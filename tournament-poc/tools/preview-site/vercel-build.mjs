// PR プレビュー（Vercel）のビルド。vercel.json の buildCommand（npm run build:preview-host）から呼ぶ。
//
//   1. n02 本体: npm run build:preview（tsc -b && vite build → web/dist。本番の GitHub Pages の成果物は書かない）
//   2. Vercel の production 以外（プレビュー・ローカル）では、大会運営の確認用プレビューサイトを web/dist/tournament/ に足す
//      （実物の Code.gs をブラウザ内の模擬環境で動かす。本物の Google・Apps Script・大会データには接続しない）。
//      n02 本体の「トーナメント・リーグ」の入口も、そのプレビューのポータルを指す
//
// Secrets は使わない（必要もない）。production（VERCEL_ENV=production）では 1 だけを行い、従来と同じ成果物になる。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const preview = process.env.VERCEL_ENV !== 'production';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execFileSync(npm, ['run', 'build:preview'], {
  cwd: repo,
  stdio: 'inherit',
  // N02_TOURNAMENT_PREVIEW: n02 の Service Worker が /tournament/ への移動を n02 のトップで置き換えないようにする（vite.config.ts）
  env: preview ? { ...process.env, VITE_TOURNAMENT_PORTAL_URL: './tournament/site/events/index.html', N02_TOURNAMENT_PREVIEW: '1' } : process.env,
});

if (preview) {
  const out = join(repo, 'web', 'dist', 'tournament');
  execFileSync('node', [join(here, 'build-preview-site.mjs'), out], { cwd: repo, stdio: 'inherit' });
  if (!existsSync(join(out, 'index.html')) || !existsSync(join(out, 'site', 'events', 'index.html'))) {
    console.error('tournament preview was not built');
    process.exit(1);
  }
  console.log('tournament preview: web/dist/tournament/index.html (commit ' + (process.env.VERCEL_GIT_COMMIT_SHA || 'local') + ')');
}
