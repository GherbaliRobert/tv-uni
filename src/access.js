const crypto = require('crypto');

const COOKIE = 'panou_acces';
const DAY_MS = 24 * 3600 * 1000;
const LIFETIME_MS = { tv: 365 * DAY_MS, admin: 30 * DAY_MS };
const LANDING = { tv: '/', admin: '/meniu/' };
const MIN_PASSWORD_LENGTH = 8;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_ADDRESSES = 1000;

const digest = (text) => crypto.createHash('sha256').update(text).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// A TV keyboard capitalizes on its own and is hard to correct, so case and stray spaces don't count.
const clean = (password) => String(password ?? '').trim().toLowerCase();

const tokenFor = (role, password) => crypto.createHmac('sha256', password).update(`panou:${role}`).digest('hex');

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name) return value;
  }
  return null;
}

// The reason the server must refuse to start, or null. The panel is never served unprotected.
function passwordProblem(tvPassword, adminPassword) {
  const tv = clean(tvPassword);
  const admin = clean(adminPassword);
  if (!tv) return 'Lipsește variabila PAROLA_TV.';
  if (!admin) return 'Lipsește variabila PAROLA_LAPTOP.';
  if (tv.length < MIN_PASSWORD_LENGTH || admin.length < MIN_PASSWORD_LENGTH) {
    return `Parolele trebuie să aibă cel puțin ${MIN_PASSWORD_LENGTH} caractere.`;
  }
  if (tv === admin) return 'PAROLA_TV și PAROLA_LAPTOP trebuie să fie diferite.';
  return null;
}

// Big and script-free, so it works with a TV remote and an old browser.
function passwordPage(message) {
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Panou</title>
<style>
  html { background: #0d0d0d; color: #f0efec; font: 22px "Segoe UI", system-ui, sans-serif; text-align: center; }
  body { padding: 12vh 1rem 0; }
  input, button { font: inherit; padding: .4em .6em; border-radius: .2em; border: 2px solid #989690; }
  input { width: 12em; max-width: 100%; background: #1a1a19; color: inherit; }
  button { background: #3987e5; color: #fff; border-color: #3987e5; font-weight: 700; }
  p { color: #c3c2b7; }
</style>
</head>
<body>
<h1>Parolă</h1>
${message ? `<p>${message}</p>` : ''}
<form method="post" action="/intra">
  <input type="password" name="parola" autofocus autocomplete="current-password">
  <button>Intră</button>
</form>
</body>
</html>`;
}

function createAccess({ tvPassword, adminPassword }) {
  const tokens = { admin: tokenFor('admin', clean(adminPassword)), tv: tokenFor('tv', clean(tvPassword)) };
  const failures = new Map();

  function roleOf(req) {
    const cookie = readCookie(req.headers.cookie, COOKIE);
    if (!cookie) return null;
    if (same(cookie, tokens.admin)) return 'admin';
    if (same(cookie, tokens.tv)) return 'tv';
    return null;
  }

  function isBlocked(address) {
    const entry = failures.get(address);
    if (!entry) return false;
    if (Date.now() - entry.since > FAILURE_WINDOW_MS) {
      failures.delete(address);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  function recordFailure(address) {
    if (failures.size >= MAX_TRACKED_ADDRESSES) failures.clear();
    const entry = failures.get(address) ?? { count: 0, since: Date.now() };
    entry.count += 1;
    failures.set(address, entry);
  }

  function refuse(req, res, status, message) {
    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/') || req.baseUrl.startsWith('/api/')) {
      res.status(status).json({ error: message });
      return;
    }
    res.status(status).type('html').send(passwordPage(message));
  }

  return {
    login(req, res) {
      res.set('Cache-Control', 'no-store');
      if (isBlocked(req.ip)) {
        res.status(429).type('html').send(passwordPage('Prea multe încercări. Mai încearcă peste 15 minute.'));
        return;
      }
      const given = clean(req.body?.parola);
      const role = [['admin', adminPassword], ['tv', tvPassword]]
        .find(([, password]) => same(given, clean(password)))?.[0];
      if (!role) {
        recordFailure(req.ip);
        res.status(401).type('html').send(passwordPage('Parola nu este corectă.'));
        return;
      }
      failures.delete(req.ip);
      res.cookie(COOKIE, tokens[role], {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.get('x-forwarded-proto') === 'https',
        maxAge: LIFETIME_MS[role],
      });
      res.redirect(303, LANDING[role]);
    },

    logout(req, res) {
      res.clearCookie(COOKIE);
      res.redirect(303, '/');
    },

    // Every request needs a password, this machine's included.
    gate(req, res, next) {
      req.role = roleOf(req);
      if (req.role) next();
      else refuse(req, res, 401, 'Lipsește parola');
    },

    requireAdmin(req, res, next) {
      if (req.role === 'admin') next();
      else refuse(req, res, 403, 'Meniul se deschide cu parola de laptop.');
    },
  };
}

module.exports = { createAccess, passwordProblem };
