import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useTempCache, startAssetServer, fixtureFeedText } from './helpers.mjs';

useTempCache();

const { parseFeedText } = await import('../feed-store.js');

const assets = await startAssetServer();
const tours = parseFeedText(fixtureFeedText(assets.base));
await assets.close();

test('parser preskočí záznamy bez kódu', () => {
  assert.equal(tours.length, 3);
  assert.deepEqual(tours.map(t => t.id), ['D1001', 'D1002', 'D1003']);
});

test('cena je minimum zo všetkých termínov', () => {
  const t = tours[0];
  assert.equal(t.minPrice, 729.5);
  assert.equal(t.terms.length, 2);
  assert.equal(t.terms[1].price, 849);
});

test('dĺžka pobytu sa počíta z dátumov', () => {
  assert.equal(tours[0].days, 10);          // 17.7. – 26.7. vrátane
  assert.equal(tours[0].dateFrom, '2035-07-17');
  assert.equal(tours[0].dateTo, '2035-07-26');
});

test('zľava sa načíta z description name="Zľavy"', () => {
  assert.equal(tours[0].maxDiscount, 25);
  assert.equal(tours[1].maxDiscount, 0);
  assert.equal(tours[2].maxDiscount, 10);
});

test('destinácia sa odvodí z názvu', () => {
  assert.equal(tours[0].dest, 'Bulharska');   // "…s dopravou do Bulharska"
  assert.equal(tours[1].dest, 'Fethiye');     // mesto pred pomlčkou
  // Pri "Letecky na Cyprus - Hotel…" sa vzor "na X" neuplatní (za destináciou
  // nenasleduje " s " ani koniec názvu), preto padne na text pred pomlčkou.
  // Heuristika je prevzatá 1:1 z pôvodného generátora – banner tento text
  // nezobrazuje ako jediný zdroj, slúži na kategorizáciu vo feede.
  assert.equal(tours[2].dest, 'Letecky na Cyprus');
});

test('obrázok main="1" je prvý v poradí', () => {
  assert.match(tours[0].imgs[0], /photo-landscape\.jpg$/);
  assert.equal(tours[0].imgs.length, 3);
  assert.equal(tours[0].imgUrl, tours[0].imgs[0]);
});
