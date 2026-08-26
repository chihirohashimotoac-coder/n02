import type { DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

export const GOLF_HOLES = 9;

export interface GolfState {
  hole: number;
  strokes: number;
  darts: number;
  finished: boolean;
  holeScores: number[];
}

/**
 * Strokes for the dart that finished a hole. Only the LAST dart thrown counts (a player may stop
 * after 1 or 2 darts), which is what makes throwing on a gamble.
 */
export function golfStrokes(hole: number, hit: DartHit): number {
  if (hit.kind === 'number' && hit.value === hole) {
    if (hit.ring === 'double') return 1;
    if (hit.ring === 'triple') return 2;
    return 3;
  }
  return 5;
}

export const golfEngine: DisciplineEngine<GolfState, DartHit[]> = {
  meta: {
    id: 'golf',
    name: 'GOLF',
    description: `${GOLF_HOLES}ホール・最終投のみ加算 / 少ないほど良い`,
    inputMode: 'dart-hits',
    unit: 'strokes',
  },

  createState: (): GolfState => ({
    hole: 1,
    strokes: 0,
    darts: 0,
    finished: false,
    holeScores: [],
  }),

  applyInput(state, hits) {
    if (state.finished || hits.length === 0) return state;
    const lastHit = hits[hits.length - 1];
    const strokes = golfStrokes(state.hole, lastHit);
    const hole = state.hole + 1;
    return {
      hole,
      strokes: state.strokes + strokes,
      darts: state.darts + hits.length,
      finished: hole > GOLF_HOLES,
      holeScores: [...state.holeScores, strokes],
    };
  },

  isFinished: (state) => state.finished,

  getResult: (state): DisciplineResult => ({
    value: state.strokes,
    unit: 'strokes',
    completed: state.finished,
    darts: state.darts,
    label: `${state.strokes} STROKES`,
  }),

  // Fewer strokes wins.
  compareResults: (a, b): CompareOutcome => {
    if (a.value < b.value) return 'p0';
    if (b.value < a.value) return 'p1';
    return 'draw';
  },

  describeTarget: (state) => (state.finished ? 'FINISHED' : `HOLE ${state.hole}`),

  dartsRemainingThisTurn: () => 3,
};
