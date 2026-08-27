import { useCallback, useState } from 'react';
import TopBar from '../TopBar';
import ThemeSelect from '../ThemeSelect';
import PentathlonSetup from './PentathlonSetup';
import PentathlonPlay from './PentathlonPlay';
import PentathlonX01Play from './PentathlonX01Play';
import PentathlonCricketPlay from './PentathlonCricketPlay';
import DisciplineResult from './DisciplineResult';
import PentathlonResult from './PentathlonResult';
import {
  advanceDiscipline,
  applyTurn,
  canUndo as canUndoSession,
  createPentathlonSession,
  currentDisciplineId,
  finishDisciplineNow,
  stageHit,
  undo as undoSession,
  type CreateSessionOptions,
} from '../../domain/pentathlon/session';
import { getEngine } from '../../domain/pentathlon/presets';
import {
  clearPentathlonSession,
  loadPentathlonSession,
  savePentathlonSession,
} from '../../storage/pentathlonStorage';
import { InvalidVisitError } from '../../domain/x01Core';
import type { DartHit } from '../../domain/darts';
import type { PentathlonSession } from '../../domain/pentathlon/types';
import type { ThemeName } from '../../storage/matchStorage';

interface Props {
  theme: ThemeName;
  onChangeTheme: (theme: ThemeName) => void;
  onExit: () => void;
}

export default function PentathlonFlow({ theme, onChangeTheme, onExit }: Props) {
  const [session, setSession] = useState<PentathlonSession | null>(null);
  const [savedSession] = useState<PentathlonSession | null>(loadPentathlonSession);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback((next: PentathlonSession) => {
    setSession(next);
    savePentathlonSession(next);
  }, []);

  const start = useCallback(
    (options: CreateSessionOptions) => {
      update(createPentathlonSession(options));
      setError(null);
    },
    [update],
  );

  const resume = useCallback(() => {
    const stored = loadPentathlonSession();
    if (stored) {
      setSession(stored);
      setError(null);
    }
  }, []);

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

  const handleUndo = useCallback(() => {
    if (!session) return;
    update(undoSession(session));
    setError(null);
  }, [session, update]);

  const handleFinishDisciplineNow = useCallback(() => {
    if (!session) return;
    update(finishDisciplineNow(session));
    setError(null);
  }, [session, update]);

  const handleExitToMenu = useCallback(() => {
    onExit();
  }, [onExit]);

  const handleFinish = useCallback(() => {
    clearPentathlonSession();
    setSession(null);
    onExit();
  }, [onExit]);

  if (!session) {
    return (
      <div className="app-shell">
        <TopBar onBrandClick={onExit} />
        <section className="setup-layout">
          <PentathlonSetup
            onStart={start}
            onCancel={onExit}
            hasSavedSession={savedSession !== null}
            onResume={resume}
          />
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
          onUndo={handleUndo}
          canUndo={canUndoSession(session)}
          onExit={handleExitToMenu}
          onFinishDisciplineNow={handleFinishDisciplineNow}
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
          onUndo={handleUndo}
          canUndo={canUndoSession(session)}
          onExit={handleExitToMenu}
        />
      );
    }
    return (
      <PentathlonPlay
        session={session}
        onTurn={handleTurn}
        onStageHit={handleStageHit}
        onUndo={handleUndo}
        canUndo={canUndoSession(session)}
        onExit={handleExitToMenu}
      />
    );
  }

  if (session.status === 'between-disciplines') {
    return (
      <DisciplineResult
        session={session}
        onNext={() => update(advanceDiscipline(session))}
        onUndo={handleUndo}
        canUndo={canUndoSession(session)}
        onExit={handleExitToMenu}
      />
    );
  }

  return <PentathlonResult session={session} onFinish={handleFinish} />;
}
