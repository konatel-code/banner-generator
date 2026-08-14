import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadImage } from '@napi-rs/canvas';
import { useTempCache, startAssetServer, fixtureFeedText } from './helpers.mjs';

// Poradie je dôležité: config.js číta env pri importe, takže adresu loga
// musíme nastaviť skôr, než sa modul načíta.
useTempCache();
const assets = await startAssetServer();
process.env.LOGO_URL = `${assets.base}/logo.png`;

const { loadFromText } = await import('../feed-store.js');
const { renderBanner, pickImages } = await import('../render.js');
const { allSizes, STYLES } = await import('../../shared/formats.js');

const feed = loadFromText(fixtureFeedText(assets.base));

after(async () => { await assets.close(); });

test('vyrenderuje každý rozmer v každom štýle so správnymi rozmermi', async () => {
  const tour = feed.byId.get('D1001');
  let count = 0;

  for (const style of STYLES) {
    for (const size of allSizes()) {
      const out = await renderBanner({
        tour, w: size.w, h: size.h, style, ext: 'jpg', feedVersion: feed.version,
      });
      assert.ok(out.buffer.length > 500, `${style} ${size.key}: prázdny výstup`);
      const img = await loadImage(out.buffer);
      assert.equal(img.width, size.w, `${style} ${size.key}: zlá šírka`);
      assert.equal(img.height, size.h, `${style} ${size.key}: zlá výška`);
      count++;
    }
  }
  assert.ok(count >= 3 * 10, `očakávaných aspoň 30 kombinácií, bolo ${count}`);
});

test('podporuje png aj webp', async () => {
  const tour = feed.byId.get('D1002');
  for (const [ext, mime] of [['png', 'image/png'], ['webp', 'image/webp'], ['jpg', 'image/jpeg']]) {
    const out = await renderBanner({ tour, w: 300, h: 250, ext, feedVersion: feed.version });
    assert.equal(out.mime, mime);
    const img = await loadImage(out.buffer);
    assert.equal(img.width, 300);
  }
});

test('konkrétny termín zmení cenu na bannery', async () => {
  const tour = feed.byId.get('D1001');
  const a = await renderBanner({ tour, w: 300, h: 250, ext: 'png', feedVersion: feed.version });
  const b = await renderBanner({ tour, w: 300, h: 250, ext: 'png', term: '2035-08-07', feedVersion: feed.version });
  assert.notEqual(a.etag, b.etag, 'banner s termínom musí mať iný etag');
  assert.notEqual(a.buffer.length, b.buffer.length, 'obsah bannera sa má líšiť');
});

test('druhé volanie ide z cache', async () => {
  const tour = feed.byId.get('D1003');
  const first  = await renderBanner({ tour, w: 728, h: 90, ext: 'jpg', feedVersion: feed.version });
  const second = await renderBanner({ tour, w: 728, h: 90, ext: 'jpg', feedVersion: feed.version });
  assert.equal(second.cached, true);
  assert.equal(first.etag, second.etag);
  assert.deepEqual(second.buffer, first.buffer);
});

test('automatický výber fotky preferuje fotografiu pred ikonou', async () => {
  const tour = feed.byId.get('D1001');   // 2 fotky + 1 biela ikona s ikonkou
  const picked = await pickImages(tour, feed.version + ':pick');
  for (const cat of ['portrait', 'landscape', 'strip']) {
    assert.ok(!picked[cat].includes('icon-feature'), `${cat}: vybraná ikona namiesto fotky`);
  }
  // Na výšku orientované formáty dostanú fotku na výšku
  assert.match(picked.portrait, /photo-portrait/);
});

test('zájazd bez načítateľnej fotky sa vyrenderuje bez pádu', async () => {
  const broken = { ...feed.byId.get('D1002'), imgs: ['http://127.0.0.1:1/nic.jpg'], imgUrl: 'http://127.0.0.1:1/nic.jpg' };
  const out = await renderBanner({ tour: broken, w: 1080, h: 1080, ext: 'jpg', feedVersion: 'broken' });
  const img = await loadImage(out.buffer);
  assert.equal(img.width, 1080);
});
