/**
 * Registrácia fontu Ubuntu pre server-side render.
 *
 * Prehliadač načíta Ubuntu z Google Fonts (rezy 400/500/700), server ho musí
 * mať tiež – inak by sa server-side banner líšil od náhľadu v prehliadači.
 * Font dodáva npm balík @expo-google-fonts/ubuntu, ktorý obsahuje kompletné
 * TTF súbory (vrátane slovenskej diakritiky). Podmnožinové woff2 z Google
 * Fonts sa použiť nedajú – latin a latin-ext sú samostatné súbory a Skia
 * medzi nimi glyfy nedopĺňa.
 */
import { GlobalFonts } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { setDateIcon } from '../shared/banner.js';

const require = createRequire(import.meta.url);

// Emoji font pre ikonu 📅 vo svetlom štýle. Skia nerobí automatický fallback,
// preto ho treba registrovať explicitne (v Dockerfile: fonts-noto-color-emoji).
const EMOJI_PATHS = [
  process.env.EMOJI_FONT_PATH,
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/truetype/noto/NotoColorEmoji-Regular.ttf',
  '/usr/share/fonts/noto/NotoColorEmoji.ttf',
  '/System/Library/Fonts/Apple Color Emoji.ttc',
].filter(Boolean);

function registerEmoji() {
  for (const file of EMOJI_PATHS) {
    try {
      if (!fs.existsSync(file)) continue;
      GlobalFonts.registerFromPath(file, 'Noto Color Emoji');
      return true;
    } catch { /* skús ďalší */ }
  }
  return false;
}

// Rez → súbor v balíku. Všetky sa registrujú pod rodinu "Ubuntu",
// takže `ctx.font = '500 28px Ubuntu,Arial'` vyberie správny rez.
const FACES = [
  { file: '400Regular/Ubuntu_400Regular.ttf', weight: 400 },
  { file: '500Medium/Ubuntu_500Medium.ttf',   weight: 500 },
  { file: '700Bold/Ubuntu_700Bold.ttf',       weight: 700 },
];

const FAMILY = 'Ubuntu';

let state = null;   // { ok:boolean, loaded:string[] }

export function registerFonts() {
  if (state) return state.ok;

  let dir;
  try {
    dir = path.dirname(require.resolve('@expo-google-fonts/ubuntu/package.json'));
  } catch {
    console.warn('[fonts] @expo-google-fonts/ubuntu chýba – spusti `npm install` v priečinku server/');
    state = { ok: false, loaded: [] };
    return false;
  }

  const loaded = [];
  for (const face of FACES) {
    const file = path.join(dir, face.file);
    if (!fs.existsSync(file)) {
      console.warn(`[fonts] chýba súbor ${face.file}`);
      continue;
    }
    try {
      GlobalFonts.registerFromPath(file, FAMILY);
      loaded.push(String(face.weight));
    } catch (err) {
      console.warn(`[fonts] nepodarilo sa registrovať ${face.file}: ${err.message}`);
    }
  }

  const emoji = registerEmoji();
  if (!emoji) {
    // Bez emoji fontu by sa namiesto ikony vykreslil prázdny štvorec
    setDateIcon('');
    console.warn('[fonts] emoji font nenájdený – ikona pri dátume sa vynechá');
  }

  state = { ok: loaded.length > 0, loaded, emoji };
  if (!state.ok) console.warn('[fonts] Ubuntu sa nenačítal, render použije systémový font');
  return state.ok;
}

/** Diagnostika pre /health. */
export function fontStatus() {
  return {
    family: FAMILY,
    ok: !!state?.ok,
    weights: state?.loaded ?? [],
    emoji: !!state?.emoji,
    registered: GlobalFonts.families.map(f => f.family),
  };
}
