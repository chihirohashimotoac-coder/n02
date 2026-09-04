import {
  AWARD_KINDS,
  COUNT_UP_ROUNDS,
  emptyAwardCounts,
  isValidRoundScore,
  type AwardCounts,
  type AwardKind,
  type BullMode,
} from '../domain/practice/countUp';

/**
 * PRACTICE history lives under its own key. The pre-existing contracts (n02-current-v1,
 * n02-history-v1, n02-theme-v1, n02-pentathlon-v1, n02-pentathlon-single-v1) are never read or
 * written from here, so a COUNT-UP result can never appear in - or corrupt - the 01 history.
 */
export const COUNT_UP_HISTORY_KEY = 'n02-practice-countup-history-v1';

/** Only the most recent games are kept; older entries fall off the end. */
export const COUNT_UP_HISTORY_LIMIT = 10;

export interface CountUpHistoryPlayer {
  name: string;
  total: number;
  ppr: number;
  awards: AwardCounts;
  roundScores: number[];
}

/** One finished game. A 2-player game is a single entry holding both players' results. */
export interface CountUpHistoryEntry {
  date: string;
  playerCount: 1 | 2;
  bullMode: BullMode;
  players: CountUpHistoryPlayer[];
}

function sanitizeAwards(value: unknown): AwardCounts {
  const counts = emptyAwardCounts();
  if (!value || typeof value !== 'object') return counts;
  const record = value as Record<string, unknown>;
  for (const kind of AWARD_KINDS as readonly AwardKind[]) {
    const raw = record[kind];
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) counts[kind] = raw;
  }
  return counts;
}

function sanitizePlayer(value: unknown): CountUpHistoryPlayer | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  const roundScores = Array.isArray(record.roundScores)
    ? record.roundScores.filter(isValidRoundScore).slice(0, COUNT_UP_ROUNDS)
    : [];
  const total = typeof record.total === 'number' && Number.isFinite(record.total) ? record.total : 0;
  const ppr = typeof record.ppr === 'number' && Number.isFinite(record.ppr) ? record.ppr : 0;
  return { name: record.name, total, ppr, awards: sanitizeAwards(record.awards), roundScores };
}

function sanitizeEntry(value: unknown): CountUpHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.date !== 'string') return null;
  if (!Array.isArray(record.players)) return null;
  const players = record.players.map(sanitizePlayer).filter((player): player is CountUpHistoryPlayer => player !== null);
  if (players.length === 0) return null;
  const playerCount = record.playerCount === 2 ? 2 : 1;
  const bullMode: BullMode = record.bullMode === 'fat' ? 'fat' : 'separate';
  return { date: record.date, playerCount, bullMode, players };
}

/** Newest first. Any unreadable or malformed storage value yields an empty list rather than throwing. */
export function loadCountUpHistory(): CountUpHistoryEntry[] {
  try {
    const raw = localStorage.getItem(COUNT_UP_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeEntry)
      .filter((entry): entry is CountUpHistoryEntry => entry !== null)
      .slice(0, COUNT_UP_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** Records a finished game at the head of the list, keeping at most COUNT_UP_HISTORY_LIMIT entries. */
export function appendCountUpHistory(entry: CountUpHistoryEntry): CountUpHistoryEntry[] {
  const next = [entry, ...loadCountUpHistory()].slice(0, COUNT_UP_HISTORY_LIMIT);
  try {
    localStorage.setItem(COUNT_UP_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode, quota); the result screen still shows the game.
  }
  return next;
}

export function clearCountUpHistory(): void {
  try {
    localStorage.removeItem(COUNT_UP_HISTORY_KEY);
  } catch {
    // ignore
  }
}

/**
 * Rewrites one already-recorded game in place, matched on its own `date`. Used when a finished
 * game's round score is corrected on the result screen, so the stored record matches what the
 * player is looking at rather than gaining a second entry for the same game.
 *
 * Matched rather than assumed to be the newest: another tab (or another window of the installed
 * PWA) can finish its own COUNT-UP in between, and overwriting the head would delete that game's
 * result while leaving this one uncorrected.
 */
export function updateCountUpHistoryEntry(entry: CountUpHistoryEntry): CountUpHistoryEntry[] {
  const current = loadCountUpHistory();
  const index = current.findIndex((item) => item.date === entry.date);
  // Gone from the list means it was pushed past the 10-entry cap by games finished elsewhere.
  // Re-inserting it would put an older game at the head, so the stored list is left as it is.
  if (index === -1) return current;

  const next = current.map((item, position) => (position === index ? entry : item));
  try {
    localStorage.setItem(COUNT_UP_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
