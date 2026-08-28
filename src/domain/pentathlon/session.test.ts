import { describe, expect, it } from 'vitest';
import {
  advanceDiscipline,
  applyTurn,
  canUndoRound,
  canUndoStagedHit,
  computeNextStarter,
  computeTotals,
  createPentathlonSession,
  currentDisciplineId,
  disciplineCount,
  isDisciplineComplete,
  isSingleGameSession,
  sessionDisciplines,
  stageHit,
  undoRound,
  undoStagedHit,
  type CreateSessionOptions,
} from './session';
import type { DartHit } from '../darts';
import type { PentathlonSession } from './types';

const D = (value: number): DartHit => ({ kind: 'number', value, ring: 'double' });
const MISS: DartHit = { kind: 'miss' };
const BULL: DartHit = { kind: 'bull', ring: 'inner' };

function newSession(overrides: Partial<CreateSessionOptions> = {}): PentathlonSession {
  return createPentathlonSession({
    preset: 'jda',
    playerCount: 2,
    names: ['プレイヤー1', 'プレイヤー2'],
    starterMode: 'loser',
    initialStarter: 0,
    ...overrides,
  });
}

/** 1-player only: plays a 9-dart 501 finish for the lone player. */
function play501Finish(session: PentathlonSession): PentathlonSession {
  let next = applyTurn(session, { score: 180 });
  next = applyTurn(next, { score: 180 });
  return applyTurn(next, { score: 141, finishDarts: 3 });
}

/**
 * 2-player: turns interleave until the starter checks out in 9 darts, which wins 501 outright -
 * the opponent, still on 449, never throws again.
 */
function play501TwoPlayers(session: PentathlonSession): PentathlonSession {
  let next = applyTurn(session, { score: 180 }); // starter -> 321
  next = applyTurn(next, { score: 26 }); // opponent -> 475
  next = applyTurn(next, { score: 180 }); // starter -> 141
  next = applyTurn(next, { score: 26 }); // opponent -> 449
  return applyTurn(next, { score: 141, finishDarts: 3 }); // starter OUT in 9 -> discipline over
}

/**
 * Fast-forwards through Cork's 5 rounds (15 darts per player) under the 15-dart bull-count rule.
 * With p0AllInner true, P0 hits inner bull throughout (30 points) while P1 misses every dart (0) -
 * an outright win with no tie. With it false, both players miss every dart for an exact 0-0 tie.
 */
function playCorkOutright(session: PentathlonSession, options: { p0AllInner: boolean }): PentathlonSession {
  let next = session;
  for (let round = 0; round < 5; round++) {
    next = applyTurn(next, options.p0AllInner ? [BULL, BULL, BULL] : [MISS, MISS, MISS]);
    next = applyTurn(next, [MISS, MISS, MISS]);
  }
  return next;
}

describe('createPentathlonSession', () => {
  it('starts on the first discipline of the chosen preset', () => {
    const jda = newSession({ preset: 'jda' });
    expect(currentDisciplineId(jda)).toBe('x01-501');
    expect(disciplineCount(jda)).toBe(5);

    const n01 = newSession({ preset: 'n01' });
    expect(currentDisciplineId(n01)).toBe('cork');
    expect(disciplineCount(n01)).toBe(5);
  });

  it('honours an explicit initial starter', () => {
    expect(newSession({ initialStarter: 0 }).current!.active).toBe(0);
    expect(newSession({ initialStarter: 1 }).current!.active).toBe(1);
  });

  it('resolves a random starter exactly once and persists it', () => {
    const session = newSession({ initialStarter: 'random' });
    expect([0, 1]).toContain(session.initialStarter);
    expect(session.currentStarter).toBe(session.initialStarter);
    // Re-reading the same session object must never re-roll.
    expect(session.current!.active).toBe(session.initialStarter);
  });

  it('forces player 0 as starter in 1-player mode', () => {
    const session = newSession({ playerCount: 1, initialStarter: 1 });
    expect(session.current!.active).toBe(0);
  });
});

