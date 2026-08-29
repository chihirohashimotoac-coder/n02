import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface Props {
  label: string;
  onClose: () => void;
  /**
   * Keys this dialog itself acts on (e.g. the finish-darts dialog's 1/2/3). Called before the
   * keystroke is swallowed, so gameplay behind the dialog still never sees it.
   */
  onKeyDown?: (event: KeyboardEvent) => void;
  /**
   * 'menu-list' opts this dialog into 通常01・チェックアウト練習's own menu card design - full-width
   * rows separated by rules, each one a bordered, coloured button. Children are laid out by that
   * shared stylesheet, so with this variant the buttons must be DIRECT children of the dialog.
   */
  variant?: 'default' | 'menu-list';
  children: ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal shell for Pentathlon dialogs: Escape closes it, focus moves inside on open and
 * returns to the trigger on close, Tab is trapped within the dialog, and a backdrop click closes it
 * while a click inside does not. Pentathlon-only - 通常01・チェックアウト練習 keep their own
 * pre-existing .n01-modal-backdrop markup untouched.
 */
export default function PentathlonModal({
  label,
  onClose,
  onKeyDown,
  variant = 'default',
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
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
    () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const first = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
    (first ?? cardRef.current)?.focus();
    return () => {
      const target = returnFocusRef.current;
      if (!target?.isConnected) return;
      // Deferred, and only when nothing else has claimed focus: closing this dialog to open another
      // one (the DNF confirmation) must not yank focus back out of the replacement.
      queueMicrotask(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) target.focus();
      });
    };
  }, []);

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
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !cardRef.current?.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
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
  }, [focusables]);

  return (
    <div className="n01-modal-backdrop pent-modal-backdrop" onClick={onClose}>
      <div
        className={`n01-modal-card pent-modal-card ${variant === 'menu-list' ? 'menu-list' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={cardRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
