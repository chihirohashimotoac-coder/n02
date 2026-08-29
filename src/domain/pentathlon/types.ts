import type { DartHit } from '../darts';

export type PentathlonPreset = 'jda' | 'n01';
export type StarterMode = 'loser' | 'alternate';
export type PlayerIndex = 0 | 1;

export type DisciplineId =
  | 'x01-501'
  | 'x01-301'
  | 'half-it'
  | 'rtc-doubles'
  | 'golf'
  | 'cork'
  | 'baseball'
  | 'cricket';

/**
 * How a discipline's raw result should be read by the UI, so screens never hardcode per-game
 * assumptions ("fewer is better" vs "higher is better").
 */
export type ResultUnit = 'darts' | 'points' | 'strokes' | 'runs';

export interface DisciplineResult {
  /** The primary comparable figure for this discipline, in `unit`s. */
  value: number;
  unit: ResultUnit;
  /** Whether this player actually completed the discipline under its own rules. */
  completed: boolean;
  /** Total darts thrown by this player in this discipline. */
  darts: number;
  /** Short human-readable summary, e.g. "24 DARTS", "128 POINTS", "DNF". */
  label: string;
  /**
   * Replaces the result table's DARTS column for a discipline whose own measure is not the dart
   * count (Cricket reports MPR). Omitted everywhere else, which keeps that column reading DARTS.
   */
  stat?: {
    /** Column heading, e.g. "STATS". */
    label: string;
    primary: string;
    /** Small caption under the heading's value, naming what `primary` is. */
    primaryNote?: string;
    secondary?: string;
  };
}

export type CompareOutcome = 'p0' | 'p1' | 'draw';

/**
 * One player's in-progress state for a discipline. Engines own the shape of `state`; the session
 * controller only cares about `finished` and the eventual `result`.
 */
export interface PlayerProgress<TState> {
  state: TState;
  finished: boolean;
  result: DisciplineResult | null;
}

export interface DisciplineMeta {
  id: DisciplineId;
  /** Display name, e.g. "501", "HALF-IT". */
  name: string;
  /** Short Japanese description shown in the progress list. */
  description: string;
  /** What kind of input UI this discipline needs. */
  inputMode: 'visit-score' | 'dart-hits';
  unit: ResultUnit;
  /**
   * Whether a dart-hit turn may be committed before all dartsRemainingThisTurn() hits are staged.
   * Only true for disciplines where stopping early is itself part of the rules (Golf); everywhere
   * else a partial turn would desync the engine's fixed per-round/per-inning bookkeeping.
   */
  allowEarlyCommit?: boolean;
  /**
   * Whether the FIRST player to complete the discipline (getResult().completed) wins it outright,
   * ending it there and then. True for 301/501, which are a race to check out exactly like 通常01・
   * チェックアウト練習 - the opponent does not get to keep throwing once someone has gone out.
   * Only a genuine completion ends it: a player who merely runs out of rounds (301's round limit)
   * finishes without completing, and the other player throws on and can still win.
   */
  endsOnFirstCompletion?: boolean;
}

/**
 * The contract every Pentathlon discipline implements. Keeping compareResults() here (rather than
 * in the session controller) is what stops the controller from comparing unrelated numbers - a
 * lower dart count wins 501, but a higher score wins Half-It.
 */
