import { describe, expect, it } from 'vitest';
import type { DartHit } from '../../darts';
import { HALF_IT_START_SCORE, HALF_IT_TARGETS, halfItDartValue, halfItEngine } from './halfIt';
import { createRtcDoublesEngine, RTC_TARGET_COUNT, rtcAdvances, rtcTargetLabel } from './rtcDoubles';
import { GOLF_HOLES, golfEngine, golfStrokes } from './golf';
import { corkEngine, corkProximity } from './cork';
import { BASEBALL_INNINGS, baseballEngine, baseballRuns } from './baseball';
import { CRICKET_ROUND_LIMIT, allCricketClosed, cricketEngine, cricketMarks } from './cricket';
import { createX01SoloEngine } from './x01Solo';

const S = (value: number): DartHit => ({ kind: 'number', value, ring: 'single' });
const D = (value: number): DartHit => ({ kind: 'number', value, ring: 'double' });
const T = (value: number): DartHit => ({ kind: 'number', value, ring: 'triple' });
const BULL: DartHit = { kind: 'bull', ring: 'inner' };
const OUTER: DartHit = { kind: 'bull', ring: 'outer' };
const MISS: DartHit = { kind: 'miss' };

describe('Half-It', () => {
  it('has the documented 9-round target sequence', () => {
    expect(HALF_IT_TARGETS).toHaveLength(9);
    expect(HALF_IT_TARGETS[0]).toEqual({ kind: 'number', value: 15 });
    expect(HALF_IT_TARGETS[2]).toEqual({ kind: 'any-double' });
    expect(HALF_IT_TARGETS[5]).toEqual({ kind: 'any-triple' });
    expect(HALF_IT_TARGETS[8]).toEqual({ kind: 'bull' });
  });

  it('starts at 40 points', () => {
    expect(halfItEngine.createState().score).toBe(HALF_IT_START_SCORE);
  });

  it('scores target hits with their multiplier (hand-check: 40 + S15 + D15 + T15 = 40+15+30+45 = 130)', () => {
    const state = halfItEngine.applyInput(halfItEngine.createState(), [S(15), D(15), T(15)]);
    expect(state.score).toBe(130);
    expect(state.darts).toBe(3);
  });

  it('halves (rounding down) when all three darts miss the target', () => {
    let state = halfItEngine.createState();
    state = halfItEngine.applyInput(state, [S(15)]); // 40 + 15 = 55
    expect(state.score).toBe(55);
    state = halfItEngine.applyInput(state, [S(1), S(2), S(3)]); // round 2 target=16, all miss
    expect(state.score).toBe(27); // floor(55 / 2)
    expect(state.rounds[1].halved).toBe(true);
  });

  it('counts ANY double in the double round and ANY triple in the triple round', () => {
    expect(halfItDartValue({ kind: 'any-double' }, D(7))).toBe(14);
    expect(halfItDartValue({ kind: 'any-double' }, T(7))).toBe(0);
    expect(halfItDartValue({ kind: 'any-triple' }, T(7))).toBe(21);
    expect(halfItDartValue({ kind: 'any-triple' }, D(7))).toBe(0);
  });

  it('counts both bull rings in the bull round', () => {
    expect(halfItDartValue({ kind: 'bull' }, BULL)).toBe(50);
    expect(halfItDartValue({ kind: 'bull' }, OUTER)).toBe(25);
    expect(halfItDartValue({ kind: 'bull' }, S(20))).toBe(0);
  });

  it('finishes after exactly 9 rounds', () => {
    let state = halfItEngine.createState();
    for (let i = 0; i < 9; i++) {
      expect(halfItEngine.isFinished(state)).toBe(false);
      state = halfItEngine.applyInput(state, [MISS, MISS, MISS]);
    }
    expect(halfItEngine.isFinished(state)).toBe(true);
  });

  it('compareResults: higher score wins', () => {
    const hi = { value: 200, unit: 'points' as const, completed: true, darts: 27, label: '200 POINTS' };
    const lo = { value: 100, unit: 'points' as const, completed: true, darts: 27, label: '100 POINTS' };
    expect(halfItEngine.compareResults(hi, lo)).toBe('p0');
    expect(halfItEngine.compareResults(lo, hi)).toBe('p1');
    expect(halfItEngine.compareResults(hi, hi)).toBe('draw');
  });

  it('minimum case: missing every round from 40 floors toward 0', () => {
    let state = halfItEngine.createState();
    for (let i = 0; i < 9; i++) state = halfItEngine.applyInput(state, [MISS, MISS, MISS]);
    // 40 -> 20 -> 10 -> 5 -> 2 -> 1 -> 0 -> 0 -> 0 -> 0
    expect(state.score).toBe(0);
  });
});

