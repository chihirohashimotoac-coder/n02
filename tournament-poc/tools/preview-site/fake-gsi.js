/* 確認用プレビューだけで使う「模擬 Google ログイン」。
 * 本物の Google Identity Services（accounts.google.com/gsi/client）の代わりに読み込み、同じ関数（initialize・renderButton など）を用意する。
 * 押すと、選んだテスト用アカウントの ID トークン（模擬 tokeninfo だけが受け付ける形）を渡す。本物の Google には接続しない。 */
(function () {
  'use strict';
  var config = null;
  function preview() {
    return window.TPOC_PREVIEW;
  }
  window.google = {
    accounts: {
      id: {
        initialize: function (cfg) {
          config = cfg;
        },
        renderButton: function (box, opts) {
          var dark = opts && opts.theme === 'filled_black';
          var wrap = document.createElement('div');
          wrap.className = 'preview-gsi';
          wrap.style.setProperty('display', 'flex');
          wrap.style.setProperty('flex-wrap', 'wrap');
          wrap.style.setProperty('gap', '6px');
          wrap.style.setProperty('align-items', 'center');
          var label = document.createElement('span');
          label.textContent = '模擬 Google ログイン（プレビュー）:';
          label.style.setProperty('font-size', '12px');
          label.style.setProperty('font-weight', '700');
          label.style.setProperty('opacity', '0.85');
          wrap.appendChild(label);
          preview().ACCOUNTS.forEach(function (acc) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'fake-gsi';
            b.textContent = acc.label + 'でログイン';
            b.title = acc.email + '（プレビュー用のテストアカウント）';
            b.setAttribute('aria-label', acc.label + '（' + acc.email + '・プレビュー用のテストアカウント）でログイン');
            b.style.setProperty('min-height', '40px');
            b.style.setProperty('padding', '6px 14px');
            b.style.setProperty('border-radius', '999px');
            b.style.setProperty('border', '2px dashed ' + (dark ? '#f1f4f2' : '#1b1f1d'));
            b.style.setProperty('background', dark ? '#252c30' : '#ffffff');
            b.style.setProperty('color', dark ? '#f1f4f2' : '#1b1f1d');
            b.style.setProperty('font', 'inherit');
            b.style.setProperty('font-size', '14px');
            b.style.setProperty('font-weight', '700');
            b.style.setProperty('cursor', 'pointer');
            b.addEventListener('click', function () {
              if (config && config.callback) config.callback({ credential: preview().previewIdToken(acc.email, Date.now()) });
            });
            wrap.appendChild(b);
          });
          box.appendChild(wrap);
        },
        prompt: function () {},
        disableAutoSelect: function () {},
      },
    },
  };
})();
