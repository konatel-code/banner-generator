/**
 * Parser XML feedu CK DAKA (cesys export).
 *
 * Pracuje nad ľubovoľnou DOM-like implementáciou, ktorá vie
 * getElementsByTagName / getAttribute / textContent:
 *   – prehliadač: new DOMParser().parseFromString(text, 'text/xml')
 *   – Node:       new DOMParser().parseFromString(text, 'text/xml') z @xmldom/xmldom
 */

const tags = (el, name) => Array.from(el.getElementsByTagName(name) || []);
const tag1 = (el, name) => tags(el, name)[0] || null;
const txt  = (el) => (el && el.textContent != null ? String(el.textContent) : '');

/** Meno elementu bez prípadného namespace prefixu, malými písmenami. */
const localName = (node) =>
  String(node && node.nodeName || '').replace(/^.*:/, '').toLowerCase();

/** Priami potomkovia daného mena (nie vnorení hlbšie). */
const children = (el, names) =>
  Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && names.includes(localName(n)));

/**
 * Očistí adresu z feedu. Relatívnu cestu necháva tak – doménu k nej
 * doplní až ten, kto odkaz použije (server pozná SITE_URL, prehliadač nie).
 */
function cleanUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return s;
  return '';   // čokoľvek iné nie je použiteľný odkaz
}

/**
 * Odkaz na detail zájazdu.
 *
 * Vo feede cesys je ako priamy potomok <url> (hneď za blokom
 * PRICELIST_INFO). Priamych potomkov berieme prednostne, aby nás
 * nepomýlila <url> vnorená hlbšie – napríklad v cenníku alebo galérii.
 * Meno tagu porovnávame bez ohľadu na veľkosť písmen, lebo export
 * mieša <url> a <URL>.
 */
function tourUrl(item) {
  const fromChild = children(item, ['url', 'link'])
    .map(n => cleanUrl(txt(n)))
    .find(Boolean);
  if (fromChild) return fromChild;

  const fromAttr = cleanUrl(item.getAttribute('url') || item.getAttribute('link'));
  if (fromAttr) return fromAttr;

  return [...tags(item, 'url'), ...tags(item, 'URL'), ...tags(item, 'link')]
    .map(n => cleanUrl(txt(n)))
    .find(Boolean) || '';
}

/**
 * @param {Document} doc XML dokument
 * @returns {Array<object>} zoznam zájazdov
 */
export function parseFeedDocument(doc) {
  return tags(doc, 'accommodation').map(item => {
    const code = item.getAttribute('code') || '';
    const name = (item.getAttribute('name') || '').trim();
    if (!code || !name) return null;

    // Všetky obrázky – main="1" ide ako prvý
    const imgEls = tags(item, 'image');
    const mainEl = imgEls.find(e => e.getAttribute('main') === '1');
    const imgs = [
      ...(mainEl ? [mainEl.getAttribute('url')] : []),
      ...imgEls.filter(e => e !== mainEl).map(e => e.getAttribute('url'))
    ].filter(Boolean);

    // Cena – minimum z final_price naprieč dátumami
    const prices = tags(item, 'final_price')
      .map(e => parseFloat(txt(e)))
      .filter(p => !isNaN(p) && p > 0);

    // Zľava – z <description name="Zľavy">
    const discounts = tags(item, 'description')
      .filter(e => ['Zľavy','Zlava','Zľava','Zlavy'].includes(e.getAttribute('name')))
      .map(e => parseInt(txt(e)))
      .filter(d => !isNaN(d) && d > 0);

    // Destinácia – extrahuj z názvu (country/destination sú "Array")
    const dm = name.match(/\bdo\s+([A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽÄ][\wáčďéíĺľňóôŕšťúýžÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽä\s,]+?)(?:\s+s\b|\s+na\b|\s+zo?\b|\s*$)/i)
            || name.match(/\bna\s+([A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽÄ][\wáčďéíĺľňóôŕšťúýžÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽä\s,]+?)(?:\s+s\b|\s*$)/i);
    // Ak sa nenašiel vzor "do/na X", skús extrahovať mesto pred pomlčkou ("Fethiye – Perla...")
    const dm2 = !dm && name.match(/^([A-ZÁČĎÉÍĹĽŇÓÔŔŠŤÚÝŽÄ][^\d–\-\n]{1,28}?)\s*[–\-]/);
    const dest = dm ? dm[1].trim() : (dm2 ? dm2[1].trim() : '');

    // Dátumy a počet dní – uložíme aj všetky termíny s cenami
    const dateEls = tags(item, 'date');
    const terms = dateEls.map(de => {
      const df = de.getAttribute('date_from');
      const dt = de.getAttribute('date_to');
      if (!df) return null;
      const pEl = tag1(de, 'final_price');
      const price = pEl ? parseFloat(txt(pEl)) : null;
      const nEl  = tag1(de, 'nights');
      const nts  = nEl ? parseInt(txt(nEl))||0 : 0;
      const dys  = dt && df ? Math.round((new Date(dt)-new Date(df))/86400000)+1 : (nts>0?nts+1:0);
      return { dateFrom: df, dateTo: dt||null, price: (!isNaN(price)&&price>0)?price:null, days: dys };
    }).filter(Boolean);

    const dateFroms = terms.map(t=>t.dateFrom).sort();
    const firstTerm = terms.find(t=>t.dateFrom===dateFroms[0]) || terms[0] || null;
    const firstDateEl = firstTerm ? dateEls.find(e=>e.getAttribute('date_from')===firstTerm.dateFrom) : null;
    const dateFrom = firstTerm ? firstTerm.dateFrom : null;
    const dateTo   = firstTerm ? firstTerm.dateTo   : null;
    const nightsEl = firstDateEl ? tag1(firstDateEl, 'nights') : null;
    const nights   = nightsEl ? (parseInt(txt(nightsEl))||0) : 0;
    const days = firstTerm ? firstTerm.days : (nights>0?nights+1:0);

    // Kategória (1. trip)
    const catEl = tag1(item, 'category');
    const category = catEl ? txt(catEl).trim() : '';

    // Odkaz na detail zájazdu – ak ho feed obsahuje (inak sa poskladá zo šablóny)
    const url = tourUrl(item);

    return {
      id: code, name, dest, category, url,
      imgUrl: imgs[0] || '',
      imgs,
      minPrice: prices.length ? Math.min(...prices) : null,
      maxDiscount: discounts.length ? Math.max(...discounts) : 0,
      nearestDate: dateFrom,
      dateFrom, dateTo, days,
      terms,   // [{dateFrom, dateTo, price, days}] – všetky dostupné termíny
    };
  }).filter(Boolean).filter(t => t.id && t.name);
}
