import type { X01MatchState, X01Settings } from '../domain/x01Engine';

/**
 * These key names and payload shapes are the pre-existing n02 storage contract and are kept exactly
 * as-is, so a user who already has a saved match or history keeps it after this release.
 */
export const CURRENT_MATCH_KEY = 'n02-current-v1';
export const HISTORY_KEY = 'n02-history-v1';
export const THEME_KEY = 'n02-theme-v1';

/**
 * How many finished legs the history keeps. Exported so the 成績 panel can name the range it is
 * actually summarising instead of restating a number that has to be kept in sync by hand.
 */
export const HISTORY_LIMIT = 50;

export interface HistoryEntry {
  date: string;
  mode: '01' | 'checkout';
  winner: string;
  startScore: number;
  darts: number;
  reason: string;
}

export type ThemeName = 'clean' | 'neon' | 'navy';

export type MatchMode = X01Settings['mode'];

/**
 * チェックアウト練習's in-progress match. 通常01 and チェックアウト練習 used to share
 * CURRENT_MATCH_KEY, so starting one silently replaced the other's saved game; each now has its own
 * slot. 通常01 stays on the pre-existing key, so a saved 01 match survives this release untouched.
 */
export const CURRENT_CHECKOUT_MATCH_KEY = 'n02-current-checkout-v1';

function currentMatchKey(mode: MatchMode): string {
  return mode === 'checkout' ? CURRENT_CHECKOUT_MATCH_KEY : CURRENT_MATCH_KEY;
}

function parseMatch(raw: string | null): X01MatchState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as X01MatchState;
    if (!parsed?.settings || !Array.isArray(parsed.players)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * A checkout match saved before the split sits in CURRENT_MATCH_KEY. Move it to its own slot (unless
 * that slot already holds a newer one, which then wins) so it is offered as チェックアウト練習 and no
 * longer blocks a 01 save.
 */
function migrateSharedCheckoutSave(): void {
  try {
    const raw = localStorage.getItem(CURRENT_MATCH_KEY);
    const parsed = parseMatch(raw);
    if (!raw || parsed?.settings.mode !== 'checkout') return;
    if (localStorage.getItem(CURRENT_CHECKOUT_MATCH_KEY) === null) {
      localStorage.setItem(CURRENT_CHECKOUT_MATCH_KEY, raw);
    }
    localStorage.removeItem(CURRENT_MATCH_KEY);
  } catch {
    // ignore storage failures
  }
}

/** Saved under the slot of the match's own mode (通常01 or チェックアウト練習). */
export function saveCurrentMatch(state: X01MatchState): void {
  try {
    localStorage.setItem(currentMatchKey(state.settings.mode), JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

export function loadCurrentMatch(mode: MatchMode): X01MatchState | null {
  migrateSharedCheckoutSave();
  try {
    const parsed = parseMatch(localStorage.getItem(currentMatchKey(mode)));
    // A slot only ever answers for its own mode.
    return parsed && (parsed.settings.mode ?? '01') === mode ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCurrentMatch(mode: MatchMode): void {
  try {
    localStorage.removeItem(currentMatchKey(mode));
  } catch {
    // ignore storage failures
  }
}

/** e.g. "501・LEG 2" / "CHECKOUT・LEG 3" - names a saved match on its resume button and prompt. */
export function savedMatchLabel(match: X01MatchState): string {
  const mode = match.settings.mode === '01' ? `${match.settings.startScore}` : 'CHECKOUT';
  return `${mode}・LEG ${match.leg}`;
}

/**
 * Whether nothing has been thrown yet: leg 1, no visit recorded, no leg completed. Leaving such a
 * match loses nothing, so its exit is not confirmed.
 */
export function isUntouchedMatch(state: X01MatchState): boolean {
  return state.leg === 1 && state.completed.length === 0 && state.visits.length === 0;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory()].slice(0, HISTORY_LIMIT);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

/**
 * Drops the newest history entry. Used when a completed leg is rewound (resumePreviousLeg), so the
 * 成績 panel does not keep a result the player has just taken back.
 */
export function removeLatestHistory(): HistoryEntry[] {
  const next = loadHistory().slice(1);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

export function loadTheme(): ThemeName {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'neon' || value === 'navy' || value === 'clean') return value;
  } catch {
    // ignore
  }
  return 'clean';
}

export function saveTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
  if (theme === 'clean') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Default 勝利条件 per mode. 通常01 is a match, so it defaults to a best-of; チェックアウト練習 is a
 * drill you keep repeating, so it defaults to no Leg target (「なし（Legを継続）」).
 */
export function defaultTargetLegs(mode: X01Settings['mode']): number {
  return mode === 'checkout' ? 0 : 2;
}

export function defaultSettings(): X01Settings {
  return {
    mode: '01',
    startScore: 501,
    checkoutMin: 41,
    checkoutMax: 170,
    targetLegs: defaultTargetLegs('01'),
    showRoute: false,
    names: ['プレイヤー1', 'プレイヤー2'],
    roundLimit: true,
    maxRounds: 15,
    comEnabled: [false, false],
    comLevels: [5, 5],
    handicapEnabled: [false, false],
    handicapScores: [501, 501],
  };
}
