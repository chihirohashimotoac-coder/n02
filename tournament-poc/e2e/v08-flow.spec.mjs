// v0.8: 新しい形式と運営機能を画面で通しで操作する
// 予選ロビン→決勝トーナメント: CSV 取込 → 組分け → 予定・延期 → 不戦勝 → 結果 → 進出の確認 → 表 → 優勝 → 自動終了 → お知らせ → CSV 出力・印刷（PDF）→ 閲覧ページ
// ダブルエリミネーション・スイス式・ポイントシリーズ: 作成 → 組み合わせ → 結果 → 閲覧ページ
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { reset, routeAppsScript, expectNoHorizontalOverflow, ADMIN_KEY, fakeGoogle, googleLogin, ORGANIZER } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';
let initSeq = 0;

async function start(page, request) {
  await reset(request, { configured: true });
  const seen = await routeAppsScript(page, request);
  await request.post('/admin-post', { headers: { 'content-type': 'text/plain' }, data: JSON.stringify({ action: 'initializeStorage', payload: {}, requestId: `e2e-v08-init-${Date.now()}-${++initSeq}`, auth: { adminKey: ADMIN_KEY } }) });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto(ADMIN_PAGE);
  await googleLogin(page);
  return seen;
}

/** 試合結果タブの未確定の試合を、上の選手の勝ちで 1 試合確定する */
async function confirmNext(page) {
  const card = page.locator('.match-editor:not(.match-editor--final):not(.match-editor--pending)').first();
  const id = await card.getAttribute('data-match-id');
  // 「Best of N Legs」から勝ちに必要な Leg 数を求める
  const bestOf = Number(((await card.locator('.match-editor__meta').innerText()).match(/Best of (\d+)/) || [])[1] || 3);
  const a = String(Math.floor(bestOf / 2) + 1);
  const b = '0';
  const fixed = page.locator(`.match-editor[data-match-id="${id}"]`);
  await fixed.locator('input').nth(0).fill(a);
  await fixed.locator('input').nth(1).fill(b);
  await fixed.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator(`.match-editor[data-match-id="${id}"]:not(.match-editor--final)`)).toHaveCount(0);
}

async function confirmAll(page, max = 64) {
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  let n = 0;
  while ((await page.locator('.match-editor:not(.match-editor--final):not(.match-editor--pending)').count()) > 0) {
    await confirmNext(page);
    if (++n > max) throw new Error('試合が終わらない');
  }
  return n;
}

async function addPlayers(page, names) {
  await page.getByRole('button', { name: '選手', exact: true }).click();
  await page.getByPlaceholder('1 行に 1 名ずつ入力').fill(names.join('\n'));
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText(`登録選手（${names.length} 名）`)).toBeVisible();
}

