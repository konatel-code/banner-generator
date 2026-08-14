/**
 * CK DAKA – banner service.
 *
 * Tri veci:
 *   1. /img/…    banner vyrenderovaný na požiadanie z XML feedu (bez prehliadača)
 *   2. /feed/…   produktové feedy pre Google Ads, Merchant Center a Meta,
 *                v ktorých obrázok každej položky ukazuje na /img/…
 *   3. statické  pôvodná appka index.html + /proxy, aby lokálny vývoj bežal
 *                jedným príkazom (`npm start` v priečinku server/)
 *
 * Reklamné platformy si tak bannery sťahujú samy a pri zmene ceny vo feede
 * sa im automaticky zmení aj obrázok – bez ručného generovania a nahrávania.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { getFeed, getTour, feedStatus } from './feed-store.js';
import { renderBanner, supportedExtensions, pruneBannerCache } from './render.js';
import { registerFonts, fontStatus } from './fonts.js';
import { buildItems } from './feeds/items.js';
import { SERIALIZERS } from './feeds/formats.js';
import { sizeFromKey, allSizes } from '../shared/formats.js';
import { STYLES } from '../shared/formats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fonty registrujeme hneď, nie až pri prvom banneri – prvá požiadavka je tak
// rovnako rýchla ako ostatné a /health hovorí pravdu o stave fontov.
registerFonts();

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.xml':'application/xml; charset=utf-8', '.txt':'text/plain; charset=utf-8',
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
};
const sendJson = (res, status, obj) =>
  send(res, status, JSON.stringify(obj, null, 2), { 'Content-Type': 'application/json; charset=utf-8' });

/** Verejná adresa služby – z konfigurácie, inak z hlavičiek požiadavky. */
function baseUrl(req) {
  if (config.publicUrl) return config.publicUrl;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host  = (req.headers['x-forwarded-host'] || req.headers.host || `localhost:${config.port}`).split(',')[0].trim();
  return `${proto}://${host}`;
}

// ── /img/:code/:WxH.:ext ───────────────────────────────────────────────────
async function handleImage(req, res, url) {
  const m = /^\/img\/([^/]+)\/(\d{2,4}x\d{2,4})\.([a-z]{3,4})$/i.exec(url.pathname);
  if (!m) return sendJson(res, 400, { error: 'Očakávaný tvar /img/{kod}/{sirkaxvyska}.{jpg|png|webp}' });

  const [, rawCode, sizeKey, ext] = m;
  const code = decodeURIComponent(rawCode);

  if (!supportedExtensions.includes(ext.toLowerCase()))
    return sendJson(res, 400, { error: `Nepodporovaná prípona .${ext}`, supported: supportedExtensions });

  const size = sizeFromKey(sizeKey.toLowerCase());
  if (!size)
    return sendJson(res, 400, { error: `Nepodporovaný rozmer ${sizeKey}`, supported: allSizes().map(s => s.key) });

  const feed = await getFeed();
  const tour = feed.byId.get(code);
  if (!tour) return sendJson(res, 404, { error: `Zájazd s kódom ${code} nie je vo feede` });

  const style = url.searchParams.get('style') || config.defaultStyle;
  if (!STYLES.includes(style))
    return sendJson(res, 400, { error: `Neznámy štýl ${style}`, supported: STYLES });

  const term = url.searchParams.get('term') || null;
  if (term && !/^\d{4}-\d{2}-\d{2}$/.test(term))
    return sendJson(res, 400, { error: 'Parameter term musí byť dátum v tvare YYYY-MM-DD' });

  // Fotku možno vybrať ručne, ale len z fotiek daného zájazdu (žiadne cudzie URL)
  let imgUrl = null;
  const idx = url.searchParams.get('img');
  if (idx != null && idx !== '') {
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= (tour.imgs?.length || 0))
      return sendJson(res, 400, { error: `Parameter img musí byť index 0–${(tour.imgs?.length || 1) - 1}` });
    imgUrl = tour.imgs[i];
  }

  const out = await renderBanner({
    tour, w: size.w, h: size.h, style, ext: ext.toLowerCase(),
    term, imgUrl, feedVersion: feed.version,
  });

  const etag = `"${out.etag}"`;
  if (req.headers['if-none-match'] === etag) {
    return send(res, 304, '', { ETag: etag, 'Cache-Control': `public, max-age=${config.bannerMaxAge}` });
  }

  send(res, 200, out.buffer, {
    'Content-Type': out.mime,
    'Content-Length': out.buffer.length,
    'Cache-Control': `public, max-age=${config.bannerMaxAge}`,
    'ETag': etag,
    'X-Cache': out.cached ? 'HIT' : 'MISS',
  });
}

