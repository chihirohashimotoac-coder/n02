import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PentathlonModal from './PentathlonModal';
import { getEngine } from '../../domain/pentathlon/presets';
import {
  currentDisciplineId,
  disciplineCount,
  isSingleGameSession,
} from '../../domain/pentathlon/session';
import { InvalidVisitError, resolveVisit } from '../../domain/x01Core';
import { classifyAward } from '../../domain/awards';
import type { AwardPresentation } from '../common/AwardOverlay';
import { suggestCheckoutRoute, validFinishDartCounts, dartLabel } from '../../domain/darts';
import { DISCIPLINE_RULE_TEXT } from '../../domain/pentathlon/ruleText';
import type { X01SoloState, X01SoloInput } from '../../domain/pentathlon/engines/x01Solo';
import type { PentathlonSession, PlayerIndex } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onTurn: (input: X01SoloInput) => void;
  /** Takes back the previous committed round (X01 has no per-dart staging). */
  onUndoRound: () => void;
  /** Corrects one already-committed visit and replays the rest of that player's attempt. */
  onEditVisit: (player: PlayerIndex, visitIndex: number, score: number, darts: number) => void;
  canUndoRound: boolean;
  onExit: () => void;
  error: string | null;
  onError: (message: string | null) => void;
  /** The shared アワード表示 setting, owned by PentathlonFlow so it survives a discipline change. */
  awardsEnabled: boolean;
  onToggleAwards: () => void;
  /** Hands a just-earned award up to the flow, which presents it. */
  onAward: (award: Omit<AwardPresentation, 'id'>) => void;
}

type Modal = 'none' | 'finish-darts' | 'menu' | 'stats' | 'rules' | 'edit';

/**
 * 301/501 in Pentathlon. Deliberately the same screen as 通常01・チェックアウト練習 (GameScreen): the
 * same fullscreen shell, the same round-by-round score table, the same footer and keypad, and the
 * same race - whoever checks out first wins the discipline outright. GameScreen itself is left
 * untouched; this is a parallel implementation over the Pentathlon session state, because the two
 * screens read from completely different engines.
 *
 * That includes GameScreen's edit-a-past-score flow: tapping any already-entered score cell opens
 * the same 修正して再計算 dialog, backed by the X01 engine's own editVisit.
 */
