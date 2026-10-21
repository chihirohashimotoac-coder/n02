// 確認用プレビューサイトを組み立てる（Google にも本番の GitHub Pages にも接続しない、操作できる静的サイト）。
//
//   node tools/preview-site/build-preview-site.mjs <出力先フォルダ>
//
// 出力:
//   <出力先>/site/n02/          n02 本体（「トーナメント・リーグ」の入口付き。リンク先はこのサイトのポータル）
//   <出力先>/site/events/       ポータル（dist/pages/events と同じファイル）
//   <出力先>/site/admin/        運営画面（dist/pages/admin と同じファイル）
//   <出力先>/site/index.html    閲覧ページ（dist/pages と同じファイル）
//   <出力先>/site/preview/      模擬 Apps Script（実物の Code.gs をブラウザ内で動かす）・模擬 Google ログイン
//
// 本番との違い（ここで書き換えるもの）:
//   - config.js・admin/config.js は模擬の URL（script.google.com/macros/s/PREVIEW-…/exec。通信はブラウザ内で受ける）
//   - Google のログインボタン（accounts.google.com/gsi/client）は模擬ボタン（fake-gsi.js）に差し替え
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
  return ['gas-admin.js', 'gas-viewer.js', 'mock.js', 'fake-gsi.js', 'badge.js'].map((f) => `<script src="${rel}/${f}"></script>`).join('\n    ');
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
n02Html = n02Html.replace('</body>', '  <script src="../preview/badge.js"></script>\n  </body>');
writeFileSync(n02Index, n02Html);
for (const f of readdirSync(n02Out)) if (/^(sw\.js|workbox-.*\.js|registerSW\.js)$/.test(f)) rmSync(join(n02Out, f));

const count = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0);
console.log(`preview site: ${site} (${count(site)} files)`);
if (!existsSync(join(site, 'events', 'index.html'))) process.exit(1);
