// 運営画面（GitHub Pages の /admin/）: 管理者の初期設定 → Google でログインして大会を作成・運営 → 公開 → 閲覧ページに反映 → 管理パスワードでスタッフが運営
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { reset, routeAppsScript, expectNoHorizontalOverflow, publishedSample, ADMIN_KEY, fakeGoogle, googleLogin, ORGANIZER } from './helpers.mjs';

const SHEET_LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit?usp=sharing';
const ADMIN_PAGE = '/pages/admin/index.html';

test('管理者の初期設定 → Google でログインして大会作成 → 選手・グループ・対戦カード → 結果の確定・訂正 → 公開 → 閲覧ページ → 管理パスワードでスタッフが運営', async ({ page, context, browser, request }, testInfo) => {
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

  // 2. 主催者: Google でログインして大会を作る（管理者の記憶はこのタブだけなので、別のページで開く）
  const org = await context.newPage();
  await routeAppsScript(org, request, seen);
  await fakeGoogle(org, request, ORGANIZER);
  await org.goto(ADMIN_PAGE);
  await expect(org.getByRole('heading', { name: '大会を主催する' })).toBeVisible();
  await expect(org.getByLabel('大会名')).toHaveCount(0); // ログインするまで作成フォームは出ない
  await googleLogin(org);
  await expect(org.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  await expect(org.locator('#actor')).toContainText(ORGANIZER);
  await org.getByLabel('大会名').fill('E2E 検証大会');
  await org.getByLabel('開催日（表示用の文字列）').fill('2026/11/03');
  await org.getByLabel('ロビンのグループ数').fill('2');
  await org.getByRole('button', { name: '大会を作成', exact: true }).click();

  // 3. 作った大会の運営画面が開く。URL には大会 ID だけが入る（秘密の鍵は入らない）
  await expect(org.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();
  await expect(org).toHaveURL(/\/pages\/admin\/index\.html#e=EVT-[A-Z0-9]+$/);
  const url = org.url();

  // 4. 選手登録
  await org.getByRole('button', { name: '選手', exact: true }).click();
  await org.getByPlaceholder('1 行に 1 名ずつ入力').fill(['青木', '井上', '上田', '江藤', '小川', '加藤', '木村', '工藤'].join('\n'));
  await org.getByRole('button', { name: '追加', exact: true }).click();
  await expect(org.getByText('登録選手（8 名）')).toBeVisible();

  // 5. グループと対戦カード
  await org.getByRole('button', { name: '組み合わせ', exact: true }).click();
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
  // 閲覧ページの QR コード（画面表示・PNG 保存）
  const share = org.locator('.qr-share');
  await expect(share.locator('svg')).toBeVisible();
  await expect(share.locator('.qr-share__url')).toHaveText(await viewerLink.getAttribute('href'));
  const [download] = await Promise.all([org.waitForEvent('download'), share.getByRole('button', { name: '画像（PNG）で保存' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^qr-EVT-[A-Z0-9]+\.png$/);
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

  // 9. 管理パスワード: 主催者が設定し、店舗スタッフは別の端末で URL とパスワードから運営できる
  await org.getByRole('button', { name: '大会設定' }).click();
  await expect(org.locator('#event-url')).toHaveText(url);
  await org.getByLabel('管理パスワード（8〜64 文字・空白なし）').fill('short');
  await org.getByRole('button', { name: '設定する' }).click();
  await expect(org.getByText(/8〜64 文字で設定してください/).last()).toBeVisible();
  await org.getByLabel('管理パスワード（8〜64 文字・空白なし）').fill('Shop-2026-pass');
  await org.getByRole('button', { name: '設定する' }).click();
  await expect(org.getByText(/管理パスワード: 設定済み/)).toBeVisible();

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await routeAppsScript(staff, request, seen);
  await staff.goto(url);
  await expect(staff.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  await staff.getByLabel('管理パスワード').fill('wrong-password');
  await staff.getByRole('button', { name: '開く' }).click();
  await expect(staff.getByText('大会または管理パスワードが違います。')).toBeVisible();
  await staff.getByLabel('管理パスワード').fill('Shop-2026-pass');
  await staff.getByRole('button', { name: '開く' }).click();
  await expect(staff.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();
  await expect(staff.locator('#actor')).toContainText('スタッフ');
  await staff.getByRole('button', { name: '大会設定' }).click();
  await expect(staff.getByText('管理パスワードの変更は、大会を作った主催者だけが行えます。')).toBeVisible();
  // 再読み込みしてもログインを覚えている（大会当日に店舗の端末で開き直せる）
  await staff.reload();
  await expect(staff.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();
  // 主催者がパスワードを変えると、スタッフの画面はログインし直しになる
  await org.getByLabel('新しい管理パスワード（8〜64 文字・空白なし）').fill('Shop-2026-pass-v2');
  await org.getByRole('button', { name: '変更する' }).click();
  await expect(org.getByText(/以前のパスワードで開いているスタッフの画面/).last()).toBeVisible();
  await staff.getByRole('button', { name: '進行状況' }).click();
  await staff.reload();
  await expect(staff.getByRole('heading', { name: 'この大会の運営画面を開く' })).toBeVisible();
  await expect(staff.getByText(/有効期限が切れたか、管理パスワードが変更されました/)).toBeVisible();
  await staffContext.close();

  // 10. 管理者は全大会を一覧できる。通信に Cookie を一切送っていない
  await page.reload();
  await expect(page.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();
  await expect(page.locator('.event-card').first()).toContainText(ORGANIZER);
  await expect(page.locator('.event-card').first()).toContainText('管理パスワード設定済み');
  expect(seen.length).toBeGreaterThan(10);
  expect(seen.every((s) => s.cookie === '')).toBe(true);
});

test('運営画面: スマートフォン幅でも横スクロールなしで操作できる（サンプル大会・主催者として）', async ({ page, request }, testInfo) => {
  await reset(request, { configured: true });
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  // 初期化は管理者の操作
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: 'e2e-init-request-0001', auth: { adminKey: ADMIN_KEY } }) });
  await page.goto(ADMIN_PAGE);
  await expectNoHorizontalOverflow(page);
  await googleLogin(page);
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'サンプル大会を作成' }).click();
  await expect(page.getByRole('heading', { name: 'サンプル大会（PoC 検証用）' })).toBeVisible();
  for (const tab of ['進行状況', '試合結果', '選手', '形式', '組み合わせ', '大会設定', '履歴']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('admin-matches.png') });
});

test('主催者のホーム: 自分が作った大会だけが一覧に出て、ログアウトすると作成フォームも一覧も出ない', async ({ page, request }) => {
  const sample = await publishedSample(request); // ORGANIZER の大会
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, 'someone-else@example.org');
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await expect(page.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  await expect(page.getByText('まだ大会がありません。')).toBeVisible();
  await expect(page.getByText(sample.event.name)).toHaveCount(0);
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.getByRole('heading', { name: '大会を主催する' })).toBeVisible();
  await expect(page.getByLabel('大会名')).toHaveCount(0);
  await expect(page.locator('#actor')).toHaveText('');
});

test('トーナメントのみ: 5 名・シード・不戦勝・3 位決定戦 → 結果で勝ち上がり → 閲覧ページに優勝者', async ({ page, context, request }, testInfo) => {
  await reset(request, { configured: true });
  const seen = await routeAppsScript(page, request);
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: 'e2e-init-request-0003', auth: { adminKey: ADMIN_KEY } }) });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await page.getByLabel('大会名').fill('E2E トーナメント');
  await page.getByLabel(/大会の形式/).selectOption('elimination');
  await page.getByLabel('試合の長さ').selectOption('3');
  await page.getByLabel('トーナメントに 3 位決定戦を入れる').check();
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E トーナメント' })).toBeVisible();

  await page.getByRole('button', { name: '選手', exact: true }).click();
  await page.getByPlaceholder('1 行に 1 名ずつ入力').fill(['シード1', 'シード2', 'シード3', 'シード4', 'シード5'].join('\n'));
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('登録選手（5 名）')).toBeVisible();

  // 形式タブ: 決勝だけ Best of 5 にする
  await page.getByRole('button', { name: '形式', exact: true }).click();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '登録選手を全員追加' }).click();
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();
  await page.getByRole('button', { name: 'トーナメント表を作成' }).click();
  // 5 名 → 8 枠: 1 回戦は 4 位 vs 5 位の 1 試合だけ、準決勝 2・決勝・3 位決定戦
  await expect(page.getByText('5 試合のトーナメント表を作成しました。').last()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 1 回戦: 2-0 で確定 → 勝者が準決勝に入る
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  const first = page.locator('.match-editor:not(.match-editor--pending)').first();
  await expect(first).toContainText('シード4');
  await first.locator('input').nth(0).fill('2');
  await first.locator('input').nth(1).fill('0');
  await first.getByRole('button', { name: '確定' }).click();
  await expect(page.getByText('結果を確定しました。').last()).toBeVisible();

  // 準決勝 2 試合・3 位決定戦・決勝を順に入力（未定の試合は入力欄が出ない）
  for (let i = 0; i < 4; i++) {
    const card = page.locator('.match-editor:not(.match-editor--pending):not(.match-editor--final)').first();
    await card.locator('input').nth(0).fill('2');
    await card.locator('input').nth(1).fill('1');
    await card.getByRole('button', { name: '確定' }).click();
    await expect(page.getByText('結果を確定しました。').last()).toBeVisible();
  }

  await page.getByRole('button', { name: '大会設定' }).click();
  await page.getByLabel('閲覧画面に公開する').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.event-head .badge')).toHaveText('公開中');
  // 全試合が確定したので、進行状況に「終了」の案内が出る
  await page.getByRole('button', { name: '進行状況' }).click();
  await page.getByRole('button', { name: '大会を「終了」にする' }).click();
  await expect(page.getByText('大会を「終了」にしました。').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '大会を「終了」にする' })).toHaveCount(0);

  const eventId = page.url().match(/#e=(EVT-[A-Z0-9]+)/)[1];
  const viewer = await context.newPage();
  await routeAppsScript(viewer, request, seen);
  await viewer.goto(`/pages/index.html?event=${eventId}`);
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('E2E トーナメント');
  await expect(viewer.locator('.bracket__round')).toHaveCount(3);
  await expect(viewer.locator('.bmatch--final')).toHaveCount(5);
  await expect(viewer.locator('.champion')).toContainText('シード1');
  await expect(viewer.locator('.matches--third .bmatch')).toHaveCount(1);
  // トーナメント表: 1 回戦は 4 枠のうち 2 枠目（4 位 vs 5 位）だけ。勝者は準決勝 1 試合目に上がり、線でつながる
  await expect(viewer.locator('.bracket__round').first().locator('.bracket__slot')).toHaveCount(4);
  await expect(viewer.locator('.bracket__round').first().locator('.bracket__slot').nth(1)).toContainText('シード4');
  await expect(viewer.locator('.bracket__round').nth(1).locator('.bracket__slot.is-fed')).toHaveCount(1);
  // 決勝は準決勝 2 試合の上下の中央に来る
  const semis = await viewer.locator('.bracket__round').nth(1).locator('.bmatch').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
  const fin = await viewer.locator('.bracket__round').nth(2).locator('.bmatch').boundingBox();
  const mid = (semis[0].top + semis[0].height / 2 + semis[1].top + semis[1].height / 2) / 2;
  expect(Math.abs(fin.y + fin.height / 2 - mid)).toBeLessThan(2);
  // 優勝者の段が強調される
  await expect(viewer.locator('.bracket__round').nth(2).locator('.bmatch__row.is-winner')).toContainText('シード1');
  await expectNoHorizontalOverflow(viewer);
  await viewer.screenshot({ path: testInfo.outputPath('viewer-bracket.png'), fullPage: true });
});

