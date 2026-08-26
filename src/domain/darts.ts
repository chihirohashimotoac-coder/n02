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
 * A greedy suggested finishing route for `remaining` (double-out), preferring the fewest darts and
 * higher-value darts first. This is a computed suggestion (mirroring the spirit of commonly published
 * checkout charts), not a verbatim reproduction of any specific chart.
 */
export function suggestCheckoutRoute(remaining: number, maxDarts: 1 | 2 | 3 = 3): DartHit[] | null {
  if (remaining <= 1 || remaining > 170) return null;
  const candidates: DartHit[] = [];
  for (let n = 20; n >= 1; n--) candidates.push({ kind: 'number', value: n, ring: 'triple' });
  candidates.push({ kind: 'bull', ring: 'inner' });
  for (let n = 20; n >= 1; n--) candidates.push({ kind: 'number', value: n, ring: 'double' });
  candidates.push({ kind: 'bull', ring: 'outer' });
  for (let n = 20; n >= 1; n--) candidates.push({ kind: 'number', value: n, ring: 'single' });

  const finishCandidates = candidates.filter((hit) => isDouble(hit));

  if (maxDarts >= 1) {
    const finish = finishCandidates.find((hit) => dartScore(hit) === remaining);
    if (finish) return [finish];
  }
  if (maxDarts >= 2) {
    for (const first of candidates) {
      const rest = remaining - dartScore(first);
      const finish = finishCandidates.find((hit) => dartScore(hit) === rest);
      if (finish) return [first, finish];
    }
  }
  if (maxDarts >= 3) {
    for (const first of candidates) {
      const afterFirst = remaining - dartScore(first);
      for (const second of candidates) {
        const rest = afterFirst - dartScore(second);
        const finish = finishCandidates.find((hit) => dartScore(hit) === rest);
        if (finish) return [first, second, finish];
      }
    }
  }
  return null;
}
