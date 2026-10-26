// 大会運営の本番反映（main へのマージ後に .github/workflows/tournament-deploy.yml から実行）。
//
//   node tournament-poc/tools/deploy/deploy.mjs <command> [--dry-run]
//
//   gas           検証 → バックアップ（現在のコード・デプロイの版番号）→ 運営用 GAS の更新 → スキーマの移行 →
//                 閲覧者用 GAS の更新 → 動作確認（release が今回のコミットか）
//   pages         dist/pages を閲覧リポジトリの作業コピーに写し、release.json を置く（config.js・admin/config.js・README.md は残す）
//   verify-pages  GitHub Pages の release.json が今回のコミットになるまで待つ
//   rollback      デプロイを指定の版番号に戻す（ROLLBACK_ADMIN_VERSION・ROLLBACK_VIEWER_VERSION）
//   summary       ここまでの記録と、戻すときの手順を GitHub Actions の実行結果（Job summary）に書く
//
// --dry-run: Google への書き込み・移行・Pages の変更をせず、設定・権限・対象の確認とバックアップだけを行う。
//
// 環境変数（ワークフローが設定する）:
//   GITHUB_SHA                         反映するコミット
//   TOURNAMENT_CLASPRC_JSON (Secret)   clasp login 後の ~/.clasprc.json（refresh token）
//   TOURNAMENT_ADMIN_KEY    (Secret)   運営用のスクリプト プロパティ ADMIN_KEY と同じ値（移行の実行に使う）
//   TOURNAMENT_ADMIN_SCRIPT_ID         運営用 Apps Script のスクリプト ID
//   TOURNAMENT_VIEWER_SCRIPT_ID        閲覧者用 Apps Script のスクリプト ID
//   TOURNAMENT_PAGES_URL               閲覧リポジトリの GitHub Pages の URL（末尾 /）
//   VIEWER_SITE_DIR                    閲覧リポジトリの作業コピー（デプロイ ID は、その config.js・admin/config.js の URL から読む）
//   TOURNAMENT_DEPLOY_STATE            実行の記録（JSON）の置き場所
//   TOURNAMENT_BACKUP_DIR              バックアップの置き場所（ワークフローの成果物として保存する）
//
// 推測した ID は使わない: デプロイ ID は公開中のページの設定から読み、スクリプト ID と組み合わせて
// Apps Script API で実在を確かめ、さらに現在のコードが本アプリのもの（運営用・閲覧者用）であることを確かめてから書き込む。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessToken, createGasApi, parseClasprc } from './gas-api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const POC = join(here, '..', '..');
const EXEC_URL = (deploymentId) => `https://script.google.com/macros/s/${deploymentId}/exec`;
const ENDPOINT_RE = /https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]{20,})\/exec/;
const SCRIPT_ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
/** 閲覧リポジトリで残すファイル（各環境の設定・説明）。dist/pages の同名ファイルでは上書きしない */
export const PRESERVED = ['config.js', 'admin/config.js', 'README.md', 'CNAME', '.nojekyll'];

export class DeployError extends Error {}

function fail(message) {
  throw new DeployError(message);
}

/* ---------- 設定 ---------- */

export function readEndpoint(file, label) {
  if (!existsSync(file)) fail(`${label} がありません（${file}）。閲覧リポジトリに config を置いてから実行してください。`);
  const m = readFileSync(file, 'utf8').match(ENDPOINT_RE);
  if (!m) fail(`${label} に Apps Script の URL（https://script.google.com/macros/s/…/exec）が見つかりません。`);
  return m[1];
}

