/**
 * CK DAKA Banner Generator – overenie uloženého tokenu
 * Klient pošle token z localStorage, funkcia overí HMAC podpis.
 */
const crypto = require('crypto');

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token || '';

  if (!token) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false }),
    };
  }

  const secret = process.env.BANNER_SECRET || 'ckdaka-fallback-secret-2024';
  const day    = new Date().toISOString().slice(0, 10);
  const expected = crypto.createHmac('sha256', secret)
                          .update(day + ':ckdaka_banner_auth')
                          .digest('hex');

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: token === expected }),
  };
};
