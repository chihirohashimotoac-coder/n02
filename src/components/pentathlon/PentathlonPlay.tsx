import DartHitPad from './DartHitPad';
import PentathlonProgress from './PentathlonProgress';
import { getEngine } from '../../domain/pentathlon/presets';
import { currentDisciplineId } from '../../domain/pentathlon/session';
import type { DartHit } from '../../domain/darts';
import type { PentathlonSession, PlayerIndex } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onTurn: (input: unknown) => void;
  onStageHit: (hit: DartHit) => void;
  onUndo: () => void;
  canUndo: boolean;
  onExit: () => void;
}

/** Dart-hit disciplines only (Cork / Baseball / Half-It / Golf / RTC-Doubles / Cricket). 301/501 use
 *  PentathlonX01Play instead, which mirrors 通常01・チェックアウト練習's own fullscreen UI. */
export default function PentathlonPlay({
  session,
  onTurn,
  onStageHit,
  onUndo,
  canUndo,
  onExit,
}: Props) {
  const current = session.current!;
  const engine = getEngine(currentDisciplineId(session));
  const active = current.active;
  const activeProgress = current.progress[active];
  const activeState = activeProgress.state;

  const players: PlayerIndex[] = session.playerCount === 1 ? [0] : [0, 1];

  return (
    <div className="pent-game-shell">
    <div className="pent-play">
      <PentathlonProgress session={session} />

      <div className="section-heading compact">
        <div>
          <p className="eyebrow">{engine.meta.name}</p>
          <h2>{engine.meta.description}</h2>
        </div>
      </div>

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

      <DartHitPad
        pendingHits={current.pendingHits}
        maxDarts={engine.dartsRemainingThisTurn?.(activeState as never) ?? 3}
        disabled={activeProgress.finished}
        onStage={onStageHit}
        onUndoHit={onUndo}
        onCommit={() => onTurn(current.pendingHits)}
        allowEarlyCommit={engine.meta.allowEarlyCommit}
      />

      <div className="pent-actions">
        <button type="button" className="secondary-button" disabled={!canUndo} onClick={onUndo}>
          1つ戻す
        </button>
        <button type="button" className="secondary-button" onClick={onExit}>
          中断してメニューへ
        </button>
      </div>
    </div>
    </div>
  );
}

/** The headline number shown on each player card, in that discipline's own units. */
function primaryValue(id: string, state: unknown): string {
  const anyState = state as Record<string, number> & { self?: { points: number } };
  switch (id) {
    case 'cricket':
      // Cricket's state is a shared self/opponent view (head-to-head territory denial).
      return String(anyState.self?.points ?? 0);
    case 'half-it':
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