async function publishAndOpenViewer(page, context, request, seen) {
  await page.getByRole('button', { name: '大会設定' }).click();
  await page.getByLabel('閲覧画面に公開する').check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.event-head .badge')).toHaveText('公開中');
  const eventId = page.url().match(/#e=(EVT-[A-Z0-9]+)/)[1];
  const viewer = await context.newPage();
  await routeAppsScript(viewer, request, seen);
  await viewer.goto(`/pages/index.html?event=${eventId}`);
  return viewer;
}

test('予選ロビン→決勝トーナメント: CSV 取込 → 組分け → 予定・延期 → 不戦勝 → 進出の確認 → 優勝・自動終了 → お知らせ → CSV・印刷 → 閲覧ページ', async ({ page, context, request, browserName }, testInfo) => {
  test.setTimeout(120000);
  const seen = await start(page, request);
  // 作成: 既定の形式は「予選ロビン→決勝トーナメント」。形式の説明と予定試合数を出す
  await expect(page.getByLabel(/大会の形式/)).toHaveValue('robin_ko');
  await expect(page.locator('.format-info__flow')).toContainText('ロビン');
  await page.getByLabel('大会名').fill('E2E v0.8 ロビン KO');
  await page.getByLabel('ロビンのグループ数').fill('2');
  await page.getByLabel(/通過順位/).fill('2');
  await expect(page.locator('.estimate__total')).toContainText('予定試合数');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E v0.8 ロビン KO' })).toBeVisible();

  // F11: CSV で 8 名を登録（見出し付き・所属・Rt。プレビューで確認してから登録）
  await page.getByRole('button', { name: '選手', exact: true }).click();
  const csv = '﻿名前,所属,Rt\r\n' + ['青木,東店,12', '石井,東店,10', '上田,西店,9', '江口,西店,8', '大野,南店,7', '加藤,南店,6', '木村,北店,5', '久保,北店,4'].join('\r\n') + '\r\n';
  await page.locator('#csv-file').setInputFiles({ name: 'players.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await expect(page.getByText(/8 行を読みました（文字コード: UTF-8）/)).toBeVisible();
  await page.getByRole('button', { name: '8 名を登録' }).click();
  await expect(page.getByText('8 名を登録しました。').last()).toBeVisible();
  await expect(page.getByText('登録選手（8 名）')).toBeVisible();

  // F16・F17: 組分け（Rt を蛇行で・同じ所属を別の組へ）→ 対戦カード
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByLabel('割り当ての方法').selectOption('balanced');
  await page.getByRole('button', { name: '組分けする' }).click();
  await expect(page.getByText('8 名を割り当てました。').last()).toBeVisible();
  await expect(page.getByText(/前回の割り当て: 組分け/)).toBeVisible();
  await page.getByRole('button', { name: '全グループの対戦カードを作成' }).click();
  await expect(page.getByText('12 試合を作成しました。').last()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // F07・F08: 1 試合目に予定を入れ、2 試合目を延期にする
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  const cards = page.locator('.match-editor:not(.match-editor--final):not(.match-editor--pending)');
  const firstId = await cards.nth(0).getAttribute('data-match-id');
  const secondId = await cards.nth(1).getAttribute('data-match-id');
  const first = page.locator(`.match-editor[data-match-id="${firstId}"]`);
  await first.getByRole('button', { name: '予定・延期' }).click();
  await first.locator(`#sch-${firstId}-date`).fill('2026-11-03');
  await first.locator(`#sch-${firstId}-time`).fill('19:30');
  await first.locator(`#sch-${firstId}-board`).fill('2');
  await first.getByRole('button', { name: '予定を保存' }).click();
  await expect(page.getByText('予定を保存しました。').last()).toBeVisible();
  await expect(first).toContainText('2026/11/03 19:30');
  const second = page.locator(`.match-editor[data-match-id="${secondId}"]`);
  await second.getByRole('button', { name: '予定・延期' }).click();
  await second.locator(`#sch-${secondId}-reason`).fill('会場の都合（非公開）');
  await second.getByRole('button', { name: '延期・振替を記録' }).click();
  await expect(page.getByText('延期・振替を記録しました。').last()).toBeVisible();
  await expect(second).toContainText('延期');

  // F06: 次戦・予定の一覧に予定が出る
  await page.getByRole('button', { name: '次戦・予定', exact: true }).click();
  await expect(page.getByText('2026/11/03 19:30').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // 閲覧ページ（公開）: 未確定の試合に予定・延期が出る。延期の理由は出ない
  const viewer = await publishAndOpenViewer(page, context, request, seen);
  await expect(viewer.getByText(/11\/03 19:30・ボード 2/).first()).toBeVisible();
  await expect(viewer.getByText(/延期/).first()).toBeVisible();
  expect(await viewer.locator('body').innerText()).not.toContain('非公開');

  // F15: 1 試合目を不戦勝で確定（理由は運営画面だけ）
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await first.getByRole('button', { name: '不戦勝・棄権・失格' }).click();
  await first.locator(`#sp-${firstId}-note`).fill('相手の当日不在（非公開）');
  await first.getByRole('button', { name: '特殊な結果で確定' }).click();
  await expect(page.getByText('記録しました。').last()).toBeVisible();
  await expect(page.locator(`.match-editor[data-match-id="${firstId}"]:not(.match-editor--final)`)).toHaveCount(0);

  // 残り 11 試合
  expect(await confirmAll(page)).toBe(11);

  // 進出: 確認してから確定
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '進出を確認' }).click();
  await expect(page.getByRole('heading', { name: /→ 決勝トーナメント（4 人）/ })).toBeVisible();
  await page.getByRole('button', { name: 'この内容で順位を確定して進出させる' }).click();
  await expect(page.getByText('4 名が進出しました。').last()).toBeVisible();

  await page.getByRole('button', { name: '決勝トーナメント', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '出場者とシード（4 名）' })).toBeVisible();
  await page.getByRole('button', { name: 'トーナメント表を作成' }).click();
  await expect(page.getByText('3 試合のトーナメント表を作成しました。').last()).toBeVisible();
  expect(await confirmAll(page)).toBe(3);

  // F05: すべて終わったので自動で「終了」
  await page.getByRole('button', { name: '大会設定' }).click();
  await expect(page.getByLabel('状態')).toHaveValue('finished');
  // F09: お知らせ
  await page.getByLabel(/閲覧ページのお知らせ/).fill('表彰式は 21:00 から');
  await page.getByRole('button', { name: '表示の設定を保存' }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();

  // F02: CSV（BOM 付き・数式にならない）
  await page.getByRole('button', { name: '出力・印刷', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '対戦・結果・予定' }).click()]);
  const csvOut = readFileSync(await download.path(), 'utf8');
  expect(csvOut.charCodeAt(0)).toBe(0xfeff);
  expect(csvOut).toContain('不戦勝');
  expect(csvOut).toContain('2026-11-03');
  expect(csvOut).not.toContain('非公開');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '選手一覧' }).click()]);
  expect(readFileSync(await dl2.path(), 'utf8')).toContain('青木,東店,12');

  // F03: 印刷（ボタン・メニューを出さず、表だけ）。Chromium の PDF 出力で実際の PDF を作って確かめる
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: '対戦表を印刷' }).click();
  await expect(page.locator('#print-root .print-table').first()).toBeAttached();
  if (browserName === 'chromium' && testInfo.project.name === 'desktop') {
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.tabs, .event-head').first()).toBeHidden();
    await expect(page.locator('#print-root h1')).toBeVisible();
    const pdf = await page.pdf({ preferCSSPageSize: true });
    writeFileSync(testInfo.outputPath('bracket-a4-portrait.pdf'), pdf);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    await page.emulateMedia({ media: 'screen' });
    await page.getByLabel('用紙の向き').selectOption('landscape');
    await page.getByRole('button', { name: '予定一覧を印刷' }).click();
    await page.emulateMedia({ media: 'print' });
    const pdf2 = await page.pdf({ preferCSSPageSize: true });
    writeFileSync(testInfo.outputPath('schedule-a4-landscape.pdf'), pdf2);
    expect(pdf2.subarray(0, 4).toString()).toBe('%PDF');
    await page.emulateMedia({ media: 'screen' });
  }
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  // 閲覧ページ: 優勝者・お知らせ・不戦勝。非公開の理由は出ない
  // 閲覧者用の Web アプリは公開データを 20 秒キャッシュする（本番と同じ）。読み直して反映を待つ
  await expect(async () => {
    await viewer.reload();
    await expect(viewer.locator('.champion')).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 45000, intervals: [5000] });
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('E2E v0.8 ロビン KO');
  await expect(viewer.locator('#notice')).toContainText('表彰式は 21:00 から');
  await expect(viewer.getByText('不戦勝').first()).toBeVisible();
  expect(await viewer.locator('body').innerText()).not.toContain('非公開');
  await expectNoHorizontalOverflow(viewer);
  await viewer.screenshot({ path: testInfo.outputPath('viewer-robin-ko.png'), fullPage: true });
});

