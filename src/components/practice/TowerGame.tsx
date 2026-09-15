import { useCallback, useEffect, useRef, useState } from 'react';
import DialogShell from '../common/DialogShell';
import TowerBoard from './TowerBoard';
import {
  activeTowerPlayer,
  advanceTurn,
  applyThrow,
  canJudge,
  canUndoThrow,
  chooseContinue,
  currentTurnThrows,
  floorRegions,
  floorTargetText,
  isRecoveryFloor,
  nextActionId,
  playerIndexes,
  recentThrows,
  remainingContinues,
  rewindPreview,
  rewindToThrow,
  totalThrows,
  undoLastThrow,
  undoTargetThrow,
  type TowerRewindPreview,
  type TowerState,
  type TowerThrowResult,
} from '../../domain/practice/tower';
import { hasSeenTowerHelp, markTowerHelpSeen } from '../../storage/towerStorage';

interface Props {
  state: TowerState;
  onChange: (state: TowerState) => void;
  onExit: () => void;
}

type Modal = 'none' | 'menu' | 'help' | 'confirm-exit' | 'rewind';
type FlashKind = 'hit' | 'miss' | 'recover' | 'clear' | 'over';

interface Flash {
  id: number;
  kind: FlashKind;
  text: string;
}

/** How long a 成功 / MISS / 回復 flash stays up. Presentation only - it never gates the state. */
const FLASH_MS = 1500;

/**
 * Swallows a second activation of the same control inside this window.
 *
 * The state-side guard (an action id derived from the state the handler read) already refuses a
 * stale repeat; this is the other half the brief asks for, and it is what catches a touch that also
 * reports a click and a double click that straddles a re-render.
 */
export const REPEAT_LOCK_MS = 220;

/** How many past darts the history strip offers as rewind points. */
const HISTORY_LENGTH = 10;

/**
 * The TOWER OF THE DARTS play screen.
 *
 * Built for a real board and a real person: the app shows the floor's target, the player throws one
 * dart, looks at the board, and presses 成功 or MISS. Nothing here infers where a dart landed, and
 * nothing moves on its own - there is no timer, no countdown and no auto-miss anywhere in this
 * file, so a player can walk up to the board to read a close dart and come back to exactly the
 * state they left.
 *
 * Like COUNT-UP, it is a self-contained screen with its own keyboard route and its own `tower-*`
 * styles: while it is mounted nothing reaches GameScreen, the X01 engine, Pentathlon or COUNT-UP,
 * and when it unmounts it takes its own listener with it and leaves nothing behind.
 */