export interface DisciplineEngine<TState = unknown, TInput = unknown> {
  meta: DisciplineMeta;
  /** Fresh per-player state at the start of the discipline. */
  createState(): TState;
  /** Applies one input (a visit score, or a set of dart hits) to one player's state. */
  applyInput(state: TState, input: TInput): TState;
  /** True once this player can no longer throw in this discipline. */
  isFinished(state: TState): boolean;
  /** The player's official result. Only meaningful once isFinished() is true. */
  getResult(state: TState): DisciplineResult;
  /** Official winner determination for this discipline, per its own rules. */
  compareResults(a: DisciplineResult, b: DisciplineResult): CompareOutcome;
  /** Human-readable "what should I aim at now" for the current state. */
  describeTarget(state: TState): string;
  /**
   * Which round this player is on, for disciplines played over a fixed cadence of rounds. Screens
   * show it verbatim (e.g. "ROUND 3 / 5"); disciplines without a meaningful round count omit it and
   * no round caption is shown at all.
   */
  roundLabel?(state: TState): string;
  /**
   * Corrects an already-entered input and replays everything after it (301/501 only, mirroring
   * 通常01・チェックアウト練習's "修正して再計算"). Play screens offer a tap-to-edit score cell exactly
   * where an engine provides this. Throws InvalidVisitError if the correction itself is not a
   * possible score.
   */
  editVisit?(state: TState, visitIndex: number, newScore: number, newDarts: number): TState;
  /** How many darts the player may still throw this turn (for dart-hit input UIs). */
  dartsRemainingThisTurn?(state: TState): number;
  /**
   * Called once both players have reached isFinished() with a tied compareResults(). Return a
   * replacement (unfinished) state pair to keep playing instead of recording the draw - e.g. Cork's
   * sudden-death re-throw, Baseball's extra innings. Return null/undefined to accept the draw.
   */
  continueOnTie?(a: TState, b: TState): [TState, TState] | null;
  /**
   * Shared-state disciplines only (currently Cricket): after applyInput() updates the active
   * player's own view of the shared board, this derives what the OTHER player's own view should now
   * look like (their own progress mirrored to reflect the active player's turn - e.g. marks the
   * active player just closed, which may block or unblock the other player's scoring). The session
   * controller writes this into the other player's progress slot alongside the active player's.
   * Engines that don't define this are treated as fully independent per-player state, as before.
   */
  mirrorForOpponent?(state: TState): TState;
}

export interface PentathlonDisciplineRecord {
  id: DisciplineId;
  results: [DisciplineResult, DisciplineResult | null];
  outcome: CompareOutcome | null;
  starter: PlayerIndex;
}

/**
 * 'full' is the real five-discipline pentathlon. 'single' is 個別練習: one discipline played on its
 * own, with no overall standing and no bearing on a saved full session.
 */
export type PentathlonMode = 'full' | 'single';

export interface PentathlonSession {
  version: 1;
  preset: PentathlonPreset;
  /** Omitted on sessions saved before 個別練習 existed; treat as 'full'. */
  mode?: PentathlonMode;
  /**
   * The disciplines this session actually plays, in order. Omitted on full sessions (and on anything
   * saved before 個別練習 existed), where the preset's own five disciplines are used.
   */
  disciplines?: DisciplineId[];
  playerCount: 1 | 2;
  names: [string, string];

  initialStarter: PlayerIndex;
  currentStarter: PlayerIndex;
  starterMode: StarterMode;
  /** Whether 301/501 shows a suggested checkout route while throwing. Defaults to off. */
  showRoute: boolean;

  currentDisciplineIndex: number;
  /** Completed discipline records, in play order. */
  records: PentathlonDisciplineRecord[];

  /** Serialized per-player engine state for the in-progress discipline. */
  current: {
    progress: [PlayerProgress<unknown>, PlayerProgress<unknown>];
    /** Whose turn it is right now. */
    active: PlayerIndex;
    /** Dart hits entered so far in the active player's current turn (dart-hit input only). */
    pendingHits: DartHit[];
  } | null;

  undo: PentathlonUndoEntry[];
  status: 'playing' | 'between-disciplines' | 'completed';
  startedAt: string;
}

/** A snapshot of everything a single undo step must restore. */
export interface PentathlonUndoEntry {
  current: PentathlonSession['current'];
  currentDisciplineIndex: number;
  currentStarter: PlayerIndex;
  records: PentathlonDisciplineRecord[];
  status: PentathlonSession['status'];
}
