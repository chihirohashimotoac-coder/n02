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
/**
 * How long the movie is given to produce its first frame before the poster takes over.
 *
 * The movies open on a pure-black frame and are only 3 seconds long, so a card that is still
 * waiting on the network at this point would spend most of its life as a black square. Past this,
 * the still is simply the better presentation - and if the movie does arrive later it has already
 * missed the moment it was for.
 */
const FIRST_FRAME_BUDGET_MS = 1200;

function AwardCard({ award }: { award: AwardPresentation }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /** 'movie' until this award's movie proves it cannot play in time, then 'poster'. */
  const [media, setMedia] = useState<'movie' | 'poster'>('movie');
  const [posterFailed, setPosterFailed] = useState(false);
  const reduceMotion = useReducedMotion();

  /**
   * Play once, from the top. The element is mounted fresh for every award (see the key above), so
   * it is already at frame 0 - assigning currentTime here would only risk a seek against metadata
   * that has not arrived yet.
   *
   * muted and playsInline are set on the element itself as well as in JSX: inline autoplay on iOS
   * is granted on what the element reports, and a video that is not demonstrably muted is refused.
   */
  useEffect(() => {
    if (reduceMotion) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    video.muted = true;
    video.playsInline = true;

    const attempt = () => {
      const started = video.play();
      if (!started || typeof started.catch !== 'function') return;
      started.catch((error: unknown) => {
        if (cancelled) return;
        // An AbortError is the browser's own autoplay taking the play over, or the element being
        // torn down - neither is a failure to play, and treating it as one used to drop a perfectly
        // good movie onto the poster. Only a refusal or an unusable source counts.
        if ((error as { name?: string } | null)?.name === 'AbortError') return;
        // One retry once there is something to play: the first attempt can land before the element
        // has any data at all, which some browsers reject outright.
        if (video.readyState >= 2) {
          setMedia('poster');
          return;
        }
        video.addEventListener(
          'canplay',
          () => {
            if (cancelled) return;
            const retried = video.play();
            if (retried && typeof retried.catch === 'function') {
              retried.catch(() => {
                if (!cancelled) setMedia('poster');
              });
            }
          },
          { once: true },
        );
      });
    };
    attempt();

    // Nothing on screen yet and the window is a third gone: show the still instead.
    const budget = window.setTimeout(() => {
      if (!cancelled && video.readyState < 2) setMedia('poster');
    }, FIRST_FRAME_BUDGET_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(budget);
      // Just stop it. The element is being removed from the document, which is what releases the
      // decoder and the fetch; clearing src here would be React's own attribute mutated behind its
      // back, and on a re-mount React does not put it back - the movie would be lost for good.
      video.pause();
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
            /*
             * Deliberately NO poster attribute. Every movie opens on a pure-black frame, so a
             * poster here would paint the bright middle of the award first and then snap to black
             * the instant playback began - which reads as the movie not being the delivered one at
             * all. The card's own near-black ground is that first frame; the poster is the
             * FALLBACK, rendered below only once the movie is out of the running.
             */
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
