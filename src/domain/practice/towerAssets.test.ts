import { describe, expect, it } from 'vitest';
import {
  TOWER_GAUGE_ART,
  TOWER_SCENE_BANDS,
  gaugeLitInsetPct,
  towerGaugeUrl,
  towerSceneUrl,
} from './towerAssets';

/**
 * The artwork's manifest and the measurements taken off it.
 *
 * What matters here is that a band always resolves to a real file - a missing scene is a blank
 * stairwell, and an off-by-one band would show the wrong stretch of the tower - and that the gauge
 * fill maps floors onto the drawn stonework rather than onto the whole image.
 */

describe('tower scene artwork', () => {
  it('has one scene per band of the climb', () => {
    expect(TOWER_SCENE_BANDS).toBe(5);
  });

  it('resolves each band to its own file, in climbing order', () => {
    const names = [1, 2, 3, 4, 5].map((band) => towerSceneUrl(band).split('/').pop());
    expect(names).toEqual([
      'tower-stage-001-020.webp',
      'tower-stage-021-040.webp',
      'tower-stage-041-060.webp',
      'tower-stage-061-080.webp',
      'tower-stage-081-100.webp',
    ]);
  });

  it('clamps a band outside the tower to a real file rather than returning nothing', () => {
    expect(towerSceneUrl(0)).toBe(towerSceneUrl(1));
    expect(towerSceneUrl(-3)).toBe(towerSceneUrl(1));
    expect(towerSceneUrl(9)).toBe(towerSceneUrl(5));
  });

  it('resolves against the document, so a sub-path deploy still finds the files', () => {
    // GitHub Pages serves n02 from /n02/; the app is built with base './', so every asset URL has
    // to be relative to the document rather than to the server root.
    expect(towerSceneUrl(2)).toBe(new URL('tower/tower-stage-021-040.webp', document.baseURI).toString());
    expect(towerGaugeUrl()).toBe(new URL('tower/tower-gauge.webp', document.baseURI).toString());
  });
});

describe('gauge fill', () => {
  const { shaftTopPct, shaftBottomPct } = TOWER_GAUGE_ART;

  it('leaves only the plinth lit before the first floor is beaten', () => {
    expect(gaugeLitInsetPct(0, 100)).toBe(shaftBottomPct);
  });

  it('lights the crown only on a finished climb', () => {
    expect(gaugeLitInsetPct(100, 100)).toBe(0);
    // One floor short still leaves the crown dark, however close it is.
    expect(gaugeLitInsetPct(99, 100)).toBeGreaterThan(0);
    expect(gaugeLitInsetPct(99, 100)).toBeCloseTo(shaftTopPct + (shaftBottomPct - shaftTopPct) * 0.01, 5);
  });

  it('maps floors linearly onto the shaft between the plinth and the crown', () => {
    const midway = (shaftBottomPct + shaftTopPct) / 2;
    expect(gaugeLitInsetPct(50, 100)).toBeCloseTo(midway, 5);
    expect(gaugeLitInsetPct(25, 100)).toBeCloseTo(shaftBottomPct - (shaftBottomPct - shaftTopPct) * 0.25, 5);
  });

  it('rises as floors are beaten, never falls back', () => {
    let previous = gaugeLitInsetPct(0, 100);
    for (let floor = 1; floor <= 100; floor += 1) {
      const inset = gaugeLitInsetPct(floor, 100);
      expect(inset).toBeLessThan(previous);
      previous = inset;
    }
  });

  it('holds inside the image for any input, including nonsense', () => {
    for (const [cleared, final] of [
      [-5, 100],
      [140, 100],
      [0, 0],
      [7, 0],
      [3, 20],
    ]) {
      const inset = gaugeLitInsetPct(cleared, final);
      expect(inset).toBeGreaterThanOrEqual(0);
      expect(inset).toBeLessThanOrEqual(100);
    }
  });

  it('works for a shorter tower than 100 floors', () => {
    // The gauge takes finalFloor from the rules rather than assuming 100, so a 20-floor tower fills
    // at five times the rate.
    expect(gaugeLitInsetPct(10, 20)).toBeCloseTo(gaugeLitInsetPct(50, 100), 5);
  });
});

describe('gauge geometry', () => {
  it('describes a box the artwork actually fits', () => {
    expect(TOWER_GAUGE_ART.width).toBe(151);
    expect(TOWER_GAUGE_ART.height).toBe(2172);
  });

  it('keeps the shaft landmarks inside the image and in order', () => {
    const { shaftTopPct, shaftBottomPct, shaftLeftPct, shaftRightPct } = TOWER_GAUGE_ART;
    expect(shaftTopPct).toBeGreaterThan(0);
    expect(shaftTopPct).toBeLessThan(shaftBottomPct);
    expect(shaftBottomPct).toBeLessThan(100);
    expect(shaftLeftPct).toBeGreaterThan(0);
    expect(shaftLeftPct).toBeLessThan(shaftRightPct);
    expect(shaftRightPct).toBeLessThan(100);
  });
});
