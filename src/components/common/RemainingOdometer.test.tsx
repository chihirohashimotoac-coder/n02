import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemainingOdometer from './RemainingOdometer';
import type { RemainingRoll } from './remainingRoll';

/**
 * The roll itself. jsdom has no Web Animations API, so each test either leaves it absent (the
 * fallback) or stubs Element.animate with a handle whose finish can be fired by hand.
 */

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  onfinish: (() => void) | null;
  cancel: ReturnType<typeof vi.fn>;
}

let animations: FakeAnimation[] = [];

function stubAnimate() {
  const animate = vi.fn(function (keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const animation: FakeAnimation = { keyframes, options, onfinish: null, cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate });
  return animate;
}

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function finishAll() {
  act(() => {
    for (const animation of animations) animation.onfinish?.();
  });
}

const roll = (from: number, to: number): RemainingRoll => ({ player: 0, from, to });

function renderInStrong(value: number, current: RemainingRoll | null) {
  const view = render(
    <strong>
      <RemainingOdometer value={value} roll={current} />
    </strong>,
  );
  const strong = view.container.querySelector('strong')!;
  const update = (nextValue: number, nextRoll: RemainingRoll | null) =>
    view.rerender(
      <strong>
        <RemainingOdometer value={nextValue} roll={nextRoll} />
      </strong>,
    );
  return { ...view, strong, update };
}

beforeEach(() => {
  animations = [];
  setReducedMotion(false);
});

afterEach(() => {
  cleanup();
  // Back to jsdom's own state: no animate at all.
  delete (Element.prototype as Partial<Element>).animate;
});

describe('RemainingOdometer', () => {
  it('is nothing but the number when there is nothing to roll', () => {
    stubAnimate();
    const { strong } = renderInStrong(501, null);
    expect(strong.innerHTML).toBe('501');
    expect(animations).toHaveLength(0);
  });

  it('rolls every digit into the new value in about 400ms, fastest at the start', () => {
    const animate = stubAnimate();
    const { strong } = renderInStrong(401, roll(501, 401));

    expect(animate).toHaveBeenCalledTimes(3);
    const durations = animations.map((animation) => animation.options.duration as number);
    // Columns to the left stop a little earlier; the whole roll, stagger included, is 400ms.
    expect(Math.max(...durations)).toBe(400);
    expect(durations).toEqual([...durations].sort((a, b) => a - b));
    expect(Math.min(...durations)).toBeGreaterThan(300);
    for (const animation of animations) {
      expect(animation.options.delay ?? 0).toBe(0);
      expect(animation.options.easing).toMatch(/^cubic-bezier\(/);
      expect(animation.keyframes[animation.keyframes.length - 1]).toEqual({ top: '0%' });
    }
    // The DOM text - what a screen reader and every test read - is the official value throughout.
    expect(strong.textContent).toBe('401');
    expect(strong.querySelector('.remaining-odometer-reels')).toHaveAttribute('aria-hidden', 'true');
    // The reels land on 4, 0 and 1.
    const tops = [...strong.querySelectorAll<HTMLElement>('.remaining-odometer-reel')].map(
      (reel) => reel.dataset.reel!.split('\n')[0],
    );
    expect(tops.join('')).toBe('401');

    finishAll();
    expect(strong.innerHTML).toBe('401');
  });

  it.each([
    [501, 321],
    [180, 80],
    [1101, 921],
    [40, 0],
  ])('lands %i → %i on the exact new value, without a leading zero', (from, to) => {
    stubAnimate();
    const { strong } = renderInStrong(to, roll(from, to));
    expect(strong.querySelectorAll('.remaining-odometer-reel')).toHaveLength(String(to).length);
    expect(strong.textContent).toBe(String(to));
    finishAll();
    expect(strong.innerHTML).toBe(String(to));
  });

  it('shows the value at once under prefers-reduced-motion', () => {
    const animate = stubAnimate();
    setReducedMotion(true);
    const { strong } = renderInStrong(401, roll(501, 401));
    expect(animate).not.toHaveBeenCalled();
    expect(strong.innerHTML).toBe('401');
  });

  it('never replays a commit shown under reduced motion once motion is allowed again', () => {
    const animate = stubAnimate();
    setReducedMotion(true);
    const commit = roll(501, 401);
    const { strong, update } = renderInStrong(401, commit);
    expect(strong.innerHTML).toBe('401');

    // The OS setting is turned off; any later re-render still carries the same, settled commit.
    setReducedMotion(false);
    update(401, commit);
    expect(animate).not.toHaveBeenCalled();
    expect(strong.innerHTML).toBe('401');

    // A new commit after that does roll.
    update(321, roll(401, 321));
    expect(animate).toHaveBeenCalledTimes(3);
  });

  it('shows the value at once where the browser cannot animate', () => {
    const { strong } = renderInStrong(401, roll(501, 401));
    expect(strong.innerHTML).toBe('401');
  });

  it('lands at once if starting the animation throws', async () => {
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error('no animation');
      },
    });
    const { strong } = renderInStrong(401, roll(501, 401));
    // The reels already rest on the new digits, and the plain number follows straight away.
    expect(strong.textContent).toBe('401');
    await act(async () => {});
    expect(strong.innerHTML).toBe('401');
  });

  it('drops an unfinished roll for a newer one, and the old finish changes nothing', () => {
    stubAnimate();
    const first = roll(501, 401);
    const { strong, update } = renderInStrong(401, first);
    const stale = [...animations];

    const second = roll(401, 221);
    update(221, second);
    for (const animation of stale) expect(animation.cancel).toHaveBeenCalled();
    expect(strong.textContent).toBe('221');

    // A late finish from the cancelled roll must not end the new one early.
    act(() => {
      for (const animation of stale) animation.onfinish?.();
    });
    expect(strong.querySelectorAll('.remaining-odometer-reel')).toHaveLength(3);

    finishAll();
    expect(strong.innerHTML).toBe('221');
  });

  it('snaps to the official value when the roll is withdrawn (an undo, a correction)', () => {
    stubAnimate();
    const { strong, update } = renderInStrong(401, roll(501, 401));
    const running = [...animations];
    update(501, null);
    expect(strong.innerHTML).toBe('501');
    for (const animation of running) expect(animation.cancel).toHaveBeenCalled();
  });

  it('never shows a roll that does not end on the value it is given', () => {
    const animate = stubAnimate();
    const { strong } = renderInStrong(501, roll(501, 401));
    expect(animate).not.toHaveBeenCalled();
    expect(strong.innerHTML).toBe('501');
  });

  it('cancels everything when it unmounts mid-roll', () => {
    stubAnimate();
    const { unmount } = renderInStrong(401, roll(501, 401));
    const running = [...animations];
    unmount();
    for (const animation of running) {
      expect(animation.cancel).toHaveBeenCalled();
      expect(animation.onfinish).toBeNull();
    }
  });

  it('rolls a given commit only once', () => {
    const animate = stubAnimate();
    const commit = roll(501, 401);
    const { strong, update } = renderInStrong(401, commit);
    finishAll();
    update(401, commit);
    expect(animate).toHaveBeenCalledTimes(3);
    expect(strong.innerHTML).toBe('401');
  });
});
