# Google Apps Script への導入・公開手順

この手順は Google アカウント上での操作です。**本作業（Claude）は Google アカウントに接続していません。** 以下はすべて利用者が行う操作です。
Google の画面の文言は言語設定や時期によって変わることがあります。名称が違う場合は近い項目を選んでください。

所要時間の目安: 30〜40 分（初回）

---

## 0. 前提

- 「n02 Tournament」フォルダと、空の「Tournament PoC」スプレッドシートが Google ドライブにあること（作成済み）。
- スプレッドシートの共有設定は **「制限付き」（自分だけ）** のままにします。閲覧者・運営補助者に共有する必要はありません。
- 以下の 2 つのプロジェクトは、**スプレッドシートを所有するのと同じ Google アカウント**で作成・デプロイします。

## 1. スプレッドシートの ID を控える（スプレッドシートは開かない）

1. Google ドライブで「Tournament PoC」を右クリック →「共有」→「リンクをコピー」。
2. コピーされた URL（`https://docs.google.com/spreadsheets/d/【ID】/edit?usp=sharing`）の【ID】部分が スプレッドシート ID です。
   運営画面には URL ごと貼り付けても構いません（ID 部分を自動で取り出します）。

## 2. 運営用プロジェクトを作る（API のみ。画面は GitHub Pages）

1. <https://script.google.com/> で「新しいプロジェクト」→ 名前を **`n02 Tournament Admin`**。
2. 「プロジェクトの設定」→「appsscript.json マニフェスト ファイルをエディタで表示する」にチェック。
3. エディタで次の 2 ファイルを用意して保存（HTML ファイルは不要。以前の版で作った `Index.html` があれば削除して構いません）。

   | エディタ上のファイル | 貼り付ける内容 |
   | --- | --- |
   | `appsscript.json` | `tournament-poc/dist/admin/appsscript.json` |
   | `コード.gs` | `tournament-poc/dist/admin/Code.gs` |

4. 「プロジェクトの設定」→「スクリプト プロパティ」に次を設定します（[security.md](security.md) の 3. を参照）。

   | プロパティ | 値 |
   | --- | --- |
   | `SPREADSHEET_ID` | 手順 1 の ID |
   | `ADMIN_KEY` | 管理者の鍵（24 文字以上の推測できない文字列。他人に教えない） |
   | `CREATE_CODE` | 作成コード（任意。設定すると、このコードを知っている人だけが大会を作れる） |

### デプロイ（運営用）

| 項目 | 値 |
| --- | --- |
| 次のユーザーとして実行 | **自分** |
| アクセスできるユーザー | **全員** |

「全員」にするのは、GitHub Pages の運営画面から Cookie なしで呼べるようにするためです。
誰が操作できるかは、アプリ側で大会ごとの鍵・管理者の鍵を毎回確かめて決めます（[security.md](security.md)）。
権限の承認では、スプレッドシートの権限だけが求められることを確認し、**「すべて選択」にチェック**してから続行します。
表示された URL（`…/exec`）を控えます（運営画面の `admin/config.js` に書きます）。

## 3. 閲覧者用プロジェクトを作る

1. <https://script.google.com/> で「新しいプロジェクト」→ 名前を **`n02 Tournament Viewer`**。
2. 「プロジェクトの設定」→「appsscript.json マニフェスト ファイルをエディタで表示する」にチェック。
3. 次の 3 ファイルを用意します。

   | エディタ上のファイル | 貼り付ける内容 |
   | --- | --- |
   | `appsscript.json` | `tournament-poc/dist/viewer/appsscript.json` |
   | `コード.gs`（`Code.gs`） | `tournament-poc/dist/viewer/Code.gs` |
   | `Index`（HTML） | `tournament-poc/dist/viewer/Index.html` |

4. 「プロジェクトの設定」→「スクリプト プロパティ」に **`SPREADSHEET_ID` = 手順 1 の ID**（必須）。
5. 保存。

### デプロイ（閲覧者用）

| 項目 | 値 |
| --- | --- |
| 次のユーザーとして実行 | **自分** |
| アクセスできるユーザー | **全員**（Google アカウントへのログイン不要） |

閲覧者用の `appsscript.json` には、高度なサービス「Google Sheets API」（v4）の利用が書かれています。貼り付けて保存すると、エディタ左の「サービス」に「Sheets」が表示されます（表示されない場合は「サービス」の「＋」から Google Sheets API を追加し、ID は `Sheets` のまま）。追加費用はかかりません。

権限の承認では、スプレッドシートについて**参照（表示）のみ**の権限が要求されることを確認し、**「すべて選択」にチェック**してから続行してください（チェックがないと閲覧画面が「通信エラー」になります）。編集の権限が表示された場合は `appsscript.json` の貼り付けを見直してください。

表示された **ウェブアプリの URL（`…/exec`）** が閲覧者に配布する URL です。

## 3.5 運営画面・閲覧ページを GitHub Pages に置く

Apps Script の画面（`…/exec`）は、ブラウザで複数の Google アカウントにログインしていると開けません（実環境で確認）。
運営画面・閲覧ページとも GitHub Pages に置き、Apps Script とは Cookie を送らない fetch で通信します。

1. GitHub に公開リポジトリ（例: `n02-tournament-viewer`）を作る。
2. `tournament-poc/dist/pages/` の中身をそのまま置く（ルートに閲覧ページ、`admin/` に運営画面）。
3. `config.example.js` を `config.js` として置き、`endpoint` を**閲覧者用** Web アプリの URL にする。
4. `admin/config.example.js` を `admin/config.js` として置き、`endpoint` を**運営用** Web アプリの URL にする。
5. 「Settings」→「Pages」で「Deploy from a branch」、ブランチ `main`・フォルダ `/ (root)` を選んで「Save」。

