// 閲覧画面の表示・自動更新・通信失敗時の表示
import { test, expect } from '@playwright/test';
import { adminCall, publishedSample, reset, setFault, expectNoHorizontalOverflow } from './helpers.mjs';

test('サンプル大会: 大会名・4 グループ・対戦・Leg 数・状態・勝者・更新時刻を表示する', async ({ page, request }, testInfo) => {
  await publishedSample(request);
  await page.goto('/viewer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('サンプル大会（PoC 検証用）');
  await expect(page.locator('.group')).toHaveCount(4);
  await expect(page.locator('.match')).toHaveCount(24);
  await expect(page.locator('.match--final')).toHaveCount(12);
  await expect(page.locator('.match--live')).toHaveCount(2);
  await expect(page.locator('.match--scheduled')).toHaveCount(10);
  await expect(page.locator('.win-mark')).toHaveCount(12);
  // 進行中・未開始には勝者を出さない
  await expect(page.locator('.match--live .win-mark')).toHaveCount(0);
  await expect(page.locator('.match--scheduled .match__score').first()).toHaveText('–-–');
  await expect(page.locator('.match--live .match__score').first()).toHaveText(/\d-\d/);
  await expect(page.locator('#updated-at')).not.toHaveText('—');
  await expect(page.locator('#fetched-at')).not.toHaveText('—');
  await expect(page.locator('#next-refresh')).toHaveText(/約 \d+ 秒後/);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('viewer.png'), fullPage: true });

  // グループの絞り込み
  await page.getByRole('button', { name: 'グループB' }).click();
  await expect(page.locator('.group')).toHaveCount(1);
  await page.getByRole('button', { name: 'すべて' }).click();
  await expect(page.locator('.group')).toHaveCount(4);
});

test('公開中の大会がないときは案内を表示し、公開されたら自動更新で表示される', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await page.goto('/viewer?interval=15');
  await expect(page.locator('#message')).toHaveText('現在公開中の大会はありません。');
  await adminCall(request, 'createSampleEvent', { publish: true });
  await request.post('/__expire-viewer-cache');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('サンプル大会（PoC 検証用）', { timeout: 30_000 });
});

test('通信失敗: 表示中のデータを残して警告し、自動で再試行して復旧する', async ({ page, request }) => {
  await publishedSample(request);
  await page.goto('/viewer?interval=15');
  await expect(page.locator('.match')).toHaveCount(24);
  await setFault(request, 'viewer', 'fail');
  await expect(page.locator('#banner')).toContainText('更新に失敗しました（1 回目）', { timeout: 30_000 });
  await expect(page.locator('.match')).toHaveCount(24); // 古いデータは消さない
  await expect(page.locator('#banner')).toContainText('（2 回目）', { timeout: 15_000 });
  await setFault(request, 'viewer', 'ok');
  await expect(page.locator('#banner')).toBeHidden({ timeout: 30_000 });
});

test('初回から通信できないときはエラーを表示し、再試行で表示される', async ({ page, request }) => {
  await publishedSample(request);
  await setFault(request, 'viewer', 'fail');
  await page.goto('/viewer');
  await expect(page.locator('#message')).toContainText('データを取得できませんでした');
  await expect(page.locator('#banner')).toContainText('通信エラー');
  await setFault(request, 'viewer', 'ok');
  await expect(page.locator('.match')).toHaveCount(24, { timeout: 30_000 });
  await expect(page.locator('#message')).toBeHidden();
});

test('選手名に HTML を含めても文字列として表示する（スクリプトは実行されない）', async ({ page, request }) => {
  const detail = await publishedSample(request);
  const p = detail.players[0];
  const evil = '<img src=x onerror="window.__xss=1">';
  const res = await adminCall(request, 'updatePlayer', { playerId: p.id, rev: p.rev, name: evil });
  expect(res.ok).toBe(true);
  await page.goto('/viewer');
  await expect(page.locator('.summary tbody th').first()).toHaveText(evil);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('.groups img').count()).toBe(0);
});
