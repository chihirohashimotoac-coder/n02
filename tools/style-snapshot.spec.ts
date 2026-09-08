/**
 * Computed-style snapshot tool. NOT part of the test suite - it lives outside e2e/ (playwright's
 * testDir) and makes no assertions; it records what the app actually renders so two builds can be
 * compared.
 *
 * Used to prove that a CSS change is a no-op, which is what the design-token commit needed: the
 * tokens are introduced as aliases of the values already in use, so the rendering must not move.
 *
 *   # before
 *   git stash && npm run build:preview
 *   STYLE_DUMP=/tmp/before.txt npx playwright test --config tools/style-snapshot.config.ts
 *   # after
 *   git stash pop && npm run build:preview
 *   STYLE_DUMP=/tmp/after.txt npx playwright test --config tools/style-snapshot.config.ts
 *   diff /tmp/before.txt /tmp/after.txt
 *
 * It walks every element of 9 screens in all 3 themes and records 29 computed properties plus the
 * layout box of each. Transitions and animations are frozen first: .n01-player-name and .mode-card
 * animate on mount, and an unfrozen dump samples a different frame each run.
 */
import { test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
  enterGameScore,
  openFreshApp,
  openPentathlon,
  openPracticeHub,
  openSingleGame,
  startCountUp,
} from '../e2e/helpers';

const PROPS = [
  'color',
  'backgroundColor',
  'backgroundImage',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'boxShadow',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontVariantNumeric',
  'letterSpacing',
  'lineHeight',
  'padding',
  'margin',
  'width',
  'height',
  'outlineColor',
  'outlineWidth',
  'outlineStyle',
  'outlineOffset',
  'opacity',
];


/** Waits until the theme React has decided on is actually on <html>, so a dump is never racy. */
async function waitForTheme(page: import('@playwright/test').Page, theme: 'clean' | 'neon' | 'navy') {
  await page.waitForFunction(
    (t) => (document.documentElement.dataset.theme ?? 'clean') === t,
    theme,
  );
}

async function applyTheme(page: import('@playwright/test').Page, theme: 'clean' | 'neon' | 'navy') {
  await openFreshApp(page);
  await page.evaluate((t) => localStorage.setItem('n02-theme-v1', t), theme);
  await page.reload();
  await page.waitForSelector('.mode-card');
  await waitForTheme(page, theme);
}

/** Back to the menu without clearing storage, then wait for the theme to be settled again. */
async function settle(page: import('@playwright/test').Page, theme: 'clean' | 'neon' | 'navy') {
  await page.goto('/');
  await page.waitForSelector('.mode-card');
  await waitForTheme(page, theme);
}

/**
 * Kills every transition and animation before a dump. Several elements (.n01-player-name,
 * .mode-card) animate colour and position on mount, so an unfrozen dump samples whatever frame the
 * transition happened to be on and differs run to run - which would drown any real change.
 */
async function freeze(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}',
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function dump(page: import('@playwright/test').Page, label: string, out: string[]) {
  await freeze(page);
  const rows = await page.evaluate((props) => {
    const seen: string[] = [];
    const all = document.querySelectorAll<HTMLElement>('body *');
    all.forEach((el, index) => {
      const cs = getComputedStyle(el);
      const values = props.map((p) => `${p}=${cs[p as keyof CSSStyleDeclaration] as string}`);
      const b = el.getBoundingClientRect();
      seen.push(
        `${index}|${el.tagName}.${el.className}|${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}|${values.join(';')}`,
      );
    });
    return seen;
  }, PROPS);
  out.push(`##### ${label}`, ...rows);
}

test('capture computed styles', async ({ page }) => {
  const out: string[] = [];

  for (const theme of ['clean', 'neon', 'navy'] as const) {
    await applyTheme(page, theme);
    await dump(page, `${theme} top`, out);

    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await page.waitForSelector('.n01-game-shell');
    await enterGameScore(page, 100);
    await enterGameScore(page, 60);
    await dump(page, `${theme} 01-game`, out);

    await page.locator('.n01-menu-table button', { hasText: '☰' }).click();
    await page.waitForSelector('.n01-modal-card');
    await dump(page, `${theme} 01-menu`, out);
    await page.keyboard.press('Escape');

    await page.locator('.n01-menu-table button', { hasText: 'Stats' }).click();
    await page.waitForSelector('.n01-stats-modal');
    await dump(page, `${theme} 01-stats`, out);
    await page.keyboard.press('Escape');

    await applyTheme(page, theme);
    await openPracticeHub(page);
    await dump(page, `${theme} practice-hub`, out);

    await settle(page, theme);
    await startCountUp(page, { players: 2 });
    await dump(page, `${theme} countup`, out);

    await settle(page, theme);
    await openPentathlon(page);
    await dump(page, `${theme} pent-setup`, out);

    await settle(page, theme);
    await openSingleGame(page, 'CRICKET');
    await page.getByRole('button', { name: /を開始/ }).click();
    await page.waitForSelector('.pent-cricket-board');
    await dump(page, `${theme} cricket`, out);

    await settle(page, theme);
    await openSingleGame(page, 'JDA 501');
    await page.getByRole('button', { name: /を開始/ }).click();
    await page.waitForSelector('.pent-x01-shell');
    await dump(page, `${theme} pent-x01`, out);
  }

  writeFileSync(process.env.STYLE_DUMP ?? '/tmp/style-dump.txt', out.join('\n'));
});
