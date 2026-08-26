import { dartScore, type DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

export interface CorkState {
  /** Proximity rank of the best dart thrown; higher is closer to the centre. */
  best: number;
  darts: number;
  finished: boolean;
  hits: DartHit[];
}

export const CORK_DARTS = 1;

/**
 * Proximity ranking: inner bull (50) beats outer bull (25) beats any other board hit beats a miss.
 * Real cork is judged by physical distance to centre, which a scorer app cannot observe - this rank
 * is the closest faithful approximation from segment data alone (see docs/pentathlon-rules.md).
 */
export function corkProximity(hit: DartHit): number {
  if (hit.kind === 'bull') return hit.ring === 'inner' ? 3 : 2;
  if (hit.kind === 'miss') return 0;
  return 1;
}

export function corkLabel(best: number): string {
  switch (best) {
    case 3:
      return 'BULL';
    case 2:
      return 'OUTER BULL';
    case 1:
      return 'BOARD';
    default:
      return 'MISS';
  }
}

export const corkEngine: DisciplineEngine<CorkState, DartHit[]> = {
  meta: {
    id: 'cork',
    name: 'CORK',
    description: 'ブルに近いほど優位',
    inputMode: 'dart-hits',
    unit: 'proximity',
  },

  createState: (): CorkState => ({ best: 0, darts: 0, finished: false, hits: [] }),

  applyInput(state, hits) {
    if (state.finished || hits.length === 0) return state;
    const best = hits.reduce((max, hit) => Math.max(max, corkProximity(hit)), state.best);
    const darts = state.darts + hits.length;
    return { best, darts, finished: darts >= CORK_DARTS, hits: [...state.hits, ...hits] };
  },

  isFinished: (state) => state.finished,

  getResult: (state): DisciplineResult => ({
    value: state.best,
    unit: 'proximity',
    completed: state.finished,
    darts: state.darts,
    label: corkLabel(state.best),
  }),

  // Closer to the centre wins.
  compareResults: (a, b): CompareOutcome => {
    if (a.value > b.value) return 'p0';
    if (b.value > a.value) return 'p1';
    return 'draw';
  },

  describeTarget: (state) => (state.finished ? 'FINISHED' : 'BULL'),

  dartsRemainingThisTurn: (state) => Math.max(0, CORK_DARTS - state.darts),

  // An exact tie (both same proximity - e.g. both miss, or both land on the board) is sudden-death:
  // both players re-throw rather than the discipline ending in a draw (see docs/pentathlon-rules.md).
  continueOnTie: (): [CorkState, CorkState] => [
    { best: 0, darts: 0, finished: false, hits: [] },
    { best: 0, darts: 0, finished: false, hits: [] },
  ],
};

/** Exposed for the share card / result display. */
export function corkDartSummary(hits: DartHit[]): string {
  return hits.map((hit) => (hit.kind === 'miss' ? 'MISS' : String(dartScore(hit)))).join(' / ');
}
