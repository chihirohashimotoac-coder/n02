import { useMemo } from 'react';
import {
  TOWER_NUMBER_ORDER,
  describeFloorTargets,
  type TowerNumber,
  type TowerRegionId,
} from '../../domain/practice/towerRegions';

interface Props {
  /** The floor's lit regions - the whole point of the drawing. */
  regions: readonly TowerRegionId[];
  /** Shown in the corner of the board, e.g. `12`. Omitted on the small result-screen boards. */
  floor?: number;
  /** Extra classes, for the size variants in tower.css. */
  className?: string;
  /** Replaces the generated caption in the accessible name (the play screen says whose target it is). */
  ariaLabel?: string;
}

/**
 * TOWER's own dartboard.
 *
 * It exists because TOWER is the only mode that has to draw the four rings of a number apart - an
 * inner single lit while the outer single beside it is dark (81F), or SBULL lit with DBULL dark
 * (99F). The board Pentathlon and 01 use is a keypad, not a drawing, and teaching it this
 * distinction would change the input model of every mode that shares it. So this component draws
 * its own, renders only inside TOWER, and is never handed to another mode.
 *
 * It is a picture, not a control: there is nothing to click. TOWER never asks where a dart landed,
 * only whether the player judged it in, so a region here is never a hit target and never carries a
 * score.
 *
 * Deliberately built from plain `<path>` elements with no `<defs>`, mask, clipPath, gradient or
 * filter, so it introduces no document-wide SVG ids that could collide with another board on the
 * page (Pentathlon's cricket marks, the share card) or with itself when several boards are drawn at
 * once on the result screen.
 */

/**
 * Radii in viewBox units. Proportional to a real board, except that the TRIPLE and DOUBLE bands are
 * widened: at true scale they are ~4% of the radius each, which on a phone is a hairline that
 * cannot be read across the room, and reading which band is lit is the whole task here.
 */
const R_DB = 11;
const R_SB = 23;
const R_TRIPLE_IN = 57;
const R_TRIPLE_OUT = 74;
const R_DOUBLE_IN = 95;
const R_DOUBLE_OUT = 112;
const R_LABEL = 123;
const VIEW = 134;

const SECTOR_DEGREES = 360 / TOWER_NUMBER_ORDER.length;
const HALF_SECTOR = SECTOR_DEGREES / 2;

type SegmentTone = 'dark' | 'light' | 'red' | 'green';

interface Segment {
  id: TowerRegionId;
  d: string;
  tone: SegmentTone;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function polar(radius: number, degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [round(radius * Math.cos(radians)), round(radius * Math.sin(radians))];
}

/** An annular sector. Always under 180 degrees wide, so the large-arc flag is always 0. */
function sectorPath(innerRadius: number, outerRadius: number, from: number, to: number): string {
  const [x0, y0] = polar(outerRadius, from);
  const [x1, y1] = polar(outerRadius, to);
  const [x2, y2] = polar(innerRadius, to);
  const [x3, y3] = polar(innerRadius, from);
  return [
    `M${x0} ${y0}`,
    `A${outerRadius} ${outerRadius} 0 0 1 ${x1} ${y1}`,
    `L${x2} ${y2}`,
    `A${innerRadius} ${innerRadius} 0 0 0 ${x3} ${y3}`,
    'Z',
  ].join('');
}

/** Static geometry: computed once for the module, never per render. */
const SEGMENTS: readonly Segment[] = TOWER_NUMBER_ORDER.flatMap((value, index) => {
  const centre = -90 + index * SECTOR_DEGREES;
  const from = centre - HALF_SECTOR;
  const to = centre + HALF_SECTOR;
  // A real board alternates the pairs: 20 has black singles with red rings, 1 cream with green.
  const single: SegmentTone = index % 2 === 0 ? 'dark' : 'light';
  const ring: SegmentTone = index % 2 === 0 ? 'red' : 'green';
  return [
    { id: `SI:${value}` as TowerRegionId, d: sectorPath(R_SB, R_TRIPLE_IN, from, to), tone: single },
    { id: `T:${value}` as TowerRegionId, d: sectorPath(R_TRIPLE_IN, R_TRIPLE_OUT, from, to), tone: ring },
    { id: `SO:${value}` as TowerRegionId, d: sectorPath(R_TRIPLE_OUT, R_DOUBLE_IN, from, to), tone: single },
    { id: `D:${value}` as TowerRegionId, d: sectorPath(R_DOUBLE_IN, R_DOUBLE_OUT, from, to), tone: ring },
  ];
});

const LABELS: readonly { value: TowerNumber; x: number; y: number }[] = TOWER_NUMBER_ORDER.map(
  (value, index) => {
    const [x, y] = polar(R_LABEL, -90 + index * SECTOR_DEGREES);
    return { value, x, y };
  },
);

export default function TowerBoard({ regions, floor, className = '', ariaLabel }: Props) {
  const lit = useMemo(() => new Set<string>(regions), [regions]);
  const caption = useMemo(() => describeFloorTargets(regions), [regions]);

  /** A number's label lights up when any of its four bands does - the eye finds the sector first. */
  const litNumbers = useMemo(() => {
    const set = new Set<TowerNumber>();
    for (const id of regions) {
      const separator = id.indexOf(':');
      if (separator !== -1) set.add(Number(id.slice(separator + 1)) as TowerNumber);
    }
    return set;
  }, [regions]);

  const label = ariaLabel ?? `${floor !== undefined ? `${floor}F の` : ''}お題：${caption}`;

  return (
    <svg
      className={`tower-board ${className}`.trim()}
      viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`}
      role="img"
      aria-label={label}
    >
      <circle className="tower-board-plate" cx="0" cy="0" r={R_DOUBLE_OUT + 10} />

      {SEGMENTS.map((segment) => (
        <path
          key={segment.id}
          data-region={segment.id}
          className={`tower-seg tone-${segment.tone}${lit.has(segment.id) ? ' is-lit' : ''}`}
          d={segment.d}
        />
      ))}

      {/* The two bulls are separate regions and are drawn as such - 99F lights the ring only,
          100F the centre only. */}
      <circle
        data-region="SB"
        className={`tower-seg tone-green${lit.has('SB') ? ' is-lit' : ''}`}
        cx="0"
        cy="0"
        r={R_SB}
      />
      <circle
        data-region="DB"
        className={`tower-seg tone-red${lit.has('DB') ? ' is-lit' : ''}`}
        cx="0"
        cy="0"
        r={R_DB}
      />

      {LABELS.map(({ value, x, y }) => (
        <text
          key={value}
          className={`tower-board-number${litNumbers.has(value) ? ' is-lit' : ''}`}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {value}
        </text>
      ))}

      {floor !== undefined && (
        <text className="tower-board-floor" x={-VIEW + 8} y={-VIEW + 8} dominantBaseline="hanging">
          {floor}F
        </text>
      )}
    </svg>
  );
}
