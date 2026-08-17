/**
 * Zostavenie položiek produktového feedu zo zájazdov.
 *
 * Jedna položka = jeden zájazd, prípadne jeden konkrétny termín zájazdu
 * (vtedy má vlastnú cenu aj dátumy). Obrázok položky nie je fotka z feedu,
 * ale URL na render endpoint tejto služby – platforma si tak stiahne hotový
 * banner s cenou, zľavou aj logom.
 */
import { config, tourLink } from '../config.js';
import { formatDate, withTerm, tourPrice } from '../../shared/tour.js';

// Rozmery bannerov použité vo feede
export const FEED_SIZES = {
  main:   { w: 1200, h: 628 },    // hlavný obrázok – pomer 1.91:1
  square: { w: 1080, h: 1080 },
  story:  { w: 1080, h: 1920 },
};

/** URL na render endpoint tejto služby. */
export function bannerUrl(base, tour, size, { style, term } = {}) {
  const q = new URLSearchParams();
  if (style) q.set('style', style);
  if (term)  q.set('term', term);
  const qs = q.toString();
  return `${base}/img/${encodeURIComponent(tour.id)}/${size.w}x${size.h}.jpg${qs ? '?' + qs : ''}`;
}

function describe(tour) {
  const parts = [];
  if (tour.dest) parts.push(tour.dest);
  if (tour.days > 0) parts.push(`${tour.days} dní`);
  const df = tour._overrideDateFrom ?? tour.dateFrom;
  const dt = tour._overrideDateTo ?? tour.dateTo;
  if (df) parts.push(dt ? `${formatDate(df)} – ${formatDate(dt)}` : formatDate(df));
  const price = tourPrice(tour);
  if (price) parts.push(`cena od ${Math.round(price)} €`);
  if (tour.maxDiscount > 0) parts.push(`zľava až ${tour.maxDiscount} %`);
  return `${tour.name}. ${parts.join(', ')}.`.replace(/\s+/g, ' ').trim();
}

/**
 * @param {Array<object>} tours zájazdy z feedu
 * @param {object} opts
 * @param {string} opts.base       verejná adresa služby (bez lomky na konci)
 * @param {string} [opts.style]    štýl bannera
 * @param {number} [opts.terms]    koľko najbližších termínov na zájazd (1 = len najbližší)
 * @param {number} [opts.limit]    maximálny počet položiek
 * @param {string} [opts.from]     ISO dátum – termíny staršie sa ignorujú
 */
export function buildItems(tours, opts = {}) {
  const {
    base,
    style,
    terms = 1,
    limit = config.feedLimit,
    from = new Date().toISOString().slice(0, 10),
  } = opts;

  const items = [];

  for (const tour of tours) {
    const upcoming = (tour.terms || [])
      .filter(t => t.dateFrom >= from)
      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom));

    // Zájazd, ktorému už všetky termíny prebehli, do feedu nepatrí –
    // inak by sa propagoval odchod, ktorý sa nedá kúpiť.
    if ((tour.terms || []).length && !upcoming.length) continue;
    // Zájazd bez termínov má zmysel len ak pozná aspoň cenu
    if (!upcoming.length && tour.minPrice == null) continue;

    const chosen = terms > 1 ? upcoming.slice(0, terms) : upcoming.slice(0, 1);
    const variants = chosen.length ? chosen : [null];

    for (const term of variants) {
      const data = term ? withTerm(tour, term.dateFrom) : tour;
      const price = tourPrice(data) ?? tour.minPrice;
      if (price == null) continue;

      const termKey = term ? term.dateFrom.replace(/-/g, '') : '';
      const query = { style, term: term ? term.dateFrom : undefined };

      items.push({
        id: termKey ? `${tour.id}-${termKey}` : String(tour.id),
        itemGroupId: String(tour.id),
        title: tour.name.slice(0, 150),
        description: describe(data).slice(0, 5000),
        link: tourLink(tour),
        imageLink: bannerUrl(base, tour, FEED_SIZES.main, query),
        additionalImages: [
          bannerUrl(base, tour, FEED_SIZES.square, query),
          bannerUrl(base, tour, FEED_SIZES.story, query),
        ],
        price,
        priceStr: `${price.toFixed(2)} ${config.currency}`,
        currency: config.currency,
        availability: 'in stock',
        condition: 'new',
        brand: config.brand,
        productType: ['Zájazdy', tour.dest || tour.category || 'Ostatné'].filter(Boolean).join(' > '),
        category: tour.category || '',
        destination: tour.dest || '',
        dateFrom: term ? term.dateFrom : tour.dateFrom,
        dateTo: term ? term.dateTo : tour.dateTo,
        days: term ? term.days : tour.days,
        discount: tour.maxDiscount || 0,
        keywords: [tour.dest, tour.category, 'dovolenka', 'zájazd'].filter(Boolean),
      });

      if (limit && items.length >= limit) return items;
    }
  }

  return items;
}
