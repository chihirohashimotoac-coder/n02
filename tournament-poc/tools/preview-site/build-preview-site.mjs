// 確認用プレビューサイトを組み立てる（Google にも本番の GitHub Pages にも接続しない、操作できる静的サイト）。
//
//   node tools/preview-site/build-preview-site.mjs <出力先フォルダ>
//
// 出力:
//   <出力先>/index.html        説明ページ（コミット・役割・サンプル・最初の状態に戻す）
//   <出力先>/site/n02/          n02 本体（「トーナメント・リーグ」の入口付き。リンク先はこのサイトのポータル）
//   <出力先>/site/events/       ポータル（dist/pages/events と同じファイル）
//   <出力先>/site/admin/        運営画面（dist/pages/admin と同じファイル）
//   <出力先>/site/index.html    閲覧ページ（dist/pages と同じファイル）
//   <出力先>/site/preview/      模擬 Apps Script（実物の Code.gs をブラウザ内で動かす）・模擬 Google ログイン
//
// 本番との違い（ここで書き換えるもの）:
//   - config.js・admin/config.js は模擬の URL（script.google.com/macros/s/PREVIEW-…/exec。通信はブラウザ内で受ける）
//   - Google のログインボタン（accounts.google.com/gsi/client）は模擬ボタン（fake-gsi.js）に、ボタン用のスタイル（gsi/style）は空のスタイルに差し替え
//   - CSP の meta を外す（置き場所の側の CSP に従う）。フォルダの URL は index.html を明示する
//   - n02 の Service Worker の登録を外す（置き場所によっては登録できないため）
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const poc = join(here, '..', '..');
const repo = join(poc, '..');
const out = process.argv[2];
if (!out) {
  console.error('usage: node tools/preview-site/build-preview-site.mjs <output-dir>');
  process.exit(1);
}
const site = join(out, 'site');
const STAFF_PASSWORD_TEXT = 'demo-staff-2026'; // mock-entry.mjs の STAFF_PASSWORD と同じ（プレビュー専用）
rmSync(site, { recursive: true, force: true });
mkdirSync(join(site, 'preview'), { recursive: true });

// 1. dist を最新に
execFileSync('node', [join(poc, 'tools', 'build.mjs')], { stdio: 'inherit' });

// 2. Code.gs を「サービスを受け取って doGet / doPost を返す関数」に包む（eval を使わずに読み込むため）
for (const app of ['admin', 'viewer']) {
  const code = readFileSync(join(poc, 'dist', app, 'Code.gs'), 'utf8');
  const wrapped =
    `/* dist/${app}/Code.gs をプレビュー用に包んだもの（tools/preview-site/build-preview-site.mjs が生成） */\n` +
    `window.__TPOC_GAS_${app.toUpperCase()} = function (G) {\n  with (G) {\n${code}\n` +
    `    return { doGet: typeof doGet === 'function' ? doGet : null, doPost: typeof doPost === 'function' ? doPost : null };\n  }\n};\n`;
  writeFileSync(join(site, 'preview', `gas-${app}.js`), wrapped);
}

// 3. 模擬 Apps Script（tests/gas-mock.mjs の模擬スプレッドシートを使う）を 1 ファイルに
const shim = (name) => join(here, 'shims', `node-${name}.mjs`);
execFileSync(
  join(repo, 'node_modules', '.bin', 'esbuild'),
  [
    join(here, 'mock-entry.mjs'),
    '--bundle',
    '--format=iife',
    '--target=es2020',
    `--outfile=${join(site, 'preview', 'mock.js')}`,
    `--alias:node:vm=${shim('vm')}`,
    `--alias:node:fs=${shim('fs')}`,
    `--alias:node:path=${shim('path')}`,
    `--alias:node:url=${shim('url')}`,
    `--alias:node:crypto=${shim('crypto')}`,
    '--define:import.meta.url="preview"',
    '--log-level=warning',
  ],
  { stdio: 'inherit' }
);
cpSync(join(here, 'fake-gsi.js'), join(site, 'preview', 'fake-gsi.js'));
cpSync(join(here, 'badge.js'), join(site, 'preview', 'badge.js'));

