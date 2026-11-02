const crypto = require('crypto');

const COOKIE = 'panou_acces';
const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

const digest = (text) => crypto.createHash('sha256').update(text).digest();
const matches = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

function readCookie(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const [key, value] = part.trim().split('=');
    if (key === name) return value;
  }
  return null;
}

// Big and script-free, so it works with a TV remote and an old browser.
function keyPage(wrong) {
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Panou</title>
<style>
  html { background: #0d0d0d; color: #f0efec; font: 3vw "Segoe UI", system-ui, sans-serif; text-align: center; }
  body { padding-top: 12vh; }
  input, button { font: inherit; padding: .4em .6em; border-radius: .2em; border: 2px solid #989690; }
  input { width: 12em; background: #1a1a19; color: inherit; }
  button { background: #3987e5; color: #fff; border-color: #3987e5; font-weight: 700; }
  p { color: #c3c2b7; }
</style>
</head>
<body>
<h1>Cheie de acces</h1>
${wrong ? '<p>Cheia nu este corectă.</p>' : ''}
<form method="get" action="/">
  <input name="cheie" autofocus autocomplete="off" autocapitalize="off" spellcheck="false">
  <button>Intră</button>
</form>
</body>
</html>`;
}

// Every request needs the key, this machine's included: a public tunnel also arrives from
// localhost, so the source address proves nothing. The cookie holds a hash, not the key.
function createAccessGate(rawKey) {
  const key = rawKey.trim().toLowerCase();
  const token = digest(key).toString('hex');

  return (req, res, next) => {
    const given = req.query.cheie;
    const hasValidKey = typeof given === 'string' && matches(given.trim().toLowerCase(), key);

    if (hasValidKey) {
      const others = new URLSearchParams(req.query);
      others.delete('cheie');
      const query = others.toString();
      res.set('Cache-Control', 'no-store');
      res.cookie(COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.get('x-forwarded-proto') === 'https',
        maxAge: ONE_YEAR_MS,
      });
      // Always to the root: echoing the requested path back would make this an open redirect.
      res.redirect(`/${query ? `?${query}` : ''}`);
      return;
    }

    const cookie = readCookie(req.headers.cookie, COOKIE);
    if (cookie && matches(cookie, token)) {
      next();
      return;
    }

    res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ error: 'Lipsește cheia de acces' });
      return;
    }
    res.status(401).type('html').send(keyPage(typeof given === 'string'));
  };
}

module.exports = { createAccessGate };
