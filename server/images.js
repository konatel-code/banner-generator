/**
 * Sťahovanie a cache fotiek zo feedu.
 *
 * Dve úrovne:
 *   1. disk  – surové stiahnuté bajty (prežije reštart, TTL config.imgTtlMs)
 *   2. pamäť – dekódované obrázky pripravené na kreslenie (LRU)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadImage } from '@napi-rs/canvas';
import { config } from './config.js';

const DISK_DIR = path.join(config.cacheDir, 'img');
const MEM_LIMIT = 80;

const mem = new Map();       // url → Promise<Image|null>   (Map zachováva poradie → LRU)
const pending = new Map();   // url → Promise<Buffer|null>

const keyOf = (url) => crypto.createHash('sha1').update(url).digest('hex');

async function ensureDir() {
  await fs.mkdir(DISK_DIR, { recursive: true });
}

async function readDisk(url) {
  const file = path.join(DISK_DIR, keyOf(url));
  try {
    const st = await fs.stat(file);
    if (Date.now() - st.mtimeMs > config.imgTtlMs) return null;
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

async function writeDisk(url, buf) {
  try {
    await ensureDir();
    const file = path.join(DISK_DIR, keyOf(url));
    await fs.writeFile(file + '.tmp', buf);
    await fs.rename(file + '.tmp', file);
  } catch (err) {
    console.warn(`[img] zápis do cache zlyhal: ${err.message}`);
  }
}

/** Stiahne obrázok (s cache na disku). Vracia null pri chybe. */
export async function fetchImageBuffer(url) {
  if (!url) return null;
  if (pending.has(url)) return pending.get(url);

  const job = (async () => {
    const cached = await readDisk(url);
    if (cached) return cached;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.fetchTimeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'CK DAKA Banner Service', 'Accept': 'image/*' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const len = +(res.headers.get('content-length') || 0);
      if (len && len > config.maxImageBytes) throw new Error(`príliš veľký obrázok (${len} B)`);

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > config.maxImageBytes) throw new Error(`príliš veľký obrázok (${buf.length} B)`);

      await writeDisk(url, buf);
      return buf;
    } catch (err) {
      console.warn(`[img] ${url} → ${err.message}`);
      return null;
    } finally {
      clearTimeout(timer);
      pending.delete(url);
    }
  })();

  pending.set(url, job);
  return job;
}

/** Stiahne a dekóduje obrázok pripravený na kreslenie do canvasu. */
export function loadRemoteImage(url) {
  if (!url) return Promise.resolve(null);

  if (mem.has(url)) {
    const hit = mem.get(url);
    mem.delete(url); mem.set(url, hit);   // posuň na koniec (LRU)
    return hit;
  }

  const job = (async () => {
    const buf = await fetchImageBuffer(url);
    if (!buf) return null;
    try {
      return await loadImage(buf);
    } catch (err) {
      console.warn(`[img] dekódovanie zlyhalo ${url}: ${err.message}`);
      return null;
    }
  })();

  mem.set(url, job);
  if (mem.size > MEM_LIMIT) mem.delete(mem.keys().next().value);
  return job;
}

/** Vyprázdni pamäťovú cache (používajú testy). */
export function clearMemoryCache() {
  mem.clear();
}
