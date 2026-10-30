import { isCheckoutPossible, validFinishDartCounts, type DartHit } from '../src/domain/darts';
import {
  advanceDiscipline,
  applyTurn,
  createPentathlonSession,
  currentDisciplineId,
} from '../src/domain/pentathlon/session';
import type { PentathlonPreset, PentathlonSession } from '../src/domain/pentathlon/types';
import {
  advanceLeg,
  applyVisit,
  createX01Match,
  type X01MatchState,
} from '../src/domain/x01Engine';
import { defaultSettings } from '../src/storage/matchStorage';

/**
 * Saved states for the display tests, produced by the app's own engines exactly as play would
 * produce them - never hand-written JSON. The tests put them where the app saves them and open them
 * through the app's own 再開 path, so what is on screen is a state the app can actually reach.
 */

export const LONG_NAME = 'あいうえおかきくけこさしすせそたちつ';
export const NORMAL_NAMES: [string, string] = ['プレイヤー1', 'プレイヤー2'];
export const LONG_NAMES: [string, string] = [LONG_NAME, `${LONG_NAME.slice(0, 17)}X`];

/** Plays one 01 / checkout leg through the engine, won by `winner`; the loser never checks out. */
function playLeg(state: X01MatchState, winner: 0 | 1, loserScore: number): X01MatchState {
  let next = state;
  for (let guard = 0; next.legResult === null && guard < 40; guard += 1) {
    const remaining = next.players[next.active].remaining;
    if (next.active !== winner) {
      next = applyVisit(next, next.settings.mode === 'checkout' ? 0 : loserScore);
    } else if (isCheckoutPossible(remaining)) {
      next = applyVisit(next, remaining, validFinishDartCounts(remaining)[0]);
    } else {
      next = applyVisit(next, 180);
    }
  }
  return next;
}

/**
 * A 01 / checkout match that is one leg from over: `winnerLegs` = target-1 for the player who
 * starts the next (final) leg, `loserLegs` for the other. Legs alternate who starts, so the final
 * leg's starter is fixed by how many legs were played; the earlier legs are spread so both players
 * win some when `loserLegs` > 0 (a close match, e.g. 9-9 before a 10-9 finish).
 */
export function x01MatchBeforeFinalLeg(options: {
  mode: '01' | 'checkout';
  targetLegs: number;
  loserLegs: number;
  names?: [string, string];
}): X01MatchState {
  const { mode, targetLegs, loserLegs } = options;
  const settings = {
    ...defaultSettings(),
    mode,
    targetLegs,
    names: options.names ?? NORMAL_NAMES,
  };
  const played = targetLegs - 1 + loserLegs;
  // Leg n (1-based) is started by player (n-1) % 2, so the final leg is started by played % 2.
  const finalStarter = (played % 2) as 0 | 1;
  const other = (1 - finalStarter) as 0 | 1;

  // Interleave: the loser's legs first come alternately, so the leg list reads like a real match.
  const winners: (0 | 1)[] = [];
  let starterWins = targetLegs - 1;
  let otherWins = loserLegs;
  while (starterWins + otherWins > 0) {
    if (otherWins > 0 && (winners.length % 2 === 1 || starterWins === 0)) {
      winners.push(other);
      otherWins -= 1;
    } else {
      winners.push(finalStarter);
      starterWins -= 1;
    }
  }

  let state = createX01Match(settings);
  winners.forEach((winner, index) => {
    state = playLeg(state, winner, 26 + (index % 5) * 15);
    state = advanceLeg(state);
  });
  return state;
}

/** A fresh 01 / checkout match with the first leg not yet thrown. */
export function x01FreshMatch(mode: '01' | 'checkout', targetLegs = 3, names = NORMAL_NAMES): X01MatchState {
  return createX01Match({ ...defaultSettings(), mode, targetLegs, names });
}

const S = (value: number): DartHit => ({ kind: 'number', value, ring: 'single' });
const T = (value: number): DartHit => ({ kind: 'number', value, ring: 'triple' });
const MISS: DartHit = { kind: 'miss' };
const INNER: DartHit = { kind: 'bull', ring: 'inner' };
const OUTER: DartHit = { kind: 'bull', ring: 'outer' };

/**
 * A full n01 / i-Pentathlon (総合) session with CORK, 301, BASEBALL and 501 played to completion by
 * the engine, standing at the start of the fifth discipline, CRICKET.
 */
export function pentathlonAtCricket(playerCount: 1 | 2, names: [string, string] = NORMAL_NAMES): PentathlonSession {
  return pentathlonUntil('n01', playerCount, names, 'cricket');
}

/** A 総合 session of `preset` advanced (by real play) until `discipline` is the one being played. */
export function pentathlonUntil(
  preset: PentathlonPreset,
  playerCount: 1 | 2,
  names: [string, string],
  discipline: ReturnType<typeof currentDisciplineId>,
): PentathlonSession {
  let session = createPentathlonSession({
    preset,
    playerCount,
    names,
    starterMode: 'loser',
    initialStarter: 0,
  });

  for (let guard = 0; guard < 400; guard += 1) {
    if (session.status === 'between-disciplines') {
      session = advanceDiscipline(session);
      continue;
    }
    const id = currentDisciplineId(session);
    if (id === discipline || session.status !== 'playing' || !session.current) return session;

    const current = session.current;
    const state = current.progress[current.active].state as { remaining?: number; inning?: number };
    switch (id) {
      case 'x01-301':
      case 'x01-501': {
        const remaining = state.remaining ?? 0;
        session = applyTurn(
          session,
          isCheckoutPossible(remaining)
            ? { score: remaining, finishDarts: validFinishDartCounts(remaining)[0] }
            : { score: 180 },
        );
        break;
      }
      case 'cork':
        session = applyTurn(session, [INNER, OUTER, MISS]);
        break;
      case 'baseball': {
        const inning = state.inning ?? 1;
        // Player 1 out-scores player 2 so no extra innings are needed.
        session = applyTurn(session, current.active === 0 ? [T(inning), S(inning), MISS] : [S(inning), MISS, MISS]);
        break;
      }
      default:
        session = applyTurn(session, [MISS, MISS, MISS]);
    }
  }
  throw new Error(`pentathlon did not reach ${discipline}`);
}
