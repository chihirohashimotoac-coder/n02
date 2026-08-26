import { useMemo, useState } from 'react';
import DartHitPad from './DartHitPad';
import PentathlonProgress from './PentathlonProgress';
import { getEngine } from '../../domain/pentathlon/presets';
import { currentDisciplineId } from '../../domain/pentathlon/session';
import { InvalidVisitError } from '../../domain/x01Core';
import { validFinishDartCounts } from '../../domain/darts';
import type { DartHit } from '../../domain/darts';
import type { PentathlonSession, PlayerIndex } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onTurn: (input: unknown) => void;
  onStageHit: (hit: DartHit) => void;
  onUndo: () => void;
  canUndo: boolean;
  onExit: () => void;
  error: string | null;
  onError: (message: string | null) => void;
}

export default function PentathlonPlay({
  session,
  onTurn,
  onStageHit,
  onUndo,
  canUndo,
  onExit,
  error,
  onError,
}: Props) {
  const [entry, setEntry] = useState('');
  const [pendingFinish, setPendingFinish] = useState<number | null>(null);
  const [openedWithDoubleAnswer, setOpenedWithDoubleAnswer] = useState(false);

  const current = session.current!;
  const engine = getEngine(currentDisciplineId(session));
  const active = current.active;
  const activeProgress = current.progress[active];
  const activeState = activeProgress.state;

  const players: PlayerIndex[] = session.playerCount === 1 ? [0] : [0, 1];

  const remaining = useMemo(() => {
    if (engine.meta.inputMode !== 'visit-score') return 0;
    return (activeState as { remaining: number }).remaining;
  }, [activeState, engine.meta.inputMode]);

  const submitVisit = (rawValue: string, finishDarts?: number) => {
    const score = Number(rawValue);
    if (rawValue === '' || Number.isNaN(score)) return;

    const state = activeState as { remaining: number; opened: boolean };
    // Double-in games need to know whether this visit's opening dart was a double.
    const needsOpening = !state.opened;

    if (score === state.remaining && score > 0 && finishDarts === undefined) {
      const counts = validFinishDartCounts(state.remaining);
      if (counts.length === 0) {
        onError(`残り${state.remaining}は上がれない数字のため、上がり申告できません。`);
        return;
      }
      setPendingFinish(score);
      return;
    }

    try {
      onTurn({ score, finishDarts, openedWithDouble: needsOpening ? openedWithDoubleAnswer : undefined });
      setEntry('');
      setPendingFinish(null);
      setOpenedWithDoubleAnswer(false);
      onError(null);
    } catch (caught) {
      if (caught instanceof InvalidVisitError) onError(caught.message);
      else throw caught;
    }
  };

  const finishCounts = pendingFinish !== null ? validFinishDartCounts(remaining) : [];

  return (
    <div className="pent-play">
      <PentathlonProgress session={session} />

      <div className="section-heading compact">
        <div>
          <p className="eyebrow">{engine.meta.name}</p>
          <h2>{engine.meta.description}</h2>
        </div>
      </div>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <div className={`pent-players ${session.playerCount === 1 ? 'solo' : ''}`}>
        {players.map((index) => {
          const progress = current.progress[index];
          const isActive = index === active && !progress.finished;
          const state = progress.state;
          return (
            <div
              key={index}
              className={`pent-player ${isActive ? 'active' : ''} ${progress.finished ? 'finished' : ''}`}
            >
              <div className="pent-player-head">
                <h3>{session.names[index]}</h3>
                {progress.finished ? (
                  <span className="pent-badge finished">FINISHED</span>
                ) : isActive ? (
                  <span className="pent-badge throw">THROW</span>
                ) : (
                  <span className="pent-badge">
                    {session.currentStarter === index ? '先攻' : '後攻'}
                  </span>
                )}
              </div>
              <div className="pent-player-value">{primaryValue(engine.meta.id, state)}</div>
              <div className="pent-player-note">
                {progress.finished
                  ? (progress.result?.label ?? '完了')
                  : engine.describeTarget(state as never)}
              </div>
            </div>
          );
        })}
      </div>

      {!activeProgress.finished && (
        <div className="pent-target">
          <span>NOW THROWING</span>
          <strong>
            {session.names[active]}・{engine.describeTarget(activeState as never)}
          </strong>
        </div>
      )}

      {engine.meta.inputMode === 'dart-hits' ? (
        <DartHitPad
          pendingHits={current.pendingHits}
          maxDarts={engine.dartsRemainingThisTurn?.(activeState as never) ?? 3}
          disabled={activeProgress.finished}
          onStage={onStageHit}
          onUndoHit={onUndo}
          onCommit={() => onTurn(current.pendingHits)}
          allowEarlyCommit={engine.meta.allowEarlyCommit}
        />
      ) : (
        <div className="pent-keypad">
          <div className="pent-pending">
            <span className="pent-pending-chip">{entry === '' ? '0' : entry}</span>
            {(activeState as { opened: boolean }).opened ? (
              <span className="pent-player-note">この投球の得点を入力</span>
            ) : (
              <label className="toggle-field compact-toggle">
                <span>
                  <strong>ダブルインで開始</strong>
                  <small>最初の1投がダブルに入るまで加点されません</small>
                </span>
                <input
                  type="checkbox"
                  checked={openedWithDoubleAnswer}
                  onChange={(event) => setOpenedWithDoubleAnswer(event.target.checked)}
                />
              </label>
            )}
          </div>
          <div className="pent-number-grid" role="group" aria-label="得点入力テンキー">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setEntry((value) => (value.length >= 3 ? value : value + key))}
              >
                {key}
              </button>
            ))}
            <button type="button" onClick={() => setEntry((value) => value + '0')}>
              0
            </button>
            <button type="button" aria-label="1文字削除" onClick={() => setEntry((value) => value.slice(0, -1))}>
              ⌫
            </button>
            <button type="button" className="wide" onClick={() => submitVisit(entry)}>
              確定
            </button>
          </div>
          <div className="pent-actions">
            <button type="button" className="secondary-button" disabled={!canUndo} onClick={onUndo}>
              1つ戻す
            </button>
            <button type="button" className="secondary-button" onClick={() => setEntry('')}>
              クリア
            </button>
          </div>
        </div>
      )}

      {engine.meta.inputMode === 'dart-hits' && (
        <div className="pent-actions">
          <button type="button" className="secondary-button" disabled={!canUndo} onClick={onUndo}>
            1つ戻す
          </button>
          <button type="button" className="secondary-button" onClick={onExit}>
            中断してメニューへ
          </button>
        </div>
      )}

      {engine.meta.inputMode === 'visit-score' && (
        <button type="button" className="text-button" onClick={onExit}>
          中断してメニューへ（進行は保存されます）
        </button>
      )}

      {pendingFinish !== null && (
        <div className="n01-modal-backdrop" role="dialog" aria-modal="true" aria-label="上がり本数を選択">
          <div className="n01-modal-card menu-list">
            <h2>上がり本数</h2>
            {finishCounts.map((count) => (
              <button key={count} type="button" onClick={() => submitVisit(String(pendingFinish), count)}>
                <kbd>{count}</kbd>{'\u3000'}{count}本目で終了
              </button>
            ))}
            <p>残り{remaining}は最短{finishCounts[0]}本で上がれます。</p>
            <button type="button" onClick={() => setPendingFinish(null)}>
              戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The headline number shown on each player card, in that discipline's own units. */
function primaryValue(id: string, state: unknown): string {
  const anyState = state as Record<string, number>;
  switch (id) {
    case 'x01-501':
    case 'x01-301':
      return String(anyState.remaining);
    case 'half-it':
    case 'cricket':
      return String(anyState.points ?? anyState.score);
    case 'golf':
      return String(anyState.strokes);
    case 'baseball':
      return String(anyState.runs);
    case 'rtc-doubles':
      return `${anyState.targetIndex}/21`;
    case 'cork':
      return String(anyState.darts > 0 ? anyState.best : '—');
    default:
      return '—';
  }
}
