/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament - ポータル「トーナメント・リーグ」（GitHub Pages の events/）
 *
 * - 公開中の大会の一覧: 閲覧者用 Web アプリの ?format=list（ログイン不要・Cookie なし）。検索と絞り込みは画面の中だけで行い、通信しない
 * - 作成した大会: 運営用 Web アプリの myEvents（Google ログインのセッション）。本人の大会かどうかはサーバーが決める
 * - ログインは運営画面（admin/）と同じ方法・同じ保存場所（localStorage の tpoc-google / tpoc-staff:大会ID）を使うので、
 *   ここでログインすれば運営画面でログインし直す必要はなく、運営画面でのログインもここに反映される（同じオリジン）
 * - 運営画面に入れるかの最終判断は、運営画面がサーバーに問い合わせて行う（ここでの判断は案内のため）
 * 設定は既存の ../config.js（閲覧者用 URL）と ../admin/config.js（運営用 URL・OAuth クライアント ID）を読む。
 */
(function (global) {
  'use strict';

  var STATUS = {
    running: { label: '開催中', rank: 0 },
    draft: { label: '準備中', rank: 1 },
    finished: { label: '終了', rank: 2 },
  };
  var STATUS_FILTERS = [
    { id: '', label: 'すべて' },
    { id: 'running', label: '開催中' },
    { id: 'draft', label: '準備中' },
    { id: 'finished', label: '終了' },
  ];
  var FORMAT_FILTERS = [
    { id: '', label: 'すべての形式' },
    { id: 'tournament', label: 'トーナメント' },
    { id: 'robin', label: 'ロビン' },
    { id: 'league', label: 'リーグ' },
    { id: 'mixed', label: '複合' },
    { id: 'swiss', label: 'スイス式' },
    { id: 'series', label: 'シリーズ' },
  ];
  var DEFAULT_N02_URL = 'https://chihirohashimotoac-coder.github.io/n02/';
  var EVENT_ID_PATTERN = /^EVT-[A-Z0-9]{4,32}$/;
  var ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var GOOGLE_CLIENT_ID_PATTERN = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
  // 一覧の自動更新: 開催中の大会があれば 60 秒、なければ 5 分。タブが非表示の間は取得しない
  var REFRESH_RUNNING_MS = 60 * 1000;
  var REFRESH_IDLE_MS = 5 * 60 * 1000;
  var SEARCH_DELAY_MS = 120;

  /* ---------- 画面に依存しない処理（tests/portal-client.test.mjs で確かめる） ---------- */

  /** 検索用に文字をそろえる: 全角・半角（NFKC）、大文字・小文字、ひらがな・カタカナ、空白 */
  function normalizeText(value) {
    var s = String(value || '');
    if (s.normalize) s = s.normalize('NFKC');
    s = s.toLowerCase().replace(/[ぁ-ゖ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) + 0x60);
    });
    return s.replace(/\s+/g, '');
  }

  /** 開催日の文字列（例: 2026/11/03、2026-11-03〜04、2026年11月3日）から並べ替え用の日付を読む。読めなければ null */
  function parseDateLabel(label) {
    var text = String(label || '');
    if (text.normalize) text = text.normalize('NFKC');
    var m = text.match(/(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return Date.UTC(y, mo - 1, d);
  }

  function timeOf(iso) {
    var t = Date.parse(iso || '');
    return isNaN(t) ? 0 : t;
  }

  /**
   * 並び順: 開催中 → 準備中 → 終了。
   * 開催中は更新が新しい順、準備中は開催日が近い順（日付なしは後ろ）、終了は開催日が新しい順。同じなら更新が新しい順、最後に大会名。
   */
  function compareEvents(a, b) {
    var ra = (STATUS[a.status] || { rank: 9 }).rank;
    var rb = (STATUS[b.status] || { rank: 9 }).rank;
    if (ra !== rb) return ra - rb;
    var da = parseDateLabel(a.dateLabel);
    var db = parseDateLabel(b.dateLabel);
    if (a.status === 'draft' || a.status === 'finished') {
      if (da !== null && db === null) return -1;
      if (da === null && db !== null) return 1;
      if (da !== null && db !== null && da !== db) return a.status === 'draft' ? da - db : db - da;
    }
    var ua = timeOf(a.updatedAt);
    var ub = timeOf(b.updatedAt);
    if (ua !== ub) return ub - ua;
    return String(a.name).localeCompare(String(b.name), 'ja');
  }

  /** filter = { q, status, format }。q は normalizeText 前の入力のまま */
  function filterEvents(events, filter) {
    var q = normalizeText(filter.q);
    return (events || [])
      .filter(function (ev) {
        if (filter.status && ev.status !== filter.status) return false;
        if (filter.format && (!ev.format || ev.format.kind !== filter.format)) return false;
        if (q && normalizeText(ev.name).indexOf(q) < 0) return false;
        return true;
      })
      .sort(compareEvents);
  }

  function countByStatus(events) {
    var out = { all: 0, running: 0, draft: 0, finished: 0 };
    (events || []).forEach(function (ev) {
      out.all++;
      if (out[ev.status] !== undefined) out[ev.status]++;
    });
    return out;
  }

  /**
   * 進捗の帯: 段階ごとの区切り。幅は段階の試合数（未作成は見積もり、見積もれなければ他の段階の平均）に比例。
   * 戻り値 [{ name, state: 'done'|'running'|'ready'|'ungenerated', width, finalWidth, liveWidth, total, final, estimated }]（幅は %）
   */
  function progressSegments(summary) {
    var stages = (summary && summary.stages) || [];
    if (!stages.length) return [];
    var known = stages.filter(function (s) {
      return s.generated || s.estimated > 0;
    });
    var avg = known.length
      ? known.reduce(function (n, s) {
          return n + (s.generated ? s.total : s.estimated);
        }, 0) / known.length
      : 1;
    var weights = stages.map(function (s) {
      return s.generated ? s.total : s.estimated > 0 ? s.estimated : Math.max(1, avg);
    });
    var sum = weights.reduce(function (n, w) {
      return n + w;
    }, 0);
    return stages.map(function (s, i) {
      var width = (weights[i] * 100) / sum;
      var state = !s.generated ? 'ungenerated' : s.complete ? 'done' : s.final || s.live ? 'running' : 'ready';
      return {
        name: s.name,
        type: s.type,
        state: state,
        width: width,
        finalWidth: s.generated && s.total ? (s.final * 100) / s.total : 0,
        liveWidth: s.generated && s.total ? (s.live * 100) / s.total : 0,
        total: s.total,
        final: s.final,
        estimated: s.estimated,
      };
    });
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 更新日時: 今日なら「14:32」、今年なら「10/21 14:32」、それ以外は「2025/10/21」 */
  function formatUpdated(iso, now) {
    var t = timeOf(iso);
    if (!t) return '';
    var d = new Date(t);
    var n = new Date(now || Date.now());
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return '今日 ' + hm;
    if (d.getFullYear() === n.getFullYear()) return d.getMonth() + 1 + '/' + d.getDate() + ' ' + hm;
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }

  function formatDateTimeFull(iso) {
    var t = timeOf(iso);
    if (!t) return '';
    var d = new Date(t);
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** 現在の段階の説明 */
  function currentStageText(summary) {
    var c = summary && summary.currentStage;
    if (!c) return '段階が未設定';
    if (c.state === 'done') return c.name + '（全試合確定）';
    if (c.state === 'ungenerated') return c.name + '（対戦表は未作成）';
    if (c.state === 'ready') return c.name + '（試合前）';
    return c.name;
  }

  function readLoginValue(raw, now) {
    var v = null;
    try {
      v = JSON.parse(raw || 'null');
    } catch (e) {
      v = null;
    }
    return v && typeof v.session === 'string' && Date.parse(v.expiresAt) > (now || Date.now()) ? v : null;
  }

  /* ---------- 画面 ---------- */

  function el(doc, tag, attrs, children) {
    var node = doc.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = v;
        else if (k === 'onClick') node.addEventListener('click', v);
        else if (k === 'onSubmit') node.addEventListener('submit', v);
        else if (k === 'style') Object.keys(v).forEach(function (p) {
          node.style.setProperty(p, v[p]);
        });
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
    });
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  function icon(doc, path, size) {
    var svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(size || 20));
    svg.setAttribute('height', String(size || 20));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var p = doc.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'currentcolor');
    svg.appendChild(p);
    return svg;
  }
  var ICON_CLOSE = 'm6.4 18.6-1-1 5.5-5.6-5.6-5.6 1.1-1 5.6 5.5 5.6-5.6 1 1.1L13 12l5.6 5.6-1 1L12 13l-5.6 5.6Z';
  var ICON_PLUS = 'M11.2 20v-7.2H4v-1.6h7.2V4h1.6v7.2H20v1.6h-7.2V20h-1.6Z';
  var ICON_LOCK = 'M6.5 21q-.6 0-1-.4-.5-.5-.5-1.1V10q0-.6.5-1 .4-.5 1-.5H8V6.5q0-1.7 1.2-2.9Q10.3 2.5 12 2.5t2.8 1.1Q16 4.8 16 6.5v2h1.5q.6 0 1 .5.5.4.5 1v9.5q0 .6-.5 1.1-.4.4-1 .4h-11Zm0-1.5h11V10h-11v9.5Zm5.5-3q.6 0 1.1-.4.4-.5.4-1.1t-.4-1.1q-.5-.4-1.1-.4t-1.1.4q-.4.5-.4 1.1t.4 1.1q.5.4 1.1.4ZM9.5 8.5h5v-2q0-1-.7-1.8Q13 4 12 4t-1.8.7q-.7.8-.7 1.8v2Z';
  var ICON_ERROR = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z';
  var ICON_INFO = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z';

  /** 状態のラベル（色だけに頼らないよう、形の違う印と文字を必ず出す） */
  function statusChip(doc, status) {
    var s = STATUS[status] || { label: status || '不明' };
    return el(doc, 'span', { className: 'status status--' + (STATUS[status] ? status : 'unknown') }, [
      el(doc, 'span', { className: 'status__mark', 'aria-hidden': 'true' }),
      s.label,
    ]);
  }

  function formatChip(doc, format) {
    var f = format || { kind: 'none', label: '未設定', flow: '' };
    return el(doc, 'span', { className: 'format' }, [
      el(doc, 'span', { className: 'format__kind', text: f.label }),
      (f.kind === 'mixed' || f.kind === 'series' || f.kind === 'swiss') && f.flow && f.flow !== f.label ? el(doc, 'span', { className: 'format__flow', text: f.flow }) : null,
    ]);
  }

  /** 段階ごとの進捗の帯（数値は隣の文字でも出す。帯は装飾ではなく段階の区切りと未作成を見せる） */
  function progressBar(doc, summary) {
    var segs = progressSegments(summary);
    var pct = summary.progress ? summary.progress.percent : 0;
    var bar = el(doc, 'div', { className: 'meter' }, [
      el(doc, 'div', { className: 'meter__track', role: 'img', 'aria-label': '進捗 ' + pct + '%' + (summary.progress && summary.progress.pendingStages ? '（対戦表が未作成の段階あり）' : '') },
        segs.map(function (s) {
          return el(doc, 'span', { className: 'meter__seg meter__seg--' + s.state, style: { '--w': s.width.toFixed(3) + '%' }, title: s.name }, [
            el(doc, 'span', { className: 'meter__final', style: { '--w': s.finalWidth.toFixed(3) + '%' } }),
            el(doc, 'span', { className: 'meter__live', style: { '--l': s.finalWidth.toFixed(3) + '%', '--w': s.liveWidth.toFixed(3) + '%' } }),
          ]);
        })
      ),
      el(doc, 'span', { className: 'meter__pct', 'aria-hidden': 'true' }, [el(doc, 'b', { text: String(pct) }), '%']),
    ]);
    return bar;
  }

  function startPortal(doc, win, config) {
    var $ = function (id) {
      return doc.getElementById(id);
    };
    var viewerEndpoint = config.viewerEndpoint;
    var adminEndpoint = config.adminEndpoint;
    var googleClientId = config.googleClientId;
    // 既存の閲覧ページ・運営画面の URL は変えない（GitHub Pages はフォルダの index.html を返す）。
    // index.html を明示しないと開けない置き場所（確認用のプレビュー）だけ、設定の pageIndex で付ける
    var index = config.pageIndex === 'index.html' ? 'index.html' : '';
    var urls = {
      n02: config.n02Url || DEFAULT_N02_URL,
      view: function (id) {
        return '../' + index + '?event=' + encodeURIComponent(id);
      },
      admin: function (id) {
        return '../admin/' + index + '#e=' + encodeURIComponent(id);
      },
      create: '../admin/' + index + '#new',
    };
    var params = new win.URLSearchParams(win.location.search);
    var state = {
      tab: params.get('tab') === 'mine' ? 'mine' : 'public',
      q: (params.get('q') || '').slice(0, 80),
      status: STATUS[params.get('status')] ? params.get('status') : '',
      format: FORMAT_FILTERS.some(function (f) {
        return f.id && f.id === params.get('format');
      })
        ? params.get('format')
        : '',
      pub: { events: null, version: '', error: null, loading: false, loadedAt: '' },
      mine: { events: null, error: null, loading: false, truncated: false },
      google: null,
      notice: null, // { kind: 'info'|'error', text, action?: { label, onClick } }
      pending: null, // ログイン後に続ける操作 { kind: 'create' } | { kind: 'manage', event }
      dialogEvent: null,
      dialogStep: '', // '' | 'auth'（管理画面のログイン方法を選ぶ）
      dialogError: '',
      busy: false,
      composing: false,
    };
    var timers = { refresh: null, search: null };

    /* ---- 保存（運営画面と共通のキー） ---- */
    function storageGet(key) {
      try {
        return win.localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    }
    function storageSet(key, value) {
      try {
        if (value === null) win.localStorage.removeItem(key);
        else win.localStorage.setItem(key, value);
      } catch (e) {
        /* 保存できない環境では、このページを開いている間だけ有効 */
      }
    }
    function readGoogle() {
      return readLoginValue(storageGet('tpoc-google'));
    }
    function setGoogle(login) {
      state.google = login;
      storageSet('tpoc-google', login ? JSON.stringify(login) : null);
    }
    function staffLoginFor(eventId) {
      return readLoginValue(storageGet('tpoc-staff:' + eventId));
    }
    state.google = readGoogle();

    /* ---- 通信 ---- */
    function fetchJson(url, init) {
      return win.fetch(url, init).then(function (r) {
        if (!r.ok) throw { code: 'NETWORK', message: 'HTTP ' + r.status };
        return r.text().then(function (text) {
          try {
            return JSON.parse(text);
          } catch (e) {
            // 古い版の Apps Script は ?format=list を知らず、画面の HTML を返す
            throw { code: 'UNSUPPORTED', message: '応答の形式が違います。' };
          }
        });
      }, function (err) {
        throw { code: 'NETWORK', message: (err && err.message) || '通信に失敗しました。' };
      });
    }

    function newRequestId() {
      var bytes = new Uint8Array(16);
      win.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    }

    /** requestId: 書き込みの操作（linkAccount）だけ。サーバーが二重送信を見分ける */
    function adminCall(action, payload, auth, requestId) {
      return fetchJson(adminEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, payload: payload || {}, auth: auth, requestId: requestId }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
      }).then(function (res) {
        if (res && res.ok) return res.data;
        throw (res && res.error) || { code: 'UNKNOWN', message: '不明な応答です。' };
      });
    }

    /** reason: 'start' | 'auto' | 'visible' | 'manual'（ボタン・引っぱって更新）。manual のときだけ結果をトーストで伝える */
    function loadPublic(reason) {
      if (state.pub.loading) return Promise.resolve();
      state.pub.loading = true;
      var before = state.pub.version;
      if (!state.pub.events) render();
      var url = viewerEndpoint + '?format=list' + (state.pub.version ? '&known=' + encodeURIComponent(state.pub.version) : '');
      return fetchJson(url, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow' })
        .then(function (res) {
          if (!res || !res.ok) throw (res && res.error) || { code: 'UNKNOWN', message: '不明な応答です。' };
          state.pub.loadedAt = res.servedAt || new Date().toISOString();
          state.pub.error = null;
          state.pub.stale = !!res.stale;
          if (!res.notModified && res.data) {
            state.pub.events = (res.data.events || []).filter(function (ev) {
              return ev && EVENT_ID_PATTERN.test(ev.id);
            });
            state.pub.version = res.version || '';
          }
        })
        .catch(function (err) {
          state.pub.error = err && err.code === 'UNSUPPORTED' ? '大会の一覧を読み込めませんでした（サーバーの更新待ちの可能性があります）。' : '大会の一覧を読み込めませんでした。通信状態を確認して、もう一度お試しください。';
          if (reason === 'manual') toast('error', state.pub.error);
        })
        .then(function () {
          state.pub.loading = false;
          render();
          scheduleRefresh();
          if (reason === 'manual' && !state.pub.error) toast('ok', state.pub.version !== before ? '大会の一覧を更新しました。' : '一覧は最新の状態です。');
        });
    }

    function loadMine() {
      if (!state.google) {
        state.mine = { events: null, error: null, loading: false, truncated: false };
        return Promise.resolve();
      }
      state.mine.loading = true;
      render();
      var session = state.google.session;
      return adminCall('myEvents', {}, { session: session })
        .then(function (data) {
          // v0.9: 以前の大会・招待をこのアカウントに紐付けられるときは、紐付けてから読み直す（同じセッションで 1 回だけ）
          if (data.link && data.link.available > 0 && !linkedSessions[session]) {
            linkedSessions[session] = true;
            return adminCall('linkAccount', {}, { session: session }, newRequestId()).then(
              function (res) {
                var n = res && res.linked ? res.linked.owner + res.linked.collaborator : 0;
                if (n) toast('ok', 'このアカウントに ' + n + ' 件の大会（主催・共同主催）を紐付けました。');
                return adminCall('myEvents', {}, { session: session });
              },
              function (err) {
                if (err && (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_INVALID')) throw err;
                toast('error', '大会の紐付けに失敗しました。時間をおいてページを再読み込みしてください。');
                return data;
              }
            );
          }
          return data;
        })
        .then(function (data) {
          state.mine = { events: data.events || [], error: null, loading: false, truncated: !!data.truncated };
          if (data.email && state.google && data.email !== state.google.email) setGoogle(Object.assign({}, state.google, { email: data.email }));
          if (data.link && data.link.pending) {
            state.notice = { kind: 'info', text: 'このアカウントの確認待ちが ' + data.link.pending + ' 件あります（大会の主催者・共同主催者としての紐付け）。承認されると「作成した大会」に表示されます。' };
          }
        })
        .catch(function (err) {
          state.mine.loading = false;
          if (err && (err.code === 'AUTH_EXPIRED' || err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_INVALID')) {
            // ログインが切れた: 権限を推測で残さず、ログアウトした状態に戻す
            setGoogle(null);
            state.mine = { events: null, error: null, loading: false, truncated: false };
            state.notice = { kind: 'info', text: 'Google のログインの有効期限が切れました。作成した大会を見るには、もう一度ログインしてください。' };
            if (state.tab === 'mine') state.tab = 'public';
            renderAccount();
            return;
          }
          state.mine.error = (err && err.message) || '作成した大会を読み込めませんでした。';
        })
        .then(function () {
          render();
        });
    }

    function scheduleRefresh() {
      if (timers.refresh) win.clearTimeout(timers.refresh);
      timers.refresh = null;
      if (doc.visibilityState === 'hidden') return;
      var running = (state.pub.events || []).some(function (ev) {
        return ev.status === 'running';
      });
      timers.refresh = win.setTimeout(function () {
        loadPublic('auto');
      }, running ? REFRESH_RUNNING_MS : REFRESH_IDLE_MS);
    }

    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') {
        if (timers.refresh) win.clearTimeout(timers.refresh);
        timers.refresh = null;
        return;
      }
      // 戻ってきたら 1 回確かめる（変わっていなければ notModified で本文は来ない）
      loadPublic('visible');
      // 別のタブ（運営画面）でログイン・ログアウトしていれば反映する
      syncGoogleFromStorage();
    });

    function syncGoogleFromStorage() {
      var g = readGoogle();
      if ((g && g.session) === (state.google && state.google.session)) return;
      state.google = g;
      if (!g) {
        state.mine = { events: null, error: null, loading: false, truncated: false };
        if (state.tab === 'mine') state.tab = 'public';
      }
      loadMine();
      renderAccount();
      render();
    }

    // 別のタブでのログイン・ログアウトを、表示中でもすぐに反映する（同じオリジンの localStorage）
    win.addEventListener('storage', function (e) {
      if (e.key === null || e.key === 'tpoc-google') syncGoogleFromStorage();
    });

    /* ---- Google ログイン（Google Identity Services の公式ボタン） ---- */
    var gis = { initialized: false };
    function whenGoogleReady(done, fail) {
      var started = Date.now();
      (function poll() {
        var id = win.google && win.google.accounts && win.google.accounts.id;
        if (id)
          return whenGoogleStyleReady(function () {
            done(id);
          });
        if (Date.now() - started > 15000) return fail();
        win.setTimeout(poll, 100);
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
      win.setTimeout(finish, 3000);
    }

    function googleButton(opts) {
      var box = el(doc, 'div', { className: 'gsi__button' });
      var note = el(doc, 'p', { className: 'gsi__note', text: 'Google のログインボタンを読み込んでいます…' });
      var wrap = el(doc, 'div', { className: 'gsi' + (opts && opts.compact ? ' gsi--compact' : '') }, [box, note]);
      if (!GOOGLE_CLIENT_ID_PATTERN.test(String(googleClientId || ''))) {
        note.textContent = 'Google ログインの設定がありません（admin/config.js）。';
        note.className = 'gsi__note gsi__note--error';
        return wrap;
      }
      whenGoogleReady(
        function (id) {
          if (!gis.initialized) {
            id.initialize({ client_id: googleClientId, callback: onGoogleCredential, auto_select: false, cancel_on_tap_outside: true });
            gis.initialized = true;
          }
          id.renderButton(box, {
            type: 'standard',
            theme: opts && opts.dark ? 'filled_black' : 'outline',
            size: opts && opts.compact ? 'medium' : 'large',
            text: 'signin_with',
            shape: 'pill',
            locale: 'ja',
          });
          note.textContent = opts && opts.compact ? '' : 'ログインすると、このブラウザに 6 時間記憶します。';
          note.hidden = !note.textContent;
        },
        function () {
          note.className = 'gsi__note gsi__note--error';
          note.textContent = 'Google のログインボタンを読み込めませんでした。アプリ内のブラウザ（LINE など）や広告ブロックでは使えないことがあります。Chrome や Safari で開いてください。';
        }
      );
      return wrap;
    }

    function onGoogleCredential(resp) {
      var token = resp && resp.credential;
      if (!token || state.busy) return;
      state.busy = true;
      adminCall('login', { idToken: token })
        .then(function (data) {
          setGoogle({ session: data.session, email: data.email || '', expiresAt: data.expiresAt });
          state.notice = null;
          toast('ok', (data.email || 'Google') + ' でログインしました。');
          renderAccount();
          return loadMine().then(continuePending);
        })
        .catch(function (err) {
          var message = (err && err.message) || 'ログインできませんでした。';
          if (state.dialogEvent) {
            state.dialogError = message;
            renderEventDialog();
          } else if ($('login-dialog').open) {
            renderLoginDialog(message);
          } else {
            toast('error', message);
          }
        })
        .then(function () {
          state.busy = false;
        });
    }

    /** ログインの前に選んでいた操作を続ける */
    function continuePending() {
      var p = state.pending;
      state.pending = null;
      if (!p) {
        if ($('login-dialog').open) $('login-dialog').close();
        return;
      }
      if (p.kind === 'create') {
        goTo(urls.create);
        return;
      }
      if (p.kind === 'manage') {
        if (isMine(p.event.id)) {
          goTo(urls.admin(p.event.id));
          return;
        }
        // 他人の大会: Google ログインだけでは運営できない。管理パスワードを案内する
        state.dialogStep = 'auth';
        state.dialogError = '';
        renderEventDialog();
      }
    }

    /**
     * ログアウト: 先にこの端末のログインを消し（この端末からは使えなくする）、その後でサーバーに無効化を頼む。
     * 成功を確かめられたときだけ「サーバーでも無効にした」と伝え、失敗・時間切れなら警告と再試行を出す。
     */
    function logout() {
      var g = state.google;
      setGoogle(null);
      try {
        if (win.google && win.google.accounts && win.google.accounts.id) win.google.accounts.id.disableAutoSelect();
      } catch (e) {
        /* Google のライブラリがなくてもログアウトできる */
      }
      state.mine = { events: null, error: null, loading: false, truncated: false };
      if (state.tab === 'mine') state.tab = 'public';
      state.notice = null;
      renderAccount();
      render();
      if (g && g.session) revokeOnServer(g);
      else toast('ok', 'ログアウトしました。');
    }

    var LOGOUT_TIMEOUT_MS = 15000;
    var linkedSessions = {};

    function revokeOnServer(g) {
      var timeout = new Promise(function (resolve, reject) {
        win.setTimeout(function () {
          reject({ code: 'TIMEOUT' });
        }, LOGOUT_TIMEOUT_MS);
      });
      if (state.notice && state.notice.revoke) {
        state.notice.action.disabled = true;
        renderNotice();
      }
      Promise.race([adminCall('logout', { session: g.session }), timeout])
        .then(function (data) {
          if (!data || data.loggedOut !== true) throw { code: 'UNKNOWN' };
          if (state.notice && state.notice.revoke) state.notice = null;
          toast('ok', 'ログアウトしました（サーバーでもログインを無効にしました）。');
        })
        .catch(function () {
          state.notice = {
            kind: 'error',
            revoke: true,
            text:
              'この端末ではログアウトしました（この端末のログイン情報は消しました）。ただし、通信できなかったため、サーバー側でログインを無効にできたかは確認できていません。サーバー側では' +
              (g.expiresAt ? ' 最長 ' + new Date(g.expiresAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' まで' : '期限まで') +
              '有効なままの可能性があります。通信できる状態で、もう一度お試しください（このページを閉じると再試行できません）。',
            action: {
              label: 'もう一度試す',
              onClick: function () {
                revokeOnServer(g);
              },
            },
          };
        })
        .then(renderNotice);
    }

    function isMine(eventId) {
      return !!(state.mine.events || []).some(function (ev) {
        return ev.id === eventId;
      });
    }

    function goTo(href) {
      win.location.assign(href);
    }

    /* ---- ヘッダー（作成・ログイン） ---- */
    function renderAccount() {
      var box = $('account');
      box.textContent = '';
      box.appendChild(
        el(doc, 'button', { type: 'button', className: 'btn btn--create', id: 'create-button', onClick: onCreate }, [icon(doc, ICON_PLUS), el(doc, 'span', { text: 'トーナメント・リーグを作成' })])
      );
      if (state.google) {
        var email = state.google.email || 'Google アカウント';
        box.appendChild(
          el(doc, 'div', { className: 'account' }, [
            el(doc, 'span', { className: 'account__avatar', 'aria-hidden': 'true', text: email.charAt(0).toUpperCase() }),
            el(doc, 'span', { className: 'account__email' }, [el(doc, 'span', { className: 'visually-hidden', text: 'ログイン中: ' }), email]),
            el(doc, 'button', { type: 'button', className: 'btn btn--plate-ghost btn--small', onClick: logout, text: 'ログアウト' }),
          ])
        );
      } else {
        box.appendChild(googleButton({ compact: true, dark: true }));
      }
      $('tabs').hidden = !state.google;
    }

    function onCreate() {
      if (state.google) {
        goTo(urls.create);
        return;
      }
      state.pending = { kind: 'create' };
      openLoginDialog();
    }

    /* ---- ログインの案内（作成ボタン） ---- */
    var lastTrigger = null;
    function openLoginDialog() {
      lastTrigger = doc.activeElement;
      renderLoginDialog('');
      showDialog($('login-dialog'));
    }

    function renderLoginDialog(error) {
      var d = $('login-dialog');
      d.textContent = '';
      d.appendChild(
        el(doc, 'div', { className: 'dialog__panel' }, [
          dialogHeader('login-dialog-title', 'Google でログイン', function () {
            state.pending = null;
            d.close();
          }),
          el(doc, 'div', { className: 'dialog__body' }, [
            el(doc, 'p', { text: '大会を作成するには、Google アカウントでログインしてください。ログインすると、そのまま大会の作成画面に進みます。' }),
            error ? el(doc, 'p', { className: 'form-error', role: 'alert', text: error }) : null,
            googleButton({}),
          ]),
        ])
      );
    }

    /* ---- ダイアログ共通（<dialog> の showModal: 背景は操作できず、Esc で閉じる） ---- */
    function dialogHeader(id, title, onClose) {
      return el(doc, 'div', { className: 'dialog__header' }, [
        el(doc, 'h2', { className: 'dialog__title', id: id, tabindex: '-1', text: title }),
        el(doc, 'button', { type: 'button', className: 'dialog__close', onClick: onClose }, [icon(doc, ICON_CLOSE, 24), el(doc, 'span', { text: '閉じる' })]),
      ]);
    }

    function showDialog(d) {
      if (!d.open) {
        if (typeof d.showModal === 'function') d.showModal();
        else d.setAttribute('open', '');
      }
      var title = d.querySelector('.dialog__title');
      if (title) title.focus();
    }

    function setupDialog(d, onClosed) {
      d.addEventListener('close', function () {
        onClosed();
        var back = lastTrigger;
        lastTrigger = null;
        if (back && back.focus && doc.contains(back)) back.focus();
      });
      // 背景（ダイアログの外側）を押したら閉じる
      d.addEventListener('click', function (e) {
        if (e.target === d) d.close();
      });
    }
    setupDialog($('login-dialog'), function () {
      state.pending = null;
    });
    setupDialog($('event-dialog'), function () {
      if (state.pending && state.pending.kind === 'manage') state.pending = null;
      state.dialogEvent = null;
      state.dialogStep = '';
      state.dialogError = '';
    });

    /* ---- 大会のダイアログ ---- */
    function openEvent(ev, trigger) {
      lastTrigger = trigger || doc.activeElement;
      state.dialogEvent = ev;
      state.dialogStep = '';
      state.dialogError = '';
      renderEventDialog();
      showDialog($('event-dialog'));
    }

    function dlRow(term, desc) {
      return el(doc, 'div', { className: 'facts__row' }, [el(doc, 'dt', { text: term }), el(doc, 'dd', null, [desc])]);
    }

    function renderEventDialog() {
      var ev = state.dialogEvent;
      var d = $('event-dialog');
      if (!ev) return;
      var focusedId = doc.activeElement && d.contains(doc.activeElement) ? doc.activeElement.id : '';
      d.textContent = '';
      var viewable = ev.isPublic !== false;
      var counts = el(doc, 'span', null, [
        el(doc, 'b', { className: 'num', text: String(ev.finalCount) }),
        ' / ',
        el(doc, 'span', { className: 'num', text: String(ev.matchCount) }),
        ' 試合' + (ev.liveCount ? '（進行中 ' + ev.liveCount + '）' : ''),
      ]);
      var facts = el(doc, 'dl', { className: 'facts' }, [
        dlRow('状態', statusChip(doc, ev.status)),
        dlRow('形式', formatChip(doc, ev.format)),
        dlRow('開催日', ev.dateLabel || '未設定'),
        dlRow('参加人数', ev.playerCount === null || ev.playerCount === undefined ? '—' : ev.playerCount + ' 名'),
        dlRow('確定済み', counts),
        dlRow('進捗', progressBar(doc, ev)),
        dlRow('現在の段階', currentStageText(ev)),
        dlRow('最終更新', formatDateTimeFull(ev.updatedAt) || '—'),
      ]);
      var actions = el(doc, 'div', { className: 'dialog__actions' }, [
        viewable
          ? el(doc, 'a', { className: 'btn btn--primary btn--xl', id: 'view-event', href: urls.view(ev.id) }, ['大会を見る'])
          : el(doc, 'p', { className: 'muted', text: 'この大会は非公開のため、閲覧ページはありません（運営画面の「大会設定」で公開できます）。' }),
        el(doc, 'button', { type: 'button', className: 'btn btn--secondary', id: 'manage-event', 'aria-expanded': state.dialogStep === 'auth' ? 'true' : 'false', onClick: onManage }, [
          icon(doc, ICON_LOCK, 18),
          el(doc, 'span', { text: '管理画面' }),
        ]),
      ]);
      d.appendChild(
        el(doc, 'div', { className: 'dialog__panel' }, [
          dialogHeader('event-dialog-title', ev.name, function () {
            d.close();
          }),
          el(doc, 'div', { className: 'dialog__body' }, [facts]),
          actions,
          state.dialogStep === 'auth' ? manageAuthPanel(ev) : null,
        ])
      );
      if (focusedId && doc.getElementById(focusedId)) doc.getElementById(focusedId).focus();
    }

    /** 管理画面: 入れることが分かっていればそのまま開き、分からなければログイン方法を出す */
    function onManage() {
      var ev = state.dialogEvent;
      if (!ev) return;
      if (staffLoginFor(ev.id)) {
        // この大会の管理パスワードでログイン済み（有効期限内）。有効かどうかは運営画面がサーバーで確かめる
        goTo(urls.admin(ev.id));
        return;
      }
      // 作成した大会の一覧をまだ読めていないときは、運営画面に判断を任せる（他人の大会なら運営画面が管理パスワードを求める）
      if (state.google && (isMine(ev.id) || !state.mine.events)) {
        goTo(urls.admin(ev.id));
        return;
      }
      state.dialogStep = state.dialogStep === 'auth' ? '' : 'auth';
      state.dialogError = '';
      // ログインしていなければ、Google でログインした後にこの大会の管理画面へ続ける
      state.pending = !state.google && state.dialogStep === 'auth' ? { kind: 'manage', event: ev } : null;
      renderEventDialog();
      var first = doc.getElementById(state.google ? 'staff-password' : 'manage-auth-title');
      if (first) first.focus();
    }

    function manageAuthPanel(ev) {
      var panel = el(doc, 'section', { className: 'auth', 'aria-labelledby': 'manage-auth-title' }, [
        el(doc, 'h3', { className: 'auth__title', id: 'manage-auth-title', tabindex: '-1', text: '管理画面を開くには' }),
      ]);
      if (state.dialogError) panel.appendChild(el(doc, 'p', { className: 'form-error', role: 'alert', text: state.dialogError }));
      if (state.google) {
        panel.appendChild(
          el(doc, 'p', { className: 'auth__note', text: state.google.email + ' はこの大会の主催者ではありません。店舗スタッフの方は、主催者から伝えられた管理パスワードを入力してください。' })
        );
      } else {
        var organizer = el(doc, 'div', { className: 'auth__way' }, [
          el(doc, 'h4', { text: '主催者の方' }),
          el(doc, 'p', { className: 'auth__note', text: '大会を作成した Google アカウントでログインします。' }),
          googleButton({}),
        ]);
        panel.appendChild(organizer);
      }
      var input = el(doc, 'input', { type: 'password', id: 'staff-password', className: 'input', autocomplete: 'current-password', maxlength: '64', required: true });
      var form = el(doc, 'form', {
        className: 'auth__form',
        onSubmit: function (e) {
          e.preventDefault();
          submitStaff(ev, input.value);
        },
      }, [
        el(doc, 'label', { className: 'field__label', for: 'staff-password', text: '管理パスワード' }),
        el(doc, 'div', { className: 'auth__row' }, [input, el(doc, 'button', { type: 'submit', className: 'btn btn--secondary', id: 'staff-submit', text: '管理画面を開く' })]),
      ]);
      panel.appendChild(
        el(doc, 'div', { className: 'auth__way' }, [state.google ? null : el(doc, 'h4', { text: '店舗スタッフの方' }), form])
      );
      return panel;
    }

    function submitStaff(ev, password) {
      if (state.busy) return;
      if (!password) {
        state.dialogError = '管理パスワードを入力してください。';
        renderEventDialog();
        return;
      }
      state.busy = true;
      var button = doc.getElementById('staff-submit');
      if (button) button.disabled = true;
      adminCall('staffLogin', { eventId: ev.id, password: password })
        .then(function (data) {
          storageSet('tpoc-staff:' + ev.id, JSON.stringify({ session: data.session, expiresAt: data.expiresAt }));
          goTo(urls.admin(ev.id));
        })
        .catch(function (err) {
          state.dialogError = (err && err.message) || 'ログインできませんでした。';
          renderEventDialog();
          var again = doc.getElementById('staff-password');
          if (again) again.focus();
        })
        .then(function () {
          state.busy = false;
        });
    }

    /* ---- トースト ---- */
    function toast(kind, text) {
      if (win.TPUX) {
        win.TPUX.toast(kind, text);
        return;
      }
      var box = $('toast');
      var item = el(doc, 'div', { className: 'toast toast--' + kind, role: kind === 'error' ? 'alert' : 'status', text: text });
      box.appendChild(item);
      win.setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, kind === 'error' ? 8000 : 4000);
    }

    /* ---- 検索・絞り込み（入力欄は作り直さない。IME の変換中は絞り込まない） ---- */
    var q = $('q');
    var clear = $('q-clear');
    q.value = state.q;
    function applySearch() {
      state.q = q.value;
      clear.hidden = !q.value;
      syncUrl();
      renderResults();
    }
    q.addEventListener('compositionstart', function () {
      state.composing = true;
    });
    q.addEventListener('compositionend', function () {
      state.composing = false;
      applySearch();
    });
    q.addEventListener('input', function (e) {
      if (state.composing || e.isComposing) return;
      if (timers.search) win.clearTimeout(timers.search);
      timers.search = win.setTimeout(applySearch, SEARCH_DELAY_MS);
    });
    $('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      applySearch();
    });
    clear.addEventListener('click', function () {
      q.value = '';
      applySearch();
      q.focus();
    });
    clear.hidden = !q.value;

    var formatSelect = $('format-filter');
    FORMAT_FILTERS.forEach(function (f) {
      formatSelect.appendChild(el(doc, 'option', { value: f.id, text: f.label, selected: f.id === state.format ? true : null }));
    });
    formatSelect.addEventListener('change', function () {
      state.format = formatSelect.value;
      syncUrl();
      renderResults();
    });

    function renderStatusFilter(counts) {
      var box = $('status-filter');
      var focused = doc.activeElement && box.contains(doc.activeElement) ? doc.activeElement.getAttribute('data-status') : null;
      box.textContent = '';
      STATUS_FILTERS.forEach(function (f) {
        var n = counts ? (f.id ? counts[f.id] : counts.all) : null;
        var b = el(doc, 'button', {
          type: 'button',
          className: 'segmented__item',
          'data-status': f.id,
          'aria-pressed': state.status === f.id ? 'true' : 'false',
          onClick: function () {
            state.status = f.id;
            syncUrl();
            renderResults();
          },
        }, [f.label, n === null ? null : el(doc, 'span', { className: 'segmented__count num', text: String(n) })]);
        box.appendChild(b);
        if (focused === f.id) b.focus();
      });
    }

    /* ---- タブ（公開中の大会 / 作成した大会） ---- */
    function selectTab(tab, focus) {
      state.tab = tab;
      syncUrl();
      render();
      if (focus) $(tab === 'mine' ? 'tab-mine' : 'tab-public').focus();
      if (tab === 'mine' && state.google && !state.mine.events && !state.mine.loading) loadMine();
    }
    $('tab-public').addEventListener('click', function () {
      selectTab('public');
    });
    $('tab-mine').addEventListener('click', function () {
      selectTab('mine');
    });
    $('tabs').addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        var next = e.key === 'Home' ? 'public' : e.key === 'End' ? 'mine' : state.tab === 'public' ? 'mine' : 'public';
        selectTab(next, true);
      }
    });

    function syncUrl() {
      var p = new win.URLSearchParams();
      if (state.tab === 'mine') p.set('tab', 'mine');
      if (state.q) p.set('q', state.q);
      if (state.status) p.set('status', state.status);
      if (state.format) p.set('format', state.format);
      var s = p.toString();
      try {
        win.history.replaceState(null, '', win.location.pathname + (s ? '?' + s : '') + win.location.hash);
      } catch (e) {
        /* URL を書き換えられない環境でも検索はできる */
      }
    }

    /* ---- 一覧 ---- */
    var shownRows = { public: {}, mine: {} };
    var rowSeq = 0;

    function eventRow(ev, mine) {
      var stats = el(doc, 'dl', { className: 'row__stats' }, [
        el(doc, 'div', null, [el(doc, 'dt', { text: '参加' }), el(doc, 'dd', null, [ev.playerCount === null || ev.playerCount === undefined ? '—' : el(doc, 'span', { className: 'num', text: String(ev.playerCount) }), ev.playerCount === null || ev.playerCount === undefined ? null : ' 名'])]),
        el(doc, 'div', null, [el(doc, 'dt', { text: '確定' }), el(doc, 'dd', null, [el(doc, 'span', { className: 'num', text: String(ev.finalCount) }), el(doc, 'span', { className: 'row__of', text: ' / ' + ev.matchCount + ' 試合' })])]),
        el(doc, 'div', { className: 'row__stage' }, [el(doc, 'dt', { text: '段階' }), el(doc, 'dd', { text: currentStageText(ev) })]),
      ]);
      var updated = formatUpdated(ev.updatedAt);
      var button = el(doc, 'button', { type: 'button', className: 'row__open', 'data-event-id': ev.id, 'aria-haspopup': 'dialog' }, [
        el(doc, 'span', { className: 'row__name', text: ev.name }),
      ]);
      button.addEventListener('click', function () {
        openEvent(ev, button);
      });
      var seen = shownRows[mine ? 'mine' : 'public'];
      var fresh = !seen[ev.id];
      seen[ev.id] = true;
      var item = el(doc, 'li', { className: 'row row--' + (STATUS[ev.status] ? ev.status : 'unknown') + (fresh ? ' is-new' : ''), style: fresh ? { '--n': String(Math.min(rowSeq++, 8)) } : null }, [
        el(doc, 'div', { className: 'row__main' }, [
          el(doc, 'div', { className: 'row__tags' }, [
            statusChip(doc, ev.status),
            formatChip(doc, ev.format),
            mine ? el(doc, 'span', { className: 'visibility visibility--' + (ev.isPublic ? 'public' : 'private'), text: ev.isPublic ? '公開' : '非公開' }) : null,
          ]),
          el(doc, 'h3', { className: 'row__title' }, [button]),
          el(doc, 'p', { className: 'row__date' }, [ev.dateLabel ? el(doc, 'span', { className: 'num', text: ev.dateLabel }) : el(doc, 'span', { className: 'muted', text: '開催日未設定' })]),
        ]),
        el(doc, 'div', { className: 'row__side' }, [
          progressBar(doc, ev),
          stats,
          updated ? el(doc, 'p', { className: 'row__updated' }, ['更新 ', el(doc, 'time', { datetime: ev.updatedAt, text: updated })]) : null,
        ]),
      ]);
      return item;
    }

    function renderNotice() {
      var box = $('banner');
      box.textContent = '';
      var n = state.notice;
      if (!n) return;
      box.appendChild(
        el(doc, 'div', { className: 'banner banner--' + n.kind, role: n.kind === 'error' ? 'alert' : 'status' }, [
          icon(doc, n.kind === 'error' ? ICON_ERROR : ICON_INFO, 24),
          el(doc, 'p', { className: 'banner__text', text: n.text }),
          n.action ? el(doc, 'button', { type: 'button', className: 'btn btn--secondary btn--small', disabled: n.action.disabled ? true : null, onClick: n.action.onClick, text: n.action.label }) : null,
          el(doc, 'button', {
            type: 'button',
            className: 'banner__close',
            'aria-label': 'お知らせを閉じる',
            onClick: function () {
              state.notice = null;
              renderNotice();
            },
          }, [icon(doc, ICON_CLOSE, 20)]),
        ])
      );
    }

    function emptyState(title, text, action) {
      return el(doc, 'div', { className: 'empty' }, [el(doc, 'p', { className: 'empty__title', text: title }), text ? el(doc, 'p', { className: 'empty__text', text: text }) : null, action || null]);
    }

    function renderResults() {
      var list = state.tab === 'mine' ? state.mine : state.pub;
      var box = $('results');
      var count = $('result-count');
      box.setAttribute('aria-labelledby', state.tab === 'mine' ? 'tab-mine' : 'tab-public');
      box.setAttribute('aria-busy', list.loading && !list.events ? 'true' : 'false');
      box.textContent = '';
      renderStatusFilter(list.events ? countByStatus(list.events) : null);
      formatSelect.value = state.format;

      rowSeq = 0;
      if (!list.events) {
        count.textContent = '';
        if (list.error) {
          box.appendChild(
            el(doc, 'div', { className: 'banner banner--error', role: 'alert' }, [
              icon(doc, ICON_ERROR, 24),
              el(doc, 'p', { className: 'banner__text', text: list.error }),
              el(doc, 'button', { type: 'button', className: 'btn btn--secondary btn--small', text: '再読み込み', onClick: function () {
                if (state.tab === 'mine') loadMine();
                else loadPublic('manual');
              } }),
            ])
          );
        } else {
          box.appendChild(skeletonList(state.tab === 'mine' ? '作成した大会を読み込んでいます' : '大会の一覧を読み込んでいます'));
        }
        return;
      }
      if (list.error) {
        box.appendChild(el(doc, 'div', { className: 'banner banner--error', role: 'alert' }, [icon(doc, ICON_ERROR, 24), el(doc, 'p', { className: 'banner__text', text: list.error })]));
      }

      var filter = { q: state.q, status: state.status, format: state.format };
      var shown = filterEvents(list.events, filter);
      var filtered = !!(normalizeText(state.q) || state.status || state.format);
      var label = state.tab === 'mine' ? '作成した大会' : '公開中の大会';
      count.textContent = filtered ? label + ' ' + list.events.length + ' 件中 ' + shown.length + ' 件を表示' : label + ' ' + shown.length + ' 件';

      if (!list.events.length) {
        if (state.tab === 'mine') {
          box.appendChild(emptyState('まだ大会を作成していません', 'トーナメント・ロビン・リーグを組み合わせた大会を作成できます。', el(doc, 'button', { type: 'button', className: 'btn btn--primary', text: 'トーナメント・リーグを作成', onClick: onCreate })));
        } else {
          box.appendChild(emptyState('公開中の大会はまだありません', '大会が公開されると、ここに表示されます。'));
        }
        return;
      }
      if (!shown.length) {
        box.appendChild(
          emptyState(
            normalizeText(state.q) ? '「' + state.q.trim() + '」に一致する大会はありません' : '条件に一致する大会はありません',
            '検索語や絞り込みを変えてお試しください。',
            el(doc, 'button', {
              type: 'button',
              className: 'btn btn--secondary',
              text: '検索と絞り込みを解除',
              onClick: function () {
                q.value = '';
                state.q = '';
                state.status = '';
                state.format = '';
                clear.hidden = true;
                syncUrl();
                renderResults();
                q.focus();
              },
            })
          )
        );
        return;
      }
      if (state.tab === 'mine' && list.truncated) {
        box.appendChild(el(doc, 'p', { className: 'muted', text: '新しい順に 100 件まで表示しています。' }));
      }
      // 状態ごとのまとまり（開催中 → 準備中 → 終了）。見出しは件数付き
      ['running', 'draft', 'finished', ''].forEach(function (st) {
        var group = shown.filter(function (ev) {
          return st ? ev.status === st : !STATUS[ev.status];
        });
        if (!group.length) return;
        var headId = 'group-' + state.tab + '-' + (st || 'other');
        var section = el(doc, 'section', { className: 'group group--' + (st || 'other'), 'aria-labelledby': headId }, [
          el(doc, 'h2', { className: 'group__title', id: headId }, [st ? STATUS[st].label : 'その他', el(doc, 'span', { className: 'group__count num', text: String(group.length) })]),
          el(doc, 'ul', { className: 'rows' }, group.map(function (ev) {
            return eventRow(ev, state.tab === 'mine');
          })),
        ]);
        box.appendChild(section);
      });
    }

    /** スケルトン: 一覧の行と同じ形の灰色の枠を先に出す（読み込み中であることは読み上げで伝える） */
    function skeletonList(label) {
      var bar = function (cls) {
        return el(doc, 'span', { className: 'ux-skeleton ' + cls, 'aria-hidden': 'true' });
      };
      var rows = [0, 1, 2, 3].map(function () {
        return el(doc, 'li', { className: 'row row--skeleton', 'aria-hidden': 'true' }, [
          el(doc, 'div', { className: 'row__main' }, [bar('sk-tags'), bar('sk-title'), bar('sk-date')]),
          el(doc, 'div', { className: 'row__side' }, [bar('sk-meter'), bar('sk-stats')]),
        ]);
      });
      return el(doc, 'div', { className: 'skeleton', role: 'status' }, [
        el(doc, 'span', { className: 'visually-hidden', text: label }),
        el(doc, 'span', { className: 'ux-skeleton sk-heading', 'aria-hidden': 'true' }),
        el(doc, 'ul', { className: 'rows' }, rows),
      ]);
    }

    function renderSync() {
      var s = $('sync');
      s.textContent = '';
      if (state.tab !== 'public' || !state.pub.loadedAt) return;
      s.appendChild(el(doc, 'span', { text: '一覧の取得 ' + formatUpdated(state.pub.loadedAt) + (state.pub.stale ? '（一時的に前回のデータ）' : '') }));
      s.appendChild(el(doc, 'button', { type: 'button', className: 'btn btn--text btn--small', text: '今すぐ更新', onClick: function () {
        loadPublic('manual');
      } }));
    }

    function render() {
      $('tab-public').setAttribute('aria-selected', state.tab === 'public' ? 'true' : 'false');
      $('tab-mine').setAttribute('aria-selected', state.tab === 'mine' ? 'true' : 'false');
      $('tab-public').tabIndex = state.tab === 'public' ? 0 : -1;
      $('tab-mine').tabIndex = state.tab === 'mine' ? 0 : -1;
      $('tab-mine').textContent = '作成した大会' + (state.mine.events ? '（' + state.mine.events.length + '）' : '');
      renderNotice();
      renderResults();
      renderSync();
    }

    /* ---- 引っぱって更新（スマートフォン）。一覧と、ログインしていれば作成した大会を読み直す ---- */
    if (win.TPUX) {
      win.TPUX.pullToRefresh({
        onRefresh: function () {
          return Promise.all([loadPublic('manual'), state.google ? loadMine() : null]);
        },
      });
    }

    /* ---- 大会名の候補（オートコンプリート）。表示中のタブの大会から選び、選ぶとその大会を開く ---- */
    if (win.TPUX) {
      win.TPUX.combobox({
        input: q,
        max: 6,
        getItems: function (text) {
          var list = state.tab === 'mine' ? state.mine.events : state.pub.events;
          return filterEvents(list || [], { q: text }).map(function (ev) {
            return { id: ev.id, label: ev.name, meta: (STATUS[ev.status] || { label: '' }).label + (ev.dateLabel ? '・' + ev.dateLabel : ''), event: ev };
          });
        },
        onPick: function (item) {
          q.value = item.label;
          applySearch();
          var row = doc.querySelector('.row__open[data-event-id="' + item.id + '"]');
          openEvent(item.event, row || q);
        },
      });
    }

    /* ---- 起動 ---- */
    $('back-to-n02').setAttribute('href', urls.n02);
    if (!state.google && state.tab === 'mine') state.tab = 'public';
    renderAccount();
    render();
    loadPublic('start');
    if (state.google) loadMine();
    return { state: state, reload: loadPublic };
  }

  global.TPPortal = {
    normalizeText: normalizeText,
    parseDateLabel: parseDateLabel,
    compareEvents: compareEvents,
    filterEvents: filterEvents,
    countByStatus: countByStatus,
    progressSegments: progressSegments,
    formatUpdated: formatUpdated,
    currentStageText: currentStageText,
    readLoginValue: readLoginValue,
  };

  if (global.document && global.document.getElementById('results')) {
    var go = function () {
      var viewer = global.TPOC_CONFIG || {};
      var admin = global.TPOC_ADMIN_CONFIG || {};
      if (!ENDPOINT_PATTERN.test(String(viewer.endpoint || '')) || !ENDPOINT_PATTERN.test(String(admin.endpoint || ''))) {
        global.document.getElementById('results').textContent = '設定エラー: config.js（閲覧者用）と admin/config.js（運営用）の endpoint を確認してください。';
        return;
      }
      global.__tpocPortal = startPortal(global.document, global, {
        viewerEndpoint: viewer.endpoint,
        adminEndpoint: admin.endpoint,
        googleClientId: admin.googleClientId,
        n02Url: admin.n02Url,
        pageIndex: admin.pageIndex,
      });
    };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(typeof window !== 'undefined' ? window : this);