describe('Round the Clock on Doubles', () => {
  const engine = createRtcDoublesEngine({ dartLimit: 0 });

  it('requires the exact double of the current target to advance', () => {
    expect(rtcAdvances(0, D(1))).toBe(true);
    expect(rtcAdvances(0, S(1))).toBe(false);
    expect(rtcAdvances(0, T(1))).toBe(false);
    expect(rtcAdvances(0, D(2))).toBe(false);
  });

  it('finishes on any bull at the last target', () => {
    expect(rtcAdvances(RTC_TARGET_COUNT - 1, BULL)).toBe(true);
    expect(rtcAdvances(RTC_TARGET_COUNT - 1, OUTER)).toBe(true);
    expect(rtcAdvances(RTC_TARGET_COUNT - 1, D(20))).toBe(false);
  });

  it('labels targets D1..D20 then BULL', () => {
    expect(rtcTargetLabel(0)).toBe('D1');
    expect(rtcTargetLabel(19)).toBe('D20');
    expect(rtcTargetLabel(20)).toBe('BULL');
  });

  it('advances multiple targets within one 3-dart turn', () => {
    const state = engine.applyInput(engine.createState(), [D(1), D(2), D(3)]);
    expect(state.targetIndex).toBe(3);
    expect(state.darts).toBe(3);
  });

  it('minimum perfect run is 21 darts', () => {
    let state = engine.createState();
    for (let i = 1; i <= 20; i++) state = engine.applyInput(state, [D(i)]);
    state = engine.applyInput(state, [BULL]);
    expect(engine.isFinished(state)).toBe(true);
    const result = engine.getResult(state);
    expect(result.completed).toBe(true);
    expect(result.value).toBe(21);
  });

  it('stops consuming darts once complete (no over-count in the finishing turn)', () => {
    let state = engine.createState();
    for (let i = 1; i <= 20; i++) state = engine.applyInput(state, [D(i)]);
    state = engine.applyInput(state, [BULL, D(5), D(6)]); // extra darts after completion
    expect(state.darts).toBe(21);
  });

  it('honours a dart limit as DNF', () => {
    const limited = createRtcDoublesEngine({ dartLimit: 3 });
    const state = limited.applyInput(limited.createState(), [MISS, MISS, MISS]);
    expect(limited.isFinished(state)).toBe(true);
    expect(limited.getResult(state).completed).toBe(false);
  });

  it('compareResults: completed beats DNF; fewer darts wins between finishers', () => {
    const fast = { value: 21, unit: 'darts' as const, completed: true, darts: 21, label: '21 DARTS' };
    const slow = { value: 40, unit: 'darts' as const, completed: true, darts: 40, label: '40 DARTS' };
    const dnf = { value: Infinity, unit: 'darts' as const, completed: false, darts: 42, label: '12 / 21' };
    expect(engine.compareResults(fast, slow)).toBe('p0');
    expect(engine.compareResults(fast, dnf)).toBe('p0');
    expect(engine.compareResults(dnf, fast)).toBe('p1');
  });
});