describe('two-player progression', () => {
  it('alternates turns P1 -> P2 -> P1 -> P2', () => {
    let session = newSession({ initialStarter: 0 });
    expect(session.current!.active).toBe(0);
    session = applyTurn(session, { score: 60 });
    expect(session.current!.active).toBe(1);
    session = applyTurn(session, { score: 60 });
    expect(session.current!.active).toBe(0);
    session = applyTurn(session, { score: 60 });
    expect(session.current!.active).toBe(1);
  });

  it('ends a NON-race discipline only once both players have their own final result', () => {
    // RTC-on-doubles is a parallel attempt, not a race: P1 completing the clock must not stop P2.
    let session = newSession({
      mode: 'single',
      disciplines: ['rtc-doubles'],
      initialStarter: 0,
    });
    for (let offset = 0; offset < RTC_SEQUENCE.length; offset += 3) {
      session = applyTurn(session, RTC_SEQUENCE.slice(offset, offset + 3)); // P1 advances
      session = applyTurn(session, [MISS, MISS, MISS]); // P2 gets nowhere
    }

    expect(session.current!.progress[0].finished).toBe(true);
    expect(isDisciplineComplete(session)).toBe(false);
    expect(session.status).toBe('playing');
    // Play must now stay with P2 for every subsequent turn.
    expect(session.current!.active).toBe(1);
    session = applyTurn(session, [MISS, MISS, MISS]);
    expect(session.current!.active).toBe(1);
  });
});

describe('X01 as a race (first checkout wins)', () => {
  it('ends 501 the moment a player checks out, with the opponent recorded where they stood', () => {
    const session = play501TwoPlayers(newSession({ initialStarter: 0 }));

    expect(isDisciplineComplete(session)).toBe(true);
    expect(session.status).toBe('between-disciplines');
    const record = session.records[0];
    expect(record.results[0]!.label).toBe('9 DARTS');
    expect(record.results[1]!.completed).toBe(false);
    expect(record.results[1]!.label).toBe('DNF');
    expect(record.outcome).toBe('p0');
  });

  it('is undoable, putting the checked-out player back on the oche', () => {
    let session = play501TwoPlayers(newSession({ initialStarter: 0 }));
    expect(session.status).toBe('between-disciplines');

    session = undoRound(session);
    expect(session.status).toBe('playing');
    expect(session.records).toHaveLength(0);
    expect(session.current!.progress[0].finished).toBe(false);
    expect(session.current!.active).toBe(0);
  });

  it('does NOT end on 301’s round limit - the opponent can still go out and win', () => {
    // P1 burns all 13 rounds without checking out: finished, but not completed.
    let session = newSession({ mode: 'single', disciplines: ['x01-301'], initialStarter: 0 });
    for (let round = 0; round < 13; round++) {
      session = applyTurn(session, { score: 0 }); // P1 scores nothing
      session = applyTurn(session, { score: 0 }); // P2 keeps pace, also nothing
    }

    expect(session.current!.progress[0].finished).toBe(true);
    expect(session.current!.progress[0].result!.completed).toBe(false);
    expect(session.current!.progress[1].finished).toBe(true);
    expect(session.status).toBe('between-disciplines');
    expect(session.records[0].outcome).toBe('draw'); // neither checked out
  });
});

describe('single-player progression', () => {
  it('completes a discipline as soon as the lone player finishes', () => {
    let session = newSession({ playerCount: 1 });
    session = play501Finish(session);
    expect(isDisciplineComplete(session)).toBe(true);
    expect(session.status).toBe('between-disciplines');
    expect(session.records[0].results[1]).toBeNull();
    expect(session.records[0].outcome).toBeNull();
  });

  it('plays all five disciplines through to completion', () => {
    let session = newSession({ playerCount: 1, preset: 'jda' });
    // 501
    session = advanceDiscipline(play501Finish(session));
    expect(currentDisciplineId(session)).toBe('half-it');
    // Half-It: 9 rounds
    for (let i = 0; i < 9; i++) session = applyTurn(session, [MISS, MISS, MISS]);
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('rtc-doubles');
    // RTC on doubles: perfect run
    for (let i = 1; i <= 20; i++) session = applyTurn(session, [D(i)]);
    session = applyTurn(session, [BULL]);
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('golf');
    // Golf: 9 holes
    for (let hole = 1; hole <= 9; hole++) session = applyTurn(session, [D(hole)]);
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('x01-301');
    // 301 double-in/out
    session = applyTurn(session, { score: 180, openedWithDouble: true });
    session = applyTurn(session, { score: 61 });
    session = applyTurn(session, { score: 60, finishDarts: 3 });
    session = advanceDiscipline(session);

    expect(session.status).toBe('completed');
    expect(session.records).toHaveLength(5);
  });
});

