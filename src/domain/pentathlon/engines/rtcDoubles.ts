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
      name: 'ON DOUBLES',
      description: 'D1→D20→BULL の順に攻略',
      inputMode: 'dart-hits',
      unit: 'darts',
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
      return {
        value: completed ? state.darts : Number.POSITIVE_INFINITY,
        unit: 'darts',
        completed,
        darts: state.darts,
        label: completed ? `${state.darts} DARTS` : `${state.targetIndex} / ${RTC_TARGET_COUNT}`,
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

    dartsRemainingThisTurn: () => 3,
  };
}
