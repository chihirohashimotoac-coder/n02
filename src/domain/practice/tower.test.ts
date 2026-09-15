import { describe, expect, it } from 'vitest';
import {
  TOWER_RULES,
  activeTowerPlayer,
  advanceTurn,
  allFinished,
  applyThrow,
  canJudge,
  canRewindTo,
  canUndoThrow,
  chooseContinue,
  createTowerGame,
  currentTurnThrows,
  floorTargetText,
  isRecoveryFloor,
  nextActionId,
  playerResults,
  recentThrows,
  remainingContinues,
  rewindPreview,
  rewindToThrow,
  totalThrows,
  undoLastThrow,
  undoTargetThrow,
  type TowerPlayer,
  type TowerSettings,
  type TowerState,
  type TowerThrowResult,
} from './tower';

function solo(name = 'P1'): TowerState {
  const settings: TowerSettings = { playerCount: 1, names: [name, ''] };
  return createTowerGame(settings);
}

function duo(first = 'P1', second = 'P2'): TowerState {
  const settings: TowerSettings = { playerCount: 2, names: [first, second] };
  return createTowerGame(settings);
}

/** One dart, then the pickup screen's 「次へ」 when the turn has just run out. */
function play(state: TowerState, result: TowerThrowResult): TowerState {
  const next = applyThrow(state, result);
  return next.phase === 'pickup' ? advanceTurn(next) : next;
}

/** Clears `count` floors in a row, taking every turn change on the way. */
function climb(state: TowerState, count: number): TowerState {
  let current = state;
  for (let index = 0; index < count; index += 1) current = play(current, 'hit');
  return current;
}

/**
 * A solo game parked on a floor with a fresh turn.
 *
 * Climbing to a deep floor one dart at a time leaves the turn wherever the arithmetic lands it,
 * which is exactly what several rules below are NOT about - so those start from a placed state and
 * the tests that are about the turn do the climbing for real.
 */
function soloOnFloor(floor: number, patch: Partial<TowerPlayer> = {}): TowerState {
  const state = solo();
  state.players[0] = {
    ...state.players[0],
    currentFloor: floor,
    lastClearedFloor: floor - 1,
    ...patch,
  };
  return state;
}

describe('TOWER setup', () => {
  it('starts every player on 1F with a full LIFE and every CONTINUE unused', () => {
    const state = duo();
    expect(state.players).toHaveLength(2);
    for (const player of state.players) {
      expect(player.currentFloor).toBe(1);
      expect(player.lastClearedFloor).toBe(0);
      expect(player.life).toBe(TOWER_RULES.startLife);
      expect(player.continuesUsed).toBe(0);
      expect(player.status).toBe('playing');
      expect(player.stats).toEqual({ throws: 0, hits: 0, misses: 0 });
    }
    expect(state.phase).toBe('throw');
    expect(state.dartsUsedInTurn).toBe(0);
    expect(state.activePlayerIndex).toBe(0);
  });

  it('falls back to PLAYER n for a blank name, and keeps a solo game to one player', () => {
    const state = createTowerGame({ playerCount: 1, names: ['  ', 'kept'] });
    expect(state.players).toHaveLength(1);
    expect(state.players[0].name).toBe('PLAYER 1');
    // Player 2's name survives on the settings for 「同じ設定でもう一度」.
    expect(state.settings.names[1]).toBe('kept');
  });

  it('plays the observed configuration: LIFE 3, CONTINUE 5, recovery on, 1F to 100F', () => {
    expect(TOWER_RULES).toMatchObject({
      startFloor: 1,
      finalFloor: 100,
      startLife: 3,
      maxLife: 3,
      continues: 5,
      dartsPerTurn: 3,
      recoveryInterval: 10,
      recovery: true,
    });
  });
});

