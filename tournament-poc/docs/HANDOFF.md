# 引き継ぎ（Handoff）— n02 Tournament / League Manager PoC

最終更新: 2026-10-21 / 対象版: **v0.5.0**（Google ログイン・管理パスワード。運営用 Apps Script・運営ページの更新と Google Cloud の設定が必要）

次のセッションは、まずこのファイルと [README.md](../README.md)・[test-plan.md](test-plan.md) を読んでから作業してください。

---

## 1. リポジトリとブランチ

| リポジトリ | 役割 | ブランチ | 備考 |
| --- | --- | --- | --- |
| **chihirohashimotoac-coder/n02** | **ソースの正本**（`tournament-poc/` 配下だけを触る） | `claude/confident-carson-4jh0g5`（最新。`claude/bold-albattani-5vsk78` から派生し、v0.4.1 の実環境確認の記録を追加） | 未マージ。PR は未作成（ユーザーの指示があるまで作らない） |
| chihirohashimotoac-coder/n02-tournament-viewer | GitHub Pages の公開先（`dist/pages/` のコピー置き場） | `main` | `config.js`・`admin/config.js` に Web アプリの URL。ここは**手で編集しない**で `dist/pages/` からコピーする。負荷テスト用に `.github/workflows/loadtest.yml`（← `tournament-poc/tools/pages-loadtest.yml`）と `tools/loadtest.mjs`（← `tournament-poc/tools/loadtest.mjs`）もコピーしてある |

新しいセッションでは **n02 を選択**し、Pages を更新するときだけ `add_repo` で n02-tournament-viewer を追加する。

## 2. 守ること（最初の依頼の制約・原文）

- 「既存n02のソースコードは変更しない」（`tournament-poc/` 以外は触らない。ルートの package.json なども不可）
- 「既存League Orderにも変更を加えない」
- 「既存のGoogleファイルを削除・上書きしない」
- 「既存の実大会データは使用しない」
- 「課金が必要なサービスを導入しない」
- 「不明なAPI仕様やテスト結果を推測で補完しない」（未検証は「未検証」と書く）
- 「Googleの認証情報や秘密情報をソースコードに埋め込まない」
- 「Googleアカウントへの接続・書き込みができない場合は、接続したと偽らず、ユーザーがApps Scriptエディタに貼り付けられる形で成果物を出力すること」
- 「今回の作業では本番公開やn02への組み込みは行わない」

運用上の約束:
- ユーザーへの返答は**日本語**（丁寧語・簡潔・正直）。
- 外部への操作（push 以外の公開、Google 側の変更、リポジトリ作成など）は**事前に承認を得る**。
- 管理者の鍵（ADMIN_KEY）・管理パスワード・（v0.4 までの）作成コードと運営用 URL（`#e=…&k=…`）を**会話に貼らないよう**ユーザーに案内済み。こちらからも求めない。OAuth クライアント ID と大会 ID は秘密ではないので、会話でもらってよい。

## 3. 構成（v0.4.1）

```
閲覧者 ─ GitHub Pages（/）──fetch(Cookie なし)──▶ 閲覧者用 Web アプリ（?format=json, readonly）─┐
主催者（Google）・スタッフ（管理パスワード） ─ GitHub Pages（/admin/、/admin/#e=ID）─POST─▶ 運営用 Web アプリ（doPost, セッションを毎回検証）─┼─▶ スプレッドシート（保存専用）
管理者 ─ GitHub Pages（/admin/#admin）──── ADMIN_KEY ─┘                                          ┘
```

| 対象 | URL・名前 |
| --- | --- |
| 閲覧ページ | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/ （`?event=EVT-…`） |
| 運営画面 | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/admin/ （管理者は `#admin`） |
| 閲覧者用 Web アプリ | Apps Script「n02 Tournament Viewer」…`AKfycbyI8B7e…/exec`（Pages の `config.js`） |
| 運営用 Web アプリ | Apps Script「n02 Tournament Admin」…`AKfycbwC41CD…/exec`（Pages の `admin/config.js`） |
| 保存先 | スプレッドシート「Tournament PoC」（ID はスクリプト プロパティ `SPREADSHEET_ID`。ソースに書かない） |
| ユーザー向け手順ページ | v0.5.0: https://claude.ai/artifact/T1DVKPSYzyE2EU93ox7Uon （G: Google Cloud・A: Apps Script・C: 連絡・T: 動作確認。コピーボタン付き）。v0.4.1 までは https://claude.ai/artifact/KekprKNKYKrHwd1MuaVke5 。生成スクリプトはスクラッチパッドにあり、セッションをまたぐと消える |

