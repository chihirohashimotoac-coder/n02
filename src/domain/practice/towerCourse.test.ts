import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TOWER_COURSE_DIGEST, TOWER_COURSE_FLOORS, TOWER_COURSE_SOURCE } from './towerCourse';
import { floorRegions, floorTargetText, TOWER_RULES, TowerFloorRangeError } from './tower';
import {
  TOWER_REGION_COUNT,
  TOWER_REGION_IDS,
  describeFloorTargets,
  isTowerRegionId,
  type TowerRegionId,
} from './towerRegions';

/**
 * The course is committed data, not something the app derives, so these tests guard the transcript
 * itself: 100 floors, no gaps, no duplicates, nothing outside the 82-region vocabulary, and the
 * floors the handoff bundle calls out as the ones worth checking by eye.
 */
describe('TOWER course data', () => {
  it('is exactly floors 1...100 with no gap and no duplicate', () => {
    expect(TOWER_COURSE_FLOORS).toHaveLength(100);
    expect(TOWER_COURSE_FLOORS[0]).toBe(floorRegions(1));
    expect(TOWER_COURSE_FLOORS[99]).toBe(floorRegions(100));
    for (let floor = 1; floor <= 100; floor += 1) {
      expect(floorRegions(floor).length).toBeGreaterThan(0);
    }
  });

  it('rejects floors off the course rather than returning an empty target', () => {
    expect(() => floorRegions(0)).toThrow(TowerFloorRangeError);
    expect(() => floorRegions(101)).toThrow(TowerFloorRangeError);
    expect(() => floorRegions(1.5)).toThrow(TowerFloorRangeError);
  });

  it('uses only the 82 defined regions, each at most once per floor', () => {
    expect(TOWER_REGION_IDS).toHaveLength(82);
    expect(TOWER_REGION_COUNT).toBe(82);
    expect(new Set(TOWER_REGION_IDS).size).toBe(82);

    for (let floor = 1; floor <= 100; floor += 1) {
      const regions = floorRegions(floor);
      expect(new Set(regions).size, `${floor}F has a duplicate region`).toBe(regions.length);
      for (const id of regions) {
        expect(isTowerRegionId(id), `${floor}F has an unknown region ${id}`).toBe(true);
      }
      expect(regions.length).toBeLessThanOrEqual(82);
    }
  });

  it('keeps every floor in canonical region order, so floors compare by value', () => {
    const rank = new Map(TOWER_REGION_IDS.map((id, index) => [id, index]));
    for (let floor = 1; floor <= 100; floor += 1) {
      const positions = floorRegions(floor).map((id) => rank.get(id) ?? -1);
      expect([...positions].sort((a, b) => a - b), `${floor}F is out of order`).toEqual(positions);
    }
  });

  /**
   * The digest is over the same canonical serialisation the generator hashed, so a hand-edited
   * floor - the one way this file could silently drift from the source transcript - fails here.
   */
  it('still hashes to the digest recorded when it was generated', () => {
    const canonical = TOWER_COURSE_FLOORS.map((regions, index) => `${index + 1}:${regions.join(',')}`).join(
      '\n',
    );
    expect(createHash('sha256').update(canonical).digest('hex')).toBe(TOWER_COURSE_DIGEST);
  });

  it('records the source it was transcribed from', () => {
    expect(TOWER_COURSE_SOURCE.courseId).toBe('home-video-IyVvVmRcmRQ-v1');
    expect(TOWER_COURSE_SOURCE.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  /** The bundle's own spot-check list: the floors that prove the fine distinctions survived. */
  describe('the floors the source bundle calls out', () => {
    it('lights the whole board on 1F', () => {
      expect(floorRegions(1)).toHaveLength(82);
      expect(new Set(floorRegions(1))).toEqual(new Set(TOWER_REGION_IDS));
    });

    it('lights only the OUTER single 20 on 56F', () => {
      expect(floorRegions(56)).toEqual(['SO:20']);
      expect(floorRegions(56)).not.toContain('SI:20');
    });

    it('lights only the INNER single 12 on 81F', () => {
      expect(floorRegions(81)).toEqual(['SI:12']);
      expect(floorRegions(81)).not.toContain('SO:12');
    });

    it('lights only SBULL on 99F and only DBULL on 100F', () => {
      expect(floorRegions(99)).toEqual(['SB']);
      expect(floorRegions(100)).toEqual(['DB']);
    });
  });

  it('never merges inner and outer singles, or the two bulls, across the whole course', () => {
    // If the two singles had been collapsed at import, no floor could ever hold one without the
    // other; the same for the bulls. Both asymmetries have to survive somewhere.
    const splitSingles = TOWER_COURSE_FLOORS.some(
      (regions) => regions.includes('SO:20') !== regions.includes('SI:20'),
    );
    const splitBulls = TOWER_COURSE_FLOORS.some(
      (regions) => regions.includes('SB') !== regions.includes('DB'),
    );
    expect(splitSingles).toBe(true);
    expect(splitBulls).toBe(true);
  });
});

describe('floor captions', () => {
  it('describes the spot-check floors from their regions', () => {
    expect(floorTargetText(1)).toBe('盤面すべて（82エリア）');
    expect(floorTargetText(56)).toBe('外SINGLE 20');
    expect(floorTargetText(81)).toBe('内SINGLE 12');
    expect(floorTargetText(99)).toBe('SBULL');
    expect(floorTargetText(100)).toBe('DBULL');
  });

  it('names rings that share a number set together, and collapses runs', () => {
    expect(describeFloorTargets(['SI:1', 'SI:2', 'SI:3', 'T:1', 'T:2', 'T:3'])).toBe(
      '内SINGLE・TRIPLE 1–3',
    );
    expect(describeFloorTargets(['SI:1', 'SI:2', 'T:5'])).toBe('内SINGLE 1・2 / TRIPLE 5');
    expect(describeFloorTargets(['D:9', 'SB', 'DB'])).toBe('DOUBLE 9 / SBULL・DBULL');
  });

  it('produces a non-empty caption for every floor on the course', () => {
    for (let floor = 1; floor <= 100; floor += 1) {
      expect(floorTargetText(floor).length, `${floor}F has no caption`).toBeGreaterThan(0);
    }
  });

  it('mentions every ring that a floor actually lights', () => {
    for (let floor = 1; floor <= 100; floor += 1) {
      const regions = floorRegions(floor);
      const text = floorTargetText(floor);
      if (text === '盤面すべて（82エリア）') continue;
      const expectations: Array<[string, string]> = [
        ['SI:', '内SINGLE'],
        ['SO:', '外SINGLE'],
        ['T:', 'TRIPLE'],
        ['D:', 'DOUBLE'],
      ];
      for (const [prefix, label] of expectations) {
        if (regions.some((id) => id.startsWith(prefix))) {
          expect(text, `${floor}F caption is missing ${label}`).toContain(label);
        }
      }
      if (regions.includes('SB')) expect(text).toContain('SBULL');
      if (regions.includes('DB')) expect(text).toContain('DBULL');
    }
  });

  it('has nothing to say about an empty region set', () => {
    expect(describeFloorTargets([] as TowerRegionId[])).toBe('点灯エリアなし');
  });
});

describe('recovery floors', () => {
  it('are the multiples of 10 below the top of the tower', () => {
    const recovery: number[] = [];
    for (let floor = 1; floor <= TOWER_RULES.finalFloor; floor += 1) {
      if (floor % TOWER_RULES.recoveryInterval === 0 && floor < TOWER_RULES.finalFloor) {
        recovery.push(floor);
      }
    }
    expect(recovery).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });
});
