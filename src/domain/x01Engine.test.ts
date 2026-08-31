import { describe, expect, it } from 'vitest';
import {
  applyVisit,
  advanceLeg,
  createX01Match,
  declareDraw,
  editVisit,
  resolveRoundLimit,
  resumePreviousLeg,
  setLegStarter,
  swapCurrentLegScores,
  threeDartAverage,
  undoLastAction,
  type X01MatchState,
  type X01Settings,
} from './x01Engine';
import { InvalidVisitError, resolveVisit } from './x01Core';

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

  it('applies a per-player handicap start in 01 mode', () => {
    const state = createX01Match(
      baseSettings({ handicapEnabled: [false, true], handicapScores: [501, 301] }),
    );
    expect(state.playerStartScores).toEqual([501, 301]);
  });
});

describe('checkout practice - shared challenge score', () => {
  const checkoutSettings = (overrides: Partial<X01Settings> = {}) =>
    baseSettings({ mode: 'checkout', checkoutMin: 41, checkoutMax: 170, ...overrides });

  it('starts both players from the identical challenge score', () => {
    // Drawn at random, so assert over many matches rather than a single lucky one.
    for (let i = 0; i < 200; i += 1) {
      const state = createX01Match(checkoutSettings());
      expect(state.players[0].remaining).toBe(state.players[1].remaining);
      expect(state.playerStartScores[0]).toBe(state.playerStartScores[1]);
      expect(state.startScore).toBe(state.playerStartScores[0]);
    }
  });

  it('keeps the same challenge score for both players across a turn hand-off', () => {
    let state = createX01Match(checkoutSettings({ checkoutMin: 100, checkoutMax: 100 }));
    expect(state.playerStartScores).toEqual([100, 100]);
    state = applyVisit(state, 20); // player 0 throws, hand-off to player 1
    expect(state.active).toBe(1);
    expect(state.startScore).toBe(100);
    expect(state.playerStartScores).toEqual([100, 100]);
    expect(state.players[1].remaining).toBe(100);
  });

  it('draws one new shared challenge score for the next leg', () => {
    let state = createX01Match(checkoutSettings({ checkoutMin: 40, checkoutMax: 60, targetLegs: 3 }));
    const first = state.startScore;
    state = applyVisit(state, 0);
    state = applyVisit(state, state.players[1].remaining, 2); // player 1 checks out
    state = advanceLeg(state);
    expect(state.leg).toBe(2);
    expect(state.playerStartScores[0]).toBe(state.playerStartScores[1]);
    expect(state.players[0].remaining).toBe(state.players[1].remaining);
    expect(state.startScore).toBe(state.playerStartScores[0]);
    expect(state.startScore).not.toBe(first); // the range holds >1 candidate, so it must change
  });

  it('never draws a number that cannot be checked out', () => {
    // 159/162/163/165/166/168/169 are bogey numbers: reachable as a remaining, impossible to finish.
    const bogey = new Set([159, 162, 163, 165, 166, 168, 169]);
    for (let i = 0; i < 400; i += 1) {
      const state = createX01Match(checkoutSettings({ checkoutMin: 155, checkoutMax: 170 }));
      expect(bogey.has(state.startScore)).toBe(false);
    }
  });

  it('ignores 01 handicaps so the challenge stays identical for both players', () => {
    const state = createX01Match(
      checkoutSettings({ handicapEnabled: [true, false], handicapScores: [301, 501] }),
    );
    expect(state.playerStartScores[0]).toBe(state.playerStartScores[1]);
  });

  it('falls back to a single-candidate range without getting stuck', () => {
    let state = createX01Match(checkoutSettings({ checkoutMin: 40, checkoutMax: 40, targetLegs: 3 }));
    expect(state.startScore).toBe(40);
    state = applyVisit(state, 40, 1); // player 0 checks out
    state = advanceLeg(state);
    expect(state.startScore).toBe(40);
    expect(state.playerStartScores).toEqual([40, 40]);
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

  it.each([
    [32, 31],
    [2, 1],
  ])('busts a visit from %i when %i would leave exactly 1', (remaining, score) => {
    let state = createX01Match(baseSettings({ startScore: remaining }));
    state = applyVisit(state, score);
    expect(state.players[0].remaining).toBe(remaining);
    expect(state.visits[0]).toMatchObject({ before: remaining, after: remaining, bust: true, darts: 3 });
    expect(state.active).toBe(1);
  });

  it('uses the same leave-1 bust rule in checkout practice', () => {
    let state = createX01Match(
      baseSettings({ mode: 'checkout', checkoutMin: 32, checkoutMax: 32 }),
    );
    state = applyVisit(state, 31);
    expect(state.players[0].remaining).toBe(32);
    expect(state.visits[0].bust).toBe(true);
  });
});

describe('resolveVisit - shared X01 boundaries', () => {
  it('keeps the visit start on an overscore and accepts an exact checkout', () => {
    expect(resolveVisit(20, 25)).toEqual({ after: 20, bust: true, checkout: false, darts: 3 });
    expect(resolveVisit(40, 40, 1)).toEqual({ after: 0, bust: false, checkout: true, darts: 1 });
  });

  it.each([0, 25, 50, 60, 170])('accepts reachable non-finishing score %i', (score) => {
    expect(resolveVisit(501, score)).toEqual({
      after: 501 - score,
      bust: false,
      checkout: false,
      darts: 3,
    });
  });

  it('rejects unreachable 179', () => {
    expect(() => resolveVisit(501, 179)).toThrow(InvalidVisitError);
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

  it('hands the throw to the other player for the next leg', () => {
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

  it('regression: 交互先攻 - the leg winner never affects who starts the next leg', () => {
    // P0 wins leg after leg. The throw must still change hands every single leg: 0,1,0,1,0.
    let state = createX01Match(baseSettings({ targetLegs: 0 }));
    const starters: Array<0 | 1> = [state.legStarter];
    for (let leg = 1; leg <= 4; leg += 1) {
      // Whoever is not P0 opens or answers; P0 checks out from 501 in three visits either way.
      while (state.legResult === null) {
        state = state.active === 0 ? winLegAsP0(state) : applyVisit(state, 26);
      }
      expect(state.legResult.winner).toBe(0); // P0 keeps winning
      state = advanceLeg(state);
      starters.push(state.legStarter);
    }
    expect(starters).toEqual([0, 1, 0, 1, 0]);
    expect(state.players[0].legs).toBe(4);
    expect(state.players[1].legs).toBe(0);
  });

  it('regression: a drawn leg alternates the starter the same way', () => {
    let state = createX01Match(baseSettings({ targetLegs: 0 }));
    expect(state.legStarter).toBe(0);
    state = applyVisit(state, 60);
    state = declareDraw(state);
    state = advanceLeg(state);
    expect(state.legStarter).toBe(1);
    expect(state.active).toBe(1);
  });
});

/** Drives P0 from 501 to a checkout, leaving P1's visits to the caller. */
function winLegAsP0(state: X01MatchState): X01MatchState {
  let next = applyVisit(state, 180); // 321
  if (next.active === 1) next = applyVisit(next, 26);
  next = applyVisit(next, 180); // 141
  if (next.active === 1) next = applyVisit(next, 26);
  return applyVisit(next, 141, 3);
}

describe('setLegStarter', () => {
  it('swaps who throws first while the leg is still untouched', () => {
    let state = createX01Match(baseSettings());
    expect(state.legStarter).toBe(0);
    state = setLegStarter(state, 1);
    expect(state.legStarter).toBe(1);
    expect(state.active).toBe(1);
    // Tapping again puts it back - the gesture is a toggle.
    state = setLegStarter(state, 0);
    expect(state.legStarter).toBe(0);
    expect(state.active).toBe(0);
  });

  it('is a no-op once a visit has been entered', () => {
    let state = createX01Match(baseSettings());
    state = applyVisit(state, 100);
    const before = state;
    state = setLegStarter(state, 0);
    expect(state).toBe(before);
  });

  it('is a no-op while a leg result is on screen', () => {
    let state = createX01Match(baseSettings({ targetLegs: 0 }));
    state = applyVisit(state, 60);
    state = declareDraw(state);
    const before = state;
    expect(setLegStarter(state, 1)).toBe(before);
  });

  it('leaves per-player scores where they are (it is not swapCurrentLegScores)', () => {
    let state = createX01Match(baseSettings({ handicapEnabled: [true, false], handicapScores: [301, 501] }));
    expect(state.players[0].remaining).toBe(301);
    state = setLegStarter(state, 1);
    expect(state.players[0].remaining).toBe(301);
    expect(state.players[1].remaining).toBe(501);
  });

  it('makes the swapped order the new origin of the alternation', () => {
    let state = createX01Match(baseSettings({ targetLegs: 0 }));
    state = setLegStarter(state, 1); // P1 now opens leg 1
    state = applyVisit(state, 60); // P1 throws first
    expect(state.visits[0].player).toBe(1);
    state = declareDraw(state);
    state = advanceLeg(state);
    expect(state.legStarter).toBe(0); // leg 2 alternates from the swapped order, not from P0
    state = declareDraw(state);
    state = advanceLeg(state);
    expect(state.legStarter).toBe(1);
  });
});

describe('resumePreviousLeg', () => {
  it('rewinds to the state just before the winning visit and un-awards the leg', () => {
    let state = createX01Match(baseSettings({ targetLegs: 5 }));
    state = applyVisit(state, 180); // P0 -> 321
    state = applyVisit(state, 26); // P1 -> 475
    state = applyVisit(state, 180); // P0 -> 141
    state = applyVisit(state, 26); // P1 -> 449
    state = applyVisit(state, 141, 3); // P0 checks out
    state = advanceLeg(state);
    expect(state.leg).toBe(2);
    expect(state.players[0].legs).toBe(1);

    state = resumePreviousLeg(state);
    expect(state.leg).toBe(1);
    expect(state.legResult).toBeNull();
    expect(state.matchWinner).toBeNull();
    expect(state.completed).toHaveLength(0);
    expect(state.players[0].legs).toBe(0);
    expect(state.players[0].remaining).toBe(141); // back on the checkout, before taking it
    expect(state.players[0].checkouts).toBe(0);
    expect(state.players[0].highestFinish).toBe(0);
    expect(state.active).toBe(0);
  });

  it('is a no-op with no completed leg to go back to', () => {
    const state = createX01Match(baseSettings());
    expect(resumePreviousLeg(state)).toBe(state);
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

  it('replays an edited visit that would leave 1 as a bust', () => {
    let state = createX01Match(baseSettings({ startScore: 32 }));
    state = applyVisit(state, 0);
    state = editVisit(state, 0, 31, 3);
    expect(state.players[0].remaining).toBe(32);
    expect(state.visits[0]).toMatchObject({ before: 32, after: 32, bust: true });
  });

  it('busts an untouched later visit when an earlier correction makes it leave 1', () => {
    let state = createX01Match(baseSettings({ startScore: 100 }));
    state = applyVisit(state, 40); // P0: 60
    state = applyVisit(state, 0); // P1
    state = applyVisit(state, 40); // P0: 20
    state = editVisit(state, 0, 59, 3); // P0: 41, then the later 40 must bust
    expect(state.players[0].remaining).toBe(41);
    expect(state.visits[2]).toMatchObject({ before: 41, after: 41, bust: true });
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
    expect(state.legStarter).toBe(1); // 交互先攻: P0 opened leg 1, so P1 opens leg 2
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
