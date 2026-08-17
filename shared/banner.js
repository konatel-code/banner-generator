/**
 * Kreslenie bannerov na Canvas 2D.
 *
 * Modul je zámerne bez DOM závislostí – pracuje len s kontextom Canvas 2D,
 * takže rovnaký kód beží v prehliadači (index.html) aj na serveri
 * (@napi-rs/canvas v server/render.js). Vďaka tomu vyzerá server-side
 * vygenerovaný banner presne rovnako ako náhľad v prehliadači.
 *
 * Použitie:
 *   drawBanner(ctx, w, h, tour, tourImg, logoImg, { style: 'dark' })
 */
import { C, layout } from './formats.js';
import {
  formatDate, tourPrice, tourPriceStr, tourPricePrefix,
  tourDateFrom, tourDateTo, tourDays,
} from './tour.js';

export function drawBanner(ctx, w, h, tour, tImg, lImg, opts = {}) {
  const bannerStyle = opts.style || 'dark';
  ctx.clearRect(0,0,w,h);
  if (bannerStyle === 'light-wave')  { drawLight(ctx,w,h,tour,tImg,lImg,'wave');  return; }
  if (bannerStyle === 'light-stamp') { drawLight(ctx,w,h,tour,tImg,lImg,'stamp'); return; }
  if (bannerStyle === 'light')       { drawLight(ctx,w,h,tour,tImg,lImg,'wave');  return; } // backward compat
  const t = layout(w,h);
  if (t==='strip')      drawStrip(ctx,w,h,tour,tImg,lImg);
  else if (t==='horizontal') drawHorizontal(ctx,w,h,tour,tImg,lImg);
  else if (t==='landscape')  drawLandscape(ctx,w,h,tour,tImg,lImg);
  else if (t==='story')      drawStory(ctx,w,h,tour,tImg,lImg);
  else if (t==='skyscraper') drawSkyscraper(ctx,w,h,tour,tImg,lImg);
  else                       drawSquare(ctx,w,h,tour,tImg,lImg);
}

// yFocus 0=top 0.5=center 1=bottom  – pre cestovné fotky 0.55 ukazuje viac krajiny, menej oblohy
export function imgCover(ctx, img, x, y, w, h, yFocus=0.5) {
  if (!img) return;
  const ir = img.width/img.height, dr = w/h;
  let sx,sy,sw,sh;
  if (ir>dr){ sh=img.height; sw=sh*dr; sx=(img.width-sw)*0.5; sy=0; }
  else { sw=img.width; sh=sw/dr; sx=0; sy=(img.height-sh)*Math.max(0,Math.min(1,yFocus)); }
  ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);
}

function grad(ctx,x,y,w,h,dir,c0,c1){
  let g;
  if(dir==='b') g=ctx.createLinearGradient(x,y,x,y+h);
  else if(dir==='t') g=ctx.createLinearGradient(x,y+h,x,y);
  else if(dir==='r') g=ctx.createLinearGradient(x,y,x+w,y);
  else g=ctx.createLinearGradient(x+w,y,x,y);
  g.addColorStop(0,c0); g.addColorStop(1,c1);
  ctx.fillStyle=g; ctx.fillRect(x,y,w,h);
}

function rr(ctx,x,y,w,h,r,color){
  ctx.fillStyle=color; ctx.beginPath(); ctx.roundRect(x,y,w,h,r); ctx.fill();
}

function wrap(ctx,text,x,y,maxW,lh,maxL){
  const words=text.split(' '); let line=''; const lines=[];
  for(const word of words){
    const test=line?line+' '+word:word;
    if(ctx.measureText(test).width>maxW&&line){
      lines.push(line); if(lines.length>=maxL){lines[maxL-1]+='…';break;} line=word;
    } else line=test;
  }
  if(line&&lines.length<maxL) lines.push(line);
  lines.forEach((l,i)=>ctx.fillText(l,x,y+i*lh));
  return lines.length*lh;
}

// Nájdi najväčší font (maxFs→minFs) kde sa text zmestí do maxLines riadkov so šírkou maxW
function autoFit(ctx, text, maxW, maxLines, minFs, maxFs, weight='bold') {
  for (let fs = maxFs; fs >= minFs; fs--) {
    ctx.font = `${weight} ${fs}px Ubuntu,Arial`;
    const words = text.split(' '); let lines = 0, line = '';
    for (const wd of words) {
      const t2 = line ? line+' '+wd : wd;
      if (ctx.measureText(t2).width > maxW && line) { lines++; if(lines>=maxLines) break; line=wd; }
      else line = t2;
    }
    if (line) lines++;
    if (lines <= maxLines) return fs;
  }
  return minFs;
}

// Zmestí text do jedného riadka (zmenší font alebo skráti text)
function fitLine(ctx, text, maxW, minFs, maxFs, weight='500') {
  let fs = maxFs;
  for (; fs >= minFs; fs--) {
    ctx.font = `${weight} ${fs}px Ubuntu,Arial`;
    if (ctx.measureText(text).width <= maxW) return {fs, t: text};
  }
  // Stále sa nezmestí → skrátim na celé slová
  ctx.font = `${weight} ${minFs}px Ubuntu,Arial`;
  let t = text;
  while (t.includes(' ') && ctx.measureText(t+'…').width > maxW) t = t.slice(0, t.lastIndexOf(' '));
  if (t !== text) t += '…';
  return {fs: minFs, t};
}

