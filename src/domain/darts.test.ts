import { describe, expect, it } from 'vitest';
import {
  dartScore,
  isCheckoutPossible,
  isReachableScore,
  validFinishDartCounts,
  suggestCheckoutRoute,
  dartLabel,
  isDouble,
  parseDartId,
  checkoutRouteLabel,
} from './darts';
import { STANDARD_CHECKOUT_ROUTES } from './standardCheckoutRoutes.generated';

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
  const BOGEY_NUMBERS = [159, 162, 163, 165, 166, 168, 169];
  const show = (remaining: number) => {
    const route = suggestCheckoutRoute(remaining);
    return route ? checkoutRouteLabel(route) : null;
  };

  it('is valid for every remaining 2-170: right total, double/bull finish, no bust on the way, at most 3 darts', () => {
    const violations: string[] = [];
    for (let remaining = 2; remaining <= 170; remaining++) {
      const route = suggestCheckoutRoute(remaining);
      if (!route) continue;
      if (route.length < 1 || route.length > 3) violations.push(`${remaining}: ${route.length} darts`);
      let left = remaining;
      route.forEach((hit, index) => {
        left -= dartScore(hit);
        const last = index === route.length - 1;
        if (!last && left < 2) violations.push(`${remaining}: busts after dart ${index + 1}`);
        if (last && (left !== 0 || !isDouble(hit))) violations.push(`${remaining}: does not finish on a double`);
      });
    }
    expect(violations).toEqual([]);
  });

  it('has a route exactly where a 3-dart checkout exists (only the bogey numbers are missing)', () => {
    const missing: number[] = [];
    const mismatched: number[] = [];
    for (let remaining = 2; remaining <= 170; remaining++) {
      const route = suggestCheckoutRoute(remaining);
      if (!route) missing.push(remaining);
      if ((route !== null) !== isCheckoutPossible(remaining)) mismatched.push(remaining);
    }
    expect(missing).toEqual(BOGEY_NUMBERS);
    expect(mismatched).toEqual([]);
    expect(Object.keys(STANDARD_CHECKOUT_ROUTES)).toHaveLength(169 - BOGEY_NUMBERS.length);
  });

  it('returns null outside 2-170', () => {
    for (const remaining of [-1, 0, 1, 171, 180, 501]) expect(suggestCheckoutRoute(remaining)).toBeNull();
  });

  it('shows the standard routes of 01 Arrangement Support, not computed ones', () => {
    // Values the old greedy search got wrong (it showed e.g. T13 - D1 for 41 and T20 - T19 - D4 for 125).
    expect(show(5)).toBe('S1 - D2');
    expect(show(41)).toBe('S9 - D16');
    expect(show(50)).toBe('S18 - D16');
    expect(show(60)).toBe('S20 - D20');
    expect(show(82)).toBe('BULL - D16');
    expect(show(101)).toBe('T20 - S9 - D16');
    expect(show(110)).toBe('T20 - S10 - D20');
    expect(show(121)).toBe('T20 - S11 - BULL');
    expect(show(125)).toBe('SB - T20 - D20');
    expect(show(131)).toBe('T20 - T13 - D16');
    expect(show(170)).toBe('T20 - T20 - BULL');
  });

  it('writes every route in the notation of the table (outer bull as SB), and nothing longer', () => {
    const differing: string[] = [];
    for (const [left, ids] of Object.entries(STANDARD_CHECKOUT_ROUTES)) {
      const label = show(Number(left));
      if (label !== ids.join(' - ')) differing.push(`${left}: ${label} / ${ids.join(' - ')}`);
    }
    expect(differing).toEqual([]);
    // The outer bull keeps its long name everywhere else (e.g. the Pentathlon hit pad).
    expect(dartLabel({ kind: 'bull', ring: 'outer' })).toBe('OUTER BULL');
  });

  it('parses every id of the table and rejects unknown ones', () => {
    expect(parseDartId('T20')).toEqual({ kind: 'number', value: 20, ring: 'triple' });
    expect(parseDartId('D1')).toEqual({ kind: 'number', value: 1, ring: 'double' });
    expect(parseDartId('S11')).toEqual({ kind: 'number', value: 11, ring: 'single' });
    expect(parseDartId('SB')).toEqual({ kind: 'bull', ring: 'outer' });
    expect(parseDartId('BULL')).toEqual({ kind: 'bull', ring: 'inner' });
    for (const bad of ['T21', 'D0', 'S', 'MISS', 'DB', 't20']) expect(() => parseDartId(bad)).toThrow();
  });

  it('hands out a copy, so a caller cannot alter the table', () => {
    const first = suggestCheckoutRoute(170)!;
    first.pop();
    expect(suggestCheckoutRoute(170)).toHaveLength(3);
  });
});
