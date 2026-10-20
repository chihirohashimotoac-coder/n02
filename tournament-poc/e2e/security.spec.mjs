// 公開 URL を知っているだけでは書き込めないことの確認（模擬環境）
import { test, expect } from '@playwright/test';
import { adminCall, publishedSample } from './helpers.mjs';

test('運営者用 URL に権限のないアカウント・匿名でアクセスしても運営画面は表示されない', async ({ page, request }) => {
  await publishedSample(request);
  for (const as of ['anonymous', 'stranger']) {
    await page.goto(`/admin?as=${as}`);
    await expect(page.getByText('このページは運営者専用です。')).toBeVisible();
    await expect(page.locator('#app')).toHaveCount(0);
  }
});

test('運営者用 API を権限なしで直接呼んでも、全操作が拒否されデータは変わらない', async ({ request }) => {
  const detail = await publishedSample(request);
  const before = await (await request.get('/__stats')).json();
  const m = detail.groups[1].matches[5];
  for (const as of ['anonymous', 'stranger']) {
    for (const [action, payload] of [
      ['createEvent', { name: 'x', bestOf: 5, groupCount: 1 }],
      ['saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }],
      ['initializeStorage', {}],
      ['bootstrap', {}],
    ]) {
      const res = await adminCall(request, action, payload, as);
      expect(res.ok, `${as} ${action}`).toBe(false);
      expect(res.error.code).toBe('FORBIDDEN');
    }
  }
  const after = await (await request.get('/__stats')).json();
  expect(after.dump).toEqual(before.dump);
});

test('閲覧者用 URL から書き込み・管理用の関数は呼べない', async ({ request }) => {
  await publishedSample(request);
  for (const fn of ['adminCall', 'initializeStorage_', 'actionSaveMatchResult_', 'refreshFromSheet_', 'readPublishedEntries_']) {
    const res = await request.post('/rpc/viewer', { data: { fn, args: [{ action: 'createEvent' }] } });
    const body = await res.json();
    expect(body.ok, fn).toBe(false);
  }
});
