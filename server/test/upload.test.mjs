import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ── Falošné Google API ──────────────────────────────────────────────────────
// Testy nesmú siahať na skutočný účet, preto si Google Ads aj OAuth
// odsimulujeme lokálne. Overujeme tvar požiadaviek, nie odpovede Googlu.
const calls = [];
let tokenCalls = 0;
let failuresLeft = 0;      // koľkokrát po sebe vrátiť 500
let duplicateNext = false; // ďalší upload odmietnuť ako duplicitný

const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };

    if (req.url === '/token') {
      tokenCalls++;
      return json(200, { access_token: `tok-${tokenCalls}`, expires_in: 3600 });
    }

    calls.push({ url: req.url, headers: req.headers, body: JSON.parse(body || '{}') });

    if (failuresLeft > 0) { failuresLeft--; return json(500, { error: 'dočasná chyba' }); }

    if (req.url.endsWith('/assets:mutate')) {
      if (duplicateNext) {
        duplicateNext = false;
        return json(400, { error: { details: [{ errors: [{ errorCode: 'DUPLICATE_ASSET' }] }] } });
      }
      return json(200, { results: [{ resourceName: 'customers/1234567890/assets/999' }] });
    }

    if (req.url.endsWith('/googleAds:search')) {
      return json(200, { results: [{ asset: { resourceName: 'customers/1234567890/assets/111', name: 'DAKA_D1001_min_300x250_dark', type: 'IMAGE' } }] });
    }

    json(404, { error: 'nepodporované' });
  });
});