test('ロビン → A / B トーナメント: 順位を確定して進出 → 進出者でトーナメント表を作れる', async ({ page, request }, testInfo) => {
  await reset(request, { configured: true });
  await routeAppsScript(page, request);
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: 'e2e-init-request-0004', auth: { adminKey: ADMIN_KEY } }) });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  await page.getByLabel('大会名').fill('E2E ロビンAB');
  await page.getByLabel(/大会の形式/).selectOption('robin_ab');
  await page.getByLabel('ロビンのグループ数').fill('2');
  await page.getByLabel(/A トーナメントへ進む順位/).fill('1');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();

  await page.getByRole('button', { name: '選手', exact: true }).click();
  await page.getByPlaceholder('1 行に 1 名ずつ入力').fill(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'].join('\n'));
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('登録選手（6 名）')).toBeVisible();

  await page.getByRole('button', { name: '形式', exact: true }).click();
  await expect(page.locator('.stage-editor')).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('admin-format.png'), fullPage: true });

  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '登録順に自動割当' }).click();
  await expect(page.getByText('割り当てました。').last()).toBeVisible();
  await page.getByRole('button', { name: '全グループの対戦カードを作成' }).click();
  await expect(page.getByText('6 試合を作成しました。').last()).toBeVisible();

  // 全試合を「上の選手が 3-0」で確定する
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  for (let i = 0; i < 6; i++) {
    const card = page.locator('.match-editor:not(.match-editor--final):not(.match-editor--pending)').first();
    await card.locator('input').nth(0).fill('3');
    await card.locator('input').nth(1).fill('0');
    await card.getByRole('button', { name: '確定' }).click();
    await expect(page.getByText('結果を確定しました。').last()).toBeVisible();
  }

  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  // 3 名の総当たりで全試合「上の選手」が勝つと 3 すくみ（全員 1 勝 1 敗・同 Leg 差）になる → 進出できない
  await page.getByRole('button', { name: '順位を確定して進出させる' }).click();
  await expect(page.getByText(/同順位（1位）の選手がいて進出者が決まりません/).last()).toBeVisible();
  // 手動で順位を決めると進出できる
  const editors = page.locator('.manual-order');
  await expect(editors).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page.locator('.manual-order').nth(i).getByRole('button', { name: 'この順番で決める' }).click();
    await expect(page.getByText('順位を決めました。').last()).toBeVisible();
  }
  await page.getByRole('button', { name: '順位を確定して進出させる' }).click();
  await expect(page.getByText('6 名が進出しました。').last()).toBeVisible();

  // A トーナメント: 各組 1 位の 2 名
  await page.getByRole('button', { name: 'A トーナメント', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '出場者とシード（2 名）' })).toBeVisible();
  await page.getByRole('button', { name: 'トーナメント表を作成' }).click();
  await expect(page.getByText('1 試合のトーナメント表を作成しました。').last()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('試合結果: 入力途中の結果は他の試合を確定しても消えず、入力済みの複数試合をまとめて確定できる', async ({ page, request }) => {
  const sample = await publishedSample(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${sample.event.id}`);
  await googleLogin(page);
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await page.getByRole('button', { name: 'グループD', exact: true }).click();
  const ids = sample.groups[3].matches.map((m) => m.id);
  const card = (i) => page.locator(`.match-editor[data-match-id="${ids[i]}"]`);
  const fill = async (i, a, b) => {
    await card(i).locator('input').nth(0).fill(String(a));
    await card(i).locator('input').nth(1).fill(String(b));
  };
  await fill(0, 3, 0);
  await fill(1, 3, 1);
  await fill(2, 2, 1); // Best of 5 では確定できない入力
  await expect(card(1).getByText('未保存の入力')).toBeVisible();
  // 確定できる入力が 2 試合あるのでバーが出る
  await expect(page.locator('.batch-bar')).toContainText('確定できる入力が 2 試合あります');

  // 1 試合だけ確定しても、他の入力は残る
  await card(0).getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.getByText('結果を確定しました。').last()).toBeVisible();
  await expect(card(1).locator('input').nth(0)).toHaveValue('3');
  await expect(card(1).locator('input').nth(1)).toHaveValue('1');
  await expect(card(2).locator('input').nth(0)).toHaveValue('2');
  await expect(page.locator('.batch-bar')).toBeHidden();

  // 3 試合目を直すと、2 試合をまとめて確定できる
  await card(2).locator('input').nth(1).fill('3');
  await page.getByRole('button', { name: '2 試合をまとめて確定' }).click();
  await expect(page.getByText('2 試合の結果を確定しました。').last()).toBeVisible();
  await page.getByRole('button', { name: 'すべての状態' }).click();
  await expect(card(1).locator('.status')).toHaveText('確定済み');
  await expect(card(2).locator('.match-editor__winner')).toContainText(`勝者: ${sample.groups[3].matches[2].p2.name}`);
  await expect(card(3).locator('.status')).toHaveText('未開始');
  await expectNoHorizontalOverflow(page);
});

test('大会の削除: データを JSON で保存し、大会名を入力すると削除でき、一覧から消える（スタッフ・閲覧ページは単体テスト）', async ({ page, request }) => {
  const sample = await publishedSample(request);
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(`${ADMIN_PAGE}#e=${sample.event.id}`);
  await googleLogin(page);
  await page.getByRole('button', { name: '大会設定' }).click();
  const del = page.getByRole('button', { name: 'この大会を削除する' });
  await expect(del).toBeDisabled();
  // ① 保存: ファイル名に大会 ID、中身は全シートの行と結果
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /大会のデータを保存/ }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^n02-tournament-${sample.event.id}-\\d{8}\\.json$`));
  const archive = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(archive.format).toBe('n02-tournament-archive');
  expect(archive.tables.Matches).toHaveLength(24);
  // ② 大会名を入れるまで削除できない
  await expect(del).toBeDisabled();
  await page.getByLabel(/確認のため、大会名/).fill('ちがう名前');
  await expect(del).toBeDisabled();
  await page.getByLabel(/確認のため、大会名/).fill(sample.event.name);
  await expect(del).toBeEnabled();
  await del.click();
  await expect(page.getByText(`大会「${sample.event.name}」を削除しました。`).last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'あなたの大会' })).toBeVisible();
  await expect(page.getByText('まだ大会がありません。')).toBeVisible();
});

