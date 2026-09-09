import { useRef, type ReactNode, type RefObject } from 'react';
import { useDialogFocus } from '../common/useDialogFocus';

interface Props {
  label: string;
  onClose: () => void;
  /**
   * Where focus goes on close, when the trigger is the wrong answer - the score sheet, on the
   * gameplay screens. See useDialogFocus: with a focused button keeping its native Enter, parking
   * focus back on ☰ or on a score cell turns the next Enter into "open that dialog again" instead
   * of "commit the score".
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
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

/**
 * Accessible modal shell for Pentathlon dialogs: Escape closes it, focus moves inside on open and
 * returns to the trigger on close, Tab is trapped within the dialog, and a backdrop click closes it
 * while a click inside does not.
 *
 * The focus and keyboard half of that now lives in useDialogFocus, which 通常01・チェックアウト練習
 * and COUNT-UP share through DialogShell. The backdrop-click-to-close behaviour and this markup are
 * Pentathlon's own and stay here.
 */
export default function PentathlonModal({
  label,
  onClose,
  onKeyDown,
  returnFocusTo,
  variant = 'default',
  children,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  useDialogFocus({ cardRef, onClose, onKeyDown, returnFocusTo });

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
