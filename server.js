const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3456;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

function fetchUrl(targetUrl, res) {
  const parsed = url.parse(targetUrl);
  const lib = parsed.protocol === 'https:' ? https : http;
  const opts = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.path,
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
    rejectUnauthorized: false,
  };
  lib.get(opts, upstream => {
    // Follow redirects
    if ([301, 302, 303, 307].includes(upstream.statusCode) && upstream.headers.location) {
      fetchUrl(upstream.headers.location, res);
      return;
    }
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    });
    upstream.pipe(res);
  }).on('error', err => {
    res.writeHead(502); res.end('Proxy error: ' + err.message);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
    res.end(); return;
  }

  // Proxy endpoint: /proxy?url=...
  if (pathname === '/proxy') {
    const target = parsed.query.url;
    if (!target) { res.writeHead(400); res.end('Missing url param'); return; }
    fetchUrl(target, res); return;
  }

  // Static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  // Prevent path traversal
  if (!filePath.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`CK DAKA Banner Generator running at http://localhost:${PORT}`));
