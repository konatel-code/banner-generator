import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// ── Falošné Meta Graph API ──────────────────────────────────────────────────
// Rovnaký prístup ako pri Google Ads: overujeme tvar požiadavky, nie odpoveď
// skutočnej Mety. Do reklamného účtu sa v testoch nesiaha.
const calls = [];
let failuresLeft = 0;    // koľkokrát po sebe vrátiť dočasnú chybu
let failMode = 'http500';

const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const url = new URL(req.url, 'http://x');
    calls.push({
      path: url.pathname,
      method: req.method,
      query: Object.fromEntries(url.searchParams),
      headers: req.headers,
      form: Object.fromEntries(new URLSearchParams(body)),
    });

    if (failuresLeft > 0) {
      failuresLeft--;
      // Meta hlási limity ako HTTP 400 s kódom v tele
      if (failMode === 'ratelimit') return json(400, { error: { message: 'limit', code: 17 } });
      return json(500, { error: { message: 'dočasná chyba', code: 2 } });
    }

    if (url.pathname.endsWith('/adimages') && req.method === 'POST') {
      const name = new URLSearchParams(body).get('name') || 'bytes';
      return json(200, { images: { [name]: { hash: 'abc123hash', url: 'https://cdn.example/img.png' } } });
    }
    if (url.pathname.endsWith('/adimages')) {
      return json(200, { data: [{ hash: 'abc123hash', name: 'DAKA_D1001', url: 'https://cdn.example/img.png' }] });
    }
    json(404, { error: { message: 'nepodporované', code: 100 } });
  });
});

await new Promise(r => api.listen(0, '127.0.0.1', r));
process.env.META_ENDPOINT = `http://127.0.0.1:${api.address().port}`;
process.env.META_API_VERSION = 'v21.0';

const { MetaAdsClient, normalizeAdAccountId } = await import('../upload/meta.js');
const { TARGETS } = await import('../upload.js');

const CREDS = { accessToken: 'systok', adAccountId: 'act_123456' };

after(() => new Promise(r => api.close(r)));

test('ID reklamného účtu dostane prefix act_', () => {
  assert.equal(normalizeAdAccountId('123456'), 'act_123456');
  assert.equal(normalizeAdAccountId('act_123456'), 'act_123456');
  assert.equal(normalizeAdAccountId(''), '');
});

test('klient odmietne chýbajúci token', () => {
  assert.throws(() => new MetaAdsClient({ adAccountId: 'act_1' }), /Chýbajúce údaje pre Meta/);
});

test('upload pošle obrázok v base64 na adimages účtu', async () => {
  calls.length = 0;
  const client = new MetaAdsClient(CREDS);
  const res = await client.uploadImage({ buffer: Buffer.from('png-bytes'), name: 'DAKA_D1001_min_300x250_dark' });

  assert.equal(res.hash, 'abc123hash');
  assert.equal(res.url, 'https://cdn.example/img.png');

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/v21.0/act_123456/adimages');
  assert.equal(call.headers.authorization, 'Bearer systok');
  assert.equal(call.form.name, 'DAKA_D1001_min_300x250_dark');
  assert.equal(Buffer.from(call.form.bytes, 'base64').toString(), 'png-bytes');
});

test('token sa neposiela v URL', async () => {
  calls.length = 0;
  await new MetaAdsClient(CREDS).uploadImage({ buffer: Buffer.from('x'), name: 'n' });
  assert.equal(calls[0].query.access_token, undefined, 'token nemá byť v query – zostáva v hlavičke');
});

test('dočasná chyba servera sa zopakuje', async () => {
  calls.length = 0;
  failMode = 'http500';
  failuresLeft = 2;
  const client = new MetaAdsClient(CREDS, { retries: 3 });
  const res = await client.uploadImage({ buffer: Buffer.from('x'), name: 'retry' });
  assert.equal(res.hash, 'abc123hash');
  assert.equal(calls.length, 3);
});

test('prekročený limit (HTTP 400, kód 17) sa tiež zopakuje', async () => {
  calls.length = 0;
  failMode = 'ratelimit';
  failuresLeft = 1;
  const client = new MetaAdsClient(CREDS, { retries: 2 });
  const res = await client.uploadImage({ buffer: Buffer.from('x'), name: 'limit' });
  assert.equal(res.hash, 'abc123hash');
  assert.equal(calls.length, 2);
  failMode = 'http500';
});

test('trvalá chyba sa neopakuje donekonečna', async () => {
  calls.length = 0;
  failuresLeft = 99;
  const client = new MetaAdsClient(CREDS, { retries: 1 });
  await assert.rejects(
    () => client.uploadImage({ buffer: Buffer.from('x'), name: 'fail' }),
    /Meta API 500/);
  assert.equal(calls.length, 2);
  failuresLeft = 0;
});

test('zoznam obrázkov v účte', async () => {
  calls.length = 0;
  const images = await new MetaAdsClient(CREDS).listImages({ limit: 10 });
  assert.deepEqual(images, [{ hash: 'abc123hash', name: 'DAKA_D1001', url: 'https://cdn.example/img.png' }]);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].query.limit, '10');
  assert.match(calls[0].query.fields, /hash/);
});

test('cieľ meta v upload.js vracia hash ako referenciu', async () => {
  const target = TARGETS['meta'];
  assert.ok(target, 'cieľ meta chýba');
  const res = await target.upload(new MetaAdsClient(CREDS), { buffer: Buffer.from('x'), name: 'n' });
  assert.equal(res.ref, 'abc123hash');
});

test('oba ciele sú dostupné a majú popis', () => {
  assert.deepEqual(Object.keys(TARGETS), ['google-ads', 'meta']);
  for (const [key, t] of Object.entries(TARGETS)) {
    assert.equal(typeof t.label, 'string', `${key}: chýba label`);
    assert.equal(typeof t.upload, 'function', `${key}: chýba upload`);
    assert.equal(typeof t.list, 'function', `${key}: chýba list`);
  }
});
