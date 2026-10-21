# 引き継ぎ（Handoff）— n02 Tournament / League Manager PoC

最終更新: 2026-10-21 / 対象版: **v0.7.0**（ポータル「トーナメント・リーグ」。**本番未反映**。v0.6.0 までは本番反映・動作確認済み）

次のセッションは、まずこのファイルと [README.md](../README.md)・[test-plan.md](test-plan.md) を読んでから作業してください。
作業を始める前に、ユーザーに次の依頼内容を確認してください（現時点で未着手の依頼はありません）。

---

## 1. リポジトリとブランチ

| リポジトリ | 役割 | ブランチ | 備考 |
| --- | --- | --- | --- |
| **chihirohashimotoac-coder/n02** | **ソースの正本**（`tournament-poc/` 配下。v0.7.0 では n02 本体のトップ画面に入口のリンクも追加） | `claude/gifted-bardeen-eistmm`（最新。`claude/confident-carson-4jh0g5` に main をマージして派生） | `claude/bold-albattani-5vsk78`（v0.4.1 まで）から派生。未マージ。**PR は未作成**（ユーザーの指示があるまで作らない） |
| chihirohashimotoac-coder/n02-tournament-viewer | GitHub Pages の公開先（`dist/pages/` のコピー置き場） | `main` | 手で編集しないで `dist/pages/` からコピーする。例外は `config.js`・`admin/config.js`（Web アプリの URL と OAuth クライアント ID。コピーで上書きしない）と `README.md`（`admin/` の行が手で足されている）。負荷テスト用に `.github/workflows/loadtest.yml`（← `tournament-poc/tools/pages-loadtest.yml`）と `tools/loadtest.mjs`（← `tournament-poc/tools/loadtest.mjs`）も置いてある |

- 新しいセッションの作業ブランチがシステムから指定された場合は、そのブランチを `origin/claude/confident-carson-4jh0g5` から作って push する（このセッションでもそうした）。
- Pages を更新するときだけ `add_repo` で n02-tournament-viewer を追加し（push 権限。ユーザーの許可が要る）、`/home/user/n02-tournament-viewer` に clone する。
- GitHub の操作は MCP（`mcp__github__*`）。Pages の公開状況は `actions_list`（workflow `390482601` = pages build and deployment）で確認できる。この環境から github.io・script.google.com へは直接つながらない。

## 2. 守ること

最初の依頼の制約（原文）:
- 「既存n02のソースコードは変更しない」（`tournament-poc/` 以外は触らない。ルートの package.json なども不可）
- 「既存League Orderにも変更を加えない」
- 「既存のGoogleファイルを削除・上書きしない」
- 「既存の実大会データは使用しない」
- 「課金が必要なサービスを導入しない」
- 「不明なAPI仕様やテスト結果を推測で補完しない」（未検証は「未検証」と書く）
- 「Googleの認証情報や秘密情報をソースコードに埋め込まない」
- 「Googleアカウントへの接続・書き込みができない場合は、接続したと偽らず、ユーザーがApps Scriptエディタに貼り付けられる形で成果物を出力すること」
- 「今回の作業では本番公開やn02への組み込みは行わない」（n02 本体への組み込みはしていない。GitHub Pages・Apps Script への反映はユーザーの依頼・了承のもとで行っている）

運用上の約束:
- ユーザーへの返答は**日本語**（丁寧語・簡潔・正直）。手順はわかりやすく短く（長い手順は「わかりにくい」と言われたことがある。こちらでできることはこちらでやる）。
- 外部への操作（Google 側の変更、公開リポジトリへの追加、ワークフローの実行など）は**事前に承認を得る**。
- 管理者の鍵（ADMIN_KEY）・管理パスワード・クライアント シークレットは**会話に貼らないよう**案内済み。こちらからも求めない。OAuth クライアント ID と大会 ID は秘密ではないので、会話でもらってよい。

## 3. 構成（v0.6.0）

```
閲覧者 ─ GitHub Pages（/）──fetch(Cookie なし)──▶ 閲覧者用 Web アプリ（?format=json, readonly）──────────┐
主催者（Google ログイン）・店舗スタッフ（管理パスワード）                                                  │
       ─ GitHub Pages（/admin/、/admin/#e=大会ID）─POST─▶ 運営用 Web アプリ（doPost, セッションを毎回検証）─┼─▶ スプレッドシート「Tournament PoC」
管理者 ─ GitHub Pages（/admin/#admin）──── ADMIN_KEY ─┘                                                   ┘
```

