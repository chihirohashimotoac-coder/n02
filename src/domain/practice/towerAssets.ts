/**
 * Where TOWER's artwork lives, and the few measurements taken off it.
 *
 * The files sit in web/public/tower/, so Vite copies them to the build root untouched and they are
 * NEVER part of the JS bundle - the initial app load carries none of them. They are fetched by the
 * play screen once TOWER has started, and only the band the climb is actually in.
 *
 * They are also kept out of the service worker's precache (see vite.config.ts): 1.2MB of scenery
 * must not hold up a service-worker install for players who never open TOWER. A runtime CacheFirst
 * rule stores each one the first time it is really shown, so a second visit is offline-capable.
 *
 * Every screen that uses them degrades to the drawn fallback if a file is missing, so a failed
 * fetch costs the scenery and nothing else.
 */

/** Resolved against the document, so it works under GitHub Pages' /n02/ sub-path and on a preview
 *  host serving from the root alike - the app is built with Vite's base: './'. */
function assetUrl(file: string): string {
  return new URL(`tower/${file}`, document.baseURI).toString();
}

/**
 * One scene per 20 floors, matching the bands the play screen already switches on.
 *
 * The names are the delivered artwork's subjects: stone and torchlight, moss, a blue gallery, the
 * violet upper storeys, and the summit at dawn.
 */
const SCENE_FILES: Record<number, string> = {
  1: 'tower-stage-001-020.webp',
  2: 'tower-stage-021-040.webp',
  3: 'tower-stage-041-060.webp',
  4: 'tower-stage-061-080.webp',
  5: 'tower-stage-081-100.webp',
};

export const TOWER_SCENE_BANDS = Object.keys(SCENE_FILES).length;

/** The scene for a band, clamped so an out-of-range band still returns a real file. */
export function towerSceneUrl(band: number): string {
  const clamped = Math.min(TOWER_SCENE_BANDS, Math.max(1, Math.round(band)));
  return assetUrl(SCENE_FILES[clamped]);
}

export function towerGaugeUrl(): string {
  return assetUrl('tower-gauge.webp');
}

/**
 * Where the gauge tower sits inside its own image, as percentages of the file.
 *
 * Measured off web/public/tower/tower-gauge.webp rather than guessed, because the lit fill and the
 * player markers have to line up with the drawn stonework: the fill starts at the top of the plinth
 * and ends under the crown, and the markers ride the shaft's own edges. See
 * docs/tower-artwork-report.md for how the numbers were taken.
 *
 * The image is cropped to the tower, so these are stable: changing the artwork means re-measuring
 * it, which the report describes.
 */
export const TOWER_GAUGE_ART = {
  /** Intrinsic size of the file, and therefore the aspect ratio its box must hold. */
  width: 151,
  height: 2172,
  /** Top of the shaft - above this is the crenellated crown, which only lights on a full climb. */
  shaftTopPct: 5.99,
  /** Top of the plinth. The climb runs upward from here. */
  shaftBottomPct: 94.29,
  /** The shaft's own left and right edges, so a marker touches stone rather than empty air. */
  shaftLeftPct: 25.83,
  shaftRightPct: 74.83,
} as const;

/**
 * How far up the image the lit portion should reach, as a CSS `inset()` top percentage.
 *
 * 0 floors beaten leaves only the plinth lit, which reads as standing at the foot of the tower; a
 * finished climb lights the crown too, which nothing short of 100F does.
 */
export function gaugeLitInsetPct(clearedFloor: number, finalFloor: number): number {
  if (finalFloor <= 0) return TOWER_GAUGE_ART.shaftBottomPct;
  const ratio = Math.min(1, Math.max(0, clearedFloor / finalFloor));
  if (ratio >= 1) return 0;
  const { shaftTopPct, shaftBottomPct } = TOWER_GAUGE_ART;
  return shaftBottomPct - ratio * (shaftBottomPct - shaftTopPct);
}
