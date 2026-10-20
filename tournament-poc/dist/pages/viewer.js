/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament PoC - 閲覧画面（クライアント側） */
(function (global) {
  'use strict';

  var STATUS_LABEL = { scheduled: '未開始', live: '進行中', final: '確定済み', check: '確認中' };
  var EVENT_STATUS_LABEL = { draft: '準備中', running: '開催中', finished: '終了' };

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * 自動更新の制御（DOM に依存しないので単体テストできる）。
   * - 通常は intervalMs ± jitterMs の間隔で取得（閲覧者ごとに取得タイミングがずれる）
   * - 失敗時は指数バックオフ（5s, 10s, 20s, 40s, 60s 上限）にランダム幅を加えて再試行
   * - 取得中は次の取得を始めない（重複リクエスト防止）
   * - 応答が timeoutMs 以内に返らなければ失敗扱いにし、遅れて届いた応答は捨てる
   * - タブが非表示の間は取得しない。表示に戻ったら、間隔を過ぎていれば少しずらして取得する
   */
  function createPoller(opts) {
    var now = opts.now;
    var setTimer = opts.setTimer;
    var clearTimer = opts.clearTimer;
    var random = opts.random || Math.random;
    var cfg = {
      intervalMs: opts.intervalMs || 60000,
      jitterMs: opts.jitterMs === undefined ? 10000 : opts.jitterMs,
      timeoutMs: opts.timeoutMs || 25000,
      backoffBaseMs: opts.backoffBaseMs || 5000,
      backoffMaxMs: opts.backoffMaxMs || 60000,
      minManualGapMs: opts.minManualGapMs === undefined ? 5000 : opts.minManualGapMs,
      intervalLocked: !!opts.intervalLocked,
    };
    var st = {
      inFlight: false,
      seq: 0,
      pending: null,
      timer: null,
      nextAt: 0,
      failures: 0,
      lastAttemptAt: 0,
      lastSuccessAt: 0,
      version: '',
      hidden: false,
      dueWhileHidden: false,
      stopped: true,
      requests: 0,
      latencies: [],
    };

    function emit(type, detail) {
      if (opts.onEvent) opts.onEvent(type, detail || {}, snapshot());
    }

    function snapshot() {
      return {
        inFlight: st.inFlight,
        nextAt: st.nextAt,
        failures: st.failures,
        lastSuccessAt: st.lastSuccessAt,
        lastAttemptAt: st.lastAttemptAt,
        version: st.version,
        requests: st.requests,
        intervalMs: cfg.intervalMs,
      };
    }

    function schedule(delayMs) {
      if (st.timer !== null) clearTimer(st.timer);
      var delay = Math.max(0, Math.round(delayMs));
      st.nextAt = now() + delay;
      st.timer = setTimer(onTimer, delay);
      emit('scheduled', { delayMs: delay });
    }

    function onTimer() {
      st.timer = null;
      if (st.stopped) return;
      if (st.hidden) {
        st.dueWhileHidden = true;
        st.nextAt = 0;
        emit('paused');
        return;
      }
      run('timer');
    }

    function normalDelay() {
      return cfg.intervalMs + (random() * 2 - 1) * cfg.jitterMs;
    }

    function backoffDelay() {
      var base = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * Math.pow(2, st.failures - 1));
      return base * (0.5 + random() * 0.5);
    }

    function run(reason) {
      if (st.inFlight || st.stopped) return false;
      st.inFlight = true;
      st.lastAttemptAt = now();
      st.requests++;
      var seq = ++st.seq;
      var timeoutId = setTimer(function () {
        complete(seq, null, { code: 'TIMEOUT', message: '応答がありません' });
      }, cfg.timeoutMs);
      st.pending = { seq: seq, timeoutId: timeoutId, startedAt: st.lastAttemptAt };
      emit('request', { reason: reason });
      try {
        opts.fetch(
          { knownVersion: st.version },
          function (res) {
            complete(seq, res, null);
          },
          function (err) {
            complete(seq, null, { code: 'NETWORK', message: (err && err.message) || '通信に失敗しました' });
          }
        );
      } catch (e) {
        complete(seq, null, { code: 'NETWORK', message: (e && e.message) || '通信に失敗しました' });
      }
      return true;
    }

    function complete(seq, res, err) {
      if (!st.pending || st.pending.seq !== seq) return; // タイムアウト後に遅れて届いた応答は無視
      clearTimer(st.pending.timeoutId);
      st.latencies.push(now() - st.pending.startedAt);
      if (st.latencies.length > 50) st.latencies.shift();
      st.pending = null;
      st.inFlight = false;
      if (st.stopped) return;

      var accepted = res && (res.ok || (res.error && (res.error.code === 'NO_PUBLIC_EVENT' || res.error.code === 'BAD_REQUEST')));
      if (accepted) {
        st.failures = 0;
        st.lastSuccessAt = now();
        if (res.ok && !res.notModified && res.version) st.version = res.version;
        if (!res.ok) st.version = '';
        if (res.refresh && res.refresh.intervalSec && !cfg.intervalLocked) {
          cfg.intervalMs = clamp(res.refresh.intervalSec, 30, 600) * 1000;
          cfg.jitterMs = clamp(res.refresh.jitterSec || 0, 0, 30) * 1000;
        }
        emit('success', { response: res });
        schedule(normalDelay());
      } else {
        st.failures++;
        var error = err || (res && res.error) || { code: 'UNKNOWN', message: '不明なエラー' };
        var delay = backoffDelay();
        emit('failure', { error: error, retryInMs: delay });
        schedule(delay);
      }
    }

    return {
      start: function () {
        st.stopped = false;
        run('start');
      },
      stop: function () {
        st.stopped = true;
        if (st.timer !== null) clearTimer(st.timer);
        st.timer = null;
      },
      /** 手動更新。取得中・直前に取得した場合は実行しない */
      refreshNow: function () {
        if (st.inFlight) return 'busy';
        if (now() - st.lastAttemptAt < cfg.minManualGapMs) return 'throttled';
        if (st.timer !== null) clearTimer(st.timer);
        st.timer = null;
        run('manual');
        return 'started';
      },
      setHidden: function (hidden) {
        st.hidden = !!hidden;
        if (st.hidden || st.stopped) return;
        var overdue = st.dueWhileHidden || (st.lastSuccessAt && now() - st.lastSuccessAt >= cfg.intervalMs);
        st.dueWhileHidden = false;
        if (overdue && !st.inFlight) schedule(random() * 2000);
      },
      onOnline: function () {
        if (!st.inFlight && !st.stopped && st.failures > 0) schedule(random() * 2000);
      },
      state: snapshot,
      latencies: function () {
        return st.latencies.slice();
      },
    };
  }

  /* ---------- 表示 ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function formatTime(value) {
    if (!value) return '—';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function legsText(legs) {
    return legs === null || legs === undefined ? '–' : String(legs);
  }

  function renderMatch(m) {
    var final = m.status === 'final';
    var p1Win = final && m.winnerId === m.p1.id;
    var p2Win = final && m.winnerId === m.p2.id;
    var showLegs = m.status === 'live' || m.status === 'final';
    return el('li', { className: 'match match--' + m.status, 'data-match-id': m.id }, [
      el('span', { className: 'match__round', text: 'R' + m.round }),
      el('span', { className: 'match__player match__player--1' + (p1Win ? ' is-winner' : '') }, [
        el('span', { className: 'match__name', text: m.p1.name }),
        p1Win ? el('span', { className: 'win-mark', text: 'WIN', 'aria-label': '勝者' }) : null,
      ]),
      el('span', { className: 'match__score', 'aria-label': showLegs ? '取得Leg ' + legsText(m.p1.legs) + '対' + legsText(m.p2.legs) : '結果なし' }, [
        el('span', { className: 'legs' + (p1Win ? ' is-winner' : ''), text: showLegs ? legsText(m.p1.legs) : '–' }),
        el('span', { className: 'legs-sep', text: '-' }),
        el('span', { className: 'legs' + (p2Win ? ' is-winner' : ''), text: showLegs ? legsText(m.p2.legs) : '–' }),
      ]),
      el('span', { className: 'match__player match__player--2' + (p2Win ? ' is-winner' : '') }, [
        p2Win ? el('span', { className: 'win-mark', text: 'WIN', 'aria-label': '勝者' }) : null,
        el('span', { className: 'match__name', text: m.p2.name }),
      ]),
      el('span', { className: 'status status--' + m.status, text: STATUS_LABEL[m.status] || '確認中' }),
    ]);
  }

  function renderGroup(g) {
    var nameById = {};
    g.players.forEach(function (p) {
      nameById[p.id] = p.name;
    });
    var rows = g.summary.map(function (s) {
      return el('tr', null, [
        el('th', { scope: 'row', text: nameById[s.playerId] || '' }),
        el('td', { text: s.won + '-' + s.lost }),
        el('td', { text: s.legsFor + '-' + s.legsAgainst }),
      ]);
    });
    var p = g.progress;
    return el('section', { className: 'group', id: 'group-' + g.id, 'aria-labelledby': 'group-title-' + g.id }, [
      el('header', { className: 'group__head' }, [
        el('h2', { className: 'group__title', id: 'group-title-' + g.id, text: g.name }),
        el('span', { className: 'group__progress', text: '確定 ' + p.final + ' / ' + p.total + (p.live ? '・進行中 ' + p.live : '') }),
      ]),
      el('table', { className: 'summary' }, [
        el('caption', { className: 'visually-hidden', text: g.name + ' の成績（確定試合のみ）' }),
        el('thead', null, [el('tr', null, [el('th', { scope: 'col', text: '選手' }), el('th', { scope: 'col', text: '勝-敗' }), el('th', { scope: 'col', text: 'Leg 得-失' })])]),
        el('tbody', null, rows),
      ]),
      el('ol', { className: 'matches', 'aria-label': g.name + ' の対戦' }, g.matches.map(renderMatch)),
    ]);
  }

  function renderEvent(root, data, filter) {
    var groups = data.groups || [];
    var visible = groups.filter(function (g) {
      return !filter || filter === 'all' || g.id === filter;
    });
    root.textContent = '';
    if (!groups.length) {
      root.appendChild(el('p', { className: 'empty', text: 'グループはまだ登録されていません。' }));
      return;
    }
    visible.forEach(function (g) {
      root.appendChild(renderGroup(g));
    });
  }

  /* ---------- 画面の組み立て ---------- */

  function startApp(doc, win) {
    var $ = function (id) {
      return doc.getElementById(id);
    };
    var ui = {
      title: $('event-title'),
      date: $('event-date'),
      eventStatus: $('event-status'),
      rule: $('rule-badge'),
      groups: $('groups'),
      filter: $('group-filter'),
      updated: $('updated-at'),
      fetched: $('fetched-at'),
      next: $('next-refresh'),
      banner: $('banner'),
      refresh: $('refresh-button'),
      message: $('message'),
    };
    var view = { data: null, filter: 'all', lastError: null, eventId: '' };

    function showBanner(kind, text) {
      ui.banner.hidden = !text;
      ui.banner.className = 'banner banner--' + kind;
      ui.banner.textContent = text || '';
    }

    function renderFilter() {
      ui.filter.textContent = '';
      var groups = (view.data && view.data.groups) || [];
      if (groups.length < 2) {
        ui.filter.hidden = true;
        return;
      }
      ui.filter.hidden = false;
      [{ id: 'all', name: 'すべて' }].concat(groups).forEach(function (g) {
        var b = el('button', { type: 'button', className: 'chip', 'aria-pressed': String(view.filter === g.id), text: g.name });
        b.addEventListener('click', function () {
          view.filter = g.id;
          renderFilter();
          renderEvent(ui.groups, view.data, view.filter);
        });
        ui.filter.appendChild(b);
      });
    }

    function renderData() {
      var d = view.data;
      ui.message.hidden = true;
      ui.title.textContent = d.event.name;
      doc.title = d.event.name + ' | n02 Tournament';
      ui.date.textContent = d.event.dateLabel || '';
      ui.eventStatus.textContent = EVENT_STATUS_LABEL[d.event.status] || '';
      if (d.rule) {
        ui.rule.hidden = false;
        ui.rule.textContent = 'Best of ' + d.rule.bestOf + ' Legs（先に ' + d.rule.legsToWin + ' Leg）' + (d.rule.provisional ? '・暫定ルール' : '');
      } else {
        ui.rule.hidden = true;
      }
      ui.updated.textContent = formatTime(d.dataUpdatedAt);
      renderFilter();
      renderEvent(ui.groups, d, view.filter);
    }

    function showMessage(text) {
      ui.message.hidden = false;
      ui.message.textContent = text;
    }

    var config = win.TPOC_CONFIG || null;
    var fetchJson = config ? createFetchTransport(win, config.endpoint) : null;

    function fetchSnapshot(req, ok, fail) {
      req.eventId = view.eventId || undefined;
      if (fetchJson) fetchJson(req, ok, fail);
      else win.google.script.run.withSuccessHandler(ok).withFailureHandler(fail).getPublicSnapshot(req);
    }

    var params = {};
    var poller;
    // 負荷試験（tools/loadtest.mjs）が読み取る計測値。画面の動作には使わない
    var metrics = { success: 0, failure: 0, notModified: 0, stale: 0, errors: {}, versions: {} };

    function onEvent(type, detail, s) {
      if (type === 'success') {
        var res = detail.response;
        metrics.success++;
        if (res.notModified) metrics.notModified++;
        if (res.stale) metrics.stale++;
        if (res.version && !metrics.versions[res.version]) metrics.versions[res.version] = Date.now();
        ui.fetched.textContent = formatTime(new Date(s.lastSuccessAt));
        if (res.ok) {
          if (res.data) {
            view.data = res.data;
            renderData();
          }
          if (res.stale) {
            showBanner('warn', 'サーバーで最新データを読み込めなかったため、' + formatTime(res.publishedAt) + ' 時点の公開データを表示しています。');
          } else {
            showBanner('ok', '');
          }
        } else {
          view.data = null;
          ui.groups.textContent = '';
          ui.filter.hidden = true;
          ui.title.textContent = 'n02 Tournament';
          ui.rule.hidden = true;
          showMessage(res.error.message);
          showBanner('ok', '');
        }
      } else if (type === 'failure') {
        metrics.failure++;
        metrics.errors[detail.error.code] = (metrics.errors[detail.error.code] || 0) + 1;
        var sec = Math.round(detail.retryInMs / 1000);
        if (view.data) {
          showBanner('warn', '更新に失敗しました（' + s.failures + ' 回目）。' + sec + ' 秒後に再試行します。表示中は ' + ui.fetched.textContent + ' に取得したデータです。');
        } else {
          showMessage('データを取得できませんでした。' + sec + ' 秒後に自動で再試行します。');
          showBanner('error', '通信エラー（' + s.failures + ' 回目）');
        }
      } else if (type === 'request') {
        ui.refresh.disabled = true;
        ui.refresh.textContent = '更新中…';
      }
      if (type !== 'request') {
        ui.refresh.disabled = s.inFlight;
        ui.refresh.textContent = '今すぐ更新';
      }
    }

    function tick() {
      if (!poller) return;
      var s = poller.state();
      if (s.inFlight) ui.next.textContent = '取得中…';
      else if (!s.nextAt) ui.next.textContent = '画面表示中に再開';
      else ui.next.textContent = '約 ' + Math.max(0, Math.ceil((s.nextAt - Date.now()) / 1000)) + ' 秒後';
    }

    function boot() {
      var interval = Number(params.interval);
      var locked = isFinite(interval) && interval >= 15 && interval <= 600;
      if (typeof params.event === 'string' && /^EVT-[A-Z0-9]{4,32}$/.test(params.event)) view.eventId = params.event;
      poller = createPoller({
        fetch: fetchSnapshot,
        now: function () {
          return Date.now();
        },
        setTimer: function (fn, ms) {
          return win.setTimeout(fn, ms);
        },
        clearTimer: function (id) {
          win.clearTimeout(id);
        },
        intervalMs: locked ? interval * 1000 : 60000,
        intervalLocked: locked,
        onEvent: onEvent,
      });
      ui.refresh.addEventListener('click', function () {
        var r = poller.refreshNow();
        if (r === 'throttled') showBanner('info', '少し時間をおいてから更新してください。');
      });
      doc.addEventListener('visibilitychange', function () {
        poller.setHidden(doc.visibilityState === 'hidden');
      });
      win.addEventListener('online', function () {
        poller.onOnline();
      });
      poller.setHidden(doc.visibilityState === 'hidden');
      poller.start();
      win.setInterval(tick, 1000);
      win.__tpocViewer = { poller: poller, metrics: metrics };
    }

    if (config && !ENDPOINT_PATTERN.test(String(config.endpoint || ''))) {
      showMessage('設定エラー: config.js の endpoint に閲覧者用 Web アプリの URL（https://script.google.com/macros/s/…/exec）を設定してください。');
      return;
    }
    if (!(win.google && win.google.script) || config) {
      params = readSearchParams(win.location && win.location.search);
      boot();
    } else if (win.google.script.url) {
      win.google.script.url.getLocation(function (loc) {
        params = (loc && loc.parameter) || {};
        boot();
      });
    } else {
      boot();
    }
  }

  var ENDPOINT_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

  function readSearchParams(search) {
    var out = {};
    String(search || '')
      .replace(/^\?/, '')
      .split('&')
      .forEach(function (pair) {
        if (!pair) return;
        var i = pair.indexOf('=');
        var k = decodeURIComponent((i < 0 ? pair : pair.slice(0, i)).replace(/\+/g, ' '));
        var v = i < 0 ? '' : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' '));
        if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
      });
    return out;
  }

  /**
   * GitHub Pages など Google の外に置いた閲覧ページ用の通信。
   * 閲覧者用 Web アプリの ?format=json を fetch で読む。Cookie を送らない（credentials: 'omit'）ので、
   * ブラウザが複数の Google アカウントにログインしていても匿名アクセスとして扱われる。
   */
  function createFetchTransport(win, endpoint) {
    return function (req, ok, fail) {
      var q = ['format=json'];
      if (req.eventId) q.push('event=' + encodeURIComponent(req.eventId));
      if (req.knownVersion) q.push('known=' + encodeURIComponent(req.knownVersion));
      win
        .fetch(endpoint + '?' + q.join('&'), { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'follow' })
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

  global.TPViewer = {
    readSearchParams: readSearchParams,
    createFetchTransport: createFetchTransport,
    createPoller: createPoller,
    renderEvent: renderEvent,
    formatTime: formatTime,
    STATUS_LABEL: STATUS_LABEL,
  };

  if (global.document && ((global.google && global.google.script) || global.TPOC_CONFIG)) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', function () {
        startApp(global.document, global);
      });
    } else {
      startApp(global.document, global);
    }
  }
})(typeof window !== 'undefined' ? window : this);
