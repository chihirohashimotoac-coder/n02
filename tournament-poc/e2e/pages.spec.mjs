// GitHub Pages 用の閲覧ページ（dist/pages）。Google の外から ?format=json を fetch で読む方式の確認
import { test, expect } from '@playwright/test';
import { publishedSample, setFault, expectNoHorizontalOverflow, routeAppsScript, VIEWER_ENDPOINT } from './helpers.mjs';

const ENDPOINT = VIEWER_ENDPOINT;

async function routeToPreview(page, request, seen) {
  await routeAppsScript(page, request, seen);
}

test('Google にログインしていても（Cookie があっても）送らずに表示する。CSP 違反なし', async ({ page, context, request }) => {
  await publishedSample(request);
  // 複数アカウントでログインしているブラウザを模して、google.com の Cookie を入れておく
  await context.addCookies([{ name: 'SID', value: 'logged-in-account', domain: '.google.com', path: '/', secure: true, sameSite: 'None' }]);
  const seen = [];
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text());
  });
  await routeToPreview(page, request, seen);
  await page.goto('/pages/index.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('サンプル大会（PoC 検証用）');
  await expect(page.locator('.match')).toHaveCount(24);
  await expect(page.locator('.win-mark')).toHaveCount(12);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen[0].url).toBe(`${ENDPOINT}?format=json`);
  expect(seen.every((s) => s.cookie === '')).toBe(true);
  expect(violations).toEqual([]);
  await expectNoHorizontalOverflow(page);
});

test('?event= で大会を指定でき、通信失敗時は再試行して復旧する', async ({ page, request }) => {
  const detail = await publishedSample(request);
  const seen = [];
  await routeToPreview(page, request, seen);
  await page.goto(`/pages/index.html?event=${detail.event.id}&interval=15`);
  await expect(page.locator('.match')).toHaveCount(24);
  expect(seen[0].url).toContain(`event=${detail.event.id}`);
  await setFault(request, 'viewer', 'fail');
  await expect(page.locator('#banner')).toContainText('更新に失敗しました', { timeout: 30_000 });
  await expect(page.locator('.match')).toHaveCount(24);
  await setFault(request, 'viewer', 'ok');
  await expect(page.locator('#banner')).toBeHidden({ timeout: 30_000 });
  // 2 回目以降は版番号を送り、変化がなければ本体を受け取らない
  expect(seen.some((s) => s.url.includes('known='))).toBe(true);
});

test('QR コード: 広い画面は右下に固定表示（スクロールしても追従・内容と重ならない）、狭い画面はボタンで拡大表示', async ({ page, request }, testInfo) => {
  const detail = await publishedSample(request);
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text());
  });
  await routeAppsScript(page, request);
  await page.goto(`/pages/index.html?event=${detail.event.id}`);
  await expect(page.locator('.match')).toHaveCount(24);
  const url = new URL(`/pages/index.html?event=${detail.event.id}`, page.url()).href;
  const panel = page.locator('#qr-panel');
  const wide = page.viewportSize().width >= 1100;
  if (wide) {
    await expect(panel.locator('svg')).toBeVisible();
    const before = await panel.boundingBox();
    await page.mouse.wheel(0, 2000);
    await page.waitForFunction(() => window.scrollY > 500);
    const after = await panel.boundingBox();
    expect(after.y).toBeCloseTo(before.y, 0); // 画面上の同じ位置にある
    // どのグループの枠とも重ならない
    const groups = await page.locator('.group').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
    expect(Math.max(...groups)).toBeLessThanOrEqual(after.x);
    await page.screenshot({ path: testInfo.outputPath('viewer-qr.png') });
  } else {
    await expect(panel).toBeHidden();
  }
  // ボタンで拡大表示（スマートフォンで他の人に見せる用）
  await page.getByRole('button', { name: 'QR コード' }).click();
  const overlay = page.getByRole('dialog', { name: 'この大会の QR コード' });
  await expect(overlay.locator('svg')).toBeVisible();
  await expect(page.locator('#qr-overlay-url')).toHaveText(url);
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expectNoHorizontalOverflow(page);
  expect(violations).toEqual([]);

  // ?qr=0 なら固定表示しない
  await page.goto(`/pages/index.html?event=${detail.event.id}&qr=0`);
  await expect(page.locator('.match')).toHaveCount(24);
  await expect(panel).toBeHidden();
});
