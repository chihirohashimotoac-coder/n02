import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  advanceLeg,
  applyVisit,
  createX01Match,
  editVisit,
  maybePlayComTurn,
  resumePreviousLeg,
  swapCurrentLegScores,
  undoLastAction,
  type X01MatchState,
  type X01Settings,
} from '../../domain/x01Engine';
import {
  applyTurn,
  createPentathlonSession,
  editVisitScore,
  undoRound,
} from '../../domain/pentathlon/session';
import type { X01SoloState } from '../../domain/pentathlon/engines/x01Solo';
import type { PentathlonSession } from '../../domain/pentathlon/types';
import { detectPentathlonX01Roll, detectX01Roll, reelColumns, useRemainingRolls } from './remainingRoll';

/**
 * The remaining-score roll is display-only, so what these pin is the boundary: which state changes
 * count as an ordinary commit (and for whom), and that every column lands on the official value.
 */

function settings(overrides: Partial<X01Settings> = {}): X01Settings {
  return {
    mode: '01',
    startScore: 501,
    checkoutMin: 41,
    checkoutMax: 170,
    targetLegs: 2,
    showRoute: false,
    names: ['プレイヤー1', 'プレイヤー2'],
    roundLimit: false,
    maxRounds: 15,
    comEnabled: [false, false],
    comLevels: [5, 5],
    handicapEnabled: [false, false],
    handicapScores: [501, 501],
    ...overrides,
  };
}

function play(state: X01MatchState, ...scores: number[]): X01MatchState {
  return scores.reduce((current, score) => applyVisit(current, score), state);
}

/** What each column shows once it has landed: the top line of its reel. */
function landed(from: number, to: number): string {
  return reelColumns(from, to)
    .map((column) => column.reel.split('\n')[0])
    .join('');
}

describe('reelColumns', () => {
  it.each([
    [501, 401],
    [501, 321],
    [180, 80],
    [1101, 921],
    [40, 0],
    [121, 61],
    [100, 1],
  ])('%i → %i lands on exactly the new value, with no leading zero', (from, to) => {
    expect(landed(from, to)).toBe(String(to));
    expect(reelColumns(from, to)).toHaveLength(String(to).length);
  });

  it('starts every column on the digit it had, counting down to the new one', () => {
    for (const [from, to] of [
      [501, 401],
      [1101, 921],
      [180, 80],
    ]) {
      const source = String(from).slice(-String(to).length);
      reelColumns(from, to).forEach((column, index) => {
        const lines = column.reel.split('\n');
        expect(lines).toHaveLength(column.steps + 1);
        // Bottom line is where the column starts, top line is where it lands.
        expect(lines[lines.length - 1]).toBe(source[index]);
        expect(lines[0]).toBe(String(to)[index]);
        // Read bottom to top, each line is one less than the line below it.
        for (let line = lines.length - 1; line > 0; line -= 1) {
          expect(Number(lines[line - 1])).toBe((Number(lines[line]) + 9) % 10);
        }
      });
    }
  });

  it('turns an unchanged digit as well, and never more than a short way', () => {
    // 501 → 401: the 0 and the 1 do not change, and still turn with the 5.
    for (const column of reelColumns(501, 401)) {
      expect(column.steps).toBeGreaterThanOrEqual(10);
      expect(column.steps).toBeLessThanOrEqual(19);
    }
  });
});

