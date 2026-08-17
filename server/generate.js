#!/usr/bin/env node
/**
 * Dávkové generovanie bannerov do priečinka – bez prehliadača, bez klikania.
 *
 * Použitie:
 *   node generate.js --out ../dist --limit 30 --style dark --sizes 300x250,1200x628
 *   node generate.js --platform "Google Ads" --terms 2
 *
 * Vedľa obrázkov vznikne manifest.json so zoznamom, čo sa vygenerovalo –
 * z neho bude čerpať budúci nahrávač do reklamných platforiem (fáza 2).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { getFeed } from './feed-store.js';
import { renderBanner } from './render.js';
import { registerFonts } from './fonts.js';
import { FORMATS, allSizes, sizeFromKey, STYLES } from '../shared/formats.js';
import { nextTerm } from '../shared/tour.js';
import { slugify } from './config.js';

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

const HELP = `
Dávkové generovanie bannerov CK DAKA

  --out <priečinok>     kam uložiť (predvolene ./out)
  --limit <n>           najviac n zájazdov (predvolene všetky)
  --style <štýl>        ${STYLES.join(' | ')} (predvolene ${config.defaultStyle})
  --sizes <zoznam>      napr. 300x250,728x90 (predvolene všetky)
  --platform <názov>    rozmery jednej platformy: ${Object.keys(FORMATS).join(', ')}
  --ext <jpg|png|webp>  formát súboru (predvolene ${config.defaultExt})
  --terms <n>           koľko najbližších termínov na zájazd (predvolene 1)
  --min-discount <n>    len zájazdy so zľavou aspoň n %
  --codes <zoznam>      len konkrétne kódy zájazdov, oddelené čiarkou
  --help                tento výpis
`;

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const outDir  = path.resolve(args.out || './out');
  const style   = args.style || config.defaultStyle;
  const ext     = args.ext || config.defaultExt;
  const terms   = Math.max(1, Number(args.terms) || 1);
  const minDisc = Number(args['min-discount']) || 0;
  const codes   = args.codes ? new Set(args.codes.split(',').map(s => s.trim())) : null;

  if (!STYLES.includes(style)) throw new Error(`Neznámy štýl "${style}". Možnosti: ${STYLES.join(', ')}`);

  const sizes = resolveSizes(args);
  registerFonts();

  console.log(`[generate] sťahujem feed ${config.feedUrl}`);
  const feed = await getFeed({ force: true });

  const today = new Date().toISOString().slice(0, 10);
  let tours = feed.tours
    .filter(t => !codes || codes.has(t.id))
    .filter(t => t.maxDiscount >= minDisc)
    .filter(t => !(t.terms?.length) || t.terms.some(x => x.dateFrom >= today));

  if (args.limit) tours = tours.slice(0, Number(args.limit));

  console.log(`[generate] ${tours.length} zájazdov × ${sizes.length} rozmerov × ${terms} termín(y) → ${tours.length * sizes.length * terms} bannerov`);
  await fs.mkdir(outDir, { recursive: true });

  const manifest = [];
  let done = 0, failed = 0;

  for (const tour of tours) {
    const upcoming = (tour.terms || [])
      .filter(t => t.dateFrom >= today)
      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))
      .slice(0, terms);
    const variants = upcoming.length ? upcoming : [nextTerm(tour) || null];

    for (const term of variants) {
      for (const size of sizes) {
        const suffix = term ? `_${term.dateFrom.replace(/-/g, '')}` : '';
        const name = `DAKA_${tour.id}${suffix}_${size.w}x${size.h}_${slugify(style)}.${ext}`;
        try {
          const out = await renderBanner({
            tour, w: size.w, h: size.h, style, ext,
            term: term?.dateFrom || null, feedVersion: feed.version,
          });
          await fs.writeFile(path.join(outDir, name), out.buffer);
          manifest.push({
            file: name, code: tour.id, name: tour.name,
            width: size.w, height: size.h, style,
            term: term?.dateFrom || null,
            price: term?.price ?? tour.minPrice,
            discount: tour.maxDiscount, bytes: out.buffer.length,
          });
          done++;
          if (done % 25 === 0) console.log(`[generate] ${done} hotových…`);
        } catch (err) {
          failed++;
          console.error(`[generate] ${name}: ${err.message}`);
        }
      }
    }
  }

  await fs.writeFile(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      feedVersion: feed.version,
      style, ext, count: manifest.length, banners: manifest,
    }, null, 2)
  );

  console.log(`[generate] hotovo: ${done} bannerov v ${outDir}${failed ? `, ${failed} chýb` : ''}`);
}

main().catch(err => {
  console.error(`[generate] chyba: ${err.message}`);
  process.exitCode = 1;
});
