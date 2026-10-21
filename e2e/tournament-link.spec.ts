import { expect, test } from '@playwright/test';
import { openFreshApp } from './helpers';

const PORTAL = 'https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/events/';

test.describe('トーナメント・リーグ link on the top screen', () => {
  test('is a plain link to the portal in the top bar, and leaves the modes as they were', async ({ page }) => {
    await openFreshApp(page);
    const link = page.getByRole('link', { name: /トーナメント・リーグ/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', PORTAL);
    // In the top bar's action slot - never one of the mode tiles.
    expect(await link.evaluate((a) => !!a.closest('.topbar .top-actions'))).toBe(true);
    expect(await link.evaluate((a) => !!a.closest('.mode-grid, .setup-panel'))).toBe(false);
    await expect(page.locator('.mode-grid .mode-card')).toHaveCount(5);
    await expect(page.locator('.mode-card.selected')).toContainText('通常01');
    // It fits inside the bar, clear of the brand, with a comfortable tap target.
    const bar = await page.locator('.topbar').boundingBox();
    const brand = await page.locator('.topbar .brand').boundingBox();
    const box = await link.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(bar!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + bar!.height);
    expect(box!.x).toBeGreaterThanOrEqual(brand!.x + brand!.width);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bar!.x + bar!.width);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('is reachable by keyboard right after the brand and leaves the page when followed', async ({ page }) => {
    await openFreshApp(page);
    await page.route(`${PORTAL}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>portal</title><h1>portal</h1>' })
    );
    await page.locator('.topbar .brand').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /トーナメント・リーグ/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PORTAL);
    // Coming back restores the top screen with nothing lost.
    await page.goBack();
    await expect(page.locator('.mode-card')).toHaveCount(5);
  });

  test('stays on the top screen only: the game screens keep their own top bar', async ({ page }) => {
    await openFreshApp(page);
    await page.getByRole('button', { name: /ゲームを開始/ }).click();
    await expect(page.getByRole('link', { name: /トーナメント・リーグ/ })).toHaveCount(0);
  });
});
