import { useCallback, useState } from 'react';
import TopBar from '../TopBar';
import ThemeSelect from '../ThemeSelect';
import PentathlonSetup from './PentathlonSetup';
import SingleGameSetup from './SingleGameSetup';
import PentathlonPlay from './PentathlonPlay';
import PentathlonX01Play from './PentathlonX01Play';
import PentathlonCricketPlay from './PentathlonCricketPlay';
import DisciplineResult from './DisciplineResult';
import PentathlonResult from './PentathlonResult';
import SingleGameResult from './SingleGameResult';
import {
  advanceDiscipline,
  applyTurn,
  canUndo as canUndoSession,
  createPentathlonSession,
  currentDisciplineId,
  setPendingHits,
  stageHit,
  undoRound as undoRoundSession,
  undoStagedHit as undoStagedHitSession,
  canUndoRound as canUndoRoundSession,
  type CreateSessionOptions,
} from '../../domain/pentathlon/session';
import { findSingleGameOption, getEngine } from '../../domain/pentathlon/presets';
import {
  clearPentathlonSession,
  clearSingleGameSession,
  loadPentathlonSession,
  loadSingleGameSession,
  savePentathlonSession,
  saveSingleGameSession,
} from '../../storage/pentathlonStorage';
import { InvalidVisitError } from '../../domain/x01Core';
import type { DartHit } from '../../domain/darts';
import type { PentathlonSession } from '../../domain/pentathlon/types';
import type { ThemeName } from '../../storage/matchStorage';

/** The menu label of the discipline a saved 個別練習 session was playing. */
function singleGameLabel(session: PentathlonSession): string | undefined {
  const disciplineId = session.disciplines?.[0];
  if (!disciplineId) return undefined;
  return findSingleGameOption(`${session.preset}:${disciplineId}`)?.label;
}

interface Props {
  theme: ThemeName;
  onChangeTheme: (theme: ThemeName) => void;
  onExit: () => void;
  /** 'single' is 個別練習: one discipline, stored under its own key, no overall standing. */
  variant?: 'full' | 'single';
}

export default function PentathlonFlow({ theme, onChangeTheme, onExit, variant = 'full' }: Props) {
  const isSingle = variant === 'single';
  const load = isSingle ? loadSingleGameSession : loadPentathlonSession;
  const save = isSingle ? saveSingleGameSession : savePentathlonSession;
  const clear = isSingle ? clearSingleGameSession : clearPentathlonSession;

  const [session, setSession] = useState<PentathlonSession | null>(null);
  const [savedSession, setSavedSession] = useState<PentathlonSession | null>(load);
  const [lastOptions, setLastOptions] = useState<CreateSessionOptions | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    (next: PentathlonSession) => {
      setSession(next);
      save(next);
    },
    [save],
  );

  const start = useCallback(
    (options: CreateSessionOptions) => {
      setLastOptions(options);
      update(createPentathlonSession(options));
      setError(null);
    },
    [update],
  );

  const resume = useCallback(() => {
    const stored = load();
    if (stored) {
      setSession(stored);
      setError(null);
    }
  }, [load]);

  const handleTurn = useCallback(
    (input: unknown) => {
      if (!session) return;
      try {
        update(applyTurn(session, input));
        setError(null);
      } catch (caught) {
        if (caught instanceof InvalidVisitError) setError(caught.message);
        else throw caught;
      }
    },
    [session, update],
  );

  const handleStageHit = useCallback(
    (hit: DartHit) => {
      if (!session) return;
      update(stageHit(session, hit));
    },
    [session, update],
  );

  const handleSetPendingHits = useCallback(
    (hits: DartHit[]) => {
      if (!session) return;
      update(setPendingHits(session, hits));
    },
    [session, update],
  );

  const handleUndoStagedHit = useCallback(() => {
    if (!session) return;
    update(undoStagedHitSession(session));
    setError(null);
  }, [session, update]);

  const handleUndoRound = useCallback(() => {
    if (!session) return;
    update(undoRoundSession(session));
    setError(null);
  }, [session, update]);

  const handleExitToMenu = useCallback(() => {
    onExit();
  }, [onExit]);

  const handleFinish = useCallback(() => {
    clear();
    setSession(null);
    setSavedSession(null);
    onExit();
  }, [clear, onExit]);

  if (!session) {
    return (
      <div className="app-shell">
        <TopBar onBrandClick={onExit} />
        <section className="setup-layout">
          {isSingle ? (
            <SingleGameSetup
              onStart={start}
              onCancel={onExit}
              initialKey={
                lastOptions?.disciplines
                  ? `${lastOptions.preset}:${lastOptions.disciplines[0]}`
                  : undefined
              }
              hasSavedSession={savedSession !== null}
              onResume={resume}
              savedLabel={savedSession ? singleGameLabel(savedSession) : undefined}
            />
          ) : (
            <PentathlonSetup
              onStart={start}
              onCancel={onExit}
              hasSavedSession={savedSession !== null}
              onResume={resume}
            />
          )}
          <div className="panel theme-panel">
            <ThemeSelect theme={theme} onChange={onChangeTheme} />
          </div>
        </section>
      </div>
    );
  }

  // Gameplay and its result screens are fullscreen, chrome-free views - same precedent as GameScreen
  // (which bypasses TopBar entirely, including for its own match-result screen).
  if (session.status === 'playing' && session.current) {
    const disciplineId = currentDisciplineId(session);
    const engine = getEngine(disciplineId);
    if (engine.meta.inputMode === 'visit-score') {
      return (
        <PentathlonX01Play
          key={session.currentDisciplineIndex}
          session={session}
          onTurn={handleTurn}
          onUndoRound={handleUndoRound}
          canUndoRound={canUndoRoundSession(session)}
          onExit={handleExitToMenu}
          error={error}
          onError={setError}
        />
      );
    }
    if (disciplineId === 'cricket') {
      return (
        <PentathlonCricketPlay
          session={session}
          onTurn={handleTurn}
          onStageHit={handleStageHit}
          onSetPendingHits={handleSetPendingHits}
          onUndoStagedHit={handleUndoStagedHit}
          onUndoRound={handleUndoRound}
          canUndo={canUndoSession(session)}
          canUndoRound={canUndoRoundSession(session)}
          onExit={handleExitToMenu}
        />
      );
    }
    return (
      <PentathlonPlay
        session={session}
        onTurn={handleTurn}
        onStageHit={handleStageHit}
        onUndoStagedHit={handleUndoStagedHit}
        onUndoRound={handleUndoRound}
        canUndo={canUndoSession(session)}
        canUndoRound={canUndoRoundSession(session)}
        onExit={handleExitToMenu}
      />
    );
  }

  if (session.status === 'between-disciplines') {
    // A single game has nowhere to advance to, so its one discipline result IS the final screen.
    if (isSingle) {
      return (
        <SingleGameResult
          session={session}
          onPlayAgain={() => {
            if (lastOptions) start(lastOptions);
          }}
          onChooseAnother={() => {
            clear();
            setSession(null);
            setSavedSession(null);
            setError(null);
          }}
          onExit={handleFinish}
        />
      );
    }
    return (
      <DisciplineResult
        session={session}
        onNext={() => update(advanceDiscipline(session))}
        onUndo={handleUndoRound}
        canUndo={canUndoRoundSession(session)}
        onExit={handleExitToMenu}
      />
    );
  }

  return <PentathlonResult session={session} onFinish={handleFinish} />;
}
