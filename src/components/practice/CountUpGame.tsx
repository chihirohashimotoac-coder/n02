import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CountUpEditDialog, { type EditTarget } from './CountUpEditDialog';
import {
  COUNT_UP_ROUNDS,
  ROUND_SCORE_MESSAGE,
  activePlayer,
  applyRoundScore,
  awardForScore,
  canUndo,
  completedRounds,
  currentRound,
  editRoundScore,
  formatPpr,
  InvalidRoundScoreError,
  parseRoundScore,
  playerIndexes,
  pointsPerRound,
  totalEntries,
  totalScore,
  undoLastRound,
  type AwardKind,
  type CountUpState,
  type PlayerIndex,
} from '../../domain/practice/countUp';

interface Props {
  state: CountUpState;
  onChange: (state: CountUpState) => void;
  /** Reports a freshly scored award so the flow can present it. Never fired by a past-round edit. */
  onAward: (award: { kind: AwardKind; score: number; playerName: string }) => void;
  onExit: () => void;
}

type Modal = 'none' | 'menu' | 'edit' | 'confirm-exit';

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The COUNT-UP play screen.
 *
 * Operationally it mirrors 通常01 - type the round total, press ENTER - but it is a completely
 * separate component with its own keyboard handler and its own `countup-*` styles, so nothing here
 * can reach GameScreen, the X01 engine, or their storage. Visually it is deliberately the opposite
 * of 01: the accumulating TOTAL is the headline number and the round progress runs 1/8 → 8/8, so a
 * bystander can tell at a glance that this is not an 01 leg counting down.
 */
