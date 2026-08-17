/**
 * Klient Google Ads API – nahrávanie obrázkových podkladov (image assets).
 *
 * Rozsah je zámerne úzky: nahrať obrázok do knižnice podkladov účtu a zistiť,
 * čo tam už je. Zostavovanie reklám a kampaní zostáva v rukách človeka –
 * automat dodá podklady, nie stratégiu.
 *
 * Verzia API je konfigurovateľná (GOOGLE_ADS_API_VERSION), pretože Google ju
 * mení niekoľkokrát ročne a staré verzie po čase vypína.
 *
 * POZOR: rozhranie Google Ads API sa vyvíja. Pred prvým ostrým behom si
 * over názvy polí a verziu v aktuálnej dokumentácii; `--dry-run` (predvolený)
 * ukáže presne to, čo by sa odoslalo, bez toho aby sa čokoľvek zmenilo.
 */
import { getAccessToken } from './oauth.js';

const BASE    = process.env.GOOGLE_ADS_ENDPOINT || 'https://googleads.googleapis.com';
const VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v18';

/** Očistí ID zákazníka: "123-456-7890" → "1234567890". */
export function normalizeCustomerId(id) {
  return String(id || '').replace(/[^0-9]/g, '');
}

export function credentialsFromEnv() {
  return {
    clientId:      process.env.GOOGLE_CLIENT_ID,
    clientSecret:  process.env.GOOGLE_CLIENT_SECRET,
    refreshToken:  process.env.GOOGLE_REFRESH_TOKEN,
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    customerId:    normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID),
    loginCustomerId: normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
  };
}

/** Ktoré chyby má zmysel skúsiť znova. */
function isRetryable(status) {
  return status === 429 || status >= 500;
}

export class GoogleAdsClient {
  /**
   * @param {object} creds výsledok credentialsFromEnv() alebo vlastné hodnoty
   * @param {object} [opts]
   * @param {number} [opts.retries] počet opakovaní pri dočasnej chybe
   */
  constructor(creds, opts = {}) {
    const missing = ['clientId','clientSecret','refreshToken','developerToken','customerId']
      .filter(k => !creds[k]);
    if (missing.length) throw new Error(`Chýbajúce údaje pre Google Ads: ${missing.join(', ')}`);

    this.creds = creds;
    this.retries = opts.retries ?? 3;
  }

  async headers() {
    const token = await getAccessToken(this.creds);
    const h = {
      'Authorization': `Bearer ${token}`,
      'developer-token': this.creds.developerToken,
      'Content-Type': 'application/json',
    };
    // Pri správe cez MCC účet treba povedať, pod ktorým účtom sa prihlasujeme
    if (this.creds.loginCustomerId) h['login-customer-id'] = this.creds.loginCustomerId;
    return h;
  }

  async request(path, body) {
    const url = `${BASE}/${VERSION}/customers/${this.creds.customerId}${path}`;
    let lastErr;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) {
        // exponenciálny odstup: 1s, 2s, 4s …
        await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: await this.headers(),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();

        if (!res.ok) {
          const err = new Error(`Google Ads API ${res.status}: ${text.slice(0, 500)}`);
          err.status = res.status;
          err.bodyText = text;
          if (isRetryable(res.status) && attempt < this.retries) { lastErr = err; continue; }
          throw err;
        }
        return text ? JSON.parse(text) : {};
      } catch (err) {
        // Sieťové chyby a timeouty tiež stoja za opakovanie
        const networky = !err.status;
        if (networky && attempt < this.retries) { lastErr = err; continue; }
        throw err;
      }
    }
    throw lastErr;
  }

  /**
   * Nahrá obrázok do knižnice podkladov.
   * @param {object} o
   * @param {Buffer} o.buffer  dáta obrázka
   * @param {string} o.name    názov podkladu (v účte musí byť jedinečný)
   * @returns {Promise<{resourceName:string, duplicate:boolean}>}
   */
  async uploadImageAsset({ buffer, name }) {
    const body = {
      operations: [{
        create: {
          name,
          type: 'IMAGE',
          imageAsset: { data: buffer.toString('base64') },
        },
      }],
    };

    try {
      const res = await this.request('/assets:mutate', body);
      const resourceName = res?.results?.[0]?.resourceName;
      if (!resourceName) throw new Error(`Odpoveď neobsahuje resourceName: ${JSON.stringify(res).slice(0, 300)}`);
      return { resourceName, duplicate: false };
    } catch (err) {
      // Google odmietne obrázok, ktorý v účte už existuje – to nie je chyba,
      // len znamená, že podklad netreba nahrávať znova.
      if (/DUPLICATE_ASSET|DUPLICATE_NAME|already exists/i.test(err.bodyText || err.message)) {
        const existing = await this.findAssetByName(name).catch(() => null);
        return { resourceName: existing?.resourceName || null, duplicate: true };
      }
      throw err;
    }
  }

  /** Nájde podklad podľa názvu (GAQL dotaz). */
  async findAssetByName(name) {
    const query = `SELECT asset.resource_name, asset.name, asset.type
                   FROM asset
                   WHERE asset.name = '${String(name).replace(/'/g, "\\'")}'
                   LIMIT 1`;
    const res = await this.request('/googleAds:search', { query });
    const row = res?.results?.[0]?.asset;
    return row ? { resourceName: row.resourceName, name: row.name } : null;
  }

  /** Zoznam obrázkových podkladov v účte – na kontrolu, čo tam už je. */
  async listImageAssets({ limit = 200 } = {}) {
    const query = `SELECT asset.resource_name, asset.name
                   FROM asset
                   WHERE asset.type = 'IMAGE'
                   LIMIT ${Number(limit) || 200}`;
    const res = await this.request('/googleAds:search', { query });
    return (res?.results || []).map(r => ({
      resourceName: r.asset?.resourceName,
      name: r.asset?.name,
    })).filter(a => a.resourceName);
  }
}
