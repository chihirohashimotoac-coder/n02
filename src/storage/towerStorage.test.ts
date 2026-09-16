import { beforeEach, describe, expect, it } from 'vitest';
import {
  TOWER_HELP_SEEN_KEY,
  TOWER_HISTORY_KEY,
  TOWER_HISTORY_LIMIT,
  appendTowerHistory,
  clearTowerHistory,
  hasSeenTowerHelp,
  loadTowerHistory,
  markTowerHelpSeen,
  removeTowerHistoryEntry,
  updateTowerHistoryEntry,
  type TowerHistoryEntry,
} from './towerStorage';
import { COUNT_UP_HISTORY_KEY } from './practiceStorage';
import { CURRENT_MATCH_KEY, HISTORY_KEY, THEME_KEY } from './matchStorage';
import { PENTATHLON_SESSION_KEY, PENTATHLON_SINGLE_SESSION_KEY } from './pentathlonStorage';
import { AWARD_DISPLAY_KEY } from './awardSettings';

function entry(patch: Partial<TowerHistoryEntry> = {}): TowerHistoryEntry {
  return {
    date: '2026-01-01T00:00:00.000Z',
    courseId: 'home-video-IyVvVmRcmRQ-v1',
    playerCount: 1,
    rules: { startFloor: 1, startLife: 3, continues: 5, recovery: true },
    players: [
      {
        name: 'PLAYER 1',
        clearFloor: 23,
        status: 'retired',
        continuesUsed: 2,
        throws: 61,
        hits: 23,
        misses: 38,
      },
    ],
    ...patch,
  };
}

describe('TOWER history storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses its own key and starts empty', () => {
    expect(TOWER_HISTORY_KEY).toBe('n02-practice-tower-history-v1');
    expect(loadTowerHistory()).toEqual([]);
  });

  it('records newest first and caps the list', () => {
    for (let index = 0; index < TOWER_HISTORY_LIMIT + 4; index += 1) {
      appendTowerHistory(entry({ date: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z` }));
    }
    const stored = loadTowerHistory();
    expect(stored).toHaveLength(TOWER_HISTORY_LIMIT);
    expect(stored[0].date).toBe('2026-01-01T00:00:13.000Z');
  });

  it('rewrites one recorded game in place, matched on its date', () => {
    appendTowerHistory(entry({ date: 'a' }));
    appendTowerHistory(entry({ date: 'b' }));
    updateTowerHistoryEntry(entry({ date: 'a', players: [{ ...entry().players[0], clearFloor: 41 }] }));
    const stored = loadTowerHistory();
    expect(stored.map((item) => item.date)).toEqual(['b', 'a']);
    expect(stored[1].players[0].clearFloor).toBe(41);
  });

  it('leaves the list alone when the game to rewrite has fallen off the end', () => {
    appendTowerHistory(entry({ date: 'a' }));
    const before = loadTowerHistory();
    updateTowerHistoryEntry(entry({ date: 'gone' }));
    expect(loadTowerHistory()).toEqual(before);
  });

  it('removes a game, for a RESULT that is rewound back into play', () => {
    appendTowerHistory(entry({ date: 'a' }));
    appendTowerHistory(entry({ date: 'b' }));
    removeTowerHistoryEntry('b');
    expect(loadTowerHistory().map((item) => item.date)).toEqual(['a']);
  });

  it('survives malformed storage rather than throwing', () => {
    localStorage.setItem(TOWER_HISTORY_KEY, 'not json');
    expect(loadTowerHistory()).toEqual([]);
    localStorage.setItem(TOWER_HISTORY_KEY, '{"nope":1}');
    expect(loadTowerHistory()).toEqual([]);
    localStorage.setItem(TOWER_HISTORY_KEY, '[{"date":"a","players":[]}]');
    expect(loadTowerHistory()).toEqual([]);
  });

  it('clamps and defaults a half-broken row instead of dropping the whole list', () => {
    localStorage.setItem(
      TOWER_HISTORY_KEY,
      JSON.stringify([
        { date: 'a', players: [{ name: 'X', clearFloor: 9999, status: 'nonsense', throws: -4 }] },
      ]),
    );
    const [row] = loadTowerHistory();
    expect(row.players[0].clearFloor).toBe(100);
    expect(row.players[0].status).toBe('playing');
    expect(row.players[0].throws).toBe(0);
    expect(row.rules).toEqual({ startFloor: 1, startLife: 5, continues: 5, recovery: true });
  });

  it('remembers that the first-run help has been shown, under a second key of its own', () => {
    expect(hasSeenTowerHelp()).toBe(false);
    markTowerHelpSeen();
    expect(hasSeenTowerHelp()).toBe(true);
    expect(TOWER_HELP_SEEN_KEY).toBe('n02-practice-tower-help-v1');
    // Clearing the history is not the same as forgetting the help.
    clearTowerHistory();
    expect(hasSeenTowerHelp()).toBe(true);
  });
});

/**
 * The isolation guarantee, asserted rather than assumed: TOWER writes and clears only its own two
 * keys. If any call here ever reached for `localStorage.clear()` or another mode's key, one of
 * these would fail.
 */
describe('TOWER storage isolation', () => {
  const foreign: Array<[string, string]> = [
    [COUNT_UP_HISTORY_KEY, '[{"date":"x","playerCount":1,"bullMode":"fat","players":[{"name":"A"}]}]'],
    [CURRENT_MATCH_KEY, '{"keep":"me"}'],
    [HISTORY_KEY, '[{"keep":"me"}]'],
    [THEME_KEY, 'neon'],
    [PENTATHLON_SESSION_KEY, '{"keep":"me"}'],
    [PENTATHLON_SINGLE_SESSION_KEY, '{"keep":"me"}'],
    [AWARD_DISPLAY_KEY, '{"keep":"me"}'],
  ];

  beforeEach(() => {
    localStorage.clear();
    for (const [key, value] of foreign) localStorage.setItem(key, value);
  });

  function expectForeignUntouched() {
    for (const [key, value] of foreign) {
      expect(localStorage.getItem(key), `${key} was modified by TOWER`).toBe(value);
    }
  }

  it('never touches another mode’s key while recording, updating or removing', () => {
    appendTowerHistory(entry({ date: 'a' }));
    updateTowerHistoryEntry(entry({ date: 'a', playerCount: 2 }));
    removeTowerHistoryEntry('a');
    markTowerHelpSeen();
    expectForeignUntouched();
  });

  it('never touches another mode’s key while clearing its own history', () => {
    appendTowerHistory(entry());
    clearTowerHistory();
    expect(localStorage.getItem(TOWER_HISTORY_KEY)).toBeNull();
    expectForeignUntouched();
  });

  it('reads nothing from another mode’s key', () => {
    // Every foreign key is populated and TOWER's own is not, so anything but [] here would mean it
    // had picked up somebody else's data.
    expect(loadTowerHistory()).toEqual([]);
    expect(hasSeenTowerHelp()).toBe(false);
  });
});
