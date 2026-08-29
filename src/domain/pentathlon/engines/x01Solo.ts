import { isReachableScore, MAX_VISIT_SCORE, validFinishDartCounts } from '../../darts';
import { InvalidVisitError, resolveVisit, type VisitResolution } from '../../x01Core';
import type { CompareOutcome, DisciplineEngine, DisciplineId, DisciplineResult } from '../types';

export interface X01SoloState {
  startScore: number;
  remaining: number;
  darts: number;
  round: number;
  finished: boolean;
  checkedOut: boolean;
  visits: Array<{
    score: number;
    darts: number;
    bust: boolean;
    checkout: boolean;
    /**
     * What the player actually typed, which is what a replay has to work from. `score` is the
     * scoring value (0 on a bust), so it alone cannot tell a genuine 0 from a bust - and after an
     * edit, a visit that used to bust may well fit the corrected remaining. Optional because
     * sessions saved before edit-a-past-score existed have no such field; those fall back to
     * `score`, which is exact for every visit that did not bust.
     */
    entered?: number;
  }>;
}

export interface X01SoloInput {
  score: number;
  finishDarts?: number;
}

export interface X01SoloOptions {
  id: DisciplineId;
  name: string;
  startScore: number;
  doubleIn: boolean;
  /** Max rounds before the attempt is abandoned unfinished; 0 = unlimited. */
  roundLimit: number;
}

/**
 * One player's X01 attempt. Each player keeps their own independent state (remaining, darts, visit
 * history), but the discipline itself is a race: per meta.endsOnFirstCompletion, whoever checks out
 * first wins it outright and the opponent stops throwing - the same "first one out takes the leg"
 * rule 通常01・チェックアウト練習 already play by.
 */