describe('a dart', () => {
  it('moves up exactly one floor on a hit and records the floor it beat', () => {
    const state = applyThrow(solo(), 'hit');
    expect(state.players[0].currentFloor).toBe(2);
    expect(state.players[0].lastClearedFloor).toBe(1);
    expect(state.players[0].life).toBe(3);
    expect(state.players[0].stats).toEqual({ throws: 1, hits: 1, misses: 0 });
  });

  it('holds the floor and the target on a miss, and takes one LIFE', () => {
    const before = solo();
    const target = floorTargetText(before.players[0].currentFloor);
    const state = applyThrow(before, 'miss');
    expect(state.players[0].currentFloor).toBe(1);
    expect(state.players[0].lastClearedFloor).toBe(0);
    expect(state.players[0].life).toBe(2);
    expect(floorTargetText(state.players[0].currentFloor)).toBe(target);
    expect(state.players[0].stats).toEqual({ throws: 1, hits: 0, misses: 1 });
  });

  it('never drives LIFE below zero', () => {
    let state = solo();
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    expect(state.players[0].life).toBe(0);
    expect(state.phase).toBe('continue');
    // A further judgement in the CONTINUE phase is refused outright, so LIFE cannot go negative.
    expect(applyThrow(state, 'miss')).toBe(state);
    expect(state.players[0].life).toBe(0);
  });

  it('counts the turn across floors - three hits on three different floors is still one turn', () => {
    let state = solo();
    state = applyThrow(state, 'hit');
    expect(state.dartsUsedInTurn).toBe(1);
    expect(state.phase).toBe('throw');
    state = applyThrow(state, 'hit');
    expect(state.dartsUsedInTurn).toBe(2);
    expect(state.phase).toBe('throw');
    state = applyThrow(state, 'hit');
    expect(state.dartsUsedInTurn).toBe(3);
    expect(state.phase).toBe('pickup');
    expect(state.players[0].currentFloor).toBe(4);
    expect(state.players[0].lastClearedFloor).toBe(3);
  });

  it('starts a fresh turn only when 「次へ」 is pressed', () => {
    let state = climb(solo(), 3);
    expect(state.dartsUsedInTurn).toBe(0);
    expect(state.phase).toBe('throw');
    state = applyThrow(state, 'hit');
    expect(state.dartsUsedInTurn).toBe(1);
  });
});

describe('waiting for a judgement', () => {
  it('changes nothing at all while no input arrives', () => {
    const state = applyThrow(solo(), 'miss');
    const before = JSON.stringify(state);
    // There is no timer, no countdown and no auto-miss: the only thing that moves state is input.
    expect(JSON.stringify(state)).toBe(before);
    expect(state.phase).toBe('throw');
    expect(state.dartsUsedInTurn).toBe(1);
  });

  it('refuses a judgement on the pickup, CONTINUE and RESULT screens', () => {
    const pickup = applyThrow(applyThrow(applyThrow(solo(), 'hit'), 'hit'), 'hit');
    expect(pickup.phase).toBe('pickup');
    expect(canJudge(pickup)).toBe(false);
    expect(applyThrow(pickup, 'hit')).toBe(pickup);
    expect(applyThrow(pickup, 'miss')).toBe(pickup);

    const dead = applyThrow(applyThrow(applyThrow(solo(), 'miss'), 'miss'), 'miss');
    expect(dead.phase).toBe('continue');
    expect(canJudge(dead)).toBe(false);
    expect(applyThrow(dead, 'hit')).toBe(dead);

    const finished = advanceTurn(chooseContinue(dead, 'no'));
    expect(finished.phase).toBe('result');
    expect(canJudge(finished)).toBe(false);
    expect(applyThrow(finished, 'hit')).toBe(finished);
  });

  it('spends one dart for a repeated input against the same state', () => {
    const state = solo();
    const first = applyThrow(state, 'hit');
    // A double click, a touch that also fires click, a key that repeats: the second handler sees
    // the state the first one saw, computes the same action id, and is refused.
    const second = applyThrow(state, 'hit', { actionId: nextActionId(state, 'throw') });
    expect(first.players[0].stats.throws).toBe(1);
    expect(applyThrow(first, 'hit', { actionId: nextActionId(state, 'throw') })).toBe(first);
    expect(second.players[0].stats.throws).toBe(1);
  });

  it('still accepts two genuinely separate darts in a row', () => {
    let state = solo();
    state = applyThrow(state, 'hit');
    state = applyThrow(state, 'hit');
    expect(state.players[0].stats.throws).toBe(2);
    expect(state.players[0].currentFloor).toBe(3);
  });

  it('refuses a duplicate 「次へ」 and a duplicate CONTINUE answer', () => {
    const pickup = applyThrow(applyThrow(applyThrow(solo(), 'hit'), 'hit'), 'hit');
    const advanced = advanceTurn(pickup);
    expect(advanced.dartsUsedInTurn).toBe(0);
    // A second 「次へ」 lands on a state that is no longer waiting for one, and does nothing.
    expect(advanceTurn(advanced)).toBe(advanced);
    expect(advanceTurn(advanced, { actionId: nextActionId(pickup, 'advance') })).toBe(advanced);

    const dead = applyThrow(applyThrow(applyThrow(solo(), 'miss'), 'miss'), 'miss');
    const continued = chooseContinue(dead, 'yes');
    expect(continued.players[0].continuesUsed).toBe(1);
    expect(chooseContinue(continued, 'yes')).toBe(continued);
    expect(chooseContinue(continued, 'yes', { actionId: nextActionId(dead, 'continue') })).toBe(continued);
  });

  /**
   * The case the action id exists for: the first input has already been applied and the phase is
   * still 'throw', so only the id can tell the stale repeat from a real second dart.
   */
  it('refuses a stale repeat even when the screen is ready for another dart', () => {
    const state = solo();
    const staleId = nextActionId(state, 'throw');
    const first = applyThrow(state, 'hit', { actionId: staleId });
    expect(first.phase).toBe('throw');
    expect(applyThrow(first, 'hit', { actionId: staleId })).toBe(first);
    expect(first.players[0].stats.throws).toBe(1);
  });
});

