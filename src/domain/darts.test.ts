import { describe, expect, it } from 'vitest';
import {
  dartScore,
  isCheckoutPossible,
  isReachableScore,
  validFinishDartCounts,
  suggestCheckoutRoute,
  dartLabel,
} from './darts';

describe('dartScore', () => {
  it('scores each ring correctly', () => {
    expect(dartScore({ kind: 'miss' })).toBe(0);
    expect(dartScore({ kind: 'number', value: 20, ring: 'single' })).toBe(20);
    expect(dartScore({ kind: 'number', value: 20, ring: 'double' })).toBe(40);
    expect(dartScore({ kind: 'number', value: 20, ring: 'triple' })).toBe(60);
    expect(dartScore({ kind: 'bull', ring: 'outer' })).toBe(25);
    expect(dartScore({ kind: 'bull', ring: 'inner' })).toBe(50);
  });
});

describe('dartLabel', () => {
  it('formats labels', () => {
    expect(dartLabel({ kind: 'number', value: 20, ring: 'triple' })).toBe('T20');
    expect(dartLabel({ kind: 'bull', ring: 'inner' })).toBe('BULL');
    expect(dartLabel({ kind: 'bull', ring: 'outer' })).toBe('OUTER BULL');
    expect(dartLabel({ kind: 'miss' })).toBe('MISS');
  });
});

describe('isReachableScore (raw 3-dart totals, no double-out constraint)', () => {
  it('accepts the maximum (180 = T20 T20 T20)', () => {
    expect(isReachableScore(180)).toBe(true);
  });
  it('rejects known-unreachable 3-dart totals', () => {
    for (const bad of [179, 178, 176, 175, 173, 172, 169]) {
      expect(isReachableScore(bad)).toBe(false);
    }
  });
  it('accepts 0 (three misses)', () => {
    expect(isReachableScore(0)).toBe(true);
  });
  it('accepts scores only reachable via misses (regression: S1 + MISS + MISS = 1)', () => {
    expect(isReachableScore(1)).toBe(true);
    expect(isReachableScore(2)).toBe(true); // S2+MISS+MISS or S1+S1+MISS
  });
  it('respects the darts-available cap', () => {
    expect(isReachableScore(60, 1)).toBe(true); // T20
    expect(isReachableScore(61, 1)).toBe(false);
    expect(isReachableScore(120, 2)).toBe(true); // T20 T20
    expect(isReachableScore(121, 2)).toBe(false);
  });
});

describe('checkout feasibility (double-out)', () => {
  it('170 is the highest possible checkout (T20 T20 Bull)', () => {
    expect(isCheckoutPossible(170)).toBe(true);
    expect(isCheckoutPossible(171)).toBe(false);
  });
  it('1 can never be checked out', () => {
    expect(isCheckoutPossible(1)).toBe(false);
  });
  it('the standard double-out bogey numbers are impossible', () => {
    for (const bogey of [169, 168, 166, 165, 163, 162, 159]) {
      expect(isCheckoutPossible(bogey)).toBe(false);
    }
  });
  it('40 (D20) is a 1-dart checkout', () => {
    expect(validFinishDartCounts(40)).toContain(1);
  });
  it('50 (bull) is a 1-dart checkout', () => {
    expect(validFinishDartCounts(50)).toContain(1);
  });
  it('141 requires exactly 3 darts (never 1 or 2)', () => {
    expect(validFinishDartCounts(141)).toEqual([3]);
  });
  it('32 is reachable in 1, 2 and 3 darts', () => {
    const counts = validFinishDartCounts(32);
    expect(counts).toContain(1); // D16
    expect(counts).toContain(2);
    expect(counts).toContain(3);
  });
  it('respects maxDarts (141 needs 3 darts minimum, so is not offered with only 1 available)', () => {
    expect(validFinishDartCounts(141, 1)).toEqual([]);
  });
  it('accepts a checkout reached via leading misses (regression: remaining=2 via MISS, MISS, D1)', () => {
    expect(validFinishDartCounts(2)).toEqual(expect.arrayContaining([1, 2, 3]));
  });
});

describe('suggestCheckoutRoute', () => {
  it('suggests a route whose total equals remaining and ends on a double/bull', () => {
    for (const remaining of [170, 141, 40, 32, 2, 121, 100]) {
      const route = suggestCheckoutRoute(remaining);
      expect(route).not.toBeNull();
      const total = route!.reduce((sum, hit) => sum + dartScore(hit), 0);
      expect(total).toBe(remaining);
      const last = route![route!.length - 1];
      expect(last.kind === 'bull' ? last.ring === 'inner' : (last as { ring: string }).ring === 'double').toBe(
        true,
      );
    }
  });
  it('returns null for an impossible checkout', () => {
    expect(suggestCheckoutRoute(169)).toBeNull();
    expect(suggestCheckoutRoute(1)).toBeNull();
  });
});
