import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempCache, startAssetServer, fixtureFeedText } from './helpers.mjs';

useTempCache();
const assets = await startAssetServer();
process.env.LOGO_URL = `${assets.base}/logo.png`;
process.env.BANNER_PASSWORD = 'tajne-heslo';
process.env.BANNER_SECRET = 'testovaci-kluc-aspon-32-znakov-dlhy';

const { loadFromText } = await import('../feed-store.js');
const { tokenFor, verifyToken, checkPassword, authEnabled } = await import('../auth.js');
const { server } = await import('../index.js');

loadFromText(fixtureFeedText(assets.base));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise(r => server.close(r));
  await assets.close();
});

// ── Overovanie hesla ────────────────────────────────────────────────────────

test('správne heslo vráti token, nesprávne nie', () => {
  assert.equal(authEnabled(), true);
  const ok = checkPassword('tajne-heslo');
  assert.equal(ok.ok, true);
  assert.equal(ok.token, tokenFor());
  assert.equal(checkPassword('zle-heslo').ok, false);
  assert.equal(checkPassword('').ok, false);
  assert.equal(checkPassword(undefined).ok, false);
});

test('token platí len pre dnešok', () => {
  assert.equal(verifyToken(tokenFor()), true);
  assert.equal(verifyToken(tokenFor('2020-01-01')), false);
  assert.equal(verifyToken('nezmysel'), false);
  assert.equal(verifyToken(''), false);
});

// ── HTTP rozhranie ──────────────────────────────────────────────────────────

test('/api/check-auth pustí správne heslo a odmietne zlé', async () => {
  const post = (password) => fetch(`${base}/api/check-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });

  const ok = await post('tajne-heslo');
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.ok(body.token);

  const bad = await post('zle-heslo');
  assert.equal(bad.status, 401);
  assert.equal((await bad.json()).ok, false);
});

test('heslo sa v odpovedi nikdy neobjaví', async () => {
  const res = await fetch(`${base}/api/check-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'zle-heslo' }),
  });
  const text = await res.text();
  assert.ok(!text.includes('tajne-heslo'), 'v odpovedi je skutočné heslo');
});

test('/api/verify-auth overí uložený token', async () => {
  const ok = await (await fetch(`${base}/api/verify-auth?token=${tokenFor()}`)).json();
  assert.equal(ok.ok, true);

  const bad = await (await fetch(`${base}/api/verify-auth?token=podvrh`)).json();
  assert.equal(bad.ok, false);

  const none = await (await fetch(`${base}/api/verify-auth`)).json();
  assert.equal(none.ok, false);
});

test('check-auth prijíma len POST a odmietne obrovské telo', async () => {
  assert.equal((await fetch(`${base}/api/check-auth`)).status, 405);
  // Príliš veľké telo dostane riadnu odpoveď, nie zhodené spojenie
  const huge = await fetch(`${base}/api/check-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'x'.repeat(20000) }),
  });
  assert.equal(huge.status, 413);
  assert.equal((await huge.json()).ok, false);
});

// ── Statické súbory ─────────────────────────────────────────────────────────

test('servíruje sa appka a zdieľané moduly', async () => {
  const app = await fetch(`${base}/`);
  assert.equal(app.status, 200);
  assert.ok((await app.text()).includes('<title>'));

  const mod = await fetch(`${base}/shared/formats.js`);
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /javascript/);
});

test('nič iné z repozitára sa von nedostane', async () => {
  // Zdrojáky služby, závislosti, cache ani git nesmú byť dostupné
  for (const p of [
    '/server/config.js',
    '/server/upload/google-ads.js',
    '/server/node_modules/@napi-rs/canvas/package.json',
    '/server/.cache/upload-state.json',
    '/package.json',
    '/.git/config',
    '/docs/NASADENIE.md',
    '/shared/../server/auth.js',
  ]) {
    const res = await fetch(`${base}${p}`, { redirect: 'manual' });
    assert.ok(res.status === 404 || res.status === 400 || res.status === 301,
      `${p} vrátilo ${res.status} – nemalo by byť dostupné`);
  }
});

test('/health hlási, že prihlasovanie je zapnuté', async () => {
  const body = await (await fetch(`${base}/health`)).json();
  assert.equal(body.auth, 'heslo');
});
