#!/usr/bin/env node
/**
 * Synchronizačný beh – to, čo sa má diať samo, bez klikania.
 *
 * Jeden cyklus:
 *   1. stiahne feed a porovná ho s odtlačkom z minulého behu
 *   2. pre zmenené zájazdy pregeneruje bannery (naplní cache, aby platforma
 *      pri sťahovaní nečakala na kreslenie)
 *   3. voliteľne nahrá zmenené podklady do reklamných účtov
 *   4. zapíše správu o behu a nový odtlačok
 *
 * Nahrávanie je vypnuté, kým sa výslovne nezapne (--upload + --confirm).
 * Bez nich beh iba pripraví obrázky – feedy si platformy sťahujú samy.
 *
 *   node sync.js                                   # jeden cyklus, len príprava
 *   node sync.js --watch --interval 360            # každých 6 hodín
 *   node sync.js --upload google-ads,meta --confirm
 */
import path from 'node:path';
import fs from 'node:fs/promises';

import { config } from './config.js';
import { getFeed } from './feed-store.js';
import { renderBanner } from './render.js';
import { registerFonts } from './fonts.js';
import { FEED_SIZES } from './feeds/items.js';
import { TARGETS } from './upload.js';
import { UploadState, contentHash } from './upload/state.js';
import { snapshotOf, diffSnapshots, readSnapshot, writeSnapshot, summarize } from './sync/snapshot.js';

