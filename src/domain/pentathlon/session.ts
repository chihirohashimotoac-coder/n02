import type { DartHit } from '../darts';
import { getEngine, presetDisciplines } from './presets';
import type {
  CompareOutcome,
  DisciplineId,
  DisciplineResult,
  PentathlonDisciplineRecord,
  PentathlonMode,
  PentathlonSession,
  PentathlonUndoEntry,
  PlayerIndex,
  PlayerProgress,
  PentathlonPreset,
  StarterMode,
} from './types';

export interface CreateSessionOptions {
  preset: PentathlonPreset;
  playerCount: 1 | 2;
  names: [string, string];
  starterMode: StarterMode;
  /** 'random' is resolved exactly once, here, and then persisted - never re-rolled on resume. */
  initialStarter: PlayerIndex | 'random';
  /** Whether 301/501 shows a suggested checkout route while throwing. Defaults to off. */
  showRoute?: boolean;
  /** Defaults to 'full' - the real five-discipline pentathlon. */
  mode?: PentathlonMode;
  /** 個別練習 only: the single discipline to play, instead of the preset's five. */
  disciplines?: DisciplineId[];
}

/** Reconstructs only the setup needed for a fresh attempt from a saved/completed session. */
export function replayOptionsFromSession(session: PentathlonSession): CreateSessionOptions {
  return {
    preset: session.preset,
    playerCount: session.playerCount,
    names: [...session.names] as [string, string],
    starterMode: session.starterMode,
    initialStarter: session.initialStarter,
    showRoute: session.showRoute ?? false,
    mode: session.mode ?? 'full',
    ...(session.disciplines ? { disciplines: [...session.disciplines] } : {}),
  };
}

const MAX_UNDO = 60;

export function createPentathlonSession(options: CreateSessionOptions): PentathlonSession {
  const initialStarter: PlayerIndex =
    options.initialStarter === 'random'
      ? ((Math.random() < 0.5 ? 0 : 1) as PlayerIndex)
      : options.initialStarter;
  const starter = options.playerCount === 1 ? 0 : initialStarter;

  const session: PentathlonSession = {
    version: 1,
    preset: options.preset,
    mode: options.mode ?? 'full',
    ...(options.disciplines ? { disciplines: options.disciplines } : {}),
    playerCount: options.playerCount,
    names: options.names,
    initialStarter: starter,
    currentStarter: starter,
    starterMode: options.starterMode,
    showRoute: options.showRoute ?? false,
    currentDisciplineIndex: 0,
    records: [],
    current: null,
    undo: [],
    status: 'playing',
    startedAt: new Date().toISOString(),
  };
  return startDiscipline(session);
}

/** The disciplines this session plays: 個別練習's single pick, or the preset's own five. */
export function sessionDisciplines(session: PentathlonSession): DisciplineId[] {
  return session.disciplines ?? presetDisciplines(session.preset);
}

/** True for a 個別練習 session - one discipline, no overall standing. */
export function isSingleGameSession(session: PentathlonSession): boolean {
  return (session.mode ?? 'full') === 'single';
}

export function currentDisciplineId(session: PentathlonSession) {
  return sessionDisciplines(session)[session.currentDisciplineIndex];
}

export function disciplineCount(session: PentathlonSession): number {
  return sessionDisciplines(session).length;
}

function startDiscipline(session: PentathlonSession): PentathlonSession {
  const engine = getEngine(currentDisciplineId(session));
  const makeProgress = (): PlayerProgress<unknown> => ({
    state: engine.createState(),
    finished: false,
    result: null,
  });
  return {
    ...session,
    current: {
      progress: [makeProgress(), makeProgress()],
      active: session.currentStarter,
      pendingHits: [],
    },
    status: 'playing',
  };
}

function snapshot(session: PentathlonSession): PentathlonUndoEntry {
  return {
    current: structuredClone(session.current),
    currentDisciplineIndex: session.currentDisciplineIndex,
    currentStarter: session.currentStarter,
    records: structuredClone(session.records),
    status: session.status,
  };
}

