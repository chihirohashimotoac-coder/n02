// Apps Script へ貼り付ける完成版（dist/）を src/ から組み立てる。
//   node tools/build.mjs          … dist/ を書き出す
//   node tools/build.mjs --check  … dist/ が src/ と一致しているか確認（CI 用）
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const APPS = {
  admin: { label: '運営者用', css: 'admin.css', js: 'admin.js' },
  viewer: { label: '閲覧者用', css: 'viewer.css', js: 'viewer.js' },
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
  const code = header + files.map((f) => `\n// ---- ${f} ----\n` + read(`${serverDir}/${f}`)).join('');

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
function buildPages() {
  const template = read('viewer/src/client/index.html');
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    'connect-src https://script.google.com https://script.googleusercontent.com',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  let html = template
    .replace('    <base target="_top" />\n', '')
    .replace(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
        `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n` +
        '    <meta name="referrer" content="no-referrer" />'
    )
    .replace(/<style>\s*\/\*@@STYLES@@\*\/\s*<\/style>/, '<link rel="stylesheet" href="viewer.css" />')
    .replace(/<script>\s*\/\*@@SCRIPT@@\*\/\s*<\/script>/, '<script src="config.js"></script>\n    <script src="viewer.js"></script>');
  if (html.includes('@@') || html.includes('<base')) throw new Error('pages template not converted');
  const header = '/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */\n';
  return {
    'dist/pages/index.html': html,
    'dist/pages/viewer.css': header + read('viewer/src/client/viewer.css'),
    'dist/pages/viewer.js': header + read('viewer/src/client/viewer.js'),
    'dist/pages/config.example.js': read('viewer/src/pages/config.example.js'),
    'dist/pages/README.md': read('viewer/src/pages/README.md'),
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
