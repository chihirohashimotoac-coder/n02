// 本番反映（tools/deploy）: Google の API は模擬。呼ぶ順序・書き込む前に止める条件・秘密を出さないことを確かめる
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGas, runPages, runRollback, runVerifyPages, summaryMarkdown, createRecorder, stampRelease } from '../tools/deploy/deploy.mjs';
import { parseClasprc, accessToken } from '../tools/deploy/gas-api.mjs';

const SHA = 'a'.repeat(40);
const ADMIN_SCRIPT = 'ADMINscript0123456789abcdefghij';
const VIEWER_SCRIPT = 'VIEWERscript0123456789abcdefghi';
const ADMIN_DEP = 'AKfycbADMINdeployment0123456789';
const VIEWER_DEP = 'AKfycbVIEWERdeployment012345678';
const REFRESH = 'refresh-token-SECRET-1234567890';
const TOKEN = 'ya29.ACCESS-TOKEN-SECRET';
const ADMIN_KEY = 'admin-key-SECRET-0123456789abcdef';
const CLASPRC = JSON.stringify({ tokens: { default: { client_id: 'cid.apps.googleusercontent.com', client_secret: 'csecret', refresh_token: REFRESH, type: 'authorized_user' } } });
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
const WEBAPP = (access = 'ANYONE_ANONYMOUS') => JSON.stringify({ timeZone: 'Asia/Tokyo', oauthScopes: SCOPES, webapp: { executeAs: 'USER_DEPLOYING', access } });

function site() {
  const dir = mkdtempSync(join(tmpdir(), 'viewer-site-'));
  mkdirSync(join(dir, '.git'));
  mkdirSync(join(dir, 'admin'));
  writeFileSync(join(dir, 'config.js'), `window.TPOC_CONFIG = { endpoint: 'https://script.google.com/macros/s/${VIEWER_DEP}/exec' };\n`);
  writeFileSync(join(dir, 'admin', 'config.js'), `window.TPOC_ADMIN_CONFIG = { endpoint: 'https://script.google.com/macros/s/${ADMIN_DEP}/exec', googleClientId: 'x' };\n`);
  writeFileSync(join(dir, 'README.md'), '# 閲覧リポジトリの説明（残す）\n');
  return dir;
}

function envFor(dir, extra = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'deploy-state-'));
  return {
    GITHUB_SHA: SHA,
    TOURNAMENT_CLASPRC_JSON: CLASPRC,
    TOURNAMENT_ADMIN_KEY: ADMIN_KEY,
    TOURNAMENT_ADMIN_SCRIPT_ID: ADMIN_SCRIPT,
    TOURNAMENT_VIEWER_SCRIPT_ID: VIEWER_SCRIPT,
    TOURNAMENT_PAGES_URL: 'https://example.github.io/n02-tournament-viewer/',
    VIEWER_SITE_DIR: dir,
    TOURNAMENT_DEPLOY_STATE: join(tmp, 'state.json'),
    TOURNAMENT_BACKUP_DIR: join(tmp, 'backup'),
    ...extra,
  };
}