function pushUndo(session: PentathlonSession): PentathlonUndoEntry[] {
  const next = [...session.undo, snapshot(session)];
  return next.length > MAX_UNDO ? next.slice(next.length - MAX_UNDO) : next;
}

/** Which player, if any, should throw next - skipping players who already finished. */
function nextActivePlayer(session: PentathlonSession, from: PlayerIndex): PlayerIndex | null {
  const current = session.current;
  if (!current) return null;
  if (session.playerCount === 1) return current.progress[0].finished ? null : 0;

  const other: PlayerIndex = from === 0 ? 1 : 0;
  if (!current.progress[other].finished) return other;
  if (!current.progress[from].finished) return from;
  return null;
}

export function isDisciplineComplete(session: PentathlonSession): boolean {
  const current = session.current;
  if (!current) return true;
  if (session.playerCount === 1) return current.progress[0].finished;
  return current.progress[0].finished && current.progress[1].finished;
}

/**
 * Applies one turn's input for the active player. By default a player finishing does NOT end the
 * discipline - the other player keeps throwing until their own result is final. Disciplines that are
 * a race rather than parallel attempts (301/501, via meta.endsOnFirstCompletion) are the exception:
 * the first completed result ends the discipline immediately.
 */
export function applyTurn(session: PentathlonSession, input: unknown): PentathlonSession {
  const current = session.current;
  if (!current || session.status !== 'playing') return session;

  const engine = getEngine(currentDisciplineId(session));
  const active = current.active;
  if (current.progress[active].finished) return session;

  const undo = pushUndo(session);
  const progress = structuredClone(current.progress) as [PlayerProgress<unknown>, PlayerProgress<unknown>];
  const nextState = engine.applyInput(progress[active].state as never, input as never);
  const finished = engine.isFinished(nextState as never);
  progress[active] = {
    state: nextState,
    finished,
    result: finished ? engine.getResult(nextState as never) : null,
  };

  if (engine.mirrorForOpponent) {
    const other: PlayerIndex = active === 0 ? 1 : 0;
    const mirrored = engine.mirrorForOpponent(nextState as never);
    const mirroredFinished = engine.isFinished(mirrored as never);
    progress[other] = {
      state: mirrored,
      finished: mirroredFinished,
      result: mirroredFinished ? engine.getResult(mirrored as never) : null,
    };
  }

  const partial: PentathlonSession = {
    ...session,
    undo,
    current: { progress, active, pendingHits: [] },
  };

  // A race discipline is over the moment someone actually completes it - the opponent has lost and
  // does not throw again, so their attempt is closed off exactly where it stands. Merely being
  // `finished` is not enough: 301's round limit finishes a player without a checkout, and the other
  // player must still get to go out and win.
  if (engine.meta.endsOnFirstCompletion && progress[active].result?.completed) {
    const other: PlayerIndex = active === 0 ? 1 : 0;
    if (session.playerCount === 2 && !progress[other].finished) {
      progress[other] = {
        ...progress[other],
        finished: true,
        result: engine.getResult(progress[other].state as never),
      };
    }
    return finishDiscipline({ ...partial, current: { progress, active, pendingHits: [] } });
  }

  const upcoming = nextActivePlayer(partial, active);
  if (upcoming === null) {
    return finishDiscipline(partial);
  }
  return { ...partial, current: { progress, active: upcoming, pendingHits: [] } };
}

/**
 * Corrects one already-entered visit of the given player and replays the rest of their attempt
 * (301/501 only - engines without editVisit have no such operation and are left untouched). The
 * correction goes on the undo stack like any other committed change, and can flip the discipline
 * either way: a corrected score that now checks out ends a race discipline immediately, and one
 * that no longer checks out puts the player back on the oche.
 */
