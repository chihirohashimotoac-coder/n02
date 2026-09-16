import { useEffect, useId, useState } from 'react';
import { TOWER_SCENE_BANDS, towerSceneUrl } from '../../domain/practice/towerAssets';

interface Props {
  /** 1...5 - which stretch of the tower the climb is in. Picks the artwork and the palette. */
  band: number;
}

/**
 * The stairwell the climb is happening in.
 *
 * Two layers. The artwork in web/public/tower/ is the scene a player sees; underneath it sits a
 * scene built out of geometry - masonry, a flight of stairs in one-point perspective, an arch and
 * wall torches - which paints instantly, covers the moment before a 200KB image arrives, and is
 * what remains if the file is missing, blocked, or being asked for offline before it was ever
 * fetched. Neither layer is decoration for the other: the drawing is the fallback, and it is
 * exercised whenever the artwork cannot load.
 *
 * The source video's frames are still not used here. The artwork was supplied separately; the
 * frames stay evidence, and no game asset is cut from them.
 *
 * All of it is decoration behind the board and is `aria-hidden`: nothing here carries information
 * the player needs, and the floor number is announced elsewhere.
 *
 * Gradient ids come from `useId`, so two scenes on one page - or the scene next to the board and
 * the gauge - can never collide over a document-wide id.
 */

/*
 * A 4:3 viewBox, drawn to be cropped.
 *
 * The scene is placed with `slice`, so a phone in portrait sees a tall strip of the middle and a
 * desktop sees most of the width. Everything that carries the composition - the arch, the flight,
 * the nearest torches - therefore lives in the central third; the outer thirds hold only more wall
 * and the far torches, which a narrow screen can lose without noticing.
 */
const VIEW_W = 800;
const VIEW_H = 600;
/** Where the stairs and the wall courses converge. Slightly above centre, so the climb reads as up. */
const VP_X = 400;
const VP_Y = 236;

interface Palette {
  /** Deep shadow, far from the light. */
  far: string;
  /** Lit stone. */
  near: string;
  /** Stair tread, the brightest masonry. */
  tread: string;
  /** The daylight or torchlight beyond the arch. */
  glow: string;
}

/**
 * Five stretches of the climb. The tower gets colder and higher as it goes, then opens to the sky:
 * cellar sandstone, damp mossed stone, blue granite, a violet upper hall, and the summit at dawn.
 */
const PALETTES: Record<number, Palette> = {
  1: { far: '#150e09', near: '#5b4029', tread: '#7d5c3c', glow: '#ffae52' },
  2: { far: '#0b1510', near: '#2f4a39', tread: '#4a6b53', glow: '#7fe0ae' },
  3: { far: '#090f19', near: '#27405f', tread: '#3d5f85', glow: '#6fb6ff' },
  4: { far: '#120c20', near: '#3f3066', tread: '#5b478c', glow: '#c08cff' },
  5: { far: '#070c1e', near: '#2c3c6f', tread: '#46598f', glow: '#ffd977' },
};

function paletteFor(band: number): Palette {
  return PALETTES[Math.min(5, Math.max(1, Math.round(band)))] ?? PALETTES[1];
}