describe('recovery', () => {
  it('names 10F through 90F, and never 100F', () => {
    expect(isRecoveryFloor(10)).toBe(true);
    expect(isRecoveryFloor(90)).toBe(true);
    expect(isRecoveryFloor(11)).toBe(false);
    expect(isRecoveryFloor(100)).toBe(false);
  });

  it('does not fire on reaching 10F - only on clearing it', () => {
    let state = climb(solo(), 8); // beaten 8 floors, now on 9F
    state = play(state, 'miss');
    state = play(state, 'miss');
    expect(state.players[0].life).toBe(1);
    state = play(state, 'hit'); // 9F cleared -> now on 10F
    expect(state.players[0].currentFloor).toBe(10);
    // Standing ON 10F is not what recovers.
    expect(state.players[0].life).toBe(1);

    state = play(state, 'hit'); // 10F cleared -> recovery
    expect(state.players[0].currentFloor).toBe(11);
    expect(state.players[0].life).toBe(3);
    const event = recentThrows(state, 1)[0];
    expect(event.recovered).toBe(true);
    expect(event.floor).toBe(10);
  });

  it('caps at 3 when LIFE is already full, with nothing carried over', () => {
    let state = soloOnFloor(20); // on 20F with a full LIFE
    expect(state.players[0].life).toBe(3);
    state = play(state, 'hit');
    expect(state.players[0].life).toBe(3);
    expect(recentThrows(state, 1)[0].recovered).toBe(true);

    // A single miss afterwards still costs exactly one - no hidden surplus absorbed it.
    state = play(state, 'miss');
    expect(state.players[0].life).toBe(2);
  });

  it('does not recover on the way out of 100F', () => {
    const state = applyThrow(soloOnFloor(100), 'hit');
    expect(recentThrows(state, 1)[0].recovered).toBe(false);
    expect(recentThrows(state, 1)[0].clearedTower).toBe(true);
  });
});

