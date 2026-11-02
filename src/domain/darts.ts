import { STANDARD_CHECKOUT_ROUTES } from './standardCheckoutRoutes.generated';

/** A single thrown dart, identified by the board segment it landed in. */
export type DartHit =
  | { kind: 'miss' }
  | { kind: 'number'; value: number; ring: 'single' | 'double' | 'triple' }
  | { kind: 'bull'; ring: 'outer' | 'inner' };

export function dartScore(hit: DartHit): number {
  switch (hit.kind) {
    case 'miss':
      return 0;
    case 'bull':
      return hit.ring === 'inner' ? 50 : 25;
    case 'number': {
      const multiplier = hit.ring === 'triple' ? 3 : hit.ring === 'double' ? 2 : 1;
      return hit.value * multiplier;
    }
  }
}

export function isDouble(hit: DartHit): boolean {
  return (hit.kind === 'number' && hit.ring === 'double') || (hit.kind === 'bull' && hit.ring === 'inner');
}

export function isTriple(hit: DartHit): boolean {
  return hit.kind === 'number' && hit.ring === 'triple';
}

export function dartLabel(hit: DartHit): string {
  switch (hit.kind) {
    case 'miss':
      return 'MISS';
    case 'bull':
      return hit.ring === 'inner' ? 'BULL' : 'OUTER BULL';
    case 'number': {
      const prefix = hit.ring === 'triple' ? 'T' : hit.ring === 'double' ? 'D' : 'S';
      return `${prefix}${hit.value}`;
    }
  }
}

/** The distinct point values a single dart can score, ignoring which segment produced them. */
const ONE_DART_SCORES: readonly number[] = (() => {
  const values = new Set<number>();
  for (let n = 1; n <= 20; n++) {
    values.add(n);
    values.add(n * 2);
    values.add(n * 3);
  }
  values.add(25);
  values.add(50);
  return [...values].sort((a, b) => a - b);
})();

/** Point values a dart can score while also being a valid double-out finishing dart. */
const FINISH_DART_SCORES: ReadonlySet<number> = (() => {
  const values = new Set<number>();
  for (let n = 1; n <= 20; n++) values.add(n * 2);
  values.add(50);
  return values;
})();

function sumSet(a: readonly number[], b: readonly number[]): Set<number> {
  const out = new Set<number>();
  for (const x of a) for (const y of b) out.add(x + y);
  return out;
}

// A visit's darts can each be a miss (0) - a score like 1 is only achievable as S1 + MISS + MISS, so
// reachability must be computed over "scoring dart or miss", not just real scoring darts.
const ONE_DART_OR_MISS: readonly number[] = [0, ...ONE_DART_SCORES];

const REACHABLE_1 = ONE_DART_OR_MISS;
const REACHABLE_2 = [...sumSet(ONE_DART_OR_MISS, ONE_DART_OR_MISS)].sort((a, b) => a - b);
const REACHABLE_3 = [...sumSet(REACHABLE_2, ONE_DART_OR_MISS)].sort((a, b) => a - b);

/** Is `total` an achievable 3-dart (or fewer) visit score at all (regardless of checkout)? */
export function isReachableScore(total: number, maxDarts: 1 | 2 | 3 = 3): boolean {
  const set = maxDarts === 1 ? REACHABLE_1 : maxDarts === 2 ? REACHABLE_2 : REACHABLE_3;
  return set.includes(total);
}

export const MAX_VISIT_SCORE = 180;

/**
 * How many darts (1-3) can legally finish a leg from `remaining` under double-out, given at most
 * `maxDarts` are available this visit. Returns every valid count (a remaining like 40 is finishable
 * in 1, 2 or 3 darts), not just the minimum - matching how the finish-declaration prompt only offers
 * mathematically consistent choices.
 */
export function validFinishDartCounts(remaining: number, maxDarts: 1 | 2 | 3 = 3): number[] {
  if (remaining <= 1 || remaining > 170) return [];
  const counts: number[] = [];
  if (maxDarts >= 1 && FINISH_DART_SCORES.has(remaining)) counts.push(1);
  if (maxDarts >= 2) {
    for (const d1 of ONE_DART_OR_MISS) {
      if (FINISH_DART_SCORES.has(remaining - d1)) {
        counts.push(2);
        break;
      }
    }
  }
  if (maxDarts >= 3) {
    for (const d1 of ONE_DART_OR_MISS) {
      for (const d2 of ONE_DART_OR_MISS) {
        if (FINISH_DART_SCORES.has(remaining - d1 - d2)) {
          counts.push(3);
          break;
        }
      }
      if (counts.includes(3)) break;
    }
  }
  return counts;
}

export function isCheckoutPossible(remaining: number, maxDarts: 1 | 2 | 3 = 3): boolean {
  return validFinishDartCounts(remaining, maxDarts).length > 0;
}

/**
 * Parses a segment id as written in the standard-route table (`S20`, `D16`, `T19`, `SB`, `BULL`).
 * Throws on anything else so a malformed table entry fails loudly in tests instead of being shown.
 */
export function parseDartId(id: string): DartHit {
  if (id === 'BULL') return { kind: 'bull', ring: 'inner' };
  if (id === 'SB') return { kind: 'bull', ring: 'outer' };
  const match = /^([SDT])([1-9]|1[0-9]|20)$/.exec(id);
  if (!match) throw new Error(`Unknown dart id: ${id}`);
  const ring = match[1] === 'T' ? 'triple' : match[1] === 'D' ? 'double' : 'single';
  return { kind: 'number', value: Number(match[2]), ring };
}

const STANDARD_ROUTE_HITS: ReadonlyMap<number, readonly DartHit[]> = new Map(
  Object.entries(STANDARD_CHECKOUT_ROUTES).map(([left, ids]) => [Number(left), ids.map(parseDartId)]),
);

/**
 * The suggested finishing route for `remaining` (double-out, a fresh 3-dart visit): the standard
 * route of 01 Arrangement Support, looked up from `standardCheckoutRoutes.generated.ts` (2-40: its
 * approved derivation rule; 41-170: the first candidate of its checkout table). Nothing is computed
 * here, so the route shown always matches that app. Returns null when there is no 3-dart checkout
 * (1, above 170, and the bogey numbers 159/162/163/165/166/168/169).
 */
export function suggestCheckoutRoute(remaining: number): DartHit[] | null {
  const route = STANDARD_ROUTE_HITS.get(remaining);
  return route ? [...route] : null;
}

/**
 * The text of a suggested route as shown under a remaining score (`T20 - S11 - BULL`). The outer bull
 * is written `SB`, as 01 Arrangement Support writes it, rather than dartLabel's `OUTER BULL`: the
 * longer form does not fit the remaining cell on a phone (e.g. `OUTER BULL - T19 - BULL` for 132).
 */
export function checkoutRouteLabel(route: readonly DartHit[]): string {
  return route.map((hit) => (hit.kind === 'bull' && hit.ring === 'outer' ? 'SB' : dartLabel(hit))).join(' - ');
}
