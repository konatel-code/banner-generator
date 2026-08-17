/**
 * Prihlásenie do generátora – rovnaká schéma, akú používali Netlify funkcie,
 * len obsluhovaná priamo touto službou. Vďaka tomu appka funguje aj na
 * hostingu bez serverless funkcií (napr. Plesk).
 *
 * Heslo sa nikdy neposiela klientovi. Po overení dostane klient token, ktorý
 * je HMAC podpis dnešného dňa – platí teda do konca dňa a nedá sa podvrhnúť
 * bez znalosti tajného kľúča.
 */
import crypto from 'node:crypto';

const PURPOSE = 'ckdaka_banner_auth';

function secret() {
  return process.env.BANNER_SECRET || 'ckdaka-fallback-secret-2024';
}

/** Token pre daný deň (predvolene dnešok). */
export function tokenFor(day = new Date().toISOString().slice(0, 10)) {
  return crypto.createHmac('sha256', secret()).update(`${day}:${PURPOSE}`).digest('hex');
}

/** Porovnanie odolné voči časovaniu – nedá sa z neho vyčítať, ako ďaleko sa trafil. */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const expected = tokenFor();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Overí heslo a vráti token. Keď heslo nie je nastavené v prostredí,
 * prihlásenie sa nedá dokončiť – radšej nepustiť nikoho než pustiť každého.
 */
export function checkPassword(password) {
  const expected = process.env.BANNER_PASSWORD;
  if (!expected) return { ok: false, error: 'not_configured' };
  if (!password || typeof password !== 'string') return { ok: false };

  const a = Buffer.from(String(password));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  return { ok: true, token: tokenFor() };
}

/** Je prihlasovanie vôbec zapnuté? Bez hesla appka beží otvorene. */
export function authEnabled() {
  return !!process.env.BANNER_PASSWORD;
}
