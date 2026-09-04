/**
 * COUNT-UP domain logic for the PRACTICE hub.
 *
 * Deliberately standalone: it shares no state, no storage and no code path with the existing 01 /
 * checkout engine (x01Engine.ts, x01Core.ts) or with Pentathlon. COUNT-UP has no bust, no double-out
 * and no checkout, so nothing in the X01 resolver applies here; keeping the two apart is what
 * guarantees this feature cannot change any existing mode's behaviour.
 *
 * The round history (`players[].scores`) is the single source of truth. Totals, PPR, award counts
 * and the winner are always recomputed from it, so correcting a past round can never leave a stale
 * aggregate behind (award-count drift).
 */

/** COUNT-UP is fixed at 8 rounds of 3 darts - there is no round-count setting. */
export const COUNT_UP_ROUNDS = 8;
export const COUNT_UP_DARTS_PER_ROUND = 3;
export const MIN_ROUND_SCORE = 0;
/** A round total is 3 darts, so 3 × T20 = 180 is the ceiling. */
export const MAX_ROUND_SCORE = 180;

/**
 * SEPARATE BULL (inner 50 / outer 25) vs FAT BULL (both 50). Round totals are entered directly, so
 * this setting does not change any arithmetic - it only decides which award a 150 round is.
 */
export type BullMode = 'separate' | 'fat';

export type AwardKind = 'LOW_TON' | 'HIGH_TON' | 'TON_80' | 'HAT_TRICK' | 'THREE_IN_THE_BLACK';

export const AWARD_KINDS: readonly AwardKind[] = [
  'LOW_TON',
  'HIGH_TON',
  'TON_80',
  'HAT_TRICK',
  'THREE_IN_THE_BLACK',
] as const;

export const AWARD_LABELS: Record<AwardKind, string> = {
  LOW_TON: 'LOW TON',
  HIGH_TON: 'HIGH TON',
  TON_80: 'TON 80',
  HAT_TRICK: 'HAT TRICK',
  THREE_IN_THE_BLACK: 'THREE IN THE BLACK',
};

export type AwardCounts = Record<AwardKind, number>;

export type PlayerIndex = 0 | 1;

export interface CountUpSettings {
  playerCount: 1 | 2;
  /** Always two slots so 「SAME SETTINGS」 can keep player 2's name across a 1-player game. */
  names: [string, string];
  bullMode: BullMode;
}

export interface CountUpPlayer {
  name: string;
  /** Committed round totals, oldest first. Length is how many rounds that player has completed. */
  scores: number[];
}

export interface CountUpState {
  settings: CountUpSettings;
  players: CountUpPlayer[];
}

export class InvalidRoundScoreError extends Error {}

export const ROUND_SCORE_MESSAGE = `ラウンド得点は${MIN_ROUND_SCORE}〜${MAX_ROUND_SCORE}の整数で入力してください。`;

/** Trims a configured name, falling back to PLAYER 1 / PLAYER 2 for blank or whitespace-only input. */
export function normalizeName(name: string, index: PlayerIndex): string {
  const trimmed = name.trim();
  return trimmed === '' ? `PLAYER ${index + 1}` : trimmed;
}

export function defaultCountUpSettings(): CountUpSettings {
  return { playerCount: 1, names: ['', ''], bullMode: 'separate' };
}

export function createCountUpGame(settings: CountUpSettings): CountUpState {
  const indexes: PlayerIndex[] = settings.playerCount === 2 ? [0, 1] : [0];
  return {
    settings: { ...settings, names: [...settings.names] as [string, string] },
    players: indexes.map((index) => ({ name: normalizeName(settings.names[index], index), scores: [] })),
  };
}

/** True for an integer in 0...180. Everything else (NaN, decimals, negatives, 181+) is rejected. */
export function isValidRoundScore(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_ROUND_SCORE &&
    value <= MAX_ROUND_SCORE
  );
}

/** Parses raw keypad/input text, returning null for anything that is not a valid round score. */
export function parseRoundScore(raw: string): number | null {
  const text = raw.trim();
  // Number('') is 0 and Number(' 12 ') is 12, so the shape is checked before the conversion.
  if (!/^\d{1,3}$/.test(text)) return null;
  const value = Number(text);
  return isValidRoundScore(value) ? value : null;
}

export function playerIndexes(state: CountUpState): PlayerIndex[] {
  return state.players.length === 2 ? [0, 1] : [0];
}

/** How many rounds that player has completed. */
export function completedRounds(state: CountUpState, player: PlayerIndex): number {
  return state.players[player]?.scores.length ?? 0;
}

/** Total visits entered so far - 8 for a finished solo game, 16 for a finished 2-player game. */
export function totalEntries(state: CountUpState): number {
  return state.players.reduce((sum, player) => sum + player.scores.length, 0);
}

export function isFinished(state: CountUpState): boolean {
  return state.players.every((player) => player.scores.length >= COUNT_UP_ROUNDS);
}

/**
 * Whose turn it is. Play runs P1 → P2 within a round, so the player who is behind on rounds throws;
 * when both are level, player 1 opens the next round.
 */