describe('computeNextStarter', () => {
  it('loser mode: the losing player starts next', () => {
    expect(computeNextStarter('loser', 0, 'p0')).toBe(1); // P1 won -> P2 starts
    expect(computeNextStarter('loser', 0, 'p1')).toBe(0); // P2 won -> P1 starts
    expect(computeNextStarter('loser', 1, 'p0')).toBe(1);
    expect(computeNextStarter('loser', 1, 'p1')).toBe(0);
  });

  it('loser mode on a DRAW: the previous second player starts (starter swaps, deterministically)', () => {
    expect(computeNextStarter('loser', 0, 'draw')).toBe(1);
    expect(computeNextStarter('loser', 1, 'draw')).toBe(0);
  });

  it('alternate mode: always swaps regardless of the result', () => {
    expect(computeNextStarter('alternate', 0, 'p0')).toBe(1);
    expect(computeNextStarter('alternate', 0, 'p1')).toBe(1);
    expect(computeNextStarter('alternate', 0, 'draw')).toBe(1);
    expect(computeNextStarter('alternate', 1, 'p0')).toBe(0);
    expect(computeNextStarter('alternate', 1, 'p1')).toBe(0);
    expect(computeNextStarter('alternate', 1, 'draw')).toBe(0);
  });

  it('is deterministic (same inputs always give the same result)', () => {
    for (let i = 0; i < 50; i++) {
      expect(computeNextStarter('loser', 0, 'draw')).toBe(1);
      expect(computeNextStarter('alternate', 1, 'p0')).toBe(0);
    }
  });
});

describe('starter application across disciplines', () => {
  it('loser mode: the loser of discipline 1 starts discipline 2', () => {
    let session = play501TwoPlayers(newSession({ starterMode: 'loser', initialStarter: 0 }));
    expect(session.records[0].outcome).toBe('p0');
    session = advanceDiscipline(session);
    expect(session.currentStarter).toBe(1); // P2 lost, so P2 starts
    expect(session.current!.active).toBe(1);
  });

  it('alternate mode: starter swaps even when the same player keeps winning', () => {
    let session = play501TwoPlayers(newSession({ starterMode: 'alternate', initialStarter: 0 }));
    expect(session.records[0].outcome).toBe('p0'); // P1 won
    session = advanceDiscipline(session);
    expect(session.currentStarter).toBe(1); // swaps anyway
  });

  it('a DRAW swaps the starter in loser mode', () => {
    // Golf is easiest to force a draw in: identical stroke totals.
    let session = newSession({ preset: 'jda', starterMode: 'loser', initialStarter: 0 });
    // Skip ahead to Golf by finishing 501, Half-It and RTC quickly for both players.
    session = fastForwardToGolf(session);
    expect(currentDisciplineId(session)).toBe('golf');
    const starterBefore = session.currentStarter;
    // Both players play identical rounds -> draw.
    for (let hole = 1; hole <= 9; hole++) {
      session = applyTurn(session, [D(hole)]);
      session = applyTurn(session, [D(hole)]);
    }
    expect(session.records[3].outcome).toBe('draw');
    session = advanceDiscipline(session);
    expect(session.currentStarter).toBe(starterBefore === 0 ? 1 : 0);
  });
});

const RTC_SEQUENCE: DartHit[] = [...Array.from({ length: 20 }, (_, i) => D(i + 1)), BULL];

function fastForwardToGolf(start: PentathlonSession): PentathlonSession {
  let session = play501TwoPlayers(start);
  session = advanceDiscipline(session);
  // Half-It: 9 rounds each, interleaved
  for (let i = 0; i < 9; i++) {
    session = applyTurn(session, [MISS, MISS, MISS]);
    session = applyTurn(session, [MISS, MISS, MISS]);
  }
  session = advanceDiscipline(session);
  // RTC doubles: identical perfect runs for both, 3 targets per turn
  for (let offset = 0; offset < RTC_SEQUENCE.length; offset += 3) {
    const hits = RTC_SEQUENCE.slice(offset, offset + 3);
    session = applyTurn(session, hits);
    session = applyTurn(session, hits);
  }
  return advanceDiscipline(session);
}

