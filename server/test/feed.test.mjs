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

// ── Odkaz na detail zájazdu ─────────────────────────────────────────────────

test('odkaz sa načíta z priameho potomka <url>', () => {
  assert.equal(tours[0].url, 'https://www.ckdaka.sk/zajazd/hotel-kaliakra-bulharsko-D1001');
});

test('<url> vnorená v PRICELIST_INFO sa nepomýli s odkazom na zájazd', () => {
  // Fixture má v PRICELIST_INFO odkaz na cenník; ten je v XML skôr,
  // takže naivné getElementsByTagName('url')[0] by vrátilo jeho
  assert.ok(!tours[0].url.includes('/cennik/'), `parser vzal odkaz na cenník: ${tours[0].url}`);
});

test('tag <URL> veľkými písmenami sa načíta tiež', () => {
  assert.equal(tours[2].url, '/zajazd/hotel-anmaria-cyprus-D1003');
});

test('bez odkazu vo feede zostane pole prázdne', () => {
  assert.equal(tours[1].url, '');
});

test('nepoužiteľné hodnoty v <url> sa zahodia', async () => {
  const { parseFeedText } = await import('../feed-store.js');
  const xml = (inner) => `<?xml version="1.0"?><cesys>
    <accommodation code="X" name="Zájazd do Grécka">
      ${inner}
      <dates><date date_from="2035-06-01" date_to="2035-06-08"><final_price>100</final_price></date></dates>
    </accommodation></cesys>`;

  assert.equal(parseFeedText(xml('<url>javascript:alert(1)</url>'))[0].url, '');
  assert.equal(parseFeedText(xml('<url>   </url>'))[0].url, '');
  assert.equal(parseFeedText(xml('<url>zajazd/bez-lomky</url>'))[0].url, '');
  // Adresa bez protokolu sa doplní na https
  assert.equal(parseFeedText(xml('<url>//www.ckdaka.sk/z/X</url>'))[0].url, 'https://www.ckdaka.sk/z/X');
  // Zalomený riadok a medzery okolo adresy neprekážajú
  assert.equal(parseFeedText(xml('<url>\n  https://www.ckdaka.sk/z/X\n</url>'))[0].url,
    'https://www.ckdaka.sk/z/X');
});

test('feedStatus hlási, koľko odkazov prišlo z feedu', async () => {
  const { loadFromText, feedStatus } = await import('../feed-store.js');
  const a = await startAssetServer();
  loadFromText(fixtureFeedText(a.base));
  await a.close();
  const { links } = feedStatus();
  assert.equal(links.fromFeed, 2);       // D1001 a D1003
  assert.equal(links.fromTemplate, 1);   // D1002 padne na šablónu
  assert.equal(links.example, 'https://www.ckdaka.sk/zajazd/hotel-kaliakra-bulharsko-D1001');
});
