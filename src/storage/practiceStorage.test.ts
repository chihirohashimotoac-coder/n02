import { beforeEach, describe, expect, it } from 'vitest';
import {
  COUNT_UP_HISTORY_KEY,
  COUNT_UP_HISTORY_LIMIT,
  appendCountUpHistory,
  clearCountUpHistory,
  loadCountUpHistory,
  updateCountUpHistoryEntry,
  type CountUpHistoryEntry,
} from './practiceStorage';
import { CURRENT_MATCH_KEY, HISTORY_KEY, THEME_KEY } from './matchStorage';
import { PENTATHLON_SESSION_KEY, PENTATHLON_SINGLE_SESSION_KEY } from './pentathlonStorage';
import { emptyAwardCounts } from '../domain/practice/countUp';

function entry(patch: Partial<CountUpHistoryEntry> = {}): CountUpHistoryEntry {
  return {
    date: '2026-01-01T00:00:00.000Z',
    playerCount: 1,
    bullMode: 'separate',
    players: [
      {
        name: 'PLAYER 1',
        total: 640,
        ppr: 80,
        awards: { ...emptyAwardCounts(), LOW_TON: 2 },
        roundScores: [60, 100, 80, 120, 40, 140, 50, 50],
      },
    ],
    ...patch,
  };
}