export default function TowerGame({ state, onChange, onExit }: Props) {
  const [modal, setModal] = useState<Modal>(() => (hasSeenTowerHelp() ? 'none' : 'help'));
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [rewind, setRewind] = useState<TowerRewindPreview | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  const flashId = useRef(0);
  const repeatLock = useRef(0);

  const { rules } = state;
  const indexes = playerIndexes(state);
  const active = activeTowerPlayer(state);
  const solo = state.players.length === 1;
  const floor = active.currentFloor;
  // All cheap and all derived: the region list is a lookup in the constant course table (so its
  // identity is stable per floor), the caption is cached in the domain, and the rest walk a handful
  // of events. Nothing here is worth a memo, and memoising it would only pin stale state.
  const regions = floorRegions(floor);
  const targetText = floorTargetText(floor);
  const turn = currentTurnThrows(state);
  const history = recentThrows(state, HISTORY_LENGTH);
  const judgeable = canJudge(state);
  const undoable = canUndoThrow(state);

  /** True while this activation should be ignored as a repeat of the one just handled. */
  const acquire = useCallback(() => {
    const now = Date.now();
    if (now - repeatLock.current < REPEAT_LOCK_MS) return false;
    repeatLock.current = now;
    return true;
  }, []);

  const showFlash = useCallback((kind: FlashKind, text: string) => {
    flashId.current += 1;
    setFlash({ id: flashId.current, kind, text });
  }, []);

  // The flash is purely presentational: it is cleared on a timer that is torn down with the
  // component, and it never reads or writes game state.
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const judge = useCallback(
    (result: TowerThrowResult) => {
      if (!canJudge(state) || !acquire()) return;
      const updated = applyThrow(state, result, { actionId: nextActionId(state, 'throw') });
      if (updated === state) return;
      onChange(updated);
      setNotice(null);

      const event = updated.history[updated.history.length - 1];
      if (!event || event.kind !== 'throw') return;
      if (event.clearedTower) showFlash('clear', `GAME CLEAR！ ${rules.finalFloor}F 踏破`);
      else if (event.lifeAfter <= 0) showFlash('over', `GAME OVER ${event.floor}F`);
      else if (event.recovered) showFlash('recover', `${event.floor}F 突破 / LIFE 回復`);
      else if (result === 'hit') showFlash('hit', `成功 / ${event.floor}F 突破`);
      else showFlash('miss', `MISS / LIFE ${event.lifeAfter}`);
    },
    [acquire, onChange, rules.finalFloor, showFlash, state],
  );

  const undo = useCallback(() => {
    if (!canUndoThrow(state) || !acquire()) return;
    const target = undoTargetThrow(state);
    const updated = undoLastThrow(state);
    if (updated === state) return;
    onChange(updated);
    setFlash(null);
    setNotice(
      target
        ? `${target.playerName} の ${target.floor}F ${target.dartNumber}投目（${
            target.result === 'hit' ? '成功' : 'MISS'
          }）を取り消しました。`
        : null,
    );
  }, [acquire, onChange, state]);

  const goNext = useCallback(() => {
    if (state.phase !== 'pickup' && state.phase !== 'player-over') return;
    if (!acquire()) return;
    const updated = advanceTurn(state, { actionId: nextActionId(state, 'advance') });
    if (updated === state) return;
    onChange(updated);
    setFlash(null);
    setNotice(null);
  }, [acquire, onChange, state]);

  const answerContinue = useCallback(
    (answer: 'yes' | 'no') => {
      if (state.phase !== 'continue' || !acquire()) return;
      const updated = chooseContinue(state, answer, { actionId: nextActionId(state, 'continue') });
      if (updated === state) return;
      onChange(updated);
      setFlash(null);
      setNotice(
        answer === 'yes'
          ? `CONTINUE を使いました。${updated.players[updated.activePlayerIndex].currentFloor}F・LIFE ${
              updated.players[updated.activePlayerIndex].life
            } で再開します。`
          : null,
      );
    },
    [acquire, onChange, state],
  );

  /**
   * TOWER's keyboard route. Every branch checks that TOWER can actually act on the key first and
   * only then calls preventDefault, so Backspace still navigates and Enter still submits wherever
   * this screen has nothing to do. The listener is added only while no dialog is open, and is
   * removed when this screen unmounts - it is this component's alone and never touches another
   * screen's handlers.
   */
  useEffect(() => {
    if (modal !== 'none') return;
    const handler = (event: KeyboardEvent) => {
      // Never act on an IME commit, never let a held key repeat into a second dart.
      if (event.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) {
        return;
      }
      // Leave a focused control its native Enter / Space activation.
      if (target?.tagName === 'BUTTON' && ['Enter', ' ', 'Tab'].includes(event.key)) return;

      if (event.key === '1' || event.key === '2') {
        if (!canJudge(state)) return;
        event.preventDefault();
        judge(event.key === '1' ? 'hit' : 'miss');
        return;
      }
      if (event.key === 'Backspace') {
        if (!canUndoThrow(state)) return;
        event.preventDefault();
        undo();
        return;
      }
      if (event.key === 'Enter') {
        if (state.phase !== 'pickup' && state.phase !== 'player-over') return;
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, judge, modal, state, undo]);

  const requestExit = useCallback(() => {
    // Nothing is persisted mid-game, so leaving with a climb in progress discards it - ask once.
    if (totalThrows(state) > 0) setModal('confirm-exit');
    else onExit();
  }, [onExit, state]);

  const closeHelp = useCallback(() => {
    markTowerHelpSeen();
    setModal('none');
  }, []);

  /**
   * A tap on the history strip. The newest dart is the ordinary 「1投戻す」 and goes straight back
   * with no dialog; anything older discards the darts thrown after it, so it asks first.
   */
  const pickHistory = useCallback(
    (eventId: string) => {
      const latest = undoTargetThrow(state);
      if (latest && latest.id === eventId) {
        undo();
        return;
      }
      const preview = rewindPreview(state, eventId);
      if (!preview) return;
      setRewind(preview);
      setModal('rewind');
    },
    [state, undo],
  );

  const confirmRewind = useCallback(() => {
    if (!rewind) return;
    const updated = rewindToThrow(state, rewind.eventId);
    setModal('none');
    setRewind(null);
    if (updated === state) return;
    onChange(updated);
    setFlash(null);
    setNotice(
      `${rewind.playerName} の ${rewind.floor}F ${rewind.dartNumber}投目まで戻しました。この投から入力し直してください。`,
    );
  }, [onChange, rewind, state]);

  const otherPlayerName = solo ? null : state.players[state.activePlayerIndex === 0 ? 1 : 0].name;

  return (
    <section className="tower-shell" ref={shellRef} tabIndex={-1}>
      <header className="tower-header">
        <div className="tower-identity">
          <strong>TOWER</strong>
          <span>OF THE DARTS</span>
        </div>
        <div className="tower-floor-badge">
          <small>FLOOR</small>
          <strong>
            {floor}
            <i>/{rules.finalFloor}</i>
          </strong>
        </div>
      </header>

      <div
        className="tower-climb"
        role="img"
        aria-label={`${active.name} は ${rules.finalFloor}F 中 ${active.lastClearedFloor}F まで突破`}
      >
        {indexes.map((index) => {
          const player = state.players[index];
          const ratio = Math.min(1, player.lastClearedFloor / rules.finalFloor);
          return (
            <div className={`tower-climb-row ${index === state.activePlayerIndex ? 'active' : ''}`} key={index}>
              <span className="tower-climb-name">{player.name}</span>
              <span className="tower-climb-track">
                <span className="tower-climb-fill" style={{ width: `${ratio * 100}%` }} />
              </span>
              <span className="tower-climb-value">{player.lastClearedFloor}F</span>
            </div>
          );
        })}
      </div>

      <div className="tower-stage">
        <p className="tower-turn-line">
          <b>{active.name}</b>
          <span>
            {floor}F のお題{isRecoveryFloor(floor, rules) ? '（突破で LIFE 回復）' : ''}
          </span>
        </p>

        <TowerBoard
          regions={regions}
          floor={floor}
          className="tower-board-main"
          ariaLabel={`${active.name} の ${floor}F のお題：${targetText}`}
        />

        <p className="tower-target-text">{targetText}</p>

        {flash && (
          <p className={`tower-flash is-${flash.kind}`} key={flash.id} role="status">
            {flash.text}
          </p>
        )}
      </div>

      <footer className="tower-footer">
        <div className={`tower-status ${solo ? 'solo' : ''}`}>
          {indexes.map((index) => {
            const player = state.players[index];
            const isActive = index === state.activePlayerIndex;
            return (
              <div className={`tower-status-card ${isActive ? 'active' : ''} is-${player.status}`} key={index}>
                <span className="tower-status-name">
                  {player.name}
                  {isActive && player.status === 'playing' && <em>THROW</em>}
                  {player.status === 'cleared' && <em className="done">CLEAR</em>}
                  {player.status === 'retired' && <em className="done">END</em>}
                </span>
                <span className="tower-status-life" aria-label={`LIFE ${player.life} / ${rules.maxLife}`}>
                  <b aria-hidden="true">LIFE</b>
                  <span className="tower-life-pips" aria-hidden="true">
                    {Array.from({ length: rules.maxLife }, (_, pip) => (
                      <i key={pip} className={pip < player.life ? 'on' : 'off'} />
                    ))}
                  </span>
                  <b className="tower-life-value" aria-hidden="true">
                    {player.life}
                  </b>
                </span>
                <span className="tower-status-meta">
                  {player.currentFloor}F ／ CONTINUE 残 {remainingContinues(player, rules)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="tower-turn-pips" aria-label={`この手番 ${turn.length} / ${rules.dartsPerTurn} 投`}>
          {Array.from({ length: rules.dartsPerTurn }, (_, index) => {
            const thrown = turn[index];
            const label = thrown ? (thrown.result === 'hit' ? '成功' : 'MISS') : '未';
            return (
              <span
                key={index}
                className={`tower-pip ${thrown ? `done is-${thrown.result}` : ''} ${
                  !thrown && index === turn.length && judgeable ? 'now' : ''
                }`}
              >
                <i aria-hidden="true">{index + 1}</i>
                <b>{label}</b>
              </span>
            );
          })}
        </div>

        {notice && (
          <p className="tower-notice" role="status">
            {notice}
          </p>
        )}

        <div className="tower-actions">
          {state.phase === 'throw' && (
            <>
              <button
                type="button"
                className="tower-judge hit"
                disabled={!judgeable}
                onClick={() => judge('hit')}
              >
                <i aria-hidden="true">◎</i>
                <strong>成功</strong>
                <kbd aria-hidden="true">1</kbd>
              </button>
              <button
                type="button"
                className="tower-judge miss"
                disabled={!judgeable}
                onClick={() => judge('miss')}
              >
                <i aria-hidden="true">✕</i>
                <strong>MISS</strong>
                <kbd aria-hidden="true">2</kbd>
              </button>
              <p className="tower-actions-hint">
                際どいときは、どちらも押さずに着弾を確認してください。入力があるまで進みません。
              </p>
            </>
          )}

          {state.phase === 'pickup' && (
            <div className="tower-panel pickup">
              <strong>{rules.dartsPerTurn}投終了 — ダーツを回収してください</strong>
              <p>
                {solo
                  ? `続けて ${active.name} の次の手番です。`
                  : `次は ${otherPlayerName} の手番です。${otherPlayerName} が投げる間、${active.name} が入力を担当するとスムーズです。`}
              </p>
              <button type="button" className="tower-primary" onClick={goNext}>
                次へ
                <kbd aria-hidden="true">Enter</kbd>
              </button>
            </div>
          )}

          {state.phase === 'continue' && (
            <div className="tower-panel over">
              <strong>GAME OVER — {active.name}</strong>
              <p>
                {floor}F で LIFE がなくなりました。CONTINUE を使うと、同じ {floor}F・LIFE {rules.startLife} で再開します。
                残り {remainingContinues(active, rules)} 回。
              </p>
              <div className="tower-continue-row">
                <button type="button" className="tower-primary" onClick={() => answerContinue('yes')}>
                  CONTINUE する
                </button>
                <button type="button" className="tower-secondary" onClick={() => answerContinue('no')}>
                  やめる
                </button>
              </div>
              {/* Deliberately no keyboard shortcut: a CONTINUE must never be spent by a stray
                  judgement keystroke. */}
              <small>CONTINUE の選択はボタン操作のみです。</small>
            </div>
          )}

          {state.phase === 'player-over' && (
            <div className={`tower-panel ${active.status === 'cleared' ? 'clear' : 'end'}`}>
              <strong>
                {active.status === 'cleared'
                  ? `GAME CLEAR — ${active.name}`
                  : `${active.name} は終了しました`}
              </strong>
              <p>
                {active.status === 'cleared'
                  ? `${rules.finalFloor}F を踏破しました。CLEAR FLOOR ${active.lastClearedFloor}。`
                  : remainingContinues(active, rules) === 0
                    ? `CONTINUE を${rules.continues}回すべて使い切りました。CLEAR FLOOR ${active.lastClearedFloor}。`
                    : `CLEAR FLOOR ${active.lastClearedFloor}。`}
              </p>
              <button type="button" className="tower-primary" onClick={goNext}>
                次へ
                <kbd aria-hidden="true">Enter</kbd>
              </button>
            </div>
          )}
        </div>

        <div className="tower-history" aria-label="直近の入力">
          {history.length === 0 ? (
            <span className="tower-history-empty">まだ入力がありません</span>
          ) : (
            history.map((event, position) => (
              <button
                key={event.id}
                type="button"
                className={`tower-history-chip is-${event.result} ${position === 0 ? 'latest' : ''}`}
                onClick={() => pickHistory(event.id)}
                aria-label={`${event.playerName} ${event.floor}F ${event.dartNumber}投目 ${
                  event.result === 'hit' ? '成功' : 'MISS'
                }${position === 0 ? ' を取り消す' : ' まで戻す'}`}
              >
                <b>{event.floor}F</b>
                <i aria-hidden="true">{event.result === 'hit' ? '◎' : '✕'}</i>
              </button>
            ))
          )}
        </div>

        <nav className="tower-menu" aria-label="TOWERメニュー">
          <button type="button" onClick={requestExit}>
            PRACTICE
          </button>
          <button type="button" disabled={!undoable} onClick={undo}>
            1投戻す
          </button>
          <button type="button" onClick={() => setModal('menu')} aria-label="メニュー">
            ☰
          </button>
        </nav>
      </footer>

      {modal === 'help' && (
        <DialogShell
          label="TOWER の遊びかた"
          backdropClassName="tower-modal-backdrop"
          returnFocusTo={shellRef}
          cardClassName="tower-modal-card"
          onClose={closeHelp}
        >
          <h2>ハードダーツでの遊びかた</h2>
          <ol className="tower-help-steps">
            <li>画面のお題（点灯エリア）を確認します。</li>
            <li>1本投げます。</li>
            <li>
              明らかに点灯エリア内なら <b>成功</b>、明らかに外なら <b>MISS</b> を押します。
            </li>
          </ol>
          <p className="tower-modal-note strong">
            際どいときは、成功・MISS のどちらも押さずに着弾を確認してください。入力があるまで階・LIFE・投数・手番は動きません。
          </p>
          <p className="tower-modal-note">
            {rules.dartsPerTurn}投したらダーツを回収し、「次へ」で次の手番を始めます。判定を間違えたら「1投戻す」、
            もっと前の投に戻すときは下の履歴から選べます。
          </p>
          <p className="tower-modal-note">
            キーボード：<kbd>1</kbd> 成功・<kbd>2</kbd> MISS・<kbd>Backspace</kbd> 1投戻す・<kbd>Enter</kbd> 次へ
          </p>
          <button type="button" className="tower-modal-primary" onClick={closeHelp}>
            はじめる
          </button>
        </DialogShell>
      )}

      {modal === 'menu' && (
        <DialogShell
          label="TOWERメニュー"
          backdropClassName="tower-modal-backdrop"
          returnFocusTo={shellRef}
          cardClassName="tower-modal-card menu-list"
          onClose={() => setModal('none')}
        >
          <h2>メニュー</h2>
          <p className="tower-modal-note">
            START LIFE {rules.startLife}／CONTINUE {rules.continues}／RECOVERY {rules.recovery ? 'ON' : 'OFF'}／1手番
            {rules.dartsPerTurn}投
          </p>
          <button
            type="button"
            disabled={!undoable}
            onClick={() => {
              setModal('none');
              undo();
            }}
          >
            <kbd>Backspace</kbd>
            {'　'}1投戻す
          </button>
          <button
            type="button"
            onClick={() => {
              setModal('help');
            }}
          >
            遊びかたを見る
          </button>
          <button
            type="button"
            onClick={() => {
              setModal('none');
              requestExit();
            }}
          >
            PRACTICE へ戻る
          </button>
          <p className="tower-modal-note">
            キーボード：<kbd>1</kbd> 成功・<kbd>2</kbd> MISS・<kbd>Backspace</kbd> 1投戻す・<kbd>Enter</kbd> 次へ
          </p>
          <button type="button" className="tower-modal-cancel" onClick={() => setModal('none')}>
            閉じる
          </button>
        </DialogShell>
      )}

      {modal === 'confirm-exit' && (
        <DialogShell
          label="TOWERの終了確認"
          backdropClassName="tower-modal-backdrop"
          returnFocusTo={shellRef}
          cardClassName="tower-modal-card"
          onClose={() => setModal('none')}
        >
          <h2>現在の TOWER を終了しますか？</h2>
          <p className="tower-modal-note">途中経過は保存されません。</p>
          <button type="button" className="tower-modal-primary" onClick={onExit}>
            終了して PRACTICE へ
          </button>
          <button type="button" className="tower-modal-cancel" onClick={() => setModal('none')}>
            続ける
          </button>
        </DialogShell>
      )}

      {modal === 'rewind' && rewind && (
        <DialogShell
          label="この投から入力し直す"
          backdropClassName="tower-modal-backdrop"
          returnFocusTo={shellRef}
          cardClassName="tower-modal-card"
          onClose={() => {
            setModal('none');
            setRewind(null);
          }}
        >
          <h2>この投から入力し直しますか？</h2>
          <p className="tower-modal-note">
            {rewind.playerName} の {rewind.floor}F {rewind.dartNumber}投目に戻ります。
          </p>
          <p className="tower-modal-note strong">
            この投を含む {rewind.discardedThrows} 投
            {rewind.discardedContinues > 0 ? `と CONTINUE ${rewind.discardedContinues} 回` : ''}
            の入力が取り消されます。
          </p>
          <p className="tower-modal-note">
            狙う階が変わるため、後の入力はそのまま適用できません。戻したあと、もう一度入力してください。
          </p>
          <button type="button" className="tower-modal-primary" onClick={confirmRewind}>
            この投から入力し直す
          </button>
          <button
            type="button"
            className="tower-modal-cancel"
            onClick={() => {
              setModal('none');
              setRewind(null);
            }}
          >
            やめる
          </button>
        </DialogShell>
      )}
    </section>
  );
}
