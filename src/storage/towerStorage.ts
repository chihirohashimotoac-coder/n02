import { TOWER_COURSE_ID, TOWER_RULES, type TowerPlayerStatus } from '../domain/practice/tower';

/**
 * TOWER OF THE DARTS history, under its own key.
 *
 * The naming follows the PRACTICE convention already set by COUNT-UP
 * (`n02-practice-countup-history-v1`), but nothing here reads or writes that key, nor any of the
 * pre-existing ones (n02-current-v1, n02-history-v1, n02-theme-v1, n02-pentathlon-v1,
 * n02-pentathlon-single-v1, n02-award-settings-v1). Storage is only ever touched through
 * getItem/setItem/removeItem on TOWER's own two keys - never `localStorage.clear()` - so no other
 * mode's saved settings or results can be read, rewritten or dropped from here.
 *
 * Like COUNT-UP, TOWER keeps NO mid-game persistence: an unfinished climb lives only in React
 * state, and only a finished game is recorded. That is also why a reload can never double-count a
 * dart - there is nothing to replay.
 *
 * The stored `courseId` and `rules` identify which course and settings a row was produced under, so
 * a future course revision cannot make old rows look comparable to new ones.
 */
export const TOWER_HISTORY_KEY = 'n02-practice-tower-history-v1';

/** Remembers that the first-run help has been shown. Its own key, so clearing history keeps it. */
export const TOWER_HELP_SEEN_KEY = 'n02-practice-tower-help-v1';

export const TOWER_HISTORY_LIMIT = 10;

export interface TowerHistoryPlayer {
  name: string;
  /** The last floor beaten. 0 when 1F was never cleared. */
  clearFloor: number;
  status: TowerPlayerStatus;
  continuesUsed: number;
  throws: number;
  hits: number;
  misses: number;
}

export interface TowerHistoryEntry {
  date: string;
  courseId: string;
  playerCount: 1 | 2;
  rules: { startFloor: number; startLife: number; continues: number; recovery: boolean };
  players: TowerHistoryPlayer[];
}

function positiveInteger(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function sanitizeStatus(value: unknown): TowerPlayerStatus {
  return value === 'cleared' || value === 'retired' ? value : 'playing';
}

function sanitizePlayer(value: unknown): TowerHistoryPlayer | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string') return null;
  return {
    name: record.name,
    clearFloor: Math.min(positiveInteger(record.clearFloor), TOWER_RULES.finalFloor),
    status: sanitizeStatus(record.status),
    continuesUsed: positiveInteger(record.continuesUsed),
    throws: positiveInteger(record.throws),
    hits: positiveInteger(record.hits),
    misses: positiveInteger(record.misses),
  };
}

function sanitizeRules(value: unknown): TowerHistoryEntry['rules'] {
  const fallback = {
    startFloor: TOWER_RULES.startFloor,
    startLife: TOWER_RULES.startLife,
    continues: TOWER_RULES.continues,
    recovery: TOWER_RULES.recovery,
  };
  if (!value || typeof value !== 'object') return fallback;
  const record = value as Record<string, unknown>;
  return {
    startFloor: positiveInteger(record.startFloor, fallback.startFloor),
    startLife: positiveInteger(record.startLife, fallback.startLife),
    continues: positiveInteger(record.continues, fallback.continues),
    recovery: typeof record.recovery === 'boolean' ? record.recovery : fallback.recovery,
  };
}

function sanitizeEntry(value: unknown): TowerHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.date !== 'string') return null;
  if (!Array.isArray(record.players)) return null;
  const players = record.players
    .map(sanitizePlayer)
    .filter((player): player is TowerHistoryPlayer => player !== null);
  if (players.length === 0) return null;
  return {
    date: record.date,
    courseId: typeof record.courseId === 'string' ? record.courseId : TOWER_COURSE_ID,
    playerCount: record.playerCount === 2 ? 2 : 1,
    rules: sanitizeRules(record.rules),
    players,
  };
}

/** Newest first. Unreadable or malformed storage yields an empty list rather than throwing. */
export function loadTowerHistory(): TowerHistoryEntry[] {
  try {
    const raw = localStorage.getItem(TOWER_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeEntry)
      .filter((entry): entry is TowerHistoryEntry => entry !== null)
      .slice(0, TOWER_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function appendTowerHistory(entry: TowerHistoryEntry): TowerHistoryEntry[] {
  const next = [entry, ...loadTowerHistory()].slice(0, TOWER_HISTORY_LIMIT);
  try {
    localStorage.setItem(TOWER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode, quota); RESULT still shows the finished game.
  }
  return next;
}

/**
 * Rewrites one recorded game in place, matched on its own `date` - the same approach COUNT-UP uses,
 * and for the same reason: another tab can record its own game in between, so overwriting the head
 * would delete that one. A game that has fallen off the end is left alone.
 */
export function updateTowerHistoryEntry(entry: TowerHistoryEntry): TowerHistoryEntry[] {
  const current = loadTowerHistory();
  const index = current.findIndex((item) => item.date === entry.date);
  if (index === -1) return current;
  const next = current.map((item, position) => (position === index ? entry : item));
  try {
    localStorage.setItem(TOWER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

/** Removes one recorded game, used when a RESULT is rewound back into play. */
export function removeTowerHistoryEntry(date: string): TowerHistoryEntry[] {
  const next = loadTowerHistory().filter((item) => item.date !== date);
  try {
    localStorage.setItem(TOWER_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function clearTowerHistory(): void {
  try {
    localStorage.removeItem(TOWER_HISTORY_KEY);
  } catch {
    // ignore
  }
}

export function hasSeenTowerHelp(): boolean {
  try {
    return localStorage.getItem(TOWER_HELP_SEEN_KEY) === 'yes';
  } catch {
    // No storage means the help simply shows again; it is never a reason to fail to start a game.
    return false;
  }
}

export function markTowerHelpSeen(): void {
  try {
    localStorage.setItem(TOWER_HELP_SEEN_KEY, 'yes');
  } catch {
    // ignore
  }
}
