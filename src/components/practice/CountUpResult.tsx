import { useState } from 'react';
import CountUpEditDialog, { type EditTarget } from './CountUpEditDialog';
import {
  AWARD_KINDS,
  AWARD_LABELS,
  COUNT_UP_ROUNDS,
  awardCounts,
  editRoundScore,
  formatPpr,
  outcome,
  playerIndexes,
  pointsPerRound,
  totalScore,
  type CountUpState,
  type PlayerIndex,
} from '../../domain/practice/countUp';

interface Props {
  state: CountUpState;
  onChange: (state: CountUpState) => void;
  onPlayAgain: () => void;
  /** Back to the COUNT-UP setup, where the settings and RECENT RESULTS are. */
  onBackToSetup: () => void;
  onBackToPractice: () => void;
}

/**
 * The finished-game screen. Scores stay editable here on purpose: a mis-key noticed only after
 * ROUND 8 is corrected in place and every figure on this screen - TOTAL, PPR, award counts and the
 * winner - is recomputed from the round history, with no award presentation replayed.
 */
export default function CountUpResult({
  state,
  onChange,
  onPlayAgain,
  onBackToSetup,
  onBackToPractice,
}: Props) {
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const indexes = playerIndexes(state);
  const result = outcome(state);

  const commitEdit = (score: number) => {
    if (!editTarget) return;
    try {
      onChange(editRoundScore(state, editTarget.player, editTarget.roundIndex, score));
    } finally {
      // The dialog validates 0...180 itself; closing regardless keeps a rejected edit from
      // trapping the player on this screen.
      setEditTarget(null);
    }
  };

  const openEditor = (player: PlayerIndex, roundIndex: number) => {
    const score = state.players[player].scores[roundIndex];
    if (score === undefined) return;
    setEditTarget({ player, roundIndex, playerName: state.players[player].name, currentScore: score });
  };

  return (
    <section className="countup-shell countup-result-shell">
      <div className="countup-result-scroll">
        <header className="countup-result-head">
          <p className="countup-result-eyebrow">PRACTICE / COUNT-UP</p>
          <h1>GAME RESULT</h1>
          <p className="countup-result-sub">
            {COUNT_UP_ROUNDS} ROUNDS ／ {state.settings.bullMode === 'fat' ? 'FAT BULL' : 'SEPARATE BULL'}
          </p>
        </header>

        {result?.kind === 'winner' && (
          <p className="countup-verdict" role="status">
            <span>WINNER</span>
            <strong>{state.players[result.player].name}</strong>
          </p>
        )}
        {result?.kind === 'draw' && (
          <p className="countup-verdict draw" role="status">
            <span>RESULT</span>
            <strong>DRAW</strong>
          </p>
        )}

        <div className={`countup-result-cards ${indexes.length === 1 ? 'solo' : ''}`}>
          {indexes.map((player) => {
            const counts = awardCounts(state, player);
            const earned = AWARD_KINDS.filter((kind) => counts[kind] > 0);
            const isWinner = result?.kind === 'winner' && result.player === player;
            return (
              <article key={player} className={`countup-result-card ${isWinner ? 'winner' : ''}`}>
                <h2>{state.players[player].name}</h2>
                <strong className="countup-result-total">{totalScore(state, player)}</strong>
                <span className="countup-result-total-label">TOTAL</span>
                <p className="countup-result-ppr">
                  PPR <b>{formatPpr(pointsPerRound(state, player))}</b>
                </p>
                <ul className="countup-award-list">
                  {earned.length === 0 ? (
                    <li className="none">AWARD なし</li>
                  ) : (
                    earned.map((kind) => (
                      <li key={kind}>
                        <span>{AWARD_LABELS[kind]}</span>
                        <b>×{counts[kind]}</b>
                      </li>
                    ))
                  )}
                </ul>
                <ol className="countup-round-list" aria-label={`${state.players[player].name} のラウンド得点`}>
                  {state.players[player].scores.map((score, roundIndex) => (
                    <li key={roundIndex}>
                      <button
                        type="button"
                        onClick={() => openEditor(player, roundIndex)}
                        aria-label={`${state.players[player].name} ROUND ${roundIndex + 1} の ${score} を修正`}
                      >
                        <small>R{roundIndex + 1}</small>
                        <span>{score}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </article>
            );
          })}
        </div>

        <p className="countup-result-hint">ラウンド得点をタップすると修正でき、TOTAL・PPR・アワードを再集計します。</p>

        <div className="countup-result-actions">
          <button type="button" className="primary-button" onClick={onPlayAgain}>
            ➤ SAME SETTINGS でもう一度
          </button>
          <button type="button" className="secondary-button" onClick={onBackToSetup}>
            COUNT-UP 設定へ
          </button>
          <button type="button" className="text-button" onClick={onBackToPractice}>
            PRACTICE へ戻る
          </button>
        </div>
      </div>

      {editTarget && (
        <CountUpEditDialog target={editTarget} onCommit={commitEdit} onCancel={() => setEditTarget(null)} />
      )}
    </section>
  );
}
