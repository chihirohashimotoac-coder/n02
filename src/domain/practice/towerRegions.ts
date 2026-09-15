/**
 * TOWER OF THE DARTS - the board vocabulary its floors are written in.
 *
 * 82 regions: 20 numbers x 4 rings, plus the two bulls. The two distinctions that matter here and
 * that no other n02 mode needs are kept strictly:
 *
 * - inner SINGLE (`SI`, between BULL and TRIPLE) and outer SINGLE (`SO`, between TRIPLE and DOUBLE)
 *   are different regions - 56F is SO:20 only, 81F is SI:12 only;
 * - SBULL (`SB`, the ring) and DBULL (`DB`, the centre) are different regions - 99F is SB only,
 *   100F is DB only.
 *
 * This vocabulary is TOWER's alone. It deliberately does not extend `domain/darts.ts`, whose
 * `DartHit` is what 01, checkout and Pentathlon score with: those modes have no reason to tell an
 * inner single from an outer one, and giving their shared type a TOWER-shaped ring set would change
 * every mode's input model to serve this one. Nothing here is scoring data - a region id never
 * carries points, because TOWER never scores a dart, it only asks whether the player judged it in.
 */

export const TOWER_NUMBERS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
] as const;
export type TowerNumber = (typeof TOWER_NUMBERS)[number];

/**
 * The numbers clockwise from the top, as they sit on a real board. Board layout rather than game
 * rules, but it belongs with the vocabulary: it is the other half of what a region id means.
 */
export const TOWER_NUMBER_ORDER: readonly TowerNumber[] = [
  20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5,
];

/** Ring ids, in the order a floor's regions are written: innermost band outwards. */
export const TOWER_RINGS = ['SI', 'SO', 'T', 'D'] as const;
export type TowerRing = (typeof TOWER_RINGS)[number];

export type TowerNumberRegionId = `${TowerRing}:${TowerNumber}`;
export type TowerBullRegionId = 'SB' | 'DB';
export type TowerRegionId = TowerNumberRegionId | TowerBullRegionId;

/**
 * Every region, canonical order: SI:1-20, SO:1-20, T:1-20, D:1-20, SB, DB. Course data is written
 * in this order, which is what makes a floor's region list comparable by value.
 */
export const TOWER_REGION_IDS: readonly TowerRegionId[] = [
  ...TOWER_RINGS.flatMap((ring) => TOWER_NUMBERS.map((value) => `${ring}:${value}` as TowerRegionId)),
  'SB',
  'DB',
];

/** 82 - the whole board, which is what 1F lights up. */
export const TOWER_REGION_COUNT = TOWER_REGION_IDS.length;

const REGION_ID_SET: ReadonlySet<string> = new Set<string>(TOWER_REGION_IDS);

export function isTowerRegionId(value: unknown): value is TowerRegionId {
  return typeof value === 'string' && REGION_ID_SET.has(value);
}

export const TOWER_RING_LABELS: Record<TowerRing, string> = {
  SI: '内SINGLE',
  SO: '外SINGLE',
  T: 'TRIPLE',
  D: 'DOUBLE',
};

export const TOWER_BULL_LABELS: Record<TowerBullRegionId, string> = {
  SB: 'SBULL',
  DB: 'DBULL',
};

/** The number in a number-region id, or null for a bull. */
export function regionNumber(id: TowerRegionId): TowerNumber | null {
  const separator = id.indexOf(':');
  if (separator === -1) return null;
  return Number(id.slice(separator + 1)) as TowerNumber;
}

/** The ring of a number-region id, or the bull id itself. */
export function regionRing(id: TowerRegionId): TowerRing | TowerBullRegionId {
  const separator = id.indexOf(':');
  return separator === -1 ? (id as TowerBullRegionId) : (id.slice(0, separator) as TowerRing);
}

/** `[1,2,3,5]` -> `1–3・5`. Runs of three or more collapse; two in a row stay listed. */
function formatNumbers(values: readonly number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const parts: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    const length = end - index + 1;
    if (length >= 3) {
      parts.push(`${sorted[index]}–${sorted[end]}`);
      index = end + 1;
    } else {
      parts.push(String(sorted[index]));
      index += 1;
    }
  }
  return parts.join('・');
}

/**
 * A short caption for a floor, derived from that floor's regions rather than transcribed by hand.
 *
 * Rings that light the same numbers are named together, so the common "the same numbers in every
 * ring" floors read as one clause instead of four. The board itself is the primary display - this
 * is the line under it, and the accessible name the board is announced by.
 */
export function describeFloorTargets(regions: readonly TowerRegionId[]): string {
  if (regions.length === 0) return '点灯エリアなし';
  if (regions.length === TOWER_REGION_COUNT) return `盤面すべて（${TOWER_REGION_COUNT}エリア）`;

  const byRing = new Map<TowerRing, number[]>();
  const bulls: TowerBullRegionId[] = [];
  for (const id of regions) {
    if (id === 'SB' || id === 'DB') {
      bulls.push(id);
      continue;
    }
    const ring = regionRing(id) as TowerRing;
    const value = regionNumber(id);
    if (value === null) continue;
    const list = byRing.get(ring);
    if (list) list.push(value);
    else byRing.set(ring, [value]);
  }

  // Rings sharing an identical number set collapse into one clause, keeping TOWER_RINGS order.
  const clauses: string[] = [];
  const claimed = new Set<TowerRing>();
  for (const ring of TOWER_RINGS) {
    const values = byRing.get(ring);
    if (!values || claimed.has(ring)) continue;
    const key = [...values].sort((a, b) => a - b).join(',');
    const group = TOWER_RINGS.filter((other) => {
      const otherValues = byRing.get(other);
      return otherValues !== undefined && [...otherValues].sort((a, b) => a - b).join(',') === key;
    });
    for (const member of group) claimed.add(member);
    const names = group.map((member) => TOWER_RING_LABELS[member]).join('・');
    const all = values.length === TOWER_NUMBERS.length;
    clauses.push(`${names} ${all ? `1–${TOWER_NUMBERS.length}` : formatNumbers(values)}`);
  }

  if (bulls.length > 0) {
    clauses.push(
      (['SB', 'DB'] as const).filter((id) => bulls.includes(id)).map((id) => TOWER_BULL_LABELS[id]).join('・'),
    );
  }

  return clauses.join(' / ');
}
