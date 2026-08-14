/**
 * Server-side render bannerov.
 *
 * Používa presne tú istú kresliacu logiku ako prehliadač (shared/banner.js),
 * takže výstup zodpovedá náhľadu v generátore. Rozdiel je len v tom, odkiaľ
 * prichádza canvas: tu ho dodáva @napi-rs/canvas namiesto DOM.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';

import { drawBanner } from '../shared/banner.js';
import { imgCategory } from '../shared/formats.js';
import { makeScorer, bestPerAspect } from '../shared/imgpick.js';
import { withTerm } from '../shared/tour.js';

import { config } from './config.js';
import { registerFonts } from './fonts.js';
import { loadRemoteImage } from './images.js';

// Zvýš pri zmene kresliacej logiky – zneplatní cache vygenerovaných bannerov.
const RENDER_VERSION = 1;

const BANNER_DIR = path.join(config.cacheDir, 'banner');

const EXT = {
  jpg:  { fmt: 'jpeg', mime: 'image/jpeg', quality: () => config.jpegQuality },
  jpeg: { fmt: 'jpeg', mime: 'image/jpeg', quality: () => config.jpegQuality },
  png:  { fmt: 'png',  mime: 'image/png',  quality: () => undefined },
  webp: { fmt: 'webp', mime: 'image/webp', quality: () => config.webpQuality },
};

export const supportedExtensions = Object.keys(EXT);

let fontsReady = false;
let scorer = null;
let logoJob = null;

const aspectCache = new Map();   // `${feedVersion}:${tourId}` → Promise<{portrait,landscape,strip}>

function init() {
  if (fontsReady) return;
  registerFonts();
  scorer = makeScorer(createCanvas(64, 64));
  fontsReady = true;
}

function logo() {
  if (!logoJob) logoJob = loadRemoteImage(config.logoUrl);
  return logoJob;
}

/**
 * Vyberie najvhodnejšiu fotku zájazdu pre každý pomer strán.
 * Skórovanie prebehne raz za verziu feedu a zájazd.
 */
export function pickImages(tour, feedVersion) {
  const key = `${feedVersion}:${tour.id}`;
  if (aspectCache.has(key)) return aspectCache.get(key);

  const job = (async () => {
    init();
    const fallback = tour.imgUrl || tour.imgs?.[0] || null;
    const urls = (tour.imgs || []).slice(0, config.scoreImgLimit);
    if (urls.length <= 1) return { portrait: fallback, landscape: fallback, strip: fallback };

    const results = await Promise.all(urls.map(async url => {
      const img = await loadRemoteImage(url);
      return {
        url,
        score: scorer(img, url),
        ratio: img ? (img.naturalWidth || img.width) / (img.naturalHeight || img.height || 1) : 1.5,
      };
    }));
    return bestPerAspect(results, fallback);
  })();

  aspectCache.set(key, job);
  if (aspectCache.size > 500) aspectCache.delete(aspectCache.keys().next().value);
  return job;
}

// ── Obmedzenie súbežných renderov ──────────────────────────────────────────
let running = 0;
const queue = [];

function acquire() {
  if (running < config.maxConcurrentRenders) { running++; return Promise.resolve(); }
  return new Promise(resolve => queue.push(resolve));
}
function release() {
  const next = queue.shift();
  if (next) next(); else running--;
}

// ── Cache hotových bannerov na disku ───────────────────────────────────────
async function readCache(key) {
  try { return await fs.readFile(path.join(BANNER_DIR, key)); } catch { return null; }
}
async function writeCache(key, buf) {
  try {
    await fs.mkdir(BANNER_DIR, { recursive: true });
    const file = path.join(BANNER_DIR, key);
    await fs.writeFile(file + '.tmp', buf);
    await fs.rename(file + '.tmp', file);
  } catch (err) {
    console.warn(`[render] zápis cache zlyhal: ${err.message}`);
  }
}

/**
 * Vyrenderuje banner.
 *
 * @param {object}  o
 * @param {object}  o.tour        zájazd z feedu
 * @param {number}  o.w
 * @param {number}  o.h
 * @param {string}  [o.style]     'dark' | 'light-wave' | 'light-stamp'
 * @param {string}  [o.ext]       'jpg' | 'png' | 'webp'
 * @param {string}  [o.term]      ISO dátum odchodu – banner s konkrétnou cenou
 * @param {string}  [o.imgUrl]    natvrdo zvolená fotka (inak automatický výber)
 * @param {string}  [o.feedVersion]
 * @returns {Promise<{buffer:Buffer, mime:string, etag:string, cached:boolean}>}
 */
export async function renderBanner({ tour, w, h, style, ext, term, imgUrl, feedVersion = '0' }) {
  const enc = EXT[ext] || EXT[config.defaultExt] || EXT.jpg;
  const st  = style || config.defaultStyle;
  const data = term ? withTerm(tour, term) : tour;

  const chosen = imgUrl
    || (await pickImages(tour, feedVersion))[imgCategory(w, h)]
    || tour.imgUrl || null;

  const etag = crypto.createHash('sha1').update([
    RENDER_VERSION, feedVersion, tour.id, term || '', w, h, st, enc.fmt,
    enc.quality() ?? '', chosen || '',
    data.minPrice ?? '', data._overridePrice ?? '', data.maxDiscount ?? '', data.name,
  ].join('|')).digest('hex').slice(0, 20);

  const cacheKey = `${etag}.${enc.fmt}`;
  const hit = await readCache(cacheKey);
  if (hit) return { buffer: hit, mime: enc.mime, etag, cached: true };

  await acquire();
  try {
    init();
    const [tImg, lImg] = await Promise.all([loadRemoteImage(chosen), logo()]);

    const canvas = createCanvas(w, h);
    drawBanner(canvas.getContext('2d'), w, h, data, tImg, lImg, { style: st });

    const q = enc.quality();
    const buffer = await (q == null ? canvas.encode(enc.fmt) : canvas.encode(enc.fmt, q));

    await writeCache(cacheKey, buffer);
    return { buffer, mime: enc.mime, etag, cached: false };
  } finally {
    release();
  }
}

/** Zmaže staré súbory v cache bannerov (spúšťa sa periodicky). */
export async function pruneBannerCache(maxAgeMs = 7 * 24 * 3600 * 1000) {
  let removed = 0;
  try {
    const files = await fs.readdir(BANNER_DIR);
    const now = Date.now();
    for (const f of files) {
      const file = path.join(BANNER_DIR, f);
      try {
        const st = await fs.stat(file);
        if (now - st.mtimeMs > maxAgeMs) { await fs.unlink(file); removed++; }
      } catch {}
    }
  } catch {}
  return removed;
}
