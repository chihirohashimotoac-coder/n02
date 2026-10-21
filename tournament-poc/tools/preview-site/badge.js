/* 確認用プレビューの目印: 画面の左下に「プレビュー・模擬データ・本番には保存されません」とコミットを出し、説明ページへ戻れるようにする。 */
(function () {
  'use strict';
  var src = document.currentScript && document.currentScript.src;
  function add() {
    var a = document.createElement('a');
    a.href = src ? new URL('../../', src).href : '../../';
    var build = window.TPOC_PREVIEW_BUILD || {};
    a.textContent = 'プレビュー・模擬データ・本番には保存されません' + (build.shortSha ? '（' + build.shortSha + '）' : '');
    a.title = '本物の Google・Apps Script・大会データには接続していません。押すと説明ページに戻ります。' + (build.sha ? ' コミット ' + build.sha : '');
    var s = a.style;
    s.setProperty('position', 'fixed');
    s.setProperty('left', 'calc(8px + env(safe-area-inset-left, 0px))');
    s.setProperty('bottom', 'calc(8px + env(safe-area-inset-bottom, 0px))');
    s.setProperty('z-index', '2147483000');
    s.setProperty('padding', '4px 10px');
    s.setProperty('border-radius', '999px');
    s.setProperty('background', '#ffd43d');
    s.setProperty('color', '#000');
    s.setProperty('font', '700 12px/1.4 system-ui, sans-serif');
    s.setProperty('max-width', 'calc(100vw - 16px)');
    s.setProperty('text-decoration', 'none');
    s.setProperty('box-shadow', '0 1px 4px rgba(0,0,0,.35)');
    a.className = 'preview-badge';
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
  else add();
})();
