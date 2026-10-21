import { expect, test } from '@playwright/test';
import { openFreshApp } from './helpers';

const PORTAL = 'https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/events/';

test.describe('トーナメント・リーグ link on the top screen', () => {
  test('is a plain link to the portal, outside the mode grid, and leaves the modes as they were', async ({ page }) => {
    await openFreshApp(page);
    const link = page.getByRole('link', { name: /トーナメント・リーグ/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', PORTAL);
    // Its own landmark between the top bar and the setup panel - never one of the mode tiles.
    await expect(page.getByRole('navigation', { name: '大会' })).toContainText('トーナメント・リーグ');
    expect(await link.evaluate((a) => !!a.closest('.mode-grid, .setup-panel'))).toBe(false);
    await expect(page.locator('.mode-grid .mode-card')).toHaveCount(5);
    await expect(page.locator('.mode-card.selected')).toContainText('通常01');
    // The start button is still on the first screen of the setup panel.
    await expect(page.getByRole('button', { name: /ゲームを開始/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('is reachable by keyboard before the modes and leaves the page when followed', async ({ page }) => {
    await openFreshApp(page);
    await page.route(`${PORTAL}**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<title>portal</title><h1>portal</h1>' })
    );
    await page.locator('.brand').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: /トーナメント・リーグ/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PORTAL);
    // Coming back restores the top screen with nothing lost.
    await page.goBack();
    await expect(page.locator('.mode-card')).toHaveCount(5);
  });
});