| URL | 用途 |
| --- | --- |
| `https://<ユーザー名>.github.io/<リポジトリ名>/?event=大会ID` | 閲覧者に配る（大会ごと） |
| `https://<ユーザー名>.github.io/<リポジトリ名>/admin/` | 大会を作る人に教える（作成画面） |
| `https://<ユーザー名>.github.io/<リポジトリ名>/admin/#admin` | 管理者（あなた）用 |
| `…/admin/#e=大会ID&k=鍵` | 大会ごとの運営用 URL（作成時に表示。主催者だけが持つ） |

Web アプリの URL が変わると、これらのページが動かなくなります。コードの更新は必ず「デプロイを管理」→「新バージョン」で行ってください。

## 4. 初期設定（管理者）

1. `…/admin/#admin` を開き、管理者の鍵（`ADMIN_KEY`）を入力。
2. 保存先が未設定なら共有リンクを貼って「設定」、続けて「初期化する」。以前の版から更新した場合も「初期化する」を押すと、新しい列（主催者名・鍵のハッシュ）が追加されます（既存データは消えません）。
3. 「閲覧者用 URL」に GitHub Pages の閲覧ページの URL を登録。
4. 以前の版で作った大会には運営用 URL がありません。管理者画面で大会を開き、「大会設定」→「運営用 URL の再発行」で発行できます。

## 5. 動作確認（サンプル）

1. `…/admin/` を開き、「検証用サンプル」→「作成後すぐ閲覧画面に公開する」にチェック →「サンプル大会を作成」。表示された運営用 URL を保存。
2. 閲覧者用 URL を**シークレット ウィンドウ**（ログインしていない状態）で開き、4 グループ・24 試合が表示されることを確認。
3. 運営画面の「試合結果」で未開始の試合に結果を入れて「確定」→ 閲覧画面が約 1〜2 分以内に更新されることを確認。
4. 以降の確認項目は [test-plan.md](test-plan.md) の「実環境での確認項目」を参照。

## 6. コードを更新するとき

1. 該当プロジェクトのファイルを、新しい `dist/` の内容で置き換えて保存。
2. 「デプロイ」→「デプロイを管理」→ 対象のデプロイの鉛筆アイコン →「バージョン」で「新バージョン」→「デプロイ」。
   この方法なら **URL は変わりません**。「新しいデプロイ」を作ると URL が変わるので注意してください。
3. 権限（`oauthScopes`）が変わった場合は、再度承認を求められます。
4. 運営用を更新したら、`…/admin/#admin` で管理者の鍵を入れて「初期化する」を押してください。新しい版で増えた列（v0.4.0 ではセット数・3 位決定戦の行き先・手動の順位など）がシートの末尾に追加されます。既存のデータは消えません。
5. GitHub Pages 側も、`dist/pages/` の `viewer.js` `viewer.css` `index.html` `qrcode.js` と `admin/` の `admin.js` `admin.css` `index.html` `qrcode.js` を新しいものに置き換えます（`config.js` はそのまま）。

## 6.5 うまくいかないとき（権限の許可し直し）

運営画面で「そのスプレッドシートを開けませんでした」、閲覧画面で「通信エラー」が続く場合は、権限が許可されていない可能性があります。
該当プロジェクトのエディタの末尾に次の関数を一時的に追加して実行し、承認画面で「すべて選択」にチェックして許可してください。
`OK: Tournament PoC` と出たら関数を削除して保存します（デプロイのやり直しは不要）。

```javascript
function checkSheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  Logger.log('ID: [' + id + ']');
  var ss = SpreadsheetApp.openById(id);
  Logger.log('OK: ' + ss.getName());
}
```

閲覧者用は `SpreadsheetApp` ではなく Sheets API で読むため、閲覧者用で確かめる場合は `var ss = …` と次の行を `Logger.log(Sheets.Spreadsheets.Values.get(id, 'PublicSnapshots').range);` に置き換えます。

運営者用で `SPREADSHEET_ID` をまだ設定していない場合は、`id` の行を `var id = '（スプレッドシートの ID）';` に置き換えて実行します。

## 7. 公開前の確認（必須）

[security.md](security.md) の「公開前チェックリスト」をすべて確認してから、閲覧者用 URL を配布してください。

## 8. 片付け・停止

- 閲覧画面を止める: 閲覧者用プロジェクトの「デプロイを管理」→ デプロイを「アーカイブ」。
- 特定の大会だけ隠す: 運営画面の「大会設定」で「閲覧画面に公開する」を外して保存。
- データはスプレッドシートに残ります（削除はしません）。

## 参考（公式ドキュメント）

- Web アプリ: <https://developers.google.com/apps-script/guides/web>
- マニフェストのスコープ: <https://developers.google.com/apps-script/concepts/scopes>
- Session（getActiveUser / getEffectiveUser）: <https://developers.google.com/apps-script/reference/base/session>
- CacheService: <https://developers.google.com/apps-script/reference/cache/cache>
- 割り当て（クォータ）: <https://developers.google.com/apps-script/guides/services/quotas>

※ 本作業の環境からは developers.google.com に直接アクセスできなかったため、上記ページの内容は検索結果の要約で確認しています。数値・UI の文言は公開前に公式ページで再確認してください。
