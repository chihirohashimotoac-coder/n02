import type { X01MatchState, X01Visit } from './x01Engine';

/**
 * Play-screen statistics for 通常01・チェックアウト練習, defined exactly as n01 (Web) defines them.
 *
 * Reference: n01 Web's n01_stats.js (`init`, `calcPlayer`, `calcLeg`, `getCheckoutCount`) and the
 * legData its n01.js stores (`nextScore`, `finish`, `middle`). The version this was checked against,
 * and the test that runs those reference functions on the same records, are in x01Stats.n01.test.ts.
 *
 * Read-only by construction: the match state is never written, and nothing here feeds back into the
 * engine, the save, or the darts a visit was recorded with. n01 counts every ordinary visit as three
 * darts and only a finish by its declared count, so a visit n02 saved as 1 or 2 darts still counts
 * as three HERE, while x01Engine keeps the darts that were actually used.
 *
 * The work is split the way n01 splits it:
 *   buildN01Legs()          n02 state -> n01's legData (the adapter)
 *   computeN01PlayerStats() legData -> n01's per-player totals (calcPlayer / calcLeg)
 *   selectX01Stats()        totals -> the strings n01 shows (init)
 */

/** One cell of n01's `playerData[player]`: index 0 is the start, then one entry per visit. */
export interface N01Round {
  /** Points scored, 0 for a bust; a finish is stored as minus the darts it took. */
  score: number;
  /** Remaining after the visit (the start score at index 0). */
  left: number;
}

/** The fields of one n01 leg that the statistics read. */
export interface N01Leg {
  first: 0 | 1;
  /** Index of the round in progress (0-based), or of the deciding round once the leg is over. */
  currentRound: number;
  currentPlayer: 0 | 1;
  endFlag: 0 | 1;
  /** 1 when the leg ended without a checkout: a 判定 (decided winner) or a draw. */
  middleForDiddle: 0 | 1;
  winner: -1 | 0 | 1;
  playerData: [N01Round[], N01Round[]];
}

export type N01LegsResult = { ok: true; legs: N01Leg[] } | { ok: false; reason: string };

/** n01's per-player totals, named as in n01_stats.js. */
export interface N01PlayerStats {
  winLegs: number;
  s60Count: number;
  s80Count: number;
  ton00Count: number;
  ton20Count: number;
  ton40Count: number;
  ton70Count: number;
  ton80Count: number;
  highOut: number;
  highOutCount: number;
  bestLeg: number;
  worstLeg: number;
  allScore: number;
  allDarts: number;
  winDarts: number;
  winCount: number;
  first9Score: number;
  first9Darts: number;
  checkout: number;
  breakCnt: number;
  secondCnt: number;
}

/**
 * n01 counts the score bands two ways. The default view folds them into 100-139 / 140-179; its
 * "Details" view splits them into 100-119 / 120-139 / 140-169 / 170-179. The same visit therefore
 * shows under a different 100+ / 140+ depending on the view, as it does in n01.
 */
export type N01BandMode = 'basic' | 'details';

/** Thrown for a save that cannot be turned back into n01's legData. Caught by buildN01Legs(). */
class UnreproducibleError extends Error {}

const other = (player: 0 | 1): 0 | 1 => (player === 0 ? 1 : 0);

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isPlayer(value: unknown): value is 0 | 1 {
  return value === 0 || value === 1;
}

interface LegRecord {
  legStarter: unknown;
  playerStartScores?: unknown;
  visits?: unknown;
}

/**
 * One player's n01 `playerData` for an n02 leg record: the start, then each of their visits in order
 * as {score, left}. A bust is a 0 that leaves the remaining unchanged, which is what an n01 player
 * enters for one. Every visit's `before` must continue the chain, so a record that does not add up is
 * refused rather than quietly reinterpreted.
 */
