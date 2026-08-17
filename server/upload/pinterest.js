/**
 * Klient Pinterest API v5 – vytvorenie pinu z bannera.
 *
 * Pinterest nemá samostatnú knižnicu podkladov ako Google Ads či Meta:
 * jednotkou obsahu je pin na nástenke, ktorý sa potom dá propagovať.
 * Preto sa banner nahráva ako pin (obrázok v base64) na zvolenú nástenku
 * a vráti sa `pin_id`.
 *
 * Prihlásenie je dlhodobý token aplikácie s právom `pins:write`.
 */

const BASE    = process.env.PINTEREST_ENDPOINT || 'https://api.pinterest.com';
const VERSION = process.env.PINTEREST_API_VERSION || 'v5';

export function pinterestCredentialsFromEnv() {
  return {
    accessToken: process.env.PINTEREST_ACCESS_TOKEN,
    boardId: String(process.env.PINTEREST_BOARD_ID || '').trim(),
    // Odkaz, kam pin vedie; ak nie je, doplní ho volajúci z feedu
    defaultLink: process.env.PINTEREST_DEFAULT_LINK || '',
  };
}

export class PinterestClient {
  constructor(creds, opts = {}) {
    const missing = ['accessToken', 'boardId'].filter(k => !creds[k]);
    if (missing.length) {
      throw new Error(`Chýbajúce údaje pre Pinterest: ${missing.join(', ')} ` +
                      '(PINTEREST_ACCESS_TOKEN, PINTEREST_BOARD_ID)');
    }
    this.creds = creds;
    this.retries = opts.retries ?? 3;
  }

  async request(path, { method = 'GET', json = null, query = null } = {}) {
    const url = new URL(`${BASE}/${VERSION}${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);

    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)));

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.creds.accessToken}`,
            ...(json ? { 'Content-Type': 'application/json' } : {}),
          },
          body: json ? JSON.stringify(json) : undefined,
          signal: AbortSignal.timeout(60_000),
        });

        const text = await res.text();
        let payload = null;
        try { payload = text ? JSON.parse(text) : {}; } catch { /* nechaj null */ }

        if (!res.ok) {
          const detail = payload?.message || text.slice(0, 400);
          const err = new Error(`Pinterest API ${res.status}: ${detail}`);
          err.status = res.status;
          err.payload = payload;
          const retry = res.status === 429 || res.status >= 500;
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
   * Vytvorí pin s bannerom.
   * @returns {Promise<{pinId:string, url:string|null}>}
   */
  async uploadImage({ buffer, name, title, link, description }) {
    const res = await this.request('/pins', {
      method: 'POST',
      json: {
        board_id: this.creds.boardId,
        title: (title || name).slice(0, 100),
        description: (description || title || name).slice(0, 800),
        link: link || this.creds.defaultLink || undefined,
        alt_text: (title || name).slice(0, 500),
        media_source: {
          source_type: 'image_base64',
          content_type: 'image/png',
          data: buffer.toString('base64'),
        },
      },
    });

    if (!res?.id) {
      throw new Error(`Odpoveď Pinterestu neobsahuje id pinu: ${JSON.stringify(res).slice(0, 300)}`);
    }
    return { pinId: res.id, url: res.media?.images?.originals?.url || null };
  }

  /** Piny, ktoré už na nástenke sú. */
  async listImages({ limit = 100 } = {}) {
    const res = await this.request(`/boards/${encodeURIComponent(this.creds.boardId)}/pins`, {
      query: { page_size: String(Math.min(limit, 250)) },
    });
    return (res?.items || []).map(p => ({
      pinId: p.id, name: p.title, url: p.media?.images?.originals?.url || null,
    })).filter(p => p.pinId);
  }
}