// 4. GitHub Pages 用のページ（dist/pages）を写し、プレビュー用に書き換える
cpSync(join(poc, 'dist', 'pages'), site, { recursive: true, filter: (src) => !/README\.md$|config\.example\.js$/.test(src) });
writeFileSync(join(site, 'config.js'), "window.TPOC_CONFIG = { endpoint: 'https://script.google.com/macros/s/PREVIEW-VIEWER/exec' };\n");
writeFileSync(
  join(site, 'admin', 'config.js'),
  "window.TPOC_ADMIN_CONFIG = { endpoint: 'https://script.google.com/macros/s/PREVIEW-ADMIN/exec', googleClientId: '000000000000-preview0mock.apps.googleusercontent.com', n02Url: '../n02/index.html', pageIndex: 'index.html' };\n"
);

function previewScripts(pageDir) {
  const rel = relative(join(site, pageDir), join(site, 'preview')) || '.';
  return ['build-info.js', 'gas-admin.js', 'gas-viewer.js', 'mock.js', 'fake-gsi.js', 'badge.js'].map((f) => `<script src="${rel}/${f}"></script>`).join('\n    ');
}

function rewritePage(file, pageDir) {
  let html = readFileSync(file, 'utf8');
  html = html
    .replace(/\s*<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/, '')
    .replace('<script src="https://accounts.google.com/gsi/client" async></script>', '')
    .replace(/<script src="/, () => previewScripts(pageDir) + '\n    <script src="')
    .replace('href="../events/"', 'href="../events/index.html"')
    .replace('class="to-portal" href="events/"', 'class="to-portal" href="events/index.html"');
  if (html.includes('accounts.google.com') || html.includes('Content-Security-Policy')) throw new Error('not rewritten: ' + file);
  writeFileSync(file, html);
}
// Google のボタン用のスタイル（accounts.google.com/gsi/style）もプレビュー用の空のスタイルにする（本物の Google に一切通信しない）
writeFileSync(join(site, 'preview', 'gsi-style.css'), '/* プレビュー: Google のボタン用スタイルの代わり（模擬ボタンは fake-gsi.js が描く） */\n');
for (const file of [join(site, 'admin', 'admin.js'), join(site, 'events', 'portal.js')]) {
  const js = readFileSync(file, 'utf8');
  const next = js.split("'https://accounts.google.com/gsi/style'").join("'../preview/gsi-style.css'").split('link[href^="https://accounts.google.com/gsi/style"]').join('link[href="../preview/gsi-style.css"]');
  // 説明のコメントに残る URL は除き、文字列として使っている箇所が残っていないこと
  if (/['"]https:\/\/accounts\.google\.com\/gsi\/style/.test(next)) throw new Error('not rewritten: ' + file);
  writeFileSync(file, next);
}
rewritePage(join(site, 'index.html'), '.');
rewritePage(join(site, 'admin', 'index.html'), 'admin');
rewritePage(join(site, 'events', 'index.html'), 'events');

// 5. n02 本体（入口のリンク先をこのサイトのポータルに）
const n02Out = join(site, 'n02');
execFileSync(join(repo, 'node_modules', '.bin', 'vite'), ['build', '--outDir', n02Out, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: repo,
  stdio: 'inherit',
  env: { ...process.env, VITE_TOURNAMENT_PORTAL_URL: '../events/index.html' },
});
const n02Index = join(n02Out, 'index.html');
let n02Html = readFileSync(n02Index, 'utf8')
  .replace(/\s*<script id="vite-plugin-pwa:register-sw" src="\.\/registerSW\.js"><\/script>/, '')
  .replace(/\s*<link rel="manifest" href="\.\/manifest\.webmanifest">/, '');
n02Html = n02Html.replace('</body>', '  <script src="../preview/build-info.js"></script>\n  <script src="../preview/badge.js"></script>\n  </body>');
writeFileSync(n02Index, n02Html);
for (const f of readdirSync(n02Out)) if (/^(sw\.js|workbox-.*\.js|registerSW\.js)$/.test(f)) rmSync(join(n02Out, f));

// 6. 説明ページ（<出力先>/index.html）とビルドの情報（コミット・時刻）。ページ左下の目印にもコミットを出す
const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || gitHead();
const ref = process.env.VERCEL_GIT_COMMIT_REF || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || gitBranch();
const builtAt = new Date();
const build = { sha, shortSha: sha ? sha.slice(0, 7) : '', ref, builtAt: builtAt.toISOString(), host: process.env.VERCEL ? 'Vercel' : process.env.GITHUB_ACTIONS ? 'GitHub Actions' : 'local' };
writeFileSync(join(site, 'preview', 'build-info.js'), `window.TPOC_PREVIEW_BUILD = ${JSON.stringify(build)};\n`);
writeFileSync(join(out, 'index.html'), landingPage(build));

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}
function gitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function landingPage(b) {
  const jst = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(b.builtAt));
  const samples = [
    ['予選ロビン→決勝トーナメント', 'サンプル: 予選ロビン→決勝（同順位あり）', '3 人の組で全員 1 勝 1 敗。「組み合わせ」→「進出を確認」で止まり、同順位を手で並べると進出できます。'],
    ['トーナメント', 'ウィークエンド・トーナメント（終了）', '8 名・3 位決定戦あり。管理パスワードでスタッフとして入れます。'],
    ['トーナメント（回戦ごとの抽選）', 'サンプル: 回戦ごとの抽選（シードは 2 回戦から）', '非公開。1 回戦が終わり、2 回戦の抽選（「次の回戦を抽選」）を試せます。'],
    ['ロビン→A/B トーナメント', 'ナイトカップ 11月', '準備中。結果を入れて A/B へ振り分けを試せます。'],
    ['ダブルエリミネーション', 'サンプル: ダブルエリミネーション 5 名', '勝者側・敗者側・グランドファイナル（リセットあり）。'],
    ['ロビン', '第12回 n02 オープン・水曜練習会（非公開）', 'v0.7 までと同じ総当たり。'],
    ['リーグ', 'サンプル: 2 ディビジョンのリーグ（固定 4 Legs）', '主催者 B。引き分け・勝ち点・毎週の日程・延期・お知らせ・ルールの表示。'],
    ['リーグ→プレーオフ', 'サンプル: リーグ→プレーオフ', '主催者 B。リーグ戦が終わり、上位 4 名のプレーオフへ進めます。'],
    ['複数段階ロビン→決勝', 'サンプル: 複数段階ロビン→決勝', '予選の上位が 2 次ロビンへ（成績は持ち越さない）。'],
    ['ポイントシリーズ→プレーオフ', 'サンプル: ポイントシリーズ 8 名・4 節', '第 1 節は終了（不戦勝あり）・第 2 節は中止・第 3 節は途中。累計ポイントと暫定。'],
    ['スイス式', 'サンプル: スイス式 7 名（不戦あり）', '第 2 回戦まで。不戦は同じ人に 2 回与えません。Buchholz の列。'],
    ['期制リーグ（v1.0）', 'サンプル期制リーグ 第1期・第2期', '主催者 A。第 1 期（10 人の総当たり）の順位から第 2 期を 2 部制で作成済み。第 2 期は入替戦の結果待ち。「試合結果」で入替戦を入力 →「期・昇降格」で第 3 期の配置をプレビュー・修正・確定。閲覧ページで前期・次期をたどれます。'],
    ['期制リーグ 50 人（v1.0）', 'サンプル 50 人リーグ 第1期', '主催者 B。1,225 試合のうち第 3 節まで確定。公開データは試合一覧を分けて公開し、閲覧ページは節を選んで表示します。'],
  ];
  const rows = samples.map(([f, name, note]) => `<tr><th scope="row">${esc(f)}</th><td>${esc(name)}</td><td>${esc(note)}</td></tr>`).join('\n          ');
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>n02 大会運営 プレビュー</title>
    <style>
      :root { color-scheme: light dark; --bg: #fff; --fg: #1b1b1f; --muted: #5b5d66; --line: #d9dbe1; --accent: #0b5cad; --warn-bg: #ffd43d; --warn-fg: #000; }
      @media (prefers-color-scheme: dark) { :root { --bg: #15161a; --fg: #ececf1; --muted: #a5a8b3; --line: #33353d; --accent: #7cb7ff; } }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.7 system-ui, -apple-system, 'Hiragino Sans', 'Noto Sans JP', sans-serif; }
      .banner { background: var(--warn-bg); color: var(--warn-fg); padding: 10px 16px; font-weight: 700; text-align: center; }
      main { max-width: 960px; margin: 0 auto; padding: 16px; }
      h1 { font-size: 1.5rem; margin: 16px 0 4px; }
      h2 { font-size: 1.1rem; margin: 28px 0 8px; border-bottom: 1px solid var(--line); padding-bottom: 4px; }
      .muted { color: var(--muted); }
      a { color: var(--accent); }
      .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; padding: 0; list-style: none; }
      .links a { display: block; border: 1px solid var(--line); border-radius: 10px; padding: 12px; text-decoration: none; }
      .links strong { display: block; color: var(--fg); }
      .table-wrap { overflow-x: auto; }
      table { border-collapse: collapse; width: 100%; min-width: 560px; }
      th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: top; }
      code { font-size: .92em; word-break: break-all; }
      button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
      dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0; }
      dt { color: var(--muted); }
      dd { margin: 0; min-width: 0; }
    </style>
  </head>
  <body>
    <div class="banner" role="note">プレビュー・模擬データ・本番には保存されません</div>
    <main>
      <h1>n02 大会運営 v0.8 プレビュー</h1>
      <p class="muted">実物の運営用・閲覧者用 Code.gs を、ブラウザの中の模擬環境（模擬スプレッドシート・模擬 Google ログイン）で動かしています。本物の Google・Apps Script・大会データ・GitHub Pages には一切接続しません。操作の内容はこのブラウザの中だけに残ります。</p>
      <dl>
        <dt>コミット</dt><dd><code id="build-sha">${esc(b.sha || '不明')}</code></dd>
        <dt>ブランチ</dt><dd>${esc(b.ref || '不明')}</dd>
        <dt>ビルド</dt><dd>${esc(jst)}（${esc(b.host)}）</dd>
      </dl>

      <h2>画面</h2>
      <ul class="links">
        <li><a href="site/events/index.html"><strong>ポータル（大会一覧）</strong>公開中の大会・作成した大会</a></li>
        <li><a href="site/admin/index.html"><strong>運営画面</strong>大会の作成・運営（Google でログイン）</a></li>
        <li><a href="site/index.html"><strong>閲覧ページ</strong>既定の大会の表示</a></li>
        <li><a href="site/n02/index.html"><strong>n02 本体</strong>上部の「トーナメント・リーグ」から入口へ</a></li>
      </ul>

      <h2>役割の切り替え</h2>
      <ul>
        <li><strong>主催者 A</strong>（organizer@example.org）・<strong>主催者 B</strong>（other@example.net）: 運営画面・ポータルの「Google でログイン」で選びます（模擬のログイン）。自分の大会だけを運営できます。ログアウトして選び直すと切り替わります。</li>
        <li><strong>スタッフ</strong>: ログインせずに大会の運営画面を開き、管理パスワード <code>${esc(STAFF_PASSWORD_TEXT)}</code> を入力（「ウィークエンド・トーナメント」に設定済み）。</li>
        <li><strong>共同主催者</strong>: 主催者 A の大会の「大会設定」→「共同主催者」に other@example.net を追加し、主催者 B でログインし直します。</li>
        <li><strong>閲覧者</strong>: 閲覧ページ・ポータルはログイン不要です。</li>
      </ul>

      <h2>サンプル大会（10 形式）</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th scope="col">形式</th><th scope="col">大会</th><th scope="col">試せること</th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table>
      </div>
      <p class="muted">新しい大会は、運営画面でログインした後の「大会を作成」から 10 形式すべてで作れます（CSV の取込・抽選・予定・不戦勝・印刷・CSV 出力・JSON の保存と復元なども試せます）。大会の作成は本番と同じく主催者 1 人あたり 1 時間に 5 件までです（主催者 B に切り替えるとさらに作れます）。</p>

      <h2>最初の状態に戻す</h2>
      <p>このブラウザに残した操作をすべて消し、サンプル大会だけの状態に戻します（他の人のプレビューには影響しません）。</p>
      <p><button type="button" id="reset">最初の状態に戻す</button> <span id="reset-done" class="muted" hidden>戻しました。</span></p>
    </main>
    <script>
      document.getElementById('reset').addEventListener('click', function () {
        if (!window.confirm('このブラウザのプレビューの操作をすべて消して、最初の状態に戻しますか？')) return;
        try {
          Object.keys(window.localStorage).filter(function (k) { return k.indexOf('tpoc-') === 0 || k.indexOf('tpoc_') === 0; }).forEach(function (k) { window.localStorage.removeItem(k); });
          Object.keys(window.sessionStorage).filter(function (k) { return k.indexOf('tpoc') === 0; }).forEach(function (k) { window.sessionStorage.removeItem(k); });
        } catch (e) {}
        document.getElementById('reset-done').hidden = false;
      });
    </script>
  </body>
</html>
`;
}

const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
console.log(`preview site: ${site} (${count(site)} files)`);
if (!existsSync(join(site, 'events', 'index.html'))) process.exit(1);