export function loadConfig(env) {
  const sha = env.GITHUB_SHA || '';
  if (!SHA_RE.test(sha)) fail('GITHUB_SHA が正しくありません。');
  const adminScriptId = (env.TOURNAMENT_ADMIN_SCRIPT_ID || '').trim();
  const viewerScriptId = (env.TOURNAMENT_VIEWER_SCRIPT_ID || '').trim();
  if (!SCRIPT_ID_RE.test(adminScriptId)) fail('変数 TOURNAMENT_ADMIN_SCRIPT_ID が未設定か、スクリプト ID の形ではありません。');
  if (!SCRIPT_ID_RE.test(viewerScriptId)) fail('変数 TOURNAMENT_VIEWER_SCRIPT_ID が未設定か、スクリプト ID の形ではありません。');
  if (adminScriptId === viewerScriptId) fail('運営用と閲覧者用のスクリプト ID が同じです。');
  const pagesUrl = (env.TOURNAMENT_PAGES_URL || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.github\.io\/[A-Za-z0-9._-]+\/$/.test(pagesUrl)) fail('変数 TOURNAMENT_PAGES_URL は https://<ユーザー>.github.io/<リポジトリ>/ の形で設定してください（末尾の / を含む）。');
  const site = env.VIEWER_SITE_DIR || '';
  if (!site || !existsSync(join(site, '.git'))) fail('VIEWER_SITE_DIR（閲覧リポジトリの作業コピー）がありません。');
  const viewerDeploymentId = readEndpoint(join(site, 'config.js'), '閲覧リポジトリの config.js');
  const adminDeploymentId = readEndpoint(join(site, 'admin', 'config.js'), '閲覧リポジトリの admin/config.js');
  if (viewerDeploymentId === adminDeploymentId) fail('config.js と admin/config.js が同じ Web アプリを指しています。');
  return { sha, adminScriptId, viewerScriptId, adminDeploymentId, viewerDeploymentId, pagesUrl, site };
}

/* ---------- 反映するコード ---------- */

/** dist の Code.gs の release の目印を、今回のコミットに置き換える（ちょうど 1 か所であること） */
export function stampRelease(code, varName, sha) {
  const marker = `var ${varName} = 'manual';`;
  const count = code.split(marker).length - 1;
  if (count !== 1) fail(`${varName} の目印が ${count} か所あります（1 か所のはず）。`);
  return code.replace(marker, `var ${varName} = '${sha}';`);
}

export function gasFiles(app, sha, dist = join(POC, 'dist')) {
  const dir = join(dist, app);
  const files = [
    { name: 'appsscript', type: 'JSON', source: readFileSync(join(dir, 'appsscript.json'), 'utf8') },
    { name: 'Code', type: 'SERVER_JS', source: stampRelease(readFileSync(join(dir, 'Code.gs'), 'utf8'), app === 'admin' ? 'RELEASE_ID_' : 'VIEWER_RELEASE_ID_', sha) },
  ];
  if (app === 'viewer') files.push({ name: 'Index', type: 'HTML', source: readFileSync(join(dir, 'Index.html'), 'utf8') });
  return files;
}

/** 今の GAS のコードが本アプリのものか（違うプロジェクトを上書きしない）・Web アプリの公開設定が変わらないか */
export function checkCurrentContent(app, content, files) {
  const list = (content && content.files) || [];
  const code = list.filter((f) => f.type === 'SERVER_JS').map((f) => f.source || '').join('\n');
  const mark = app === 'admin' ? "app: 'n02-tournament-admin-api'" : "'n02-tournament-viewer'";
  const legacyMark = app === 'admin' ? 'ADMIN_CONFIG' : 'VIEWER_CONFIG';
  if (!code.includes(mark) && !code.includes(legacyMark)) fail(`${app === 'admin' ? '運営用' : '閲覧者用'}のスクリプト ID が、このアプリではないプロジェクトを指しています（上書きしません）。`);
  const manifest = list.find((f) => f.name === 'appsscript');
  const curManifest = manifest ? JSON.parse(manifest.source) : {};
  const nextManifest = JSON.parse(files.find((f) => f.name === 'appsscript').source);
  const cur = curManifest.webapp || {};
  const next = nextManifest.webapp || {};
  // 権限（スコープ）が増える版は、所有者がエディタで承認し直すまで Web アプリが動かなくなるため、自動では反映しない
  const added = (nextManifest.oauthScopes || []).filter((x) => (curManifest.oauthScopes || []).indexOf(x) === -1);
  if (added.length) fail(`${app === 'admin' ? '運営用' : '閲覧者用'}の権限が増えます（${added.join(', ')}）。所有者がエディタで承認し直す必要があるため止めます（手順は deploy.md）。`);
  if (cur.executeAs !== next.executeAs || cur.access !== next.access) {
    fail(`${app === 'admin' ? '運営用' : '閲覧者用'}の Web アプリの公開設定（実行ユーザー・アクセスできるユーザー）が今と変わります（今: ${cur.executeAs}/${cur.access}・新: ${next.executeAs}/${next.access}）。人の判断が必要なため止めます。`);
  }
  const ver = (code.match(/APP_VERSION:\s*'([^']+)'/) || [])[1] || '不明';
  return { version: ver };
}

