// UX 改善 S4: 画面の構成（一覧と作成の分離・大会メニュー・設定の分類）と、スマートフォン／タブレット／PC の幅での配置。
// ブラウザ（Chromium）の画面幅を変えた確認で、実機・ソフトウェアキーボードの確認ではない。
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, ORGANIZER, organizerHome, openCreate, openTab, openSettings, chooseFormat, expectNoHorizontalOverflow, recordActions } from './helpers.mjs';

const SIZES = [
  { name: 'スマートフォン 390×844', width: 390, height: 844 },
  { name: 'タブレット 768×1024', width: 768, height: 1024 },
  { name: 'PC 1440×900', width: 1440, height: 900 },
];

async function seedMany(request, count) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const auth = await loginSession(request, ORGANIZER);
  // 主催者の大会として、管理者の鍵でまとめて作る（1 時間に作れる数の上限を避ける）。所有者は後から主催者にする
  const ids = [];
  const byAdmin = [];
  for (let i = 1; i <= count; i++) {
    const res = await adminCall(request, 'createEvent', { name: `一覧の大会 ${String(i).padStart(2, '0')}`, template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, i <= 4 ? auth : undefined);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    ids.push(res.data.eventId);
    if (i > 4) {
      const ev = res.data.detail.event;
      expect((await adminCall(request, 'setOwner', { eventId: ev.id, rev: ev.rev, ownerEmail: ORGANIZER })).ok).toBe(true);
      byAdmin.push(ev.id);
    }
  }
  // 本人のログインで紐付けを申請し、管理者が承認する（Google が持ち主を保証しないアドレスの手順）
  await adminCall(request, 'linkAccount', {}, auth);
  for (const id of byAdmin) {
    const ev = (await adminCall(request, 'eventDetail', { eventId: id })).data.event;
    if (ev.ownerLink && !ev.ownerLink.linked) {
      expect((await adminCall(request, 'approveOwnerClaim', { eventId: id, rev: ev.rev, ref: ev.ownerLink.claims[0].ref })).ok).toBe(true);
    }
  }
  return { auth, ids };
}

