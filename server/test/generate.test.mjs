import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadImage } from '@napi-rs/canvas';
import { startAssetServer } from './helpers.mjs';

const run = promisify(execFile);
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'generate.js');

const assets = await startAssetServer();
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ckdaka-gen-'));

after(async () => {
  await assets.close();
  await fs.rm(outDir, { recursive: true, force: true });
});

const env = {
  ...process.env,
  FEED_URL: assets.feedUrl,
  LOGO_URL: `${assets.base}/logo.png`,
  CACHE_DIR: path.join(outDir, '.cache'),
};

test('CLI vygeneruje bannery a manifest', async () => {
  const { stdout } = await run('node',
    [CLI, '--out', outDir, '--sizes', '300x250,728x90', '--style', 'dark', '--ext', 'png'],
    { env, timeout: 120000 });

  assert.match(stdout, /hotovo: \d+ bannerov/);

  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.count > 0, 'manifest je prázdny');
  assert.equal(manifest.style, 'dark');
  assert.ok(manifest.feedVersion, 'chýba verzia feedu');

  // každý zapísaný súbor musí byť skutočný obrázok v deklarovanom rozmere
  for (const b of manifest.banners) {
    const buf = await fs.readFile(path.join(outDir, b.file));
    const img = await loadImage(buf);
    assert.equal(img.width, b.width, `${b.file}: zlá šírka`);
    assert.equal(img.height, b.height, `${b.file}: zlá výška`);
    assert.match(b.file, /^DAKA_D\d+/);
  }
});

test('CLI odmietne neznámy rozmer aj štýl', async () => {
  await assert.rejects(
    () => run('node', [CLI, '--out', outDir, '--sizes', '123x456'], { env, timeout: 30000 }),
    /Neznámy rozmer/);
  await assert.rejects(
    () => run('node', [CLI, '--out', outDir, '--style', 'neon'], { env, timeout: 30000 }),
    /Neznámy štýl/);
});

test('--codes obmedzí generovanie na vybraný zájazd', async () => {
  const dir = path.join(outDir, 'jeden');
  await run('node', [CLI, '--out', dir, '--codes', 'D1002', '--sizes', '300x250'], { env, timeout: 60000 });
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.banners.every(b => b.code === 'D1002'), 'vygeneroval sa aj iný zájazd');
});
