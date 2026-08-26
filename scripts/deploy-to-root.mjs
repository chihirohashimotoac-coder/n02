// Copies the freshly built web/dist/* onto the repo root, which is what GitHub
// Pages actually serves (no separate gh-pages branch / Pages build step exists
// for this repo). Old hashed asset files are removed first so bundles never
// accumulate across builds; the root n02-icon.svg (also used pre-build, e.g. by
// README/social previews) is left untouched since dist ships an identical copy.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'web', 'dist');

if (!existsSync(dist)) {
  console.error('web/dist not found - run `vite build` first.');
  process.exit(1);
}

const rootAssets = path.join(root, 'assets');
if (existsSync(rootAssets)) rmSync(rootAssets, { recursive: true, force: true });

for (const entry of readdirSync(dist, { withFileTypes: true })) {
  const from = path.join(dist, entry.name);
  const to = path.join(root, entry.name);
  if (entry.isDirectory()) {
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
  } else {
    cpSync(from, to);
  }
}

console.log('Deployed web/dist/* to repo root.');
