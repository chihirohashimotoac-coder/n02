import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PentathlonModal from './PentathlonModal';
import { getEngine } from '../../domain/pentathlon/presets';
import {
  currentDisciplineId,
  disciplineCount,
  isSingleGameSession,
} from '../../domain/pentathlon/session';
import { InvalidVisitError } from '../../domain/x01Core';
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

      try {
        onTurn({ score, finishDarts });
        setEntry('');
        setPendingFinish(null);
        setModal('none');
        onError(null);
      } catch (caught) {
        if (caught instanceof InvalidVisitError) onError(caught.message);
        else throw caught;
      }
    },
    [activeState.remaining, onError, onTurn],
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

  // Only ever the gameplay screen's own shortcuts: any open PentathlonModal swallows keystrokes
  // before they reach this listener, and drives its own buttons natively (Enter/Space on the
  // focused control), so there is no dialog-specific branch here to fall out of sync.
  useEffect(() => {
    if (modal !== 'none') return;
    const handler = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        pressKey(event.key);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        pressKey('enter');
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (entry.length > 0) pressKey('delete');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setEntry('');
      } else if (event.key.toLowerCase() === 'u') {
        event.preventDefault();
        onUndoRound();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry, modal, onUndoRound, pressKey]);

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

  const openFinishModal = () => {
    const counts = validFinishDartCounts(activeState.remaining);
    if (counts.length === 0) {
      onError(`残り${activeState.remaining}は上がれない数字のため、上がり申告できません。`);
      return;
    }
    setPendingFinish(activeState.remaining);
    setModal('finish-darts');
  };

  const openEditor = (player: PlayerIndex, visitIndex: number) => {
    const state = current.progress[player].state as X01SoloState;
    const visit = state.visits[visitIndex];
    if (!visit) return;
    // Everything before the edited visit is untouched, so the score it was thrown at is exact.
    const remainingBefore = state.visits
      .slice(0, visitIndex)
      .reduce((left, earlier) => left - earlier.score, state.startScore);
    setEdit({ player, visitIndex, remainingBefore });
    setEditScore(String(visit.entered ?? visit.score));
    setEditDarts(visit.darts);
    setEditError(null);
    setModal('edit');
  };

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
                    onSelect={(visitIndex) => openEditor(0, visitIndex)}
                  />
                  <td className="to-go">{toGo(row, 0, active, current.progress)}</td>
                  <td className="darts">{row.darts}</td>
                  {!solo && (
                    <ScoreCell
                      cell={row.cells[1]}
                      isCurrent={active === 1 && row.isCurrentRow}
                      entry={entry}
                      onSelect={(visitIndex) => openEditor(1, visitIndex)}
                    />
                  )}
                  {!solo && <td className="to-go">{toGo(row, 1, active, current.progress)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="n01-table-hint">
          得点表をスクロールすると1ラウンド目から確認できます。得点セルを選択すると過去ラウンドを修正できます。
        </p>
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
          onClose={() => {
            setModal('none');
            setPendingFinish(null);
          }}
          onKeyDown={(event) => {
            const digit = Number(event.key);
            if (finishCounts.includes(digit)) {
              event.preventDefault();
              submitVisit(String(pendingFinish), digit);
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
          <button
            type="button"
            onClick={() => {
              setModal('none');
              setPendingFinish(null);
            }}
          >
            戻る
          </button>
        </PentathlonModal>
      )}

      {modal === 'menu' && (
        <PentathlonModal label="ゲームメニュー" variant="menu-list" onClose={() => setModal('none')}>
          <h2>メニュー</h2>
          <button
            type="button"
            disabled={!canUndoRound}
            onClick={() => {
              onUndoRound();
              setModal('none');
            }}
          >
            前の確定ラウンドに戻す
          </button>
          <button type="button" onClick={() => setModal('rules')}>
            ルール説明
          </button>
          <button
            type="button"
            onClick={() => {
              setModal('none');
              onExit();
            }}
          >
            中断してメニューへ
          </button>
          <p>
            キーボード：<kbd>0</kbd>–<kbd>9</kbd> 得点入力・<kbd>Enter</kbd> 確定・
            <kbd>Backspace</kbd> 1文字削除・<kbd>U</kbd> 前の確定ラウンドに戻す
          </p>
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
        <PentathlonModal
          label="過去得点の修正"
          onClose={() => {
            setModal('none');
            setEdit(null);
          }}
        >
          <h2>過去得点を修正</h2>
          <p className="pent-edit-target">
            {session.names[edit.player]}・{edit.visitIndex + 1} ラウンド目
          </p>
          <label>
            <span>得点</span>
            <input
              type="number"
              inputMode="numeric"
              value={editScore}
              onChange={(event) => setEditScore(event.target.value)}
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
            onClick={() => {
              try {
                onEditVisit(edit.player, edit.visitIndex, Number(editScore), editEffectiveDarts);
                setModal('none');
                setEdit(null);
                setEditError(null);
                onError(null);
              } catch (caught) {
                if (caught instanceof InvalidVisitError) setEditError(caught.message);
                else throw caught;
              }
            }}
          >
            修正して再計算
          </button>
          <button
            type="button"
            className="n01-modal-cancel"
            onClick={() => {
              setModal('none');
              setEdit(null);
            }}
          >
            キャンセル
          </button>
        </PentathlonModal>
      )}

      {modal === 'stats' && (
        <PentathlonModal label="この種目の成績" onClose={() => setModal('none')}>
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
  onSelect,
}: {
  cell: RowCell | null;
  isCurrent: boolean;
  entry: string;
  onSelect: (visitIndex: number) => void;
}) {
  if (cell) {
    const display = cell.bust ? 'BUST' : String(cell.score);
    return (
      <td className="scored">
        <button type="button" onClick={() => onSelect(cell.visitIndex)} aria-label={`${display} を修正`}>
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
