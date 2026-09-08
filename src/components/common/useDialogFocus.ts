import { useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Everything inside a dialog that can hold focus, in document order. `:not([disabled])` matters:
 * several menus disable their own rows (UNDO with nothing to undo, 前のLegをやり直す in leg 1), and a
 * disabled button must not be where Tab lands or where the opening focus goes.
 */
export const DIALOG_FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

interface Options {
  /** The dialog card. Focus is moved into it on open and trapped inside it while it is open. */
  cardRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /**
   * Keys this dialog itself acts on. Called before the keystroke is swallowed, so the gameplay
   * screen behind the dialog still never sees it.
   */
  onKeyDown?: (event: KeyboardEvent) => void;
  /**
   * Where focus goes when the dialog closes, when the trigger is the wrong answer.
   *
   * 通常01・チェックアウト練習 and COUNT-UP leave a focused button its native Enter activation, so
   * parking focus back on the ☰ button that opened a dialog would turn the next Enter - the key
   * that commits a score - into "open the menu again". Those screens point this at their score
   * sheet instead, which is where typing belongs; it is the same call CountUpGame already makes
   * after UNDO. Falls back to the trigger when the element is missing.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

/**
 * The keyboard and focus contract every dialog in this app owes its user:
 *
 * - focus moves into the dialog on open, and back to whatever opened it on close;
 * - Tab and Shift+Tab cycle within the dialog and cannot reach the screen behind it;
 * - Escape closes it;
 * - every other keystroke is stopped before the gameplay screen's own `window` keydown listener
 *   sees it, so Enter cannot also commit a score, and digits / Backspace / U cannot edit or undo
 *   hidden gameplay.
 *
 * Extracted from PentathlonModal, which had all of this and was the only place that did. 通常01,
 * チェックアウト練習 and COUNT-UP now share the same behaviour through this hook while keeping
 * their own existing markup and styles.
 */
export function useDialogFocus({ cardRef, onClose, onKeyDown, returnFocusTo }: Options): void {
  // Captured on mount so focus can go back exactly where it came from - usually the trigger button.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Callers pass these as inline closures, so keeping them in refs lets the key listener be
  // registered exactly once per open dialog instead of being torn down and re-added every render.
  const onCloseRef = useRef(onClose);
  const onKeyDownRef = useRef(onKeyDown);
  useEffect(() => {
    onCloseRef.current = onClose;
    onKeyDownRef.current = onKeyDown;
  });

  const focusables = useCallback(
    () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE) ?? []),
    [cardRef],
  );

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    // Read once, here, rather than in the cleanup: the screens that pass this point at their score
    // sheet, which is already mounted and outlives every dialog on it.
    const preferredReturn = returnFocusTo?.current ?? null;
    // A dialog whose first control is an autoFocus <input> has already claimed focus by the time
    // this runs; moving it to the first button would take the caret out of the field the player is
    // meant to type in. Otherwise focus goes to the first focusable, or to the card itself when the
    // dialog has none at all (tabIndex={-1} on the card makes that possible).
    if (!card?.contains(document.activeElement)) {
      (card?.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE)[0] ?? card)?.focus();
    }
    return () => {
      const target = preferredReturn?.isConnected ? preferredReturn : returnFocusRef.current;
      if (!target?.isConnected) return;
      // Deferred, and only when nothing else has claimed focus: closing this dialog to open another
      // one must not yank focus back out of the replacement.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) target.focus({ preventScroll: true });
      });
    };
  }, [cardRef, returnFocusTo]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab') {
        const items = focusables();
        // 0 focusables: nothing to cycle between, so Tab must not be allowed to leave for the
        // screen behind. 1 focusable: both branches below land back on that same element.
        if (items.length === 0) {
          event.preventDefault();
          cardRef.current?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !cardRef.current?.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !cardRef.current?.contains(active))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      // A focused text field inside the dialog owns its own keys, including any Enter-to-commit
      // handler React has attached to it. React delegates to the root container, which is INSIDE
      // window, so swallowing the event here would stop that handler from ever running. Letting it
      // through is safe: every gameplay key listener in the app either ignores events whose target
      // is an INPUT/SELECT/TEXTAREA, or unregisters itself entirely while a dialog is open.
      const target = event.target as HTMLElement | null;
      const inOwnField =
        target !== null &&
        cardRef.current?.contains(target) === true &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
      if (inOwnField) return;

      // Anything else belongs to this dialog alone. It still reaches the focused control's own
      // default action (Enter/Space activating a button), but is stopped before the gameplay
      // screen's window listener sees it - otherwise Enter would also commit the score behind the
      // dialog, and digits/Backspace/U would edit or undo hidden gameplay.
      onKeyDownRef.current?.(event);
      event.stopPropagation();
    };
    // Capture phase: gameplay screens listen for keys on window too, and must not act on
    // keystrokes aimed at an open dialog.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [cardRef, focusables]);
}
