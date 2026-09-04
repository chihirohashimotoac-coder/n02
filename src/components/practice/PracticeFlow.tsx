import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '../TopBar';
import ThemeSelect from '../ThemeSelect';
import PracticeHub from './PracticeHub';
import CountUpSetup from './CountUpSetup';
import CountUpGame from './CountUpGame';
import CountUpResult from './CountUpResult';
import CountUpAwardOverlay, { type AwardPresentation } from './CountUpAwardOverlay';
import {
  awardCounts,
  createCountUpGame,
  defaultCountUpSettings,
  isFinished,
  playerIndexes,
  pointsPerRound,
  totalScore,
  type AwardKind,
  type CountUpSettings,
  type CountUpState,
} from '../../domain/practice/countUp';
import { appendCountUpHistory, updateCountUpHistoryEntry, type CountUpHistoryEntry } from '../../storage/practiceStorage';
import type { ThemeName } from '../../storage/matchStorage';

interface Props {
  theme: ThemeName;
  onChangeTheme: (theme: ThemeName) => void;
  onExit: () => void;
}

type Screen = 'hub' | 'countup-setup';

function buildHistoryEntry(state: CountUpState, date: string): CountUpHistoryEntry {
  return {
    date,
    playerCount: state.settings.playerCount,
    bullMode: state.settings.bullMode,
    players: playerIndexes(state).map((player) => ({
      name: state.players[player].name,
      total: totalScore(state, player),
      ppr: pointsPerRound(state, player),
      awards: awardCounts(state, player),
      roundScores: [...state.players[player].scores],
    })),
  };
}

/**
 * PRACTICE: the hub and everything under it. A second discipline is added by giving PracticeHub one
 * more playable card and this switch one more branch - no shared "practice engine" is invented up
 * front for games that do not exist yet.
 *
 * COUNT-UP keeps no mid-game persistence at all: an unfinished game lives only in this component's
 * state, and only a completed game is written to the PRACTICE history key.
 */
export default function PracticeFlow({ theme, onChangeTheme, onExit }: Props) {
  const [screen, setScreen] = useState<Screen>('hub');
  const [settings, setSettings] = useState<CountUpSettings>(defaultCountUpSettings);
  const [game, setGame] = useState<CountUpState | null>(null);
  const [award, setAward] = useState<AwardPresentation | null>(null);
  const awardId = useRef(0);
  /** Date of the history entry this finished game already owns, so edits update it in place. */
  const recordedDate = useRef<string | null>(null);

  const startGame = useCallback((next: CountUpSettings) => {
    setSettings(next);
    recordedDate.current = null;
    setAward(null);
    setGame(createCountUpGame(next));
  }, []);

  const presentAward = useCallback((next: { kind: AwardKind; score: number; playerName: string }) => {
    awardId.current += 1;
    // A new award replaces whatever is showing and restarts its timer - never queued behind it.
    setAward({ id: awardId.current, ...next });
  }, []);

  // A completed game is recorded once; correcting a round afterwards rewrites that same entry.
  useEffect(() => {
    if (!game || !isFinished(game)) return;
    if (recordedDate.current === null) {
      const date = new Date().toISOString();
      recordedDate.current = date;
      appendCountUpHistory(buildHistoryEntry(game, date));
    } else {
      updateCountUpHistoryEntry(buildHistoryEntry(game, recordedDate.current));
    }
  }, [game]);

  /** Ends the current game and lands on the named screen - nothing about it is persisted. */
  const leaveGame = useCallback((target: Screen) => {
    setGame(null);
    setAward(null);
    recordedDate.current = null;
    setScreen(target);
  }, []);

  // Stable identity: the overlay restarts its 3-second timer whenever this changes, so it must not
  // be recreated on every score entry.
  const clearAward = useCallback(() => setAward(null), []);

  const overlay = <CountUpAwardOverlay award={award} onExpire={clearAward} />;

  if (game && !isFinished(game)) {
    return (
      <>
        <CountUpGame
          state={game}
          onChange={setGame}
          onAward={presentAward}
          onExit={() => leaveGame('hub')}
        />
        {overlay}
      </>
    );
  }

  if (game) {
    return (
      <>
        <CountUpResult
          state={game}
          onChange={setGame}
          onPlayAgain={() => startGame(settings)}
          onBackToSetup={() => leaveGame('countup-setup')}
          onBackToPractice={() => leaveGame('hub')}
        />
        {overlay}
      </>
    );
  }

  return (
    <div className="app-shell">
      <TopBar onBrandClick={onExit} />
      <section className="setup-layout practice-layout">
        {screen === 'hub' ? (
          <PracticeHub onSelectCountUp={() => setScreen('countup-setup')} onExit={onExit} />
        ) : (
          <CountUpSetup
            settings={settings}
            onChangeSettings={setSettings}
            onStart={startGame}
            onBack={() => setScreen('hub')}
          />
        )}
        <div className="panel theme-panel">
          <ThemeSelect theme={theme} onChange={onChangeTheme} />
        </div>
      </section>
    </div>
  );
}
