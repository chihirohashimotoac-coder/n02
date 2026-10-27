// 確認用プレビューサイト（tools/preview-site）を実際に組み立てて操作する。
// 説明ページ（プレビューの表示・コミット）→ ポータルにサンプル → 主催者 A でログインして結果を入力 → 読み直しても残る →
// 主催者 B に切り替えると A の大会は運営できない → 「最初の状態に戻す」で元に戻る
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const poc = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
let out;
let server;
let base;

test.beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'tpoc-preview-'));
  execFileSync('node', [join(poc, 'tools', 'preview-site', 'build-preview-site.mjs'), out], { stdio: 'pipe', env: { ...process.env, VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567', VERCEL_GIT_COMMIT_REF: 'test-branch' } });
  server = createServer((req, res) => {
    let p = join(out, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(out)) return res.writeHead(403).end();
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  }));
});

test.afterAll(() => {
  server && server.close();
  out && rmSync(out, { recursive: true, force: true });
});

test('プレビューサイト: 説明ページ → サンプル → 主催者で結果を入力（読み直しても残る）→ 主催者の切り替え → 最初の状態に戻す', async ({ page }) => {
  test.setTimeout(120000);
  // 本物の Google・Apps Script には通信しない
  const external = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1' && u.protocol !== 'data:') external.push(r.url());
  });
  await page.goto(`${base}/index.html`);
  await expect(page.locator('.banner')).toHaveText('プレビュー・模擬データ・本番には保存されません');
  await expect(page.locator('#build-sha')).toHaveText('0123456789abcdef0123456789abcdef01234567');
  await expect(page.getByRole('row')).toHaveCount(14);

  // ポータル: 公開中のサンプル 14 件（v1.0 の期制リーグ 3 件を含む）。左下の目印にコミット
  await page.getByRole('link', { name: /ポータル/ }).click();
  await expect(page.getByText('公開中の大会 14 件')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('サンプル期制リーグ 第2期').first()).toBeVisible();
  await expect(page.getByText('サンプル 50 人リーグ 第1期').first()).toBeVisible();
  await expect(page.locator('.preview-badge')).toHaveText('プレビュー・模擬データ・本番には保存されません（0123456）');

  // 主催者 A でログインし、期制リーグの第 2 期（入替戦の結果待ち）を開く
  await page.goto(`${base}/site/admin/index.html`);
  await page.locator('.fake-gsi').first().click();
  await page.locator('.fake-gsi-account', { hasText: 'organizer@example.org' }).click();
  await page.locator('.event-card').filter({ hasText: 'サンプル期制リーグ 第2期' }).last().getByRole('button', { name: '開く' }).click();
  await page.getByRole('button', { name: '期・昇降格', exact: true }).click();
  await expect(page.getByText('期制リーグ「サンプル期制リーグ」 第2期')).toBeVisible();
  await expect(page.locator('table', { hasText: '1部・2部' }).first()).toContainText('未開始');
  await page.getByRole('button', { name: '← あなたの大会' }).click();
  // ダブルエリミのサンプルに結果を 1 試合入れる
  await page.locator('.event-card').filter({ hasText: 'サンプル: ダブルエリミネーション 5 名' }).last().getByRole('button', { name: '開く' }).click();
  await expect(page.getByRole('heading', { name: 'サンプル: ダブルエリミネーション 5 名' })).toBeVisible();
  await page.getByRole('button', { name: '試合結果', exact: true }).click();
  const card = page.locator('.match-editor:not(.match-editor--final):not(.match-editor--pending)').first();
  const id = await card.getAttribute('data-match-id');
  await card.locator('input').nth(0).fill('2');
  await card.locator('input').nth(1).fill('0');
  await card.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator(`.match-editor[data-match-id="${id}"]:not(.match-editor--final)`)).toHaveCount(0);
  await page.getByRole('button', { name: '進行状況', exact: true }).click();
  await expect(page.getByText(/確定 4 \/ /).first()).toBeVisible();

  // 読み直しても残る（このブラウザの中に記録して再生する）
  await page.reload();
  await page.getByRole('button', { name: '進行状況', exact: true }).click();
  await expect(page.getByText(/確定 4 \/ /).first()).toBeVisible({ timeout: 30000 });

  // 主催者 B に切り替えると、B の大会だけが出る（A の大会は運営できない）
  await page.goto(`${base}/site/admin/index.html`);
  await page.getByRole('button', { name: 'ログアウト' }).first().click();
  await page.locator('.fake-gsi').first().click();
  await page.locator('.fake-gsi-account', { hasText: 'other@example.net' }).click();
  await expect(page.locator('.event-card').filter({ hasText: 'サンプル: 2 ディビジョンのリーグ（固定 4 Legs）' })).toBeVisible();
  await expect(page.locator('.event-card').filter({ hasText: 'サンプル: ダブルエリミネーション 5 名' })).toHaveCount(0);

  // 最初の状態に戻す
  page.once('dialog', (d) => d.accept());
  await page.goto(`${base}/index.html`);
  await page.getByRole('button', { name: '最初の状態に戻す' }).click();
  await expect(page.getByText('戻しました。')).toBeVisible();
  await page.goto(`${base}/site/events/index.html`);
  const de = page.locator('*', { hasText: /^サンプル: ダブルエリミネーション 5 名$/ }).last();
  await expect(de).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(/確定\s*3\s*\/\s*9\s*試合/).first()).toBeVisible();
  // 戻すとログインも消える
  await page.goto(`${base}/site/admin/index.html`);
  await expect(page.locator('.fake-gsi').first()).toBeVisible();
  expect(external, '外部への通信').toEqual([]);
});