describe('GAME OVER and CONTINUE', () => {
  /** Drops the active player to LIFE 0 from a full LIFE, taking turn changes as they come. */
  function die(state: TowerState): TowerState {
    let current = state;
    while (activeTowerPlayer(current).life > 0 && current.phase === 'throw') {
      current = applyThrow(current, 'miss');
      if (current.phase === 'pickup') current = advanceTurn(current);
    }
    return current;
  }

  it('offers CONTINUE at LIFE 0 instead of ending the turn', () => {
    const state = die(solo());
    expect(state.players[0].life).toBe(0);
    expect(state.phase).toBe('continue');
    expect(remainingContinues(state.players[0])).toBe(5);
  });

  it('resolves a third-dart GAME OVER before the pickup screen', () => {
    let state = soloOnFloor(15); // on 15F, full LIFE, fresh turn
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    expect(state.dartsUsedInTurn).toBe(2);
    state = applyThrow(state, 'miss');
    expect(state.dartsUsedInTurn).toBe(3);
    // Not 'pickup': the GAME OVER is handled first.
    expect(state.phase).toBe('continue');

    const continued = chooseContinue(state, 'yes');
    expect(continued.players[0].life).toBe(3);
    expect(continued.players[0].currentFloor).toBe(15);
    // ...and only then does the turn end.
    expect(continued.phase).toBe('pickup');
    expect(advanceTurn(continued).dartsUsedInTurn).toBe(0);
  });

  it('restarts the failed floor on YES, keeping the darts already spent this turn', () => {
    let state = soloOnFloor(14);
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'hit'); // 14F cleared on the third dart -> 15F, turn over
    state = advanceTurn(state);
    expect(state.players[0].currentFloor).toBe(15);
    expect(state.players[0].life).toBe(1);

    state = applyThrow(state, 'miss'); // first dart of the new turn, LIFE 0
    expect(state.phase).toBe('continue');
    expect(state.dartsUsedInTurn).toBe(1);

    const continued = chooseContinue(state, 'yes');
    expect(continued.players[0].life).toBe(3);
    expect(continued.players[0].currentFloor).toBe(15);
    expect(continued.players[0].continuesUsed).toBe(1);
    // n02 rule: the turn is not restarted - two darts are left.
    expect(continued.dartsUsedInTurn).toBe(1);
    expect(continued.phase).toBe('throw');
  });

  it('does not count a CONTINUE as a dart', () => {
    const dead = die(solo());
    const before = totalThrows(dead);
    const continued = chooseContinue(dead, 'yes');
    expect(totalThrows(continued)).toBe(before);
    expect(continued.players[0].stats.throws).toBe(before);
  });

  it('ends the player on NO, without charging the unthrown darts as misses', () => {
    // Down to the last LIFE, so the turn dies on its first dart with two still in hand.
    let state = soloOnFloor(6, { life: 1 });
    state = applyThrow(state, 'miss');
    expect(state.phase).toBe('continue');
    expect(state.dartsUsedInTurn).toBe(1);

    const stopped = chooseContinue(state, 'no');
    expect(stopped.players[0].status).toBe('retired');
    expect(stopped.phase).toBe('player-over');
    // The two darts never thrown are given up, not recorded as misses.
    expect(stopped.players[0].stats).toEqual({ throws: 1, hits: 0, misses: 1 });
    expect(stopped.players[0].continuesUsed).toBe(0);
  });

  it('retires the player once all five CONTINUEs are spent, never offering a sixth', () => {
    let state = solo();
    for (let round = 0; round < 5; round += 1) {
      state = die(state);
      expect(state.phase).toBe('continue');
      expect(remainingContinues(state.players[0])).toBe(5 - round);
      state = chooseContinue(state, 'yes');
      if (state.phase === 'pickup') state = advanceTurn(state);
    }
    expect(state.players[0].continuesUsed).toBe(5);
    expect(remainingContinues(state.players[0])).toBe(0);

    state = die(state);
    // n02 rule: no sixth prompt - the player is simply done.
    expect(state.phase).toBe('player-over');
    expect(state.players[0].status).toBe('retired');
    expect(allFinished(state)).toBe(true);
    expect(advanceTurn(state).phase).toBe('result');
  });
});

