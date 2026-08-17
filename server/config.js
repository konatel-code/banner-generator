/**
 * Konfigurácia služby – všetko cez env premenné, žiadne tajomstvá v kóde.
 * Predvolené hodnoty zodpovedajú produkčnému nastaveniu CK DAKA.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const num  = (v, d) => (v != null && v !== '' && !isNaN(+v) ? +v : d);

export const config = {
  port: num(process.env.PORT, 3457),
  host: process.env.HOST || '0.0.0.0',

  // Zdroj dát
  feedUrl: process.env.FEED_URL || 'https://cestovnakancelariadaka.sk/export/cesys',
  logoUrl: process.env.LOGO_URL || 'https://cestovnakancelariadaka.sk/assets/ck/images/layout/logo.png',
  feedTtlMs: num(process.env.FEED_TTL_MS, 30 * 60 * 1000),      // 30 min

  // Verejná adresa služby – vkladá sa do feedov ako image_link.
  // Ak nie je nastavená, odvodí sa z hlavičiek požiadavky.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),

  // Odkaz na detail zájazdu. {code} sa nahradí kódom, {slug} názvom v URL tvare.
  // Ak feed obsahuje vlastnú URL, tá má prednosť.
  linkTemplate: process.env.LINK_TEMPLATE || '',
  siteUrl: (process.env.SITE_URL || 'https://www.ckdaka.sk').replace(/\/+$/, ''),

  brand: process.env.BRAND || 'CK DAKA',
  currency: process.env.CURRENCY || 'EUR',

  // Render
  defaultStyle: process.env.DEFAULT_STYLE || 'dark',
  defaultExt: process.env.DEFAULT_EXT || 'jpg',
  jpegQuality: num(process.env.JPEG_QUALITY, 88),
  webpQuality: num(process.env.WEBP_QUALITY, 90),
  maxConcurrentRenders: num(process.env.MAX_CONCURRENT_RENDERS, 4),
  // Koľko fotiek zájazdu sa hodnotí pri automatickom výbere
  scoreImgLimit: num(process.env.SCORE_IMG_LIMIT, 12),

  // Cache
  cacheDir: process.env.CACHE_DIR || path.join(here, '.cache'),
  imgTtlMs: num(process.env.IMG_TTL_MS, 7 * 24 * 3600 * 1000),  // stiahnuté fotky: 7 dní
  bannerMaxAge: num(process.env.BANNER_MAX_AGE, 6 * 3600),      // Cache-Control pre bannery (s)
  feedMaxAge: num(process.env.FEED_MAX_AGE, 30 * 60),           // Cache-Control pre feedy (s)
  fetchTimeoutMs: num(process.env.FETCH_TIMEOUT_MS, 20000),
  maxImageBytes: num(process.env.MAX_IMAGE_BYTES, 12 * 1024 * 1024),

  // Koľko položiek maximálne vo feede (0 = bez limitu)
  feedLimit: num(process.env.FEED_LIMIT, 0),
};

/** Názov v tvare vhodnom do URL: "Slnečné pobrežie" → "slnecne-pobrezie" */
export function slugify(s) {
  return (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Odkaz na detail zájazdu – z feedu, zo šablóny, alebo aspoň na web. */
export function tourLink(tour) {
  const fromFeed = (tour.url || '').trim();
  if (/^https?:\/\//i.test(fromFeed)) return fromFeed;
  if (fromFeed.startsWith('/')) return config.siteUrl + fromFeed;   // feed dal len cestu
  if (config.linkTemplate) {
    return config.linkTemplate
      .replace(/\{code\}/g, encodeURIComponent(tour.id))
      .replace(/\{slug\}/g, slugify(tour.name));
  }
  return config.siteUrl;
}
