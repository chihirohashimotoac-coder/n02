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

const outputs = Object.assign({}, ...Object.entries(APPS).map(([n, s]) => buildApp(n, s)));
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
