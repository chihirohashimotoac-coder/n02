/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament - 画面の動きと操作の共通部品（GitHub Pages のポータル・閲覧ページで使う）
 *
 * - toast: 画面下の短いお知らせ（読み上げあり。エラーは長めに出す）
 * - pullToRefresh: スマートフォンで一番上から下に引っぱって離すと更新する（タッチ操作の端末だけ）
 * - countUp: 数字を 0 から目標の値まで数え上げる（インフォグラフィックの数字）
 * - kinetic: 見出しの文字を 1 字ずつ順に立ち上げる（最初の 1 回だけ。終わったら元の文字に戻す）
 * - combobox: 入力欄の候補（オートコンプリート）。WAI-ARIA の combobox パターン、IME の変換中は候補を出さない
 * 動きはすべて「視差効果を減らす」設定（prefers-reduced-motion）では出さない。
 * 文字はすべて textContent で入れる（innerHTML は使わない）。
 */
(function (global) {
  'use strict';

  var doc = global.document;

  function reducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function make(tag, className, text) {
    var n = doc.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* ---------- トースト ---------- */

  var toastHost = null;
  var TOAST_MARK = { ok: '✓', info: 'i', warn: '!', error: '!' };

  function toast(kind, text, opts) {
    if (!doc || !text) return null;
    if (!toastHost) {
      toastHost = doc.getElementById('toast') || make('div', 'toast-box');
      if (!toastHost.parentNode) doc.body.appendChild(toastHost);
      toastHost.classList.add('ux-toasts');
      toastHost.setAttribute('aria-live', 'polite');
    }
    var k = TOAST_MARK[kind] ? kind : 'info';
    var item = make('div', 'ux-toast ux-toast--' + k);
    item.setAttribute('role', k === 'error' ? 'alert' : 'status');
    var mark = make('span', 'ux-toast__mark', TOAST_MARK[k]);
    mark.setAttribute('aria-hidden', 'true');
    item.appendChild(mark);
    item.appendChild(make('span', 'ux-toast__text', text));
    toastHost.appendChild(item);
    // 同時に出すのは 3 件まで（古いものから消す）
    while (toastHost.querySelectorAll('.ux-toast').length > 3) toastHost.removeChild(toastHost.querySelector('.ux-toast'));
    var ms = (opts && opts.duration) || (k === 'error' ? 8000 : 3600);
    global.setTimeout(function () {
      item.classList.add('is-leaving');
      global.setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, reducedMotion() ? 0 : 240);
    }, ms);
    return item;
  }

  /* ---------- プルトゥリフレッシュ ---------- */

  /**
   * opts = { onRefresh: () => Promise, threshold?: px, label? }
   * 一番上までスクロールした状態で下へ引くと、上に丸い印が出て、閾値を超えて離すと onRefresh を呼ぶ。
   * ダイアログ表示中・入力欄の操作中・横スクロールの中では反応しない。ブラウザ標準の「引っぱって再読み込み」は CSS で止める。
   */
  function pullToRefresh(opts) {
    if (!doc || !('ontouchstart' in global)) return null;
    var threshold = opts.threshold || 72;
    var root = doc.documentElement;
    root.classList.add('ux-ptr-enabled');
    var box = make('div', 'ux-ptr');
    box.setAttribute('aria-hidden', 'true');
    var ring = make('span', 'ux-ptr__ring');
    var label = make('span', 'ux-ptr__label', '引っぱって更新');
    box.appendChild(ring);
    box.appendChild(label);
    doc.body.appendChild(box);
    var live = make('p', 'visually-hidden');
    live.setAttribute('role', 'status');
    doc.body.appendChild(live);

    var start = null;
    var pull = 0;
    var busy = false;

    function setPull(px) {
      pull = px;
      var p = Math.min(1, px / threshold);
      box.style.setProperty('--ptr-y', Math.min(px, threshold * 1.4).toFixed(1) + 'px');
      box.style.setProperty('--ptr-p', p.toFixed(3));
      box.classList.toggle('is-visible', px > 4);
      box.classList.toggle('is-armed', px >= threshold);
      label.textContent = px >= threshold ? '離して更新' : '引っぱって更新';
    }

    function blocked(target) {
      if (doc.querySelector('dialog[open]')) return true;
      for (var n = target; n && n !== doc.body; n = n.parentNode) {
        if (n.nodeType !== 1) continue;
        var tag = n.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (n.scrollTop > 0) return true;
        if (n.classList && (n.classList.contains('bracket__scroll') || n.classList.contains('ux-combobox__list'))) return true;
      }
      return false;
    }

    doc.addEventListener(
      'touchstart',
      function (e) {
        if (busy || e.touches.length !== 1 || (global.scrollY || root.scrollTop) > 0 || blocked(e.target)) {
          start = null;
          return;
        }
        start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      },
      { passive: true }
    );
    doc.addEventListener(
      'touchmove',
      function (e) {
        if (!start) return;
        var dx = e.touches[0].clientX - start.x;
        var dy = e.touches[0].clientY - start.y;
        if (dy <= 0 || Math.abs(dx) > dy) {
          if (pull) setPull(0);
          if (dy < -4) start = null;
          return;
        }
        // 引くほど重くなる（指の移動の半分強だけ下がる）
        setPull(dy * 0.55);
        if (e.cancelable) e.preventDefault();
      },
      { passive: false }
    );
    function end() {
      if (!start) return;
      start = null;
      if (pull < threshold) {
        setPull(0);
        return;
      }
      busy = true;
      box.classList.add('is-refreshing');
      label.textContent = '更新しています…';
      live.textContent = '更新しています';
      setPull(threshold);
      Promise.resolve()
        .then(opts.onRefresh)
        .catch(function () {})
        .then(function () {
          busy = false;
          box.classList.remove('is-refreshing');
          live.textContent = '';
          setPull(0);
        });
    }
    doc.addEventListener('touchend', end, { passive: true });
    doc.addEventListener('touchcancel', end, { passive: true });
    return { element: box };
  }

  /* ---------- 数え上げ ---------- */

  /** el の数字を from（既定は今の表示）から to まで数え上げる。format(n) で表示を整える */
  function countUp(el, to, opts) {
    if (!el) return;
    var o = opts || {};
    var format =
      o.format ||
      function (n) {
        return String(n);
      };
    var target = Number(to) || 0;
    var prev = el.getAttribute('data-count');
    var from = o.from !== undefined ? o.from : prev === null ? 0 : Number(prev) || 0;
    el.setAttribute('data-count', String(target));
    if (el.__uxRaf) global.cancelAnimationFrame(el.__uxRaf);
    if (from === target || reducedMotion() || !global.requestAnimationFrame) {
      el.textContent = format(target);
      return;
    }
    var duration = o.duration || 900;
    var t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      var k = Math.min(1, (t - t0) / duration);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = format(Math.round(from + (target - from) * eased));
      if (k < 1) el.__uxRaf = global.requestAnimationFrame(step);
    }
    el.textContent = format(from);
    el.__uxRaf = global.requestAnimationFrame(step);
  }

  /* ---------- キネティックタイポグラフィ ---------- */

  /** 見出しの文字を 1 字ずつ立ち上げる。文字そのものは変えず（1 字ずつの span に分けるだけ）、終わったら元の 1 つの文字列に戻す */
  function kinetic(el, opts) {
    if (!el || reducedMotion()) return;
    var text = el.textContent;
    if (!text || el.getAttribute('data-kinetic') === 'done') return;
    el.setAttribute('data-kinetic', 'done');
    var step = (opts && opts.step) || 45;
    var chars = Array.from ? Array.from(text) : text.split('');
    el.textContent = '';
    el.classList.add('ux-kinetic');
    chars.forEach(function (c, i) {
      var s = make('span', 'ux-kinetic__char', c);
      s.style.setProperty('--i', String(i));
      s.style.setProperty('--step', step + 'ms');
      el.appendChild(s);
    });
    global.setTimeout(function () {
      // 描き直しで別の文字に変わっていたら触らない
      if (el.classList.contains('ux-kinetic') && el.querySelector('.ux-kinetic__char')) {
        el.classList.remove('ux-kinetic');
        el.textContent = text;
      }
    }, chars.length * step + 700);
  }

  /* ---------- オートコンプリート（combobox） ---------- */

  /**
   * opts = { input, getItems(query) -> [{ id, label, meta? }], onPick(item), max?, emptyText? }
   * 候補は入力欄の下に出し、↑↓ で選んで Enter で決定、Esc で閉じる。マウス・タップでも選べる。
   */
  var comboSeq = 0;
  function combobox(opts) {
    var input = opts.input;
    var max = opts.max || 8;
    var id = 'ux-combo-' + ++comboSeq;
    var wrap = input.parentNode;
    wrap.classList.add('ux-combobox');
    var list = make('ul', 'ux-combobox__list');
    list.id = id + '-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', list.id);
    var items = [];
    var active = -1;
    var composing = false;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }
    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(list.children, function (li, k) {
        li.classList.toggle('is-active', k === i);
        li.setAttribute('aria-selected', k === i ? 'true' : 'false');
      });
      if (i >= 0 && list.children[i]) {
        input.setAttribute('aria-activedescendant', list.children[i].id);
        if (list.children[i].scrollIntoView) list.children[i].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      var it = items[i];
      if (!it) return;
      close();
      opts.onPick(it);
    }
    function open() {
      if (composing) return;
      var q = input.value;
      items = q.trim() ? (opts.getItems(q) || []).slice(0, max) : [];
      list.textContent = '';
      if (!items.length) {
        close();
        return;
      }
      items.forEach(function (it, i) {
        var li = make('li', 'ux-combobox__option');
        li.id = id + '-opt-' + i;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.appendChild(make('span', 'ux-combobox__label', it.label));
        if (it.meta) li.appendChild(make('span', 'ux-combobox__meta', it.meta));
        li.addEventListener('mousedown', function (e) {
          e.preventDefault();
        });
        li.addEventListener('click', function () {
          pick(i);
        });
        list.appendChild(li);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
    }
    input.addEventListener('compositionstart', function () {
      composing = true;
      close();
    });
    input.addEventListener('compositionend', function () {
      composing = false;
      open();
    });
    input.addEventListener('input', function (e) {
      if (composing || e.isComposing) return;
      open();
    });
    input.addEventListener('focus', function () {
      if (input.value.trim()) open();
    });
    input.addEventListener('blur', function () {
      global.setTimeout(close, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.isComposing || composing) return;
      if (e.key === 'ArrowDown') {
        if (list.hidden) open();
        if (items.length) setActive((active + 1) % items.length);
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        if (items.length) setActive(active <= 0 ? items.length - 1 : active - 1);
        e.preventDefault();
      } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
        e.preventDefault();
        pick(active);
      } else if (e.key === 'Escape' && !list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    return { close: close, refresh: open };
  }

  global.TPUX = { reducedMotion: reducedMotion, toast: toast, pullToRefresh: pullToRefresh, countUp: countUp, kinetic: kinetic, combobox: combobox };
})(typeof window !== 'undefined' ? window : this);
