import {
  AWARD_KINDS,
  COUNT_UP_ROUNDS,
  emptyAwardCounts,
  isFinished,
  isValidRoundScore,
  type AwardCounts,
  type AwardKind,
  type BullMode,
  type CountUpState,
} from '../domain/practice/countUp';

/**
 * PRACTICE history lives under its own key (and a game saved part-way through under another one,
 * COUNT_UP_PROGRESS_KEY below). The pre-existing contracts (n02-current-v1,
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

/**
 * A COUNT-UP left part-way through with 「途中経過を保存する」. Its own key, next to the history one;
 * written only by that choice (never automatically), and removed when the saved game is resumed and
 * finished, when YES discards it, or when 「前回の途中から始めますか？」 is answered NO.
 */
export const COUNT_UP_PROGRESS_KEY = 'n02-practice-countup-progress-v1';

function sanitizeProgress(value: unknown): CountUpState | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const settings = record.settings as Record<string, unknown> | undefined;
  if (!settings || typeof settings !== 'object') return null;
  if (settings.playerCount !== 1 && settings.playerCount !== 2) return null;
  if (settings.bullMode !== 'fat' && settings.bullMode !== 'separate') return null;
  const names = settings.names;
  if (!Array.isArray(names) || names.length !== 2 || !names.every((name) => typeof name === 'string')) return null;
  if (!Array.isArray(record.players) || record.players.length !== settings.playerCount) return null;

  const players: CountUpState['players'] = [];
  for (const entry of record.players as unknown[]) {
    if (!entry || typeof entry !== 'object') return null;
    const player = entry as Record<string, unknown>;
    if (typeof player.name !== 'string' || !Array.isArray(player.scores)) return null;
    if (player.scores.length > COUNT_UP_ROUNDS || !player.scores.every(isValidRoundScore)) return null;
    players.push({ name: player.name, scores: [...(player.scores as number[])] });
  }
  // Player 1 throws first each round, so player 2 is level with player 1 or one round behind.
  if (players.length === 2) {
    const lead = players[0].scores.length - players[1].scores.length;
    if (lead !== 0 && lead !== 1) return null;
  }

  const state: CountUpState = {
    settings: {
      playerCount: settings.playerCount,
      names: [names[0], names[1]] as [string, string],
      bullMode: settings.bullMode,
    },
    players,
  };
  // A finished game is a result, not progress to resume.
  return isFinished(state) ? null : state;
}

export function saveCountUpProgress(state: CountUpState): void {
  try {
    localStorage.setItem(COUNT_UP_PROGRESS_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode, quota); the game then simply is not kept.
  }
}

/** The saved game, or null when there is none or it cannot be read back as a playable game. */
export function loadCountUpProgress(): CountUpState | null {
  try {
    const raw = localStorage.getItem(COUNT_UP_PROGRESS_KEY);
    if (!raw) return null;
    return sanitizeProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearCountUpProgress(): void {
  try {
    localStorage.removeItem(COUNT_UP_PROGRESS_KEY);
  } catch {
    // ignore
  }
}