test('ダブルエリミネーション 4 名: 表の作成 → 勝者側・敗者側・グランドファイナル → 閲覧ページに優勝者と準優勝', async ({ page, context, request }, testInfo) => {
  test.setTimeout(90000);
  const seen = await start(page, request);
  await page.getByLabel('大会名').fill('E2E ダブルエリミ');
  await page.getByLabel(/大会の形式/).selectOption('double_elimination');
  await expect(page.locator('.estimate__total')).toContainText('試合');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await addPlayers(page, ['D1', 'D2', 'D3', 'D4']);
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '登録選手を全員追加' }).click();
  await page.getByRole('button', { name: '出場者とシードを保存' }).click();
  await expect(page.getByText('保存しました。').last()).toBeVisible();
  await page.getByRole('button', { name: 'トーナメント表を作成' }).click();
  await expect(page.getByText(/試合のダブルエリミネーション表を作成しました。/).last()).toBeVisible();
  // 上の選手が毎回勝つ: 勝者側 3・敗者側 2・グランドファイナル 1（勝者側の優勝者が勝つのでリセットなし）= 6 試合
  expect(await confirmAll(page)).toBe(6);
  const viewer = await publishAndOpenViewer(page, context, request, seen);
  await expect(viewer.locator('.champion')).toContainText('D1');
  await expect(viewer.getByText('敗者側').first()).toBeVisible();
  await expectNoHorizontalOverflow(viewer);
  await viewer.screenshot({ path: testInfo.outputPath('viewer-de.png'), fullPage: true });
});