/** 模擬の Google（トークン・Apps Script API・Web アプリ） */
function fakeGoogle(opts = {}) {
  const calls = [];
  const deployed = { admin: { version: 7, release: 'old' }, viewer: { version: 4, release: 'old' } };
  const nextVersion = { admin: 7, viewer: 4 };
  let migrated = false;
  const content = {
    admin: { files: [{ name: 'appsscript', type: 'JSON', source: WEBAPP(opts.adminAccess) }, { name: 'コード', type: 'SERVER_JS', source: opts.adminCode || "var ADMIN_CONFIG = { APP_VERSION: '0.7.1' }; function doGet(){ return { app: 'n02-tournament-admin-api' }; }" }] },
    viewer: { files: [{ name: 'appsscript', type: 'JSON', source: WEBAPP() }, { name: 'コード', type: 'SERVER_JS', source: "var VIEWER_CONFIG = { APP_VERSION: '0.7.1' };" }, { name: 'Index', type: 'HTML', source: '<p>' }] },
  };
  const uploaded = {};
  const appOf = (id) => (id === ADMIN_SCRIPT ? 'admin' : id === VIEWER_SCRIPT ? 'viewer' : null);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url: String(url), body: init.body ? String(init.body) : '', auth: init.headers && init.headers.authorization });
    const u = new URL(url);
    if (u.href === 'https://oauth2.googleapis.com/token') {
      if (opts.tokenFails) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: TOKEN, expires_in: 3599 });
    }
    if (u.host === 'script.googleapis.com') {
      if (init.headers.authorization !== 'Bearer ' + TOKEN) return json(401, { error: { status: 'UNAUTHENTICATED', message: 'no' } });
      const m = u.pathname.match(/^\/v1\/projects\/([^/]+)\/(content|versions|deployments)(?:\/([^/]+))?$/);
      const app = m && appOf(decodeURIComponent(m[1]));
      if (!app) return json(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } });
      const depId = app === 'admin' ? ADMIN_DEP : VIEWER_DEP;
      if (m[2] === 'content' && method === 'GET') return json(200, { scriptId: m[1], files: content[app].files });
      if (m[2] === 'content' && method === 'PUT') {
        uploaded[app] = JSON.parse(init.body).files;
        return json(200, {});
      }
      if (m[2] === 'versions' && method === 'POST') return json(200, { versionNumber: ++nextVersion[app] });
      if (m[2] === 'deployments' && m[3] === depId && method === 'GET') return json(200, { deploymentId: depId, deploymentConfig: { versionNumber: deployed[app].version } });
      if (m[2] === 'deployments' && m[3] === depId && method === 'PUT') {
        const v = JSON.parse(init.body).deploymentConfig.versionNumber;
        deployed[app] = { version: v, release: v > (app === 'admin' ? 7 : 4) ? SHA : 'old' };
        return json(200, {});
      }
      return json(404, { error: { status: 'NOT_FOUND', message: 'deployment' } });
    }
    if (u.host === 'script.google.com') {
      const dep = u.pathname.split('/')[3];
      if (dep === ADMIN_DEP && method === 'POST') {
        const req = JSON.parse(init.body);
        if (req.auth.adminKey !== ADMIN_KEY || req.action !== 'migrateStorage') return json(200, { ok: false, error: { code: 'FORBIDDEN', message: 'x' } });
        const res = { ok: true, data: { migrateResult: { migrated: !migrated, from: 1, to: 2 }, storage: { migrationRequired: false } } };
        migrated = true;
        return json(200, res);
      }
      if (dep === ADMIN_DEP) return json(200, { ok: true, release: deployed.admin.release, schema: deployed.admin.release === SHA ? 2 : undefined });
      if (dep === VIEWER_DEP && u.searchParams.get('format') === 'version') return json(200, { ok: true, release: deployed.viewer.release });
      if (dep === VIEWER_DEP && u.searchParams.get('format') === 'list') return json(200, { ok: true, events: [] });
    }
    if (u.host === 'example.github.io') {
      if (u.pathname.endsWith('/release.json')) return json(200, opts.pagesRelease || { sha: SHA });
      if (u.pathname.endsWith('/config.js')) return { ok: true, status: 200, text: async () => `endpoint: 'https://script.google.com/macros/s/${VIEWER_DEP}/exec'` };
    }
    return json(404, {});
  };
  return { fetch, calls, uploaded, deployed, isMigrated: () => migrated };
}

function io(g, extra = {}) {
  const logs = [];
  return { fetch: g.fetch, sleep: async () => {}, remoteMain: () => SHA, isAncestor: () => true, log: (m) => logs.push(m), logs, ...extra };
}

const writes = (g) => g.calls.filter((c) => c.method !== 'GET' && !c.url.startsWith('https://oauth2'));

