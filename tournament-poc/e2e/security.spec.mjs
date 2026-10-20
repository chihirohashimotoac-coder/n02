// URL を知っているだけでは書き込めないことの確認（模擬環境）
import { test, expect } from '@playwright/test';
import { adminCall, publishedSample, routeAppsScript } from './helpers.mjs';

test('運営用 API を鍵なし・違う鍵で直接呼んでも、全操作が拒否されデータは変わらない', async ({ request }) => {
  const detail = await publishedSample(request);
  const before = await (await request.get('/__stats')).json();
  const m = detail.groups[1].matches[5];
  const auths = ['anon', { eventId: detail.event.id, key: 'f'.repeat(64) }, { adminKey: 'wrong-key-wrong-key-wrong-key' }];
  for (const auth of auths) {
    for (const [action, payload] of [
      ['saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }],
      ['initializeStorage', {}],
      ['eventDetail', { eventId: detail.event.id }],
      ['rotateKey', { eventId: detail.event.id, rev: detail.event.rev }],
    ]) {
      const res = await adminCall(request, action, payload, auth);
      expect(res.ok, `${JSON.stringify(auth)} ${action}`).toBe(false);
      expect(['AUTH_REQUIRED', 'AUTH_INVALID', 'FORBIDDEN']).toContain(res.error.code);
    }
  }
  const after = await (await request.get('/__stats')).json();
  expect(after.dump).toEqual(before.dump);
});

test('ある大会の運営用 URL では、別の大会を操作できない', async ({ request }) => {
  const a = await publishedSample(request);
  const bRes = await adminCall(request, 'createSampleEvent', { publish: true }, 'anon');
  const b = bRes.data.detail;
  const authA = { eventId: a.event.id, key: a.adminKey };
  const m = b.groups[1].matches[5];
  const res = await adminCall(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, authA);
  expect(res.ok).toBe(false);
  expect(res.error.code).toBe('NOT_FOUND');
  const own = await adminCall(request, 'eventDetail', { eventId: a.event.id }, authA);
  expect(own.ok).toBe(true);
});

test('鍵の部分が欠けた運営用 URL を開くと、操作画面は出ずに案内が出る', async ({ page, request }) => {
  const detail = await publishedSample(request);
  await routeAppsScript(page, request);
  await page.goto(`/pages/admin/index.html#e=${detail.event.id}&k=${detail.adminKey.slice(0, 30)}`);
  await expect(page.getByRole('heading', { name: '運営用 URL が正しくありません' })).toBeVisible();
  await expect(page.locator('.tabs')).toHaveCount(0);
});

test('閲覧者用 Web アプリから書き込み・管理用の関数は呼べない', async ({ request }) => {
  await publishedSample(request);
  for (const fn of ['doPost', 'handleAdminRequest_', 'initializeStorage_', 'actionSaveMatchResult_', 'refreshFromSheet_', 'readPublishedEntries_']) {
    const res = await request.post('/rpc/viewer', { data: { fn, args: [{ action: 'createEvent' }] } });
    const body = await res.json();
    expect(body.ok, fn).toBe(false);
  }
});