test('スイス式 5 名: 回戦ごとに組む（不戦は 1 人ずつ）→ 順位に Buchholz → 閲覧ページ', async ({ page, context, request }, testInfo) => {
  test.setTimeout(90000);
  const seen = await start(page, request);
  await page.getByLabel('大会名').fill('E2E スイス');
  await page.getByLabel(/大会の形式/).selectOption('swiss');
  await page.getByLabel('スイス式の回戦数').fill('3');
  await page.getByLabel(/決勝トーナメントに進む人数/).fill('0');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await addPlayers(page, ['S1', 'S2', 'S3', 'S4', 'S5']);
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '登録選手を全員参加させる' }).click();
  await expect(page.getByText('5 名を割り当てました。').last()).toBeVisible();
  for (let r = 1; r <= 3; r++) {
    await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
    await page.getByRole('button', { name: `第${r}回戦を組む` }).click();
    await expect(page.getByText(new RegExp(`第${r}回戦を組みました（2 試合・不戦 `)).last()).toBeVisible();
    expect(await confirmAll(page)).toBe(2);
  }
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await expect(page.getByText('3 / 3 回戦を組みました。')).toBeVisible();
  await page.getByText(/組み合わせの記録（3 回戦）/).click();
  const viewer = await publishAndOpenViewer(page, context, request, seen);
  await expect(viewer.getByRole('columnheader', { name: /Buchholz/ }).first()).toBeVisible();
  await expectNoHorizontalOverflow(viewer);
  await viewer.screenshot({ path: testInfo.outputPath('viewer-swiss.png'), fullPage: true });
});