export default function PentathlonX01Play({
  session,
  onTurn,
  onUndoRound,
  onEditVisit,
  canUndoRound,
  onExit,
  error,
  onError,
  awardsEnabled,
  onToggleAwards,
  onAward,
}: Props) {
  const [entry, setEntry] = useState('');
  const [modal, setModal] = useState<Modal>('none');
  const [pendingFinish, setPendingFinish] = useState<number | null>(null);
  const [edit, setEdit] = useState<{
    player: PlayerIndex;
    visitIndex: number;
    /** What the player was on before this visit - what decides whether a correction can go out. */
    remainingBefore: number;
  } | null>(null);
  const [editScore, setEditScore] = useState('');
  const [editDarts, setEditDarts] = useState(3);
  /**
   * The score cell the arrow keys are parked on, exactly as 通常01・チェックアウト練習 park theirs.
   *
   * A pair rather than an index: 通常01 keeps one interleaved visit list, whereas each Pentathlon
   * player has their own, so a cell is only identified by both halves.
   */
  const [selected, setSelected] = useState<{ player: PlayerIndex; visitIndex: number } | null>(null);
  // Shown inside the edit dialog: the play screen's own error banner sits behind it, where a
  // rejected correction would go unread.
  const [editError, setEditError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const current = session.current!;
  const disciplineId = currentDisciplineId(session);
  const engine = getEngine(disciplineId);
  const active = current.active;
  const activeState = current.progress[active].state as X01SoloState;
  const solo = session.playerCount === 1;
  const players: PlayerIndex[] = solo ? [0] : [0, 1];

  /**
   * Every played cell in table order, so the arrow keys can walk the score sheet. Each player's
   * attempt is its own list here, and the visit index IS the round, so a row is simply that index
   * across the players.
   */
  const navCells = useMemo(() => {
    const columns: PlayerIndex[] = solo ? [0] : [0, 1];
    const counts = columns.map(
      (player) => (current.progress[player].state as X01SoloState).visits.length,
    );
    const cells: Array<{ player: PlayerIndex; visitIndex: number; row: number }> = [];
    for (let row = 0; row < Math.max(0, ...counts); row += 1) {
      columns.forEach((player, column) => {
        if (row < counts[column]) cells.push({ player, visitIndex: row, row });
      });
    }
    return cells;
  }, [current.progress, solo]);

  /**
   * The parked cell, but only while it still exists. An UNDO or a correction that drops later
   * visits can take the selected cell away underneath it; treating a stale pair as "nothing
   * selected" keeps every digit going to the keypad rather than to a cell that is no longer there.
   */
  const activeSelection = useMemo(() => {
    if (selected === null) return null;
    const state = current.progress[selected.player].state as X01SoloState;
    return state.visits[selected.visitIndex] !== undefined ? selected : null;
  }, [current.progress, selected]);

  /** Arrow keys walk the played cells; the first press parks on the most recent visit. */
  const moveSelection = useCallback(
    (key: string) => {
      if (navCells.length === 0) return;
      const last = navCells[navCells.length - 1];
      setSelected((cell) => {
        const from = cell === null ? null : navCells.find(
          (candidate) => candidate.player === cell.player && candidate.visitIndex === cell.visitIndex,
        );
        if (!from) return { player: last.player, visitIndex: last.visitIndex };
        const rowDelta = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
        const playerDelta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
        const target = navCells.find(
          (candidate) =>
            candidate.row === from.row + rowDelta && candidate.player === from.player + playerDelta,
        );
        return target ? { player: target.player, visitIndex: target.visitIndex } : cell;
      });
    },
    [navCells],
  );

  /**
   * Presents the award a just-committed visit earned, if any - the same six awards, the same
   * classifier and the same SEPARATE BULL reading 通常01・チェックアウト練習 use, because 301/501 here
   * take a visit total too.
   *
   * Called only from the one place a visit is appended, right after the turn is accepted, so an
   * undo, a past-score correction or a discipline replay can never fire one. `resolveVisit` is the
   * very function the engine itself just ran, called again purely to read back whether the visit
   * busted or checked out; it is pure, and nothing here is written to the session.
   */
  const announceAward = useCallback(
    (score: number, remainingBefore: number, finishDarts?: number) => {
      if (!awardsEnabled) return;
      let checkout: boolean;
      try {
        const resolution = resolveVisit(remainingBefore, score, finishDarts);
        // A bust scores nothing, so it earns nothing.
        if (resolution.bust) return;
        checkout = resolution.checkout;
      } catch {
        // The engine would have rejected the same visit; there is no award for a throw not made.
        return;
      }
      const kind = classifyAward(score, {
        mode: 'x01',
        // A visit total, so 150 is THREE IN THE BLACK here; HAT TRICK stays COUNT-UP's.
        bullMode: 'separate',
        remainingBefore,
        checkout,
      });
      if (!kind) return;
      onAward({ kind, score, playerName: session.names[active] });
    },
    [active, awardsEnabled, onAward, session.names],
  );

  const submitVisit = useCallback(
    (rawValue: string, finishDarts?: number) => {
      const score = Number(rawValue);
      if (rawValue === '' || Number.isNaN(score)) return;

      if (score === activeState.remaining && score > 0 && finishDarts === undefined) {
        const counts = validFinishDartCounts(activeState.remaining);
        if (counts.length === 0) {
          onError(`残り${activeState.remaining}は上がれない数字のため、上がり申告できません。`);
          return;
        }
        setPendingFinish(score);
        setModal('finish-darts');
        return;
      }

      const remainingBefore = activeState.remaining;
      try {
        onTurn({ score, finishDarts });
        setEntry('');
        setPendingFinish(null);
        setModal('none');
        onError(null);
      } catch (caught) {
        if (caught instanceof InvalidVisitError) onError(caught.message);
        else throw caught;
        return;
      }
      // After the turn is committed, and never in its place.
      announceAward(score, remainingBefore, finishDarts);
    },
    [activeState.remaining, announceAward, onError, onTurn],
  );

  const pressKey = useCallback(
    (key: string) => {
      if (key === 'enter') {
        submitVisit(entry);
        return;
      }
      if (key === 'delete') {
        setEntry((value) => value.slice(0, -1));
        return;
      }
      setEntry((value) => (value.length >= 3 ? value : value + key));
    },
    [entry, submitVisit],
  );

  const openFinishModal = useCallback(() => {
    const counts = validFinishDartCounts(activeState.remaining);
    if (counts.length === 0) {
      onError(`残り${activeState.remaining}は上がれない数字のため、上がり申告できません。`);
      return;
    }
    setPendingFinish(activeState.remaining);
    setModal('finish-darts');
  }, [activeState.remaining, onError]);

  const closeFinishModal = useCallback(() => {
    setModal('none');
    setPendingFinish(null);
  }, []);

  /** Opens the past-score editor. `seedDigit` starts a fresh number, for type-over-a-selected-cell. */
  const openEditor = useCallback(
    (player: PlayerIndex, visitIndex: number, seedDigit?: string) => {
      const state = current.progress[player].state as X01SoloState;
      const visit = state.visits[visitIndex];
      if (!visit) return;
      // Everything before the edited visit is untouched, so the score it was thrown at is exact.
      const remainingBefore = state.visits
        .slice(0, visitIndex)
        .reduce((left, earlier) => left - earlier.score, state.startScore);
      setSelected({ player, visitIndex });
      setEdit({ player, visitIndex, remainingBefore });
      setEditScore(seedDigit ?? String(visit.entered ?? visit.score));
      setEditDarts(visit.darts);
      setEditError(null);
      setModal('edit');
    },
    [current.progress],
  );

  /**
   * Leaves the past-score editor, whether the correction was committed or abandoned.
   *
   * Unparking the cell is the point, and the same fix 通常01・チェックアウト練習 carry: openEditor
   * parks the arrow-key selection on the cell being corrected, and while a cell is parked every
   * digit is routed into a correction of THAT cell instead of the keypad.
   */
  const closeEditor = useCallback(() => {
    setModal('none');
    setEdit(null);
    setEditError(null);
    setSelected(null);
  }, []);

  /*
   * The gameplay keyboard, deliberately the same one 通常01・チェックアウト練習 answer to. Any open
   * PentathlonModal swallows keystrokes in the capture phase before this listener runs, and drives
   * its own buttons natively, so there is no dialog-specific branch here to fall out of sync.
   *
   * Not mapped, and not an oversight: 通常01's <kbd>+</kbd> / <kbd>-</kbd> 使用ダーツ. A Pentathlon
   * X01 attempt is SCORED in darts - getResult() ranks by the dart count - so letting a visit
   * declare fewer than three would not adjust a statistic, it would change who wins the discipline.
   * The one visit where the count is real, the checkout, already asks for it in its own dialog.
   */
  useEffect(() => {
    if (modal !== 'none') return;
    const handler = (event: KeyboardEvent) => {
      // Never act on the Enter that merely commits an IME conversion, and never let a held key
      // repeat-fire an action (a held U would otherwise unwind the whole attempt).
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;

      // Never steal a key from a real text field, and leave a focused button its native
      // Enter/Space/Tab activation - otherwise Enter on the ☰ button would open the menu AND
      // commit the score sitting in the entry.
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
      if (target?.tagName === 'BUTTON' && ['Enter', ' ', 'Tab'].includes(event.key)) return;

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        // Typing over a selected past cell starts correcting it, rather than feeding the keypad.
        if (activeSelection !== null) openEditor(activeSelection.player, activeSelection.visitIndex, event.key);
        else pressKey(event.key);
        return;
      }

      switch (event.key) {
        case 'Enter':
        case 'Tab':
          event.preventDefault();
          if (activeSelection !== null) openEditor(activeSelection.player, activeSelection.visitIndex);
          else pressKey('enter');
          break;
        case 'Backspace':
        case 'Delete':
          event.preventDefault();
          if (activeSelection !== null) setSelected(null);
          else if (entry.length > 0) pressKey('delete');
          break;
        case 'Escape':
          event.preventDefault();
          if (activeSelection !== null) setSelected(null);
          else setEntry('');
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          event.preventDefault();
          moveSelection(event.key);
          break;
        default:
          switch (event.key.toLowerCase()) {
            case 'f':
              event.preventDefault();
              openFinishModal();
              break;
            case 'm':
              event.preventDefault();
              setModal('menu');
              break;
            case 'n':
              // 通常01's N abandons the match outright. Here it is the footer's 中断: the session
              // is saved and can be resumed from the menu, so a stray press costs nothing.
              event.preventDefault();
              onExit();
              break;
            case 's':
              event.preventDefault();
              setModal('stats');
              break;
            case 'u':
              event.preventDefault();
              onUndoRound();
              break;
            case 'r': {
              event.preventDefault();
              const cell = activeSelection ?? navCells[navCells.length - 1];
              if (cell) openEditor(cell.player, cell.visitIndex);
              break;
            }
          }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeSelection,
    entry,
    modal,
    moveSelection,
    navCells,
    onExit,
    onUndoRound,
    openEditor,
    openFinishModal,
    pressKey,
  ]);

  const rows = useMemo(() => buildRows(current.progress, active, solo), [current.progress, active, solo]);

  // Keep the newest round in view, exactly as the 01 score sheet does.
  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [rows.length]);

  const finishCounts = pendingFinish !== null ? validFinishDartCounts(activeState.remaining) : [];

  // A correction that lands exactly on what the player was sitting on is a finish declaration, and
  // has to be held to the same double-out rules as one entered live.
  const isEditFinish = edit !== null && Number(editScore) === edit.remainingBefore && edit.remainingBefore > 0;
  const editFinishCounts = isEditFinish ? validFinishDartCounts(edit.remainingBefore) : [];
  const editEffectiveDarts = editFinishCounts.includes(editDarts) ? editDarts : (editFinishCounts[0] ?? 3);

  /**
   * Applies the correction, on Enter in the field or on the 修正して再計算 button - the same two
   * routes 通常01・チェックアウト練習 offer.
   *
   * The dart count is passed in rather than read from the render body: it only means anything on a
   * correction that finishes, and both call sites already have it in hand.
   */
  const commitEdit = useCallback(
    (darts: number) => {
      if (edit === null) return;
      try {
        onEditVisit(edit.player, edit.visitIndex, Number(editScore), darts);
        closeEditor();
        onError(null);
      } catch (caught) {
        if (caught instanceof InvalidVisitError) setEditError(caught.message);
        else throw caught;
      }
    },
    [closeEditor, edit, editScore, onEditVisit, onError],
  );

  const positionLabel = isSingleGameSession(session)
    ? '個別練習'
    : `種目 ${session.currentDisciplineIndex + 1} / ${disciplineCount(session)}`;

  return (
    <section className="n01-game-shell pent-x01-shell">
      {/* Source order is load-bearing: the header is a 3-column grid (player | discipline | player). */}
      <header className={`n01-game-header ${solo ? 'solo' : ''}`}>
        <div className={`n01-player-name ${active === 0 && !current.progress[0].finished ? 'active' : ''}`}>
          <span>{session.currentStarter === 0 ? '先攻' : '後攻'}</span>
          <strong>{session.names[0]}</strong>
          {current.progress[0].finished ? (
            <em>FINISHED</em>
          ) : active === 0 ? (
            <em aria-label="現在のスロー">THROW</em>
          ) : null}
        </div>
        <div className="n01-leg-center">
          <small>{positionLabel}</small>
          <strong>{engine.meta.name}</strong>
        </div>
        {!solo && (
          <div className={`n01-player-name right ${active === 1 && !current.progress[1].finished ? 'active' : ''}`}>
            {current.progress[1].finished ? (
              <em>FINISHED</em>
            ) : active === 1 ? (
              <em aria-label="現在のスロー">THROW</em>
            ) : null}
            <strong>{session.names[1]}</strong>
            <span>{session.currentStarter === 1 ? '先攻' : '後攻'}</span>
          </div>
        )}
      </header>

      <div className="n01-score-area">
        <div className="n01-game-meta">
          <span>{engine.meta.description}</span>
          <strong>{session.names[active]} の得点入力</strong>
          <span>3 darts</span>
        </div>

        {error && (
          <p className="n01-notice warning" role="alert">
            {error}
          </p>
        )}

        <div className="n01-score-scroll" ref={scrollRef} tabIndex={0} aria-label="全ラウンド履歴">
          <table className="n01-score-table">
            <thead>
              <tr>
                <th scope="col">得点</th>
                <th scope="col">残り</th>
                <th scope="col">Darts</th>
                {!solo && <th scope="col">得点</th>}
                {!solo && <th scope="col">残り</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.round}>
                  <ScoreCell
                    cell={row.cells[0]}
                    isCurrent={active === 0 && row.isCurrentRow}
                    entry={entry}
                    selected={activeSelection?.player === 0 ? activeSelection.visitIndex : null}
                    onSelect={(visitIndex) => openEditor(0, visitIndex)}
                  />
                  <td className="to-go">{toGo(row, 0, active, current.progress)}</td>
                  <td className="darts">{row.darts}</td>
                  {!solo && (
                    <ScoreCell
                      cell={row.cells[1]}
                      isCurrent={active === 1 && row.isCurrentRow}
                      entry={entry}
                      selected={activeSelection?.player === 1 ? activeSelection.visitIndex : null}
                      onSelect={(visitIndex) => openEditor(1, visitIndex)}
                    />
                  )}
                  {!solo && <td className="to-go">{toGo(row, 1, active, current.progress)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="n01-game-footer">
        <div className={`n01-left-table ${solo ? 'solo' : ''}`}>
          {players.map((index) => {
            const progress = current.progress[index];
            const state = progress.state as X01SoloState;
            const isActive = active === index && !progress.finished;
            const route =
              session.showRoute && !progress.finished ? suggestCheckoutRoute(state.remaining) : null;
            return (
              <div key={index} className={isActive ? 'active' : ''}>
                <strong>{state.remaining}</strong>
                {route ? (
                  <span className="checkout-route">{route.map(dartLabel).join(' - ')}</span>
                ) : (
                  <span>3DA {threeDartAverage(state).toFixed(1)}</span>
                )}
              </div>
            );
          })}
        </div>

        <nav className="n01-menu-table" aria-label="ゲームメニュー">
          <button type="button" onClick={onExit}>
            中断
          </button>
          <button type="button" onClick={openFinishModal}>
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

      {modal === 'finish-darts' && pendingFinish !== null && (
        <PentathlonModal
          label="上がり本数を選択"
          variant="menu-list"
          returnFocusTo={scrollRef}
          onClose={closeFinishModal}
          onKeyDown={(event) => {
            const digit = Number(event.key);
            if (finishCounts.includes(digit)) {
              event.preventDefault();
              submitVisit(String(pendingFinish), digit);
            } else if (event.key === 'Backspace') {
              event.preventDefault();
              closeFinishModal();
            }
          }}
        >
          <h2>上がり本数</h2>
          {finishCounts.map((count) => (
            <button key={count} type="button" onClick={() => submitVisit(String(pendingFinish), count)}>
              <kbd>{count}</kbd>{'　'}{count}本目で終了
            </button>
          ))}
          <p>
            残り{activeState.remaining}は最短{finishCounts[0]}本で上がれます。ボタンまたは数字キーで選択してください。
          </p>
          <button type="button" onClick={closeFinishModal}>
            戻る
          </button>
        </PentathlonModal>
      )}

      {modal === 'menu' && (
        <PentathlonModal
          label="ゲームメニュー"
          variant="menu-list"
          returnFocusTo={scrollRef}
          onClose={() => setModal('none')}
          onKeyDown={(event) => {
            if (event.key === '1' && canUndoRound) {
              event.preventDefault();
              onUndoRound();
              setModal('none');
            } else if (event.key === '2') {
              event.preventDefault();
              setModal('rules');
            } else if (event.key === '3') {
              event.preventDefault();
              setModal('none');
              onExit();
            } else if (event.key.toLowerCase() === 'a') {
              event.preventDefault();
              onToggleAwards();
              setModal('none');
            } else if (event.key === 'Backspace') {
              event.preventDefault();
              setModal('none');
            }
          }}
        >
          <h2>メニュー</h2>
          <button
            type="button"
            disabled={!canUndoRound}
            onClick={() => {
              onUndoRound();
              setModal('none');
            }}
          >
            <kbd>1</kbd>{'　'}前の確定ラウンドに戻す
          </button>
          <button type="button" onClick={() => setModal('rules')}>
            <kbd>2</kbd>{'　'}ルール説明
          </button>
          <button
            type="button"
            aria-pressed={awardsEnabled}
            onClick={() => {
              onToggleAwards();
              setModal('none');
            }}
          >
            <kbd>A</kbd>{'　'}アワード表示：{awardsEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            onClick={() => {
              setModal('none');
              onExit();
            }}
          >
            <kbd>3</kbd>{'　'}中断してメニューへ
          </button>
          {/* The same list 通常01・チェックアウト練習 show, minus the one key that cannot exist here:
              使用ダーツ is the discipline's own result metric, not a per-visit statistic. */}
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
              <kbd>U</kbd>前の確定ラウンドに戻す
            </span>
            <span>
              <kbd>矢印</kbd>履歴
            </span>
            <span>
              <kbd>R</kbd>選択中を修正
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
              <kbd>N</kbd>中断
            </span>
            <span>
              <kbd>A</kbd>アワード表示
            </span>
          </div>
          <button type="button" onClick={() => setModal('none')}>
            戻る
          </button>
        </PentathlonModal>
      )}

      {modal === 'rules' && (
        <PentathlonModal
          label={`${DISCIPLINE_RULE_TEXT[disciplineId].title}のルール`}
          onClose={() => setModal('menu')}
        >
          <h2>{DISCIPLINE_RULE_TEXT[disciplineId].title} のルール</h2>
          <p className="pent-rules-body">{DISCIPLINE_RULE_TEXT[disciplineId].body}</p>
          <button type="button" className="n01-modal-primary" onClick={() => setModal('menu')}>
            閉じる
          </button>
        </PentathlonModal>
      )}

      {modal === 'edit' && edit !== null && (
        <PentathlonModal label="過去得点の修正" returnFocusTo={scrollRef} onClose={closeEditor}>
          <h2>過去得点を修正</h2>
          <p className="pent-edit-target">
            {session.names[edit.player]}・{edit.visitIndex + 1} ラウンド目
          </p>
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
                  commitEdit(editEffectiveDarts);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeEditor();
                }
              }}
            />
          </label>
          {/*
            * The dart count only ever means anything on the visit that goes out - every other visit
            * is three darts. So it is offered only when the correction actually finishes, and then
            * only in the counts that can finish this number, rather than letting a 1-dart 170
            * through for the engine to reject.
            */}
          {editFinishCounts.length > 0 ? (
            <div className="n01-darts-inline">
              <span>上がり本数</span>
              {[1, 2, 3].map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={!editFinishCounts.includes(count)}
                  className={editEffectiveDarts === count ? 'selected' : ''}
                  onClick={() => setEditDarts(count)}
                >
                  {count}本
                </button>
              ))}
            </div>
          ) : (
            <p className="pent-edit-note">
              {isEditFinish
                ? `残り${edit.remainingBefore}は上がれない数字のため、この得点では確定できません。バストだった投球は0を入力してください。`
                : `残り${edit.remainingBefore}に対する得点として再計算します（上がり以外は3ダーツ）。`}
            </p>
          )}
          {editError && (
            <p className="n01-notice warning" role="alert">
              {editError}
            </p>
          )}
          <button
            type="button"
            className="n01-modal-primary"
            onClick={() => commitEdit(editEffectiveDarts)}
          >
            修正して再計算
          </button>
          <button type="button" className="n01-modal-cancel" onClick={closeEditor}>
            キャンセル
          </button>
        </PentathlonModal>
      )}

      {modal === 'stats' && (
        <PentathlonModal
          label="この種目の成績"
          returnFocusTo={scrollRef}
          onClose={() => setModal('none')}
          onKeyDown={(event) => {
            if (event.key === 'Backspace') {
              event.preventDefault();
              setModal('none');
            }
          }}
        >
          <h2>{engine.meta.name} 成績</h2>
          <div className={`n01-stats-table ${solo ? 'solo' : ''}`}>
            <div className="n01-stats-head">
              <strong>{session.names[0]}</strong>
              <span>STATS</span>
              {!solo && <strong>{session.names[1]}</strong>}
            </div>
            <StatsRow
              label="残り"
              solo={solo}
              values={players.map((i) => String((current.progress[i].state as X01SoloState).remaining))}
            />
            <StatsRow
              label="DARTS"
              solo={solo}
              values={players.map((i) => String((current.progress[i].state as X01SoloState).darts))}
            />
            <StatsRow
              label="3DA"
              solo={solo}
              values={players.map((i) =>
                threeDartAverage(current.progress[i].state as X01SoloState).toFixed(2),
              )}
            />
            <StatsRow
              label="100+"
              solo={solo}
              values={players.map((i) =>
                String(countTons(current.progress[i].state as X01SoloState, 100, 140)),
              )}
            />
            <StatsRow
              label="140+"
              solo={solo}
              values={players.map((i) =>
                String(countTons(current.progress[i].state as X01SoloState, 140, 180)),
              )}
            />
            <StatsRow
              label="180"
              solo={solo}
              values={players.map((i) =>
                String(countTons(current.progress[i].state as X01SoloState, 180, Infinity)),
              )}
            />
          </div>
          <button type="button" className="n01-modal-primary" onClick={() => setModal('none')}>
            閉じる
          </button>
        </PentathlonModal>
      )}
    </section>
  );
}

