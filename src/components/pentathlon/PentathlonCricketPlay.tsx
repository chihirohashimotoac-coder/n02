import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import PentathlonModal from './PentathlonModal';
import PentathlonProgress from './PentathlonProgress';
import PentathlonPlayMenu from './PentathlonPlayMenu';
import { currentDisciplineId } from '../../domain/pentathlon/session';
import {
  CRICKET_TARGETS,
  cricketMarks,
  type CricketTarget,
  type CricketState,
} from '../../domain/pentathlon/engines/cricket';
import type { DartHit } from '../../domain/darts';
import type { PentathlonSession, PlayerIndex } from '../../domain/pentathlon/types';

interface Props {
  session: PentathlonSession;
  onTurn: (input: unknown) => void;
  onStageHit: (hit: DartHit) => void;
  /** Replaces the whole staged turn - used by the tap-to-correct popover. */
  onSetPendingHits: (hits: DartHit[]) => void;
  /** Takes back only the last dart staged in the current, uncommitted turn. */
  onUndoStagedHit: () => void;
  /** Takes back the previous already-committed round. */
  onUndoRound: () => void;
  canUndo: boolean;
  canUndoRound: boolean;
  onExit: () => void;
}

/** Marks a single dart in each ring is worth, per cricket's own scoring. */
const RING_MARKS = { single: 1, double: 2, triple: 3 } as const;

/**
 * Cricket. The scoreboard IS the keypad, laid out the way n01's own cricket screen works: every row
 * is `D | number | T` with each player's marks either side, so one tap enters one dart - the number
 * for a single, D for a double, T for a triple (and on the BULL row, the bull for an outer and D for
 * an inner). A turn is at most three taps plus 確定; darts that scored nothing are simply not
 * entered, so a turn where nothing landed is 確定 alone.
 *
 * Only the operation method follows n01 - the layout, styling and wording are n02's own, and nothing
 * from n01's assets, CSS or JavaScript was used.
 *
 * Marks entered this turn are shown in red and are not committed until 確定, so a mistake can be
 * fixed either with 1投戻す or by tapping the mark itself, which offers ／ ✕ ⊗ and delete. That
 * correction is deliberately scoped to the turn being entered right now: a confirmed turn - the
 * player's own earlier rounds included - and the opponent's marks are never editable in place, and
 * are corrected by undoing back to that point instead.
 */
