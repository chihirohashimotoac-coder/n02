import { useState } from 'react';
import {
  MAX_ROUND_SCORE,
  MIN_ROUND_SCORE,
  ROUND_SCORE_MESSAGE,
  parseRoundScore,
  type PlayerIndex,
} from '../../domain/practice/countUp';

export interface EditTarget {
  player: PlayerIndex;
  roundIndex: number;
  playerName: string;
  currentScore: number;
}

interface Props {
  target: EditTarget;
  onCommit: (score: number) => void;
  onCancel: () => void;
}

/**
 * Corrects one already-entered round. The COUNT-UP aggregates (TOTAL / PPR / award counts / winner)
 * are all derived from the round history, so committing here is enough - and a correction never
 * replays the award presentation.
 */
export default function CountUpEditDialog({ target, onCommit, onCancel }: Props) {
  const [value, setValue] = useState(String(target.currentScore));
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const score = parseRoundScore(value);
    if (score === null) {
      setError(ROUND_SCORE_MESSAGE);
      return;
    }
    onCommit(score);
  };

  return (
    <div className="countup-modal-backdrop" role="dialog" aria-modal="true" aria-label="ラウンド得点の修正">
      <div className="countup-modal-card">
        <h2>ラウンド得点を修正</h2>
        <p className="countup-edit-target">
          {target.playerName}・ROUND {target.roundIndex + 1}
        </p>
        <label>
          <span>得点</span>
          <input
            type="number"
            inputMode="numeric"
            min={MIN_ROUND_SCORE}
            max={MAX_ROUND_SCORE}
            autoFocus
            value={value}
            aria-label="修正後のラウンド得点"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              // Never act on the Enter that only commits an IME conversion.
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                commit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        {error && (
          <p className="countup-modal-error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="countup-modal-primary" onClick={commit}>
          修正して再計算
        </button>
        <button type="button" className="countup-modal-cancel" onClick={onCancel}>
          キャンセル
        </button>
      </div>
    </div>
  );
}
