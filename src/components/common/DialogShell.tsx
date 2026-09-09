import { useRef, type ReactNode, type RefObject } from 'react';
import { useDialogFocus } from './useDialogFocus';

interface Props {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  /** Keys the dialog itself acts on, called before the keystroke is swallowed. */
  onKeyDown?: (event: KeyboardEvent) => void;
  /**
   * The screen's own backdrop / card classes. Passed in rather than fixed here so 通常01,
   * チェックアウト練習 and COUNT-UP keep exactly the markup and styles they already had - this
   * shell adds the focus and keyboard contract, not a new look.
   */
  backdropClassName: string;
  cardClassName: string;
  /**
   * Where focus goes when this dialog closes, instead of the control that opened it. See
   * useDialogFocus - the gameplay screens point it at their score sheet so the next Enter still
   * commits a score rather than re-opening the menu.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Dialog shell for 通常01・チェックアウト練習・COUNT-UP.
 *
 * Deliberately does NOT close on a backdrop click: these dialogs never did, and a mis-tap next to
 * the card during play must not discard the menu. Escape (and each dialog's own 戻る/閉じる button)
 * is the way out, as before.
 */
export default function DialogShell({
  label,
  onClose,
  onKeyDown,
  backdropClassName,
  cardClassName,
  returnFocusTo,
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ cardRef, onClose, onKeyDown, returnFocusTo });

  return (
    <div className={backdropClassName}>
      <div
        className={cardClassName}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        ref={cardRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