export function editVisitScore(
  session: PentathlonSession,
  player: PlayerIndex,
  visitIndex: number,
  newScore: number,
  newDarts: number,
): PentathlonSession {
  const current = session.current;
  if (!current || session.status !== 'playing') return session;
  const engine = getEngine(currentDisciplineId(session));
  if (!engine.editVisit) return session;

  const undo = pushUndo(session);
  const progress = structuredClone(current.progress) as [PlayerProgress<unknown>, PlayerProgress<unknown>];
  const nextState = engine.editVisit(progress[player].state as never, visitIndex, newScore, newDarts);
  const finished = engine.isFinished(nextState as never);
  progress[player] = {
    state: nextState,
    finished,
    result: finished ? engine.getResult(nextState as never) : null,
  };

  const partial: PentathlonSession = {
    ...session,
    undo,
    current: { progress, active: current.active, pendingHits: [] },
  };

  if (engine.meta.endsOnFirstCompletion && progress[player].result?.completed) {
    const other: PlayerIndex = player === 0 ? 1 : 0;
    if (session.playerCount === 2 && !progress[other].finished) {
      progress[other] = {
        ...progress[other],
        finished: true,
        result: engine.getResult(progress[other].state as never),
      };
    }
    return finishDiscipline(partial);
  }

  // The correction may have finished (or un-finished) whoever was on the oche, so the turn order is
  // recomputed rather than assumed.
  const upcoming = progress[current.active].finished
    ? nextActivePlayer(partial, current.active)
    : current.active;
  if (upcoming === null) return finishDiscipline(partial);
  return { ...partial, current: { progress, active: upcoming, pendingHits: [] } };
}

/** Records the completed discipline and computes the next starter. */
function finishDiscipline(session: PentathlonSession): PentathlonSession {
  const current = session.current;
  if (!current) return session;
  const engine = getEngine(currentDisciplineId(session));

  const p0Result = current.progress[0].result ?? engine.getResult(current.progress[0].state as never);
  const p1Result =
    session.playerCount === 2
      ? (current.progress[1].result ?? engine.getResult(current.progress[1].state as never))
      : null;

  const outcome: CompareOutcome | null =
    p1Result !== null ? engine.compareResults(p0Result, p1Result) : null;

  if (outcome === 'draw' && session.playerCount === 2 && engine.continueOnTie) {
    const continued = engine.continueOnTie(current.progress[0].state as never, current.progress[1].state as never);
    if (continued) {
      const [s0, s1] = continued;
      return {
        ...session,
        current: {
          progress: [
            { state: s0, finished: false, result: null },
            { state: s1, finished: false, result: null },
          ],
          active: session.currentStarter,
          pendingHits: [],
        },
        status: 'playing',
      };
    }
  }

  const record: PentathlonDisciplineRecord = {
    id: currentDisciplineId(session),
    results: [p0Result, p1Result],
    outcome,
    starter: session.currentStarter,
  };

  return {
    ...session,
    records: [...session.records, record],
    current: { ...current, pendingHits: [] },
    status: 'between-disciplines',
  };
}

/**
 * The next discipline's starter.
 * - alternate: always swap, regardless of who won.
 * - loser: the losing player starts next. On a DRAW there is no loser, so the previous discipline's
 *   *second* player starts (i.e. the starter swaps) - a deterministic rule, never random, so undo
 *   and resume reproduce it exactly.
 */
export function computeNextStarter(
  starterMode: StarterMode,
  previousStarter: PlayerIndex,
  outcome: CompareOutcome | null,
): PlayerIndex {
  const swapped: PlayerIndex = previousStarter === 0 ? 1 : 0;
  if (starterMode === 'alternate') return swapped;
  if (outcome === 'draw' || outcome === null) return swapped;
  return outcome === 'p0' ? 1 : 0;
}

/** Moves on to the next discipline (or completes the session). */
export function advanceDiscipline(session: PentathlonSession): PentathlonSession {
  if (session.status !== 'between-disciplines') return session;
  const undo = pushUndo(session);
  const lastRecord = session.records[session.records.length - 1];
  const nextIndex = session.currentDisciplineIndex + 1;

  if (nextIndex >= disciplineCount(session)) {
    return { ...session, undo, current: null, status: 'completed' };
  }

  const nextStarter =
    session.playerCount === 1
      ? 0
      : computeNextStarter(session.starterMode, session.currentStarter, lastRecord?.outcome ?? null);

  return startDiscipline({
    ...session,
    undo,
    currentDisciplineIndex: nextIndex,
    currentStarter: nextStarter,
  });
}

