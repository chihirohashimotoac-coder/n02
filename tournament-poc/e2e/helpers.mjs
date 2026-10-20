// 画面テスト共通の操作
import { expect } from '@playwright/test';

export async function reset(request, opts = {}) {
  await request.post('/__reset', { data: opts });
}

export async function setFault(request, app, mode) {
  await request.post('/__fault', { data: { app, mode } });
}

let seq = 0;
/** 模擬 google.script.run と同じ経路で運営者用 API を呼ぶ（画面操作の前提データ作成用） */
export async function adminCall(request, action, payload = {}, as = '') {
  const res = await request.post('/rpc/admin', {
    data: { fn: 'adminCall', args: [{ action, payload, requestId: `e2e-request-${Date.now()}-${++seq}` }], as },
  });
  const body = await res.json();
  return body.ok ? body.value : { ok: false, error: { code: 'RPC', message: body.error } };
}

/** 初期化済み・サンプル大会を公開した状態を作る */
export async function publishedSample(request) {
  await reset(request, { configured: true });
  await adminCall(request, 'initializeStorage');
  const res = await adminCall(request, 'createSampleEvent', { publish: true });
  expect(res.ok).toBe(true);
  return res.data.detail;
}

/** 横スクロールが発生していないこと（スマートフォン表示の確認） */
export async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
