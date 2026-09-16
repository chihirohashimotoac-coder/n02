import TowerBoard from './TowerBoard';
import {
  canUndoThrow,
  floorRegions,
  floorTargetText,
  playerResults,
  totalThrows,
  undoTargetThrow,
  type TowerPlayerResult,
  type TowerState,
} from '../../domain/practice/tower';

interface Props {
  state: TowerState;
  /** Takes the last dart back and returns to play - the 100F clear is undoable from here too. */
  onUndo: () => void;
  onPlayAgain: () => void;
  onBackToSetup: () => void;
  onBackToPractice: () => void;
}

function statusLabel(result: TowerPlayerResult): string {
  return result.status === 'cleared' ? 'GAME CLEAR' : 'GAME OVER';
}

/**
 * TOWER's RESULT.
 *
 * `CLEAR FLOOR` is the last floor actually beaten, which is not the floor the player was standing
 * on: failing on 4F is CLEAR FLOOR 3, failing on 6F is 5, and never beating 1F is 0. That
 * distinction is the whole point of the screen, so the floor being attempted is not shown here at
 * all - only what was cleared.
 *
 * The four counters below the fold (darts, hits, misses, CONTINUEs used) are n02's own additions,
 * labelled as such: the original's RESULT showed the configuration and the cleared floor, not
 * these.
 */
export default function TowerResult({
  state,
  onUndo,
  onPlayAgain,
  onBackToSetup,
  onBackToPractice,
}: Props) {
  const results = playerResults(state);
  const { rules } = state;
  const undoable = canUndoThrow(state);
  const lastThrow = undoTargetThrow(state);

  return (
    <div className="app-shell">
      <section className="setup-layout practice-layout">
        <div className="panel setup-panel tower-result">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PRACTICE / TOWER</p>
              <h1>GAME RESULT</h1>
            </div>
            <span className="status-chip">{totalThrows(state)} DARTS</span>
          </div>

          <p className="practice-note">
            CONFIGURATION：START FLOOR {rules.startFloor}／START LIFE {rules.startLife}／CONTINUE {rules.continues}／
            RECOVERY {rules.recovery ? 'ON' : 'OFF'}
          </p>

          <div className={`tower-result-grid ${results.length === 1 ? 'solo' : ''}`}>
            {results.map((result, index) => (
              <div className={`tower-result-card is-${result.status}`} key={index}>
                <span className="tower-result-name">{result.name}</span>
                <span className={`tower-result-status is-${result.status}`}>{statusLabel(result)}</span>

                <strong className="tower-result-floor">
                  {result.clearFloor}
                  <i>F</i>
                </strong>
                <span className="tower-result-floor-label">CLEAR FLOOR</span>

                <span className="tower-result-range">
                  START FLOOR {result.startFloor} → {result.clearFloor}F 突破
                  {/* Starting above 1F grants the floors below it, so "beat nothing" is the start
                      floor minus one, not zero. */}
                  {result.clearFloor < result.startFloor ? `（${result.startFloor}F 未突破）` : ''}
                </span>

                {/* n02's own counters - not part of what the original RESULT showed. */}
                <dl className="tower-result-stats">
                  <div>
                    <dt>総投数</dt>
                    <dd>{result.stats.throws}</dd>
                  </div>
                  <div>
                    <dt>成功</dt>
                    <dd>{result.stats.hits}</dd>
                  </div>
                  <div>
                    <dt>MISS</dt>
                    <dd>{result.stats.misses}</dd>
                  </div>
                  <div>
                    <dt>CONTINUE使用</dt>
                    <dd>{result.continuesUsed}</dd>
                  </div>
                </dl>
                <p className="tower-result-stats-note">総投数以下は n02 独自の集計です。</p>
              </div>
            ))}
          </div>

          <div className="tower-result-top">
            <TowerBoard
              regions={floorRegions(rules.finalFloor)}
              className="tower-board-mini"
              ariaLabel={`${rules.finalFloor}F のお題：${floorTargetText(rules.finalFloor)}`}
            />
            <p>
              {rules.finalFloor}F のお題は {floorTargetText(rules.finalFloor)}。到達ではなく、この1投の成功で GAME CLEAR です。
            </p>
          </div>

          {undoable && (
            <button type="button" className="secondary-button tower-result-undo" onClick={onUndo}>
              1投戻す
              {lastThrow
                ? `（${lastThrow.playerName} ${lastThrow.floor}F ${lastThrow.dartNumber}投目）`
                : ''}
            </button>
          )}

          <button type="button" className="primary-button countup-start" onClick={onPlayAgain}>
            ➤ 同じ設定でもう一度
          </button>
          <button type="button" className="text-button" onClick={onBackToSetup}>
            設定を変えて遊ぶ
          </button>
          <button type="button" className="text-button" onClick={onBackToPractice}>
            PRACTICE へ戻る
          </button>
        </div>
      </section>
    </div>
  );
}
