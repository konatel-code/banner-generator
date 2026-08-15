/**
 * Pamäť o tom, čo už bolo do platformy nahraté.
 *
 * Bez nej by každý beh nahrával všetko odznova. Kľúčom je hash obsahu
 * bannera – keď sa vo feede zmení cena, hash sa zmení a podklad sa nahrá
 * nanovo; keď sa nezmenilo nič, beh je bez jediného volania API.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function contentHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
}

export class UploadState {
  /**
   * @param {string} file cesta k JSON súboru so stavom
   * @param {string} platform napr. 'google-ads'
   */
  constructor(file, platform) {
    this.file = file;
    this.platform = platform;
    this.data = { version: 1, platforms: {} };
  }

  async load() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.platforms) this.data = parsed;
    } catch {
      // Prvý beh – prázdny stav je v poriadku
    }
    this.data.platforms[this.platform] ||= { assets: {} };
    return this;
  }

  async save() {
    this.data.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.file);
  }

  #assets() { return this.data.platforms[this.platform].assets; }

  /** Bol tento presný obsah pod týmto kľúčom už nahratý? */
  isUploaded(key, hash) {
    const rec = this.#assets()[key];
    return !!rec && rec.hash === hash && !!rec.ref;
  }

  get(key) { return this.#assets()[key] || null; }

  /**
   * @param {string} key názov podkladu
   * @param {object} rec
   * @param {string} rec.hash hash obsahu bannera
   * @param {string} rec.ref  identifikátor v platforme – resourceName (Google Ads) alebo hash obrázka (Meta)
   */
  record(key, { hash, ref, name, meta }) {
    this.#assets()[key] = {
      hash, ref, name,
      uploadedAt: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    };
  }

  /** Kľúče, ktoré sú v stave, ale v aktuálnej dávke sa nevyskytli. */
  staleKeys(currentKeys) {
    const set = new Set(currentKeys);
    return Object.keys(this.#assets()).filter(k => !set.has(k));
  }

  stats() {
    const assets = this.#assets();
    return { platform: this.platform, count: Object.keys(assets).length };
  }
}
