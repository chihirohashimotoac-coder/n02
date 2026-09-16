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
 * It reads bottom-to-top like the original's tower: the stack of floor blocks fills upwards as
 * floors are beaten, and each player's marker rides the outside at their own height. A plain bar
 * would carry the same number, but the point of this gauge is that a glance at it says "how far up
 * the tower am I", which a horizontal bar never quite does.
 *
 * Drawn as discrete blocks rather than one clipped shape on purpose: it looks like stacked storeys,
 * and it needs no `clipPath` or `mask`, so the gauge introduces no document-wide SVG id that could
 * collide with the board beside it or with a second gauge on the same screen.
 */

/** One block per this many floors. 100 / 5 = 20 storeys, which reads as a tower rather than a bar. */
const FLOORS_PER_BLOCK = 5;

/*
 * A deliberately tall, narrow viewBox. The gauge is laid out as a slim full-height column beside
 * the board, and the drawing scales to fit its width - so the taller the box is relative to its
 * width, the more of the column's height the tower actually occupies.
 */
const VIEW_W = 40;
const VIEW_H = 520;
/** The tower tapers as it rises: half-width at the base and at the top of the shaft. */
const BASE_HALF = 13;
const TOP_HALF = 7.5;
const SHAFT_BOTTOM = 495;
const SHAFT_TOP = 58;
const CENTRE = VIEW_W / 2;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Half-width of the tower at a height ratio (0 at the base, 1 at the top of the shaft). */
function halfWidthAt(ratio: number): number {
  return round(BASE_HALF + (TOP_HALF - BASE_HALF) * ratio);
}

function yAt(ratio: number): number {
  return round(SHAFT_BOTTOM + (SHAFT_TOP - SHAFT_BOTTOM) * ratio);
}

interface Block {
  d: string;
  /** The highest floor this block represents, so it can be compared against a cleared floor. */
  topFloor: number;
}

/** Static geometry: the storeys, bottom first. */
function buildBlocks(finalFloor: number): Block[] {
  const count = Math.ceil(finalFloor / FLOORS_PER_BLOCK);
  return Array.from({ length: count }, (_, index) => {
    const from = index / count;
    const to = (index + 1) / count;
    // A small gap between storeys, so the courses read as separate floors.
    const yBottom = yAt(from);
    const yTop = yAt(to) + 2;
    const halfBottom = halfWidthAt(from);
    const halfTop = halfWidthAt(to);
    return {
      topFloor: Math.min(finalFloor, (index + 1) * FLOORS_PER_BLOCK),
      d: [
        `M${round(CENTRE - halfBottom)} ${yBottom}`,
        `L${round(CENTRE - halfTop)} ${yTop}`,
        `L${round(CENTRE + halfTop)} ${yTop}`,
        `L${round(CENTRE + halfBottom)} ${yBottom}`,
        'Z',
      ].join(''),
    };
  });
}

/** The crenellated cap and the plinth, which are what make the silhouette read as a tower. */
function buildRoof(): string {
  const half = TOP_HALF + 2.5;
  const top = SHAFT_TOP - 3;
  const merlonTop = top - 18;
  const merlons = 5;
  const step = (half * 2) / (merlons * 2 - 1);
  const parts: string[] = [`M${round(CENTRE - half)} ${top}`];
  for (let index = 0; index < merlons; index += 1) {
    const left = round(CENTRE - half + index * step * 2);
    const right = round(left + step);
    parts.push(`L${left} ${merlonTop}`, `L${right} ${merlonTop}`, `L${right} ${top}`);
  }
  parts.push(`L${round(CENTRE + half)} ${top}`, 'Z');
  return parts.join('');
}

const ROOF = buildRoof();
const PLINTH = `M${round(CENTRE - BASE_HALF - 3.5)} ${VIEW_H} L${round(CENTRE - BASE_HALF - 1)} ${SHAFT_BOTTOM} L${round(
  CENTRE + BASE_HALF + 1,
)} ${SHAFT_BOTTOM} L${round(CENTRE + BASE_HALF + 3.5)} ${VIEW_H} Z`;

export default function TowerGauge({ players, finalFloor, className = '' }: Props) {
  const blocks = buildBlocks(finalFloor);
  const leader = players.reduce((best, player) => Math.max(best, player.clearedFloor), 0);
  const label = players
    .map((player) => `${player.name} ${player.clearedFloor}F`)
    .join('、');

  return (
    <svg
      className={`tower-gauge ${className}`.trim()}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={`塔の進行：${finalFloor}F 中 ${label}`}
    >
      <path className="tower-gauge-plinth" d={PLINTH} />

      {blocks.map((block) => (
        <path
          key={block.topFloor}
          className={`tower-gauge-block ${block.topFloor <= leader ? 'is-climbed' : ''}`}
          d={block.d}
        />
      ))}

      <path className={`tower-gauge-roof ${leader >= finalFloor ? 'is-climbed' : ''}`} d={ROOF} />

      {players.map((player, index) => {
        const ratio = Math.min(1, Math.max(0, player.clearedFloor / finalFloor));
        const y = yAt(ratio);
        // Player 1 rides the left face, player 2 the right, so two markers never sit on top of
        // each other however close the climbs are.
        const left = index === 0;
        const x = left ? CENTRE - halfWidthAt(ratio) - 1 : CENTRE + halfWidthAt(ratio) + 1;
        const tip = left ? x + 6 : x - 6;
        return (
          <polygon
            key={index}
            className={`tower-gauge-marker p${index} ${player.active ? 'is-active' : ''}`}
            points={`${round(tip)},${y} ${round(x)},${round(y - 11)} ${round(x)},${round(y + 11)}`}
          />
        );
      })}
    </svg>
  );
}
