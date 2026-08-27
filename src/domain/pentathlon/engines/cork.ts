import type { DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

/**
 * Cork: 5 rounds of 3 darts (15 darts total), every dart thrown at BULL. The rule (given directly
 * by the user, superseding the earlier "closest to centre, sudden-death on a tie" interpretation -
 * see docs/pentathlon-rules.md): inner bull counts as 2, outer bull as 1, anything else as 0. The
 * player with the higher total wins; max possible is 30 (15 darts x inner bull).
 */
export const CORK_ROUNDS = 5;
export const CORK_DARTS = CORK_ROUNDS * 3;

/** Points contributed by one dart: inner bull = 2, outer bull = 1, anything else = 0. */
export function corkDartValue(hit: DartHit): number {
  if (hit.kind !== 'bull') return 0;
  return hit.ring === 'inner' ? 2 : 1;
}

export interface CorkState {
  score: number;
  darts: number;
  finished: boolean;
  hits: DartHit[];
}

export const corkEngine: DisciplineEngine<CorkState, DartHit[]> = {
  meta: {
    id: 'cork',
    name: 'CORK',
    description: `${CORK_ROUNDS}ラウンド・計${CORK_DARTS}投を全てブルへ / インナー2本・アウター1本でカウント`,
    inputMode: 'dart-hits',
    unit: 'points',
  },

  createState: (): CorkState => ({ score: 0, darts: 0, finished: false, hits: [] }),

  applyInput(state, hits) {
    if (state.finished || hits.length === 0) return state;
    const gained = hits.reduce((sum, hit) => sum + corkDartValue(hit), 0);
    const darts = state.darts + hits.length;
    return { score: state.score + gained, darts, finished: darts >= CORK_DARTS, hits: [...state.hits, ...hits] };
  },

  isFinished: (state) => state.finished,

  getResult: (state): DisciplineResult => ({
    value: state.score,
    unit: 'points',
    completed: state.finished,
    darts: state.darts,
    label: `${state.score} POINTS`,
  }),

  // Higher total wins; an exact tie is a genuine draw (no sudden-death re-throw under this rule).
  compareResults: (a, b): CompareOutcome => {
    if (a.value > b.value) return 'p0';
    if (b.value > a.value) return 'p1';
    return 'draw';
  },

  describeTarget: (state) => (state.finished ? 'FINISHED' : `BULL（残り${CORK_DARTS - state.darts}投）`),

  dartsRemainingThisTurn: () => 3,
};
