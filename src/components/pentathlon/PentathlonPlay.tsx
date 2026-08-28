import { useState } from 'react';
import DartHitPad from './DartHitPad';
import PentathlonProgress from './PentathlonProgress';
import PentathlonPlayMenu from './PentathlonPlayMenu';
import { deriveQuickTarget, describeAim } from './quickTarget';
import { getEngine } from '../../domain/pentathlon/presets';
import { currentDisciplineId } from '../../domain/pentathlon/session';
import type { DartHit } from '../../domain/darts';
import type { PentathlonSession, PlayerIndex } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onTurn: (input: unknown) => void;
  onStageHit: (hit: DartHit) => void;
  /** Takes back only the last dart staged in the current, uncommitted turn. */
  onUndoStagedHit: () => void;
  /** Takes back the previous already-committed round. */
  onUndoRound: () => void;
  canUndo: boolean;
  canUndoRound: boolean;
  onExit: () => void;
}

/** Dart-hit disciplines except Cricket (Cork / Baseball / Half-It / Golf / RTC-Doubles) - Cricket has
 *  its own dedicated scoreboard screen (PentathlonCricketPlay). 301/501 use PentathlonX01Play
 *  instead, which mirrors 通常01・チェックアウト練習's own fullscreen UI.
 *
 *  The screen is a fixed-height column: heading and input pad are pinned, and only the middle band
 *  can ever scroll, so everything needed to play a turn is on screen without scrolling. Anything not
 *  needed to throw (undo a committed round, rules, quit) lives in the ☰ menu.
 */
export default function PentathlonPlay({
  session,
  onTurn,
  onStageHit,
  onUndoStagedHit,
  onUndoRound,
  canUndo,
  canUndoRound,
  onExit,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = session.current!;
  const disciplineId = currentDisciplineId(session);
  const engine = getEngine(disciplineId);
  const active = current.active;
  const activeProgress = current.progress[active];
  const activeState = activeProgress.state;
  const quickTarget = deriveQuickTarget(disciplineId, activeState, current.pendingHits);
  const aim = activeProgress.finished ? null : describeAim(disciplineId, activeState, quickTarget);

  const players: PlayerIndex[] = session.playerCount === 1 ? [0] : [0, 1];

  return (
    <div className="pent-game-shell pent-play-shell">
      <div className="pent-play">
        <div className="pent-play-head">
          <div className="pent-play-title">
            <p className="eyebrow">{engine.meta.name}</p>
            <h2>{engine.meta.description}</h2>
          </div>
          <button
            type="button"
            className="pent-menu-button"
            aria-label="メニュー"
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
        </div>

        <div className="pent-play-main">
          <PentathlonProgress session={session} collapsible />

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

          {!activeProgress.finished &&
            (aim ? (
              <div className="pent-aim">
                <span className="pent-aim-phase">
                  {session.names[active]}
                  {aim.phase ? `・${aim.phase}` : ''}
                </span>
                <strong className="pent-aim-target">
                  <em>TARGET</em>
                  {aim.target}
                </strong>
                <span className="pent-aim-hint">{aim.hint}</span>
              </div>
            ) : (
              <div className="pent-target">
                <span>NOW THROWING</span>
                <strong>
                  {session.names[active]}・{engine.describeTarget(activeState as never)}
                </strong>
              </div>
            ))}
        </div>

        <div className="pent-play-pad">
          <DartHitPad
            pendingHits={current.pendingHits}
            maxDarts={engine.dartsRemainingThisTurn?.(activeState as never) ?? 3}
            disabled={activeProgress.finished}
            onStage={onStageHit}
            onUndoHit={onUndoStagedHit}
            onCommit={() => onTurn(current.pendingHits)}
            allowEarlyCommit={engine.meta.allowEarlyCommit}
            target={quickTarget}
          />
        </div>
      </div>

      {menuOpen && (
        <PentathlonPlayMenu
          disciplineId={disciplineId}
          canUndo={canUndo}
          canUndoRound={canUndoRound}
          onUndoRound={onUndoRound}
          onExit={onExit}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

/** The headline number shown on each player card, in that discipline's own units. */
function primaryValue(id: string, state: unknown): string {
  const anyState = state as Record<string, number>;
  switch (id) {
    case 'half-it':
      return String(anyState.points ?? anyState.score);
    case 'golf':
      return String(anyState.strokes);
    case 'baseball':
      return String(anyState.runs);
    case 'rtc-doubles':
      return `${anyState.targetIndex}/21`;
    case 'cork':
      return String(anyState.score);
    default:
      return '—';
  }
}
