// ポータル「トーナメント・リーグ」（dist/pages/events/）の画面テスト
import { test, expect } from '@playwright/test';
import { reset, adminCall, loginSession, routeAppsScript, fakeGoogle, setFault, expectNoHorizontalOverflow, ORGANIZER } from './helpers.mjs';

const OTHER = 'other@example.net';

// 画面の移動直後に終わるテストで、移動前のページの通信（振り替え中）が残っていても失敗にしない
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
const STAFF_PASSWORD = 'staff-pass-1234';

async function ok(request, action, payload, auth) {
  const res = await adminCall(request, action, payload, auth);
  expect(res.ok, `${action}: ${JSON.stringify(res.error)}`).toBe(true);
  return res.data;
}

async function setEvent(request, auth, eventId, patch) {
  const ev = (await ok(request, 'eventDetail', { eventId }, auth)).event;
  return ok(request, 'updateEvent', { eventId, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: ev.status, isPublic: ev.isPublic, isFeatured: false, notes: '', ...patch }, auth);
}

/**
 * 主催者（ORGANIZER）: 開催中の公開大会・準備中の公開大会・非公開の大会
 * 別の主催者（OTHER）: 終了した公開大会（管理パスワードあり）
 */
async function seed(request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const org = await loginSession(request, ORGANIZER);
  const other = await loginSession(request, OTHER);
  const running = (await ok(request, 'createSampleEvent', { publish: true }, org)).eventId;
  await setEvent(request, org, running, { name: '第12回 n02 オープン', dateLabel: '2026/10/21', status: 'running' });
  const draft = (await ok(request, 'createEvent', { name: 'ナイトカップ', template: 'robin_ab', groupCount: 2, advanceCount: 2, rule: { format: 'legs', bestOf: 5 } }, org)).eventId;
  await setEvent(request, org, draft, { isPublic: true, status: 'draft', dateLabel: '2026/11/03' });
  const hidden = (await ok(request, 'createEvent', { name: '非公開の練習会', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, org)).eventId;
  const finished = (await ok(request, 'createEvent', { name: 'ウィークエンド・トーナメント', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }, other)).eventId;
  await setEvent(request, other, finished, { isPublic: true, status: 'finished', dateLabel: '2026/10/12' });
  const ev = (await ok(request, 'eventDetail', { eventId: finished }, other)).event;
  await ok(request, 'setStaffPassword', { eventId: finished, rev: ev.rev, password: STAFF_PASSWORD }, other);
  await request.post('/__expire-viewer-cache');
  return { org, other, running, draft, hidden, finished };
}

async function openPortal(page, request, email = ORGANIZER, seen = []) {
  await routeAppsScript(page, request, seen);
  await fakeGoogle(page, request, email);
  await page.goto('/pages/events/');
  await expect(page.locator('.row')).not.toHaveCount(0);
  return seen;
}

function rowNames(page) {
  return page.locator('.row__name').allTextContents();
}

test('未ログイン: 公開中の大会だけを 開催中 → 準備中 → 終了 の順に表示し、非公開の大会は出さない。CSP 違反・横スクロールなし', async ({ page, request }) => {
  await seed(request);
  const violations = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to|error/i.test(m.text()) && m.type() === 'error') violations.push(m.text());
  });
  const seen = await openPortal(page, request);
  expect(await rowNames(page)).toEqual(['第12回 n02 オープン', 'ナイトカップ', 'ウィークエンド・トーナメント']);
  await expect(page.getByText('非公開の練習会')).toHaveCount(0);
  await expect(page.locator('.group__title')).toHaveText(['開催中1', '準備中1', '終了1']);
  await expect(page.locator('#result-count')).toHaveText('公開中の大会 3 件');
  // 作成した大会のタブはログインしていないと出ない
  await expect(page.locator('#tabs')).toBeHidden();
  // 状態は文字と印で出す（色だけに頼らない）
  await expect(page.locator('.row').first().locator('.status')).toHaveText('開催中');
  // 各大会の情報: 形式・開催日・人数・確定数・進捗率・段階・更新
  const first = page.locator('.row').first();
  await expect(first.locator('.format')).toContainText('ロビン');
  await expect(first.locator('.row__date')).toHaveText('2026/10/21');
  await expect(first.locator('.row__stats')).toContainText('参加16 名');
  await expect(first.locator('.row__stats')).toContainText('確定12 / 24 試合');
  await expect(first.locator('.meter__pct')).toHaveText('50%');
  await expect(first.locator('.row__updated')).toContainText('更新');
  // 準備中の複合大会: トーナメント表がまだないので 100% にならない・未作成の段階を斜線で示す
  const draftRow = page.locator('.row').nth(1);
  await expect(draftRow.locator('.format')).toContainText('複合');
  await expect(draftRow.locator('.format')).toContainText('ロビン → トーナメント');
  await expect(draftRow.locator('.meter__seg--ungenerated')).toHaveCount(3);
  // 通信は一覧の 1 回だけ（大会ごとの問い合わせをしない）・Cookie なし
  expect(seen.filter((s) => s.url.includes('format=list'))).toHaveLength(1);
  expect(seen.filter((s) => s.url.includes('format=json'))).toHaveLength(0);
  expect(seen.every((s) => s.cookie === '')).toBe(true);
  expect(violations).toEqual([]);
  await expectNoHorizontalOverflow(page);
});

