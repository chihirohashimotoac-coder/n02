import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AwardOverlay, { AWARD_DURATION_MS, type AwardPresentation } from './AwardOverlay';

/**
 * The award presentation's media contract.
 *
 * These live here rather than in the E2E suite deliberately: Playwright's bundled Chromium ships
 * without the proprietary H.264 decoder (canPlayType for avc1 returns ''), so the movie can never
 * actually play there, and the service worker precaches the posters - which means the "neither the
 * movie nor the poster loaded" floor is unreachable in that environment. jsdom lets each step of
 * the fallback chain be driven directly.
 */

const award = (overrides: Partial<AwardPresentation> = {}): AwardPresentation => ({
  id: 1,
  kind: 'TON_80',
  score: 180,
  playerName: 'プレイヤー1',
  ...overrides,
});

/** jsdom has no media pipeline; play() is undefined on HTMLMediaElement there. */
function stubPlay(result: Promise<void> = Promise.resolve()) {
  const play = vi.fn(() => result);
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: play,
  });
  return play;
}

/** jsdom's readyState is always 0; the component branches on it, so let each test say what it is. */
function setReadyState(value: number) {
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => value,
  });
}

/** A refusal in the browser's own shape: a DOMException-like error that is not an AbortError. */
function refusal() {
  const error = new Error('play() failed because the user did not interact with the document first');
  error.name = 'NotAllowedError';
  return error;
}

function setReducedMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  setReducedMotion(false);
  setReadyState(0);
  stubPlay();
  // jsdom implements none of the media pipeline and logs a warning for each of these; the cleanup
  // path in the component calls them, so stub them out rather than let every test print noise.
  for (const method of ['pause', 'load'] as const) {
    Object.defineProperty(HTMLMediaElement.prototype, method, {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('AwardOverlay', () => {
  it('renders nothing at all when there is no award', () => {
    const { container } = render(<AwardOverlay award={null} onExpire={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('plays the movie muted, inline, once, and hides it from assistive technology', () => {
    const play = stubPlay();
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);

    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(video.muted).toBe(true);
    expect(video).toHaveAttribute('playsinline');
    expect(video).not.toHaveAttribute('loop');
    expect(video).not.toHaveAttribute('controls');
    expect(video.getAttribute('src')).toContain('award-ton80.mp4');
    // No poster attribute, on purpose: every movie opens on a pure-black frame, so a poster here
    // would paint the bright middle of the award and then snap to black as playback started. The
    // poster is the fallback element below, not a placeholder over the movie.
    expect(video).not.toHaveAttribute('poster');
    // The movie carries no words; it is decoration over which the text is drawn.
    expect(container.querySelector('.award-media')).toHaveAttribute('aria-hidden', 'true');
    // Played from the very start, exactly once.
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.currentTime).toBe(0);
  });

  it('announces the award as real text through a polite live region', () => {
    render(<AwardOverlay award={award({ playerName: 'あいうえおかきくけこさしすせそたちつ' })} onExpire={vi.fn()} />);

    const text = document.querySelector('.award-text') as HTMLElement;
    expect(text).toHaveAttribute('aria-live', 'polite');
    expect(text).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByText('TON 80')).toBeInTheDocument();
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('あいうえおかきくけこさしすせそたちつ')).toBeInTheDocument();
  });

  it('carries the award kind as a class, so each award can be tinted to its own movie', () => {
    const { container } = render(<AwardOverlay award={award({ kind: 'BIG_FISH' })} onExpire={vi.fn()} />);
    expect(container.querySelector('.award-card')).toHaveClass('award-big-fish');
    expect(screen.getByText('BIG FISH')).toBeInTheDocument();
  });

  it('falls back to the poster when the movie cannot be decoded or fetched', () => {
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    fireEvent.error(container.querySelector('video') as HTMLVideoElement);

    expect(container.querySelector('video')).toBeNull();
    const poster = container.querySelector('img.award-poster') as HTMLImageElement;
    expect(poster.getAttribute('src')).toContain('award-ton80-poster.webp');
    // The award is still fully readable.
    expect(screen.getByText('TON 80')).toBeInTheDocument();
  });

  it('falls back to the CSS presentation when the poster fails too', () => {
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    fireEvent.error(container.querySelector('video') as HTMLVideoElement);
    fireEvent.error(container.querySelector('img.award-poster') as HTMLImageElement);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.award-fallback')).toBeInTheDocument();
    expect(screen.getByText('TON 80')).toBeInTheDocument();
  });

  it('falls back to the poster when autoplay is refused on a movie that had data to play', async () => {
    setReadyState(4);
    stubPlay(Promise.reject(refusal()));
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    await act(async () => {});
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img.award-poster')).toBeInTheDocument();
  });

  /**
   * The first play() lands before the element has anything to play, which some browsers reject
   * outright. Giving up there used to drop a movie that was about to be perfectly playable.
   */
  it('retries once when play() is refused before the movie has any data', async () => {
    setReadyState(0);
    const play = stubPlay(Promise.reject(refusal()));
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    await act(async () => {});
    // Still the movie: nothing has proved it cannot play.
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(play).toHaveBeenCalledTimes(1);

    setReadyState(4);
    stubPlay(Promise.resolve());
    await act(async () => {
      fireEvent(video, new Event('canplay'));
    });
    expect(container.querySelector('video')).toBeInTheDocument();
  });

  it('falls back to the poster when the retry is refused as well', async () => {
    setReadyState(0);
    stubPlay(Promise.reject(refusal()));
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    await act(async () => {});
    const video = container.querySelector('video') as HTMLVideoElement;

    await act(async () => {
      fireEvent(video, new Event('canplay'));
    });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img.award-poster')).toBeInTheDocument();
  });

  /**
   * An AbortError is the browser's own autoplay taking the play over, or the element going away -
   * neither means the movie failed, and treating it as a failure threw away good movies.
   */
  it('keeps the movie when play() rejects with AbortError', async () => {
    setReadyState(4);
    const error = new Error('interrupted');
    error.name = 'AbortError';
    stubPlay(Promise.reject(error));
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    await act(async () => {});
    expect(container.querySelector('video')).toBeInTheDocument();
    expect(container.querySelector('img.award-poster')).toBeNull();
  });

  it('shows the poster when the movie has produced no frame within its budget', () => {
    vi.useFakeTimers();
    setReadyState(0);
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    expect(container.querySelector('video')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(1199));
    expect(container.querySelector('video')).toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(2));
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img.award-poster')).toBeInTheDocument();
  });

  it('leaves a movie that is playing alone once its budget passes', () => {
    vi.useFakeTimers();
    setReadyState(4);
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    act(() => void vi.advanceTimersByTime(1500));
    expect(container.querySelector('video')).toBeInTheDocument();
  });

  it('plays no movie at all under prefers-reduced-motion, showing the poster and the text', () => {
    setReducedMotion(true);
    const play = stubPlay();
    const { container } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);

    expect(container.querySelector('video')).toBeNull();
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector('img.award-poster')).toBeInTheDocument();
    expect(screen.getByText('TON 80')).toBeInTheDocument();
  });

  it('holds for exactly 3000ms, whatever the media did', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<AwardOverlay award={award()} onExpire={onExpire} />);

    expect(AWARD_DURATION_MS).toBe(3000);
    act(() => void vi.advanceTimersByTime(2999));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(2));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not extend the window while the movie is still loading', () => {
    vi.useFakeTimers();
    // A movie whose play() promise never settles: the timer must not wait on it.
    stubPlay(new Promise<void>(() => {}));
    const onExpire = vi.fn();
    render(<AwardOverlay award={award()} onExpire={onExpire} />);

    act(() => void vi.advanceTimersByTime(3000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('a replacement award restarts the window rather than inheriting the previous one', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { rerender } = render(<AwardOverlay award={award({ id: 1, kind: 'LOW_TON', score: 100 })} onExpire={onExpire} />);

    act(() => void vi.advanceTimersByTime(2500));
    expect(onExpire).not.toHaveBeenCalled();

    rerender(<AwardOverlay award={award({ id: 2, kind: 'TON_80', score: 180 })} onExpire={onExpire} />);
    // The first award's remaining 500ms must not take the second one down with it.
    act(() => void vi.advanceTimersByTime(2500));
    expect(onExpire).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(600));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('gives a replacement award a clean shot at its own movie after the previous one fell back', () => {
    const { container, rerender } = render(<AwardOverlay award={award({ id: 1 })} onExpire={vi.fn()} />);
    fireEvent.error(container.querySelector('video') as HTMLVideoElement);
    expect(container.querySelector('video')).toBeNull();

    rerender(<AwardOverlay award={award({ id: 2, kind: 'LOW_TON', score: 100 })} onExpire={vi.fn()} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(video.getAttribute('src')).toContain('award-low-ton.mp4');
  });

  /**
   * Stopping it is the whole cleanup. Clearing src here would be React's own attribute mutated
   * behind its back, and React does not put it back on a re-mount - under StrictMode's double
   * invoke that left the element permanently source-less and the movie was lost for good.
   */
  it('stops the movie when it goes away, without clearing the source React owns', () => {
    const { container, rerender } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    const video = container.querySelector('video') as HTMLVideoElement;
    const pause = vi.spyOn(video, 'pause');

    rerender(<AwardOverlay award={null} onExpire={vi.fn()} />);
    expect(pause).toHaveBeenCalled();
    expect(video.getAttribute('src')).toContain('award-ton80.mp4');
  });

  it('survives being mounted, cleaned up and mounted again with its movie intact', async () => {
    // Exactly what StrictMode does in development, and what used to strip the source.
    setReadyState(0);
    const { container, unmount } = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    const first = container.querySelector('video') as HTMLVideoElement;
    unmount();
    expect(first.getAttribute('src')).toContain('award-ton80.mp4');

    const second = render(<AwardOverlay award={award()} onExpire={vi.fn()} />);
    await act(async () => {});
    const video = second.container.querySelector('video') as HTMLVideoElement;
    expect(video).toBeInTheDocument();
    expect(video.getAttribute('src')).toContain('award-ton80.mp4');
  });
});