// ── /feed/:name ────────────────────────────────────────────────────────────
async function handleFeed(req, res, url) {
  const name = url.pathname.replace(/^\/feed\/?/, '');
  const ser = SERIALIZERS[name];
  if (!ser) {
    return sendJson(res, name ? 404 : 200, {
      feeds: Object.keys(SERIALIZERS).map(n => `${baseUrl(req)}/feed/${n}`),
      params: {
        style: `štýl bannera (${STYLES.join(' | ')})`,
        terms: 'koľko najbližších termínov na zájazd (1 = len najbližší)',
        limit: 'maximálny počet položiek',
      },
    });
  }

  const feed = await getFeed();
  const style = url.searchParams.get('style') || config.defaultStyle;
  if (!STYLES.includes(style)) return sendJson(res, 400, { error: `Neznámy štýl ${style}`, supported: STYLES });

  const terms = Math.max(1, Math.min(20, Number(url.searchParams.get('terms')) || 1));
  const limit = Math.max(0, Number(url.searchParams.get('limit')) || config.feedLimit);

  // Od ktorého dňa brať termíny – štandardne dnešok, dá sa posunúť na náhľad
  const from = url.searchParams.get('from') || undefined;
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from))
    return sendJson(res, 400, { error: 'Parameter from musí byť dátum v tvare YYYY-MM-DD' });

  const items = buildItems(feed.tours, { base: baseUrl(req), style, terms, limit, from });
  const body = ser.fn(items);

  send(res, 200, body, {
    'Content-Type': ser.mime,
    'Cache-Control': `public, max-age=${config.feedMaxAge}`,
    'X-Item-Count': String(items.length),
    'X-Feed-Version': feed.version,
  });
}

// ── /proxy?url= (len pre lokálny vývoj pôvodnej appky) ─────────────────────
async function handleProxy(req, res, url) {
  const target = url.searchParams.get('url');
  if (!target) return send(res, 400, 'Missing url param');
  let parsed;
  try { parsed = new URL(target); } catch { return send(res, 400, 'Invalid url'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return send(res, 400, 'Invalid protocol');

  try {
    const upstream = await fetch(parsed, {
      headers: { 'User-Agent': 'CK DAKA Banner Service', Accept: '*/*' },
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    send(res, upstream.status, buf, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    });
  } catch (err) {
    send(res, 502, `Proxy error: ${err.message}`);
  }
}

// ── statické súbory z koreňa repozitára ────────────────────────────────────
async function handleStatic(req, res, url) {
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html'))
    return send(res, 403, 'Forbidden');

  try {
    const st = await fsp.stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const data = await fsp.readFile(file);
    send(res, 200, data, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
    });
  } catch {
    send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

// ── prehľad služby ─────────────────────────────────────────────────────────
function handleService(req, res) {
  const base = baseUrl(req);
  const feeds = Object.keys(SERIALIZERS)
    .map(n => `<li><a href="/feed/${n}">/feed/${n}</a></li>`).join('');
  const sizes = allSizes().map(s => s.key).join(', ');
  send(res, 200, `<!doctype html><html lang="sk"><meta charset="utf-8">
<title>CK DAKA – banner service</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#1F315F}
code{background:#eef2f8;padding:2px 6px;border-radius:4px}h2{margin-top:28px}</style>
<h1>CK DAKA – banner service</h1>
<p>Bannery sa generujú na požiadanie z XML feedu. Reklamné platformy si ich sťahujú samy cez URL vo feede.</p>
<h2>Bannery</h2>
<p><code>${base}/img/{kód}/{šírka}x{výška}.jpg</code></p>
<p>Parametre: <code>style</code> (${STYLES.join(', ')}), <code>term</code> (YYYY-MM-DD), <code>img</code> (index fotky)</p>
<p>Rozmery: ${sizes}</p>
<h2>Feedy</h2><ul>${feeds}</ul>
<h2>Stav</h2><p><a href="/health">/health</a></p>`, { 'Content-Type': 'text/html; charset=utf-8' });
}

// ── router ─────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
    });
  }
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method Not Allowed');

  try {
    if (url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        feed: feedStatus(),
        fonts: fontStatus(),
        sizes: allSizes().map(s => s.key),
        styles: STYLES,
        uptimeSec: Math.round(process.uptime()),
      });
    }
    if (url.pathname === '/service')          return handleService(req, res);
    if (url.pathname.startsWith('/img/'))     return await handleImage(req, res, url);
    if (url.pathname.startsWith('/feed'))     return await handleFeed(req, res, url);
    if (url.pathname === '/proxy')            return await handleProxy(req, res, url);
    if (url.pathname === '/xml-feed')         return await handleProxy(req, res,
                                                     new URL(`/proxy?url=${encodeURIComponent(config.feedUrl)}`, 'http://x'));
    return await handleStatic(req, res, url);
  } catch (err) {
    console.error(`[http] ${url.pathname}: ${err.stack || err.message}`);
    sendJson(res, 500, { error: 'Interná chyba', detail: err.message });
  }
});

// Spustenie len pri priamom štarte (nie pri importe v testoch)
const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  server.listen(config.port, config.host, async () => {
    console.log(`[server] beží na http://${config.host}:${config.port}`);
    console.log(`[server] prehľad: http://localhost:${config.port}/service`);
    try {
      const feed = await getFeed();
      console.log(`[server] feed pripravený: ${feed.tours.length} zájazdov`);
    } catch (err) {
      console.error(`[server] feed sa nepodarilo načítať: ${err.message}`);
    }
  });

  // Denné upratovanie cache vyrenderovaných bannerov
  setInterval(() => {
    pruneBannerCache().then(n => n && console.log(`[cache] zmazaných ${n} starých bannerov`));
  }, 24 * 3600 * 1000).unref();
}

export { server };
