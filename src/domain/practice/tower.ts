import { TOWER_COURSE_FLOORS, TOWER_COURSE_SOURCE } from './towerCourse';
import { describeFloorTargets, type TowerRegionId } from './towerRegions';

/**
 * TOWER OF THE DARTS domain logic for the PRACTICE hub.
 *
 * Deliberately standalone, for the same reason COUNT-UP is: it shares no state, no storage and no
 * code path with the 01 / checkout engine, with Pentathlon, or with COUNT-UP. TOWER has no score at
 * all - a dart is a hit or a miss and nothing else - so nothing in those resolvers applies, and
 * keeping them apart is what guarantees this mode cannot change any existing mode's behaviour.
 *
 * ## The input model
 *
 * TOWER is played on a real board with real darts, so the app never detects or infers where a dart
 * landed. The player looks at the board and enters one of two judgements per dart. Until that
 * judgement arrives nothing moves: there is no timeout, no countdown and no auto-miss, which is
 * what lets a player walk up to the board to read a close dart without the game running on.
 *
 * ## Where the rules come from
 *
 * The floor list and the observable behaviour are transcribed from the DARTSLIVE Home video (see
 * towerCourse.ts). Several rules the video could not settle are decided here, as n02's rules, and
 * are marked `n02 rule:` below. They are not claims about the original game.
 *
 * ## Correcting a dart
 *
 * Because the app never learns where a dart landed, a past judgement cannot be re-scored: flipping
 * an old "hit" to "miss" changes which floor every later dart was thrown at, and those darts'
 * recorded results no longer describe anything real. So TOWER has no edit-in-place. It rewinds to
 * the state just before the chosen dart and the player throws on from there. `undoStack` holds the
 * exact pre-action state for every action, which is what makes a rewind across a recovery, a
 * handover, a CONTINUE or the 100F clear land back on the right state rather than a recomputed one.
 */

export interface TowerRules {
  startFloor: number;
  finalFloor: number;
  startLife: number;
  /** n02 rule: a hard ceiling of 3. The video only ever showed 3; other settings were never seen. */
  maxLife: number;
  /** CONTINUEs available per player. */
  continues: number;
  dartsPerTurn: number;
  /** A floor is a recovery floor when `floor % recoveryInterval === 0` - applied on CLEARING it. */
  recoveryInterval: number;
  recovery: boolean;
}

/**
 * The single place TOWER's numbers live. The observed video ran START LIFE 3 / CONTINUE 5 /
 * RECOVERY ON, and that is what n02 plays; there is no settings screen for them.
 */
export const TOWER_RULES: TowerRules = {
  startFloor: 1,
  finalFloor: 100,
  startLife: 3,
  maxLife: 3,
  continues: 5,
  dartsPerTurn: 3,
  recoveryInterval: 10,
  recovery: true,
};

export const TOWER_COURSE_ID = TOWER_COURSE_SOURCE.courseId;
export const TOWER_DATA_VERSION = TOWER_COURSE_SOURCE.schemaVersion;

/** How many action ids are remembered for duplicate rejection. Only the newest few can repeat. */
const RECENT_ACTION_LIMIT = 8;

export class TowerFloorRangeError extends RangeError {}

/** The lit regions of a floor. Throws rather than returning an empty set for a floor off the course. */
export function floorRegions(floor: number): readonly TowerRegionId[] {
  const entry = TOWER_COURSE_FLOORS[floor - 1];
  if (!entry) {
    throw new TowerFloorRangeError(`${floor}F はコース（1F〜${TOWER_COURSE_FLOORS.length}F）にありません。`);
  }
  return entry;
}

const targetTextCache = new Map<number, string>();

/** The generated one-line caption for a floor - derived from its regions, never hand-written. */
export function floorTargetText(floor: number): string {
  const cached = targetTextCache.get(floor);
  if (cached !== undefined) return cached;
  const text = describeFloorTargets(floorRegions(floor));
  targetTextCache.set(floor, text);
  return text;
}

/** True when clearing this floor restores LIFE. 10F, 20F ... 90F; 100F ends the game instead. */
export function isRecoveryFloor(floor: number, rules: TowerRules = TOWER_RULES): boolean {
  return rules.recovery && floor < rules.finalFloor && floor % rules.recoveryInterval === 0;
}

export type PlayerIndex = 0 | 1;

export interface TowerSettings {
  playerCount: 1 | 2;
  /** Always two slots so 「同じ設定でもう一度」 keeps player 2's name across a solo game. */
  names: [string, string];
}