function playerRounds(record: LegRecord, player: 0 | 1, where: string): N01Round[] {
  const starts = record.playerStartScores;
  if (!Array.isArray(starts) || !isInt(starts[player]) || starts[player] <= 0) {
    throw new UnreproducibleError(`${where}: 開始点（playerStartScores）が保存されていません。`);
  }
  const rounds: N01Round[] = [{ score: 0, left: starts[player] }];
  for (const visit of record.visits as X01Visit[]) {
    if (visit.player !== player) continue;
    const previous = rounds[rounds.length - 1].left;
    const valid =
      isInt(visit.score) &&
      isInt(visit.before) &&
      isInt(visit.after) &&
      typeof visit.bust === 'boolean' &&
      visit.before === previous &&
      visit.checkout !== true &&
      (visit.bust
        ? visit.score === 0 && visit.after === visit.before
        : visit.score >= 0 && visit.score <= 180 && visit.after === visit.before - visit.score && visit.after > 0);
    if (!valid) throw new UnreproducibleError(`${where}: 得点記録の残り点数が連続していません。`);
    rounds.push({ score: visit.score, left: visit.after });
  }
  return rounds;
}

/**
 * The parts of a leg record shared by every leg shape: who threw first, and both players' rounds.
 * n02 alternates strictly from `legStarter` (a starter can only be changed on an empty leg, and the
 * score swap swaps the starter with it), so a record that does not alternate is not a real one.
 */
function legBase(record: LegRecord, where: string) {
  if (!isPlayer(record.legStarter) || !Array.isArray(record.visits)) {
    throw new UnreproducibleError(`${where}: 先攻または得点記録が保存されていません。`);
  }
  const first = record.legStarter;
  const visits = record.visits as X01Visit[];
  visits.forEach((visit, index) => {
    if (visit?.player !== (index % 2 === 0 ? first : other(first))) {
      throw new UnreproducibleError(`${where}: 投げ順が先攻からの交互になっていません。`);
    }
  });
  const playerData: [N01Round[], N01Round[]] = [playerRounds(record, 0, where), playerRounds(record, 1, where)];
  /** Visits by the first and the second thrower: equal, or the first one ahead by one. */
  const firstVisits = playerData[first].length - 1;
  const secondVisits = playerData[other(first)].length - 1;
  return { first, visits, playerData, firstVisits, secondVisits };
}

/** A leg still being played: n01's state between two inputs, endFlag 0. */
function inProgressLeg(record: LegRecord, where: string): N01Leg {
  const { first, playerData, firstVisits, secondVisits } = legBase(record, where);
  // n01 moves to the second thrower after the first one's input, and opens the next round (back to
  // the first thrower) only after the second one's.
  const secondToThrow = firstVisits === secondVisits + 1;
  return {
    first,
    currentRound: secondVisits,
    currentPlayer: secondToThrow ? other(first) : first,
    endFlag: 0,
    middleForDiddle: 0,
    winner: -1,
    playerData,
  };
}

type CompletedLeg = X01MatchState['completed'][number];

/**
 * A leg won on a checkout, as n01's finish() stores it.
 *
 * `completed.restore` is the state just before the deciding visit, so the visit itself is rebuilt:
 * it was thrown from the winner's remaining at that moment, took it to 0, and used
 * `completed.darts - restore.legDarts[winner]` darts. n01 stores it as score = -darts, left = 0.
 */
function checkoutLeg(entry: CompletedLeg, where: string): N01Leg {
  const restore = entry.restore;
  const winner = entry.winner;
  if (!isPlayer(winner)) throw new UnreproducibleError(`${where}: 上がりの勝者が保存されていません。`);
  const { first, visits, playerData } = legBase(restore, where);
  const expectedThrower = visits.length % 2 === 0 ? first : other(first);
  if (restore.active !== winner || expectedThrower !== winner) {
    throw new UnreproducibleError(`${where}: 上がりの手番が得点記録と一致しません。`);
  }
  const legDarts = restore.legDarts;
  if (!Array.isArray(legDarts) || !isInt(legDarts[winner]) || !isInt(entry.darts)) {
    throw new UnreproducibleError(`${where}: 上がり本数を復元できる使用ダーツ数が保存されていません。`);
  }
  const finishDarts = entry.darts - legDarts[winner];
  if (finishDarts < 1 || finishDarts > 3) {
    throw new UnreproducibleError(`${where}: 上がり本数が1～3本になりません。`);
  }
  const before = restore.players?.[winner]?.remaining;
  const winnerRounds = playerData[winner];
  if (!isInt(before) || before <= 1 || before !== winnerRounds[winnerRounds.length - 1].left) {
    throw new UnreproducibleError(`${where}: 上がり直前の残り点数が得点記録と一致しません。`);
  }
  winnerRounds.push({ score: -finishDarts, left: 0 });
  return {
    first,
    // The deciding round: the winner's ordinary visits before the finish.
    currentRound: winnerRounds.length - 2,
    currentPlayer: winner,
    endFlag: 1,
    middleForDiddle: 0,
    winner,
    playerData,
  };
}