await new Promise(r => api.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${api.address().port}`;

process.env.GOOGLE_ADS_ENDPOINT = apiBase;
process.env.GOOGLE_TOKEN_URL = `${apiBase}/token`;
process.env.GOOGLE_ADS_API_VERSION = 'v18';

const { GoogleAdsClient, normalizeCustomerId } = await import('../upload/google-ads.js');
const { getAccessToken, clearTokenCache } = await import('../upload/oauth.js');
const { UploadState, contentHash } = await import('../upload/state.js');
const { assetName, planUploads } = await import('../upload.js');

const CREDS = {
  clientId: 'cid', clientSecret: 'secret', refreshToken: 'refresh',
  developerToken: 'devtoken', customerId: '1234567890', loginCustomerId: '9999999999',
};

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ckdaka-upload-'));

after(async () => {
  await new Promise(r => api.close(r));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── OAuth ───────────────────────────────────────────────────────────────────

test('prístupový token sa cachuje a neťahá pri každom volaní', async () => {
  clearTokenCache();
  const before = tokenCalls;
  const a = await getAccessToken(CREDS);
  const b = await getAccessToken(CREDS);
  assert.equal(a, b);
  assert.equal(tokenCalls, before + 1, 'token sa mal stiahnuť len raz');
});

test('chýbajúce OAuth údaje zlyhajú zrozumiteľne', async () => {
  await assert.rejects(() => getAccessToken({ clientId: 'x' }), /Chýbajú OAuth údaje/);
});

// ── Klient ──────────────────────────────────────────────────────────────────

test('ID zákazníka sa očistí od pomlčiek', () => {
  assert.equal(normalizeCustomerId('123-456-7890'), '1234567890');
});

test('klient odmietne neúplné prihlasovacie údaje', () => {
  assert.throws(() => new GoogleAdsClient({ clientId: 'a' }), /Chýbajúce údaje pre Google Ads/);
});

test('upload pošle obrázok v base64 so správnymi hlavičkami', async () => {
  calls.length = 0;
  const client = new GoogleAdsClient(CREDS);
  const buffer = Buffer.from('fake-png-bytes');

  const res = await client.uploadImageAsset({ buffer, name: 'DAKA_D1001_min_300x250_dark' });
  assert.equal(res.resourceName, 'customers/1234567890/assets/999');
  assert.equal(res.duplicate, false);

  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call.url.includes('/v18/customers/1234567890/assets:mutate'), `zlá cesta: ${call.url}`);
  assert.equal(call.headers['developer-token'], 'devtoken');
  assert.equal(call.headers['login-customer-id'], '9999999999');
  assert.match(call.headers.authorization, /^Bearer tok-/);

  const create = call.body.operations[0].create;
  assert.equal(create.type, 'IMAGE');
  assert.equal(create.name, 'DAKA_D1001_min_300x250_dark');
  assert.equal(Buffer.from(create.imageAsset.data, 'base64').toString(), 'fake-png-bytes');
});

test('dočasná chyba servera sa zopakuje', async () => {
  calls.length = 0;
  failuresLeft = 2;
  const client = new GoogleAdsClient(CREDS, { retries: 3 });
  const res = await client.uploadImageAsset({ buffer: Buffer.from('x'), name: 'test-retry' });
  assert.equal(res.resourceName, 'customers/1234567890/assets/999');
  assert.equal(calls.length, 3, 'očakávané dva neúspešné pokusy a jeden úspešný');
});

test('trvalá chyba sa neopakuje donekonečna', async () => {
  calls.length = 0;
  failuresLeft = 99;
  const client = new GoogleAdsClient(CREDS, { retries: 1 });
  await assert.rejects(
    () => client.uploadImageAsset({ buffer: Buffer.from('x'), name: 'test-fail' }),
    /Google Ads API 500/);
  assert.equal(calls.length, 2, 'jeden pokus + jedno opakovanie');
  failuresLeft = 0;
});

test('duplicitný podklad sa nepovažuje za chybu', async () => {
  calls.length = 0;
  duplicateNext = true;
  const client = new GoogleAdsClient(CREDS, { retries: 0 });
  const res = await client.uploadImageAsset({ buffer: Buffer.from('x'), name: 'DAKA_D1001_min_300x250_dark' });
  assert.equal(res.duplicate, true);
  assert.equal(res.resourceName, 'customers/1234567890/assets/111', 'mal dohľadať existujúci podklad');
});

// ── Stav ────────────────────────────────────────────────────────────────────

test('stav si pamätá nahraté podklady medzi behmi', async () => {
  const file = path.join(tmpDir, 'state.json');
  const hash = contentHash(Buffer.from('banner-v1'));

  const first = await new UploadState(file, 'google-ads').load();
  assert.equal(first.isUploaded('A', hash), false);
  first.record('A', { hash, resourceName: 'customers/1/assets/2', name: 'A' });
  await first.save();

  const second = await new UploadState(file, 'google-ads').load();
  assert.equal(second.isUploaded('A', hash), true, 'stav sa nenačítal zo súboru');
  assert.equal(second.get('A').resourceName, 'customers/1/assets/2');
});

test('zmena obsahu bannera si vynúti nové nahratie', async () => {
  const file = path.join(tmpDir, 'state2.json');
  const state = await new UploadState(file, 'google-ads').load();
  state.record('A', { hash: contentHash(Buffer.from('cena 729')), resourceName: 'x', name: 'A' });

  // Zmenila sa cena → iný obsah → iný hash → nahrať znova
  assert.equal(state.isUploaded('A', contentHash(Buffer.from('cena 849'))), false);
});

test('staleKeys nájde podklady, ktoré už v dávke nie sú', async () => {
  const state = await new UploadState(path.join(tmpDir, 'state3.json'), 'google-ads').load();
  state.record('A', { hash: 'h', resourceName: 'x', name: 'A' });
  state.record('B', { hash: 'h', resourceName: 'y', name: 'B' });
  assert.deepEqual(state.staleKeys(['A']), ['B']);
});

test('poškodený súbor stavu neurobí z behu pád', async () => {
  const file = path.join(tmpDir, 'broken.json');
  await fs.writeFile(file, '{toto nie je json');
  const state = await new UploadState(file, 'google-ads').load();
  assert.equal(state.stats().count, 0);
});

// ── Plánovanie ──────────────────────────────────────────────────────────────

test('názov podkladu je jedinečný pre kombináciu zájazd/termín/rozmer/štýl', () => {
  assert.equal(assetName({ code: 'D1001', term: '2035-07-17', w: 300, h: 250, style: 'dark' }),
               'DAKA_D1001_20350717_300x250_dark');
  assert.equal(assetName({ code: 'D1001', term: null, w: 1200, h: 628, style: 'light-wave' }),
               'DAKA_D1001_min_1200x628_light-wave');
});

test('plán pokryje každý termín × každý rozmer', () => {
  const tour = {
    id: 'D1001',
    terms: [
      { dateFrom: '2035-07-17', price: 729.5 },
      { dateFrom: '2035-08-07', price: 849 },
      { dateFrom: '2030-01-01', price: 100 },   // v minulosti voči `today`
    ],
  };
  const plan = planUploads([tour], {
    sizes: [{ w: 300, h: 250 }, { w: 728, h: 90 }],
    style: 'dark', terms: 2, today: '2035-01-01',
  });
  assert.equal(plan.length, 4);
  assert.deepEqual([...new Set(plan.map(p => p.term))], ['2035-07-17', '2035-08-07']);
  assert.ok(plan.every(p => p.name.startsWith('DAKA_D1001_')));
});

test('zájazd bez budúceho termínu sa naplánuje aspoň s minimálnou cenou', () => {
  const plan = planUploads([{ id: 'D9', terms: [] }], {
    sizes: [{ w: 300, h: 250 }], style: 'dark', terms: 1, today: '2035-01-01',
  });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].term, null);
  assert.match(plan[0].name, /_min_/);
});