test('clasp の認証情報: 3.x と 2.x の形式を読める。読めない・トークンが取れないときに秘密を出さない', async () => {
  assert.equal(parseClasprc(CLASPRC).refreshToken, REFRESH);
  assert.equal(parseClasprc(JSON.stringify({ token: { refresh_token: 'r2' }, oauth2ClientSettings: { clientId: 'c', clientSecret: 's' } })).refreshToken, 'r2');
  assert.throws(() => parseClasprc('not json'), /JSON として読めません/);
  assert.throws(() => parseClasprc('{}'), /refresh token が見つかりません/);
  const g = fakeGoogle({ tokenFails: true });
  await assert.rejects(accessToken(parseClasprc(CLASPRC), g.fetch), (e) => /invalid_grant/.test(e.message) && !e.message.includes(REFRESH));
});

test('dry-run: 書き込みは一切せず、今の版番号とコードをバックアップし、対象が本アプリのプロジェクトか確かめる', async () => {
  const dir = site();
  const env = envFor(dir);
  const g = fakeGoogle();
  const i = io(g);
  const state = await runGas(env, { dryRun: true, io: i });
  assert.deepEqual(writes(g), []);
  assert.equal(state.previous.admin.versionNumber, 7);
  assert.equal(state.previous.viewer.versionNumber, 4);
  assert.ok(existsSync(join(env.TOURNAMENT_BACKUP_DIR, 'admin-content.json')));
  assert.ok(existsSync(join(env.TOURNAMENT_BACKUP_DIR, 'viewer-deployment.json')));
  assert.ok(state.steps.some((s) => s.status === 'skipped' && /dry-run/.test(s.detail)));
  const out = i.logs.join('\n') + readFileSync(env.TOURNAMENT_DEPLOY_STATE, 'utf8') + readFileSync(join(env.TOURNAMENT_BACKUP_DIR, 'admin-content.json'), 'utf8');
  [REFRESH, TOKEN, ADMIN_KEY, 'csecret'].forEach((s) => assert.ok(!out.includes(s), 'secret in output: ' + s));
});

test('本番反映: 運営用の更新 → 移行 → 閲覧者用の更新 → 動作確認の順。既存のデプロイの版を差し替え、新しいデプロイは作らない', async () => {
  const dir = site();
  const env = envFor(dir);
  const g = fakeGoogle();
  const i = io(g);
  const state = await runGas(env, { io: i });
  const seq = writes(g).map((c) => c.method + ' ' + c.url.replace('https://script.googleapis.com/v1/projects/', '').replace(/https:\/\/script\.google\.com\/macros\/s\/([^/]+)\/exec/, 'exec:$1'));
  assert.deepEqual(seq, [
    `PUT ${ADMIN_SCRIPT}/content`,
    `POST ${ADMIN_SCRIPT}/versions`,
    `PUT ${ADMIN_SCRIPT}/deployments/${ADMIN_DEP}`,
    `POST exec:${ADMIN_DEP}`,
    `PUT ${VIEWER_SCRIPT}/content`,
    `POST ${VIEWER_SCRIPT}/versions`,
    `PUT ${VIEWER_SCRIPT}/deployments/${VIEWER_DEP}`,
  ]);
  assert.ok(!g.calls.some((c) => c.method === 'POST' && /\/deployments$/.test(c.url)), 'deployments.create を呼ばない');
  assert.equal(g.isMigrated(), true);
  // 反映したコードには今回のコミットが入り、ファイル構成は Code・appsscript（閲覧者用は Index も）
  const adminCode = g.uploaded.admin.find((f) => f.name === 'Code').source;
  assert.ok(adminCode.includes(`var RELEASE_ID_ = '${SHA}';`));
  assert.deepEqual(g.uploaded.viewer.map((f) => f.name).sort(), ['Code', 'Index', 'appsscript']);
  assert.ok(g.uploaded.viewer.find((f) => f.name === 'Code').source.includes(`var VIEWER_RELEASE_ID_ = '${SHA}';`));
  assert.deepEqual(g.deployed.admin.version, 8);
  assert.deepEqual(g.deployed.viewer.version, 5);
  assert.deepEqual(state.created, { admin: { versionNumber: 8 }, viewer: { versionNumber: 5 } });
  const md = summaryMarkdown(state, null);
  assert.match(md, /運営用: 版 7/);
  assert.match(md, /閲覧者用: 版 4/);
  assert.ok(![REFRESH, TOKEN, ADMIN_KEY].some((s) => (i.logs.join('\n') + md + readFileSync(env.TOURNAMENT_DEPLOY_STATE, 'utf8')).includes(s)));
});