describe('Golf', () => {
  it('scores strokes by ring: D=1, T=2, S=3, miss=5', () => {
    expect(golfStrokes(1, D(1))).toBe(1);
    expect(golfStrokes(1, T(1))).toBe(2);
    expect(golfStrokes(1, S(1))).toBe(3);
    expect(golfStrokes(1, S(2))).toBe(5);
    expect(golfStrokes(1, MISS)).toBe(5);
  });

  it('only the LAST dart thrown counts for the hole', () => {
    const state = golfEngine.applyInput(golfEngine.createState(), [D(1), MISS]);
    expect(state.holeScores[0]).toBe(5); // the miss was last, so the double is discarded
    expect(state.strokes).toBe(5);
  });

  it('best possible 9-hole round is 9 strokes (all doubles)', () => {
    let state = golfEngine.createState();
    for (let hole = 1; hole <= GOLF_HOLES; hole++) state = golfEngine.applyInput(state, [D(hole)]);
    expect(golfEngine.isFinished(state)).toBe(true);
    expect(state.strokes).toBe(9);
  });

  it('worst possible 9-hole round is 45 strokes (all misses)', () => {
    let state = golfEngine.createState();
    for (let hole = 1; hole <= GOLF_HOLES; hole++) state = golfEngine.applyInput(state, [MISS]);
    expect(state.strokes).toBe(45);
  });

  it('compareResults: fewer strokes wins', () => {
    const good = { value: 18, unit: 'strokes' as const, completed: true, darts: 9, label: '18 STROKES' };
    const bad = { value: 30, unit: 'strokes' as const, completed: true, darts: 9, label: '30 STROKES' };
    expect(golfEngine.compareResults(good, bad)).toBe('p0');
    expect(golfEngine.compareResults(bad, good)).toBe('p1');
    expect(golfEngine.compareResults(good, good)).toBe('draw');
  });
});

describe('Cork', () => {
  it('ranks inner bull > outer bull > board > miss', () => {
    expect(corkProximity(BULL)).toBeGreaterThan(corkProximity(OUTER));
    expect(corkProximity(OUTER)).toBeGreaterThan(corkProximity(S(20)));
    expect(corkProximity(S(20))).toBeGreaterThan(corkProximity(MISS));
  });

  it('finishes after one dart', () => {
    const state = corkEngine.applyInput(corkEngine.createState(), [BULL]);
    expect(corkEngine.isFinished(state)).toBe(true);
    expect(corkEngine.getResult(state).label).toBe('BULL');
  });

  it('compareResults: closer to centre wins, equal is a draw', () => {
    const bull = { value: 3, unit: 'proximity' as const, completed: true, darts: 1, label: 'BULL' };
    const outer = { value: 2, unit: 'proximity' as const, completed: true, darts: 1, label: 'OUTER BULL' };
    expect(corkEngine.compareResults(bull, outer)).toBe('p0');
    expect(corkEngine.compareResults(outer, bull)).toBe('p1');
    expect(corkEngine.compareResults(bull, bull)).toBe('draw');
  });
});

describe('Baseball', () => {
  it('only the inning number scores', () => {
    expect(baseballRuns(1, S(1))).toBe(1);
    expect(baseballRuns(1, D(1))).toBe(2);
    expect(baseballRuns(1, T(1))).toBe(3);
    expect(baseballRuns(1, S(2))).toBe(0);
    expect(baseballRuns(1, BULL)).toBe(0);
  });

  it('max 9 runs in one inning (three triples)', () => {
    const state = baseballEngine.applyInput(baseballEngine.createState(), [T(1), T(1), T(1)]);
    expect(state.runs).toBe(9);
  });

  it('plays exactly 9 innings; perfect game is 81 runs', () => {
    let state = baseballEngine.createState();
    for (let inning = 1; inning <= BASEBALL_INNINGS; inning++) {
      expect(baseballEngine.isFinished(state)).toBe(false);
      state = baseballEngine.applyInput(state, [T(inning), T(inning), T(inning)]);
    }
    expect(baseballEngine.isFinished(state)).toBe(true);
    expect(state.runs).toBe(81);
  });

  it('minimum is 0 runs', () => {
    let state = baseballEngine.createState();
    for (let i = 1; i <= BASEBALL_INNINGS; i++) state = baseballEngine.applyInput(state, [MISS, MISS, MISS]);
    expect(state.runs).toBe(0);
  });

  it('compareResults: more runs wins', () => {
    const many = { value: 30, unit: 'runs' as const, completed: true, darts: 27, label: '30 RUNS' };
    const few = { value: 10, unit: 'runs' as const, completed: true, darts: 27, label: '10 RUNS' };
    expect(baseballEngine.compareResults(many, few)).toBe('p0');
    expect(baseballEngine.compareResults(few, many)).toBe('p1');
    expect(baseballEngine.compareResults(many, many)).toBe('draw');
  });
});