describe('undo', () => {
  it('reverts the most recent turn and restores the active player', () => {
    let session = newSession({ initialStarter: 0 });
    session = applyTurn(session, { score: 100 });
    expect(session.current!.active).toBe(1);
    session = undoRound(session);
    expect(session.current!.active).toBe(0);
    const state = session.current!.progress[0].state as { remaining: number };
    expect(state.remaining).toBe(501);
  });

  it('restores a finished player back to unfinished', () => {
    let session = newSession({ playerCount: 1 });
    session = play501Finish(session);
    expect(session.current!.progress[0].finished).toBe(true);
    session = undoRound(session);
    expect(session.current!.progress[0].finished).toBe(false);
    expect(session.current!.progress[0].result).toBeNull();
  });

  it('reverts a discipline advance, restoring the previous discipline and its records', () => {
    let session = newSession({ playerCount: 1 });
    session = play501Finish(session);
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('half-it');
    session = undoRound(session);
    expect(currentDisciplineId(session)).toBe('x01-501');
    expect(session.status).toBe('between-disciplines');
    expect(session.records).toHaveLength(1);
  });

  it('recomputes correctly after undo (redoing the turn gives the same state)', () => {
    let session = newSession({ playerCount: 1 });
    session = applyTurn(session, { score: 180 });
    const afterFirst = structuredClone(session.current!.progress[0].state);
    session = applyTurn(session, { score: 100 });
    session = undoRound(session);
    expect(session.current!.progress[0].state).toEqual(afterFirst);
    session = applyTurn(session, { score: 100 });
    const state = session.current!.progress[0].state as { remaining: number; darts: number };
    expect(state.remaining).toBe(221);
    expect(state.darts).toBe(6);
  });

  it('is a no-op with nothing to undo', () => {
    const session = newSession();
    expect(canUndoRound(session)).toBe(false);
    expect(undoRound(session)).toBe(session);
  });
});

describe('computeTotals', () => {
  it('counts discipline wins per player', () => {
    const session = newSession();
    const withRecords: PentathlonSession = {
      ...session,
      records: [
        { id: 'x01-501', results: [null as never, null], outcome: 'p0', starter: 0 },
        { id: 'half-it', results: [null as never, null], outcome: 'p1', starter: 1 },
        { id: 'golf', results: [null as never, null], outcome: 'p0', starter: 0 },
        { id: 'x01-301', results: [null as never, null], outcome: 'draw', starter: 1 },
      ],
    };
    const totals = computeTotals(withRecords);
    expect(totals.wins).toEqual([2, 1]);
    expect(totals.draws).toBe(1);
    expect(totals.overall).toBe('p0');
  });

  it('reports a tie as a draw', () => {
    const session = newSession();
    const totals = computeTotals({
      ...session,
      records: [
        { id: 'x01-501', results: [null as never, null], outcome: 'p0', starter: 0 },
        { id: 'half-it', results: [null as never, null], outcome: 'p1', starter: 1 },
      ],
    });
    expect(totals.overall).toBe('draw');
  });

  it('has no overall winner in 1-player mode', () => {
    const session = newSession({ playerCount: 1 });
    expect(computeTotals(session).overall).toBeNull();
  });
});

const S = (value: number): DartHit => ({ kind: 'number', value, ring: 'single' });

/** Repeats `input` for whichever player is active until the current discipline is done. */
function playUntilDisciplineComplete(session: PentathlonSession, input: unknown): PentathlonSession {
  let s = session;
  for (let guard = 0; guard < 100 && !isDisciplineComplete(s); guard++) {
    s = applyTurn(s, input);
  }
  return s;
}

describe('Cork: 15-dart bull count (regression)', () => {
  it('is not finished until both players have thrown all 15 darts', () => {
    let session = newSession({ preset: 'n01' });
    expect(currentDisciplineId(session)).toBe('cork');

    session = applyTurn(session, [BULL, BULL, BULL]); // P0, round 1
    session = applyTurn(session, [MISS, MISS, MISS]); // P1, round 1

    expect(session.status).toBe('playing');
    expect(session.records).toHaveLength(0);
    expect(session.current?.progress[0].finished).toBe(false);
    expect(session.current?.progress[0].state).toMatchObject({ darts: 3, score: 6 });
  });

  it('records an exact tie as a genuine draw - no sudden-death re-throw under this rule', () => {
    let session = newSession({ preset: 'n01' });
    session = playCorkOutright(session, { p0AllInner: false });

    expect(session.status).toBe('between-disciplines');
    expect(session.records).toHaveLength(1);
    expect(session.records[0].outcome).toBe('draw');
    expect(session.records[0].results[0]!.label).toBe('0 POINTS');
    expect(session.records[0].results[1]!.label).toBe('0 POINTS');
  });

  it('the higher 15-dart total wins outright (max possible score is 30)', () => {
    let session = newSession({ preset: 'n01' });
    session = playCorkOutright(session, { p0AllInner: true });

    expect(session.status).toBe('between-disciplines');
    expect(session.records[0].outcome).toBe('p0');
    expect(session.records[0].results[0]!.label).toBe('30 POINTS');
    expect(session.records[0].results[1]!.label).toBe('0 POINTS');
  });
});