test('ポイントシリーズ 4 名・2 節: 節ごとの小トーナメント → 中止の節 → 累計ポイント → プレーオフ → 閲覧ページ', async ({ page, context, request }, testInfo) => {
  test.setTimeout(120000);
  const seen = await start(page, request);
  await page.getByLabel('大会名').fill('E2E シリーズ');
  await page.getByLabel(/大会の形式/).selectOption('series_playoff');
  await page.getByLabel(/節の数/).fill('3');
  await page.getByLabel(/プレーオフ（決勝）に進む人数/).fill('2');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await addPlayers(page, ['P1', 'P2', 'P3', 'P4']);
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: /登録順に自動割当|登録選手を全員参加させる/ }).click();
  await expect(page.getByText('4 名を割り当てました。').last()).toBeVisible();
  // 第 1 節・第 2 節を行い、第 3 節は中止（点なし）
  for (let n = 0; n < 2; n++) {
    await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
    await page.locator('.night-card').nth(n).getByRole('button', { name: 'この節の組み合わせを作る' }).click();
    await expect(page.getByText(/試合の組み合わせを作りました。/).last()).toBeVisible();
    expect(await confirmAll(page)).toBe(3);
  }
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  const third = page.locator('.night-card').nth(2);
  await third.getByRole('textbox', { name: /中止の理由/ }).fill('台風');
  await third.getByRole('button', { name: 'この節を中止' }).click();
  await third.getByRole('button', { name: '中止（点なし）にする' }).click();
  await expect(page.getByText('中止にしました。').last()).toBeVisible();
  await expect(page.locator('.night-card').nth(2)).toContainText('中止');
  // 累計順位が決まったらプレーオフへ
  const pts = page.locator('table').filter({ hasText: '累計' }).first();
  await expect(pts).toBeVisible();
  // 節の組み合わせは抽選なので、累計が同点になることがある。同点なら運営が手動で順位を決めてから進出
  if ((await page.locator('.manual-order').count()) > 0) {
    await page.locator('.manual-order').first().getByRole('button', { name: 'この順番で決める' }).click();
    await expect(page.getByText('順位を決めました。').last()).toBeVisible();
  }
  await page.getByRole('button', { name: '進出を確認' }).click();
  await page.getByRole('button', { name: 'この内容で順位を確定して進出させる' }).click();
  await expect(page.getByText('2 名が進出しました。').last()).toBeVisible();
  const viewer = await publishAndOpenViewer(page, context, request, seen);
  await expect(viewer.getByText('中止').first()).toBeVisible();
  await expect(viewer.locator('.series-table').first()).toBeVisible();
  await expectNoHorizontalOverflow(viewer);
  await viewer.screenshot({ path: testInfo.outputPath('viewer-series.png'), fullPage: true });
});

test('印刷（PDF）: 複数ページの表は行の途中で切らず、各ページに見出しの行を出す（A4 縦・16 名の総当たり 120 試合）', async ({ page, request, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'desktop', 'PDF 出力は Chromium のデスクトップで確かめる');
  await start(page, request);
  await page.getByLabel('大会名').fill('E2E 印刷');
  await page.getByLabel(/大会の形式/).selectOption('robin');
  await page.getByLabel('ロビンのグループ数').fill('1');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await addPlayers(page, Array.from({ length: 16 }, (_, i) => '選手' + String(i + 1).padStart(2, '0')));
  await page.getByRole('button', { name: '組み合わせ', exact: true }).click();
  await page.getByRole('button', { name: '登録順に自動割当' }).click();
  await expect(page.getByText('16 名を割り当てました。').last()).toBeVisible();
  await page.getByRole('button', { name: '全グループの対戦カードを作成' }).click();
  await expect(page.getByText('120 試合を作成しました。').last()).toBeVisible();
  await page.getByRole('button', { name: '出力・印刷', exact: true }).click();
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.getByRole('button', { name: '対戦表を印刷' }).click();
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true });
  writeFileSync(testInfo.outputPath('robin16-a4-portrait.pdf'), pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBeGreaterThanOrEqual(3);
  // 見出しの行（thead）は印刷で各ページに繰り返す設定
  expect(await page.locator('#print-root .print-table thead').first().evaluate((e) => getComputedStyle(e).display)).toBe('table-header-group');
  expect(await page.locator('#print-root .print-table tr').first().evaluate((e) => getComputedStyle(e).breakInside)).toBe('avoid');
});