/**
 * Stages a dart hit for the active player's in-progress turn (dart-hit input UIs). Staged hits live
 * only in `pendingHits` and never touch the undo stack - taking one back is undoStagedHit(), which
 * is a different operation from undoing an already-committed round.
 */
export function stageHit(session: PentathlonSession, hit: DartHit): PentathlonSession {
  const current = session.current;
  if (!current || session.status !== 'playing') return session;
  const engine = getEngine(currentDisciplineId(session));
  const maxDarts = engine.dartsRemainingThisTurn?.(current.progress[current.active].state as never) ?? 3;
  if (current.pendingHits.length >= maxDarts) return session;
  return {
    ...session,
    current: { ...current, pendingHits: [...current.pendingHits, hit] },
  };
}

/**
 * Replaces the whole staged turn at once, for input UIs that correct a turn in place rather than
 * only appending to it (Cricket: tapping an already-entered mark to change or clear it). Like
 * stageHit, this never touches the undo stack - nothing has been committed yet.
 */
export function setPendingHits(session: PentathlonSession, hits: DartHit[]): PentathlonSession {
  const current = session.current;
  if (!current || session.status !== 'playing') return session;
  const engine = getEngine(currentDisciplineId(session));
  const maxDarts = engine.dartsRemainingThisTurn?.(current.progress[current.active].state as never) ?? 3;
  return { ...session, current: { ...current, pendingHits: hits.slice(0, maxDarts) } };
}

/** Commits the staged dart hits as the active player's turn. */
export function commitHits(session: PentathlonSession): PentathlonSession {
  const current = session.current;
  if (!current || current.pendingHits.length === 0) return session;
  return applyTurn(session, current.pendingHits);
}

/** Takes back the last dart staged in the current, still-uncommitted turn. */
export function undoStagedHit(session: PentathlonSession): PentathlonSession {
  const current = session.current;
  if (!current || current.pendingHits.length === 0) return session;
  return { ...session, current: { ...current, pendingHits: current.pendingHits.slice(0, -1) } };
}

export function canUndoStagedHit(session: PentathlonSession): boolean {
  return (session.current?.pendingHits.length ?? 0) > 0;
}

/**
 * Undoes the most recent *committed* step - a completed turn or a discipline advance. Refuses while
 * darts are staged for the current turn: those belong to undoStagedHit(), and undoing a committed
 * round out from under a half-entered turn would silently discard it.
 */
export function undoRound(session: PentathlonSession): PentathlonSession {
  if (!canUndoRound(session)) return session;
  const previous = session.undo[session.undo.length - 1];
  return {
    ...session,
    current: structuredClone(previous.current),
    currentDisciplineIndex: previous.currentDisciplineIndex,
    currentStarter: previous.currentStarter,
    records: structuredClone(previous.records),
    status: previous.status,
    undo: session.undo.slice(0, -1),
  };
}

export function canUndoRound(session: PentathlonSession): boolean {
  return session.undo.length > 0 && !canUndoStagedHit(session);
}

/** True if either kind of undo is currently available. */
export function canUndo(session: PentathlonSession): boolean {
  return canUndoStagedHit(session) || canUndoRound(session);
}

export interface PentathlonTotals {
  wins: [number, number];
  draws: number;
  overall: CompareOutcome | null;
}

/**
 * Overall standing. Per docs/pentathlon-rules.md, the official score->points conversion table could
 * not be sourced, so this reports discipline wins (clearly labelled as such in the UI) rather than
 * inventing point values and presenting them as official.
 */
export function computeTotals(session: PentathlonSession): PentathlonTotals {
  let p0 = 0;
  let p1 = 0;
  let draws = 0;
  for (const record of session.records) {
    if (record.outcome === 'p0') p0 += 1;
    else if (record.outcome === 'p1') p1 += 1;
    else if (record.outcome === 'draw') draws += 1;
  }
  const overall: CompareOutcome | null =
    session.playerCount === 1 ? null : p0 > p1 ? 'p0' : p1 > p0 ? 'p1' : 'draw';
  return { wins: [p0, p1], draws, overall };
}

export function resultForDisplay(result: DisciplineResult | null): string {
  return result ? result.label : '—';
}