export function activePlayer(state: CountUpState): PlayerIndex {
  if (state.players.length === 1) return 0;
  return state.players[0].scores.length <= state.players[1].scores.length ? 0 : 1;
}

/** The round now being thrown, 1...8 (stays at 8 once the game is finished). */
export function currentRound(state: CountUpState): number {
  if (isFinished(state)) return COUNT_UP_ROUNDS;
  return Math.min(COUNT_UP_ROUNDS, completedRounds(state, activePlayer(state)) + 1);
}

export function totalScore(state: CountUpState, player: PlayerIndex): number {
  return (state.players[player]?.scores ?? []).reduce((sum, score) => sum + score, 0);
}

/** PPR = total score / completed rounds. 0 rounds is 0, never NaN or Infinity. */
export function pointsPerRound(state: CountUpState, player: PlayerIndex): number {
  const rounds = completedRounds(state, player);
  if (rounds === 0) return 0;
  return totalScore(state, player) / rounds;
}

export function formatPpr(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

/**
 * The single award a round total earns, or null. At most one category per round: a 150 is only ever
 * the bull award for the configured BULL setting, never also a LOW TON.
 */
export function awardForScore(score: number, bullMode: BullMode): AwardKind | null {
  if (!isValidRoundScore(score)) return null;
  if (score === MAX_ROUND_SCORE) return 'TON_80';
  if (score === 150) return bullMode === 'fat' ? 'HAT_TRICK' : 'THREE_IN_THE_BLACK';
  if (score >= 151) return 'HIGH_TON';
  if (score >= 100) return 'LOW_TON';
  return null;
}

export function emptyAwardCounts(): AwardCounts {
  return { LOW_TON: 0, HIGH_TON: 0, TON_80: 0, HAT_TRICK: 0, THREE_IN_THE_BLACK: 0 };
}

/** Award counts recomputed from the player's whole round history - never incrementally adjusted. */
export function awardCounts(state: CountUpState, player: PlayerIndex): AwardCounts {
  const counts = emptyAwardCounts();
  for (const score of state.players[player]?.scores ?? []) {
    const award = awardForScore(score, state.settings.bullMode);
    if (award) counts[award] += 1;
  }
  return counts;
}

/** Commits the active player's round total. Returns a new state; the input state is untouched. */
export function applyRoundScore(state: CountUpState, score: number): CountUpState {
  if (isFinished(state)) throw new InvalidRoundScoreError('このCOUNT-UPはすでに終了しています。');
  if (!isValidRoundScore(score)) throw new InvalidRoundScoreError(ROUND_SCORE_MESSAGE);

  const player = activePlayer(state);
  return {
    ...state,
    players: state.players.map((entry, index) =>
      index === player ? { ...entry, scores: [...entry.scores, score] } : entry,
    ),
  };
}

/**
 * Corrects one already-entered round. Aggregates are derived from the history, so nothing else has
 * to be patched up - and this deliberately never reports an award, so a correction cannot replay
 * the award presentation.
 */
export function editRoundScore(
  state: CountUpState,
  player: PlayerIndex,
  roundIndex: number,
  score: number,
): CountUpState {
  const target = state.players[player];
  if (!target || roundIndex < 0 || roundIndex >= target.scores.length) {
    throw new InvalidRoundScoreError('修正できるラウンドが見つかりません。');
  }
  if (!isValidRoundScore(score)) throw new InvalidRoundScoreError(ROUND_SCORE_MESSAGE);

  return {
    ...state,
    players: state.players.map((entry, index) =>
      index === player
        ? { ...entry, scores: entry.scores.map((value, i) => (i === roundIndex ? score : value)) }
        : entry,
    ),
  };
}

/** The player whose entry would be undone, or null when nothing has been entered yet. */
export function lastEnteredPlayer(state: CountUpState): PlayerIndex | null {
  if (totalEntries(state) === 0) return null;
  if (state.players.length === 1) return 0;
  // P1 → P2 within a round, so the player who is ahead on rounds threw last.
  return state.players[1].scores.length >= state.players[0].scores.length ? 1 : 0;
}

export function canUndo(state: CountUpState): boolean {
  return lastEnteredPlayer(state) !== null;
}

/** Takes back the most recent round entry. A no-op when nothing has been entered. */
export function undoLastRound(state: CountUpState): CountUpState {
  const player = lastEnteredPlayer(state);
  if (player === null) return state;
  return {
    ...state,
    players: state.players.map((entry, index) =>
      index === player ? { ...entry, scores: entry.scores.slice(0, -1) } : entry,
    ),
  };
}

export type CountUpOutcome = { kind: 'solo' } | { kind: 'winner'; player: PlayerIndex } | { kind: 'draw' };

/**
 * The result of a finished 2-player game, decided purely on TOTAL - PPR and award counts are never
 * tiebreakers. A solo game has no winner at all.
 */
export function outcome(state: CountUpState): CountUpOutcome | null {
  if (!isFinished(state)) return null;
  if (state.players.length === 1) return { kind: 'solo' };
  const first = totalScore(state, 0);
  const second = totalScore(state, 1);
  if (first === second) return { kind: 'draw' };
  return { kind: 'winner', player: first > second ? 0 : 1 };
}