// Skráti text na maxW so '…' ak sa nezmestí (pre jednoradové nadpisy)
function ellipsis(ctx, text, maxW) {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// Text shadow ON/OFF pre text na fotografii
function ts(ctx){ ctx.shadowColor='rgba(0,0,0,.72)'; ctx.shadowBlur=5; ctx.shadowOffsetX=0; ctx.shadowOffsetY=1; }
function tc(ctx){ ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetX=0; ctx.shadowOffsetY=0; }

// ── Logo: biela pill + logo v originálnych farbách ── vracia skutočnú šírku
// Vypočíta skutočnú šírku logo-boxu bez kreslenia (potrebné pre presné zarovnanie)
function measureLogo(lImg, maxW, maxH) {
  const vpad = Math.round(maxH * 0.15), hpad = Math.round(maxH * 0.28);
  if (!lImg) {
    return Math.min(maxW, maxH * 3.5);
  }
  const ratio = lImg.width / lImg.height;
  const innerH = maxH - vpad * 2;
  let lw = Math.min(maxW - hpad * 2, ratio * innerH);
  if (lw < 1) lw = 1;
  let lh = lw / ratio;
  if (lh > innerH) { lh = innerH; lw = lh * ratio; }
  return Math.min(Math.ceil(lw + hpad * 2), maxW);
}

// Nakreslí logo a vráti skutočnú šírku boxu
function drawLogo(ctx, lImg, x, y, maxW, maxH) {
  const vpad = Math.round(maxH * 0.15), hpad = Math.round(maxH * 0.28);
  if (!lImg) {
    const fs = Math.max(7, Math.min(maxH * 0.58, 20));
    ctx.font = `bold ${fs}px Ubuntu,Arial`;
    const tw = ctx.measureText('CK DAKA').width;
    const bw = Math.min(tw + hpad*2, maxW);
    tc(ctx);
    rr(ctx, x, y, bw, maxH, maxH*0.22, C.white);
    ctx.fillStyle = C.primary; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText('CK DAKA', x + hpad, y + maxH/2);
    return bw;
  }
  const ratio = lImg.width / lImg.height;
  const innerH = maxH - vpad * 2;
  let lw = Math.min(maxW - hpad * 2, ratio * innerH);
  if (lw < 1) lw = 1;
  let lh = lw / ratio;
  if (lh > innerH) { lh = innerH; lw = lh * ratio; }
  const totalW = Math.min(Math.ceil(lw + hpad * 2), maxW);
  tc(ctx);
  rr(ctx, x, y, totalW, Math.ceil(lh + vpad * 2), Math.ceil((lh + vpad * 2) * 0.2), C.white);
  ctx.drawImage(lImg, x + hpad, y + vpad, lw, lh);
  return totalW;
}

// Pomocné funkcie pre zarovnanie loga:
// Vpravo hore – presná medzera p z prava aj zhora
function drawLogoTopRight(ctx, lImg, w, p, maxH) {
  const maxW = Math.min(Math.round(maxH * 5), w - p * 2);
  const nw   = measureLogo(lImg, maxW, maxH);
  drawLogo(ctx, lImg, w - p - nw, p, maxW, maxH);
  return nw;
}
// Vycentrované horizontálne – presne na stred (rovnaká medzera z prava aj z ľava)
function drawLogoCentered(ctx, lImg, w, y, maxH) {
  const maxW = Math.min(Math.round(maxH * 5), w);
  const nw   = measureLogo(lImg, maxW, maxH);
  drawLogo(ctx, lImg, Math.round((w - nw) / 2), y, maxW, maxH);
  return nw;
}
// Vpravo hore v oblasti fotky (landscape split) – vpravo od ľavej hrany po wave
function drawLogoTopRightInPhoto(ctx, lImg, photoW, p, maxH) {
  const maxW = Math.min(Math.round(maxH * 5), photoW - p * 2);
  const nw   = measureLogo(lImg, maxW, maxH);
  drawLogo(ctx, lImg, photoW - p - nw, p, maxW, maxH);
  return nw;
}

// ── Templates ── (prísne sekcie, žiadne prekrývanie)

// STRIP: 728×90, 320×50, 468×60  – pásik
function drawStrip(ctx,w,h,tour,tImg,lImg){
  ctx.fillStyle=C.primary; ctx.fillRect(0,0,w,h);
  const p=Math.max(3,Math.round(h*.1));
  // Fotka: pravá 30% s plynulým prechodom
  const imgW=Math.round(w*.30);
  if(tImg){
    ctx.save(); ctx.beginPath(); ctx.rect(w-imgW,0,imgW,h); ctx.clip();
    imgCover(ctx,tImg,w-imgW,0,imgW,h,0.5);
    grad(ctx,w-imgW*1.2,0,imgW*1.2,h,'l','rgba(31,49,95,0)',C.primary);
    ctx.restore();
  }
  const availW = w - imgW - p*2;
  // Logo: vľavo, výška = 64% pruhu
  const logoH = Math.round(h*.64);
  const logoMaxW = Math.round(availW*.30);
  const actualLogoW = drawLogo(ctx,lImg,p,Math.round((h-logoH)/2),logoMaxW,logoH);
  const textX = p + actualLogoW + Math.max(4, Math.round(p*.9));
  // Cena (badge) vpravo pred fotkou – proporcionálna veľkosť
  let priceRight = w - imgW - p;
  if(tourPrice(tour)){
    const pfs = Math.max(7, Math.round(h*.30));
    ctx.font = `bold ${pfs}px Ubuntu,Arial`;
    const ps = tourPriceStr(tour);
    const pw = ctx.measureText(ps).width;
    const bpad = Math.round(p*.65);
    const bh = Math.round(h*.60), by = Math.round((h-bh)/2);
    const bx = priceRight - pw - bpad*2;
    if(bx > textX+16){
      rr(ctx, bx-bpad, by, pw+bpad*2, bh, 4, C.green);
      ctx.fillStyle=C.white; ctx.textBaseline='middle'; ctx.fillText(ps, bx, h/2);
      priceRight = bx - bpad - p;
    }
  }
  // Názov: AUTO-FIT – čo najväčší font, ktorý sa zmestí do dostupnej šírky
  const maxTxtW = priceRight - textX - p;
  if(maxTxtW > 20){
    const maxFs = Math.round(h*.38);
    const minFs = Math.max(7, Math.round(h*.14));
    const {fs, t} = fitLine(ctx, tour.name, maxTxtW, minFs, maxFs, '500');
    ctx.font = `500 ${fs}px Ubuntu,Arial`; ctx.fillStyle=C.white; ctx.textBaseline='middle';
    ctx.fillText(t, textX, h/2);
  }
}

// HORIZONTAL: 970×250  – wide landscape
// Stratégia: rezervuj spodných 28% pre cenu, zvyšok pre logo+dest+názov
function drawHorizontal(ctx,w,h,tour,tImg,lImg){
  if(tImg){imgCover(ctx,tImg,0,0,w,h);grad(ctx,0,0,w*.55,h,'r',C.primary,'rgba(31,49,95,0)');}
  else{ctx.fillStyle=C.primary;ctx.fillRect(0,0,w,h);}
  const p=Math.round(h*.09);
  const textW=Math.round(w*.46);
  // ── Spodná zóna (rezervovaná): cena + web ──
  const priceZoneH = Math.round(h*.28);
  const priceZoneTop = h - priceZoneH;
  if(tourPrice(tour)){
    const cfs=Math.round(h*.19);
    ctx.font=`bold ${cfs}px Ubuntu,Arial`; ctx.fillStyle=C.green;
    ctx.textBaseline='bottom'; ts(ctx);
    ctx.fillText(tourPriceStr(tour),p,h-p*.4); tc(ctx);
  }
  if(tour.maxDiscount>0){
    const zfs=Math.round(h*.09);
    ctx.font=`${zfs}px Ubuntu,Arial`; ctx.fillStyle=C.greenLight; ctx.textBaseline='bottom'; ts(ctx);
    ctx.fillText(`Zľava ${tour.maxDiscount}%`,p,priceZoneTop+Math.round(zfs*.2)); tc(ctx);
  }
  // Web
  ctx.font=`${Math.round(h*.073)}px Ubuntu,Arial`; ctx.fillStyle='rgba(255,255,255,.35)';
  ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText('ckdaka.sk',w-p,h-p*.3);
  ctx.textAlign='left';
  // ── Horná zóna: logo + dest + názov ──
  const topZoneBot = priceZoneTop - p;
  // Logo: vpravo hore – presná rovnaká medzera zhora aj zprava
  const logoH=Math.round(h*.22);
  drawLogoTopRight(ctx,lImg,w,p,logoH);
  let ty=p+logoH+Math.round(p*.55);
  // Destinácia
  const destFs=Math.round(h*.11);
  if(ty+destFs < topZoneBot){
    ctx.font=`300 ${destFs}px Ubuntu,Arial`; ctx.fillStyle=C.white;
    ctx.textBaseline='top'; ctx.globalAlpha=.72; ts(ctx);
    ctx.fillText(ellipsis(ctx,tour.dest.toUpperCase(),textW-p*2),p,ty); tc(ctx); ctx.globalAlpha=1;
    ty+=Math.round(destFs*1.28);
  }
  // Názov – AUTO-FIT max 2 riadky do zostávajúceho priestoru
  const maxNameH = topZoneBot - ty - p;
  if(maxNameH > 12){
    const maxNameFs=Math.round(h*.165);
    const minNameFs=Math.max(9, Math.round(h*.07));
    const nameFs=autoFit(ctx,tour.name,textW-p,2,minNameFs,maxNameFs);
    ctx.font=`bold ${nameFs}px Ubuntu,Arial`; ctx.fillStyle=C.white;
    ctx.textBaseline='top'; ts(ctx);
    wrap(ctx,tour.name,p,ty,textW-p,Math.round(nameFs*1.22),2); tc(ctx);
  }
  // CTA: vpravo dole
  const cw=Math.round(w*.145), ch=Math.round(h*.24);
  rr(ctx,w-p-cw,h-p-ch,cw,ch,6,C.green);
  ctx.font=`bold ${Math.round(h*.1)}px Ubuntu,Arial`; ctx.fillStyle=C.white;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('Viac info',w-p-cw/2,h-p-ch/2); ctx.textAlign='left';
}

// LANDSCAPE: 1200×628 – FB News Feed a pod.
function drawLandscape(ctx,w,h,tour,tImg,lImg){
  if(tImg){imgCover(ctx,tImg,0,0,w,h);}
  else{ctx.fillStyle=C.primary;ctx.fillRect(0,0,w,h);}
  // Silný gradient – spodných 78%
  grad(ctx,0,h*.22,w,h*.78,'b','rgba(12,20,50,0)','rgba(12,20,50,.98)');
  grad(ctx,0,0,w,h*.25,'t','rgba(0,0,0,.6)','rgba(0,0,0,0)');
  const p=Math.round(w*.033);
  // Logo: vpravo hore – presná rovnaká medzera zhora aj zprava
  const logoH=Math.round(h*.135);
  drawLogoTopRight(ctx,lImg,w,p,logoH);
  // Všetko od dna nahor
  const bot=h-p;
  ctx.font=`${Math.round(h*.027)}px Ubuntu,Arial`; ctx.fillStyle='rgba(255,255,255,.38)';
  ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText('ckdaka.sk',w-p,bot);
  ctx.textAlign='left';
  const priceFs=Math.round(h*.092);
  let curBot=bot-Math.round(h*.028*1.4);
  if(tourPrice(tour)){
    ctx.font=`bold ${priceFs}px Ubuntu,Arial`; ctx.fillStyle=C.green;
    ctx.textBaseline='bottom'; ts(ctx);
    ctx.fillText(tourPriceStr(tour),p,curBot); tc(ctx);
    curBot-=Math.round(priceFs*1.1);
  }
  if(tour.maxDiscount>0){
    const dfs=Math.round(h*.037);
    ctx.font=`${dfs}px Ubuntu,Arial`; ctx.fillStyle=C.greenLight;
    ctx.textBaseline='bottom'; ts(ctx);
    ctx.fillText(`Zľava ${tour.maxDiscount}%`,p,curBot); tc(ctx);
    curBot-=Math.round(dfs*1.35);
  }
  const nameFs=autoFit(ctx,tour.name,w*.62,2,Math.round(h*.042),Math.round(h*.082));
  const lh2=Math.round(nameFs*1.26);
  ctx.font=`bold ${nameFs}px Ubuntu,Arial`;
  const words2=tour.name.split(' '); let ln='',lns=[];
  for(const wd of words2){
    const t2=ln?ln+' '+wd:wd;
    if(ctx.measureText(t2).width>w*.62&&ln){lns.push(ln);if(lns.length>=2){lns[1]+='…';break;}ln=wd;}else ln=t2;
  }
  if(ln&&lns.length<2)lns.push(ln);
  ctx.fillStyle=C.white; ctx.textBaseline='bottom'; ts(ctx);
  for(let i=lns.length-1;i>=0;i--){
    ctx.fillText(lns[i],p,curBot-(lns.length-1-i)*lh2);
  }
  tc(ctx);
  curBot-=lns.length*lh2+Math.round(h*.012);
  const destFs=Math.round(h*.036);
  ctx.font=`500 ${destFs}px Ubuntu,Arial`; ctx.fillStyle=C.white;
  ctx.textBaseline='bottom'; ctx.globalAlpha=.85; ts(ctx);
  ctx.fillText(ellipsis(ctx,tour.dest.toUpperCase(),w*.62),p,curBot); tc(ctx); ctx.globalAlpha=1;
  const cw=Math.round(w*.155),ch=Math.round(h*.115);
  rr(ctx,w-p-cw,bot-ch,cw,ch,7,C.green);
  ctx.font=`bold ${Math.round(h*.046)}px Ubuntu,Arial`; ctx.fillStyle=C.white;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('Viac info ›',w-p-cw/2,bot-ch/2);
  ctx.textAlign='left';
}

// SQUARE / RECT: 300×250, 1080×1080
function drawSquare(ctx,w,h,tour,tImg,lImg){
  // Obraz: horných 52% – yFocus 0.55 = viac krajiny, menej oblohy
  const imgH=Math.round(h*.52);
  if(tImg){
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,w,imgH); ctx.clip();
    imgCover(ctx,tImg,0,0,w,imgH,0.55); ctx.restore();
    // Jemný gradient dolu pre plynulý prechod do panelu
    grad(ctx,0,imgH*0.65,w,imgH*0.35,'b','rgba(31,49,95,0)','rgba(31,49,95,.3)');
  } else {ctx.fillStyle=C.primaryLight;ctx.fillRect(0,0,w,imgH);}
  // Modrý panel
  ctx.fillStyle=C.primary; ctx.fillRect(0,imgH,w,h-imgH);
  ctx.fillStyle=C.green; ctx.fillRect(0,imgH,w,Math.max(3,Math.round(h*.005)));
  const p=Math.round(w*.05);
  // Logo: vpravo hore – presná rovnaká medzera zhora aj zprava
  const logoH=Math.round(imgH*.22);
  drawLogoTopRight(ctx,lImg,w,p,logoH);
  // Zľava badge: vľavo hore (aby nekonflikovalo s logom)
  if(tour.maxDiscount>0){
    const dbadgeFs=Math.round(w*.058);
    ctx.font=`bold ${dbadgeFs}px Ubuntu,Arial`;
    const dt=`-${tour.maxDiscount}%`;
    const dw2=ctx.measureText(dt).width+Math.round(p*.8);
    rr(ctx,p,p,dw2,Math.round(dbadgeFs*1.5),4,C.green);
    ctx.fillStyle=C.white; ctx.textBaseline='top'; ctx.textAlign='center';
    ctx.fillText(dt,p+dw2/2,p+Math.round(dbadgeFs*.2)); ctx.textAlign='left';
  }
  // ── Textový panel (od hora, fixné zóny) ──
  const panH=h-imgH;
  const pad2=Math.round(p*.9);
  // Destinácia
  const destFs=Math.round(panH*.125);
  let ty=imgH+Math.round(panH*.09);
  ctx.font=`300 ${destFs}px Ubuntu,Arial`; ctx.fillStyle=C.greenLight; ctx.textBaseline='top';
  ctx.fillText(ellipsis(ctx,tour.dest.toUpperCase(),w-p*2),p,ty); ty+=Math.round(destFs*1.35);
  // Názov – AUTO-FIT: čo najväčší font, 2 riadky
  const nameMaxH = panH - (ty-imgH) - Math.round(panH*.28);
  const maxNameFs = Math.round(panH*.18);
  const minNameFs = Math.max(8, Math.round(panH*.085));
  const nameFs = autoFit(ctx, tour.name, w-p*2, 2, minNameFs, maxNameFs);
  ctx.font=`bold ${nameFs}px Ubuntu,Arial`; ctx.fillStyle=C.white; ctx.textBaseline='top';
  const nl=wrap(ctx,tour.name,p,ty,w-p*2,Math.round(nameFs*1.22),2); ty+=nl+Math.round(panH*.04);
  // Cena – ak ostáva miesto
  if(tourPrice(tour) &&ty<h-Math.round(panH*.1)){
    const priceFs=Math.min(Math.round(panH*.20),Math.round((h-ty-pad2)*.80));
    ctx.font=`bold ${priceFs}px Ubuntu,Arial`; ctx.fillStyle=C.green; ctx.textBaseline='top';
    ctx.fillText(tourPriceStr(tour),p,ty);
  }
  ctx.font=`${Math.round(panH*.085)}px Ubuntu,Arial`; ctx.fillStyle='rgba(255,255,255,.32)';
  ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText('ckdaka.sk',w-p,h-pad2);
  ctx.textAlign='left';
}