export default function PentathlonCricketPlay({
  session,
  onTurn,
  onStageHit,
  onSetPendingHits,
  onUndoStagedHit,
  onUndoRound,
  canUndo,
  canUndoRound,
  onExit,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<CricketTarget | null>(null);
  // Digits typed towards a number, e.g. "1" on the way to 15. Keyboard entry only.
  const [typed, setTyped] = useState('');

  const current = session.current!;
  const disciplineId = currentDisciplineId(session);
  const active = current.active;
  const activeProgress = current.progress[active];
  const solo = session.playerCount === 1;
  const players: PlayerIndex[] = solo ? [0] : [0, 1];
  const views = players.map((index) => (current.progress[index].state as CricketState).self);

  const pending = current.pendingHits;
  const locked = activeProgress.finished;
  const full = pending.length >= 3;

  const stage = useCallback(
    (hit: DartHit) => {
      if (locked || full) return;
      onStageHit(hit);
    },
    [full, locked, onStageHit],
  );

  /** Pointer clicks drop focus afterwards so Enter keeps meaning 確定, not "press that key again". */
  const stageFromClick = useCallback(
    (hit: DartHit) => (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail > 0) event.currentTarget.blur();
      stage(hit);
    },
    [stage],
  );

  const commit = useCallback(() => {
    if (locked) return;
    setTyped('');
    onTurn(pending);
  }, [locked, onTurn, pending]);

  /** Undo steps back through the turn first, then through committed rounds - one visible action. */
  const undo = useCallback(() => {
    if (typed) setTyped((value) => value.slice(0, -1));
    else if (pending.length > 0) onUndoStagedHit();
    else if (canUndoRound) onUndoRound();
  }, [canUndoRound, onUndoRound, onUndoStagedHit, pending.length, typed]);

  useEffect(() => {
    if (menuOpen || editing !== null) return;
    const handler = (event: KeyboardEvent) => {
      if (locked || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const active_ = document.activeElement;
      const onControl = active_ instanceof HTMLElement && active_.matches('button, input, select, a[href]');

      if (key === 'enter') {
        if (onControl) return;
        event.preventDefault();
        commit();
        return;
      }
      if (key === 'backspace') {
        event.preventDefault();
        undo();
        return;
      }
      if (key === 'escape') {
        event.preventDefault();
        setTyped('');
        return;
      }
      if (key === 'b' || key === 'o') {
        event.preventDefault();
        setTyped('');
        stage({ kind: 'bull', ring: key === 'b' ? 'inner' : 'outer' });
        return;
      }
      const ring = key === 's' ? 'single' : key === 'd' ? 'double' : key === 't' ? 'triple' : null;
      if (ring) {
        event.preventDefault();
        const value = resolveTyped(typed);
        setTyped('');
        if (value !== null) stage({ kind: 'number', value, ring });
        return;
      }
      if (key >= '0' && key <= '9') {
        event.preventDefault();
        const next = typed + key;
        setTyped(isPrefixOfTarget(next) ? next : isPrefixOfTarget(key) ? key : '');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commit, editing, locked, menuOpen, stage, typed, undo]);

  return (
    <div className="pent-game-shell pent-play-shell pent-cricket-shell">
      <div className="pent-play">
        <div className="pent-play-head">
          <div className="pent-play-title">
            <p className="eyebrow">CRICKET</p>
            <h2>
              {typed
                ? `入力中 ${typed}… （S / D / T で確定）`
                : '刺さったエリアを最大3回タップして「確定」'}
            </h2>
          </div>
          <button
            type="button"
            className="pent-menu-button"
            aria-label="メニュー"
            onClick={() => setMenuOpen(true)}
          >
            ☰
          </button>
        </div>

        <div className="pent-play-main">
          <PentathlonProgress session={session} collapsible />

          <div className={`pent-cricket-board ${solo ? 'solo' : ''}`}>
            <div className="pent-cricket-row head">
              <span className={`pent-cricket-name ${active === 0 ? 'active' : ''}`}>{session.names[0]}</span>
              <span className="pent-cricket-num">NUMBER</span>
              {!solo && (
                <span className={`pent-cricket-name ${active === 1 ? 'active' : ''}`}>{session.names[1]}</span>
              )}
            </div>

            {CRICKET_TARGETS.map((target) => {
              const isBull = target === 'BULL';
              const staged = players.map((index) =>
                index === active ? pendingMarksOn(pending, target) : 0,
              );
              const committed = players.map((index) => views[index].marks[String(target)] ?? 0);
              const dead = !solo && committed[0] >= 3 && committed[1] >= 3;
              return (
                <div className={`pent-cricket-row ${dead ? 'dead' : ''}`} key={String(target)}>
                  <CricketMark
                    marks={committed[0]}
                    staged={staged[0]}
                    onEdit={active === 0 && staged[0] > 0 ? () => setEditing(target) : undefined}
                  />
                  <div className="pent-cricket-keys">
                    <button
                      type="button"
                      className="pent-cricket-ring"
                      disabled={locked || full}
                      aria-label={`ダブル${isBull ? 'ブル' : target}`}
                      onClick={stageFromClick(hitFor(target, 'double'))}
                    >
                      D
                    </button>
                    <button
                      type="button"
                      className={`pent-cricket-key ${isBull ? 'bull' : ''}`}
                      disabled={locked || full}
                      aria-label={isBull ? 'アウターブル' : `シングル${target}`}
                      onClick={stageFromClick(hitFor(target, 'single'))}
                    >
                      {isBull ? <span className="pent-bull-dot" aria-hidden="true" /> : target}
                    </button>
                    {isBull ? (
                      <button
                        type="button"
                        className="pent-cricket-commit"
                        disabled={locked}
                        onClick={commit}
                      >
                        確定
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="pent-cricket-ring"
                        disabled={locked || full}
                        aria-label={`トリプル${target}`}
                        onClick={stageFromClick(hitFor(target, 'triple'))}
                      >
                        T
                      </button>
                    )}
                  </div>
                  {!solo && (
                    <CricketMark
                      marks={committed[1]}
                      staged={staged[1]}
                      onEdit={active === 1 && staged[1] > 0 ? () => setEditing(target) : undefined}
                    />
                  )}
                </div>
              );
            })}

            <div className="pent-cricket-row total">
              <strong>{views[0].points}</strong>
              <span className="pent-cricket-num">POINTS</span>
              {!solo && <strong>{views[1]?.points ?? 0}</strong>}
            </div>
          </div>
        </div>

        <div className="pent-play-pad">
          <div className="pent-cricket-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={locked || (pending.length === 0 && !canUndoRound && !typed)}
              onClick={undo}
            >
              {pending.length > 0 || typed ? '1投戻す' : '前のラウンドに戻す'}
            </button>
            <span className="pent-cricket-status" aria-live="polite">
              {session.names[active]}・この投球 {pending.length} / 3
            </span>
          </div>
        </div>
      </div>

      {editing !== null && (
        <MarkEditor
          target={editing}
          // Darts this turn still has free once this number's own darts are taken back out. BULL
          // needs two of them for 3 marks (it has no triple), so that choice can genuinely not fit.
          slotsFree={3 - pending.filter((hit) => cricketMarks(hit)?.target !== editing).length}
          onClose={() => setEditing(null)}
          onApply={(marks) => {
            onSetPendingHits(withMarksOn(pending, editing, marks));
            setEditing(null);
          }}
        />
      )}

      {menuOpen && (
        <PentathlonPlayMenu
          disciplineId={disciplineId}
          canUndo={canUndo}
          canUndoRound={canUndoRound}
          onUndoRound={onUndoRound}
          onExit={onExit}
          onClose={() => setMenuOpen(false)}
          padKind="cricket"
        />
      )}
    </div>
  );
}

/**
 * The ／ ✕ ⊗ 🗑 popover: sets this turn's marks on one number, or clears them. A choice that would
 * need more darts than the turn has left is offered as disabled rather than silently truncated -
 * only BULL can hit that, since 3 marks there is an inner plus an outer (there is no triple bull).
 */
function MarkEditor({
  target,
  slotsFree,
  onApply,
  onClose,
}: {
  target: CricketTarget;
  slotsFree: number;
  onApply: (marks: 0 | 1 | 2 | 3) => void;
  onClose: () => void;
}) {
  const dartsNeeded = (marks: 1 | 2 | 3) => (target === 'BULL' && marks === 3 ? 2 : 1);
  const fits = (marks: 1 | 2 | 3) => dartsNeeded(marks) <= slotsFree;

  return (
    <PentathlonModal label={`${target} の入力を修正`} onClose={onClose}>
      <h2>{target} の入力を修正</h2>
      <div className="pent-mark-choices">
        <button type="button" aria-label="1マークにする" disabled={!fits(1)} onClick={() => onApply(1)}>
          ╱
        </button>
        <button type="button" aria-label="2マークにする" disabled={!fits(2)} onClick={() => onApply(2)}>
          ✕
        </button>
        <button type="button" aria-label="3マークにする" disabled={!fits(3)} onClick={() => onApply(3)}>
          <span className="pent-cricket-sym closed">✕</span>
        </button>
        <button type="button" className="delete" aria-label="この入力を削除" onClick={() => onApply(0)}>
          🗑
        </button>
      </div>
      <p>
        この投球で入力した {target} のマークだけを変更します。
        {!fits(3) && 'ブルの3マークはインナー＋アウターの2投が必要なため、残りの投数が足りません。'}
      </p>
      <button type="button" className="n01-modal-cancel" onClick={onClose}>
        キャンセル
      </button>
    </PentathlonModal>
  );
}

/**
 * One player's cell for one number: the standard mark notation (blank / ╱ / ✕ / circled ✕), with
 * marks entered this turn but not yet committed shown in red alongside their count, so they are
 * obviously provisional - and tappable, to correct them.
 */
function CricketMark({
  marks,
  staged,
  onEdit,
}: {
  marks: number;
  staged: number;
  onEdit?: () => void;
}) {
  const total = marks + staged;
  const label =
    total <= 0 ? '未オープン' : total === 1 ? '1マーク' : total === 2 ? '2マーク' : 'クローズ（3マーク以上）';

  const body = (
    <>
      {staged > 0 && <em className="pent-cricket-staged-count">{staged}</em>}
      {total > 0 && (
        <span className={`pent-cricket-sym ${total >= 3 ? 'closed' : ''}`} aria-hidden="true">
          {total === 1 ? '╱' : '✕'}
        </span>
      )}
    </>
  );
  const className = `pent-cricket-mark ${staged > 0 ? 'staged' : ''}`;

  if (onEdit) {
    return (
      <button type="button" className={`${className} editable`} aria-label={`${label} を修正`} onClick={onEdit}>
        {body}
      </button>
    );
  }
  return (
    <span className={className} aria-label={label}>
      {body}
    </span>
  );
}

function hitFor(target: CricketTarget, ring: 'single' | 'double' | 'triple'): DartHit {
  if (target === 'BULL') return { kind: 'bull', ring: ring === 'single' ? 'outer' : 'inner' };
  return { kind: 'number', value: target, ring };
}

/** Marks the staged darts have put on one number this turn. */
function pendingMarksOn(pending: readonly DartHit[], target: CricketTarget): number {
  return pending.reduce((total, hit) => {
    const scored = cricketMarks(hit);
    return scored && scored.target === target ? total + scored.marks : total;
  }, 0);
}

/** The staged turn with this number's darts replaced by a single dart worth `marks` (0 removes). */
function withMarksOn(pending: readonly DartHit[], target: CricketTarget, marks: 0 | 1 | 2 | 3): DartHit[] {
  const others = pending.filter((hit) => cricketMarks(hit)?.target !== target);
  if (marks === 0) return others;
  const ring = (Object.keys(RING_MARKS) as Array<keyof typeof RING_MARKS>).find(
    (name) => RING_MARKS[name] === marks,
  )!;
  // BULL has no triple, so 3 marks there is an inner bull plus an outer.
  if (target === 'BULL' && marks === 3) {
    return [...others, { kind: 'bull', ring: 'inner' }, { kind: 'bull', ring: 'outer' }];
  }
  return [...others, hitFor(target, ring)];
}

const TARGET_STRINGS = CRICKET_TARGETS.filter((t) => t !== 'BULL').map(String);

function isPrefixOfTarget(digits: string): boolean {
  return TARGET_STRINGS.some((value) => value.startsWith(digits));
}

/** The number the typed digits mean, once they name exactly one of the in-play numbers. */
function resolveTyped(typed: string): number | null {
  if (typed === '') return null;
  const matches = TARGET_STRINGS.filter((value) => value.startsWith(typed));
  if (matches.includes(typed)) return Number(typed);
  return matches.length === 1 ? Number(matches[0]) : null;
}
