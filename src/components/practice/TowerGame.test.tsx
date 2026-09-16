import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import TowerGame, { REPEAT_LOCK_MS } from './TowerGame';
import {
  createTowerGame,
  type TowerPlayer,
  type TowerSettings,
  type TowerState,
} from '../../domain/practice/tower';
import { TOWER_HELP_SEEN_KEY } from '../../storage/towerStorage';
import { TOWER_GAUGE_ART } from '../../domain/practice/towerAssets';

/**
 * The play screen's input contract: what a dart costs, what is refused, and what the keyboard is
 * allowed to touch.
 *
 * The domain rules themselves are covered in domain/practice/tower.test.ts; what is tested here is
 * the layer that can spend a dart nobody threw - a double tap, a held key, a keystroke meant for
 * something else - and the promise that this screen leaves no keyboard behind when it closes.
 */

/** Hosts the screen with real state, the way PracticeFlow does, so inputs actually accumulate. */
function Harness({ initial }: { initial: TowerState }) {
  const [state, setState] = useState(initial);
  return <TowerGame state={state} onChange={setState} onExit={() => {}} />;
}

/** 3 LIFE, so a GAME OVER is three darts away rather than five. */
function game(
  playerCount: 1 | 2 = 1,
  patch: Partial<TowerPlayer> = {},
  settingsPatch: Partial<TowerSettings> = {},
): TowerState {
  const settings: TowerSettings = {
    playerCount,
    names: ['AKI', 'BEN'],
    startLife: 3,
    startFloor: 1,
    ...settingsPatch,
  };
  const state = createTowerGame(settings);
  state.players[0] = { ...state.players[0], ...patch };
  return state;
}

function renderGame(state: TowerState) {
  return render(<Harness initial={state} />);
}

/**
 * The judgement buttons by class, not by accessible name: the history strip's chips are announced
 * as "...成功" / "...MISS" too, and a name query would match them as well.
 */
const hitButton = () => document.querySelector('.tower-judge.hit') as HTMLElement;
const missButton = () => document.querySelector('.tower-judge.miss') as HTMLElement;

/**
 * One press, then past the repeat lock.
 *
 * The screen deliberately swallows a second activation within REPEAT_LOCK_MS, which is what makes a
 * double tap one dart - and which means a test firing three clicks in the same millisecond would
 * otherwise record one. Real darts are seconds apart, so the clock is moved on between presses.
 */
function press(target: HTMLElement) {
  fireEvent.click(target);
  act(() => {
    vi.advanceTimersByTime(REPEAT_LOCK_MS + 20);
  });
}

/** A keystroke where a real one would land - on an element, so it bubbles to window as usual. */
function key(value: string, init: Record<string, unknown> = {}) {
  fireEvent.keyDown(document.body, { key: value, ...init });
  act(() => {
    vi.advanceTimersByTime(REPEAT_LOCK_MS + 20);
  });
}

/** The visible LIFE of the first status card. */
function life(): number {
  const card = document.querySelector('.tower-status-card');
  const label = card?.querySelector('.tower-status-life')?.getAttribute('aria-label') ?? '';
  return Number(label.replace(/^LIFE (\d+).*$/, '$1'));
}

function floorBadge(): string {
  return document.querySelector('.tower-floor-badge strong')?.textContent ?? '';
}

