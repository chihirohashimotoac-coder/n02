// UX 改善 S2: 作成画面では、成り立つ設定だけを選べる。
// - 固定 Leg 数は、勝ち抜き戦の段階を含まない形式（ロビンのみ・リーグ・決勝なしのスイス式）だけ
// - 形式で使わない欄は隠して無効にし、送る内容にも入れない（前に選んでいた形式の値が混ざらない）
// - スイス式で決勝トーナメントを行わないときは 3 位決定戦を選べない（送る値は false）
import { test, expect } from '@playwright/test';
import { reset, adminCall, ORGANIZER, organizerHome, openCreate, chooseFormat, interceptAction, routeAppsScript, fakeGoogle, googleLogin } from './helpers.mjs';

const FORMATS = ['robin_ko', 'elimination', 'robin_ab', 'double_elimination', 'robin', 'league', 'league_playoff', 'multi_robin_ko', 'series_playoff', 'swiss'];
// 作成時に固定 Leg 数を使える形式（スイス式は決勝トーナメントの人数 0 のとき）
const FIXED_OK = { robin: true, league: true, swiss: true };
// 形式ごとに送ってよい項目（共通の name / dateLabel / organizerName / template / rule / thirdPlace を除く）
const ALLOWED = {
  robin_ko: ['groupCount', 'advanceCount', 'cycles'],
  elimination: [],
  robin_ab: ['groupCount', 'advanceCount', 'cycles'],
  double_elimination: ['grandFinal'],
  robin: ['groupCount', 'cycles'],
  league: ['divisions', 'cycles', 'points'],
  league_playoff: ['divisions', 'cycles', 'points', 'playoff'],
  multi_robin_ko: ['groupCount', 'advanceCount', 'groupCount2', 'advanceCount2', 'cycles'],
  series_playoff: ['nights', 'nightPoints', 'playoff'],
  swiss: ['swissRounds', 'points', 'playoff'],
};
const COMMON = ['name', 'dateLabel', 'organizerName', 'template', 'rule', 'thirdPlace'];

async function setup(page, request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await routeAppsScript(page, request);
  // 作成の要求は記録だけして、作らずに「保存されなかった」と返す（同じ画面で次の組み合わせを試すため）
  const seen = await interceptAction(page, request, 'createEvent', async ({ reply }) => {
    await reply(JSON.stringify({ ok: false, error: { code: 'VALIDATION', message: '（試験）記録だけして作成しません。' } }));
  });
  await fakeGoogle(page, request, ORGANIZER);
  await page.goto('/pages/admin/index.html#new');
  await googleLogin(page);
  await page.locator('#new-name').fill('組み合わせの確認');
  return seen;
}

test('全 10 形式 × Leg 制／セット制／固定 Leg 数: サーバーが拒否する組み合わせは送れず、送る内容は選んだ形式の項目だけ', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', '組み合わせの網羅は 1 つの画面幅で行う（表示の確認は layout.spec）');
  test.setTimeout(180000);
  const seen = await setup(page, request);
  const submit = page.getByRole('button', { name: 'この内容で大会を作成' });
  // 前の形式の値が残るよう、どの形式でも使わない値をあらかじめ入れておく
  await chooseFormat(page, 'multi_robin_ko');
  await page.locator('#new-groups2').fill('3');
  await page.locator('#new-advance2').fill('1');
  await chooseFormat(page, 'series_playoff');
  await page.locator('#new-nights').fill('7');
  for (const id of FORMATS) {
    // サーバーへ直接送る確認は管理者の鍵で行う（作成の検査は同じ。1 時間に作れる大会の数の上限だけが掛からない）
    const auth = undefined;
    await chooseFormat(page, id);
    if (id === 'swiss') await page.locator('#new-playoff-opt').fill('0');
    for (const rule of ['legs', 'sets', 'fixed']) {
      const label = `${id} × ${rule}`;
      const fixedOption = page.locator('#new-format option[value="fixed"]');
      if (rule === 'fixed' && !FIXED_OK[id]) {
        // 選べない: 選択肢が無効。サーバーも同じ組み合わせを拒否する（画面の制限がサーバーの仕様と合っていること）
        await expect(fixedOption, label).toHaveJSProperty('disabled', true);
        const direct = await adminCall(request, 'createEvent', { name: '直接', template: id, groupCount: 2, advanceCount: 1, groupCount2: 2, advanceCount2: 1, playoff: 2, nights: 2, rule: { format: 'fixed', bestOf: 4 } }, auth);
        expect(direct.ok, label + ' はサーバーが拒否する').toBe(false);
        expect(direct.error.code, label).toBe('VALIDATION');
        continue;
      }
      await expect(fixedOption, label).toHaveJSProperty('disabled', !FIXED_OK[id]);
      await page.locator('#new-format').selectOption(rule);
      const before = seen.length;
      await submit.click();
      await expect.poll(() => seen.length, { message: label }).toBe(before + 1);
      const p = seen[seen.length - 1].payload;
      expect(p.template, label).toBe(id);
      expect(p.rule.format, label).toBe(rule);
      expect(Object.keys(p).filter((k) => p[k] !== undefined).sort(), label).toEqual(COMMON.concat(ALLOWED[id]).sort());
      if (rule !== 'sets') expect(p.rule.setBestOf, label).toBeUndefined();
      // 送る内容をそのままサーバーへ渡すと作成できる（画面が許す組み合わせをサーバーが受け付けること）
      const direct = await adminCall(request, 'createEvent', p, auth);
      expect(direct.ok, label + ': ' + JSON.stringify(direct.error)).toBe(true);
      await expect(page.locator('#create-form .save-state')).toContainText('保存されませんでした');
    }
    await page.locator('#new-format').selectOption('legs');
  }
});