export function defaultTowerSettings(): TowerSettings {
  return { playerCount: 1, names: ['', ''] };
}

export function normalizeName(name: string, index: PlayerIndex): string {
  const trimmed = name.trim();
  return trimmed === '' ? `PLAYER ${index + 1}` : trimmed;
}

/** `playing` can still throw; the other two are final for that player within the game. */
export type TowerPlayerStatus = 'playing' | 'cleared' | 'retired';

export interface TowerStats {
  throws: number;
  hits: number;
  misses: number;
}

export interface TowerPlayer {
  name: string;
  /** The floor being attempted right now. Never advances past `finalFloor`. */
  currentFloor: number;
  /** The highest floor actually beaten - 0 until the first hit. This is what RESULT reports. */
  lastClearedFloor: number;
  life: number;
  continuesUsed: number;
  status: TowerPlayerStatus;
  stats: TowerStats;
}

/**
 * - `throw`       waiting for this dart's judgement
 * - `pickup`      three darts thrown: collect them, then 「次へ」
 * - `continue`    LIFE 0 with CONTINUEs left: YES / NO
 * - `player-over`  this player is done (cleared or retired); 「次へ」 hands over or ends the game
 * - `result`      everyone is done
 */
export type TowerPhase = 'throw' | 'pickup' | 'continue' | 'player-over' | 'result';

export type TowerThrowResult = 'hit' | 'miss';

export interface TowerThrowEvent {
  kind: 'throw';
  id: string;
  playerIndex: PlayerIndex;
  playerName: string;
  /** The floor this dart was thrown at - not the floor that follows it. */
  floor: number;
  /** 1...3 within the turn. */
  dartNumber: number;
  result: TowerThrowResult;
  lifeAfter: number;
  /** The 10F-recovery fired on this dart. True even at full LIFE, as the video shows it. */
  recovered: boolean;
  clearedTower: boolean;
}

export interface TowerContinueEvent {
  kind: 'continue';
  id: string;
  playerIndex: PlayerIndex;
  playerName: string;
  floor: number;
  answer: 'yes' | 'no';
}

export type TowerEvent = TowerThrowEvent | TowerContinueEvent;

type TowerActionKind = 'throw' | 'continue' | 'advance';

/**
 * The state as it stood immediately before one action, which is what the action is undone by.
 *
 * `history` and `recentActionIds` are append-only, so a length and a copy restore them exactly -
 * there is no need to hold a second copy of the whole event log per action.
 */
interface TowerSnapshot {
  action: TowerActionKind;
  actionId: string;
  players: TowerPlayer[];
  activePlayerIndex: PlayerIndex;
  dartsUsedInTurn: number;
  phase: TowerPhase;
  actionSeq: number;
  historyLength: number;
  recentActionIds: string[];
}

export interface TowerState {
  courseId: string;
  dataVersion: string;
  rules: TowerRules;
  settings: TowerSettings;
  players: TowerPlayer[];
  activePlayerIndex: PlayerIndex;
  /** Darts thrown in the current turn, 0...3. Counts across floors - a turn is 3 darts, not a floor. */
  dartsUsedInTurn: number;
  phase: TowerPhase;
  /** Increments on every accepted action; the identity half of duplicate rejection. */
  actionSeq: number;
  recentActionIds: string[];
  history: TowerEvent[];
  undoStack: TowerSnapshot[];
}

function clonePlayer(player: TowerPlayer): TowerPlayer {
  return { ...player, stats: { ...player.stats } };
}

export function createTowerGame(settings: TowerSettings, rules: TowerRules = TOWER_RULES): TowerState {
  const indexes: PlayerIndex[] = settings.playerCount === 2 ? [0, 1] : [0];
  return {
    courseId: TOWER_COURSE_ID,
    dataVersion: TOWER_DATA_VERSION,
    rules,
    settings: { ...settings, names: [...settings.names] as [string, string] },
    players: indexes.map((index) => ({
      name: normalizeName(settings.names[index], index),
      currentFloor: rules.startFloor,
      lastClearedFloor: 0,
      life: rules.startLife,
      continuesUsed: 0,
      status: 'playing' as const,
      stats: { throws: 0, hits: 0, misses: 0 },
    })),
    activePlayerIndex: 0,
    dartsUsedInTurn: 0,
    phase: 'throw',
    actionSeq: 0,
    recentActionIds: [],
    history: [],
    undoStack: [],
  };
}