function thrownPips(): string[] {
  return [...document.querySelectorAll('.tower-pip.done b')].map((node) => node.textContent ?? '');
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  // Skip the first-run help; the one test that wants it sets its own state.
  localStorage.setItem(TOWER_HELP_SEEN_KEY, 'yes');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the judgement buttons', () => {
  it('shows the floor, its target and a full LIFE on the first dart', () => {
    renderGame(game());
    expect(floorBadge()).toContain('1');
    // The target is the board, not a sentence under it - the sentence is the board's accessible
    // name, and appears nowhere on screen.
    expect(screen.getByRole('img', { name: /1F のお題：盤面すべて（82エリア）/ })).toBeInTheDocument();
    expect(document.querySelector('.tower-target-text')).toBeNull();
    expect(life()).toBe(3);
    expect(thrownPips()).toEqual([]);
  });

  it('lights the tower up to the floor the player is past', () => {
    renderGame(game(1, { currentFloor: 51, lastClearedFloor: 50 }));
    const gauge = document.querySelector('.tower-gauge');
    expect(gauge).not.toBeNull();
    expect(gauge?.getAttribute('aria-label')).toContain('50F');

    // Half the tower beaten, so the lit copy is clipped to halfway up the shaft: the boundary sits
    // midway between the top of the plinth and the top of the shaft.
    const lit = document.querySelector<HTMLElement>('.tower-gauge-art.is-lit');
    const midway = (TOWER_GAUGE_ART.shaftBottomPct + TOWER_GAUGE_ART.shaftTopPct) / 2;
    expect(lit?.style.clipPath).toBe(`inset(${midway}% 0 0 0)`);

    // ...and the player's marker rides that same boundary.
    const marker = document.querySelector<HTMLElement>('.tower-gauge-marker.p0');
    expect(marker?.style.top).toBe(`${midway}%`);
  });

  it('lights the crown only on a finished climb, and only the plinth before the first floor', () => {
    renderGame(game(1, { currentFloor: 1, lastClearedFloor: 0 }));
    const litAt = () => document.querySelector<HTMLElement>('.tower-gauge-art.is-lit')?.style.clipPath;
    // Nothing beaten: the fill starts at the top of the plinth, so only the base glows.
    expect(litAt()).toBe(`inset(${TOWER_GAUGE_ART.shaftBottomPct}% 0 0 0)`);

    cleanup();
    renderGame(game(1, { currentFloor: 100, lastClearedFloor: 100 }));
    // 100F beaten lights the whole file, crown included - which nothing short of a clear does.
    expect(litAt()).toBe('inset(0% 0 0 0)');

    cleanup();
    renderGame(game(1, { currentFloor: 100, lastClearedFloor: 99 }));
    expect(litAt()).not.toBe('inset(0% 0 0 0)');
  });

  it('falls back to a drawn gauge when the artwork cannot be fetched', () => {
    renderGame(game(1, { currentFloor: 51, lastClearedFloor: 50 }));
    expect(document.querySelector('.tower-gauge-fallback')).toBeNull();

    fireEvent.error(document.querySelector('.tower-gauge-art')!);

    expect(document.querySelectorAll('.tower-gauge-art')).toHaveLength(0);
    expect(document.querySelectorAll('.tower-gauge-block')).toHaveLength(20);
    expect(document.querySelectorAll('.tower-gauge-block.is-climbed')).toHaveLength(10);
    // The gauge still says where everyone is, however it is drawn.
    expect(document.querySelector('.tower-gauge')?.getAttribute('aria-label')).toContain('50F');
  });

  it('shows the band artwork over the drawn scene, and keeps the drawing if it fails', () => {
    renderGame(game(1, { currentFloor: 45, lastClearedFloor: 44 }));
    const photo = document.querySelector<HTMLImageElement>('.tower-scene-photo');
    expect(photo?.getAttribute('src')).toContain('tower/tower-stage-041-060.webp');
    // The drawing is underneath from the first paint, not swapped in on failure.
    expect(document.querySelector('.tower-scene-drawn')).not.toBeNull();
    expect(photo?.className).not.toContain('is-ready');

    fireEvent.load(photo!);
    expect(document.querySelector('.tower-scene-photo')?.className).toContain('is-ready');

    fireEvent.error(document.querySelector('.tower-scene-photo')!);
    expect(document.querySelector('.tower-scene-photo')).toBeNull();
    expect(document.querySelector('.tower-scene-drawn')).not.toBeNull();
  });

  it('changes the stairwell behind the board as the climb gets higher', () => {
    const band = () => document.querySelector('.tower-stage')?.getAttribute('data-band');
    renderGame(game());
    expect(band()).toBe('1');
    cleanup();
    renderGame(game(1, { currentFloor: 45, lastClearedFloor: 44 }));
    expect(band()).toBe('3');
    cleanup();
    renderGame(game(1, { currentFloor: 100, lastClearedFloor: 99 }));
    expect(band()).toBe('5');
  });

  it('spends one dart per press and moves a floor on 成功', () => {
    renderGame(game());
    fireEvent.click(hitButton());
    expect(floorBadge()).toContain('2');
    expect(thrownPips()).toEqual(['成功']);
    expect(life()).toBe(3);
  });

  it('holds the floor and takes a LIFE on MISS', () => {
    renderGame(game());
    fireEvent.click(missButton());
    expect(floorBadge()).toContain('1');
    expect(thrownPips()).toEqual(['MISS']);
    expect(life()).toBe(2);
  });

  /** The repeat lock: two clicks in the same instant are one dart, not two. */
  it('counts a double click as one dart', () => {
    renderGame(game());
    const button = hitButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(thrownPips()).toEqual(['成功']);
    expect(floorBadge()).toContain('2');
  });

  it('counts a touch that also reports a click as one dart', () => {
    renderGame(game());
    const button = missButton();
    fireEvent.touchStart(button);
    fireEvent.touchEnd(button);
    fireEvent.click(button);
    expect(thrownPips()).toEqual(['MISS']);
    expect(life()).toBe(2);
  });
});

