/**
 * Klient Meta Marketing API – nahrávanie obrázkov do reklamného účtu.
 *
 * Meta funguje inak než Google Ads: obrázok sa nahrá do knižnice účtu a späť
 * príde `hash`, ktorým sa naň potom odkazuje reklamný kreatív. Prihlásenie je
 * jednoduchšie – dlhodobý token systémového používateľa z Business Managera,
 * žiadne obnovovanie.
 *
 * Rovnako ako pri Google Ads: nahrávame len podklady, kampane nezostavujeme.
 */

const BASE    = process.env.META_ENDPOINT || 'https://graph.facebook.com';
const VERSION = process.env.META_API_VERSION || 'v21.0';

/** Doplní prefix act_, ak chýba. */
export function normalizeAdAccountId(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw.replace(/[^0-9]/g, '')}`;
}

export function metaCredentialsFromEnv() {
  return {
    accessToken: process.env.META_ACCESS_TOKEN,
    adAccountId: normalizeAdAccountId(process.env.META_AD_ACCOUNT_ID),
  };
}

// Kódy, pri ktorých má zmysel počkať a skúsiť znova (limity a dočasné výpadky)
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

function retryable(status, payload) {
  if (status === 429 || status >= 500) return true;
  const code = payload?.error?.code;
  return code != null && RETRYABLE_CODES.has(Number(code));
}

export class MetaAdsClient {
  constructor(creds, opts = {}) {
    const missing = ['accessToken', 'adAccountId'].filter(k => !creds[k]);
    if (missing.length) {
      throw new Error(`Chýbajúce údaje pre Meta: ${missing.join(', ')} ` +
                      '(META_ACCESS_TOKEN, META_AD_ACCOUNT_ID)');
    }
    this.creds = creds;
    this.retries = opts.retries ?? 3;
  }

  async request(path, { method = 'GET', form = null, query = null } = {}) {
    const url = new URL(`${BASE}/${VERSION}/${this.creds.adAccountId}${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);

    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));

      try {
        const body = form ? new URLSearchParams(form) : undefined;
        const res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.creds.accessToken}`,
            ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          },
          body,
          signal: AbortSignal.timeout(60_000),
        });

        const text = await res.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : {}; } catch { /* nechaj null */ }

        if (!res.ok) {
          const detail = payload?.error?.message || text.slice(0, 400);
          const err = new Error(`Meta API ${res.status}: ${detail}`);
          err.status = res.status;
          err.payload = payload;
          if (retryable(res.status, payload) && attempt < this.retries) { lastErr = err; continue; }
          throw err;
        }
        return payload ?? {};
      } catch (err) {
        if (!err.status && attempt < this.retries) { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  }

  /**
   * Nahrá obrázok do knižnice reklamného účtu.
   * @returns {Promise<{hash:string, url:string|null}>} hash sa používa v kreatíve
   */
  async uploadImage({ buffer, name }) {
    const res = await this.request('/adimages', {
      method: 'POST',
      form: { bytes: buffer.toString('base64'), name },
    });

    // Odpoveď je mapa {názov: {hash, url}} – kľúč sa nie vždy zhoduje s názvom
    const images = res?.images || {};
    const entry = images[name] || Object.values(images)[0];
    if (!entry?.hash) {
      throw new Error(`Odpoveď Meta neobsahuje hash: ${JSON.stringify(res).slice(0, 300)}`);
    }
    return { hash: entry.hash, url: entry.url || null };
  }

  /** Obrázky, ktoré už v účte sú. */
  async listImages({ limit = 200 } = {}) {
    const res = await this.request('/adimages', {
      query: { fields: 'hash,name,url', limit: String(limit) },
    });
    return (res?.data || []).map(i => ({ hash: i.hash, name: i.name, url: i.url }))
      .filter(i => i.hash);
  }
}
