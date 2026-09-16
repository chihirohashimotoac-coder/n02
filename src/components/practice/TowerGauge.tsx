import { useState } from 'react';
import { TOWER_GAUGE_ART, gaugeLitInsetPct, towerGaugeUrl } from '../../domain/practice/towerAssets';

interface GaugePlayer {
  name: string;
  /** Highest floor this player is past. */
  clearedFloor: number;
  active: boolean;
}

interface Props {
  players: readonly GaugePlayer[];
  finalFloor: number;
  className?: string;
}

/**
 * The climb, drawn as the tower itself.
 *
 * It reads bottom-to-top like the original's tower: the stonework fills with light as floors are
 * beaten, and each player's marker rides the shaft at their own height. A plain bar would carry the
 * same number, but the point of this gauge is that a glance at it says "how far up the tower am I",
 * which a horizontal bar never quite does.
 *
 * The tower is the supplied artwork (web/public/tower/tower-gauge.webp), laid down twice: a dimmed
 * copy for the part still ahead, and a full-brightness copy clipped to the part already climbed.
 * Same file, same box, so the two always line up and the browser fetches it once.
 *
 * The box is given the image's own aspect ratio, which is what makes the percentages honest: a
 * `clip-path: inset(...)` is measured against the element, so unless the element IS the image, a
 * percentage taken off the artwork would land somewhere else on screen. The measurements
 * themselves live in towerAssets.ts.
 *
 * If the file cannot be fetched the gauge falls back to a plain stack of storey blocks - the shape
 * it had before the artwork existed - so the climb is still readable offline or on a broken deploy.
 */

/** One block per this many floors, in the fallback gauge. 100 / 5 = 20 storeys. */
const FLOORS_PER_BLOCK = 5;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function TowerGauge({ players, finalFloor, className = '' }: Props) {
  const [artFailed, setArtFailed] = useState(false);
  const leader = players.reduce((best, player) => Math.max(best, player.clearedFloor), 0);
  const label = players.map((player) => `${player.name} ${player.clearedFloor}F`).join('、');

  return (
    <div
      className={`tower-gauge ${artFailed ? 'is-drawn' : ''} ${className}`.trim()}
      style={{ aspectRatio: `${TOWER_GAUGE_ART.width} / ${TOWER_GAUGE_ART.height}` }}
      role="img"
      aria-label={`塔の進行：${finalFloor}F 中 ${label}`}
    >
      {artFailed ? (
        <FallbackTower finalFloor={finalFloor} leader={leader} />
      ) : (
        <>
          {/* The climb still ahead: the same tower, held back in the dark. */}
          <img
            className="tower-gauge-art"
            src={towerGaugeUrl()}
            alt=""
            aria-hidden="true"
            decoding="async"
            onError={() => setArtFailed(true)}
          />
          {/* The climb already made, lit from the plinth up to where the leader stands. */}
          <img
            className="tower-gauge-art is-lit"
            src={towerGaugeUrl()}
            alt=""
            aria-hidden="true"
            decoding="async"
            style={{ clipPath: `inset(${round(gaugeLitInsetPct(leader, finalFloor))}% 0 0 0)` }}
          />
        </>
      )}

      {players.map((player, index) => {
        const inset = round(gaugeLitInsetPct(player.clearedFloor, finalFloor));
        // Player 1 rides the left face of the shaft, player 2 the right, so two markers never sit
        // on top of each other however close the climbs are.
        const left = index === 0;
        return (
          <span
            key={index}
            className={`tower-gauge-marker p${index} ${player.active ? 'is-active' : ''}`.trim()}
            style={
              left
                ? { top: `${inset}%`, right: `${round(100 - TOWER_GAUGE_ART.shaftLeftPct)}%` }
                : { top: `${inset}%`, left: `${TOWER_GAUGE_ART.shaftRightPct}%` }
            }
          />
        );
      })}
    </div>
  );
}

/**
 * What the gauge looks like with no artwork: storeys stacked bottom-up, lighting as they are
 * beaten. Stretched to the same box, so the markers keep pointing at the right heights.
 */
function FallbackTower({ finalFloor, leader }: { finalFloor: number; leader: number }) {
  const count = Math.ceil(finalFloor / FLOORS_PER_BLOCK);
  const { shaftTopPct, shaftBottomPct, shaftLeftPct, shaftRightPct } = TOWER_GAUGE_ART;
  const span = shaftBottomPct - shaftTopPct;

  return (
    <svg
      className="tower-gauge-fallback"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: count }, (_, index) => {
        const topFloor = Math.min(finalFloor, (index + 1) * FLOORS_PER_BLOCK);
        const bottom = shaftBottomPct - (index / count) * span;
        const top = shaftBottomPct - ((index + 1) / count) * span;
        return (
          <rect
            key={topFloor}
            className={`tower-gauge-block ${topFloor <= leader ? 'is-climbed' : ''}`.trim()}
            x={shaftLeftPct}
            y={round(top)}
            width={round(shaftRightPct - shaftLeftPct)}
            height={round(bottom - top - 0.25)}
          />
        );
      })}
    </svg>
  );
}
