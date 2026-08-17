/**
 * Pomocníci pre testy: lokálny server s obrázkami + načítanie fixture feedu.
 * Testy nesmú siahať na internet, preto si fotky vyrobíme canvasom
 * a fixture feed na ne ukazuje cez 127.0.0.1.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Cache adresár mimo repozitára – nastav pred importom config.js. */
export function useTempCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckdaka-test-'));
  process.env.CACHE_DIR = dir;
  return dir;
}

function photo(w, h, hue) {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue}, 70%, 55%)`);
  g.addColorStop(1, `hsl(${(hue + 60) % 360}, 65%, 35%)`);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  // pár tvarov, aby mal obrázok rozptyl (skórovanie ho nevyhodnotí ako prázdny)
  for (let i = 0; i < 24; i++) {
    x.fillStyle = `hsla(${(hue + i * 15) % 360}, 80%, ${30 + (i % 5) * 12}%, .8)`;
    x.beginPath();
    x.arc((i * 97) % w, (i * 61) % h, Math.min(w, h) * 0.08, 0, Math.PI * 2);
    x.fill();
  }
  return c.toBuffer('image/jpeg');
}

function flatIcon(w, h) {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#9aa0a6';
  x.fillRect(w * 0.35, h * 0.35, w * 0.3, h * 0.3);
  return c.toBuffer('image/jpeg');
}

/** Spustí HTTP server s testovacími fotkami a logom. */
export async function startAssetServer() {
  const assets = {
    '/photo-landscape.jpg': photo(1200, 800, 200),
    '/photo-portrait.jpg':  photo(800, 1200, 20),
    '/icon-feature.jpg':    flatIcon(600, 600),
    '/logo.png':            (() => {
      const c = createCanvas(240, 60);
      const x = c.getContext('2d');
      x.fillStyle = '#1F315F'; x.font = 'bold 34px Arial'; x.fillText('DAKA', 10, 44);
      return c.toBuffer('image/png');
    })(),
  };

  let selfBase = '';
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    // Feed servírujeme tiež – CLI test si ho stiahne cez FEED_URL
    if (route === '/feed.xml') {
      const xml = fixtureFeedText(selfBase);
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
      return res.end(xml);
    }
    const body = assets[route];
    if (!body) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, {
      'Content-Type': req.url.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Content-Length': body.length,
    });
    res.end(body);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  selfBase = base;
  return { base, feedUrl: `${base}/feed.xml`, close: () => new Promise(r => server.close(r)) };
}

/** Text fixture feedu s doplnenou adresou lokálneho servera s obrázkami. */
export function fixtureFeedText(base) {
  return fs.readFileSync(path.join(here, 'fixtures', 'feed.xml'), 'utf8')
    .replaceAll('__BASE__', base);
}