describe('the top of the tower', () => {
  it('is not cleared by reaching 100F, only by beating it', () => {
    const state = climb(solo(), 99);
    expect(state.players[0].currentFloor).toBe(100);
    expect(state.players[0].lastClearedFloor).toBe(99);
    expect(state.players[0].status).toBe('playing');
    expect(state.phase).toBe('throw');
  });

  it('keeps missing 100F playable, on 100F', () => {
    let state = climb(solo(), 99);
    state = applyThrow(state, 'miss');
    expect(state.players[0].currentFloor).toBe(100);
    expect(state.players[0].lastClearedFloor).toBe(99);
    expect(state.players[0].life).toBe(2);
    expect(state.players[0].status).toBe('playing');
  });

  it('clears on a hit and never builds a 101F', () => {
    let state = climb(solo(), 99);
    state = applyThrow(state, 'hit');
    expect(state.players[0].status).toBe('cleared');
    expect(state.players[0].currentFloor).toBe(100);
    expect(state.players[0].lastClearedFloor).toBe(100);
    expect(state.phase).toBe('player-over');
    expect(advanceTurn(state).phase).toBe('result');
    expect(playerResults(state)[0].clearFloor).toBe(100);
  });
});

describe('two players', () => {
  it('keeps each player on their own floor, LIFE and CONTINUE count', () => {
    let state = duo();
    state = applyThrow(state, 'hit');
    state = applyThrow(state, 'hit');
    state = applyThrow(state, 'hit');
    expect(state.phase).toBe('pickup');
    expect(state.players[0].currentFloor).toBe(4);

    state = advanceTurn(state);
    expect(state.activePlayerIndex).toBe(1);
    // P2 starts their own climb at 1F, untouched by P1's three floors.
    expect(state.players[1].currentFloor).toBe(1);
    expect(state.players[1].lastClearedFloor).toBe(0);

    state = applyThrow(state, 'miss');
    expect(state.players[1].life).toBe(2);
    expect(state.players[0].life).toBe(3);
    expect(state.players[0].currentFloor).toBe(4);
  });

  it('hands back and forth, and skips a player who is finished', () => {
    let state = duo();
    state = advanceTurn(applyThrow(applyThrow(applyThrow(state, 'hit'), 'hit'), 'hit'));
    expect(state.activePlayerIndex).toBe(1);

    // P2 walks away at the CONTINUE prompt.
    state = applyThrow(applyThrow(applyThrow(state, 'miss'), 'miss'), 'miss');
    expect(state.phase).toBe('continue');
    state = chooseContinue(state, 'no');
    expect(state.players[1].status).toBe('retired');

    state = advanceTurn(state);
    expect(state.activePlayerIndex).toBe(0);
    expect(state.phase).toBe('throw');

    // P1 plays on alone: the turn comes back to them rather than to the retired player.
    state = advanceTurn(applyThrow(applyThrow(applyThrow(state, 'hit'), 'hit'), 'hit'));
    expect(state.activePlayerIndex).toBe(0);
    expect(state.players[0].currentFloor).toBe(7);
  });

  it('parks a player who has cleared the tower and lets the other carry on', () => {
    let state = duo();
    state.players[0] = { ...state.players[0], currentFloor: 100, lastClearedFloor: 99 };
    state = applyThrow(state, 'hit');
    expect(state.players[0].status).toBe('cleared');
    expect(state.phase).toBe('player-over');

    state = advanceTurn(state);
    expect(state.phase).toBe('throw');
    expect(state.activePlayerIndex).toBe(1);
    expect(state.players[1].status).toBe('playing');

    // The cleared player is never handed the darts again.
    state = advanceTurn(applyThrow(applyThrow(applyThrow(state, 'hit'), 'hit'), 'hit'));
    expect(state.activePlayerIndex).toBe(1);
    expect(allFinished(state)).toBe(false);
  });

  it('reaches RESULT only once both players are done', () => {
    let state = duo();
    state = applyThrow(applyThrow(applyThrow(state, 'miss'), 'miss'), 'miss');
    state = advanceTurn(chooseContinue(state, 'no'));
    expect(state.phase).toBe('throw');
    expect(allFinished(state)).toBe(false);
    expect(state.activePlayerIndex).toBe(1);

    state = applyThrow(applyThrow(applyThrow(state, 'miss'), 'miss'), 'miss');
    state = chooseContinue(state, 'no');
    expect(allFinished(state)).toBe(true);
    expect(advanceTurn(state).phase).toBe('result');
  });
});

