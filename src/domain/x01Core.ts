import { isCheckoutPossible, isReachableScore, validFinishDartCounts, MAX_VISIT_SCORE } from './darts';

export interface VisitResolution {
  after: number;
  bust: boolean;
  checkout: boolean;
  darts: number;
}

export class InvalidVisitError extends Error {}

/**
 * The single source of truth for "what happens when a player scores `enteredScore` this visit from
 * `remaining`" - shared by the existing 2-player match engine (x01Engine.ts) and the independent
 * per-player Pentathlon X01 attempts (pentathlon/engines/x01Solo.ts), so the bust/checkout/finish-darts
 * arithmetic is never duplicated between them.
 */
export function resolveVisit(remaining: number, enteredScore: number, finishDarts?: number): VisitResolution {
  if (!Number.isInteger(enteredScore) || enteredScore < 0 || enteredScore > MAX_VISIT_SCORE) {
    throw new InvalidVisitError(`得点は0～${MAX_VISIT_SCORE}の整数で入力してください。`);
  }
  if (!isReachableScore(enteredScore)) {
    throw new InvalidVisitError(`${enteredScore}は3投では出せない得点です。`);
  }

  // Double-out X01 busts the whole visit when the subtraction would leave 1: there is no
  // possible double that can finish it on a later dart. Keep this in the shared resolver so
  // normal 01, checkout practice and both Pentathlon X01 disciplines cannot drift apart.
  if (enteredScore > remaining || remaining - enteredScore === 1) {
    return { after: remaining, bust: true, checkout: false, darts: 3 };
  }

  if (enteredScore === remaining) {
    if (!isCheckoutPossible(remaining)) {
      throw new InvalidVisitError(`残り${remaining}は上がれない数字のため、上がり申告できません。`);
    }
    const validCounts = validFinishDartCounts(remaining);
    if (finishDarts === undefined || !validCounts.includes(finishDarts)) {
      throw new InvalidVisitError('上がり本数を選択してください。');
    }
    return { after: 0, bust: false, checkout: true, darts: finishDarts };
  }

  return { after: remaining - enteredScore, bust: false, checkout: false, darts: 3 };
}