| 対象 | URL・名前 |
| --- | --- |
| 閲覧ページ | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/ （`?event=EVT-…`、`&qr=0/1`、`&interval=秒` で間隔固定） |
| 運営画面 | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/admin/ （大会は `#e=EVT-…`、管理者は `#admin`） |
| 閲覧者用 Web アプリ | Apps Script「n02 Tournament Viewer」…`AKfycbyI8B7e…/exec`（Pages の `config.js`）。**v0.2.0 以降コード変更なし** |
| 運営用 Web アプリ | Apps Script「n02 Tournament Admin」…`AKfycbwC41CD…/exec`（Pages の `admin/config.js`）。v0.6.0 |
| 保存先 | スプレッドシート「Tournament PoC」（マイドライブ「n02 Tournament」フォルダ。共有なし。ID はスクリプト プロパティ `SPREADSHEET_ID`） |
| Google Cloud | プロジェクト `n02-tournament`。OAuth クライアント ID `99512252323-um86…apps.googleusercontent.com`（ウェブ、承認済みの JavaScript 生成元 `https://chihirohashimotoac-coder.github.io`）。同じ ID を運営用のスクリプト プロパティ `GOOGLE_CLIENT_ID` と Pages の `admin/config.js` の `googleClientId` に設定済み |
| ユーザー向け手順ページ | https://claude.ai/artifact/T1DVKPSYzyE2EU93ox7Uon （今は v0.6.0 の手順。コピーボタン付き）。生成スクリプトはスクラッチパッドにあったので次のセッションでは消えている。作り直すときは `Artifact read` で読んでから同じ URL に公開するか、新しいページを作って URL をここに書く |

- 運営用: スコープ `spreadsheets` と `script.external_request`（Google ログインの確認に tokeninfo を呼ぶ）。実行「自分」・アクセス「全員」。スクリプト プロパティ `SPREADSHEET_ID` `ADMIN_KEY` `GOOGLE_CLIENT_ID` `VIEWER_URL`。
- 閲覧者用: スコープ `spreadsheets.readonly`、高度なサービス Sheets API（`SpreadsheetApp.openById` は readonly では使えない）。
- Apps Script の画面（HtmlService）は複数 Google アカウントのブラウザで開けないため、画面はすべて GitHub Pages。
- GAS プロジェクトはマイドライブ直下からフォルダに移しても動く（ファイル ID・デプロイ ID は変わらない）とユーザーに回答済み。

## 3.5 v0.7.0（ポータル）の要点

- ポータル: `portal/src/client/*` → `dist/pages/events/`。設定は既存の `../config.js` と `../admin/config.js` を読む（新しい設定ファイルは不要）
- 閲覧者用 Apps Script: `?format=list`（PublicSnapshots から全公開大会の要約。キャッシュ・notModified）。公開関数は doGet と getPublicSnapshot のまま
- 運営用 Apps Script: 操作 `myEvents`（scope `google`）。公開データに `event.playerCount` を追加
- 要約の計算は `shared/summary.js`（両方の Code.gs の末尾に入る）
- 運営画面: `#new`（作成欄へ移る）、上部にポータルへのリンク
- n02 本体: `src/components/tournament/TournamentPortalLink.tsx`・`src/styles/tournament-link.css`。トップ画面のヘッダー直下に専用の帯。リンク先は `VITE_TOURNAMENT_PORTAL_URL`（既定は本番の `…/n02-tournament-viewer/events/`）
- 確認用プレビュー: `node tools/preview-site/build-preview-site.mjs <出力先>`。実物の Code.gs をブラウザ内の模擬環境で動かす静的サイト（Google 非接続）。claude.ai の Artifact に公開済み: https://claude.ai/artifact/XcYhUQcBWLY7tJ6hUmzZeN
- 反映手順は [deploy.md](deploy.md) の「v0.7.0 に更新するとき」（Apps Script を先に、Pages を後に）

## 4. 現在の状態（2026-10-21 時点。v0.6.0 まで反映・確認済み。v0.7.0 は未反映）

