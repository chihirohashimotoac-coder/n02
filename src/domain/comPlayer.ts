import { MAX_VISIT_SCORE, isCheckoutPossible, isReachableScore, validFinishDartCounts } from './darts';

/**
 * A simple practice-opponent simulator. There is no official rule governing "COM strength" - this is
 * a deliberately simple implementation detail, not a competitive rule, so it favours a friendly,
 * plausible feel over statistical rigor.
 */
export function simulateComVisit(remaining: number, level: number): { score: number; finishDarts?: number } {
  const clampedLevel = Math.min(10, Math.max(1, Math.round(level)));
  const mean = 20 + clampedLevel * 8;
  const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 20;
  let raw = Math.max(0, Math.min(MAX_VISIT_SCORE, Math.round(mean + noise)));

  if (raw >= remaining && isCheckoutPossible(remaining)) {
    const attemptSucceeds = Math.random() < 0.3 + clampedLevel * 0.05;
    if (attemptSucceeds) {
      const counts = validFinishDartCounts(remaining);
      return { score: remaining, finishDarts: counts[0] };
    }
    raw = remaining > 2 ? remaining - 1 - Math.floor(Math.random() * Math.min(40, remaining - 1)) : 0;
  } else if (raw > remaining) {
    raw = Math.max(0, remaining - 2);
  }

  while (raw > 0 && !isReachableScore(raw)) raw -= 1;
  return { score: Math.max(0, raw) };
}
