import { describe, expect, it } from 'vitest';
import {
  applyVisit,
  advanceLeg,
  createX01Match,
  declareDraw,
  editVisit,
  resolveRoundLimit,
  swapCurrentLegScores,
  threeDartAverage,
  undoLastAction,
  type X01Settings,
} from './x01Engine';
import { InvalidVisitError } from './x01Core';

function baseSettings(overrides: Partial<X01Settings> = {}): X01Settings {
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

describe('createX01Match', () => {
  it('starts both players at startScore with player 0 active on leg 1', () => {
    const state = createX01Match(baseSettings());
    expect(state.players[0].remaining).toBe(501);
    expect(state.players[1].remaining).toBe(501);
    expect(state.active).toBe(0);
    expect(state.leg).toBe(1);
    expect(state.legStarter).toBe(0);
  });
});

describe('applyVisit - normal scoring', () => {
  it('subtracts the score and alternates the active player', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 100);
    expect(state.players[0].remaining).toBe(401);
    expect(state.active).toBe(1);
    state = applyVisit(state, 60);
    expect(state.players[1].remaining).toBe(441);
    expect(state.active).toBe(0);
  });

  it('rejects an unreachable 3-dart score', () => {
    const state = createX01Match(baseSettings());
    expect(() => applyVisit(state, 179)).toThrow(InvalidVisitError);
  });

  it('tracks ton bands correctly', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 120); // ton00 band (100-139)
    state = applyVisit(state, 0);
    state = applyVisit(state, 150); // ton40 band (140-179)
    state = applyVisit(state, 0);
    state = applyVisit(state, 180); // ton80
    expect(state.players[0].ton00Count).toBe(1);
    expect(state.players[0].ton40Count).toBe(1);
    expect(state.players[0].ton80Count).toBe(1);
  });
});

describe('applyVisit - bust', () => {
  it('leaves remaining unchanged and still consumes 3 darts', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 180); // P0 -> 321
    state = applyVisit(state, 0);
    state = applyVisit(state, 180); // P0 -> 141
    state = applyVisit(state, 0);
    state = applyVisit(state, 150); // 150 > 141 -> bust
    expect(state.players[0].remaining).toBe(141);
    expect(state.visits[state.visits.length - 1].bust).toBe(true);
    expect(state.players[0].totalDarts).toBe(9);
    expect(state.players[0].totalScored).toBe(360); // bust contributes 0
    expect(state.active).toBe(1); // turn still advances
  });
});

describe('applyVisit - checkout and leg/match completion', () => {
  it('completes a leg on an exact valid double-out finish, and reports darts used', () => {
    let state = createX01Match(baseSettings({ targetLegs: 2 }));
    state = applyVisit(state, 180); // P0 -> 321
    state = applyVisit(state, 26); // P1 -> 475
    state = applyVisit(state, 180); // P0 -> 141
    state = applyVisit(state, 26); // P1 -> 449
    state = applyVisit(state, 141, 3); // P0 finishes with 3 darts
    expect(state.players[0].remaining).toBe(0);
    expect(state.legResult).toEqual({ winner: 0, darts: 9, reason: 'checkout' });
    expect(state.players[0].legs).toBe(1);
    expect(state.players[0].highestFinish).toBe(141);
    expect(state.matchWinner).toBeNull(); // only 1 of 2 legs so far
  });

  it('rejects a finish claim without a valid finishDarts count', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 180);
    state = applyVisit(state, 0);
    state = applyVisit(state, 180);
    state = applyVisit(state, 0); // P0 remaining -> 141
    expect(() => applyVisit(state, 141)).toThrow(InvalidVisitError);
  });

  it('rejects declaring a finish on a bogey (impossible checkout) remaining', () => {
    const state = createX01Match(baseSettings({ startScore: 169 }));
    expect(() => applyVisit(state, 169, 3)).toThrow(InvalidVisitError);
  });

  it('sets matchWinner once targetLegs is reached', () => {
    let state = createX01Match(baseSettings({ targetLegs: 1 }));
    state = applyVisit(state, 180);
    state = applyVisit(state, 26);
    state = applyVisit(state, 180);
    state = applyVisit(state, 26);
    state = applyVisit(state, 141, 3);
    expect(state.matchWinner).toBe(0);
  });

  it('alternates the next leg starter to the loser (checkout winner is not next starter)', () => {
    let state = createX01Match(baseSettings({ targetLegs: 5 }));
    state = applyVisit(state, 180);
    state = applyVisit(state, 26);
    state = applyVisit(state, 180);
    state = applyVisit(state, 26);
    state = applyVisit(state, 141, 3); // P0 wins leg 1
    state = advanceLeg(state);
    expect(state.leg).toBe(2);
    expect(state.legStarter).toBe(1);
    expect(state.active).toBe(1);
    expect(state.players[0].remaining).toBe(501);
  });
});

