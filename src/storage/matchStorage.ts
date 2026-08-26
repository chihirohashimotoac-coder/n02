import type { X01MatchState, X01Settings } from '../domain/x01Engine';

/**
 * These key names and payload shapes are the pre-existing n02 storage contract and are kept exactly
 * as-is, so a user who already has a saved match or history keeps it after this release.
 */
export const CURRENT_MATCH_KEY = 'n02-current-v1';
export const HISTORY_KEY = 'n02-history-v1';
export const THEME_KEY = 'n02-theme-v1';

export interface HistoryEntry {
  date: string;
  mode: '01' | 'checkout';
  winner: string;
  startScore: number;
  darts: number;
  reason: string;
}

export type ThemeName = 'clean' | 'neon' | 'navy';

export function saveCurrentMatch(state: X01MatchState | null): void {
  try {
    if (state === null) localStorage.removeItem(CURRENT_MATCH_KEY);
    else localStorage.setItem(CURRENT_MATCH_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

export function loadCurrentMatch(): X01MatchState | null {
  try {
    const raw = localStorage.getItem(CURRENT_MATCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as X01MatchState;
    if (!parsed?.settings || !Array.isArray(parsed.players)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCurrentMatch(): void {
  saveCurrentMatch(null);
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
  const next = [entry, ...loadHistory()].slice(0, 50);
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

export function defaultSettings(): X01Settings {
  return {
    mode: '01',
    startScore: 501,
    checkoutMin: 41,
    checkoutMax: 170,
    targetLegs: 2,
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