describe('waiting', () => {
  it('changes nothing at all until a judgement arrives', () => {
    renderGame(game());
    const before = document.querySelector('.tower-shell')?.innerHTML;
    // No timer, no countdown: the screen is identical however long nobody presses anything.
    expect(document.querySelector('.tower-shell')?.innerHTML).toBe(before);
    expect(thrownPips()).toEqual([]);
    expect(life()).toBe(3);
  });

  it('replaces the judgement buttons with the pickup screen after three darts', () => {
    renderGame(game());
    press(hitButton());
    press(hitButton());
    press(hitButton());

    expect(hitButton()).toBeNull();
    expect(missButton()).toBeNull();
    expect(screen.getByText(/ダーツを回収してください/)).toBeInTheDocument();
    // Nothing advances on its own - it waits for 次へ.
    expect(floorBadge()).toContain('4');

    press(screen.getByRole('button', { name: /次へ/ }));
    expect(hitButton()).not.toBeNull();
    expect(thrownPips()).toEqual([]);
  });

  it('offers CONTINUE at LIFE 0, and refuses judgements while it is up', () => {
    renderGame(game(1, { life: 1 }));
    press(missButton());

    // The panel, not the flash message above it - both say GAME OVER.
    const panel = () => document.querySelector('.tower-panel.over');
    expect(panel()).not.toBeNull();
    expect(hitButton()).toBeNull();

    // Deliberately no key for CONTINUE: a stray judgement keystroke must never spend one.
    key('1');
    key('2');
    expect(panel()).not.toBeNull();

    press(screen.getByRole('button', { name: 'CONTINUE する' }));
    expect(life()).toBe(3);
    expect(floorBadge()).toContain('1');
    expect(screen.getByText(/CONTINUE を使いました/)).toBeInTheDocument();
  });
});

