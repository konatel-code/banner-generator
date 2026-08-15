/**
 * Klient TikTok Marketing API – nahrávanie obrázkov do knižnice reklamného účtu.
 *
 * Dve zvláštnosti oproti ostatným platformám:
 *   – prihlásenie je jednoduchý dlhodobý token v hlavičke `Access-Token`
 *   – chybu TikTok vráti s HTTP 200 a nenulovým `code` v tele, takže stav
 *     odpovede sám o sebe nestačí
 *
 * Obrázok sa posiela ako multipart spolu s MD5 podpisom, ktorým si TikTok
 * overí, že prenos neprišiel poškodený.
 */
import crypto from 'node:crypto';

const BASE    = process.env.TIKTOK_ENDPOINT || 'https://business-api.tiktok.com';
const VERSION = process.env.TIKTOK_API_VERSION || 'v1.3';

// Kódy, pri ktorých má zmysel počkať a skúsiť znova (limity a dočasné výpadky)
const RETRYABLE_CODES = new Set([40100, 40133, 50000]);

export function tiktokCredentialsFromEnv() {
  return {
    accessToken: process.env.TIKTOK_ACCESS_TOKEN,
    advertiserId: String(process.env.TIKTOK_ADVERTISER_ID || '').trim(),
  };
}

export class TikTokAdsClient {
  constructor(creds, opts = {}) {
    const missing = ['accessToken', 'advertiserId'].filter(k => !creds[k]);
    if (missing.length) {
      throw new Error(`Chýbajúce údaje pre TikTok: ${missing.join(', ')} ` +
                      '(TIKTOK_ACCESS_TOKEN, TIKTOK_ADVERTISER_ID)');
    }
    this.creds = creds;
    this.retries = opts.retries ?? 3;
  }

  async request(path, { method = 'GET', form = null, query = null } = {}) {
    const url = new URL(`${BASE}/open_api/${VERSION}${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);

    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Access-Token': this.creds.accessToken },
          body: form || undefined,
          signal: AbortSignal.timeout(60_000),
        });

        const text = await res.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : {}; } catch { /* nechaj null */ }

        // TikTok hlási chyby v tele, nie stavovým kódom
        const code = payload?.code;
        const ok = res.ok && (code === 0 || code === undefined);

        if (!ok) {
          const detail = payload?.message || text.slice(0, 400);
          const err = new Error(`TikTok API ${res.status}/${code ?? '?'}: ${detail}`);
          err.status = res.status;
          err.code = code;
          const retry = res.status === 429 || res.status >= 500 || RETRYABLE_CODES.has(Number(code));
          if (retry && attempt < this.retries) { lastErr = err; continue; }
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
   * Nahrá obrázok do knižnice účtu.
   * @returns {Promise<{imageId:string, url:string|null}>}
   */
  async uploadImage({ buffer, name }) {
    const form = new FormData();
    form.set('advertiser_id', this.creds.advertiserId);
    form.set('upload_type', 'UPLOAD_BY_FILE');
    form.set('file_name', `${name}.png`);
    // Podpis obsahu – TikTok si ním overí neporušenosť prenosu
    form.set('image_signature', crypto.createHash('md5').update(buffer).digest('hex'));
    form.set('image_file', new Blob([buffer], { type: 'image/png' }), `${name}.png`);

    const res = await this.request('/file/image/ad/upload/', { method: 'POST', form });
    const data = res?.data || {};
    if (!data.image_id) {
      throw new Error(`Odpoveď TikToku neobsahuje image_id: ${JSON.stringify(res).slice(0, 300)}`);
    }
    return { imageId: data.image_id, url: data.image_url || null };
  }

  /** Obrázky, ktoré už v účte sú. */
  async listImages({ limit = 100 } = {}) {
    const res = await this.request('/file/image/ad/search/', {
      query: { advertiser_id: this.creds.advertiserId, page_size: String(limit) },
    });
    return (res?.data?.list || []).map(i => ({
      imageId: i.image_id, name: i.file_name, url: i.image_url,
    })).filter(i => i.imageId);
  }
}