/**
 * A leg ended without a checkout - a round-limit decision or a draw - as n01's middle() stores it:
 * the leg is cut at the round in progress (a first thrower's visit in a round the second thrower
 * never got to is discarded) and nothing is invented for the missing finish.
 */
function middleLeg(entry: CompletedLeg, where: string): N01Leg {
  const { first, playerData, secondVisits } = legBase(entry.restore, where);
  const winner = entry.winner;
  if (winner !== null && !isPlayer(winner)) throw new UnreproducibleError(`${where}: 勝者の記録が不正です。`);
  const round = secondVisits;
  return {
    first,
    currentRound: round,
    currentPlayer: first,
    endFlag: 1,
    middleForDiddle: 1,
    winner: winner ?? -1,
    playerData: [playerData[0].slice(0, round + 1), playerData[1].slice(0, round + 1)],
  };
}

/**
 * The adapter: this match, from its first leg up to the leg in progress, as n01's legData.
 *
 * Built only from `completed` (each finished leg, with the state that ended it) and the live leg.
 * `undo` snapshots, the 50-leg history and anything in `players` are never read - so an Undo, a
 * correction, a rewind to the previous leg, a score swap or a new starter is reflected simply by
 * calling this again on the new state. A leg that has just finished is already in `completed` and
 * is not counted a second time from the live state.
 */
export function buildN01Legs(state: X01MatchState): N01LegsResult {
  try {
    if (!Array.isArray(state.completed)) throw new UnreproducibleError('Legの記録が保存されていません。');
    const legs = state.completed.map((entry, index) => {
      const where = `Leg ${index + 1}`;
      if (!entry || typeof entry.restore !== 'object' || entry.restore === null) {
        throw new UnreproducibleError(`${where}: 終了時の記録（restore）が保存されていません。`);
      }
      if (entry.reason === 'checkout') return checkoutLeg(entry, where);
      if (entry.reason === 'draw' || entry.reason === 'round-limit') return middleLeg(entry, where);
      throw new UnreproducibleError(`${where}: 終了理由（reason）が保存されていません。`);
    });
    const currentFinished = state.legResult !== null && state.completed.length >= state.leg;
    if (!currentFinished) legs.push(inProgressLeg(state, `Leg ${state.completed.length + 1}`));
    return { ok: true, legs };
  } catch (error) {
    if (error instanceof UnreproducibleError) return { ok: false, reason: error.message };
    throw error;
  }
}

function emptyStats(): N01PlayerStats {
  return {
    winLegs: 0,
    s60Count: 0,
    s80Count: 0,
    ton00Count: 0,
    ton20Count: 0,
    ton40Count: 0,
    ton70Count: 0,
    ton80Count: 0,
    highOut: 0,
    highOutCount: 0,
    bestLeg: 0,
    worstLeg: 0,
    allScore: 0,
    allDarts: 0,
    winDarts: 0,
    winCount: 0,
    first9Score: 0,
    first9Darts: 0,
    checkout: 0,
    breakCnt: 0,
    secondCnt: 0,
  };
}

/** Adds one score to the 60+ ... 180 bands. Visits and checkout points go through the same bands. */
function countBands(stats: N01PlayerStats, score: number, mode: N01BandMode): void {
  if (score >= 60 && score < 80) stats.s60Count++;
  if (score >= 80 && score < 100) stats.s80Count++;
  if (mode === 'details') {
    if (score >= 100 && score < 120) stats.ton00Count++;
    if (score >= 120 && score < 140) stats.ton20Count++;
    if (score >= 140 && score < 170) stats.ton40Count++;
    if (score >= 170 && score < 180) stats.ton70Count++;
  } else {
    if (score >= 100 && score < 140) stats.ton00Count++;
    if (score >= 140 && score < 180) stats.ton40Count++;
  }
  if (score === 180) stats.ton80Count++;
}

/**
 * n01's checkout-opportunity estimate: how many darts at a double a visit is assumed to have had,
 * judged only from the remaining before (`oldLeft`) and after (`left`) it. `finish` is the darts a
 * finish took, 0 for an ordinary visit. This is n01's "Checkout Prediction", not a recorded count of
 * darts thrown at a double, and every branch is n01's own.
 */
