#!/usr/bin/env node
/**
 * Nahratie vygenerovaných bannerov do reklamného účtu.
 *
 * Podporované ciele: Google Ads (knižnica podkladov) a Meta (knižnica
 * obrázkov reklamného účtu). Nahrávajú sa len podklady – zostavenie reklám
 * a kampaní zostáva na človeku.
 *
 * Predvolene beží nasucho: vypíše, čo by nahral, a neodošle nič.
 * Skutočné nahratie treba potvrdiť prepínačom --confirm.
 *
 * Nahráva sa len to, čo sa naozaj zmenilo – stav si pamätá hash obsahu
 * každého podkladu, takže druhý beh bez zmeny cien neurobí ani jedno
 * volanie API.
 *
 *   node upload.js --platform "Google Ads" --limit 20            # nasucho
 *   node upload.js --platform "Google Ads" --limit 20 --confirm  # naostro
 *   node upload.js --target meta --sizes 1080x1080 --confirm
 *   node upload.js --list                                        # čo už je v účte
 */
import path from 'node:path';

import { config, slugify } from './config.js';
import { getFeed } from './feed-store.js';
import { renderBanner } from './render.js';
import { registerFonts } from './fonts.js';
import { FORMATS, allSizes, sizeFromKey, STYLES } from '../shared/formats.js';
import { GoogleAdsClient, credentialsFromEnv } from './upload/google-ads.js';
import { MetaAdsClient, metaCredentialsFromEnv } from './upload/meta.js';
import { UploadState, contentHash } from './upload/state.js';

export const TARGETS = {
  'google-ads': {
    label: 'Google Ads',
    create: () => new GoogleAdsClient(credentialsFromEnv()),
    upload: async (client, { buffer, name }) => {
      const res = await client.uploadImageAsset({ buffer, name });
      return { ref: res.resourceName, note: res.duplicate ? 'už existoval' : '' };
    },
    list: (client) => client.listImageAssets(),
    describe: (a) => `${a.name}  ${a.resourceName}`,
  },
  'meta': {
    label: 'Meta (Facebook / Instagram)',
    create: () => new MetaAdsClient(metaCredentialsFromEnv()),
    upload: async (client, { buffer, name }) => {
      const res = await client.uploadImage({ buffer, name });
      return { ref: res.hash, note: '' };
    },
    list: (client) => client.listImages(),
    describe: (a) => `${a.name || '(bez názvu)'}  ${a.hash}`,
  },
};

