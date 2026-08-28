import type { DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

export const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15] as const;
/** Not a rule - just a practical safety net so a degenerate game (both missing almost everything)
 * can't run forever in the UI. Real Cricket has no such cap; the win condition below ends any
 * realistically-played game on its own. */
export const CRICKET_ROUND_LIMIT = 30;
const MARKS_TO_CLOSE = 3;
/**
 * How many of the seven targets either side must have closed for the "80%" stat window to shut.
 * Six of seven is roughly 80% of the board, which is the point DARTSLIVE freezes cricket stats at
 * (per the user's specification: whichever player gets there first closes the window for both).
 */
const STAT_80_TARGETS = 6;

export type CricketTarget = (typeof CRICKET_NUMBERS)[number] | 'BULL';
export const CRICKET_TARGETS: readonly CricketTarget[] = [...CRICKET_NUMBERS, 'BULL'];

export interface CricketPlayerView {
  /** Marks accrued per target, capped at 3 (opened); further hits become points instead. */
  marks: Record<string, number>;
  points: number;
  darts: number;
  round: number;
  /**
   * Marks that did something: the ones that opened a number, plus the ones that scored. A mark on a
   * number this player has already opened AND the opponent has already closed is dead - it neither
   * opens nor scores - and is the only kind left out. Drives MPR.
   *
   * `undefined` means "not tracked": a game saved before MPR existed carries marks and points but
   * no running total, and `points` alone cannot be decomposed back into which marks scored. Such a
   * game keeps playing normally and simply reports no MPR, rather than a total that silently omits
   * every round played before the upgrade.
   */
  effectiveMarks?: number;
  /** effectiveMarks / rounds frozen at the 80% window, or null while the window is still open. */
  marks80?: number | null;
  rounds80?: number | null;
}

/**
 * Standard head-to-head Cricket (the same rules used by mainstream soft-tip machines and steel-tip
 * play): each side is a mirror of the shared board from its own point of view. `self` is always
 * "the player this state belongs to"; `opponent` is the other player's marks/points as of their last
 * turn. Territory denial is the point of the game - a number only pays out for `self` while
 * `opponent` hasn't also closed it (marks < 3); once both have closed a number, it is dead for both.
 */
export interface CricketState {
  self: CricketPlayerView;
  opponent: CricketPlayerView;
  finished: boolean;
  winner: 'self' | 'opponent' | null;
}

function emptyView(): CricketPlayerView {
  return {
    marks: Object.fromEntries(CRICKET_TARGETS.map((t) => [String(t), 0])),
    points: 0,
    darts: 0,
    round: 1,
    effectiveMarks: 0,
    marks80: null,
    rounds80: null,
  };
}

/** How many of the seven targets this view has closed. */
export function cricketClosedCount(view: CricketPlayerView): number {
  return CRICKET_TARGETS.filter((target) => isCricketClosed(view, target)).length;
}

/**
 * Marks per round. The 80% window covers the rounds up to and including the one in which either
 * player reached six closed targets; the 100% figure covers every round the player threw. A player
 * whose game ended before the window ever shut reports the same rounds for both.
 */