describe('Baseball extra innings on a tie (regression)', () => {
  it('continues past inning 9 instead of recording a 0-0 draw, then finalizes once broken', () => {
    // Fast-forward through Cork (P0 wins outright, no tie) and 301 (both DNF -> draw) to reach Baseball.
    let session = newSession({ preset: 'n01' });
    session = playCorkOutright(session, { p0AllInner: true });
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('x01-301');
    session = playUntilDisciplineComplete(session, { score: 0, openedWithDouble: false });
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('baseball');

    for (let inning = 0; inning < 9; inning++) {
      session = applyTurn(session, [MISS, MISS, MISS]);
      session = applyTurn(session, [MISS, MISS, MISS]);
    }

    // 0-0 after inning 9 must extend into extra innings, not finalize as a draw.
    expect(session.status).toBe('playing');
    expect(session.records).toHaveLength(2); // just Cork + 301 so far, not Baseball
    expect(session.current?.progress[0].state).toMatchObject({ inning: 10, finished: false });
    expect(session.current?.progress[1].state).toMatchObject({ inning: 10, finished: false });

    // Break the tie in inning 10.
    session = applyTurn(session, [S(10), MISS, MISS]); // 1 run
    session = applyTurn(session, [MISS, MISS, MISS]); // 0 runs
    expect(session.status).toBe('between-disciplines');
    expect(session.records).toHaveLength(3);
    expect(session.records[2].outcome).toBe('p0');
  });
});

const T = (value: number): DartHit => ({ kind: 'number', value, ring: 'triple' });

describe('Cricket territory denial through the session controller (regression)', () => {
  it('mirrors a closed number into the other player so their scoring on it is blocked, end to end', () => {
    // Fast-forward through Cork, 301, Baseball and 501 to reach Cricket (discipline 5 of n01).
    let session = newSession({ preset: 'n01' });
    session = playCorkOutright(session, { p0AllInner: true });
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('x01-301');
    session = playUntilDisciplineComplete(session, { score: 0, openedWithDouble: false }); // both DNF -> draw
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('baseball');
    for (let inning = 1; inning <= 9; inning++) {
      session = applyTurn(session, inning === 1 ? [S(1), MISS, MISS] : [MISS, MISS, MISS]); // P0: 1 run total
      session = applyTurn(session, [MISS, MISS, MISS]); // P1: 0 runs
    }
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('x01-501');
    session = applyTurn(session, { score: 180 }); // P0 -> 321
    session = applyTurn(session, { score: 180 }); // P1 -> 321
    session = applyTurn(session, { score: 180 }); // P0 -> 141
    session = applyTurn(session, { score: 180 }); // P1 -> 141
    session = applyTurn(session, { score: 141, finishDarts: 3 }); // P0 checks out
    session = applyTurn(session, { score: 141, finishDarts: 3 }); // P1 checks out
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('cricket');

    // P0 opens and scores twice on 20 (unopposed): 120 points.
    session = applyTurn(session, [T(20), T(20), T(20)]);
    expect((session.current?.progress[0].state as { self: { points: number } }).self.points).toBe(120);
    // P1's own view must already show 20 as held by the opponent (the mirror ran through applyTurn).
    expect(
      (session.current?.progress[1].state as { opponent: { marks: Record<string, number> } }).opponent.marks['20'],
    ).toBe(3);

    // P1 closes 20 too (denying further P0 scoring there) but is too late to score there themself.
    session = applyTurn(session, [T(20)]);
    expect((session.current?.progress[1].state as { self: { points: number } }).self.points).toBe(0);

    // Mirrored back to P0: a further triple on 20 now scores nothing, since P1 has also closed it.
    session = applyTurn(session, [T(20)]);
    expect((session.current?.progress[0].state as { self: { points: number } }).self.points).toBe(120);
  });
});