- 運営用: `appsscript.json` のスコープは `spreadsheets` と `script.external_request`（v0.5.0〜。tokeninfo でログイン確認）、実行「自分」・アクセス「全員」。スクリプト プロパティ `SPREADSHEET_ID` `ADMIN_KEY` `GOOGLE_CLIENT_ID`（v0.5.0〜必須）`VIEWER_URL`。`CREATE_CODE` は v0.5.0 で廃止。
- Google Cloud: OAuth クライアント ID（ウェブ アプリケーション、承認済みの JavaScript 生成元 `https://chihirohashimotoac-coder.github.io`）。同じ ID を `GOOGLE_CLIENT_ID` と Pages の `admin/config.js` の `googleClientId` に書く（秘密ではない）。
- 閲覧者用: スコープ `spreadsheets.readonly`、高度なサービス Sheets API（`SpreadsheetApp.openById` は readonly では使えないため）。**v0.2.0 以降コード変更なし**。
- Apps Script の画面（HtmlService）は複数 Google アカウントのブラウザで開けないため、画面はすべて GitHub Pages。

## 4. 現在の状態

| 項目 | 状態 |
| --- | --- |
| ソース（n02 ブランチ） | v0.5.0 をコミット・push 済み（v0.4.3 は `5a8dbc8`、v0.4.1 は `c7d1fd6`） |
| v0.5.0 の反映 | **完了・動作確認済み**（2026-10-21）。OAuth クライアント ID `99512252323-um86…apps.googleusercontent.com`（秘密ではない）。運営用 Apps Script はビルドと完全一致を Drive で確認、ユーザーが `GOOGLE_CLIENT_ID` 設定・承認し直し・新バージョンでデプロイ・初期化を実施。Pages の運営画面は `c538cba`。ユーザーが Google ログイン → 大会作成 → 管理パスワードでスタッフとして開く、まで「全て完了」と報告（R-19〜R-22 すべて合格） |
| GitHub Pages | v0.5.0 の運営画面を push 済み（`c538cba`）。閲覧ページは v0.4.3（`fd90803`）。v0.4.2 は `e1ee333`（`viewer.css`・`viewer.js` のみ差し替え、pages build and deployment は成功）。Pages 側の `README.md` には `admin/` の行が手で足されており `dist/pages/README.md` と 1 行違う（上書きしていない） |
| 運営用 Apps Script のコード | ユーザーが v0.4.1 を貼り付け済み。Drive コネクタで読み出し、**ビルドと完全一致**を確認 |
| 運営用のデプロイ（新バージョン） | **動作確認済み**（2026-10-21）。ユーザーが「まとめて確定」で「2 試合の結果を確定しました。」と表示されたと報告 → v0.4.1 の `saveMatchResults` が実環境で動いている。閲覧ページにも反映された（R-17 合格） |
| 閲覧者用 Apps Script | 変更不要（v0.2.0 のまま）。v0.4.2 で `dist/viewer/Index.html` の CSS も変わるが、Apps Script 版の画面は QR を出さないので貼り替え不要 |

### 版の履歴（要点）
- v0.1.x: GAS + スプレッドシートの PoC、閲覧者用を Sheets API に変更
- v0.2.0: 閲覧ページを GitHub Pages に（複数アカウント問題の回避）
- v0.3.0: 誰でも主催・大会ごとの秘密の運営用 URL（ログインなし）
- v0.4.0: 大会形式を主催者が組める（段階・ロビン/リーグ/トーナメント・A/B 進出・順位の決め方・2 回総当たり・節名・段階/回戦ごとの Best of・セット制・3 位決定戦・シード・不戦勝）
- v0.5.0: 大会の作成・運営を Google ログイン（作った本人）＋大会ごとの管理パスワード（店舗スタッフ）に変更。運営用 URL（鍵）と作成コードを廃止。運営用 Apps Script はスコープに `script.external_request` を追加（tokeninfo でログイン確認）、スクリプト プロパティ `GOOGLE_CLIENT_ID` が必須。運営ページの `admin/config.js` に `googleClientId` が必須
- v0.4.3: 閲覧ページのトーナメントを、回戦ごとの列に試合を並べて線でつなぐトーナメント表に変更（ロビンは変更なし）。公開データの round・order で配置するのでサーバーの変更なし。Pages のみの変更
- v0.4.2: 閲覧ページの QR を内容の右余白に収まる大きさで表示（内容は動かさない・余白がなければ出さない）。Pages のみの変更
- v0.4.1: 結果の「まとめて確定」（全件検証してから保存）・入力途中の値の保持・閲覧ページの QR コード（広い画面で右下に固定、スマホはボタンで拡大、`?qr=0/1`）・運営画面の QR（PNG 保存）

