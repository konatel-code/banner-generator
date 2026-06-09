/**
 * CK DAKA Banner Generator – overenie hesla (server-side)
 * Heslo je uložené ako env premenná BANNER_PASSWORD v Netlify dashboarde.
 * Klientský kód nikdy nevidí skutočné heslo.
 */
const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  const expected = process.env.BANNER_PASSWORD;
  if (!expected) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, err: 'not_configured' }) };
  }

  if (!body.password || body.password !== expected) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false }),
    };
  }

  // Vygeneruj podpísaný denný token (platný 24 hod)
  const secret = process.env.BANNER_SECRET || 'ckdaka-fallback-secret-2024';
  const day    = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const token  = crypto.createHmac('sha256', secret)
                        .update(day + ':ckdaka_banner_auth')
                        .digest('hex');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, token }),
  };
};
