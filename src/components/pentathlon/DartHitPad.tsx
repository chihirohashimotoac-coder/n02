import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
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
const RING_NAME: Record<Ring, string> = { single: 'シングル', double: 'ダブル', triple: 'トリプル' };
const RING_KEY: Record<Ring, string> = { single: 's', double: 'd', triple: 't' };

/** One button of a quick-target pad, in the order it is rendered - which is also its number-key. */
interface QuickOption {
  hit: DartHit;
  label: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * One-tap-per-dart input: the ring (S/D/T) stays selected between darts, so a typical visit is
 * three taps rather than three dialogs.
 *
 * On a PC the whole pad is also driveable from the keyboard, in whichever way suits the screen:
 * a small quick-target pad binds its buttons to 1-4 in display order, while the full number grid
 * takes darts notation (a number, then S/D/T - e.g. "20" then "t" for T20; b/o for the bulls,
 * m for a miss). Enter commits the turn and Backspace takes a dart back, on both.
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
  // Digits typed towards a number in grid mode, e.g. "1" on the way to 15. Shown on screen so the
  // half-entered state is never invisible. Tagged with the pad it was typed into, so a pad that
  // changes shape mid-turn (Half-It's any-ring rounds) discards it rather than misreading it.
  const [buffer, setBuffer] = useState({ context: '', digits: '' });
  const full = pendingHits.length >= maxDarts;
  const canCommit = pendingHits.length > 0 && (allowEarlyCommit || full);

  const stage = useCallback(
    (hit: DartHit) => {
      if (disabled || full) return;
      onStage(hit);
    },
    [disabled, full, onStage],
  );

