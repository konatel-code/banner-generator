/**
 * OAuth2 – výmena refresh tokenu za prístupový token.
 *
 * Používa Google (Google Ads) aj Microsoft (Microsoft Advertising); líšia sa
 * len adresou token endpointu a prípadným scope. Refresh token sa získa raz
 * (consent flow) a uloží do env premennej. Prístupový token platí ~1 hodinu,
 * preto si ho držíme v pamäti a obnovujeme až tesne pred expiráciou.
 *
 * Do kódu sa žiadne tajomstvo nezapisuje – všetko ide cez env.
 */

export const GOOGLE_TOKEN_URL =
  process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
export const MICROSOFT_TOKEN_URL =
  process.env.MICROSOFT_TOKEN_URL || 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

const SKEW_MS = 60_000;   // obnov token minútu pred expiráciou

const cache = new Map();  // tokenUrl+clientId+refreshToken → { token, expiresAt }

/**
 * @param {object} creds
 * @param {string} creds.clientId
 * @param {string} creds.clientSecret
 * @param {string} creds.refreshToken
 * @param {string} [creds.tokenUrl] predvolene Google
 * @param {string} [creds.scope]    vyžaduje Microsoft
 * @returns {Promise<string>} prístupový token
 */
export async function getAccessToken({ clientId, clientSecret, refreshToken, tokenUrl, scope }) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Chýbajú OAuth údaje (client id, client secret, refresh token)');
  }

  const url = tokenUrl || GOOGLE_TOKEN_URL;
  const key = `${url}:${clientId}:${refreshToken}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - SKEW_MS > Date.now()) return hit.token;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    ...(scope ? { scope } : {}),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  const text = await res.text();
  if (!res.ok) {
    // Telo obsahuje popis chyby (invalid_grant pri expirovanom refresh tokene)
    throw new Error(`OAuth zlyhal: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('OAuth vrátil neplatný JSON'); }
  if (!data.access_token) throw new Error('OAuth odpoveď neobsahuje access_token');

  cache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
  return data.access_token;
}

/** Vyprázdni cache tokenov (testy). */
export function clearTokenCache() { cache.clear(); }