// SKYSCRAPER: 160×600, 300×600
// SKYSCRAPER: 160×600, 300×600
// Pri 160px šírke sú fonty relatívne k výške, aby neboli príliš malé
function drawSkyscraper(ctx,w,h,tour,tImg,lImg){
  const imgH=Math.round(h*.46);
  if(tImg){
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,w,imgH); ctx.clip();
    imgCover(ctx,tImg,0,0,w,imgH,0.55);
    grad(ctx,0,Math.round(imgH*.55),w,Math.round(imgH*.45),'b','rgba(31,49,95,0)',C.primary);
    ctx.restore();
  } else {ctx.fillStyle=C.primaryLight;ctx.fillRect(0,0,w,imgH);}
  ctx.fillStyle=C.primary; ctx.fillRect(0,imgH,w,h-imgH);
  ctx.fillStyle=C.green; ctx.fillRect(0,imgH,w,Math.max(3,Math.round(h*.004)));

  const p=Math.round(w*.062);
  // Veľkosti fontov: max(w-relatívne, h-relatívne) – pri 160px preváži výška
  const logoH  = Math.max(Math.round(w*.16),  Math.round(h*.055));
  const destFs = Math.max(Math.round(w*.082), Math.round(h*.030));
  const ctaFs  = Math.max(Math.round(w*.080), Math.round(h*.030));
  const maxNFs = Math.max(Math.round(w*(w<200?.10:.095)), Math.round(h*.038));
  const minNFs = Math.max(8, Math.round(h*.020));
  const webFs  = Math.max(Math.round(w*.067), Math.round(h*.024));

  // Logo: vycentrované – presne na stred, rovnaká medzera z prava aj z ľava
  const logoY = imgH+Math.round(p*.85);
  drawLogoCentered(ctx,lImg,w,logoY,logoH);
  let ty=logoY+logoH+Math.round(p*.6);

  // Destinácia
  ctx.font=`300 ${destFs}px Ubuntu,Arial`; ctx.fillStyle=C.greenLight; ctx.textBaseline='top';
  ctx.fillText(ellipsis(ctx,tour.dest.toUpperCase(),w-p*2),p,ty); ty+=Math.round(destFs*1.3);

  // Rezervuj priestor zdola: web + cena + CTA + separator
  const ctaH    = Math.round(h*.068);
  const priceFs0= Math.max(Math.round(w*.130), Math.round(h*.055));
  const priceH  = tourPrice(tour) ? Math.round(priceFs0*1.3)+Math.round(p*.4) : 0;
  const webH    = Math.round(webFs*1.5);
  const sepH    = Math.round(p*.5)+2;
  const reserved= webH+priceH+ctaH+sepH+Math.round(p*1.5);

  // Názov: AUTO-FIT do zostávajúceho priestoru, max 3 riadky
  const nameMaxH = h - reserved - ty;
  const maxLines = 3;
  let nameFs = minNFs;
  for(let fs=maxNFs; fs>=minNFs; fs--){
    ctx.font=`bold ${fs}px Ubuntu,Arial`;
    const words=tour.name.split(' '); let lines=0, line='';
    for(const wd of words){
      const t2=line?line+' '+wd:wd;
      if(ctx.measureText(t2).width>w-p*2&&line){lines++;if(lines>=maxLines)break;line=wd;}else line=t2;
    }
    if(line)lines++;
    if(lines<=maxLines && lines*fs*1.25<=nameMaxH){nameFs=fs;break;}
  }
  ctx.font=`bold ${nameFs}px Ubuntu,Arial`; ctx.fillStyle=C.white; ctx.textBaseline='top';
  const nl2=wrap(ctx,tour.name,p,ty,w-p*2,Math.round(nameFs*1.25),maxLines);
  ty+=nl2+Math.round(p*.4);

  // Separator
  ctx.fillStyle='rgba(255,255,255,.18)'; ctx.fillRect(p,ty,w-p*2,1); ty+=Math.round(p*.5)+1;

  // CTA
  rr(ctx,p,ty,w-p*2,ctaH,ctaH/2,C.green);
  ctx.font=`bold ${ctaFs}px Ubuntu,Arial`; ctx.fillStyle=C.white;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('Viac info ›',w/2,ty+ctaH/2);
  ctx.textAlign='left'; ty+=ctaH+Math.round(p*.45);

  // Cena
  if(tourPrice(tour) &&ty<h-webH-p){
    const priceFs=Math.min(priceFs0,Math.round((h-ty-webH-p)*.80));
    ctx.font=`bold ${priceFs}px Ubuntu,Arial`; ctx.fillStyle=C.green;
    ctx.textBaseline='top'; ctx.textAlign='center';
    ctx.fillText(tourPriceStr(tour),w/2,ty);
    ctx.textAlign='left';
  }

  // Web
  ctx.font=`${webFs}px Ubuntu,Arial`; ctx.fillStyle='rgba(255,255,255,.33)';
  ctx.textAlign='center'; ctx.textBaseline='bottom'; ctx.fillText('ckdaka.sk',w/2,h-Math.round(p*.3));
  ctx.textAlign='left';
}

