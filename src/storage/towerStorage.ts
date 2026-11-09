import {
  TOWER_COURSE_ID,
  TOWER_DATA_VERSION,
  TOWER_LIFE_OPTIONS,
  TOWER_RULES,
  TOWER_START_FLOORS,
  rulesFor,
  type TowerPlayerStatus,
  type TowerState,
} from '../domain/practice/tower';

/**
 * TOWER OF THE DARTS history, under its own key.
 *
 * The naming follows the PRACTICE convention already set by COUNT-UP
 * (`n02-practice-countup-history-v1`), but nothing here reads or writes that key, nor any of the
 * pre-existing ones (n02-current-v1, n02-history-v1, n02-theme-v1, n02-pentathlon-v1,
 * n02-pentathlon-single-v1, n02-award-settings-v1). Storage is only ever touched through
 * getItem/setItem/removeItem on TOWER's own three keys - never `localStorage.clear()` - so no other
 * mode's saved settings or results can be read, rewritten or dropped from here.
 *
 * Like COUNT-UP, TOWER keeps no AUTOMATIC mid-game persistence: an unfinished climb lives in React
 * state, and only a finished game is recorded. The one exception is the player's own
 * 「途中経過を保存する」, which writes the whole state once under TOWER_PROGRESS_KEY below. That is a
 * snapshot to resume, not a log to replay, so a reload still can never double-count a dart.
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

/**
 * A climb left part-way through with 「途中経過を保存する」: the whole TowerState, undo stack
 * included, so a resumed game can still take back the darts thrown before it was saved. Removed when
 * the resumed game reaches RESULT, when YES discards it, or when 「前回の途中から始めますか？」 is
 * answered NO.
 */
export const TOWER_PROGRESS_KEY = 'n02-practice-tower-progress-v1';

const PLAYABLE_PHASES = new Set(['throw', 'pickup', 'continue', 'player-over']);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isStoredPlayer(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const player = value as Record<string, unknown>;
  const stats = player.stats as Record<string, unknown> | undefined;
  return (
    typeof player.name === 'string' &&
    isCount(player.currentFloor) &&
    player.currentFloor >= 1 &&
    player.currentFloor <= TOWER_RULES.finalFloor &&
    isCount(player.lastClearedFloor) &&
    player.lastClearedFloor <= TOWER_RULES.finalFloor &&
    isCount(player.life) &&
    isCount(player.continuesUsed) &&
    (player.status === 'playing' || player.status === 'cleared' || player.status === 'retired') &&
    !!stats &&
    isCount(stats.throws) &&
    isCount(stats.hits) &&
    isCount(stats.misses)
  );
}

/**
 * Only a game this very course and rule set produced is offered back: a saved climb from an older
 * course revision would put its floors on the wrong targets, so it is dropped rather than resumed.
 */
function sanitizeProgress(value: unknown): TowerState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as TowerState;
  if (state.courseId !== TOWER_COURSE_ID || state.dataVersion !== TOWER_DATA_VERSION) return null;

  const settings = state.settings as unknown as Record<string, unknown> | undefined;
  if (!settings || (settings.playerCount !== 1 && settings.playerCount !== 2)) return null;
  const names = settings.names;
  if (!Array.isArray(names) || names.length !== 2 || !names.every((name) => typeof name === 'string')) return null;
  if (!TOWER_LIFE_OPTIONS.includes(settings.startLife as number)) return null;
  if (!TOWER_START_FLOORS.includes(settings.startFloor as number)) return null;
  if (JSON.stringify(state.rules) !== JSON.stringify(rulesFor(state.settings))) return null;

  if (!Array.isArray(state.players) || state.players.length !== settings.playerCount) return null;
  if (!state.players.every(isStoredPlayer)) return null;
  if (state.activePlayerIndex !== 0 && state.activePlayerIndex !== 1) return null;
  if (state.activePlayerIndex >= state.players.length) return null;
  if (!isCount(state.dartsUsedInTurn) || state.dartsUsedInTurn > state.rules.dartsPerTurn) return null;
  if (!PLAYABLE_PHASES.has(state.phase)) return null;
  if (!isCount(state.actionSeq)) return null;
  if (!Array.isArray(state.recentActionIds) || !state.recentActionIds.every((id) => typeof id === 'string')) {
    return null;
  }
  if (
    !Array.isArray(state.history) ||
    !state.history.every(
      (event) =>
        !!event && typeof event === 'object' && (event.kind === 'throw' || event.kind === 'continue') && typeof event.id === 'string',
    )
  ) {
    return null;
  }
  if (
    !Array.isArray(state.undoStack) ||
    !state.undoStack.every(
      (snapshot) =>
        !!snapshot &&
        typeof snapshot === 'object' &&
        Array.isArray(snapshot.players) &&
        snapshot.players.every(isStoredPlayer) &&
        isCount(snapshot.historyLength) &&
        snapshot.historyLength <= state.history.length &&
        Array.isArray(snapshot.recentActionIds),
    )
  ) {
    return null;
  }
  return state;
}

export function saveTowerProgress(state: TowerState): void {
  try {
    localStorage.setItem(TOWER_PROGRESS_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private mode, quota); the climb then simply is not kept.
  }
}

/** The saved climb, or null when there is none or it cannot be read back as a playable game. */
export function loadTowerProgress(): TowerState | null {
  try {
    const raw = localStorage.getItem(TOWER_PROGRESS_KEY);
    if (!raw) return null;
    return sanitizeProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearTowerProgress(): void {
  try {
    localStorage.removeItem(TOWER_PROGRESS_KEY);
  } catch {
    // ignore
  }
}
