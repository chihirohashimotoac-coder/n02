// 運営画面の通知（.toast-box）: 表示中も、その下にある入力欄・ボタンをそのまま操作できること。
// 通知は画面下に重ねて出る（通常 4 秒・エラー 8 秒）。重なった入力欄を、通知が消えるのを待たずに
// 実際のタップ／クリックで操作できることを確かめる（通知の文言・読み上げ・表示時間は変えない）。
import { test, expect } from '@playwright/test';
import { routeAppsScript, publishedSample, fakeGoogle, googleLogin, ORGANIZER } from './helpers.mjs';

const ADMIN_PAGE = '/pages/admin/index.html';

for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`通知の表示中も、重なった試合結果の入力欄を操作できる（${viewport.width}×${viewport.height}）`, async ({ page, request }, testInfo) => {
    const sample = await publishedSample(request);
    await page.setViewportSize(viewport);
    await routeAppsScript(page, request);
    await fakeGoogle(page, request, ORGANIZER);
    await page.goto(`${ADMIN_PAGE}#e=${sample.event.id}`);
    await googleLogin(page);
    await page.getByRole('button', { name: '試合結果', exact: true }).click();
    await page.getByRole('button', { name: 'グループD', exact: true }).click();
    const ids = sample.groups[3].matches.map((m) => m.id);
    const card = (i) => page.locator(`.match-editor[data-match-id="${ids[i]}"]`);

    // 1 試合を確定 → 「結果を確定しました。」の通知が画面下に出る
    await card(0).locator('input').nth(0).fill('3');
    await card(0).locator('input').nth(1).fill('0');
    await card(0).getByRole('button', { name: '確定', exact: true }).click();
    const toast = page.locator('#toast .toast', { hasText: '結果を確定しました。' });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(page.locator('#toast')).toHaveAttribute('aria-live', 'polite');

    // 通知の真下に来るまで、ホイールで画面を動かす（スクリプトでのスクロールはしない）
    const box = await page.locator('#toast').boundingBox();
    const inputs = page.locator('.match-editor:not(.match-editor--final) input');
    let target = null;
    for (let step = 0; step < 30 && !target; step += 1) {
      for (const input of await inputs.all()) {
        const r = await input.boundingBox();
        if (!r) continue;
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (cx > box.x + 4 && cx < box.x + box.width - 4 && cy > box.y + 4 && cy < box.y + box.height - 4) {
          target = { input, x: cx, y: cy };
          break;
        }
      }
      if (!target) {
        await page.mouse.move(viewport.width / 2, viewport.height / 3);
        await page.mouse.wheel(0, 60);
        await page.waitForTimeout(30);
      }
    }
    expect(target, 'no result input could be brought under the notification').not.toBeNull();
    await expect(toast).toBeVisible();

    // その位置の最前面は通知ではなく入力欄で、実際のクリックが入力欄に届く
    const topmost = await page.evaluate(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit ? { tag: hit.tagName, inToast: !!hit.closest('#toast') } : null;
    }, [target.x, target.y]);
    expect(topmost).toEqual({ tag: 'INPUT', inToast: false });
    await page.mouse.click(target.x, target.y);
    await expect(target.input).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('2');
    await expect(target.input).toHaveValue('2');
    // 通知はまだ表示中（消えるのを待って操作したのではない）
    await expect(toast).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('toast-over-input.png') });
  });
}