test('止める条件: main が先に進んでいる・別のプロジェクト・公開設定が変わる・設定がない（どれも Google に書き込む前）', async () => {
  // main が先に進んでいる（古いコミットの実行）
  let g = fakeGoogle();
  await assert.rejects(runGas(envFor(site()), { io: io(g, { remoteMain: () => 'b'.repeat(40) }) }), /main が先に進んでいます/);
  assert.deepEqual(writes(g), []);
  // スクリプト ID が別のプロジェクト
  g = fakeGoogle({ adminCode: 'function myFunction() {}' });
  await assert.rejects(runGas(envFor(site()), { io: io(g) }), /このアプリではないプロジェクト/);
  assert.deepEqual(writes(g), []);
  // Web アプリの公開範囲が今と違う
  g = fakeGoogle({ adminAccess: 'ANYONE' });
  await assert.rejects(runGas(envFor(site()), { io: io(g) }), /公開設定/);
  assert.deepEqual(writes(g), []);
  // 設定の不足・取り違え
  g = fakeGoogle();
  await assert.rejects(runGas(envFor(site(), { TOURNAMENT_ADMIN_SCRIPT_ID: '' }), { io: io(g) }), /TOURNAMENT_ADMIN_SCRIPT_ID/);
  await assert.rejects(runGas(envFor(site(), { TOURNAMENT_VIEWER_SCRIPT_ID: ADMIN_SCRIPT }), { io: io(g) }), /同じです/);
  const noConfig = site();
  writeFileSync(join(noConfig, 'config.js'), '// 未設定\n');
  await assert.rejects(runGas(envFor(noConfig), { io: io(g) }), /config\.js に Apps Script の URL/);
  await assert.rejects(runGas(envFor(site(), { TOURNAMENT_ADMIN_KEY: '' }), { io: io(g) }), /TOURNAMENT_ADMIN_KEY/);
  // 推測したデプロイ ID（実在しない）では 404 で止まる
  const wrong = site();
  writeFileSync(join(wrong, 'config.js'), `endpoint: 'https://script.google.com/macros/s/AKfycbGUESSEDdeployment0123456/exec'`);
  await assert.rejects(runGas(envFor(wrong), { io: io(g) }), /NOT_FOUND/);
  assert.deepEqual(writes(g), []);
});

test('Pages: dist/pages を写して release.json を置く。各環境の config.js・admin/config.js・README.md は残す。新しい版を古い版で上書きしない', () => {
  const dir = site();
  const env = envFor(dir);
  const g = fakeGoogle();
  runPages(env, { io: io(g) });
  assert.match(readFileSync(join(dir, 'config.js'), 'utf8'), new RegExp(VIEWER_DEP));
  assert.match(readFileSync(join(dir, 'admin', 'config.js'), 'utf8'), new RegExp(ADMIN_DEP));
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# 閲覧リポジトリの説明（残す）\n');
  assert.ok(existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'admin', 'admin.js')) && existsSync(join(dir, 'events', 'portal.js')) && existsSync(join(dir, 'formats.js')));
  assert.ok(existsSync(join(dir, 'config.example.js')));
  const rel = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'));
  assert.equal(rel.sha, SHA);
  assert.match(rel.version, /^\d+\.\d+\.\d+$/);
  // 閲覧リポジトリに、このコミットの子孫ではない版が出ている → 止める
  writeFileSync(join(dir, 'release.json'), JSON.stringify({ sha: 'c'.repeat(40) }));
  assert.throws(() => runPages(envFor(dir), { io: io(g, { isAncestor: () => false }) }), /古い版で上書きしない/);
  // dry-run は写さない
  const dry = site();
  runPages(envFor(dry), { dryRun: true, io: io(g) });
  assert.ok(!existsSync(join(dry, 'release.json')));
});

