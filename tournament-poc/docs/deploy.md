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
   | `GOOGLE_CLIENT_ID` | 手順 2.5 で作る OAuth クライアント ID（`…apps.googleusercontent.com`） |

### デプロイ（運営用）

| 項目 | 値 |
| --- | --- |
| 次のユーザーとして実行 | **自分** |
| アクセスできるユーザー | **全員** |

「全員」にするのは、GitHub Pages の運営画面から Cookie なしで呼べるようにするためです。
誰が操作できるかは、アプリ側で Google ログインのセッション・管理パスワード・管理者の鍵を毎回確かめて決めます（[security.md](security.md)）。
権限の承認では、**スプレッドシート**と**外部サービスへの接続**（Google にログイン情報を確かめるため）の 2 つが求められることを確認し、
**「すべて選択」にチェック**してから続行します。
表示された URL（`…/exec`）を控えます（運営画面の `admin/config.js` に書きます）。

## 2.5 Google ログインの準備（Google Cloud・無料）

主催者は Google アカウントでログインします（v0.5.0〜）。そのための「OAuth クライアント ID」を 1 つ作ります。
課金（請求先アカウント）の設定は不要です。手順と項目名は [Google の案内](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) に基づきます（画面の名前は変わることがあります）。

1. <https://console.cloud.google.com/> を開き、上部のプロジェクト選択から「新しいプロジェクト」→ 名前（例: `n02-tournament`）→「作成」。
2. 左メニュー「Google Auth Platform」（または「API とサービス」→「OAuth 同意画面」）→「ブランディング」: アプリ名（例: `n02 Tournament`）とサポートメールを入れて保存。
3. 「対象」（Audience）: ユーザーの種類は「外部」。「アプリを公開」で「本番環境」にします。
   求める情報はメールアドレス・プロフィールなど基本的なものだけなので、Google の審査は不要の見込みです
   （Google のヘルプでは、基本的な情報だけを求めるアプリは「テスト中」でもテストユーザー以外がログインできるとされています。
   [Manage App Audience](https://support.google.com/cloud/answer/15549945)。実環境では未確認）。
4. 「クライアント」→「クライアントを作成」: アプリケーションの種類は「ウェブ アプリケーション」、名前は任意。
   「承認済みの JavaScript 生成元」に **`https://<ユーザー名>.github.io`** だけを追加（パスは付けない）。リダイレクト URI は空のまま →「作成」。
5. 表示された「クライアント ID」（`…apps.googleusercontent.com`）を控えます。**クライアント シークレットは使いません**（控えなくてよい）。
6. 控えたクライアント ID を、運営用プロジェクトのスクリプト プロパティ `GOOGLE_CLIENT_ID` と、GitHub Pages の `admin/config.js` の `googleClientId` の 2 か所に書きます。

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
4. `admin/config.example.js` を `admin/config.js` として置き、`endpoint` を**運営用** Web アプリの URL、`googleClientId` を手順 2.5 のクライアント ID にする。
5. 「Settings」→「Pages」で「Deploy from a branch」、ブランチ `main`・フォルダ `/ (root)` を選んで「Save」。

| URL | 用途 |
| --- | --- |
| `https://<ユーザー名>.github.io/<リポジトリ名>/?event=大会ID` | 閲覧者に配る（大会ごと） |
| `https://<ユーザー名>.github.io/<リポジトリ名>/admin/` | 主催者のページ（Google でログインして大会を作る・自分の大会を開く） |
| `https://<ユーザー名>.github.io/<リポジトリ名>/admin/#admin` | 管理者（あなた）用 |
| `…/admin/#e=大会ID` | 大会ごとの運営画面（主催者は Google ログイン、店舗スタッフは管理パスワードで開く。URL 自体は秘密ではない） |
| `https://<ユーザー名>.github.io/<リポジトリ名>/events/` | ポータル「トーナメント・リーグ」（v0.7.0〜。公開中の大会の一覧・検索、作成した大会、作成ボタン。n02 のトップ画面からリンク） |

Web アプリの URL が変わると、これらのページが動かなくなります。コードの更新は必ず「デプロイを管理」→「新バージョン」で行ってください。

## 4. 初期設定（管理者）

1. `…/admin/#admin` を開き、管理者の鍵（`ADMIN_KEY`）を入力。
2. 保存先が未設定なら共有リンクを貼って「設定」、続けて「初期化する」。以前の版から更新した場合も「初期化する」を押すと、新しい列（v0.5.0 では主催者の Google アカウント・管理パスワード）が追加されます（既存データは消えません）。
3. 「閲覧者用 URL」に GitHub Pages の閲覧ページの URL を登録。
4. v0.4 以前に作った大会には主催者（Google アカウント）がいません。管理者画面で大会を開き、「大会設定」→「主催者（管理者のみ）」にメールアドレスを入れて保存すると、その人が Google ログインで運営できます。

## 5. 動作確認（サンプル）

1. `…/admin/` を開き、「Google でログイン」→「検証用サンプル」→「作成後すぐ閲覧画面に公開する」にチェック →「サンプル大会を作成」。サンプル大会の運営画面が開きます。
2. 閲覧者用 URL を**シークレット ウィンドウ**（ログインしていない状態）で開き、4 グループ・24 試合が表示されることを確認。
3. 運営画面の「試合結果」で未開始の試合に結果を入れて「確定」→ 閲覧画面が約 1〜2 分以内に更新されることを確認。
4. 以降の確認項目は [test-plan.md](test-plan.md) の「実環境での確認項目」を参照。

## 6. コードを更新するとき

1. 該当プロジェクトのファイルを、新しい `dist/` の内容で置き換えて保存。
2. 「デプロイ」→「デプロイを管理」→ 対象のデプロイの鉛筆アイコン →「バージョン」で「新バージョン」→「デプロイ」。
   この方法なら **URL は変わりません**。「新しいデプロイ」を作ると URL が変わるので注意してください。
3. 権限（`oauthScopes`）が変わった場合は、再度承認を求められます。
4. 運営用を更新したら、`…/admin/#admin` で管理者の鍵を入れて「初期化する」を押してください。新しい版で増えた列（v0.4.0 ではセット数・3 位決定戦の行き先・手動の順位など、v0.5.0 では主催者の Google アカウント・管理パスワード）がシートの末尾に追加されます。既存のデータは消えません。
5. GitHub Pages 側も、`dist/pages/` の `viewer.js` `viewer.css` `index.html` `qrcode.js` と `admin/` の `admin.js` `admin.css` `index.html` `qrcode.js` を新しいものに置き換えます（`config.js` はそのまま）。

### v0.7.0（ポータル「トーナメント・リーグ」）に更新するとき

ポータルは閲覧者用 Web アプリの新しい口（`?format=list`）と運営用 Web アプリの新しい操作（`myEvents`）を使います。
**Apps Script を先に更新してから** GitHub Pages を更新してください（逆の順番だと、ポータルの一覧が「読み込めませんでした」になります。既存の閲覧ページ・運営画面はどちらの順番でも動きます）。

1. 運営用: `dist/admin/Code.gs` を貼り替え →「デプロイを管理」→ 鉛筆 →「新バージョン」。権限・列の変更はないので、承認のし直しと「初期化する」は不要です。
2. 閲覧者用: `dist/viewer/Code.gs` を貼り替え → 同じく「新バージョン」（v0.2.0 以来の更新。権限の変更はありません）。
3. GitHub Pages: `dist/pages/events/` フォルダ（`index.html` `portal.js` `portal.css` `archivo.woff2` `OFL-Archivo.txt`）と、ルートの `ux-kit.js` `ux-kit.css` `viewer-plus.js` を追加し、ルートの `index.html` `viewer.js` `viewer.css` と `admin/` の `admin.js` `admin.css` `index.html` を置き換えます。`config.js` と `admin/config.js` はそのまま（ポータルはこの 2 つを読みます）。
4. Google Cloud の OAuth クライアントの設定変更は不要です（ポータルは運営画面と同じ `https://<ユーザー名>.github.io` から開くため）。
5. 一覧の「参加人数」は、v0.7.0 の運営用で公開データを作り直した大会から表示されます。それまでは「—」です。すぐに表示したい大会は、運営画面の「進行状況」→「公開データを再生成」を押してください。

### v0.7.1（レビュー指摘の修正。サーバーのみ）に更新するとき

v0.7.0 を反映済みなら、運営用・閲覧者用の `Code.gs` を貼り替えて、それぞれ「新バージョン」でデプロイし直すだけです（権限・列・Pages 側の `config.js` の変更なし）。GitHub Pages は `admin/admin.js` だけが変わります（閲覧ページへの反映に失敗したときの知らせ）。

- 管理パスワードの間違いの回数を、並んで届いた要求でも 1 回ずつ数える（総当たりの上限をすり抜けられないように）
- 閲覧者用: シートの読み直しが長引いているとき、待っている要求は前回の内容で答え、全員でシートを読みに行かない
- 閲覧者用: 公開をやめた大会の予備キャッシュを消す（シートが読めないときに非公開の大会を返さない）
- 運営用: 保存のあと閲覧ページへの反映だけが失敗したときは、保存は成功として返し、再送で二重に実行しない（画面に「公開データを再生成」の案内を出す）

### v0.8.0 から: main へのマージで本番に反映する（GitHub Actions）

v0.8.0 からは、手での貼り替えの代わりに `.github/workflows/tournament-deploy.yml` が反映します（手での貼り替えも引き続きできます）。
PR（プルリクエスト）の段階では何も反映しません。**main にマージされたときだけ**、次の順で動きます。

| 順 | 内容 | 失敗したとき |
| --- | --- | --- |
| 1 | 検証（Secrets なし）: `dist/` が `src/` から作られたものか、単体テスト | ここで止まり、何も変わらない |
| 2 | main が先に進んでいないか（古いコミットで上書きしない） | 何も変わらない（新しい実行が反映する） |
| 3 | 設定の確認: デプロイ ID は閲覧リポジトリの `config.js`・`admin/config.js` の URL から読み、スクリプト ID と組み合わせて Apps Script API で実在を確認。今のコードが本アプリのものか・Web アプリの公開設定と権限が変わらないかを確認 | 何も変わらない |
| 3.5 | 管理者の確認（dry-run でも行う）: 今動いている運営用 GAS の読み取り API（`bootstrap`）を `TOURNAMENT_ADMIN_KEY` で呼び、管理者として認証できること・保存先が設定済み・開ける・初期化済みであることを確認（移行が必要なだけなら止めない。鍵・保存先・大会のデータはログに出さない） | 何も変わらない |
| 4 | バックアップ: 運営用・閲覧者用の今のコードと、デプロイの版番号を記録（実行結果の成果物 `tournament-backup-<SHA>` に 90 日） | 何も変わらない |
| 5 | 運営用 GAS: コードを置き換え → 新しい版を作成 → **既存のデプロイ**の版を差し替え（URL は変わらない。新しいデプロイは作らない） | 運営用だけ新しい版。閲覧はでき、書き込みは移行まで止まる（下の「戻す」） |
| 6 | スキーマの移行（管理者の鍵で `migrateStorage`）: 同じスプレッドシートに `bak-s1-…` のバックアップのシートを作り、列とシート（Collaborators）を足す。何度実行しても安全 | 運営用は新しい版のまま。書き込みは止まる（再実行で続きから） |
| 7 | 閲覧者用 GAS: 5 と同じ | 閲覧者用は前の版のまま（前の版でも移行後のシートを読める） |
| 8 | 動作確認: 両方の Web アプリが今回のコミットで応答し、大会一覧を読める | GAS は新しい版。Pages は前のまま |
| 9 | GitHub Pages: `dist/pages/` を閲覧リポジトリに写して push（`config.js`・`admin/config.js`・`README.md` は残す）。`release.json` に今回のコミット | Pages は前のまま |
| 10 | 公開確認: `…/release.json` が今回のコミットになるまで待つ | 実行結果に表示 |

反映は 1 つずつ（同時に 2 つは動かない。途中で取り消さない）。各手順の結果と、戻すための版番号は実行結果の「Summary」に出ます。
「移行の前に GAS を更新する」順番なのは、移行の処理が新しい版のコードにあるためです（移行のための匿名の API は作っていません）。
旧版（v0.6.0・v0.7.1・v0.8.0）のコードは移行後のシートでも読み書きでき、新しい版は移行前のシートを読めることをテストで確かめています（`tests/storage.test.mjs`・`tests/identity.test.mjs`）。
**v0.9.0（スキーマ v3）を反映すると、Google でログイン中の全員が再ログインになり、共同主催者の値の移し替えが自動で行われます。** 反映の前に [v0.9-identity.md](v0.9-identity.md) の「8. 本番に移す前の手順」を確認してください。
Pages を最後にするため、手順 5〜9 の数分間は、前の版の画面が新しい版の API を使います（未検証。既存の操作は残しています）。

#### 最初に 1 回だけ行う設定（リポジトリの所有者が行う）

トークン・鍵・パスワードは**会話に貼らず**、GitHub の画面に直接入力してください。

1. **Apps Script API を有効にする**: スクリプトを所有する Google アカウントで <https://script.google.com/home/usersettings> を開き、「Google Apps Script API」をオンにする。
2. **clasp でログインして認証情報を作る**（Node.js が入った自分の PC で）:
   `npx @google/clasp@3.4.1 login` → ブラウザで同じ Google アカウントを選んで許可 → ホームフォルダに `.clasprc.json` ができる（clasp 3.4.1 は Apps Script のプロジェクト・デプロイの管理の権限を求めます）。
3. **GitHub に環境を作る**: n02 リポジトリの Settings → Environments → New environment → 名前 `tournament-production`。
   「Deployment branches and tags」を **Selected branches** にして `main` だけを許可（必要なら「Required reviewers」に自分を入れると、反映の前に承認を求められます）。
4. **閲覧リポジトリの Deploy key**（閲覧リポジトリだけに書ける鍵）:
   自分の PC で `ssh-keygen -t ed25519 -C n02-tournament-deploy -f n02-tournament-deploy -N ""` →
   n02-tournament-viewer の Settings → Deploy keys → Add deploy key に `n02-tournament-deploy.pub` の中身（**Allow write access にチェック**）。
5. 環境 `tournament-production` の **Secrets**（3 つ）:

   | 名前 | 値 |
   | --- | --- |
   | `TOURNAMENT_CLASPRC_JSON` | 2 の `.clasprc.json` の中身全体 |
   | `TOURNAMENT_ADMIN_KEY` | 運営用のスクリプト プロパティ `ADMIN_KEY` と同じ値 |
   | `TOURNAMENT_VIEWER_DEPLOY_KEY` | 4 の `n02-tournament-deploy`（拡張子なし。秘密鍵）の中身 |

6. 環境 `tournament-production` の **Variables**（4 つ。どれも秘密ではありません）:

   | 名前 | 値 |
   | --- | --- |
   | `TOURNAMENT_ADMIN_SCRIPT_ID` | 「n02 Tournament Admin」のスクリプト ID（エディタの「プロジェクトの設定」→「ID」） |
   | `TOURNAMENT_VIEWER_SCRIPT_ID` | 「n02 Tournament Viewer」のスクリプト ID |
   | `TOURNAMENT_PAGES_URL` | `https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/`（末尾の `/` まで） |
   | `TOURNAMENT_VIEWER_REPO` | `chihirohashimotoac-coder/n02-tournament-viewer` |

   デプロイ ID は入力しません（閲覧リポジトリの `config.js`・`admin/config.js` に書いてある URL から読みます）。
7. ここまで済んだら PR をマージします。**最初のマージでは反映しません**（8 まで止まっています）。
8. Actions → 「Tournament deploy」→ Run workflow → mode `dry-run`。書き込まずに 3〜4 を確かめ、Summary に今の版番号が出ます。
9. dry-run が通ったら、**リポジトリ**の Variables（Settings → Secrets and variables → Actions → Variables。環境の Variables ではなく）に `TOURNAMENT_DEPLOY_ENABLED` = `true` を追加し、Run workflow → mode `deploy` で反映します。以降は main へのマージごとに自動で反映します。

#### 戻す（ロールバック）

- GAS: Actions → 「Tournament deploy」→ Run workflow → mode `rollback`、Summary に出た前の版番号を入れる（運営用・閲覧者用それぞれ。空欄の方は戻さない）。
  手でも「デプロイを管理」→ 鉛筆 →「バージョン」で前の版を選べば戻せます（URL は変わりません）。
- スプレッドシート: 移行で増やした列・シートは旧版でも邪魔になりません（戻す必要はありません）。移行前の内容は `bak-s1-…`（v0.8.0）・`bak-s2-…`（v0.9.0）のシートに残っています。
- **v0.9.0 の後に運営用を v0.8.0 へ戻すと、主催者の判定がメールアドレスだけに戻ります**（共同主催者・招待には権限が付きません）。障害時の一時的な手段に限ってください（[v0.9-identity.md](v0.9-identity.md) の「6. ロールバックの境界」）。
- GitHub Pages: 閲覧リポジトリで `deploy: n02 <SHA>` のコミットを revert して push します。
- 認証情報の取り消し: 不要になったら <https://myaccount.google.com/permissions> で clasp のアクセスを削除し、Deploy key と Secrets を削除します。

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
