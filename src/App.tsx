import { useCallback, useEffect, useState } from 'react';
import SetupScreen from './components/SetupScreen';
import GameScreen from './components/GameScreen';
import PentathlonFlow from './components/pentathlon/PentathlonFlow';
import { createX01Match, type X01MatchState, type X01Settings } from './domain/x01Engine';
import {
  clearCurrentMatch,
  defaultSettings,
  loadCurrentMatch,
  loadTheme,
  saveCurrentMatch,
  saveTheme,
  type ThemeName,
} from './storage/matchStorage';
import { loadPentathlonSession } from './storage/pentathlonStorage';

type Screen = 'setup' | 'game' | 'pentathlon' | 'pentathlon-single';

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  const [settings, setSettings] = useState<X01Settings>(defaultSettings);
  const [match, setMatch] = useState<X01MatchState | null>(null);
  const [theme, setTheme] = useState<ThemeName>(loadTheme);
  const [savedMatch, setSavedMatch] = useState<X01MatchState | null>(loadCurrentMatch);
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

  const startMatch = useCallback((nextSettings: X01Settings) => {
    setSettings(nextSettings);
    const created = createX01Match(nextSettings);
    setMatch(created);
    saveCurrentMatch(created);
    setScreen('game');
  }, []);

  const resumeMatch = useCallback(() => {
    const stored = loadCurrentMatch();
    if (!stored) return;
    setSettings(stored.settings);
    setMatch(stored);
    setScreen('game');
  }, []);

  const updateMatch = useCallback((next: X01MatchState) => {
    setMatch(next);
    saveCurrentMatch(next);
  }, []);

  const exitToSetup = useCallback((options: { clearSave?: boolean } = {}) => {
    if (options.clearSave) {
      clearCurrentMatch();
      setSavedMatch(null);
    } else {
      setSavedMatch(loadCurrentMatch());
    }
    setMatch(null);
    setScreen('setup');
    setHasSavedPentathlon(loadPentathlonSession() !== null);
  }, []);

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
    <SetupScreen
      settings={settings}
      onChangeSettings={setSettings}
      onStart={startMatch}
      onResume={savedMatch ? resumeMatch : undefined}
      savedMatch={savedMatch}
      theme={theme}
      onChangeTheme={changeTheme}
      onStartPentathlon={() => setScreen('pentathlon')}
      onStartPentathlonSingle={() => setScreen('pentathlon-single')}
      hasSavedPentathlon={hasSavedPentathlon}
    />
  );
}
