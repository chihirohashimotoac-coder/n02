/**
 * Award classification, shared by COUNT-UP, 通常01 and チェックアウト練習.
 *
 * Deliberately a small pure function beside the engines rather than anything inside them: no engine
 * calls into this, and this calls into no engine. A screen resolves the award for a visit it has
 * ALREADY committed and hands it to the presentation layer. Nothing here can change a score, a
 * remaining, a turn or a result.
 *
 * COUNT-UP's own classification is unchanged - countUp.ts still exposes awardForScore() with the
 * same signature and the same answers, now expressed through this function.
 */

/** SEPARATE BULL (inner 50 / outer 25) vs FAT BULL (both 50) - only decides what a 150 is. */
export type BullMode = 'separate' | 'fat';

/**
 * Every award the app can present.
 *
 * BIG_FISH is 通常01 / チェックアウト練習 only. COUNT-UP's stored history is keyed by award kind
 * (see storage/practiceStorage.ts) and must keep exactly the five it has always had, so COUNT-UP
 * uses the narrower CountUpAwardKind below rather than this union.
 */
export type AwardKind =
  | 'LOW_TON'
  | 'HIGH_TON'
  | 'TON_80'
  | 'HAT_TRICK'
  | 'THREE_IN_THE_BLACK'
  | 'BIG_FISH';

/** The five COUNT-UP has always recorded. BIG FISH is never one of them. */
export type CountUpAwardKind = Exclude<AwardKind, 'BIG_FISH'>;

export const AWARD_LABELS: Record<AwardKind, string> = {
  LOW_TON: 'LOW TON',
  HIGH_TON: 'HIGH TON',
  TON_80: 'TON 80',
  HAT_TRICK: 'HAT TRICK',
  THREE_IN_THE_BLACK: 'THREE IN THE BLACK',
  BIG_FISH: 'BIG FISH',
};

export const AWARD_SCORE_MIN = 0;
export const AWARD_SCORE_MAX = 180;

/**
 * What the visit was thrown in.
 *
 * 通常01 and チェックアウト練習 take a visit TOTAL, not three individual darts, so which three
 * segments made up a 150 is genuinely unknowable there. They therefore always classify on the
 * SEPARATE BULL side and call a 150 THREE IN THE BLACK, which is the same answer COUNT-UP gives on
 * its default setting - a deliberate compatibility choice, recorded here rather than left implicit.
 * HAT TRICK stays COUNT-UP-only, where the FAT BULL setting makes it meaningful.
 */
export type AwardMode = 'count-up' | 'x01';

export interface AwardContext {
  mode: AwardMode;
  /** COUNT-UP's configured BULL setting. 'x01' mode is always treated as 'separate'. */
  bullMode: BullMode;
  /** x01 only: the player's remaining at the START of the visit. */
  remainingBefore?: number;
  /** x01 only: did this visit check out? */
  checkout?: boolean;
}

/** A visit total that can actually be thrown with three darts. */
function isScoreInRange(score: unknown): score is number {
  return (
    typeof score === 'number' &&
    Number.isInteger(score) &&
    score >= AWARD_SCORE_MIN &&
    score <= AWARD_SCORE_MAX
  );
}

/**
 * The single award a visit earns, or null. At most one category per visit.
 *
 * Priority, highest first:
 *   1. TON 80              - 180
 *   2. BIG FISH            - x01 only: 170 thrown from exactly 170, and checked out
 *   3. THREE IN THE BLACK  - 150 on the SEPARATE BULL side (always so in x01)
 *   4. HAT TRICK           - 150 on COUNT-UP's FAT BULL setting
 *   5. HIGH TON            - 151-179, and a 170 that did not finish
 *   6. LOW TON             - 100-149
 *
 * The caller is responsible for not asking about a visit that never counted: a bust, an invalid
 * entry, an undone visit, or a mid-edit value. Those never reach here.
 */
export function classifyAward(score: number, context: AwardContext): AwardKind | null {
  if (!isScoreInRange(score)) return null;

  if (score === AWARD_SCORE_MAX) return 'TON_80';

  if (context.mode === 'x01') {
    // 170 is the highest possible checkout (T20 T20 BULL). It is only BIG FISH when it was thrown
    // AT 170 and actually finished the leg - a 170 scored from any other remaining, or one that did
    // not go out, is a HIGH TON like any other.
    if (score === 170 && context.remainingBefore === 170 && context.checkout === true) {
      return 'BIG_FISH';
    }
  }

  if (score === 150) {
    // x01 has no FAT BULL setting; it always classifies on the SEPARATE BULL side.
    const fat = context.mode === 'count-up' && context.bullMode === 'fat';
    return fat ? 'HAT_TRICK' : 'THREE_IN_THE_BLACK';
  }

  if (score >= 151) return 'HIGH_TON';
  if (score >= 100) return 'LOW_TON';
  return null;
}
