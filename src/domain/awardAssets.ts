import type { AwardKind } from './awards';

/**
 * Where each award's movie and poster live.
 *
 * The files sit in web/public/awards/, so Vite copies them to the build root untouched and they are
 * NEVER part of the JS bundle - the initial app load carries none of them. They are fetched by the
 * overlay, after a mode has started, during idle time, and only for the awards that mode can
 * actually produce (see AWARDS_BY_MODE).
 *
 * The bytes are exactly as delivered; see docs/award-movie-production-report.md and the SHA-256
 * manifest shipped beside them at awards/award-movie-manifest.json.
 */

/** Resolved against the document, so it works under GitHub Pages' /n02/ sub-path and on a preview
 *  host serving from the root alike - the app is built with Vite's base: './'. */
function assetUrl(file: string): string {
  return new URL(`awards/${file}`, document.baseURI).toString();
}

export interface AwardAsset {
  movie: string;
  poster: string;
}

const FILES: Record<AwardKind, string> = {
  LOW_TON: 'award-low-ton',
  HIGH_TON: 'award-high-ton',
  TON_80: 'award-ton80',
  HAT_TRICK: 'award-hat-trick',
  THREE_IN_THE_BLACK: 'award-three-in-the-black',
  BIG_FISH: 'award-big-fish',
};

export function awardAsset(kind: AwardKind): AwardAsset {
  const base = FILES[kind];
  return { movie: assetUrl(`${base}.mp4`), poster: assetUrl(`${base}-poster.webp`) };
}

/**
 * Which awards each mode can actually produce, so a mode only ever warms the files it might show.
 *
 * COUNT-UP has no remaining and no checkout, so never BIG FISH. 通常01 / チェックアウト練習 take a
 * visit total and always classify on the SEPARATE BULL side, so never HAT TRICK.
 */
export const AWARDS_BY_MODE: Record<'count-up' | 'x01', readonly AwardKind[]> = {
  'count-up': ['LOW_TON', 'HIGH_TON', 'TON_80', 'HAT_TRICK', 'THREE_IN_THE_BLACK'],
  x01: ['LOW_TON', 'HIGH_TON', 'TON_80', 'THREE_IN_THE_BLACK', 'BIG_FISH'],
};