describe('taking a dart back', () => {
  it('has nothing to take back before the first dart', () => {
    const state = solo();
    expect(canUndoThrow(state)).toBe(false);
    expect(undoTargetThrow(state)).toBeNull();
    expect(undoLastThrow(state)).toBe(state);
  });

  it('restores the floor, LIFE, dart count and stats of the moment before', () => {
    let state = climb(solo(), 4);
    const before = JSON.stringify({ players: state.players, phase: state.phase, darts: state.dartsUsedInTurn });
    state = applyThrow(state, 'miss');
    state = undoLastThrow(state);
    expect(
      JSON.stringify({ players: state.players, phase: state.phase, darts: state.dartsUsedInTurn }),
    ).toBe(before);
    expect(state.history.filter((event) => event.kind === 'throw')).toHaveLength(4);
  });

  it('gives a 10F recovery back with the dart that earned it', () => {
    let state = climb(solo(), 8);
    state = play(state, 'miss');
    state = play(state, 'miss');
    state = play(state, 'hit'); // now on 10F with LIFE 1
    expect(state.players[0].life).toBe(1);

    state = applyThrow(state, 'hit'); // recovery
    expect(state.players[0].life).toBe(3);
    expect(state.players[0].currentFloor).toBe(11);

    state = undoLastThrow(state);
    expect(state.players[0].life).toBe(1);
    expect(state.players[0].currentFloor).toBe(10);
    expect(state.players[0].lastClearedFloor).toBe(9);
  });

  it('takes back the CONTINUE that followed the dart', () => {
    let state = climb(solo(), 3);
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    expect(state.phase).toBe('continue');
    state = chooseContinue(state, 'yes');
    expect(state.players[0].continuesUsed).toBe(1);
    expect(state.players[0].life).toBe(3);

    state = undoLastThrow(state);
    // The CONTINUE is unspent and the dart that killed the player is unthrown.
    expect(state.players[0].continuesUsed).toBe(0);
    expect(state.players[0].life).toBe(1);
    expect(state.phase).toBe('throw');
    expect(state.dartsUsedInTurn).toBe(2);
    expect(remainingContinues(state.players[0])).toBe(5);
  });

  it('works straight from the CONTINUE prompt', () => {
    let state = applyThrow(applyThrow(applyThrow(solo(), 'miss'), 'miss'), 'miss');
    expect(state.phase).toBe('continue');
    state = undoLastThrow(state);
    expect(state.phase).toBe('throw');
    expect(state.players[0].life).toBe(1);
    expect(state.dartsUsedInTurn).toBe(2);
  });

  it('works from the pickup screen, and from after the handover', () => {
    let state = applyThrow(applyThrow(applyThrow(duo(), 'hit'), 'hit'), 'hit');
    expect(state.phase).toBe('pickup');
    const fromPickup = undoLastThrow(state);
    expect(fromPickup.phase).toBe('throw');
    expect(fromPickup.dartsUsedInTurn).toBe(2);
    expect(fromPickup.players[0].currentFloor).toBe(3);

    state = advanceTurn(state);
    expect(state.activePlayerIndex).toBe(1);
    state = undoLastThrow(state);
    // The handover comes back with the dart: P1 is throwing again, mid-turn.
    expect(state.activePlayerIndex).toBe(0);
    expect(state.dartsUsedInTurn).toBe(2);
    expect(state.phase).toBe('throw');
    expect(state.players[0].currentFloor).toBe(3);
  });

  it('comes back from RESULT after a 100F clear', () => {
    let state = climb(solo(), 99);
    state = applyThrow(state, 'hit');
    state = advanceTurn(state);
    expect(state.phase).toBe('result');

    state = undoLastThrow(state);
    expect(state.phase).toBe('throw');
    expect(state.players[0].status).toBe('playing');
    expect(state.players[0].currentFloor).toBe(100);
    expect(state.players[0].lastClearedFloor).toBe(99);
  });

  it('lets the retaken dart be judged the other way', () => {
    let state = climb(solo(), 4);
    state = applyThrow(state, 'hit');
    expect(state.players[0].currentFloor).toBe(6);
    state = undoLastThrow(state);
    state = applyThrow(state, 'miss');
    expect(state.players[0].currentFloor).toBe(5);
    expect(state.players[0].life).toBe(2);
    expect(state.players[0].stats).toEqual({ throws: 5, hits: 4, misses: 1 });
  });

  it('unwinds dart by dart, all the way back to the start', () => {
    let state = climb(solo(), 6);
    while (canUndoThrow(state)) state = undoLastThrow(state);
    expect(state.players[0].currentFloor).toBe(1);
    expect(state.players[0].lastClearedFloor).toBe(0);
    expect(totalThrows(state)).toBe(0);
    expect(state.history).toHaveLength(0);
    expect(state.phase).toBe('throw');
  });
});

