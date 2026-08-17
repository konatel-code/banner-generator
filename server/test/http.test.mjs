import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '@napi-rs/canvas';
import { useTempCache, startAssetServer, fixtureFeedText } from './helpers.mjs';

useTempCache();
const assets = await startAssetServer();
process.env.LOGO_URL = `${assets.base}/logo.png`;
process.env.PUBLIC_URL = '';               // adresa sa má odvodiť z hlavičiek

const { loadFromText } = await import('../feed-store.js');
const { server } = await import('../index.js');

const feed = loadFromText(fixtureFeedText(assets.base));
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  await new Promise(r => server.close(r));
  await assets.close();
});

const get = (p, init) => fetch(base + p, init);

test('/health hlási načítaný feed a fonty', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.feed.tours, 3);
  assert.equal(body.fonts.ok, true);
  assert.ok(body.sizes.includes('300x250'));
});

test('/img vráti obrázok v požadovanom rozmere', async () => {
  const res = await get('/img/D1001/300x250.jpg');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const img = await loadImage(Buffer.from(await res.arrayBuffer()));
  assert.equal(img.width, 300);
  assert.equal(img.height, 250);
});

test('/img odpovie 304 na známy ETag', async () => {
  const first = await get('/img/D1001/728x90.jpg');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  const second = await get('/img/D1001/728x90.jpg', { headers: { 'If-None-Match': etag } });
  assert.equal(second.status, 304);
});

test('/img odmietne neznámy zájazd, rozmer aj štýl', async () => {
  assert.equal((await get('/img/NEEXISTUJE/300x250.jpg')).status, 404);
  assert.equal((await get('/img/D1001/123x456.jpg')).status, 400);
  assert.equal((await get('/img/D1001/300x250.gif')).status, 400);
  assert.equal((await get('/img/D1001/300x250.jpg?style=neon')).status, 400);
  assert.equal((await get('/img/D1001/300x250.jpg?term=zajtra')).status, 400);
});

test('/img nedovolí vykresliť cudziu fotku', async () => {
  // parameter img je index do fotiek zájazdu, nie ľubovoľná URL
  assert.equal((await get('/img/D1001/300x250.jpg?img=99')).status, 400);
  assert.equal((await get('/img/D1001/300x250.jpg?img=1')).status, 200);
});

test('/feed vypíše dostupné feedy', async () => {
  const body = await (await get('/feed')).json();
  assert.ok(body.feeds.some(u => u.endsWith('/feed/google-merchant.xml')));
});

// Fixture má pevné dátumy, preto testy feedu posúvajú "dnešok" dozadu –
// inak by po prebehnutí termínov ostal feed prázdny.
const FROM = 'from=2035-01-01';

test('/feed/google-merchant.xml obsahuje absolútne URL na túto službu', async () => {
  const res = await get(`/feed/google-merchant.xml?terms=3&${FROM}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  assert.equal(res.headers.get('x-feed-version'), feed.version);
  const xml = await res.text();
  assert.ok(xml.includes(`<g:image_link>${base}/img/D1001/1200x628.jpg`), 'chýba odkaz na render endpoint');
  assert.equal(Number(res.headers.get('x-item-count')), 4);
});

test('/feed odmietne neplatný parameter from', async () => {
  assert.equal((await get('/feed/google-merchant.xml?from=vlani')).status, 400);
});

test('obrázok z feedu sa dá stiahnuť tak, ako ho uvidí platforma', async () => {
  const xml = await (await get(`/feed/google-merchant.xml?${FROM}`)).text();
  const url = /<g:image_link>([^<]+)<\/g:image_link>/.exec(xml)[1];
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const img = await loadImage(Buffer.from(await res.arrayBuffer()));
  assert.equal(img.width, 1200);
  assert.equal(img.height, 628);
});

test('/feed/meta-catalog.csv sa servíruje ako CSV', async () => {
  const res = await get(`/feed/meta-catalog.csv?${FROM}`);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.ok(csv.startsWith('id,title,description'));
});

test('neznámy feed vráti 404', async () => {
  assert.equal((await get('/feed/neexistuje.csv')).status, 404);
});

test('statické súbory sa servírujú z koreňa repozitára', async () => {
  const res = await get('/shared/formats.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.ok((await res.text()).includes('export const FORMATS'));
});

test('cesta mimo repozitára je zamietnutá', async () => {
  const res = await fetch(`${base}/../../etc/passwd`, { redirect: 'manual' });
  assert.ok([400, 403, 404].includes(res.status), `neočakávaný status ${res.status}`);
});

test('zápisové metódy sú zakázané', async () => {
  assert.equal((await get('/img/D1001/300x250.jpg', { method: 'POST' })).status, 405);
});
