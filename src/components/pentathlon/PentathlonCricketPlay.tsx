import DartHitPad from './DartHitPad';
import PentathlonProgress from './PentathlonProgress';
import { getEngine } from '../../domain/pentathlon/presets';
import { currentDisciplineId } from '../../domain/pentathlon/session';
import { CRICKET_NUMBERS, CRICKET_TARGETS, isCricketClosed, type CricketState } from '../../domain/pentathlon/engines/cricket';
import { DISCIPLINE_RULE_TEXT } from '../../domain/pentathlon/ruleText';
import PentathlonRulesButton from './PentathlonRulesButton';
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

const CRICKET_INPUT_NUMBERS: number[] = [...CRICKET_NUMBERS];

/**
 * Cricket only: a standard head-to-head cricket scoreboard (numbers down the middle, each player's
 * marks either side, classic /, X, circled-X notation) instead of the generic two-card summary the
 * other dart-hit disciplines use - this is the conventional layout every cricket scoring app/board
 * uses (not anything copied from n01's own assets/CSS/JS), just built with n02's own theme.
 */
export default function PentathlonCricketPlay({
  session,
  onTurn,
  onStageHit,
  onUndoStagedHit,
  onUndoRound,
  canUndo,
  canUndoRound,
  onExit,
}: Props) {
  const current = session.current!;
  const disciplineId = currentDisciplineId(session);
  const engine = getEngine(disciplineId);
  const active = current.active;
  const activeProgress = current.progress[active];
  const activeState = activeProgress.state as CricketState;
  const solo = session.playerCount === 1;
  const players: PlayerIndex[] = solo ? [0] : [0, 1];
  const views = players.map((index) => (current.progress[index].state as CricketState).self);

  return (
    <div className="pent-game-shell pent-cricket-shell">
      <div className="pent-play">
        <PentathlonProgress session={session} collapsible />

        <div className={`pent-cricket-board ${solo ? 'solo' : ''}`}>
          <div className="pent-cricket-row head">
            <span className={`pent-cricket-name ${active === 0 ? 'active' : ''}`}>{session.names[0]}</span>
            <span className="pent-cricket-num">NUMBER</span>
            {!solo && (
              <span className={`pent-cricket-name ${active === 1 ? 'active' : ''}`}>{session.names[1]}</span>
            )}
          </div>
          {CRICKET_TARGETS.map((target) => {
            const key = String(target);
            const p0Marks = views[0].marks[key] ?? 0;
            const p1Marks = !solo ? (views[1]?.marks[key] ?? 0) : 0;
            const dead = !solo && p0Marks >= 3 && p1Marks >= 3;
            return (
              <div className={`pent-cricket-row ${dead ? 'dead' : ''}`} key={key}>
                <CricketMark count={p0Marks} />
                <span className="pent-cricket-num">{target}</span>
                {!solo && <CricketMark count={p1Marks} />}
              </div>
            );
          })}
          <div className="pent-cricket-row total">
            <strong>{views[0].points}</strong>
            <span className="pent-cricket-num">POINTS</span>
            {!solo && <strong>{views[1]?.points ?? 0}</strong>}
          </div>
        </div>

        <div className="pent-sticky-pad">
          {!activeProgress.finished && (
            <div className="pent-target compact">
              <span>NOW THROWING・{engine.meta.name}</span>
              <strong>
                {session.names[active]}・残り {openTargets(activeState)}
              </strong>
            </div>
          )}

          <DartHitPad
            pendingHits={current.pendingHits}
            maxDarts={engine.dartsRemainingThisTurn?.(activeState as never) ?? 3}
            disabled={activeProgress.finished}
            onStage={onStageHit}
            onUndoHit={onUndoStagedHit}
            onCommit={() => onTurn(current.pendingHits)}
            numbers={CRICKET_INPUT_NUMBERS}
          />

          <div className="pent-actions pent-actions-3">
            <button
              type="button"
              className="secondary-button"
              disabled={!canUndoRound}
              onClick={onUndoRound}
              title={canUndo && !canUndoRound ? '先に「1投戻す」で入力中の投球を取り消してください' : undefined}
            >
              前の確定ラウンドに戻す
            </button>
            <PentathlonRulesButton className="secondary-button" label="ルール説明" {...DISCIPLINE_RULE_TEXT[disciplineId]} />
            <button type="button" className="secondary-button" onClick={onExit}>
              中断してメニューへ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function openTargets(state: CricketState): string {
  const open = CRICKET_TARGETS.filter((t) => !isCricketClosed(state.self, t));
  return open.length ? open.map(String).join(' ') : '完了';
}

/** Standard cricket mark notation: 0 = blank, 1 = /, 2 = X, 3+ (closed) = circled X. */
function CricketMark({ count }: { count: number }) {
  if (count <= 0) return <span className="pent-cricket-mark" aria-label="未オープン" />;
  if (count === 1) {
    return (
      <span className="pent-cricket-mark m1" aria-label="1マーク">
        ╱
      </span>
    );
  }
  if (count === 2) {
    return (
      <span className="pent-cricket-mark m2" aria-label="2マーク">
        ✕
      </span>
    );
  }
  return (
    <span className="pent-cricket-mark m3" aria-label="クローズ（3マーク以上）">
      ✕
    </span>
  );
}