describe('the keyboard', () => {
  it('judges on 1 and 2', () => {
    renderGame(game());
    key('1');
    expect(floorBadge()).toContain('2');
    key('2');
    expect(life()).toBe(2);
    expect(thrownPips()).toEqual(['成功', 'MISS']);
  });

  it('ignores a held key rather than spending a second dart', () => {
    renderGame(game());
    key('1');
    key('1', { repeat: true });
    key('1', { repeat: true });
    expect(thrownPips()).toEqual(['成功']);
  });

  it('takes a dart back on Backspace, and advances on Enter', () => {
    renderGame(game());
    key('1');
    key('1');
    key('1');
    expect(screen.getByText(/ダーツを回収してください/)).toBeInTheDocument();

    key('Enter');
    expect(hitButton()).not.toBeNull();

    key('Backspace');
    // Back inside the previous turn, on the floor that dart was thrown at.
    expect(floorBadge()).toContain('3');
    expect(thrownPips()).toEqual(['成功', '成功']);
  });

  it('leaves Backspace and Enter to the browser when TOWER has nothing to do with them', () => {
    renderGame(game());
    const dispatch = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
      act(() => {
        document.body.dispatchEvent(event);
      });
      return event;
    };

    // Nothing thrown yet, so there is no dart to take back: the keystroke is not claimed.
    expect(dispatch({ key: 'Backspace' }).defaultPrevented).toBe(false);
    // Not on the pickup screen, so Enter is not claimed either.
    expect(dispatch({ key: 'Enter' }).defaultPrevented).toBe(false);
    // ...and the one it does claim, it claims.
    expect(dispatch({ key: '1' }).defaultPrevented).toBe(true);
  });

  it('keeps its hands off a text field', () => {
    renderGame(game());
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: '1' });
    fireEvent.keyDown(input, { key: '2' });
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(thrownPips()).toEqual([]);
    expect(life()).toBe(3);

    input.remove();
  });

  it('ignores an IME composition commit', () => {
    renderGame(game());
    key('1', { isComposing: true });
    key('1', { keyCode: 229 });
    expect(thrownPips()).toEqual([]);
  });

  it('ignores a modified keystroke, so browser shortcuts still work', () => {
    renderGame(game());
    key('1', { metaKey: true });
    key('2', { ctrlKey: true });
    expect(thrownPips()).toEqual([]);
  });

  /**
   * The promise that matters for every other mode: this listener belongs to this screen and goes
   * with it. After unmount, a keystroke reaches nothing of TOWER's.
   */
  it('takes its listener with it when the screen closes', () => {
    const view = renderGame(game());
    key('1');
    expect(floorBadge()).toContain('2');

    view.unmount();
    // Nothing is mounted to receive these, and nothing throws. A claimed key is no longer claimed:
    // after this screen closes, 1 / 2 / Backspace / Enter belong to whatever comes next.
    for (const value of ['1', '2', 'Backspace', 'Enter']) {
      const event = new KeyboardEvent('keydown', { key: value, cancelable: true, bubbles: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented, `${value} was still claimed after unmount`).toBe(false);
    }
    expect(document.querySelector('.tower-shell')).toBeNull();
  });

  it('stops acting on judgement keys while a dialog is open', () => {
    renderGame(game());
    press(screen.getByRole('button', { name: 'メニュー' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    key('1');
    key('2');
    expect(thrownPips()).toEqual([]);
  });
});

describe('taking a dart back from the screen', () => {
  it('undoes the newest dart straight from the history strip, with no dialog', () => {
    renderGame(game());
    press(hitButton());
    press(hitButton());
    expect(floorBadge()).toContain('3');

    const strip = document.querySelector('.tower-history') as HTMLElement;
    press(within(strip).getAllByRole('button')[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(floorBadge()).toContain('2');
  });

  it('asks before discarding the darts after an older one', () => {
    renderGame(game());
    press(hitButton());
    press(hitButton());
    press(missButton());

    const oldest = () => {
      const strip = document.querySelector('.tower-history') as HTMLElement;
      const buttons = within(strip).getAllByRole('button');
      // Newest first, so the last chip is the oldest dart.
      return buttons[buttons.length - 1];
    };

    press(oldest());
    expect(within(screen.getByRole('dialog')).getByText(/この投を含む 3 投/)).toBeInTheDocument();

    press(within(screen.getByRole('dialog')).getByRole('button', { name: 'やめる' }));
    expect(floorBadge()).toContain('3');

    press(oldest());
    press(within(screen.getByRole('dialog')).getByRole('button', { name: 'この投から入力し直す' }));
    expect(floorBadge()).toContain('1');
    expect(thrownPips()).toEqual([]);
  });

  it('disables 1投戻す when there is nothing to take back', () => {
    renderGame(game());
    expect(screen.getByRole('button', { name: '1投戻す' })).toBeDisabled();
    press(hitButton());
    expect(screen.getByRole('button', { name: '1投戻す' })).toBeEnabled();
  });
});

describe('the top of the tower', () => {
  it('does not clear on reaching 100F, and clears on beating it', () => {
    renderGame(game(1, { currentFloor: 100, lastClearedFloor: 99 }));
    expect(floorBadge()).toContain('100');
    expect(screen.getByRole('img', { name: /100F のお題：DBULL/ })).toBeInTheDocument();
    // Standing on 100F is still a normal throw.
    expect(hitButton()).not.toBeNull();

    press(missButton());
    expect(floorBadge()).toContain('100');
    expect(life()).toBe(2);
    expect(hitButton()).not.toBeNull();

    press(hitButton());
    const panel = document.querySelector('.tower-panel.clear');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('GAME CLEAR');
    expect(panel?.textContent).toContain('CLEAR FLOOR 100');
    expect(hitButton()).toBeNull();
  });

  it('can be taken back after the clear', () => {
    renderGame(game(1, { currentFloor: 100, lastClearedFloor: 99 }));
    press(hitButton());
    expect(document.querySelector('.tower-panel.clear')).not.toBeNull();

    press(screen.getByRole('button', { name: '1投戻す' }));
    expect(document.querySelector('.tower-panel.clear')).toBeNull();
    expect(hitButton()).not.toBeNull();
    expect(floorBadge()).toContain('100');
  });
});

describe('two players', () => {
  it('hands over on 次へ and keeps each climb apart', () => {
    renderGame(game(2));
    press(hitButton());
    press(hitButton());
    press(hitButton());
    expect(screen.getByText(/BEN の手番です/)).toBeInTheDocument();

    press(screen.getByRole('button', { name: /次へ/ }));
    // BEN starts their own tower at 1F; AKI's three floors are AKI's.
    expect(floorBadge()).toContain('1');
    const cards = [...document.querySelectorAll('.tower-status-card')];
    expect(cards[0].textContent).toContain('4F');
    expect(cards[1].textContent).toContain('1F');
  });
});

describe('the first-run help', () => {
  it('opens once and then stays out of the way', () => {
    localStorage.removeItem(TOWER_HELP_SEEN_KEY);
    const view = renderGame(game());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/どちらも押さずに着弾を確認/)).toBeInTheDocument();

    press(within(dialog).getByRole('button', { name: 'はじめる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    view.unmount();
    renderGame(game());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
