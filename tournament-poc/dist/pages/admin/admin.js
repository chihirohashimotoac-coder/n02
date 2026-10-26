/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament PoC - 運営画面（クライアント側） */
(function (global) {
  'use strict';

  var MATCH_STATUS_LABEL = { scheduled: '未開始', live: '進行中', final: '確定済み', check: '要確認', pending: '対戦待ち', void: '実施なし', bye: '不戦（Bye）' };
  // 段階の種類・大会形式の定義は shared/formats.js（運営用 Apps Script と同じもの）
  var STAGE_TYPE_LABEL = global.STAGE_KIND_LABEL || { round_robin: 'ロビン', league: 'リーグ', single_elimination: 'トーナメント' };
  var FORMATS = global.TOURNAMENT_FORMATS || [];
  var RESULT_TYPE_LABEL = { walkover: '不戦勝', retired: '途中棄権', disqualified: '失格', bye: '不戦（Bye）', not_needed: '実施なし' };
  var SCHEDULE_STATUS_LABEL = { postponed: '延期（日程未定）', rescheduled: '振替' };
  var WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];
  var EVENT_STATUS_LABEL = { draft: '準備中', running: '開催中', finished: '終了' };
  var BEST_OF_CHOICES = [1, 3, 5, 7, 9, 11, 13];
  var TABS = [
    { id: 'progress', label: '進行状況' },
    { id: 'matches', label: '試合結果' },
    { id: 'schedule', label: '次戦・予定' },
    { id: 'players', label: '選手' },
    { id: 'format', label: '形式' },
    { id: 'pairing', label: '組み合わせ' },
    { id: 'settings', label: '大会設定' },
    { id: 'output', label: '出力・印刷' },
    { id: 'history', label: '履歴' },
  ];

  /* ---------- 共通 ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = v;
        else if (k === 'onClick') node.addEventListener('click', v);
        else if (k === 'onSubmit') node.addEventListener('submit', v);
        else if (k === 'onChange') node.addEventListener('change', v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked') node.checked = !!v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** 同梱の qrcode-generator（グローバルの qrcode）で QR コードの行列を作る。ライブラリがなければ null */
  function qrMatrix(text) {
    var lib = typeof window !== 'undefined' ? window.qrcode : null;
    if (typeof lib !== 'function' || !text) return null;
    var qr = lib(0, 'M');
    qr.addData(text);
    qr.make();
    return { size: qr.getModuleCount(), isDark: qr.isDark };
  }

  var QR_QUIET = 4;

  function qrSvg(matrix, label) {
    var ns = 'http://www.w3.org/2000/svg';
    var size = matrix.size + QR_QUIET * 2;
    var d = '';
    for (var r = 0; r < matrix.size; r++) {
      for (var c = 0; c < matrix.size; c++) {
        if (matrix.isDark(r, c)) d += 'M' + (c + QR_QUIET) + ' ' + (r + QR_QUIET) + 'h1v1h-1z';
      }
    }
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.setAttribute('shape-rendering', 'crispEdges');
    var bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', String(size));
    bg.setAttribute('height', String(size));
    bg.setAttribute('fill', '#ffffff');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', '#000000');
    svg.appendChild(bg);
    svg.appendChild(path);
    return svg;
  }

  /** 印刷・掲示用の PNG（1 モジュール 12px） */
  function qrPngBlob(matrix, done) {
    var scale = 12;
    var size = (matrix.size + QR_QUIET * 2) * scale;
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    var g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000000';
    for (var r = 0; r < matrix.size; r++) {
      for (var c = 0; c < matrix.size; c++) {
        if (matrix.isDark(r, c)) g.fillRect((c + QR_QUIET) * scale, (r + QR_QUIET) * scale, scale, scale);
      }
    }
    canvas.toBlob(done, 'image/png');
  }

  function newRequestId() {
    var bytes = new Uint8Array(16);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function legsToWin(bestOf) {
    return Math.floor(bestOf / 2) + 1;
  }

  /** サーバーと同じ規則のクライアント側事前チェック（最終判定はサーバー） */
  function checkResult(status, p1, p2, bestOf) {
    var need = legsToWin(bestOf);
    if (!/^\d+$/.test(String(p1)) || !/^\d+$/.test(String(p2))) return '取得 Leg 数は 0 以上の整数で入力してください';
    p1 = Number(p1);
    p2 = Number(p2);
    if (p1 > need || p2 > need) return 'Best of ' + bestOf + ' では取得 Leg 数は最大 ' + need + ' です';
    if (status === 'scheduled' && (p1 || p2)) return '未開始にする場合は Leg 数を 0 にしてください';
    if (status === 'live' && (p1 >= need || p2 >= need)) return 'どちらかが ' + need + ' Leg に達しています。「確定」を押してください';
    if (status === 'final') {
      if (p1 === need && p2 === need) return '両者が ' + need + ' Leg になっています';
      if (p1 !== need && p2 !== need) return '確定するには、どちらかがちょうど ' + need + ' Leg 必要です';
    }
    return '';
  }

  /** 固定 Leg 数（引き分けあり）の事前チェック（最終判定はサーバー） */
  function checkFixed(status, p1, p2, legs) {
    if (!/^\d+$/.test(String(p1)) || !/^\d+$/.test(String(p2))) return '取得 Leg 数は 0 以上の整数で入力してください';
    var sum = Number(p1) + Number(p2);
    if (status === 'scheduled' && sum) return '未開始にする場合は Leg 数を 0 にしてください';
    if (status === 'live' && sum >= legs) return '合計が ' + legs + ' Leg に達しています。「確定」を押してください';
    if (status === 'final' && sum !== legs) return '確定するには、合計がちょうど ' + legs + ' Leg 必要です（固定 ' + legs + ' Legs）';
    return '';
  }

  /**
   * 対戦形式の入力欄（Leg 制 / セット制、Best of、1 セットの Best of、暫定ルール）。
   * 戻り値 { node, value() }。value() はサーバーの rule 入力形式
   */
  function ruleInputs(prefix, initial, opts) {
    var noFixed = opts && opts.noFixed;
    var format = el('select', { className: 'input', id: prefix + '-format' }, [
      el('option', { value: 'legs', text: 'Leg 制（Best of N Legs）', selected: initial.format === 'legs' || !initial.format ? true : null }),
      el('option', { value: 'sets', text: 'セット制（Best of N セット）', selected: initial.format === 'sets' ? true : null }),
      noFixed ? null : el('option', { value: 'fixed', text: '固定 Leg 数（N Legs をすべて投げる・引き分けあり）', selected: initial.format === 'fixed' ? true : null }),
    ]);
    var bestOf = el('select', { className: 'input', id: prefix + '-bestof' });
    var setBestOf = el('select', { className: 'input', id: prefix + '-setbestof' }, BEST_OF_CHOICES.map(function (n) {
      return el('option', { value: String(n), text: '各セット Best of ' + n + ' Legs（先に ' + legsToWin(n) + ' Leg）', selected: n === initial.setBestOf ? true : null });
    }));
    var provisional = el('input', { type: 'checkbox', id: prefix + '-provisional', checked: initial.provisional !== false });
    var setField = el('label', { className: 'field', for: prefix + '-setbestof' }, [el('span', { className: 'field__label', text: '1 セットの長さ' }), setBestOf]);
    var drawBestOf = function () {
      var unit = format.value === 'sets' ? 'セット' : 'Legs';
      var current = Number(bestOf.value) || initial.bestOf;
      bestOf.textContent = '';
      if (format.value === 'fixed') {
        for (var n = 1; n <= 21; n++) bestOf.appendChild(el('option', { value: String(n), text: '固定 ' + n + ' Legs' + (n % 2 === 0 ? '（' + n / 2 + '-' + n / 2 + ' は引き分け）' : ''), selected: n === current ? true : null }));
      } else {
        BEST_OF_CHOICES.forEach(function (n) {
          bestOf.appendChild(el('option', { value: String(n), text: 'Best of ' + n + ' ' + unit + '（先に ' + legsToWin(n) + (format.value === 'sets' ? ' セット' : ' Leg') + '）', selected: n === current ? true : null }));
        });
        if (!bestOf.value) bestOf.value = '5';
      }
      setField.hidden = format.value !== 'sets';
      fixedNote.hidden = format.value !== 'fixed';
    };
    var fixedNote = el('p', { className: 'muted small', text: '固定 Leg 数は引き分けがありうる方式です（リーグ・ロビン・スイス式向け）。勝ち抜き戦の段階では使えません。' });
    format.addEventListener('change', drawBestOf);
    drawBestOf();
    var node = el('div', { className: 'stack stack--tight' }, [
      el('label', { className: 'field', for: prefix + '-format' }, [el('span', { className: 'field__label', text: '対戦形式' }), format]),
      el('label', { className: 'field', for: prefix + '-bestof' }, [el('span', { className: 'field__label', text: '試合の長さ' }), bestOf]),
      setField,
      fixedNote,
      el('label', { className: 'check' }, [provisional, ' 暫定ルールとして扱う（確定した大会ルールではない）']),
    ]);
    return {
      node: node,
      value: function () {
        return { format: format.value, bestOf: Number(bestOf.value), setBestOf: format.value === 'sets' ? Number(setBestOf.value) : undefined, provisional: provisional.checked };
      },
    };
  }

  /* ---------- サーバー呼び出し ---------- */

  function createApi(runner) {
    function callOnce(request) {
      return new Promise(function (resolve, reject) {
        runner(
          request,
          function (res) {
            if (res && res.ok) resolve(res.data);
            else reject((res && res.error) || { code: 'UNKNOWN', message: '不明な応答です。' });
          },
          function (err) {
            reject({ code: 'NETWORK', message: '通信に失敗しました。' + (err && err.message ? '（' + err.message + '）' : '') });
          }
        );
      });
    }
    return {
      query: function (action, payload) {
        return callOnce({ action: action, payload: payload || {} });
      },
      /**
       * 書き込み。通信エラーのときだけ、同じ requestId で 1 回だけ再送する。
       * サーバーは requestId で二重実行を防ぐので、再送しても 2 回反映されることはない。
       */
      mutate: function (action, payload) {
        var request = { action: action, payload: payload || {}, requestId: newRequestId() };
        return callOnce(request).catch(function (err) {
          if (err && (err.code === 'NETWORK' || err.code === 'BUSY')) {
            return new Promise(function (r) {
              setTimeout(r, 1500);
            }).then(function () {
              return callOnce(request);
            });
          }
          throw err;
        });
      },
    };
  }

  /* ---------- 画面の URL（#e=…）と通信 ---------- */

  var EVENT_ID_PATTERN = /^EVT-[A-Z0-9]{4,32}$/;
  var ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

  /**
   * URL の # 以降を読む。秘密の情報は入れない（大会の ID だけ）。
   *   #e=EVT-…  … その大会の運営画面（作った本人の Google ログイン、または管理パスワード）
   *   #admin    … 管理者
   *   なし      … 主催者のホーム（Google でログインして、自分の大会の一覧・新しい大会の作成）
   *   #new      … 主催者のホームを開き、大会の作成欄へ移る（ポータル「トーナメント・リーグ」の作成ボタンから）
   * v0.4 までの運営用 URL（#e=…&k=…）の鍵の部分は使わない。
   */
  function parseHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (h === 'admin') return { mode: 'admin' };
    if (h === 'new') return { mode: 'home', create: true };
    var out = {};
    h.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i > 0) {
        try {
          out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
        } catch (e) {
          out[pair.slice(0, i)] = '';
        }
      }
    });
    if (EVENT_ID_PATTERN.test(out.e || '')) return { mode: 'event', eventId: out.e, legacyKey: !!out.k };
    if (out.e || out.k) return { mode: 'invalid' };
    return { mode: 'home' };
  }

  /** 大会の運営画面の URL（スタッフに共有する。秘密の情報は含まない） */
  function eventUrl(loc, eventId) {
    return loc.origin + loc.pathname + '#e=' + encodeURIComponent(eventId);
  }

  /** ID トークン（JWT）の中身を読む（画面の表示用。正しさの確認はサーバーが行う） */
  function decodeJwtPayload(token) {
    try {
      var part = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (part.length % 4) part += '=';
      return JSON.parse(decodeURIComponent(escape(atob(part))));
    } catch (e) {
      return null;
    }
  }

  /** GitHub Pages から運営用 Web アプリ（doPost）へ JSON を送る。Cookie は送らない */
  function createFetchRunner(win, endpoint, getAuth) {
    return function (request, ok, fail) {
      var body = { action: request.action, payload: request.payload, requestId: request.requestId, auth: getAuth() };
      win
        .fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(body),
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'follow',
        })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(
          function (data) {
            ok(data);
          },
          fail
        );
    };
  }

  /* ---------- アプリ ---------- */

  function startApp(doc, win, config) {
    var root = doc.getElementById('app');
    var toastBox = doc.getElementById('toast');
    var state = {
      route: parseHash(win.location.hash),
      adminKey: '',
      google: null, // Google でログインしたセッション { session, email, expiresAt }
      staff: {}, // 管理パスワードでログインしたセッション { eventId: { session, expiresAt } }
      boot: null,
      eventId: '',
      detail: null,
      noAccess: false, // ログインしているが、この大会を運営する権限がない
      tab: 'progress',
      busy: false,
      matchFilter: 'all',
      statusFilter: 'open',
      editing: {},
      stageId: '', // 試合結果・組み合わせタブで選んでいる段階
      entrantDraft: {}, // トーナメントの出場者・シード順の編集中の並び（段階ごと）
      drafts: {}, // 試合結果の未保存の入力 { matchId: { rev, p1, p2, l1, l2 } }。画面を描き直しても消さない
      scheduleOpen: {}, // 予定・延期の入力欄を開いている試合
      specialOpen: {}, // 不戦勝・棄権・失格の入力欄を開いている試合
      ui: {}, // そのほかの画面の状態（開いている欄・選んでいる絞り込みなど）
    };
    var batchUi = null; // 「まとめて確定」バーの更新関数（試合結果タブの表示中のみ）

    /* ログインの記憶: 管理者の鍵はタブを閉じるまで（sessionStorage）。主催者・スタッフのセッションは
       期限（6 時間）まで、この端末のブラウザに記憶する（localStorage。大会当日に店舗の端末で開き直せるように） */
    function storageGet(kind, key) {
      try {
        return win[kind].getItem(key);
      } catch (e) {
        return null;
      }
    }
    function storageSet(kind, key, value) {
      try {
        if (value === null) win[kind].removeItem(key);
        else win[kind].setItem(key, value);
      } catch (e) {
        /* 保存できない環境では、このページを開いている間だけ有効 */
      }
    }
    function readLogin(key) {
      var v = null;
      try {
        v = JSON.parse(storageGet('localStorage', key) || 'null');
      } catch (e) {
        v = null;
      }
      return v && typeof v.session === 'string' && Date.parse(v.expiresAt) > Date.now() ? v : null;
    }
    state.adminKey = storageGet('sessionStorage', 'tpoc-admin-key') || '';
    state.google = readLogin('tpoc-google');

    function staffLogin(eventId) {
      if (!state.staff[eventId]) state.staff[eventId] = readLogin('tpoc-staff:' + eventId);
      return state.staff[eventId];
    }
    function setGoogle(login) {
      state.google = login;
      storageSet('localStorage', 'tpoc-google', login ? JSON.stringify(login) : null);
    }
    function setStaff(eventId, login) {
      state.staff[eventId] = login;
      storageSet('localStorage', 'tpoc-staff:' + eventId, login ? JSON.stringify(login) : null);
    }

    /** 送る認証: 管理者の鍵、または（この大会の管理パスワードの）セッション、または Google のセッション */
    function currentAuth() {
      if (state.route.mode === 'admin') return state.adminKey ? { adminKey: state.adminKey } : undefined;
      var staff = state.route.mode === 'event' ? staffLogin(state.route.eventId) : null;
      if (staff) return { session: staff.session };
      if (state.google) return { session: state.google.session };
      return undefined;
    }
    var api = createApi(createFetchRunner(win, config.endpoint, currentAuth));
    // ログアウト（サーバー側での無効化）だけは、今の画面のログインを送らない（消したセッションは本文で送る）
    var plainApi = createApi(createFetchRunner(win, config.endpoint, function () {
      return undefined;
    }));

    function toast(kind, text) {
      var item = el('div', { className: 'toast toast--' + kind, role: kind === 'error' ? 'alert' : 'status', text: text });
      toastBox.appendChild(item);
      setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, kind === 'error' ? 8000 : 4000);
    }

    function setBusy(busy) {
      state.busy = busy;
      doc.body.classList.toggle('is-busy', busy);
      Array.prototype.forEach.call(root.querySelectorAll('[data-mut]'), function (b) {
        b.disabled = busy || b.getAttribute('data-locked') === '1';
      });
    }

    var AUTH_ERRORS = { AUTH_INVALID: true, AUTH_REQUIRED: true, AUTH_EXPIRED: true, AUTH_NOT_CONFIGURED: true };

    /** ログインが切れた・無効になったとき: 使っていた記憶を消して、ログイン画面に戻す（入力途中の結果は state に残る） */
    function dropLogin() {
      if (state.route.mode === 'admin') {
        state.adminKey = '';
        storageSet('sessionStorage', 'tpoc-admin-key', null);
      } else if (state.route.mode === 'event' && staffLogin(state.route.eventId)) {
        setStaff(state.route.eventId, null);
      } else {
        setGoogle(null);
      }
    }

    function handleError(err) {
      if (err && AUTH_ERRORS[err.code]) {
        if (err.code !== 'AUTH_NOT_CONFIGURED') dropLogin();
        state.authError = err.message;
        state.boot = null;
        render();
        return;
      }
      toast('error', (err && err.message) || 'エラーが発生しました。');
      if (err && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND' || err.code === 'ALREADY_FINAL') && state.eventId && state.detail) {
        loadDetail(state.eventId);
      }
    }

    /** 保存はできたが閲覧ページへの反映（公開データの書き込み）だけが失敗したとき */
    function warnPublication(data) {
      if (!data || !data.publication || !data.publication.failed) return;
      toast('error', '保存しました。ただし閲覧ページへの反映に失敗しました（' + data.publication.message + '）。「公開データを再生成」でやり直せます。');
    }

    /** 書き込み操作の共通処理。実行中は他の書き込みボタンを押せなくする。 */
    function mutate(action, payload, okMessage) {
      if (state.busy) return Promise.resolve(null);
      setBusy(true);
      return api
        .mutate(action, payload)
        .then(function (data) {
          // 大会を作ったら、その大会の運営画面へ（通信の再送で二重に作られた場合も同じ大会を開く）
          if (data && data.eventId && (action === 'createEvent' || action === 'createSampleEvent' || action === 'duplicateEvent' || action === 'restoreEvent')) {
            if (okMessage && !data.duplicate) toast('ok', okMessage);
            warnPublication(data);
            goTo('#e=' + encodeURIComponent(data.eventId));
            return data;
          }
          if (data && data.duplicate) {
            if (state.eventId) return loadDetail(state.eventId);
            return loadBoot();
          }
          if (data && data.detail) {
            state.detail = data.detail;
            state.eventId = data.detail.event.id;
          }
          if (data && data.storage) state.boot = data;
          if (okMessage) toast('ok', typeof okMessage === 'function' ? okMessage(data) : okMessage);
          warnPublication(data);
          render();
          return data;
        })
        .catch(handleError)
        .then(function (data) {
          setBusy(false);
          return data;
        });
    }

    /* ---------- ログイン ---------- */

    var gis = { initialized: false, waiting: [] };

    /** Google Identity Services（accounts.google.com/gsi/client）が読み込まれるのを待つ */
    function whenGoogleReady(done, fail) {
      var started = Date.now();
      (function poll() {
        var id = win.google && win.google.accounts && win.google.accounts.id;
        if (id)
          return whenGoogleStyleReady(function () {
            done(id);
          });
        if (Date.now() - started > 15000) return fail();
        setTimeout(poll, 100);
      })();
    }

    /**
     * Google のボタン用のスタイル（accounts.google.com/gsi/style）を読み込み終えてから cb を呼ぶ。
     * renderButton はスタイルより先に下書きのボタンを描くため、読み込み前だと大きな G のロゴが一瞬崩れて見える。
     * 読み込めない・時間がかかるとき（3 秒）は、そのまま進める（ボタンは Google 側の iframe で表示される）。
     */
    var gsiStyle = { ready: false, waiting: null };
    function whenGoogleStyleReady(cb) {
      if (gsiStyle.ready) return cb();
      if (gsiStyle.waiting) return gsiStyle.waiting.push(cb);
      gsiStyle.waiting = [cb];
      var finish = function () {
        if (gsiStyle.ready) return;
        gsiStyle.ready = true;
        gsiStyle.waiting.splice(0).forEach(function (f) {
          f();
        });
      };
      var link = doc.querySelector('link[href^="https://accounts.google.com/gsi/style"]');
      if (link && link.sheet) return finish();
      if (!link) {
        link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://accounts.google.com/gsi/style';
        doc.head.appendChild(link);
      }
      link.addEventListener('load', finish);
      link.addEventListener('error', finish);
      setTimeout(finish, 3000);
    }

    /** Google のログインボタンを置く。押して選んだアカウントの ID トークンをサーバーで確かめ、セッションを受け取る */
    function googleButton() {
      var box = el('div', { className: 'gsi-button' });
      var note = el('p', { className: 'muted small', text: 'Google のログインボタンを読み込んでいます…' });
      var wrap = el('div', { className: 'gsi' }, [box, note]);
      if (!GOOGLE_CLIENT_ID_PATTERN.test(String(config.googleClientId || ''))) {
        note.className = 'error';
        note.textContent = '設定エラー: admin/config.js の googleClientId に OAuth クライアント ID（…apps.googleusercontent.com）を設定してください。';
        return wrap;
      }
      whenGoogleReady(
        function (id) {
          if (!gis.initialized) {
            id.initialize({ client_id: config.googleClientId, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
            gis.initialized = true;
          }
          id.renderButton(box, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'ja' });
          note.textContent = 'ログインすると、このブラウザに 6 時間記憶します。';
        },
        function () {
          note.className = 'error';
          note.textContent = 'Google のログインボタンを読み込めませんでした。通信状態を確認し、ページを再読み込みしてください。広告ブロックやアプリ内のブラウザ（LINE など）では使えないことがあります。その場合は Chrome や Safari で開いてください。';
        }
      );
      return wrap;
    }

    function onGoogleCredential(resp) {
      var token = resp && resp.credential;
      if (!token) return;
      var claims = decodeJwtPayload(token) || {};
      setBusy(true);
      api
        .query('login', { idToken: token })
        .then(function (data) {
          setGoogle({ session: data.session, email: data.email || claims.email || '', expiresAt: data.expiresAt });
          state.authError = '';
          state.noAccess = false;
          toast('ok', (data.email || 'Google') + ' でログインしました。');
          return loadBoot();
        })
        .catch(function (err) {
          state.authError = (err && err.message) || 'ログインできませんでした。';
          render();
        })
        .then(function () {
          setBusy(false);
        });
    }

    function staffPasswordForm(eventId) {
      var input = el('input', { type: 'password', id: 'staff-password', className: 'input', autocomplete: 'current-password', maxlength: 64 });
      return el('form', {
        className: 'row',
        onSubmit: function (e) {
          e.preventDefault();
          if (state.busy) return;
          setBusy(true);
          api
            .query('staffLogin', { eventId: eventId, password: input.value })
            .then(function (data) {
              setStaff(eventId, { session: data.session, expiresAt: data.expiresAt });
              state.authError = '';
              state.noAccess = false;
              return loadBoot();
            })
            .catch(function (err) {
              state.authError = (err && err.message) || 'ログインできませんでした。';
              render();
            })
            .then(function () {
              setBusy(false);
            });
        },
      }, [el('label', { className: 'visually-hidden', for: 'staff-password', text: '管理パスワード' }), input, el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '開く' })]);
    }

    /**
     * ログアウト: まずこの端末のログイン（localStorage と画面の状態）を消して、この端末からは操作できなくする。
     * その後でサーバーにセッションの無効化を頼み、成功を確かめられたときだけ「サーバーでも無効にした」と伝える。
     * 通信に失敗・時間切れのときは、その旨と再試行のボタンを出す（消したセッションはこのページのメモリにだけ持つ）。
     */
    function logout() {
      var isStaff = state.route.mode === 'event' && !!staffLogin(state.route.eventId);
      var login = isStaff ? staffLogin(state.route.eventId) : state.google;
      if (isStaff) setStaff(state.route.eventId, null);
      else setGoogle(null);
      try {
        if (win.google && win.google.accounts && win.google.accounts.id) win.google.accounts.id.disableAutoSelect();
      } catch (e) {
        /* Google のライブラリがなくてもログアウトできる */
      }
      state.boot = null;
      state.detail = null;
      state.eventId = '';
      state.noAccess = false;
      render();
      loadBoot();
      if (login && login.session) revokeOnServer([{ session: login.session, expiresAt: login.expiresAt }]);
      else toast('ok', 'ログアウトしました。');
    }

    var LOGOUT_TIMEOUT_MS = 15000;

    function revokeOnServer(items) {
      state.revoke = { items: items, running: true };
      render();
      var timeout = new Promise(function (resolve, reject) {
        setTimeout(function () {
          reject({ code: 'TIMEOUT' });
        }, LOGOUT_TIMEOUT_MS);
      });
      var calls = items.map(function (it) {
        return plainApi.query('logout', { session: it.session }).then(function (data) {
          if (!data || data.loggedOut !== true) throw { code: 'UNKNOWN' };
        });
      });
      Promise.race([Promise.all(calls), timeout])
        .then(function () {
          state.revoke = null;
          toast('ok', 'ログアウトしました（サーバーでもログインを無効にしました）。');
        })
        .catch(function () {
          state.revoke = { items: items, running: false };
        })
        .then(render);
    }

    /** サーバーでの無効化を確かめられなかったときの警告（この端末ではログアウト済み） */
    function renderRevokeNotice() {
      var r = state.revoke;
      if (!r || r.running) return null;
      var until = r.items.map(function (it) {
        return it.expiresAt || '';
      }).sort().pop();
      return el('section', { className: 'panel', role: 'alert' }, [
        el('p', { className: 'error', text: 'この端末ではログアウトしました（この端末のログイン情報は消しました）。ただし、通信できなかったため、サーバー側でログインを無効にできたかは確認できていません。' }),
        el('p', { className: 'muted small', text: 'サーバー側では' + (until ? ' 最長 ' + formatDateTime(until) + ' まで' : '期限まで') + '有効なままの可能性があります。通信できる状態で、もう一度お試しください（このページを閉じると再試行できません）。' }),
        el('div', { className: 'row' }, [
          el('button', { className: 'btn btn--primary', type: 'button', text: 'サーバーでの無効化をもう一度試す', onClick: function () { revokeOnServer(r.items); } }),
          el('button', { className: 'btn btn--ghost', type: 'button', text: '閉じる', onClick: function () { state.revoke = null; render(); } }),
        ]),
      ]);
    }

    /* 別のタブ（ポータル・運営画面）でのログイン・ログアウトを反映する（同じオリジンの localStorage） */
    win.addEventListener('storage', function (e) {
      if (e.key !== null && e.key !== 'tpoc-google' && String(e.key).indexOf('tpoc-staff:') !== 0) return;
      var before = currentAuth();
      state.google = readLogin('tpoc-google');
      state.staff = {};
      var after = currentAuth();
      if ((before && before.session) === (after && after.session)) return;
      resetView();
      render();
      loadBoot();
    });

    /* ---------- 読み込み ---------- */

    function loggedIn() {
      return !!currentAuth();
    }

    function loadBoot() {
      if (!loggedIn() && state.route.mode !== 'home') {
        // 管理者の鍵・ログインがまだない: 入力・ログインの画面を出す（大会の存在はサーバーに問い合わせない）
        render();
        return Promise.resolve();
      }
      return api
        .query('bootstrap')
        .then(function (data) {
          if (needsLink(data)) return linkAccount().then(loadBoot);
          state.boot = data;
          state.authError = '';
          if (state.route.mode === 'event') return loadEventFirst(state.route.eventId);
          render();
        })
        .catch(function (err) {
          if (err && AUTH_ERRORS[err.code]) return handleError(err);
          root.textContent = '';
          root.appendChild(el('p', { className: 'panel error', text: (err && err.message) || '読み込みに失敗しました。' }));
          root.appendChild(el('button', { className: 'btn', type: 'button', text: '再読み込み', onClick: loadBoot }));
        });
    }

    /**
     * v0.9: 以前の大会・共同主催者の招待を、ログインした Google アカウントに紐付ける（サーバーが条件を判定する）。
     * 紐付けられるものがあるときだけ、同じセッションで 1 回だけ呼ぶ
     */
    var linkedSessions = {};
    function needsLink(boot) {
      var auth = currentAuth();
      var link = boot && boot.role && boot.role.kind === 'google' ? boot.role.link : null;
      return !!(link && link.available > 0 && auth && auth.session && !linkedSessions[auth.session]);
    }
    function linkAccount() {
      linkedSessions[currentAuth().session] = true;
      return api
        .mutate('linkAccount', {})
        .then(function (res) {
          var n = res && res.linked ? res.linked.owner + res.linked.collaborator : 0;
          if (n) toast('ok', 'このアカウントに ' + n + ' 件の大会（主催・共同主催）を紐付けました。');
        })
        .catch(function (err) {
          if (err && AUTH_ERRORS[err.code]) throw err;
          // 紐付けに失敗しても画面は開く（次にログインしたときにやり直す）
          toast('error', '大会の紐付けに失敗しました（' + ((err && err.message) || '通信エラー') + '）。時間をおいてページを再読み込みしてください。');
        });
    }

    /** 大会の運営画面を開く（ログインしているが権限がない場合は、管理パスワードの入力を案内する） */
    function loadEventFirst(eventId) {
      state.eventId = eventId;
      return api
        .query('eventDetail', { eventId: eventId })
        .then(function (detail) {
          state.detail = detail;
          state.noAccess = false;
          state.editing = {};
          render();
        })
        .catch(function (err) {
          if (err && err.code === 'NOT_FOUND') {
            state.noAccess = true;
            state.detail = null;
            render();
            return;
          }
          handleError(err);
        });
    }

    function loadDetail(eventId) {
      return api
        .query('eventDetail', { eventId: eventId })
        .then(function (detail) {
          state.detail = detail;
          state.eventId = eventId;
          state.editing = {};
          render();
        })
        .catch(handleError);
    }

    /** 管理者はその場で開く（URL は #admin のまま）。主催者はその大会の運営画面の URL へ */
    function openEvent(eventId) {
      if (state.route.mode !== 'admin') {
        goTo('#e=' + encodeURIComponent(eventId));
        return;
      }
      state.tab = 'progress';
      state.detail = null;
      state.eventId = eventId;
      render();
      loadDetail(eventId);
    }

    function goHome() {
      if (state.route.mode !== 'admin') {
        goTo('');
        return;
      }
      state.eventId = '';
      state.detail = null;
      render();
      loadBoot();
    }

    function goTo(hash) {
      if (win.location.hash === hash || (!hash && !win.location.hash)) {
        state.route = parseHash(hash);
        resetView();
        render();
        loadBoot();
        return;
      }
      if (hash) win.location.hash = hash;
      else win.history.pushState(null, '', win.location.pathname + win.location.search);
      if (!hash) {
        state.route = parseHash('');
        resetView();
        render();
        loadBoot();
      }
    }

    function resetView() {
      state.boot = null;
      state.detail = null;
      state.eventId = '';
      state.noAccess = false;
      state.authError = '';
      state.tab = 'progress';
    }

    win.addEventListener('hashchange', function () {
      state.route = parseHash(win.location.hash);
      resetView();
      render();
      loadBoot();
    });

    /* ---------- 描画 ---------- */

    function render() {
      // 描き直しで入力中の欄のフォーカスが外れないよう、id のある要素は描き直し後に戻す
      var active = doc.activeElement && doc.activeElement.id && root.contains(doc.activeElement) ? doc.activeElement.id : '';
      renderInner();
      // #new: 作成欄を 1 回だけ見せる（ログイン後の最初の表示で）
      if (state.route.create && !state.createShown && state.boot && state.boot.role.kind === 'google' && !state.eventId) {
        var nameInput = doc.getElementById('new-name');
        if (nameInput) {
          state.createShown = true;
          if (nameInput.scrollIntoView) nameInput.scrollIntoView({ block: 'center' });
          nameInput.focus();
          active = '';
        }
      }
      if (active) {
        var again = doc.getElementById(active);
        if (again && !again.disabled) again.focus();
      }
    }

    function renderInner() {
      batchUi = null;
      root.textContent = '';
      renderWho();
      var revoke = renderRevokeNotice();
      if (revoke) root.appendChild(revoke);
      var mode = state.route.mode;
      if (mode === 'invalid') {
        root.appendChild(renderMessage('URL が正しくありません', 'URL が途中で切れていないか確認してください。'));
        return;
      }
      if (mode === 'admin' && !state.adminKey) {
        root.appendChild(renderAdminLogin(state.authError || ''));
        return;
      }
      if (mode === 'event' && !loggedIn()) {
        root.appendChild(renderEventLogin(state.route.eventId, state.authError || ''));
        return;
      }
      if (state.authError && mode === 'admin') {
        root.appendChild(renderAdminLogin(state.authError));
        return;
      }
      if (!state.boot) {
        root.appendChild(state.authError ? renderHomeLogin(state.authError) : el('p', { className: 'panel', text: '読み込み中…' }));
        return;
      }
      var s = state.boot.storage;
      if (!s.configured || !s.accessible || !s.initialized) {
        root.appendChild(state.boot.role.isPlatformAdmin ? renderSetup(s) : renderMessage('準備中です', s.message || '管理者の設定が終わるまでお待ちください。'));
        return;
      }
      if (mode === 'event' && state.noAccess) root.appendChild(renderNoAccess(state.route.eventId));
      else if (state.eventId) root.appendChild(renderEvent());
      else if (mode === 'admin') root.appendChild(renderAdminHome());
      else if (state.boot.role.kind === 'google') root.appendChild(renderHome());
      else root.appendChild(renderHomeLogin(''));
      setBusy(state.busy);
    }

    /** 右上: 誰としてログインしているか・ログアウト */
    function renderWho() {
      var who = doc.getElementById('actor');
      if (!who) return;
      who.textContent = '';
      var mode = state.route.mode;
      var label = '';
      if (mode === 'admin') label = state.adminKey ? '管理者' : '';
      else if (mode === 'event' && staffLogin(state.route.eventId)) label = 'スタッフ（管理パスワード）';
      else if (state.google) label = state.google.email;
      if (!label) return;
      who.appendChild(el('span', { className: 'topbar__name', text: label }));
      if (mode !== 'admin') who.appendChild(el('button', { className: 'btn btn--ghost btn--small topbar__logout', type: 'button', text: 'ログアウト', onClick: logout }));
    }

    function renderMessage(title, text) {
      return el('section', { className: 'panel' }, [
        el('h2', { text: title }),
        el('p', { text: text }),
        el('p', null, [el('a', { href: '#', text: '主催者のページへ' })]),
      ]);
    }

    function renderAdminLogin(error) {
      var input = el('input', { type: 'password', id: 'admin-key', className: 'input', autocomplete: 'current-password' });
      return el('section', { className: 'panel' }, [
        el('h2', { text: '管理者' }),
        el('p', { className: 'muted', text: '運営用 Apps Script のスクリプト プロパティ ADMIN_KEY に設定した文字列を入力してください。このタブを閉じるまで記憶します。' }),
        error ? el('p', { className: 'error', text: error }) : null,
        el('form', {
          className: 'row',
          onSubmit: function (e) {
            e.preventDefault();
            state.adminKey = input.value.trim();
            storageSet('sessionStorage', 'tpoc-admin-key', state.adminKey);
            state.authError = '';
            render();
            loadBoot();
          },
        }, [el('label', { className: 'visually-hidden', for: 'admin-key', text: '管理者の鍵' }), input, el('button', { className: 'btn btn--primary', type: 'submit', text: '開く' })]),
      ]);
    }

    /** ログイン前のホーム: 主催者は Google でログイン。スタッフには大会の URL を開くよう案内する */
    function renderHomeLogin(error) {
      return el('div', { className: 'stack' }, [
        el('section', { className: 'panel' }, [
          el('h2', { text: '大会を主催する' }),
          el('p', { text: 'Google アカウントでログインすると、大会を作成し、自分が作った大会の運営画面を開けます。' }),
          error ? el('p', { className: 'error', text: error }) : null,
          googleButton(),
        ]),
        el('section', { className: 'panel' }, [
          el('h2', { text: '店舗スタッフの方' }),
          el('p', { className: 'muted', text: '主催者から教わった大会の運営画面の URL を開き、管理パスワードを入力してください。' }),
        ]),
      ]);
    }

    /** 大会の運営画面をログイン前に開いた: 主催者は Google、スタッフは管理パスワード */
    function renderEventLogin(eventId, error) {
      return el('div', { className: 'stack' }, [
        el('section', { className: 'panel' }, [
          el('h2', { text: 'この大会の運営画面を開く' }),
          state.route.legacyKey ? el('p', { className: 'notice', text: 'v0.4 までの「運営用 URL」は使えなくなりました。主催者は Google でログイン、スタッフは管理パスワードで開いてください。' }) : null,
          error ? el('p', { className: 'error', text: error }) : null,
          el('h3', { text: '店舗スタッフの方（管理パスワード）' }),
          staffPasswordForm(eventId),
          el('h3', { text: '主催者の方（大会を作った Google アカウント）' }),
          googleButton(),
        ]),
      ]);
    }

    /** ログインしているが、この大会を運営できない（他人の大会・存在しない大会） */
    function renderNoAccess(eventId) {
      return el('div', { className: 'stack' }, [
        el('section', { className: 'panel' }, [
          el('h2', { text: 'この大会を運営する権限がありません' }),
          el('p', { text: (state.google ? state.google.email + ' が作った大会ではないか、' : '') + '大会が見つかりません。店舗スタッフの方は管理パスワードを入力してください。' }),
          state.authError ? el('p', { className: 'error', text: state.authError }) : null,
          staffPasswordForm(eventId),
          el('p', null, [el('a', { href: '#', text: '自分の大会の一覧へ' })]),
        ]),
      ]);
    }

    function selectText(node) {
      var r = doc.createRange();
      r.selectNodeContents(node);
      var sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      toast('ok', '選択しました。Ctrl+C（Mac は ⌘C）でコピーしてください。');
    }

    function renderSetup(s) {
      var panel = el('section', { className: 'panel' }, [el('h2', { text: '初期セットアップ' })]);
      if (!s.configured) {
        var input = el('input', { type: 'text', id: 'spreadsheet-id', className: 'input', autocomplete: 'off', placeholder: 'https://docs.google.com/spreadsheets/d/…' });
        panel.appendChild(el('p', { text: 'データ保存用のスプレッドシート（PoC 専用の空のもの）の共有リンク、または ID を入力してください。' }));
        panel.appendChild(
          el('form', {
            className: 'row',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('configureStorage', { spreadsheetId: input.value }, '保存先を設定しました。');
            },
          }, [el('label', { className: 'visually-hidden', for: 'spreadsheet-id', text: 'スプレッドシート ID' }), input, el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '設定' })])
        );
        return panel;
      }
      if (!s.accessible) {
        panel.appendChild(el('p', { className: 'error', text: s.message }));
        return panel;
      }
      panel.appendChild(el('p', { text: '保存先: ' + s.spreadsheetName }));
      panel.appendChild(el('p', { text: '不足しているシート・列: ' + (s.missing.join('、') || 'なし') }));
      panel.appendChild(el('p', { className: 'muted', text: '初期化は何度実行しても既存データを消しません。管理対象外のデータがあるスプレッドシートでは中止します。' }));
      panel.appendChild(
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          'data-mut': true,
          text: '初期化する',
          onClick: function () {
            mutate('initializeStorage', {}, '初期化しました。');
          },
        })
      );
      return panel;
    }

    /** 大会作成フォーム（Google でログインした主催者と管理者） */
    function createForms() {
      var wrap = el('div', { className: 'stack' });
      var name = el('input', { className: 'input', id: 'new-name', required: true, maxlength: 80 });
      var date = el('input', { className: 'input', id: 'new-date', maxlength: 40, placeholder: '例: 2026/11/03' });
      var organizer = el('input', { className: 'input', id: 'new-organizer', maxlength: 40, placeholder: '例: 〇〇ダーツ部（任意・非公開）' });
      // 形式のプルダウン: 基本 → 上級の順（shared/formats.js の並び。新しい大会の初期選択は「予選ロビン → 決勝トーナメント」）
      var template = el('select', { className: 'input', id: 'new-template' }, [
        el('optgroup', { label: '基本' }, FORMATS.filter(function (f) { return f.group === 'basic'; }).map(function (f) {
          return el('option', { value: f.id, text: f.label, selected: f.id === global.DEFAULT_FORMAT_ID ? true : null });
        })),
        el('optgroup', { label: '上級' }, FORMATS.filter(function (f) { return f.group === 'advanced'; }).map(function (f) {
          return el('option', { value: f.id, text: f.label });
        })),
      ]);
      var formatInfo = el('div', { className: 'format-info', 'aria-live': 'polite' });
      var rule = ruleInputs('new', { format: 'legs', bestOf: 5, setBestOf: 5, provisional: true });
      var num = function (id, value, min, max) {
        return el('input', { className: 'input input--short', id: id, type: 'number', min: min, max: max, value: String(value), inputmode: 'numeric' });
      };
      var D = global.FORMAT_DEFAULTS || {};
      var inputs = {
        groups: num('new-groups', D.groups || 4, 1, 16),
        advance: num('new-advance', D.advance || 2, 1, 16),
        groups2: num('new-groups2', D.groups2 || 2, 1, 16),
        advance2: num('new-advance2', D.advance2 || 2, 1, 16),
        divisions: num('new-divisions', D.divisions || 1, 1, 16),
        playoff: num('new-playoff', D.playoff || 4, 2, 64),
        playoffOptional: num('new-playoff-opt', 0, 0, 64),
        nights: num('new-nights', D.nights || 16, 1, 30),
        swissRounds: num('new-swiss-rounds', D.swissRounds || 5, 1, 15),
        nightPoints: el('input', { className: 'input', id: 'new-night-points', value: (D.nightPoints || [5, 3, 2, 0]).join(', '), 'aria-describedby': 'new-night-points-help' }),
        pWin: num('new-p-win', 2, -99, 99),
        pDraw: num('new-p-draw', 1, -99, 99),
        pLoss: num('new-p-loss', 0, -99, 99),
        thirdPlace: el('input', { type: 'checkbox', id: 'new-third' }),
        cycles: el('select', { className: 'input input--short', id: 'new-cycles' }, [el('option', { value: '1', text: '1 回' }), el('option', { value: '2', text: '2 回' })]),
        grandFinal: el('select', { className: 'input', id: 'new-gf' }, [
          el('option', { value: 'reset', text: '敗者側の選手が勝ったら、もう 1 試合（リセット）' }),
          el('option', { value: 'single', text: '1 試合のみ（勝者側の選手もここで負けたら 1 敗で敗退）' }),
        ]),
      };
      var expected = num('new-expected', 16, 2, 128);
      var fields = {
        groups: field('ロビンのグループ数', inputs.groups),
        advance: field('各組の何位までが次へ進むか（通過順位）', inputs.advance),
        groups2: field('2 次ロビンの組の数', inputs.groups2),
        advance2: field('2 次ロビンの各組から決勝へ進む順位', inputs.advance2),
        cycles: field('総当たりの回数', inputs.cycles),
        divisions: field('ディビジョン数（リーグの組）', inputs.divisions),
        points: el('div', { className: 'field' }, [
          el('span', { className: 'field__label', text: '勝ち点（勝ち・引き分け・負け。アプリの既定値は 2・1・0）' }),
          el('div', { className: 'row row--tight' }, [el('span', { text: '勝ち' }), inputs.pWin, el('span', { text: '引き分け' }), inputs.pDraw, el('span', { text: '負け' }), inputs.pLoss]),
        ]),
        playoff: field('プレーオフ（決勝）に進む人数', inputs.playoff),
        playoffOptional: field('決勝トーナメントに進む人数（0 = 行わない）', inputs.playoffOptional),
        nights: field('節の数（各節で小トーナメント）', inputs.nights),
        nightPoints: el('div', { className: 'field' }, [
          el('span', { className: 'field__label', text: '各節の順位ポイント（優勝, 準優勝, 準決勝敗退, 準々決勝敗退 …）' }),
          inputs.nightPoints,
          el('span', { className: 'muted small', id: 'new-night-points-help', text: '例は 8 人の節: 優勝 5・準優勝 3・準決勝敗退 2・初戦敗退 0。到達した順位の総点で、勝った回戦の点を足し合わせません。' }),
        ]),
        swissRounds: field('スイス式の回戦数', inputs.swissRounds),
        grandFinal: field('グランドファイナルの方式', inputs.grandFinal),
        thirdPlace: el('label', { className: 'check' }, [inputs.thirdPlace, ' トーナメントに 3 位決定戦を入れる']),
      };
      var estimateBox = el('div', { className: 'estimate', 'aria-live': 'polite' });
      var paramsOf = function () {
        var f = formatById(template.value);
        return {
          players: Number(expected.value),
          groups: Number(inputs.groups.value),
          advance: Number(inputs.advance.value),
          groups2: Number(inputs.groups2.value),
          advance2: Number(inputs.advance2.value),
          cycles: Number(inputs.cycles.value),
          divisions: Number(inputs.divisions.value),
          playoff: f && f.fields.indexOf('playoffOptional') !== -1 ? Number(inputs.playoffOptional.value) : Number(inputs.playoff.value),
          nights: Number(inputs.nights.value),
          swissRounds: Number(inputs.swissRounds.value),
          thirdPlace: inputs.thirdPlace.checked,
          grandFinal: inputs.grandFinal.value,
        };
      };
      var sync = function () {
        var f = formatById(template.value);
        formatInfo.textContent = '';
        if (f) {
          formatInfo.appendChild(el('p', { className: 'format-info__flow', text: '流れ: ' + f.flow }));
          formatInfo.appendChild(el('p', { className: 'muted small', text: f.description }));
        }
        Object.keys(fields).forEach(function (k) {
          fields[k].hidden = !f || f.fields.indexOf(k) === -1;
        });
        fields.advance.firstChild.textContent = f && f.id === 'robin_ab' ? 'A トーナメントへ進む順位（各組の上位何位まで。残りは B へ）' : '各組の何位までが次へ進むか（通過順位）';
        estimateBox.textContent = '';
        if (!f || typeof global.estimateFormat_ !== 'function') return;
        var est = global.estimateFormat_(f.id, paramsOf());
        estimateBox.appendChild(el('p', { className: 'estimate__total', text: '予定試合数: ' + est.total + (est.max !== est.total ? '〜' + est.max : '') + ' 試合（' + expected.value + ' 人の場合）' }));
        estimateBox.appendChild(el('ul', { className: 'plain-list' }, est.stages.map(function (st) {
          return el('li', { text: st.name + ': ' + st.matches + ' 試合' + (st.note ? '（' + st.note + '）' : '') });
        })));
        est.problems.forEach(function (msg) {
          estimateBox.appendChild(el('p', { className: 'error small', text: '成り立たない条件: ' + msg }));
        });
        est.notes.forEach(function (msg) {
          estimateBox.appendChild(el('p', { className: 'muted small', text: msg }));
        });
      };
      [template, expected].concat(Object.keys(inputs).map(function (k) { return inputs[k]; })).forEach(function (x) {
        x.addEventListener('change', sync);
        x.addEventListener('input', sync);
      });
      sync();
      var parseNightPoints = function () {
        return inputs.nightPoints.value.split(/[,、\s]+/).filter(Boolean).map(Number);
      };
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '大会を作成' }),
          el('form', {
            className: 'form',
            onSubmit: function (e) {
              e.preventDefault();
              var f = formatById(template.value) || { fields: [] };
              var has = function (k) {
                return f.fields.indexOf(k) !== -1;
              };
              mutate('createEvent', {
                name: name.value,
                dateLabel: date.value,
                organizerName: organizer.value,
                template: template.value,
                rule: rule.value(),
                groupCount: Number(inputs.groups.value),
                advanceCount: Number(inputs.advance.value),
                groupCount2: has('groups2') ? Number(inputs.groups2.value) : undefined,
                advanceCount2: has('advance2') ? Number(inputs.advance2.value) : undefined,
                thirdPlace: inputs.thirdPlace.checked,
                cycles: Number(inputs.cycles.value),
                divisions: has('divisions') ? Number(inputs.divisions.value) : undefined,
                points: has('points') ? { win: Number(inputs.pWin.value), draw: Number(inputs.pDraw.value), loss: Number(inputs.pLoss.value) } : undefined,
                playoff: has('playoff') ? Number(inputs.playoff.value) : has('playoffOptional') ? Number(inputs.playoffOptional.value) : undefined,
                nights: has('nights') ? Number(inputs.nights.value) : undefined,
                nightPoints: has('nightPoints') ? parseNightPoints() : undefined,
                swissRounds: has('swissRounds') ? Number(inputs.swissRounds.value) : undefined,
                grandFinal: has('grandFinal') ? inputs.grandFinal.value : undefined,
              }, '大会を作成しました。');
            },
          }, [
            field('大会名', name),
            field('開催日（表示用の文字列）', date),
            field('主催者名（任意。管理者だけが見ます）', organizer),
            field('大会の形式（作成後に「形式」タブで段階の追加・変更ができます）', template),
            formatInfo,
            rule.node,
            fields.groups,
            fields.advance,
            fields.groups2,
            fields.advance2,
            fields.cycles,
            fields.divisions,
            fields.points,
            fields.playoff,
            fields.playoffOptional,
            fields.nights,
            fields.nightPoints,
            fields.swissRounds,
            fields.grandFinal,
            fields.thirdPlace,
            el('div', { className: 'estimate-panel' }, [field('想定の参加人数（予定試合数の見積もり用。保存しません）', expected), estimateBox]),
            el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '大会を作成' }),
          ]),
        ])
      );
      wrap.appendChild(restorePanel());
      var publishSample = el('input', { type: 'checkbox', id: 'sample-publish' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '検証用サンプル' }),
          el('p', { className: 'muted', text: '16 名（サンプル選手01〜16）・4 人 × 4 グループのロビン、Best of 5 Legs（暫定）。確定・進行中・未開始の試合を含みます。' }),
          el('label', { className: 'check' }, [publishSample, ' 作成後すぐ閲覧画面に公開する']),
          el('button', {
            className: 'btn',
            type: 'button',
            'data-mut': true,
            text: 'サンプル大会を作成',
            onClick: function () {
              mutate('createSampleEvent', { publish: publishSample.checked }, 'サンプル大会を作成しました。');
            },
          }),
        ])
      );
      return wrap;
    }

    function formatById(id) {
      return FORMATS.filter(function (f) {
        return f.id === id;
      })[0] || null;
    }

    /**
     * 保存したファイル（JSON）から新しい大会として復元する（F21）。ファイルの中身を画面で確認してから送る。
     * 既存の大会は上書きしない。所有者は復元する人、管理パスワード・共同主催者・履歴は復元しない。
     */
    function restorePanel() {
      var file = el('input', { type: 'file', id: 'restore-file', accept: '.json,application/json' });
      var info = el('div', { className: 'stack stack--tight', 'aria-live': 'polite' });
      var mode = el('select', { className: 'input', id: 'restore-mode' }, [
        el('option', { value: 'settings', text: '設定だけ（段階・ルール・組の設定）' }),
        el('option', { value: 'full', text: '結果も（選手・組み合わせ・試合結果）' }),
      ]);
      var players = el('input', { type: 'checkbox', id: 'restore-players' });
      var nameInput = el('input', { className: 'input', id: 'restore-name', maxlength: 80 });
      var button = el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': '1', disabled: true, text: '新しい大会として復元' });
      var archive = null;
      var playersField = el('label', { className: 'check' }, [players, ' 選手も復元する']);
      mode.addEventListener('change', function () {
        playersField.hidden = mode.value === 'full';
      });
      file.addEventListener('change', function () {
        archive = null;
        info.textContent = '';
        button.setAttribute('data-locked', '1');
        button.disabled = true;
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 1900000) {
          info.appendChild(el('p', { className: 'error', text: 'ファイルが大きすぎます（1.9MB まで）。' }));
          return;
        }
        var reader = new win.FileReader();
        reader.onload = function () {
          var data = null;
          try {
            data = JSON.parse(String(reader.result));
          } catch (e) {
            data = null;
          }
          if (!data || data.format !== 'n02-tournament-archive' || !data.tables || !data.event) {
            info.appendChild(el('p', { className: 'error', text: 'n02 の大会データのファイル（「大会のデータを保存」で作ったもの）ではありません。' }));
            return;
          }
          archive = data;
          var t = data.tables;
          var count = function (k) {
            return (t[k] || []).length;
          };
          info.appendChild(el('p', { text: '大会「' + data.event.name + '」（' + (data.exportedAt ? formatDateTime(data.exportedAt) + ' に保存' : '保存日時不明') + '）' }));
          info.appendChild(el('p', { className: 'muted small', text: '段階 ' + count('Stages') + '・選手 ' + count('Players') + '・試合 ' + count('Matches') + '（うち確定 ' + (t.Matches || []).filter(function (m) { return m.status === 'final'; }).length + '）。新しい大会として登録し、元の大会や他の大会は変更しません。' }));
          nameInput.value = String(data.event.name || '') + '（復元）';
          button.setAttribute('data-locked', '0');
          button.disabled = state.busy;
        };
        reader.readAsText(f);
      });
      button.addEventListener('click', function () {
        if (!archive) return;
        mutate('restoreEvent', { archive: archive, mode: mode.value, includePlayers: players.checked, name: nameInput.value }, function (r) {
          return '復元しました（選手 ' + r.restored.players + '・試合 ' + r.restored.matches + '）。';
        });
      });
      return el('section', { className: 'panel' }, [
        el('h2', { text: '保存したファイルから復元' }),
        el('p', { className: 'muted small', text: '「出力・印刷」タブ（または大会の削除の前）に保存した JSON ファイルから、新しい大会を作ります。管理パスワード・共同主催者・変更履歴は復元しません。ファイルの内容に不正があるときは何も登録しません。' }),
        field('ファイル', file),
        info,
        field('復元する内容', mode),
        playersField,
        field('新しい大会の名前', nameInput),
        el('div', { className: 'btn-row' }, [button]),
      ]);
    }

    /** event-card の一覧（主催者のホーム・管理者の一覧で共通） */
    function eventCards(events, admin) {
      return events.map(function (ev) {
        return el('article', { className: 'event-card' }, [
          el('div', { className: 'event-card__main' }, [
            el('h3', { text: ev.name }),
            el('p', { className: 'muted', text: [ev.dateLabel, EVENT_STATUS_LABEL[ev.status] || ev.status, admin && ev.organizerName ? '主催: ' + ev.organizerName : '', admin && ev.ownerEmail ? ev.ownerEmail : '', '選手 ' + ev.playerCount + ' 名', '確定 ' + ev.finalCount + ' / ' + ev.matchCount + ' 試合'].filter(Boolean).join('・') }),
            el('p', null, [
              el('span', { className: 'badge ' + (ev.isPublic ? 'badge--on' : ''), text: ev.isPublic ? '公開中' : '非公開' }),
              ev.isFeatured ? el('span', { className: 'badge badge--on', text: '既定表示' }) : null,
              ev.isSample ? el('span', { className: 'badge', text: 'サンプル' }) : null,
              ev.role === 'editor' ? el('span', { className: 'badge', text: '共同主催' }) : null,
              ev.staffPasswordSet ? el('span', { className: 'badge', text: '管理パスワード設定済み' }) : null,
              admin && !ev.ownerEmail ? el('span', { className: 'badge', text: '主催者未設定' }) : null,
              admin && ev.ownerEmail && ev.ownerLinked === false ? el('span', { className: 'badge', text: ev.ownerClaims ? '主催者の承認待ち ' + ev.ownerClaims : '主催者の紐付け待ち' }) : null,
            ]),
          ]),
          el('button', { className: 'btn', type: 'button', text: '開く', onClick: function () { openEvent(ev.id); } }),
        ]);
      });
    }

    /** Google でログインした主催者のホーム: 自分の大会の一覧と新しい大会の作成 */
    function renderHome() {
      var boot = state.boot;
      var wrap = el('div', { className: 'stack' });
      var list = el('section', { className: 'panel' }, [el('h2', { text: 'あなたの大会' })]);
      var link = boot.role.link;
      // v0.9: Google が持ち主を保証しないアドレスの大会・招待は、主催者（招待）・管理者（大会）の承認を待つ
      if (link && link.pending) list.appendChild(el('p', { className: 'notice', text: 'このアカウントの確認待ちが ' + link.pending + ' 件あります（大会の主催者・共同主催者としての紐付け）。承認されるとここに表示されます。招待した人（大会の主催者）または管理者に、ログインしたことを伝えてください。' }));
      if (!boot.events.length) list.appendChild(el('p', { className: 'muted', text: 'まだ大会がありません。下のフォームから作成してください。' }));
      eventCards(boot.events, false).forEach(function (n) {
        list.appendChild(n);
      });
      wrap.appendChild(list);
      Array.prototype.slice.call(createForms().childNodes).forEach(function (n) {
        wrap.appendChild(n);
      });
      return wrap;
    }

    function renderAdminHome() {
      var boot = state.boot;
      var wrap = el('div', { className: 'stack' });
      var list = el('section', { className: 'panel' }, [el('h2', { text: 'すべての大会（管理者）' })]);
      if (!boot.events.length) list.appendChild(el('p', { className: 'muted', text: 'まだ大会がありません。' }));
      eventCards(boot.events, true).forEach(function (n) {
        list.appendChild(n);
      });
      wrap.appendChild(list);
      Array.prototype.slice.call(createForms().childNodes).forEach(function (n) {
        wrap.appendChild(n);
      });
      var viewerUrl = el('input', { className: 'input', id: 'viewer-url', value: boot.viewerUrl, placeholder: 'https://<ユーザー名>.github.io/<リポジトリ名>/' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '閲覧者用 URL' }),
          el('p', { className: 'muted', text: '閲覧ページ（GitHub Pages）の URL。各大会の「進行状況」に、大会ごとの閲覧用リンクとして表示されます。' }),
          el('form', {
            className: 'row',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('setViewerUrl', { url: viewerUrl.value }, '保存しました。');
            },
          }, [el('label', { className: 'visually-hidden', for: 'viewer-url', text: '閲覧者用 URL' }), viewerUrl, el('button', { className: 'btn', type: 'submit', 'data-mut': true, text: '保存' })]),
          el('p', { className: 'muted small', text: 'データ保存先: ' + boot.storage.spreadsheetName + '（ID: ' + boot.storage.spreadsheetId + '）' }),
        ])
      );
      return wrap;
    }

    function field(label, control) {
      return el('label', { className: 'field' }, [el('span', { className: 'field__label', text: label }), control]);
    }

    function renderEvent() {
      var wrap = el('div', { className: 'stack' });
      var d = state.detail;
      wrap.appendChild(
        el('div', { className: 'event-head' }, [
          state.route.mode === 'admin' || (state.google && !staffLogin(state.eventId)) ? el('button', { className: 'btn btn--ghost', type: 'button', text: state.route.mode === 'admin' ? '← 大会一覧' : '← あなたの大会', onClick: goHome }) : null,
          el('h2', { className: 'event-head__title', text: d ? d.event.name : '読み込み中…' }),
          d ? el('span', { className: 'badge ' + (d.event.isPublic ? 'badge--on' : ''), text: d.event.isPublic ? '公開中' : '非公開' }) : null,
        ])
      );
      if (!d) return wrap;
      var tabs = el('nav', { className: 'tabs', 'aria-label': '大会メニュー' });
      TABS.forEach(function (t) {
        tabs.appendChild(
          el('button', {
            type: 'button',
            className: 'tab',
            'aria-current': state.tab === t.id ? 'page' : null,
            text: t.label,
            onClick: function () {
              state.tab = t.id;
              render();
            },
          })
        );
      });
      wrap.appendChild(tabs);
      var body = {
        progress: renderProgress,
        matches: renderMatches,
        schedule: renderSchedule,
        players: renderPlayers,
        format: renderFormat,
        pairing: renderPairing,
        settings: renderSettings,
        output: renderOutput,
        history: renderHistory,
      }[state.tab]();
      wrap.appendChild(body);
      return wrap;
    }

    /* ---------- 段階の選択（試合結果・組み合わせタブ共通） ---------- */

    function currentStage() {
      var d = state.detail;
      var st = d.stages.filter(function (s) {
        return s.id === state.stageId;
      })[0];
      return st || d.stages[0];
    }

    function stageChips() {
      var d = state.detail;
      if (d.stages.length < 2) return null;
      var cur = currentStage();
      var chips = el('div', { className: 'chips', role: 'group', 'aria-label': '段階' });
      d.stages.forEach(function (st) {
        chips.appendChild(
          el('button', {
            type: 'button',
            className: 'chip',
            'aria-pressed': String(cur.id === st.id),
            text: st.name,
            onClick: function () {
              state.stageId = st.id;
              state.matchFilter = 'all';
              render();
            },
          })
        );
      });
      return chips;
    }

    /** 段階の試合を、見出しごとのまとまりにする（グループ・回戦・勝者側/敗者側・節） */
    function stageSections(st) {
      if (st.groups) {
        return st.groups.map(function (g) {
          return { id: g.id, name: g.name, matches: g.matches };
        });
      }
      if (st.sides) {
        var out = [];
        st.sides.forEach(function (side) {
          side.rounds.forEach(function (r) {
            out.push({ id: side.side + r.round, name: r.label || side.label, matches: r.matches });
          });
        });
        return out;
      }
      if (st.nights) {
        return st.nights
          .filter(function (n) {
            return n.rounds.length;
          })
          .map(function (n) {
            return {
              id: n.id,
              name: n.name + (n.date ? '（' + n.date + '）' : ''),
              matches: n.rounds.reduce(function (all, r) {
                return all.concat(r.matches);
              }, []),
            };
          });
      }
      return (st.rounds || []).map(function (r) {
        return { id: 'r' + r.round, name: r.label, matches: r.matches };
      });
    }

    function stageMatches(st) {
      return stageSections(st).reduce(function (all, sec) {
        return all.concat(sec.matches);
      }, []);
    }

    function stageStatusText(st) {
      if (st.type === 'single_elimination' || st.type === 'double_elimination') {
        if (st.champion) return '優勝: ' + st.champion.name;
        if (!st.progress.total) return st.entries.length ? '出場 ' + st.entries.length + ' 名・トーナメント表は未作成' : '出場者未定';
      } else if (st.type === 'swiss') {
        return (st.swiss ? st.swiss.generated : 0) + ' / ' + st.config.rounds + ' 回戦' + (st.advanced ? '・進出確定済み' : '');
      } else if (st.type === 'series') {
        return st.nightsComplete + ' / ' + st.planned + ' 節' + (st.advanced ? '・進出確定済み' : '');
      } else if (st.advanced) {
        return '進出確定済み';
      }
      return '';
    }

    function renderProgress() {
      var d = state.detail;
      var p = d.progress;
      var panel = el('section', { className: 'panel' }, [el('h3', { text: '進行状況' })]);
      var pct = p.total ? Math.round((p.final / p.total) * 100) : 0;
      // CSP（style-src 'self'）では style 属性の文字列が無効になるため、幅は CSSOM で設定する
      var bar = el('div', { className: 'meter__bar' });
      bar.style.width = pct + '%';
      panel.appendChild(el('div', { className: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, [bar]));
      panel.appendChild(el('p', { text: '確定 ' + p.final + ' / ' + p.total + ' 試合（進行中 ' + p.live + '・未開始 ' + p.scheduled + (p.pending ? '・対戦待ち ' + p.pending : '') + (p.check ? '・要確認 ' + p.check : '') + '）' }));
      // 全段階が終わったら「終了」を案内する（終了にすると、閲覧ページの自動更新が止まり、実行数が増えない）
      var ev = d.event;
      var completion = d.completion || { complete: false, reasons: [] };
      var autoFinish = ev.config && ev.config.autoFinish;
      if (completion.complete && ev.status !== 'finished') {
        panel.appendChild(
          el('div', { className: 'notice finish-hint' }, [
            el('p', { text: 'すべての段階が終わりました。大会を「終了」にすると、閲覧ページの自動更新が止まります（終了にしなくても、1 時間変化がなければ止まります）。' }),
            el('button', {
              className: 'btn btn--primary',
              type: 'button',
              'data-mut': true,
              text: '大会を「終了」にする',
              onClick: function () {
                mutate('updateEvent', { eventId: ev.id, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: 'finished', isPublic: ev.isPublic, isFeatured: ev.isFeatured, notes: ev.notes || '' }, '大会を「終了」にしました。');
              },
            }),
          ])
        );
      } else if (!completion.complete && completion.reasons.length && p.total > 0) {
        panel.appendChild(el('div', { className: 'stack stack--tight' }, [
          el('p', { className: 'muted small', text: '終わっていないもの（' + (autoFinish ? 'すべて終わると自動で「終了」にします' : '自動終了は「大会設定」で有効にできます') + '）:' }),
          el('ul', { className: 'plain-list' }, completion.reasons.map(function (r) {
            return el('li', { text: r });
          })),
        ]));
      }
      if (ev.status === 'finished' && ev.config && ev.config.autoFinishedAt) {
        panel.appendChild(el('p', { className: 'muted small', text: '全段階が終わったので自動で「終了」にしました（' + formatDateTime(ev.config.autoFinishedAt) + '）。結果を訂正して終わっていない段階ができると「開催中」に戻ります。' }));
      }
      var rows = [];
      d.stages.forEach(function (st) {
        rows.push(
          el('tr', null, [
            el('th', { scope: 'row', text: st.name + '（' + STAGE_TYPE_LABEL[st.type] + '）' }),
            el('td', { text: st.progress.final + ' / ' + st.progress.total }),
            el('td', { text: String(st.progress.live) }),
            el('td', { text: stageStatusText(st) }),
          ])
        );
        (st.groups || []).forEach(function (g) {
          if (st.groups.length < 2) return;
          rows.push(el('tr', { className: 'sub' }, [el('th', { scope: 'row', text: '　' + g.name + '（' + g.players.length + ' 名）' }), el('td', { text: g.progress.final + ' / ' + g.progress.total }), el('td', { text: String(g.progress.live) }), el('td', { text: '' })]));
        });
      });
      panel.appendChild(
        el('div', { className: 'table-wrap' }, [
          el('table', { className: 'table' }, [
            el('thead', null, [el('tr', null, ['段階', '確定', '進行中', '状況'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
            el('tbody', null, rows),
          ]),
        ])
      );

      var pub = el('section', { className: 'panel' }, [el('h3', { text: '公開' })]);
      if (d.publication.published) {
        pub.appendChild(el('p', { text: '閲覧画面に公開中（公開データ更新: ' + formatDateTime(d.publication.publishedAt) + '）' + (d.publication.isDefault ? '・既定表示の大会' : '') }));
      } else {
        pub.appendChild(el('p', { text: '非公開です。「大会設定」で公開にすると閲覧画面に表示されます。' }));
      }
      pub.appendChild(el('p', { className: 'muted small', text: '閲覧画面は約 60 秒ごとに自動更新されます（閲覧側のキャッシュを含め、反映まで最大 1〜2 分程度）。' }));
      if (d.snapshotBudget) {
        var b = d.snapshotBudget;
        pub.appendChild(el('p', { className: b.percent >= 80 ? 'error small' : 'muted small', text: '公開データの大きさ: ' + b.size.toLocaleString('ja-JP') + ' / ' + b.limit.toLocaleString('ja-JP') + ' 文字（' + b.percent + '%）。' + (b.percent >= 80 ? '上限に近づいています。上限を超える変更は保存されません（段階・グループを分けるか、非公開にしてください）。' : '上限を超える変更は保存前に止めます。') }));
      }
      var viewerUrl = state.boot && state.boot.viewerUrl;
      if (viewerUrl && d.publication.published) {
        var href = viewerUrl + '?event=' + encodeURIComponent(d.event.id);
        pub.appendChild(el('p', null, [el('a', { href: href, target: '_blank', rel: 'noopener', text: '閲覧画面を開く' })]));
        pub.appendChild(renderShareQr(href, d.event));
      }
      pub.appendChild(
        el('button', {
          className: 'btn',
          type: 'button',
          'data-mut': true,
          text: '公開データを再生成',
          onClick: function () {
            mutate('republish', { eventId: d.event.id }, '公開データを再生成しました。');
          },
        })
      );
      return el('div', { className: 'stack' }, [panel, pub]);
    }

    function renderMatches() {
      var d = state.detail;
      var st = currentStage();
      var wrap = el('div', { className: 'stack' });
      var filters = el('div', { className: 'panel panel--tight' });
      var sc = stageChips();
      if (sc) filters.appendChild(sc);
      var sections = stageSections(st);
      if (sections.length > 1) {
        var chips = el('div', { className: 'chips', role: 'group', 'aria-label': st.groups ? 'グループ' : 'ラウンド' });
        [{ id: 'all', name: 'すべて' }].concat(sections).forEach(function (g) {
          chips.appendChild(el('button', { type: 'button', className: 'chip', 'aria-pressed': String(state.matchFilter === g.id), text: g.name, onClick: function () { state.matchFilter = g.id; render(); } }));
        });
        filters.appendChild(chips);
      }
      var chips2 = el('div', { className: 'chips', role: 'group', 'aria-label': '状態' });
      [{ id: 'open', name: '未確定のみ' }, { id: 'all', name: 'すべての状態' }, { id: 'final', name: '確定済みのみ' }].forEach(function (f) {
        chips2.appendChild(el('button', { type: 'button', className: 'chip', 'aria-pressed': String(state.statusFilter === f.id), text: f.name, onClick: function () { state.statusFilter = f.id; render(); } }));
      });
      filters.appendChild(chips2);
      wrap.appendChild(filters);

      var any = false;
      sections.forEach(function (sec) {
        if (state.matchFilter !== 'all' && state.matchFilter !== sec.id) return;
        var ms = sec.matches.filter(function (m) {
          if (state.statusFilter === 'open') return (m.status !== 'final' && m.status !== 'void' && m.status !== 'bye') || state.editing[m.id];
          if (state.statusFilter === 'final') return m.status === 'final' || m.status === 'bye';
          return true;
        });
        if (!ms.length) return;
        any = true;
        wrap.appendChild(el('section', { className: 'panel' }, [el('h3', { text: sec.name })].concat(ms.map(function (m) { return renderMatchEditor(m); }))));
      });
      wrap.appendChild(batchBar(st));
      if (!any) {
        var empty = stageMatches(st).length
          ? '該当する試合はありません。'
          : st.type === 'single_elimination' || st.type === 'double_elimination'
            ? 'トーナメント表がありません。「組み合わせ」タブで作成してください。'
            : st.type === 'swiss'
              ? '組み合わせがありません。「組み合わせ」タブで「次の回戦を組む」を押してください。'
              : st.type === 'series'
                ? '組み合わせのある節がありません。「組み合わせ」タブで節を組んでください。'
                : '対戦カードがありません。「組み合わせ」タブで作成してください。';
        wrap.appendChild(el('p', { className: 'panel muted', text: empty }));
      }
      return wrap;
    }

    /** 下書きのうち、そのまま「確定」できる結果（Leg 制は画面側でも成立条件を確認。セット制の Leg 合計はサーバーで確認） */
    function batchCandidates(st) {
      var out = [];
      stageMatches(st).forEach(function (m) {
        var dr = state.drafts[m.id];
        if (!dr || dr.rev !== m.rev || m.storedStatus === 'final' || m.status === 'pending' || m.status === 'bye' || m.status === 'void' || state.editing[m.id]) return;
        var spec = m.spec || { format: 'legs', bestOf: m.bestOf };
        if (spec.format === 'fixed') {
          if (checkFixed('final', dr.p1.trim(), dr.p2.trim(), spec.bestOf)) return;
          out.push({ m: m, result: { matchId: m.id, rev: m.rev, p1Legs: dr.p1.trim(), p2Legs: dr.p2.trim() } });
        } else if (spec.format === 'sets') {
          if (checkResult('final', dr.p1.trim(), dr.p2.trim(), spec.bestOf)) return;
          out.push({ m: m, result: { matchId: m.id, rev: m.rev, p1Sets: dr.p1.trim(), p2Sets: dr.p2.trim(), p1Legs: dr.l1.trim(), p2Legs: dr.l2.trim() } });
        } else {
          if (checkResult('final', dr.p1.trim(), dr.p2.trim(), spec.bestOf)) return;
          out.push({ m: m, result: { matchId: m.id, rev: m.rev, p1Legs: dr.p1.trim(), p2Legs: dr.p2.trim() } });
        }
      });
      return out;
    }

    /** 入力済みの試合をまとめて確定するバー（画面下に固定）。入力のたびに件数を更新する */
    function batchBar(st) {
      var d = state.detail;
      var label = el('span', { className: 'batch-bar__label' });
      var button = el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true });
      var bar = el('div', { className: 'batch-bar', role: 'region', 'aria-label': 'まとめて確定' }, [label, button]);
      var current = [];
      var update = function () {
        current = batchCandidates(st);
        bar.hidden = current.length < 2;
        label.textContent = '確定できる入力が ' + current.length + ' 試合あります';
        button.textContent = current.length + ' 試合をまとめて確定';
        button.disabled = state.busy;
      };
      button.addEventListener('click', function () {
        var list = current.slice();
        if (list.length < 2) return;
        mutate('saveMatchResults', { eventId: d.event.id, results: list.map(function (c) { return c.result; }) }, function (r) {
          return r.saved + ' 試合の結果を確定しました。';
        }).then(function (data) {
          if (!data) return;
          list.forEach(function (c) {
            delete state.drafts[c.m.id];
          });
          render();
        });
      });
      update();
      batchUi = update;
      return bar;
    }

    function numberInput(value, max, label, allowBlank, id) {
      return el('input', {
        id: id,
        className: 'legs-input',
        type: 'number',
        inputmode: 'numeric',
        min: 0,
        max: max,
        value: value === null || value === undefined ? (allowBlank ? '' : '0') : String(value),
        'aria-label': label,
      });
    }

    function specText(spec) {
      if (spec.format === 'fixed') return '固定 ' + spec.bestOf + ' Legs（引き分けあり）';
      return 'Best of ' + spec.bestOf + (spec.format === 'sets' ? ' セット（各セット Best of ' + spec.setBestOf + ' Legs）' : ' Legs');
    }

    /** 予定の 1 行（日付・時刻・会場・ボード・審判・延期） */
    function scheduleText(sch) {
      if (!sch) return '';
      var parts = [];
      if (sch.date) parts.push(sch.date.replace(/-/g, '/') + (sch.time ? ' ' + sch.time : '（時刻未定）'));
      else if (sch.status !== 'postponed') parts.push('日付未定');
      if (sch.venue) parts.push(sch.venue);
      if (sch.board) parts.push('ボード ' + sch.board);
      if (sch.referee) parts.push('審判 ' + sch.referee);
      if (sch.status) parts.push(SCHEDULE_STATUS_LABEL[sch.status] + (sch.original && (sch.original.date || sch.original.time) ? '（当初 ' + (sch.original.date || '未定').replace(/-/g, '/') + (sch.original.time ? ' ' + sch.original.time : '') + '）' : ''));
      return parts.join('・');
    }

    /** 試合の予定の編集（F07）と延期・振替（F08）。開いた欄は描き直しても開いたまま */
    function scheduleEditor(m) {
      var sch = m.schedule || {};
      var open = state.scheduleOpen[m.id];
      var idp = 'sch-' + m.id + '-';
      var summary = el('p', { className: 'match-editor__schedule muted small' }, [
        el('span', { text: scheduleText(m.schedule) || '予定は未設定' }),
        ' ',
        el('button', { className: 'btn btn--ghost btn--small', type: 'button', text: open ? '閉じる' : '予定・延期', 'aria-expanded': String(!!open), onClick: function () { state.scheduleOpen[m.id] = !open; render(); } }),
      ]);
      if (!open) return summary;
      var date = el('input', { className: 'input input--auto', id: idp + 'date', type: 'date', value: sch.date || '' });
      var time = el('input', { className: 'input input--auto', id: idp + 'time', type: 'time', value: sch.time || '' });
      var venue = el('input', { className: 'input', id: idp + 'venue', maxlength: 40, value: sch.venue || '' });
      var board = el('input', { className: 'input input--short', id: idp + 'board', maxlength: 20, value: sch.board || '' });
      var referee = el('input', { className: 'input', id: idp + 'referee', maxlength: 40, value: sch.referee || '' });
      var pDate = el('input', { className: 'input input--auto', id: idp + 'pdate', type: 'date' });
      var pTime = el('input', { className: 'input input--auto', id: idp + 'ptime', type: 'time' });
      var reason = el('input', { className: 'input', id: idp + 'reason', maxlength: 200, placeholder: '例: 会場の都合' });
      var box = el('div', { className: 'schedule-editor' }, [
        summary,
        el('div', { className: 'row row--tight' }, [
          el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '日付' }), date]),
          el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '時刻（空欄 = 未定）' }), time]),
          el('label', { className: 'field' }, [el('span', { className: 'field__label', text: 'ボード' }), board]),
        ]),
        el('div', { className: 'row row--tight' }, [
          el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '会場' }), venue]),
          el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '審判（表示名）' }), referee]),
        ]),
        el('div', { className: 'btn-row' }, [
          el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '予定を保存', onClick: function () { mutate('setSchedule', { matchId: m.id, rev: m.rev, date: date.value, time: time.value, venue: venue.value, board: board.value, referee: referee.value }, '予定を保存しました。'); } }),
        ]),
      ]);
      if (m.storedStatus !== 'final') {
        box.appendChild(el('div', { className: 'stack stack--tight postpone' }, [
          el('span', { className: 'field__label', text: '延期・振替（当初の予定・理由・操作者を記録します。勝敗には数えません）' }),
          el('div', { className: 'row row--tight' }, [
            el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '振替日（空欄 = 日程未定）' }), pDate]),
            el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '時刻' }), pTime]),
          ]),
          el('label', { className: 'field' }, [el('span', { className: 'field__label', text: '理由（運営画面だけに表示）' }), reason]),
          el('div', { className: 'btn-row' }, [
            el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '延期・振替を記録', onClick: function () { mutate('postponeMatch', { matchId: m.id, rev: m.rev, date: pDate.value, time: pTime.value, reason: reason.value }, '延期・振替を記録しました。'); } }),
          ]),
        ]));
      }
      if (sch.reason) box.appendChild(el('p', { className: 'muted small', text: '延期の理由: ' + sch.reason + (sch.changedBy ? '（' + sch.changedBy + '・' + formatDateTime(sch.changedAt) + '）' : '') }));
      return box;
    }

    /** 不戦勝・途中棄権・失格（F15）。記録上の勝者と、実際の Leg 数（途中棄権・失格のときだけ・任意）を分けて記録する */
    function specialResultEditor(m, sets) {
      var open = state.specialOpen[m.id];
      var toggle = el('button', { className: 'btn btn--ghost btn--small', type: 'button', text: open ? '特殊な結果を閉じる' : '不戦勝・棄権・失格', 'aria-expanded': String(!!open), onClick: function () { state.specialOpen[m.id] = !open; render(); } });
      if (!open) return el('div', { className: 'btn-row' }, [toggle]);
      var idp = 'sp-' + m.id + '-';
      var type = el('select', { className: 'input input--auto', id: idp + 'type' }, [
        el('option', { value: 'walkover', text: '不戦勝（相手の当日棄権・不在。Leg 数は記録しません）' }),
        el('option', { value: 'retired', text: '途中棄権（その時点の Leg 数を残せます）' }),
        el('option', { value: 'disqualified', text: '失格' }),
      ]);
      var winner = el('select', { className: 'input input--auto', id: idp + 'winner' }, [
        el('option', { value: '1', text: '勝者（記録上）: ' + m.p1.name }),
        el('option', { value: '2', text: '勝者（記録上）: ' + m.p2.name }),
      ]);
      var l1 = numberInput('', 99, m.p1.name + ' のその時点の Leg（任意）', true, idp + 'l1');
      var l2 = numberInput('', 99, m.p2.name + ' のその時点の Leg（任意）', true, idp + 'l2');
      l1.className = l2.className = 'legs-input legs-input--small';
      var legsRow = el('div', { className: 'match-editor__legs' }, [el('span', { className: 'muted small', text: 'その時点の Leg（任意）' }), l1, el('span', { className: 'muted small', text: '-' }), l2]);
      var note = el('input', { className: 'input', id: idp + 'note', maxlength: 200, placeholder: '理由（必須。運営画面だけに表示）' });
      var syncType = function () {
        legsRow.hidden = type.value === 'walkover';
      };
      type.addEventListener('change', syncType);
      syncType();
      return el('div', { className: 'special-result' }, [
        el('div', { className: 'btn-row' }, [toggle]),
        el('div', { className: 'row row--tight' }, [type, winner]),
        legsRow,
        note,
        el('p', { className: 'muted small', text: '確定した試合（他の試合）は消しません。選手が大会全体を棄権・失格する場合は「選手」タブから記録すると、残りの試合をまとめて処理できます。' + (sets ? ' セット制の途中棄権では Leg の合計だけを残します。' : '') }),
        el('div', { className: 'btn-row' }, [
          el('button', {
            className: 'btn btn--primary',
            type: 'button',
            'data-mut': true,
            text: '特殊な結果で確定',
            onClick: function () {
              mutate('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: m.storedStatus === 'final', resultType: type.value, winnerSide: Number(winner.value), note: note.value, p1Legs: l1.value.trim(), p2Legs: l2.value.trim() }, '記録しました。').then(function (data) {
                if (data) {
                  delete state.specialOpen[m.id];
                  delete state.editing[m.id];
                  delete state.drafts[m.id];
                  render();
                }
              });
            },
          }),
        ]),
      ]);
    }

    function renderMatchEditor(m) {
      var editing = !!state.editing[m.id];
      var locked = m.storedStatus === 'final' && !editing;
      var spec = m.spec || { format: 'legs', bestOf: m.bestOf };
      var sets = spec.format === 'sets';
      var fixed = spec.format === 'fixed';
      var meta = el('div', { className: 'match-editor__meta' }, [
        el('span', { text: (m.label || 'R' + m.round) + '・' + specText(spec) }),
        el('span', { className: 'status status--' + m.status, text: MATCH_STATUS_LABEL[m.status] || m.status }),
      ]);
      if (m.status === 'bye') {
        return el('article', { className: 'match-editor match-editor--bye', 'data-match-id': m.id }, [meta, el('p', { className: 'muted', text: m.p1.name + ' は不戦（Bye）です。勝ち点は段階の設定（不戦の点）で数えます。' })]);
      }
      if (m.status === 'void') {
        return el('article', { className: 'match-editor match-editor--pending', 'data-match-id': m.id }, [meta, el('p', { className: 'muted', text: 'この試合は行いません（グランドファイナルで勝者側の選手が勝ったため）。' })]);
      }
      if (m.status === 'pending') {
        return el('article', { className: 'match-editor match-editor--pending', 'data-match-id': m.id }, [
          meta,
          el('p', { className: 'muted', text: (m.p1.name || '（前の試合の勝者）') + ' vs ' + (m.p2.name || '（前の試合の勝者）') + '　対戦相手が決まると入力できます。' }),
          scheduleEditor(m),
        ]);
      }
      var need = fixed ? spec.bestOf : legsToWin(spec.bestOf);
      var draft = state.drafts[m.id];
      if (draft && (draft.rev !== m.rev || locked)) {
        // 別の画面で更新された・確定済みになった試合の下書きは捨てる
        delete state.drafts[m.id];
        draft = null;
      }
      var pick = function (key, stored) {
        return draft ? draft[key] : stored;
      };
      var idp = 'me-' + m.id + '-';
      var special = !!m.resultType;
      var p1 = numberInput(pick('p1', sets ? m.storedP1Sets : m.storedP1Legs), need, m.p1.name + (sets ? ' の取得セット' : ' の取得 Leg'), special, idp + 'p1');
      var p2 = numberInput(pick('p2', sets ? m.storedP2Sets : m.storedP2Legs), need, m.p2.name + (sets ? ' の取得セット' : ' の取得 Leg'), special, idp + 'p2');
      var l1 = sets ? numberInput(pick('l1', m.storedP1Legs), 99, m.p1.name + ' の取得 Leg（合計・任意）', true, idp + 'l1') : null;
      var l2 = sets ? numberInput(pick('l2', m.storedP2Legs), 99, m.p2.name + ' の取得 Leg（合計・任意）', true, idp + 'l2') : null;
      [p1, p2, l1, l2].forEach(function (x) {
        if (x) x.disabled = locked;
      });
      if (l1) l1.className = l2.className = 'legs-input legs-input--small';
      var draftMark = el('span', { className: 'match-editor__draft', text: '未保存の入力', hidden: !draft });
      var onInput = function () {
        state.drafts[m.id] = { rev: m.rev, p1: p1.value, p2: p2.value, l1: l1 ? l1.value : '', l2: l2 ? l2.value : '' };
        draftMark.hidden = false;
        if (batchUi) batchUi();
      };
      [p1, p2, l1, l2].forEach(function (x) {
        if (x) x.addEventListener('input', onInput);
      });
      var msg = el('p', { className: 'match-editor__msg', role: 'status' });

      function send(status) {
        if (!sets) {
          var problem = fixed ? checkFixed(status, p1.value.trim(), p2.value.trim(), spec.bestOf) : checkResult(status, p1.value.trim(), p2.value.trim(), spec.bestOf);
          if (problem) {
            msg.textContent = problem;
            return;
          }
        }
        var payload = { matchId: m.id, rev: m.rev, status: status, correction: m.storedStatus === 'final' };
        if (sets) {
          payload.p1Sets = p1.value.trim();
          payload.p2Sets = p2.value.trim();
          payload.p1Legs = l1.value.trim();
          payload.p2Legs = l2.value.trim();
        } else {
          payload.p1Legs = p1.value.trim();
          payload.p2Legs = p2.value.trim();
        }
        mutate('saveMatchResult', payload, status === 'final' ? '結果を確定しました。' : '保存しました。').then(function (data) {
          if (data) {
            delete state.editing[m.id];
            delete state.drafts[m.id];
            render();
          }
        });
      }

      var buttons;
      if (locked) {
        buttons = [el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '訂正', onClick: function () { state.editing[m.id] = true; render(); } })];
      } else {
        buttons = [
          el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '進行中として保存', onClick: function () { send('live'); } }),
          el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: editing ? '訂正して確定' : '確定', onClick: function () { send('final'); } }),
          el('button', {
            className: 'btn btn--ghost',
            type: 'button',
            'data-mut': true,
            text: '未開始に戻す',
            onClick: function () {
              p1.value = '0';
              p2.value = '0';
              if (l1) l1.value = l2.value = '';
              send('scheduled');
            },
          }),
        ];
        if (editing) buttons.push(el('button', { className: 'btn btn--ghost', type: 'button', text: 'キャンセル', onClick: function () { delete state.editing[m.id]; delete state.drafts[m.id]; render(); } }));
      }
      var winner = '';
      if (m.status === 'final') winner = m.draw ? '引き分け' : '勝者: ' + (m.winnerId === m.p1.id ? m.p1.name : m.p2.name);
      meta.insertBefore(draftMark, meta.lastChild);
      return el('article', { className: 'match-editor match-editor--' + m.status, 'data-match-id': m.id }, [
        meta,
        el('div', { className: 'match-editor__row' }, [
          el('label', { className: 'match-editor__player' }, [el('span', { text: m.p1.name }), p1]),
          el('span', { className: 'match-editor__vs', text: 'vs' }),
          el('label', { className: 'match-editor__player match-editor__player--2' }, [p2, el('span', { text: m.p2.name })]),
        ]),
        sets
          ? el('div', { className: 'match-editor__legs' }, [el('span', { className: 'muted small', text: '取得 Leg（合計・任意）' }), l1, el('span', { className: 'muted small', text: '-' }), l2])
          : null,
        fixed ? el('p', { className: 'muted small', text: '合計 ' + spec.bestOf + ' Legs を投げて確定します（同数は引き分け）。' }) : null,
        winner ? el('p', { className: 'match-editor__winner', text: winner + (m.resultType ? '（' + RESULT_TYPE_LABEL[m.resultType] + (m.resultNote ? '・' + m.resultNote : '') + '）' : '') + (m.confirmedAt ? '（確定 ' + formatDateTime(m.confirmedAt) + '）' : '') }) : null,
        m.problems && m.problems.length ? el('p', { className: 'error small', text: '要確認: ' + m.problems.join(' / ') }) : null,
        msg,
        el('div', { className: 'btn-row' }, buttons),
        !locked ? specialResultEditor(m, sets) : null,
        scheduleEditor(m),
      ]);
    }

    /* ---------- 次戦・未消化・予定（F06・F07・F13） ---------- */

    /** 試合の状態の区分: tbd（相手未確定）/ scheduled / live / postponed（延期・振替）/ final / void */
    function matchPhase(m) {
      if (m.status === 'pending') return 'tbd';
      if (m.status === 'void') return 'void';
      if (m.status === 'final' || m.status === 'bye') return 'final';
      if (m.schedule && m.schedule.status) return 'postponed';
      return m.status === 'live' ? 'live' : m.status === 'check' ? 'live' : 'scheduled';
    }

    var PHASE_LABEL = { tbd: '相手未確定', scheduled: '未開始', live: '進行中', postponed: '延期・振替', final: '確定', void: '実施なし' };

    function allEventMatches(d) {
      var list = [];
      d.stages.forEach(function (st, si) {
        stageSections(st).forEach(function (sec) {
          sec.matches.forEach(function (m) {
            list.push({ m: m, st: st, sec: sec, si: si });
          });
        });
      });
      return list;
    }

    function renderSchedule() {
      var d = state.detail;
      var ui = state.ui.sched || (state.ui.sched = { player: '', stage: 'all', section: 'all', date: '', board: '', phase: 'open' });
      var wrap = el('div', { className: 'stack' });
      var all = allEventMatches(d);
      var playerSel = el('select', { className: 'input input--auto', id: 'sched-player', 'aria-label': '選手で絞り込む' }, [el('option', { value: '', text: 'すべての選手' })].concat(
        d.players.map(function (p) {
          return el('option', { value: p.id, text: p.name, selected: ui.player === p.id ? true : null });
        })
      ));
      var stageSel = el('select', { className: 'input input--auto', id: 'sched-stage', 'aria-label': '段階で絞り込む' }, [el('option', { value: 'all', text: 'すべての段階' })].concat(
        d.stages.map(function (st) {
          return el('option', { value: st.id, text: st.name, selected: ui.stage === st.id ? true : null });
        })
      ));
      var curStage = d.stages.filter(function (st) {
        return st.id === ui.stage;
      })[0];
      var sectionSel = el('select', { className: 'input input--auto', id: 'sched-section', 'aria-label': '組・節・回戦で絞り込む', disabled: !curStage }, [el('option', { value: 'all', text: '組・節・回戦: すべて' })].concat(
        curStage
          ? stageSections(curStage).map(function (sec) {
              return el('option', { value: sec.id, text: sec.name, selected: ui.section === sec.id ? true : null });
            })
          : []
      ));
      var dateInput = el('input', { className: 'input input--auto', id: 'sched-date', type: 'date', value: ui.date, 'aria-label': '日付で絞り込む' });
      var boardInput = el('input', { className: 'input input--short', id: 'sched-board', value: ui.board, placeholder: 'ボード', 'aria-label': 'ボードで絞り込む' });
      var apply = function () {
        ui.player = playerSel.value;
        if (ui.stage !== stageSel.value) ui.section = 'all';
        ui.stage = stageSel.value;
        ui.section = ui.stage === 'all' ? 'all' : sectionSel.value;
        ui.date = dateInput.value;
        ui.board = boardInput.value.trim();
        render();
      };
      [playerSel, stageSel, sectionSel, dateInput].forEach(function (x) {
        x.addEventListener('change', apply);
      });
      boardInput.addEventListener('change', apply);
      var phases = [
        { id: 'open', name: '未消化（確定以外）' },
        { id: 'tbd', name: '相手未確定' },
        { id: 'scheduled', name: '未開始' },
        { id: 'live', name: '進行中' },
        { id: 'postponed', name: '延期・振替' },
        { id: 'final', name: '確定' },
        { id: 'all', name: 'すべて' },
      ];
      var chips = el('div', { className: 'chips', role: 'group', 'aria-label': '試合の状態' });
      phases.forEach(function (f) {
        chips.appendChild(el('button', { type: 'button', className: 'chip', 'aria-pressed': String(ui.phase === f.id), text: f.name, onClick: function () { ui.phase = f.id; render(); } }));
      });
      wrap.appendChild(el('section', { className: 'panel panel--tight' }, [el('div', { className: 'row row--tight' }, [playerSel, stageSel, sectionSel, dateInput, boardInput]), chips]));

      // 選んだ選手の次の試合（一意でないときは候補を全部出す）
      if (ui.player) {
        var mine = all.filter(function (x) {
          return x.m.p1.id === ui.player || x.m.p2.id === ui.player;
        });
        var ready = mine.filter(function (x) {
          var ph = matchPhase(x.m);
          return ph === 'scheduled' || ph === 'live' || ph === 'postponed';
        });
        var waiting = mine.filter(function (x) {
          return matchPhase(x.m) === 'tbd';
        });
        var pname = (d.players.filter(function (p) { return p.id === ui.player; })[0] || {}).name || '';
        var nextBox = el('section', { className: 'panel' }, [el('h3', { text: pname + ' の次の試合' })]);
        if (!ready.length && !waiting.length) nextBox.appendChild(el('p', { className: 'muted', text: '予定されている試合はありません（全試合が終わったか、次の段階の組み合わせがまだです）。' }));
        if (ready.length > 1) nextBox.appendChild(el('p', { className: 'muted small', text: '次の試合が 1 つに決まっていないため、候補をすべて表示します（' + ready.length + ' 試合）。' }));
        ready.concat(waiting).forEach(function (x) {
          var opp = x.m.p1.id === ui.player ? x.m.p2 : x.m.p1;
          nextBox.appendChild(el('p', null, [
            el('span', { className: 'status status--' + (matchPhase(x.m) === 'tbd' ? 'pending' : x.m.status), text: PHASE_LABEL[matchPhase(x.m)] }),
            ' ' + x.st.name + '・' + x.sec.name + '・' + (x.m.label || 'R' + x.m.round) + '　vs ' + (opp.id ? opp.name : '（相手は前の試合の結果で決まります）') + (x.m.schedule ? '　' + scheduleText(x.m.schedule) : ''),
          ]));
        });
        wrap.appendChild(nextBox);
      }

      var rows = all.filter(function (x) {
        var ph = matchPhase(x.m);
        if (ph === 'void') return ui.phase === 'all';
        if (ui.phase === 'open' && ph === 'final') return false;
        if (ui.phase !== 'open' && ui.phase !== 'all' && ph !== ui.phase) return false;
        if (ui.player && x.m.p1.id !== ui.player && x.m.p2.id !== ui.player) return false;
        if (ui.stage !== 'all' && x.st.id !== ui.stage) return false;
        if (ui.section !== 'all' && x.sec.id !== ui.section) return false;
        if (ui.date && !(x.m.schedule && x.m.schedule.date === ui.date)) return false;
        if (ui.board && !(x.m.schedule && x.m.schedule.board === ui.board)) return false;
        return true;
      });
      rows.sort(function (a, b) {
        var da = (a.m.schedule && a.m.schedule.date ? a.m.schedule.date + ' ' + (a.m.schedule.time || '99:99') : '9999');
        var db = (b.m.schedule && b.m.schedule.date ? b.m.schedule.date + ' ' + (b.m.schedule.time || '99:99') : '9999');
        return da < db ? -1 : da > db ? 1 : a.si - b.si || (a.m.round || 0) - (b.m.round || 0) || (a.m.order || 0) - (b.m.order || 0);
      });
      var table = el('table', { className: 'table schedule-table' }, [
        el('thead', null, [el('tr', null, ['予定', '段階・組', '試合', '対戦', 'ボード', '状態'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
        el('tbody', null, rows.map(function (x) {
          var sch = x.m.schedule;
          return el('tr', null, [
            el('td', { text: sch && sch.date ? sch.date.replace(/-/g, '/') + (sch.time ? ' ' + sch.time : '（時刻未定）') : sch && sch.status === 'postponed' ? '日程未定' : '—' }),
            el('td', { text: x.st.name + '・' + x.sec.name }),
            el('td', { text: x.m.label || 'R' + x.m.round }),
            el('td', { text: (x.m.p1.id ? x.m.p1.name : '未定') + ' vs ' + (x.m.p2.id ? x.m.p2.name : x.m.status === 'bye' ? '（不戦）' : '未定') }),
            el('td', { text: sch && sch.board ? sch.board : '' }),
            el('td', { text: PHASE_LABEL[matchPhase(x.m)] + (sch && sch.status ? '（' + SCHEDULE_STATUS_LABEL[sch.status] + '）' : '') }),
          ]);
        })),
      ]);
      wrap.appendChild(el('section', { className: 'panel' }, [el('h3', { text: '試合の一覧（' + rows.length + ' 試合）' }), rows.length ? el('div', { className: 'table-wrap' }, [table]) : el('p', { className: 'muted', text: '該当する試合はありません。' }), el('p', { className: 'muted small', text: '日時・会場・ボード・審判・延期は「試合結果」タブの各試合の「予定・延期」から入力します。時刻は大会のタイムゾーン（' + (d.event.timezone || 'Asia/Tokyo') + '）で表示します。' })]));
      wrap.appendChild(weeklySchedulePanel(d));
      return wrap;
    }

    /** 毎週の日程（F13）: 節ごとの日付をプレビューしてから、未実施の試合にだけ適用する */
    function weeklySchedulePanel(d) {
      var targets = d.stages.filter(function (st) {
        return st.type === 'league' || st.type === 'round_robin' || st.type === 'series';
      });
      var panel = el('section', { className: 'panel' }, [el('h3', { text: '毎週の日程を作る' })]);
      if (!targets.length) {
        panel.appendChild(el('p', { className: 'muted', text: 'リーグ・ロビン・ポイントシリーズの段階で使えます。' }));
        return panel;
      }
      var ui = state.ui.weekly || (state.ui.weekly = { stageId: targets[0].id, start: '', weekdays: [], interval: 1, skips: '', time: '', venue: '', plan: null });
      var stage = el('select', { className: 'input input--auto', id: 'weekly-stage', 'aria-label': '段階' }, targets.map(function (st) {
        return el('option', { value: st.id, text: st.name, selected: st.id === ui.stageId ? true : null });
      }));
      var start = el('input', { className: 'input input--auto', id: 'weekly-start', type: 'date', value: ui.start });
      var boxes = WEEKDAY_LABEL.map(function (w, i) {
        return el('label', { className: 'check check--inline' }, [el('input', { type: 'checkbox', value: String(i), checked: ui.weekdays.indexOf(i) !== -1 }), w]);
      });
      var interval = el('select', { className: 'input input--short', id: 'weekly-interval' }, [1, 2, 3, 4].map(function (n) {
        return el('option', { value: String(n), text: n === 1 ? '毎週' : n + ' 週ごと', selected: ui.interval === n ? true : null });
      }));
      var skips = el('textarea', { className: 'input', id: 'weekly-skips', rows: 3, placeholder: '休催日（1 行に 1 日。例: 2026-11-23）', value: ui.skips });
      var time = el('input', { className: 'input input--auto', id: 'weekly-time', type: 'time', value: ui.time });
      var venue = el('input', { className: 'input', id: 'weekly-venue', maxlength: 40, value: ui.venue, placeholder: '会場（任意）' });
      var out = el('div', { className: 'stack stack--tight', 'aria-live': 'polite' });
      var payload = function () {
        ui.stageId = stage.value;
        ui.start = start.value;
        ui.weekdays = boxes
          .map(function (b) {
            return b.firstChild;
          })
          .filter(function (c) {
            return c.checked;
          })
          .map(function (c) {
            return Number(c.value);
          });
        ui.interval = Number(interval.value);
        ui.skips = skips.value;
        ui.time = time.value;
        ui.venue = venue.value;
        return {
          eventId: d.event.id,
          stageId: ui.stageId,
          startDate: ui.start,
          weekdays: ui.weekdays,
          intervalWeeks: ui.interval,
          skipDates: ui.skips.split(/[\r\n,、]+/).map(function (x) { return x.trim(); }).filter(Boolean),
          time: ui.time,
          venue: ui.venue,
        };
      };
      if (ui.plan) {
        out.appendChild(el('p', { className: 'muted small', text: '次の日付を割り当てます（祝日は自動で判定しません。休みにする日は休催日に入れてください）。' + (ui.plan.untouched ? '結果の入っている ' + ui.plan.untouched + ' 試合は変更しません。' : '') }));
        out.appendChild(el('ol', { className: 'plain-list' }, ui.plan.plan.map(function (x) {
          return el('li', { text: x.label + ': ' + x.date.replace(/-/g, '/') + ' (' + WEEKDAY_LABEL[new Date(x.date + 'T00:00:00Z').getUTCDay()] + ')' + (x.time ? ' ' + x.time : '') });
        })));
        if (ui.plan.skipped.length) out.appendChild(el('p', { className: 'muted small', text: '休催日として飛ばした日: ' + ui.plan.skipped.join('、') }));
        out.appendChild(el('div', { className: 'btn-row' }, [
          el('button', {
            className: 'btn btn--primary',
            type: 'button',
            'data-mut': true,
            text: 'この日程を適用',
            onClick: function () {
              mutate('applyWeeklySchedule', payload(), function (r) {
                return r.changed + ' 試合に日程を入れました' + (r.untouched ? '（結果の入っている ' + r.untouched + ' 試合は変更していません）' : '') + '。';
              }).then(function (data) {
                if (data) {
                  ui.plan = null;
                  render();
                }
              });
            },
          }),
          el('button', { className: 'btn btn--ghost', type: 'button', text: 'やめる', onClick: function () { ui.plan = null; render(); } }),
        ]));
      }
      panel.appendChild(el('div', { className: 'stack stack--tight' }, [
        el('div', { className: 'row row--tight' }, [field('段階', stage), field('開始日', start), field('間隔', interval), field('開始時刻（任意）', time)]),
        el('div', { className: 'field' }, [el('span', { className: 'field__label', text: '開催する曜日' }), el('div', { className: 'row row--tight' }, boxes)]),
        field('休催日（祝日などは手で入力）', skips),
        field('会場（任意）', venue),
        el('div', { className: 'btn-row' }, [
          el('button', {
            className: 'btn',
            type: 'button',
            text: '日程をプレビュー',
            onClick: function () {
              api
                .query('previewWeeklySchedule', payload())
                .then(function (res) {
                  ui.plan = res;
                  render();
                })
                .catch(handleError);
            },
          }),
        ]),
        out,
      ]));
      return panel;
    }

    /** 閲覧ページの QR コード（参加者に配る・掲示する用）。閲覧ページ側にも同じ QR が表示される */
    function renderShareQr(href, event) {
      var matrix = qrMatrix(href);
      if (!matrix) return el('p', { className: 'muted small', text: 'QR コードを表示できませんでした（qrcode.js が読み込まれていません）。' });
      var url = el('code', { className: 'qr-share__url', text: href });
      return el('div', { className: 'qr-share' }, [
        el('div', { className: 'qr-share__code' }, [qrSvg(matrix, event.name + ' の閲覧ページの QR コード')]),
        el('div', { className: 'stack stack--tight' }, [
          el('strong', { text: '閲覧ページの QR コード' }),
          el('p', { className: 'muted small', text: '参加者がスマホのカメラで読み取ると、この大会の閲覧ページが開きます。閲覧ページを大きな画面で開くと、右下にも同じ QR コードが表示されます。' }),
          url,
          el('div', { className: 'btn-row' }, [
            el('button', {
              className: 'btn',
              type: 'button',
              text: '画像（PNG）で保存',
              onClick: function () {
                qrPngBlob(matrix, function (blob) {
                  if (!blob) {
                    toast('error', '画像を作れませんでした。');
                    return;
                  }
                  var a = el('a', { href: URL.createObjectURL(blob), download: 'qr-' + event.id + '.png' });
                  doc.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(function () {
                    URL.revokeObjectURL(a.href);
                  }, 10000);
                });
              },
            }),
            el('button', {
              className: 'btn',
              type: 'button',
              text: 'URL をコピー',
              onClick: function () {
                var nav = win.navigator;
                if (nav.clipboard && nav.clipboard.writeText) {
                  nav.clipboard.writeText(href).then(function () {
                    toast('ok', 'コピーしました。');
                  }, function () {
                    toast('error', 'コピーできませんでした。URL を長押しして選択してください。');
                  });
                } else {
                  toast('error', 'コピーできませんでした。URL を長押しして選択してください。');
                }
              },
            }),
          ]),
        ]),
      ]);
    }

    /** 削除など取り消しにくい操作は、2 回押しで実行する */
    function confirmButton(label, confirmLabel, onConfirm) {
      var armed = false;
      var timer = null;
      var b = el('button', { className: 'btn btn--danger', type: 'button', 'data-mut': true, text: label });
      b.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          b.textContent = confirmLabel;
          timer = setTimeout(function () {
            armed = false;
            b.textContent = label;
          }, 4000);
          return;
        }
        clearTimeout(timer);
        onConfirm();
      });
      return b;
    }

    function renderPlayers() {
      var d = state.detail;
      var wrap = el('div', { className: 'stack' });
      var area = el('textarea', { className: 'input', id: 'bulk-names', rows: 5, placeholder: '1 行に 1 名ずつ入力' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: '選手を追加' }),
          el('form', {
            className: 'form',
            onSubmit: function (e) {
              e.preventDefault();
              var names = area.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
              if (!names.length) {
                toast('error', '選手名を入力してください。');
                return;
              }
              mutate('addPlayers', { eventId: d.event.id, names: names }, function (r) { return (r && r.added) + ' 名を追加しました。'; });
            },
          }, [el('label', { className: 'visually-hidden', for: 'bulk-names', text: '選手名' }), area, el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '追加' })]),
        ])
      );
      wrap.appendChild(csvImportPanel(d));
      var groupName = {};
      d.groups.forEach(function (g) {
        groupName[g.id] = g.name;
      });
      var list = el('section', { className: 'panel' }, [
        el('h3', { text: '登録選手（' + d.players.length + ' 名）' }),
        el('p', { className: 'muted small', text: '所属・Rt・シードは任意です。所属が空欄の選手は「所属なし」として扱います（1 つの所属にはまとめません）。Rt は組分けの目安で、ソフトダーツの Rt はスティールダーツの実力を保証するものではありません。所属・Rt を閲覧ページに出すかは「大会設定」で選べます（既定は出さない）。メモは運営画面だけに表示します。' }),
      ]);
      d.players.forEach(function (p) {
        var idp = 'pl-' + p.id + '-';
        var input = el('input', { className: 'input', id: idp + 'name', value: p.name, maxlength: 40, 'aria-label': '選手名' });
        var aff = el('input', { className: 'input', id: idp + 'aff', value: p.affiliation || '', maxlength: 40, placeholder: '所属', 'aria-label': p.name + ' の所属' });
        var rt = el('input', { className: 'input input--short', id: idp + 'rt', value: p.rating || '', maxlength: 6, placeholder: 'Rt', inputmode: 'decimal', 'aria-label': p.name + ' の Rt' });
        var seed = el('input', { className: 'input input--short', id: idp + 'seed', value: p.seed ? String(p.seed) : '', maxlength: 3, placeholder: 'シード', inputmode: 'numeric', 'aria-label': p.name + ' のシード' });
        var notes = el('input', { className: 'input', id: idp + 'notes', value: p.notes || '', maxlength: 200, placeholder: 'メモ（非公開）', 'aria-label': p.name + ' のメモ（非公開）' });
        var w = p.withdrawn;
        list.appendChild(
          el('div', { className: 'player-row player-row--v8', 'data-player-id': p.id }, [
            el('div', { className: 'player-row__fields' }, [input, aff, rt, seed, notes]),
            el('span', { className: 'muted small', text: (groupName[p.groupId] || '未割当') + (p.matchCount ? '・' + p.matchCount + ' 試合' : '') + (w ? '・' + (w.kind === 'disqualified' ? '失格' : '棄権') + '（' + w.reason + '）' : '') }),
            el('div', { className: 'btn-row' }, [
              el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '保存', onClick: function () { mutate('updatePlayer', { playerId: p.id, rev: p.rev, name: input.value, affiliation: aff.value, rating: rt.value, seed: seed.value, notes: notes.value }, '保存しました。'); } }),
              w
                ? el('button', { className: 'btn btn--ghost', type: 'button', 'data-mut': true, text: '棄権・失格の記録を外す', onClick: function () { mutate('reinstatePlayer', { playerId: p.id, rev: p.rev }, '記録を外しました（処理済みの試合の結果は変わりません）。'); } })
                : el('button', { className: 'btn btn--ghost', type: 'button', text: '棄権・失格', onClick: function () { state.ui.withdraw = { playerId: p.id, preview: null }; render(); loadWithdrawPreview(p.id); } }),
              confirmButton('削除', '本当に削除', function () { mutate('deletePlayer', { playerId: p.id, rev: p.rev }, '削除しました。'); }),
            ]),
            state.ui.withdraw && state.ui.withdraw.playerId === p.id ? withdrawPanel(p) : null,
          ])
        );
      });
      wrap.appendChild(list);
      return wrap;
    }

    function loadWithdrawPreview(playerId) {
      api
        .query('previewWithdraw', { eventId: state.detail.event.id, playerId: playerId })
        .then(function (res) {
          if (state.ui.withdraw && state.ui.withdraw.playerId === playerId) {
            state.ui.withdraw.preview = res;
            render();
          }
        })
        .catch(handleError);
    }

    /** 棄権・失格（F15）: 残りの試合の扱いを確認してから記録する */
    function withdrawPanel(p) {
      var pv = state.ui.withdraw.preview;
      var kind = el('select', { className: 'input input--auto', id: 'wd-kind' }, [el('option', { value: 'withdrawn', text: '棄権' }), el('option', { value: 'disqualified', text: '失格' })]);
      var reason = el('input', { className: 'input', id: 'wd-reason', maxlength: 200, placeholder: '理由（必須。運営画面だけに表示）' });
      var actionText = { walkover: '未開始 → 相手の不戦勝（Leg 数は記録しない）', retired: '進行中 → 途中棄権（その時点の Leg 数のまま相手の勝ち）', pending: '相手未確定 → 相手が決まった時点で不戦勝' };
      return el('div', { className: 'withdraw-panel notice' }, [
        el('h4', { text: p.name + ' の棄権・失格' }),
        !pv
          ? el('p', { className: 'muted small', text: '残りの試合を確認しています…' })
          : el('div', { className: 'stack stack--tight' }, [
              el('p', { className: 'small', text: '確定済みの ' + pv.finals + ' 試合はそのまま残します。残りの試合（' + pv.affected.length + ' 試合）は次のように処理します。以後のスイス式の組み合わせ・シリーズの節には入れません。' }),
              pv.affected.length
                ? el('ul', { className: 'plain-list' }, pv.affected.map(function (a) {
                    return el('li', { text: a.stage + '・' + a.label + (a.opponent ? '（相手: ' + a.opponent + '）' : '') + ': ' + actionText[a.action] });
                  }))
                : null,
            ]),
        el('div', { className: 'row row--tight' }, [kind, reason]),
        el('div', { className: 'btn-row' }, [
          el('button', {
            className: 'btn btn--danger',
            type: 'button',
            'data-mut': true,
            'data-locked': pv ? null : '1',
            text: 'この内容で記録する',
            onClick: function () {
              mutate('withdrawPlayer', { eventId: state.detail.event.id, playerId: p.id, rev: p.rev, kind: kind.value, reason: reason.value }, function (r) {
                return '記録しました（' + r.matches + ' 試合を処理）。';
              }).then(function (data) {
                if (data) {
                  state.ui.withdraw = null;
                  render();
                }
              });
            },
          }),
          el('button', { className: 'btn btn--ghost', type: 'button', text: 'やめる', onClick: function () { state.ui.withdraw = null; render(); } }),
        ]),
      ]);
    }

    /**
     * CSV からの選手登録（F11）: ファイルを読み、行ごとの確認（不正な行・同名の候補・上限）を表示してから登録する。
     * 不正な行があるときは登録しない（一部だけ黙って登録しない）。同名の選手は同一人物とみなさず、行を外すか名前を変えてもらう。
     */
    function csvImportPanel(d) {
      var ui = state.ui.csv || (state.ui.csv = { result: null, encoding: '', excluded: {} });
      var file = el('input', { type: 'file', id: 'csv-file', accept: '.csv,text/csv' });
      var panel = el('section', { className: 'panel' }, [
        el('h3', { text: 'CSV から登録' }),
        el('p', { className: 'muted small', text: '1 行目に見出し（名前・所属・Rt・シード）を付けた CSV を読み込めます。見出しがなければ 1 列目から順に名前・所属・Rt・シードとして読みます。Excel の「CSV UTF-8」と通常の CSV（Shift_JIS）のどちらでも読めます。「出力・印刷」タブの選手一覧の CSV をそのまま読み込めます。' }),
        field('CSV ファイル', file),
      ]);
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 500000) {
          toast('error', 'ファイルが大きすぎます（500KB まで）。');
          return;
        }
        var reader = new win.FileReader();
        reader.onload = function () {
          var dec = global.TPAdminIO.decodeCsvBytes(new Uint8Array(reader.result));
          var table = global.TPAdminIO.parseCsv(dec.text);
          ui.result = global.TPAdminIO.importRows(table, d.players.map(function (p) { return p.name; }), 40);
          ui.encoding = dec.encoding;
          ui.excluded = {};
          render();
        };
        reader.readAsArrayBuffer(f);
      });
      var r = ui.result;
      if (!r) return panel;
      if (r.problem) {
        panel.appendChild(el('p', { className: 'error', text: r.problem }));
        return panel;
      }
      var rows = r.rows;
      var included = rows.filter(function (x) {
        return !ui.excluded[x.line];
      });
      var bad = included.filter(function (x) {
        return x.problems.length;
      });
      var warn = included.filter(function (x) {
        return x.warnings.length;
      });
      var room = 128 - d.players.length;
      panel.appendChild(el('p', { className: 'small', text: rows.length + ' 行を読みました（文字コード: ' + ui.encoding + '）。登録する ' + included.length + ' 行のうち、直す必要がある行 ' + bad.length + '・確認が必要な行 ' + warn.length + '。' + (r.unknownHeaders.length ? '使わない列: ' + r.unknownHeaders.join('、') + '。' : '') }));
      if (included.length > room) panel.appendChild(el('p', { className: 'error small', text: '1 大会の選手は 128 名までです（あと ' + room + ' 名）。' }));
      var table = el('table', { className: 'table' }, [
        el('thead', null, [el('tr', null, ['登録', '行', '名前', '所属', 'Rt', 'シード', '確認'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
        el('tbody', null, rows.map(function (x) {
          var cb = el('input', { type: 'checkbox', checked: !ui.excluded[x.line], 'aria-label': x.line + ' 行目を登録する' });
          cb.addEventListener('change', function () {
            ui.excluded[x.line] = !cb.checked;
            render();
          });
          return el('tr', { className: x.problems.length ? 'row--error' : x.warnings.length ? 'row--warn' : '' }, [
            el('td', null, [cb]),
            el('td', { text: String(x.line) }),
            el('td', { text: x.name }),
            el('td', { text: x.affiliation }),
            el('td', { text: x.rating }),
            el('td', { text: x.seed }),
            el('td', { text: x.problems.concat(x.warnings).join(' / ') || 'OK' }),
          ]);
        })),
      ]);
      panel.appendChild(el('div', { className: 'table-wrap' }, [table]));
      panel.appendChild(el('p', { className: 'muted small', text: '同じ名前の選手が登録済みの行は、同一人物なら外し、別の人なら CSV の名前を区別して（例: 所属を付ける）読み込み直してください。' }));
      panel.appendChild(el('div', { className: 'btn-row' }, [
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          'data-mut': true,
          'data-locked': bad.length || warn.length || !included.length || included.length > room ? '1' : null,
          text: included.length + ' 名を登録',
          onClick: function () {
            mutate('importPlayers', { eventId: d.event.id, players: included.map(function (x) { return { name: x.name, affiliation: x.affiliation, rating: x.rating, seed: x.seed }; }) }, function (res) {
              return res.added + ' 名を登録しました。';
            }).then(function (data) {
              if (data) {
                state.ui.csv = null;
                render();
              }
            });
          },
        }),
        el('button', { className: 'btn btn--ghost', type: 'button', text: '取り消す', onClick: function () { state.ui.csv = null; render(); } }),
      ]));
      if (bad.length || warn.length) panel.appendChild(el('p', { className: 'muted small', text: '直す必要がある行・確認が必要な行のチェックを外すと登録できます（外した行は登録しません）。' }));
      return panel;
    }

    /* ---------- 形式（段階の設定） ---------- */

    function renderFormat() {
      var d = state.detail;
      var wrap = el('div', { className: 'stack' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: '大会の形式' }),
          el('p', { className: 'muted small', text: '大会は「段階」を上から順に進めます。ロビン・リーグ・スイス式・シリーズの順位で次の段階へ進出させるには、進出ルールを設定し、「組み合わせ」タブで進出を確定します（確定の前に、誰がどこへ入るかを確認できます）。' }),
          d.event.config && d.event.config.template ? el('p', { className: 'muted small', text: '作成時の形式: ' + ((formatById(d.event.config.template) || {}).label || d.event.config.template) }) : null,
        ])
      );
      d.stages.forEach(function (st, i) {
        wrap.appendChild(renderStageEditor(st, i));
      });
      var type = el('select', { className: 'input', id: 'add-stage-type' }, ['round_robin', 'league', 'single_elimination', 'double_elimination', 'swiss', 'series'].map(function (k) {
        return el('option', { value: k, text: STAGE_TYPE_LABEL[k] || k });
      }));
      var name = el('input', { className: 'input', id: 'add-stage-name', maxlength: 40, placeholder: '例: 決勝トーナメント' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: '段階を追加' }),
          el('div', { className: 'row' }, [
            el('label', { className: 'visually-hidden', for: 'add-stage-type', text: '段階の種類' }),
            type,
            el('label', { className: 'visually-hidden', for: 'add-stage-name', text: '段階の名前' }),
            name,
            el('button', {
              className: 'btn btn--primary',
              type: 'button',
              'data-mut': true,
              text: '追加',
              onClick: function () {
                mutate('addStage', { eventId: d.event.id, type: type.value, name: name.value || undefined }, '段階を追加しました。');
              },
            }),
          ]),
        ])
      );
      return wrap;
    }

    function renderStageEditor(st, index) {
      var d = state.detail;
      var type = st.type;
      var group = type === 'round_robin' || type === 'league' || type === 'swiss';
      var bracket = type === 'single_elimination' || type === 'double_elimination' || type === 'series';
      var cfg = st.config;
      var name = el('input', { className: 'input', value: st.name, maxlength: 40, 'aria-label': '段階の名前' });
      var rule = ruleInputs('stage-' + st.id, { format: st.rule.format, bestOf: st.rule.bestOf, setBestOf: st.rule.setBestOf || 5, provisional: st.ruleProvisional }, { noFixed: bracket });
      var parts = [
        el('div', { className: 'stage-head' }, [
          el('span', { className: 'badge badge--on', text: index + 1 + '. ' + (STAGE_TYPE_LABEL[type] || type) }),
          st.hasResults ? el('span', { className: 'badge', text: '結果あり' }) : null,
          cfg.advanced ? el('span', { className: 'badge', text: '進出確定済み' }) : null,
        ]),
        field('段階の名前', name),
        rule.node,
      ];
      var collectors = [];
      var add = function (node, collect) {
        parts.push(node);
        if (collect) collectors.push(collect);
      };
      var numIn = function (value, min, max, label) {
        return el('input', { className: 'input input--short', type: 'number', min: min, max: max, value: value === null || value === undefined ? '' : String(value), 'aria-label': label });
      };
      if (type === 'round_robin' || type === 'league') {
        var cycles = el('select', { className: 'input input--short', 'aria-label': '総当たりの回数' }, [1, 2].map(function (n) {
          return el('option', { value: String(n), text: n + ' 回', selected: cfg.cycles === n ? true : null });
        }));
        add(field('総当たりの回数（対戦カード作成後は変更不可）', cycles), function () {
          return { cycles: Number(cycles.value) };
        });
        if (st.feeds.length) {
          var dist = el('select', { className: 'input input--auto', 'aria-label': '進出者の配り方' }, [
            el('option', { value: 'snake', text: '順位の帯ごとに蛇行（同じ進出元の組を分ける）', selected: cfg.distribution !== 'rank' ? true : null }),
            el('option', { value: 'rank', text: '順位順に A, B, C … と配る', selected: cfg.distribution === 'rank' ? true : null }),
          ]);
          add(field('前の段階からの進出者の配り方（前の成績は持ち越しません）', dist), function () {
            return { distribution: dist.value };
          });
        }
      }
      if (group) {
        var tb = tiebreakEditor(cfg.tiebreakers, cfg.advanced, (d.tiebreakersFor || {})[type]);
        add(tb.node, function () {
          return cfg.advanced ? {} : { tiebreakers: tb.value() };
        });
        // 勝ち点（F14）。v0.7 までの段階は勝ち点なし（従来の順位）のまま。使うときだけ設定する
        var usePts = el('input', { type: 'checkbox', checked: !!cfg.points, disabled: type === 'swiss' || cfg.advanced });
        var pw = numIn(cfg.points ? cfg.points.win : 2, -99, 99, '勝ちの点');
        var pd = numIn(cfg.points ? cfg.points.draw : 1, -99, 99, '引き分けの点');
        var pl = numIn(cfg.points ? cfg.points.loss : 0, -99, 99, '負けの点');
        add(
          el('div', { className: 'field' }, [
            el('label', { className: 'check' }, [usePts, ' 勝ち点を使う（順位の決め方に「勝ち点」を入れて使います）']),
            el('div', { className: 'row row--tight' }, [el('span', { text: '勝ち' }), pw, el('span', { text: '引き分け' }), pd, el('span', { text: '負け' }), pl]),
          ]),
          function () {
            if (cfg.advanced) return {};
            return { points: usePts.checked ? { win: Number(pw.value), draw: Number(pd.value), loss: Number(pl.value) } : null };
          }
        );
        var wl = el('select', { className: 'input input--auto', 'aria-label': '不戦勝の Leg 数' }, [
          el('option', { value: 'exclude', text: '数えない（既定。実際に投げていないため）', selected: cfg.walkoverLegs !== 'award' ? true : null }),
          el('option', { value: 'award', text: '勝者に勝利に必要な Leg 数・敗者に 0 として数える', selected: cfg.walkoverLegs === 'award' ? true : null }),
        ]);
        add(field('不戦勝の試合の Leg 数の扱い（途中棄権・失格はその時点の実際の Leg 数を数えます）', wl), function () {
          return { walkoverLegs: wl.value };
        });
        if (cfg.points) parts.push(adjustmentEditor(st));
        var labels = el('textarea', {
          className: 'input',
          rows: 3,
          'aria-label': 'ラウンドの表示名',
          placeholder: type === 'league' ? '例: 1: 第1節 11/3' : '例: 1: 1 巡目',
          value: Object.keys(cfg.roundLabels)
            .map(function (k) {
              return k + ': ' + cfg.roundLabels[k];
            })
            .join('\n'),
        });
        add(field('ラウンドの表示名（1 行に「番号: 表示名」。空欄なら ' + (type === 'league' ? '「第n節」' : type === 'swiss' ? '「第n回戦」' : '「Rn」') + '）', labels), function () {
          return { roundLabels: parseLabels(labels.value) };
        });
      }
      if (type === 'swiss') {
        var rounds = numIn(cfg.rounds, 1, 15, '回戦数');
        var first = el('select', { className: 'input input--auto', 'aria-label': '1 回戦の組み方' }, [
          el('option', { value: 'seed', text: 'シード順（上半分と下半分）', selected: cfg.firstRound !== 'random' ? true : null }),
          el('option', { value: 'random', text: '抽選', selected: cfg.firstRound === 'random' ? true : null }),
        ]);
        var byePts = numIn(cfg.byePoints, 0, 99, '不戦（Bye）の点');
        add(el('div', { className: 'stack stack--tight' }, [
          field('回戦数', rounds),
          field('1 回戦の組み方', first),
          field('不戦（Bye）の点（Buchholz では不戦を 0 として数えます）', byePts),
          el('p', { className: 'muted small', text: '2 回戦以降は、勝ち点の近い選手どうしを再戦なしで組みます（このアプリの汎用のスイス式で、特定の大会の規則の再現ではありません）。組めないときは理由を表示して条件を緩めます。' }),
        ]), function () {
          return { rounds: Number(rounds.value), firstRound: first.value, byePoints: Number(byePts.value) };
        });
      }
      if (group || type === 'series') {
        var adv = advancementEditor(st, cfg.advancement, cfg.advanced);
        add(adv.node, function () {
          return cfg.advanced ? {} : { advancement: adv.value() };
        });
      }
      if (type === 'series') {
        var nights = numIn(cfg.nights, 1, 30, '節の数');
        var np = el('input', { className: 'input', value: cfg.nightPoints.join(', '), 'aria-label': '節の順位ポイント' });
        var nd = el('select', { className: 'input input--auto', 'aria-label': '節の組み合わせの決め方' }, [
          el('option', { value: 'random', text: '節ごとに抽選（既定）', selected: cfg.nightDraw === 'random' ? true : null }),
          el('option', { value: 'standing', text: 'その時点の累計順位でシード', selected: cfg.nightDraw === 'standing' ? true : null }),
          el('option', { value: 'seed', text: '参加者名簿の順', selected: cfg.nightDraw === 'seed' ? true : null }),
        ]);
        var tbS = tiebreakEditor(cfg.tiebreakers, cfg.advanced, (d.tiebreakersFor || {}).series);
        add(el('div', { className: 'stack stack--tight' }, [
          field('節の数（中止の節は数に含めたまま、完了の条件から外します）', nights),
          field('順位ポイント（優勝, 準優勝, 準決勝敗退, 準々決勝敗退 …。到達した順位の総点）', np),
          field('節の組み合わせ', nd),
          tbS.node,
        ]), function () {
          return {
            nights: Number(nights.value),
            nightPoints: np.value.split(/[,、\s]+/).filter(Boolean).map(Number),
            nightDraw: nd.value,
            tiebreakers: cfg.advanced ? undefined : tbS.value(),
          };
        });
      }
      if (type === 'single_elimination') {
        var third = el('input', { type: 'checkbox', checked: cfg.thirdPlace });
        add(el('label', { className: 'check' }, [third, ' 3 位決定戦を行う（トーナメント表の作成後は変更不可）']), function () {
          return { thirdPlace: third.checked };
        });
        var mode = el('select', { className: 'input input--auto', 'aria-label': '表の作り方' }, [
          el('option', { value: 'fixed', text: '最初に表を作る（固定の表）', selected: cfg.drawMode !== 'redraw' ? true : null }),
          el('option', { value: 'redraw', text: '回戦ごとに抽選する（指定した回戦から）', selected: cfg.drawMode === 'redraw' ? true : null }),
        ]);
        var fixedRounds = numIn(cfg.fixedRounds, 0, 6, '固定の表で行う回戦数');
        var avoid = el('input', { type: 'checkbox', checked: cfg.avoidSameGroup });
        var max = numIn(cfg.maxEntrants || '', 0, 128, '決勝の枠数');
        add(el('div', { className: 'stack stack--tight' }, [
          field('表の作り方（トーナメント表の作成後は変更不可）', mode),
          field('回戦ごとに抽選する場合: 固定の表で行う回戦数（0 = 1 回戦から抽選）', fixedRounds),
          el('label', { className: 'check' }, [avoid, ' 同じ予選グループの選手が 1 回戦で当たらないようにする（同じ順位どうしのシードを入れ替えます。両立できないときは理由を表示）']),
          field('枠数（0 = 制限なし。直接出場と進出者の合計がこれを超えたら進出を止めます）', max),
        ]), function () {
          return { drawMode: mode.value, fixedRounds: Number(fixedRounds.value) || 0, avoidSameGroup: avoid.checked, maxEntrants: Number(max.value) || 0 };
        });
        var rounds2 = eliminationRounds(st);
        var roundSelects = rounds2.map(function (r) {
          var sel = el('select', { className: 'input input--short', 'aria-label': r.label + ' の Best of' }, [el('option', { value: '', text: '段階の既定' })].concat(
            BEST_OF_CHOICES.map(function (n) {
              return el('option', { value: String(n), text: 'Best of ' + n, selected: cfg.roundBestOf[String(r.round)] === n ? true : null });
            })
          ));
          return { round: r.round, node: el('label', { className: 'field field--inline' }, [el('span', { className: 'field__label', text: r.label }), sel]), sel: sel };
        });
        if (roundSelects.length) {
          parts.push(el('div', { className: 'stack stack--tight' }, [el('span', { className: 'field__label', text: 'ラウンドごとの Best of（例: 決勝だけ長くする）' })].concat(roundSelects.map(function (x) { return x.node; }))));
        } else {
          parts.push(el('p', { className: 'muted small', text: '出場者が決まると、ラウンドごとの Best of を設定できます。' }));
        }
        collectors.push(function () {
          var map = {};
          roundSelects.forEach(function (x) {
            if (x.sel.value) map[x.round] = Number(x.sel.value);
          });
          return { roundBestOf: map };
        });
      }
      if (type === 'double_elimination') {
        var gf = el('select', { className: 'input', 'aria-label': 'グランドファイナルの方式' }, [
          el('option', { value: 'reset', text: '敗者側の選手が勝ったら、もう 1 試合（リセット）', selected: cfg.grandFinal !== 'single' ? true : null }),
          el('option', { value: 'single', text: '1 試合のみ（勝者側の選手もここで負けると 1 敗で敗退）', selected: cfg.grandFinal === 'single' ? true : null }),
        ]);
        add(field('グランドファイナルの方式（表の作成後は変更不可）', gf), function () {
          return { grandFinal: gf.value };
        });
      }
      parts.push(
        el('div', { className: 'btn-row' }, [
          el('button', {
            className: 'btn btn--primary',
            type: 'button',
            'data-mut': true,
            text: 'この段階を保存',
            onClick: function () {
              var payload = { stageId: st.id, rev: st.rev, name: name.value, rule: rule.value() };
              collectors.forEach(function (c) {
                var v = c();
                Object.keys(v).forEach(function (k) {
                  if (v[k] !== undefined) payload[k] = v[k];
                });
              });
              mutate('updateStage', payload, '保存しました。');
            },
          }),
          d.stages.length > 1
            ? confirmButton('この段階を削除', '本当に削除', function () {
                mutate('deleteStage', { stageId: st.id, rev: st.rev }, '段階を削除しました。');
              })
            : null,
        ])
      );
      return el('section', { className: 'panel stage-editor', 'data-stage-id': st.id }, [el('div', { className: 'stack' }, parts)]);
    }

    /** 手動の加減点（F14）。理由は必須 */
    function adjustmentEditor(st) {
      var d = state.detail;
      var list = (st.config.adjustments || []).map(function (a) {
        return { playerId: a.playerId, points: a.points, reason: a.reason };
      });
      var members = st.entries.map(function (e) {
        return e.playerId;
      });
      var nameOf = {};
      d.players.forEach(function (p) {
        nameOf[p.id] = p.name;
      });
      var box = el('div', { className: 'stack stack--tight adjustments' });
      var draw = function () {
        box.textContent = '';
        box.appendChild(el('span', { className: 'field__label', text: '手動の加減点（理由が必要。記録した時刻と操作者を残します）' }));
        list.forEach(function (a, i) {
          box.appendChild(el('div', { className: 'row row--tight' }, [
            el('span', { className: 'tb-item', text: (nameOf[a.playerId] || '?') + '　' + (a.points > 0 ? '+' : '') + a.points + ' 点　' + a.reason }),
            el('button', { className: 'btn btn--small', type: 'button', text: '外す', disabled: st.config.advanced, onClick: function () { list.splice(i, 1); draw(); } }),
          ]));
        });
        if (st.config.advanced || !members.length) return;
        var who = el('select', { className: 'input input--auto', 'aria-label': '加減点の選手' }, members.map(function (pid) {
          return el('option', { value: pid, text: nameOf[pid] || pid });
        }));
        var pts = el('input', { className: 'input input--tiny', type: 'number', value: '-1', 'aria-label': '加減する点' });
        var reason = el('input', { className: 'input', maxlength: 200, placeholder: '理由', 'aria-label': '加減点の理由' });
        box.appendChild(el('div', { className: 'row row--tight' }, [who, pts, reason, el('button', { className: 'btn btn--small', type: 'button', text: '追加', onClick: function () {
          if (!reason.value.trim() || !Number(pts.value)) {
            toast('error', '0 以外の点と理由を入力してください。');
            return;
          }
          list.push({ playerId: who.value, points: Number(pts.value), reason: reason.value.trim() });
          draw();
        } })]));
        box.appendChild(el('div', { className: 'btn-row' }, [el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '加減点を保存', onClick: function () { mutate('updateStage', { stageId: st.id, rev: st.rev, adjustments: list }, '加減点を保存しました。'); } })]));
      };
      draw();
      return box;
    }

    /** トーナメントのラウンド一覧（表があればその表から、なければ出場者数から） */
    function eliminationRounds(st) {
      if (st.rounds && st.rounds.length) {
        return st.rounds.map(function (r) {
          return { round: r.round, label: r.label };
        });
      }
      var n = st.entries.length;
      if (n < 2) return [];
      var total = Math.ceil(Math.log(n) / Math.LN2);
      var out = [];
      for (var r = 1; r <= total; r++) {
        out.push({ round: r, label: r === total ? '決勝' : r === total - 1 ? '準決勝' : r === total - 2 ? '準々決勝' : r + '回戦' });
      }
      return out;
    }

    function parseLabels(text) {
      var out = {};
      String(text || '')
        .split(/\r?\n/)
        .forEach(function (line) {
          var m = line.match(/^\s*(\d{1,2})\s*[:：]\s*(.+?)\s*$/);
          if (m) out[m[1]] = m[2];
        });
      return out;
    }

    /** 順位の決め方（使う項目と順番） */
    function tiebreakEditor(initial, locked, allowed) {
      var labels = {};
      Object.keys(state.detail.tiebreakerLabels).forEach(function (k) {
        if (!allowed || allowed.indexOf(k) !== -1) labels[k] = state.detail.tiebreakerLabels[k];
      });
      var list = initial.slice();
      var box = el('div', { className: 'stack stack--tight' });
      var draw = function () {
        box.textContent = '';
        box.appendChild(el('span', { className: 'field__label', text: '順位の決め方（上から順に比べ、最後まで並んだら主催者が手動で決めます）' }));
        list.forEach(function (k, i) {
          box.appendChild(
            el('div', { className: 'row row--tight' }, [
              el('span', { className: 'tb-item', text: i + 1 + '. ' + labels[k] }),
              el('button', { className: 'btn btn--small', type: 'button', text: '↑', 'aria-label': labels[k] + ' を上へ', disabled: locked || i === 0, onClick: function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); draw(); } }),
              el('button', { className: 'btn btn--small', type: 'button', text: '↓', 'aria-label': labels[k] + ' を下へ', disabled: locked || i === list.length - 1, onClick: function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); draw(); } }),
              el('button', { className: 'btn btn--small', type: 'button', text: '外す', disabled: locked, onClick: function () { list.splice(i, 1); draw(); } }),
            ])
          );
        });
        var rest = Object.keys(labels).filter(function (k) {
          return list.indexOf(k) === -1;
        });
        if (rest.length && !locked) {
          var sel = el('select', { className: 'input input--auto', 'aria-label': '順位の決め方を追加' }, rest.map(function (k) {
            return el('option', { value: k, text: labels[k] });
          }));
          box.appendChild(el('div', { className: 'row row--tight' }, [sel, el('button', { className: 'btn btn--small', type: 'button', text: '追加', onClick: function () { list.push(sel.value); draw(); } })]));
        }
      };
      draw();
      return {
        node: box,
        value: function () {
          return list.slice();
        },
      };
    }

    /** 進出ルール（何位から何位まで → どの段階へ） */
    function advancementEditor(st, initial, locked) {
      var d = state.detail;
      var targets = d.stages.filter(function (x) {
        return x.order > st.order;
      });
      var rows = initial.map(function (r) {
        return { fromRank: r.fromRank, toRank: r.toRank, targetStageId: r.targetStageId };
      });
      var box = el('div', { className: 'stack stack--tight' });
      var draw = function () {
        box.textContent = '';
        box.appendChild(el('span', { className: 'field__label', text: st.type === 'series' ? '進出ルール（累計順位 → 次の段階）' : '進出ルール（各グループの順位 → 次の段階）' }));
        if (!targets.length) {
          box.appendChild(el('p', { className: 'muted small', text: '進出先にできる段階（この段階より後の段階）がありません。下の「段階を追加」で追加できます。' }));
          return;
        }
        rows.forEach(function (r, i) {
          var from = el('input', { className: 'input input--tiny', type: 'number', min: 1, max: 99, value: String(r.fromRank), disabled: locked, 'aria-label': '何位から' });
          var to = el('input', { className: 'input input--tiny', type: 'number', min: 1, max: 99, value: r.toRank >= 99 ? '' : String(r.toRank), placeholder: '最下位', disabled: locked, 'aria-label': '何位まで（空欄は最下位まで）' });
          var target = el('select', { className: 'input input--auto', disabled: locked, 'aria-label': '進出先' }, targets.map(function (t) {
            return el('option', { value: t.id, text: t.name, selected: t.id === r.targetStageId ? true : null });
          }));
          var sync = function () {
            r.fromRank = Number(from.value);
            r.toRank = to.value ? Number(to.value) : 99;
            r.targetStageId = target.value;
          };
          [from, to, target].forEach(function (x) {
            x.addEventListener('change', sync);
          });
          sync();
          box.appendChild(
            el('div', { className: 'row row--tight' }, [from, el('span', { text: '位 〜' }), to, el('span', { text: '位 →' }), target, el('button', { className: 'btn btn--small', type: 'button', text: '外す', disabled: locked, onClick: function () { rows.splice(i, 1); draw(); } })])
          );
        });
        if (!locked) {
          box.appendChild(
            el('button', {
              className: 'btn btn--small',
              type: 'button',
              text: '進出ルールを追加',
              onClick: function () {
                var last = rows[rows.length - 1];
                var start = last ? Math.min(99, (last.toRank >= 99 ? 1 : last.toRank) + 1) : 1;
                rows.push({ fromRank: start, toRank: start, targetStageId: targets[0].id });
                draw();
              },
            })
          );
        }
      };
      draw();
      return {
        node: box,
        value: function () {
          return rows.map(function (r) {
            return { fromRank: r.fromRank, toRank: r.toRank, targetStageId: r.targetStageId };
          });
        },
      };
    }

    /* ---------- 組み合わせ（グループ・出場者・トーナメント表・進出） ---------- */

    function renderPairing() {
      var st = currentStage();
      var wrap = el('div', { className: 'stack' });
      var sc = stageChips();
      if (sc) wrap.appendChild(el('div', { className: 'panel panel--tight' }, [sc]));
      if (st.type === 'single_elimination' || st.type === 'double_elimination') renderEliminationPairing(st, wrap);
      else if (st.type === 'series') renderSeriesPairing(st, wrap);
      else renderGroupPairing(st, wrap);
      if (st.config.advancement && st.config.advancement.length) wrap.appendChild(advancementPanel(st));
      return wrap;
    }

    /** 抽選・組分けの方法（F01・F16・F17）。カード作成前だけ。やり直しは確認してから */
    function assignControls(st) {
      var d = state.detail;
      var hasMatches = st.matchCount > 0;
      var ui = state.ui.assign || (state.ui.assign = { method: 'registration', useSeeds: true, useRating: true, spreadAffiliation: true, confirm: false });
      var method = el('select', { className: 'input input--auto', id: 'assign-method', 'aria-label': '割り当ての方法' }, [
        el('option', { value: 'registration', text: '登録順に配る', selected: ui.method === 'registration' ? true : null }),
        el('option', { value: 'random', text: '抽選（ランダム）', selected: ui.method === 'random' ? true : null }),
        el('option', { value: 'balanced', text: '組分け（シード・Rt・所属を考えて配る）', selected: ui.method === 'balanced' ? true : null }),
      ]);
      var seeds = el('input', { type: 'checkbox', checked: ui.useSeeds });
      var rating = el('input', { type: 'checkbox', checked: ui.useRating });
      var aff = el('input', { type: 'checkbox', checked: ui.spreadAffiliation });
      var opts = el('div', { className: 'stack stack--tight', hidden: ui.method === 'registration' }, [
        el('label', { className: 'check', hidden: ui.method !== 'balanced' }, [seeds, ' シードの選手を別々の組へ']),
        el('label', { className: 'check', hidden: ui.method !== 'balanced' }, [rating, ' Rt の高い順に蛇行で配る（Rt 未入力の選手は 0 とせず、その後に抽選で配る）']),
        el('label', { className: 'check' }, [aff, ' 同じ所属の選手をなるべく別の組へ（所属が空欄の選手は対象外）']),
        el('p', { className: 'muted small', text: '優先順位: 組の人数の均衡（人数差 1 以下）→ シードの分散 → Rt の分散 → 所属の分散。下の条件は上の条件を崩さない範囲で整え、分けきれなかった内容は結果に表示します。' }),
      ]);
      var syncUi = function () {
        ui.method = method.value;
        ui.useSeeds = seeds.checked;
        ui.useRating = rating.checked;
        ui.spreadAffiliation = aff.checked;
      };
      [method, seeds, rating, aff].forEach(function (x) {
        x.addEventListener('change', function () {
          syncUi();
          render();
        });
      });
      var assigned = st.entries.length > 0;
      var run = function (confirmRedraw) {
        syncUi();
        mutate('autoAssign', { eventId: d.event.id, stageId: st.id, method: ui.method, useSeeds: ui.useSeeds, useRating: ui.useRating, spreadAffiliation: ui.method !== 'registration' && ui.spreadAffiliation, confirmRedraw: confirmRedraw }, function (r) {
          return r.assigned + ' 名を割り当てました。';
        }).then(function (data) {
          if (data && data.report) state.ui.lastDraw = { stageId: st.id, report: data.report };
          render();
        });
      };
      var label = st.type === 'league' ? '登録選手を全員参加させる' : st.type === 'swiss' ? '登録選手を全員参加させる' : ui.method === 'registration' ? '登録順に自動割当' : ui.method === 'random' ? '抽選する' : '組分けする';
      var buttons = [];
      if (assigned && ui.method !== 'registration') {
        buttons.push(confirmButton('抽選し直す', '今の割り当てを置き換えて抽選する', function () { run(true); }));
      } else {
        buttons.push(el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': hasMatches ? '1' : null, text: label, onClick: function () { run(false); } }));
      }
      var report = state.ui.lastDraw && state.ui.lastDraw.stageId === st.id ? state.ui.lastDraw.report : st.config.lastDraw && st.config.lastDraw.report;
      return el('div', { className: 'stack stack--tight' }, [
        st.type === 'swiss' ? null : el('div', { className: 'row row--tight' }, [field('割り当ての方法', method)]),
        st.type === 'swiss' ? null : opts,
        el('div', { className: 'btn-row' }, buttons),
        report && report.notes && report.notes.length ? el('ul', { className: 'plain-list draw-report' }, report.notes.map(function (n) { return el('li', { text: n }); })) : null,
        st.config.lastDraw ? el('p', { className: 'muted small', text: '前回の割り当て: ' + { registration: '登録順', random: '抽選', balanced: '組分け' }[st.config.lastDraw.method] + '（' + formatDateTime(st.config.lastDraw.at) + '・' + st.config.lastDraw.by + '）。結果は保存されているので、画面を読み直しても変わりません。' }) : null,
      ]);
    }

    function renderGroupPairing(st, wrap) {
      var d = state.detail;
      var league = st.type === 'league';
      var swiss = st.type === 'swiss';
      var hasMatches = st.matchCount > 0;
      var locked = st.config.advanced;
      var tools = [];
      if (!swiss) {
        var count = el('input', { className: 'input input--short', type: 'number', min: 1, max: 16, value: String(st.groups.length), inputmode: 'numeric', 'aria-label': league ? 'ディビジョン数' : 'グループ数' });
        tools.push(el('span', { text: league ? 'ディビジョン数' : 'グループ数' }), count, el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': hasMatches ? '1' : null, text: '変更', onClick: function () { mutate('setGroupCount', { eventId: d.event.id, stageId: st.id, count: Number(count.value) }, (league ? 'ディビジョン数' : 'グループ数') + 'を変更しました。'); } }));
      }
      var main = [
        el('h3', { text: st.name + '（' + STAGE_TYPE_LABEL[st.type] + (st.cycles === 2 && !swiss ? '・2 回総当たり' : '') + '）' }),
        tools.length ? el('div', { className: 'row' }, tools) : null,
        assignControls(st),
      ];
      if (swiss) main.push(swissControls(st));
      else {
        main.push(el('div', { className: 'btn-row' }, [el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: league && st.groups.length === 1 ? '対戦カードを作成' : '全' + (league ? 'ディビジョン' : 'グループ') + 'の対戦カードを作成', onClick: function () { mutate('generateMatches', { eventId: d.event.id, stageId: st.id }, function (r) { return r.created + ' 試合を作成しました。' + (r.skipped && r.skipped.length ? '（対象外: ' + r.skipped.join('、') + '）' : ''); }); } })]));
      }
      if (hasMatches && !swiss) main.push(el('p', { className: 'muted small', text: '対戦カード作成後は、グループ数の変更・自動割当はできません（カードを削除すると再びできます）。' }));
      if (st.feeds.length) main.push(el('p', { className: 'muted small', text: 'この段階には、前の段階から進出者が入ります（進出の確定時に自動で登録されます。前の段階の成績は持ち越しません）。' }));
      wrap.appendChild(el('section', { className: 'panel' }, main));

      // 選手の割り当て
      var groupOf = {};
      st.entries.forEach(function (e) {
        groupOf[e.playerId] = e.groupId;
      });
      var options = [{ id: '', name: league || swiss ? '不参加' : '未割当' }].concat(st.groups);
      var assign = el('section', { className: 'panel' }, [el('h3', { text: league || swiss ? '参加する選手' : '選手の割り当て' })]);
      d.players.forEach(function (p) {
        var sel = el('select', { className: 'input', 'aria-label': p.name + ' のグループ', 'data-mut': true, 'data-locked': locked || (swiss && hasMatches) ? '1' : null }, options.map(function (g) {
          return el('option', { value: g.id, text: g.name, selected: g.id === (groupOf[p.id] || '') ? true : null });
        }));
        sel.addEventListener('change', function () {
          mutate('assignPlayer', { eventId: d.event.id, stageId: st.id, playerId: p.id, groupId: sel.value }, '割り当てを変更しました。');
        });
        assign.appendChild(el('div', { className: 'player-row' }, [el('span', { text: p.name + (p.affiliation ? '（' + p.affiliation + '）' : '') + (p.withdrawn ? '・' + (p.withdrawn.kind === 'disqualified' ? '失格' : '棄権') : '') }), sel]));
      });
      if (!d.players.length) assign.appendChild(el('p', { className: 'muted', text: '選手が登録されていません。' }));
      wrap.appendChild(assign);

      st.groups.forEach(function (g) {
        wrap.appendChild(renderGroupCard(st, g));
      });
    }

    /** スイス式: 次の回戦を組む・最新の回戦の削除・組み合わせの記録（緩めた条件と理由） */
    function swissControls(st) {
      var d = state.detail;
      var generated = st.swiss ? st.swiss.generated : 0;
      var g = st.groups[0];
      var latestOpen = g ? g.matches.filter(function (m) { return m.round === generated && m.status !== 'final' && m.status !== 'bye'; }).length : 0;
      var log = (st.swiss && st.swiss.log) || [];
      var relaxText = function (r) {
        return r.detail || r.rule;
      };
      return el('div', { className: 'stack stack--tight swiss-controls' }, [
        el('p', { text: generated + ' / ' + st.config.rounds + ' 回戦を組みました。' + (latestOpen ? '第' + generated + '回戦の未確定が ' + latestOpen + ' 試合あります。' : '') }),
        el('div', { className: 'btn-row' }, [
          el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': generated >= st.config.rounds || latestOpen || !st.entries.length || st.config.advanced ? '1' : null, text: '第' + (generated + 1) + '回戦を組む', onClick: function () { mutate('generateSwissRound', { eventId: d.event.id, stageId: st.id }, function (r) { return '第' + r.round + '回戦を組みました（' + r.created + ' 試合' + (r.bye ? '・不戦 ' + r.bye : '') + '）。' + (r.relaxed && r.relaxed.length ? '条件を緩めました: ' + r.relaxed.map(relaxText).join(' / ') : ''); }); } }),
          generated ? confirmButton('第' + generated + '回戦の組み合わせを削除', '本当に削除（始まっていない場合のみ）', function () { mutate('deleteSwissRound', { eventId: d.event.id, stageId: st.id }, '組み合わせを削除しました。'); }) : null,
        ]),
        el('p', { className: 'muted small', text: '前の回戦がすべて確定してから押してください（自動では組みません）。後の回戦を組んだ後に前の回戦を訂正するときは、先に最新の回戦の組み合わせを削除します。' }),
        log.length
          ? el('details', { className: 'swiss-log' }, [
              el('summary', { text: '組み合わせの記録（' + log.length + ' 回戦）' }),
              el('ul', { className: 'plain-list' }, log.map(function (l) {
                return el('li', { text: '第' + l.round + '回戦（' + formatDateTime(l.at) + '）' + (l.bye ? '・不戦: ' + l.bye : '') + (l.relaxed && l.relaxed.length ? '・緩めた条件: ' + l.relaxed.map(relaxText).join(' / ') : '・すべての条件を満たしました') + (l.rematches && l.rematches.length ? '・再戦: ' + l.rematches.join('、') : '') });
              })),
            ])
          : null,
      ]);
    }

    function renderGroupCard(st, g) {
      var d = state.detail;
      var name = el('input', { className: 'input', value: g.name, maxlength: 40, 'aria-label': 'グループ名' });
      var nameOf = {};
      g.players.forEach(function (p) {
        nameOf[p.id] = p.name;
      });
      var anyTied = g.standings.some(function (r) {
        return r.tied;
      });
      var manualSet = st.entries.some(function (e) {
        return e.groupId === g.id && e.manualOrder;
      });
      var sets = st.rule && st.rule.format === 'sets';
      var pts = g.standings.some(function (r) {
        return r.points !== undefined;
      });
      var swiss = st.type === 'swiss';
      var draws = g.standings.some(function (r) {
        return r.drawn;
      });
      var heads = ['順位', '選手'].concat(pts ? ['勝ち点'] : []).concat(['勝-' + (draws ? '分-' : '') + '敗']).concat(swiss ? ['Buchholz'] : []).concat(['Leg 得-失']).concat(sets ? ['セット 得-失'] : []);
      var table = el('div', { className: 'table-wrap' }, [
        el('table', { className: 'table' }, [
          el('thead', null, [el('tr', null, heads.map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
          el('tbody', null, g.standings.map(function (r) {
            return el('tr', null, [
              el('td', { text: (r.tied ? '=' : '') + r.rank }),
              el('th', { scope: 'row', text: nameOf[r.playerId] || '' }),
            ].concat(pts ? [el('td', { text: String(r.points) + (r.adjustment ? '（加減 ' + (r.adjustment > 0 ? '+' : '') + r.adjustment + '）' : '') })] : []).concat([
              el('td', { text: r.won + '-' + (draws ? (r.drawn || 0) + '-' : '') + r.lost }),
            ]).concat(swiss ? [el('td', { text: String(r.buchholz || 0) })] : []).concat([
              el('td', { text: r.legsFor + '-' + r.legsAgainst }),
            ]).concat(sets ? [el('td', { text: r.setsFor + '-' + r.setsAgainst })] : []));
          })),
        ]),
      ]);
      var parts = [
        el('div', { className: 'row' }, [name, el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '名前を保存', onClick: function () { mutate('renameGroup', { groupId: g.id, rev: g.rev, name: name.value }, '保存しました。'); } })]),
        g.players.length ? table : el('p', { className: 'muted', text: '選手がいません。' }),
        el('p', { className: 'muted small', text: (g.complete ? '全試合確定。' : '確定した試合だけで数えた暫定順位です。') + '「=」は同順位。対戦カード: ' + g.progress.total + ' 試合' }),
      ];
      if ((anyTied || manualSet) && !st.config.advanced) parts.push(manualOrderEditor(st, g, nameOf));
      if (st.type !== 'swiss') {
        parts.push(
          el('div', { className: 'btn-row' }, [
            el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': g.progress.total > 0 ? '1' : null, text: '対戦カードを作成', onClick: function () { mutate('generateMatches', { eventId: d.event.id, stageId: st.id, groupId: g.id }, function (r) { return r.created + ' 試合を作成しました。'; }); } }),
            g.progress.total > 0 ? confirmButton('対戦カードを削除', '本当に削除', function () { mutate('clearMatches', { eventId: d.event.id, groupId: g.id }, '対戦カードを削除しました。'); }) : null,
          ])
        );
      }
      return el('section', { className: 'panel' }, [el('div', { className: 'stack' }, parts)]);
    }

    /** 同順位の選手の並びを手で決める（↑↓で並べて保存）。シリーズは段階全体で決める（g が null） */
    function manualOrderEditor(st, g, nameOf) {
      var d = state.detail;
      var standings = g ? g.standings : st.standings;
      var order = standings.map(function (r) {
        return r.playerId;
      });
      var scope = g ? { groupId: g.id } : {};
      var box = el('div', { className: 'stack stack--tight manual-order' });
      var draw = function () {
        box.textContent = '';
        box.appendChild(el('span', { className: 'field__label', text: '手動で順位を決める（設定した決め方で決まらない場合。上から 1 位）' }));
        order.forEach(function (pid, i) {
          box.appendChild(
            el('div', { className: 'row row--tight' }, [
              el('span', { className: 'tb-item', text: i + 1 + '. ' + nameOf[pid] }),
              el('button', { className: 'btn btn--small', type: 'button', text: '↑', 'aria-label': nameOf[pid] + ' を上へ', disabled: i === 0, onClick: function () { order.splice(i - 1, 0, order.splice(i, 1)[0]); draw(); } }),
              el('button', { className: 'btn btn--small', type: 'button', text: '↓', 'aria-label': nameOf[pid] + ' を下へ', disabled: i === order.length - 1, onClick: function () { order.splice(i + 1, 0, order.splice(i, 1)[0]); draw(); } }),
            ])
          );
        });
        box.appendChild(
          el('div', { className: 'btn-row' }, [
            el('button', { className: 'btn', type: 'button', 'data-mut': true, text: 'この順番で決める', onClick: function () { mutate('setManualOrder', Object.assign({ eventId: d.event.id, stageId: st.id, playerIds: order }, scope), '順位を決めました。'); } }),
            el('button', { className: 'btn btn--ghost', type: 'button', 'data-mut': true, text: '手動の順位を解除', onClick: function () { mutate('setManualOrder', Object.assign({ eventId: d.event.id, stageId: st.id, playerIds: [] }, scope), '解除しました。'); } }),
          ])
        );
      };
      draw();
      return box;
    }

    /** 進出（F18 など）: 確認してから確定する。境目の同順位は手動で決めるまで止まる */
    function advancementPanel(st) {
      var d = state.detail;
      var targetName = function (id) {
        var t = d.stages.filter(function (x) {
          return x.id === id;
        })[0];
        return t ? t.name : '（不明）';
      };
      var locked = st.config.advanced;
      var pv = state.ui.advPreview && state.ui.advPreview.stageId === st.id ? state.ui.advPreview.data : null;
      var panel = el('section', { className: 'panel' }, [
        el('h3', { text: '次の段階への進出' }),
        el('ul', { className: 'plain-list' }, st.config.advancement.map(function (r) {
          return el('li', { text: (st.type === 'series' ? '累計 ' : st.groups && st.groups.length > 1 ? '各グループ ' : '') + r.fromRank + '位〜' + (r.toRank >= 99 ? '最下位' : r.toRank + '位') + ' → ' + targetName(r.targetStageId) });
        })),
      ]);
      if (locked) {
        panel.appendChild(el('p', { text: '進出確定済み（' + formatDateTime(st.config.advancedAt) + '）。進出先の出場者に登録されています。' }));
        panel.appendChild(el('div', { className: 'btn-row' }, [confirmButton('進出を取り消す', '本当に取り消す', function () { mutate('undoAdvancement', { eventId: d.event.id, stageId: st.id }, '進出を取り消しました。'); })]));
        return panel;
      }
      panel.appendChild(el('p', { className: 'muted small', text: st.complete ? 'この段階は終わっています。「進出を確認」で誰がどこへ入るかを確かめてから確定してください。' : 'この段階が終わると（' + ((st.completion && st.completion.reason) || '') + '）進出を確定できます。' }));
      panel.appendChild(el('div', { className: 'btn-row' }, [
        el('button', {
          className: 'btn',
          type: 'button',
          'data-locked': st.complete ? null : '1',
          'data-mut': true,
          text: '進出を確認',
          onClick: function () {
            api
              .query('previewAdvancement', { eventId: d.event.id, stageId: st.id })
              .then(function (res) {
                state.ui.advPreview = { stageId: st.id, data: res };
                render();
              })
              .catch(handleError);
          },
        }),
      ]));
      if (pv) {
        if (!pv.ok) {
          panel.appendChild(el('p', { className: 'error', text: pv.message }));
        } else {
          pv.targets.forEach(function (t) {
            panel.appendChild(el('h4', { text: '→ ' + t.name + '（' + t.rows.length + ' 人）' }));
            t.notes.forEach(function (n) {
              panel.appendChild(el('p', { className: 'muted small', text: n }));
            });
            panel.appendChild(el('ol', { className: 'plain-list' }, t.rows.map(function (r) {
              return el('li', { text: (r.group ? r.group + '・' : '') + (t.type === 'single_elimination' || t.type === 'double_elimination' ? 'シード ' + r.seed + '　' : '') + r.name + '（' + r.label + '）' });
            })));
          });
          panel.appendChild(el('div', { className: 'btn-row' }, [
            el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: 'この内容で順位を確定して進出させる', onClick: function () { mutate('confirmAdvancement', { eventId: d.event.id, stageId: st.id }, function (r) { return r.advanced + ' 名が進出しました。'; }).then(function () { state.ui.advPreview = null; render(); }); } }),
            el('button', { className: 'btn btn--ghost', type: 'button', text: 'やめる', onClick: function () { state.ui.advPreview = null; render(); } }),
          ]));
        }
      }
      return panel;
    }

    /** ポイントシリーズ: 参加者名簿・節ごとの参加者・組み合わせ・中止・累計順位 */
    function renderSeriesPairing(st, wrap) {
      var d = state.detail;
      var nameOf = {};
      d.players.forEach(function (p) {
        nameOf[p.id] = p.name;
      });
      var cfg = st.config;
      wrap.appendChild(el('section', { className: 'panel' }, [
        el('h3', { text: st.name + '（ポイントシリーズ・' + st.planned + ' 節）' }),
        el('p', { className: 'muted small', text: '各節の順位ポイント: ' + cfg.nightPoints.map(function (n, i) { return ['優勝', '準優勝', '準決勝敗退', '準々決勝敗退'][i] ? ['優勝', '準優勝', '準決勝敗退', '準々決勝敗退'][i] + ' ' + n : 'それ以前の敗退 ' + n; }).join('・') + '。到達した順位の総点で、勝った回戦の点を足し合わせません。節の組み合わせ: ' + { random: '節ごとに抽選', standing: '累計順位でシード', seed: '名簿の順' }[cfg.nightDraw] + '。' }),
        el('p', null, ['参加者名簿: ' + st.roster.length + ' 名']),
        assignControls(st),
      ]));
      var standing = el('section', { className: 'panel' }, [el('h3', { text: '累計順位（確定した節のみ。途中の節は暫定）' })]);
      if (st.standings.length) {
        standing.appendChild(el('div', { className: 'table-wrap' }, [
          el('table', { className: 'table' }, [
            el('thead', null, [el('tr', null, ['順位', '選手', '累計', '暫定', '節優勝'].concat(st.nights.map(function (n, i) { return String(i + 1); })).map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
            el('tbody', null, st.standings.map(function (r) {
              return el('tr', null, [
                el('td', { text: (r.tied ? '=' : '') + r.rank }),
                el('th', { scope: 'row', text: nameOf[r.playerId] || '' }),
                el('td', { text: String(r.points) }),
                el('td', { text: r.provisionalPoints ? '+' + r.provisionalPoints : '' }),
                el('td', { text: String(r.nightWins || 0) }),
              ].concat(r.nights.map(function (v) { return el('td', { text: v === null ? '' : String(v) }); })));
            })),
          ]),
        ]));
        if (st.standings.some(function (r) { return r.tied; }) && !cfg.advanced) standing.appendChild(manualOrderEditor(st, null, nameOf));
      } else {
        standing.appendChild(el('p', { className: 'muted', text: '参加者名簿を登録してください。' }));
      }
      wrap.appendChild(standing);
      st.nights.forEach(function (n) {
        wrap.appendChild(nightCard(st, n, nameOf));
      });
    }

    function nightCard(st, n, nameOf) {
      var d = state.detail;
      var statusText = { planned: '未準備', ready: '組み合わせ前', drawn: '組み合わせ済み', running: '進行中', complete: '終了', cancelled: '中止' }[n.status];
      var parts = [
        el('div', { className: 'stage-head' }, [el('h3', { text: n.name + (n.date ? '（' + n.date.replace(/-/g, '/') + '）' : '') }), el('span', { className: 'badge' + (n.status === 'complete' ? ' badge--on' : ''), text: statusText })]),
      ];
      if (n.status === 'cancelled') {
        parts.push(el('p', { className: 'muted small', text: '中止（点なし）' + (n.cancelReason ? ': ' + n.cancelReason : '') }));
        parts.push(el('div', { className: 'btn-row' }, [el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '中止を取り消す', onClick: function () { mutate('cancelNight', { eventId: d.event.id, groupId: n.id, rev: n.rev, undo: true }, '中止を取り消しました。'); } })]));
        return el('section', { className: 'panel night-card night-card--cancelled' }, [el('div', { className: 'stack stack--tight' }, parts)]);
      }
      var date = el('input', { className: 'input input--auto', type: 'date', value: n.date || '', 'aria-label': n.name + ' の開催日' });
      parts.push(el('div', { className: 'row row--tight' }, [field('開催日', date), el('button', { className: 'btn btn--small', type: 'button', 'data-mut': true, text: '保存', onClick: function () { mutate('updateNight', { eventId: d.event.id, groupId: n.id, rev: n.rev, date: date.value }, '保存しました。'); } })]));
      var hasMatches = n.rounds.length > 0;
      if (!hasMatches) {
        var chosen = n.participants.length ? n.participants.map(function (p) { return p.id; }) : st.roster.map(function (p) { return p.id; });
        var boxes = st.roster.map(function (p) {
          return el('label', { className: 'check check--inline' }, [el('input', { type: 'checkbox', value: p.id, checked: chosen.indexOf(p.id) !== -1 }), p.name]);
        });
        parts.push(el('div', { className: 'field' }, [el('span', { className: 'field__label', text: 'この節の参加者（' + (n.participants.length ? '指定あり' : '名簿の全員') + '）' }), el('div', { className: 'row row--tight' }, boxes)]));
        parts.push(el('div', { className: 'btn-row' }, [
          el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '参加者を保存', onClick: function () {
            var ids = boxes.map(function (b) { return b.firstChild; }).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
            mutate('setNightParticipants', { eventId: d.event.id, groupId: n.id, playerIds: ids }, '参加者を保存しました。');
          } }),
          el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': st.config.advanced ? '1' : null, text: 'この節の組み合わせを作る', onClick: function () { mutate('generateNight', { eventId: d.event.id, groupId: n.id }, function (r) { return r.created + ' 試合の組み合わせを作りました。'; }); } }),
        ]));
        var cancelReason = el('input', { className: 'input', maxlength: 200, placeholder: '中止の理由（運営画面だけに表示）', 'aria-label': n.name + ' の中止の理由' });
        parts.push(el('div', { className: 'row row--tight' }, [
          cancelReason,
          confirmButton('この節を中止', '中止（点なし）にする', function () {
            if (!cancelReason.value.trim()) {
              toast('error', '中止の理由を入力してください。');
              return;
            }
            mutate('cancelNight', { eventId: d.event.id, groupId: n.id, rev: n.rev, reason: cancelReason.value }, '中止にしました。');
          }),
        ]));
      } else {
        parts.push(el('p', { className: 'muted small', text: n.participants.length + ' 人・' + n.progress.final + ' / ' + n.progress.total + ' 試合確定' + (n.champion ? '・優勝 ' + n.champion.name : '') }));
        n.rounds.forEach(function (r) {
          parts.push(el('h4', { text: r.label }));
          parts.push(el('ul', { className: 'plain-list' }, r.matches.map(function (m) {
            return el('li', { text: (m.p1.name || '（未定）') + ' vs ' + (m.p2.name || '（未定）') + '　' + MATCH_STATUS_LABEL[m.status] });
          })));
        });
        if (!n.progress.final && !n.progress.live) parts.push(el('div', { className: 'btn-row' }, [confirmButton('組み合わせを削除', '本当に削除', function () { mutate('clearNight', { eventId: d.event.id, groupId: n.id }, '組み合わせを削除しました。'); })]));
      }
      return el('section', { className: 'panel night-card' }, [el('div', { className: 'stack stack--tight' }, parts)]);
    }

    /** トーナメント・ダブルエリミ: 出場者とシード（途中回戦から出場・直接出場）、表のプレビュー・作成、回戦ごとの抽選 */
    function renderEliminationPairing(st, wrap) {
      var d = state.detail;
      var de = st.type === 'double_elimination';
      var cfg = st.config;
      var hasBracket = st.matchCount > 0;
      var nameOf = {};
      d.players.forEach(function (p) {
        nameOf[p.id] = p.name;
      });
      var info = {};
      st.entries.forEach(function (e) {
        info[e.playerId] = e;
      });
      if (!state.entrantDraft[st.id]) {
        state.entrantDraft[st.id] = st.entries
          .slice()
          .sort(function (a, b) {
            return (a.seed || 0) - (b.seed || 0);
          })
          .map(function (e) {
            return { playerId: e.playerId, startRound: e.startRound || 1, direct: !!e.direct };
          });
      }
      var draft = state.entrantDraft[st.id];
      var saved = st.entries
        .slice()
        .sort(function (a, b) {
          return (a.seed || 0) - (b.seed || 0);
        })
        .map(function (e) {
          return e.playerId + ':' + (e.startRound || 1) + ':' + (e.direct ? 1 : 0);
        });
      var dirty = draft.map(function (x) { return x.playerId + ':' + x.startRound + ':' + (x.direct ? 1 : 0); }).join(',') !== saved.join(',');
      var head = el('section', { className: 'panel' }, [
        el('h3', { text: st.name + '（' + (de ? 'ダブルエリミネーション・グランドファイナル: ' + (cfg.grandFinal === 'single' ? '1 試合のみ' : 'リセットあり') : 'トーナメント' + (cfg.thirdPlace ? '・3 位決定戦あり' : '') + (cfg.drawMode === 'redraw' ? '・回戦ごとに抽選' : '')) + '）' }),
        st.feeds.length ? el('p', { className: 'muted small', text: 'この段階には、前の段階の順位から進出者が自動で入ります（シード順は 直接出場 → 各組 1 位 → 2 位 … の順）。必要なら下で並べ替えてから保存してください。' }) : null,
        el('p', { className: 'muted small', text: de ? '上から順にシード 1, 2, 3 … です。勝者側は通常のトーナメントと同じ配置で、負けた選手は敗者側へ移ります（早い再戦を減らすよう入る順番を回戦ごとに変えます）。' : '上から順にシード 1, 2, 3 … です。1 位と 2 位が決勝まで当たらない標準の配置で、人数が 2 のべき乗に満たない分は上位シードが不戦勝（次の回戦から出場）になります。「n 回戦から」を選んだシードは、その回戦から出場します（不戦勝とは別に表示します）。' }),
      ]);
      wrap.appendChild(head);
      var maxRound = Math.max(1, Math.ceil(Math.log(Math.max(2, draft.length)) / Math.LN2));
      var list = el('section', { className: 'panel' }, [el('h3', { text: '出場者とシード（' + draft.length + ' 名' + (cfg.maxEntrants ? ' / 枠 ' + cfg.maxEntrants : '') + '）' })]);
      draft.forEach(function (x, i) {
        var pid = x.playerId;
        var src = info[pid] && info[pid].source;
        var round = el('select', { className: 'input input--auto', 'aria-label': (nameOf[pid] || '') + ' の出場する回戦', disabled: hasBracket || de }, [1, 2, 3, 4].filter(function (r) { return r <= maxRound; }).map(function (r) {
          return el('option', { value: String(r), text: r === 1 ? '1 回戦から' : r + ' 回戦から', selected: x.startRound === r ? true : null });
        }));
        round.addEventListener('change', function () {
          x.startRound = Number(round.value);
          render();
        });
        var direct = el('input', { type: 'checkbox', checked: x.direct, disabled: hasBracket, 'aria-label': (nameOf[pid] || '') + ' を直接出場にする' });
        direct.addEventListener('change', function () {
          x.direct = direct.checked;
          render();
        });
        list.appendChild(
          el('div', { className: 'row row--tight seed-row' }, [
            el('span', { className: 'seed-no', text: String(i + 1) }),
            el('span', { className: 'tb-item', text: (nameOf[pid] || '（不明）') + (src ? '（' + src + '）' : '') }),
            de ? null : round,
            el('label', { className: 'check check--inline' }, [direct, '直接出場']),
            el('button', { className: 'btn btn--small', type: 'button', text: '↑', 'aria-label': (nameOf[pid] || '') + ' を上へ', disabled: hasBracket || i === 0, onClick: function () { draft.splice(i - 1, 0, draft.splice(i, 1)[0]); render(); } }),
            el('button', { className: 'btn btn--small', type: 'button', text: '↓', 'aria-label': (nameOf[pid] || '') + ' を下へ', disabled: hasBracket || i === draft.length - 1, onClick: function () { draft.splice(i + 1, 0, draft.splice(i, 1)[0]); render(); } }),
            el('button', { className: 'btn btn--small', type: 'button', text: '外す', disabled: hasBracket, onClick: function () { draft.splice(i, 1); render(); } }),
          ])
        );
      });
      var rest = d.players.filter(function (p) {
        return !draft.some(function (x) { return x.playerId === p.id; });
      });
      if (!hasBracket) {
        if (rest.length) {
          var sel = el('select', { className: 'input', 'aria-label': '出場者を追加' }, rest.map(function (p) {
            return el('option', { value: p.id, text: p.name });
          }));
          list.appendChild(
            el('div', { className: 'row row--tight' }, [
              sel,
              el('button', { className: 'btn btn--small', type: 'button', text: '追加', onClick: function () { draft.push({ playerId: sel.value, startRound: 1, direct: st.feeds.length > 0 }); render(); } }),
              el('button', { className: 'btn btn--small', type: 'button', text: '登録選手を全員追加', onClick: function () { rest.forEach(function (p) { draft.push({ playerId: p.id, startRound: 1, direct: false }); }); render(); } }),
            ])
          );
        }
        if (st.feeds.length) list.appendChild(el('p', { className: 'muted small', text: '「直接出場」は前の段階を経ずに決勝から出る選手です（例: 招待選手）。前の段階の参加者は直接出場にできません。進出を確定しても直接出場の選手は残ります。' }));
        list.appendChild(
          el('div', { className: 'btn-row' }, [
            el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': dirty ? null : '1', text: '出場者とシードを保存', onClick: function () { mutate('setEntrants', { eventId: d.event.id, stageId: st.id, entrants: draft.map(function (x) { return { playerId: x.playerId, startRound: x.startRound, direct: x.direct }; }) }, '保存しました。').then(function () { delete state.entrantDraft[st.id]; render(); }); } }),
            dirty ? el('button', { className: 'btn btn--ghost', type: 'button', text: '変更を取り消す', onClick: function () { delete state.entrantDraft[st.id]; render(); } }) : null,
          ])
        );
      }
      wrap.appendChild(list);

      var bracket = el('section', { className: 'panel' }, [el('h3', { text: de ? '表（勝者側・敗者側・グランドファイナル）' : 'トーナメント表' })]);
      if (hasBracket) {
        stageSections(st).forEach(function (sec) {
          bracket.appendChild(el('h4', { text: sec.name }));
          bracket.appendChild(el('ul', { className: 'plain-list' }, sec.matches.map(function (m) {
            return el('li', { text: (sec.matches.length > 1 || m.label !== sec.name ? m.label + '：' : '') + (m.p1.name || '（未定）') + ' vs ' + (m.p2.name || '（未定）') + '　' + (MATCH_STATUS_LABEL[m.status] || m.status) });
          })));
        });
        var btns = [confirmButton('トーナメント表を削除', '本当に削除', function () { mutate('clearBracket', { eventId: d.event.id, stageId: st.id }, 'トーナメント表を削除しました。'); })];
        if (cfg.drawMode === 'redraw' && !de) {
          btns.unshift(
            el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: '次の回戦を抽選', onClick: function () { mutate('drawNextRound', { eventId: d.event.id, stageId: st.id }, function (r) { return r.round + ' 回戦を抽選しました（' + r.created + ' 試合）。'; }); } }),
            confirmButton('最新の回戦の抽選をやり直す', '本当にやり直す（始まっていない場合のみ）', function () { mutate('drawNextRound', { eventId: d.event.id, stageId: st.id, redo: true }, '抽選をやり直しました（前の抽選は履歴に残ります）。'); })
          );
          bracket.appendChild(el('p', { className: 'muted small', text: '前の回戦の結果がすべて確定してから「次の回戦を抽選」を押してください（自動では抽選しません）。抽選の結果は保存されるので、画面を読み直しても変わりません。' }));
        }
        bracket.appendChild(el('div', { className: 'btn-row' }, btns));
      } else {
        var pv = state.ui.bracketPreview && state.ui.bracketPreview.stageId === st.id ? state.ui.bracketPreview.data : null;
        bracket.appendChild(el('p', { className: 'muted small', text: dirty ? '先に「出場者とシードを保存」を押してください。' : saved.length < 2 ? '出場者が 2 名以上必要です。' : saved.length + ' 名で表を作成します。作成の前に「表を確認」で 1 回戦の組み合わせと注意点を確かめられます。' }));
        bracket.appendChild(el('div', { className: 'btn-row' }, [
          el('button', { className: 'btn', type: 'button', 'data-locked': dirty || saved.length < 2 ? '1' : null, 'data-mut': true, text: '表を確認', onClick: function () {
            api.query('previewBracket', { eventId: d.event.id, stageId: st.id }).then(function (res) { state.ui.bracketPreview = { stageId: st.id, data: res }; render(); }).catch(handleError);
          } }),
          el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': dirty || saved.length < 2 ? '1' : null, text: cfg.drawMode === 'redraw' && !de && !cfg.fixedRounds ? '1 回戦を抽選して表を作成' : 'トーナメント表を作成', onClick: function () { mutate('generateBracket', { eventId: d.event.id, stageId: st.id }, function (r) { return r.created + (de ? ' 試合のダブルエリミネーション表を作成しました。' : ' 試合のトーナメント表を作成しました。'); }).then(function () { state.ui.bracketPreview = null; }); } }),
        ]));
        if (pv) {
          pv.problems.forEach(function (msg) {
            bracket.appendChild(el('p', { className: 'error small', text: msg }));
          });
          pv.notes.forEach(function (msg) {
            bracket.appendChild(el('p', { className: 'muted small', text: msg }));
          });
          if (pv.ok) bracket.appendChild(el('p', { className: 'small', text: '試合数: ' + pv.matchCount + (de && cfg.grandFinal === 'reset' ? '（リセットの決勝を含む。行わないこともあります）' : '') }));
          if (pv.firstRound.length) {
            bracket.appendChild(el('h4', { text: '1 回戦' }));
            bracket.appendChild(el('ul', { className: 'plain-list' }, pv.firstRound.map(function (m) { return el('li', { text: m.p1 + ' vs ' + m.p2 }); })));
          }
          if (pv.drawnAtCreate) bracket.appendChild(el('p', { className: 'muted small', text: '1 回戦は作成するときに抽選します。' }));
          if (pv.schedule) bracket.appendChild(el('p', { className: 'muted small', text: '各回戦の出場人数: ' + pv.schedule.map(function (r) { return r.round + ' 回戦 ' + (r.players === null ? '—' : r.players + ' 人') + (r.joining ? '（うち途中から ' + r.joining + ' 人）' : ''); }).join('・') }));
        }
      }
      wrap.appendChild(bracket);
    }

    /** お知らせ（F09）・ルールの表示（F10）・公開する項目・タイムゾーン・自動終了（F05） */
    function eventSettingsPanel(ev) {
      var cfg = ev.config || {};
      var rd = cfg.ruleDisplay || {};
      var ann = el('textarea', { className: 'input', id: 'set-announcement', rows: 4, maxlength: 1000, value: cfg.announcement ? cfg.announcement.text : '', placeholder: '例: 受付は 18:30 まで。駐車場はありません。' });
      var sel = function (id, options, value) {
        return el('select', { className: 'input input--auto', id: id }, options.map(function (o) {
          return el('option', { value: o[0], text: o[1], selected: String(value === null || value === undefined ? '' : value) === o[0] ? true : null });
        }));
      };
      var category = sel('set-category', [['', '指定しない'], ['soft', 'ソフトダーツ'], ['steel', 'スティールダーツ']], rd.category);
      var start = sel('set-start', [['', '指定しない'], ['101', '101'], ['301', '301'], ['501', '501'], ['701', '701'], ['901', '901'], ['1101', '1101'], ['1501', '1501']], rd.startScore);
      var inMode = sel('set-in', [['', '指定しない'], ['open', 'オープンイン（制限なし）'], ['double', 'ダブルイン'], ['master', 'マスターイン（ダブル・トリプル）']], rd.inMode);
      var outMode = sel('set-out', [['', '指定しない'], ['open', 'オープンアウト（制限なし）'], ['double', 'ダブルアウト'], ['master', 'マスターアウト（ダブル・トリプル）']], rd.outMode);
      var bull = sel('set-bull', [['', '指定しない'], ['fat', 'ファットブル（ブルを 50 点の 1 つにする。ソフト向け）'], ['separate', 'セパレートブル（25・50）']], rd.bull);
      var roundLimit = el('input', { className: 'input input--short', id: 'set-round-limit', type: 'number', min: 1, max: 99, value: rd.roundLimit ? String(rd.roundLimit) : '' });
      var ruleNote = el('input', { className: 'input', id: 'set-rule-note', maxlength: 200, value: rd.note || '', placeholder: '補足（任意）' });
      var pubAff = el('input', { type: 'checkbox', checked: cfg.publicFields && cfg.publicFields.affiliation });
      var pubRt = el('input', { type: 'checkbox', checked: cfg.publicFields && cfg.publicFields.rating });
      var autoFinish = el('input', { type: 'checkbox', checked: !!cfg.autoFinish });
      var tz = sel('set-tz', ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'].map(function (z) { return [z, z]; }), cfg.timezone || 'Asia/Tokyo');
      return el('section', { className: 'panel' }, [
        el('h3', { text: 'お知らせ・ルールの表示・公開する項目' }),
        el('form', {
          className: 'form',
          onSubmit: function (e) {
            e.preventDefault();
            var any = category.value || start.value || inMode.value || outMode.value || bull.value || roundLimit.value || ruleNote.value.trim();
            mutate('updateEventSettings', {
              eventId: ev.id,
              rev: ev.rev,
              announcement: ann.value,
              ruleDisplay: any ? { category: category.value, startScore: start.value ? Number(start.value) : null, inMode: inMode.value, outMode: outMode.value, bull: bull.value, roundLimit: roundLimit.value, note: ruleNote.value } : null,
              publicFields: { affiliation: pubAff.checked, rating: pubRt.checked },
              autoFinish: autoFinish.checked,
              timezone: tz.value,
            }, '保存しました。');
          },
        }, [
          field('閲覧ページのお知らせ（公開。運営メモとは別です。閲覧ページの通常の更新で反映され、通知は送りません）', ann),
          el('fieldset', { className: 'fieldset' }, [
            el('legend', { text: 'ルールの表示（閲覧ページに出す説明。n02 の採点には使いません）' }),
            el('div', { className: 'row row--tight' }, [field('競技区分', category), field('開始点数（01）', start)]),
            el('div', { className: 'row row--tight' }, [field('イン', inMode), field('アウト', outMode)]),
            el('div', { className: 'row row--tight' }, [field('ブル', bull), field('ラウンド上限（任意）', roundLimit)]),
            field('補足', ruleNote),
            el('p', { className: 'muted small', text: 'Leg 制・セット制・Best of は段階ごとのルール（「形式」タブ）から表示します。スティールダーツではファットブルは選べません。' }),
          ]),
          el('label', { className: 'check' }, [pubAff, ' 所属を閲覧ページに出す']),
          el('label', { className: 'check' }, [pubRt, ' Rt を閲覧ページに出す']),
          el('label', { className: 'check' }, [autoFinish, ' すべての段階が終わったら自動で「終了」にする（訂正で終わっていない段階ができたら「開催中」に戻します）']),
          field('予定の時刻のタイムゾーン（表示用）', tz),
          el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '表示の設定を保存' }),
        ]),
      ]);
    }

    /** 共同主催者（F20）: Google アカウント単位。追加・解除は大会を作った本人と管理者だけ。招待メールは送らない */
    function collaboratorsPanel(d) {
      var ev = d.event;
      var email = el('input', { className: 'input', id: 'collab-email', type: 'email', placeholder: '共同主催者の Google アカウント（メールアドレス）' });
      var list = d.collaborators || [];
      return el('section', { className: 'panel' }, [
        el('h3', { text: '共同主催者' }),
        el('p', { className: 'muted small', text: 'Google アカウントで、この大会を一緒に運営できる人を追加します（招待メールは送りません。相手には運営画面の URL を伝えてください）。共同主催者は結果の入力・組み合わせ・設定の変更ができますが、大会の削除・管理パスワード・共同主催者の管理はできません。解除すると、その人のログイン中の画面でもすぐに操作できなくなります。' }),
        el('p', { className: 'muted small', text: '追加した時点では「招待中」で、相手がその Google アカウントでログインすると有効になります。Gmail・Google Workspace 以外のアドレスは Google が今の持ち主を保証しないため、相手のログインの後に「承認」が必要です（相手に、ログインした日時を確かめてから承認してください）。' }),
        list.length
          ? el('ul', { className: 'plain-list' }, list.map(function (c) {
              var status = c.status === 'active' ? '' : c.status === 'pending' ? ' — 承認待ち' : ' — 招待中（相手のログイン待ち）';
              var claims = (c.claims || []).map(function (cl) {
                return el('li', null, [
                  el('span', { text: formatDateTime(cl.at) + ' にログイン（アカウントの識別: ' + cl.ref + '）' }),
                  ' ',
                  confirmButton('承認', 'この人を承認', function () { mutate('approveCollaborator', { eventId: ev.id, collabId: c.id, rev: c.rev, ref: cl.ref }, '共同主催者を承認しました。'); }),
                ]);
              });
              return el('li', null, [
                el('span', { text: c.email + '（' + formatDateTime(c.addedAt) + ' 追加）' + status }),
                ' ',
                confirmButton('解除', '本当に解除', function () { mutate('removeCollaborator', { eventId: ev.id, collabId: c.id }, '解除しました。'); }),
                claims.length ? el('ul', { className: 'plain-list' }, claims) : null,
              ]);
            }))
          : el('p', { className: 'muted small', text: '共同主催者はいません。' }),
        el('form', {
          className: 'row',
          onSubmit: function (e) {
            e.preventDefault();
            mutate('addCollaborator', { eventId: ev.id, email: email.value }, '共同主催者を追加しました。');
          },
        }, [el('label', { className: 'visually-hidden', for: 'collab-email', text: '共同主催者の Google アカウント' }), email, el('button', { className: 'btn', type: 'submit', 'data-mut': true, text: '追加' })]),
      ]);
    }

    /** 大会設定の複製（F12）: 形式・ルール・組の設定・順位の決め方などを、新しい大会（準備中・非公開）に写す */
    function duplicatePanel(ev) {
      var name = el('input', { className: 'input', id: 'dup-name', maxlength: 80, value: ev.name + '（コピー）' });
      var players = el('input', { type: 'checkbox', id: 'dup-players' });
      return el('section', { className: 'panel' }, [
        el('h3', { text: 'この大会の設定を複製' }),
        el('p', { className: 'muted small', text: '段階・ルール・グループ・順位の決め方・お知らせ以外の表示設定を、新しい大会（準備中・非公開）に写します。結果・組み合わせ・変更履歴・管理パスワード・共同主催者は写しません。新しい大会の主催者は、複製した人です。' }),
        field('新しい大会の名前', name),
        el('label', { className: 'check' }, [players, ' 選手（名前・所属・Rt・シード）も写す']),
        el('div', { className: 'btn-row' }, [el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '複製して新しい大会を作る', onClick: function () { mutate('duplicateEvent', { eventId: ev.id, name: name.value, includePlayers: players.checked }, '複製しました。新しい大会を開きます。'); } })]),
      ]);
    }

    function renderSettings() {
      var d = state.detail;
      var ev = d.event;
      var name = el('input', { className: 'input', value: ev.name, maxlength: 80 });
      var date = el('input', { className: 'input', value: ev.dateLabel, maxlength: 40 });
      var status = el('select', { className: 'input' }, Object.keys(EVENT_STATUS_LABEL).map(function (k) {
        return el('option', { value: k, text: EVENT_STATUS_LABEL[k], selected: k === ev.status ? true : null });
      }));
      var isPublic = el('input', { type: 'checkbox', checked: ev.isPublic });
      var featured = el('input', { type: 'checkbox', checked: ev.isFeatured });
      var notes = el('input', { className: 'input', value: ev.notes || '', maxlength: 200 });
      var eventForm = el('section', { className: 'panel' }, [
        el('h3', { text: '大会情報' }),
        el('form', {
          className: 'form',
          onSubmit: function (e) {
            e.preventDefault();
            mutate('updateEvent', { eventId: ev.id, rev: ev.rev, name: name.value, dateLabel: date.value, status: status.value, isPublic: isPublic.checked, isFeatured: featured.checked, notes: notes.value }, '保存しました。');
          },
        }, [
          field('大会名', name),
          field('開催日（表示用）', date),
          field('状態', status),
          el('label', { className: 'check' }, [isPublic, ' 閲覧画面に公開する']),
          state.boot && state.boot.role.isPlatformAdmin ? el('label', { className: 'check' }, [featured, ' 閲覧画面の既定表示にする（URL に大会指定がないときに表示。管理者のみ）']) : null,
          field('運営メモ（非公開）', notes),
          el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '保存' }),
        ]),
      ]);

      var url = eventUrl(win.location, ev.id);
      var urlBox = el('code', { className: 'issued__url', id: 'event-url', text: url });
      var copy = el('button', { className: 'btn', type: 'button', text: 'URL をコピー' });
      copy.addEventListener('click', function () {
        try {
          win.navigator.clipboard.writeText(url).then(
            function () {
              copy.textContent = 'コピーしました';
            },
            function () {
              selectText(urlBox);
            }
          );
        } catch (e) {
          selectText(urlBox);
        }
      });
      var accessPanel = el('section', { className: 'panel' }, [
        el('h3', { text: '店舗スタッフに運営を任せる' }),
        el('p', { className: 'muted small', text: 'スタッフには、この URL と管理パスワードを別々に伝えてください（URL だけでは開けません）。スタッフは結果の入力などの運営ができますが、管理パスワードの変更はできません。' }),
        urlBox,
        el('div', { className: 'btn-row' }, [copy]),
      ]);
      if (ev.canChangePassword) {
        var pass = el('input', { className: 'input', id: 'staff-pass-new', type: 'password', autocomplete: 'new-password', maxlength: 64 });
        accessPanel.appendChild(el('p', { text: '管理パスワード: ' + (ev.staffPasswordSet ? '設定済み（' + formatDateTime(ev.staffPasswordSetAt) + '）' : '未設定（スタッフは開けません）') }));
        accessPanel.appendChild(
          el('form', {
            className: 'form',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('setStaffPassword', { eventId: ev.id, rev: ev.rev, password: pass.value }, '管理パスワードを設定しました。以前のパスワードで開いているスタッフの画面は、もう一度ログインが必要です。');
            },
          }, [
            field(ev.staffPasswordSet ? '新しい管理パスワード（8〜64 文字・空白なし）' : '管理パスワード（8〜64 文字・空白なし）', pass),
            el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: ev.staffPasswordSet ? '変更する' : '設定する' }),
          ])
        );
        if (ev.staffPasswordSet) {
          accessPanel.appendChild(
            el('div', { className: 'btn-row' }, [
              confirmButton('管理パスワードを解除', '本当に解除（スタッフは開けなくなります）', function () {
                mutate('setStaffPassword', { eventId: ev.id, rev: ev.rev, password: '' }, '管理パスワードを解除しました。');
              }),
            ])
          );
        }
      } else {
        accessPanel.appendChild(el('p', { className: 'muted small', text: '管理パスワードの変更は、大会を作った主催者だけが行えます。' }));
      }
      var panels = [eventForm, eventSettingsPanel(ev), accessPanel];
      if (ev.canManageCollaborators) panels.push(collaboratorsPanel(d));
      if (ev.role !== 'staff') panels.push(duplicatePanel(ev));
      if (ev.canChangePassword) panels.push(renderDeletePanel(ev));
      if (state.boot && state.boot.role.isPlatformAdmin) {
        var owner = el('input', { className: 'input', id: 'owner-email', type: 'email', value: ev.ownerEmail || '', placeholder: '主催者の Google アカウントのメールアドレス' });
        panels.push(
          el('section', { className: 'panel' }, [
            el('h3', { text: '主催者（管理者のみ）' }),
            el('p', { className: 'muted small', text: 'この大会を運営できる Google アカウント。v0.4 以前に作った大会や、管理者が作った大会に主催者を付けるときに使います。空欄にすると管理者だけが運営できます。' }),
            ownerLinkInfo(ev),
            el('form', {
              className: 'row',
              onSubmit: function (e) {
                e.preventDefault();
                mutate('setOwner', { eventId: ev.id, rev: ev.rev, ownerEmail: owner.value }, '主催者を保存しました。');
              },
            }, [el('label', { className: 'visually-hidden', for: 'owner-email', text: '主催者の Google アカウント' }), owner, el('button', { className: 'btn', type: 'submit', 'data-mut': true, text: '保存' })]),
          ])
        );
      }
      return el('div', { className: 'stack' }, panels);
    }

    /**
     * 主催者の Google アカウントの紐付け（管理者のみ）。メールアドレスを設定しただけでは権限はなく、本人のログインで紐付く。
     * Google が持ち主を保証しないアドレスは、確認待ちのログインを管理者が承認する（本人に、ログインした日時を確かめてから）
     */
    function ownerLinkInfo(ev) {
      var link = ev.ownerLink;
      if (!link || !ev.ownerEmail) return null;
      if (link.linked) return el('p', { className: 'muted small', text: '紐付け済み（' + (link.via === 'approved' ? '管理者が承認' : link.via === 'created' ? '作成した本人' : '本人のログイン') + '・' + formatDateTime(link.at) + '）' });
      var claims = link.claims || [];
      return el('div', null, [
        el('p', { className: 'notice', text: claims.length ? '確認待ちのログインがあります。本人に確かめてから承認してください（同じアドレスのアカウントが複数あるときは、なりすまし・アドレスの再割り当ての可能性があります）。' : 'まだ紐付いていません。この Google アカウントでログインすると紐付きます（Gmail・Google Workspace 以外のアドレスは、ログインの後にここで承認が必要です）。' }),
        claims.length
          ? el('ul', { className: 'plain-list' }, claims.map(function (cl) {
              return el('li', null, [
                el('span', { text: cl.email + ' — ' + formatDateTime(cl.at) + ' にログイン（アカウントの識別: ' + cl.ref + '）' }),
                ' ',
                confirmButton('承認', 'この人を主催者にする', function () { mutate('approveOwnerClaim', { eventId: ev.id, rev: ev.rev, ref: cl.ref }, '主催者を承認しました。'); }),
              ]);
            }))
          : null,
      ]);
    }

    /** ファイルとして保存させる（ダウンロード） */
    function saveFile(blob, name) {
      var a = el('a', { href: URL.createObjectURL(blob), download: name });
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 10000);
    }

    /**
     * 大会の削除（アーカイブ）。大会を作った本人と管理者だけ。
     * ①大会の全データをファイルに保存 → ②大会名を入力 → ③削除。保存しない場合は、そのことを明示的に選ぶ
     */
    function renderDeletePanel(ev) {
      var exported = false;
      var confirmName = el('input', { className: 'input', id: 'delete-confirm', autocomplete: 'off', placeholder: ev.name });
      var skipSave = el('input', { type: 'checkbox', id: 'delete-skip-save' });
      var deleteButton = el('button', { className: 'btn btn--danger', type: 'button', 'data-mut': true, 'data-locked': '1', disabled: true, text: 'この大会を削除する' });
      var saveButton = el('button', { className: 'btn', type: 'button', text: '① 大会のデータを保存（JSON ファイル）' });
      var sync = function () {
        var ready = confirmName.value.replace(/\s+/g, ' ').trim() === ev.name && (exported || skipSave.checked);
        deleteButton.setAttribute('data-locked', ready ? '0' : '1');
        deleteButton.disabled = state.busy || !ready;
      };
      confirmName.addEventListener('input', sync);
      skipSave.addEventListener('change', sync);
      saveButton.addEventListener('click', function () {
        saveButton.disabled = true;
        api
          .query('exportEvent', { eventId: ev.id })
          .then(function (data) {
            var day = String(data.exportedAt || '').slice(0, 10).replace(/-/g, '');
            saveFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'n02-tournament-' + ev.id + '-' + day + '.json');
            exported = true;
            saveButton.textContent = '保存しました（もう一度保存する）';
            toast('ok', '大会のデータをファイルに保存しました。保存先のフォルダを確認してください。');
            sync();
          })
          .catch(handleError)
          .then(function () {
            saveButton.disabled = false;
          });
      });
      deleteButton.addEventListener('click', function () {
        mutate('deleteEvent', { eventId: ev.id, rev: ev.rev, confirmName: confirmName.value }, '大会「' + ev.name + '」を削除しました。').then(function (data) {
          if (data && data.deletedEventId) goHome();
        });
      });
      return el('section', { className: 'panel danger-zone' }, [
        el('h3', { text: '大会の削除' }),
        el('p', { className: 'muted small', text: 'この大会のデータ（選手・組み合わせ・試合結果・変更履歴・閲覧ページ）をスプレッドシートから消します。元に戻せません。消す前に、データをファイルに保存しておくことをおすすめします（保存したファイルからは、主催者のページの「保存したファイルから復元」で新しい大会として作り直せます）。' }),
        el('div', { className: 'btn-row' }, [saveButton]),
        el('label', { className: 'check' }, [skipSave, ' 保存せずに削除する']),
        field('② 確認のため、大会名「' + ev.name + '」を入力', confirmName),
        el('div', { className: 'btn-row' }, [deleteButton]),
      ]);
    }

    /* ---------- 出力・印刷（F02・F03） ---------- */

    function scoreText(m) {
      if (m.status !== 'final' && m.status !== 'live') return '';
      if (m.resultType === 'walkover') return '不戦勝';
      var a = m.p1.sets !== null && m.p1.sets !== undefined ? m.p1.sets : m.p1.legs;
      var b = m.p2.sets !== null && m.p2.sets !== undefined ? m.p2.sets : m.p2.legs;
      return a === null || a === undefined ? '' : a + '-' + b;
    }

    function winnerName(m) {
      if (m.status !== 'final') return '';
      if (m.draw) return '引き分け';
      return m.winnerId === m.p1.id ? m.p1.name : m.winnerId === m.p2.id ? m.p2.name : '';
    }

    /** CSV（F02）。日本語名・カンマ・引用符・改行に対応し、数式として実行されないようにする。メール・メモ・理由は入れない */
    function csvFor(kind) {
      var d = state.detail;
      var rows;
      if (kind === 'players') {
        rows = [['名前', '所属', 'Rt', 'シード', '棄権・失格']].concat(d.players.map(function (p) {
          return [p.name, p.affiliation || '', p.rating || '', p.seed || '', p.withdrawn ? (p.withdrawn.kind === 'disqualified' ? '失格' : '棄権') : ''];
        }));
      } else if (kind === 'standings') {
        rows = [['段階', '組', '順位', '同順位', '選手', '勝ち点', '勝', '分', '敗', '得 Leg', '失 Leg', 'Buchholz']];
        var nameOf = {};
        d.players.forEach(function (p) {
          nameOf[p.id] = p.name;
        });
        d.stages.forEach(function (st) {
          var groups = st.type === 'series' ? [{ name: '累計', standings: st.standings }] : st.groups || [];
          groups.forEach(function (g) {
            g.standings.forEach(function (r) {
              rows.push([st.name, g.name, r.rank, r.tied ? '同' : '', nameOf[r.playerId] || '', r.points === undefined ? '' : r.points, r.won === undefined ? '' : r.won, r.drawn || 0, r.lost === undefined ? '' : r.lost, r.legsFor, r.legsAgainst, r.buchholz === undefined ? '' : r.buchholz]);
            });
          });
          if (st.champion) rows.push([st.name, '', 1, '', st.champion.name, '', '', '', '', '', '', '']);
        });
      } else {
        rows = [['段階', '組・節・回戦', '試合', '選手 1', '選手 2', '結果', '状態', '勝者', '特殊な結果', '日付', '時刻', '会場', 'ボード', '審判', '予定の状態']];
        allEventMatches(d).forEach(function (x) {
          var m = x.m;
          var sch = m.schedule || {};
          rows.push([x.st.name, x.sec.name, m.label || 'R' + m.round, m.p1.name || '', m.p2.name || '', scoreText(m), MATCH_STATUS_LABEL[m.status] || m.status, winnerName(m), m.resultType ? RESULT_TYPE_LABEL[m.resultType] : '', sch.date || '', sch.time || '', sch.venue || '', sch.board || '', sch.referee || '', sch.status ? SCHEDULE_STATUS_LABEL[sch.status] : '']);
        });
      }
      return global.TPAdminIO.toCsv(rows);
    }

    function printTable(title, heads, rows) {
      return el('table', { className: 'print-table' }, [
        el('thead', null, [el('tr', null, [el('th', { colspan: String(heads.length), className: 'print-table__title', text: title })]), el('tr', null, heads.map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
        el('tbody', null, rows.map(function (r) {
          return el('tr', null, r.map(function (c) { return el('td', { text: c === null || c === undefined ? '' : String(c) }); }));
        })),
      ]);
    }

    /** 印刷用の内容（F03）。大きな表は縮小せず、行の途中で切らずにページを分け、見出しの行を各ページに出す */
    function buildPrint(kind) {
      var d = state.detail;
      var nameOf = {};
      d.players.forEach(function (p) {
        nameOf[p.id] = p.name;
      });
      var root = el('div', { className: 'print-doc' }, [
        el('header', { className: 'print-head' }, [el('h1', { text: d.event.name }), el('p', { text: [d.event.dateLabel, { bracket: '対戦表', standings: '順位', schedule: '予定一覧' }[kind], '出力 ' + formatDateTime(new Date().toISOString())].filter(Boolean).join('・') })]),
      ]);
      if (kind === 'schedule') {
        var rows = allEventMatches(d)
          .filter(function (x) {
            return x.m.status !== 'void';
          })
          .sort(function (a, b) {
            var da = a.m.schedule && a.m.schedule.date ? a.m.schedule.date + ' ' + (a.m.schedule.time || '99:99') : '9999';
            var db = b.m.schedule && b.m.schedule.date ? b.m.schedule.date + ' ' + (b.m.schedule.time || '99:99') : '9999';
            return da < db ? -1 : da > db ? 1 : a.si - b.si || (a.m.round || 0) - (b.m.round || 0);
          })
          .map(function (x) {
            var sch = x.m.schedule || {};
            return [sch.date ? sch.date.replace(/-/g, '/') + (sch.time ? ' ' + sch.time : '') : sch.status === 'postponed' ? '日程未定' : '未定', x.st.name + '・' + x.sec.name, x.m.label || 'R' + x.m.round, (x.m.p1.name || '未定') + ' vs ' + (x.m.p2.name || (x.m.status === 'bye' ? '（不戦）' : '未定')), sch.board || '', sch.referee || '', PHASE_LABEL[matchPhase(x.m)] + (sch.status ? '・' + SCHEDULE_STATUS_LABEL[sch.status] : '')];
          });
        root.appendChild(printTable('予定一覧', ['日時', '段階・組', '試合', '対戦', 'ボード', '審判', '状態'], rows));
        return root;
      }
      d.stages.forEach(function (st) {
        root.appendChild(el('h2', { className: 'print-stage', text: st.name + '（' + (STAGE_TYPE_LABEL[st.type] || st.type) + '）' + (st.champion ? '　優勝: ' + st.champion.name : '') }));
        if (kind === 'standings') {
          var groups = st.type === 'series' ? [{ name: '累計順位', standings: st.standings }] : st.groups || [];
          if (!groups.length) root.appendChild(el('p', { text: st.champion ? '優勝: ' + st.champion.name + (st.runnerUp ? '・準優勝: ' + st.runnerUp.name : '') : '順位表のない段階です。' }));
          groups.forEach(function (g) {
            var pts = g.standings.some(function (r) {
              return r.points !== undefined;
            });
            root.appendChild(printTable(st.name + '・' + g.name, ['順位', '選手'].concat(pts ? ['勝ち点'] : []).concat(['勝-分-敗', 'Leg 得-失']), g.standings.map(function (r) {
              return [(r.tied ? '=' : '') + r.rank, nameOf[r.playerId] || ''].concat(pts ? [r.points] : []).concat([(r.won || 0) + '-' + (r.drawn || 0) + '-' + (r.lost || 0), r.legsFor + '-' + r.legsAgainst]);
            })));
          });
          return;
        }
        stageSections(st).forEach(function (sec) {
          root.appendChild(printTable(st.name + '・' + sec.name, ['試合', '選手 1', '結果', '選手 2', '勝者', '状態'], sec.matches.map(function (m) {
            return [m.label || 'R' + m.round, m.p1.name || '未定', scoreText(m), m.p2.name || (m.status === 'bye' ? '（不戦）' : '未定'), winnerName(m), (MATCH_STATUS_LABEL[m.status] || m.status) + (m.resultType && m.resultType !== 'bye' ? '・' + RESULT_TYPE_LABEL[m.resultType] : '')];
          })));
        });
        if (!stageSections(st).length) root.appendChild(el('p', { text: '組み合わせはまだありません。' }));
      });
      return root;
    }

    function printNow(kind, orientation) {
      var box = doc.getElementById('print-root');
      if (!box) {
        box = el('div', { id: 'print-root', className: 'print-root' });
        doc.body.appendChild(box);
      }
      box.textContent = '';
      box.appendChild(buildPrint(kind));
      var land = doc.getElementById('print-landscape');
      if (land) land.disabled = orientation !== 'landscape';
      doc.body.classList.add('is-printing');
      var done = function () {
        doc.body.classList.remove('is-printing');
        win.removeEventListener('afterprint', done);
      };
      win.addEventListener('afterprint', done);
      if (typeof win.print === 'function') win.print();
    }

    function renderOutput() {
      var d = state.detail;
      var ev = d.event;
      var day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      var csvButton = function (kind, label) {
        return el('button', { className: 'btn', type: 'button', text: label, onClick: function () { saveFile(new Blob([csvFor(kind)], { type: 'text/csv;charset=utf-8' }), 'n02-' + kind + '-' + ev.id + '-' + day + '.csv'); toast('ok', 'CSV を保存しました。'); } });
      };
      var orient = el('select', { className: 'input input--auto', id: 'print-orientation', 'aria-label': '用紙の向き' }, [el('option', { value: 'portrait', text: 'A4 縦' }), el('option', { value: 'landscape', text: 'A4 横' })]);
      var printButton = function (kind, label) {
        return el('button', { className: 'btn', type: 'button', text: label, onClick: function () { printNow(kind, orient.value); } });
      };
      var exportButton = el('button', { className: 'btn', type: 'button', text: '大会のデータを保存（JSON ファイル）' });
      exportButton.addEventListener('click', function () {
        exportButton.disabled = true;
        api
          .query('exportEvent', { eventId: ev.id })
          .then(function (data) {
            saveFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'n02-tournament-' + ev.id + '-' + day + '.json');
            toast('ok', '大会のデータをファイルに保存しました。');
          })
          .catch(handleError)
          .then(function () {
            exportButton.disabled = false;
          });
      });
      return el('div', { className: 'stack' }, [
        el('section', { className: 'panel' }, [
          el('h3', { text: 'CSV で保存' }),
          el('p', { className: 'muted small', text: 'Excel で開けます（UTF-8・BOM 付き）。選手一覧の CSV は「選手」タブの「CSV から登録」でそのまま読み込めます。メールアドレス・運営メモ・棄権や延期の理由は含めません。' }),
          el('div', { className: 'btn-row' }, [csvButton('players', '選手一覧'), csvButton('standings', '順位'), csvButton('matches', '対戦・結果・予定')]),
        ]),
        el('section', { className: 'panel' }, [
          el('h3', { text: '印刷' }),
          el('p', { className: 'muted small', text: 'ボタンやメニューは印刷しません。大きな表は縮小せずにページを分け、各ページに表の見出しを出します。印刷の画面で「PDF に保存」を選ぶと PDF にできます。' }),
          field('用紙', orient),
          el('div', { className: 'btn-row' }, [printButton('bracket', '対戦表を印刷'), printButton('standings', '順位を印刷'), printButton('schedule', '予定一覧を印刷')]),
        ]),
        ev.role !== 'staff'
          ? el('section', { className: 'panel' }, [
              el('h3', { text: 'データの保存' }),
              el('p', { className: 'muted small', text: '大会の全データを JSON ファイルに保存します（管理パスワード・共同主催者は含めません）。主催者のページの「保存したファイルから復元」で、新しい大会として作り直せます。' }),
              el('div', { className: 'btn-row' }, [exportButton]),
            ])
          : null,
      ]);
    }

    function renderHistory() {
      var d = state.detail;
      var panel = el('section', { className: 'panel' }, [el('h3', { text: '変更履歴（直近 ' + d.history.length + ' 件）' })]);
      if (!d.history.length) panel.appendChild(el('p', { className: 'muted', text: '履歴はありません。' }));
      var list = el('ol', { className: 'history' });
      d.history.forEach(function (h) {
        list.appendChild(el('li', null, [el('span', { className: 'muted small', text: formatDateTime(h.at) + '・' + h.actor }), el('span', { text: h.action + ' ' + h.entity + (h.entityId ? ' ' + h.entityId : '') })]));
      });
      panel.appendChild(list);
      return panel;
    }

    render();
    loadBoot();
    return { state: state };
  }

  global.TPAdmin = { checkResult: checkResult, checkFixed: checkFixed, createApi: createApi, legsToWin: legsToWin, parseHash: parseHash, eventUrl: eventUrl, decodeJwtPayload: decodeJwtPayload, createFetchRunner: createFetchRunner };

  if (global.document && global.TPOC_ADMIN_CONFIG) {
    var go = function () {
      var config = global.TPOC_ADMIN_CONFIG;
      if (!ENDPOINT_PATTERN.test(String(config.endpoint || ''))) {
        global.document.getElementById('app').textContent =
          '設定エラー: admin/config.js の endpoint に運営用 Web アプリの URL（https://script.google.com/macros/s/…/exec）を設定してください。';
        return;
      }
      global.__tpocAdmin = startApp(global.document, global, config);
    };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(typeof window !== 'undefined' ? window : this);
