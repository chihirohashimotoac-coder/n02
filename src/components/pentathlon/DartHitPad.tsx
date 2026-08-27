import { useState } from 'react';
import { dartLabel, type DartHit } from '../../domain/darts';
import type { QuickTarget } from './quickTarget';

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
  /**
   * When set, renders a small, unambiguous button set scoped to exactly what this turn can score
   * against (Cork/Golf/Half-It/RTC-on-Doubles) instead of the full 20-number x S/D/T grid below -
   * the full grid forces two decisions (which number, then which ring) even on turns where only one
   * of them can ever vary, which is what made it slow to use. See quickTarget.ts.
   */
  target?: QuickTarget | null;
  /** Restricts the full grid's numbers (Cricket: just its 6 in-play numbers). Ignored when `target` is set. */
  numbers?: number[];
}

const ALL_NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

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
  target = null,
  numbers = ALL_NUMBERS,
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

      {target ? (
        <QuickTargetButtons target={target} disabled={disabled} full={full} onHit={stage} />
      ) : (
        <>
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
            {numbers.map((value) => (
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
        </>
      )}

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

function QuickTargetButtons({
  target,
  disabled,
  full,
  onHit,
}: {
  target: QuickTarget;
  disabled: boolean;
  full: boolean;
  onHit: (hit: DartHit) => void;
}) {
  const tap = (hit: DartHit) => {
    if (disabled || full) return;
    onHit(hit);
  };
  const busy = disabled || full;

  if (target.kind === 'bull') {
    return (
      <div className="pent-quick-grid pent-quick-3" role="group" aria-label="判定の選択">
        <button
          type="button"
          className="pent-quick-btn"
          disabled={busy}
          onClick={() => tap({ kind: 'bull', ring: 'outer' })}
        >
          アウターブル
        </button>
        <button
          type="button"
          className="pent-quick-btn hit"
          disabled={busy}
          onClick={() => tap({ kind: 'bull', ring: 'inner' })}
        >
          インナーブル
        </button>
        <button type="button" className="pent-quick-btn miss" disabled={busy} onClick={() => tap({ kind: 'miss' })}>
          ミス
        </button>
      </div>
    );
  }

  if (target.kind === 'double') {
    return (
      <div className="pent-quick-grid pent-quick-2" role="group" aria-label="判定の選択">
        <button
          type="button"
          className="pent-quick-btn hit"
          disabled={busy}
          onClick={() => tap({ kind: 'number', value: target.number, ring: 'double' })}
        >
          成功（D{target.number}）
        </button>
        <button type="button" className="pent-quick-btn miss" disabled={busy} onClick={() => tap({ kind: 'miss' })}>
          ミス
        </button>
      </div>
    );
  }

  if (target.kind === 'number') {
    const outcomes = target.outcomes;
    return (
      <div className="pent-quick-grid pent-quick-4" role="group" aria-label="判定の選択">
        {(['single', 'double', 'triple'] as const).map((ring) => {
          const ringName = ring === 'single' ? 'シングル' : ring === 'double' ? 'ダブル' : 'トリプル';
          return (
            <button
              key={ring}
              type="button"
              className={`pent-quick-btn ${ring === 'triple' ? 'hit' : ''}`}
              disabled={busy}
              aria-label={outcomes ? `${ringName}${target.number}・${outcomes[ring]}` : undefined}
              onClick={() => tap({ kind: 'number', value: target.number, ring })}
            >
              {outcomes ? ringName : `${ringName}${target.number}`}
              {outcomes && <em>{outcomes[ring]}</em>}
            </button>
          );
        })}
        <button
          type="button"
          className="pent-quick-btn miss"
          disabled={busy}
          aria-label={outcomes ? `ミス・${outcomes.miss}` : undefined}
          onClick={() => tap({ kind: 'miss' })}
        >
          ミス
          {outcomes && <em>{outcomes.miss}</em>}
        </button>
      </div>
    );
  }

  // any-ring: the ring is fixed for this round, so only the landed-on number is left to pick.
  const ringLabel = target.ring === 'double' ? 'ダブル' : 'トリプル';
  return (
    <div className="pent-number-grid" role="group" aria-label={`${ringLabel}の命中ナンバー`}>
      {ALL_NUMBERS.map((value) => (
        <button
          key={value}
          type="button"
          disabled={busy}
          aria-label={`${ringLabel}${value}`}
          onClick={() => tap({ kind: 'number', value, ring: target.ring })}
        >
          {value}
        </button>
      ))}
      <button type="button" className="wide" disabled={busy} onClick={() => tap({ kind: 'miss' })}>
        ミス
      </button>
    </div>
  );
}
