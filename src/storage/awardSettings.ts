/**
 * The アワード表示 ON/OFF setting for 通常01 and チェックアウト練習.
 *
 * Its own key, shared by both modes: the two are the same screen with a different starting score,
 * so a player who turns the presentation off in one expects it off in the other. It is deliberately
 * NOT part of the match payload (n02-current-v1) - a display preference must survive starting a new
 * match, and changing it must never touch a saved game's score, history or resume data.
 *
 * COUNT-UP is not covered by this setting. Its award presentation predates it and keeps working
 * exactly as before, whatever this is set to.
 */
export const AWARD_DISPLAY_KEY = 'n02-award-display-v1';

/**
 * Whether to present awards in 通常01 / チェックアウト練習.
 *
 * Defaults to ON, and specifically defaults to ON for an existing player whose storage has no such
 * key yet: only an explicitly stored 'off' turns it off. Anything unreadable (private mode, a
 * corrupted value, storage disabled) also reads as ON, so the feature can never be lost to a
 * storage failure.
 */
export function loadAwardDisplay(): boolean {
  try {
    return localStorage.getItem(AWARD_DISPLAY_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAwardDisplay(enabled: boolean): void {
  try {
    localStorage.setItem(AWARD_DISPLAY_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage can be unavailable; the setting then just lasts for this session.
  }
}
