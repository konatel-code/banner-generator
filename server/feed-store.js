/**
 * Načítanie a cache XML feedu zájazdov.
 *
 * Feed sa sťahuje najviac raz za config.feedTtlMs; ostatné požiadavky
 * dostanú pamäťovú kópiu. Pri chybe sťahovania sa ponechá posledná
 * úspešná verzia (služba tak neprestane fungovať kvôli výpadku feedu).
 */
import crypto from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { parseFeedDocument } from '../shared/feed.js';
import { config } from './config.js';

let state = {
  tours: [],
  byId: new Map(),
  version: '',        // hash obsahu – vstupuje do cache kľúčov bannerov
  fetchedAt: 0,
  lastError: null,
  lastOkAt: 0,
};

let inFlight = null;

async function fetchFeed() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(config.feedUrl, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CK DAKA Banner Service', 'Accept': 'application/xml,text/xml,*/*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Rozparsuje XML text na zoznam zájazdov. Exportované kvôli testom. */
export function parseFeedText(text) {
  const doc = new DOMParser({
    onError: () => {},   // feed obsahuje drobné nevalidnosti, parser ich zvládne
  }).parseFromString(text, 'text/xml');
  return parseFeedDocument(doc);
}

/** Naplní store z už stiahnutého XML textu (používajú testy a lokálny fixture). */
export function loadFromText(text) {
  const tours = parseFeedText(text);
  const version = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
  state = {
    tours,
    byId: new Map(tours.map(t => [t.id, t])),
    version,
    fetchedAt: Date.now(),
    lastError: null,
    lastOkAt: Date.now(),
  };
  return state;
}

/**
 * Vráti aktuálny stav feedu. Ak je cache stará, stiahne ho znova.
 * Súbežné volania zdieľajú jedno sťahovanie.
 */
export async function getFeed({ force = false } = {}) {
  const fresh = Date.now() - state.fetchedAt < config.feedTtlMs;
  if (!force && fresh && state.tours.length) return state;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const text = await fetchFeed();
      const next = loadFromText(text);
      console.log(`[feed] načítaných ${next.tours.length} zájazdov (verzia ${next.version})`);
      return next;
    } catch (err) {
      state.lastError = err.message;
      state.fetchedAt = Date.now();   // neskúšaj hneď znova pri každom requeste
      console.error(`[feed] chyba sťahovania: ${err.message}`);
      if (!state.tours.length) throw err;
      return state;                   // dožívame na poslednej dobrej verzii
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Jeden zájazd podľa kódu. */
export async function getTour(code) {
  const feed = await getFeed();
  return feed.byId.get(String(code)) || null;
}

export function feedStatus() {
  return {
    tours: state.tours.length,
    version: state.version,
    fetchedAt: state.fetchedAt ? new Date(state.fetchedAt).toISOString() : null,
    lastOkAt: state.lastOkAt ? new Date(state.lastOkAt).toISOString() : null,
    lastError: state.lastError,
  };
}
