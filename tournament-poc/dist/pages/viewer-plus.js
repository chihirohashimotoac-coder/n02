/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament - 閲覧ページ（GitHub Pages）の操作と動き
 *
 * viewer.js（取得・自動更新・描画）はそのままにして、描画の知らせ（tpoc:viewer イベント）を受けて次を足す。
 * - 大会の進み具合（インフォグラフィック）: 全体と段階ごとの確定・進行中・未開始を帯と数字で。変わった分だけ動く
 * - 選手を探す（オートコンプリート）: 名前の候補から選ぶと、その選手の試合と順位表の行を強調する
 * - 更新された試合を一瞬強調し、手動更新・引っぱって更新の結果をトーストで伝える
 * - 引っぱって更新（スマートフォン）: 「今すぐ更新」と同じ（短い間隔での連続更新は viewer.js が止める）
 * - 優勝者が決まったときだけ、その名前を 1 字ずつ立ち上げる（キネティックタイポグラフィ）
 * 自動更新の間隔・停止の規則（viewer.js の refreshPlan）には関わらない。
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var UX = global.TPUX;
  if (!doc || !UX) return;

  function $(id) {
    return doc.getElementById(id);
  }
  function make(tag, className, text) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function normalize(value) {
    var s = String(value || '');
    if (s.normalize) s = s.normalize('NFKC');
    return s
      .toLowerCase()
      .replace(/[ぁ-ゖ]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) + 0x60);
      })
      .replace(/\s+/g, '');
  }

  function stagesOf(data) {
    return data && data.stages && data.stages.length ? data.stages : data ? [{ id: 'main', name: '', groups: data.groups || [], progress: data.progress }] : [];
  }

  function allMatches(data) {
    var out = [];
    stagesOf(data).forEach(function (st) {
      (st.groups || []).forEach(function (g) {
        out = out.concat(g.matches || []);
      });
      (st.rounds || []).forEach(function (r) {
        out = out.concat(r.matches || []);
      });
    });
    return out;
  }

  function players(data) {
    var seen = {};
    var out = [];
    var add = function (p) {
      if (p && p.id && p.name && !seen[p.id]) {
        seen[p.id] = true;
        out.push({ id: p.id, name: p.name });
      }
    };
    stagesOf(data).forEach(function (st) {
      (st.groups || []).forEach(function (g) {
        (g.players || []).forEach(add);
      });
      (st.entrants || []).forEach(add);
    });
    allMatches(data).forEach(function (m) {
      add(m.p1);
      add(m.p2);
    });
    return out;
  }

  /* ---------- 大会の進み具合（インフォグラフィック） ---------- */

  var overview = $('overview');
  var bars = {};

  function percent(p) {
    return p && p.total ? Math.floor((p.final * 100) / p.total) : 0;
  }

  function renderOverview(data) {
    if (!overview) return;
    var stages = stagesOf(data).filter(function (s) {
      return s.progress;
    });
    var total = data.progress || { total: 0, final: 0, live: 0 };
    if (!total.total) {
      overview.hidden = true;
      return;
    }
    overview.hidden = false;
    if (!overview.firstChild) {
      var head = make('div', 'overview__head');
      var big = make('p', 'overview__pct');
      var num = make('b', 'overview__num', '0');
      big.appendChild(num);
      big.appendChild(make('span', 'overview__unit', '%'));
      head.appendChild(big);
      var counts = make('p', 'overview__counts');
      head.appendChild(counts);
      overview.appendChild(head);
      overview.appendChild(make('div', 'overview__stages'));
    }
    var allDone = total.final === total.total && stages.every(function (s) {
      return s.progress && s.progress.total > 0;
    });
    // 対戦表がまだない段階があるうちは 100% にしない（ポータルの一覧と同じ考え方）
    var pct = Math.min(percent(total), allDone ? 100 : 99);
    UX.countUp(overview.querySelector('.overview__num'), pct);
    var counts = overview.querySelector('.overview__counts');
    counts.textContent = '';
    [
      ['確定', total.final, 'final'],
      ['進行中', total.live || 0, 'live'],
      ['未開始', Math.max(0, total.total - total.final - (total.live || 0)), 'rest'],
    ].forEach(function (c) {
      var item = make('span', 'overview__count overview__count--' + c[2]);
      item.appendChild(make('span', 'overview__dot'));
      item.appendChild(doc.createTextNode(c[0] + ' '));
      item.appendChild(make('b', null, String(c[1])));
      counts.appendChild(item);
    });
    var list = overview.querySelector('.overview__stages');
    list.textContent = '';
    stages.forEach(function (s) {
      var p = s.progress || { total: 0, final: 0, live: 0 };
      var row = make('div', 'ov-stage');
      row.appendChild(make('span', 'ov-stage__name', s.name || '全体'));
      var track = make('span', 'ov-stage__track');
      track.setAttribute('role', 'img');
      if (p.total) {
        track.setAttribute('aria-label', (s.name || '全体') + ' 確定 ' + p.final + ' / ' + p.total + ' 試合' + (p.live ? '・進行中 ' + p.live : ''));
        var fin = make('span', 'ov-stage__final');
        var live = make('span', 'ov-stage__live');
        var key = s.id || 'main';
        var from = bars[key] || { f: 0, l: 0 };
        var to = { f: (p.final * 100) / p.total, l: ((p.live || 0) * 100) / p.total };
        bars[key] = to;
        // 前回の幅から今回の幅へ伸ばす（変わっていなければ動かない）
        fin.style.setProperty('--w', from.f + '%');
        live.style.setProperty('--l', from.f + '%');
        live.style.setProperty('--w', from.l + '%');
        track.appendChild(fin);
        track.appendChild(live);
        global.requestAnimationFrame(function () {
          global.requestAnimationFrame(function () {
            fin.style.setProperty('--w', to.f + '%');
            live.style.setProperty('--l', to.f + '%');
            live.style.setProperty('--w', to.l + '%');
          });
        });
      } else {
        track.classList.add('is-pending');
        track.setAttribute('aria-label', (s.name || '全体') + ' 対戦表は未作成');
      }
      row.appendChild(track);
      row.appendChild(make('span', 'ov-stage__value', p.total ? p.final + ' / ' + p.total : '未作成'));
      list.appendChild(row);
    });
  }

  /* ---------- 選手を探す（オートコンプリート） ---------- */

  var search = $('player-search');
  var focus = null; // { id, name }
  var input = null;
  var chip = null;

  function setupSearch() {
    if (!search || input) return;
    search.hidden = false;
    var label = make('label', 'player-search__label', '選手を探す');
    label.setAttribute('for', 'player-q');
    var field = make('div', 'player-search__field');
    input = make('input', 'player-search__input');
    input.id = 'player-q';
    input.type = 'search';
    input.autocomplete = 'off';
    input.setAttribute('enterkeyhint', 'search');
    input.placeholder = '名前の一部を入力';
    field.appendChild(input);
    chip = make('p', 'player-search__chip');
    chip.hidden = true;
    search.appendChild(label);
    search.appendChild(field);
    search.appendChild(chip);
    UX.combobox({
      input: input,
      max: 8,
      getItems: function (text) {
        var q = normalize(text);
        return players(current)
          .filter(function (p) {
            return normalize(p.name).indexOf(q) >= 0;
          })
          .map(function (p) {
            var n = allMatches(current).filter(function (m) {
              return m.p1.id === p.id || m.p2.id === p.id;
            }).length;
            return { id: p.id, label: p.name, meta: n + ' 試合', player: p };
          });
      },
      onPick: function (item) {
        setFocus(item.player);
        input.value = '';
        var first = doc.querySelector('.is-focus');
        if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: UX.reducedMotion() ? 'auto' : 'smooth' });
      },
    });
  }

  function setFocus(p) {
    focus = p;
    chip.textContent = '';
    chip.hidden = !p;
    if (p) {
      chip.appendChild(doc.createTextNode(p.name + ' の試合を強調しています'));
      var clear = make('button', 'player-search__clear', '解除');
      clear.type = 'button';
      clear.setAttribute('aria-label', p.name + ' の強調を解除');
      clear.addEventListener('click', function () {
        setFocus(null);
        input.focus();
      });
      chip.appendChild(clear);
    }
    applyFocus();
  }

  function applyFocus() {
    var root = $('groups');
    if (!root) return;
    root.classList.toggle('has-focus', !!focus);
    Array.prototype.forEach.call(root.querySelectorAll('.is-focus'), function (n) {
      n.classList.remove('is-focus');
    });
    if (!focus) return;
    var ids = {};
    allMatches(current).forEach(function (m) {
      if (m.p1.id === focus.id || m.p2.id === focus.id) ids[m.id] = true;
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-match-id]'), function (n) {
      if (ids[n.getAttribute('data-match-id')]) n.classList.add('is-focus');
    });
    // 順位表の行（選手名の見出しセル）
    Array.prototype.forEach.call(root.querySelectorAll('.summary tbody th'), function (th) {
      if (th.textContent === focus.name) th.parentNode.classList.add('is-focus');
    });
  }

  /* ---------- 更新された試合の強調・トースト・優勝者 ---------- */

  function changedMatches(prev, next) {
    if (!prev) return [];
    var before = {};
    allMatches(prev).forEach(function (m) {
      before[m.id] = m;
    });
    return allMatches(next).filter(function (m) {
      var b = before[m.id];
      if (!b) return false;
      return b.status !== m.status || b.p1.legs !== m.p1.legs || b.p2.legs !== m.p2.legs || b.p1.sets !== m.p1.sets || b.p2.sets !== m.p2.sets;
    });
  }

  function flash(matches) {
    matches.forEach(function (m) {
      var n = doc.querySelector('[data-match-id="' + m.id + '"]');
      if (n) n.classList.add('is-updated');
    });
  }

  var champions = {};
  function celebrate(data, first) {
    stagesOf(data).forEach(function (s) {
      var name = s.champion && s.champion.name;
      var key = s.id || 'main';
      if (!name) {
        delete champions[key];
        return;
      }
      var el = doc.querySelector('#stage-' + key + ' .champion strong');
      // 開いたときにもう決まっていたら一度だけ、開いている間に決まったらそのときに
      if (el && champions[key] !== name) UX.kinetic(el, { step: first ? 60 : 80 });
      champions[key] = name;
    });
  }

  /* ---------- 描画の知らせを受ける ---------- */

  var current = null;
  var firstRender = true;

  doc.addEventListener('tpoc:viewer', function (e) {
    var d = e.detail || {};
    if (d.type === 'render' && d.data) {
      current = d.data;
      setupSearch();
      if (!d.filterOnly) renderOverview(d.data);
      applyFocus();
      celebrate(d.data, firstRender);
      firstRender = false;
    } else if (d.type === 'result') {
      var changed = changedMatches(d.previous, d.data);
      if (changed.length) flash(changed);
      if (d.reason === 'manual') {
        var finals = changed.filter(function (m) {
          return m.status === 'final';
        }).length;
        if (changed.length) UX.toast('ok', finals ? finals + ' 試合の結果が確定しました。' : changed.length + ' 試合の結果が更新されました。');
        else UX.toast('ok', '最新の状態です。');
      } else if (changed.length) {
        var f = changed.filter(function (m) {
          return m.status === 'final';
        }).length;
        if (f) UX.toast('info', f + ' 試合の結果が確定しました。');
      }
    } else if (d.type === 'empty') {
      current = null;
      if (overview) overview.hidden = true;
      if (search) search.hidden = true;
    } else if (d.type === 'failure' && d.reason === 'manual') {
      UX.toast('error', '更新できませんでした。通信状態を確認してください。');
    }
  });

  /* ---------- 引っぱって更新 ---------- */

  UX.pullToRefresh({
    onRefresh: function () {
      var button = $('refresh-button');
      if (!button) return null;
      return new Promise(function (resolve) {
        var done = function (e) {
          var t = e.detail && e.detail.type;
          if (t === 'result' || t === 'failure' || t === 'empty') {
            doc.removeEventListener('tpoc:viewer', done);
            resolve();
          }
        };
        var started = function (e) {
          if (e.detail && e.detail.type === 'refresh-requested') {
            doc.removeEventListener('tpoc:viewer', started);
            if (e.detail.result === 'started') doc.addEventListener('tpoc:viewer', done);
            else {
              if (e.detail.result === 'throttled') UX.toast('info', '少し時間をおいてから更新してください。');
              resolve();
            }
          }
        };
        doc.addEventListener('tpoc:viewer', started);
        button.click();
        // 念のため 15 秒で印を戻す
        global.setTimeout(resolve, 15000);
      });
    },
  });

  global.TPViewerPlus = { changedMatches: changedMatches, players: players, normalize: normalize };
})(typeof window !== 'undefined' ? window : this);
