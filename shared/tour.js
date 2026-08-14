/**
 * Pomocné funkcie nad objektom zájazdu.
 * Zdieľané medzi prehliadačom a serverom – žiadne DOM závislosti.
 */

export function formatDate(iso) {
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ── Override helpers – ak je zájazd vybraný s konkrétnym termínom, použi ho ──
export function tourPrice(t)     { return t._overridePrice    ?? t.minPrice;  }
export function tourDateFrom(t)  { return t._overrideDateFrom ?? t.dateFrom;  }
export function tourDateTo(t)    { return t._overrideDateTo   ?? t.dateTo;    }
export function tourDays(t)      { return t._overrideDays     ?? t.days;      }

// Formát ceny: "X,XX €" keď je konkrétny termín, "od X €" keď min cena
export function tourPriceStr(t) {
  if (t._overridePrice != null) return `${t._overridePrice.toFixed(2).replace('.',',')} €`;
  return t.minPrice != null ? `od ${Math.round(t.minPrice)} €` : null;
}

// "už za" prefix len pre override (konkrétna cena), pre minPrice "od"
export function tourPricePrefix(t) { return t._overridePrice != null ? 'už za' : 'od'; }

// Odstráni diakritiku: "paríž" → "pariz", "česká" → "ceska"
export function stripDia(s) {
  return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
}

/**
 * Vráti kópiu zájazdu s aplikovaným konkrétnym termínom (podľa dátumu odchodu).
 * Používa server pri generovaní bannera pre konkrétny termín.
 * @param {object} tour
 * @param {string|null} dateFrom ISO dátum "YYYY-MM-DD"
 */
export function withTerm(tour, dateFrom) {
  if (!dateFrom || !tour.terms?.length) return tour;
  const term = tour.terms.find(t => t.dateFrom === dateFrom);
  if (!term) return tour;
  return {
    ...tour,
    _overrideDateFrom: term.dateFrom,
    _overrideDateTo:   term.dateTo,
    _overrideDays:     term.days,
    _overridePrice:    term.price,
  };
}

/** Najbližší termín od zadaného dňa (default dnes). */
export function nextTerm(tour, fromISO) {
  const from = fromISO || new Date().toISOString().slice(0,10);
  const upcoming = (tour.terms || [])
    .filter(t => t.dateFrom >= from)
    .sort((a,b) => a.dateFrom.localeCompare(b.dateFrom));
  return upcoming[0] || null;
}