// STORY: 1080×1920
function drawStory(ctx,w,h,tour,tImg,lImg){
  if(tImg){imgCover(ctx,tImg,0,0,w,h);}
  else{ctx.fillStyle=C.primary;ctx.fillRect(0,0,w,h);}
  // Pregraduácia: top a bottom
  grad(ctx,0,0,w,h*.26,'t','rgba(20,32,72,.9)','rgba(0,0,0,0)');
  grad(ctx,0,h*.44,w,h*.56,'b','rgba(0,0,0,0)','rgba(15,25,55,.98)');
  const p=Math.round(w*.07);
  // ── TOP: logo centrovaný – presne na stred, rovnaká medzera z prava aj z ľava ──
  const logoH=Math.round(h*.07);
  drawLogoCentered(ctx,lImg,w,Math.round(p*.9),logoH);
  // ── BOTTOM: pevné sekcie od dna ──
  const bot=h-p;
  // Web (najnižšie)
  const webFs=Math.round(w*.032);
  ctx.font=`${webFs}px Ubuntu,Arial`; ctx.fillStyle='rgba(255,255,255,.4)';
  ctx.textAlign='right'; ctx.textBaseline='bottom'; ctx.fillText('ckdaka.sk',w-p,bot);
  ctx.textAlign='left';
  // Cena
  const priceBot=bot-Math.round(webFs*1.6);
  const priceFs=Math.round(w*.115);
  if(tourPrice(tour)){
    ctx.font=`bold ${priceFs}px Ubuntu,Arial`; ctx.fillStyle=C.green; ctx.textBaseline='bottom';
    ts(ctx); ctx.fillText(tourPriceStr(tour),p,priceBot); tc(ctx);
  }
  // Zľava
  const discBot=priceBot-(tourPrice(tour)?Math.round(priceFs*1.1):0);
  if(tour.maxDiscount>0){
    const dfs=Math.round(w*.05);
    ctx.font=`${dfs}px Ubuntu,Arial`; ctx.fillStyle=C.greenLight; ctx.textBaseline='bottom';
    ts(ctx); ctx.fillText(`Zľava ${tour.maxDiscount}%`,p,discBot); tc(ctx);
  }
  const discSpace=(tour.maxDiscount>0?Math.round(w*.06):0);
  // CTA
  const ctaH=Math.round(h*.06),ctaW=Math.round(w*.52);
  const ctaBot=discBot-discSpace-Math.round(h*.015);
  rr(ctx,p,ctaBot-ctaH,ctaW,ctaH,ctaH/2,C.green);
  ctx.font=`bold ${Math.round(w*.047)}px Ubuntu,Arial`; ctx.fillStyle=C.white;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('Viac info ›',p+ctaW/2,ctaBot-ctaH/2);
  ctx.textAlign='left';
  // Oddeľovač
  const sepY=ctaBot-ctaH-Math.round(h*.02);
  ctx.fillStyle=C.green; ctx.fillRect(p,sepY,w-p*2,2);
  // Destinácia
  const destFs=Math.round(w*.055);
  ctx.font=`300 ${destFs}px Ubuntu,Arial`; ctx.fillStyle=C.white; ctx.textBaseline='bottom';
  ctx.globalAlpha=.8; ts(ctx); ctx.fillText(ellipsis(ctx,tour.dest.toUpperCase(),w-p*2),p,sepY-Math.round(h*.01)); tc(ctx); ctx.globalAlpha=1;
  // Názov (max 3 riadky) – AUTO-FIT nad destináciou
  const nameBot=sepY-Math.round(h*.01)-Math.round(destFs*1.3);
  const nameAvailH = nameBot - Math.round(h*.3); // priestor nad logom je vyhradený
  const maxNameFs=Math.round(w*.080);
  const minNameFs=Math.max(10,Math.round(w*.038));
  const nameFs=autoFit(ctx,tour.name,w-p*2,3,minNameFs,maxNameFs);
  const nameLh=Math.round(nameFs*1.26);
  ctx.font=`bold ${nameFs}px Ubuntu,Arial`; ctx.fillStyle=C.white; ctx.textBaseline='bottom';
  const nwords=tour.name.split(' '); let nline='',nlines=[];
  for(const wd of nwords){
    const t3=nline?nline+' '+wd:wd;
    if(ctx.measureText(t3).width>w-p*2&&nline){nlines.push(nline);if(nlines.length>=3){nlines[2]+='…';break;}nline=wd;}else nline=t3;
  }
  if(nline&&nlines.length<3)nlines.push(nline);
  ts(ctx);
  for(let i=nlines.length-1;i>=0;i--){ctx.fillText(nlines[i],p,nameBot-(nlines.length-1-i)*nameLh);}
  tc(ctx);
}

