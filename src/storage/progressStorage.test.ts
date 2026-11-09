import { beforeEach, describe, expect, it } from 'vitest';
import { applyVisit, createX01Match } from '../domain/x01Engine';
import { applyRoundScore, createCountUpGame, defaultCountUpSettings } from '../domain/practice/countUp';
import { advanceTurn, applyThrow, createTowerGame, defaultTowerSettings } from '../domain/practice/tower';
import {
  CURRENT_CHECKOUT_MATCH_KEY,
  CURRENT_MATCH_KEY,
  clearCurrentMatch,
  defaultSettings,
  isUntouchedMatch,
  loadCurrentMatch,
  saveCurrentMatch,
} from './matchStorage';
import {
  COUNT_UP_HISTORY_KEY,
  COUNT_UP_PROGRESS_KEY,
  clearCountUpProgress,
  loadCountUpProgress,
  saveCountUpProgress,
} from './practiceStorage';
import {
  TOWER_HISTORY_KEY,
  TOWER_PROGRESS_KEY,
  clearTowerProgress,
  loadTowerProgress,
  saveTowerProgress,
} from './towerStorage';

/**
 * The saves behind 「途中経過を保存する」 and 「前回の途中から始めますか？」.
 */

beforeEach(() => {
  localStorage.clear();
});

describe('通常01・チェックアウト練習 saved matches', () => {
  const x01 = () => createX01Match(defaultSettings());
  const checkout = () => createX01Match({ ...defaultSettings(), mode: 'checkout', targetLegs: 0 });

  it('keeps one slot per mode, so saving one never replaces the other', () => {
    saveCurrentMatch(applyVisit(x01(), 100));
    saveCurrentMatch(checkout());

    expect(loadCurrentMatch('01')?.settings.mode).toBe('01');
    expect(loadCurrentMatch('01')?.visits).toHaveLength(1);
    expect(loadCurrentMatch('checkout')?.settings.mode).toBe('checkout');
    expect(localStorage.getItem(CURRENT_CHECKOUT_MATCH_KEY)).not.toBeNull();

    clearCurrentMatch('checkout');
    expect(loadCurrentMatch('checkout')).toBeNull();
    expect(loadCurrentMatch('01')).not.toBeNull();
  });

  it('moves a checkout match saved in the shared slot (before the split) to its own slot', () => {
    localStorage.setItem(CURRENT_MATCH_KEY, JSON.stringify(checkout()));

    expect(loadCurrentMatch('01')).toBeNull();
    expect(localStorage.getItem(CURRENT_MATCH_KEY)).toBeNull();
    expect(loadCurrentMatch('checkout')?.settings.mode).toBe('checkout');
  });

  it('leaves a 01 match in the pre-existing slot exactly where it was', () => {
    const raw = JSON.stringify(x01());
    localStorage.setItem(CURRENT_MATCH_KEY, raw);

    expect(loadCurrentMatch('checkout')).toBeNull();
    expect(loadCurrentMatch('01')).not.toBeNull();
    expect(localStorage.getItem(CURRENT_MATCH_KEY)).toBe(raw);
  });

  it('treats only a match with nothing thrown yet as untouched', () => {
    const fresh = x01();
    expect(isUntouchedMatch(fresh)).toBe(true);
    // A score of 0 is still an entry.
    expect(isUntouchedMatch(applyVisit(fresh, 0))).toBe(false);
  });
});

describe('COUNT-UP saved progress', () => {
  const game = () => applyRoundScore(createCountUpGame({ ...defaultCountUpSettings(), playerCount: 2 }), 60);

  it('round-trips a game in progress under its own key only', () => {
    saveCountUpProgress(game());
    expect(loadCountUpProgress()).toEqual(game());
    expect(localStorage.getItem(COUNT_UP_HISTORY_KEY)).toBeNull();

    clearCountUpProgress();
    expect(localStorage.getItem(COUNT_UP_PROGRESS_KEY)).toBeNull();
    expect(loadCountUpProgress()).toBeNull();
  });

  it('refuses a value that cannot be played on', () => {
    for (const bad of [
      '{',
      'null',
      JSON.stringify({ ...game(), players: [] }),
      JSON.stringify({ ...game(), players: [{ name: 'A', scores: [181] }, { name: 'B', scores: [] }] }),
      // Player 2 cannot be ahead of player 1.
      JSON.stringify({ ...game(), players: [{ name: 'A', scores: [] }, { name: 'B', scores: [60] }] }),
    ]) {
      localStorage.setItem(COUNT_UP_PROGRESS_KEY, bad);
      expect(loadCountUpProgress()).toBeNull();
    }
  });

  it('does not offer a finished game as progress', () => {
    let finished = createCountUpGame(defaultCountUpSettings());
    for (let round = 0; round < 8; round += 1) finished = applyRoundScore(finished, 60);
    saveCountUpProgress(finished);
    expect(loadCountUpProgress()).toBeNull();
  });
});

describe('TOWER saved progress', () => {
  const climb = () => {
    let state = createTowerGame({ ...defaultTowerSettings(), playerCount: 2 });
    state = applyThrow(state, 'hit');
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'hit');
    return advanceTurn(state);
  };

  it('round-trips a climb in progress, undo stack included, under its own key only', () => {
    const state = climb();
    saveTowerProgress(state);
    const loaded = loadTowerProgress();
    expect(loaded).toEqual(state);
    expect(loaded?.undoStack.length).toBe(state.undoStack.length);
    expect(localStorage.getItem(TOWER_HISTORY_KEY)).toBeNull();

    clearTowerProgress();
    expect(localStorage.getItem(TOWER_PROGRESS_KEY)).toBeNull();
  });

  it('refuses a climb from another course revision or with broken fields', () => {
    const state = climb();
    for (const bad of [
      { ...state, courseId: 'some-older-course' },
      { ...state, phase: 'result' },
      { ...state, activePlayerIndex: 3 },
      { ...state, players: [] },
      { ...state, rules: { ...state.rules, startLife: 99 } },
      { ...state, history: 'nope' },
    ]) {
      localStorage.setItem(TOWER_PROGRESS_KEY, JSON.stringify(bad));
      expect(loadTowerProgress()).toBeNull();
    }
    localStorage.setItem(TOWER_PROGRESS_KEY, '{');
    expect(loadTowerProgress()).toBeNull();
  });
});