  /**
   * Stages a dart from a click, and - only for a real pointer click (detail > 0, so never a
   * keyboard activation) - drops focus afterwards, so Enter still means "commit the turn" rather
   * than re-firing whichever pad button the mouse last landed on.
   */
  const stageFromClick = useCallback(
    (hit: DartHit) => (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 0) event.currentTarget.blur();
      stage(hit);
    },
    [stage],
  );

  const quickOptions = useMemo(() => buildQuickOptions(target), [target]);
  // Half-It's any-double / any-triple rounds still use the full grid, but with the ring fixed.
  const gridRing: Ring = target?.kind === 'any-ring' ? target.ring : ring;
  const gridNumbers = target?.kind === 'any-ring' ? ALL_NUMBERS : numbers;
  const gridMode = quickOptions === null;
  const ringRowShown = target === null;

  const padContext = `${target?.kind ?? 'grid'}:${gridRing}`;
  const typed = buffer.context === padContext ? buffer.digits : '';
  const setTyped = useCallback(
    (digits: string) => setBuffer({ context: padContext, digits }),
    [padContext],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      // Enter and Space are how a keyboard user activates whatever control they have tabbed to, so
      // those two are only ever claimed as pad shortcuts when nothing is focused. Letters and
      // digits activate nothing, so they stay available either way.
      const active = document.activeElement;
      const onControl = active instanceof HTMLElement && active.matches('button, input, select, textarea, a[href]');
      if (onControl && (key === 'enter' || key === ' ')) return;

      if (key === 'enter') {
        event.preventDefault();
        if (canCommit) onCommit();
        return;
      }
      if (key === 'backspace') {
        event.preventDefault();
        if (typed) setTyped(typed.slice(0, -1));
        else if (pendingHits.length > 0) onUndoHit();
        return;
      }
      if (key === 'escape') {
        event.preventDefault();
        setTyped('');
        return;
      }
      if (key === 'm') {
        event.preventDefault();
        setTyped('');
        stage({ kind: 'miss' });
        return;
      }

      if (quickOptions) {
        const index = Number(key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < quickOptions.length) {
          event.preventDefault();
          stage(quickOptions[index].hit);
        }
        return;
      }

      // Grid mode: darts notation.
      if (ringRowShown && (key === 'b' || key === 'o')) {
        event.preventDefault();
        setTyped('');
        stage({ kind: 'bull', ring: key === 'b' ? 'inner' : 'outer' });
        return;
      }

      const pressedRing = (Object.keys(RING_KEY) as Ring[]).find((value) => RING_KEY[value] === key);
      if (pressedRing) {
        event.preventDefault();
        if (typed) {
          const value = resolveTyped(typed, gridNumbers);
          setTyped('');
          // With the ring fixed for the round, the pressed key only terminates the number.
          if (value !== null) stage({ kind: 'number', value, ring: ringRowShown ? pressedRing : gridRing });
        } else if (ringRowShown) {
          setRing(pressedRing);
        }
        return;
      }

      if (key === ' ') {
        event.preventDefault();
        const value = resolveTyped(typed, gridNumbers);
        setTyped('');
        if (value !== null) stage({ kind: 'number', value, ring: gridRing });
        return;
      }

      if (key >= '0' && key <= '9') {
        event.preventDefault();
        const next = typed + key;
        // Restart from this digit rather than ignoring it when the pair can't be a valid number.
        const candidate = gridNumbers.some((n) => String(n).startsWith(next)) ? next : key;
        if (!gridNumbers.some((n) => String(n).startsWith(candidate))) return;
        const exact = Number(candidate);
        const extendable = gridNumbers.some((n) => n !== exact && String(n).startsWith(candidate));
        if (gridNumbers.includes(exact) && !extendable) {
          setTyped('');
          stage({ kind: 'number', value: exact, ring: gridRing });
        } else {
          setTyped(candidate);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    canCommit,
    disabled,
    gridNumbers,
    gridRing,
    onCommit,
    onUndoHit,
    pendingHits.length,
    quickOptions,
    ringRowShown,
    setTyped,
    stage,
    typed,
  ]);

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
        {gridMode && typed !== '' && (
          <span className="pent-typing" role="status">
            {gridRing === 'single' ? 'S' : gridRing === 'double' ? 'D' : 'T'}
            {typed}
            <em>…</em>
          </span>
        )}
      </div>

      {suggestion && <div className="pent-hint">ターゲット： {suggestion}</div>}

      {quickOptions ? (
        <div
          className={`pent-quick-grid pent-quick-${quickOptions.length === 2 ? 2 : quickOptions.length === 3 ? 3 : 4}`}
          role="group"
          aria-label="判定の選択"
        >
          {/* The number-key badge is drawn from data-key in CSS, so it stays purely decorative -
              out of the button's accessible name and out of its text content. */}
          {quickOptions.map((option, index) => (
            <button
              key={index}
              type="button"
              className={`pent-quick-btn ${option.className ?? ''}`}
              data-key={index + 1}
              disabled={disabled || full}
              aria-label={option.ariaLabel}
              onClick={stageFromClick(option.hit)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          {ringRowShown && (
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
                onClick={stageFromClick({ kind: 'bull', ring: 'outer' })}
                aria-label="アウターブル 25点"
              >
                25
              </button>
              <button
                type="button"
                disabled={disabled || full}
                onClick={stageFromClick({ kind: 'bull', ring: 'inner' })}
                aria-label="インナーブル 50点"
              >
                BULL
              </button>
            </div>
          )}

          <div
            className="pent-number-grid"
            role="group"
            aria-label={ringRowShown ? 'ナンバーの選択' : `${RING_NAME[gridRing]}の命中ナンバー`}
          >
            {gridNumbers.map((value) => (
              <button
                key={value}
                type="button"
                disabled={disabled || full}
                aria-label={`${RING_NAME[gridRing]}${value}`}
                onClick={stageFromClick({ kind: 'number', value, ring: gridRing })}
              >
                {value}
              </button>
            ))}
            <button
              type="button"
              className="wide"
              disabled={disabled || full}
              onClick={stageFromClick({ kind: 'miss' })}
            >
              {ringRowShown ? 'MISS' : 'ミス'}
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

/**
 * The number the typed digits mean: the digits themselves when they name a number in the set, or
 * the single number they can still complete to (so "2" is 20 on a Cricket pad, where 2 is not in
 * play). Null when they are still ambiguous or name nothing.
 */
function resolveTyped(typed: string, numbers: number[]): number | null {
  if (typed === '') return null;
  const exact = Number(typed);
  if (numbers.includes(exact)) return exact;
  const matches = numbers.filter((n) => String(n).startsWith(typed));
  return matches.length === 1 ? matches[0] : null;
}

/** The quick pad's buttons, in display (and number-key) order. Null means "use the full grid". */
function buildQuickOptions(target: QuickTarget | null): QuickOption[] | null {
  if (target === null || target.kind === 'any-ring') return null;

  if (target.kind === 'bull') {
    return [
      { hit: { kind: 'bull', ring: 'outer' }, label: 'アウターブル' },
      { hit: { kind: 'bull', ring: 'inner' }, label: 'インナーブル', className: 'hit' },
      { hit: { kind: 'miss' }, label: 'ミス', className: 'miss' },
    ];
  }

  if (target.kind === 'double') {
    return [
      {
        hit: { kind: 'number', value: target.number, ring: 'double' },
        label: `成功（D${target.number}）`,
        className: 'hit',
      },
      { hit: { kind: 'miss' }, label: 'ミス', className: 'miss' },
    ];
  }

  const outcomes = target.outcomes;
  const rings: QuickOption[] = (['single', 'double', 'triple'] as const).map((ring) => ({
    hit: { kind: 'number', value: target.number, ring },
    className: ring === 'triple' ? 'hit' : undefined,
    ariaLabel: outcomes ? `${RING_NAME[ring]}${target.number}・${outcomes[ring]}` : undefined,
    label: (
      <>
        {outcomes ? RING_NAME[ring] : `${RING_NAME[ring]}${target.number}`}
        {outcomes && <em>{outcomes[ring]}</em>}
      </>
    ),
  }));
  return [
    ...rings,
    {
      hit: { kind: 'miss' },
      className: 'miss',
      ariaLabel: outcomes ? `ミス・${outcomes.miss}` : undefined,
      label: (
        <>
          ミス
          {outcomes && <em>{outcomes.miss}</em>}
        </>
      ),
    },
  ];
}