const HELP = `
Nahratie bannerov do reklamného účtu

  --target <cieľ>       ${Object.keys(TARGETS).join(' | ')} (predvolene google-ads)
  --confirm             skutočne nahrať (bez neho beží nasucho)
  --list                vypísať obrázky, ktoré už v účte sú
  --platform <názov>    rozmery jednej platformy: ${Object.keys(FORMATS).join(', ')}
  --sizes <zoznam>      napr. 300x250,1200x628
  --style <štýl>        ${STYLES.join(' | ')} (predvolene ${config.defaultStyle})
  --terms <n>           koľko najbližších termínov na zájazd (predvolene 1)
  --limit <n>           najviac n zájazdov
  --codes <zoznam>      len konkrétne kódy zájazdov
  --min-discount <n>    len zájazdy so zľavou aspoň n %
  --state <súbor>       kde si pamätať nahraté (predvolene <CACHE_DIR>/upload-state.json)
  --help

Prihlasovacie údaje sa čítajú z env premenných:
  Google Ads  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
              GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CUSTOMER_ID,
              GOOGLE_ADS_LOGIN_CUSTOMER_ID (pri správe cez MCC)
  Meta        META_ACCESS_TOKEN, META_AD_ACCOUNT_ID
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = val;
  }
  return args;
}

function resolveSizes(args) {
  if (args.platform) {
    const fmts = FORMATS[args.platform];
    if (!fmts) throw new Error(`Neznáma platforma "${args.platform}". Možnosti: ${Object.keys(FORMATS).join(', ')}`);
    return fmts.map(f => ({ w: f.w, h: f.h, key: `${f.w}x${f.h}` }));
  }
  if (args.sizes) {
    return args.sizes.split(',').map(s => {
      const size = sizeFromKey(s.trim());
      if (!size) throw new Error(`Neznámy rozmer "${s.trim()}"`);
      return size;
    });
  }
  return allSizes();
}

/** Názov podkladu v účte – musí byť jedinečný a čitateľný pre človeka. */
export function assetName({ code, term, w, h, style }) {
  return ['DAKA', code, term ? term.replace(/-/g, '') : 'min', `${w}x${h}`, slugify(style)]
    .filter(Boolean).join('_');
}

/** Zoznam podkladov na spracovanie – rovnaké filtre ako generate.js. */
export function planUploads(tours, { sizes, style, terms, today }) {
  const plan = [];
  for (const tour of tours) {
    const upcoming = (tour.terms || [])
      .filter(t => t.dateFrom >= today)
      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
      .slice(0, terms);
    const variants = upcoming.length ? upcoming : [null];

    for (const term of variants) {
      for (const size of sizes) {
        plan.push({
          tour,
          term: term?.dateFrom || null,
          w: size.w, h: size.h, style,
          name: assetName({ code: tour.id, term: term?.dateFrom, w: size.w, h: size.h, style }),
        });
      }
    }
  }
  return plan;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const confirm = args.confirm === 'true' || args.confirm === true;
  const stateFile = args.state || path.join(config.cacheDir, 'upload-state.json');

  const targetKey = args.target || 'google-ads';
  const target = TARGETS[targetKey];
  if (!target) throw new Error(`Neznámy cieľ "${targetKey}". Možnosti: ${Object.keys(TARGETS).join(', ')}`);

  if (args.list) {
    const assets = await target.list(target.create());
    console.log(`[upload] ${target.label}: v účte je ${assets.length} obrázkov`);
    for (const a of assets.slice(0, 50)) console.log(`  ${target.describe(a)}`);
    if (assets.length > 50) console.log(`  … a ďalších ${assets.length - 50}`);
    return;
  }

  const style   = args.style || config.defaultStyle;
  const terms   = Math.max(1, Number(args.terms) || 1);
  const minDisc = Number(args['min-discount']) || 0;
  const codes   = args.codes ? new Set(args.codes.split(',').map(s => s.trim())) : null;
  if (!STYLES.includes(style)) throw new Error(`Neznámy štýl "${style}". Možnosti: ${STYLES.join(', ')}`);

  const sizes = resolveSizes(args);
  registerFonts();

  // Prihlasovacie údaje overíme skôr, než začneme renderovať – nemá zmysel
  // kresliť stovky bannerov a až potom zistiť, že chýba token.
  const client = confirm ? target.create() : null;

  const feed = await getFeed({ force: true });
  const today = new Date().toISOString().slice(0, 10);

  let tours = feed.tours
    .filter(t => !codes || codes.has(t.id))
    .filter(t => t.maxDiscount >= minDisc)
    .filter(t => !(t.terms?.length) || t.terms.some(x => x.dateFrom >= today));
  if (args.limit) tours = tours.slice(0, Number(args.limit));

  const plan = planUploads(tours, { sizes, style, terms, today });
  const state = await new UploadState(stateFile, targetKey).load();

  console.log(`[upload] cieľ: ${target.label}`);
  console.log(`[upload] ${confirm ? 'NAOSTRO' : 'NASUCHO (bez --confirm sa nič neodošle)'}`);
  console.log(`[upload] ${plan.length} podkladov na kontrolu, stav: ${state.stats().count} už nahratých`);

  let uploaded = 0, skipped = 0, failed = 0, wouldUpload = 0;

  for (const item of plan) {
    let buffer;
    try {
      const out = await renderBanner({
        tour: item.tour, w: item.w, h: item.h, style: item.style,
        ext: 'png', term: item.term, feedVersion: feed.version,
      });
      buffer = out.buffer;
    } catch (err) {
      failed++;
      console.error(`[upload] render zlyhal ${item.name}: ${err.message}`);
      continue;
    }

    const hash = contentHash(buffer);
    if (state.isUploaded(item.name, hash)) { skipped++; continue; }

    if (!confirm) {
      wouldUpload++;
      console.log(`  + ${item.name}  ${item.w}×${item.h}  ${(buffer.length / 1024).toFixed(0)} kB  ${hash}`);
      continue;
    }

    try {
      const res = await target.upload(client, { buffer, name: item.name });
      state.record(item.name, {
        hash,
        ref: res.ref,
        name: item.name,
        meta: { code: item.tour.id, term: item.term, size: `${item.w}x${item.h}`, style: item.style },
      });
      uploaded++;
      console.log(`  ✓ ${item.name} → ${res.ref}${res.note ? ` (${res.note})` : ''}`);
      // Stav ukladáme priebežne, aby prerušený beh neprišiel o hotovú prácu
      if (uploaded % 10 === 0) await state.save();
    } catch (err) {
      failed++;
      console.error(`  ✗ ${item.name}: ${err.message}`);
    }
  }

  if (confirm) await state.save();

  const stale = state.staleKeys(plan.map(p => p.name));
  console.log(
    confirm
      ? `[upload] hotovo: ${uploaded} nahratých, ${skipped} bez zmeny${failed ? `, ${failed} chýb` : ''}`
      : `[upload] nasucho: ${wouldUpload} by sa nahralo, ${skipped} bez zmeny${failed ? `, ${failed} chýb` : ''}`
  );
  if (stale.length) {
    console.log(`[upload] ${stale.length} podkladov v stave už nie je v aktuálnej dávke ` +
                `(prebehnuté termíny) – v účte ostávajú, zmazať ich treba ručne`);
  }
  if (failed) process.exitCode = 1;
}

// Spustenie len pri priamom volaní (testy importujú pomocné funkcie)
if (process.argv[1] && process.argv[1].endsWith('upload.js')) {
  main().catch(err => {
    console.error(`[upload] chyba: ${err.message}`);
    process.exitCode = 1;
  });
}
