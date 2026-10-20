// ローカル確認用サーバー（Google には接続しない）。
// dist/ の Code.gs と Index.html を、gas-mock の模擬 Apps Script 上で動かし、ブラウザで操作できるようにする。
// google.script.run は /rpc/<app> への fetch で模擬する。
//
//   node tools/preview-server.mjs            → http://127.0.0.1:4180/
//   PORT=5000 node tools/preview-server.mjs
//
// 実環境（Apps Script の iframe・認証・クォータ）との違いは docs/test-plan.md を参照。
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore, loadProject, ROOT, SPREADSHEET_ID } from '../tests/gas-mock.mjs';

const PORT = Number(process.env.PORT || 4180);
const HOST = process.env.HOST || '127.0.0.1';
const OWNER = 'owner@example.com';

let env;
function reset({ configured = false } = {}) {
  const store = createStore();
  store.add(SPREADSHEET_ID, 'Tournament PoC');
  const clock = { now: () => Date.now(), advance() {} };
  env = {
    store,
    fault: { viewer: 'ok', admin: 'ok' },
    admin: loadProject('admin', { store, clock, owner: OWNER, activeUser: OWNER, properties: configured ? { SPREADSHEET_ID } : {} }),
    viewer: loadProject('viewer', { store, clock, owner: OWNER, activeUser: '', properties: { SPREADSHEET_ID } }),
  };
}
reset();

const SHIM = `(function () {
  var app = document.currentScript.getAttribute('data-app');
  var params = new URLSearchParams(location.search);
  var as = params.get('as') || '';
  function runner(h) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (fn) { return runner(Object.assign({}, h, { ok: fn })); };
        if (name === 'withFailureHandler') return function (fn) { return runner(Object.assign({}, h, { fail: fn })); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/rpc/' + app, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn: name, args: args, as: as }) })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              if (res.ok) { if (h.ok) h.ok(res.value); }
              else if (h.fail) h.fail(new Error(res.error));
            })
            .catch(function (e) { if (h.fail) h.fail(e); });
        };
      },
    });
  }
  var parameter = {};
  params.forEach(function (v, k) { parameter[k] = v; });
  window.google = { script: { run: runner({}), url: { getLocation: function (cb) { setTimeout(function () { cb({ parameter: parameter, hash: '' }); }, 0); } } } };
})();`;

function page(app) {
  const html = readFileSync(join(ROOT, 'dist', app, 'Index.html'), 'utf8');
  return html.replace('<head>', `<head>\n<script data-app="${app}" src="/__gas-shim.js"></script>`);
}

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

function send(res, status, type, text) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><title>n02 Tournament PoC preview</title>
<h1>n02 Tournament PoC（ローカル確認用・Google 非接続）</h1>
<ul><li><a href="/admin">運営者用画面</a></li><li><a href="/viewer">閲覧者用画面</a></li>
<li><a href="/admin?as=anonymous">運営者用画面に匿名でアクセスした場合</a></li></ul>`);
    }
    if (req.method === 'GET' && url.pathname === '/__gas-shim.js') return send(res, 200, 'text/javascript; charset=utf-8', SHIM);
    if (req.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/viewer')) {
      const app = url.pathname.slice(1);
      // doGet と同じ判定を通す（運営者用は権限がなければアプリの HTML を返さない）
      const project = env[app];
      const as = url.searchParams.get('as');
      const saved = project.activeUser;
      if (app === 'admin') project.activeUser = as === 'anonymous' ? '' : as === 'stranger' ? 'stranger@example.net' : OWNER;
      const out = project.run('doGet', {});
      project.activeUser = saved;
      const html = out.content.includes('<script') ? page(app) : out.content;
      return send(res, 200, 'text/html; charset=utf-8', html);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/rpc/')) {
      const app = url.pathname.slice(5);
      const project = env[app];
      if (!project) return send(res, 404, 'application/json', '{}');
      const { fn, args, as } = await body(req);
      const fault = env.fault[app];
      if (fault === 'fail') return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: 'simulated network failure' }));
      if (fault === 'slow') await new Promise((r) => setTimeout(r, 30_000));
      const saved = project.activeUser;
      if (app === 'admin') project.activeUser = as === 'anonymous' ? '' : as === 'stranger' ? 'stranger@example.net' : OWNER;
      try {
        const value = project.run(fn, ...(args || []));
        return send(res, 200, 'application/json', JSON.stringify({ ok: true, value }));
      } catch (e) {
        return send(res, 200, 'application/json', JSON.stringify({ ok: false, error: e.message }));
      } finally {
        project.activeUser = saved;
      }
    }
    // テスト用の操作
    if (req.method === 'POST' && url.pathname === '/__reset') {
      const opts = await body(req);
      reset(opts);
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/__fault') {
      const { app, mode } = await body(req);
      env.fault[app] = mode;
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/__expire-viewer-cache') {
      env.viewer.cache.clear();
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'GET' && url.pathname === '/__stats') {
      return send(res, 200, 'application/json', JSON.stringify({ stats: env.store.stats, dump: JSON.parse(env.store.dump()) }));
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 500, 'text/plain', String(e && e.stack));
  }
});

server.listen(PORT, HOST, () => console.log(`preview: http://${HOST}:${PORT}/`));
