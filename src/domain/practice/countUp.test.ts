import { describe, expect, it } from 'vitest';
import {
  COUNT_UP_ROUNDS,
  activePlayer,
  applyRoundScore,
  awardCounts,
  awardForScore,
  canUndo,
  completedRounds,
  createCountUpGame,
  currentRound,
  defaultCountUpSettings,
  editRoundScore,
  formatPpr,
  InvalidRoundScoreError,
  isFinished,
  isValidRoundScore,
  normalizeName,
  outcome,
  parseRoundScore,
  pointsPerRound,
  totalEntries,
  totalScore,
  undoLastRound,
  type BullMode,
  type CountUpSettings,
  type CountUpState,
} from './countUp';

const SAMPLE = [60, 100, 80, 120, 40, 140, 50, 50];

function settings(patch: Partial<CountUpSettings> = {}): CountUpSettings {
  return { playerCount: 1, names: ['', ''], bullMode: 'separate', ...patch };
}

function play(state: CountUpState, scores: number[]): CountUpState {
  return scores.reduce((current, score) => applyRoundScore(current, score), state);
}

describe('COUNT-UP defaults', () => {
  it('defaults to 1 player and SEPARATE BULL', () => {
    expect(defaultCountUpSettings()).toEqual({ playerCount: 1, names: ['', ''], bullMode: 'separate' });
  });

  it('normalizes blank and whitespace-only names to PLAYER 1 / PLAYER 2', () => {
    expect(normalizeName('', 0)).toBe('PLAYER 1');
    expect(normalizeName('   ', 1)).toBe('PLAYER 2');
    expect(normalizeName('  なおき ', 0)).toBe('なおき');
  });

  it('applies the fallback names when the game is created', () => {
    const game = createCountUpGame(settings({ playerCount: 2, names: ['', ' '] }));
    expect(game.players.map((player) => player.name)).toEqual(['PLAYER 1', 'PLAYER 2']);
  });
});

describe('progression', () => {
  it('1 player: exactly 8 scoring rounds, then finished', () => {
    let game = createCountUpGame(settings());
    for (let round = 1; round <= COUNT_UP_ROUNDS; round += 1) {
      expect(isFinished(game)).toBe(false);
      expect(currentRound(game)).toBe(round);
      expect(activePlayer(game)).toBe(0);
      game = applyRoundScore(game, 60);
    }
    expect(isFinished(game)).toBe(true);
    expect(totalEntries(game)).toBe(8);
    expect(() => applyRoundScore(game, 60)).toThrow(InvalidRoundScoreError);
  });

  it('2 players: P1 then P2 in every round, 16 entries, finished only after round 8 P2', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    const order: number[] = [];
    for (let visit = 0; visit < COUNT_UP_ROUNDS * 2; visit += 1) {
      order.push(activePlayer(game));
      game = applyRoundScore(game, 40);
      // Everything but the very last visit leaves the game unfinished.
      expect(isFinished(game)).toBe(visit === COUNT_UP_ROUNDS * 2 - 1);
    }
    expect(order).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(totalEntries(game)).toBe(16);
    expect(completedRounds(game, 0)).toBe(8);
    expect(completedRounds(game, 1)).toBe(8);
  });

  it('reports the round being thrown for each player', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    expect(currentRound(game)).toBe(1);
    game = applyRoundScore(game, 60); // P1 round 1
    expect(currentRound(game)).toBe(1); // still round 1 - P2 to throw
    expect(activePlayer(game)).toBe(1);
    game = applyRoundScore(game, 60); // P2 round 1
    expect(currentRound(game)).toBe(2);
    expect(activePlayer(game)).toBe(0);
  });
});

