// URL を知っているだけでは書き込めないことの確認（模擬環境）
import { test, expect } from '@playwright/test';
import { adminCall, publishedSample, routeAppsScript, loginSession, fakeGoogle } from './helpers.mjs';

test('運営用 API をログインなし・偽のセッション・違う鍵で直接呼んでも、全操作が拒否されデータは変わらない', async ({ request }) => {
  const detail = await publishedSample(request);
  const before = await (await request.get('/__stats')).json();
  const m = detail.groups[1].matches[5];
  const auths = ['anon', { session: 'f'.repeat(64) }, { eventId: detail.event.id, key: 'f'.repeat(64) }, { adminKey: 'wrong-key-wrong-key-wrong-key' }];
  for (const auth of auths) {
    for (const [action, payload] of [
      ['saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }],
      ['initializeStorage', {}],
      ['eventDetail', { eventId: detail.event.id }],
      ['setStaffPassword', { eventId: detail.event.id, rev: detail.event.rev, password: 'takeover-1234' }],
      ['createEvent', { name: 'x', bestOf: 5, groupCount: 1 }],
    ]) {
      const res = await adminCall(request, action, payload, auth);
      expect(res.ok, `${JSON.stringify(auth)} ${action}`).toBe(false);
      expect(['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'FORBIDDEN']).toContain(res.error.code);
    }
  }
  const after = await (await request.get('/__stats')).json();
  expect(after.dump).toEqual(before.dump);
});

test('Google でログインした主催者は、他の人が作った大会を操作できない', async ({ request }) => {
  const a = await publishedSample(request);
  const authB = await loginSession(request, 'other@example.org');
  const bRes = await adminCall(request, 'createSampleEvent', { publish: true }, authB);
  const b = bRes.data.detail;
  const authA = a.auth;
  const m = b.groups[1].matches[5];
  const res = await adminCall(request, 'saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, authA);
  expect(res.ok).toBe(false);
  expect(res.error.code).toBe('NOT_FOUND');
  const own = await adminCall(request, 'eventDetail', { eventId: a.event.id }, authA);
  expect(own.ok).toBe(true);
});

test('ログインせずに大会の運営画面の URL（v0.4 の運営用 URL を含む）を開くと、ログインの画面だけが出る', async ({ page, request }) => {
  const detail = await publishedSample(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, 'other@example.org');
  await page.goto(`/pages/admin/index.html#e=${detail.event.id}&k=${'a'.repeat(64)}`);
  await expect(page.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  await expect(page.getByText('v0.4 までの「運営用 URL」は使えなくなりました')).toBeVisible();
  await expect(page.locator('.tabs')).toHaveCount(0);
  await expect(page.getByText(detail.event.name)).toHaveCount(0);
  // 他人の Google アカウントでログインしても開けない
  await page.locator('.fake-gsi').click();
  await expect(page.getByRole('heading', { name: 'この大会を運営する権限がありません' })).toBeVisible();
  await expect(page.locator('.tabs')).toHaveCount(0);
  await page.goto('/pages/admin/index.html#e=EVT-BROKEN!!');
  await expect(page.getByRole('heading', { name: 'URL が正しくありません' })).toBeVisible();
});

test('閲覧者用 Web アプリから書き込み・管理用の関数は呼べない', async ({ request }) => {
  await publishedSample(request);
  for (const fn of ['doPost', 'handleAdminRequest_', 'initializeStorage_', 'actionSaveMatchResult_', 'refreshFromSheet_', 'readPublishedEntries_']) {
    const res = await request.post('/rpc/viewer', { data: { fn, args: [{ action: 'createEvent' }] } });
    const body = await res.json();
    expect(body.ok, fn).toBe(false);
  }
});