describe('COUNT-UP history storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses its own key and starts empty', () => {
    expect(COUNT_UP_HISTORY_KEY).toBe('n02-practice-countup-history-v1');
    expect(loadCountUpHistory()).toEqual([]);
  });

  it('stores a completed game and reads it back', () => {
    appendCountUpHistory(entry());
    const stored = loadCountUpHistory();
    expect(stored).toHaveLength(1);
    expect(stored[0].players[0].total).toBe(640);
    expect(stored[0].players[0].roundScores).toHaveLength(8);
  });

  it('keeps a 2-player game as a single entry holding both players', () => {
    appendCountUpHistory(
      entry({
        playerCount: 2,
        bullMode: 'fat',
        players: [
          { name: 'A', total: 500, ppr: 62.5, awards: emptyAwardCounts(), roundScores: [] },
          { name: 'B', total: 400, ppr: 50, awards: emptyAwardCounts(), roundScores: [] },
        ],
      }),
    );
    const stored = loadCountUpHistory();
    expect(stored).toHaveLength(1);
    expect(stored[0].players.map((player) => player.name)).toEqual(['A', 'B']);
    expect(stored[0].bullMode).toBe('fat');
  });

  it('keeps at most 10 entries, newest first', () => {
    for (let index = 0; index < 14; index += 1) {
      appendCountUpHistory(entry({ date: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z` }));
    }
    const stored = loadCountUpHistory();
    expect(stored).toHaveLength(COUNT_UP_HISTORY_LIMIT);
    expect(stored[0].date).toBe('2026-01-01T00:00:13.000Z');
    expect(stored[9].date).toBe('2026-01-01T00:00:04.000Z');
  });

  it('replaces the matching entry in place when a finished game is corrected', () => {
    appendCountUpHistory(entry({ date: 'a' }));
    appendCountUpHistory(entry({ date: 'b' }));
    updateCountUpHistoryEntry(entry({ date: 'b', players: [{ ...entry().players[0], total: 700 }] }));
    const stored = loadCountUpHistory();
    expect(stored).toHaveLength(2);
    expect(stored[0].players[0].total).toBe(700);
    expect(stored[1].date).toBe('a');
  });

  it('corrects its own entry, not whatever another tab recorded in the meantime', () => {
    appendCountUpHistory(entry({ date: 'mine' }));
    // Another tab finishes its own COUNT-UP: it, not this game, is now the newest entry.
    appendCountUpHistory(entry({ date: 'other-tab', players: [{ ...entry().players[0], name: 'OTHER' }] }));

    updateCountUpHistoryEntry(entry({ date: 'mine', players: [{ ...entry().players[0], total: 700 }] }));

    const stored = loadCountUpHistory();
    expect(stored).toHaveLength(2);
    expect(stored[0].date).toBe('other-tab');
    expect(stored[0].players[0].name).toBe('OTHER'); // the other tab's result survives
    expect(stored[1].date).toBe('mine');
    expect(stored[1].players[0].total).toBe(700); // and this game is the one corrected
  });

  it('leaves the list untouched when the corrected game has fallen past the cap', () => {
    for (let index = 0; index < COUNT_UP_HISTORY_LIMIT; index += 1) {
      appendCountUpHistory(entry({ date: `newer-${index}` }));
    }
    const before = localStorage.getItem(COUNT_UP_HISTORY_KEY);

    updateCountUpHistoryEntry(entry({ date: 'evicted', players: [{ ...entry().players[0], total: 700 }] }));

    expect(localStorage.getItem(COUNT_UP_HISTORY_KEY)).toBe(before);
    expect(loadCountUpHistory()).toHaveLength(COUNT_UP_HISTORY_LIMIT);
  });

  it('survives corrupted JSON', () => {
    localStorage.setItem(COUNT_UP_HISTORY_KEY, '{not json');
    expect(loadCountUpHistory()).toEqual([]);
  });

  it('survives values of the wrong shape', () => {
    for (const raw of ['null', '{}', '"text"', '42', '[null, 3, "x"]', '[{"date":1}]', '[{"players":[]}]']) {
      localStorage.setItem(COUNT_UP_HISTORY_KEY, raw);
      expect(loadCountUpHistory()).toEqual([]);
    }
  });

  it('drops malformed rows but keeps the good ones, and repairs missing fields', () => {
    localStorage.setItem(
      COUNT_UP_HISTORY_KEY,
      JSON.stringify([
        { date: 'x', players: [{ name: 'A' }] },
        null,
        { nope: true },
        entry({ date: 'y' }),
      ]),
    );
    const stored = loadCountUpHistory();
    expect(stored).toHaveLength(2);
    expect(stored[0].players[0]).toEqual({
      name: 'A',
      total: 0,
      ppr: 0,
      awards: emptyAwardCounts(),
      roundScores: [],
    });
    expect(stored[0].playerCount).toBe(1);
    expect(stored[0].bullMode).toBe('separate');
    expect(stored[1].date).toBe('y');
  });

  it('discards round scores that are not valid COUNT-UP values', () => {
    localStorage.setItem(
      COUNT_UP_HISTORY_KEY,
      JSON.stringify([{ ...entry(), players: [{ ...entry().players[0], roundScores: [60, 181, -1, 'x', 70.5, 180] }] }]),
    );
    expect(loadCountUpHistory()[0].players[0].roundScores).toEqual([60, 180]);
  });

  it('never reads or writes the pre-existing n02 storage keys', () => {
    localStorage.setItem(CURRENT_MATCH_KEY, '{"keep":1}');
    localStorage.setItem(HISTORY_KEY, '[{"keep":2}]');
    localStorage.setItem(THEME_KEY, 'neon');
    localStorage.setItem(PENTATHLON_SESSION_KEY, '{"keep":3}');
    localStorage.setItem(PENTATHLON_SINGLE_SESSION_KEY, '{"keep":4}');

    appendCountUpHistory(entry());
    updateCountUpHistoryEntry(entry({ date: 'z' }));
    loadCountUpHistory();
    clearCountUpHistory();

    expect(localStorage.getItem(CURRENT_MATCH_KEY)).toBe('{"keep":1}');
    expect(localStorage.getItem(HISTORY_KEY)).toBe('[{"keep":2}]');
    expect(localStorage.getItem(THEME_KEY)).toBe('neon');
    expect(localStorage.getItem(PENTATHLON_SESSION_KEY)).toBe('{"keep":3}');
    expect(localStorage.getItem(PENTATHLON_SINGLE_SESSION_KEY)).toBe('{"keep":4}');
    expect(localStorage.getItem(COUNT_UP_HISTORY_KEY)).toBeNull();
  });
});
