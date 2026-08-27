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
 * Applies one turn's input for the active player. Crucially, a player finishing does NOT end the
 * discipline - the other player keeps throwing until their own result is final.
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

  const upcoming = nextActivePlayer(partial, active);
  if (upcoming === null) {
    return finishDiscipline(partial);
  }
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
 * Ends the current discipline immediately even though the non-active player hasn't reached
 * isFinished() yet - their in-progress attempt is recorded exactly as it stands (DNF if they hadn't
 * checked out). finishDiscipline() already falls back to engine.getResult() on the raw state for
 * anyone without a committed result, so this needs no extra bookkeeping. Used only by the Pentathlon
 * X01 "proceed to the next discipline without waiting for the opponent's checkout" choice.
 */
export function finishDisciplineNow(session: PentathlonSession): PentathlonSession {
  if (!session.current || session.status !== 'playing') return session;
  return finishDiscipline({ ...session, undo: pushUndo(session) });
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