describe('Cricket (head-to-head, same rules as soft-tip machines)', () => {
  it('marks by ring, and bull inner counts double', () => {
    expect(cricketMarks(S(20))).toEqual({ target: 20, marks: 1 });
    expect(cricketMarks(D(20))).toEqual({ target: 20, marks: 2 });
    expect(cricketMarks(T(20))).toEqual({ target: 20, marks: 3 });
    expect(cricketMarks(OUTER)).toEqual({ target: 'BULL', marks: 1 });
    expect(cricketMarks(BULL)).toEqual({ target: 'BULL', marks: 2 });
    expect(cricketMarks(S(14))).toBeNull(); // not a cricket number
  });

  it('opens a number with 3 marks without scoring points', () => {
    const state = cricketEngine.applyInput(cricketEngine.createState(), [T(20)]);
    expect(state.self.marks['20']).toBe(3);
    expect(state.self.points).toBe(0);
  });

  it('scores surplus marks after opening while the opponent has not closed it (hand-check: T20 T20 T20 = open + 60 + 60 = 120)', () => {
    const state = cricketEngine.applyInput(cricketEngine.createState(), [T(20), T(20), T(20)]);
    expect(state.self.marks['20']).toBe(3);
    expect(state.self.points).toBe(120);
  });

  it('finishes once all 7 targets are closed and points are ahead of a (still empty) opponent', () => {
    let state = cricketEngine.createState();
    for (const n of [20, 19, 18, 17, 16, 15]) state = cricketEngine.applyInput(state, [T(n)]);
    expect(allCricketClosed(state.self)).toBe(false); // bull still open
    state = cricketEngine.applyInput(state, [BULL, OUTER]); // 2 + 1 marks = closed
    expect(allCricketClosed(state.self)).toBe(true);
    expect(cricketEngine.isFinished(state)).toBe(true);
    expect(state.winner).toBe('self');
    expect(cricketEngine.getResult(state).completed).toBe(true);
  });

  it('stops at the round limit, undecided, if neither side closes out', () => {
    let state = cricketEngine.createState();
    for (let i = 0; i <= CRICKET_ROUND_LIMIT; i++) state = cricketEngine.applyInput(state, [MISS, MISS, MISS]);
    expect(cricketEngine.isFinished(state)).toBe(true);
    expect(cricketEngine.getResult(state).completed).toBe(false);
  });

  it('compareResults: closing all outranks points', () => {
    const closedLowPoints = { value: 20, unit: 'points' as const, completed: true, darts: 30, label: '20 POINTS' };
    const openHighPoints = { value: 200, unit: 'points' as const, completed: false, darts: 60, label: '200 PTS (未クローズ)' };
    expect(cricketEngine.compareResults(closedLowPoints, openHighPoints)).toBe('p0');
    expect(cricketEngine.compareResults(openHighPoints, closedLowPoints)).toBe('p1');
  });

  describe('territory denial (mirrorForOpponent)', () => {
    function mirror(state: ReturnType<typeof cricketEngine.createState>) {
      return cricketEngine.mirrorForOpponent!(state);
    }

    it('a number closed by the opponent blocks further scoring on it, even though it can still be opened', () => {
      // P0 opens and scores twice on 20 (120 points), unopposed so far.
      let p0 = cricketEngine.applyInput(cricketEngine.createState(), [T(20), T(20), T(20)]);
      expect(p0.self.points).toBe(120);

      // P1's own view after P0's turn: P1 is still empty, but now sees P0 (as "opponent") holding 20.
      let p1 = mirror(p0);
      expect(p1.opponent.marks['20']).toBe(3);

      // P1 also closes 20 (denying P0 any further points there) but is too late to score there themself.
      p1 = cricketEngine.applyInput(p1, [T(20)]);
      expect(p1.self.marks['20']).toBe(3);
      expect(p1.self.points).toBe(0); // opponent (P0) already had it closed, so no payout for P1 either

      // Mirror back to P0: 20 is now closed by both, so a further triple there scores nothing more.
      p0 = mirror(p1);
      expect(p0.opponent.marks['20']).toBe(3);
      p0 = cricketEngine.applyInput(p0, [T(20)]);
      expect(p0.self.points).toBe(120); // unchanged - shut out once the opponent also closed it
    });

    it('closing all 7 while behind on points does NOT finish the discipline yet', () => {
      // The opponent (P1) genuinely scores 120 real points first, and P0 sees that via the mirror.
      const p1After = cricketEngine.applyInput(cricketEngine.createState(), [T(20), T(20), T(20)]);
      let p0 = mirror(p1After);
      expect(p0.opponent.points).toBe(120);

      for (const n of [20, 19, 18, 17, 16, 15]) p0 = cricketEngine.applyInput(p0, [T(n)]); // 20 already denied by the opponent, so 0 surplus there; the rest are fresh opens too
      p0 = cricketEngine.applyInput(p0, [BULL, OUTER]);
      expect(allCricketClosed(p0.self)).toBe(true);
      expect(p0.self.points).toBe(0);
      expect(cricketEngine.isFinished(p0)).toBe(false); // closed everything, but 0 < the opponent's 120

      // The opponent hasn't touched 19, so P0 can still score there to catch up and take the lead.
      p0 = cricketEngine.applyInput(p0, [T(19), T(19), T(19)]); // 3 x 3x19 = 171
      expect(p0.self.points).toBe(171);
      expect(cricketEngine.isFinished(p0)).toBe(true);
      expect(p0.winner).toBe('self');
    });

    it('mirrorForOpponent flips the winner label correctly', () => {
      let state = cricketEngine.createState();
      for (const n of [20, 19, 18, 17, 16, 15]) state = cricketEngine.applyInput(state, [T(n)]);
      state = cricketEngine.applyInput(state, [BULL, OUTER]);
      expect(state.winner).toBe('self');

      const mirrored = mirror(state);
      expect(mirrored.winner).toBe('opponent');
      expect(mirrored.finished).toBe(true);
    });
  });
});