/** Deterministic 0...1 from two integers - the per-stone tone variation, stable across renders. */
function jitter(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Mixes two hex colours. `amount` 0 returns `from`, 1 returns `to`. */
function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${channel(r1, r2)} ${channel(g1, g2)} ${channel(b1, b2)})`;
}

interface Stone {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: number;
}

/**
 * The back wall, in courses that shorten and crowd together toward the vanishing point - which is
 * what reads as distance without any actual 3D.
 */
function buildWall(): Stone[] {
  const stones: Stone[] = [];
  const courses = 16;
  for (let row = 0; row < courses; row += 1) {
    // Rows are laid from the bottom up, easing toward the vanishing point.
    const t = row / courses;
    const eased = t ** 1.5;
    const y = VIEW_H - (VIEW_H - VP_Y) * eased;
    const next = VIEW_H - (VIEW_H - VP_Y) * ((row + 1) / courses) ** 1.5;
    const h = Math.max(6, y - next);
    const blockW = 76 - 46 * eased;
    // Alternate courses are offset by half a block, the way masonry is actually laid.
    const offset = row % 2 === 0 ? 0 : blockW / 2;
    for (let x = -blockW; x < VIEW_W + blockW; x += blockW) {
      stones.push({ x: x + offset, y: next, w: blockW - 1.5, h: h - 1.5, tone: jitter(row, x) });
    }
  }
  return stones;
}

interface Step {
  tread: string;
  riser: string;
}

/**
 * A flight climbing away from the viewer. Each step is a tread (the top face, catching the light)
 * and a riser (the front face, in shadow) drawn in one-point perspective toward VP.
 */
function buildStairs(): Step[] {
  const steps: Step[] = [];
  const count = 14;
  // Narrow enough at the base that the flight reads as a staircase rather than as floor bands.
  const baseHalf = 330;
  const topHalf = 52;
  const baseY = VIEW_H + 30;

  const at = (index: number) => {
    const t = index / count;
    const eased = t ** 0.72;
    return {
      half: baseHalf + (topHalf - baseHalf) * eased,
      y: baseY + (VP_Y + 18 - baseY) * eased,
    };
  };

  for (let index = 0; index < count; index += 1) {
    const a = at(index);
    const b = at(index + 1);
    const riserTop = a.y - (a.y - b.y) * 0.45;
    const halfAtRiser = a.half + (b.half - a.half) * 0.45;

    // Front face: from this step's nose up to where the tread starts.
    steps.push({
      riser: `M${VP_X - a.half} ${a.y} L${VP_X - halfAtRiser} ${riserTop} L${VP_X + halfAtRiser} ${riserTop} L${VP_X + a.half} ${a.y} Z`,
      // Top face: from the back of the riser to the next step's nose.
      tread: `M${VP_X - halfAtRiser} ${riserTop} L${VP_X - b.half} ${b.y} L${VP_X + b.half} ${b.y} L${VP_X + halfAtRiser} ${riserTop} Z`,
    });
  }
  return steps;
}

const WALL = buildWall();
const STAIRS = buildStairs();

/** The opening at the top of the flight, where the light comes from. */
const ARCH_W = 118;
const ARCH_TOP = 92;
const ARCH_BOTTOM = VP_Y + 26;
const ARCH = `M${VP_X - ARCH_W / 2} ${ARCH_BOTTOM} L${VP_X - ARCH_W / 2} ${ARCH_TOP + ARCH_W / 2} A${ARCH_W / 2} ${
  ARCH_W / 2
} 0 0 1 ${VP_X + ARCH_W / 2} ${ARCH_TOP + ARCH_W / 2} L${VP_X + ARCH_W / 2} ${ARCH_BOTTOM} Z`;

/**
 * Wall torches. The inner pair sits inside the strip a portrait phone keeps; the outer pair only
 * appears once the screen is wide enough to show it.
 */
const TORCHES = [
  { x: 286, y: 372, scale: 1 },
  { x: VIEW_W - 286, y: 372, scale: 1 },
  { x: 108, y: 300, scale: 1.15 },
  { x: VIEW_W - 108, y: 300, scale: 1.15 },
];

/**
 * The photographed scene for one band.
 *
 * Mounted with `key={band}` by the parent, so a band change makes a new element and its load state
 * starts clean - no chance of showing the sixties' scene while the eighties' file is still coming
 * down the wire. Until it reports `load` it stays transparent and the drawing shows through; if it
 * reports `error` it stays that way for good and the drawing is simply what the band looks like.
 *
 * On a successful load it warms the next band during idle time, the way the award assets do: a
 * climb only crosses a band boundary every 20 floors, and by then the file is already there.
 */
function ScenePhoto({ band }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (state !== 'ready' || band >= TOWER_SCENE_BANDS) return;
    const warm = () => {
      const next = new Image();
      next.src = towerSceneUrl(band + 1);
    };
    // requestIdleCallback is not in Safari; a short timeout is the same idea, late enough that it
    // never competes with the scene the player is actually looking at.
    const timer = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(timer);
  }, [band, state]);

  if (state === 'failed') return null;

  return (
    <img
      className={`tower-scene-photo ${state === 'ready' ? 'is-ready' : ''}`.trim()}
      src={towerSceneUrl(band)}
      alt=""
      aria-hidden="true"
      decoding="async"
      onLoad={() => setState('ready')}
      onError={() => setState('failed')}
    />
  );
}

export default function TowerScene({ band }: Props) {
  return (
    <div className="tower-scene" aria-hidden="true">
      <TowerSceneDrawing band={band} />
      <ScenePhoto key={band} band={band} />
      {/* Holds the board and the white type above the artwork, which is brightest exactly where the
          board sits. Without it the summit scene washes out the board's own numbers. */}
      <div className="tower-scene-scrim" />
    </div>
  );
}

function TowerSceneDrawing({ band }: Props) {
  const palette = paletteFor(band);
  const uid = useId().replace(/:/g, '');
  const wallId = `tw-wall-${uid}`;
  const skyId = `tw-sky-${uid}`;
  const hazeId = `tw-haze-${uid}`;
  const vignetteId = `tw-vig-${uid}`;

  return (
    <svg
      className="tower-scene-drawn"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={wallId} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={palette.far} />
          <stop offset="1" stopColor={palette.near} />
        </linearGradient>
        <radialGradient id={skyId} cx="0.5" cy="0.62" r="0.62">
          <stop offset="0" stopColor={palette.glow} />
          <stop offset="1" stopColor={mix(palette.glow, palette.near, 0.75)} />
        </radialGradient>
        <radialGradient id={hazeId} cx="0.5" cy="0.42" r="0.55">
          <stop offset="0" stopColor={palette.glow} stopOpacity="0.5" />
          <stop offset="1" stopColor={palette.glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={vignetteId} cx="0.5" cy="0.45" r="0.72">
          <stop offset="0.45" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.72" />
        </radialGradient>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${wallId})`} />

      {/* Masonry. Each stone takes a slightly different tone, and the courses darken with depth. */}
      {WALL.map((stone, index) => {
        const depth = 1 - (VIEW_H - stone.y) / (VIEW_H - VP_Y);
        const tone = mix(palette.far, palette.near, 0.25 + 0.55 * depth * (0.7 + stone.tone * 0.6));
        return (
          <rect
            key={index}
            x={stone.x}
            y={stone.y}
            width={stone.w}
            height={stone.h}
            fill={tone}
            opacity={0.85}
          />
        );
      })}

      {/* The way out, and the light that comes through it. */}
      <path d={ARCH} fill={`url(#${skyId})`} />
      <path d={ARCH} fill="none" stroke={mix(palette.near, '#000000', 0.35)} strokeWidth="5" />

      {/* The flight. Treads catch the light from the arch, risers stay in shadow. */}
      {STAIRS.map((step, index) => {
        const lit = index / STAIRS.length;
        return (
          <g key={index}>
            <path d={step.riser} fill={mix(palette.far, palette.near, 0.12 + lit * 0.3)} />
            <path
              d={step.tread}
              fill={mix(palette.tread, palette.glow, 0.1 + lit * 0.4)}
              opacity="0.95"
            />
            {/* The nose of the tread, catching the light from above. */}
            <path
              d={step.tread}
              fill="none"
              stroke={mix(palette.tread, palette.glow, 0.55)}
              strokeWidth="1.2"
              opacity={0.35 + lit * 0.4}
            />
          </g>
        );
      })}

      {/* Light spilling down the flight, over everything it falls on. */}
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${hazeId})`} />

      {TORCHES.map((torch, index) => (
        <g key={index}>
          <circle cx={torch.x} cy={torch.y} r={52 * torch.scale} fill={palette.glow} opacity="0.13" />
          <circle cx={torch.x} cy={torch.y} r={21 * torch.scale} fill={palette.glow} opacity="0.2" />
          <ellipse
            cx={torch.x}
            cy={torch.y}
            rx={5 * torch.scale}
            ry={11 * torch.scale}
            fill={palette.glow}
            opacity="0.95"
          />
          <ellipse
            cx={torch.x}
            cy={torch.y + 3}
            rx={2.4 * torch.scale}
            ry={6 * torch.scale}
            fill="#fff8e0"
            opacity="0.85"
          />
          <rect
            x={torch.x - 2}
            y={torch.y + 11 * torch.scale}
            width="4"
            height={16 * torch.scale}
            fill={mix(palette.far, '#000000', 0.35)}
          />
        </g>
      ))}

      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${vignetteId})`} />
    </svg>
  );
}