describe('total and PPR', () => {
  it('totals the sample game correctly', () => {
    const game = play(createCountUpGame(settings()), SAMPLE);
    expect(totalScore(game, 0)).toBe(640);
    expect(isFinished(game)).toBe(true);
  });

  it('PPR is total / completed rounds', () => {
    const game = play(createCountUpGame(settings()), SAMPLE);
    expect(pointsPerRound(game, 0)).toBe(80);
    expect(formatPpr(pointsPerRound(game, 0))).toBe('80.00');

    const partial = play(createCountUpGame(settings()), [60, 100, 80]);
    expect(pointsPerRound(partial, 0)).toBeCloseTo(80, 10);
    expect(formatPpr(pointsPerRound(partial, 0))).toBe('80.00');

    const uneven = play(createCountUpGame(settings()), [61, 100]);
    expect(formatPpr(pointsPerRound(uneven, 0))).toBe('80.50');
  });

  it('is 0 (never NaN) with no completed rounds', () => {
    const game = createCountUpGame(settings());
    expect(pointsPerRound(game, 0)).toBe(0);
    expect(formatPpr(pointsPerRound(game, 0))).toBe('0.00');
  });

  it('computes each player separately in a 2-player game', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    game = applyRoundScore(game, 100); // P1
    game = applyRoundScore(game, 40); // P2
    game = applyRoundScore(game, 60); // P1
    expect(totalScore(game, 0)).toBe(160);
    expect(totalScore(game, 1)).toBe(40);
    expect(formatPpr(pointsPerRound(game, 0))).toBe('80.00');
    expect(formatPpr(pointsPerRound(game, 1))).toBe('40.00');
  });
});

describe('validation', () => {
  it('accepts every integer in 0...180 and rejects everything else', () => {
    expect(isValidRoundScore(0)).toBe(true);
    expect(isValidRoundScore(180)).toBe(true);
    expect(isValidRoundScore(-1)).toBe(false);
    expect(isValidRoundScore(181)).toBe(false);
    expect(isValidRoundScore(60.5)).toBe(false);
    expect(isValidRoundScore(Number.NaN)).toBe(false);
    expect(isValidRoundScore('60')).toBe(false);
    expect(isValidRoundScore(null)).toBe(false);
    expect(isValidRoundScore(undefined)).toBe(false);
  });

  it('parses only well-formed integer text', () => {
    expect(parseRoundScore('0')).toBe(0);
    expect(parseRoundScore('180')).toBe(180);
    expect(parseRoundScore(' 60 ')).toBe(60);
    expect(parseRoundScore('')).toBeNull();
    expect(parseRoundScore('  ')).toBeNull();
    expect(parseRoundScore('60.5')).toBeNull();
    expect(parseRoundScore('-1')).toBeNull();
    expect(parseRoundScore('181')).toBeNull();
    expect(parseRoundScore('abc')).toBeNull();
    expect(parseRoundScore('1e2')).toBeNull();
  });

  it('rejects an invalid score without touching the state', () => {
    const game = play(createCountUpGame(settings()), [60]);
    expect(() => applyRoundScore(game, 181)).toThrow(InvalidRoundScoreError);
    expect(() => applyRoundScore(game, -1)).toThrow(InvalidRoundScoreError);
    expect(() => applyRoundScore(game, 60.5)).toThrow(InvalidRoundScoreError);
    expect(() => applyRoundScore(game, Number.NaN)).toThrow(InvalidRoundScoreError);
    expect(game.players[0].scores).toEqual([60]);
  });
});

describe('awards', () => {
  const cases: Array<[number, BullMode, string | null]> = [
    [0, 'separate', null],
    [99, 'separate', null],
    [100, 'separate', 'LOW_TON'],
    [149, 'separate', 'LOW_TON'],
    [150, 'fat', 'HAT_TRICK'],
    [150, 'separate', 'THREE_IN_THE_BLACK'],
    [151, 'separate', 'HIGH_TON'],
    [179, 'separate', 'HIGH_TON'],
    [180, 'separate', 'TON_80'],
    [180, 'fat', 'TON_80'],
  ];

  for (const [score, bullMode, expected] of cases) {
    it(`${score} with ${bullMode} bull is ${expected ?? 'no award'}`, () => {
      expect(awardForScore(score, bullMode)).toBe(expected);
    });
  }

  it('gives a round at most one award category', () => {
    const fat = play(createCountUpGame(settings({ bullMode: 'fat' })), [150]);
    expect(awardCounts(fat, 0)).toEqual({
      LOW_TON: 0,
      HIGH_TON: 0,
      TON_80: 0,
      HAT_TRICK: 1,
      THREE_IN_THE_BLACK: 0,
    });

    const separate = play(createCountUpGame(settings()), [150]);
    expect(awardCounts(separate, 0)).toEqual({
      LOW_TON: 0,
      HIGH_TON: 0,
      TON_80: 0,
      HAT_TRICK: 0,
      THREE_IN_THE_BLACK: 1,
    });
  });

  it('counts awards across a whole game', () => {
    const game = play(createCountUpGame(settings()), [100, 140, 160, 180, 99, 150, 45, 179]);
    expect(awardCounts(game, 0)).toEqual({
      LOW_TON: 2,
      HIGH_TON: 2,
      TON_80: 1,
      HAT_TRICK: 0,
      THREE_IN_THE_BLACK: 1,
    });
  });
});

