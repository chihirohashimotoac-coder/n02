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

test('QR コード: 内容の右に余白がある画面だけ右下に固定表示（余白に収まる大きさ・内容は動かさない・スクロールに追従）、ボタンで拡大表示', async ({ page, request }, testInfo) => {
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
  // 既定の画面（1366 幅・スマートフォン）は内容の右に余白がないので出さない
  await expect(panel).toBeHidden();
  if (testInfo.project.name === 'desktop') {
    const contentBox = () => page.locator('.content').boundingBox();
    const groupsRight = () => page.locator('.group').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
    for (const [width, height, expected] of [[1920, 1080, 200], [1600, 900, 168], [1504, 900, 120]]) {
      await page.setViewportSize({ width, height });
      await expect(panel.locator('svg')).toBeVisible();
      const box = await panel.boundingBox();
      expect(box.width).toBeCloseTo(expected, 0); // 余白に合わせた大きさ（上限 200px）
      // 内容は中央のまま（QR の分だけ左に寄せない）
      const content = await contentBox();
      expect(content.x + content.width / 2).toBeCloseTo(width / 2, 0);
      expect(await groupsRight()).toBeLessThanOrEqual(box.x - 16);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
      await page.screenshot({ path: testInfo.outputPath(`viewer-qr-${width}.png`) });
    }
    // スクロールしても画面上の同じ位置にある
    const before = await panel.boundingBox();
    await page.mouse.wheel(0, 2000);
    await page.waitForFunction(() => window.scrollY > 500);
    const after = await panel.boundingBox();
    expect(after.y).toBeCloseTo(before.y, 0);
    // 縦長の窓（余白なし）・余白が 120px 未満では出さない
    for (const [width, height] of [[1080, 1920], [1500, 900]]) {
      await page.setViewportSize({ width, height });
      await expect(panel).toBeHidden();
    }
    await page.setViewportSize({ width: 1366, height: 768 });
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