export function createX01SoloEngine(
  options: X01SoloOptions,
): DisciplineEngine<X01SoloState, X01SoloInput> {
  const { id, name, startScore, doubleIn, roundLimit } = options;

  return {
    meta: {
      id,
      name,
      description: doubleIn
        ? `ダブルイン / ダブルアウト・${roundLimit}ラウンド制限`
        : 'オープンイン / ダブルアウト',
      inputMode: 'visit-score',
      unit: 'darts',
      endsOnFirstCompletion: true,
    },

    createState: (): X01SoloState => ({
      startScore,
      remaining: startScore,
      darts: 0,
      round: 1,
      finished: false,
      checkedOut: false,
      visits: [],
    }),

    // Double-in is enforced by the player, not the UI: if a double-in visit didn't open the
    // score, they simply enter 0, which resolveVisit treats as a no-op visit (3 darts, no change) -
    // identical to how a bust or a deliberate miss is entered in 通常01/チェックアウト練習.
    applyInput(state, input) {
      if (state.finished) return state;

      const resolution = resolveVisit(state.remaining, input.score, input.finishDarts);
      const next: X01SoloState = {
        ...state,
        remaining: resolution.after,
        darts: state.darts + resolution.darts,
        round: state.round + 1,
        finished: resolution.checkout,
        checkedOut: resolution.checkout,
        visits: [
          ...state.visits,
          {
            score: resolution.bust ? 0 : input.score,
            darts: resolution.darts,
            bust: resolution.bust,
            checkout: resolution.checkout,
            entered: input.score,
          },
        ],
      };
      return next.finished ? next : finalizeIfRoundLimitReached(next, roundLimit);
    },

    /**
     * Corrects an already-entered visit and replays the attempt from the start score - the same
     * "修正して再計算" 通常01・チェックアウト練習 offer on their own score sheet. The replay goes back
     * through resolveVisit rather than doing the arithmetic itself, so a corrected visit is held to
     * exactly the rules a live one is: landing on zero only checks out from a remaining that can
     * actually be gone out on, in a number of darts that can actually do it. Reaching zero is not
     * enough on its own - a remaining of 1 or of 171-180 cannot be finished at all, and here a
     * wrongly accepted checkout would not just misreport a stat, it would end the discipline on the
     * spot and hand someone the win.
     *
     * A visit that no longer fits the corrected remaining becomes a bust, and anything recorded
     * after a checkout is dropped, because those darts could never have been thrown.
     */
    editVisit(state, visitIndex, newScore, newDarts) {
      if (visitIndex < 0 || visitIndex >= state.visits.length) return state;
      if (
        !Number.isInteger(newScore) ||
        newScore < 0 ||
        newScore > MAX_VISIT_SCORE ||
        !isReachableScore(newScore)
      ) {
        throw new InvalidVisitError(
          `修正する得点は0～${MAX_VISIT_SCORE}の、3投で実際に出せる数字で入力してください。`,
        );
      }
      if (!Number.isInteger(newDarts) || newDarts < 1 || newDarts > 3) {
        throw new InvalidVisitError('使用ダーツは1～3本で指定してください。');
      }

      const entries = state.visits.map((visit, index) =>
        index === visitIndex
          ? { entered: newScore, darts: newDarts }
          : { entered: visit.entered ?? visit.score, darts: visit.darts },
      );

      let remaining = state.startScore;
      let darts = 0;
      let checkedOut = false;
      const visits: X01SoloState['visits'] = [];
      for (const [index, entry] of entries.entries()) {
        let resolution: VisitResolution;
        try {
          resolution = resolveVisit(remaining, entry.entered, entry.darts);
        } catch (caught) {
          if (!(caught instanceof InvalidVisitError)) throw caught;
          // The correction itself is the throw that cannot be made: reject it and change nothing,
          // so the dialog can say why rather than quietly recording something impossible.
          if (index === visitIndex) throw impossibleEditError(caught, remaining, entry);
          // An untouched later visit that the correction has made impossible - its score now lands
          // exactly on a remaining that cannot be gone out on. On the board that is a bust.
          resolution = { after: remaining, bust: true, checkout: false, darts: 3 };
        }
        visits.push({
          // Only a checkout gets to say how many darts it took; every other visit is three, which
          // is the only count applyInput itself can produce.
          score: resolution.bust ? 0 : entry.entered,
          darts: resolution.checkout ? resolution.darts : 3,
          bust: resolution.bust,
          checkout: resolution.checkout,
          entered: entry.entered,
        });
        remaining = resolution.after;
        darts += resolution.checkout ? resolution.darts : 3;
        if (resolution.checkout) {
          checkedOut = true;
          break;
        }
      }

      const next: X01SoloState = {
        ...state,
        remaining,
        darts,
        round: visits.length + 1,
        finished: checkedOut,
        checkedOut,
        visits,
      };
      return next.finished ? next : finalizeIfRoundLimitReached(next, roundLimit);
    },

    isFinished: (state) => state.finished,

    getResult(state): DisciplineResult {
      return {
        value: state.checkedOut ? state.darts : Number.POSITIVE_INFINITY,
        unit: 'darts',
        completed: state.checkedOut,
        darts: state.darts,
        label: state.checkedOut ? `${state.darts} DARTS` : 'DNF',
      };
    },

    // Fewer darts wins. A player who never checked out always loses to one who did.
    compareResults: (a, b): CompareOutcome => {
      if (a.completed && !b.completed) return 'p0';
      if (!a.completed && b.completed) return 'p1';
      if (!a.completed && !b.completed) return 'draw';
      if (a.value < b.value) return 'p0';
      if (b.value < a.value) return 'p1';
      return 'draw';
    },

    describeTarget(state) {
      if (state.finished) return 'FINISHED';
      return `残り ${state.remaining}`;
    },
  };
}

/**
 * resolveVisit's own message for a rejected finish is "上がり本数を選択してください" - written for the
 * live input, where the count has not been chosen yet. On a correction the count HAS been chosen and
 * simply cannot finish this number, so say that instead and name the counts that can.
 */
function impossibleEditError(
  caught: InvalidVisitError,
  remaining: number,
  entry: { entered: number; darts: number },
): InvalidVisitError {
  if (entry.entered !== remaining) return caught;
  const counts = validFinishDartCounts(remaining);
  if (counts.length === 0 || counts.includes(entry.darts)) return caught;
  return new InvalidVisitError(
    `残り${remaining}を${entry.darts}投で上がることはできません。${counts.join('・')}投のいずれかを選んでください。`,
  );
}

function finalizeIfRoundLimitReached(state: X01SoloState, roundLimit: number): X01SoloState {
  if (roundLimit > 0 && state.round > roundLimit) {
    return { ...state, finished: true };
  }
  return state;
}