describe('editing a past round', () => {
  it('recalculates total, PPR and awards from the history', () => {
    let game = play(createCountUpGame(settings({ bullMode: 'fat' })), [120, 60, 60, 60, 60, 60, 60, 60]);
    expect(awardCounts(game, 0).LOW_TON).toBe(1);
    expect(totalScore(game, 0)).toBe(540);

    game = editRoundScore(game, 0, 0, 150);
    expect(awardCounts(game, 0).LOW_TON).toBe(0);
    expect(awardCounts(game, 0).HAT_TRICK).toBe(1);
    expect(totalScore(game, 0)).toBe(570);
    expect(formatPpr(pointsPerRound(game, 0))).toBe('71.25');

    // ...and back again: the aggregates are rebuilt, never nudged.
    game = editRoundScore(game, 0, 0, 120);
    expect(awardCounts(game, 0)).toEqual({
      LOW_TON: 1,
      HIGH_TON: 0,
      TON_80: 0,
      HAT_TRICK: 0,
      THREE_IN_THE_BLACK: 0,
    });
    expect(totalScore(game, 0)).toBe(540);
  });

  it('edits the right player only, and revalidates the new score', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    game = play(game, [100, 40, 60, 20]);
    game = editRoundScore(game, 1, 0, 180);
    expect(game.players[0].scores).toEqual([100, 60]);
    expect(game.players[1].scores).toEqual([180, 20]);
    expect(awardCounts(game, 1).TON_80).toBe(1);

    expect(() => editRoundScore(game, 0, 0, 181)).toThrow(InvalidRoundScoreError);
    expect(() => editRoundScore(game, 0, 5, 60)).toThrow(InvalidRoundScoreError);
  });

  it('can still be corrected after the game has finished', () => {
    let game = play(createCountUpGame(settings()), SAMPLE);
    expect(isFinished(game)).toBe(true);
    game = editRoundScore(game, 0, 7, 180);
    expect(totalScore(game, 0)).toBe(770);
    expect(awardCounts(game, 0).TON_80).toBe(1);
    expect(isFinished(game)).toBe(true);
  });
});

describe('undo', () => {
  it('takes back the most recent entry, in turn order', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    expect(canUndo(game)).toBe(false);
    expect(undoLastRound(game)).toBe(game);

    game = play(game, [100, 40]);
    game = undoLastRound(game); // undoes P2
    expect(game.players[0].scores).toEqual([100]);
    expect(game.players[1].scores).toEqual([]);
    game = undoLastRound(game); // undoes P1
    expect(game.players[0].scores).toEqual([]);
    expect(canUndo(game)).toBe(false);
  });
});

describe('winner', () => {
  it('has no outcome until the game is finished', () => {
    const game = play(createCountUpGame(settings()), [60, 60]);
    expect(outcome(game)).toBeNull();
  });

  it('1 player finishes with no winner at all', () => {
    const game = play(createCountUpGame(settings()), SAMPLE);
    expect(outcome(game)).toEqual({ kind: 'solo' });
  });

  it('2 players: the higher TOTAL wins, regardless of PPR or awards', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    for (let round = 0; round < COUNT_UP_ROUNDS; round += 1) {
      game = applyRoundScore(game, 60); // P1: 480 total
      game = applyRoundScore(game, 61); // P2: 488 total
    }
    expect(totalScore(game, 0)).toBe(480);
    expect(totalScore(game, 1)).toBe(488);
    expect(outcome(game)).toEqual({ kind: 'winner', player: 1 });
  });

  it('2 players: an equal TOTAL is a draw', () => {
    let game = createCountUpGame(settings({ playerCount: 2 }));
    // Different shapes, identical totals - a draw is decided on TOTAL alone.
    for (const [p1, p2] of [
      [100, 60],
      [60, 100],
      [180, 20],
      [20, 180],
      [45, 45],
      [45, 45],
      [45, 45],
      [45, 45],
    ]) {
      game = applyRoundScore(game, p1);
      game = applyRoundScore(game, p2);
    }
    expect(totalScore(game, 0)).toBe(totalScore(game, 1));
    expect(outcome(game)).toEqual({ kind: 'draw' });
  });
});