describe('X01 solo attempts', () => {
  const engine501 = createX01SoloEngine({ id: 'x01-501', name: '501', startScore: 501, doubleIn: false, roundLimit: 0 });
  const engine301 = createX01SoloEngine({ id: 'x01-301', name: '301', startScore: 301, doubleIn: true, roundLimit: 13 });

  it('501: a 9-dart finish is recorded as 9 darts', () => {
    let state = engine501.createState();
    state = engine501.applyInput(state, { score: 180 });
    state = engine501.applyInput(state, { score: 180 });
    state = engine501.applyInput(state, { score: 141, finishDarts: 3 });
    expect(engine501.isFinished(state)).toBe(true);
    const result = engine501.getResult(state);
    expect(result.value).toBe(9);
    expect(result.completed).toBe(true);
    expect(result.label).toBe('9 DARTS');
  });

  it('501: a bust leaves remaining unchanged but still consumes darts', () => {
    let state = engine501.createState();
    state = engine501.applyInput(state, { score: 180 }); // 321
    state = engine501.applyInput(state, { score: 180 }); // 141
    state = engine501.applyInput(state, { score: 150 }); // bust
    expect(state.remaining).toBe(141);
    expect(state.darts).toBe(9);
    expect(state.visits[2].bust).toBe(true);
  });

  it('301: double-in means nothing scores until the player opens with a double', () => {
    let state = engine301.createState();
    state = engine301.applyInput(state, { score: 60, openedWithDouble: false });
    expect(state.remaining).toBe(301);
    expect(state.darts).toBe(3);
    state = engine301.applyInput(state, { score: 60, openedWithDouble: true });
    expect(state.remaining).toBe(241);
  });

  it('301: exceeding the 13-round limit ends the attempt as DNF', () => {
    let state = engine301.createState();
    for (let i = 0; i < 14; i++) state = engine301.applyInput(state, { score: 0, openedWithDouble: true });
    expect(engine301.isFinished(state)).toBe(true);
    expect(engine301.getResult(state).completed).toBe(false);
    expect(engine301.getResult(state).label).toBe('DNF');
  });

  it('compareResults: fewer darts wins, and any finisher beats a DNF', () => {
    const nine = { value: 9, unit: 'darts' as const, completed: true, darts: 9, label: '9 DARTS' };
    const twenty = { value: 20, unit: 'darts' as const, completed: true, darts: 20, label: '20 DARTS' };
    const dnf = { value: Infinity, unit: 'darts' as const, completed: false, darts: 39, label: 'DNF' };
    expect(engine501.compareResults(nine, twenty)).toBe('p0');
    expect(engine501.compareResults(twenty, nine)).toBe('p1');
    expect(engine501.compareResults(nine, dnf)).toBe('p0');
    expect(engine501.compareResults(dnf, nine)).toBe('p1');
    expect(engine501.compareResults(dnf, dnf)).toBe('draw');
    expect(engine501.compareResults(nine, nine)).toBe('draw');
  });
});
