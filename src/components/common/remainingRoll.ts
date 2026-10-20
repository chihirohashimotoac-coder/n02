import { useState } from 'react';
import type { X01MatchState } from '../../domain/x01Engine';
import type { X01SoloState } from '../../domain/pentathlon/engines/x01Solo';
import type { PentathlonSession } from '../../domain/pentathlon/types';

/**
 * One committed visit that lowered a player's remaining: the big remaining number rolls from `from`
 * to `to`. Display-only - each object is one commit, and nothing here is ever written back to the
 * game state, the save or the undo stack.
 */
export interface RemainingRoll {
  player: 0 | 1;
  from: number;
  to: number;
}

/**
 * The roll a 通常01・チェックアウト練習 state change calls for, or null when it is anything but an
 * ordinary committed visit.
 *
 * Read from the structure of the change rather than from the numbers: applyVisit() appends exactly
 * one visit to the same leg and keeps every earlier visit object as it was. An undo, a correction, a
 * score swap, a leg rewind, a new leg or a restored save all rebuild or shorten the list instead, so
 * none of them can pass for a commit just because a remaining went down. The player who rolls is
 * the one the new visit belongs to, never whoever is up next.
 */
export function detectX01Roll(previous: X01MatchState, next: X01MatchState): RemainingRoll | null {
  if (next.leg !== previous.leg || next.visits.length !== previous.visits.length + 1) return null;
  if (previous.visits.some((visit, index) => next.visits[index] !== visit)) return null;
  const visit = next.visits[next.visits.length - 1];
  // A bust or a 0 leaves the remaining where it was, so there is nothing to roll.
  if (visit.after === visit.before) return null;
  if (previous.players[visit.player].remaining !== visit.before) return null;
  if (next.players[visit.player].remaining !== visit.after) return null;
  return { player: visit.player, from: visit.before, to: visit.after };
}

/**
 * The same for a Pentathlon 301/501 session. Each player keeps their own visit list here, so a
 * commit is one player's list growing by exactly one visit while the other's stays as it was, within
 * the same discipline. An undo or a correction never lengthens a list.
 */
export function detectPentathlonX01Roll(
  previous: PentathlonSession,
  next: PentathlonSession,
): RemainingRoll | null {
  if (previous.currentDisciplineIndex !== next.currentDisciplineIndex) return null;
  if (!previous.current || !next.current) return null;
  let roll: RemainingRoll | null = null;
  for (const player of [0, 1] as const) {
    const before = previous.current.progress[player]?.state as X01SoloState | undefined;
    const after = next.current.progress[player]?.state as X01SoloState | undefined;
    if (!before?.visits || !after?.visits) return null;
    if (after.visits.length === before.visits.length) continue;
    if (roll !== null || after.visits.length !== before.visits.length + 1) return null;
    if (after.startScore !== before.startScore || after.remaining === before.remaining) return null;
    roll = { player, from: before.remaining, to: after.remaining };
  }
  return roll;
}

/**
 * The digits one column passes through, top to bottom, ending on the digit it lands on at the top.
 *
 * Purely decorative: these are never remainings the player was on. Each column turns one full
 * revolution plus however far its digit actually moves, counting down, so an unchanged digit still
 * turns briefly with the rest. The new value sets the number of columns - no leading zero is ever
 * shown, and a digit that disappears (1101 → 921) simply is not there any more.
 */
export function reelColumns(from: number, to: number): Array<{ reel: string; steps: number }> {
  const target = String(to);
  const source = String(from).padStart(target.length, '0').slice(-target.length);
  return [...target].map((digit, index) => {
    const start = Number(source[index]);
    const end = Number(digit);
    const steps = ((start - end + 10) % 10) + 10;
    // Top to bottom: the landing digit, then upward to the starting one at the bottom, so the strip
    // moves down and each digit comes in from above - a counter running backwards.
    const reel = Array.from({ length: steps + 1 }, (_, offset) => String((end + offset) % 10)).join('\n');
    return { reel, steps };
  });
}

/**
 * Which roll each player's remaining should show, derived from the game state alone.
 *
 * Kept as display state of the screen, never of the game: the state passed in is already final
 * (remaining, turn, save) by the time this sees it. `detect` names the ordinary commit, if this
 * change is one; anything else - an undo, a correction, a new leg, a restored save - clears both
 * rolls so the remaining shows its value at once. A commit replaces only its own player's roll, so
 * the opponent's roll, if still running, is left to land.
 */
export function useRemainingRolls<S>(
  state: S,
  detect: (previous: S, next: S) => RemainingRoll | null,
): [RemainingRoll | null, RemainingRoll | null] {
  const [tracked, setTracked] = useState<{ state: S; rolls: [RemainingRoll | null, RemainingRoll | null] }>(
    () => ({ state, rolls: [null, null] }),
  );
  if (tracked.state === state) return tracked.rolls;
  const roll = detect(tracked.state, state);
  const rolls: [RemainingRoll | null, RemainingRoll | null] =
    roll === null ? [null, null] : roll.player === 0 ? [roll, tracked.rolls[1]] : [tracked.rolls[0], roll];
  setTracked({ state, rolls });
  return rolls;
}
