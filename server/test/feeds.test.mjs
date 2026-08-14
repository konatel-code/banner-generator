import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { useTempCache, startAssetServer, fixtureFeedText } from './helpers.mjs';

useTempCache();
process.env.LINK_TEMPLATE = 'https://www.ckdaka.sk/zajazd/{slug}-{code}';

const assets = await startAssetServer();
const { loadFromText } = await import('../feed-store.js');
const { buildItems } = await import('../feeds/items.js');
const { SERIALIZERS, googleMerchantXml, metaCatalogCsv, googleAdsDynamicCsv } =
  await import('../feeds/formats.js');

const feed = loadFromText(fixtureFeedText(assets.base));
await assets.close();

const BASE = 'https://banner.ckdaka.sk';
const items = buildItems(feed.tours, { base: BASE, from: '2035-01-01' });

test('každý zájazd s termínom má položku', () => {
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.id), ['D1001-20350717', 'D1002-20350903', 'D1003-20350601']);
});

test('viac termínov vytvorí viac položiek s rovnakým item_group_id', () => {
  const many = buildItems(feed.tours, { base: BASE, terms: 5, from: '2035-01-01' });
  assert.equal(many.length, 4);                       // D1001 má 2 termíny
  const d1001 = many.filter(i => i.itemGroupId === 'D1001');
  assert.equal(d1001.length, 2);
  assert.equal(d1001[0].price, 729.5);
  assert.equal(d1001[1].price, 849);
});

test('termíny v minulosti sa preskočia', () => {
  const later = buildItems(feed.tours, { base: BASE, terms: 5, from: '2035-08-01' });
  assert.ok(!later.some(i => i.dateFrom < '2035-08-01'), 'vo feede ostal starý termín');
});

test('obrázok položky ukazuje na render endpoint s termínom', () => {
  const it = items[0];
  assert.equal(it.imageLink, `${BASE}/img/D1001/1200x628.jpg?term=2035-07-17`);
  assert.equal(it.additionalImages.length, 2);
  assert.match(it.additionalImages[0], /1080x1080\.jpg/);
  assert.match(it.additionalImages[1], /1080x1920\.jpg/);
});

test('odkaz sa poskladá zo šablóny LINK_TEMPLATE', () => {
  assert.equal(items[0].link, 'https://www.ckdaka.sk/zajazd/slnecne-pobrezie-hotel-kaliakra-4-s-dopravou-do-bulharska-D1001');
});

test('limit oreže počet položiek', () => {
  assert.equal(buildItems(feed.tours, { base: BASE, limit: 2, from: '2035-01-01' }).length, 2);
});

test('Google Merchant XML je platné XML so správnymi poľami', () => {
  const xml = googleMerchantXml(items);
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  const nodes = doc.getElementsByTagName('item');
  assert.equal(nodes.length, 3);
  const first = nodes[0];
  const val = (t) => first.getElementsByTagName(t)[0]?.textContent;
  assert.equal(val('g:id'), 'D1001-20350717');
  assert.equal(val('g:price'), '729.50 EUR');
  assert.equal(val('g:availability'), 'in stock');
  assert.match(val('g:image_link'), /^https:\/\/banner\.ckdaka\.sk\/img\//);
  assert.equal(first.getElementsByTagName('g:additional_image_link').length, 2);
});

test('XML escapuje ampersandy v názvoch', () => {
  const tricky = [{ ...items[0], title: 'Zájazd & pobyt <špeciál>' }];
  const xml = googleMerchantXml(tricky);
  assert.ok(xml.includes('Zájazd &amp; pobyt &lt;špeciál&gt;'));
  const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
  assert.equal(doc.getElementsByTagName('g:title')[0].textContent, 'Zájazd & pobyt <špeciál>');
});

test('Meta CSV má rovnaký počet stĺpcov vo všetkých riadkoch', () => {
  const csv = metaCatalogCsv(items);
  const rows = csv.trim().split('\r\n');
  assert.equal(rows.length, items.length + 1);
  const cols = (r) => r.match(/(".*?"|[^,]*)(,|$)/g).length;
  const head = cols(rows[0]);
  for (const r of rows.slice(1)) assert.equal(cols(r), head);
  assert.ok(rows[0].startsWith('id,title,description'));
});

test('CSV zabalí hodnoty s čiarkou do úvodzoviek', () => {
  const csv = metaCatalogCsv([{ ...items[0], title: 'Hotel, Bulharsko' }]);
  assert.ok(csv.includes('"Hotel, Bulharsko"'));
});

test('Google Ads dynamický feed má očakávané stĺpce', () => {
  const csv = googleAdsDynamicCsv(items);
  const head = csv.split('\r\n')[0];
  assert.equal(head, 'ID,ID2,Item title,Item subtitle,Item description,Item category,Price,Sale price,Final URL,Image URL,Contextual keywords,Item ID');
});

test('všetky serializéry zvládnu prázdny vstup', () => {
  for (const [name, ser] of Object.entries(SERIALIZERS)) {
    const out = ser.fn([]);
    assert.equal(typeof out, 'string', `${name} nevrátil text`);
    assert.ok(out.length > 0, `${name} vrátil prázdno`);
  }
});
