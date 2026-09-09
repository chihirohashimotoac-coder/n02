import { describe, expect, it } from 'vitest';
import { classifyAward, type AwardContext, type AwardKind } from './awards';

/** 通常01 / チェックアウト練習: always the SEPARATE BULL side, never FAT. */
const x01 = (remainingBefore?: number, checkout = false): AwardContext => ({
  mode: 'x01',
  bullMode: 'separate',
  remainingBefore,
  checkout,
});
const countUp = (bullMode: 'separate' | 'fat'): AwardContext => ({ mode: 'count-up', bullMode });

describe('classifyAward - score bands', () => {
  const cases: Array<[number, AwardKind | null]> = [
    [0, null],
    [1, null],
    [99, null],
    [100, 'LOW_TON'],
    [140, 'LOW_TON'],
    [149, 'LOW_TON'],
    [151, 'HIGH_TON'],
    [169, 'HIGH_TON'],
    [179, 'HIGH_TON'],
    [180, 'TON_80'],
  ];

  for (const [score, expected] of cases) {
    it(`${score} -> ${expected ?? 'no award'} in both modes`, () => {
      expect(classifyAward(score, countUp('separate'))).toBe(expected);
      expect(classifyAward(score, countUp('fat'))).toBe(expected);
      expect(classifyAward(score, x01())).toBe(expected);
    });
  }
});

describe('classifyAward - 150 and the BULL setting', () => {
  it('COUNT-UP on SEPARATE BULL calls a 150 THREE IN THE BLACK', () => {
    expect(classifyAward(150, countUp('separate'))).toBe('THREE_IN_THE_BLACK');
  });

  it('COUNT-UP on FAT BULL calls the same 150 a HAT TRICK', () => {
    expect(classifyAward(150, countUp('fat'))).toBe('HAT_TRICK');
  });

  it('通常01 / チェックアウト練習 always use the SEPARATE BULL side', () => {
    expect(classifyAward(150, x01())).toBe('THREE_IN_THE_BLACK');
    expect(classifyAward(150, x01(301))).toBe('THREE_IN_THE_BLACK');
    // Even asked with fat set, x01 must not produce a HAT TRICK: that award is COUNT-UP's.
    expect(classifyAward(150, { mode: 'x01', bullMode: 'fat' })).toBe('THREE_IN_THE_BLACK');
  });
});

describe('classifyAward - BIG FISH', () => {
  it('fires only for 170 thrown from 170 and checked out', () => {
    expect(classifyAward(170, x01(170, true))).toBe('BIG_FISH');
  });

  it('is a HIGH TON when the 170 did not check out', () => {
    expect(classifyAward(170, x01(170, false))).toBe('HIGH_TON');
  });

  it('is a HIGH TON when 170 was scored from any other remaining', () => {
    expect(classifyAward(170, x01(501, false))).toBe('HIGH_TON');
    expect(classifyAward(170, x01(301, true))).toBe('HIGH_TON');
    expect(classifyAward(170, x01(180, false))).toBe('HIGH_TON');
    expect(classifyAward(170, x01(171, false))).toBe('HIGH_TON');
  });

  it('never fires in COUNT-UP, which has no remaining and no checkout', () => {
    expect(classifyAward(170, countUp('separate'))).toBe('HIGH_TON');
    expect(classifyAward(170, countUp('fat'))).toBe('HIGH_TON');
  });

  it('does not fire for a checkout of any other number', () => {
    expect(classifyAward(167, x01(167, true))).toBe('HIGH_TON');
    expect(classifyAward(164, x01(164, true))).toBe('HIGH_TON');
    expect(classifyAward(120, x01(120, true))).toBe('LOW_TON');
    expect(classifyAward(40, x01(40, true))).toBeNull();
  });

  it('does not fire for a 180, which stays TON 80', () => {
    expect(classifyAward(180, x01(180, true))).toBe('TON_80');
  });
});

describe('classifyAward - rejects anything that is not a visit total', () => {
  for (const bad of [-1, 181, 200, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`${bad} earns no award`, () => {
      expect(classifyAward(bad, x01())).toBeNull();
      expect(classifyAward(bad, countUp('separate'))).toBeNull();
    });
  }
});
