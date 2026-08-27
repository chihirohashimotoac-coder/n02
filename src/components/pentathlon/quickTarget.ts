import { HALF_IT_TARGETS, type HalfItState, type HalfItTarget } from '../../domain/pentathlon/engines/halfIt';
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
  | { kind: 'number'; number: number }
  | { kind: 'any-ring'; ring: 'double' | 'triple' };

/**
 * Derives the current turn's QuickTarget for disciplines whose every target reduces to one of the
 * above shapes (Cork/Golf/Half-It/RTC-on-Doubles). Returns null for disciplines that genuinely need
 * the full number x ring grid (Baseball, Cricket) or once the discipline is finished.
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
