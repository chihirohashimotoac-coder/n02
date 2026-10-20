// GitHub Pages 用の閲覧ページ（dist/pages）。Google の外から ?format=json を fetch で読む方式の確認
import { test, expect } from '@playwright/test';
import { publishedSample, setFault, expectNoHorizontalOverflow } from './helpers.mjs';

const ENDPOINT = 'https://script.google.com/macros/s/PREVIEW/exec';

/** script.google.com への通信をローカルの /viewer-json に振り替え、送られた Cookie を記録する */
async function routeToPreview(page, request, seen) {
  await page.route(`${ENDPOINT}**`, async (route) => {
    const headers = await route.request().allHeaders();
    seen.push({ url: route.request().url(), cookie: headers.cookie || '' });
    const u = new URL(route.request().url());
    const r = await request.get(`/viewer-json${u.search}`);
    await route.fulfill({ status: r.status(), contentType: r.headers()['content-type'], body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
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
