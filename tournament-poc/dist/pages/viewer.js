/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament PoC - 閲覧画面（クライアント側） */
(function (global) {
  'use strict';

  var STATUS_LABEL = { scheduled: '未開始', live: '進行中', final: '確定済み', check: '確認中', pending: '組み合わせ待ち' };
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
   * - opts.nextDelay(res, normalMs) があれば、成功後の次の取得までの時間をそれで決める（null を返すと自動更新を止める）。
   *   止めた後も、表示に戻ったとき・手動更新では 1 回取得し、その結果でまた決め直す
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
      halted: false, // 自動更新を止めている（nextDelay が null を返した）
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
        halted: st.halted,
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
        var next = opts.nextDelay && !cfg.intervalLocked ? opts.nextDelay(res, normalDelay()) : normalDelay();
        if (next === null) {
          if (st.timer !== null) clearTimer(st.timer);
          st.timer = null;
          st.nextAt = 0;
          st.halted = true;
          emit('halted');
        } else {
          st.halted = false;
          schedule(next);
        }
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
        var overdue = st.halted || st.dueWhileHidden || (st.lastSuccessAt && now() - st.lastSuccessAt >= cfg.intervalMs);
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

  var MINUTE = 60000;
  var HOUR = 60 * MINUTE;
  var DAY = 24 * HOUR;

  /**
   * 自動更新の間隔（DOM に依存しないので単体テストできる）。最後にデータが変わってからの時間で決める。
   *   〜60 分: 通常（約 60 秒）/ 〜3 時間: 5 分 / 〜24 時間: 30 分 / 〜14 日: 60 分 / それ以降: 停止
   * 次の場合はすぐに止める: 大会が「終了」/ 全試合が確定して 60 分変化がない（終了にし忘れても止まる）
   * info = { now, lastChangeAt, finished, allFinal, normalMs }
   * 戻り値 = { delayMs: number | null（null は停止）, mode: 'normal' | 'slow' | 'stopped', everyMs?, reason? }
   */
  function refreshPlan(info) {
    if (info.finished) return { delayMs: null, mode: 'stopped', reason: 'finished' };
    var idle = Math.max(0, info.now - info.lastChangeAt);
    if (info.allFinal && idle >= HOUR) return { delayMs: null, mode: 'stopped', reason: 'allFinal' };
    if (idle < HOUR) return { delayMs: info.normalMs, mode: 'normal' };
    var every = idle < 3 * HOUR ? 5 * MINUTE : idle < DAY ? 30 * MINUTE : idle < 14 * DAY ? HOUR : 0;
    if (!every) return { delayMs: null, mode: 'stopped', reason: 'idle' };
    // 全試合が確定していれば、60 分たった時点で止める判定ができるよう、それより先へは延ばさない
    var delay = every * (0.9 + Math.random() * 0.2);
    if (info.allFinal) delay = Math.min(delay, Math.max(1000, HOUR - idle + 1000));
    return { delayMs: delay, mode: 'slow', everyMs: every };
  }

  /**
   * 全試合が確定したか。まだ試合のない段階（トーナメント表を作る前の A / B トーナメントなど）があれば、
   * 次の段階を待っているので「確定」とはみなさない
   */
  function allMatchesFinal(d) {
    var p = d && d.progress;
    if (!p || !(p.total > 0) || p.final !== p.total) return false;
    return (d.stages || []).every(function (st) {
      return st.progress && st.progress.total > 0;
    });
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

  var STAGE_TYPE_LABEL = { round_robin: '総当たり', league: 'リーグ', single_elimination: 'トーナメント' };
  var TIEBREAKER_LABEL = { wins: '勝数', leg_diff: 'Leg 差', legs_for: '得 Leg', set_diff: 'セット差', sets_for: '得セット', head_to_head: '直接対決' };

  function ruleText(rule) {
    if (!rule || !rule.bestOf) return '';
    var text =
      rule.format === 'sets'
        ? 'Best of ' + rule.bestOf + ' セット（先に ' + rule.setsToWin + ' セット・各セット Best of ' + rule.setBestOf + ' Legs）'
        : 'Best of ' + rule.bestOf + ' Legs（先に ' + rule.legsToWin + ' Leg）';
    return text + (rule.provisional ? '・暫定ルール' : '');
  }

  function isSetMatch(m) {
    return m.p1.sets !== null && m.p1.sets !== undefined;
  }

  function renderMatch(m) {
    var final = m.status === 'final';
    var p1Win = final && !!m.winnerId && m.winnerId === m.p1.id;
    var p2Win = final && !!m.winnerId && m.winnerId === m.p2.id;
    var showScore = m.status === 'live' || final;
    var sets = isSetMatch(m);
    var s1 = sets ? m.p1.sets : m.p1.legs;
    var s2 = sets ? m.p2.sets : m.p2.legs;
    var unit = sets ? 'セット' : 'Leg';
    var name = function (p) {
      return p.id ? p.name : '未定';
    };
    return el('li', { className: 'match match--' + m.status, 'data-match-id': m.id }, [
      el('span', { className: 'match__round', text: m.label || 'R' + m.round }),
      el('span', { className: 'match__player match__player--1' + (p1Win ? ' is-winner' : '') + (m.p1.id ? '' : ' is-tbd') }, [
        el('span', { className: 'match__name', text: name(m.p1) }),
        p1Win ? el('span', { className: 'win-mark', text: 'WIN', 'aria-label': '勝者' }) : null,
      ]),
      el('span', { className: 'match__score', 'aria-label': showScore ? '取得' + unit + ' ' + legsText(s1) + '対' + legsText(s2) : '結果なし' }, [
        el('span', { className: 'legs' + (p1Win ? ' is-winner' : ''), text: showScore ? legsText(s1) : '–' }),
        el('span', { className: 'legs-sep', text: '-' }),
        el('span', { className: 'legs' + (p2Win ? ' is-winner' : ''), text: showScore ? legsText(s2) : '–' }),
        sets && showScore && m.p1.legs !== null && m.p2.legs !== null
          ? el('span', { className: 'match__legs', text: '(' + legsText(m.p1.legs) + '-' + legsText(m.p2.legs) + ')', 'aria-label': 'Leg 合計' })
          : null,
      ]),
      el('span', { className: 'match__player match__player--2' + (p2Win ? ' is-winner' : '') + (m.p2.id ? '' : ' is-tbd') }, [
        p2Win ? el('span', { className: 'win-mark', text: 'WIN', 'aria-label': '勝者' }) : null,
        el('span', { className: 'match__name', text: name(m.p2) }),
      ]),
      el('span', { className: 'status status--' + m.status, text: STATUS_LABEL[m.status] || '確認中' }),
    ]);
  }

  function renderGroup(g, opts) {
    var nameById = {};
    g.players.forEach(function (p) {
      nameById[p.id] = p.name;
    });
    var sets = !!(opts && opts.sets);
    var ranked = !!(opts && opts.ranked);
    var standings = g.standings || g.summary || [];
    var heads = [];
    if (ranked) heads.push(el('th', { scope: 'col', className: 'summary__rank', text: '順位' }));
    heads.push(el('th', { scope: 'col', text: '選手' }), el('th', { scope: 'col', text: '勝-敗' }));
    if (sets) heads.push(el('th', { scope: 'col', text: 'セット 得-失' }));
    heads.push(el('th', { scope: 'col', text: 'Leg 得-失' }));
    var rows = standings.map(function (s) {
      var cells = [];
      // 確定試合がないうちは全員同順位になるので、順位は出さない
      if (ranked) cells.push(el('td', { className: 'summary__rank', text: g.progress.final && s.rank ? s.rank + (s.tied ? '（同）' : '') : '–' }));
      cells.push(el('th', { scope: 'row', text: nameById[s.playerId] || '' }), el('td', { text: s.won + '-' + s.lost }));
      if (sets) cells.push(el('td', { text: (s.setsFor || 0) + '-' + (s.setsAgainst || 0) }));
      cells.push(el('td', { text: s.legsFor + '-' + s.legsAgainst }));
      return el('tr', null, cells);
    });
    var p = g.progress;
    return el('section', { className: 'group', id: 'group-' + g.id, 'aria-labelledby': 'group-title-' + g.id }, [
      el('header', { className: 'group__head' }, [
        el('h3', { className: 'group__title', id: 'group-title-' + g.id, text: g.name }),
        el('span', { className: 'group__progress', text: '確定 ' + p.final + ' / ' + p.total + (p.live ? '・進行中 ' + p.live : '') }),
      ]),
      el('table', { className: 'summary' }, [
        el('caption', { className: 'visually-hidden', text: g.name + ' の成績（確定試合のみ）' }),
        el('thead', null, [el('tr', null, heads)]),
        el('tbody', null, rows),
      ]),
      el('ol', { className: 'matches', 'aria-label': g.name + ' の対戦' }, g.matches.map(renderMatch)),
    ]);
  }

  function stageRanked(stage) {
    return !!(stage && stage.tiebreakers && stage.tiebreakers.length);
  }

  function renderGroupStage(stage, groupFilter) {
    var sets = !!(stage.rule && stage.rule.format === 'sets');
    var groups = (stage.groups || []).filter(function (g) {
      return !groupFilter || groupFilter === 'all' || g.id === groupFilter;
    });
    var nodes = groups.map(function (g) {
      return renderGroup(g, { sets: sets, ranked: stageRanked(stage) });
    });
    if (!stage.groups || !stage.groups.length) nodes.push(el('p', { className: 'empty', text: 'グループはまだ登録されていません。' }));
    return el('div', { className: 'groups' }, nodes);
  }

  var THIRD_PLACE_LABEL = '3位決定戦';

  /**
   * トーナメント表の配置（DOM に依存しないので単体テストできる）。
   * 最後の回戦を R とすると、回戦 r の枠は 2^(R−r) 個。試合は order（1 から）の枠に置く。
   * 1 回戦の不戦勝の枠は空き（null）になり、線を引かない。order が欠けている・重なるときは出現順に詰める。
   * 戻り値: { columns: [{ round, label, bestOf, slots: [match|null], fed: [bool] }], third: [match] }
   */
  function bracketLayout(rounds) {
    var main = [];
    var third = [];
    (rounds || []).forEach(function (r) {
      var ms = (r.matches || []).filter(function (m) {
        if (m.label === THIRD_PLACE_LABEL) third.push(m);
        return m.label !== THIRD_PLACE_LABEL;
      });
      if (ms.length) main.push({ round: Number(r.round) || 0, label: r.label || '', matches: ms });
    });
    main.sort(function (a, b) {
      return a.round - b.round;
    });
    var columns = main.map(function (r, i) {
      var count = Math.max(Math.pow(2, main.length - 1 - i), r.matches.length);
      var slots = [];
      for (var k = 0; k < count; k++) slots.push(null);
      var placed = r.matches.every(function (m) {
        var k = Number(m.order) - 1;
        if (!(k >= 0 && k < count) || Math.floor(k) !== k || slots[k]) return false;
        slots[k] = m;
        return true;
      });
      if (!placed) {
        slots = slots.map(function () {
          return null;
        });
        r.matches.forEach(function (m, k) {
          slots[k] = m;
        });
      }
      var bestOf = r.matches[0] && r.matches[0].bestOf;
      return { round: r.round, label: r.label, bestOf: bestOf || null, slots: slots, fed: [] };
    });
    // 前の回戦から勝者が上がってくる枠か（線を引くかどうか）
    columns.forEach(function (c, i) {
      c.fed = c.slots.map(function (m, k) {
        var prev = columns[i - 1];
        return !!(m && prev && (prev.slots[2 * k] || prev.slots[2 * k + 1]));
      });
    });
    return { columns: columns, third: third };
  }

  function bracketMatch(m, seedById) {
    var final = m.status === 'final';
    var showScore = m.status === 'live' || final;
    var sets = isSetMatch(m);
    var row = function (p) {
      var win = final && !!m.winnerId && m.winnerId === p.id;
      var lose = final && !!m.winnerId && !win;
      var score = sets ? p.sets : p.legs;
      var seed = p.id && seedById[p.id];
      return el('div', { className: 'bmatch__row' + (win ? ' is-winner' : '') + (lose ? ' is-loser' : '') + (p.id ? '' : ' is-tbd') }, [
        seed ? el('span', { className: 'bmatch__seed', text: String(seed), 'aria-label': 'シード ' + seed }) : null,
        el('span', { className: 'bmatch__name', text: p.id ? p.name : '未定', title: p.id ? p.name : null }),
        win ? el('span', { className: 'visually-hidden', text: '（勝者）' }) : null,
        sets && showScore && p.legs !== null && p.legs !== undefined ? el('span', { className: 'bmatch__legs', text: legsText(p.legs), 'aria-label': 'Leg 合計 ' + legsText(p.legs) }) : null,
        el('span', { className: 'bmatch__score', text: showScore ? legsText(score) : '' }),
      ]);
    };
    var showStatus = m.status === 'live' || m.status === 'check';
    return el('div', { className: 'bmatch bmatch--' + m.status, 'data-match-id': m.id }, [
      showStatus ? el('span', { className: 'bmatch__status status status--' + m.status, text: STATUS_LABEL[m.status] }) : el('span', { className: 'visually-hidden', text: STATUS_LABEL[m.status] || '' }),
      row(m.p1),
      row(m.p2),
    ]);
  }

  function roundTitle(label, bestOf, extra) {
    return el('h3', { className: 'bracket__title' + (extra ? ' ' + extra : '') }, [label, bestOf ? el('span', { className: 'bracket__bestof', text: ' Bo' + bestOf }) : null]);
  }

  /**
   * トーナメント表: 回戦ごとの列に試合を枠の位置で並べ、勝ち上がりを線でつなぐ。
   * 列数が多く画面に収まらないとき（スマートフォンなど）は、表の中だけ横にスクロールする。
   */
  function renderBracket(stage) {
    var layout = bracketLayout(stage.rounds);
    if (!layout.columns.length) return el('p', { className: 'empty', text: '組み合わせはまだ決まっていません。' });
    var seedById = {};
    (stage.entrants || []).forEach(function (e) {
      if (e.seed) seedById[e.id] = e.seed;
    });
    var n = layout.columns.length;
    var items = [];
    layout.columns.forEach(function (c, i) {
      var col = ' bracket__col--' + (i + 1);
      items.push(roundTitle(c.label, c.bestOf, 'bracket__cell' + col));
      items.push(
        el(
          'ol',
          { className: 'bracket__round bracket__cell' + col + (i === n - 1 ? ' is-last' : ''), 'aria-label': c.label },
          c.slots.map(function (m, k) {
            return el('li', { className: 'bracket__slot' + (m ? '' : ' is-empty') + (c.fed[k] ? ' is-fed' : '') }, [m ? bracketMatch(m, seedById) : null]);
          })
        )
      );
    });
    if (layout.third.length) {
      var col = ' bracket__col--' + n;
      items.push(
        el('div', { className: 'bracket__third bracket__cell' + col }, [
          roundTitle(THIRD_PLACE_LABEL, layout.third[0].bestOf),
          el(
            'ol',
            { className: 'matches--third', 'aria-label': THIRD_PLACE_LABEL },
            layout.third.map(function (m) {
              return el('li', null, [bracketMatch(m, seedById)]);
            })
          ),
        ])
      );
    }
    return el('div', { className: 'bracket' }, [
      el('div', { className: 'bracket__scroll', 'data-stage': stage.id, tabindex: '0', 'aria-label': 'トーナメント表' }, [
        el('div', { className: 'bracket__grid bracket__grid--' + Math.min(n, 7) }, items),
      ]),
      el('p', { className: 'bracket__hint', text: '表は横にスクロールできます' }),
    ]);
  }

  /** 横にはみ出しているトーナメント表にだけ「横にスクロールできます」を出す */
  function updateBracketHints(root) {
    if (!root || !root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll('.bracket'), function (b) {
      var sc = b.querySelector('.bracket__scroll');
      b.classList.toggle('is-scrollable', !!sc && sc.scrollWidth > sc.clientWidth + 1);
    });
  }

  function renderStage(stage, groupFilter) {
    var p = stage.progress || { final: 0, total: 0, live: 0 };
    var notes = [];
    if (stage.groups && stageRanked(stage)) {
      notes.push(
        '順位の決め方: ' +
          stage.tiebreakers
            .map(function (k) {
              return TIEBREAKER_LABEL[k] || k;
            })
            .join(' → ') +
          '（並んだ場合は運営が決定。「同」は順位が未確定）'
      );
    }
    if (stage.cycles > 1) notes.push('各対戦を ' + stage.cycles + ' 回行います。');
    var body = stage.groups ? renderGroupStage(stage, groupFilter) : renderBracket(stage);
    return el('section', { className: 'stage stage--' + stage.type, id: 'stage-' + stage.id, 'aria-labelledby': 'stage-title-' + stage.id }, [
      stage.name
        ? el('header', { className: 'stage__head' }, [
            el('h2', { className: 'stage__title', id: 'stage-title-' + stage.id, text: stage.name }),
            el('span', { className: 'stage__meta', text: [STAGE_TYPE_LABEL[stage.type] !== stage.name ? STAGE_TYPE_LABEL[stage.type] || '' : '', ruleText(stage.rule), '確定 ' + p.final + ' / ' + p.total].filter(Boolean).join('・') }),
          ])
        : null,
      stage.champion ? el('p', { className: 'champion' }, [el('span', { className: 'champion__label', text: '優勝' }), el('strong', { text: stage.champion.name })]) : null,
      body,
      notes.length ? el('p', { className: 'stage__note', text: notes.join(' ') }) : null,
    ]);
  }

  function legacyStage(data) {
    return { id: 'main', name: '', type: 'round_robin', groups: data.groups || [], progress: data.progress, rule: data.rule };
  }

  function eventStages(data) {
    return data.stages && data.stages.length ? data.stages : [legacyStage(data)];
  }

  function renderEvent(root, data, filter) {
    var f = typeof filter === 'string' ? { stage: 'all', group: filter } : filter || {};
    var stages = eventStages(data);
    // 自動更新で描き直しても、トーナメント表の横スクロールの位置を保つ
    var scrolled = {};
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('.bracket__scroll') : [], function (sc) {
      scrolled[sc.getAttribute('data-stage')] = sc.scrollLeft;
    });
    root.textContent = '';
    var visible = stages.filter(function (s) {
      return !f.stage || f.stage === 'all' || s.id === f.stage;
    });
    if (!stages.length || (stages.length === 1 && stages[0].groups && !stages[0].groups.length)) {
      root.appendChild(el('p', { className: 'empty', text: 'グループはまだ登録されていません。' }));
      return;
    }
    visible.forEach(function (s) {
      root.appendChild(renderStage(s, f.group));
    });
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('.bracket__scroll') : [], function (sc) {
      var left = scrolled[sc.getAttribute('data-stage')];
      if (left) sc.scrollLeft = left;
    });
    updateBracketHints(root);
  }

  /* ---------- QR コード ---------- */

  /**
   * 同梱の qrcode-generator（グローバルの qrcode）で URL の QR コードを SVG にする。
   * ライブラリがない環境（Apps Script の画面）では null を返し、QR は出さない。
   */
  function qrSvg(text, label) {
    var lib = global.qrcode;
    if (typeof lib !== 'function' || !text) return null;
    var qr = lib(0, 'M');
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var quiet = 4;
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h1v1h-1z';
      }
    }
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    var size = n + quiet * 2;
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

  /** この大会の閲覧ページの URL（QR 用）。http(s) で開いているときだけ作る */
  function shareUrl(loc, eventId) {
    if (!loc || !/^https?:$/.test(loc.protocol) || !eventId) return '';
    return loc.origin + loc.pathname + '?event=' + encodeURIComponent(eventId);
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
      qrPanel: $('qr-panel'),
      qrCode: $('qr-code'),
      qrButton: $('qr-button'),
      qrOverlay: $('qr-overlay'),
      qrOverlayCode: $('qr-overlay-code'),
      qrOverlayUrl: $('qr-overlay-url'),
      qrClose: $('qr-close'),
    };
    var qrState = { url: '' };
    var view = { data: null, filter: { stage: 'all', group: 'all' }, lastError: null, eventId: '' };

    function showBanner(kind, text) {
      ui.banner.hidden = !text;
      ui.banner.className = 'banner banner--' + kind;
      ui.banner.textContent = text || '';
    }

    function chipRow(label, items, current, onPick) {
      var row = el('div', { className: 'filter__row', role: 'group', 'aria-label': label });
      items.forEach(function (it) {
        var b = el('button', { type: 'button', className: 'chip', 'aria-pressed': String(current === it.id), text: it.name });
        b.addEventListener('click', function () {
          onPick(it.id);
          renderFilter();
          renderEvent(ui.groups, view.data, view.filter);
        });
        row.appendChild(b);
      });
      return row;
    }

    function renderFilter() {
      ui.filter.textContent = '';
      var stages = view.data ? eventStages(view.data) : [];
      if (stages.length > 1) {
        ui.filter.appendChild(
          chipRow('ステージ', [{ id: 'all', name: 'すべて' }].concat(stages), view.filter.stage, function (id) {
            view.filter = { stage: id, group: 'all' };
          })
        );
      }
      // 表示中のグループ ステージが 1 つで、グループが 2 つ以上ならグループで絞り込める
      var shown = stages.filter(function (s) {
        return view.filter.stage === 'all' || s.id === view.filter.stage;
      });
      var groupStages = shown.filter(function (s) {
        return s.groups;
      });
      if (groupStages.length === 1 && groupStages[0].groups.length > 1) {
        ui.filter.appendChild(
          chipRow('グループ', [{ id: 'all', name: 'すべて' }].concat(groupStages[0].groups), view.filter.group, function (id) {
            view.filter = { stage: view.filter.stage, group: id };
          })
        );
      }
      ui.filter.hidden = !ui.filter.childNodes.length;
    }

    function renderData() {
      var d = view.data;
      ui.message.hidden = true;
      ui.title.textContent = d.event.name;
      doc.title = d.event.name + ' | n02 Tournament';
      ui.date.textContent = d.event.dateLabel || '';
      ui.eventStatus.textContent = EVENT_STATUS_LABEL[d.event.status] || '';
      var stages = eventStages(d);
      var known = {};
      stages.forEach(function (s) {
        known[s.id] = true;
        (s.groups || []).forEach(function (g) {
          known[g.id] = true;
        });
      });
      if (view.filter.stage !== 'all' && !known[view.filter.stage]) view.filter = { stage: 'all', group: 'all' };
      if (view.filter.group !== 'all' && !known[view.filter.group]) view.filter = { stage: view.filter.stage, group: 'all' };
      // ステージごとにルールが違うときは、各ステージの見出しに表示する
      var rule = stages.length === 1 ? stages[0].rule || d.rule : null;
      ui.rule.hidden = !ruleText(rule);
      ui.rule.textContent = ruleText(rule);
      ui.updated.textContent = formatTime(d.dataUpdatedAt);
      renderQr(d);
      renderFilter();
      renderEvent(ui.groups, d, view.filter);
    }

    /**
     * QR コード: 内容の右に余白がある広い画面（店内モニターなど）では右下に固定表示し、スクロールしても追従する。
     * 内容は動かさない。余白がなければ固定表示は出さない（CSS）。
     * スマートフォンでは「QR コード」ボタンで大きく表示する。?qr=0 で固定表示をやめ、?qr=1 で幅に関係なく固定表示する。
     */
    function renderQr(d) {
      if (!ui.qrPanel) return;
      var url = shareUrl(win.location, d.event.id);
      if (url === qrState.url) return;
      var svg = qrSvg(url, 'この大会の閲覧ページの QR コード');
      if (!svg) return;
      qrState.url = url;
      ui.qrCode.textContent = '';
      ui.qrCode.appendChild(svg);
      ui.qrOverlayCode.textContent = '';
      ui.qrOverlayCode.appendChild(qrSvg(url, 'この大会の閲覧ページの QR コード（拡大）'));
      ui.qrOverlayUrl.textContent = url;
      ui.qrPanel.hidden = params.qr === '0';
      if (params.qr === '1') doc.body.classList.add('qr-forced');
      ui.qrButton.hidden = false;
    }

    function openQr(open) {
      ui.qrOverlay.hidden = !open;
      if (open) ui.qrClose.focus();
      else ui.qrButton.focus();
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
    // 自動更新の間隔を決めるための記録: 最後にデータが変わった時刻（ページ側で変化に気づいた時刻も含む）
    var activity = { lastChangeAt: Date.now(), seenVersion: '', plan: { mode: 'normal' } };

    function nextDelay(res, normalMs) {
      var d = res.ok ? view.data : null;
      if (res.ok && res.version && res.version !== activity.seenVersion) {
        var updated = d && Date.parse(d.dataUpdatedAt);
        // 最初に開いたときはデータの更新時刻、開いている間に変わったら気づいた時刻
        activity.lastChangeAt = activity.seenVersion ? Date.now() : isFinite(updated) && updated > 0 ? Math.min(updated, Date.now()) : Date.now();
        activity.seenVersion = res.version;
      }
      activity.plan = refreshPlan({
        now: Date.now(),
        lastChangeAt: activity.lastChangeAt,
        finished: !!(d && d.event && d.event.status === 'finished'),
        allFinal: allMatchesFinal(d),
        normalMs: normalMs,
      });
      return activity.plan.delayMs;
    }
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

    var STOP_REASON = { finished: '大会終了のため停止中', allFinal: '全試合確定のため停止中', idle: '14 日間更新がないため停止中' };

    function tick() {
      if (!poller) return;
      var s = poller.state();
      var plan = activity.plan;
      if (s.inFlight) ui.next.textContent = '取得中…';
      else if (s.halted) ui.next.textContent = (STOP_REASON[plan.reason] || '停止中') + '（「今すぐ更新」で確認）';
      else if (!s.nextAt) ui.next.textContent = '画面表示中に再開';
      else {
        var sec = Math.max(0, Math.ceil((s.nextAt - Date.now()) / 1000));
        var left = sec >= 120 ? '約 ' + Math.round(sec / 60) + ' 分後' : '約 ' + sec + ' 秒後';
        ui.next.textContent = plan.mode === 'slow' ? left + '（更新が少ないため ' + Math.round(plan.everyMs / MINUTE) + ' 分ごと）' : left;
      }
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
        nextDelay: nextDelay,
      });
      if (ui.qrButton) {
        ui.qrButton.addEventListener('click', function () {
          openQr(true);
        });
        ui.qrClose.addEventListener('click', function () {
          openQr(false);
        });
        ui.qrOverlay.addEventListener('click', function (e) {
          if (e.target === ui.qrOverlay) openQr(false);
        });
        doc.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && !ui.qrOverlay.hidden) openQr(false);
        });
      }
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
      win.addEventListener('resize', function () {
        updateBracketHints(ui.groups);
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
    bracketLayout: bracketLayout,
    refreshPlan: refreshPlan,
    allMatchesFinal: allMatchesFinal,
    shareUrl: shareUrl,
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
