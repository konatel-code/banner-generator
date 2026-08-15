import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { useTempCache, startAssetServer, fixtureFeedText } from './helpers.mjs';

useTempCache();
const assets = await startAssetServer();
process.env.LOGO_URL = `${assets.base}/logo.png`;
process.env.FEED_URL = assets.feedUrl;

const { snapshotOf, diffSnapshots, summarize, readSnapshot, writeSnapshot } =
  await import('../sync/snapshot.js');
const { loadFromText } = await import('../feed-store.js');
const { runOnce } = await import('../sync.js');

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ckdaka-sync-'));
const feed = loadFromText(fixtureFeedText(assets.base));

after(async () => {
  await assets.close();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Odtlačok a porovnanie ───────────────────────────────────────────────────

test('odtlačok zachytí cenu, termín a zľavu najbližšieho termínu', () => {
  const snap = snapshotOf(feed.tours, { version: 'v1', from: '2035-01-01' });
  assert.equal(snap.version, 'v1');
  assert.equal(snap.tours.D1001.price, 729.5);
  assert.equal(snap.tours.D1001.dateFrom, '2035-07-17');
  assert.equal(snap.tours.D1001.discount, 25);
});

test('prvý beh hlási všetky zájazdy ako nové', () => {
  const next = snapshotOf(feed.tours, { from: '2035-01-01' });
  const diff = diffSnapshots(null, next);
  assert.equal(diff.firstRun, true);
  assert.equal(diff.affected.length, 3);
  assert.match(summarize(diff), /prvý beh/);
});

test('zmena ceny sa nájde a označí zájazd na pregenerovanie', () => {
  const prev = snapshotOf(feed.tours, { from: '2035-01-01' });
  const cheaper = feed.tours.map(t =>
    t.id === 'D1001' ? { ...t, terms: t.terms.map(x => ({ ...x, price: 599 })) } : t);
  const diff = diffSnapshots(prev, snapshotOf(cheaper, { from: '2035-01-01' }));

  assert.equal(diff.priceChanged.length, 1);
  assert.deepEqual(
    { code: diff.priceChanged[0].code, from: diff.priceChanged[0].from, to: diff.priceChanged[0].to },
    { code: 'D1001', from: 729.5, to: 599 });
  assert.deepEqual(diff.affected, ['D1001']);
  assert.equal(diff.unchanged, 2);
  assert.match(summarize(diff), /zmenou ceny/);
});

test('zájazd, ktorý zmizol z feedu, sa nahlási', () => {
  const prev = snapshotOf(feed.tours, { from: '2035-01-01' });
  const diff = diffSnapshots(prev, snapshotOf(feed.tours.filter(t => t.id !== 'D1003'), { from: '2035-01-01' }));
  assert.deepEqual(diff.removed.map(r => r.code), ['D1003']);
  assert.equal(diff.affected.length, 0, 'zmiznutý zájazd netreba pregenerovať');
});

test('bez zmeny nie je čo robiť', () => {
  const snap = snapshotOf(feed.tours, { from: '2035-01-01' });
  const diff = diffSnapshots(snap, snapshotOf(feed.tours, { from: '2035-01-01' }));
  assert.equal(diff.affected.length, 0);
  assert.equal(summarize(diff), 'žiadne zmeny');
});

test('poškodený odtlačok sa berie ako prvý beh', async () => {
  const file = path.join(tmpDir, 'broken-snapshot.json');
  await fs.writeFile(file, 'toto nie je json');
  assert.equal(await readSnapshot(file), null);
});

test('odtlačok prežije zápis a načítanie', async () => {
  const file = path.join(tmpDir, 'snap.json');
  const snap = snapshotOf(feed.tours, { version: 'v9', from: '2035-01-01' });
  await writeSnapshot(file, snap);
  const back = await readSnapshot(file);
  assert.equal(back.version, 'v9');
  assert.deepEqual(Object.keys(back.tours), ['D1001', 'D1002', 'D1003']);
});

// ── Celý cyklus ─────────────────────────────────────────────────────────────

test('prvý cyklus pregeneruje bannery a zapíše odtlačok aj správu', async () => {
  const snapshotFile = path.join(tmpDir, 'run-snapshot.json');
  const logs = [];

  const report = await runOnce({ snapshotFile, log: (m) => logs.push(m) });

  assert.ok(report.rendered > 0, 'nič sa nevygenerovalo');
  assert.equal(report.renderFailed, 0);
  assert.equal(report.tours, 3);
  assert.ok(report.feedVersion, 'chýba verzia feedu');
  assert.ok(logs.some(l => l.includes('prvý beh')), `log neobsahuje prvý beh: ${logs.join(' | ')}`);

  const snap = await readSnapshot(snapshotFile);
  assert.ok(snap, 'odtlačok sa nezapísal');
});

test('druhý cyklus bez zmeny feedu nič nepregenerúva', async () => {
  const snapshotFile = path.join(tmpDir, 'run2-snapshot.json');
  await runOnce({ snapshotFile, log: () => {} });
  const second = await runOnce({ snapshotFile, log: () => {} });

  assert.equal(second.rendered, 0, 'druhý beh mal byť bez práce');
  assert.equal(second.changes.added, 0);
});

test('--all pregeneruje aj bez zmeny', async () => {
  const snapshotFile = path.join(tmpDir, 'run3-snapshot.json');
  await runOnce({ snapshotFile, log: () => {} });
  const forced = await runOnce({ snapshotFile, all: true, log: () => {} });
  assert.ok(forced.rendered > 0, '--all mal pregenerovať všetko');
});

test('nahrávanie bez potvrdenia neodošle nič', async () => {
  const snapshotFile = path.join(tmpDir, 'run4-snapshot.json');
  const stateFile = path.join(tmpDir, 'run4-state.json');

  // Bez confirm sa klient ani nevytvára – token teda netreba a nič sa neodošle
  const report = await runOnce({
    snapshotFile, stateFile, uploadTargets: ['google-ads'], confirm: false, log: () => {},
  });

  assert.ok(report.uploaded['google-ads'] > 0, 'malo sa napočítať, čo by sa nahralo');
  assert.equal(report.uploadFailed['google-ads'], 0);
  await assert.rejects(() => fs.access(stateFile), 'stav sa nemal zapísať');
});

test('neznámy cieľ nahrávania zlyhá hneď', async () => {
  await assert.rejects(
    () => runOnce({ snapshotFile: path.join(tmpDir, 'run5.json'), uploadTargets: ['snapchat'], log: () => {} }),
    /Neznámy cieľ "snapchat"/);
});
