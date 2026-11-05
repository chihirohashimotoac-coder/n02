// 整合性の診断（管理者だけ・読み取りだけ）: 管理者のホームの「データの点検」で、問題なし・問題ありの一覧を表示する
import { test, expect } from '@playwright/test';
import { reset, adminCall, routeAppsScript, expectNoHorizontalOverflow, ADMIN_KEY, ADMIN_ENDPOINT } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

async function openAdminHome(page, request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await adminCall(request, 'createSampleEvent', { publish: true });
  await routeAppsScript(page, request);
  await page.goto(`${ADMIN_PAGE}#admin`);
  await page.getByLabel('管理者の鍵').fill(ADMIN_KEY);
  await page.getByRole('button', { name: '開く' }).click();
  await expect(page.getByRole('heading', { name: 'データの点検（読み取りだけ）' })).toBeVisible();
}

test('正常なデータ: 「問題は見つかりませんでした」。点検してもシートの行は変わらない', async ({ page, request }) => {
  await openAdminHome(page, request);
  const before = await adminCall(request, 'diagnoseStorage');
  await page.getByRole('button', { name: '点検する' }).click();
  await expect(page.locator('#diagnose [role="status"]')).toContainText('問題は見つかりませんでした。');
  await expect(page.getByRole('button', { name: 'もう一度点検する' })).toBeVisible();
  const after = await adminCall(request, 'diagnoseStorage');
  expect(after.data.counts).toEqual(before.data.counts);
  await expectNoHorizontalOverflow(page);
});

test('問題がある: 件数と種類を示し、一覧の表は表の中だけが横にスクロールする', async ({ page, request }) => {
  await openAdminHome(page, request);
  // 点検の応答だけを、問題のある結果に差し替える（シートを壊さずに画面の表示を確かめる）
  await page.route(ADMIN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (body.action !== 'diagnoseStorage') return route.fallback();
    const issues = [
      { kind: 'orphan_event', label: '大会がない行', sheet: 'Players', id: 'PLY-ORPHAN-0001', eventId: 'EVT-GONE-0001', detail: 'Players の行の大会（EVT-GONE-0001）が Events にありません。' },
      { kind: 'bracket_mismatch', label: '勝ち上がりの不一致', sheet: 'Matches', id: 'MCH-0001', eventId: 'EVT-0001', detail: '勝者（PLY-0001）が行き先の試合（MCH-0003）の枠 1 にいません（PLY-0002）。' },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true, data: { checkedAt: new Date().toISOString(), counts: {}, kinds: [{ kind: 'orphan_event', label: '大会がない行', count: 1 }, { kind: 'bracket_mismatch', label: '勝ち上がりの不一致', count: 1 }], issues, total: 2, truncated: false } }),
    });
  });
  await page.getByRole('button', { name: '点検する' }).click();
  await expect(page.locator('#diagnose [role="status"]')).toContainText('2 件の問題があります（大会がない行 1・勝ち上がりの不一致 1）');
  await expect(page.locator('.diagnose-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.diagnose-table')).toContainText('PLY-ORPHAN-0001');
  await expectNoHorizontalOverflow(page);
});
