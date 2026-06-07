/**
 * CK DAKA Banner Generator – Netlify Serverless Proxy
 * Beží v izolovanom Netlify sandboxe, nie na serveri ckdaka.sk.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

function fetchUrl(targetUrl, redirects) {
  if ((redirects || 0) > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch(e) { return reject(e); }
    const lib  = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  { 'User-Agent': 'Mozilla/5.0 (CK DAKA Banner Generator)' },
      rejectUnauthorized: false,
    };
    lib.get(opts, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, (redirects||0)+1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        statusCode:  res.statusCode,
        contentType: res.headers['content-type'] || 'application/octet-stream',
        body:        Buffer.concat(chunks),
      }));
    }).on('error', reject);
  });
}

exports.handler = async (event) => {
  const targetUrl = (event.queryStringParameters || {}).url || '';
  if (!targetUrl) return { statusCode: 400, body: 'Missing url parameter' };

  try { new URL(targetUrl); } catch {
    return { statusCode: 400, body: 'Invalid URL' };
  }

  try {
    const result = await fetchUrl(targetUrl);
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type':  result.contentType,
        'Cache-Control': 'public, max-age=300',
      },
      body:            result.body.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 502, body: 'Proxy error: ' + err.message };
  }
};