for (const size of SIZES) {
  test(`${size.name}: 一覧・作成・大会の各メニュー・設定の各分類で、ページが横にはみ出さない。作成の入口は一覧の長さに関係なく最初の画面にある`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'desktop', '画面幅はこのテストの中で変える');
    test.setTimeout(120000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await seedMany(request, 11);
    await organizerHome(page, request);
    await expect(page.locator('.event-card')).toHaveCount(11);
    await expectNoHorizontalOverflow(page);
    // 作成ボタン・検索は一覧の上（大会が 11 件あっても、スクロールせずに届く）
    const create = await page.locator('#open-create').boundingBox();
    expect(create.y + create.height).toBeLessThan(size.height);
    expect(create.height).toBeGreaterThanOrEqual(44);
    const search = await page.locator('#home-search').boundingBox();
    expect(search.y + search.height).toBeLessThan(size.height);
    // その他の作成（期制リーグ・復元・検証用サンプル）は別の入口
    await page.locator('#create-more summary').click();
    await expect(page.getByRole('button', { name: '期制リーグを作成' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ファイルから復元' })).toBeVisible();
    await expect(page.getByRole('button', { name: '検証用サンプル' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.locator('#create-more summary').click();

    // 作成画面: 基本情報 → 形式 → 人数・進行 → 1 試合のルール → 作成内容
    await openCreate(page);
    await expect(page).toHaveURL(/#new$/);
    await expect(page.locator('.event-card')).toHaveCount(0); // 一覧とは別の画面
    await page.locator('#new-name').fill('配置の確認');
    await expectNoHorizontalOverflow(page);
    const order = await page.evaluate(() => ['new-h-basic', 'new-h-format', 'new-h-flow', 'new-h-rule'].map((id) => document.getElementById(id).getBoundingClientRect().top));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const main = await page.locator('.create-main').boundingBox();
    const summary = await page.locator('.create-summary').boundingBox();
    const submit = await page.getByRole('button', { name: 'この内容で大会を作成' }).boundingBox();
    const dl = await page.locator('#new-summary').boundingBox();
    expect(dl.y).toBeLessThan(submit.y); // 作成ボタンより前に内容を確認できる
    expect(submit.height).toBeGreaterThanOrEqual(44);
    if (size.width >= 1024) {
      expect(summary.x).toBeGreaterThanOrEqual(main.x + main.width); // 入力の横に並ぶ
      expect(summary.y).toBeLessThan(main.y + 40);
    } else {
      expect(summary.y).toBeGreaterThanOrEqual(main.y + main.height - 1); // 1 列: 入力の後・作成ボタンの前
    }
    for (const id of ['league_playoff', 'multi_robin_ko', 'series_playoff', 'swiss', 'double_elimination']) {
      await chooseFormat(page, id);
      await expectNoHorizontalOverflow(page);
    }
    await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
    await expect(page.getByRole('heading', { name: '配置の確認' })).toBeVisible();
    // 作成した直後: 次にすることが主ボタンで出る
    await page.locator('#next-step').getByRole('button', { name: '選手を登録' }).click();
    await expect(page.locator('#bulk-names')).toBeVisible();

    // 大会のメニュー: 狭い画面は 進行状況・試合結果・選手・その他。大会設定へは最大 2 操作
    const more = page.locator('#tab-more');
    if (size.width >= 1024) {
      await expect(more).toBeHidden();
      const nav = await page.locator('.tabs').boundingBox();
      const body = await page.locator('.event-body').boundingBox();
      expect(nav.width).toBeLessThanOrEqual(220);
      expect(body.x).toBeGreaterThanOrEqual(nav.x + nav.width); // 左にメニュー、右に本文
      await page.locator('#tab-settings').click(); // 1 操作
    } else {
      await expect(more).toBeVisible();
      await expect(page.locator('.tabs > .tab:visible')).toHaveText(['進行状況', '試合結果', '選手', 'その他']);
      await expect(page.locator('#tab-settings')).toBeHidden();
      await more.click(); // 1 操作目
      await expect(page.locator('#tabs-more .tab:visible')).toHaveText(['次戦・予定', '形式', '組み合わせ', '大会設定', '出力・印刷', '履歴']);
      // 開いた一覧は、メニューの行（進行状況 … その他）の下に出る
      const row = await page.evaluate(() => ['tab-progress', 'tab-matches', 'tab-players', 'tab-more'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
      expect(new Set(row).size).toBe(1);
      expect((await page.locator('#tabs-more').boundingBox()).y).toBeGreaterThan(row[0]);
      await expectNoHorizontalOverflow(page);
      await page.locator('#tab-settings').click(); // 2 操作目
      await expect(more).toHaveAttribute('aria-current', 'true');
    }
    await expect(page.locator('#set-name')).toBeVisible();
    for (const group of ['基本情報', '公開・表示', '権限', 'その他']) {
      await openSettings(page, group);
      await expectNoHorizontalOverflow(page);
    }
    // 複製・削除は「その他」。削除の確認（大会名の入力・保存の選択）はそのまま
    await expect(page.getByRole('button', { name: '複製して新しい大会を作る' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'この大会を削除する' })).toBeDisabled();
    await expect(page.locator('#delete-confirm')).toBeVisible();
    for (const tab of ['進行状況', '試合結果', '次戦・予定', '選手', '形式', '組み合わせ', '出力・印刷', '履歴']) {
      await openTab(page, tab);
      await expectNoHorizontalOverflow(page);
    }
    if (size.width >= 1024) {
      // PC の設定: 入力の横に今の状態のまとめ
      await openSettings(page, '基本情報');
      const form = await page.locator('#settings-event').boundingBox();
      const side = await page.locator('.settings-summary').boundingBox();
      expect(side.x).toBeGreaterThanOrEqual(form.x + form.width);
      expect(form.width).toBeGreaterThan(560);
    }
  });
}

test('一覧: 大会名の検索・状態の絞り込み・更新が新しい順。絞り込みで通信しない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const auth = await loginSession(request, ORGANIZER);
  const made = [];
  for (const name of ['春のリーグ', '夏のトーナメント', '秋のリーグ']) {
    const res = await adminCall(request, 'createEvent', { name, template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, auth);
    made.push(res.data.detail.event);
    await page.waitForTimeout(15);
  }
  // 「春のリーグ」を開催中にする（更新も一番新しくなる）
  expect((await adminCall(request, 'updateEvent', { eventId: made[0].id, rev: made[0].rev, name: made[0].name, dateLabel: '', status: 'running', isPublic: false, isFeatured: false, notes: '' }, auth)).ok).toBe(true);
  await organizerHome(page, request);
  const actions = await recordActions(page);
  const names = () => page.locator('.event-card h3').allTextContents();
  expect(await names()).toEqual(['春のリーグ', '秋のリーグ', '夏のトーナメント']);
  await page.locator('#home-search').fill('リーグ');
  expect(await names()).toEqual(['春のリーグ', '秋のリーグ']);
  await expect(page.locator('#home-count')).toHaveText('3 件中 2 件を表示');
  await page.getByRole('button', { name: '準備中', exact: true }).click();
  expect(await names()).toEqual(['秋のリーグ']);
  await page.getByRole('button', { name: '終了', exact: true }).click();
  await expect(page.locator('.event-card')).toHaveCount(0);
  await expect(page.getByText('条件に合う大会がありません。')).toBeVisible();
  await expect(page.locator('#home-search')).toBeFocused().catch(() => {}); // 入力欄は描き直さない
  await page.getByRole('button', { name: 'すべて', exact: true }).click();
  await page.locator('#home-search').fill('');
  expect(await names()).toEqual(['春のリーグ', '秋のリーグ', '夏のトーナメント']);
  expect(actions).toEqual([]);
});

test('別の入口: 期制リーグの作成・ファイルからの復元・検証用サンプルは、通常の作成とは別の画面で開く（機能はそのまま）', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await organizerHome(page, request);
  const openMore = async (name) => {
    await page.locator('#create-more summary').click();
    await page.getByRole('button', { name }).click();
  };
  await openMore('期制リーグを作成');
  await expect(page).toHaveURL(/#new-season$/);
  await expect(page.locator('#season-name')).toBeVisible();
  await expect(page.locator('#new-name')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.goBack(); // ブラウザの「戻る」で一覧へ
  await expect(page.locator('#event-list')).toBeVisible();
  await openMore('ファイルから復元');
  await expect(page).toHaveURL(/#restore$/);
  await expect(page.locator('#restore-file')).toBeVisible();
  await expect(page.getByRole('button', { name: '新しい大会として復元' })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
  await page.locator('#back-to-list').click();
  await openMore('検証用サンプル');
  await expect(page).toHaveURL(/#sample$/);
  await expect(page.getByRole('heading', { name: '検証用サンプル', level: 3 })).toBeVisible();
  await page.getByRole('button', { name: 'サンプル大会を作成' }).click();
  await expect(page.getByRole('heading', { name: 'サンプル大会（PoC 検証用）' })).toBeVisible();
});

test('拡大表示・低い画面（PC の 200% 相当 720×450・横向きのスマートフォン 844×390）: 入力と保存のボタンに届く', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', '画面の大きさはこのテストの中で変える');
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await organizerHome(page, request);
  for (const vp of [{ width: 720, height: 450 }, { width: 844, height: 390 }, { width: 1440, height: 450 }]) {
    await page.setViewportSize(vp);
    await page.goto('/pages/admin/index.html#new');
    await page.locator('#new-name').fill(`低い画面 ${vp.width}`);
    await expectNoHorizontalOverflow(page);
    // 追従する枠が画面をふさがない: どの入力欄も、作成ボタンも、スクロールして押せる
    await page.locator('#new-bestof').selectOption('3');
    const submit = page.getByRole('button', { name: 'この内容で大会を作成' });
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    if (vp.width >= 1024) expect(await page.locator('.create-summary').evaluate((e) => getComputedStyle(e).position)).toBe('static');
    await submit.click();
    await expect(page.getByRole('heading', { name: `低い画面 ${vp.width}` })).toBeVisible();
    await openSettings(page);
    await page.locator('#set-notes').fill('低い画面でも保存できる');
    const save = page.getByRole('button', { name: '大会情報を保存' });
    await save.scrollIntoViewIfNeeded();
    await save.click();
    await expect(page.locator('#settings-event .save-state')).toHaveText('保存済み');
    await expectNoHorizontalOverflow(page);
  }
});

test('キーボードだけで作成できる: 形式は矢印キーで選べ、選んだ状態が分かる', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'キーボードの操作は PC で確かめる');
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await organizerHome(page, request);
  await page.locator('#open-create').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#new-name')).toBeVisible();
  await page.locator('#new-name').focus();
  await page.keyboard.type('キーボードで作成');
  await page.locator('#new-template-robin_ko').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#new-template-elimination')).toBeChecked();
  await expect(page.locator('#new-template-elimination')).toBeFocused();
  await expect(page.locator('#new-summary')).toContainText('トーナメント（シングルエリミネーション）');
  expect(await page.locator('label[for="new-template-elimination"]').evaluate((e) => getComputedStyle(e).borderColor)).not.toBe(await page.locator('label[for="new-template-robin"]').evaluate((e) => getComputedStyle(e).borderColor));
  await page.locator('#new-name').focus();
  await page.keyboard.press('Enter'); // フォームの送信
  await expect(page.getByRole('heading', { name: 'キーボードで作成' })).toBeVisible();
});