/* ---------- 記録 ---------- */

export function createRecorder(env, log = console.log) {
  const file = env.TOURNAMENT_DEPLOY_STATE;
  // 同じ実行の前の手順（gas → pages → verify-pages）の記録に続けて書く
  const state = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { sha: env.GITHUB_SHA, startedAt: new Date().toISOString(), steps: [], previous: {}, created: {} };
  const save = () => {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  };
  return {
    state,
    step(name, status, detail) {
      state.steps.push({ name, status, detail: detail || '', at: new Date().toISOString() });
      log(`${status === 'done' ? '✔' : status === 'skipped' ? '－' : status === 'failed' ? '✘' : '・'} ${name}${detail ? ': ' + detail : ''}`);
      save();
    },
    save,
  };
}

export function summaryMarkdown(state, cfg) {
  const lines = ['## 大会運営の本番反映', '', `コミット: \`${state.sha}\``, '', '| 手順 | 結果 | 内容 |', '| --- | --- | --- |'];
  state.steps.forEach((s) => lines.push(`| ${s.name} | ${{ done: '完了', skipped: '省略', failed: '**失敗**', info: '確認' }[s.status] || s.status} | ${String(s.detail).replace(/\|/g, '\\|')} |`));
  const p = state.previous || {};
  if (p.admin || p.viewer) {
    lines.push('', '### 戻すとき（ロールバック）', '');
    lines.push('Actions の「Tournament deploy」を手動実行し、mode に `rollback`、版番号に次を入れます（Web アプリの URL は変わりません）。');
    if (p.admin) lines.push(`- 運営用: 版 ${p.admin.versionNumber ?? '（HEAD）'}`);
    if (p.viewer) lines.push(`- 閲覧者用: 版 ${p.viewer.versionNumber ?? '（HEAD）'}`);
    lines.push('- スプレッドシート: 移行の前の内容は、同じスプレッドシートの `bak-s1-…` シートに残っています（旧版のコードは移行後のシートでも動きます）。');
    if (cfg) lines.push(`- GitHub Pages: 閲覧リポジトリの直前のコミットを revert します（${cfg.pagesUrl}release.json で今の版を確認できます）。`);
  }
  return lines.join('\n') + '\n';
}

/* ---------- 共通 ---------- */

function defaultIo() {
  return {
    fetch: (...a) => fetch(...a),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    remoteMain: () => execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { cwd: POC, encoding: 'utf8' }).split(/\s/)[0],
    isAncestor: (a, b) => {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', a, b], { cwd: POC, stdio: 'ignore' });
        return true;
      } catch (e) {
        return false;
      }
    },
    log: console.log,
  };
}

/** main がこのコミットより先に進んでいたら止める（後の実行が新しい版を反映する。古い版で上書きしない） */
export function assertNotStale(io, sha) {
  const head = io.remoteMain();
  if (head !== sha) fail(`main が先に進んでいます（main: ${String(head).slice(0, 7)}・この実行: ${sha.slice(0, 7)}）。古い版で上書きしないよう止めます（新しい実行が反映します）。`);
}

async function getJson(io, url, opts) {
  const res = await io.fetch(url, { redirect: 'follow', ...opts });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch (e) {
    return { status: res.status, json: null, text: text.slice(0, 200) };
  }
}

async function retry(io, times, waitMs, fn) {
  let last;
  for (let i = 0; i < times; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < times - 1) await io.sleep(waitMs);
    }
  }
  throw last;
}

/* ---------- gas ---------- */

/**
 * 今動いている運営用 GAS（旧版 v0.6.0 も含む）の既存の読み取り API（bootstrap）を管理者の鍵で呼び、
 * 管理者として認証できること・保存先が設定済み・開ける・初期化済みであることを確かめる。
 * スキーマの移行が必要なこと（新しい版で判定。旧版の応答には項目がない）は止める理由にしない。
 * 鍵・保存先の ID・大会のデータはログに出さない（判定に使う項目だけを見る）。
 */