## 5. 開発・テスト

```bash
cd /home/user/n02 && npm ci            # 初回のみ（Playwright を使うため）
cd tournament-poc
node tools/build.mjs                   # src → dist（dist もコミットする）
node tools/build.mjs --check           # dist が最新か
npm test                               # 98 件（node:test + tests/gas-mock.mjs）
npm run e2e                            # 36 件（desktop 18・mobile 18）
cd .. && npx eslint .                  # ルートの lint（tournament-poc の JS は対象外だが、既存への影響確認として実行）
```

- 画面テストは `tools/preview-server.mjs`（模擬 Apps Script）と `page.route` で script.google.com を振り替える。
- Playwright を単体スクリプトで使うときは `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`（`playwright install` はしない）。
- `tests/gas-mock.mjs` の `loadProject(app, { codePath })` で別の版のコードを動かせる（版の更新の確認用）。v0.3.0 → v0.4.0 の更新は「初期化する」で列が足され、既存データがそのまま使えることを確認済み。

## 6. Google 側への反映手順（毎回これ）

1. `node tools/build.mjs` → `dist/admin/Code.gs` をユーザーに貼り付けてもらう（手順ページを作り直して渡す）。
2. ユーザーが「デプロイを管理」→ 鉛筆 →「**新バージョン**」→「デプロイ」。**「新しいデプロイ」は URL が変わるので禁止**（過去に 2 回誤操作あり）。
3. スキーマ（列）を増やした版では、管理者画面（`/admin/#admin`）で「初期化する」。
4. Pages は `dist/pages/` の該当ファイルを n02-tournament-viewer にコピーして push（`config.js` は触らない）。サーバーに新しい操作を追加した場合、Apps Script 更新前は「不明な操作です。」になるので、互換に注意して順番を伝える。

Drive コネクタでできること・できないこと（確認済み）:
- できる: Apps Script プロジェクトの検索、`download_file_content`（`exportMimeType: application/vnd.google-apps.script+json`）で中身の読み出し → 貼り付け結果の照合に使える。
- できない: スクリプトの中身の書き換え（`update_file` はメタデータのみ）、デプロイ。Apps Script API や clasp はユーザーの認証情報をこの環境に渡す必要があるため使っていない。

## 7. 未検証・残タスク

実環境で未検証（[test-plan.md](test-plan.md) の確認項目）:
- R-14 の残り: 閲覧者用 Apps Script の「実行数」でのクォータ系エラーの確認、段階 4（50 人一斉アクセス・任意）、実機・店内回線での確認（[load-test.md](load-test.md)。GitHub Actions の「負荷テスト（閲覧ページ）」で実行できる）
- 2 大会の同時進行
- R-09〜R-13（R-06 は v0.5.0 で R-20「他人のアカウントでは開けない」に置き換え）
- アプリ内ブラウザ（LINE など）での Google ログインは未確認
- R-15・R-16（v0.4.0 の形式機能はユーザーが「全て問題なく出来ました」と報告済み。項目ごとの結果は未記録）

実環境で合格済み: R-01〜R-05（v0.1〜v0.3）、R-19〜R-22（v0.5.0。2026-10-21）、R-07（置き換え。保存版コードとスコープで確認）・R-08・R-17・R-18（2026-10-21。R-18 は v0.4.2 の QR 配置を含む）、R-14（2026-10-21。GitHub Actions から 50 画面 × 15 分で成功率 99.6%・p95 1.4 秒・反映 約 75〜90 秒）

未対応（ユーザーとの合意で範囲外）:
- ダブルエリミネーション、スイスドロー、試合ごとの棄権・不戦勝の入力、日時・ボードの割り当て、n02 との結果連携、大会の削除、共同主催者

## 8. ハマりどころ

- CSS の `display` が `hidden` 属性を上書きする → 両方の CSS に `[hidden] { display: none !important; }` を入れてある。
- `#groups` コンテナは `.stages`（グリッドにしない）。中の `.groups` がグリッド。
- 閲覧者用 `doGet` の HTML（Apps Script 版の画面）には qrcode.js を入れていない（QR は Pages 版のみ。ライブラリがなければ表示しない）。
- 公開データの項目は `tests/security.test.mjs` の ALLOWED で固定。項目を足すときはここも更新。
- スクラッチパッドのファイルはセッションをまたいで消える。手順ページの生成スクリプトも消えるので、次回は公開済みページを `Artifact read` して作り直す。
- この環境から script.google.com・Google API への直接通信は proxy で拒否される（403）。
