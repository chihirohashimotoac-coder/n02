import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import TowerBoard from './TowerBoard';
import { floorRegions } from '../../domain/practice/tower';
import {
  TOWER_NUMBERS,
  TOWER_NUMBER_ORDER,
  TOWER_REGION_IDS,
  type TowerRegionId,
} from '../../domain/practice/towerRegions';

/**
 * The drawing has one job: show exactly the regions a floor lights, and no others. The floors below
 * are the ones where getting it wrong is invisible in a screenshot but wrong in play - an inner
 * single lit next to a dark outer one, a lit bull ring around a dark centre.
 */

afterEach(cleanup);

function drawFloor(floor: number) {
  return render(<TowerBoard regions={floorRegions(floor)} floor={floor} />);
}

function region(id: TowerRegionId): SVGElement {
  const node = document.querySelector(`[data-region="${id}"]`);
  if (!node) throw new Error(`${id} is not drawn`);
  return node as SVGElement;
}

function isLit(id: TowerRegionId): boolean {
  return region(id).classList.contains('is-lit');
}

function litRegions(): string[] {
  return [...document.querySelectorAll('.tower-seg.is-lit')].map(
    (node) => node.getAttribute('data-region') ?? '',
  );
}

describe('the TOWER board', () => {
  it('draws all 82 regions, every floor', () => {
    drawFloor(56);
    for (const id of TOWER_REGION_IDS) expect(region(id)).toBeTruthy();
    expect(document.querySelectorAll('.tower-seg')).toHaveLength(82);
  });

  it('places all 20 numbers, clockwise from 20 at the top', () => {
    drawFloor(1);
    expect([...TOWER_NUMBER_ORDER].sort((a, b) => a - b)).toEqual([...TOWER_NUMBERS]);
    expect(TOWER_NUMBER_ORDER[0]).toBe(20);
    expect(document.querySelectorAll('.tower-board-number')).toHaveLength(20);
  });

  it('lights the whole board on 1F', () => {
    drawFloor(1);
    expect(litRegions()).toHaveLength(82);
    expect(document.querySelectorAll('.tower-seg:not(.is-lit)')).toHaveLength(0);
  });

  it('lights the OUTER single 20 on 56F and leaves the inner one dark', () => {
    drawFloor(56);
    expect(litRegions()).toEqual(['SO:20']);
    expect(isLit('SO:20')).toBe(true);
    expect(isLit('SI:20')).toBe(false);
    expect(isLit('T:20')).toBe(false);
    expect(isLit('D:20')).toBe(false);
  });

  it('lights the INNER single 12 on 81F and leaves the outer one dark', () => {
    drawFloor(81);
    expect(litRegions()).toEqual(['SI:12']);
    expect(isLit('SI:12')).toBe(true);
    expect(isLit('SO:12')).toBe(false);
  });

  it('lights SBULL alone on 99F and DBULL alone on 100F', () => {
    drawFloor(99);
    expect(litRegions()).toEqual(['SB']);
    expect(isLit('SB')).toBe(true);
    expect(isLit('DB')).toBe(false);

    cleanup();
    drawFloor(100);
    expect(litRegions()).toEqual(['DB']);
    expect(isLit('DB')).toBe(true);
    expect(isLit('SB')).toBe(false);
  });

  it('lights exactly the floor’s regions, for every floor on the course', () => {
    for (let floor = 1; floor <= 100; floor += 1) {
      cleanup();
      drawFloor(floor);
      expect(new Set(litRegions()), `${floor}F is drawn wrong`).toEqual(new Set(floorRegions(floor)));
    }
  });

  it('is announced as a picture with the floor’s target as its name', () => {
    drawFloor(81);
    expect(screen.getByRole('img', { name: '81F のお題：内SINGLE 12' })).toBeInTheDocument();
  });

  it('introduces no document-wide SVG ids that another board could collide with', () => {
    // Two boards on one page (the RESULT screen draws its own) must not fight over a mask, clip or
    // gradient id - so there are none at all.
    render(
      <>
        <TowerBoard regions={floorRegions(1)} />
        <TowerBoard regions={floorRegions(100)} />
      </>,
    );
    expect(document.querySelectorAll('svg defs, svg mask, svg clipPath, svg linearGradient, svg filter'))
      .toHaveLength(0);
    expect(document.querySelectorAll('svg [id]')).toHaveLength(0);
  });

  it('offers nothing to click - it is a picture, not an input', () => {
    drawFloor(1);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('.tower-board a, .tower-board button')).toHaveLength(0);
  });
});