describe('個別練習 (single-game sessions)', () => {
  const singleSession = (disciplineId: 'x01-501' | 'baseball' | 'cricket', playerCount: 1 | 2 = 1) =>
    newSession({
      preset: 'n01',
      mode: 'single',
      disciplines: [disciplineId],
      playerCount,
    });

  it('plays exactly the chosen discipline, not the preset five', () => {
    const session = singleSession('baseball');
    expect(isSingleGameSession(session)).toBe(true);
    expect(sessionDisciplines(session)).toEqual(['baseball']);
    expect(disciplineCount(session)).toBe(1);
    expect(currentDisciplineId(session)).toBe('baseball');
  });

  it('can pick a discipline out of the middle of a preset', () => {
    expect(currentDisciplineId(singleSession('cricket'))).toBe('cricket');
    expect(currentDisciplineId(singleSession('x01-501'))).toBe('x01-501');
  });

  it('stops after its one discipline instead of moving on to another', () => {
    let session = play501Finish(singleSession('x01-501'));
    expect(session.status).toBe('between-disciplines');
    expect(session.records).toHaveLength(1);

    session = advanceDiscipline(session);
    expect(session.status).toBe('completed');
    expect(session.current).toBeNull();
  });

  it('records only its own discipline, so nothing can leak into a full pentathlon', () => {
    const session = play501Finish(singleSession('x01-501'));
    expect(session.records.map((record) => record.id)).toEqual(['x01-501']);
  });

  it('treats a session saved before 個別練習 existed as a full pentathlon', () => {
    const legacy = newSession();
    delete legacy.mode;
    delete legacy.disciplines;
    expect(isSingleGameSession(legacy)).toBe(false);
    expect(disciplineCount(legacy)).toBe(5);
  });
});

describe('undo split: staged dart vs committed round', () => {
  const baseballSession = () =>
    newSession({ preset: 'n01', mode: 'single', disciplines: ['baseball'], playerCount: 1 });

  it('undoStagedHit removes only the last staged dart, leaving committed rounds alone', () => {
    let session = baseballSession();
    session = applyTurn(session, [{ kind: 'number', value: 1, ring: 'triple' }]); // inning 1: 3 runs
    const afterFirstRound = (session.current!.progress[0].state as { runs: number }).runs;
    expect(afterFirstRound).toBe(3);

    session = stageHit(session, { kind: 'number', value: 2, ring: 'double' });
    session = stageHit(session, { kind: 'number', value: 2, ring: 'single' });
    expect(session.current!.pendingHits).toHaveLength(2);

    session = undoStagedHit(session);
    expect(session.current!.pendingHits).toHaveLength(1);
    // The committed round is untouched by a staged-dart undo.
    expect((session.current!.progress[0].state as { runs: number }).runs).toBe(3);
    expect((session.current!.progress[0].state as { inning: number }).inning).toBe(2);
  });

  it('undoRound reverts the previous committed round, not the staged darts', () => {
    let session = baseballSession();
    session = applyTurn(session, [{ kind: 'number', value: 1, ring: 'triple' }]);
    expect((session.current!.progress[0].state as { runs: number }).runs).toBe(3);

    session = undoRound(session);
    expect((session.current!.progress[0].state as { runs: number }).runs).toBe(0);
    expect((session.current!.progress[0].state as { inning: number }).inning).toBe(1);
  });

  it('blocks the round undo while darts are staged, so a half-entered turn is never discarded', () => {
    let session = baseballSession();
    session = applyTurn(session, [{ kind: 'number', value: 1, ring: 'single' }]);
    expect(canUndoRound(session)).toBe(true);

    session = stageHit(session, { kind: 'number', value: 2, ring: 'single' });
    expect(canUndoStagedHit(session)).toBe(true);
    expect(canUndoRound(session)).toBe(false);
    expect(undoRound(session)).toBe(session);

    session = undoStagedHit(session);
    expect(canUndoStagedHit(session)).toBe(false);
    expect(canUndoRound(session)).toBe(true);
  });

  it('staging darts never grows the undo stack', () => {
    let session = baseballSession();
    const before = session.undo.length;
    session = stageHit(session, { kind: 'number', value: 1, ring: 'single' });
    session = stageHit(session, { kind: 'number', value: 1, ring: 'single' });
    expect(session.undo.length).toBe(before);
  });

  it('undoStagedHit is a no-op with nothing staged', () => {
    const session = baseballSession();
    expect(undoStagedHit(session)).toBe(session);
  });
});