export function cricketMpr(view: CricketPlayerView, window: '80' | '100'): number | null {
  // Resumed from a save that predates MPR: the earlier rounds' marks are unrecoverable, so there is
  // no honest figure to give.
  if (view.effectiveMarks === undefined) return null;
  const roundsPlayed = view.round - 1;
  if (window === '80' && view.rounds80 != null && view.marks80 != null) {
    return view.rounds80 > 0 ? view.marks80 / view.rounds80 : null;
  }
  if (roundsPlayed <= 0) return null;
  return (view.effectiveMarks ?? 0) / roundsPlayed;
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

export function isCricketClosed(view: CricketPlayerView, target: CricketTarget): boolean {
  return (view.marks[String(target)] ?? 0) >= MARKS_TO_CLOSE;
}

export function allCricketClosed(view: CricketPlayerView): boolean {
  return CRICKET_TARGETS.every((target) => isCricketClosed(view, target));
}

export const cricketEngine: DisciplineEngine<CricketState, DartHit[]> = {
  meta: {
    id: 'cricket',
    name: 'CRICKET',
    description: '20-15 & BULLを3マークでオープン・相手にクローズされると加点不可',
    inputMode: 'dart-hits',
    unit: 'points',
  },

  createState: (): CricketState => ({
    self: emptyView(),
    opponent: emptyView(),
    finished: false,
    winner: null,
  }),

  applyInput(state, hits) {
    if (state.finished) return state;
    const marks = { ...state.self.marks };
    let points = state.self.points;
    // Absent on a pre-MPR save; stays absent so the stat reads as unavailable rather than as a
    // total that starts counting only from the resume point.
    const tracksMarks = state.self.effectiveMarks !== undefined;
    let effective = state.self.effectiveMarks ?? 0;

    for (const hit of hits) {
      const scored = cricketMarks(hit);
      if (!scored) continue;
      const key = String(scored.target);
      const current = marks[key] ?? 0;
      const remainingToClose = Math.max(0, MARKS_TO_CLOSE - current);
      const closingMarks = Math.min(remainingToClose, scored.marks);
      const scoringMarks = scored.marks - closingMarks;
      marks[key] = current + closingMarks;
      // Territory denial: only pays out while the opponent hasn't also closed this number.
      const opponentMarks = state.opponent.marks[key] ?? 0;
      const paid = scoringMarks > 0 && opponentMarks < MARKS_TO_CLOSE;
      if (paid) points += scoringMarks * cricketTargetValue(scored.target);
      // Opening marks always count; surplus marks count only where they actually scored.
      effective += closingMarks + (paid ? scoringMarks : 0);
    }

    // The round just thrown, before `round` advances to the next one.
    const roundsPlayed = state.self.round;
    const self: CricketPlayerView = {
      marks,
      points,
      // A Cricket turn is always three darts. The input only records the darts that landed in a
      // scoring area (a miss is simply not entered, as on n01's board), so `hits` undercounts the
      // turn - the round itself is what costs three darts.
      darts: state.self.darts + 3,
      round: state.self.round + 1,
      effectiveMarks: tracksMarks ? effective : undefined,
      marks80: state.self.marks80 ?? null,
      rounds80: state.self.rounds80 ?? null,
    };

    // Shut the 80% window at the end of the round in which either side reached six closed targets.
    if (
      tracksMarks &&
      self.rounds80 == null &&
      (cricketClosedCount(self) >= STAT_80_TARGETS || cricketClosedCount(state.opponent) >= STAT_80_TARGETS)
    ) {
      self.marks80 = effective;
      self.rounds80 = roundsPlayed;
    }

    let finished = false;
    let winner: 'self' | 'opponent' | null = null;
    if (allCricketClosed(self) && points >= state.opponent.points) {
      finished = true;
      winner = 'self';
    } else if (self.round > CRICKET_ROUND_LIMIT) {
      finished = true;
      winner = points > state.opponent.points ? 'self' : points < state.opponent.points ? 'opponent' : null;
    }

    return { self, opponent: state.opponent, finished, winner };
  },

  // Mirrors the just-applied turn into the other player's own point of view: their unchanged marks/
  // points become "self", and the active player's freshly-updated view becomes "opponent" - so e.g. a
  // number the active player just closed now correctly blocks the other player's future scoring there.
  mirrorForOpponent(state): CricketState {
    const winner = state.winner === 'self' ? 'opponent' : state.winner === 'opponent' ? 'self' : null;
    return { self: state.opponent, opponent: state.self, finished: state.finished, winner };
  },

  isFinished: (state) => state.finished,

  getResult(state): DisciplineResult {
    const closed = allCricketClosed(state.self);
    const mpr80 = cricketMpr(state.self, '80');
    const mpr100 = cricketMpr(state.self, '100');
    return {
      value: state.self.points,
      unit: 'points',
      completed: closed,
      darts: state.self.darts,
      label: closed ? `${state.self.points} POINTS` : `${state.self.points} PTS (未クローズ)`,
      // Cricket is judged on marks, not darts, so the result table shows MPR in place of the
      // dart count: the 80% figure headline, the full-game figure underneath.
      stat: {
        label: 'STATS',
        primary: mpr80 === null ? '—' : mpr80.toFixed(2),
        primaryNote: 'MPR 80%',
        secondary: mpr100 === null ? '—' : `${mpr100.toFixed(2)} (100%)`,
      },
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
    const open = CRICKET_TARGETS.filter((t) => !isCricketClosed(state.self, t));
    return open.length ? open.map(String).join(' ') : 'FINISHED';
  },

  dartsRemainingThisTurn: () => 3,
};
