const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAccessGate } = require('../src/access');

const KEY = 'abcd-efgh-jkmn';

async function withServer(run) {
  const app = express();
  app.use(createAccessGate(KEY));
  app.get('/', (req, res) => res.send('panou'));
  app.get('/api/date', (req, res) => res.json({ secret: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
  try {
    await run(get);
  } finally {
    server.close();
  }
}

const cookieFrom = (response) => response.headers.get('set-cookie').split(';')[0];

test('without the key nothing is served', () => withServer(async (get) => {
  const page = await get('/');
  assert.equal(page.status, 401);
  const html = await page.text();
  assert.match(html, /Cheie de acces/);
  assert.doesNotMatch(html, /panou<|nu este corect/);

  const api = await get('/api/date');
  assert.equal(api.status, 401);
  assert.deepEqual(await api.json(), { error: 'Lipsește cheia de acces' });

  assert.equal((await get('/alta/pagina')).status, 401);
}));

test('a wrong key or a forged cookie gets the form back', () => withServer(async (get) => {
  const wrong = await get('/?cheie=gresit');
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.match(await wrong.text(), /nu este corect/);

  assert.equal((await get('/', { cookie: 'panou_acces=fals' })).status, 401);
  assert.equal((await get('/', { cookie: `panou_acces=${KEY}` })).status, 401, 'the raw key is not a valid cookie');
  assert.equal((await get('/?cheie=a&cheie=b')).status, 401);
}));

test('the right key sets a cookie and removes itself from the address', () => withServer(async (get) => {
  const login = await get(`/?cheie=${KEY}&fila=mecanizare`);
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/?fila=mecanizare');

  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(setCookie, /Secure/, 'plain http would drop a Secure cookie');
  assert.ok(!setCookie.includes(KEY), 'the cookie must not contain the key');

  const cookie = cookieFrom(login);
  const page = await get('/', { cookie });
  assert.equal(page.status, 200);
  assert.equal(await page.text(), 'panou');
  assert.deepEqual(await (await get('/api/date', { cookie })).json(), { secret: true });
}));

test('the key survives what a TV keyboard does to it, and the cookie is Secure over https', () => withServer(async (get) => {
  const login = await get(`/?cheie=%20${KEY.toUpperCase()}%20`, { 'x-forwarded-proto': 'https' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/');
  assert.match(login.headers.get('set-cookie'), /Secure/);
}));

test('a key set with capitals or spaces on the host still works', async () => {
  const gate = createAccessGate(`  ${KEY.toUpperCase()} `);
  const app = express();
  app.use(gate);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/?cheie=${KEY}`, { redirect: 'manual' });
  server.close();
  assert.equal(response.status, 302);
});

test('a login on any path lands on the root, never on an outside address', () => withServer(async (get) => {
  const login = await get(`//rau.example/?cheie=${KEY}`);
  assert.equal(login.headers.get('location'), '/');
}));
