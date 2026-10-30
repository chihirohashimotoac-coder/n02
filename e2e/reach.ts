import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * "Can a person actually get to this control and press it?" - checked the way a person would.
 *
 * toBeVisible() / toBeInViewport() and a card that fits the screen are not enough: a card can sit
 * inside the viewport while overflow:hidden on it (or on any ancestor) cuts off the buttons at its
 * bottom, and Playwright's own click() scrolls things into view by script before it clicks, which
 * hides exactly that. So here:
 *
 *  1. the control's box must be whole after intersecting it with the viewport AND with the clip
 *     box of every ancestor that clips (overflow other than visible);
 *  2. if it is not, the only way to bring it into view is a real input gesture - a mouse wheel on
 *     a pointer device, a touch drag on a touch device - over the area that should scroll. No
 *     scrollIntoView, no scrollTop, no force;
 *  3. at the spot that will be tapped, the control (or something inside it) must be the topmost
 *     element, so nothing painted over it swallows the tap;
 *  4. the tap itself is a real mouse click / touchscreen tap at those coordinates, and the caller
 *     asserts what it did.
 */

export interface ReachReport {
  /** The control's box, after scrolling. */
  box: { x: number; y: number; width: number; height: number };
  /** How many wheel / touch gestures it took (0 = it was already reachable). */
  gestures: number;
}

interface Geometry {
  rect: { left: number; top: number; right: number; bottom: number };
  visible: { left: number; top: number; right: number; bottom: number } | null;
  /** The nearest ancestor that can still scroll towards the control, as a gesture point. */
  scrollPoint: { x: number; y: number } | null;
  /** Which way the control lies: +1 below the visible area, -1 above, 0 inside. */
  direction: number;
}

async function measure(target: Locator): Promise<Geometry> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    // Every ancestor that clips, innermost first. display: contents has no box and clips nothing.
    const clippers: { node: Element; top: number; bottom: number; scrollable: boolean }[] = [];
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clipsX = style.overflowX !== 'visible';
      const clipsY = style.overflowY !== 'visible';
      if ((!clipsX && !clipsY) || style.display === 'contents') continue;
      const box = node.getBoundingClientRect();
      const left = box.left + node.clientLeft;
      const top = box.top + node.clientTop;
      if (clipsX) {
        clip.left = Math.max(clip.left, left);
        clip.right = Math.min(clip.right, left + node.clientWidth);
      }
      if (clipsY) {
        clip.top = Math.max(clip.top, top);
        clip.bottom = Math.min(clip.bottom, top + node.clientHeight);
        const scrollable =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
        clippers.push({ node, top, bottom: top + node.clientHeight, scrollable });
      }
    }
    const visible =
      clip.right > clip.left && clip.bottom > clip.top
        ? {
            left: Math.max(rect.left, clip.left),
            top: Math.max(rect.top, clip.top),
            right: Math.min(rect.right, clip.right),
            bottom: Math.min(rect.bottom, clip.bottom),
          }
        : null;

    // What to scroll: the innermost scroll area that itself cuts the control off. Scrolling an inner
    // list whose own view already shows the control would only move it about, while the card
    // around it is what hides it. Failing that, the innermost scroll area at all.
    const cuts = (c: { top: number; bottom: number }) => rect.bottom > c.bottom + 0.5 || rect.top < c.top - 0.5;
    const chosen = clippers.find((c) => c.scrollable && cuts(c)) ?? clippers.find((c) => c.scrollable) ?? null;
    const reference = chosen && cuts(chosen) ? chosen : clip;
    const direction = rect.bottom > reference.bottom + 0.5 ? 1 : rect.top < reference.top - 0.5 ? -1 : 0;

    // Where a finger / the pointer goes to scroll it: the middle of the part of that scroll area
    // that is actually visible (a nested list can be partly hidden by the card around it).
    let scrollPoint: { x: number; y: number } | null = null;
    if (chosen) {
      const box = chosen.node.getBoundingClientRect();
      const area = { left: box.left, right: box.right, top: Math.max(chosen.top, 0), bottom: Math.min(chosen.bottom, window.innerHeight) };
      for (const outer of clippers.slice(clippers.indexOf(chosen) + 1)) {
        area.top = Math.max(area.top, outer.top);
        area.bottom = Math.min(area.bottom, outer.bottom);
      }
      if (area.bottom > area.top) {
        scrollPoint = { x: Math.round((area.left + area.right) / 2), y: Math.round((area.top + area.bottom) / 2) };
      }
    }
    return {
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      visible,
      scrollPoint,
      direction,
    };
  });
}

