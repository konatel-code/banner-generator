/**
 * Formáty bannerov a korporátne farby.
 * Zdieľané medzi prehliadačom (index.html) a serverom (server/).
 */

// Korporátne farby: len modrá a zelená (bez oranžovej)
export const C = {
  primary:'#1F315F', primaryDark:'#182347', primaryLight:'#2D4A7A',
  green:'#67982f', greenDark:'#4f7322', greenLight:'#7db535',
  white:'#FFFFFF', whiteAlpha:'rgba(255,255,255,0.9)',
};

export const FORMATS = {
  'Google Ads':[
    {name:'Rectangle',      sz:'300×250',   w:300, h:250},
    {name:'Leaderboard',    sz:'728×90',    w:728, h:90},
    {name:'Half Page',      sz:'300×600',   w:300, h:600},
    {name:'Wide Skyscraper',sz:'160×600',   w:160, h:600},
    {name:'Billboard',      sz:'970×250',   w:970, h:250},
    {name:'Mobile Banner',  sz:'320×50',    w:320, h:50},
    {name:'Story',          sz:'1080×1920', w:1080, h:1920},
  ],
  'Facebook / Instagram':[
    {name:'News Feed',  sz:'1200×628',  w:1200, h:628},
    {name:'Štvorcový',  sz:'1080×1080', w:1080, h:1080},
    {name:'Story',      sz:'1080×1920', w:1080, h:1920},
  ],
  'Microsoft Ads':[
    {name:'Rectangle',       sz:'300×250', w:300, h:250},
    {name:'Leaderboard',     sz:'728×90',  w:728, h:90},
    {name:'Wide Skyscraper', sz:'160×600', w:160, h:600},
  ],
  'TikTok Ads':[
    {name:'Story',     sz:'1080×1920', w:1080, h:1920},
    {name:'Štvorcový', sz:'1080×1080', w:1080, h:1080},
  ],
  'Pinterest Ads':[
    {name:'Story',          sz:'1080×1920', w:1080, h:1920},
    {name:'Štandardný Pin', sz:'1000×1500', w:1000, h:1500},
    {name:'Štvorcový',      sz:'1080×1080', w:1080, h:1080},
  ],
};

// Podporované štýly bannerov (rovnaké názvy ako prepínač v UI)
export const STYLES = ['dark', 'light-wave', 'light-stamp'];

// Všetky unikátne rozmery naprieč platformami – pre server-side render a feedy
export function allSizes() {
  const seen = new Map();
  for (const fmts of Object.values(FORMATS)) {
    for (const f of fmts) {
      const key = `${f.w}x${f.h}`;
      if (!seen.has(key)) seen.set(key, {w:f.w, h:f.h, name:f.name, key});
    }
  }
  return [...seen.values()];
}

// Rozpozná rozmer zo stringu "300x250"; vracia null ak nie je v zozname povolených
export function sizeFromKey(key) {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(key || ''));
  if (!m) return null;
  const w = +m[1], h = +m[2];
  return allSizes().find(s => s.w === w && s.h === h) || null;
}

// Typ layoutu podľa pomeru strán – rozhoduje, ktorá šablóna sa kreslí
export function layout(w, h) {
  const r = w / h;
  if (r >= 6)   return 'strip';
  if (r >= 3)   return 'horizontal';
  if (r >= 1.4) return 'landscape';
  if (h >= 1500) return 'story';
  if (r < 0.6)  return 'skyscraper';
  return 'square';
}

// Kategória obrázka podľa pomeru strán formátu – ktorá fotka sa hodí
export function imgCategory(w, h) {
  const r = w / h;
  if (r >= 3)    return 'strip';     // pásiky (728×90, 320×50)
  if (r >= 1.25) return 'landscape'; // horizontál, square
  return 'portrait';                  // story, skyscraper, portrait
}
