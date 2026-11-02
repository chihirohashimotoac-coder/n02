// 01 Arrangement Support の「基準ルート（Standard Route）」を n02 へ写す生成スクリプト。
//
//   npm run import:routes -- <01ArrangementSupport の作業コピー>          # 生成
//   npm run import:routes -- <01ArrangementSupport の作業コピー> --check  # 差分確認だけ
//
// 写す範囲は 01ArrangementSupport の getStandardRoute()（残り 3 本）と同じ:
//   - 2〜40   : src/data/lowStandardRoutes.ts の導出結果（01AS の承認済み方針 A-4）
//   - 41〜170 : src/data/standardCheckoutRoutes.generated.ts の Excel 第1候補
// n02 はラウンド合計で入力するため、残り 2 本の表（twoDartStandardRoutes.ts）は写さない。
//
// 01ArrangementSupport 側の 2 ファイルは import を持たない TypeScript なので、
// Node の型除去（Node 22.18 以降は既定で有効）でそのまま読み込める。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, 'src', 'domain', 'standardCheckoutRoutes.generated.ts');

const args = process.argv.slice(2);
const check = args.includes('--check');
const sourceDir = args.find((arg) => !arg.startsWith('--'));
if (!sourceDir) {
  console.error('usage: node scripts/import-standard-routes.mjs <01ArrangementSupport の作業コピー> [--check]');
  process.exit(1);
}

const lowFile = path.resolve(sourceDir, 'src/data/lowStandardRoutes.ts');
const excelFile = path.resolve(sourceDir, 'src/data/standardCheckoutRoutes.generated.ts');
for (const file of [lowFile, excelFile]) {
  if (!existsSync(file)) {
    console.error(`見つかりません: ${file}`);
    process.exit(1);
  }
}

const { DERIVED_LOW_ROUTES } = await import(pathToFileURL(lowFile).href);
const { EXCEL_STANDARD_ROWS } = await import(pathToFileURL(excelFile).href);

/** @type {Map<number, string[]>} */
const routes = new Map();
for (const row of DERIVED_LOW_ROUTES) routes.set(row.left, [...row.darts]);
for (const row of EXCEL_STANDARD_ROWS) {
  if (routes.has(row.left)) {
    console.error(`残り ${row.left} が 2 系統の両方にあります`);
    process.exit(1);
  }
  routes.set(row.left, [...row.standard]);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', sourceDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // git でない作業コピーでも生成はできる（出典コミットは unknown と記録する）。
}

const lefts = [...routes.keys()].sort((a, b) => a - b);
const body = lefts.map((left) => `  ${left}: [${routes.get(left).map((id) => `'${id}'`).join(', ')}],`).join('\n');

const content = `/**
 * 自動生成ファイル — 直接編集しないこと。
 *
 * 生成元 : chihirohashimotoac-coder/01ArrangementSupport ${commit}
 *          src/data/lowStandardRoutes.ts（残り 2〜40）
 *          src/data/standardCheckoutRoutes.generated.ts（残り 41〜170、Excel 第1候補）
 * 生成器 : scripts/import-standard-routes.mjs
 * 再生成 : node scripts/import-standard-routes.mjs <01ArrangementSupport の作業コピー>
 *
 * 01 Arrangement Support の基準ルート（残り 3 本）。アレンジルート表示はこの表だけを使う。
 * 表記は 01 Arrangement Support と同じ（S/D/T + 数字、SB = アウターブル、BULL = インブル）。
 * 収録 ${lefts.length} 件。2〜170 のうち表に無い残りは 3 本で上がれない Bogey Number。
 */
export const STANDARD_CHECKOUT_ROUTES: Readonly<Record<number, readonly string[]>> = {
${body}
};
`;

if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  // 出典コミットの行だけ違う場合は、表の中身が同じなので一致とみなす。
  const strip = (text) => text.replace(/^ \* 生成元 : .*$/m, '');
  if (strip(current) !== strip(content)) {
    console.error('src/domain/standardCheckoutRoutes.generated.ts が 01ArrangementSupport の基準ルートと一致しません。');
    process.exit(1);
  }
  console.log(`一致: ${lefts.length} 件`);
} else {
  writeFileSync(target, content);
  console.log(`生成: ${path.relative(root, target)}（${lefts.length} 件、出典 ${commit}）`);
}
