import { dartScore, type DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

/** Round targets, per docs/pentathlon-rules.md. */
export type HalfItTarget =
  | { kind: 'number'; value: number }
  | { kind: 'any-double' }
  | { kind: 'any-triple' }
  | { kind: 'bull' };

export const HALF_IT_TARGETS: readonly HalfItTarget[] = [
  { kind: 'number', value: 15 },
  { kind: 'number', value: 16 },
  { kind: 'any-double' },
  { kind: 'number', value: 17 },
  { kind: 'number', value: 18 },
  { kind: 'any-triple' },
  { kind: 'number', value: 19 },
  { kind: 'number', value: 20 },
  { kind: 'bull' },
];

export const HALF_IT_START_SCORE = 40;

export interface HalfItState {
  score: number;
  round: number;
  darts: number;
  finished: boolean;
  rounds: Array<{ target: HalfItTarget; gained: number; halved: boolean; scoreAfter: number }>;
}

export function halfItTargetLabel(target: HalfItTarget): string {
  switch (target.kind) {
    case 'number':
      return String(target.value);
    case 'any-double':
      return 'ANY DOUBLE';
    case 'any-triple':
      return 'ANY TRIPLE';
    case 'bull':
      return 'BULL';
  }
}

/** Score contributed by one dart against a round's target (0 if it doesn't count). */
export function halfItDartValue(target: HalfItTarget, hit: DartHit): number {
  switch (target.kind) {
    case 'number':
      return hit.kind === 'number' && hit.value === target.value ? dartScore(hit) : 0;
    case 'any-double':
      return hit.kind === 'number' && hit.ring === 'double' ? dartScore(hit) : 0;
    case 'any-triple':
      return hit.kind === 'number' && hit.ring === 'triple' ? dartScore(hit) : 0;
    case 'bull':
      return hit.kind === 'bull' ? dartScore(hit) : 0;
  }
}

export const halfItEngine: DisciplineEngine<HalfItState, DartHit[]> = {
  meta: {
    id: 'half-it',
    name: 'HALF-IT',
    description: '9ラウンド・外すと持ち点が半分',
    inputMode: 'dart-hits',
    unit: 'points',
  },

  createState: (): HalfItState => ({
    score: HALF_IT_START_SCORE,
    round: 1,
    darts: 0,
    finished: false,
    rounds: [],
  }),

  applyInput(state, hits) {
    if (state.finished) return state;
    const target = HALF_IT_TARGETS[state.round - 1];
    const gained = hits.reduce((sum, hit) => sum + halfItDartValue(target, hit), 0);
    const halved = gained === 0;
    // Halving rounds down (see docs/pentathlon-rules.md - rounding direction is an documented
    // implementation choice, not an independently confirmed rule).
    const scoreAfter = halved ? Math.floor(state.score / 2) : state.score + gained;
    const round = state.round + 1;
    return {
      score: scoreAfter,
      round,
      darts: state.darts + hits.length,
      finished: round > HALF_IT_TARGETS.length,
      rounds: [...state.rounds, { target, gained, halved, scoreAfter }],
    };
  },

  isFinished: (state) => state.finished,

  getResult: (state): DisciplineResult => ({
    value: state.score,
    unit: 'points',
    completed: state.finished,
    darts: state.darts,
    label: `${state.score} POINTS`,
  }),

  // Higher score wins.
  compareResults: (a, b): CompareOutcome => {
    if (a.value > b.value) return 'p0';
    if (b.value > a.value) return 'p1';
    return 'draw';
  },

  describeTarget(state) {
    if (state.finished) return 'FINISHED';
    return halfItTargetLabel(HALF_IT_TARGETS[state.round - 1]);
  },

  dartsRemainingThisTurn: () => 3,
};
