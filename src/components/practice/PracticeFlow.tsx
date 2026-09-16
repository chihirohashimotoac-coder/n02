import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '../TopBar';
import ThemeSelect from '../ThemeSelect';
import PracticeHub from './PracticeHub';
import CountUpSetup from './CountUpSetup';
import CountUpGame from './CountUpGame';
import CountUpResult from './CountUpResult';
import TowerSetup from './TowerSetup';
import TowerGame from './TowerGame';
import TowerResult from './TowerResult';
import AwardOverlay, { type AwardPresentation } from '../common/AwardOverlay';
import { useAwardPreload } from '../common/useAwardPreload';
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
import {
  createTowerGame,
  defaultTowerSettings,
  playerResults,
  undoLastThrow,
  type TowerSettings,
  type TowerState,
} from '../../domain/practice/tower';
import { appendCountUpHistory, updateCountUpHistoryEntry, type CountUpHistoryEntry } from '../../storage/practiceStorage';
import {
  appendTowerHistory,
  removeTowerHistoryEntry,
  updateTowerHistoryEntry,
  type TowerHistoryEntry,
} from '../../storage/towerStorage';
import type { ThemeName } from '../../storage/matchStorage';

interface Props {
  theme: ThemeName;
  onChangeTheme: (theme: ThemeName) => void;
  onExit: () => void;
}

type Screen = 'hub' | 'countup-setup' | 'tower-setup';

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

function buildTowerHistoryEntry(state: TowerState, date: string): TowerHistoryEntry {
  return {
    date,
    courseId: state.courseId,
    playerCount: state.settings.playerCount,
    rules: {
      startFloor: state.rules.startFloor,
      startLife: state.rules.startLife,
      continues: state.rules.continues,
      recovery: state.rules.recovery,
    },
    players: playerResults(state).map((result) => ({
      name: result.name,
      clearFloor: result.clearFloor,
      status: result.status,
      continuesUsed: result.continuesUsed,
      throws: result.stats.throws,
      hits: result.stats.hits,
      misses: result.stats.misses,
    })),
  };
}

/**
 * PRACTICE: the hub and everything under it. A second discipline is added by giving PracticeHub one
 * more playable card and this switch one more branch - no shared "practice engine" is invented up
 * front for games that do not exist yet.
 *
 * COUNT-UP and TOWER are held in separate state here and share nothing but this component: two
 * `null`-able game slots, two setup screens, two history keys. Starting one never touches the
 * other, and neither can be in play at the same time.
 *
 * Neither keeps mid-game persistence: an unfinished game lives only in this component's state, and
 * only a completed game is written to its own PRACTICE history key.
 */
export default function PracticeFlow({ theme, onChangeTheme, onExit }: Props) {
  const [screen, setScreen] = useState<Screen>('hub');
  const [settings, setSettings] = useState<CountUpSettings>(defaultCountUpSettings);
  const [game, setGame] = useState<CountUpState | null>(null);
  const [award, setAward] = useState<AwardPresentation | null>(null);
  const awardId = useRef(0);
  /** Date of the history entry this finished game already owns, so edits update it in place. */
  const recordedDate = useRef<string | null>(null);

  const [towerSettings, setTowerSettings] = useState<TowerSettings>(defaultTowerSettings);
  const [tower, setTower] = useState<TowerState | null>(null);
  /** Same idea as `recordedDate`, for the TOWER game that has reached RESULT. */
  const towerRecordedDate = useRef<string | null>(null);

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

  const startTower = useCallback((next: TowerSettings) => {
    setTowerSettings(next);
    towerRecordedDate.current = null;
    setTower(createTowerGame(next));
  }, []);

  /**
   * A TOWER game is recorded when it reaches RESULT - and un-recorded if RESULT is then rewound
   * back into play, because at that point the game is not over after all and its row would be a
   * result nobody reached.
   */
  useEffect(() => {
    if (!tower) return;
    if (tower.phase === 'result') {
      if (towerRecordedDate.current === null) {
        const date = new Date().toISOString();
        towerRecordedDate.current = date;
        appendTowerHistory(buildTowerHistoryEntry(tower, date));
      } else {
        updateTowerHistoryEntry(buildTowerHistoryEntry(tower, towerRecordedDate.current));
      }
    } else if (towerRecordedDate.current !== null) {
      removeTowerHistoryEntry(towerRecordedDate.current);
      towerRecordedDate.current = null;
    }
  }, [tower]);

  const leaveTower = useCallback((target: Screen) => {
    setTower(null);
    towerRecordedDate.current = null;
    setScreen(target);
  }, []);

  // Stable identity: the overlay restarts its 3-second timer whenever this changes, so it must not
  // be recreated on every score entry.
  const clearAward = useCallback(() => setAward(null), []);

  // Warm this mode's award movies once a game is actually under way, during idle time.
  useAwardPreload('count-up', game !== null);

  const overlay = <AwardOverlay award={award} onExpire={clearAward} />;

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

  if (tower && tower.phase !== 'result') {
    return <TowerGame state={tower} onChange={setTower} onExit={() => leaveTower('hub')} />;
  }

  if (tower) {
    return (
      <TowerResult
        state={tower}
        onUndo={() => setTower(undoLastThrow(tower))}
        onPlayAgain={() => startTower(towerSettings)}
        onBackToSetup={() => leaveTower('tower-setup')}
        onBackToPractice={() => leaveTower('hub')}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar onBrandClick={onExit} />
      <section className="setup-layout practice-layout">
        {screen === 'hub' && (
          <PracticeHub
            onSelectCountUp={() => setScreen('countup-setup')}
            onSelectTower={() => setScreen('tower-setup')}
            onExit={onExit}
          />
        )}
        {screen === 'countup-setup' && (
          <CountUpSetup
            settings={settings}
            onChangeSettings={setSettings}
            onStart={startGame}
            onBack={() => setScreen('hub')}
          />
        )}
        {screen === 'tower-setup' && (
          <TowerSetup
            settings={towerSettings}
            onChangeSettings={setTowerSettings}
            onStart={startTower}
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
