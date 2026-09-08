import { useEffect } from 'react';
import { AWARDS_BY_MODE, awardAsset } from '../../domain/awardAssets';

type RequestIdle = (cb: () => void, options?: { timeout?: number }) => number;

/**
 * Warms the award media for one mode, without ever competing with the game.
 *
 * The files live in public/ and so are absent from the initial bundle - nothing is fetched until a
 * mode actually starts. From there this waits for the browser to be idle and fetches only the
 * awards that mode can produce, one at a time, at low priority. Every fetch failure is ignored:
 * this is a warm-up, and the overlay's own poster/CSS fallbacks cover a cold cache anyway.
 *
 * Posters are precached by the service worker (they are part of the build output), so the poster
 * fallback works on a first offline run even with no movie cached at all. The movies themselves are
 * runtime-cached: too large to justify holding up the install, and never required for correctness.
 */
export function useAwardPreload(mode: 'count-up' | 'x01', enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();

    const warm = async () => {
      for (const kind of AWARDS_BY_MODE[mode]) {
        if (cancelled) return;
        const { movie } = awardAsset(kind);
        try {
          // Sequential and non-blocking: one movie in flight at a time, so the warm-up can never
          // saturate a phone's connection while a player is entering scores.
          await fetch(movie, { signal: controller.signal, priority: 'low' } as RequestInit);
        } catch {
          // Offline, aborted, 404 - all fine. The overlay falls back to the poster.
          if (cancelled) return;
        }
      }
    };

    const idle = (window as unknown as { requestIdleCallback?: RequestIdle }).requestIdleCallback;
    let handle: number;
    if (typeof idle === 'function') {
      handle = idle(() => void warm(), { timeout: 4000 });
    } else {
      // Safari has no requestIdleCallback; a plain delay keeps the warm-up off the critical path.
      handle = window.setTimeout(() => void warm(), 2000);
    }

    return () => {
      cancelled = true;
      controller.abort();
      const cancelIdle = (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback;
      if (typeof idle === 'function' && typeof cancelIdle === 'function') cancelIdle(handle);
      else clearTimeout(handle);
    };
  }, [mode, enabled]);
}
