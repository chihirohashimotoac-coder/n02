// 閲覧者用 Web アプリ（実際のデプロイ URL）に、ヘッドレスブラウザで N 人分の閲覧画面を開いて計測する。
// 手順と判定基準は docs/load-test.md を参照。Google の本番環境に負荷をかけるため、実行は運営者の判断で行うこと。
//
//   node tournament-poc/tools/loadtest.mjs --url https://script.google.com/macros/s/XXXX/exec \
//        --clients 50 --minutes 10 --ramp 60 [--interval 60] [--out result.json]
//
// 前提: リポジトリ直下で `npm ci`（@playwright/test を使う）。ブラウザが無い場合は `npx playwright install chromium`。
import { writeFileSync, existsSync } from 'node:fs';
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
const interval = arg('interval', '');
const out = arg('out', `loadtest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const executablePath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// --allow-local はローカル確認用サーバー（tools/preview-server.mjs）でスクリプト自体を試すときだけ使う
const allowLocal = process.argv.includes('--allow-local') && /^http:\/\/127\.0\.0\.1:\d+\/viewer$/.test(url || '');
if (!allowLocal && (!url || !/^https:\/\/script\.google\.com\/.+\/exec$/.test(url))) {
  console.error('usage: node tools/loadtest.mjs --url https://script.google.com/macros/s/…/exec [--clients 50] [--minutes 10] [--ramp 60] [--interval 60]');
  process.exit(2);
}

const target = interval ? `${url}?interval=${encodeURIComponent(interval)}` : url;
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
console.log(JSON.stringify(summary, null, 2));
console.log(`saved: ${out}`);
