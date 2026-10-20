/**
 * Which keystrokes the 通常01・チェックアウト練習・ペンタスロン X01 screens may act on, and which
 * element owns a keystroke. Decisions only: no state, no engine calls, no preventDefault.
 */

/**
 * The score sheet's live entry box. It is a read-only mirror of what the keypad has typed, so a
 * click on it must not take the keyboard away from the game the way a real text field would.
 */
const GAME_ENTRY_INPUT = '.n01-score-table td.scored.current input[readonly]';

/** Ctrl / Meta / Alt chords belong to the browser and the OS, never to gameplay. Shift is fine. */
export function hasCommandModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/**
 * A keystroke that must not trigger any app action: part of an IME conversion (including the Enter
 * that only commits it), an auto-repeat of a held key, one something else already handled, or a
 * browser/OS chord.
 */
export function isInertKeystroke(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    event.defaultPrevented ||
    hasCommandModifier(event)
  );
}

/**
 * True when the target is a field that owns its own keys - a text input, select, textarea or
 * contenteditable. The score sheet's read-only entry box is the one exception: it belongs to the
 * game.
 */
export function isFieldOwned(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (!target.matches('input, select, textarea')) return false;
  return !target.matches(GAME_ENTRY_INPUT);
}

/** Enter / Space / Tab on a focused button or link: the browser's own activation or focus move. */
export function isNativeActivation(event: KeyboardEvent): boolean {
  if (!['Enter', ' ', 'Tab'].includes(event.key)) return false;
  const target = event.target;
  return target instanceof HTMLElement && target.matches('button, a[href]');
}
