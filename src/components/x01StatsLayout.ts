import { useSyncExternalStore } from 'react';

/**
 * Where the play-screen statistics of 通常01・チェックアウト練習 go on this viewport.
 *
 * - `side`    a landscape screen 1280px wide or more: a 160px column either side of the sheet;
 * - `compact` a landscape screen 1024-1279px wide: 112px columns with the main figures only;
 * - `dialog`  everything else - a phone, a portrait tablet, a short or narrow window, a 200% zoom,
 *             and the short touch landscape that has the keypad rail: Stats opens the 詳細 dialog.
 *
 * The minimum height keeps a column from being squeezed into a sliver. Read from media queries
 * rather than measured, so there is no ResizeObserver and nothing written back into the layout.
 */
const SIDE_QUERY = '(orientation: landscape) and (min-width: 1280px) and (min-height: 640px)';
const COMPACT_QUERY = '(orientation: landscape) and (min-width: 1024px) and (min-height: 640px)';

export type X01StatsLayout = 'side' | 'compact' | 'dialog';

function readLayout(): X01StatsLayout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dialog';
  if (window.matchMedia(SIDE_QUERY).matches) return 'side';
  if (window.matchMedia(COMPACT_QUERY).matches) return 'compact';
  return 'dialog';
}

function subscribeLayout(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const lists = [SIDE_QUERY, COMPACT_QUERY].map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

export function useX01StatsLayout(): X01StatsLayout {
  return useSyncExternalStore(subscribeLayout, readLayout, () => 'dialog');
}

export const sidePanelId = (player: 0 | 1) => `x01-stats-p${player + 1}`;
export const STATS_DIALOG_ID = 'x01-stats-detail';