test('Pages の公開確認と、ロールバック（指定の版番号に戻すだけ。コードは書き換えない）', async () => {
  const dir = site();
  let g = fakeGoogle();
  const st = await runVerifyPages(envFor(dir), { io: io(g), attempts: 2, waitMs: 0 });
  assert.ok(st.steps.some((s) => s.name === 'Pages の公開確認' && s.status === 'done'));
  g = fakeGoogle({ pagesRelease: { sha: 'd'.repeat(40) } });
  await assert.rejects(runVerifyPages(envFor(dir), { io: io(g), attempts: 2, waitMs: 0 }), /まだ ddddddd/);
  g = fakeGoogle();
  await runRollback(envFor(dir, { ROLLBACK_ADMIN_VERSION: '6' }), { io: io(g) });
  assert.deepEqual(writes(g).map((c) => c.method + ' ' + c.url.replace('https://script.googleapis.com/v1/projects/', '')), [`PUT ${ADMIN_SCRIPT}/deployments/${ADMIN_DEP}`]);
  assert.equal(g.deployed.admin.version, 6);
  await assert.rejects(runRollback(envFor(dir, { ROLLBACK_ADMIN_VERSION: 'x' }), { io: io(fakeGoogle()) }), /数字ではありません/);
  await assert.rejects(runRollback(envFor(dir), { io: io(fakeGoogle()) }), /版番号/);
});

test('記録: 手順を続けて記録し、release の目印はちょうど 1 か所だけ置き換える', () => {
  const env = envFor(site());
  createRecorder(env, () => {}).step('一つ目', 'done');
  createRecorder(env, () => {}).step('二つ目', 'failed', '理由');
  const st = JSON.parse(readFileSync(env.TOURNAMENT_DEPLOY_STATE, 'utf8'));
  assert.deepEqual(st.steps.map((s) => s.name), ['一つ目', '二つ目']);
  assert.match(summaryMarkdown(st, null), /\*\*失敗\*\*/);
  assert.throws(() => stampRelease("var RELEASE_ID_ = 'manual'; var RELEASE_ID_ = 'manual';", 'RELEASE_ID_', SHA), /2 か所/);
  assert.throws(() => stampRelease('', 'RELEASE_ID_', SHA), /0 か所/);
});

test('対象の確認: 本番で動いている版（運営用 v0.6.0・閲覧者用 v0.2.0）と v0.7.1 のコードを本アプリと判定し、版を読み取る', async () => {
  const { checkCurrentContent, gasFiles } = await import('../tools/deploy/deploy.mjs');
  const fx = (f) => readFileSync(join(import.meta.dirname, 'fixtures', f), 'utf8');
  const man = readFileSync(join(import.meta.dirname, '..', 'dist', 'admin', 'appsscript.json'), 'utf8');
  const vman = readFileSync(join(import.meta.dirname, '..', 'dist', 'viewer', 'appsscript.json'), 'utf8');
  const content = (code, m) => ({ files: [{ name: 'appsscript', type: 'JSON', source: m }, { name: 'コード', type: 'SERVER_JS', source: code }] });
  assert.equal(checkCurrentContent('admin', content(fx('admin-v0.6.0.gs'), man), gasFiles('admin', SHA)).version, '0.6.0');
  assert.equal(checkCurrentContent('admin', content(fx('admin-v0.7.1.gs'), man), gasFiles('admin', SHA)).version, '0.7.1');
  assert.equal(checkCurrentContent('viewer', content(fx('viewer-v0.2.0.gs'), vman), gasFiles('viewer', SHA)).version, '0.2.0');
  // 権限（スコープ）が増える版は止める
  const narrow = JSON.stringify({ ...JSON.parse(man), oauthScopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  assert.throws(() => checkCurrentContent('admin', content(fx('admin-v0.6.0.gs'), narrow), gasFiles('admin', SHA)), /権限が増えます（https:\/\/www\.googleapis\.com\/auth\/script\.external_request）/);
  // 運営用と閲覧者用の取り違えは止める
  assert.throws(() => checkCurrentContent('viewer', content(fx('admin-v0.6.0.gs').replace(/VIEWER_CONFIG/g, ''), vman), gasFiles('viewer', SHA)), /このアプリではない/);
});