describe('detectX01Roll', () => {
  const start = createX01Match(settings());

  it('rolls the player who threw, not the one up next', () => {
    const next = applyVisit(start, 100);
    expect(next.active).toBe(1);
    expect(detectX01Roll(start, next)).toEqual({ player: 0, from: 501, to: 401 });
    const after = applyVisit(next, 180);
    expect(detectX01Roll(next, after)).toEqual({ player: 1, from: 501, to: 321 });
  });

  it('rolls a checkout down to 0', () => {
    const before = play(start, 180, 0, 180, 0, 100, 0);
    const checkout = applyVisit(before, 41, 2);
    expect(checkout.legResult).not.toBeNull();
    expect(detectX01Roll(before, checkout)).toEqual({ player: 0, from: 41, to: 0 });
  });

  it('rolls a COM visit exactly as a typed one', () => {
    const com = createX01Match(settings({ comEnabled: [false, true] }));
    const waiting = applyVisit(com, 60);
    const next = maybePlayComTurn(waiting);
    const visit = next.visits[next.visits.length - 1];
    const roll = detectX01Roll(waiting, next);
    if (visit.after === visit.before) expect(roll).toBeNull();
    else expect(roll).toEqual({ player: 1, from: visit.before, to: visit.after });
  });

  it('does not roll a 0 or a bust: the remaining did not move', () => {
    expect(detectX01Roll(start, applyVisit(start, 0))).toBeNull();
    const onFifty = play(start, 180, 0, 180, 0, 91, 0);
    const bust = applyVisit(onFifty, 60);
    expect(bust.visits[bust.visits.length - 1].bust).toBe(true);
    expect(detectX01Roll(onFifty, bust)).toBeNull();
  });

  it('never mistakes a correction for a commit, even when a remaining goes down', () => {
    const played = play(start, 60, 60, 60);
    // Undo, a past-score correction that lowers the remaining, a swap.
    expect(detectX01Roll(played, undoLastAction(played))).toBeNull();
    const corrected = editVisit(played, 0, 140, 3);
    expect(corrected.players[0].remaining).toBeLessThan(played.players[0].remaining);
    expect(detectX01Roll(played, corrected)).toBeNull();
    expect(detectX01Roll(played, swapCurrentLegScores(played))).toBeNull();
  });

  it('shows a new leg, a rewound leg and a restored save at once', () => {
    const before = play(start, 180, 0, 180, 0, 100, 0);
    const finished = applyVisit(before, 41, 2);
    const nextLeg = advanceLeg(finished);
    expect(detectX01Roll(finished, nextLeg)).toBeNull();
    const played = applyVisit(nextLeg, 100);
    expect(detectX01Roll(nextLeg, played)).not.toBeNull();
    // 前のLegをやり直す: back to leg 1 with one visit more than leg 2 has.
    const rewound = resumePreviousLeg(played);
    expect(rewound.visits.length).toBeGreaterThan(played.visits.length);
    expect(detectX01Roll(played, rewound)).toBeNull();
    // A save read back from storage is a different object with the same content.
    const restored = JSON.parse(JSON.stringify(played)) as X01MatchState;
    expect(detectX01Roll(played, restored)).toBeNull();
  });

  it('does not write anything into the state', () => {
    const next = applyVisit(start, 100);
    const snapshot = JSON.stringify(next);
    detectX01Roll(start, next);
    expect(JSON.stringify(next)).toBe(snapshot);
  });
});

describe('detectPentathlonX01Roll', () => {
  function session(playerCount: 1 | 2): PentathlonSession {
    return createPentathlonSession({
      preset: 'jda',
      playerCount,
      names: ['A', 'B'],
      starterMode: 'loser',
      initialStarter: 0,
    });
  }
  const remaining = (value: PentathlonSession, player: 0 | 1) =>
    (value.current!.progress[player].state as X01SoloState).remaining;

  it('rolls the player who threw in a two-player discipline', () => {
    const start = session(2);
    const first = applyTurn(start, { score: 100 });
    expect(first.current!.active).toBe(1);
    expect(detectPentathlonX01Roll(start, first)).toEqual({ player: 0, from: 501, to: 401 });
    const second = applyTurn(first, { score: 180 });
    expect(detectPentathlonX01Roll(first, second)).toEqual({ player: 1, from: 501, to: 321 });
  });

  it('rolls the single player of a one-player discipline', () => {
    const start = session(1);
    const next = applyTurn(start, { score: 140 });
    expect(detectPentathlonX01Roll(start, next)).toEqual({ player: 0, from: 501, to: 361 });
  });

  it('does not roll a 0, an undo or a correction', () => {
    const start = session(2);
    expect(detectPentathlonX01Roll(start, applyTurn(start, { score: 0 }))).toBeNull();
    const played = applyTurn(applyTurn(start, { score: 60 }), { score: 60 });
    expect(detectPentathlonX01Roll(played, undoRound(played))).toBeNull();
    const corrected = editVisitScore(played, 0, 0, 140, 3);
    expect(remaining(corrected, 0)).toBeLessThan(remaining(played, 0));
    expect(detectPentathlonX01Roll(played, corrected)).toBeNull();
  });
});

describe('useRemainingRolls', () => {
  it('keeps a running roll for the other player and clears both on anything but a commit', () => {
    const start = createX01Match(settings());
    const first = applyVisit(start, 100);
    const second = applyVisit(first, 180);
    const { result, rerender } = renderHook(({ state }) => useRemainingRolls(state, detectX01Roll), {
      initialProps: { state: start },
    });
    expect(result.current).toEqual([null, null]);

    rerender({ state: first });
    const [roll0] = result.current;
    expect(roll0).toEqual({ player: 0, from: 501, to: 401 });

    rerender({ state: second });
    expect(result.current[0]).toBe(roll0);
    expect(result.current[1]).toEqual({ player: 1, from: 501, to: 321 });

    // A re-render with the same state keeps the same roll objects, so nothing restarts.
    const held = result.current;
    rerender({ state: second });
    expect(result.current[0]).toBe(held[0]);
    expect(result.current[1]).toBe(held[1]);

    rerender({ state: undoLastAction(second) });
    expect(result.current).toEqual([null, null]);
  });
});