// ════════════════════════════════════════════════════════
// ── SVETLÝ ŠTÝL – VLNKA ──
// ════════════════════════════════════════════════════════

// ── VLNKOVÁ CESTA: 3 symetrické vrcholy (sínusový vzor) ──
// d = šírka / 6 → jeden pol-cyklus. k=0.52 = bezier "sínusový" faktor.
// bot = úroveň údolia, top = úroveň vrcholu.
// clipPhotoWave MUSÍ byť presná reverzná cesta (segmenty odzadu, CP1↔CP2).
function wavePath(ctx, w, splitY, amp) {
  const d = w / 6, k = 0.52;
  const bot = splitY + amp * 0.3;   // úroveň údolia (mierne pod stredovou líniou)
  const top = splitY - amp;          // úroveň vrcholu (nad stredovou líniou)
  ctx.moveTo(0, bot);
  ctx.bezierCurveTo(d*k,       bot, d - d*k,   top, d,   top);  // Peak 1
  ctx.bezierCurveTo(d + d*k,   top, 2*d-d*k,   bot, 2*d, bot);  // Valley 1
  ctx.bezierCurveTo(2*d+d*k,   bot, 3*d-d*k,   top, 3*d, top);  // Peak 2
  ctx.bezierCurveTo(3*d+d*k,   top, 4*d-d*k,   bot, 4*d, bot);  // Valley 2
  ctx.bezierCurveTo(4*d+d*k,   bot, 5*d-d*k,   top, 5*d, top);  // Peak 3
  ctx.bezierCurveTo(5*d+d*k,   top, w - d*k,   bot,   w, bot);  // End
}

// Biely panel s trojvlnkovou hranou navrchu
function drawWhitePanel(ctx, w, h, splitY, amp) {
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  wavePath(ctx, w, splitY, amp);
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fill();
}

// Oreže fotografiu vlnkou – presná reverzná cesta
function clipPhotoWave(ctx, w, splitY, amp) {
  const d = w / 6, k = 0.52;
  const bot = splitY + amp * 0.3;
  const top = splitY - amp;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w, bot);
  ctx.bezierCurveTo(w - d*k,   bot, 5*d+d*k,  top, 5*d, top);  // Rev End
  ctx.bezierCurveTo(5*d-d*k,   top, 4*d+d*k,  bot, 4*d, bot);  // Rev Peak 3
  ctx.bezierCurveTo(4*d-d*k,   bot, 3*d+d*k,  top, 3*d, top);  // Rev Valley 2
  ctx.bezierCurveTo(3*d-d*k,   top, 2*d+d*k,  bot, 2*d, bot);  // Rev Peak 2
  ctx.bezierCurveTo(2*d-d*k,   bot, d + d*k,  top,   d, top);  // Rev Valley 1
  ctx.bezierCurveTo(d - d*k,   top, d*k,       bot,   0, bot);  // Rev Peak 1
  ctx.closePath(); ctx.clip();
}

// ── VERTIKÁLNA VLNKA (landscape): foto vľavo, biely panel vpravo ──
// Rovnaký vzor ako horizontálna, ale os x↔y vymenená.
function drawWhitePanelV(ctx, w, h, splitX, amp) {
  const d = h / 6, k = 0.52;
  const rig = splitX + amp * 0.3;  // úroveň údolia (vpravo od stredu)
  const lef = splitX - amp;         // úroveň vrcholu (vľavo, do foto)
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(rig, 0);
  ctx.bezierCurveTo(rig, d*k,       lef, d - d*k,   lef, d);    // Peak 1
  ctx.bezierCurveTo(lef, d + d*k,   rig, 2*d-d*k,   rig, 2*d);  // Valley 1
  ctx.bezierCurveTo(rig, 2*d+d*k,   lef, 3*d-d*k,   lef, 3*d);  // Peak 2
  ctx.bezierCurveTo(lef, 3*d+d*k,   rig, 4*d-d*k,   rig, 4*d);  // Valley 2
  ctx.bezierCurveTo(rig, 4*d+d*k,   lef, 5*d-d*k,   lef, 5*d);  // Peak 3
  ctx.bezierCurveTo(lef, 5*d+d*k,   rig, h - d*k,   rig, h);    // End
  ctx.lineTo(w, h); ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
}