describe('going back to an older dart', () => {
  it('drops every later dart rather than re-judging it', () => {
    let state = climb(solo(), 5);
    const third = recentThrows(state, 5).reverse()[2];
    expect(third.floor).toBe(3);

    const preview = rewindPreview(state, third.id);
    expect(preview).toMatchObject({ floor: 3, dartNumber: 3, discardedThrows: 3, playerName: 'P1' });

    state = rewindToThrow(state, third.id);
    expect(state.players[0].currentFloor).toBe(3);
    expect(state.players[0].lastClearedFloor).toBe(2);
    expect(totalThrows(state)).toBe(2);
    // The two darts thrown after it are gone, not re-applied against a different floor.
    expect(state.history).toHaveLength(2);
    expect(state.phase).toBe('throw');
  });

  it('gives back the CONTINUEs spent after the dart', () => {
    let state = climb(solo(), 3); // on 4F, fresh turn
    const marker = recentThrows(state, 1)[0];
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    expect(state.phase).toBe('continue');
    state = chooseContinue(state, 'yes');
    expect(state.players[0].continuesUsed).toBe(1);

    expect(rewindPreview(state, marker.id)).toMatchObject({ discardedThrows: 4, discardedContinues: 1 });
    state = rewindToThrow(state, marker.id);
    expect(state.players[0].continuesUsed).toBe(0);
    // Back to throwing at 3F, the floor that dart was aimed at.
    expect(state.players[0].currentFloor).toBe(3);
    expect(state.players[0].lastClearedFloor).toBe(2);
    expect(state.players[0].life).toBe(3);
  });

  it('restores the right player and turn in a two-player game', () => {
    let state = duo();
    state = applyThrow(state, 'hit');
    const p1Second = applyThrow(state, 'hit');
    const marker = recentThrows(p1Second, 1)[0];
    let later = applyThrow(p1Second, 'hit');
    later = advanceTurn(later);
    later = applyThrow(later, 'miss');
    expect(later.activePlayerIndex).toBe(1);

    const rewound = rewindToThrow(later, marker.id);
    expect(rewound.activePlayerIndex).toBe(0);
    expect(rewound.dartsUsedInTurn).toBe(1);
    expect(rewound.players[0].currentFloor).toBe(2);
    expect(rewound.players[1].life).toBe(3);
    expect(rewound.players[1].stats.throws).toBe(0);
  });

  it('refuses a dart that is not a rewind point', () => {
    let state = climb(solo(), 3);
    const first = recentThrows(state, 3).reverse()[0];
    expect(canRewindTo(state, first.id)).toBe(true);
    state = rewindToThrow(state, first.id);
    // Rewound past: the same id is no longer a point this game can return to.
    expect(canRewindTo(state, first.id)).toBe(false);
    expect(rewindPreview(state, first.id)).toBeNull();
    expect(rewindToThrow(state, first.id)).toBe(state);
    expect(rewindToThrow(state, 'nonsense')).toBe(state);
  });
});

