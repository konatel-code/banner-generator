/**
 * Automatický výber najvhodnejšej fotky zájazdu.
 *
 * Feed obsahuje pri jednom zájazde aj 20 obrázkov – medzi nimi sú okrem
 * fotografií aj ikonky, feature-listy a promo grafiky. Skóre uprednostní
 * bohatú farebnú fotografiu a penalizuje biele/šedé grafiky.
 *
 * Bez DOM závislostí: canvas 64×64 sa odovzdáva zvonku (prehliadač
 * document.createElement('canvas'), server @napi-rs/canvas createCanvas).
 */
import { imgCover } from './banner.js';

/**
 * Vyrobí skórovaciu funkciu nad daným canvasom 64×64.
 * @param {HTMLCanvasElement|object} canvas64 canvas s rozmermi 64×64
 */
export function makeScorer(canvas64) {
  const cx = canvas64.getContext('2d', {willReadFrequently: true});

  return function scoreImgFromImg(img, url) {
    if (!img) return -1;
    cx.clearRect(0, 0, 64, 64);
    imgCover(cx, img, 0, 0, 64, 64, 0.5);
    const {data} = cx.getImageData(0, 0, 64, 64);
    const n = 64*64;

    // Priemer kanálov
    let rS=0,gS=0,bS=0;
    for (let i=0;i<data.length;i+=4){rS+=data[i];gS+=data[i+1];bS+=data[i+2];}
    const rM=rS/n, gM=gS/n, bM=bS/n;

    // Rozptyl, biela plocha, tmavá plocha, saturácia
    let varS=0, whiteN=0, darkN=0, satS=0, grayN=0;
    for (let i=0;i<data.length;i+=4){
      const r=data[i],g=data[i+1],b=data[i+2];
      varS += (r-rM)**2 + (g-gM)**2 + (b-bM)**2;
      if (r>230 && g>230 && b>230) whiteN++;         // blízko bielej = promo pozadie
      if (r<25  && g<25  && b<25)  darkN++;           // čisto čierna = overlay/text
      const mx=Math.max(r,g,b)/255, mn=Math.min(r,g,b)/255;
      satS += mx>0.08 ? (mx-mn)/mx : 0;
      // Šedé pixely (nízka saturácia) – veľa šedej = UI/ikony
      if (mx>0 && (mx-mn)/mx < 0.12) grayN++;
    }
    const variance  = varS/(n*3);
    const whiteFrac = whiteN/n;
    const darkFrac  = darkN/n;
    const satAvg    = satS/n;
    const grayFrac  = grayN/n;

    // Hlavné skóre: bohatá fotka = vysoký rozptyl + saturácia
    let score = Math.sqrt(variance) * (0.35 + satAvg * 1.4);

    // Penalizácia za veľké biele/svetlé plochy (promo/ikona pozadie, feature-list)
    score *= Math.max(0.02, 1 - whiteFrac * 4.0);
    // Penalizácia za veľmi tmavé plochy (textový overlay)
    score *= Math.max(0.2,  1 - darkFrac  * 1.8);
    // Penalizácia za šedú/nízko-saturovanú dominanciu (UI, ikony, infografiky)
    score *= Math.max(0.2,  1 - grayFrac  * 1.6);

    // Kombinácia svetlé pozadie + nízka saturácia = feature-list/ikona stránka
    if (whiteFrac > 0.35 && satAvg < 0.18) score *= 0.15; // drastická penalizácia
    if (whiteFrac > 0.25 && grayFrac > 0.45) score *= 0.25; // sivé ikony na bielom

    // Bonus pre stock-foto vzory v názve súboru
    const fn = url.split('/').pop().toLowerCase();
    if (/\d{5,}/.test(fn))                                           score *= 1.18; // dlhé číslo = stock
    if (/depositphotos|shutterstock|pixabay|unsplash|adobe/.test(fn)) score *= 1.25;
    // Bonus: typické mená cestovných fotografií
    if (/foto|photo|image|view|beach|hotel|resort|coast|sea|lake|mount/.test(fn)) score *= 1.10;
    // Penalizácia: slug zodpovedajúci názvu zájazdu alebo feature obrázky
    if (/^[a-z0-9]+(-[a-z0-9]+){4,}\.jpg$/i.test(fn))              score *= 0.78;
    if (/icon|feature|service|amenity|includ|ponuka|ikona|sluzb/.test(fn)) score *= 0.30;

    return Math.max(0, score);
  };
}

/**
 * Z výsledkov skórovania vyberie najlepší obrázok pre každú kategóriu formátu.
 * @param {Array<{url:string, score:number, ratio:number}>} results
 * @param {string|null} fallback URL použitá ak nič neprejde
 * @returns {{portrait:string, landscape:string, strip:string}}
 */
export function bestPerAspect(results, fallback = null) {
  const same = { portrait: fallback, landscape: fallback, strip: fallback };
  const valid = results.filter(r => r.score >= 0);
  if (!valid.length) return same;

  const best = (cat) => valid.reduce((acc, r) => {
    let s = r.score;
    if (cat === 'portrait') {
      // Pre story/skyscraper: portrait foto (r<1) dostane bonus, veľmi široké penalizácia
      s *= r.ratio < 1.0 ? 1.5 : r.ratio < 1.6 ? 1.05 : 0.80;
    } else if (cat === 'strip') {
      // Pre pásiky: wide landscape foto
      s *= r.ratio >= 2.5 ? 1.2 : r.ratio >= 1.5 ? 1.1 : 1.0;
    }
    // landscape: žiadny extra bonus – základné skóre rozhoduje
    return (!acc || s > acc.s) ? { url: r.url, s } : acc;
  }, null)?.url || valid[0].url;

  return { portrait: best('portrait'), landscape: best('landscape'), strip: best('strip') };
}