function clipPhotoWaveV(ctx, w, h, splitX, amp) {
  const d = h / 6, k = 0.52;
  const rig = splitX + amp * 0.3;
  const lef = splitX - amp;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(rig, 0);
  // Rovnaká cesta ako drawWhitePanelV (tá istá smer = horný smer) + uzavretie vľavo
  ctx.bezierCurveTo(rig, d*k,       lef, d - d*k,   lef, d);
  ctx.bezierCurveTo(lef, d + d*k,   rig, 2*d-d*k,   rig, 2*d);
  ctx.bezierCurveTo(rig, 2*d+d*k,   lef, 3*d-d*k,   lef, 3*d);
  ctx.bezierCurveTo(lef, 3*d+d*k,   rig, 4*d-d*k,   rig, 4*d);
  ctx.bezierCurveTo(rig, 4*d+d*k,   lef, 5*d-d*k,   lef, 5*d);
  ctx.bezierCurveTo(lef, 5*d+d*k,   rig, h - d*k,   rig, h);
  ctx.lineTo(0, h); ctx.closePath(); ctx.clip();
}

// Cena: "už za  X,XX €  / N dní" – mix fontov na jednom riadku
function drawLightPrice(ctx, tour, x, baseY, bigFs, smFs, maxW) {
  maxW = maxW || 99999;
  ctx.textBaseline = 'bottom'; ctx.fillStyle = C.primary;

  const price = tourPrice(tour);
  if (!price) return 0;
  const priceStr = price % 1 === 0
    ? `${Math.round(price)} €`
    : `${price.toFixed(2).replace('.', ',')} €`;
  const prefix   = tourPricePrefix(tour);   // 'už za' alebo 'od'
  const daysStr  = tourDays(tour) > 0 ? `/ ${tourDays(tour)} dní` : '';

  ctx.font = `${smFs}px Ubuntu,Arial`;
  const uzaW  = ctx.measureText(prefix + ' ').width + smFs * 0.15;
  const daysW = daysStr ? ctx.measureText(' ' + daysStr).width + smFs * 0.2 : 0;
  ctx.font = `bold ${bigFs}px Ubuntu,Arial`;
  const priceW = ctx.measureText(priceStr).width;

  const fullW = uzaW + priceW + daysW;

  if (fullW <= maxW) {
    // Celá verzia: "už za/od X,XX € / N dní"
    ctx.font = `${smFs}px Ubuntu,Arial`;  ctx.fillText(prefix, x, baseY);
    ctx.font = `bold ${bigFs}px Ubuntu,Arial`; ctx.fillText(priceStr, x + uzaW, baseY);
    if (daysStr) { ctx.font = `${smFs}px Ubuntu,Arial`; ctx.fillText(daysStr, x + uzaW + priceW + smFs*0.2, baseY); }
  } else if (uzaW + priceW <= maxW) {
    // Bez "/ N dní"
    ctx.font = `${smFs}px Ubuntu,Arial`;  ctx.fillText(prefix, x, baseY);
    ctx.font = `bold ${bigFs}px Ubuntu,Arial`; ctx.fillText(priceStr, x + uzaW, baseY);
  } else {
    // Len cena – zmenšená ak treba
    let fs = bigFs;
    ctx.font = `bold ${fs}px Ubuntu,Arial`;
    while (fs > Math.max(smFs, 10) && ctx.measureText(priceStr).width > maxW) {
      fs -= 1; ctx.font = `bold ${fs}px Ubuntu,Arial`;
    }
    ctx.fillText(ellipsis(ctx, priceStr, maxW), x, baseY);
  }
  return bigFs * 1.35;
}

// Ikona pred dátumom. Prehliadač ju vykreslí systémovým emoji fontom; server
// musí mať emoji font registrovaný, inak by vznikol prázdny štvorec – preto si
// ho vie vypnúť cez setDateIcon('').
let DATE_ICON = '📅';
export function setDateIcon(icon) { DATE_ICON = icon || ''; }

// Dátum s ikonou
function drawLightDate(ctx, tour, x, y, fs, maxW) {
  const df = tourDateFrom(tour);
  if (!df) return;
  // "Noto Color Emoji" v zozname rodín – vďaka tomu vykreslí ikonu aj Skia na serveri
  ctx.font = `${fs}px Ubuntu,"Noto Color Emoji",Arial`; ctx.fillStyle = C.primary; ctx.textBaseline = 'top';
  const dt = tourDateTo(tour);
  const dateStr = dt ? `${formatDate(df)} – ${formatDate(dt)}` : formatDate(df);
  ctx.fillText(DATE_ICON ? `${DATE_ICON} ${dateStr}` : dateStr, x, y);
}

// ── Hlavná funkcia svetlého štýlu ──
// variant: 'wave' (default) | 'stamp'
function drawLight(ctx, w, h, tour, tImg, lImg, variant) {
  const r = w / h;
  const isStamp = (variant === 'stamp');
  if (r >= 4) {
    drawLightStrip(ctx, w, h, tour, tImg, lImg); // strip nemá vlnku ani znamku
  } else if (r >= 1.6) {
    isStamp ? drawLightStampLandscape(ctx, w, h, tour, tImg, lImg)
            : drawLightLandscape(ctx, w, h, tour, tImg, lImg);
  } else {
    isStamp ? drawLightStampPortrait(ctx, w, h, tour, tImg, lImg)
            : drawLightPortrait(ctx, w, h, tour, tImg, lImg);
  }
}

