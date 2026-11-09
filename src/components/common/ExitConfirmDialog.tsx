import type { RefObject } from 'react';
import DialogShell from './DialogShell';

interface Props {
  /** The screen's own modal classes, so the dialog keeps that screen's look (see DialogShell). */
  backdropClassName: string;
  /** Must be a `menu-list` card: the three choices are laid out as that list's full-width rows. */
  cardClassName: string;
  /** The screen's own class for a dialog's explanatory line, where its card does not style a bare paragraph. */
  noteClassName?: string;
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Set on the X01 screens, whose dialogs sit over a screen that commits a score on Enter. */
  guardKeys?: boolean;
  /** YES: end the game and throw its progress (and any saved copy of it) away. */
  onYes: () => void;
  /** NO: close this dialog and carry on playing. */
  onNo: () => void;
  /** 途中経過を保存する: keep the progress so the next start of this game can pick it back up. */
  onSave: () => void;
}

/**
 * 「ゲームを終了しますか？」 - asked when a play screen's exit button (New / PRACTICE / 中断, or the
 * keyboard / menu route to the same action) is pressed with something already entered.
 *
 * Keys: Enter is YES and Escape is NO. Enter on a focused button keeps that button's own native
 * activation instead, so a keyboard user who has tabbed to 「途中経過を保存する」 gets what the focus
 * shows rather than the destructive YES; focus opens on YES, so a plain Enter is YES as asked.
 *
 * Deliberately no backdrop-click close (DialogShell never has one): a mis-tap beside the card is the
 * very accident this dialog exists to catch.
 */
export default function ExitConfirmDialog({
  backdropClassName,
  cardClassName,
  noteClassName,
  returnFocusTo,
  guardKeys,
  onYes,
  onNo,
  onSave,
}: Props) {
  return (
    <DialogShell
      label="ゲームの終了確認"
      backdropClassName={backdropClassName}
      cardClassName={cardClassName}
      returnFocusTo={returnFocusTo}
      guardKeys={guardKeys}
      onClose={onNo}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'BUTTON') return;
        event.preventDefault();
        onYes();
      }}
    >
      <h2>ゲームを終了しますか？</h2>
      <button type="button" data-exit-choice="yes" onClick={onYes}>
        <kbd>Enter</kbd>
        {'　'}YES
      </button>
      <button type="button" data-exit-choice="no" onClick={onNo}>
        <kbd>Esc</kbd>
        {'　'}NO
      </button>
      <button type="button" data-exit-choice="save" onClick={onSave}>
        途中経過を保存する
      </button>
      <p className={noteClassName}>YES を選ぶと途中経過は削除されます。保存すると、次に同じゲームを開始するときに続きから再開できます。</p>
    </DialogShell>
  );
}
