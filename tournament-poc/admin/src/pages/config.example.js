// このファイルを config.js という名前でコピーし、2 つの値を書き換えてください。
// - endpoint: 運営用 Web アプリの URL（Apps Script の「デプロイを管理」で確認できる …/exec で終わるもの）
// - googleClientId: Google Cloud コンソールで作った OAuth クライアント ID（…apps.googleusercontent.com）。
//   運営用 Apps Script のスクリプト プロパティ GOOGLE_CLIENT_ID にも同じ値を設定します。
// どちらも秘密の情報ではありません（公開されたページに書く前提のもの）。
// この URL や ID を知られても、Google でログインした主催者本人か、管理パスワード・管理者の鍵がなければ何も操作できません。
window.TPOC_ADMIN_CONFIG = {
  endpoint: 'https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXX/exec',
  googleClientId: '000000000000-xxxxxxxx.apps.googleusercontent.com',
};
