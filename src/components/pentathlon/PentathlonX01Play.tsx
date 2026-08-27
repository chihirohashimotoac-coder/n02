import { useCallback, useEffect, useState } from 'react';
import PentathlonProgress from './PentathlonProgress';
import PentathlonModal from './PentathlonModal';
import { getEngine } from '../../domain/pentathlon/presets';
import { currentDisciplineId } from '../../domain/pentathlon/session';
import { InvalidVisitError } from '../../domain/x01Core';
import { suggestCheckoutRoute, validFinishDartCounts, dartLabel } from '../../domain/darts';
import { DISCIPLINE_RULE_TEXT } from '../../domain/pentathlon/ruleText';
import PentathlonRulesButton from './PentathlonRulesButton';
import type { X01SoloState, X01SoloInput } from '../../domain/pentathlon/engines/x01Solo';
import type { PentathlonSession, PlayerIndex } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onTurn: (input: X01SoloInput) => void;
  /** Takes back the previous committed round (X01 has no per-dart staging). */
  onUndoRound: () => void;
  canUndoRound: boolean;
  onExit: () => void;
  /** Ends the discipline right now, recording the still-playing opponent as DNF. Confirmed first. */
  onFinishDisciplineNow: () => void;
  error: string | null;
  onError: (message: string | null) => void;
}

/**
 * 301/501 in Pentathlon: each player plays an independent attempt (not a shared race), but the UI is
 * otherwise the same fullscreen shell/keypad as 通常01・チェックアウト練習 (GameScreen), per explicit
 * request - round-by-round history is the only thing intentionally left out.
 */