export default function CountUpGame({ state, onChange, onAward, onExit }: Props) {
  const [entry, setEntry] = useState('');
  const [modal, setModal] = useState<Modal>('none');
  const [notice, setNotice] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const indexes = playerIndexes(state);
  const active = activePlayer(state);
  const round = currentRound(state);
  const solo = state.players.length === 1;

  const submit = useCallback(() => {
    const score = parseRoundScore(entry);
    if (score === null) {
      setNotice(ROUND_SCORE_MESSAGE);
      return;
    }
    const playerName = state.players[active].name;
    let next: CountUpState;
    try {
      next = applyRoundScore(state, score);
    } catch (error) {
      if (error instanceof InvalidRoundScoreError) {
        setNotice(error.message);
        return;
      }
      throw error;
    }
    onChange(next);
    setEntry('');
    setNotice(null);
    // The state has already advanced; the presentation is fired afterwards and never gates it.
    const award = awardForScore(score, state.settings.bullMode);
    if (award) onAward({ kind: award, score, playerName });
  }, [active, entry, onAward, onChange, state]);

  const pressKey = useCallback(
    (key: string) => {
      if (key === 'enter') {
        submit();
        return;
      }
      if (key === 'delete') {
        setEntry((value) => value.slice(0, -1));
        setNotice(null);
        return;
      }
      setNotice(null);
      setEntry((value) => (value.length >= 3 ? value : value + key));
    },
    [submit],
  );

  const undo = useCallback(() => {
    if (!canUndo(state)) return;
    onChange(undoLastRound(state));
    setEntry('');
    setNotice('直前のラウンド得点を取り消しました。');
  }, [onChange, state]);

  const requestExit = useCallback(() => {
    // Nothing is persisted mid-game, so leaving with scores on the board discards them - ask once.
    if (totalEntries(state) > 0) setModal('confirm-exit');
    else onExit();
  }, [onExit, state]);

  // COUNT-UP's own keyboard route. GameScreen's handler is untouched and never runs here: this
  // screen replaces it entirely while it is mounted.
  useEffect(() => {
    if (modal !== 'none') return;
    const handler = (event: KeyboardEvent) => {
      // Never act on the Enter that only commits an IME conversion, and never let a held key repeat.
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      // Leave a focused button its native Enter/Space activation.
      if (target?.tagName === 'BUTTON' && ['Enter', ' ', 'Tab'].includes(event.key)) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        pressKey(event.key);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        pressKey('enter');
      } else if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        if (entry.length > 0) pressKey('delete');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setEntry('');
      } else if (event.key.toLowerCase() === 'u') {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry.length, modal, pressKey, undo]);

  const rows = useMemo(
    () =>
      Array.from({ length: COUNT_UP_ROUNDS }, (_, index) => ({
        round: index + 1,
        cells: indexes.map((player) => state.players[player].scores[index] ?? null),
      })),
    [indexes, state.players],
  );

  // Keep the round being thrown in view as the sheet fills up. Measured against the scroll box
  // itself rather than offsetTop, which resolves against the fixed shell, not the board.
  useEffect(() => {
    const container = boardRef.current;
    const current = container?.querySelector('tr.current');
    if (!(current instanceof HTMLElement) || !container) return;
    const row = current.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    container.scrollTop += row.top - box.top - (box.height - row.height) / 2;
  }, [round, active]);

  const openEditor = (player: PlayerIndex, roundIndex: number) => {
    const score = state.players[player].scores[roundIndex];
    if (score === undefined) return;
    setEditTarget({ player, roundIndex, playerName: state.players[player].name, currentScore: score });
    setModal('edit');
  };

  const commitEdit = (score: number) => {
    if (!editTarget) return;
    try {
      onChange(editRoundScore(state, editTarget.player, editTarget.roundIndex, score));
    } catch (error) {
      if (error instanceof InvalidRoundScoreError) {
        setNotice(error.message);
        setModal('none');
        setEditTarget(null);
        return;
      }
      throw error;
    }
    setModal('none');
    setEditTarget(null);
    setNotice(`ROUND ${editTarget.roundIndex + 1} の得点を修正し、TOTAL・PPR・アワードを再集計しました。`);
  };

  return (
    <section className="countup-shell">
      <header className="countup-header">
        <div className="countup-identity">
          <strong>COUNT-UP</strong>
          <span>8 ROUND SCORE ATTACK</span>
        </div>
        <div className="countup-round-badge">
          <small>ROUND</small>
          <strong>
            {round}
            <i>/{COUNT_UP_ROUNDS}</i>
          </strong>
        </div>
      </header>

      <div className="countup-progress" aria-label={`ラウンド ${round} / ${COUNT_UP_ROUNDS}`}>
        {Array.from({ length: COUNT_UP_ROUNDS }, (_, index) => {
          const number = index + 1;
          const done = completedRounds(state, active) >= number;
          return (
            <span
              key={number}
              className={`countup-pip ${done ? 'done' : ''} ${number === round && !done ? 'now' : ''}`}
              aria-hidden="true"
            />
          );
        })}
      </div>

      <div className="countup-board" ref={boardRef} tabIndex={0} aria-label="ラウンド履歴">
        <table className="countup-table">
          <thead>
            <tr>
              <th scope="col">R</th>
              {indexes.map((player) => (
                <th key={player} scope="col" className={active === player ? 'active' : ''}>
                  {state.players[player].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isCurrentRow = row.round === round;
              return (
                <tr key={row.round} className={isCurrentRow ? 'current' : ''}>
                  <th scope="row">{row.round}</th>
                  {indexes.map((player) => {
                    const score = row.cells[player];
                    const isEntryCell = isCurrentRow && active === player && score === null;
                    if (score !== null) {
                      return (
                        <td key={player} className="scored">
                          <button
                            type="button"
                            onClick={() => openEditor(player, row.round - 1)}
                            aria-label={`${state.players[player].name} ROUND ${row.round} の ${score} を修正`}
                          >
                            {score}
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={player} className={isEntryCell ? 'entry' : 'empty'}>
                        {isEntryCell ? <span className="countup-cell-entry">{entry || '–'}</span> : <span>–</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <footer className="countup-footer">
        <div className={`countup-totals ${solo ? 'solo' : ''}`}>
          {indexes.map((player) => (
            <div key={player} className={`countup-total-card ${active === player ? 'active' : ''}`}>
              <span className="countup-total-name">
                {state.players[player].name}
                {active === player && <em>THROW</em>}
              </span>
              <strong className="countup-total-value">
                <i aria-hidden="true">▲</i>
                {totalScore(state, player)}
              </strong>
              <span className="countup-total-label">TOTAL</span>
              <span className="countup-total-meta">PPR {formatPpr(pointsPerRound(state, player))}</span>
            </div>
          ))}
        </div>

        <div className="countup-entry-strip">
          <span className="countup-entry-label">{state.players[active].name} の3投合計</span>
          <output className="countup-entry-value" aria-live="off">
            {entry || '–'}
          </output>
        </div>

        {notice && (
          <p className="countup-notice" role="status">
            {notice}
          </p>
        )}

        <nav className="countup-menu" aria-label="COUNT-UPメニュー">
          <button type="button" onClick={requestExit}>
            PRACTICE
          </button>
          <button type="button" disabled={!canUndo(state)} onClick={undo}>
            UNDO
          </button>
          <button type="button" onClick={() => setModal('menu')} aria-label="メニュー">
            ☰
          </button>
        </nav>

        <div className="countup-keypad" aria-label="得点入力テンキー">
          {KEYPAD.map((key) => (
            <button key={key} type="button" onClick={() => pressKey(key)}>
              {key}
            </button>
          ))}
          <button type="button" aria-label="1文字削除" onClick={() => pressKey('delete')}>
            ⌫
          </button>
          <button type="button" onClick={() => pressKey('0')}>
            0
          </button>
          <button type="button" className="enter" onClick={() => pressKey('enter')}>
            ENTER
          </button>
        </div>
      </footer>

      {modal === 'menu' && (
        <div className="countup-modal-backdrop" role="dialog" aria-modal="true" aria-label="COUNT-UPメニュー">
          <div className="countup-modal-card menu-list">
            <h2>メニュー</h2>
            <p className="countup-modal-note">
              BULL設定：{state.settings.bullMode === 'fat' ? 'FAT BULL' : 'SEPARATE BULL'}／全{COUNT_UP_ROUNDS}ラウンド・1ラウンド3ダーツ
            </p>
            <button
              type="button"
              disabled={!canUndo(state)}
              onClick={() => {
                undo();
                setModal('none');
              }}
            >
              <kbd>U</kbd>{'\u3000'}直前の入力を戻す
            </button>
            <button
              type="button"
              onClick={() => {
                setModal('none');
                requestExit();
              }}
            >
              PRACTICE へ戻る
            </button>
            <p className="countup-modal-note">
              キーボード：<kbd>0</kbd>–<kbd>9</kbd> 入力・<kbd>Enter</kbd> 確定・<kbd>Backspace</kbd> 1文字削除・
              <kbd>U</kbd> 取り消し
            </p>
            <button type="button" className="countup-modal-cancel" onClick={() => setModal('none')}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {modal === 'confirm-exit' && (
        <div className="countup-modal-backdrop" role="dialog" aria-modal="true" aria-label="COUNT-UPの終了確認">
          <div className="countup-modal-card">
            <h2>現在のCOUNT-UPを終了しますか？</h2>
            <p className="countup-modal-note">途中経過は保存されません。</p>
            <button type="button" className="countup-modal-primary" onClick={onExit}>
              終了してPRACTICEへ
            </button>
            <button type="button" className="countup-modal-cancel" onClick={() => setModal('none')}>
              続ける
            </button>
          </div>
        </div>
      )}

      {modal === 'edit' && editTarget && (
        <CountUpEditDialog
          target={editTarget}
          onCommit={commitEdit}
          onCancel={() => {
            setModal('none');
            setEditTarget(null);
          }}
        />
      )}
    </section>
  );
}
