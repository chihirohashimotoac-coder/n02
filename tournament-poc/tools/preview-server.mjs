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
import { createStore, loadProject, ROOT, SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID, fakeIdToken } from '../tests/gas-mock.mjs';

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
    admin: loadProject('admin', { store, clock, owner: OWNER, activeUser: OWNER, properties: configured ? { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID } : { ADMIN_KEY, GOOGLE_CLIENT_ID } }),
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
<p>運営画面（/pages/admin/）と閲覧ページ（/pages/）は、Apps Script への通信を画面テストで振り替えて動かします。</p>
<ul><li><a href="/viewer">閲覧者用画面（Apps Script の画面）</a></li></ul>`);
    }
    if (req.method === 'GET' && url.pathname === '/__gas-shim.js') return send(res, 200, 'text/javascript; charset=utf-8', SHIM);
    // GitHub Pages 用の閲覧ページ（dist/pages）。endpoint は架空の script.google.com の URL にしてあり、
    // 画面テストではブラウザ側でその通信を /viewer-json に振り替える（CSP をそのまま検証するため）。
    if (req.method === 'GET' && url.pathname.startsWith('/pages/')) {
      let name = url.pathname.slice('/pages/'.length);
      if (name === '' || name.endsWith('/')) name += 'index.html';
      if (name === 'config.js') {
        return send(res, 200, 'text/javascript; charset=utf-8', "window.TPOC_CONFIG = { endpoint: 'https://script.google.com/macros/s/PREVIEW/exec' };");
      }
      if (name === 'admin/config.js') {
        return send(res, 200, 'text/javascript; charset=utf-8', `window.TPOC_ADMIN_CONFIG = { endpoint: 'https://script.google.com/macros/s/PREVIEW-ADMIN/exec', googleClientId: '${GOOGLE_CLIENT_ID}' };`);
      }
      const types = {
        'index.html': 'text/html; charset=utf-8',
        'viewer.css': 'text/css; charset=utf-8',
        'viewer.js': 'text/javascript; charset=utf-8',
        'qrcode.js': 'text/javascript; charset=utf-8',
        'admin/qrcode.js': 'text/javascript; charset=utf-8',
        'admin/index.html': 'text/html; charset=utf-8',
        'admin/admin.css': 'text/css; charset=utf-8',
        'admin/admin.js': 'text/javascript; charset=utf-8',
        'events/index.html': 'text/html; charset=utf-8',
        'events/portal.css': 'text/css; charset=utf-8',
        'events/portal.js': 'text/javascript; charset=utf-8',
        'events/archivo.woff2': 'font/woff2',
        'ux-kit.js': 'text/javascript; charset=utf-8',
        'ux-kit.css': 'text/css; charset=utf-8',
        'viewer-plus.js': 'text/javascript; charset=utf-8',
      };
      if (!types[name]) return send(res, 404, 'text/plain', 'not found');
      const file = join(ROOT, 'dist', 'pages', name);
      return send(res, 200, types[name], types[name] === 'font/woff2' ? readFileSync(file) : readFileSync(file, 'utf8'));
    }
    // 運営用 Web アプリの doPost と同じ処理（本文は fetch で送られた JSON 文字列のまま渡す）
    if (req.method === 'POST' && url.pathname === '/admin-post') {
      if (env.fault.admin === 'fail') return send(res, 503, 'text/html; charset=utf-8', '<html>Service Unavailable</html>');
      const text = await new Promise((resolve) => {
        let data = '';
        req.on('data', (c) => (data += c));
        req.on('end', () => resolve(data));
      });
      return send(res, 200, 'application/json', JSON.stringify(env.admin.post(text)));
    }
    // 閲覧者用 Web アプリの ?format=json と同じ処理（doGet）
    if (req.method === 'GET' && url.pathname === '/viewer-json') {
      if (env.fault.viewer === 'fail') return send(res, 503, 'text/html; charset=utf-8', '<html>Service Unavailable</html>');
      const out = env.viewer.fn('doGet')({ parameter: Object.fromEntries(url.searchParams) });
      return send(res, 200, 'application/json', out.getContent());
    }
    if (req.method === 'GET' && url.pathname === '/viewer') {
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
    if (req.method === 'POST' && url.pathname === '/__set-admin-property') {
      const { key, value } = await body(req);
      env.admin.properties.setProperty(key, value);
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/__expire-viewer-cache') {
      env.viewer.cache.clear();
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    // Google Identity Services（accounts.google.com/gsi/client）の代わり。画面テストでブラウザ側から振り替える。
    // ボタンを押すと、指定したメールアドレスのテスト用 ID トークン（模擬 tokeninfo が本物として扱う形）を渡す
    if (req.method === 'GET' && url.pathname === '/__fake-gsi.js') {
      const email = url.searchParams.get('email') || 'organizer@example.org';
      const token = fakeIdToken(email, null);
      const script = `window.google = { accounts: { id: {
  initialize: function (cfg) { window.__gisConfig = cfg; },
  renderButton: function (box) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fake-gsi';
    b.textContent = 'Google でログイン（テスト: ${email}）';
    b.addEventListener('click', function () { window.__gisConfig.callback({ credential: ${JSON.stringify(token)} }); });
    box.appendChild(b);
  },
  disableAutoSelect: function () {},
  prompt: function () {}
} } };`;
      return send(res, 200, 'text/javascript; charset=utf-8', script);
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