test('検索: 部分一致・件数・該当なし・消去。入力中は通信しない。IME の変換中は絞り込まない', async ({ page, request }) => {
  await seed(request);
  const seen = await openPortal(page, request);
  const before = seen.length;
  const q = page.getByLabel('大会名で検索');
  await q.fill('とーなめんと');
  await expect(page.locator('#result-count')).toHaveText('公開中の大会 3 件中 1 件を表示');
  expect(await rowNames(page)).toEqual(['ウィークエンド・トーナメント']);
  await expect(page).toHaveURL(/\?q=/);

  // IME: 変換中（compositionstart〜end）の入力では絞り込まず、確定したら絞り込む
  await q.fill('');
  await expect(page.locator('.row')).toHaveCount(3);
  await q.evaluate((input) => {
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    input.value = 'なｊ';
    input.dispatchEvent(new InputEvent('input', { isComposing: true, data: 'ｊ' }));
  });
  await page.waitForTimeout(400);
  await expect(page.locator('.row')).toHaveCount(3);
  await q.evaluate((input) => {
    input.value = 'ナイト';
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'ナイト' }));
  });
  expect(await rowNames(page)).toEqual(['ナイトカップ']);

  await q.fill('存在しない大会');
  await expect(page.locator('.empty__title')).toHaveText('「存在しない大会」に一致する大会はありません');
  await expect(page.locator('#result-count')).toHaveText('公開中の大会 3 件中 0 件を表示');
  await page.getByRole('button', { name: '検索と絞り込みを解除' }).click();
  await expect(page.locator('.row')).toHaveCount(3);
  await expect(q).toHaveValue('');
  await expect(q).toBeFocused();

  await q.fill('オープン');
  await page.getByRole('button', { name: '消去' }).click();
  await expect(q).toHaveValue('');
  await expect(page.locator('.row')).toHaveCount(3);
  expect(seen.length).toBe(before);
});

