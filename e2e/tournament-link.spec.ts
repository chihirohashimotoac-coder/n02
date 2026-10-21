import { expect, test } from '@playwright/test';
import { openFreshApp } from './helpers';

const PORTAL = 'https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/events/';

test.describe('トーナメント・リーグ link on the top screen', () => {
  test('is a plain link to the portal in its own 「大会」 section below the modes, and leaves the modes as they were', async ({ page }) => {
    await openFreshApp(page);
    const link = page.getByRole('link', { name: /トーナメント・リーグ/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', PORTAL);
    // Its own section with its own heading - never one of the mode tiles.
    const section = page.getByRole('region', { name: '大会' });
    await expect(section).toContainText('トーナメント・リーグ');
    expect(await link.evaluate((a) => !!a.closest('.mode-grid, .mode-card'))).toBe(false);
    await expect(page.locator('.mode-grid .mode-card')).toHaveCount(5);
    await expect(page.locator('.mode-card.selected')).toContainText('通常01');
    // Below the mode selection, above the start button.
    const grid = await page.locator('.mode-grid').boundingBox();
    const box = await link.boundingBox();
    const start = await page.getByRole('button', { name: /ゲームを開始/ }).boundingBox();
    expect(box!.y).toBeGreaterThan(grid!.y + grid!.height);
    expect(start!.y).toBeGreaterThan(box!.y + box!.height);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('is reachable by keyboard right after the modes and leaves the page when followed', async ({ page }) => {
    await openFreshApp(page);
    await page.route(`${PORTAL}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>portal</title><h1>portal</h1>' })
    );
    await page.locator('.mode-card[data-mode="practice"]').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /トーナメント・リーグ/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PORTAL);
    // Coming back restores the top screen with nothing lost.
    await page.goBack();
    await expect(page.locator('.mode-card')).toHaveCount(5);
  });
});
