import DialogShell from './DialogShell';

interface Props {
  backdropClassName: string;
  /** Must be a `menu-list` card, like ExitConfirmDialog's. */
  cardClassName: string;
  /** The screen's own class for a dialog's explanatory line, where its card does not style a bare paragraph. */
  noteClassName?: string;
  /** What was saved, e.g. "501・LEG 2", so the player knows which game YES picks back up. */
  savedLabel?: string;
  /** YES: continue the saved game exactly where it was left (with its own settings). */
  onYes: () => void;
  /** NO: delete the saved game and start a new one with the settings just chosen. */
  onNo: () => void;
  /**
   * Escape: neither - the dialog closes and the setup screen stays as it was, save included.
   * Escape is the one way out every dialog in this app has, and it must never be the key that
   * silently deletes a saved game.
   */
  onCancel: () => void;
}

/** 「前回の途中から始めますか？」 - asked when a game is started while that game has a saved progress. */
export default function ResumePromptDialog({
  backdropClassName,
  cardClassName,
  noteClassName,
  savedLabel,
  onYes,
  onNo,
  onCancel,
}: Props) {
  return (
    <DialogShell
      label="前回の途中からの再開"
      backdropClassName={backdropClassName}
      cardClassName={cardClassName}
      onClose={onCancel}
    >
      <h2>前回の途中から始めますか？</h2>
      {savedLabel && <p className={noteClassName}>保存したゲーム：{savedLabel}</p>}
      <button type="button" data-resume-choice="yes" onClick={onYes}>
        YES
      </button>
      <button type="button" data-resume-choice="no" onClick={onNo}>
        NO
      </button>
      <p className={noteClassName}>YES は保存したところから再開します。NO を選ぶと保存したデータは削除され、新しいゲームを開始します。</p>
    </DialogShell>
  );
}
