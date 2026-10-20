/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament PoC - 運営画面（クライアント側） */
(function (global) {
  'use strict';

  var MATCH_STATUS_LABEL = { scheduled: '未開始', live: '進行中', final: '確定済み', check: '要確認', pending: '対戦待ち' };
  var STAGE_TYPE_LABEL = { round_robin: 'ロビン', league: 'リーグ', single_elimination: 'トーナメント' };
  var TEMPLATES = [
    { id: 'robin', label: 'ロビンのみ（グループ内の総当たり）' },
    { id: 'robin_ab', label: 'ロビン → A / B トーナメント（順位で振り分け）' },
    { id: 'elimination', label: 'トーナメントのみ（勝ち抜き）' },
    { id: 'league', label: 'リーグ（全員の総当たり・節ごと）' },
  ];
  var EVENT_STATUS_LABEL = { draft: '準備中', running: '開催中', finished: '終了' };
  var BEST_OF_CHOICES = [1, 3, 5, 7, 9, 11, 13];
  var TABS = [
    { id: 'progress', label: '進行状況' },
    { id: 'matches', label: '試合結果' },
    { id: 'players', label: '選手' },
    { id: 'format', label: '形式' },
    { id: 'pairing', label: '組み合わせ' },
    { id: 'settings', label: '大会設定' },
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

  /**
   * 対戦形式の入力欄（Leg 制 / セット制、Best of、1 セットの Best of、暫定ルール）。
   * 戻り値 { node, value() }。value() はサーバーの rule 入力形式
   */
  function ruleInputs(prefix, initial) {
    var format = el('select', { className: 'input', id: prefix + '-format' }, [
      el('option', { value: 'legs', text: 'Leg 制（Best of N Legs）', selected: initial.format !== 'sets' ? true : null }),
      el('option', { value: 'sets', text: 'セット制（Best of N セット）', selected: initial.format === 'sets' ? true : null }),
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
      BEST_OF_CHOICES.forEach(function (n) {
        bestOf.appendChild(el('option', { value: String(n), text: 'Best of ' + n + ' ' + unit + '（先に ' + legsToWin(n) + (format.value === 'sets' ? ' セット' : ' Leg') + '）', selected: n === current ? true : null }));
      });
      setField.hidden = format.value !== 'sets';
    };
    format.addEventListener('change', drawBestOf);
    drawBestOf();
    var node = el('div', { className: 'stack stack--tight' }, [
      el('label', { className: 'field', for: prefix + '-format' }, [el('span', { className: 'field__label', text: '対戦形式' }), format]),
      el('label', { className: 'field', for: prefix + '-bestof' }, [el('span', { className: 'field__label', text: '試合の長さ' }), bestOf]),
      setField,
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

  /* ---------- 運営用 URL（#e=…&k=…）と通信 ---------- */

  var EVENT_ID_PATTERN = /^EVT-[A-Z0-9]{4,32}$/;
  var EVENT_KEY_PATTERN = /^[a-f0-9]{48,64}$/;
  var ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

  /**
   * URL の # 以降を読む。# 以降はサーバー（GitHub Pages）にも送られず、リンク先への Referer にも含まれない。
   *   #e=EVT-…&k=…  … 主催者（その大会の運営用 URL）
   *   #admin        … 管理者
   */
  function parseHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (h === 'admin') return { mode: 'admin' };
    var out = {};
    h.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i > 0) out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
    });
    if (EVENT_ID_PATTERN.test(out.e || '') && EVENT_KEY_PATTERN.test(out.k || '')) return { mode: 'organizer', eventId: out.e, key: out.k };
    if (out.e || out.k) return { mode: 'invalid' };
    return { mode: 'create' };
  }

  function organizerUrl(loc, eventId, key) {
    return loc.origin + loc.pathname + '#e=' + encodeURIComponent(eventId) + '&k=' + encodeURIComponent(key);
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
      boot: null,
      eventId: '',
      detail: null,
      tab: 'progress',
      busy: false,
      matchFilter: 'all',
      statusFilter: 'open',
      editing: {},
      issued: null, // 直前に発行した運営用 URL { eventId, url, name }
      stageId: '', // 試合結果・組み合わせタブで選んでいる段階
      entrantDraft: {}, // トーナメントの出場者・シード順の編集中の並び（段階ごと）
    };
    try {
      state.adminKey = win.sessionStorage.getItem('tpoc-admin-key') || '';
    } catch (e) {
      state.adminKey = '';
    }

    function currentAuth() {
      if (state.route.mode === 'organizer') return { eventId: state.route.eventId, key: state.route.key };
      if (state.route.mode === 'admin' && state.adminKey) return { adminKey: state.adminKey };
      return undefined;
    }
    var api = createApi(createFetchRunner(win, config.endpoint, currentAuth));

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

    function handleError(err) {
      if (err && (err.code === 'AUTH_INVALID' || err.code === 'AUTH_REQUIRED')) {
        if (state.route.mode === 'admin') {
          state.adminKey = '';
          try {
            win.sessionStorage.removeItem('tpoc-admin-key');
          } catch (e) {
            /* 保存できない環境では何もしない */
          }
        }
        state.authError = err.message;
        state.boot = null;
        render();
        return;
      }
      toast('error', (err && err.message) || 'エラーが発生しました。');
      if (err && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND' || err.code === 'ALREADY_FINAL') && state.eventId) {
        loadDetail(state.eventId);
      }
    }

    /** 書き込み操作の共通処理。実行中は他の書き込みボタンを押せなくする。 */
    function mutate(action, payload, okMessage) {
      if (state.busy) return Promise.resolve(null);
      setBusy(true);
      return api
        .mutate(action, payload)
        .then(function (data) {
          if (data && data.adminKey) rememberIssued(data);
          if (data && data.duplicate) {
            if (data.adminKey) {
              render();
              return data;
            }
            if (state.eventId) return loadDetail(state.eventId);
            return loadBoot();
          }
          if (data && data.detail) {
            state.detail = data.detail;
            state.eventId = data.detail.event.id;
          }
          if (data && data.storage) state.boot = data;
          if (okMessage) toast('ok', typeof okMessage === 'function' ? okMessage(data) : okMessage);
          render();
          return data;
        })
        .catch(handleError)
        .then(function (data) {
          setBusy(false);
          return data;
        });
    }

    /** 大会作成・再発行で受け取った鍵から運営用 URL を作る。主催者本人の画面なら、以後の通信も新しい鍵に切り替える */
    function rememberIssued(data) {
      var url = organizerUrl(win.location, data.eventId, data.adminKey);
      state.issued = { eventId: data.eventId, url: url, name: data.detail ? data.detail.event.name : '' };
      if (state.route.mode === 'organizer' && state.route.eventId === data.eventId) {
        state.route = { mode: 'organizer', eventId: data.eventId, key: data.adminKey };
        win.history.replaceState(null, '', url);
      }
    }

    function loadBoot() {
      if (state.route.mode === 'admin' && !state.adminKey) {
        render();
        return Promise.resolve();
      }
      return api
        .query('bootstrap')
        .then(function (data) {
          state.boot = data;
          state.authError = '';
          if (state.route.mode === 'organizer') {
            state.eventId = state.route.eventId;
            return loadDetail(state.route.eventId);
          }
          render();
        })
        .catch(function (err) {
          if (err && (err.code === 'AUTH_INVALID' || err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_NOT_CONFIGURED')) return handleError(err);
          root.textContent = '';
          root.appendChild(el('p', { className: 'panel error', text: (err && err.message) || '読み込みに失敗しました。' }));
          root.appendChild(el('button', { className: 'btn', type: 'button', text: '再読み込み', onClick: loadBoot }));
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

    function openEvent(eventId) {
      state.tab = 'progress';
      state.detail = null;
      state.eventId = eventId;
      render();
      loadDetail(eventId);
    }

    function goHome() {
      state.eventId = '';
      state.detail = null;
      render();
      loadBoot();
    }

    function goTo(hash) {
      win.location.hash = hash;
    }

    win.addEventListener('hashchange', function () {
      state.route = parseHash(win.location.hash);
      state.boot = null;
      state.detail = null;
      state.eventId = '';
      state.issued = null;
      state.authError = '';
      render();
      loadBoot();
    });

    /* ---------- 描画 ---------- */

    function render() {
      root.textContent = '';
      var who = doc.getElementById('actor');
      if (who) who.textContent = { admin: '管理者', organizer: '主催者', create: '', invalid: '' }[state.route.mode] || '';
      if (state.issued) {
        root.appendChild(renderIssued());
        setBusy(state.busy);
        return;
      }
      if (state.route.mode === 'invalid') {
        root.appendChild(renderMessage('運営用 URL が正しくありません', 'URL が途中で切れていないか確認してください。最後までコピーした URL を開き直してください。'));
        return;
      }
      if (state.authError) {
        if (state.route.mode === 'admin') {
          root.appendChild(renderAdminLogin(state.authError));
          return;
        }
        root.appendChild(renderMessage('この運営用 URL は使えません', state.authError + ' 紛失・再発行の場合は管理者に連絡してください。'));
        return;
      }
      if (state.route.mode === 'admin' && !state.adminKey) {
        root.appendChild(renderAdminLogin(''));
        return;
      }
      if (!state.boot) {
        root.appendChild(el('p', { className: 'panel', text: '読み込み中…' }));
        return;
      }
      var s = state.boot.storage;
      if (!s.configured || !s.accessible || !s.initialized) {
        root.appendChild(state.boot.role.isPlatformAdmin ? renderSetup(s) : renderMessage('準備中です', s.message || '管理者の設定が終わるまでお待ちください。'));
        return;
      }
      if (state.eventId) root.appendChild(renderEvent());
      else if (state.route.mode === 'admin') root.appendChild(renderAdminHome());
      else if (state.route.mode === 'organizer') root.appendChild(el('p', { className: 'panel', text: '読み込み中…' }));
      else root.appendChild(renderCreate());
      setBusy(state.busy);
    }

    function renderMessage(title, text) {
      return el('section', { className: 'panel' }, [
        el('h2', { text: title }),
        el('p', { text: text }),
        el('p', null, [el('a', { href: '#', text: '新しい大会を作る' })]),
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
            try {
              win.sessionStorage.setItem('tpoc-admin-key', state.adminKey);
            } catch (err) {
              /* 保存できない環境では、このページを開いている間だけ有効 */
            }
            state.authError = '';
            render();
            loadBoot();
          },
        }, [el('label', { className: 'visually-hidden', for: 'admin-key', text: '管理者の鍵' }), input, el('button', { className: 'btn btn--primary', type: 'submit', text: '開く' })]),
      ]);
    }

    /** 運営用 URL の表示（大会作成・再発行の直後に 1 回だけ） */
    function renderIssued() {
      var issued = state.issued;
      var box = el('code', { className: 'issued__url', id: 'issued-url', text: issued.url });
      var saved = el('input', { type: 'checkbox', id: 'issued-saved' });
      var go = el('button', { className: 'btn btn--primary', type: 'button', text: 'この大会の運営画面を開く', disabled: true });
      saved.addEventListener('change', function () {
        go.disabled = !saved.checked;
      });
      go.addEventListener('click', function () {
        state.issued = null;
        if (win.location.href === issued.url) {
          render();
        } else {
          win.location.href = issued.url;
        }
      });
      var copy = el('button', { className: 'btn', type: 'button', text: 'URL をコピー' });
      copy.addEventListener('click', function () {
        var done = function () {
          copy.textContent = 'コピーしました';
        };
        try {
          win.navigator.clipboard.writeText(issued.url).then(done, function () {
            selectText(box);
          });
        } catch (e) {
          selectText(box);
        }
      });
      var back = state.route.mode === 'admin'
        ? el('button', { className: 'btn btn--ghost', type: 'button', text: '大会一覧に戻る', onClick: function () { state.issued = null; render(); } })
        : null;
      return el('section', { className: 'panel issued' }, [
        el('h2', { text: '運営用 URL' + (issued.name ? '（' + issued.name + '）' : '') }),
        el('p', { className: 'issued__warn', text: 'この URL を知っている人は、誰でもこの大会を運営（結果の入力・変更）できます。他人に教えないでください。この画面を閉じると、同じ URL は二度と表示されません。' }),
        box,
        el('div', { className: 'btn-row' }, [copy]),
        el('label', { className: 'check' }, [saved, ' URL をブックマーク、またはメモに保存しました']),
        el('div', { className: 'btn-row' }, [go, back]),
        el('p', { className: 'muted small', text: '紛失した場合は、管理者に再発行を依頼してください（再発行すると古い URL は使えなくなります）。' }),
      ]);
    }

    function selectText(node) {
      var r = doc.createRange();
      r.selectNodeContents(node);
      var s = win.getSelection();
      s.removeAllRanges();
      s.addRange(r);
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

    /** 大会作成フォーム（誰でも。作成コードが必要な設定なら入力欄を出す） */
    function createForms() {
      var boot = state.boot;
      var wrap = el('div', { className: 'stack' });
      var needCode = boot.createCodeRequired && !boot.role.isPlatformAdmin;
      var name = el('input', { className: 'input', id: 'new-name', required: true, maxlength: 80 });
      var date = el('input', { className: 'input', id: 'new-date', maxlength: 40, placeholder: '例: 2026/11/03' });
      var organizer = el('input', { className: 'input', id: 'new-organizer', maxlength: 40, placeholder: '例: 〇〇ダーツ部（任意・非公開）' });
      var template = el('select', { className: 'input', id: 'new-template' }, TEMPLATES.map(function (t) {
        return el('option', { value: t.id, text: t.label });
      }));
      var rule = ruleInputs('new', { format: 'legs', bestOf: 5, setBestOf: 5, provisional: true });
      var groupCount = el('input', { className: 'input input--short', id: 'new-groups', type: 'number', min: 1, max: 16, value: '4', inputmode: 'numeric' });
      var advanceCount = el('input', { className: 'input input--short', id: 'new-advance', type: 'number', min: 1, max: 16, value: '2', inputmode: 'numeric' });
      var thirdPlace = el('input', { type: 'checkbox', id: 'new-third' });
      var cycles = el('select', { className: 'input input--short', id: 'new-cycles' }, [el('option', { value: '1', text: '1 回' }), el('option', { value: '2', text: '2 回' })]);
      var code = needCode ? el('input', { className: 'input', id: 'new-code', type: 'password', autocomplete: 'off', required: true }) : null;
      var groupField = field('ロビンのグループ数', groupCount);
      var advanceField = field('A トーナメントへ進む順位（各組の上位何位まで。残りは B へ）', advanceCount);
      var thirdField = el('label', { className: 'check' }, [thirdPlace, ' トーナメントに 3 位決定戦を入れる']);
      var cyclesField = field('総当たりの回数', cycles);
      var syncTemplate = function () {
        var t = template.value;
        groupField.hidden = !(t === 'robin' || t === 'robin_ab');
        advanceField.hidden = t !== 'robin_ab';
        thirdField.hidden = !(t === 'robin_ab' || t === 'elimination');
        cyclesField.hidden = t === 'elimination';
      };
      template.addEventListener('change', syncTemplate);
      syncTemplate();
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '大会を作成' }),
          el('form', {
            className: 'form',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('createEvent', {
                name: name.value,
                dateLabel: date.value,
                organizerName: organizer.value,
                template: template.value,
                rule: rule.value(),
                groupCount: Number(groupCount.value),
                advanceCount: Number(advanceCount.value),
                thirdPlace: thirdPlace.checked,
                cycles: Number(cycles.value),
                createCode: code ? code.value : undefined,
              }, '大会を作成しました。');
            },
          }, [
            field('大会名', name),
            field('開催日（表示用の文字列）', date),
            field('主催者名（任意。管理者だけが見ます）', organizer),
            field('大会の形式（作成後に「形式」タブで段階の追加・変更ができます）', template),
            rule.node,
            groupField,
            advanceField,
            thirdField,
            cyclesField,
            code ? field('作成コード（管理者から教えてもらったもの）', code) : null,
            el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '作成して運営用 URL を発行' }),
          ]),
        ])
      );
      var publishSample = el('input', { type: 'checkbox', id: 'sample-publish' });
      var sampleCode = needCode ? el('input', { className: 'input', id: 'sample-code', type: 'password', autocomplete: 'off' }) : null;
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '検証用サンプル' }),
          el('p', { className: 'muted', text: '16 名（サンプル選手01〜16）・4 人 × 4 グループのロビン、Best of 5 Legs（暫定）。確定・進行中・未開始の試合を含みます。' }),
          el('label', { className: 'check' }, [publishSample, ' 作成後すぐ閲覧画面に公開する']),
          sampleCode ? field('作成コード', sampleCode) : null,
          el('button', {
            className: 'btn',
            type: 'button',
            'data-mut': true,
            text: 'サンプル大会を作成',
            onClick: function () {
              mutate('createSampleEvent', { publish: publishSample.checked, createCode: sampleCode ? sampleCode.value : undefined }, 'サンプル大会を作成しました。');
            },
          }),
        ])
      );
      return wrap;
    }

    function renderCreate() {
      var wrap = createForms();
      wrap.insertBefore(
        el('section', { className: 'panel' }, [
          el('h2', { text: '大会を主催する' }),
          el('p', { text: '大会を作成すると、その大会専用の「運営用 URL」が発行されます。運営（選手登録・組み合わせ・結果入力・公開）は、その URL から行います。ログインは不要です。' }),
          el('p', { className: 'muted small', text: 'すでに大会を作成済みの場合は、発行された運営用 URL を開いてください。' }),
        ]),
        wrap.firstChild
      );
      return wrap;
    }

    function renderAdminHome() {
      var boot = state.boot;
      var wrap = el('div', { className: 'stack' });
      var list = el('section', { className: 'panel' }, [el('h2', { text: 'すべての大会（管理者）' })]);
      if (!boot.events.length) list.appendChild(el('p', { className: 'muted', text: 'まだ大会がありません。' }));
      boot.events.forEach(function (ev) {
        list.appendChild(
          el('article', { className: 'event-card' }, [
            el('div', { className: 'event-card__main' }, [
              el('h3', { text: ev.name }),
              el('p', { className: 'muted', text: [ev.dateLabel, EVENT_STATUS_LABEL[ev.status] || ev.status, ev.organizerName ? '主催: ' + ev.organizerName : '', '選手 ' + ev.playerCount + ' 名', '確定 ' + ev.finalCount + ' / ' + ev.matchCount + ' 試合'].filter(Boolean).join('・') }),
              el('p', null, [
                el('span', { className: 'badge ' + (ev.isPublic ? 'badge--on' : ''), text: ev.isPublic ? '公開中' : '非公開' }),
                ev.isFeatured ? el('span', { className: 'badge badge--on', text: '既定表示' }) : null,
                ev.isSample ? el('span', { className: 'badge', text: 'サンプル' }) : null,
                ev.hasKey ? null : el('span', { className: 'badge', text: '運営用 URL 未発行' }),
              ]),
            ]),
            el('button', { className: 'btn', type: 'button', text: '開く', onClick: function () { openEvent(ev.id); } }),
          ])
        );
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
          state.route.mode === 'admin' ? el('button', { className: 'btn btn--ghost', type: 'button', text: '← 大会一覧', onClick: goHome }) : null,
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
        players: renderPlayers,
        format: renderFormat,
        pairing: renderPairing,
        settings: renderSettings,
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

    function stageMatches(st) {
      if (st.groups) {
        return st.groups.reduce(function (all, g) {
          return all.concat(g.matches);
        }, []);
      }
      return (st.rounds || []).reduce(function (all, r) {
        return all.concat(r.matches);
      }, []);
    }

    function stageStatusText(st) {
      if (st.type === 'single_elimination') {
        if (st.champion) return '優勝: ' + st.champion.name;
        if (!st.progress.total) return st.entries.length ? '出場 ' + st.entries.length + ' 名・トーナメント表は未作成' : '出場者未定';
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
      var viewerUrl = state.boot && state.boot.viewerUrl;
      if (viewerUrl && d.publication.published) {
        var href = viewerUrl + '?event=' + encodeURIComponent(d.event.id);
        pub.appendChild(el('p', null, [el('a', { href: href, target: '_blank', rel: 'noopener', text: '閲覧画面を開く' })]));
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
      var sections = st.groups
        ? st.groups.map(function (g) {
            return { id: g.id, name: g.name, matches: g.matches };
          })
        : (st.rounds || []).map(function (r) {
            return { id: 'r' + r.round, name: r.label, matches: r.matches };
          });
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
          if (state.statusFilter === 'open') return m.status !== 'final' || state.editing[m.id];
          if (state.statusFilter === 'final') return m.status === 'final';
          return true;
        });
        if (!ms.length) return;
        any = true;
        wrap.appendChild(el('section', { className: 'panel' }, [el('h3', { text: sec.name })].concat(ms.map(function (m) { return renderMatchEditor(m); }))));
      });
      if (!any) {
        var empty = stageMatches(st).length ? '該当する試合はありません。' : st.type === 'single_elimination' ? 'トーナメント表がありません。「組み合わせ」タブで作成してください。' : '対戦カードがありません。「組み合わせ」タブで作成してください。';
        wrap.appendChild(el('p', { className: 'panel muted', text: empty }));
      }
      return wrap;
    }

    function numberInput(value, max, label, allowBlank) {
      return el('input', {
        className: 'legs-input',
        type: 'number',
        inputmode: 'numeric',
        min: 0,
        max: max,
        value: value === null || value === undefined ? (allowBlank ? '' : '0') : String(value),
        'aria-label': label,
      });
    }

    function renderMatchEditor(m) {
      var editing = !!state.editing[m.id];
      var locked = m.storedStatus === 'final' && !editing;
      var spec = m.spec || { format: 'legs', bestOf: m.bestOf };
      var sets = spec.format === 'sets';
      var meta = el('div', { className: 'match-editor__meta' }, [
        el('span', { text: (m.label || 'R' + m.round) + '・Best of ' + spec.bestOf + (sets ? ' セット（各セット Best of ' + spec.setBestOf + ' Legs）' : ' Legs') }),
        el('span', { className: 'status status--' + m.status, text: MATCH_STATUS_LABEL[m.status] }),
      ]);
      if (m.status === 'pending') {
        return el('article', { className: 'match-editor match-editor--pending', 'data-match-id': m.id }, [
          meta,
          el('p', { className: 'muted', text: (m.p1.name || '（前の試合の勝者）') + ' vs ' + (m.p2.name || '（前の試合の勝者）') + '　対戦相手が決まると入力できます。' }),
        ]);
      }
      var need = legsToWin(spec.bestOf);
      var p1 = sets ? numberInput(m.storedP1Sets, need, m.p1.name + ' の取得セット', false) : numberInput(m.storedP1Legs, need, m.p1.name + ' の取得 Leg', false);
      var p2 = sets ? numberInput(m.storedP2Sets, need, m.p2.name + ' の取得セット', false) : numberInput(m.storedP2Legs, need, m.p2.name + ' の取得 Leg', false);
      var l1 = sets ? numberInput(m.storedP1Legs, 99, m.p1.name + ' の取得 Leg（合計・任意）', true) : null;
      var l2 = sets ? numberInput(m.storedP2Legs, 99, m.p2.name + ' の取得 Leg（合計・任意）', true) : null;
      [p1, p2, l1, l2].forEach(function (x) {
        if (x) x.disabled = locked;
      });
      if (l1) l1.className = l2.className = 'legs-input legs-input--small';
      var msg = el('p', { className: 'match-editor__msg', role: 'status' });

      function send(status) {
        if (!sets) {
          var problem = checkResult(status, p1.value.trim(), p2.value.trim(), spec.bestOf);
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
        if (editing) buttons.push(el('button', { className: 'btn btn--ghost', type: 'button', text: 'キャンセル', onClick: function () { delete state.editing[m.id]; render(); } }));
      }
      var winner = m.status === 'final' ? (m.winnerId === m.p1.id ? m.p1.name : m.p2.name) : '';
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
        winner ? el('p', { className: 'match-editor__winner', text: '勝者: ' + winner + (m.confirmedAt ? '（確定 ' + formatDateTime(m.confirmedAt) + '）' : '') }) : null,
        m.problems && m.problems.length ? el('p', { className: 'error small', text: '要確認: ' + m.problems.join(' / ') }) : null,
        msg,
        el('div', { className: 'btn-row' }, buttons),
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
      var groupName = {};
      d.groups.forEach(function (g) {
        groupName[g.id] = g.name;
      });
      var list = el('section', { className: 'panel' }, [el('h3', { text: '登録選手（' + d.players.length + ' 名）' })]);
      d.players.forEach(function (p) {
        var input = el('input', { className: 'input', value: p.name, maxlength: 40, 'aria-label': '選手名' });
        list.appendChild(
          el('div', { className: 'player-row', 'data-player-id': p.id }, [
            input,
            el('span', { className: 'muted small', text: (groupName[p.groupId] || '未割当') + (p.matchCount ? '・' + p.matchCount + ' 試合' : '') }),
            el('div', { className: 'btn-row' }, [
              el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '名前を保存', onClick: function () { mutate('updatePlayer', { playerId: p.id, rev: p.rev, name: input.value }, '保存しました。'); } }),
              confirmButton('削除', '本当に削除', function () { mutate('deletePlayer', { playerId: p.id, rev: p.rev }, '削除しました。'); }),
            ]),
          ])
        );
      });
      wrap.appendChild(list);
      return wrap;
    }

    /* ---------- 形式（段階の設定） ---------- */

    function renderFormat() {
      var d = state.detail;
      var wrap = el('div', { className: 'stack' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: '大会の形式' }),
          el('p', { className: 'muted small', text: '大会は「段階」を上から順に進めます。ロビン・リーグの順位で次の段階（トーナメント・リーグ）へ進出させるには、進出ルールを設定し、「組み合わせ」タブで進出を確定します。' }),
        ])
      );
      d.stages.forEach(function (st, i) {
        wrap.appendChild(renderStageEditor(st, i));
      });
      var type = el('select', { className: 'input', id: 'add-stage-type' }, Object.keys(STAGE_TYPE_LABEL).map(function (k) {
        return el('option', { value: k, text: STAGE_TYPE_LABEL[k] });
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
      var group = st.type !== 'single_elimination';
      var cfg = st.config;
      var name = el('input', { className: 'input', value: st.name, maxlength: 40, 'aria-label': '段階の名前' });
      var rule = ruleInputs('stage-' + st.id, { format: st.rule.format, bestOf: st.rule.bestOf, setBestOf: st.rule.setBestOf || 5, provisional: st.ruleProvisional });
      var parts = [
        el('div', { className: 'stage-head' }, [
          el('span', { className: 'badge badge--on', text: index + 1 + '. ' + STAGE_TYPE_LABEL[st.type] }),
          st.hasResults ? el('span', { className: 'badge', text: '結果あり' }) : null,
          cfg.advanced ? el('span', { className: 'badge', text: '進出確定済み' }) : null,
        ]),
        field('段階の名前', name),
        rule.node,
      ];
      var collect = {};
      if (group) {
        var cycles = el('select', { className: 'input input--short', 'aria-label': '総当たりの回数' }, [1, 2].map(function (n) {
          return el('option', { value: String(n), text: n + ' 回', selected: cfg.cycles === n ? true : null });
        }));
        parts.push(field('総当たりの回数（対戦カード作成後は変更不可）', cycles));
        var tb = tiebreakEditor(cfg.tiebreakers, cfg.advanced);
        parts.push(tb.node);
        var adv = advancementEditor(st, cfg.advancement, cfg.advanced);
        parts.push(adv.node);
        var labels = el('textarea', {
          className: 'input',
          rows: 3,
          'aria-label': 'ラウンドの表示名',
          placeholder: st.type === 'league' ? '例: 1: 第1節 11/3' : '例: 1: 1 巡目',
          value: Object.keys(cfg.roundLabels)
            .map(function (k) {
              return k + ': ' + cfg.roundLabels[k];
            })
            .join('\n'),
        });
        parts.push(field('ラウンドの表示名（1 行に「番号: 表示名」。空欄なら ' + (st.type === 'league' ? '「第n節」' : '「Rn」') + '）', labels));
        collect = function () {
          var out = { cycles: Number(cycles.value), roundLabels: parseLabels(labels.value) };
          if (!cfg.advanced) {
            out.tiebreakers = tb.value();
            out.advancement = adv.value();
          }
          return out;
        };
      } else {
        var third = el('input', { type: 'checkbox', checked: cfg.thirdPlace });
        parts.push(el('label', { className: 'check' }, [third, ' 3 位決定戦を行う（トーナメント表の作成後は変更不可）']));
        var rounds = eliminationRounds(st);
        var roundSelects = rounds.map(function (r) {
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
        collect = function () {
          var map = {};
          roundSelects.forEach(function (x) {
            if (x.sel.value) map[x.round] = Number(x.sel.value);
          });
          return { thirdPlace: third.checked, roundBestOf: map };
        };
      }
      parts.push(
        el('div', { className: 'btn-row' }, [
          el('button', {
            className: 'btn btn--primary',
            type: 'button',
            'data-mut': true,
            text: 'この段階を保存',
            onClick: function () {
              var payload = Object.assign({ stageId: st.id, rev: st.rev, name: name.value, rule: rule.value() }, collect());
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
    function tiebreakEditor(initial, locked) {
      var labels = state.detail.tiebreakerLabels;
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
        return x.order > st.order && x.type !== 'round_robin';
      });
      var rows = initial.map(function (r) {
        return { fromRank: r.fromRank, toRank: r.toRank, targetStageId: r.targetStageId };
      });
      var box = el('div', { className: 'stack stack--tight' });
      var draw = function () {
        box.textContent = '';
        box.appendChild(el('span', { className: 'field__label', text: '進出ルール（各グループの順位 → 次の段階）' }));
        if (!targets.length) {
          box.appendChild(el('p', { className: 'muted small', text: '進出先にできる段階（この段階より後のトーナメント・リーグ）がありません。下の「段階を追加」で追加できます。' }));
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
      if (st.type === 'single_elimination') renderEliminationPairing(st, wrap);
      else renderGroupPairing(st, wrap);
      return wrap;
    }

    function renderGroupPairing(st, wrap) {
      var d = state.detail;
      var league = st.type === 'league';
      var hasMatches = st.matchCount > 0;
      var locked = st.config.advanced;
      var tools = [];
      if (!league) {
        var count = el('input', { className: 'input input--short', type: 'number', min: 1, max: 16, value: String(st.groups.length), inputmode: 'numeric', 'aria-label': 'グループ数' });
        tools.push(el('span', { text: 'グループ数' }), count, el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': hasMatches ? '1' : null, text: '変更', onClick: function () { mutate('setGroupCount', { eventId: d.event.id, stageId: st.id, count: Number(count.value) }, 'グループ数を変更しました。'); } }));
      }
      tools.push(
        el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': hasMatches ? '1' : null, text: league ? '登録選手を全員参加させる' : '登録順に自動割当', onClick: function () { mutate('autoAssign', { eventId: d.event.id, stageId: st.id }, '割り当てました。'); } }),
        el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: league ? '対戦カードを作成' : '全グループの対戦カードを作成', onClick: function () { mutate('generateMatches', { eventId: d.event.id, stageId: st.id }, function (r) { return r.created + ' 試合を作成しました。' + (r.skipped && r.skipped.length ? '（対象外: ' + r.skipped.join('、') + '）' : ''); }); } })
      );
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: st.name + '（' + STAGE_TYPE_LABEL[st.type] + (st.cycles === 2 ? '・2 回総当たり' : '') + '）' }),
          el('div', { className: 'row' }, tools),
          hasMatches ? el('p', { className: 'muted small', text: '対戦カード作成後は、グループ数の変更・自動割当はできません（カードを削除すると再びできます）。' }) : null,
          st.feeds.length ? el('p', { className: 'muted small', text: 'この段階には、前の段階から進出者が入ります（進出の確定時に自動で登録されます）。' }) : null,
        ])
      );

      // 選手の割り当て
      var groupOf = {};
      st.entries.forEach(function (e) {
        groupOf[e.playerId] = e.groupId;
      });
      var options = [{ id: '', name: league ? '不参加' : '未割当' }].concat(st.groups);
      var assign = el('section', { className: 'panel' }, [el('h3', { text: league ? '参加する選手' : '選手の割り当て' })]);
      d.players.forEach(function (p) {
        var sel = el('select', { className: 'input', 'aria-label': p.name + ' のグループ', 'data-mut': true, 'data-locked': locked ? '1' : null }, options.map(function (g) {
          return el('option', { value: g.id, text: g.name, selected: g.id === (groupOf[p.id] || '') ? true : null });
        }));
        sel.addEventListener('change', function () {
          mutate('assignPlayer', { eventId: d.event.id, stageId: st.id, playerId: p.id, groupId: sel.value }, '割り当てを変更しました。');
        });
        assign.appendChild(el('div', { className: 'player-row' }, [el('span', { text: p.name }), sel]));
      });
      if (!d.players.length) assign.appendChild(el('p', { className: 'muted', text: '選手が登録されていません。' }));
      wrap.appendChild(assign);

      st.groups.forEach(function (g) {
        wrap.appendChild(renderGroupCard(st, g));
      });

      // 進出
      if (st.config.advancement.length) {
        var targetName = function (id) {
          var t = d.stages.filter(function (x) {
            return x.id === id;
          })[0];
          return t ? t.name : '（不明）';
        };
        var allFinal = st.progress.total > 0 && st.progress.final === st.progress.total;
        wrap.appendChild(
          el('section', { className: 'panel' }, [
            el('h3', { text: '次の段階への進出' }),
            el('ul', { className: 'plain-list' }, st.config.advancement.map(function (r) {
              return el('li', { text: '各グループ ' + r.fromRank + '位〜' + (r.toRank >= 99 ? '最下位' : r.toRank + '位') + ' → ' + targetName(r.targetStageId) });
            })),
            locked
              ? el('p', { text: '進出確定済み（' + formatDateTime(st.config.advancedAt) + '）。進出先の出場者に登録されています。' })
              : el('p', { className: 'muted small', text: allFinal ? 'すべての試合が確定しています。順位を確認して進出を確定してください。' : 'すべての試合が確定すると進出を確定できます。' }),
            el('div', { className: 'btn-row' }, [
              locked
                ? confirmButton('進出を取り消す', '本当に取り消す', function () {
                    mutate('undoAdvancement', { eventId: d.event.id, stageId: st.id }, '進出を取り消しました。');
                  })
                : el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': allFinal ? null : '1', text: '順位を確定して進出させる', onClick: function () { mutate('confirmAdvancement', { eventId: d.event.id, stageId: st.id }, function (r) { return r.advanced + ' 名が進出しました。'; }); } }),
            ]),
          ])
        );
      }
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
      var table = el('div', { className: 'table-wrap' }, [
        el('table', { className: 'table' }, [
          el('thead', null, [el('tr', null, ['順位', '選手', '勝-敗', 'Leg 得-失'].concat(sets ? ['セット 得-失'] : []).map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
          el('tbody', null, g.standings.map(function (r) {
            return el('tr', null, [
              el('td', { text: (r.tied ? '=' : '') + r.rank }),
              el('th', { scope: 'row', text: nameOf[r.playerId] || '' }),
              el('td', { text: r.won + '-' + r.lost }),
              el('td', { text: r.legsFor + '-' + r.legsAgainst }),
            ].concat(sets ? [el('td', { text: r.setsFor + '-' + r.setsAgainst })] : []));
          })),
        ]),
      ]);
      var parts = [
        el('div', { className: 'row' }, [name, el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '名前を保存', onClick: function () { mutate('renameGroup', { groupId: g.id, rev: g.rev, name: name.value }, '保存しました。'); } })]),
        g.players.length ? table : el('p', { className: 'muted', text: '選手がいません。' }),
        el('p', { className: 'muted small', text: (g.complete ? '全試合確定。' : '確定した試合だけで数えた暫定順位です。') + '「=」は同順位。対戦カード: ' + g.progress.total + ' 試合' }),
      ];
      if ((anyTied || manualSet) && !st.config.advanced) parts.push(manualOrderEditor(st, g, nameOf));
      parts.push(
        el('div', { className: 'btn-row' }, [
          el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': g.progress.total > 0 ? '1' : null, text: '対戦カードを作成', onClick: function () { mutate('generateMatches', { eventId: d.event.id, stageId: st.id, groupId: g.id }, function (r) { return r.created + ' 試合を作成しました。'; }); } }),
          g.progress.total > 0 ? confirmButton('対戦カードを削除', '本当に削除', function () { mutate('clearMatches', { eventId: d.event.id, groupId: g.id }, '対戦カードを削除しました。'); }) : null,
        ])
      );
      return el('section', { className: 'panel' }, [el('div', { className: 'stack' }, parts)]);
    }

    /** 同順位の選手の並びを手で決める（↑↓で並べて保存） */
    function manualOrderEditor(st, g, nameOf) {
      var d = state.detail;
      var order = g.standings.map(function (r) {
        return r.playerId;
      });
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
            el('button', { className: 'btn', type: 'button', 'data-mut': true, text: 'この順番で決める', onClick: function () { mutate('setManualOrder', { eventId: d.event.id, stageId: st.id, groupId: g.id, playerIds: order }, '順位を決めました。'); } }),
            el('button', { className: 'btn btn--ghost', type: 'button', 'data-mut': true, text: '手動の順位を解除', onClick: function () { mutate('setManualOrder', { eventId: d.event.id, stageId: st.id, groupId: g.id, playerIds: [] }, '解除しました。'); } }),
          ])
        );
      };
      draw();
      return box;
    }

    function renderEliminationPairing(st, wrap) {
      var d = state.detail;
      var hasBracket = st.matchCount > 0;
      var nameOf = {};
      d.players.forEach(function (p) {
        nameOf[p.id] = p.name;
      });
      var sourceOf = {};
      st.entries.forEach(function (e) {
        sourceOf[e.playerId] = e.source;
      });
      if (!state.entrantDraft[st.id]) {
        state.entrantDraft[st.id] = st.entries.map(function (e) {
          return e.playerId;
        });
      }
      var draft = state.entrantDraft[st.id];
      var saved = st.entries.map(function (e) {
        return e.playerId;
      });
      var dirty = draft.join(',') !== saved.join(',');
      var head = el('section', { className: 'panel' }, [
        el('h3', { text: st.name + '（トーナメント' + (st.config.thirdPlace ? '・3 位決定戦あり' : '') + '）' }),
        st.feeds.length ? el('p', { className: 'muted small', text: 'この段階には、前の段階の順位から進出者が自動で入ります（シード順は 各組 1 位 → 2 位 … の順）。必要なら下で並べ替えてから保存してください。' }) : null,
        el('p', { className: 'muted small', text: '上から順にシード 1, 2, 3 … です。1 位と 2 位が決勝まで当たらない標準の配置で、人数が 2 のべき乗に満たない分は上位シードが不戦勝（次の回戦から出場）になります。' }),
      ]);
      wrap.appendChild(head);

      var list = el('section', { className: 'panel' }, [el('h3', { text: '出場者とシード（' + draft.length + ' 名）' })]);
      draft.forEach(function (pid, i) {
        list.appendChild(
          el('div', { className: 'row row--tight seed-row' }, [
            el('span', { className: 'seed-no', text: String(i + 1) }),
            el('span', { className: 'tb-item', text: (nameOf[pid] || '（不明）') + (sourceOf[pid] ? '（' + sourceOf[pid] + '）' : '') }),
            el('button', { className: 'btn btn--small', type: 'button', text: '↑', 'aria-label': (nameOf[pid] || '') + ' を上へ', disabled: hasBracket || i === 0, onClick: function () { draft.splice(i - 1, 0, draft.splice(i, 1)[0]); render(); } }),
            el('button', { className: 'btn btn--small', type: 'button', text: '↓', 'aria-label': (nameOf[pid] || '') + ' を下へ', disabled: hasBracket || i === draft.length - 1, onClick: function () { draft.splice(i + 1, 0, draft.splice(i, 1)[0]); render(); } }),
            el('button', { className: 'btn btn--small', type: 'button', text: '外す', disabled: hasBracket, onClick: function () { draft.splice(i, 1); render(); } }),
          ])
        );
      });
      var rest = d.players.filter(function (p) {
        return draft.indexOf(p.id) === -1;
      });
      if (!hasBracket) {
        if (rest.length) {
          var sel = el('select', { className: 'input', 'aria-label': '出場者を追加' }, rest.map(function (p) {
            return el('option', { value: p.id, text: p.name });
          }));
          list.appendChild(
            el('div', { className: 'row row--tight' }, [
              sel,
              el('button', { className: 'btn btn--small', type: 'button', text: '追加', onClick: function () { draft.push(sel.value); render(); } }),
              el('button', { className: 'btn btn--small', type: 'button', text: '登録選手を全員追加', onClick: function () { rest.forEach(function (p) { draft.push(p.id); }); render(); } }),
            ])
          );
        }
        list.appendChild(
          el('div', { className: 'btn-row' }, [
            el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': dirty ? null : '1', text: '出場者とシードを保存', onClick: function () { mutate('setEntrants', { eventId: d.event.id, stageId: st.id, playerIds: draft.slice() }, '保存しました。').then(function () { delete state.entrantDraft[st.id]; render(); }); } }),
            dirty ? el('button', { className: 'btn btn--ghost', type: 'button', text: '変更を取り消す', onClick: function () { delete state.entrantDraft[st.id]; render(); } }) : null,
          ])
        );
      }
      wrap.appendChild(list);

      var bracket = el('section', { className: 'panel' }, [el('h3', { text: 'トーナメント表' })]);
      if (hasBracket) {
        st.rounds.forEach(function (r) {
          bracket.appendChild(el('h4', { text: r.label }));
          bracket.appendChild(el('ul', { className: 'plain-list' }, r.matches.map(function (m) {
            return el('li', { text: (r.matches.length > 1 || m.label !== r.label ? m.label + '：' : '') + (m.p1.name || '（未定）') + ' vs ' + (m.p2.name || '（未定）') + '　' + MATCH_STATUS_LABEL[m.status] });
          })));
        });
        bracket.appendChild(el('div', { className: 'btn-row' }, [confirmButton('トーナメント表を削除', '本当に削除', function () { mutate('clearBracket', { eventId: d.event.id, stageId: st.id }, 'トーナメント表を削除しました。'); })]));
      } else {
        bracket.appendChild(el('p', { className: 'muted small', text: dirty ? '先に「出場者とシードを保存」を押してください。' : saved.length < 2 ? '出場者が 2 名以上必要です。' : saved.length + ' 名でトーナメント表を作成します。' }));
        bracket.appendChild(el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, 'data-locked': dirty || saved.length < 2 ? '1' : null, text: 'トーナメント表を作成', onClick: function () { mutate('generateBracket', { eventId: d.event.id, stageId: st.id }, function (r) { return r.created + ' 試合のトーナメント表を作成しました。'; }); } }));
      }
      wrap.appendChild(bracket);
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

      var keyPanel = el('section', { className: 'panel' }, [
        el('h3', { text: '運営用 URL の再発行' }),
        el('p', { className: 'muted small', text: '運営用 URL が他人に知られた場合や紛失した場合に、新しい URL を発行します。古い URL はすぐに使えなくなります。' + (ev.adminKeyIssuedAt ? '（現在の URL の発行: ' + formatDateTime(ev.adminKeyIssuedAt) + '）' : '（未発行）') }),
        el('div', { className: 'btn-row' }, [
          confirmButton('再発行する', '本当に再発行', function () {
            mutate('rotateKey', { eventId: ev.id, rev: ev.rev }, '運営用 URL を再発行しました。');
          }),
        ]),
      ]);
      return el('div', { className: 'stack' }, [eventForm, keyPanel]);
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

  global.TPAdmin = { checkResult: checkResult, createApi: createApi, legsToWin: legsToWin, parseHash: parseHash, organizerUrl: organizerUrl, createFetchRunner: createFetchRunner };

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