describe('the turn read-out', () => {
  it('reports only the darts of the turn in progress', () => {
    let state = solo();
    expect(currentTurnThrows(state)).toHaveLength(0);
    state = applyThrow(state, 'hit');
    expect(currentTurnThrows(state).map((event) => event.result)).toEqual(['hit']);
    state = applyThrow(state, 'miss');
    expect(currentTurnThrows(state).map((event) => event.result)).toEqual(['hit', 'miss']);
    state = advanceTurn(applyThrow(state, 'hit'));
    expect(currentTurnThrows(state)).toHaveLength(0);
  });

  it('does not bleed the other player’s darts into the turn', () => {
    let state = duo();
    state = advanceTurn(applyThrow(applyThrow(applyThrow(state, 'hit'), 'hit'), 'hit'));
    state = applyThrow(state, 'miss');
    const turn = currentTurnThrows(state);
    expect(turn).toHaveLength(1);
    expect(turn[0].playerIndex).toBe(1);
  });
});

describe('RESULT', () => {
  it('reports the last floor beaten, not the floor being attempted', () => {
    // Failing on 4F means three floors were beaten.
    let state = climb(solo(), 3);
    expect(state.players[0].currentFloor).toBe(4);
    state = applyThrow(applyThrow(applyThrow(state, 'miss'), 'miss'), 'miss');
    state = chooseContinue(state, 'no');
    expect(playerResults(state)[0].clearFloor).toBe(3);

    // Failing on 6F means five were beaten.
    let other = soloOnFloor(6, { lastClearedFloor: 5 });
    other = applyThrow(applyThrow(applyThrow(other, 'miss'), 'miss'), 'miss');
    expect(other.phase).toBe('continue');
    other = chooseContinue(other, 'no');
    expect(playerResults(other)[0].clearFloor).toBe(5);
  });

  it('reports 0 when 1F was never beaten', () => {
    let state = applyThrow(applyThrow(applyThrow(solo(), 'miss'), 'miss'), 'miss');
    state = chooseContinue(state, 'no');
    const result = playerResults(state)[0];
    expect(result.clearFloor).toBe(0);
    expect(result.status).toBe('retired');
    expect(result.stats).toEqual({ throws: 3, hits: 0, misses: 3 });
  });

  it('counts only the darts and CONTINUEs that still stand', () => {
    let state = climb(solo(), 3);
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    state = applyThrow(state, 'miss');
    state = chooseContinue(state, 'yes');
    expect(totalThrows(state)).toBe(6);

    // Everything from the first of those misses is taken back...
    const firstMiss = recentThrows(state, 3).reverse()[0];
    state = rewindToThrow(state, firstMiss.id);
    expect(totalThrows(state)).toBe(3);
    expect(state.players[0].continuesUsed).toBe(0);

    state = applyThrow(applyThrow(applyThrow(state, 'miss'), 'miss'), 'miss');
    state = chooseContinue(state, 'no');
    const result = playerResults(state)[0];
    // ...so the discarded darts and the discarded CONTINUE are not in the record.
    expect(result.stats).toEqual({ throws: 6, hits: 3, misses: 3 });
    expect(result.continuesUsed).toBe(0);
    expect(result.clearFloor).toBe(3);
    expect(result.startFloor).toBe(1);
  });

  it('reports both players side by side, with their own outcomes', () => {
    let state = duo('AKI', 'BEN');
    state.players[0] = { ...state.players[0], currentFloor: 100, lastClearedFloor: 99 };
    state = advanceTurn(applyThrow(state, 'hit'));
    state = applyThrow(applyThrow(applyThrow(state, 'miss'), 'miss'), 'miss');
    state = advanceTurn(chooseContinue(state, 'no'));
    expect(state.phase).toBe('result');

    const results = playerResults(state);
    expect(results.map((entry) => entry.name)).toEqual(['AKI', 'BEN']);
    expect(results[0]).toMatchObject({ clearFloor: 100, status: 'cleared' });
    expect(results[1]).toMatchObject({ clearFloor: 0, status: 'retired' });
  });
});