test('固定 Leg 数を選んだまま勝ち抜き戦を含む形式へ変えると、作成を止めて選び直しを求める（勝手に別の方式へ変えない）', async ({ page, request }) => {
  const seen = await setup(page, request);
  await chooseFormat(page, 'robin');
  await page.locator('#new-format').selectOption('fixed');
  await page.locator('#new-bestof').selectOption('4');
  await expect(page.locator('#new-format-error')).toBeHidden();
  await chooseFormat(page, 'robin_ko');
  // 選んだ値はそのまま（勝手に Leg 制へ変えない）。理由を示し、送信しない
  await expect(page.locator('#new-format')).toHaveValue('fixed');
  await expect(page.locator('#new-format-error')).toContainText('固定 Leg 数は使えません');
  expect(await page.locator('#new-format').evaluate((e) => e.validity.valid)).toBe(false);
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await page.waitForTimeout(500);
  expect(seen.length).toBe(0);
  // 形式を戻すと、選んでいた固定 4 Legs のまま送れる
  await chooseFormat(page, 'robin');
  await expect(page.locator('#new-format-error')).toBeHidden();
  await expect(page.locator('#new-bestof')).toHaveValue('4');
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0].payload.rule).toMatchObject({ format: 'fixed', bestOf: 4 });
});

test('スイス式: 決勝 0 人では 3 位決定戦を出さず false で送る。決勝ありへ戻すと選んでいた値が戻る。決勝ありでは固定 Leg 数を選べない', async ({ page, request }) => {
  const seen = await setup(page, request);
  await chooseFormat(page, 'swiss');
  const third = page.locator('#new-third');
  const submit = page.getByRole('button', { name: 'この内容で大会を作成' });
  await page.locator('#new-playoff-opt').fill('4');
  await expect(third).toBeVisible();
  await third.check();
  await expect(page.locator('#new-format option[value="fixed"]')).toHaveJSProperty('disabled', true);
  await page.locator('#new-playoff-opt').fill('0');
  await expect(third).toBeHidden();
  await expect(third).toBeDisabled();
  await expect(page.locator('#new-format option[value="fixed"]')).toHaveJSProperty('disabled', false);
  await submit.click();
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0].payload.thirdPlace).toBe(false);
  expect(seen[0].payload.playoff).toBe(0);
  await page.locator('#new-playoff-opt').fill('2');
  await expect(third).toBeVisible();
  await expect(third).toBeChecked(); // 下書きの値が戻る
  await submit.click();
  await expect.poll(() => seen.length).toBe(2);
  expect(seen[1].payload.thirdPlace).toBe(true);
  expect(seen[1].payload.playoff).toBe(2);
});

test('隠れた欄の不正な値は送信を妨げない。形式を往復しても関係する入力は残る。勝ち点の 3 つの欄にはそれぞれラベルがある', async ({ page, request }) => {
  const seen = await setup(page, request);
  // シリーズで節の数に範囲外の値を入れてから、別の形式へ
  await chooseFormat(page, 'series_playoff');
  await page.locator('#new-nights').fill('999');
  expect(await page.locator('#new-nights').evaluate((e) => e.validity.valid)).toBe(false);
  await chooseFormat(page, 'league');
  await expect(page.locator('#new-nights')).toBeHidden();
  await expect(page.locator('#new-nights')).toBeDisabled();
  await expect(page.getByLabel('勝ち', { exact: true })).toHaveValue('2');
  await expect(page.getByLabel('引き分け', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('負け', { exact: true })).toHaveValue('0');
  await page.getByLabel('勝ち', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0].payload.points).toEqual({ win: 3, draw: 1, loss: 0 });
  expect(seen[0].payload.nights).toBeUndefined();
  // 形式を往復: シリーズの入力も、リーグの入力も残っている
  await chooseFormat(page, 'series_playoff');
  await expect(page.locator('#new-nights')).toHaveValue('999');
  await chooseFormat(page, 'league');
  await expect(page.getByLabel('勝ち', { exact: true })).toHaveValue('3');
});

test('想定人数は見積もりだけ: この人数で成り立たなくても作成でき、人数は保存しない', async ({ page, request }) => {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  await organizerHome(page, request);
  await openCreate(page);
  await page.locator('#new-name').fill('人数が未確定の大会');
  await page.locator('#new-expected').fill('3');
  await page.locator('#new-groups').fill('4'); // 3 人を 4 組には分けられない
  await expect(page.locator('#new-estimate .estimate__warn').first()).toContainText('この人数では成り立ちません');
  const seen = await interceptAction(page, request, 'createEvent', async ({ pass }) => pass());
  await page.getByRole('button', { name: 'この内容で大会を作成' }).click();
  await expect(page.getByRole('heading', { name: '人数が未確定の大会' })).toBeVisible();
  expect(JSON.stringify(seen[0].payload)).not.toContain('expected');
  expect(seen[0].payload.players).toBeUndefined();
});
