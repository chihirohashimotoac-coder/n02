// 運営画面（GitHub Pages の /admin/）: 管理者の初期設定 → 誰でも大会を作成 → 運営用 URL で運営 → 公開 → 閲覧ページに反映
import { test, expect } from '@playwright/test';
import { reset, routeAppsScript, expectNoHorizontalOverflow, ADMIN_KEY } from './helpers.mjs';

const SHEET_LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit?usp=sharing';
const ADMIN_PAGE = '/pages/admin/index.html';

test('管理者の初期設定 → 大会作成（ログインなし）→ 運営用 URL → 選手・グループ・対戦カード → 結果の確定・訂正 → 公開 → 閲覧ページ', async ({ page, context, request }, testInfo) => {
  await reset(request, { configured: false });
  const seen = await routeAppsScript(page, request);

  // 1. 管理者: 保存先の設定と初期化
  await page.goto(`${ADMIN_PAGE}#admin`);
  await page.getByLabel('管理者の鍵').fill('wrong-key-wrong-key-wrong-key');
  await page.getByRole('button', { name: '開く' }).click();
  await expect(page.getByText('管理者の鍵が違います。')).toBeVisible();
  await page.getByLabel('管理者の鍵').fill(ADMIN_KEY);
  await page.getByRole('button', { name: '開く' }).click();
  await page.getByPlaceholder('https://docs.google.com/spreadsheets/d/…').fill(SHEET_LINK);
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByText('保存先: Tournament PoC')).toBeVisible();
  await page.getByRole('button', { name: '初期化する' }).click();
  await expect(page.getByRole('heading', { name: 'すべての大会（管理者）' })).toBeVisible();
  await page.getByLabel('閲覧者用 URL').fill('https://example-user.github.io/n02-tournament-viewer/');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();

  // 2. 主催者: ログインなしで大会を作る（管理者の記憶はこのタブだけなので、別のページで開く）
  const org = await context.newPage();
  await routeAppsScript(org, request, seen);
  await org.goto(ADMIN_PAGE);
  await expect(org.getByRole('heading', { name: '大会を主催する' })).toBeVisible();
  await org.getByLabel('大会名').fill('E2E 検証大会');
  await org.getByLabel('開催日（表示用の文字列）').fill('2026/11/03');
  await org.getByLabel('ロビンのグループ数').fill('2');
  await org.getByRole('button', { name: '作成して運営用 URL を発行' }).click();

  // 3. 運営用 URL の発行画面（保存したことを確認するまで先へ進めない）
  await expect(org.getByRole('heading', { name: /運営用 URL/ })).toBeVisible();
  const url = (await org.locator('#issued-url').textContent()).trim();
  expect(url).toMatch(/\/pages\/admin\/index\.html#e=EVT-[A-Z0-9]+&k=[a-f0-9]{64}$/);
  const go = org.getByRole('button', { name: 'この大会の運営画面を開く' });
  await expect(go).toBeDisabled();
  await org.getByLabel('URL をブックマーク、またはメモに保存しました').check();
  await go.click();
  await expect(org.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();
  await expect(org).toHaveURL(url);

  // 4. 選手登録
  await org.getByRole('button', { name: '選手', exact: true }).click();
  await org.getByPlaceholder('1 行に 1 名ずつ入力').fill(['青木', '井上', '上田', '江藤', '小川', '加藤', '木村', '工藤'].join('\n'));
  await org.getByRole('button', { name: '追加', exact: true }).click();
  await expect(org.getByText('登録選手（8 名）')).toBeVisible();

  // 5. グループと対戦カード
  await org.getByRole('button', { name: 'グループ', exact: true }).click();
  await org.getByRole('button', { name: '登録順に自動割当' }).click();
  await expect(org.getByText('割り当てました。').last()).toBeVisible();
  await org.getByRole('button', { name: '全グループの対戦カードを作成' }).click();
  await expect(org.getByText('12 試合を作成しました。').last()).toBeVisible();

  // 6. 結果入力: Best of 5 で 2-1 は確定できない → 進行中 → 3-1 で確定 → 訂正
  await org.getByRole('button', { name: '試合結果' }).click();
  const card = org.locator('.match-editor').first();
  await card.locator('input').nth(0).fill('2');
  await card.locator('input').nth(1).fill('1');
  await card.getByRole('button', { name: '確定' }).click();
  await expect(card.getByText('確定するには、どちらかがちょうど 3 Leg 必要です')).toBeVisible();
  await card.getByRole('button', { name: '進行中として保存' }).click();
  await expect(org.locator('.match-editor').first().locator('.status')).toHaveText('進行中');
  const card2 = org.locator('.match-editor').first();
  await card2.locator('input').nth(0).fill('3');
  await card2.getByRole('button', { name: '確定' }).click();
  await expect(org.getByText('結果を確定しました。').last()).toBeVisible();
  await org.getByRole('button', { name: 'すべての状態' }).click();
  const done = org.locator('.match-editor--final').first();
  await done.getByRole('button', { name: '訂正' }).click();
  const fix = org.locator('.match-editor').first();
  await fix.locator('input').nth(0).fill('1');
  await fix.locator('input').nth(1).fill('3');
  await fix.getByRole('button', { name: '訂正して確定' }).click();
  await expect(org.getByText('結果を確定しました。').last()).toBeVisible();
  const corrected = org.locator('.match-editor--final').first();
  const p2name = (await corrected.locator('.match-editor__player--2 span').textContent()).trim();
  await expect(corrected.locator('.match-editor__winner')).toContainText(`勝者: ${p2name}`);

  // 7. 公開（既定表示は管理者だけの設定なので、主催者には出さない）
  await org.getByRole('button', { name: '大会設定' }).click();
  await expect(org.getByText(/閲覧画面の既定表示にする/)).toHaveCount(0);
  await org.getByLabel('閲覧画面に公開する').check();
  await org.getByLabel('状態').selectOption('running');
  await org.getByRole('button', { name: '保存', exact: true }).click();
  await expect(org.locator('.event-head .badge')).toHaveText('公開中');
  await org.getByRole('button', { name: '進行状況' }).click();
  await expect(org.getByText('確定 1 / 12 試合')).toBeVisible();
  const viewerLink = org.getByRole('link', { name: '閲覧画面を開く' });
  await expect(viewerLink).toHaveAttribute('href', /^https:\/\/example-user\.github\.io\/n02-tournament-viewer\/\?event=EVT-/);
  await expectNoHorizontalOverflow(org);
  await org.screenshot({ path: testInfo.outputPath('admin-progress.png') });

  // 8. 閲覧ページ（GitHub Pages のルート）に反映されている
  const eventId = url.match(/#e=(EVT-[A-Z0-9]+)/)[1];
  const viewer = await context.newPage();
  await routeAppsScript(viewer, request, seen);
  await viewer.goto(`/pages/index.html?event=${eventId}`);
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('E2E 検証大会');
  const vm = viewer.locator('.match--final').first();
  await expect(vm.locator('.match__score')).toHaveText('1-3');
  await expect(vm.locator('.match__player--2 .match__name')).toHaveText(p2name);

  // 9. 運営用 URL の再発行: 新しい URL が表示され、古い URL は使えなくなる
  await org.getByRole('button', { name: '大会設定' }).click();
  await org.getByRole('button', { name: '再発行する' }).click();
  await org.getByRole('button', { name: '本当に再発行' }).click();
  const newUrl = (await org.locator('#issued-url').textContent()).trim();
  expect(newUrl).not.toBe(url);
  await expect(org).toHaveURL(newUrl);
  const stale = await context.newPage();
  await routeAppsScript(stale, request, seen);
  await stale.goto(url);
  await expect(stale.getByRole('heading', { name: 'この運営用 URL は使えません' })).toBeVisible();

  // 10. 管理者は全大会を一覧できる。通信に Cookie を一切送っていない
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.every((s) => s.cookie === '')).toBe(true);
});

test('運営画面: スマートフォン幅でも横スクロールなしで操作できる（サンプル大会・主催者として）', async ({ page, request }, testInfo) => {
  await reset(request, { configured: true });
  await routeAppsScript(page, request);
  // 初期化は管理者の操作
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: 'e2e-init-request-0001', auth: { adminKey: ADMIN_KEY } }) });
  await page.goto(ADMIN_PAGE);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'サンプル大会を作成' }).click();
  await page.getByLabel('URL をブックマーク、またはメモに保存しました').check();
  await page.getByRole('button', { name: 'この大会の運営画面を開く' }).click();
  await expect(page.getByRole('heading', { name: 'サンプル大会（PoC 検証用）' })).toBeVisible();
  for (const tab of ['進行状況', '試合結果', '選手', 'グループ', '大会設定', '履歴']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('admin-matches.png') });
});

test('作成コードが設定されていれば、コードなしでは大会を作れない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await routeAppsScript(page, request);
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: 'e2e-init-request-0002', auth: { adminKey: ADMIN_KEY } }) });
  await request.post('/__set-admin-property', { data: { key: 'CREATE_CODE', value: 'darts-2026' } });
  await page.goto(ADMIN_PAGE);
  await page.getByLabel('大会名').fill('コード確認');
  await page.getByLabel('作成コード（管理者から教えてもらったもの）').fill('wrong');
  await page.getByRole('button', { name: '作成して運営用 URL を発行' }).click();
  await expect(page.getByText(/作成コードが違います/)).toBeVisible();
  await page.getByLabel('作成コード（管理者から教えてもらったもの）').fill('darts-2026');
  await page.getByRole('button', { name: '作成して運営用 URL を発行' }).click();
  await expect(page.locator('#issued-url')).toBeVisible();
});