const HELP = `
Synchronizačný beh generátora bannerov

  --watch               po dokončení počkať a spustiť znova
  --interval <minúty>   perióda pri --watch (predvolene 360 = 6 hodín)
  --upload <ciele>      nahrať aj do účtov: ${Object.keys(TARGETS).join(',')} (čiarkou)
  --confirm             bez neho sa do účtov nič neodošle
  --style <štýl>        štýl bannerov (predvolene ${config.defaultStyle})
  --all                 pregenerovať všetko, nielen zmenené
  --limit <n>           najviac n zájazdov
  --help

Bez --upload beh len pripraví obrázky do cache. Feedy si platformy sťahujú
samy, takže na dynamické kampane to stačí.
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

/**
 * Jeden cyklus synchronizácie.
 * @returns {Promise<object>} správa o behu
 */
export async function runOnce({
  style = config.defaultStyle,
  uploadTargets = [],
  confirm = false,
  all = false,
  limit = 0,
  snapshotFile = path.join(config.cacheDir, 'feed-snapshot.json'),
  stateFile = path.join(config.cacheDir, 'upload-state.json'),
  log = console.log,
} = {}) {
  const startedAt = new Date();
  registerFonts();

  const feed = await getFeed({ force: true });
  const today = startedAt.toISOString().slice(0, 10);

  const prev = await readSnapshot(snapshotFile);
  const next = snapshotOf(feed.tours, { version: feed.version, from: today });
  const diff = diffSnapshots(prev, next);
  log(`[sync] feed ${feed.version}: ${feed.tours.length} zájazdov – ${summarize(diff)}`);

  // Ktoré zájazdy spracovať
  const affected = new Set(diff.affected);
  let scope = all ? feed.tours : feed.tours.filter(t => affected.has(t.id));
  if (limit) scope = scope.slice(0, limit);

  const sizes = Object.values(FEED_SIZES);
  const report = {
    startedAt: startedAt.toISOString(),
    feedVersion: feed.version,
    tours: feed.tours.length,
    changes: {
      added: diff.added.length,
      removed: diff.removed.length,
      priceChanged: diff.priceChanged.length,
      termChanged: diff.termChanged.length,
      discountChanged: diff.discountChanged.length,
    },
    rendered: 0, renderFailed: 0,
    uploaded: {}, uploadFailed: {},
    style,
  };

  if (!scope.length) {
    log('[sync] niet čo pregenerovať');
  } else {
    log(`[sync] pregenerúvam ${scope.length} zájazdov × ${sizes.length} rozmerov`);
  }

  // Pripravíme si klientov vopred – ak chýba token, nech to praskne pred prácou
  const clients = {};
  for (const key of uploadTargets) {
    const target = TARGETS[key];
    if (!target) throw new Error(`Neznámy cieľ "${key}". Možnosti: ${Object.keys(TARGETS).join(', ')}`);
    report.uploaded[key] = 0;
    report.uploadFailed[key] = 0;
    if (confirm) clients[key] = target.create();
  }
  const states = {};
  for (const key of uploadTargets) states[key] = await new UploadState(stateFile, key).load();

  for (const tour of scope) {
    const term = (tour.terms || [])
      .filter(t => t.dateFrom >= today)
      .sort((a, b) => a.dateFrom.localeCompare(b.dateFrom))[0] || null;

    for (const size of sizes) {
      let buffer;
      try {
        const out = await renderBanner({
          tour, w: size.w, h: size.h, style, ext: 'png',
          term: term?.dateFrom || null, feedVersion: feed.version,
        });
        buffer = out.buffer;
        report.rendered++;
      } catch (err) {
        report.renderFailed++;
        console.error(`[sync] render zlyhal ${tour.id} ${size.w}x${size.h}: ${err.message}`);
        continue;
      }

      for (const key of uploadTargets) {
        const name = ['DAKA', tour.id, term ? term.dateFrom.replace(/-/g, '') : 'min',
                      `${size.w}x${size.h}`, style].join('_');
        const hash = contentHash(buffer);
        if (states[key].isUploaded(name, hash)) continue;

        if (!confirm) { report.uploaded[key]++; continue; }   // len počítadlo, nič sa neodosiela

        try {
          const res = await TARGETS[key].upload(clients[key], { buffer, name });
          states[key].record(name, {
            hash, ref: res.ref, name,
            meta: { code: tour.id, term: term?.dateFrom || null, size: `${size.w}x${size.h}`, style },
          });
          report.uploaded[key]++;
        } catch (err) {
          report.uploadFailed[key]++;
          console.error(`[sync] ${key}: ${name} – ${err.message}`);
        }
      }
    }
  }

  if (confirm) for (const key of uploadTargets) await states[key].save();

  // Odtlačok zapisujeme až na konci – keď beh spadne, nabudúce sa zmeny zopakujú
  await writeSnapshot(snapshotFile, next);

  report.finishedAt = new Date().toISOString();
  report.durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);

  const reportFile = path.join(config.cacheDir, 'last-sync.json');
  await fs.mkdir(path.dirname(reportFile), { recursive: true });
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2));

  const up = uploadTargets.map(k => `${k}: ${report.uploaded[k]}${confirm ? '' : ' (nasucho)'}`).join(', ');
  log(`[sync] hotovo za ${report.durationSec}s – ${report.rendered} bannerov` +
      `${report.renderFailed ? `, ${report.renderFailed} chýb` : ''}${up ? `, nahraté ${up}` : ''}`);

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  const opts = {
    style: args.style || config.defaultStyle,
    uploadTargets: args.upload && args.upload !== 'true'
      ? args.upload.split(',').map(s => s.trim()).filter(Boolean)
      : [],
    confirm: args.confirm === 'true' || args.confirm === true,
    all: args.all === 'true' || args.all === true,
    limit: Number(args.limit) || 0,
  };

  if (opts.uploadTargets.length && !opts.confirm) {
    console.log('[sync] --upload bez --confirm: nahrávanie beží nasucho');
  }

  if (!args.watch) { await runOnce(opts); return; }

  const minutes = Math.max(5, Number(args.interval) || 360);
  console.log(`[sync] režim watch – cyklus každých ${minutes} min`);
  for (;;) {
    try {
      await runOnce(opts);
    } catch (err) {
      // Jeden zlyhaný cyklus nesmie zhodiť plánovač
      console.error(`[sync] cyklus zlyhal: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, minutes * 60_000));
  }
}

if (process.argv[1] && process.argv[1].endsWith('sync.js')) {
  main().catch(err => {
    console.error(`[sync] chyba: ${err.message}`);
    process.exitCode = 1;
  });
}
