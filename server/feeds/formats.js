/**
 * Serializácia položiek do formátov, ktoré reklamné platformy vedia načítať.
 *
 *   google-merchant.xml     RSS 2.0 s namespace g: – Merchant Center / Performance Max
 *   google-ads-dynamic.csv  feed firemných údajov pre dynamický remarketing v Google Ads
 *   meta-catalog.csv        katalóg produktov Meta (Facebook / Instagram)
 *   meta-catalog.xml        ten istý katalóg v XML (Meta akceptuje oba)
 *   items.json              surové položky – na ladenie a vlastné integrácie
 */
import { config } from '../config.js';

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // XML 1.0 nepovoľuje riadiace znaky
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const csvCell = (s) => {
  const v = String(s ?? '').replace(/\r?\n/g, ' ');
  return /[",;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

const csvRows = (header, rows) =>
  [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Google Merchant Center / Performance Max – RSS 2.0. */
export function googleMerchantXml(items, { title, link } = {}) {
  const body = items.map(it => `  <item>
    <g:id>${xmlEsc(it.id)}</g:id>
    <g:item_group_id>${xmlEsc(it.itemGroupId)}</g:item_group_id>
    <g:title>${xmlEsc(it.title)}</g:title>
    <g:description>${xmlEsc(it.description)}</g:description>
    <g:link>${xmlEsc(it.link)}</g:link>
    <g:image_link>${xmlEsc(it.imageLink)}</g:image_link>
${it.additionalImages.map(u => `    <g:additional_image_link>${xmlEsc(u)}</g:additional_image_link>`).join('\n')}
    <g:availability>${xmlEsc(it.availability)}</g:availability>
    <g:condition>${xmlEsc(it.condition)}</g:condition>
    <g:price>${xmlEsc(it.priceStr)}</g:price>
    <g:brand>${xmlEsc(it.brand)}</g:brand>
    <g:product_type>${xmlEsc(it.productType)}</g:product_type>
    <g:identifier_exists>no</g:identifier_exists>
    <g:custom_label_0>${xmlEsc(it.destination)}</g:custom_label_0>
    <g:custom_label_1>${xmlEsc(it.dateFrom || '')}</g:custom_label_1>
    <g:custom_label_2>${xmlEsc(it.discount ? `zlava-${it.discount}` : 'bez-zlavy')}</g:custom_label_2>
    <g:custom_label_3>${xmlEsc(it.days ? `${it.days}-dni` : '')}</g:custom_label_3>
  </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
  <title>${xmlEsc(title || `${config.brand} – zájazdy`)}</title>
  <link>${xmlEsc(link || config.siteUrl)}</link>
  <description>${xmlEsc(`Produktový feed zájazdov ${config.brand} s automaticky generovanými bannermi`)}</description>
${body}
</channel>
</rss>
`;
}

/** Meta (Facebook / Instagram) katalóg – XML variant. */
export function metaCatalogXml(items, { title, link } = {}) {
  const body = items.map(it => `  <item>
    <id>${xmlEsc(it.id)}</id>
    <item_group_id>${xmlEsc(it.itemGroupId)}</item_group_id>
    <title>${xmlEsc(it.title)}</title>
    <description>${xmlEsc(it.description)}</description>
    <link>${xmlEsc(it.link)}</link>
    <image_link>${xmlEsc(it.imageLink)}</image_link>
${it.additionalImages.map(u => `    <additional_image_link>${xmlEsc(u)}</additional_image_link>`).join('\n')}
    <availability>${xmlEsc(it.availability)}</availability>
    <condition>${xmlEsc(it.condition)}</condition>
    <price>${xmlEsc(it.priceStr)}</price>
    <brand>${xmlEsc(it.brand)}</brand>
    <product_type>${xmlEsc(it.productType)}</product_type>
    <custom_label_0>${xmlEsc(it.destination)}</custom_label_0>
    <custom_label_1>${xmlEsc(it.dateFrom || '')}</custom_label_1>
  </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${xmlEsc(title || `${config.brand} – katalóg zájazdov`)}</title>
  <link>${xmlEsc(link || config.siteUrl)}</link>
${body}
</channel>
</rss>
`;
}

/** Meta katalóg – CSV variant (rovnaké stĺpce ako oficiálna šablóna). */
export function metaCatalogCsv(items) {
  const header = [
    'id','title','description','availability','condition','price','link','image_link',
    'brand','item_group_id','additional_image_link','product_type',
    'custom_label_0','custom_label_1',
  ];
  const rows = items.map(it => [
    it.id, it.title, it.description, it.availability, it.condition, it.priceStr,
    it.link, it.imageLink, it.brand, it.itemGroupId,
    it.additionalImages.join(','), it.productType,
    it.destination, it.dateFrom || '',
  ]);
  return csvRows(header, rows);
}

/**
 * Google Ads – feed firemných údajov pre dynamický remarketing (typ Vlastné).
 * Nahráva sa v Google Ads: Nástroje → Zdieľaná knižnica → Firemné údaje.
 */
export function googleAdsDynamicCsv(items) {
  const header = [
    'ID','ID2','Item title','Item subtitle','Item description','Item category',
    'Price','Sale price','Final URL','Image URL','Contextual keywords','Item ID',
  ];
  const rows = items.map(it => [
    it.id,
    it.itemGroupId,
    it.title,
    [it.destination, it.days ? `${it.days} dní` : ''].filter(Boolean).join(' • '),
    it.description,
    it.category || it.destination || 'Zájazdy',
    it.priceStr,
    it.discount ? it.priceStr : '',
    it.link,
    it.imageLink,
    it.keywords.join(';'),
    it.itemGroupId,
  ]);
  return csvRows(header, rows);
}

export const SERIALIZERS = {
  'google-merchant.xml':    { fn: googleMerchantXml,   mime: 'application/xml; charset=utf-8' },
  'google-ads-dynamic.csv': { fn: googleAdsDynamicCsv, mime: 'text/csv; charset=utf-8' },
  'meta-catalog.csv':       { fn: metaCatalogCsv,      mime: 'text/csv; charset=utf-8' },
  'meta-catalog.xml':       { fn: metaCatalogXml,      mime: 'application/xml; charset=utf-8' },
  'items.json':             { fn: (items) => JSON.stringify({ count: items.length, items }, null, 2),
                              mime: 'application/json; charset=utf-8' },
};
