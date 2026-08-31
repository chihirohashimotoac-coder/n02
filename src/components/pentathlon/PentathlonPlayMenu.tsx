import { useState } from 'react';
import PentathlonModal from './PentathlonModal';
import { DISCIPLINE_RULE_TEXT } from '../../domain/pentathlon/ruleText';
import type { DisciplineId } from '../../domain/pentathlon/types';

interface Props {
  disciplineId: DisciplineId;
  /** True while darts are staged - the round undo is blocked until they are taken back first. */
  canUndo: boolean;
  canUndoRound: boolean;
  onUndoRound: () => void;
  onExit: () => void;
  onClose: () => void;
  /**
   * Which input pad this screen is showing, so the shortcut list describes the keys that actually
   * do something here: a quick pad binds its buttons to 1-3, the full grid takes darts notation.
   */
  padKind: 'quick' | 'grid' | 'cricket';
}

/**
 * The ☰ menu shared by the dart-hit play screens. Everything in here is deliberately NOT on the play
 * screen itself: none of it is needed to throw a dart, and the play screen has to fit one viewport
 * without scrolling. Rules open as a second view of this same dialog rather than a nested modal, so
 * only ever one dialog owns the keyboard.
 */
export default function PentathlonPlayMenu({
  disciplineId,
  canUndo,
  canUndoRound,
  onUndoRound,
  onExit,
  onClose,
  padKind,
}: Props) {
  const [view, setView] = useState<'menu' | 'rules'>('menu');
  const rules = DISCIPLINE_RULE_TEXT[disciplineId];

  if (view === 'rules') {
    return (
      <PentathlonModal label={`${rules.title}のルール`} onClose={() => setView('menu')}>
        <h2>{rules.title} のルール</h2>
        <p className="pent-rules-body">{rules.body}</p>
        <button type="button" className="n01-modal-primary" onClick={() => setView('menu')}>
          閉じる
        </button>
      </PentathlonModal>
    );
  }

  return (
    <PentathlonModal label="ゲームメニュー" onClose={onClose} variant="menu-list">
      <h2>メニュー</h2>
      <button
        type="button"
        disabled={!canUndoRound}
        title={canUndo && !canUndoRound ? '先に「1投戻す」で入力中の投球を取り消してください' : undefined}
        onClick={() => {
          onUndoRound();
          onClose();
        }}
      >
        前の確定ラウンドに戻す
      </button>
      <button type="button" onClick={() => setView('rules')}>
        ルール説明
      </button>
      <button
        type="button"
        onClick={() => {
          onClose();
          onExit();
        }}
      >
        中断してメニューへ
      </button>
      <p>
        キーボード：
        {padKind === 'quick' && (
          <>
            <kbd>1</kbd>–<kbd>3</kbd> 各ボタン・<kbd>0</kbd> ミス・
          </>
        )}
        {padKind !== 'quick' && (
          <>
            数字→<kbd>S</kbd>
            <kbd>D</kbd>
            <kbd>T</kbd> でナンバー（例 <kbd>2</kbd>
            <kbd>0</kbd>
            <kbd>T</kbd> でT20）・<kbd>B</kbd> インナーブル・<kbd>O</kbd> アウターブル・
            {padKind === 'grid' && (
              <>
                <kbd>0</kbd> ミス（数字を打ちかけていないとき）・
              </>
            )}
          </>
        )}
        <kbd>Enter</kbd> {padKind === 'cricket' ? '確定' : 'この投球を確定'}・
        <kbd>Backspace</kbd> 1投戻す
      </p>
      <button type="button" onClick={onClose}>
        戻る
      </button>
    </PentathlonModal>
  );
}