/**
 * The id the next action of this kind will carry.
 *
 * Derived from the state rather than from a clock or a counter held outside it, which is what makes
 * duplicate rejection work: two handlers that fire against the same (not yet re-rendered) state -
 * a double click, a touch that also reports a click, a key that repeats - compute the same id, and
 * the second is refused. Two genuinely consecutive inputs see different states, so they differ.
 */
export function nextActionId(state: TowerState, kind: TowerActionKind): string {
  return `${kind}:${state.actionSeq}`;
}

function isDuplicate(state: TowerState, actionId: string): boolean {
  return state.recentActionIds.includes(actionId);
}

function remember(ids: readonly string[], id: string): string[] {
  return [...ids, id].slice(-RECENT_ACTION_LIMIT);
}

function snapshotOf(state: TowerState, action: TowerActionKind, actionId: string): TowerSnapshot {
  return {
    action,
    actionId,
    players: state.players.map(clonePlayer),
    activePlayerIndex: state.activePlayerIndex,
    dartsUsedInTurn: state.dartsUsedInTurn,
    phase: state.phase,
    actionSeq: state.actionSeq,
    historyLength: state.history.length,
    recentActionIds: [...state.recentActionIds],
  };
}

export function activeTowerPlayer(state: TowerState): TowerPlayer {
  return state.players[state.activePlayerIndex];
}

export function playerIndexes(state: TowerState): PlayerIndex[] {
  return state.players.length === 2 ? [0, 1] : [0];
}

export function remainingContinues(player: TowerPlayer, rules: TowerRules = TOWER_RULES): number {
  return Math.max(0, rules.continues - player.continuesUsed);
}

export function totalThrows(state: TowerState): number {
  return state.players.reduce((sum, player) => sum + player.stats.throws, 0);
}

export function allFinished(state: TowerState): boolean {
  return state.players.every((player) => player.status !== 'playing');
}

/** True while the two judgement buttons should do anything at all. */
export function canJudge(state: TowerState): boolean {
  return state.phase === 'throw' && activeTowerPlayer(state).status === 'playing';
}

/**
 * The player who throws next, or null when nobody is left.
 *
 * Scans forward from the active player and checks the active player last, so a handover prefers the
 * other player but a solo game - or a game whose other player has finished - stays put.
 */
function findNextPlayer(state: TowerState): PlayerIndex | null {
  const count = state.players.length;
  for (let step = 1; step <= count; step += 1) {
    const index = ((state.activePlayerIndex + step) % count) as PlayerIndex;
    if (state.players[index].status === 'playing') return index;
  }
  return null;
}

/**
 * Records one dart's judgement. The order below is the rule, and the phase decision at the end is
 * what keeps a GAME OVER from being swallowed by the end of a turn.
 *
 * Returns the input state unchanged - never throws - when the input cannot be accepted: wrong
 * phase, finished player, or an id already processed. A refused input costs no dart.
 */
export function applyThrow(
  state: TowerState,
  result: TowerThrowResult,
  options: { actionId?: string } = {},
): TowerState {
  const actionId = options.actionId ?? nextActionId(state, 'throw');
  if (state.phase !== 'throw' || isDuplicate(state, actionId)) return state;

  const index = state.activePlayerIndex;
  const current = state.players[index];
  if (!current || current.status !== 'playing') return state;

  const before = snapshotOf(state, 'throw', actionId);
  const { rules } = state;
  const floor = current.currentFloor;
  const dartNumber = state.dartsUsedInTurn + 1;
  const dartsUsedInTurn = dartNumber;

  const player = clonePlayer(current);
  player.stats.throws += 1;

  let recovered = false;
  let clearedTower = false;

  if (result === 'hit') {
    player.stats.hits += 1;
    player.lastClearedFloor = floor;
    if (floor >= rules.finalFloor) {
      // The tower ends on a cleared 100F: no 101F, and no recovery on the way out.
      player.status = 'cleared';
      clearedTower = true;
    } else {
      if (isRecoveryFloor(floor, rules)) {
        // Recovery is applied to the floor just BEATEN, before stepping up - reaching 10F is not
        // what recovers, clearing it is. The effect fires at full LIFE too, and caps at maxLife:
        // n02 rule, there is no carry-over or hidden surplus.
        recovered = true;
        player.life = rules.maxLife;
      }
      player.currentFloor = floor + 1;
    }
  } else {
    player.stats.misses += 1;
    // Same floor, same target. LIFE never goes negative.
    player.life = Math.max(0, player.life - 1);
  }

  let phase: TowerPhase;
  if (player.status === 'cleared') {
    phase = 'player-over';
  } else if (player.life <= 0) {
    // GAME OVER is resolved before the end of the turn, so a third-dart death offers CONTINUE
    // rather than going quietly to the pickup screen.
    if (player.continuesUsed < rules.continues) {
      phase = 'continue';
    } else {
      // n02 rule: out of CONTINUEs, the player is simply finished - the original was never observed
      // running out.
      player.status = 'retired';
      phase = 'player-over';
    }
  } else if (dartsUsedInTurn >= rules.dartsPerTurn) {
    phase = 'pickup';
  } else {
    phase = 'throw';
  }

  const event: TowerThrowEvent = {
    kind: 'throw',
    id: actionId,
    playerIndex: index,
    playerName: player.name,
    floor,
    dartNumber,
    result,
    lifeAfter: player.life,
    recovered,
    clearedTower,
  };

  return {
    ...state,
    players: state.players.map((entry, position) => (position === index ? player : entry)),
    dartsUsedInTurn,
    phase,
    actionSeq: state.actionSeq + 1,
    recentActionIds: remember(state.recentActionIds, actionId),
    history: [...state.history, event],
    undoStack: [...state.undoStack, before],
  };
}

