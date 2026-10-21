// 閲覧者用 Web アプリ（実際のデプロイ URL）に、ヘッドレスブラウザで N 人分の閲覧画面を開いて計測する。
// 手順と判定基準は docs/load-test.md を参照。Google の本番環境に負荷をかけるため、実行は運営者の判断で行うこと。
//
//   node tournament-poc/tools/loadtest.mjs --url 'https://<ユーザー名>.github.io/<リポジトリ名>/?event=EVT-XXXX' \
//        --clients 50 --minutes 10 --ramp 60 [--interval 60] [--out result.json]
//   （閲覧者用 Web アプリの …/exec を直接指定することもできる）
//
// 前提: リポジトリ直下で `npm ci`（@playwright/test を使う）。ブラウザが無い場合は `npx playwright install chromium`。
import { writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const url = arg('url');
const clients = Number(arg('clients', 50));
const minutes = Number(arg('minutes', 10));
const reportSec = Number(arg('report', 30));
const rampSec = Number(arg('ramp', 60));
// 閲覧ページは更新が少ないと取得間隔を延ばす（v0.5.1〜）。負荷を一定にするため、既定で 60 秒に固定する（URL の interval で固定）
const interval = arg('interval', '60');
const out = arg('out', `loadtest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// 大会の指定（?event=EVT-…）は省略可。省略すると閲覧ページの既定の大会を開く
const EVENT_QUERY = '(\\?event=EVT-[A-Z0-9]+)?';
// --allow-local はローカル確認用サーバー（tools/preview-server.mjs）でスクリプト自体を試すときだけ使う
const allowLocal =
  process.argv.includes('--allow-local') && new RegExp(`^http://127\\.0\\.0\\.1:\\d+/(viewer|pages/index\\.html${EVENT_QUERY})$`).test(url || '');
// ローカルの Pages 版は、Apps Script への通信をブラウザ側で模擬サーバーの /viewer-json に振り替える（e2e と同じ）
const localPages = allowLocal && url.includes('/pages/');
// 閲覧者に配る URL（GitHub Pages の閲覧ページ）か、閲覧者用 Web アプリの …/exec
const isPages = new RegExp(`^https://[a-z0-9-]+\\.github\\.io/[A-Za-z0-9._-]+/${EVENT_QUERY}$`).test(url || '');
if (!allowLocal && !isPages && (!url || !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url))) {
  console.error("usage: node tools/loadtest.mjs --url 'https://<ユーザー名>.github.io/<リポジトリ名>/?event=EVT-XXXX' (または …/exec) [--clients 50] [--minutes 10] [--ramp 60] [--interval 60]");
  process.exit(2);
}

const targetUrl = new URL(url);
if (interval) targetUrl.searchParams.set('interval', interval);
const target = targetUrl.href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Apps Script の Web アプリは入れ子の iframe の中で動くので、計測値を持つフレームを探す */
async function readMetrics(page) {
  for (const frame of page.frames()) {
    try {
      const m = await frame.evaluate(() =>
        window.__tpocViewer
          ? { metrics: window.__tpocViewer.metrics, state: window.__tpocViewer.poller.state(), latencies: window.__tpocViewer.poller.latencies() }
          : null
      );
      if (m) return m;
    } catch {
      /* 別オリジンのフレームなど */
    }
  }
  return null;
}

function pct(list, p) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const browser = await chromium.launch({ executablePath });
const pages = [];
const loadErrors = [];
const startedAt = Date.now();
console.log(`target=${target} clients=${clients} minutes=${minutes} ramp=${rampSec}s`);

for (let i = 0; i < clients; i++) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  if (localPages) {
    await context.route('https://script.google.com/**', async (route) => {
      const r = await fetch(`${targetUrl.origin}/viewer-json${new URL(route.request().url()).search}`);
      await route.fulfill({ status: r.status, contentType: r.headers.get('content-type') || 'application/json', body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
    });
  }
  const page = await context.newPage();
  const t0 = Date.now();
  page
    .goto(target, { waitUntil: 'load', timeout: 60_000 })
    .then(() => pages.push({ i, page, loadMs: Date.now() - t0 }))
    .catch((e) => loadErrors.push({ i, message: e.message }));
  await sleep((rampSec * 1000) / clients);
}

const endAt = startedAt + minutes * 60_000;
while (Date.now() < endAt) {
  await sleep(Math.min(reportSec * 1000, Math.max(1000, endAt - Date.now())));
  const ms = (await Promise.all(pages.map((p) => readMetrics(p.page)))).filter(Boolean);
  const ok = ms.reduce((s, m) => s + m.metrics.success, 0);
  const ng = ms.reduce((s, m) => s + m.metrics.failure, 0);
  console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] pages=${pages.length}/${clients} measured=${ms.length} success=${ok} failure=${ng}`);
}

const results = [];
for (const p of pages) {
  const m = await readMetrics(p.page);
  results.push({ client: p.i, loadMs: p.loadMs, ...(m || { missing: true }) });
}
await browser.close();

const measured = results.filter((r) => !r.missing);
const latencies = measured.flatMap((r) => r.latencies);
const success = measured.reduce((s, r) => s + r.metrics.success, 0);
const failure = measured.reduce((s, r) => s + r.metrics.failure, 0);
const errors = {};
measured.forEach((r) => Object.entries(r.metrics.errors).forEach(([k, v]) => (errors[k] = (errors[k] || 0) + v)));
// 版ごとに「最初に見えた時刻」と「全員に行き渡った時刻」の差（反映の遅れのばらつき）
const versions = {};
measured.forEach((r) => Object.entries(r.metrics.versions).forEach(([v, at]) => {
  versions[v] = versions[v] || [];
  versions[v].push(at);
}));
const spread = Object.fromEntries(Object.entries(versions).map(([v, ats]) => [v, { clients: ats.length, firstSeen: new Date(Math.min(...ats)).toISOString(), spreadSec: (Math.max(...ats) - Math.min(...ats)) / 1000 }]));

const summary = {
  target,
  clients,
  minutes,
  opened: pages.length,
  measured: measured.length,
  loadErrors,
  requests: success + failure,
  success,
  failure,
  successRate: success + failure ? success / (success + failure) : null,
  errors,
  stale: measured.reduce((s, r) => s + r.metrics.stale, 0),
  notModified: measured.reduce((s, r) => s + r.metrics.notModified, 0),
  latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), max: latencies.length ? Math.max(...latencies) : null, samples: latencies.length },
  pageLoadMs: { p50: pct(pages.map((p) => p.loadMs), 50), p95: pct(pages.map((p) => p.loadMs), 95) },
  versions: spread,
};
writeFileSync(out, JSON.stringify({ summary, results }, null, 2));

// GitHub Actions で動かしたときは、判定基準（docs/load-test.md の 1.）との比較を実行結果の画面に出す
if (process.env.GITHUB_STEP_SUMMARY) {
  const jst = (iso) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const mark = (ok) => (ok === null ? '—' : ok ? '合格' : '**不合格**');
  const rows = [
    ['開けた画面 / 計測できた画面', `${pages.length} / ${measured.length}（${clients} 人中）`, mark(pages.length === clients && measured.length === clients)],
    ['取得の成功率（99% 以上）', summary.successRate === null ? '—' : `${(summary.successRate * 100).toFixed(2)}%（${success} / ${success + failure} 回）`, mark(summary.successRate === null ? null : summary.successRate >= 0.99)],
    ['応答時間 p95（5 秒以内）', summary.latencyMs.p95 === null ? '—' : `${summary.latencyMs.p95} ms（p50 ${summary.latencyMs.p50} ms・最大 ${summary.latencyMs.max} ms）`, mark(summary.latencyMs.p95 === null ? null : summary.latencyMs.p95 <= 5000)],
    ['失敗の内訳', Object.keys(errors).length ? Object.entries(errors).map(([k, v]) => `${k} ${v} 回`).join('、') : 'なし', '—'],
    ['予備キャッシュを返した回数', String(summary.stale), '—'],
    ['画面を開く時間 p50 / p95', `${summary.pageLoadMs.p50} / ${summary.pageLoadMs.p95} ms`, '—'],
  ];
  const md = [
    `## 負荷テストの結果（${clients} 人・${minutes} 分）`,
    '',
    `対象: ${target}`,
    '',
    '| 項目 | 結果 | 判定 |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    '### 公開データの版ごとの反映（運営画面で確定した時刻と比べて、反映までの秒数を求める）',
    '',
    '| 最初に表示された時刻（日本時間） | 全画面に行き渡るまで | 表示した画面数 |',
    '| --- | --- | --- |',
    ...Object.values(spread).sort((a, b) => a.firstSeen.localeCompare(b.firstSeen)).map((v) => `| ${jst(v.firstSeen)} | ${v.spreadSec} 秒 | ${v.clients} |`),
    '',
    errors.NO_PUBLIC_EVENT ? '**NO_PUBLIC_EVENT: 指定した大会が公開されていません。運営画面の「大会設定」で「閲覧画面に公開する」を確認してください。**\n' : '',
    'NETWORK（Google 側のエラー・通信失敗）が多いときは、閲覧者用 Apps Script の「実行数」で、同時実行数などの上限に関するエラーが出ていないか確認してください。',
    '',
    '詳しい数値は、この画面下の「Artifacts」の loadtest-result（JSON）にあります。',
    '',
  ].join('\n');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
console.log(JSON.stringify(summary, null, 2));
console.log(`saved: ${out}`);
