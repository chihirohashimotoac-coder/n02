import { describe, expect, it } from 'vitest';
import {
  advanceDiscipline,
  applyTurn,
  canUndo,
  computeNextStarter,
  computeTotals,
  createPentathlonSession,
  currentDisciplineId,
  disciplineCount,
  isDisciplineComplete,
  undo,
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
 * 2-player: the starter checks out in 9 darts while the opponent lags, then the opponent finishes
 * in 15. Turns interleave, so this also exercises the "finished player is skipped" path.
 */
function play501TwoPlayers(session: PentathlonSession): PentathlonSession {
  let next = applyTurn(session, { score: 180 }); // starter -> 321
  next = applyTurn(next, { score: 26 }); // opponent -> 475
  next = applyTurn(next, { score: 180 }); // starter -> 141
  next = applyTurn(next, { score: 26 }); // opponent -> 449
  next = applyTurn(next, { score: 141, finishDarts: 3 }); // starter OUT in 9
  next = applyTurn(next, { score: 180 }); // opponent -> 269
  next = applyTurn(next, { score: 180 }); // opponent -> 89
  return applyTurn(next, { score: 89, finishDarts: 3 }); // opponent OUT in 15
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

  it('does NOT end the discipline when one player finishes - the other plays on', () => {
    let session = newSession({ initialStarter: 0 });
    // P1 finishes in 9 darts while P2 scores poorly.
    session = applyTurn(session, { score: 180 }); // P1 -> 321
    session = applyTurn(session, { score: 26 }); // P2 -> 475
    session = applyTurn(session, { score: 180 }); // P1 -> 141
    session = applyTurn(session, { score: 26 }); // P2 -> 449
    session = applyTurn(session, { score: 141, finishDarts: 3 }); // P1 OUT in 9
    // P1's own result is now locked in and must not change while P2 plays on.

    expect(session.current!.progress[0].finished).toBe(true);
    expect(session.current!.progress[0].result!.label).toBe('9 DARTS');
    expect(isDisciplineComplete(session)).toBe(false);
    expect(session.status).toBe('playing');
    // Play must now stay with P2 for every subsequent turn.
    expect(session.current!.active).toBe(1);
    session = applyTurn(session, { score: 100 });
    expect(session.current!.active).toBe(1);
  });

  it('completes the discipline only once BOTH players have final results', () => {
    const session = play501TwoPlayers(newSession({ initialStarter: 0 }));

    expect(isDisciplineComplete(session)).toBe(true);
    expect(session.status).toBe('between-disciplines');
    const record = session.records[0];
    expect(record.results[0]!.label).toBe('9 DARTS');
    expect(record.results[1]!.label).toBe('15 DARTS');
    expect(record.outcome).toBe('p0'); // fewer darts wins 501
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
    session = undo(session);
    expect(session.current!.active).toBe(0);
    const state = session.current!.progress[0].state as { remaining: number };
    expect(state.remaining).toBe(501);
  });

  it('restores a finished player back to unfinished', () => {
    let session = newSession({ playerCount: 1 });
    session = play501Finish(session);
    expect(session.current!.progress[0].finished).toBe(true);
    session = undo(session);
    expect(session.current!.progress[0].finished).toBe(false);
    expect(session.current!.progress[0].result).toBeNull();
  });

  it('reverts a discipline advance, restoring the previous discipline and its records', () => {
    let session = newSession({ playerCount: 1 });
    session = play501Finish(session);
    session = advanceDiscipline(session);
    expect(currentDisciplineId(session)).toBe('half-it');
    session = undo(session);
    expect(currentDisciplineId(session)).toBe('x01-501');
    expect(session.status).toBe('between-disciplines');
    expect(session.records).toHaveLength(1);
  });

  it('recomputes correctly after undo (redoing the turn gives the same state)', () => {
    let session = newSession({ playerCount: 1 });
    session = applyTurn(session, { score: 180 });
    const afterFirst = structuredClone(session.current!.progress[0].state);
    session = applyTurn(session, { score: 100 });
    session = undo(session);
    expect(session.current!.progress[0].state).toEqual(afterFirst);
    session = applyTurn(session, { score: 100 });
    const state = session.current!.progress[0].state as { remaining: number; darts: number };
    expect(state.remaining).toBe(221);
    expect(state.darts).toBe(6);
  });

  it('is a no-op with nothing to undo', () => {
    const session = newSession();
    expect(canUndo(session)).toBe(false);
    expect(undo(session)).toBe(session);
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