test('絞り込み: 開催状態・形式（件数付き）', async ({ page, request }) => {
  await seed(request);
  await openPortal(page, request);
  await expect(page.locator('#status-filter button')).toHaveText(['すべて3', '開催中1', '準備中1', '終了1']);
  await page.locator('#status-filter').getByRole('button', { name: /終了/ }).click();
  expect(await rowNames(page)).toEqual(['ウィークエンド・トーナメント']);
  await expect(page.locator('#status-filter').getByRole('button', { name: /終了/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#status-filter').getByRole('button', { name: /すべて/ }).click();
  await page.getByLabel('形式').selectOption('mixed');
  expect(await rowNames(page)).toEqual(['ナイトカップ']);
  // URL に残るので、開き直しても同じ条件
  await page.reload();
  await expect(page.getByLabel('形式')).toHaveValue('mixed');
  expect(await rowNames(page)).toEqual(['ナイトカップ']);
});

test('大会のモーダル: 大会名が見出し・Esc で閉じて元の場所に戻る・背景は操作できない・大会を見るで閲覧ページへ（ログイン不要・終了大会も）', async ({ page, request }) => {
  const s = await seed(request);
  await openPortal(page, request);
  const trigger = page.locator('.row__open', { hasText: 'ウィークエンド・トーナメント' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'ウィークエンド・トーナメント' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'ウィークエンド・トーナメント' })).toBeFocused();
  await expect(dialog.locator('.facts')).toContainText('終了');
  await expect(dialog.locator('.facts')).toContainText('2026/10/12');
  // 背景はモーダルの間は操作できない（inert）
  expect(await page.evaluate(() => document.querySelector('#q').matches(':modal *, :modal'))).toBe(false);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // キーボードだけで開く（Tab で大会名へ → Enter）
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  // Tab を押してもモーダルの外へフォーカスが出ない
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('dialog') || document.activeElement === document.body)).toBe(true);
  }
  // 「大会を見る」が最も大きいボタン、「管理画面」は小さい
  const view = dialog.getByRole('link', { name: '大会を見る' });
  const manage = dialog.getByRole('button', { name: '管理画面' });
  const vb = await view.boundingBox();
  const mb = await manage.boundingBox();
  expect(vb.width * vb.height).toBeGreaterThan(mb.width * mb.height * 2);
  await expect(view).toHaveAttribute('href', `../?event=${s.finished}`);
  await view.click();
  await expect(page).toHaveURL(new RegExp(`/pages/\\?event=${s.finished}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ウィークエンド・トーナメント');
});

test('未ログインで管理画面: 管理パスワードを間違えると拒否、正しければ運営画面がログインし直さずに開く', async ({ page, request }) => {
  const s = await seed(request);
  await openPortal(page, request);
  await page.locator('.row__open', { hasText: 'ウィークエンド・トーナメント' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '管理画面' }).click();
  await expect(dialog.getByRole('heading', { name: '管理画面を開くには' })).toBeVisible();
  // 主催者の方は Google、店舗スタッフの方は管理パスワード
  await expect(dialog.locator('.fake-gsi')).toHaveCount(1);
  await dialog.getByLabel('管理パスワード').fill('wrong-pass-0000');
  await dialog.getByRole('button', { name: '管理画面を開く' }).click();
  await expect(dialog.locator('.form-error')).toHaveText('大会または管理パスワードが違います。');
  await expect(page).toHaveURL(/\/pages\/events\//);
  await dialog.getByLabel('管理パスワード').fill(STAFF_PASSWORD);
  await dialog.getByRole('button', { name: '管理画面を開く' }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/admin/#e=${s.finished}$`));
  await expect(page.locator('.event-head__title')).toHaveText('ウィークエンド・トーナメント');
  await expect(page.locator('#actor')).toContainText('スタッフ（管理パスワード）');
  // ポータルへ戻ってもう一度押すと、パスワードを聞かずに開く
  await page.goto('/pages/events/');
  await page.locator('.row__open', { hasText: 'ウィークエンド・トーナメント' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '管理画面' }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/admin/#e=${s.finished}$`));
  await expect(page.locator('.event-head__title')).toHaveText('ウィークエンド・トーナメント');
});

