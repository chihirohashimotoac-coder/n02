/* 運営者の認可（すべてサーバー側で判定する） */

function readEmail_(getter) {
  try {
    var email = getter();
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

/**
 * 運営者として許可するメールアドレスの一覧。
 * スクリプト プロパティ ADMIN_EMAILS（カンマ区切り）があればそれを使い、
 * なければデプロイしたアカウント（実行ユーザー）本人だけを許可する。
 * どちらも取れなければ空配列となり、誰も許可しない（フェイルクローズ）。
 */
function getAdminEmails_() {
  var raw = '';
  try {
    raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  } catch (e) {
    raw = '';
  }
  var list = raw
    .split(/[\s,;]+/)
    .map(function (s) {
      return s.trim().toLowerCase();
    })
    .filter(function (s) {
      return /^[^@\s]+@[^@\s]+$/.test(s);
    });
  if (list.length) return list;
  var owner = readEmail_(function () {
    return Session.getEffectiveUser().getEmail();
  });
  return owner ? [owner] : [];
}

/**
 * 呼び出し元が運営者であることを確認し、そのメールアドレスを返す。
 * Web アプリの公開範囲（Google 側のアクセス制御）とは独立に、毎回ここで検証する。
 */
function requireAdmin_() {
  var active = readEmail_(function () {
    return Session.getActiveUser().getEmail();
  });
  if (!active) {
    throw appError_('FORBIDDEN', '運営者として認証できませんでした。運営者用 URL に、許可された Google アカウントでアクセスしてください。');
  }
  if (getAdminEmails_().indexOf(active) === -1) {
    throw appError_('FORBIDDEN', 'このアカウントには運営者の権限がありません。');
  }
  return active;
}
