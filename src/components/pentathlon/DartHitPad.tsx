import { useState } from 'react';
import { dartLabel, type DartHit } from '../../domain/darts';

type Ring = 'single' | 'double' | 'triple';

interface Props {
  pendingHits: DartHit[];
  maxDarts: number;
  disabled: boolean;
  onStage: (hit: DartHit) => void;
  onUndoHit: () => void;
  onCommit: () => void;
  /** Numbers worth highlighting for the current target (dimmed elsewhere is avoided - all stay usable). */
  suggestion?: string;
  /** Golf-style disciplines only: committing before maxDarts hits are staged is itself a valid move. */
  allowEarlyCommit?: boolean;
}

const NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * One-tap-per-dart input: the ring (S/D/T) stays selected between darts, so a typical visit is
 * three taps rather than three dialogs.
 */
export default function DartHitPad({
  pendingHits,
  maxDarts,
  disabled,
  onStage,
  onUndoHit,
  onCommit,
  suggestion,
  allowEarlyCommit = false,
}: Props) {
  const [ring, setRing] = useState<Ring>('single');
  const full = pendingHits.length >= maxDarts;
  const canCommit = pendingHits.length > 0 && (allowEarlyCommit || full);

  const stage = (hit: DartHit) => {
    if (disabled || full) return;
    onStage(hit);
  };

  return (
    <div className="pent-keypad">
      <div className="pent-pending" aria-live="polite" aria-label="この投球の入力内容">
        {Array.from({ length: maxDarts }, (_, index) => {
          const hit = pendingHits[index];
          return hit ? (
            <span className="pent-pending-chip" key={index}>
              {dartLabel(hit)}
            </span>
          ) : (
            <span className="pent-pending-chip empty" key={index}>
              {index + 1}投目
            </span>
          );
        })}
      </div>

      {suggestion && <div className="pent-hint">ターゲット： {suggestion}</div>}

      <div className="pent-ring-row" role="group" aria-label="倍率の選択">
        {(['single', 'double', 'triple'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={ring === value ? 'selected' : ''}
            aria-pressed={ring === value}
            disabled={disabled}
            onClick={() => setRing(value)}
          >
            {value === 'single' ? 'S' : value === 'double' ? 'D' : 'T'}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => stage({ kind: 'bull', ring: 'outer' })}
          aria-label="アウターブル 25点"
        >
          25
        </button>
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => stage({ kind: 'bull', ring: 'inner' })}
          aria-label="インナーブル 50点"
        >
          BULL
        </button>
      </div>

      <div className="pent-number-grid" role="group" aria-label="ナンバーの選択">
        {NUMBERS.map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled || full}
            aria-label={`${ring === 'single' ? 'シングル' : ring === 'double' ? 'ダブル' : 'トリプル'}${value}`}
            onClick={() => stage({ kind: 'number', value, ring })}
          >
            {value}
          </button>
        ))}
        <button
          type="button"
          className="wide"
          disabled={disabled || full}
          onClick={() => stage({ kind: 'miss' })}
        >
          MISS
        </button>
      </div>

      <div className="pent-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || pendingHits.length === 0}
          onClick={onUndoHit}
        >
          1投戻す
        </button>
        <button
          type="button"
          className="primary-button compact"
          disabled={disabled || !canCommit}
          onClick={onCommit}
          style={{ width: '100%' }}
        >
          この投球を確定
        </button>
      </div>
    </div>
  );
}