export function n01CheckoutCount(left: number, oldLeft: number, finish: number): number {
  const twoDartRange = (value: number) =>
    value < 99 || value === 100 || value === 101 || value === 104 || value === 107 || value === 110;
  const oneDartDouble = (value: number) => value === 50 || (value <= 40 && value % 2 === 0);
  if (left === 0) {
    if (oldLeft > 50) {
      if (twoDartRange(oldLeft)) return finish === 1 ? 1 : finish - 1;
      return 1;
    } else if (oneDartDouble(oldLeft)) {
      return finish;
    } else {
      return finish === 1 ? 1 : finish - 1;
    }
  }
  if (left === oldLeft || left < 50) {
    if (oldLeft > 50) {
      if (twoDartRange(oldLeft)) return left === oldLeft || left <= 40 ? 2 : 1;
      if (oldLeft <= 158 || oldLeft === 160 || oldLeft === 161 || oldLeft === 164 || oldLeft === 167 || oldLeft === 170) {
        return 1;
      }
      return 0;
    } else if (oneDartDouble(oldLeft)) {
      return left === oldLeft || left <= 40 ? 3 : 1;
    } else {
      return left === oldLeft || left <= 40 ? 2 : 0;
    }
  }
  return 0;
}

/** One leg's contribution to one player's totals (n01's calcLeg). */
function addLeg(stats: N01PlayerStats, player: 0 | 1, leg: N01Leg, mode: N01BandMode): void {
  const rounds = leg.playerData[player];
  // How many of this player's ordinary visits the leg holds. The first thrower is one ahead while
  // the second is still to throw in the round; a cut (middle) leg holds the same count for both.
  let round =
    (leg.first !== leg.currentPlayer && leg.currentPlayer === player) ||
    leg.first === leg.currentPlayer ||
    leg.middleForDiddle === 1
      ? leg.currentRound
      : leg.currentRound + 1;
  let first9Score = 0;
  let first9Darts = 0;
  for (let i = 1; i <= round; i++) {
    if (rounds[i] === undefined) {
      round = i - 1;
      break;
    }
    const score = rounds[i].score;
    countBands(stats, score, mode);
    if (i <= 3) {
      first9Score += score;
      first9Darts += 3;
    }
    // Opportunities are judged from the second visit on: the first one has no earlier remaining.
    if (i > 1) stats.checkout += n01CheckoutCount(rounds[i].left, rounds[i - 1].left, 0);
  }
  if (leg.endFlag === 1 && leg.winner === player) {
    stats.winLegs++;
    if (leg.middleForDiddle === 0) {
      const finishDarts = rounds[leg.currentRound + 1].score * -1;
      const allScore = rounds[0].left;
      const allDarts = leg.currentRound * 3 + finishDarts;
      stats.allScore += allScore;
      stats.allDarts += allDarts;
      // Checked out within the first three visits: First 9 is the whole leg.
      if (leg.currentRound + 1 <= 3) {
        first9Score = allScore;
        first9Darts = allDarts;
      }
      const highOut = rounds[leg.currentRound].left;
      if (stats.highOut < highOut) stats.highOut = highOut;
      if (highOut >= 100) stats.highOutCount++;
      countBands(stats, highOut, mode);
      if (stats.bestLeg === 0 || stats.bestLeg > allDarts) stats.bestLeg = allDarts;
      if (stats.worstLeg < allDarts) stats.worstLeg = allDarts;
      stats.winCount++;
      stats.winDarts += allDarts;
      stats.checkout += n01CheckoutCount(0, rounds[leg.currentRound].left, finishDarts);
    } else {
      // Won on a decision: no finish, no High Finish, and one dart more than the visits taken.
      const allScore = rounds[0].left - rounds[round].left;
      const allDarts = round * 3;
      stats.allScore += allScore;
      stats.allDarts += allDarts;
      if (stats.bestLeg === 0 || stats.bestLeg > allDarts + 1) stats.bestLeg = allDarts + 1;
      if (stats.worstLeg < allDarts + 1) stats.worstLeg = allDarts + 1;
      stats.winCount++;
      stats.winDarts += allDarts + 1;
    }
  } else {
    stats.allScore += rounds[0].left - rounds[round].left;
    stats.allDarts += round * 3;
  }
  stats.first9Score += first9Score;
  stats.first9Darts += first9Darts;
  // Every finished leg thrown second counts, a draw included; winning it is a break.
  if (leg.endFlag === 1 && leg.first !== player) {
    if (leg.winner === player) stats.breakCnt++;
    stats.secondCnt++;
  }
}