export async function checkAdminAccess(io, cfg, adminKey, rec) {
  const body = JSON.stringify({ action: 'bootstrap', payload: {}, requestId: `deploy-check-${cfg.sha}`.slice(0, 64), auth: { adminKey } });
  const res = await io.fetch(EXEC_URL(cfg.adminDeploymentId), { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body });
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch (e) {
    json = null;
  }
  if (!json || typeof json !== 'object') fail(`運営用 GAS の応答が JSON ではありません（HTTP ${res.status}）。Web アプリの URL・公開設定を確認してください。`);
  if (!json.ok) {
    const code = json.error && typeof json.error.code === 'string' ? json.error.code : '不明';
    if (code === 'AUTH_INVALID' || code === 'FORBIDDEN') fail(`運営用 GAS に管理者として認証できません（${code}）。Secret TOURNAMENT_ADMIN_KEY が運営用のスクリプト プロパティ ADMIN_KEY と同じか確認してください。`);
    fail(`運営用 GAS の確認でエラーになりました（${code}）。`);
  }
  const data = json.data || {};
  const role = data.role || {};
  const st = data.storage || {};
  if (role.kind !== 'admin' || role.isPlatformAdmin !== true) fail('運営用 GAS に管理者として認証できません（管理者の権限で応答しませんでした）。Secret TOURNAMENT_ADMIN_KEY を確認してください。');
  if (st.configured !== true) fail('運営用 GAS の保存先（スプレッドシート）が未設定です。');
  if (st.accessible !== true) fail('運営用 GAS が保存先（スプレッドシート）を開けません（共有・権限を確認してください）。');
  if (st.initialized !== true) fail('運営用 GAS の保存先が初期化されていません（管理者画面で「初期化する」を済ませてから反映してください）。');
  rec.step('管理者の認証・保存先の確認', 'done', '管理者として認証・保存先は設定済み・開ける・初期化済み' + (st.migrationRequired === true ? '（スキーマの移行が必要）' : st.migrationRequired === false ? '' : '（旧版。移行の要否は新しい版で判定）'));
}

