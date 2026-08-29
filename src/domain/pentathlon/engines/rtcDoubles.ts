import type { DartHit } from '../../darts';
import type { CompareOutcome, DisciplineEngine, DisciplineResult } from '../types';

/** D1..D20 then Bull. */
export const RTC_TARGET_COUNT = 21;

export interface RtcDoublesState {
  /** 0-based index into the D1..D20,BULL sequence. */
  targetIndex: number;
  darts: number;
  finished: boolean;
  history: Array<{ targetIndex: number; hit: boolean }>;
}

export function rtcTargetLabel(targetIndex: number): string {
  if (targetIndex >= RTC_TARGET_COUNT) return 'FINISHED';
  return targetIndex === RTC_TARGET_COUNT - 1 ? 'BULL' : `D${targetIndex + 1}`;
}

/** Does this dart advance the player past the current target? */
export function rtcAdvances(targetIndex: number, hit: DartHit): boolean {
  if (targetIndex === RTC_TARGET_COUNT - 1) {
    // Final target: any bull counts (documented implementation choice - sources disagree on whether
    // the inner bull is required; see docs/pentathlon-rules.md).
    return hit.kind === 'bull';
  }
  return hit.kind === 'number' && hit.ring === 'double' && hit.value === targetIndex + 1;
}

/** True when these not-yet-committed darts reach the final Bull from the current target. */
export function rtcTurnCompletes(targetIndex: number, hits: readonly DartHit[]): boolean {
  let nextTarget = targetIndex;
  for (const hit of hits) {
    if (nextTarget >= RTC_TARGET_COUNT) return true;
    if (rtcAdvances(nextTarget, hit)) nextTarget += 1;
  }
  return nextTarget >= RTC_TARGET_COUNT;
}

/** Rounds are three darts each, so the round a player is on follows straight from their dart count. */
export function rtcCurrentRound(darts: number): number {
  return Math.floor(darts / 3) + 1;
}

/** Rounds actually thrown - a part-thrown round still counts as started. */
export function rtcRoundsThrown(darts: number): number {
  return Math.ceil(darts / 3);
}

export interface RtcDoublesOptions {
  /** Abandon the attempt after this many darts; 0 = unlimited. */
  dartLimit: number;
}

export function createRtcDoublesEngine(
  options: RtcDoublesOptions = { dartLimit: 0 },
): DisciplineEngine<RtcDoublesState, DartHit[]> {
  const { dartLimit } = options;

  return {
    meta: {
      id: 'rtc-doubles',
      name: 'Round-the-Clock ON DOUBLES',
      description: 'D1→D20→BULL の順に攻略・先にブルへ入れた方の勝ち',
      inputMode: 'dart-hits',
      unit: 'darts',
      // A race, per the user's rule: the first player to finish the clock by hitting the BULL wins
      // the discipline there and then, and the opponent stops throwing.
      endsOnFirstCompletion: true,
    },

    createState: (): RtcDoublesState => ({
      targetIndex: 0,
      darts: 0,
      finished: false,
      history: [],
    }),

    applyInput(state, hits) {
      if (state.finished) return state;
      let targetIndex = state.targetIndex;
      let darts = state.darts;
      const history = [...state.history];

      for (const hit of hits) {
        if (targetIndex >= RTC_TARGET_COUNT) break;
        darts += 1;
        const advanced = rtcAdvances(targetIndex, hit);
        history.push({ targetIndex, hit: advanced });
        if (advanced) targetIndex += 1;
      }

      const completed = targetIndex >= RTC_TARGET_COUNT;
      const outOfDarts = dartLimit > 0 && darts >= dartLimit;
      return { targetIndex, darts, finished: completed || outOfDarts, history };
    },

    isFinished: (state) => state.finished,

    getResult(state): DisciplineResult {
      const completed = state.targetIndex >= RTC_TARGET_COUNT;
      const rounds = rtcRoundsThrown(state.darts);
      return {
        value: completed ? state.darts : Number.POSITIVE_INFINITY,
        unit: 'darts',
        completed,
        darts: state.darts,
        // compareResults parses the leading number back out of an unfinished label - keep it first.
        label: completed
          ? `${state.darts} DARTS・${rounds}R`
          : `${state.targetIndex} / ${RTC_TARGET_COUNT}`,
        // How many rounds it took is the figure this discipline is followed by while playing, so
        // the result table reports it too rather than the dart count alone.
        stat: {
          label: 'ROUNDS',
          primary: String(rounds),
          secondary: `${state.darts} DARTS`,
        },
      };
    },

    // Fewer darts to complete the full clock wins; if neither completed, more targets reached wins.
    compareResults: (a, b): CompareOutcome => {
      if (a.completed && !b.completed) return 'p0';
      if (!a.completed && b.completed) return 'p1';
      if (a.completed && b.completed) {
        if (a.value < b.value) return 'p0';
        if (b.value < a.value) return 'p1';
        return 'draw';
      }
      // Neither finished: rank by targets reached (parsed back from the label's "n / 21" form).
      const reachedA = Number.parseInt(a.label, 10) || 0;
      const reachedB = Number.parseInt(b.label, 10) || 0;
      if (reachedA > reachedB) return 'p0';
      if (reachedB > reachedA) return 'p1';
      return 'draw';
    },

    describeTarget: (state) => rtcTargetLabel(state.targetIndex),

    // Open-ended: there is no round limit to count towards, so only the current round is shown.
    roundLabel: (state) =>
      `ROUND ${state.finished ? Math.max(1, rtcRoundsThrown(state.darts)) : rtcCurrentRound(state.darts)}`,

    dartsRemainingThisTurn: () => 3,
  };
}
