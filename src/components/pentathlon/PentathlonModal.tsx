import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface Props {
  label: string;
  onClose: () => void;
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
export default function PentathlonModal({ label, onClose, children }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  // Captured on mount so focus can go back exactly where it came from - usually the trigger button.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const focusables = useCallback(
    () => Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const first = cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
    (first ?? cardRef.current)?.focus();
    return () => returnFocusRef.current?.focus?.();
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
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
    };
    // Capture phase: gameplay screens listen for Escape/keys on window too, and must not act on
    // keystrokes aimed at an open dialog.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focusables, onClose]);

  return (
    <div className="n01-modal-backdrop pent-modal-backdrop" onClick={onClose}>
      <div
        className="n01-modal-card pent-modal-card"
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
