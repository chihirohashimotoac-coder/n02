import { useCallback, useState } from 'react';
import TopBar from '../TopBar';
import ThemeSelect from '../ThemeSelect';
import PentathlonSetup from './PentathlonSetup';
import PentathlonPlay from './PentathlonPlay';
import DisciplineResult from './DisciplineResult';
import PentathlonResult from './PentathlonResult';
import {
  advanceDiscipline,
  applyTurn,
  canUndo as canUndoSession,
  createPentathlonSession,
  stageHit,
  undo as undoSession,
  type CreateSessionOptions,
} from '../../domain/pentathlon/session';
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

  return (
    <div className="app-shell">
      <TopBar
        onBrandClick={handleExitToMenu}
        actions={
          <button type="button" className="subtle-button" onClick={handleExitToMenu}>
            中断して設定へ
          </button>
        }
      />
      <section className="setup-layout">
        <div className="panel setup-panel">
          {session.status === 'playing' && session.current && (
            <PentathlonPlay
              session={session}
              onTurn={handleTurn}
              onStageHit={handleStageHit}
              onUndo={handleUndo}
              canUndo={canUndoSession(session)}
              onExit={handleExitToMenu}
              error={error}
              onError={setError}
            />
          )}
          {session.status === 'between-disciplines' && (
            <DisciplineResult
              session={session}
              onNext={() => update(advanceDiscipline(session))}
              onUndo={handleUndo}
              canUndo={canUndoSession(session)}
            />
          )}
          {session.status === 'completed' && (
            <PentathlonResult session={session} onFinish={handleFinish} />
          )}
        </div>
        <div className="panel theme-panel">
          <ThemeSelect theme={theme} onChange={onChangeTheme} />
        </div>
      </section>
    </div>
  );
}
