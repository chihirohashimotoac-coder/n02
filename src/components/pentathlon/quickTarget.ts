import { HALF_IT_TARGETS, type HalfItState, type HalfItTarget } from '../../domain/pentathlon/engines/halfIt';
import type { BaseballState } from '../../domain/pentathlon/engines/baseball';
import type { GolfState } from '../../domain/pentathlon/engines/golf';
import { RTC_TARGET_COUNT, rtcAdvances, type RtcDoublesState } from '../../domain/pentathlon/engines/rtcDoubles';
import type { DartHit } from '../../domain/darts';
import type { DisciplineId } from '../../domain/pentathlon/types';

/**
 * What a turn can score against, reduced to exactly the choices that matter this turn. Replaces the
 * old "pick any of 20 numbers, then pick S/D/T" flow (two decisions for something that's usually
 * only one) with the smallest unambiguous input for each shape of target - which is also what makes
 * the current aim point obvious instead of buried in a 20-button grid.
 */
export type QuickTarget =
  | { kind: 'bull' }
  | { kind: 'double'; number: number }
  | {
      kind: 'number';
      number: number;
      /**
       * What each ring is worth this turn, shown under the ring name (Baseball: "1 RUN"/"2 RUN"/
       * "3 RUN"/"0 RUN"). Omitted where the ring name alone is the whole story (Golf/Half-It).
       */
      outcomes?: { single: string; double: string; triple: string; miss: string };
    }
  | { kind: 'any-ring'; ring: 'double' | 'triple' };

/**
 * Derives the current turn's QuickTarget for disciplines whose every target reduces to one of the
 * above shapes (Cork/Golf/Half-It/RTC-on-Doubles/Baseball). Returns null for disciplines that
 * genuinely need the full number x ring grid (Cricket) or once the discipline is finished.
 *
 * `pendingHits` are the darts already staged this turn but not yet committed. Every discipline here
 * except RTC-on-Doubles has one fixed target for the whole turn (Golf/Half-It only score the turn as
 * a whole once committed; Cork is always bull), so they ignore it. RTC-on-Doubles is the exception:
 * hitting D1 then D2 within the SAME turn legitimately advances the target twice before committing
 * (see rtcDoubles.ts / engines.test.ts's "advances multiple targets within one 3-dart turn"), so the
 * pad has to preview that advancement rather than showing a stale target for darts 2 and 3.
 */
export function deriveQuickTarget(
  disciplineId: DisciplineId,
  state: unknown,
  pendingHits: readonly DartHit[] = [],
): QuickTarget | null {
  switch (disciplineId) {
    case 'cork':
      return { kind: 'bull' };

    case 'golf': {
      const s = state as GolfState;
      return s.finished ? null : { kind: 'number', number: s.hole };
    }

    case 'rtc-doubles': {
      const s = state as RtcDoublesState;
      if (s.finished) return null;
      // Clamped: once staged darts already reach the last target (or run past it - the engine
      // simply ignores darts thrown after completion), keep showing the bull pad rather than
      // falling back to the full grid for the turn's last dart or two.
      const targetIndex = previewRtcTargetIndex(s.targetIndex, pendingHits);
      if (targetIndex >= RTC_TARGET_COUNT - 1) return { kind: 'bull' };
      return { kind: 'double', number: targetIndex + 1 };
    }

    case 'half-it': {
      const s = state as HalfItState;
      return s.finished ? null : halfItQuickTarget(HALF_IT_TARGETS[s.round - 1]);
    }

    case 'baseball': {
      const s = state as BaseballState;
      if (s.finished) return null;
      // Inning N only ever scores on number N, so the number is never the player's decision - the
      // only thing to record per dart is which ring it landed in, and what that is worth.
      return {
        kind: 'number',
        number: s.inning,
        outcomes: { single: '1 RUN', double: '2 RUN', triple: '3 RUN', miss: '0 RUN' },
      };
    }

    default:
      return null;
  }
}

/** Read-only replay of rtcAdvances() over this turn's already-staged darts, for display only. */
function previewRtcTargetIndex(targetIndex: number, pendingHits: readonly DartHit[]): number {
  let index = targetIndex;
  for (const hit of pendingHits) {
    if (index >= RTC_TARGET_COUNT) break;
    if (rtcAdvances(index, hit)) index += 1;
  }
  return index;
}

function halfItQuickTarget(target: HalfItTarget): QuickTarget {
  switch (target.kind) {
    case 'number':
      return { kind: 'number', number: target.value };
    case 'bull':
      return { kind: 'bull' };
    case 'any-double':
      return { kind: 'any-ring', ring: 'double' };
    case 'any-triple':
      return { kind: 'any-ring', ring: 'triple' };
  }
}

/**
 * The "what am I aiming at right now" banner shown above the pad. Split into three parts so the
 * target itself can be the largest thing on screen, rather than a phrase the player has to read.
 */
export interface AimDisplay {
  /** Where in the discipline we are, e.g. "第1イニング", "第3ホール". Null when it has no phases. */
  phase: string | null;
  /** The single most prominent thing to hit: "1", "D7", "BULL", "ダブル". */
  target: string;
  /** One line spelling out what counts this turn. */
  hint: string;
}

export function describeAim(
  disciplineId: DisciplineId,
  state: unknown,
  target: QuickTarget | null,
): AimDisplay | null {
  if (!target) return null;
  switch (disciplineId) {
    case 'baseball': {
      const s = state as BaseballState;
      return {
        phase: `第${s.inning}イニング`,
        target: String(s.inning),
        hint: `${s.inning}のシングル・ダブル・トリプルを狙ってください`,
      };
    }
    case 'cork': {
      return {
        phase: null,
        target: 'BULL',
        hint: 'ブルを狙ってください（インナー2本・アウター1本）',
      };
    }
    case 'golf': {
      const s = state as GolfState;
      return {
        phase: `第${s.hole}ホール`,
        target: String(s.hole),
        hint: `${s.hole}を狙ってください（ダブル1打・トリプル2打・シングル3打・ミス5打）`,
      };
    }
    case 'rtc-doubles': {
      const label = target.kind === 'bull' ? 'BULL' : target.kind === 'double' ? `D${target.number}` : '';
      return {
        phase: null,
        target: label,
        hint:
          target.kind === 'bull'
            ? '最後はブル（アウター・インナーどちらでも可）です'
            : `${label} に入ると次のターゲットへ進みます`,
      };
    }
    case 'half-it': {
      const s = state as HalfItState;
      const label =
        target.kind === 'bull'
          ? 'BULL'
          : target.kind === 'any-ring'
            ? target.ring === 'double'
              ? 'ダブル'
              : 'トリプル'
            : String((target as { number: number }).number);
      return {
        phase: `第${s.round}ラウンド`,
        target: label,
        hint:
          target.kind === 'any-ring'
            ? `どのナンバーでもよいので${label}を狙ってください`
            : `${label} を狙ってください（3投とも外すと持ち点が半分になります）`,
      };
    }
    default:
      return null;
  }
}
