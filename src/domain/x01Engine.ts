import { resolveVisit, InvalidVisitError } from './x01Core';
import { isCheckoutPossible, isReachableScore } from './darts';
import { simulateComVisit } from './comPlayer';

export { InvalidVisitError };

export interface X01PlayerStats {
  name: string;
  remaining: number;
  legs: number;
  totalDarts: number;
  totalScored: number;
  ton00Count: number;
  ton40Count: number;
  ton80Count: number;
  first9Score: number;
  first9Darts: number;
  checkouts: number;
  finishDarts: number[];
  highestFinish: number;
}

export interface X01Visit {
  player: 0 | 1;
  score: number;
  before: number;
  after: number;
  darts: number;
  bust: boolean;
  checkout: boolean;
}

export interface X01Settings {
  mode: '01' | 'checkout';
  startScore: number;
  checkoutMin: number;
  checkoutMax: number;
  targetLegs: number;
  showRoute: boolean;
  names: [string, string];
  roundLimit: boolean;
  maxRounds: number;
  comEnabled: [boolean, boolean];
  comLevels: [number, number];
  handicapEnabled: [boolean, boolean];
  handicapScores: [number, number];
}

export type LegEndReason = 'checkout' | 'draw' | 'round-limit';

interface X01CoreState {
  players: [X01PlayerStats, X01PlayerStats];
  active: 0 | 1;
  leg: number;
  legStarter: 0 | 1;
  startScore: number;
  playerStartScores: [number, number];
  visits: X01Visit[];
  legDarts: [number, number];
  /**
   * Each player's cumulative stats as of the start of this leg (i.e. carrying forward every prior
   * leg's contribution). editVisit() rebuilds from this baseline rather than from zero, so correcting
   * a visit in leg 2+ doesn't erase darts/scoring/checkouts earned in earlier legs.
   */
  legStartStats: [X01PlayerStats, X01PlayerStats];
}

export interface X01MatchState extends X01CoreState {
  settings: X01Settings;
  completed: Array<{
    winner: 0 | 1 | null;
    startScore: number;
    darts: number;
    reason: LegEndReason;
    restore: X01CoreState;
  }>;
  undo: X01CoreState[];
  legResult: { winner: 0 | 1 | null; darts: number; reason: LegEndReason } | null;
  matchWinner: 0 | 1 | null;
}

export function computeDefaultMaxRounds(startScore: number): number {
  return Math.ceil(startScore / 34);
}

