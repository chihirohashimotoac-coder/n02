import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceLeg,
  applyVisit,
  declareDraw,
  editVisit,
  InvalidVisitError,
  maybePlayComTurn,
  needsRoundLimitDecision,
  resolveRoundLimit,
  resumePreviousLeg,
  setLegStarter,
  swapCurrentLegScores,
  threeDartAverage,
  undoLastAction,
  type X01MatchState,
} from '../domain/x01Engine';
import { suggestCheckoutRoute, validFinishDartCounts, dartLabel } from '../domain/darts';
import { appendHistory, removeLatestHistory } from '../storage/matchStorage';
import MatchResultCard from './MatchResultCard';

interface Props {
  state: X01MatchState;
  onChange: (state: X01MatchState) => void;
  onExit: (options?: { clearSave?: boolean }) => void;
}

type Modal = 'none' | 'menu' | 'finish-darts' | 'round-limit' | 'stats' | 'edit';

export default function GameScreen({ state, onChange, onExit }: Props) {
  const [entry, setEntry] = useState('');
  const [modal, setModal] = useState<Modal>('none');
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeKind, setNoticeKind] = useState<'info' | 'warning'>('info');
  const [pendingFinish, setPendingFinish] = useState<number | null>(null);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editScore, setEditScore] = useState('');
  const [editDarts, setEditDarts] = useState(3);
  const [remainingEntryMode, setRemainingEntryMode] = useState(false);
  /** 使用ダーツ for the visit being entered - 3 unless the player says otherwise, reset after each visit. */
  const [dartsUsed, setDartsUsed] = useState(3);
  /** The played cell the arrow keys are parked on, and which R/Enter/digits act upon. */
  const [selectedVisit, setSelectedVisit] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyRecorded = useRef<Set<number>>(new Set());

  const activePlayer = state.players[state.active];
  // A round-limit leg must be resolved before anything else, so that prompt is derived from
  // game state rather than pushed into modal state by an effect.
  const awaitingRoundLimit = needsRoundLimitDecision(state);
  const effectiveModal: Modal = awaitingRoundLimit ? 'round-limit' : modal;
  const isComTurn = state.settings.comEnabled[state.active];
  // The 1st-round tap-the-opponent's-cell gesture that swaps who throws first, offered only while the
  // leg is genuinely untouched. That condition is also what keeps it clear of the edit-a-past-score
  // gesture: a cell is either a played visit (editable) or empty (a starter pick), never both.
  const canPickStarter = state.visits.length === 0 && state.legResult === null && state.matchWinner === null;
  // An undo or a leg rewind can delete the visit the arrow keys were parked on, so the stored index
  // is validated on every render rather than corrected from an effect.
  const activeSelection = selectedVisit !== null && selectedVisit < state.visits.length ? selectedVisit : null;

  const showNotice = useCallback((message: string, kind: 'info' | 'warning' = 'info') => {
    setNotice(message);
    setNoticeKind(kind);
  }, []);

  // Record a completed leg into the persistent history exactly once.
  useEffect(() => {
    const index = state.completed.length - 1;
    if (index < 0 || historyRecorded.current.has(index)) return;
    const last = state.completed[index];
    historyRecorded.current.add(index);
    appendHistory({
      date: new Date().toISOString(),
      mode: state.settings.mode,
      winner: last.winner === null ? '引き分け' : state.players[last.winner].name,
      startScore: last.startScore,
      darts: last.darts,
      reason: last.reason,
    });
  }, [state.completed, state.players, state.settings.mode]);

  // COM opponents take their turn automatically.
  useEffect(() => {
    if (!isComTurn || state.legResult || state.matchWinner !== null) return;
    const timer = setTimeout(() => onChange(maybePlayComTurn(state)), 700);
    return () => clearTimeout(timer);
  }, [isComTurn, state, onChange]);

  const submitScore = useCallback(
    (rawValue: string, finishDarts?: number) => {
      const numeric = Number(rawValue);
      if (rawValue === '' || Number.isNaN(numeric)) return;

      const remaining = activePlayer.remaining;
      const scored = remainingEntryMode ? remaining - numeric : numeric;
      if (remainingEntryMode && (numeric < 0 || numeric > remaining)) {
        showNotice(`残り点数は0～${remaining}の整数で入力してください。`, 'warning');
        return;
      }

      // An exact finish needs the player to declare how many darts they used.
      if (scored === remaining && scored > 0 && finishDarts === undefined) {
        const counts = validFinishDartCounts(remaining);
        if (counts.length === 0) {
          showNotice(`残り${remaining}は上がれない数字のため、上がり申告できません。`, 'warning');
          return;
        }
        setPendingFinish(scored);
        setModal('finish-darts');
        return;
      }

      try {
        const next = applyVisit(state, scored, finishDarts, dartsUsed);
        onChange(next);
        setEntry('');
        setPendingFinish(null);
        setModal('none');
        setDartsUsed(3); // 使用ダーツ is a per-visit override, not a sticky setting.
        setSelectedVisit(null);
        const lastVisit = next.visits[next.visits.length - 1];
        if (lastVisit?.bust) showNotice('バスト：残り点数は変わりません。', 'warning');
        else setNotice(null);
      } catch (error) {
        if (error instanceof InvalidVisitError) showNotice(error.message, 'warning');
        else throw error;
      }
    },
    [activePlayer.remaining, dartsUsed, onChange, remainingEntryMode, showNotice, state],
  );

  const pressKey = useCallback(
    (key: string) => {
      if (key === 'enter') {
        submitScore(entry);
        return;
      }
      if (key === 'delete') {
        setEntry((value) => value.slice(0, -1));
        return;
      }
      setEntry((value) => (value.length >= 3 ? value : value + key));
    },
    [entry, submitScore],
  );

  /** Every played cell in table order, so the arrow keys can walk the score sheet. */
  const navCells = useMemo(() => {
    const perPlayer: [number[], number[]] = [[], []];
    state.visits.forEach((visit, index) => perPlayer[visit.player].push(index));
    const cells: Array<{ index: number; row: number; player: 0 | 1 }> = [];
    const rowCount = Math.max(perPlayer[0].length, perPlayer[1].length);
    for (let row = 0; row < rowCount; row += 1) {
      for (const player of [0, 1] as const) {
        const index = perPlayer[player][row];
        if (index !== undefined) cells.push({ index, row, player });
      }
    }
    return cells;
  }, [state.visits]);

  /** Arrow keys walk the played cells; the first press parks on the most recent visit. */
  const moveSelection = useCallback(
    (key: string) => {
      if (navCells.length === 0) return;
      const last = navCells[navCells.length - 1].index;
      setSelectedVisit((current) => {
        if (current === null) return last;
        const from = navCells.find((cell) => cell.index === current);
        if (!from) return last;
        const rowDelta = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
        const playerDelta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
        const target = navCells.find(
          (cell) => cell.row === from.row + rowDelta && cell.player === from.player + playerDelta,
        );
        return target?.index ?? current;
      });
    },
    [navCells],
  );

  /** Opens the past-score editor. `seedDigit` starts a fresh number, for type-over-a-selected-cell. */
  const openEditor = useCallback(
    (index: number, seedDigit?: string) => {
      const visit = state.visits[index];
      if (!visit) return;
      setSelectedVisit(index);
      setEditIndex(index);
      setEditScore(seedDigit ?? String(visit.score));
      setEditDarts(visit.darts);
      setModal('edit');
    },
    [state.visits],
  );

  const openFinishDialog = useCallback(() => {
    const counts = validFinishDartCounts(activePlayer.remaining);
    if (counts.length === 0) {
      showNotice(`残り${activePlayer.remaining}は上がれない数字のため、上がり申告できません。`, 'warning');
      return;
    }
    setPendingFinish(activePlayer.remaining);
    setModal('finish-darts');
  }, [activePlayer.remaining, showNotice]);

  const closeMenuWith = useCallback((run: () => void) => {
    run();
    setModal('none');
  }, []);

  const commitEdit = useCallback(() => {
    if (editIndex === null) return;
    try {
      onChange(editVisit(state, editIndex, Number(editScore), editDarts));
      setModal('none');
      showNotice(`${editIndex + 1}件目の得点を修正し、以降の残り点数を再計算しました。`);
    } catch (error) {
      if (error instanceof InvalidVisitError) showNotice(error.message, 'warning');
      else throw error;
    }
  }, [editDarts, editIndex, editScore, onChange, showNotice, state]);

  const goToNextLeg = useCallback(() => {
    onChange(advanceLeg(state));
    setEntry('');
    setDartsUsed(3);
    setSelectedVisit(null);
  }, [onChange, state]);

  const rewindToPreviousLeg = useCallback(() => {
    if (state.completed.length === 0) return;
    // The rewound completion must also leave the 成績 history, and free its slot in historyRecorded
    // so the replayed leg is recorded again when it finishes.
    historyRecorded.current.delete(state.completed.length - 1);
    removeLatestHistory();
    onChange(resumePreviousLeg(state));
    setEntry('');
    setDartsUsed(3);
    setSelectedVisit(null);
    showNotice('前のLegを勝利直前の状態で再開しました。以降の進行は破棄されます。');
  }, [onChange, showNotice, state]);

  // Keyboard support mirrors the on-screen keypad.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never act on the Enter that merely commits an IME conversion, and never let a held key
      // repeat-fire an action (a held U would otherwise unwind the whole leg).
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;

      const target = event.target as HTMLElement | null;
      const onButton = target?.tagName === 'BUTTON';
      // ESC and BackSpace are the shared "cancel / go back" pair on every dialog.
      const closeKey = event.key === 'Escape' || event.key === 'Backspace';

      // The leg-result dialog and the match-result card are driven by state.legResult/matchWinner,
      // not by `modal`, so they need their own branch here - without it the <kbd>Enter</kbd> badge on
      // 「次のLegへ」 promises a shortcut that no listener implements. Claim every key while one is up
      // so nothing queues into the keypad behind the dialog, and leave a focused button to the
      // browser's own Enter-activates-button handling so 「戻る」 cannot fire twice (or fire at all
      // when 「次のLegへ」 was meant).
      if ((state.legResult !== null || state.matchWinner !== null) && !awaitingRoundLimit) {
        if (onButton) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          if (state.matchWinner === null) goToNextLeg();
          else onExit({ clearSave: true });
        } else if (closeKey) {
          event.preventDefault();
          onChange(undoLastAction(state)); // 戻る: un-finish the leg to re-declare the checkout.
        }
        return;
      }

      if (effectiveModal === 'round-limit') {
        if (/^[1-3]$/.test(event.key)) {
          event.preventDefault();
          onChange(resolveRoundLimit(state, event.key === '1' ? 0 : event.key === '3' ? 1 : 'draw'));
          setModal('none');
        }
        return;
      }

      if (effectiveModal === 'finish-darts') {
        const counts = pendingFinish !== null ? validFinishDartCounts(activePlayer.remaining) : [];
        const digit = Number(event.key);
        if (/^[1-3]$/.test(event.key) && counts.includes(digit)) {
          event.preventDefault();
          submitScore(String(pendingFinish), digit);
        } else if (closeKey) {
          event.preventDefault();
          setModal('none');
          setPendingFinish(null);
        }
        return;
      }

      if (effectiveModal === 'menu') {
        if (event.key === '1' && !isComTurn) {
          event.preventDefault();
          closeMenuWith(() => {
            setRemainingEntryMode((value) => !value);
            setEntry('');
          });
        } else if (event.key === '2' && !state.settings.comEnabled.some(Boolean)) {
          event.preventDefault();
          closeMenuWith(() => {
            onChange(swapCurrentLegScores(state));
            showNotice('このLegのプレイヤー別スコア履歴を入れ替えました。');
          });
        } else if (event.key === '3' && state.completed.length > 0) {
          event.preventDefault();
          closeMenuWith(() => rewindToPreviousLeg());
        } else if (event.key === '4') {
          event.preventDefault();
          closeMenuWith(() => onChange(declareDraw(state)));
        } else if (closeKey) {
          event.preventDefault();
          setModal('none');
        }
        return;
      }

      if (effectiveModal === 'stats') {
        if (closeKey) {
          event.preventDefault();
          setModal('none');
        }
        return;
      }

      // The edit dialog owns its own keys through its focused <input>.
      if (effectiveModal !== 'none') return;

      // Gameplay keys. Never steal a key from a real text field, and leave a focused button its
      // native Enter/Space/Tab activation.
      if (isComTurn) return;
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      if (onButton && ['Enter', ' ', 'Tab'].includes(event.key)) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        // Typing over a selected past cell starts correcting it, rather than feeding the keypad.
        if (activeSelection !== null) openEditor(activeSelection, event.key);
        else pressKey(event.key);
        return;
      }

      switch (event.key) {
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (activeSelection !== null) openEditor(activeSelection);
          else pressKey('enter');
          break;
        case 'Backspace':
        case 'Delete':
          event.preventDefault();
          if (activeSelection !== null) setSelectedVisit(null);
          else if (entry.length > 0) pressKey('delete');
          break;
        case 'Escape':
          event.preventDefault();
          if (activeSelection !== null) setSelectedVisit(null);
          else setEntry('');
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(event.key);
          break;
        case '+':
          event.preventDefault();
          setDartsUsed((value) => Math.min(3, value + 1));
          break;
        case '-':
          event.preventDefault();
          setDartsUsed((value) => Math.max(1, value - 1));
          break;
        default:
          switch (event.key.toLowerCase()) {
            case 'f':
              event.preventDefault();
              openFinishDialog();
              break;
            case 'm':
              event.preventDefault();
              setModal('menu');
              break;
            case 'n':
              event.preventDefault();
              onExit({ clearSave: true });
              break;
            case 's':
              event.preventDefault();
              setModal('stats');
              break;
            case 'u':
              event.preventDefault();
              onChange(undoLastAction(state));
              showNotice('直前の入力を取り消しました。');
              break;
            case 'r': {
              event.preventDefault();
              const index = activeSelection ?? state.visits.length - 1;
              if (index >= 0) openEditor(index);
              break;
            }
          }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activePlayer.remaining,
    awaitingRoundLimit,
    closeMenuWith,
    effectiveModal,
    entry,
    isComTurn,
    moveSelection,
    onChange,
    onExit,
    openEditor,
    openFinishDialog,
    pendingFinish,
    pressKey,
    rewindToPreviousLeg,
    activeSelection,
    goToNextLeg,
    showNotice,
    state,
    submitScore,
  ]);

  const pickStarter = useCallback(
    (starter: 0 | 1) => {
      const next = setLegStarter(state, starter);
      if (next === state) return;
      onChange(next);
      setEntry('');
      showNotice(`${state.players[starter].name}を先攻に変更しました。`);
    },
    [onChange, showNotice, state],
  );

  const rows = useMemo(() => buildRows(state), [state]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [rows.length]);

  const finishCounts = pendingFinish !== null ? validFinishDartCounts(activePlayer.remaining) : [];
  const routes = state.settings.showRoute
    ? ([0, 1] as const).map((index) => suggestCheckoutRoute(state.players[index].remaining))
    : [null, null];

  if (state.matchWinner !== null) {
    return (
      <MatchResultCard
        state={state}
        onNewMatch={() => onExit({ clearSave: true })}
        onBackToMenu={() => onExit({ clearSave: true })}
      />
    );
  }

  return (
    <section className="n01-game-shell">
      {/* Source order is load-bearing: the header is a 3-column grid (player | leg | player). */}
      <header className="n01-game-header">
        <div className={`n01-player-name ${state.active === 0 ? 'active' : ''}`}>
          <span>{state.legStarter === 0 ? '先攻' : '後攻'}</span>
          <strong>{state.players[0].name}</strong>
          {state.active === 0 && <em aria-label="現在のスロー">THROW</em>}
        </div>
        <div className="n01-leg-center">
          <small>LEG {state.leg}</small>
          <strong>
            {state.players[0].legs} - {state.players[1].legs}
          </strong>
        </div>
        <div className={`n01-player-name right ${state.active === 1 ? 'active' : ''}`}>
          {state.active === 1 && <em aria-label="現在のスロー">THROW</em>}
          <strong>{state.players[1].name}</strong>
          <span>{state.legStarter === 1 ? '先攻' : '後攻'}</span>
        </div>
      </header>

      <div className="n01-score-area">
        <div className="n01-game-meta">
          <span>
            {state.settings.mode === '01' ? `${state.startScore} GAME` : `CHECKOUT ${state.startScore}`}
            {state.settings.roundLimit ? `・最大${state.settings.maxRounds}R` : ''}
          </span>
          <strong>
            {activePlayer.name} の{remainingEntryMode ? '残り点数入力' : '得点入力'}
          </strong>
          <span>3 darts</span>
        </div>

        {notice && (
          <p className={`n01-notice ${noticeKind === 'warning' ? 'warning' : ''}`} role="status">
            {notice}
          </p>
        )}

        <div className="n01-score-scroll" ref={scrollRef} tabIndex={0} aria-label="全ラウンド履歴">
          <table className="n01-score-table">
            <thead>
              <tr>
                <th scope="col">得点</th>
                <th scope="col">残り</th>
                <th scope="col">Darts</th>
                <th scope="col">得点</th>
                <th scope="col">残り</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.round}>
                  <ScoreCell
                    cell={row.cells[0]}
                    isCurrent={state.active === 0 && row.isCurrentRow}
                    entry={entry}
                    onSelect={(index) => openEditor(index)}
                    selectedVisit={activeSelection}
                    playerName={state.players[0].name}
                    onPickStarter={canPickStarter && row.round === 1 ? () => pickStarter(0) : undefined}
                  />
                  <td className="to-go">{toGo(row, 0, state)}</td>
                  <td className="darts">{row.darts}</td>
                  <ScoreCell
                    cell={row.cells[1]}
                    isCurrent={state.active === 1 && row.isCurrentRow}
                    entry={entry}
                    onSelect={(index) => openEditor(index)}
                    selectedVisit={activeSelection}
                    playerName={state.players[1].name}
                    onPickStarter={canPickStarter && row.round === 1 ? () => pickStarter(1) : undefined}
                  />
                  <td className="to-go">{toGo(row, 1, state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="n01-table-hint">
          得点表をスクロールすると1ラウンド目から確認できます。得点セルを選択すると過去ラウンドを修正できます。
          {canPickStarter && '1ラウンド目の未入力の間は、相手側の「—」セルを選択すると先攻を入れ替えられます。'}
        </p>
      </div>

      <footer className="n01-game-footer">
        <div className="n01-left-table">
          {([0, 1] as const).map((index) => (
            <div key={index} className={state.active === index ? 'active' : ''}>
              <strong>{state.players[index].remaining}</strong>
              {routes[index] ? (
                <span className="checkout-route">{routes[index]!.map(dartLabel).join(' - ')}</span>
              ) : (
                <span>3DA {threeDartAverage(state.players[index]).toFixed(1)}</span>
              )}
            </div>
          ))}
        </div>

        <nav className="n01-menu-table" aria-label="ゲームメニュー">
          <button type="button" onClick={() => onExit({ clearSave: true })}>
            New
          </button>
          <button type="button" onClick={openFinishDialog}>
            Finish
          </button>
          <button type="button" onClick={() => setModal('stats')}>
            Stats
          </button>
          <button type="button" aria-label="メニュー" onClick={() => setModal('menu')}>
            ☰
          </button>
        </nav>

        <div className="n01-key-table" aria-label="得点入力テンキー">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
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
            Enter
          </button>
        </div>
      </footer>

      {effectiveModal === 'finish-darts' && pendingFinish !== null && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="上がり本数を選択">
          <div className="n01-modal-card menu-list">
            <h2>上がり本数</h2>
            {finishCounts.map((count) => (
              <button key={count} type="button" onClick={() => submitScore(String(pendingFinish), count)}>
                <kbd>{count}</kbd>{'\u3000'}{count}本目で終了
              </button>
            ))}
            <p>
              残り{activePlayer.remaining}は最短{finishCounts[0]}本で上がれます。ボタンまたは数字キーで選択してください。
            </p>
            <button
              type="button"
              onClick={() => {
                setModal('none');
                setPendingFinish(null);
              }}
            >
              戻る
            </button>
          </div>
        </div>
      )}

      {effectiveModal === 'round-limit' && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="Legの勝敗を選択">
          <div className="n01-modal-card menu-list">
            <h2>{state.settings.maxRounds}ラウンド終了</h2>
            <p>このLegの結果を選択してください。</p>
            <button
              type="button"
              onClick={() => {
                onChange(resolveRoundLimit(state, 0));
                setModal('none');
              }}
            >
              <kbd>1</kbd>{'\u3000'}{state.players[0].name} の勝ち
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(resolveRoundLimit(state, 'draw'));
                setModal('none');
              }}
            >
              <kbd>2</kbd>{'\u3000'}引き分け
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(resolveRoundLimit(state, 1));
                setModal('none');
              }}
            >
              <kbd>3</kbd>{'\u3000'}{state.players[1].name} の勝ち
            </button>
          </div>
        </div>
      )}

      {effectiveModal === 'menu' && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="ゲームメニュー">
          <div className="n01-modal-card menu-list">
            <h2>メニュー</h2>
            <div className="n01-darts-inline">
              <span>使用ダーツ</span>
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={dartsUsed === count ? 'selected' : ''}
                  onClick={() => setDartsUsed(count)}
                >
                  {count}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={isComTurn}
              onClick={() =>
                closeMenuWith(() => {
                  setRemainingEntryMode((value) => !value);
                  setEntry('');
                })
              }
            >
              <kbd>1</kbd>{'　'}{remainingEntryMode ? '得点入力に戻す' : '残り点数で入力'}
            </button>
            <button
              type="button"
              disabled={state.settings.comEnabled.some(Boolean)}
              onClick={() =>
                closeMenuWith(() => {
                  onChange(swapCurrentLegScores(state));
                  showNotice('このLegのプレイヤー別スコア履歴を入れ替えました。');
                })
              }
            >
              <kbd>2</kbd>{'　'}プレイヤーのスコアを入れ替え
            </button>
            <button
              type="button"
              disabled={state.undo.length === 0}
              onClick={() =>
                closeMenuWith(() => {
                  onChange(undoLastAction(state));
                  showNotice('直前の入力を取り消しました。');
                })
              }
            >
              <kbd>U</kbd>{'　'}直前の入力を戻す
            </button>
            <button
              type="button"
              disabled={state.completed.length === 0}
              onClick={() => closeMenuWith(rewindToPreviousLeg)}
            >
              <kbd>3</kbd>{'　'}前のLegをやり直す
            </button>
            <button type="button" onClick={() => closeMenuWith(() => onChange(declareDraw(state)))}>
              <kbd>4</kbd>{'　'}Legを終了・引き分け
            </button>
            <div className="keyboard-help" aria-label="キーボード操作">
              <span>
                <kbd>0–9</kbd>入力
              </span>
              <span>
                <kbd>Enter / Tab</kbd>確定
              </span>
              <span>
                <kbd>BackSpace / Delete</kbd>1文字削除
              </span>
              <span>
                <kbd>ESC</kbd>クリア・戻る
              </span>
              <span>
                <kbd>U</kbd>直前の入力を取消
              </span>
              <span>
                <kbd>矢印</kbd>履歴
              </span>
              <span>
                <kbd>R</kbd>選択中を修正
              </span>
              <span>
                <kbd>+ / -</kbd>使用ダーツ
              </span>
              <span>
                <kbd>F</kbd>Finish
              </span>
              <span>
                <kbd>M</kbd>メニュー
              </span>
              <span>
                <kbd>S</kbd>Stats
              </span>
              <span>
                <kbd>N</kbd>New
              </span>
            </div>
            <button type="button" onClick={() => setModal('none')}>
              戻る
            </button>
          </div>
        </div>
      )}

      {effectiveModal === 'stats' && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="対戦成績">
          <div className="n01-modal-card n01-stats-modal">
            <h2>対戦成績</h2>
            <div className="n01-stats-table">
              <div className="n01-stats-head">
                <strong>{state.players[0].name}</strong>
                <span>STATS</span>
                <strong>{state.players[1].name}</strong>
              </div>
              <StatsRow label="3DA" values={([0, 1] as const).map((i) => threeDartAverage(state.players[i]).toFixed(2))} />
              <StatsRow label="LEGS" values={([0, 1] as const).map((i) => String(state.players[i].legs))} />
              <StatsRow label="DARTS" values={([0, 1] as const).map((i) => String(state.players[i].totalDarts))} />
              <StatsRow label="100+" values={([0, 1] as const).map((i) => String(state.players[i].ton00Count))} />
              <StatsRow label="140+" values={([0, 1] as const).map((i) => String(state.players[i].ton40Count))} />
              <StatsRow label="180" values={([0, 1] as const).map((i) => String(state.players[i].ton80Count))} />
              <StatsRow
                label="HIGH OUT"
                values={([0, 1] as const).map((i) => String(state.players[i].highestFinish || '—'))}
              />
            </div>
            <button type="button" className="n01-modal-primary" onClick={() => setModal('none')}>
              閉じる
            </button>
          </div>
        </div>
      )}

      {effectiveModal === 'edit' && editIndex !== null && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="過去得点の修正">
          <div className="n01-modal-card">
            <h2>過去得点を修正</h2>
            <label>
              <span>得点</span>
              <input
                type="number"
                inputMode="numeric"
                autoFocus
                value={editScore}
                onChange={(event) => setEditScore(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    commitEdit();
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setModal('none');
                  }
                }}
              />
            </label>
            <div className="n01-darts-inline">
              <span>使用ダーツ</span>
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={editDarts === count ? 'selected' : ''}
                  onClick={() => setEditDarts(count)}
                >
                  {count}本
                </button>
              ))}
            </div>
            <button
              type="button"
              className="n01-modal-primary"
              onClick={commitEdit}
            >
              修正して再計算
            </button>
            <button type="button" className="n01-modal-cancel" onClick={() => setModal('none')}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {state.legResult && !awaitingRoundLimit && (
        <div className="result-backdrop" role="dialog" aria-modal="true" aria-label="Leg結果">
          <div className="result-card">
            <div className="result-icon" aria-hidden="true">
              ✓
            </div>
            <p>LEG {state.leg} WINNER</p>
            <h2>
              {state.legResult.winner === null ? '引き分け' : state.players[state.legResult.winner].name}
            </h2>
            <div className="result-numbers">
              <span>
                <strong>{state.startScore}</strong>
                開始点
              </span>
              <span>
                <strong>{state.legResult.darts || '—'}</strong>
                使用ダーツ
              </span>
            </div>
            <button type="button" className="primary-button" onClick={goToNextLeg}>
              次のLegへ <kbd>Enter</kbd>
            </button>
            <button type="button" className="text-button" onClick={() => onChange(undoLastAction(state))}>
              戻る（本数を選び直す） <kbd>ESC</kbd>
            </button>
          </div>
        </div>
      )}
    </section>
  );

}

function StatsRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="n01-stats-row">
      <strong>{values[0]}</strong>
      <span>{label}</span>
      <strong>{values[1]}</strong>
    </div>
  );
}

interface RowCell {
  visitIndex: number;
  score: number;
  after: number;
  bust: boolean;
}

interface Row {
  round: number;
  cells: [RowCell | null, RowCell | null];
  darts: number;
  isCurrentRow: boolean;
}

/**
 * A played row shows what the visit left; the active player's upcoming row shows their live
 * remaining, so the number they are throwing at is always on screen.
 */
function toGo(row: Row, player: 0 | 1, state: X01MatchState): string {
  const cell = row.cells[player];
  if (cell) return String(cell.after);
  if (row.isCurrentRow && state.active === player) return String(state.players[player].remaining);
  return '—';
}

function buildRows(state: X01MatchState): Row[] {
  const perPlayer: [RowCell[], RowCell[]] = [[], []];
  state.visits.forEach((visit, index) => {
    perPlayer[visit.player].push({
      visitIndex: index,
      score: visit.score,
      after: visit.after,
      bust: visit.bust,
    });
  });

  const rowCount = Math.max(perPlayer[0].length, perPlayer[1].length) + 1;
  const rows: Row[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cells: [RowCell | null, RowCell | null] = [perPlayer[0][i] ?? null, perPlayer[1][i] ?? null];
    rows.push({
      round: i + 1,
      cells,
      darts: (i + 1) * 3,
      isCurrentRow: i === perPlayer[state.active].length,
    });
  }
  return rows;
}