| 項目 | 状態 |
| --- | --- |
| ソース（n02 ブランチ） | v0.6.0 まで push 済み |
| 運営用 Apps Script | v0.6.0。ユーザーが貼り替え・新バージョンでデプロイ済み（v0.5.0 のときは Drive コネクタで読み出してビルドと完全一致を確認） |
| 閲覧者用 Apps Script | v0.2.0 のまま（Drive コネクタでビルドと一致を確認済み） |
| GitHub Pages | 運営画面 v0.6.0（`8b5a4b4`）、閲覧ページ v0.5.1（`bf7e070`）。pages build and deployment 成功 |
| 実環境の確認 | R-01〜R-05・R-07・R-08・R-14・R-17〜R-23 合格（[test-plan.md](test-plan.md)）。v0.6.0 の削除もユーザーが「全て問題なく完了」と報告 |

### 版の履歴（要点）
- v0.1.x: GAS + スプレッドシートの PoC、閲覧者用を Sheets API に変更
- v0.2.0: 閲覧ページを GitHub Pages に（複数アカウント問題の回避）
- v0.3.0: 誰でも主催・大会ごとの秘密の運営用 URL（v0.5.0 で廃止）
- v0.4.0: 大会形式を主催者が組める（段階・ロビン/リーグ/トーナメント・A/B 進出・順位の決め方・2 回総当たり・節名・段階/回戦ごとの Best of・セット制・3 位決定戦・シード・不戦勝）
- v0.4.1: 結果の「まとめて確定」・入力途中の値の保持・QR コード
- v0.4.2: 閲覧ページの QR を右余白に収まる大きさで（内容は動かさない・余白がなければ出さない）
- v0.4.3: 閲覧ページのトーナメントを、回戦ごとの列に並べて線でつなぐトーナメント表に
- v0.5.0: 作成・運営を Google ログイン（作った本人）＋大会ごとの管理パスワード（店舗スタッフ）に。運営用 URL（鍵）と作成コードを廃止。tokeninfo でログイン確認 → 6 時間のセッション（CacheService）
- v0.5.1: 閲覧ページの自動更新を最後の更新からの時間で延ばす（60 分まで約 60 秒・3 時間まで 5 分・24 時間まで 30 分・14 日まで 60 分・以降停止。終了・全試合確定で停止。表示に戻ったとき・手動更新で再開）。Apps Script の「実行数」を抑えるため
- v0.6.0: 大会ごとの削除（アーカイブ）。主催者と管理者が全データを JSON で保存 → 大会名を入力 → 削除

## 5. 開発・テスト

```bash
cd /home/user/n02 && npm ci            # 初回のみ（Playwright を使うため）
cd tournament-poc
node tools/build.mjs                   # src → dist（dist もコミットする）
node tools/build.mjs --check           # dist が最新か
npm test                               # 106 件（node:test + tests/gas-mock.mjs）
npm run e2e                            # 40 件（desktop 20・mobile 20）
cd .. && npx eslint .                  # ルートの lint（既存への影響確認として実行）
```

- 画面テストは `tools/preview-server.mjs`（模擬 Apps Script）と `page.route` で script.google.com を振り替える。Google のログインボタンは `fakeGoogle(page, request, email)`・`googleLogin(page)`（e2e/helpers.mjs）で模擬し、tokeninfo は gas-mock の `UrlFetchApp` が模擬する（`fakeIdToken`）。
- Playwright を単体スクリプトで使うときは `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`（`playwright install` はしない）。
- 模擬サーバーを別ポートで立てるときは 4190 など fetch が禁止しているポートを避ける（4185 は使えた）。
- `tests/gas-mock.mjs` の `loadProject(app, { codePath })` で別の版のコードを動かせる（版の更新の確認用）。

## 6. Google 側・Pages への反映手順（毎回これ）

1. `node tools/build.mjs` → 運営用の変更があれば `dist/admin/Code.gs`（権限が変われば `appsscript.json` も）を、手順ページ（コピーボタン付き）でユーザーに貼り付けてもらう。
2. ユーザーが「デプロイを管理」→ 鉛筆 →「**新バージョン**」→「デプロイ」。**「新しいデプロイ」は URL が変わるので禁止**（過去に 2 回誤操作あり）。
3. 列を増やした版では、管理者画面（`/admin/#admin`）で「初期化する」。権限が増えた版では、エディタで `doGet` を実行して「すべて選択」で承認し直す。
4. Pages は `dist/pages/` の該当ファイルを n02-tournament-viewer にコピーして push（`config.js`・`admin/config.js`・`README.md` は上書きしない）。サーバーに操作を追加した版は、Apps Script 更新前だとその操作だけ「不明な操作です。」になる。既存の操作を変える版は順番に注意して伝える。
5. 反映を HANDOFF・test-plan に記録する。