/**
 * Answers the CONTINUE prompt.
 *
 * YES restarts the SAME floor with a full LIFE and does NOT reset the turn - n02 rule: the darts
 * already thrown in this turn stay spent, so a first-dart death leaves two darts to throw and a
 * third-dart death goes to the pickup screen. A CONTINUE is not a dart and never counts as one.
 *
 * NO retires the player. Any darts left in the turn are simply given up, never recorded as misses.
 */
export function chooseContinue(
  state: TowerState,
  answer: 'yes' | 'no',
  options: { actionId?: string } = {},
): TowerState {
  const actionId = options.actionId ?? nextActionId(state, 'continue');
  if (state.phase !== 'continue' || isDuplicate(state, actionId)) return state;

  const index = state.activePlayerIndex;
  const current = state.players[index];
  if (!current || current.status !== 'playing') return state;
  if (answer === 'yes' && current.continuesUsed >= state.rules.continues) return state;

  const before = snapshotOf(state, 'continue', actionId);
  const player = clonePlayer(current);
  let phase: TowerPhase;

  if (answer === 'yes') {
    player.continuesUsed += 1;
    player.life = state.rules.startLife;
    phase = state.dartsUsedInTurn >= state.rules.dartsPerTurn ? 'pickup' : 'throw';
  } else {
    player.status = 'retired';
    phase = 'player-over';
  }

  const event: TowerContinueEvent = {
    kind: 'continue',
    id: actionId,
    playerIndex: index,
    playerName: player.name,
    floor: player.currentFloor,
    answer,
  };

  return {
    ...state,
    players: state.players.map((entry, position) => (position === index ? player : entry)),
    phase,
    actionSeq: state.actionSeq + 1,
    recentActionIds: remember(state.recentActionIds, actionId),
    history: [...state.history, event],
    undoStack: [...state.undoStack, before],
  };
}

/**
 * The 「次へ」 of the pickup screen and of a player's closing screen. Never fires on a timer - a
 * turn only ends when somebody says it has.
 */
export function advanceTurn(state: TowerState, options: { actionId?: string } = {}): TowerState {
  const actionId = options.actionId ?? nextActionId(state, 'advance');
  if ((state.phase !== 'pickup' && state.phase !== 'player-over') || isDuplicate(state, actionId)) {
    return state;
  }

  const before = snapshotOf(state, 'advance', actionId);
  const next = findNextPlayer(state);

  return {
    ...state,
    activePlayerIndex: next ?? state.activePlayerIndex,
    dartsUsedInTurn: 0,
    phase: next === null ? 'result' : 'throw',
    actionSeq: state.actionSeq + 1,
    recentActionIds: remember(state.recentActionIds, actionId),
    undoStack: [...state.undoStack, before],
  };
}

function restoreSnapshot(state: TowerState, index: number): TowerState {
  const snapshot = state.undoStack[index];
  return {
    ...state,
    players: snapshot.players.map(clonePlayer),
    activePlayerIndex: snapshot.activePlayerIndex,
    dartsUsedInTurn: snapshot.dartsUsedInTurn,
    phase: snapshot.phase,
    actionSeq: snapshot.actionSeq,
    recentActionIds: [...snapshot.recentActionIds],
    history: state.history.slice(0, snapshot.historyLength),
    undoStack: state.undoStack.slice(0, index),
  };
}

function lastThrowSnapshotIndex(state: TowerState): number {
  for (let index = state.undoStack.length - 1; index >= 0; index -= 1) {
    if (state.undoStack[index].action === 'throw') return index;
  }
  return -1;
}

