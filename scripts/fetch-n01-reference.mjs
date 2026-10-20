/**
 * Downloads the n01 (Web) files that src/domain/x01Stats.n01.test.ts runs as the reference for the
 * play-screen statistics, and refuses any file whose SHA-256 is not the pinned one.
 *
 * The files are n01's own work and are NOT part of this repository (see README): they are cached
 * outside the tracked tree, in node_modules/.cache/n01-reference (or $N01_REFERENCE_DIR), and only
 * ever executed inside the test's jsdom sandbox.
 *
 * Pinned version. n01_stats.js is the `?a=16` build - the one whose Checkout Prediction is
 * getCheckoutCount(). `?a=17` (what stats.html links today) replaces it with n01_checkout_est.js and
 * is deliberately not used. The `?a=` values are cache keys on n01darts.com's CDN, so each URL keeps
 * the query it was pinned with.
 *
 *   node scripts/fetch-n01-reference.mjs
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const referenceDir = process.env.N01_REFERENCE_DIR ?? join(root, 'node_modules', '.cache', 'n01-reference');

const BASE = 'https://n01darts.com/n01/web/';

export const referenceFiles = [
  { name: 'n01_stats.js', url: `${BASE}n01_v2/js/n01_stats.js?a=16`, sha256: 'e8764747bf9e24c8c216a608cedee25fbbf402ea86e00378e3a3840d110fdd5f' },
  { name: 'n01.js', url: `${BASE}n01_v2/js/n01.js?a=65`, sha256: '6144e48e4004249e3f7a557075643a58e1b2fd453164e4f72145f365025e89cd' },
  { name: 'n01_data.js', url: `${BASE}n01_v2/js/n01_data.js?a=7`, sha256: '5d351236d27e7333e3540551e4fc4c97834eb661b933661054c20c898fc27414' },
  { name: 'n01_util.js', url: `${BASE}n01_v2/js/n01_util.js?a=2`, sha256: 'b0baa8a5107dd743af4ff26403e605aa300fbf9fb9f675d558f8404e5fc08b9d' },
  { name: 'jquery-3.6.0.min.js', url: `${BASE}n01_v2/js/jquery-3.6.0.min.js`, sha256: 'ff1523fb7389539c84c65aba19260648793bb4f5e29329d2ee8804bc37a3fe6e' },
  { name: 'n01.html', url: `${BASE}n01.html`, sha256: 'eebd10f84a7bc58b677edbb148d62e331747210d8f149c937926c7d5def37bd7' },
  { name: 'stats.html', url: `${BASE}n01_v2/stats.html`, sha256: '90ec10dfe0244a7e91444ce9c2892cc456c7dde4fb762a2314ddb3403956d7bf' },
];

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function cached(file) {
  try {
    const bytes = await readFile(join(referenceDir, file.name));
    return sha256(bytes) === file.sha256;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(referenceDir, { recursive: true });
  let failed = false;
  for (const file of referenceFiles) {
    if (await cached(file)) {
      console.log(`ok (cached)  ${file.name}`);
      continue;
    }
    const response = await fetch(file.url);
    if (!response.ok) {
      console.error(`FAILED  ${file.name}: HTTP ${response.status} from ${file.url}`);
      failed = true;
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== file.sha256) {
      console.error(`FAILED  ${file.name}: SHA-256 ${actual}, pinned ${file.sha256} (${file.url})`);
      failed = true;
      continue;
    }
    await writeFile(join(referenceDir, file.name), bytes);
    console.log(`ok          ${file.name}`);
  }
  if (failed) process.exit(1);
  console.log(`n01 reference files in ${referenceDir}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