function isWhole(geometry: Geometry): boolean {
  const { rect, visible } = geometry;
  if (!visible || rect.right - rect.left < 1 || rect.bottom - rect.top < 1) return false;
  return (
    visible.left <= rect.left + 0.5 &&
    visible.top <= rect.top + 0.5 &&
    visible.right >= rect.right - 0.5 &&
    visible.bottom >= rect.bottom - 0.5
  );
}

/**
 * One real scroll gesture at (x, y): on a touch device a finger put down there and dragged 120px
 * (raw touch events, as the touchscreen sends them), otherwise a mouse wheel notch.
 */
async function scrollGesture(page: Page, x: number, y: number, direction: number, hasTouch: boolean) {
  if (hasTouch && page.context().browser()?.browserType().name() === 'chromium') {
    const session = await page.context().newCDPSession(page);
    const steps = 10;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= steps; step += 1) {
      // Dragging the finger up scrolls the content down, and the other way round.
      const touchY = y - (direction * 120 * step) / steps;
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: touchY }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 120 * direction);
  }
}

/**
 * Measures again once a scroll has come to rest. Wheel and touch scrolling are animated and can
 * take a moment to start, so this waits up to 600ms for movement and then until it stops.
 */
async function settledMeasure(target: Locator, before: Geometry): Promise<Geometry> {
  const same = (a: Geometry, b: Geometry) =>
    Math.abs(a.rect.top - b.rect.top) < 0.1 && Math.abs(a.rect.left - b.rect.left) < 0.1;
  let previous = before;
  let moved = false;
  let still = 0;
  for (let i = 0; i < 60; i += 1) {
    await target.page().waitForTimeout(50);
    const next = await measure(target);
    if (same(next, previous)) {
      still += 1;
      if (moved ? still >= 3 : i >= 12) return next;
    } else {
      moved = true;
      still = 0;
    }
    previous = next;
  }
  return previous;
}

/**
 * Brings `target` into full view using real gestures only, then checks that a tap on it would
 * land on it. Fails - with the measured boxes in the message - if it cannot be reached.
 */
export async function reach(page: Page, target: Locator, testInfo: TestInfo): Promise<ReachReport> {
  const hasTouch = Boolean(testInfo.project.use.hasTouch);
  await expect(target).toBeAttached();
  let gestures = 0;
  let geometry = await measure(target);
  for (; !isWhole(geometry) && gestures < 60; gestures += 1) {
    if (!geometry.scrollPoint || geometry.direction === 0) break;
    await scrollGesture(page, geometry.scrollPoint.x, geometry.scrollPoint.y, geometry.direction, hasTouch);
    const after = await settledMeasure(target, geometry);
    // The gesture moved nothing: whatever should scroll does not.
    if (Math.abs(after.rect.top - geometry.rect.top) < 0.5 && Math.abs(after.rect.left - geometry.rect.left) < 0.5) {
      geometry = after;
      gestures += 1;
      break;
    }
    geometry = after;
  }
  const label = (await target.evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())).slice(0, 40);
  expect(
    isWhole(geometry),
    `「${label}」 is clipped after ${gestures} scroll gesture(s): box ${JSON.stringify(geometry.rect)}, visible ${JSON.stringify(geometry.visible)}`,
  ).toBe(true);

  // Topmost element at the centre and near each corner of the box must be the control itself.
  const covered = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const points = [
      [0.5, 0.5],
      [0.2, 0.25],
      [0.8, 0.25],
      [0.2, 0.75],
      [0.8, 0.75],
    ];
    for (const [fx, fy] of points) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === element || element.contains(hit))) {
        const name = hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'nothing';
        return `${name} at (${Math.round(x)}, ${Math.round(y)})`;
      }
    }
    return null;
  });
  expect(covered, `「${label}」 is covered by ${covered}`).toBeNull();

  const { rect } = geometry;
  return {
    box: { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top },
    gestures,
  };
}

/** Reaches `target` (see reach()) and presses it with a real tap / click at its centre. */
export async function reachAndTap(page: Page, target: Locator, testInfo: TestInfo): Promise<ReachReport> {
  const report = await reach(page, target, testInfo);
  const x = report.box.x + report.box.width / 2;
  const y = report.box.y + report.box.height / 2;
  if (testInfo.project.use.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  return report;
}

/** Whether `target` is whole and on top right now, with no gesture at all. */
export async function expectReachableWithoutScrolling(page: Page, target: Locator, testInfo: TestInfo) {
  const report = await reach(page, target, testInfo);
  expect(report.gestures, 'needed scrolling to reach a control that must be on screen').toBe(0);
  return report;
}