test('Google でログイン: 作成した大会（非公開・準備中を含む）を表示し、自分の大会は管理画面へそのまま入れる', async ({ page, request }) => {
  const s = await seed(request);
  await openPortal(page, request, ORGANIZER);
  await page.locator('.plate .fake-gsi').click();
  await expect(page.locator('.account__email')).toContainText(ORGANIZER);
  await expect(page.getByRole('tab', { name: /作成した大会/ })).toHaveText('作成した大会（3）');
  await page.getByRole('tab', { name: /作成した大会/ }).click();
  await expect(page.getByRole('tab', { name: /作成した大会/ })).toHaveAttribute('aria-selected', 'true');
  expect(await rowNames(page)).toEqual(['第12回 n02 オープン', 'ナイトカップ', '非公開の練習会']);
  await expect(page.locator('.row', { hasText: '非公開の練習会' }).locator('.visibility')).toHaveText('非公開');
  await expect(page.getByText('ウィークエンド・トーナメント')).toHaveCount(0);
  // 非公開の大会は閲覧ページがない
  await page.locator('.row__open', { hasText: '非公開の練習会' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '大会を見る' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('非公開のため、閲覧ページはありません');
  await page.getByRole('dialog').getByRole('button', { name: '管理画面' }).click();
  await expect(page).toHaveURL(new RegExp(`/pages/admin/#e=${s.hidden}$`));
  await expect(page.locator('.event-head__title')).toHaveText('非公開の練習会');
  // 運営画面でもログイン済み（同じログインを使う）
  await expect(page.locator('#actor')).toContainText(ORGANIZER);
});

test('Google でログインしていても他人の大会はそのまま開けず、管理パスワードを求める', async ({ page, request }) => {
  await seed(request);
  await openPortal(page, request, ORGANIZER);
  await page.locator('.plate .fake-gsi').click();
  await expect(page.locator('.account__email')).toContainText(ORGANIZER);
  await expect(page.getByRole('tab', { name: /作成した大会（3）/ })).toBeVisible();
  await page.locator('.row__open', { hasText: 'ウィークエンド・トーナメント' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '管理画面' }).click();
  await expect(dialog.locator('.auth__note')).toContainText(`${ORGANIZER} はこの大会の主催者ではありません`);
  await expect(dialog.locator('.fake-gsi')).toHaveCount(0);
  await expect(dialog.getByLabel('管理パスワード')).toBeFocused();
  await expect(page).toHaveURL(/\/pages\/events\//);
  await dialog.getByLabel('管理パスワード').fill(STAFF_PASSWORD);
  await dialog.getByRole('button', { name: '管理画面を開く' }).click();
  await expect(page.locator('.event-head__title')).toHaveText('ウィークエンド・トーナメント');
});

test('未ログインのまま管理画面 → Google でログインすると、自分の大会ならそのまま運営画面へ', async ({ page, request }) => {
  const s = await seed(request);
  await openPortal(page, request, ORGANIZER);
  await page.locator('.row__open', { hasText: '第12回 n02 オープン' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '管理画面' }).click();
  await dialog.locator('.fake-gsi').click();
  await expect(page).toHaveURL(new RegExp(`/pages/admin/#e=${s.running}$`));
  await expect(page.locator('.event-head__title')).toHaveText('第12回 n02 オープン');
});

test('作成ボタン: 未ログインならログインを案内し、ログイン後に作成画面へ → 作成した大会が運営画面で開き、ポータルの一覧に出る', async ({ page, request }) => {
  await seed(request);
  await openPortal(page, request, OTHER);
  await page.getByRole('button', { name: 'トーナメント・リーグを作成' }).click();
  const dialog = page.getByRole('dialog', { name: 'Google でログイン' });
  await expect(dialog).toBeVisible();
  await dialog.locator('.fake-gsi').click();
  await expect(page).toHaveURL(/\/pages\/admin\/#new$/);
  await expect(page.locator('#new-name')).toBeFocused();
  await page.locator('#new-name').fill('新しいリーグ戦');
  await page.locator('#new-template').selectOption('league');
  await page.getByRole('button', { name: '大会を作成', exact: true }).click();
  await expect(page.locator('.event-head__title')).toHaveText('新しいリーグ戦');
  await page.goto('/pages/events/?tab=mine');
  await expect(page.getByRole('tab', { name: /作成した大会/ })).toHaveAttribute('aria-selected', 'true');
  expect(await rowNames(page)).toEqual(['新しいリーグ戦', 'ウィークエンド・トーナメント']);
  await expect(page.locator('.row', { hasText: '新しいリーグ戦' }).locator('.format')).toHaveText('リーグ');
  // ログイン済みなら作成ボタンで直接作成画面へ
  await page.getByRole('button', { name: 'トーナメント・リーグを作成' }).click();
  await expect(page).toHaveURL(/\/pages\/admin\/#new$/);
});

test('ログインが切れていたら（サーバーが無効と判断したら）ログアウトした状態に戻し、権限を残さない', async ({ page, request }) => {
  await seed(request);
  await page.addInitScript(() => {
    localStorage.setItem('tpoc-google', JSON.stringify({ session: 'f'.repeat(64), email: 'organizer@example.org', expiresAt: new Date(Date.now() + 3600e3).toISOString() }));
  });
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto('/pages/events/?tab=mine');
  await expect(page.locator('#banner')).toContainText('有効期限が切れました');
  await expect(page.locator('#tabs')).toBeHidden();
  await expect(page.locator('.plate .fake-gsi')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tpoc-google'))).toBeNull();
  await expect(page.locator('.row')).toHaveCount(3);
});

test('ログアウトすると作成した大会が消え、運営画面のログインも消える', async ({ page, request }) => {
  await seed(request);
  await openPortal(page, request, ORGANIZER);
  await page.locator('.plate .fake-gsi').click();
  await expect(page.getByRole('tab', { name: /作成した大会（3）/ })).toBeVisible();
  await page.getByRole('button', { name: 'ログアウト' }).click();
  await expect(page.locator('#tabs')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('tpoc-google'))).toBeNull();
  await page.goto('/pages/admin/');
  await expect(page.getByRole('heading', { name: '大会を主催する' })).toBeVisible();
});

test('通信エラー: 一覧が読めなければエラーと再読み込みを出し、復旧したら表示する', async ({ page, request }) => {
  await seed(request);
  await setFault(request, 'viewer', 'fail');
  await routeAppsScript(page, request);
  await page.goto('/pages/events/');
  await expect(page.locator('#results .banner--error')).toContainText('大会の一覧を読み込めませんでした');
  await setFault(request, 'viewer', 'ok');
  await page.getByRole('button', { name: '再読み込み' }).click();
  await expect(page.locator('.row')).toHaveCount(3);
});

test('公開大会がないとき・作成した大会がないときの表示', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await routeAppsScript(page, request);
  await fakeGoogle(page, request, 'newcomer@example.org');
  await page.goto('/pages/events/');
  await expect(page.locator('.empty__title')).toHaveText('公開中の大会はまだありません');
  await page.locator('.plate .fake-gsi').click();
  await page.getByRole('tab', { name: /作成した大会/ }).click();
  await expect(page.locator('.empty__title')).toHaveText('まだ大会を作成していません');
  await page.locator('.empty').getByRole('button', { name: 'トーナメント・リーグを作成' }).click();
  await expect(page).toHaveURL(/\/pages\/admin\/#new$/);
});

test('n02 に戻るリンクと、運営画面からポータルへのリンク', async ({ page, request }) => {
  await seed(request);
  await openPortal(page, request);
  await expect(page.getByRole('link', { name: 'n02 に戻る' })).toHaveAttribute('href', 'https://chihirohashimotoac-coder.github.io/n02/');
  await page.goto('/pages/admin/');
  await page.getByRole('link', { name: 'トーナメント・リーグ' }).click();
  await expect(page).toHaveURL(/\/pages\/events\/$/);
});