export default function PentathlonX01Play({
  session,
  onTurn,
  onUndoRound,
  canUndoRound,
  onExit,
  onFinishDisciplineNow,
  error,
  onError,
}: Props) {
  const [entry, setEntry] = useState('');
  const [pendingFinish, setPendingFinish] = useState<number | null>(null);
  const [acknowledgedFinishIndex, setAcknowledgedFinishIndex] = useState<PlayerIndex | null>(null);
  const [confirmingDnf, setConfirmingDnf] = useState(false);

  const current = session.current!;
  const disciplineId = currentDisciplineId(session);
  const engine = getEngine(disciplineId);
  const active = current.active;
  const activeState = current.progress[active].state as X01SoloState;
  const players: PlayerIndex[] = session.playerCount === 1 ? [0] : [0, 1];

  // In 2-player mode, a player who finishes first simply waits - the discipline isn't over until the
  // other player's own result is final too (see session.ts). That hand-off is easy to miss, so it
  // gets one explicit, dismissible confirmation instead of just quietly switching whose turn it is.
  const waitingFinishedIndex: PlayerIndex | null =
    session.playerCount === 2 && current.progress[0].finished !== current.progress[1].finished
      ? (current.progress[0].finished ? 0 : 1)
      : null;
  const stillPlayingIndex: PlayerIndex | null =
    waitingFinishedIndex === null ? null : waitingFinishedIndex === 0 ? 1 : 0;
  const showCheckoutOverlay =
    waitingFinishedIndex !== null && waitingFinishedIndex !== acknowledgedFinishIndex;

  const continuePlaying = useCallback(() => {
    setAcknowledgedFinishIndex(waitingFinishedIndex);
  }, [waitingFinishedIndex]);

  const submitVisit = useCallback(
    (rawValue: string, finishDarts?: number) => {
      const score = Number(rawValue);
      if (rawValue === '' || Number.isNaN(score)) return;

      if (score === activeState.remaining && score > 0 && finishDarts === undefined) {
        const counts = validFinishDartCounts(activeState.remaining);
        if (counts.length === 0) {
          onError(`残り${activeState.remaining}は上がれない数字のため、上がり申告できません。`);
          return;
        }
        setPendingFinish(score);
        return;
      }

      try {
        onTurn({ score, finishDarts });
        setEntry('');
        setPendingFinish(null);
        onError(null);
      } catch (caught) {
        if (caught instanceof InvalidVisitError) onError(caught.message);
        else throw caught;
      }
    },
    [activeState.remaining, onError, onTurn],
  );

  const pressKey = useCallback(
    (key: string) => {
      if (key === 'enter') {
        submitVisit(entry);
        return;
      }
      if (key === 'delete') {
        setEntry((value) => value.slice(0, -1));
        return;
      }
      setEntry((value) => (value.length >= 3 ? value : value + key));
    },
    [entry, submitVisit],
  );

  // Only ever the gameplay screen's own shortcuts: any open PentathlonModal swallows keystrokes
  // before they reach this listener, and drives its own buttons natively (Enter/Space on the
  // focused control), so there is no dialog-specific branch here to fall out of sync.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') {
        event.preventDefault();
        pressKey(event.key);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        pressKey('enter');
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (entry.length > 0) pressKey('delete');
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setEntry('');
      } else if (event.key.toLowerCase() === 'u') {
        event.preventDefault();
        onUndoRound();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry, onUndoRound, pressKey]);

  const finishCounts = pendingFinish !== null ? validFinishDartCounts(activeState.remaining) : [];

  const openFinishModal = () => {
    const counts = validFinishDartCounts(activeState.remaining);
    if (counts.length === 0) {
      onError(`残り${activeState.remaining}は上がれない数字のため、上がり申告できません。`);
      return;
    }
    setPendingFinish(activeState.remaining);
  };

  return (
    <section className="n01-game-shell pent-x01-shell">
      <header className={`n01-game-header ${session.playerCount === 1 ? 'solo' : ''}`}>
        <div className={`n01-player-name ${active === 0 && !current.progress[0].finished ? 'active' : ''}`}>
          <span>{session.currentStarter === 0 ? '先攻' : '後攻'}</span>
          <strong>{session.names[0]}</strong>
          {current.progress[0].finished ? (
            <em>FINISHED</em>
          ) : active === 0 ? (
            <em aria-label="現在のスロー">THROW</em>
          ) : null}
        </div>
        <div className="n01-leg-center">
          <small>PENTATHLON</small>
          <strong>{engine.meta.name}</strong>
        </div>
        {session.playerCount === 2 && (
          <div className={`n01-player-name right ${active === 1 && !current.progress[1].finished ? 'active' : ''}`}>
            {current.progress[1].finished ? (
              <em>FINISHED</em>
            ) : active === 1 ? (
              <em aria-label="現在のスロー">THROW</em>
            ) : null}
            <strong>{session.names[1]}</strong>
            <span>{session.currentStarter === 1 ? '先攻' : '後攻'}</span>
          </div>
        )}
      </header>

      <div className="n01-score-area">
        <div className="n01-game-meta">
          <span>{engine.meta.description}</span>
          <strong>{session.names[active]} の得点入力</strong>
          <span>3 darts</span>
        </div>

        {error && (
          <p className="n01-notice warning" role="alert">
            {error}
          </p>
        )}

        <div className="n01-score-scroll" tabIndex={0} aria-label="ペンタスロン進行状況">
          <PentathlonProgress session={session} />
        </div>
      </div>

      {/* Only while something is actually being typed: floats clear of both the scoreboard above and
          the keypad below, and disappears again the moment Enter commits or the entry is cleared. */}
      {entry !== '' && (
        <div className="pent-entry-popover" role="status">
          <span>{session.names[active]} の得点</span>
          <strong>{entry}</strong>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {entry === '' ? '入力中の得点はありません' : `入力中の得点 ${entry}`}
      </p>

      <footer className="n01-game-footer">
        <div className={`n01-left-table ${session.playerCount === 1 ? 'solo' : ''}`}>
          {players.map((index) => {
            const progress = current.progress[index];
            const state = progress.state as X01SoloState;
            const isActive = active === index && !progress.finished;
            const route =
              session.showRoute && !progress.finished ? suggestCheckoutRoute(state.remaining) : null;
            return (
              <div key={index} className={isActive ? 'active' : ''}>
                <strong>{progress.finished ? state.darts : state.remaining}</strong>
                {progress.finished ? (
                  <span>{progress.result!.completed ? 'DARTS' : 'DNF'}</span>
                ) : route ? (
                  <span className="checkout-route">{route.map(dartLabel).join(' - ')}</span>
                ) : (
                  <span className="pent-player-label">{session.names[index]}</span>
                )}
              </div>
            );
          })}
        </div>

        <nav className="n01-menu-table pent-x01-menu" aria-label="ゲームメニュー">
          <button type="button" onClick={onExit}>
            中断
          </button>
          <button type="button" onClick={openFinishModal}>
            Finish
          </button>
          <button type="button" disabled={!canUndoRound} onClick={onUndoRound}>
            前の確定ラウンドに戻す
          </button>
          <PentathlonRulesButton {...DISCIPLINE_RULE_TEXT[disciplineId]} />
        </nav>

        <p className="pent-key-hint">
          <kbd>0</kbd>–<kbd>9</kbd> 得点入力・<kbd>Enter</kbd> 確定・<kbd>Backspace</kbd> 1文字削除・
          <kbd>U</kbd> 前の確定ラウンドに戻す
        </p>

        <div className="n01-key-table" aria-label="得点入力テンキー">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((key) => (
            <button key={key} type="button" onClick={() => pressKey(key)}>
              {key}
            </button>
          ))}
          <button type="button" aria-label="1文字削除" onClick={() => pressKey('delete')}>
            ⌫
          </button>
          <button type="button" onClick={() => pressKey('0')}>
            0
          </button>
          <button type="button" className="enter" onClick={() => pressKey('enter')}>
            Enter
          </button>
        </div>
      </footer>

      {pendingFinish !== null && (
        <PentathlonModal
          label="上がり本数を選択"
          onClose={() => setPendingFinish(null)}
          onKeyDown={(event) => {
            const digit = Number(event.key);
            if (finishCounts.includes(digit)) {
              event.preventDefault();
              submitVisit(String(pendingFinish), digit);
            }
          }}
        >
          <h2>上がり本数</h2>
          <div className="menu-list">
            {finishCounts.map((count) => (
              <button key={count} type="button" onClick={() => submitVisit(String(pendingFinish), count)}>
                <kbd>{count}</kbd>{'　'}{count}本目で終了
              </button>
            ))}
          </div>
          <p>
            残り{activeState.remaining}は最短{finishCounts[0]}本で上がれます。
          </p>
          <button type="button" onClick={() => setPendingFinish(null)}>
            戻る
          </button>
        </PentathlonModal>
      )}

      {/* Hidden while the DNF confirmation is up: only one dialog is ever open at a time. */}
      {showCheckoutOverlay && !confirmingDnf && stillPlayingIndex !== null && (
        <PentathlonModal label="種目の続行選択" onClose={continuePlaying}>
          <h2>
            {session.names[waitingFinishedIndex!]}{' '}
            {current.progress[waitingFinishedIndex!].result!.completed ? 'チェックアウト' : 'DNF'}
          </h2>
          <p>
            使用ダーツ {current.progress[waitingFinishedIndex!].result!.darts || '—'} 本。
            {session.names[stillPlayingIndex]} はまだ投げ終えていません。
          </p>
          <button type="button" className="n01-modal-primary" onClick={continuePlaying}>
            {session.names[stillPlayingIndex]} のプレイを続ける <kbd>Enter</kbd>
          </button>
          <button type="button" onClick={() => setConfirmingDnf(true)}>
            {session.names[stillPlayingIndex]} をDNFとして次の種目へ進む
          </button>
        </PentathlonModal>
      )}

      {confirmingDnf && stillPlayingIndex !== null && (
        <PentathlonModal label="DNFの確認" onClose={() => setConfirmingDnf(false)}>
          <h2>DNFとして記録します</h2>
          <p>
            {session.names[stillPlayingIndex]} は投げ終えていないため、DNF（未完了）として記録され、
            この種目は負け扱いになります。よろしいですか？
          </p>
          <button
            type="button"
            className="n01-modal-primary"
            onClick={() => {
              setConfirmingDnf(false);
              onFinishDisciplineNow();
            }}
          >
            {session.names[stillPlayingIndex]} をDNFにして進む
          </button>
          <button type="button" onClick={() => setConfirmingDnf(false)}>
            キャンセル
          </button>
        </PentathlonModal>
      )}
    </section>
  );
}
