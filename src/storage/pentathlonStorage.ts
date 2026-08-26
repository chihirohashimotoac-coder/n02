import type { PentathlonSession } from '../domain/pentathlon/types';

/**
 * Deliberately a NEW key, separate from the pre-existing n02-current-v1 / n02-history-v1 /
 * n02-theme-v1 keys, so an in-progress Pentathlon can never overwrite or corrupt a saved 01 match.
 */
export const PENTATHLON_SESSION_KEY = 'n02-pentathlon-v1';

export function savePentathlonSession(session: PentathlonSession | null): void {
  try {
    if (session === null) localStorage.removeItem(PENTATHLON_SESSION_KEY);
    else localStorage.setItem(PENTATHLON_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode, quota); play continues in memory.
  }
}

export function loadPentathlonSession(): PentathlonSession | null {
  try {
    const raw = localStorage.getItem(PENTATHLON_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PentathlonSession;
    if (!parsed || parsed.version !== 1) return null;
    if (!parsed.preset || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPentathlonSession(): void {
  savePentathlonSession(null);
}