// ── PORTRAIT/STORY/SQUARE/SKYSCRAPER: foto hore, vlnka, biely panel dolu ──
function drawLightPortrait(ctx, w, h, tour, tImg, lImg) {
  const splitY = Math.round(h * 0.50);
  const amp    = Math.round(h * 0.036);   // amplitúda – 3 vlnky, jemnejší efekt
  const p      = Math.round(w * 0.055);

  // 1. Biely podklad
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,w,h);

  // 2. Fotografia s vlnkovým výrezom
  if (tImg) {
    ctx.save(); clipPhotoWave(ctx, w, splitY, amp);
    imgCover(ctx, tImg, 0, 0, w, splitY + amp*0.6, 0.48);
    ctx.restore();
  } else {
    ctx.save(); clipPhotoWave(ctx, w, splitY, amp);
    ctx.fillStyle = C.primary; ctx.fillRect(0,0,w,splitY+amp*1.2);
    ctx.restore();
  }

  // 3. Biely panel s vlnkou
  drawWhitePanel(ctx, w, h, splitY, amp);

  // 4. Logo: vpravo hore – presná rovnaká medzera zhora aj zprava
  const logoH = Math.round(h * (h > 900 ? 0.072 : 0.115));
  drawLogoTopRight(ctx, lImg, w, p, logoH);

  // 5. Texty v bielom paneli
  const tp    = Math.round(w * 0.07);
  const maxW  = w - tp*2;
  const lhBar = Math.max(3, Math.round(h * 0.006)); // zelená spodná lišta
  // ty začína tesne pod dolinou vlnky (splitY + amp*0.3) + malý padding
  let ty = Math.round(splitY + amp*0.3 + h*0.025);

  // Dostupný priestor od ty až po spodnú líštu
  const bottomY = h - lhBar - Math.round(h * 0.012);

  // Názov zájazdu – fonty obmedzené aj šírkou (pri 160px canvas)
  const nameLines  = w < 220 ? 4 : 3;
  const maxNameFs  = Math.min(
    Math.round(h * (h > 900 ? 0.072 : 0.092)),
    Math.round(w * 0.17)   // pri 160px → max 27px, pri 300px → 51px
  );
  const minNameFs  = Math.max(10, Math.round(Math.min(h * 0.028, w * 0.11)));
  const nameFs     = autoFit(ctx, tour.name, maxW, nameLines, minNameFs, maxNameFs);
  const nameLh     = Math.round(nameFs * 1.22);
  ctx.font         = `bold ${nameFs}px Ubuntu,Arial`;
  ctx.fillStyle    = C.green; ctx.textBaseline = 'top';
  const nlH        = wrap(ctx, tour.name, tp, ty, maxW, nameLh, nameLines);
  ty += nlH + Math.round(h * 0.022);

  // Cena – obmedzená aj šírkou
  const bigFs = Math.min(
    Math.round(h * (h > 900 ? 0.056 : 0.072)),
    Math.round(w * 0.145)  // pri 160px → max 23px
  );
  const smFs  = Math.min(
    Math.round(h * (h > 900 ? 0.027 : 0.034)),
    Math.round(w * 0.09)
  );
  if(tourPrice(tour) && ty + bigFs < bottomY) {
    ty += drawLightPrice(ctx, tour, tp, ty + bigFs, bigFs, smFs, maxW);
  }

  // Dátum – obmedzený aj šírkou
  const dFs = Math.min(
    Math.round(h * (h > 900 ? 0.026 : 0.032)),
    Math.round(w * 0.082)
  );
  if (tourDateFrom(tour) && ty + dFs*1.4 < bottomY) {
    drawLightDate(ctx, tour, tp, ty, dFs, maxW);
  }

  // Zelená čiara dolu
  ctx.fillStyle = C.green; ctx.fillRect(0, h - lhBar, w, lhBar);
}

// ── LANDSCAPE/HORIZONTAL: foto vľavo, vlnka, biely panel vpravo ──
function drawLightLandscape(ctx, w, h, tour, tImg, lImg) {
  const splitX = Math.round(w * 0.50);
  const amp    = Math.round(h * 0.08);   // amplitúda relatívna k výške – 3 vlnky
  const p      = Math.round(h * 0.09);
  const tp     = Math.round(h * 0.10);

  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,w,h);

  if (tImg) {
    ctx.save(); clipPhotoWaveV(ctx, w, h, splitX, amp);
    imgCover(ctx, tImg, 0, 0, splitX + amp*0.6, h, 0.5);
    ctx.restore();
  } else {
    ctx.save(); clipPhotoWaveV(ctx, w, h, splitX, amp);
    ctx.fillStyle = C.primary; ctx.fillRect(0,0,splitX+amp*0.6,h);
    ctx.restore();
  }
  drawWhitePanelV(ctx, w, h, splitX, amp);

  // Logo: vpravo hore v oblasti fotky – presná rovnaká medzera zhora aj od vlnky
  const logoH = Math.round(h * 0.22);
  drawLogoTopRightInPhoto(ctx, lImg, splitX, p, logoH);

  // Texty vpravo – tx začína za dolinou vlnky (splitX + amp*0.3 + padding)
  const tx   = Math.round(splitX + amp*0.3 + w*0.018);
  const maxW = w - tx - p;
  let ty     = Math.round(h * 0.10);
  const lh   = Math.max(3, Math.round(h * 0.012));
  const bottomY = h - lh - Math.round(h * 0.02);

  const maxNameFs = Math.round(h * 0.175);
  const minNameFs = Math.max(9, Math.round(h * 0.07));
  const nameFs    = autoFit(ctx, tour.name, maxW, 2, minNameFs, maxNameFs);
  const nameLh    = Math.round(nameFs * 1.22);
  ctx.font        = `bold ${nameFs}px Ubuntu,Arial`;
  ctx.fillStyle   = C.green; ctx.textBaseline = 'top';
  const nlH       = wrap(ctx, tour.name, tx, ty, maxW, nameLh, 2);
  ty += nlH + Math.round(h * 0.05);

  const bigFs = Math.round(h * 0.13);
  const smFs  = Math.round(h * 0.065);
  if(tourPrice(tour) && ty + bigFs < bottomY) {
    ty += drawLightPrice(ctx, tour, tx, ty + bigFs, bigFs, smFs, maxW);
  }
  const dFs = Math.round(h * 0.065);
  if (tourDateFrom(tour) && ty + dFs*1.4 < bottomY) {
    drawLightDate(ctx, tour, tx, ty, dFs, maxW);
  }

  ctx.fillStyle = C.green; ctx.fillRect(0, h - lh, w, lh);
}

// ── STRIP: svetlý bez vlnky (príliš úzky) ──
function drawLightStrip(ctx, w, h, tour, tImg, lImg) {
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,w,h);
  const p = Math.max(3, Math.round(h*.1));
  // Foto vľavo
  const imgW = Math.round(w*0.28);
  if (tImg) {
    ctx.save(); ctx.beginPath(); ctx.rect(0,0,imgW,h); ctx.clip();
    imgCover(ctx,tImg,0,0,imgW,h,0.5); ctx.restore();
    grad(ctx,imgW*.4,0,imgW*.6,h,'r','rgba(255,255,255,0)','rgba(255,255,255,1)');
  }
  // Tenká zelená čiara vľavo
  ctx.fillStyle=C.green; ctx.fillRect(0,0,3,h);
  // Logo
  const logoH=Math.round(h*.64);
  const lx = imgW + p;
  const actualLogoW = drawLogo(ctx,lImg,lx,Math.round((h-logoH)/2),Math.round(w*.2),logoH);
  const textX = lx + actualLogoW + Math.round(p*.9);
  // Cena
  let priceRight = w - p;
  if (tourPrice(tour)) {
    const pfs = Math.max(7, Math.round(h*.28));
    ctx.font = `bold ${pfs}px Ubuntu,Arial`; ctx.fillStyle = C.green;
    const ps = tourPriceStr(tour);
    const pw = ctx.measureText(ps).width;
    const bpad = Math.round(p*.6);
    const bh = Math.round(h*.58), by = Math.round((h-bh)/2);
    const bx = priceRight - pw - bpad*2;
    if (bx > textX+16) {
      rr(ctx,bx-bpad,by,pw+bpad*2,bh,4,C.green);
      ctx.fillStyle=C.white; ctx.textBaseline='middle'; ctx.fillText(ps,bx,h/2);
      priceRight = bx - bpad - p;
    }
  }
  const maxTxtW = priceRight - textX - p;
  if (maxTxtW > 20) {
    const {fs,t} = fitLine(ctx,tour.name,maxTxtW,Math.max(7,Math.round(h*.14)),Math.round(h*.36),'600');
    ctx.font=`600 ${fs}px Ubuntu,Arial`; ctx.fillStyle=C.primary; ctx.textBaseline='middle';
    ctx.fillText(t,textX,h/2);
  }
  ctx.fillStyle=C.green; ctx.fillRect(0,h-2,w,2);
}

// ════════════════════════════════════════════════════════
// ── SVETLÝ ŠTÝL – ZNAMKA (poštová perforácia) ──
// ════════════════════════════════════════════════════════

