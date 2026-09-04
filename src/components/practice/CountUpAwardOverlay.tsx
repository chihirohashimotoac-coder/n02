import { useEffect } from 'react';
import { AWARD_LABELS, type AwardKind } from '../../domain/practice/countUp';

export interface AwardPresentation {
  /** Bumped for every presented award, so a consecutive award restarts the animation and the timer. */
  id: number;
  kind: AwardKind;
  score: number;
  playerName: string;
}

interface Props {
  award: AwardPresentation | null;
  onExpire: () => void;
  /** How long the presentation stays up. Roughly 3 seconds, per the COUNT-UP spec. */
  durationMs?: number;
}

/**
 * The COUNT-UP award presentation.
 *
 * Deliberately NOT a modal: it never takes focus, never blocks pointer events (pointer-events: none
 * in CSS) and never gates game progression - the score is already committed and the next player is
 * already up by the time this renders. A second award inside the window replaces the first outright
 * and restarts the timer, rather than queueing behind it, so the presentation can never slow entry
 * down.
 */
export default function CountUpAwardOverlay({ award, onExpire, durationMs = 3000 }: Props) {
  const id = award?.id ?? null;

  useEffect(() => {
    if (id === null) return;
    const timer = setTimeout(onExpire, durationMs);
    return () => clearTimeout(timer);
  }, [id, durationMs, onExpire]);

  if (!award) return null;

  return (
    <div className="countup-award-layer" aria-live="polite" aria-atomic="true">
      {/* key on the award id: a replacement award re-mounts the card so its entry animation replays. */}
      <div key={award.id} className={`countup-award-card award-${award.kind.toLowerCase().replace(/_/g, '-')}`}>
        <span className="countup-award-player">{award.playerName}</span>
        <strong className="countup-award-name">{AWARD_LABELS[award.kind]}</strong>
        <b className="countup-award-score">{award.score}</b>
        <span className="countup-award-rays" aria-hidden="true" />
      </div>
    </div>
  );
}
