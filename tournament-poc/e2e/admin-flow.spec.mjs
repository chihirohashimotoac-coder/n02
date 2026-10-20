// 運営者がスプレッドシートを開かずに、Web 画面だけで大会を作成・運営・公開できることの確認
import { test, expect } from '@playwright/test';
import { reset, expectNoHorizontalOverflow } from './helpers.mjs';

const SHEET_LINK = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit?usp=sharing';

test('初期設定 → 大会作成 → 選手登録 → グループ → 対戦カード → 結果入力・確定・訂正 → 公開 → 閲覧画面に反映', async ({ page, context, request }, testInfo) => {
  await reset(request, { configured: false });
  await page.goto('/admin');

  // 1. 保存先の設定と初期化（Web 画面から）
  await page.getByPlaceholder('https://docs.google.com/spreadsheets/d/…').fill(SHEET_LINK);
  await page.getByRole('button', { name: '設定' }).click();
  await expect(page.getByText('保存先: Tournament PoC')).toBeVisible();
  await page.getByRole('button', { name: '初期化する' }).click();
  await expect(page.getByRole('heading', { name: '大会一覧' })).toBeVisible();

  // 2. 大会作成
  await page.getByLabel('大会名').fill('E2E 検証大会');
  await page.getByLabel('開催日（表示用の文字列）').fill('2026/11/03');
  await page.getByLabel('ロビンのグループ数').fill('2');
  await page.getByRole('button', { name: '作成', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'E2E 検証大会' })).toBeVisible();

  // 3. 選手登録（作成後は「選手」タブが開く）
  await page.getByPlaceholder('1 行に 1 名ずつ入力').fill(['青木', '井上', '上田', '江藤', '小川', '加藤', '木村', '工藤'].join('\n'));
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('登録選手（8 名）')).toBeVisible();

  // 名前の変更
  const first = page.locator('.player-row').first();
  await first.getByRole('textbox').fill('青木 太郎');
  await first.getByRole('button', { name: '名前を保存' }).click();
  await expect(page.locator('.player-row').first().getByRole('textbox')).toHaveValue('青木 太郎');

  // 削除（2 回押し）
  await page.getByPlaceholder('1 行に 1 名ずつ入力').fill('削除予定');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  const last = page.locator('.player-row').last();
  await last.getByRole('button', { name: '削除' }).click();
  await last.getByRole('button', { name: '本当に削除' }).click();
  await expect(page.getByText('登録選手（8 名）')).toBeVisible();

  // 4. グループ割当と対戦カード
  await page.getByRole('button', { name: 'グループ', exact: true }).click();
  await page.getByRole('button', { name: '登録順に自動割当' }).click();
  await expect(page.getByText('割り当てました。').last()).toBeVisible();
  await page.getByRole('button', { name: '全グループの対戦カードを作成' }).click();
  await expect(page.getByText('12 試合を作成しました。').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '登録順に自動割当' })).toBeDisabled();

  // 5. 結果入力
  await page.getByRole('button', { name: '試合結果' }).click();
  const card = page.locator('.match-editor').first();
  const inputs = card.locator('input');
  // Best of 5 で 2-1 は確定できない（画面でも止め、サーバーでも拒否する）
  await inputs.nth(0).fill('2');
  await inputs.nth(1).fill('1');
  await card.getByRole('button', { name: '確定' }).click();
  await expect(card.getByText('確定するには、どちらかがちょうど 3 Leg 必要です')).toBeVisible();
  await card.getByRole('button', { name: '進行中として保存' }).click();
  await expect(page.locator('.match-editor').first().locator('.status')).toHaveText('進行中');

  const card2 = page.locator('.match-editor').first();
  await card2.locator('input').nth(0).fill('3');
  await card2.getByRole('button', { name: '確定' }).click();
  await expect(page.getByText('結果を確定しました。').last()).toBeVisible();

  // 確定済みは「未確定のみ」の一覧から消える → すべての状態で表示
  await page.getByRole('button', { name: 'すべての状態' }).click();
  const done = page.locator('.match-editor--final').first();
  await expect(done.locator('.match-editor__winner')).toContainText('勝者:');
  await expect(done.locator('input').first()).toBeDisabled();

  // 訂正
  await done.getByRole('button', { name: '訂正' }).click();
  const fix = page.locator('.match-editor').first();
  await fix.locator('input').nth(0).fill('1');
  await fix.locator('input').nth(1).fill('3');
  await fix.getByRole('button', { name: '訂正して確定' }).click();
  await expect(page.getByText('結果を確定しました。').last()).toBeVisible();
  const corrected = page.locator('.match-editor--final').first();
  const p2name = (await corrected.locator('.match-editor__player--2 span').textContent()).trim();
  await expect(corrected.locator('.match-editor__winner')).toContainText(`勝者: ${p2name}`);

  // 6. 公開設定
  await page.getByRole('button', { name: '大会設定' }).click();
  await page.getByLabel('閲覧画面に公開する').check();
  await page.getByLabel('閲覧画面の既定表示にする（URL に大会指定がないときに表示）').check();
  await page.getByLabel('状態').selectOption('running');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.event-head .badge')).toHaveText('公開中');

  // 進行状況
  await page.getByRole('button', { name: '進行状況' }).click();
  await expect(page.getByText('確定 1 / 12 試合')).toBeVisible();
  await expect(page.getByText(/閲覧画面に公開中/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('admin-progress.png') });

  // 履歴
  await page.getByRole('button', { name: '履歴' }).click();
  await expect(page.getByText(/match\.correct/)).toBeVisible();

  // 7. 閲覧画面（ログインなし）
  const viewer = await context.newPage();
  await viewer.goto('/viewer');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText('E2E 検証大会');
  await expect(viewer.locator('#rule-badge')).toContainText('Best of 5 Legs');
  await expect(viewer.locator('#rule-badge')).toContainText('暫定ルール');
  const vm = viewer.locator('.match--final').first();
  await expect(vm.locator('.match__score')).toHaveText('1-3');
  await expect(vm.locator('.match__player--2 .win-mark')).toHaveText('WIN');
  await expect(vm.locator('.match__player--2 .match__name')).toHaveText(p2name);

  // 8. 結果を追加入力 → 閲覧画面に反映（キャッシュ失効後の再取得）
  await page.getByRole('button', { name: '試合結果' }).click();
  await page.getByRole('button', { name: '未確定のみ' }).click();
  const next = page.locator('.match-editor').first();
  await next.locator('input').nth(0).fill('3');
  await next.locator('input').nth(1).fill('2');
  await next.getByRole('button', { name: '確定' }).click();
  await expect(page.getByText('結果を確定しました。').last()).toBeVisible();
  await request.post('/__expire-viewer-cache');
  await viewer.waitForTimeout(5100); // 手動更新は直前の取得から 5 秒空ける
  await viewer.getByRole('button', { name: '今すぐ更新' }).click();
  await expect(viewer.locator('.match--final')).toHaveCount(2);

  // 9. この流れの中でスプレッドシートの画面・URL を一度も使っていない（保存先の指定に共有リンクを貼っただけ）
  const html = await page.content();
  expect(html).not.toContain('docs.google.com/spreadsheets/d/1AbCd');
});

test('運営画面: スマートフォン幅でも横スクロールなしで操作できる', async ({ page, request }, testInfo) => {
  await reset(request, { configured: true });
  await page.goto('/admin');
  await page.getByRole('button', { name: '初期化する' }).click();
  await page.getByRole('button', { name: 'サンプル大会を作成' }).click();
  await expect(page.getByRole('heading', { name: 'サンプル大会（PoC 検証用）' })).toBeVisible();
  for (const tab of ['進行状況', '試合結果', '選手', 'グループ', '大会設定', '履歴']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expectNoHorizontalOverflow(page);
  }
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('admin-matches.png') });
});
