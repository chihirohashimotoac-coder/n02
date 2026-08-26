import type { DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

export const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15] as const;
export const CRICKET_ROUND_LIMIT = 20;
const MARKS_TO_CLOSE = 3;

export type CricketTarget = (typeof CRICKET_NUMBERS)[number] | 'BULL';
export const CRICKET_TARGETS: readonly CricketTarget[] = [...CRICKET_NUMBERS, 'BULL'];

export interface CricketState {
  /** Marks accrued per target (capped at 3 for closing; extra marks convert to points). */
  marks: Record<string, number>;
  points: number;
  round: number;
  darts: number;
  finished: boolean;
}

/** Marks contributed by one dart (Single=1, Double=2, Triple=3), or null if it hits nothing relevant. */
export function cricketMarks(hit: DartHit): { target: CricketTarget; marks: number } | null {
  if (hit.kind === 'bull') return { target: 'BULL', marks: hit.ring === 'inner' ? 2 : 1 };
  if (hit.kind !== 'number') return null;
  if (!(CRICKET_NUMBERS as readonly number[]).includes(hit.value)) return null;
  const marks = hit.ring === 'triple' ? 3 : hit.ring === 'double' ? 2 : 1;
  return { target: hit.value as CricketTarget, marks };
}

export function cricketTargetValue(target: CricketTarget): number {
  return target === 'BULL' ? 25 : target;
}

export function isCricketClosed(state: CricketState, target: CricketTarget): boolean {
  return (state.marks[String(target)] ?? 0) >= MARKS_TO_CLOSE;
}

export function allCricketClosed(state: CricketState): boolean {
  return CRICKET_TARGETS.every((target) => isCricketClosed(state, target));
}

/**
 * Each player plays their own independent Cricket attempt: they open their own numbers and score on
 * them, and the opponent cannot close them out. This is what makes "each player completes their own
 * official result" possible (and is the only form that works in 1-player mode); it does mean the
 * head-to-head territory-denial dynamic of tournament Cricket is not modelled. See
 * docs/pentathlon-rules.md.
 */
export const cricketEngine: DisciplineEngine<CricketState, DartHit[]> = {
  meta: {
    id: 'cricket',
    name: 'CRICKET',
    description: '20-15 & BULL を3マークでオープン',
    inputMode: 'dart-hits',
    unit: 'points',
  },

  createState: (): CricketState => ({
    marks: Object.fromEntries(CRICKET_TARGETS.map((t) => [String(t), 0])),
    points: 0,
    round: 1,
    darts: 0,
    finished: false,
  }),

  applyInput(state, hits) {
    if (state.finished) return state;
    const marks = { ...state.marks };
    let points = state.points;

    for (const hit of hits) {
      const scored = cricketMarks(hit);
      if (!scored) continue;
      const key = String(scored.target);
      const current = marks[key] ?? 0;
      const remainingToClose = Math.max(0, MARKS_TO_CLOSE - current);
      const closingMarks = Math.min(remainingToClose, scored.marks);
      const scoringMarks = scored.marks - closingMarks;
      marks[key] = current + closingMarks;
      if (scoringMarks > 0) points += scoringMarks * cricketTargetValue(scored.target);
    }

    const round = state.round + 1;
    const next: CricketState = {
      marks,
      points,
      round,
      darts: state.darts + hits.length,
      finished: false,
    };
    next.finished = allCricketClosed(next) || round > CRICKET_ROUND_LIMIT;
    return next;
  },

  isFinished: (state) => state.finished,

  getResult(state): DisciplineResult {
    const closed = allCricketClosed(state);
    return {
      value: state.points,
      unit: 'points',
      completed: closed,
      darts: state.darts,
      label: closed ? `${state.points} POINTS` : `${state.points} PTS (未クローズ)`,
    };
  },

  // Closing every number outranks points; among equal closing status, more points wins.
  compareResults: (a, b): CompareOutcome => {
    if (a.completed && !b.completed) return 'p0';
    if (!a.completed && b.completed) return 'p1';
    if (a.value > b.value) return 'p0';
    if (b.value > a.value) return 'p1';
    return 'draw';
  },

  describeTarget(state) {
    if (state.finished) return 'FINISHED';
    const open = CRICKET_TARGETS.filter((t) => !isCricketClosed(state, t));
    return open.length ? open.map(String).join(' ') : 'FINISHED';
  },

  dartsRemainingThisTurn: () => 3,
};