export async function runGas(env, { dryRun = false, io = defaultIo(), dist } = {}) {
  const rec = createRecorder(env, io.log);
  const cfg = loadConfig(env);
  rec.step('設定の確認', 'done', `運営用デプロイ ${cfg.adminDeploymentId.slice(0, 8)}…・閲覧者用デプロイ ${cfg.viewerDeploymentId.slice(0, 8)}…（閲覧リポジトリの config から）`);
  if (!env.TOURNAMENT_CLASPRC_JSON) fail('Secret TOURNAMENT_CLASPRC_JSON がありません。');
  if (!env.TOURNAMENT_ADMIN_KEY) fail('Secret TOURNAMENT_ADMIN_KEY がありません（管理者としての確認とスキーマの移行に使います）。');
  // GAS への最初の書き込みの前に、今動いている運営用 GAS に管理者として認証でき、保存先が使える状態かを確かめる（dry-run でも）
  await checkAdminAccess(io, cfg, env.TOURNAMENT_ADMIN_KEY, rec);
  const token = await accessToken(parseClasprc(env.TOURNAMENT_CLASPRC_JSON), io.fetch);
  const api = createGasApi(token, io.fetch);
  const apps = {
    admin: { scriptId: cfg.adminScriptId, deploymentId: cfg.adminDeploymentId, files: gasFiles('admin', cfg.sha, dist), label: '運営用' },
    viewer: { scriptId: cfg.viewerScriptId, deploymentId: cfg.viewerDeploymentId, files: gasFiles('viewer', cfg.sha, dist), label: '閲覧者用' },
  };
  // バックアップ: 今のコードとデプロイの版番号を記録する（戻すときに使う）
  for (const [app, a] of Object.entries(apps)) {
    const dep = await api.getDeployment(a.scriptId, a.deploymentId);
    const versionNumber = dep && dep.deploymentConfig ? dep.deploymentConfig.versionNumber : undefined;
    const content = await api.getContent(a.scriptId);
    const cur = checkCurrentContent(app, content, a.files);
    if (env.TOURNAMENT_BACKUP_DIR) {
      mkdirSync(env.TOURNAMENT_BACKUP_DIR, { recursive: true });
      writeFileSync(join(env.TOURNAMENT_BACKUP_DIR, `${app}-content.json`), JSON.stringify(content, null, 2));
      writeFileSync(join(env.TOURNAMENT_BACKUP_DIR, `${app}-deployment.json`), JSON.stringify(dep, null, 2));
    }
    rec.state.previous[app] = { versionNumber: versionNumber === undefined ? null : versionNumber, appVersion: cur.version };
    rec.step(`${a.label}のバックアップ`, 'done', `今の版 ${versionNumber ?? 'HEAD'}（v${cur.version}）`);
  }
  if (dryRun) {
    rec.step('書き込み', 'skipped', 'dry-run（Google への書き込み・移行はしていません）');
    return rec.state;
  }
  const publish = async (app) => {
    const a = apps[app];
    assertNotStale(io, cfg.sha);
    await api.updateContent(a.scriptId, a.files);
    const ver = await api.createVersion(a.scriptId, `n02 ${cfg.sha.slice(0, 7)}`);
    rec.state.created[app] = { versionNumber: ver.versionNumber };
    await api.updateDeployment(a.scriptId, a.deploymentId, ver.versionNumber, `n02 ${cfg.sha}`);
    rec.step(`${a.label} GAS の更新`, 'done', `版 ${rec.state.previous[app].versionNumber ?? 'HEAD'} → ${ver.versionNumber}（URL は同じ）`);
  };
  // 1. 運営用（移行は新しい版のコードにある。移行前は閲覧だけでき、書き込みは MIGRATION_REQUIRED で止まる）
  await publish('admin');
  const adminUrl = EXEC_URL(cfg.adminDeploymentId);
  await retry(io, 6, 10000, async () => {
    const r = await getJson(io, adminUrl);
    if (!r.json || r.json.release !== cfg.sha) throw new DeployError('運営用 GAS がまだ新しい版で応答しません。');
  });
  // 2. スキーマの移行（管理者の鍵。何度呼んでも安全。バックアップのシートを作ってから列を足す）
  const body = JSON.stringify({ action: 'migrateStorage', payload: {}, requestId: `deploy-migrate-${cfg.sha}`.slice(0, 64), auth: { adminKey: env.TOURNAMENT_ADMIN_KEY } });
  const mig = await getJson(io, adminUrl, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body });
  if (!mig.json || !mig.json.ok) fail('スキーマの移行に失敗しました: ' + (mig.json && mig.json.error ? mig.json.error.code + ' ' + mig.json.error.message : 'HTTP ' + mig.status));
  const mr = mig.json.data.migrateResult || {};
  if (mig.json.data.storage && mig.json.data.storage.migrationRequired) fail('移行の後も migrationRequired のままです。');
  rec.step('スキーマの移行', 'done', mr.migrated ? `v${mr.from} → v${mr.to}（バックアップのシートあり）` : '移行済み（変更なし）');
  // 3. 閲覧者用
  await publish('viewer');
  // 4. 動作確認
  await retry(io, 6, 10000, async () => {
    const a = await getJson(io, adminUrl);
    const v = await getJson(io, EXEC_URL(cfg.viewerDeploymentId) + '?format=version');
    const l = await getJson(io, EXEC_URL(cfg.viewerDeploymentId) + '?format=list');
    if (!a.json || a.json.release !== cfg.sha || a.json.schema !== 2) throw new DeployError('運営用 GAS の応答が想定と違います。');
    if (!v.json || v.json.release !== cfg.sha) throw new DeployError('閲覧者用 GAS の応答が想定と違います。');
    if (!l.json || l.json.ok !== true) throw new DeployError('閲覧者用 GAS の大会一覧が読めません。');
  });
  rec.step('GAS の動作確認', 'done', '運営用・閲覧者用とも今回のコミットで応答。大会一覧を読めました');
  return rec.state;
}

/* ---------- pages ---------- */

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).split('\\').join('/')];
  });
}

export function runPages(env, { dryRun = false, io = defaultIo(), dist } = {}) {
  const rec = createRecorder(env, io.log);
  const cfg = loadConfig(env);
  const src = join(dist || join(POC, 'dist'), 'pages');
  const releaseFile = join(cfg.site, 'release.json');
  if (existsSync(releaseFile)) {
    const cur = JSON.parse(readFileSync(releaseFile, 'utf8'));
    if (cur.sha && cur.sha !== cfg.sha && !io.isAncestor(cur.sha, cfg.sha)) fail(`閲覧リポジトリには、このコミットより新しい（または別系統の）版 ${String(cur.sha).slice(0, 7)} が出ています。古い版で上書きしないよう止めます。`);
  }
  const files = walk(src).filter((f) => !PRESERVED.includes(f) && !/(^|\/)config\.example\.js$/.test(f) && f !== 'README.md');
  // 例のファイル（config.example.js）は閲覧リポジトリにも置く（設定の手本）
  const examples = walk(src).filter((f) => /(^|\/)config\.example\.js$/.test(f));
  if (dryRun) {
    rec.step('Pages の更新', 'skipped', `dry-run（${files.length + examples.length} ファイルを写す予定。config.js・admin/config.js・README.md は残す）`);
    return rec.state;
  }
  assertNotStale(io, cfg.sha);
  [...files, ...examples].forEach((f) => {
    mkdirSync(dirname(join(cfg.site, f)), { recursive: true });
    cpSync(join(src, f), join(cfg.site, f));
  });
  const version = (readFileSync(join(POC, 'admin', 'src', 'server', '00_config.js'), 'utf8').match(/APP_VERSION:\s*'([^']+)'/) || [])[1] || '';
  writeFileSync(releaseFile, JSON.stringify({ sha: cfg.sha, version, publishedAt: new Date().toISOString() }, null, 2) + '\n');
  rec.step('Pages の更新（作業コピー）', 'done', `${files.length + examples.length} ファイル・release.json（v${version}）`);
  return rec.state;
}