// Horizontálna perforácia (rad krúžkov) – biele kruhy presekávajú hranicu foto/panel
function drawStampDivider(ctx, w, splitY, dotR) {
  const step = Math.round(dotR * 2.6);
  const cnt  = Math.ceil(w / step) + 1;
  const sx   = (w - (cnt - 1) * step) / 2;
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < cnt; i++) {
    ctx.beginPath(); ctx.arc(sx + i * step, splitY, dotR, 0, Math.PI * 2); ctx.fill();
  }
}

// Vertikálna perforácia (stĺpec krúžkov)
function drawStampDividerV(ctx, h, splitX, dotR) {
  const step = Math.round(dotR * 2.6);
  const cnt  = Math.ceil(h / step) + 1;
  const sy   = (h - (cnt - 1) * step) / 2;
  ctx.fillStyle = '#FFFFFF';
  for (let i = 0; i < cnt; i++) {
    ctx.beginPath(); ctx.arc(splitX, sy + i * step, dotR, 0, Math.PI * 2); ctx.fill();
  }
}

// ZNAMKA PORTRAIT: foto hore (obdĺžnik), perforácia, biely panel dolu
function drawLightStampPortrait(ctx, w, h, tour, tImg, lImg) {
  const splitY = Math.round(h * 0.50);
  const dotR   = Math.max(4, Math.round(Math.min(w, h) * 0.016));
  const p      = Math.round(w * 0.055);

  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);

  if (tImg) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, splitY + dotR); ctx.clip();
    imgCover(ctx, tImg, 0, 0, w, splitY + dotR, 0.48); ctx.restore();
  } else {
    ctx.fillStyle = C.primary; ctx.fillRect(0, 0, w, splitY);
  }

  // Biely panel dolu (tvrdá hrana, krúžky ju prepíšu)
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, splitY, w, h - splitY);

  // Perforácia (biele krúžky na hranici)
  drawStampDivider(ctx, w, splitY, dotR);

  // Perforácia na všetkých 4 okrajoch (efekt poštovej znamky)
  drawStampDivider(ctx, w, 0, dotR);    // horný okraj
  drawStampDivider(ctx, w, h, dotR);    // dolný okraj
  drawStampDividerV(ctx, h, 0, dotR);   // ľavý okraj
  drawStampDividerV(ctx, h, w, dotR);   // pravý okraj

  // Logo: vpravo hore – presná rovnaká medzera zhora aj zprava
  const logoH = Math.round(h * (h > 900 ? 0.072 : 0.115));
  drawLogoTopRight(ctx, lImg, w, p, logoH);

  // Text v bielom paneli
  const tp = Math.round(w * 0.07), maxW = w - tp * 2;
  let ty   = splitY + dotR + Math.round(h * 0.042);
  const lh = Math.max(3, Math.round(h * 0.006));
  const bottomY = h - lh - Math.round(h * 0.015);

  const nameLines2 = w < 220 ? 4 : 3;
  const maxNameFs  = Math.min(
    Math.round(h * (h > 900 ? 0.072 : 0.092)),
    Math.round(w * 0.17)
  );
  const minNameFs  = Math.max(10, Math.round(Math.min(h * 0.028, w * 0.11)));
  const nameFs     = autoFit(ctx, tour.name, maxW, nameLines2, minNameFs, maxNameFs);
  ctx.font = `bold ${nameFs}px Ubuntu,Arial`; ctx.fillStyle = C.green; ctx.textBaseline = 'top';
  const nlH = wrap(ctx, tour.name, tp, ty, maxW, Math.round(nameFs * 1.22), nameLines2);
  ty += nlH + Math.round(h * 0.025);

  const bFs  = Math.min(Math.round(h * (h > 900 ? 0.056 : 0.072)), Math.round(w * 0.145));
  const bSfs = Math.min(Math.round(h * (h > 900 ? 0.027 : 0.034)), Math.round(w * 0.09));
  if(tourPrice(tour) && ty + bFs < bottomY) {
    ty += drawLightPrice(ctx, tour, tp, ty + bFs, bFs, bSfs, maxW);
  }
  const dFs2 = Math.min(Math.round(h * (h > 900 ? 0.026 : 0.032)), Math.round(w * 0.082));
  if (tourDateFrom(tour) && ty + dFs2 * 1.4 < bottomY) {
    drawLightDate(ctx, tour, tp, ty, dFs2, maxW);
  }

  ctx.fillStyle = C.green; ctx.fillRect(0, h - lh, w, lh);
  // Tenký rám (vizuálny dojem znamky)
  ctx.strokeStyle = 'rgba(31,49,95,.14)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

// ZNAMKA LANDSCAPE: foto vľavo (obdĺžnik), perforácia, biely panel vpravo
function drawLightStampLandscape(ctx, w, h, tour, tImg, lImg) {
  const splitX = Math.round(w * 0.50);
  const dotR   = Math.max(4, Math.round(Math.min(w, h) * 0.016));
  const p      = Math.round(h * 0.09);

  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);

  if (tImg) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, splitX + dotR, h); ctx.clip();
    imgCover(ctx, tImg, 0, 0, splitX + dotR, h, 0.5); ctx.restore();
  } else {
    ctx.fillStyle = C.primary; ctx.fillRect(0, 0, splitX, h);
  }
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(splitX, 0, w - splitX, h);
  drawStampDividerV(ctx, h, splitX, dotR);

  // Perforácia na všetkých 4 okrajoch (efekt poštovej znamky)
  drawStampDivider(ctx, w, 0, dotR);    // horný okraj
  drawStampDivider(ctx, w, h, dotR);    // dolný okraj
  drawStampDividerV(ctx, h, 0, dotR);   // ľavý okraj
  drawStampDividerV(ctx, h, w, dotR);   // pravý okraj

  // Logo na foto: vpravo hore – presná rovnaká medzera zhora aj od vlnky
  const logoH = Math.round(h * 0.22);
  drawLogoTopRightInPhoto(ctx, lImg, splitX, p, logoH);

  // Text: pravý panel
  const tx = splitX + dotR + Math.round(w * 0.025);
  const maxW = w - tx - p;
  const lh = Math.max(3, Math.round(h * 0.012));
  const bottomY = h - lh - Math.round(h * 0.02);
  let ty = Math.round(h * 0.10);

  const maxNameFs = Math.round(h * 0.175), minNameFs = Math.max(9, Math.round(h * 0.07));
  const nameFs    = autoFit(ctx, tour.name, maxW, 2, minNameFs, maxNameFs);
  ctx.font = `bold ${nameFs}px Ubuntu,Arial`; ctx.fillStyle = C.green; ctx.textBaseline = 'top';
  const nlH = wrap(ctx, tour.name, tx, ty, maxW, Math.round(nameFs * 1.22), 2);
  ty += nlH + Math.round(h * 0.06);

  const bFs = Math.round(h * 0.13);
  if(tourPrice(tour) && ty + bFs < bottomY) {
    ty += drawLightPrice(ctx, tour, tx, ty + bFs, bFs, Math.round(h * 0.065), maxW);
  }
  const dFs3 = Math.round(h * 0.065);
  if (tourDateFrom(tour) && ty + dFs3 * 1.4 < bottomY) {
    drawLightDate(ctx, tour, tx, ty, dFs3, maxW);
  }

  ctx.fillStyle = C.green; ctx.fillRect(0, h - lh, w, lh);
  ctx.strokeStyle = 'rgba(31,49,95,.14)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