function ScoreCell({
  cell,
  isCurrent,
  entry,
  onSelect,
  playerName,
  onPickStarter,
  selectedVisit,
}: {
  cell: RowCell | null;
  isCurrent: boolean;
  entry: string;
  onSelect: (visitIndex: number) => void;
  playerName: string;
  /** Index of the visit the arrow keys are parked on, so it can be highlighted. */
  selectedVisit: number | null;
  /** Set only on the opponent's empty 1st-round cell of an untouched leg; tapping it hands them the throw. */
  onPickStarter?: () => void;
}) {
  if (cell) {
    const display = cell.bust ? 'BUST' : String(cell.score);
    return (
      <td className="scored">
        <button
          type="button"
          className={selectedVisit === cell.visitIndex ? 'selected' : ''}
          onClick={() => onSelect(cell.visitIndex)}
          aria-label={`${display} を修正`}
        >
          {cell.score >= 100 && !cell.bust ? <span className="ton-score">{display}</span> : display}
        </button>
      </td>
    );
  }
  if (isCurrent) {
    return (
      <td className="scored current">
        <input value={entry} readOnly aria-label="得点入力" />
      </td>
    );
  }
  if (onPickStarter) {
    return (
      <td className="scored">
        <button
          type="button"
          className="starter-picker"
          aria-label={`${playerName}を先攻にする`}
          title={`${playerName}を先攻にする`}
          onClick={onPickStarter}
        >
          —
        </button>
      </td>
    );
  }
  return (
    <td className="scored">
      <span>—</span>
    </td>
  );
}
