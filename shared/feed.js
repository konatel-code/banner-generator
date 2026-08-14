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

    // Odkaz na detail zájazdu – ak ho feed obsahuje (inak si ho server doplní zo šablóny)
    const urlEl = tag1(item, 'url') || tag1(item, 'link');
    const url = item.getAttribute('url') || item.getAttribute('link')
             || (urlEl ? txt(urlEl).trim() : '') || '';

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