export function threeDartAverage(stats: X01PlayerStats): number {
  return stats.totalDarts > 0 ? (stats.totalScored / stats.totalDarts) * 3 : 0;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function newPlayerStats(name: string): X01PlayerStats {
  return {
    name,
    remaining: 0,
    legs: 0,
    totalDarts: 0,
    totalScored: 0,
    ton00Count: 0,
    ton40Count: 0,
    ton80Count: 0,
    first9Score: 0,
    first9Darts: 0,
    checkouts: 0,
    finishDarts: [],
    highestFinish: 0,
  };
}

/**
 * Every remaining score in [min, max] that is worth setting as a checkout challenge: either a real
 * double-out finish, or above 170 (where the practice is getting *into* a finish over several
 * rounds). Bogey numbers like 159/162/163 are excluded because they can never be checked out.
 */
function checkoutTargetCandidates(min: number, max: number): number[] {
  const lo = Math.max(2, Math.min(min, max));
  const hi = Math.max(lo, max);
  const candidates: number[] = [];
  for (let target = lo; target <= hi; target += 1) {
    if (target > 170 || isCheckoutPossible(target)) candidates.push(target);
  }
  return candidates;
}

/**
 * The one checkout challenge for a leg. Drawn once and shared by both players - checkout practice is
 * two people attacking the *same* number - and, where the range allows it, never the same number as
 * the leg that just finished.
 */
function randomCheckoutTarget(settings: X01Settings, previousTarget?: number): number {
  const candidates = checkoutTargetCandidates(settings.checkoutMin, settings.checkoutMax);
  const pool = candidates.length > 1 ? candidates.filter((target) => target !== previousTarget) : candidates;
  return pool[Math.floor(Math.random() * pool.length)] ?? Math.max(2, settings.checkoutMin);
}

function legStartScore(settings: X01Settings, previousTarget?: number): number {
  if (settings.mode === 'checkout') return randomCheckoutTarget(settings, previousTarget);
  return settings.startScore;
}

/**
 * Per-player starting scores for a leg. Handicaps only apply to 01 - in checkout practice both
 * players always start from the identical challenge score.
 */
function playerStartScores(settings: X01Settings, legStart: number): [number, number] {
  if (settings.mode === 'checkout') return [legStart, legStart];
  return [
    settings.handicapEnabled[0] ? settings.handicapScores[0] : legStart,
    settings.handicapEnabled[1] ? settings.handicapScores[1] : legStart,
  ];
}

function coreForNewLeg(
  settings: X01Settings,
  leg: number,
  legStarter: 0 | 1,
  players: [X01PlayerStats, X01PlayerStats],
  previousTarget?: number,
): X01CoreState {
  const legStart = legStartScore(settings, previousTarget);
  const [p0Start, p1Start] = playerStartScores(settings, legStart);
  const nextPlayers: [X01PlayerStats, X01PlayerStats] = [
    { ...players[0], remaining: p0Start },
    { ...players[1], remaining: p1Start },
  ];
  return {
    players: nextPlayers,
    active: legStarter,
    leg,
    legStarter,
    startScore: legStart,
    playerStartScores: [p0Start, p1Start],
    visits: [],
    legDarts: [0, 0],
    legStartStats: clone(nextPlayers),
  };
}

export function createX01Match(settings: X01Settings): X01MatchState {
  const players: [X01PlayerStats, X01PlayerStats] = [
    newPlayerStats(settings.names[0]),
    newPlayerStats(settings.names[1]),
  ];
  const core = coreForNewLeg(settings, 1, 0, players);
  return {
    ...core,
    settings,
    completed: [],
    undo: [],
    legResult: null,
    matchWinner: null,
  };
}

function coreSnapshot(state: X01MatchState): X01CoreState {
  return {
    players: clone(state.players),
    active: state.active,
    leg: state.leg,
    legStarter: state.legStarter,
    startScore: state.startScore,
    playerStartScores: clone(state.playerStartScores),
    visits: clone(state.visits),
    legDarts: clone(state.legDarts),
    legStartStats: clone(state.legStartStats),
  };
}

/** Applies one visit for the currently-active player. Pushes an undo snapshot first. */
export function applyVisit(state: X01MatchState, enteredScore: number, finishDarts?: number): X01MatchState {
  if (state.matchWinner !== null || state.legResult !== null) return state;

  const player = state.active;
  const before = state.players[player].remaining;
  const resolution = resolveVisit(before, enteredScore, finishDarts);

  const undoStack = [...state.undo, coreSnapshot(state)];
  const players = clone(state.players) as [X01PlayerStats, X01PlayerStats];
  const stats = players[player];
  const scoredAmount = resolution.bust ? 0 : enteredScore;

  stats.totalDarts += resolution.darts;
  stats.totalScored += scoredAmount;
  if (!resolution.bust) {
    if (scoredAmount >= 180) stats.ton80Count += 1;
    else if (scoredAmount >= 140) stats.ton40Count += 1;
    else if (scoredAmount >= 100) stats.ton00Count += 1;
  }
  if (stats.first9Darts < 9) {
    const room = 9 - stats.first9Darts;
    const dartsTowardFirst9 = Math.min(room, resolution.darts);
    if (dartsTowardFirst9 > 0) {
      stats.first9Darts += dartsTowardFirst9;
      stats.first9Score += dartsTowardFirst9 === resolution.darts ? scoredAmount : 0;
    }
  }
  stats.remaining = resolution.after;

  const legDarts = clone(state.legDarts) as [number, number];
  legDarts[player] += resolution.darts;

  const visit: X01Visit = {
    player,
    score: resolution.bust ? 0 : enteredScore,
    before,
    after: resolution.after,
    darts: resolution.darts,
    bust: resolution.bust,
    checkout: resolution.checkout,
  };
  const visits = [...state.visits, visit];

  if (resolution.checkout) {
    stats.legs += 1;
    stats.checkouts += 1;
    stats.finishDarts = [...stats.finishDarts, legDarts[player]];
    stats.highestFinish = Math.max(stats.highestFinish, enteredScore);

    const legResult = { winner: player, darts: legDarts[player], reason: 'checkout' as const };
    const matchWinner = state.settings.targetLegs > 0 && stats.legs >= state.settings.targetLegs ? player : null;
    return {
      ...state,
      players,
      visits,
      legDarts,
      active: player === 0 ? 1 : 0,
      undo: undoStack,
      completed: [
        ...state.completed,
        { winner: player, startScore: state.startScore, darts: legDarts[player], reason: 'checkout', restore: coreSnapshot(state) },
      ],
      legResult,
      matchWinner,
    };
  }

  const nextActive: 0 | 1 = player === 0 ? 1 : 0;
  const roundLimitReached =
    state.settings.roundLimit && visits.length >= state.settings.maxRounds * 2 && currentRoundComplete(visits, state.settings.maxRounds);

  if (roundLimitReached) {
    return {
      ...state,
      players,
      visits,
      legDarts,
      active: nextActive,
      undo: undoStack,
      legResult: { winner: null, darts: 0, reason: 'round-limit' },
    };
  }

  return { ...state, players, visits, legDarts, active: nextActive, undo: undoStack };
}

function currentRoundComplete(visits: X01Visit[], maxRounds: number): boolean {
  const roundsPlayedByP0 = visits.filter((v) => v.player === 0).length;
  const roundsPlayedByP1 = visits.filter((v) => v.player === 1).length;
  return roundsPlayedByP0 >= maxRounds && roundsPlayedByP1 >= maxRounds;
}

/** Resolves a manually-chosen winner (or draw) once the round limit has been reached. */
export function resolveRoundLimit(state: X01MatchState, outcome: 0 | 1 | 'draw'): X01MatchState {
  if (state.legResult?.reason !== 'round-limit') return state;
  const winner = outcome === 'draw' ? null : outcome;
  if (winner !== null) {
    const players = clone(state.players) as [X01PlayerStats, X01PlayerStats];
    players[winner].legs += 1;
    const matchWinner =
      state.settings.targetLegs > 0 && players[winner].legs >= state.settings.targetLegs ? winner : null;
    return {
      ...state,
      players,
      legResult: { winner, darts: state.legDarts[winner], reason: 'round-limit' },
      completed: [
        ...state.completed,
        { winner, startScore: state.startScore, darts: state.legDarts[winner], reason: 'round-limit', restore: coreSnapshot(state) },
      ],
      matchWinner,
    };
  }
  return {
    ...state,
    legResult: { winner: null, darts: 0, reason: 'round-limit' },
    completed: [
      ...state.completed,
      { winner: null, startScore: state.startScore, darts: 0, reason: 'round-limit', restore: coreSnapshot(state) },
    ],
  };
}

/** Manually ends the current leg as a draw (the "Legを終了・引き分け" menu action). */
export function declareDraw(state: X01MatchState): X01MatchState {
  if (state.legResult !== null || state.matchWinner !== null) return state;
  return {
    ...state,
    legResult: { winner: null, darts: 0, reason: 'draw' },
    completed: [
      ...state.completed,
      { winner: null, startScore: state.startScore, darts: 0, reason: 'draw', restore: coreSnapshot(state) },
    ],
  };
}

/** Starts the next leg after a leg-result screen has been acknowledged. */
export function advanceLeg(state: X01MatchState): X01MatchState {
  if (state.legResult === null || state.matchWinner !== null) return state;
  const lastCompletion = state.completed[state.completed.length - 1];
  const nextStarter: 0 | 1 = lastCompletion.winner === null ? (state.legStarter === 0 ? 1 : 0) : lastCompletion.winner === 0 ? 1 : 0;
  const core = coreForNewLeg(state.settings, state.leg + 1, nextStarter, state.players, state.startScore);
  return { ...state, ...core, legResult: null, undo: [] };
}

/** Undoes the most recent visit (or, if a leg just finished, un-finishes it back to in-progress). */
export function undoLastAction(state: X01MatchState): X01MatchState {
  if (state.undo.length === 0) return state;
  const previous = state.undo[state.undo.length - 1];
  const undo = state.undo.slice(0, -1);
  const wasLegCompletingVisit = state.legResult !== null && state.completed.length > 0;
  const completed = wasLegCompletingVisit ? state.completed.slice(0, -1) : state.completed;
  return { ...state, ...clone(previous), undo, completed, legResult: null, matchWinner: null };
}

/** Edits a past visit's score/darts in place and recomputes everything after it. */
export function editVisit(state: X01MatchState, visitIndex: number, newScore: number, newDarts: number): X01MatchState {
  if (visitIndex < 0 || visitIndex >= state.visits.length) return state;
  if (!Number.isInteger(newScore) || newScore < 0 || newScore > 180 || !isReachableScore(newScore)) {
    throw new InvalidVisitError('修正する得点は0～180、使用ダーツは1～3本で指定してください。');
  }
  if (!Number.isInteger(newDarts) || newDarts < 1 || newDarts > 3) {
    throw new InvalidVisitError('修正する得点は0～180、使用ダーツは1～3本で指定してください。');
  }

  // Rebuild from each player's stats as they stood at the START of this leg (not from zero), so
  // darts/scoring/checkouts/highest-finish earned in earlier legs survive an in-leg correction.
  const players: [X01PlayerStats, X01PlayerStats] = [
    { ...clone(state.legStartStats[0]), remaining: state.playerStartScores[0] },
    { ...clone(state.legStartStats[1]), remaining: state.playerStartScores[1] },
  ];
  const legDarts: [number, number] = [0, 0];
  const visits = clone(state.visits);
  visits[visitIndex] = { ...visits[visitIndex], score: newScore, darts: newDarts };

  const rebuilt: X01Visit[] = [];
  for (const v of visits) {
    const before = players[v.player].remaining;
    const bust = newScoreIsBust(before, v.score, visitIndex, rebuilt.length, visits);
    const after = bust ? before : before - v.score;
    const stats = players[v.player];
    const scored = bust ? 0 : v.score;
    stats.totalDarts += v.darts;
    stats.totalScored += scored;
    if (!bust) {
      if (scored >= 180) stats.ton80Count += 1;
      else if (scored >= 140) stats.ton40Count += 1;
      else if (scored >= 100) stats.ton00Count += 1;
    }
    if (stats.first9Darts < 9) {
      const room = 9 - stats.first9Darts;
      const d = Math.min(room, v.darts);
      stats.first9Darts += d;
      if (d === v.darts) stats.first9Score += scored;
    }
    stats.remaining = after;
    legDarts[v.player] += v.darts;
    if (after === 0 && !bust) {
      stats.legs += 1;
      stats.checkouts += 1;
      stats.finishDarts = [...stats.finishDarts, legDarts[v.player]];
      stats.highestFinish = Math.max(stats.highestFinish, v.score);
    }
    rebuilt.push({ ...v, before, after, bust });
  }

  return { ...state, players, visits: rebuilt, legDarts, undo: [] };
}

function newScoreIsBust(before: number, score: number, _editIndex: number, _rebuiltIndex: number, _all: X01Visit[]): boolean {
  return score > before || before - score === 1;
}

/** Swaps the two players' current-leg progress (a manual correction tool for mis-entered players). */
export function swapCurrentLegScores(state: X01MatchState): X01MatchState {
  const players: [X01PlayerStats, X01PlayerStats] = [
    { ...state.players[1], name: state.players[0].name },
    { ...state.players[0], name: state.players[1].name },
  ];
  players[0].name = state.players[0].name;
  players[1].name = state.players[1].name;
  const visits = state.visits.map((v) => ({ ...v, player: (v.player === 0 ? 1 : 0) as 0 | 1 }));
  const legDarts: [number, number] = [state.legDarts[1], state.legDarts[0]];
  const legStartStats: [X01PlayerStats, X01PlayerStats] = [
    { ...state.legStartStats[1], name: state.players[0].name },
    { ...state.legStartStats[0], name: state.players[1].name },
  ];
  return {
    ...state,
    players,
    visits,
    legDarts,
    legStartStats,
    active: state.active === 0 ? 1 : 0,
    legStarter: state.legStarter === 0 ? 1 : 0,
    undo: [],
  };
}

/** Runs the COM player's turn if the active player is COM-controlled; no-op otherwise. */
export function maybePlayComTurn(state: X01MatchState): X01MatchState {
  if (state.matchWinner !== null || state.legResult !== null) return state;
  const player = state.active;
  if (!state.settings.comEnabled[player]) return state;
  const remaining = state.players[player].remaining;
  const { score, finishDarts } = simulateComVisit(remaining, state.settings.comLevels[player]);
  return applyVisit(state, score, finishDarts);
}

export function isMatchComplete(state: X01MatchState): boolean {
  return state.matchWinner !== null;
}

/**
 * True while a round-limit leg is waiting for the players to pick its outcome. A resolved leg has a
 * matching entry in `completed`, so this flips to false as soon as the choice is made.
 */
export function needsRoundLimitDecision(state: X01MatchState): boolean {
  return state.legResult?.reason === 'round-limit' && state.completed.length < state.leg;
}