Drive コネクタ（`mcp__Google_Drive__*`）でできること・できないこと（確認済み）:
- できる: Apps Script プロジェクト・フォルダの検索、`download_file_content`（`exportMimeType: application/vnd.google-apps.script+json`）で中身の読み出し → 貼り付け結果の照合、ファイルの共有設定の確認。
- できない: スクリプトの中身の書き換え、デプロイ。Apps Script API や clasp はユーザーの認証情報を渡す必要があるため使っていない。

## 7. 未検証・残タスク・相談済みの事項

実環境で未検証（[test-plan.md](test-plan.md)）:
- R-09〜R-13（文字列の保存・不正な結果の拒否・同時更新・通信失敗・運営画面だけで一通り）。手順はユーザーに一度渡したが「わかりにくい」と言われ、R-14 の方を先に進めた
- 2 大会の同時進行、アプリ内ブラウザ（LINE など）での Google ログイン
- R-14 の残り: 段階 4（50 人一斉アクセス）、実機・店内回線、閲覧者用 Apps Script の「実行数」でのクォータ系エラーの確認
- v0.5.1 の自動更新の休止・停止の表示（実環境で画面を見ていない）
- R-15・R-16 は「全て問題なく出来ました」との報告のみで、項目ごとの結果は未記録

ユーザーと相談済みの数値・判断:
- 容量: スプレッドシートは 1 ファイル 1,000 万セル（二次情報）。実測で 16 名・24 試合の大会 1 つ ≒ 120 行 ≒ 3,100 セル。アプリの上限 `MAX_EVENTS_TOTAL` 200 件（Google ログインの人の作成のみ制限）。運営画面は操作ごとに全シートを読むので、データが増えると遅くなる見込み（未計測）。公開中の大会が多いほど閲覧者用の読み込みが重くなるので、終わった大会は非公開か削除を勧めた
- 実行数: Web アプリの実行回数に日次上限の記載はなく料金も発生しない（公式の割り当て表）。増えたのは負荷テストと開きっぱなしの閲覧ページが原因と説明し、v0.5.1 で抑えた
- 作成の上限: 1 人 1 時間 5 件・全体 1 時間 10 件。ログイン（tokeninfo）は全体で 1 分 30 回まで。管理パスワードは 10 回間違いで 10 分停止

未対応（ユーザーとの合意で範囲外。依頼があれば見積もりから）:
- ダブルエリミネーション、スイスドロー、試合ごとの棄権・不戦勝の入力、日時・ボードの割り当て、n02 との結果連携、保存ファイル（JSON）からの大会の復元、共同主催者（Google アカウントは 1 大会 1 人）
- 大会形式の追加について質問あり（2026-10-21）。既存の段階の組み合わせ（ひな形）の追加は軽い（`TEMPLATES_`・`createEventRecords_` と運営画面の `TEMPLATES`）。新しい段階の種類（ダブルエリミ・スイスなど）は組み合わせ・順位・表示・テストを新しく作る必要があり重い、と回答

## 8. ハマりどころ

- CSS の `display` が `hidden` 属性を上書きする → 両方の CSS に `[hidden] { display: none !important; }` を入れてある。
- 閲覧ページの CSP は `style-src 'self'` なので `style` 属性は使えない（CSSOM の `el.style.x =` は可）。運営ページは Google のログイン用に `accounts.google.com/gsi/` を CSP に許可し、Referrer は `strict-origin`（Google がオリジンを確かめるため）。
- スマートフォン用の `.status { grid-area }` がトーナメント表の札にも効いた → `.bmatch .bmatch__status` で上書き。
- 公開データの項目は `tests/security.test.mjs` の ALLOWED で固定。項目を足すときはここも更新。
- 全試合確定の判定は「試合のない段階がないこと」も条件（ロビン → A/B でトーナメント表を作る前に止まらないように）。
- 行の削除は `deleteRecords_` で連続行をまとめて消す。見出し以外の全行を消すとスプレッドシートがエラーにするので空行を足してから消している。
- 負荷テストツールは既定で `interval=60` に固定（v0.5.1 の間隔の延長を避けるため）。
- 画面テストで「大会を作成」ボタンを探すときは `exact: true`（「サンプル大会を作成」に部分一致する）。
- スクラッチパッドのファイルはセッションをまたいで消える。