describe('undoLastAction', () => {
  it('reverts the last visit exactly', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 100);
    const afterOneVisit = state;
    state = applyVisit(state, 60);
    state = undoLastAction(state);
    expect(state.players[0].remaining).toBe(afterOneVisit.players[0].remaining);
    expect(state.players[1].remaining).toBe(501);
    expect(state.active).toBe(1);
    expect(state.visits).toHaveLength(1);
  });

  it('un-finishes a leg that just completed, restoring pre-finish state', () => {
    let state = createX01Match(baseSettings({ targetLegs: 2 }));
    state = applyVisit(state, 180);
    state = applyVisit(state, 26);
    state = applyVisit(state, 180);
    state = applyVisit(state, 26);
    state = applyVisit(state, 141, 3);
    expect(state.legResult).not.toBeNull();
    state = undoLastAction(state);
    expect(state.legResult).toBeNull();
    expect(state.players[0].remaining).toBe(141);
    expect(state.completed).toHaveLength(0);
  });

  it('is a no-op when there is nothing to undo', () => {
    const state = createX01Match(baseSettings());
    expect(undoLastAction(state)).toBe(state);
  });
});

describe('editVisit', () => {
  it('recalculates remaining for all visits after the edited one', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 100); // P0 -> 401
    state = applyVisit(state, 50); // P1 -> 451
    state = applyVisit(state, 100); // P0 -> 301
    state = editVisit(state, 0, 140, 3); // P0's first visit becomes 140 instead of 100
    expect(state.visits[0].score).toBe(140);
    expect(state.visits[0].after).toBe(361); // 501-140
    expect(state.players[0].remaining).toBe(261); // 361 - 100 (second P0 visit unchanged)
  });

  it('regression: preserves prior-leg cumulative stats when editing a visit in leg 2+', () => {
    let state = createX01Match(baseSettings({ targetLegs: 5 }));
    // Leg 1: P0 racks up real stats (a ton80, a ton00, a 9-dart checkout) before winning.
    state = applyVisit(state, 180); // P0 ton80 -> 321
    state = applyVisit(state, 26); // P1 -> 475
    state = applyVisit(state, 180); // P0 ton80 -> 141
    state = applyVisit(state, 26); // P1 -> 449
    state = applyVisit(state, 141, 3); // P0 checks out, 9 darts, highestFinish 141
    state = advanceLeg(state);
    expect(state.leg).toBe(2);
    const p0AfterLeg1 = state.players[0];
    expect(p0AfterLeg1.totalDarts).toBe(9);
    expect(p0AfterLeg1.ton80Count).toBe(2);
    expect(p0AfterLeg1.checkouts).toBe(1);
    expect(p0AfterLeg1.highestFinish).toBe(141);

    // Leg 2: P0 throws once, then that visit gets corrected.
    expect(state.legStarter).toBe(1); // loser-of-leg1 (P0 won, so P1 starts leg 2 - see advanceLeg test)
    state = applyVisit(state, 60); // P1's leg-2 visit -> 441
    state = applyVisit(state, 100); // P0's leg-2 visit -> 401
    state = editVisit(state, state.visits.length - 1, 140, 3); // correct P0's leg-2 visit to 140

    // Leg 1's contribution must survive untouched.
    expect(state.players[0].totalDarts).toBe(9 + 3);
    expect(state.players[0].ton80Count).toBe(2);
    expect(state.players[0].checkouts).toBe(1);
    expect(state.players[0].highestFinish).toBe(141);
    expect(state.players[0].legs).toBe(1);
    // And the leg-2 edit itself took effect.
    expect(state.players[0].remaining).toBe(361); // 501 - 140
  });
});

describe('resolveRoundLimit / declareDraw', () => {
  it('resolves a round-limit leg with a manually chosen winner', () => {
    let state = createX01Match(baseSettings({ mode: 'checkout', roundLimit: true, maxRounds: 1, checkoutMin: 100, checkoutMax: 100, targetLegs: 3 }));
    state = applyVisit(state, 10); // P0 misses target, 1 round played
    state = applyVisit(state, 10); // P1 misses target, 1 round played -> round limit reached
    expect(state.legResult?.reason).toBe('round-limit');
    state = resolveRoundLimit(state, 0);
    expect(state.players[0].legs).toBe(1);
    expect(state.legResult?.winner).toBe(0);
  });

  it('declareDraw ends the leg without awarding a leg win to either player', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 50);
    state = declareDraw(state);
    expect(state.legResult).toEqual({ winner: null, darts: 0, reason: 'draw' });
    expect(state.players[0].legs).toBe(0);
    expect(state.players[1].legs).toBe(0);
  });
});

describe('swapCurrentLegScores', () => {
  it('swaps which player owns the current leg progress while keeping names in place', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 100); // P0 -> 401
    const beforeSwapNameP0 = state.players[0].name;
    state = swapCurrentLegScores(state);
    expect(state.players[0].name).toBe(beforeSwapNameP0);
    expect(state.players[0].remaining).toBe(501); // now holds what was P1's remaining
    expect(state.players[1].remaining).toBe(401); // now holds what was P0's remaining
  });
});

describe('threeDartAverage', () => {
  it('computes (totalScored / totalDarts) * 3', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 180);
    state = applyVisit(state, 0);
    state = applyVisit(state, 100);
    expect(threeDartAverage(state.players[0])).toBeCloseTo(140, 5);
  });
});