function StatsRow({ label, values, solo }: { label: string; values: string[]; solo: boolean }) {
  return (
    <div className="n01-stats-row">
      <strong>{values[0]}</strong>
      <span>{label}</span>
      {!solo && <strong>{values[1]}</strong>}
    </div>
  );
}

function threeDartAverage(state: X01SoloState): number {
  return state.darts > 0 ? ((state.startScore - state.remaining) / state.darts) * 3 : 0;
}

/** Visits scoring at least `min` but under `max` - the 100+ / 140+ / 180 breakdown 通常01 shows. */
function countTons(state: X01SoloState, min: number, max: number): number {
  return state.visits.filter((visit) => !visit.bust && visit.score >= min && visit.score < max).length;
}

interface RowCell {
  /** Index into that player's own visit list - what editVisit corrects. */
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

type Progress = NonNullable<PentathlonSession['current']>['progress'];

/**
 * A played row shows what the visit left; the active player's upcoming row shows their live
 * remaining, so the number they are throwing at is always on screen.
 */
function toGo(row: Row, player: PlayerIndex, active: PlayerIndex, progress: Progress): string {
  const cell = row.cells[player];
  if (cell) return String(cell.after);
  if (row.isCurrentRow && active === player) {
    return String((progress[player].state as X01SoloState).remaining);
  }
  return '—';
}

/**
 * One row per round, with each player's visit either side. Remaining is replayed from the stored
 * visits rather than stored per visit - a bust records a score of 0, so subtracting the recorded
 * score reproduces the engine's own `after` for every visit, bust included.
 */
function buildRows(progress: Progress, active: PlayerIndex, solo: boolean): Row[] {
  const perPlayer: [RowCell[], RowCell[]] = [[], []];
  for (const index of [0, 1] as const) {
    if (solo && index === 1) break;
    const state = progress[index].state as X01SoloState;
    let remaining = state.startScore;
    state.visits.forEach((visit, visitIndex) => {
      remaining -= visit.score;
      perPlayer[index].push({ visitIndex, score: visit.score, after: remaining, bust: visit.bust });
    });
  }

  const rowCount = Math.max(perPlayer[0].length, perPlayer[1].length) + 1;
  const rows: Row[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({
      round: i + 1,
      cells: [perPlayer[0][i] ?? null, perPlayer[1][i] ?? null],
      darts: (i + 1) * 3,
      isCurrentRow: i === perPlayer[active].length,
    });
  }
  return rows;
}

function ScoreCell({
  cell,
  isCurrent,
  entry,
  selected,
  onSelect,
}: {
  cell: RowCell | null;
  isCurrent: boolean;
  entry: string;
  /** The visit index this player's arrow-key selection is parked on, if any. */
  selected: number | null;
  onSelect: (visitIndex: number) => void;
}) {
  if (cell) {
    const display = cell.bust ? 'BUST' : String(cell.score);
    return (
      <td className="scored">
        <button
          type="button"
          className={selected === cell.visitIndex ? 'selected' : ''}
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
  return (
    <td className="scored">
      <span>—</span>
    </td>
  );
}
