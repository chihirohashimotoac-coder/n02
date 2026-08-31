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
        const next = applyVisit(state, scored, finishDarts);
        onChange(next);
        setEntry('');
        setPendingFinish(null);
        setModal('none');
        const lastVisit = next.visits[next.visits.length - 1];
        if (lastVisit?.bust) showNotice('バスト：残り点数は変わりません。', 'warning');
        else setNotice(null);
      } catch (error) {
        if (error instanceof InvalidVisitError) showNotice(error.message, 'warning');
        else throw error;
      }
    },
    [activePlayer.remaining, onChange, remainingEntryMode, showNotice, state],
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

  // Keyboard support mirrors the on-screen keypad.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Never act on the Enter that merely commits an IME conversion.
      if (event.isComposing || event.keyCode === 229) return;

      // The leg-result dialog and the match-result card are driven by state.legResult/matchWinner,
      // not by `modal`, so they need their own branch here - without it the <kbd>Enter</kbd> badge on
      // 「次のLegへ」 promises a shortcut that no listener implements. Claim every key while one is up
      // so nothing queues into the keypad behind the dialog, and leave a focused button to the
      // browser's own Enter-activates-button handling so 「戻る」 cannot fire twice (or fire at all
      // when 「次のLegへ」 was meant).
      if ((state.legResult !== null || state.matchWinner !== null) && !awaitingRoundLimit) {
        const onButton = (event.target as HTMLElement | null)?.tagName === 'BUTTON';
        if (event.key === 'Enter' && !onButton) {
          event.preventDefault();
          if (state.matchWinner === null) onChange(advanceLeg(state));
          else onExit({ clearSave: true });
        }
        return;
      }

      if (effectiveModal === 'finish-darts') {
        const counts = pendingFinish !== null ? validFinishDartCounts(activePlayer.remaining) : [];
        const digit = Number(event.key);
        if (counts.includes(digit)) {
          event.preventDefault();
          submitScore(String(pendingFinish), digit);
        }
        if (event.key === 'Escape') {
          setModal('none');
          setPendingFinish(null);
        }
        return;
      }
      if (effectiveModal !== 'none') {
        if (event.key === 'Escape') setModal('none');
        return;
      }
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
        onChange(undoLastAction(state));
        showNotice('直前の入力を取り消しました。');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activePlayer.remaining,
    awaitingRoundLimit,
    effectiveModal,
    entry,
    onChange,
    onExit,
    pendingFinish,
    pressKey,
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
          <button
            type="button"
            onClick={() => {
              const counts = validFinishDartCounts(activePlayer.remaining);
              if (counts.length === 0) {
                showNotice(`残り${activePlayer.remaining}は上がれない数字のため、上がり申告できません。`, 'warning');
                return;
              }
              setPendingFinish(activePlayer.remaining);
              setModal('finish-darts');
            }}
          >
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
              {state.players[0].name} の勝ち
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(resolveRoundLimit(state, 'draw'));
                setModal('none');
              }}
            >
              {'\u3000'}引き分け
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(resolveRoundLimit(state, 1));
                setModal('none');
              }}
            >
              {state.players[1].name} の勝ち
            </button>
          </div>
        </div>
      )}

      {effectiveModal === 'menu' && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="ゲームメニュー">
          <div className="n01-modal-card menu-list">
            <h2>メニュー</h2>
            <button
              type="button"
              onClick={() => {
                setRemainingEntryMode((value) => !value);
                setModal('none');
              }}
            >
              {remainingEntryMode ? '得点入力に戻す' : '残り点数で入力'}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(swapCurrentLegScores(state));
                setModal('none');
                showNotice('このLegのプレイヤー別スコア履歴を入れ替えました。');
              }}
            >
              {'\u3000'}プレイヤーのスコアを入れ替え
            </button>
            <button
              type="button"
              disabled={state.undo.length === 0}
              onClick={() => {
                onChange(undoLastAction(state));
                setModal('none');
                showNotice('直前の入力を取り消しました。');
              }}
            >
              直前の入力を戻す
            </button>
            <button
              type="button"
              disabled={state.completed.length === 0}
              onClick={() => {
                // The rewound completion must also leave the 成績 history, and free its slot in
                // historyRecorded so the replayed leg is recorded again when it finishes.
                historyRecorded.current.delete(state.completed.length - 1);
                removeLatestHistory();
                onChange(resumePreviousLeg(state));
                setModal('none');
                showNotice('前のLegを勝利直前の状態で再開しました。以降の進行は破棄されます。');
              }}
            >
              前のLegをやり直す
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(declareDraw(state));
                setModal('none');
              }}
            >
              {'\u3000'}Legを終了・引き分け
            </button>
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
                value={editScore}
                onChange={(event) => setEditScore(event.target.value)}
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
              onClick={() => {
                try {
                  onChange(editVisit(state, editIndex, Number(editScore), editDarts));
                  setModal('none');
                  showNotice(`${editIndex + 1}件目の得点を修正し、以降の残り点数を再計算しました。`);
                } catch (error) {
                  if (error instanceof InvalidVisitError) showNotice(error.message, 'warning');
                  else throw error;
                }
              }}
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
            <button type="button" className="primary-button" onClick={() => onChange(advanceLeg(state))}>
              次のLegへ <kbd>Enter</kbd>
            </button>
            <button type="button" className="text-button" onClick={() => onChange(undoLastAction(state))}>
              戻る（本数を選び直す）
            </button>
          </div>
        </div>
      )}
    </section>
  );

  function openEditor(index: number) {
    setEditIndex(index);
    setEditScore(String(state.visits[index].score));
    setEditDarts(state.visits[index].darts);
    setModal('edit');
  }
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
}: {
  cell: RowCell | null;
  isCurrent: boolean;
  entry: string;
  onSelect: (visitIndex: number) => void;
  playerName: string;
  /** Set only on the opponent's empty 1st-round cell of an untouched leg; tapping it hands them the throw. */
  onPickStarter?: () => void;
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