export function canUndoThrow(state: TowerState): boolean {
  return lastThrowSnapshotIndex(state) !== -1;
}

/**
 * Takes back the most recent dart and everything that followed it - the CONTINUE answered after it,
 * the handover taken after it, the RESULT screen reached after it. The state returned is the one
 * that dart was thrown into, restored rather than recomputed, so a recovery, a floor step, a
 * CONTINUE's LIFE reset and a 100F clear all come back exactly as they were.
 */
export function undoLastThrow(state: TowerState): TowerState {
  const index = lastThrowSnapshotIndex(state);
  return index === -1 ? state : restoreSnapshot(state, index);
}

/** The dart 「1投戻す」 would take back, or null. */
export function undoTargetThrow(state: TowerState): TowerThrowEvent | null {
  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    const event = state.history[index];
    if (event.kind === 'throw') return event;
  }
  return null;
}

export interface TowerRewindPreview {
  eventId: string;
  playerIndex: PlayerIndex;
  playerName: string;
  floor: number;
  dartNumber: number;
  /** Darts that stop counting, this one included. */
  discardedThrows: number;
  /** CONTINUEs that are given back. */
  discardedContinues: number;
}

function throwSnapshotIndex(state: TowerState, eventId: string): number {
  return state.undoStack.findIndex(
    (snapshot) => snapshot.action === 'throw' && snapshot.actionId === eventId,
  );
}

export function canRewindTo(state: TowerState, eventId: string): boolean {
  return throwSnapshotIndex(state, eventId) !== -1;
}

/**
 * What rewinding to a given dart would cost, for the confirmation the UI shows before doing it.
 * Null when that dart is not a rewind point (it is not in this game, or it was already rewound past).
 */
export function rewindPreview(state: TowerState, eventId: string): TowerRewindPreview | null {
  const index = throwSnapshotIndex(state, eventId);
  if (index === -1) return null;
  const snapshot = state.undoStack[index];
  const discarded = state.history.slice(snapshot.historyLength);
  const event = state.history[snapshot.historyLength];
  if (!event || event.kind !== 'throw') return null;

  return {
    eventId,
    playerIndex: event.playerIndex,
    playerName: event.playerName,
    floor: event.floor,
    dartNumber: event.dartNumber,
    discardedThrows: discarded.filter((entry) => entry.kind === 'throw').length,
    discardedContinues: discarded.filter((entry) => entry.kind === 'continue' && entry.answer === 'yes')
      .length,
  };
}

/**
 * Rewinds to just before an older dart. Every later dart, CONTINUE and handover is dropped rather
 * than re-applied: the app never knew where any of those darts landed, so it cannot say what they
 * would mean against a different floor. The player throws again from here.
 */
export function rewindToThrow(state: TowerState, eventId: string): TowerState {
  const index = throwSnapshotIndex(state, eventId);
  return index === -1 ? state : restoreSnapshot(state, index);
}

/** Valid darts, newest first, for the on-screen history strip. */
export function recentThrows(state: TowerState, limit: number): TowerThrowEvent[] {
  const result: TowerThrowEvent[] = [];
  for (let index = state.history.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const event = state.history[index];
    if (event.kind === 'throw') result.push(event);
  }
  return result;
}

/** Every dart of the turn in progress, oldest first - what the 1/2/3 pips read from. */
export function currentTurnThrows(state: TowerState): TowerThrowEvent[] {
  if (state.dartsUsedInTurn === 0) return [];
  const turn: TowerThrowEvent[] = [];
  for (let index = state.history.length - 1; index >= 0 && turn.length < state.dartsUsedInTurn; index -= 1) {
    const event = state.history[index];
    if (event.kind !== 'throw') continue;
    if (event.playerIndex !== state.activePlayerIndex) break;
    turn.unshift(event);
  }
  return turn;
}

export interface TowerPlayerResult {
  name: string;
  startFloor: number;
  /** The last floor actually beaten - 0 when 1F was never cleared. Not the floor being attempted. */
  clearFloor: number;
  status: TowerPlayerStatus;
  life: number;
  continuesUsed: number;
  stats: TowerStats;
}

export function playerResults(state: TowerState): TowerPlayerResult[] {
  return state.players.map((player) => ({
    name: player.name,
    startFloor: state.rules.startFloor,
    clearFloor: player.lastClearedFloor,
    status: player.status,
    life: player.life,
    continuesUsed: player.continuesUsed,
    stats: { ...player.stats },
  }));
}