export async function runVerifyPages(env, { io = defaultIo(), attempts = 40, waitMs = 15000 } = {}) {
  const rec = createRecorder(env, io.log);
  const cfg = loadConfig(env);
  await retry(io, attempts, waitMs, async () => {
    const r = await getJson(io, cfg.pagesUrl + 'release.json?ts=' + Date.now());
    if (!r.json || r.json.sha !== cfg.sha) throw new DeployError(`GitHub Pages の release.json がまだ ${r.json ? String(r.json.sha).slice(0, 7) : '読めない'} です。`);
  });
  const c = await io.fetch(cfg.pagesUrl + 'config.js?ts=' + Date.now());
  if (!(await c.text()).includes(cfg.viewerDeploymentId)) fail('公開中の config.js が閲覧者用 GAS を指していません。');
  rec.step('Pages の公開確認', 'done', `${cfg.pagesUrl}release.json が今回のコミット`);
  return rec.state;
}

/* ---------- rollback ---------- */

export async function runRollback(env, { io = defaultIo() } = {}) {
  const rec = createRecorder(env, io.log);
  const cfg = loadConfig(env);
  const token = await accessToken(parseClasprc(env.TOURNAMENT_CLASPRC_JSON || fail('Secret TOURNAMENT_CLASPRC_JSON がありません。')), io.fetch);
  const api = createGasApi(token, io.fetch);
  const targets = [
    ['admin', cfg.adminScriptId, cfg.adminDeploymentId, env.ROLLBACK_ADMIN_VERSION, '運営用'],
    ['viewer', cfg.viewerScriptId, cfg.viewerDeploymentId, env.ROLLBACK_VIEWER_VERSION, '閲覧者用'],
  ];
  if (!targets.some((t) => t[3])) fail('戻す版番号（ROLLBACK_ADMIN_VERSION / ROLLBACK_VIEWER_VERSION）を指定してください。');
  for (const [, scriptId, deploymentId, ver, label] of targets) {
    if (!ver) continue;
    if (!/^\d{1,6}$/.test(String(ver))) fail(`${label}の版番号が数字ではありません。`);
    const dep = await api.getDeployment(scriptId, deploymentId);
    const from = dep.deploymentConfig ? dep.deploymentConfig.versionNumber : 'HEAD';
    await api.updateDeployment(scriptId, deploymentId, Number(ver), `rollback to ${ver} by ${cfg.sha.slice(0, 7)}`);
    rec.step(`${label}のロールバック`, 'done', `版 ${from} → ${ver}`);
  }
  return rec.state;
}

/* ---------- CLI ---------- */

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const env = process.env;
  try {
    if (command === 'gas') await runGas(env, { dryRun });
    else if (command === 'pages') runPages(env, { dryRun });
    else if (command === 'verify-pages') await runVerifyPages(env);
    else if (command === 'rollback') await runRollback(env);
    else if (command === 'summary') {
      let cfg = null;
      try {
        cfg = loadConfig(env);
      } catch (e) {
        cfg = null;
      }
      const md = summaryMarkdown(createRecorder(env, () => {}).state, cfg);
      if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, md, { flag: 'a' });
      else console.log(md);
    } else fail('command: gas | pages | verify-pages | rollback | summary');
  } catch (e) {
    // 失敗した手順を記録に残す（どこまで反映されたかを summary で示す）。秘密の値はエラーの文に含めていない
    createRecorder(env, console.log).step(command || '(なし)', 'failed', (e && e.message) || String(e));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
