const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAccess, passwordProblem } = require('../src/access');

const TV = 'parola-televizor';
const LAPTOP = 'parola-laptop-1';

async function withServer(run) {
  const access = createAccess({ tvPassword: TV, adminPassword: LAPTOP });
  const app = express();
  app.post('/intra', express.urlencoded({ extended: false }), access.login);
  app.post('/iesi', access.logout);
  app.use(access.gate);
  app.get('/', (req, res) => res.send('monitor'));
  app.get('/api/date', (req, res) => res.json({ secret: true }));
  const menu = express.Router();
  menu.use(access.requireAdmin);
  menu.get('/', (req, res) => res.json({ menu: true }));
  menu.post('/import', (req, res) => res.json({ imported: true }));
  app.use('/api/meniu', menu);
  app.get('/meniu/', access.requireAdmin, (req, res) => res.send('meniu'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { cookie, ...options } = {}) => fetch(base + path, {
    redirect: 'manual',
    ...options,
    headers: { ...(cookie ? { cookie } : {}), ...options.headers },
  });
  const login = (password, headers = {}) => request('/intra', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams({ parola: password }).toString(),
  });
  try {
    await run({ request, login });
  } finally {
    server.close();
  }
}

const cookieFrom = (response) => response.headers.get('set-cookie').split(';')[0];

test('without a password nothing is served', () => withServer(async ({ request }) => {
  const page = await request('/');
  assert.equal(page.status, 401);
  const html = await page.text();
  assert.match(html, /Parolă/);
  assert.doesNotMatch(html, /monitor/);

  const api = await request('/api/date');
  assert.equal(api.status, 401);
  assert.equal((await api.json()).error, 'Lipsește parola');

  assert.equal((await request('/meniu/')).status, 401);
  assert.equal((await request('/api/meniu/')).status, 401);
  assert.equal((await request('/api/meniu/import', { method: 'POST' })).status, 401);
}));

test('the TV password opens the monitor and nothing else', () => withServer(async ({ request, login }) => {
  const response = await login(TV);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/');
  const cookie = cookieFrom(response);

  assert.equal(await (await request('/', { cookie })).text(), 'monitor');
  assert.deepEqual(await (await request('/api/date', { cookie })).json(), { secret: true });

  assert.equal((await request('/meniu/', { cookie })).status, 403);
  assert.match(await (await request('/meniu/', { cookie })).text(), /parola de laptop/);
  assert.equal((await request('/api/meniu/', { cookie })).status, 403);
  assert.equal((await request('/api/meniu/import', { cookie, method: 'POST' })).status, 403, 'a TV must not change data');
}));

test('the laptop password opens the menu and the monitor too', () => withServer(async ({ request, login }) => {
  const response = await login(LAPTOP);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/meniu/');
  const cookie = cookieFrom(response);

  assert.equal(await (await request('/meniu/', { cookie })).text(), 'meniu');
  assert.deepEqual(await (await request('/api/meniu/import', { cookie, method: 'POST' })).json(), { imported: true });
  assert.equal(await (await request('/', { cookie })).text(), 'monitor');
}));

test('a wrong password or a forged cookie gets the form back', () => withServer(async ({ request, login }) => {
  const wrong = await login('gresit-gresit');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.match(await wrong.text(), /nu este corect/);

  assert.equal((await request('/', { cookie: 'panou_acces=fals' })).status, 401);
  assert.equal((await request('/', { cookie: `panou_acces=${TV}` })).status, 401, 'the password itself is not a valid cookie');
  assert.equal((await request('/', { cookie: `panou_acces=${LAPTOP}` })).status, 401);
}));

test('the cookie is protected and hides the password', () => withServer(async ({ login }) => {
  const plain = (await login(LAPTOP)).headers.get('set-cookie');
  assert.match(plain, /HttpOnly/);
  assert.match(plain, /SameSite=Lax/);
  assert.doesNotMatch(plain, /Secure/, 'plain http would drop a Secure cookie');
  assert.ok(!plain.includes(LAPTOP));

  const secure = (await login(TV, { 'x-forwarded-proto': 'https' })).headers.get('set-cookie');
  assert.match(secure, /Secure/);
}));

test('a TV keyboard capitalizing the password does not lock anyone out', () => withServer(async ({ login }) => {
  assert.equal((await login(`  ${TV.toUpperCase()} `)).status, 303);
}));

test('leaving the menu ends access', () => withServer(async ({ request, login }) => {
  const cookie = cookieFrom(await login(LAPTOP));
  const out = await request('/iesi', { method: 'POST', cookie });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /panou_acces=;/);
}));

test('repeated wrong passwords are blocked, even if the right one follows', () => withServer(async ({ login }) => {
  for (let i = 0; i < 10; i += 1) assert.equal((await login(`gresit-${i}-parola`)).status, 401);
  const blocked = await login(LAPTOP);
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /Prea multe/);
}));

test('the server refuses to start with missing, short or identical passwords', () => {
  assert.match(passwordProblem(undefined, LAPTOP), /PAROLA_TV/);
  assert.match(passwordProblem(TV, ''), /PAROLA_LAPTOP/);
  assert.match(passwordProblem('scurt', LAPTOP), /cel puțin 8/);
  assert.match(passwordProblem(TV, ` ${TV.toUpperCase()} `), /diferite/);
  assert.equal(passwordProblem(TV, LAPTOP), null);
});
