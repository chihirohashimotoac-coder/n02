// Apps Script へ貼り付ける完成版（dist/）を src/ から組み立てる。
//   node tools/build.mjs          … dist/ を書き出す
//   node tools/build.mjs --check  … dist/ が src/ と一致しているか確認（CI 用）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

// admin は API だけの Web アプリ（画面は GitHub Pages の dist/pages/admin/）。viewer は画面も持つ
const APPS = {
  admin: { label: '運営用', html: false },
  viewer: { label: '閲覧者用', html: true, css: 'viewer.css', js: 'viewer.js' },
};

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function buildApp(name, spec) {
  const serverDir = `${name}/src/server`;
  const files = readdirSync(join(root, serverDir))
    .filter((f) => f.endsWith('.js'))
    .sort();
  const header =
    `// ==== n02 Tournament PoC ${spec.label} Web アプリ / Code.gs ====\n` +
    `// このファイルは tools/build.mjs が ${serverDir}/*.js から生成したものです。直接編集しないでください。\n`;
  // shared/ は運営用・閲覧者用の両方に入れる（大会一覧の要約など、公開データの形を読むだけの処理）
  const shared = ['shared/summary.js'];
  const code =
    header +
    files.map((f) => `\n// ---- ${f} ----\n` + read(`${serverDir}/${f}`)).join('') +
    shared.map((f) => `\n// ---- ${f} ----\n` + read(f)).join('');
  if (!spec.html) {
    return {
      [`dist/${name}/Code.gs`]: code,
      [`dist/${name}/appsscript.json`]: read(`${name}/appsscript.json`),
    };
  }

  const template = read(`${name}/src/client/index.html`);
  const css = read(`${name}/src/client/${spec.css}`);
  const js = read(`${name}/src/client/${spec.js}`);
  if (js.includes('</script')) throw new Error(`${spec.js} must not contain "</script"`);
  if (css.includes('</style')) throw new Error(`${spec.css} must not contain "</style"`);
  const html = template
    .replace('/*@@STYLES@@*/', () => css)
    .replace('/*@@SCRIPT@@*/', () => js);
  if (html.includes('@@STYLES@@') || html.includes('@@SCRIPT@@')) throw new Error('placeholder left in ' + name);

  return {
    [`dist/${name}/Code.gs`]: code,
    [`dist/${name}/Index.html`]: html,
    [`dist/${name}/appsscript.json`]: read(`${name}/appsscript.json`),
  };
}

/**
 * GitHub Pages 用の閲覧ページ（Google の外に置く静的ページ）。閲覧画面と同じ HTML・CSS・JS を使い、
 * 通信だけを config.js の endpoint（閲覧者用 Web アプリの ?format=json）への fetch に切り替える。
 * インラインのスクリプトを持たないので、CSP で script-src 'self' に絞れる。
 */
function toStaticPage(templatePath, css, js, connect, opts = {}) {
  // qrcode.js（同梱ライブラリ）は画面のスクリプトより先に読む
  // opts.google: Google のログインボタン（Google Identity Services）を使う。CSP は Google の案内どおり
  // https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy
  const gsi = opts.google ? ' https://accounts.google.com/gsi/' : '';
  const csp = [
    "default-src 'none'",
    `script-src 'self'${opts.google ? ' https://accounts.google.com/gsi/client' : ''}`,
    `style-src 'self'${opts.google ? ' https://accounts.google.com/gsi/style' : ''}`,
    "img-src 'self' data:",
    `connect-src ${connect}${gsi}`,
    ...(opts.google ? [`frame-src${gsi}`] : []),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  // Google のログインはページの出どころ（origin）で許可を確かめるので、運営ページは origin だけを送る。
  // URL の # 以降（大会 ID）は Referer に含まれない。閲覧ページは何も送らない
  const referrer = opts.google ? 'strict-origin' : 'no-referrer';
  const html = read(templatePath)
    .replace('    <base target="_top" />\n', '')
    .replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
        `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n` +
        `    <meta name="referrer" content="${referrer}" />`
    )
    .replace(/<style>\s*\/\*@@STYLES@@\*\/\s*<\/style>/, `<link rel="stylesheet" href="${css}" />`)
    .replace(
      /<script>\s*\/\*@@SCRIPT@@\*\/\s*<\/script>/,
      (opts.google ? '<script src="https://accounts.google.com/gsi/client" async></script>\n    ' : '') +
        `<script src="config.js"></script>\n    <script src="qrcode.js"></script>\n    <script src="${js}"></script>`
    );
  if (html.includes('@@') || html.includes('<base')) throw new Error('pages template not converted: ' + templatePath);
  return html;
}

/**
 * GitHub Pages に置く静的ページ（Google の外）。
 * - 閲覧ページ（ルート）: 閲覧者用 Web アプリの ?format=json を fetch で読む
 * - 運営ページ（admin/）: 運営用 Web アプリへ fetch（POST）で操作を送る
 * どちらもインラインのスクリプトを持たないので、CSP で script-src 'self' に絞れる。
 */
function buildPages() {
  const connect = 'https://script.google.com https://script.googleusercontent.com';
  const header = '/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */\n';
  const qrcode = read('vendor/qrcode-generator/qrcode.js');
  return {
    'dist/pages/qrcode.js': qrcode,
    'dist/pages/admin/qrcode.js': qrcode,
    'dist/pages/index.html': toStaticPage('viewer/src/client/index.html', 'viewer.css', 'viewer.js', connect),
    'dist/pages/viewer.css': header + read('viewer/src/client/viewer.css'),
    'dist/pages/viewer.js': header + read('viewer/src/client/viewer.js'),
    'dist/pages/config.example.js': read('viewer/src/pages/config.example.js'),
    'dist/pages/README.md': read('viewer/src/pages/README.md'),
    'dist/pages/admin/index.html': toStaticPage('admin/src/client/index.html', 'admin.css', 'admin.js', connect, { google: true }),
    'dist/pages/admin/admin.css': header + read('admin/src/client/admin.css'),
    'dist/pages/admin/admin.js': header + read('admin/src/client/admin.js'),
    'dist/pages/admin/config.example.js': read('admin/src/pages/config.example.js'),
  };
}

const outputs = Object.assign({}, ...Object.entries(APPS).map(([n, s]) => buildApp(n, s)), buildPages());
let stale = [];
for (const [path, content] of Object.entries(outputs)) {
  const full = join(root, path);
  if (check) {
    if (!existsSync(full) || readFileSync(full, 'utf8') !== content) stale.push(path);
  } else {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}
if (check && stale.length) {
  console.error('dist/ is out of date. Run `node tools/build.mjs`:\n  ' + stale.join('\n  '));
  process.exit(1);
}
console.log(check ? 'dist/ is up to date.' : 'built: ' + Object.keys(outputs).join(', '));
