/* 確認用プレビューだけで使う「模擬 Google ログイン」。
 * 本物の Google Identity Services（accounts.google.com/gsi/client）の代わりに読み込み、同じ関数（initialize・renderButton など）を用意する。
 * ボタンは本物と同じく「Google でログイン」の 1 つだけ。押すと本物と同じようにアカウントの選択が開き、
 * 選んだテスト用アカウントの ID トークン（模擬 tokeninfo だけが受け付ける形）を渡す。本物の Google には接続しない。 */
(function () {
  'use strict';
  var config = null;
  function preview() {
    return window.TPOC_PREVIEW;
  }
  function css(node, rules) {
    Object.keys(rules).forEach(function (k) {
      node.style.setProperty(k, rules[k]);
    });
  }

  function chooseAccount(onPick) {
    var back = document.createElement('div');
    css(back, { position: 'fixed', inset: '0', 'z-index': '2147483001', background: 'rgba(0,0,0,.45)', display: 'grid', 'place-items': 'center', padding: '16px' });
    var box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'アカウントの選択');
    css(box, { width: 'min(380px, 100%)', background: '#fff', color: '#1f1f1f', 'border-radius': '16px', padding: '20px', 'box-shadow': '0 12px 32px rgba(0,0,0,.3)', font: '15px/1.5 system-ui, sans-serif' });
    var h = document.createElement('p');
    h.textContent = 'アカウントの選択';
    css(h, { margin: '0 0 4px', 'font-size': '18px', 'font-weight': '700' });
    var sub = document.createElement('p');
    sub.textContent = 'プレビュー用のテストアカウントです（本物の Google には接続しません）';
    css(sub, { margin: '0 0 12px', 'font-size': '12px', color: '#5f6368' });
    box.appendChild(h);
    box.appendChild(sub);
    function close() {
      document.removeEventListener('keydown', onKey, true);
      if (back.parentNode) back.parentNode.removeChild(back);
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    var first = null;
    preview().ACCOUNTS.forEach(function (acc) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fake-gsi-account';
      css(b, { display: 'flex', 'align-items': 'center', gap: '12px', width: '100%', 'min-height': '56px', padding: '8px 12px', margin: '0 0 6px', border: '1px solid #dadce0', 'border-radius': '10px', background: '#fff', color: 'inherit', font: 'inherit', 'text-align': 'left', cursor: 'pointer' });
      var av = document.createElement('span');
      av.textContent = acc.email.charAt(0).toUpperCase();
      css(av, { display: 'grid', 'place-items': 'center', width: '32px', height: '32px', 'border-radius': '50%', background: '#14784a', color: '#fff', 'font-weight': '700', flex: 'none' });
      var t = document.createElement('span');
      t.textContent = acc.email;
      b.appendChild(av);
      b.appendChild(t);
      b.addEventListener('click', function () {
        close();
        onPick(acc);
      });
      box.appendChild(b);
      if (!first) first = b;
    });
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'キャンセル';
    css(cancel, { 'margin-top': '6px', 'min-height': '40px', padding: '6px 14px', border: '0', background: 'transparent', color: '#0b57d0', font: 'inherit', 'font-weight': '700', cursor: 'pointer' });
    cancel.addEventListener('click', close);
    box.appendChild(cancel);
    back.addEventListener('click', function (e) {
      if (e.target === back) close();
    });
    document.addEventListener('keydown', onKey, true);
    back.appendChild(box);
    // ダイアログ（<dialog>）を開いているときはその中に置く（外に置くと背景扱いで押せないため）
    var host = document.querySelector('dialog[open]') || document.body;
    host.appendChild(back);
    if (first) first.focus();
  }

  window.google = {
    accounts: {
      id: {
        initialize: function (cfg) {
          config = cfg;
        },
        renderButton: function (box, opts) {
          var dark = opts && opts.theme === 'filled_black';
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'fake-gsi';
          b.textContent = 'Google でログイン';
          css(b, {
            'min-height': opts && opts.size === 'medium' ? '36px' : '40px',
            padding: '6px 18px',
            'border-radius': '999px',
            border: '1px solid ' + (dark ? '#8e918f' : '#747775'),
            background: dark ? '#131314' : '#ffffff',
            color: dark ? '#e3e3e3' : '#1f1f1f',
            font: 'inherit',
            'font-size': '14px',
            'font-weight': '600',
            cursor: 'pointer',
          });
          b.addEventListener('click', function () {
            chooseAccount(function (acc) {
              if (config && config.callback) config.callback({ credential: preview().previewIdToken(acc.email, Date.now()) });
            });
          });
          box.appendChild(b);
        },
        prompt: function () {},
        disableAutoSelect: function () {},
      },
    },
  };
})();