/** One player's totals over the legs, stopping after the first leg still in progress (calcPlayer). */
export function computeN01PlayerStats(legs: N01Leg[], player: 0 | 1, mode: N01BandMode): N01PlayerStats {
  const stats = emptyStats();
  for (const leg of legs) {
    addLeg(stats, player, leg, mode);
    if (leg.endFlag === 0) break;
  }
  return stats;
}

/** A rate as n01 prints it: "50.0%" over "(1 / 2)". */
export interface X01RateDisplay {
  percent: string;
  numerator: number;
  denominator: number;
}

export interface X01PlayerStatsDisplay {
  /** 3 Darts: three times the points per dart, two decimals. */
  average: string;
  /** The same figure unrounded, for the footer's shorter 3DA. */
  averageValue: number;
  first9: string;
  legs: number;
  s60: number;
  s80: number;
  ton00: number;
  ton20: number;
  ton40: number;
  ton70: number;
  ton80: number;
  highFinish: number;
  highFinishCount: number;
  bestLeg: number;
  worstLeg: number;
  checkout: X01RateDisplay;
  keep: X01RateDisplay;
  break: X01RateDisplay;
}

export type X01StatsView =
  | { ok: true; mode: N01BandMode; players: [X01PlayerStatsDisplay, X01PlayerStatsDisplay] }
  | { ok: false; reason: string };

/** n01 leaves a rate at its initial "0.0% (0 / 0)" until its condition holds. */
const ZERO_RATE: X01RateDisplay = { percent: '0.0%', numerator: 0, denominator: 0 };

function rate(numerator: number, denominator: number): X01RateDisplay {
  return { percent: `${((numerator / denominator) * 100).toFixed(1)}%`, numerator, denominator };
}

function display(stats: N01PlayerStats, keep: X01RateDisplay): X01PlayerStatsDisplay {
  const averageValue = stats.allDarts > 0 ? (stats.allScore / stats.allDarts) * 3 : 0;
  return {
    average: averageValue.toFixed(2),
    averageValue,
    first9: stats.first9Darts > 0 ? ((stats.first9Score / stats.first9Darts) * 3).toFixed(2) : '0.00',
    legs: stats.winLegs,
    s60: stats.s60Count,
    s80: stats.s80Count,
    ton00: stats.ton00Count,
    ton20: stats.ton20Count,
    ton40: stats.ton40Count,
    ton70: stats.ton70Count,
    ton80: stats.ton80Count,
    highFinish: stats.highOut,
    highFinishCount: stats.highOutCount,
    bestLeg: stats.bestLeg,
    worstLeg: stats.worstLeg,
    checkout: stats.checkout > 0 ? rate(stats.winLegs, stats.checkout) : ZERO_RATE,
    keep,
    break: stats.secondCnt ? rate(stats.breakCnt, stats.secondCnt) : ZERO_RATE,
  };
}

/**
 * Keep for `player`: the legs they won when not throwing second, over every leg won by anyone less
 * the legs they threw second. n01 shows it whenever that denominator is non-zero - including a
 * negative one, which draws can produce - and the result is printed as is, never clamped to 0-100%.
 */
function keepRate(own: N01PlayerStats, opponent: N01PlayerStats): X01RateDisplay {
  const denominator = own.winLegs + opponent.winLegs - own.secondCnt;
  if (!denominator) return ZERO_RATE;
  return rate(own.winLegs - own.breakCnt, denominator);
}

/**
 * The one selector every statistics surface reads - the side panels, the 詳細 dialog, the footer
 * 3DA and the match result - so a figure with the same name means the same thing everywhere.
 */
export function selectX01Stats(state: X01MatchState, mode: N01BandMode): X01StatsView {
  const built = buildN01Legs(state);
  if (!built.ok) return built;
  const p0 = computeN01PlayerStats(built.legs, 0, mode);
  const p1 = computeN01PlayerStats(built.legs, 1, mode);
  return { ok: true, mode, players: [display(p0, keepRate(p0, p1)), display(p1, keepRate(p1, p0))] };
}
