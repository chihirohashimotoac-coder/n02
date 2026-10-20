import { useLayoutEffect, useRef, useState } from 'react';
import { reelColumns, type RemainingRoll } from './remainingRoll';

/** The whole roll, last column's stop included. There is no separate wait before or after it. */
const ROLL_DURATION_MS = 400;
/** Each column to the left stops this much earlier, so the number settles right to left. */
const COLUMN_STAGGER_MS = 40;
/** Fast off the mark, easing into the landing digit. */
const ROLL_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function motionAllowed(): boolean {
  if (typeof window === 'undefined' || typeof Element === 'undefined') return false;
  if (typeof Element.prototype.animate !== 'function') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  return true;
}

/**
 * The digits of a big remaining number, rolled once into a newly committed value.
 *
 * Renders inside the existing <strong>, which keeps every style it had. At rest it is nothing but
 * the number itself, the same text node as before. While rolling, the number is still laid out as
 * one unbroken run of text - so the width, baseline and line box are exactly the font's own - only
 * made transparent, with the reels drawn over it out of flow, each clipped to its digit's line box.
 * The reels are CSS-generated text, so they are not in the DOM text, and aria-hidden, so the
 * accessible remaining is always the official value.
 */
export default function RemainingOdometer({ value, roll }: { value: number; roll: RemainingRoll | null }) {
  const [landed, setLanded] = useState<RemainingRoll | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  // Only a roll into the value actually shown, and only once.
  const rolling = roll !== null && roll !== landed && roll.to === value && motionAllowed() ? roll : null;

  useLayoutEffect(() => {
    if (rolling === null) return;
    const reels = [...(rootRef.current?.querySelectorAll<HTMLElement>('.remaining-odometer-reel') ?? [])];
    const animations: Animation[] = [];
    let current = true;
    try {
      reels.forEach((reel, index) => {
        const duration = ROLL_DURATION_MS - (reels.length - 1 - index) * COLUMN_STAGGER_MS;
        // `top` in whole windows (one window is one line): the reel is drawn in the same layer as
        // the number itself, so the landing digit sits on the exact pixels the real text uses.
        animations.push(
          reel.animate([{ top: `${-100 * Number(reel.dataset.steps)}%` }, { top: '0%' }], {
            duration,
            easing: ROLL_EASING,
            fill: 'backwards',
          }),
        );
      });
    } catch {
      // No usable animation: the reels already rest on the new digits, so it simply lands at once.
    }
    const last = animations[animations.length - 1];
    const land = () => {
      if (current) setLanded(rolling);
    };
    if (last) last.onfinish = land;
    else queueMicrotask(land);
    return () => {
      current = false;
      for (const animation of animations) {
        animation.onfinish = null;
        animation.cancel();
      }
    };
  }, [rolling]);

  if (rolling === null) return value;
  return (
    <i className="remaining-odometer" ref={rootRef}>
      <i className="remaining-odometer-face">{value}</i>
      <i className="remaining-odometer-reels" aria-hidden="true">
        {reelColumns(rolling.from, rolling.to).map((column, index) => (
          <i key={index} className="remaining-odometer-window">
            <i className="remaining-odometer-reel" data-reel={column.reel} data-steps={column.steps} />
          </i>
        ))}
      </i>
    </i>
  );
}
