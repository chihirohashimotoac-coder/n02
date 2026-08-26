import type { DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

export const BASEBALL_INNINGS = 9;
/** Extra innings are bounded so a stubborn tie cannot loop forever in the UI. */
export const BASEBALL_MAX_INNINGS = 12;

export interface BaseballState {
  inning: number;
  runs: number;
  darts: number;
  finished: boolean;
  innings: number[];
}

/** Runs for one dart in inning N: only number N scores, Single=1 / Double=2 / Triple=3. */
export function baseballRuns(inning: number, hit: DartHit): number {
  if (hit.kind !== 'number' || hit.value !== inning) return 0;
  return hit.ring === 'triple' ? 3 : hit.ring === 'double' ? 2 : 1;
}

export const baseballEngine: DisciplineEngine<BaseballState, DartHit[]> = {
  meta: {
    id: 'baseball',
    name: 'BASEBALL',
    description: `${BASEBALL_INNINGS}イニング・各回そのナンバーのみ加点`,
    inputMode: 'dart-hits',
    unit: 'runs',
  },

  createState: (): BaseballState => ({
    inning: 1,
    runs: 0,
    darts: 0,
    finished: false,
    innings: [],
  }),

  applyInput(state, hits) {
    if (state.finished) return state;
    const gained = hits.reduce((sum, hit) => sum + baseballRuns(state.inning, hit), 0);
    const inning = state.inning + 1;
    return {
      inning,
      runs: state.runs + gained,
      darts: state.darts + hits.length,
      finished: inning > BASEBALL_INNINGS,
      innings: [...state.innings, gained],
    };
  },

  isFinished: (state) => state.finished,

  getResult: (state): DisciplineResult => ({
    value: state.runs,
    unit: 'runs',
    completed: state.finished,
    darts: state.darts,
    label: `${state.runs} RUNS`,
  }),

  // More runs wins.
  compareResults: (a, b): CompareOutcome => {
    if (a.value > b.value) return 'p0';
    if (b.value > a.value) return 'p1';
    return 'draw';
  },

  describeTarget: (state) => (state.finished ? 'FINISHED' : `INNING ${state.inning} (${state.inning})`),

  dartsRemainingThisTurn: () => 3,

  // Tied after inning 9: extend into extra innings (10, 11, ...) up to BASEBALL_MAX_INNINGS, per the
  // standard tie rule (see docs/pentathlon-rules.md). Beyond the cap, accept the draw.
  continueOnTie: (a, b): [BaseballState, BaseballState] | null => {
    if (a.inning > BASEBALL_MAX_INNINGS || b.inning > BASEBALL_MAX_INNINGS) return null;
    return [extendForExtraInnings(a), extendForExtraInnings(b)];
  },
};

/** Extends a tied Baseball result into extra innings (10th, 11th, ...), per the standard tie rule. */
export function extendForExtraInnings(state: BaseballState): BaseballState {
  if (state.inning > BASEBALL_MAX_INNINGS) return state;
  return { ...state, finished: false };
}
