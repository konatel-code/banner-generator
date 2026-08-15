/**
 * Odtlačok feedu a porovnanie oproti minulému behu.
 *
 * Vďaka tomu vie synchronizácia povedať, čo sa v ponuke naozaj zmenilo –
 * ktorý zájazd zlacnel, komu sa posunul najbližší termín, čo pribudlo
 * a čo z feedu zmizlo. Pregenerúvať a nahrávať sa potom musí len to,
 * čoho sa zmena týka.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { nextTerm } from '../../shared/tour.js';

/** Zmenší zájazdy na to podstatné – čo ovplyvňuje obsah bannera. */
export function snapshotOf(tours, { version = '', at = null, from = null } = {}) {
  const entries = {};
  for (const t of tours) {
    const term = nextTerm(t, from);
    entries[t.id] = {
      name: t.name,
      price: term?.price ?? t.minPrice ?? null,
      dateFrom: term?.dateFrom ?? null,
      discount: t.maxDiscount || 0,
    };
  }
  return { version, at: at || new Date().toISOString(), tours: entries };
}

/**
 * Porovná dva odtlačky. Prvý beh (bez predchádzajúceho odtlačku) hlási
 * všetky zájazdy ako nové – to je správne, ešte sa nič nevygenerovalo.
 */
export function diffSnapshots(prev, next) {
  const before = prev?.tours || {};
  const after  = next?.tours || {};

  const added = [], removed = [], priceChanged = [], termChanged = [], discountChanged = [];

  for (const [code, now] of Object.entries(after)) {
    const was = before[code];
    if (!was) { added.push({ code, name: now.name, price: now.price }); continue; }
    if (was.price !== now.price)       priceChanged.push({ code, name: now.name, from: was.price, to: now.price });
    if (was.dateFrom !== now.dateFrom) termChanged.push({ code, name: now.name, from: was.dateFrom, to: now.dateFrom });
    if (was.discount !== now.discount) discountChanged.push({ code, name: now.name, from: was.discount, to: now.discount });
  }
  for (const [code, was] of Object.entries(before)) {
    if (!after[code]) removed.push({ code, name: was.name });
  }

  // Kódy, ktorých banner treba pregenerovať
  const affected = [...new Set([
    ...added.map(x => x.code),
    ...priceChanged.map(x => x.code),
    ...termChanged.map(x => x.code),
    ...discountChanged.map(x => x.code),
  ])];

  return {
    firstRun: !prev,
    added, removed, priceChanged, termChanged, discountChanged, affected,
    unchanged: Object.keys(after).length - affected.length,
  };
}

export async function readSnapshot(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.tours ? parsed : null;
  } catch {
    return null;   // prvý beh alebo poškodený súbor – správame sa ako pri prvom behu
  }
}

export async function writeSnapshot(file, snapshot) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2));
  await fs.rename(tmp, file);
}

/** Zhrnutie do jedného riadka pre log. */
export function summarize(diff) {
  if (diff.firstRun) return `prvý beh, ${diff.affected.length} zájazdov na spracovanie`;
  const parts = [];
  if (diff.added.length)           parts.push(`${diff.added.length} nových`);
  if (diff.priceChanged.length)    parts.push(`${diff.priceChanged.length} so zmenou ceny`);
  if (diff.termChanged.length)     parts.push(`${diff.termChanged.length} so zmenou termínu`);
  if (diff.discountChanged.length) parts.push(`${diff.discountChanged.length} so zmenou zľavy`);
  if (diff.removed.length)         parts.push(`${diff.removed.length} zmizlo z feedu`);
  return parts.length ? parts.join(', ') : 'žiadne zmeny';
}
