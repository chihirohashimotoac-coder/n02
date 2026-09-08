import { useEffect, useRef, useState } from 'react';
import { AWARD_LABELS, type AwardKind } from '../../domain/awards';
import { awardAsset } from '../../domain/awardAssets';

export interface AwardPresentation {
  /** Bumped for every presented award, so a consecutive award restarts the movie and the timer. */
  id: number;
  kind: AwardKind;
  score: number;
  playerName: string;
}

interface Props {
  award: AwardPresentation | null;
  onExpire: () => void;
}

/**
 * How long the presentation stays up. Fixed, and deliberately not a prop: the movies are exactly
 * 3.000s (90 frames at 30fps) and the overlay must clear on time whether the movie loaded, failed,
 * or was never played at all. Nothing here waits on the network.
 */
export const AWARD_DURATION_MS = 3000;

/** Live prefers-reduced-motion, so changing the OS setting takes effect without a reload. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * The award presentation, shared by COUNT-UP, 通常01 and チェックアウト練習.
 *
 * Emphatically NOT a modal:
 *  - the whole layer is pointer-events: none, so score entry, ENTER, UNDO, player switching and
 *    every result action underneath stay live and clickable while it is up;
 *  - it never takes focus and never moves it, so the keyboard route is uninterrupted;
 *  - it never gates progression - the score is already committed and the next player is already up
 *    by the time this renders.
 *
 * The movie is decoration: aria-hidden, muted, played once from the first frame. What the award
 * actually IS gets announced as real text through the polite live region.
 */
export default function AwardOverlay({ award, onExpire }: Props) {
  const id = award?.id ?? null;

  // One timer per presented award. Keyed on the id, so a second award inside the window replaces
  // the first outright and restarts the clock rather than queueing behind it - and, critically, the
  // previous timer is cleared here, so an old timer can never cut a newer award short.
  useEffect(() => {
    if (id === null) return;
    const timer = setTimeout(onExpire, AWARD_DURATION_MS);
    return () => clearTimeout(timer);
  }, [id, onExpire]);

  if (!award) return null;

  return (
    <div className="award-layer">
      {/*
        Keyed on the award id: a replacement award remounts the card outright, which is what resets
        the movie to frame 0, replays the entry animation, and gives the new award a clean shot at
        its own movie rather than inheriting the previous one's fallback.
      */}
      <AwardCard key={award.id} award={award} />
    </div>
  );
}

/**
 * One award's card. All of its media state is per-mount, so it is reset by the key above rather
 * than by an effect.
 *
 * Failure is not a special case here. A 404, a decode error, an offline first run, or a movie that
 * is simply slow all land on the poster, and the poster failing lands on the CSS presentation. The
 * 3-second timer in the parent runs independently of every one of them.
 */
function AwardCard({ award }: { award: AwardPresentation }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /** 'movie' until this award's movie proves it cannot play, then 'poster'. */
  const [media, setMedia] = useState<'movie' | 'poster'>('movie');
  const [posterFailed, setPosterFailed] = useState(false);
  const reduceMotion = useReducedMotion();

  /**
   * Play from the first frame, once. play() rejects when autoplay is refused or the source is
   * unusable; either way the poster takes over.
   */
  useEffect(() => {
    if (reduceMotion) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    video.currentTime = 0;
    const started = video.play();
    if (started && typeof started.catch === 'function') {
      started.catch(() => {
        if (!cancelled) setMedia('poster');
      });
    }
    return () => {
      cancelled = true;
      // Release the decoder and drop any in-flight fetch on unmount, navigation or game reset.
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [reduceMotion]);

  const asset = awardAsset(award.kind);
  const kindClass = `award-${award.kind.toLowerCase().replace(/_/g, '-')}`;
  // prefers-reduced-motion: no movie at all - the poster and the text hold for the same 3 seconds.
  const showMovie = media === 'movie' && !reduceMotion;

  return (
    <div className={`award-card ${kindClass}`}>
      <div className="award-media" aria-hidden="true">
        {showMovie && (
          <video
            ref={videoRef}
            className="award-video"
            src={asset.movie}
            poster={asset.poster}
            muted
            playsInline
            autoPlay
            preload="auto"
            // A 404, a decode failure or an offline first run all arrive here.
            onError={() => setMedia('poster')}
          />
        )}
        {!showMovie && !posterFailed && (
          <img className="award-poster" src={asset.poster} alt="" onError={() => setPosterFailed(true)} />
        )}
        {/* Nothing loaded at all: the CSS presentation is the floor, and it always renders. */}
        {!showMovie && posterFailed && <span className="award-fallback" />}
      </div>

      {/*
        The award itself, as real text over the movie. This is what a screen reader announces and
        what a player actually reads - the movie behind it carries no words at all.
      */}
      <div className="award-text" role="status" aria-live="polite" aria-atomic="true">
        <span className="award-player">{award.playerName}</span>
        <strong className="award-name">{AWARD_LABELS[award.kind]}</strong>
        <b className="award-score">{award.score}</b>
      </div>
    </div>
  );
}
