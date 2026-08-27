import type { PentathlonSession } from '../domain/pentathlon/types';

/**
 * Deliberately a NEW key, separate from the pre-existing n02-current-v1 / n02-history-v1 /
 * n02-theme-v1 keys, so an in-progress Pentathlon can never overwrite or corrupt a saved 01 match.
 */
export const PENTATHLON_SESSION_KEY = 'n02-pentathlon-v1';

/**
 * 個別練習 gets its own key again, so starting or finishing a single discipline can never touch -
 * or leak a result into - a full pentathlon that is still in progress.
 */
export const PENTATHLON_SINGLE_SESSION_KEY = 'n02-pentathlon-single-v1';

function write(key: string, session: PentathlonSession | null): void {
  try {
    if (session === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode, quota); play continues in memory.
  }
}

function read(key: string): PentathlonSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PentathlonSession;
    if (!parsed || parsed.version !== 1) return null;
    if (!parsed.preset || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePentathlonSession(session: PentathlonSession | null): void {
  write(PENTATHLON_SESSION_KEY, session);
}

export function loadPentathlonSession(): PentathlonSession | null {
  return read(PENTATHLON_SESSION_KEY);
}

export function clearPentathlonSession(): void {
  savePentathlonSession(null);
}

export function saveSingleGameSession(session: PentathlonSession | null): void {
  write(PENTATHLON_SINGLE_SESSION_KEY, session);
}

export function loadSingleGameSession(): PentathlonSession | null {
  return read(PENTATHLON_SINGLE_SESSION_KEY);
}

export function clearSingleGameSession(): void {
  saveSingleGameSession(null);
}
