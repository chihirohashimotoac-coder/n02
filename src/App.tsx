import { useCallback, useEffect, useState } from 'react';
import SetupScreen from './components/SetupScreen';
import GameScreen from './components/GameScreen';
import PentathlonFlow from './components/pentathlon/PentathlonFlow';
import PracticeFlow from './components/practice/PracticeFlow';
import ResumePromptDialog from './components/common/ResumePromptDialog';
import { createX01Match, type X01MatchState, type X01Settings } from './domain/x01Engine';
import {
  clearCurrentMatch,
  defaultSettings,
  loadCurrentMatch,
  loadTheme,
  saveCurrentMatch,
  saveTheme,
  savedMatchLabel,
  type MatchMode,
  type ThemeName,
} from './storage/matchStorage';
import { loadPentathlonSession } from './storage/pentathlonStorage';

type Screen = 'setup' | 'game' | 'pentathlon' | 'pentathlon-single' | 'practice';

/** The saved in-progress matches, 通常01 first - one slot per mode. */
function loadSavedMatches(): X01MatchState[] {
  return (['01', 'checkout'] as const)
    .map((mode) => loadCurrentMatch(mode))
    .filter((match): match is X01MatchState => match !== null);
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [settings, setSettings] = useState<X01Settings>(defaultSettings);
  const [match, setMatch] = useState<X01MatchState | null>(null);
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  const [savedMatches, setSavedMatches] = useState<X01MatchState[]>(loadSavedMatches);
  /**
   * A start that hit a saved match of the same mode, waiting on 「前回の途中から始めますか？」:
   * the settings just chosen, and the save it would otherwise replace.
   */
  const [pendingStart, setPendingStart] = useState<{ settings: X01Settings; saved: X01MatchState } | null>(null);
  const [hasSavedPentathlon, setHasSavedPentathlon] = useState(() => loadPentathlonSession() !== null);

  // Sync the stored theme onto <html> (the inline boot script does this on first paint; this keeps
  // it correct after hydration and on later changes).
  useEffect(() => {
    saveTheme(theme);
  }, [theme]);

  const changeTheme = useCallback((next: ThemeName) => {
    setTheme(next);
    saveTheme(next);
  }, []);

  const beginNewMatch = useCallback((nextSettings: X01Settings) => {
    setSettings(nextSettings);
    const created = createX01Match(nextSettings);
    setMatch(created);
    saveCurrentMatch(created);
    setScreen('game');
  }, []);

  const resumeMatch = useCallback((mode: MatchMode) => {
    const stored = loadCurrentMatch(mode);
    if (!stored) return;
    setSettings(stored.settings);
    setMatch(stored);
    setScreen('game');
  }, []);

  // 「ゲームを開始」: a saved match of the same mode is offered first rather than overwritten.
  const startMatch = useCallback(
    (nextSettings: X01Settings) => {
      const saved = loadCurrentMatch(nextSettings.mode);
      if (saved) setPendingStart({ settings: nextSettings, saved });
      else beginNewMatch(nextSettings);
    },
    [beginNewMatch],
  );

  const updateMatch = useCallback((next: X01MatchState) => {
    setMatch(next);
    saveCurrentMatch(next);
  }, []);

  const exitToSetup = useCallback((options: { clearSave?: boolean } = {}) => {
    if (options.clearSave && match) clearCurrentMatch(match.settings.mode);
    setSavedMatches(loadSavedMatches());
    setMatch(null);
    setScreen('setup');
    setHasSavedPentathlon(loadPentathlonSession() !== null);
  }, [match]);

  if (screen === 'practice') {
    return <PracticeFlow theme={theme} onChangeTheme={changeTheme} onExit={() => setScreen('setup')} />;
  }

  if (screen === 'pentathlon' || screen === 'pentathlon-single') {
    return (
      <PentathlonFlow
        key={screen}
        variant={screen === 'pentathlon-single' ? 'single' : 'full'}
        theme={theme}
        onChangeTheme={changeTheme}
        onExit={() => {
          setHasSavedPentathlon(loadPentathlonSession() !== null);
          setScreen('setup');
        }}
      />
    );
  }

  if (screen === 'game' && match) {
    return <GameScreen state={match} onChange={updateMatch} onExit={exitToSetup} />;
  }

  return (
    <>
      <SetupScreen
        settings={settings}
        onChangeSettings={setSettings}
        onStart={startMatch}
        onResume={resumeMatch}
        savedMatches={savedMatches}
        theme={theme}
        onChangeTheme={changeTheme}
        onStartPentathlon={() => setScreen('pentathlon')}
        onStartPentathlonSingle={() => setScreen('pentathlon-single')}
        onStartPractice={() => setScreen('practice')}
        hasSavedPentathlon={hasSavedPentathlon}
      />
      {pendingStart && (
        <ResumePromptDialog
          backdropClassName="n01-modal-backdrop"
          cardClassName="n01-modal-card menu-list"
          savedLabel={savedMatchLabel(pendingStart.saved)}
          onYes={() => {
            setPendingStart(null);
            resumeMatch(pendingStart.settings.mode);
          }}
          onNo={() => {
            setPendingStart(null);
            clearCurrentMatch(pendingStart.settings.mode);
            setSavedMatches(loadSavedMatches());
            beginNewMatch(pendingStart.settings);
          }}
          onCancel={() => setPendingStart(null)}
        />
      )}
    </>
  );
}
