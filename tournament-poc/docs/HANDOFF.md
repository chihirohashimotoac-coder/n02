# 引き継ぎ（Handoff）— n02 Tournament / League Manager

最終更新: 2026-10-26 / 本番の版: **v0.8.0**（コミット `344c91f`。2026-10-26 01:11 UTC に GitHub Actions で本番反映・利用者が画面で確認済み）

次のセッションは、まずこのファイルと [README.md](../README.md)・[test-plan.md](test-plan.md)・[deploy.md](deploy.md) を読んでから作業してください。

**v0.9.0**（PR [chihirohashimotoac-coder/n02#34](https://github.com/chihirohashimotoac-coder/n02/pull/34)。ユーザーの確認・指示を受けてマージ）: 主催者・共同主催者を Google の `sub` で識別し、スキーマ v3 へ移行、
ログアウトの成否の表示。設計・移行表・ロールバックの境界・本番での確認手順は [v0.9-identity.md](v0.9-identity.md)。
マージで自動反映（移行・Google でログイン中の全員の再ログインを含む）。反映の結果と戻すための版番号は Actions「Tournament deploy」の Summary を見ること。
下の表の「本番の版」は v0.8.0 時点の記録で、v0.9.0 の反映後の実環境の確認（test-plan.md の R-28・R-29、v0.9-identity.md の「8.」の 6）は未記録。

---

## 1. 今の状態（要点）

| 項目 | 状態 |
| --- | --- |
| ソースの正本 | `chihirohashimotoac-coder/n02` の `main`（`tournament-poc/` 配下） |
| 本番反映 | **main へのマージで自動**（`.github/workflows/tournament-deploy.yml`。`tournament-poc/**` が変わったとき）。手動で `dry-run` / `deploy` / `rollback` も実行できる |
| 運営用 Apps Script | v0.8.0。反映前は版 12（v0.7.1） |
| 閲覧者用 Apps Script | v0.8.0。反映前は版 5（v0.7.1） |
| スキーマ | v2（移行済み。移行前の内容は同じスプレッドシートの `bak-s1-…` シートに残る） |
| GitHub Pages | `n02-tournament-viewer` の `main`（反映コミット `1bf4921`「deploy: n02 344c91f…」）。`release.json` = `{ sha: 344c91f…, version: 0.8.0 }`（GitHub 上で確認） |
| PR プレビュー | Vercel。PR ごとに `<プレビュー>/tournament/` で操作できる（模擬データ。本番には保存しない） |

反映後の新しい GAS の版番号は、Actions「Tournament deploy」の 2026-10-26 01:10 UTC の実行（mode `deploy`）の Summary に出ている（このセッションからは Summary の本文を読めなかったため、ここには書いていない）。

## 2. リポジトリとブランチ

| リポジトリ | 役割 | 備考 |
| --- | --- | --- |
| **chihirohashimotoac-coder/n02** | ソースの正本（`tournament-poc/`）。n02 本体のトップ画面に入口のリンク（`src/components/tournament/TournamentPortalLink.tsx`） | 作業はシステムから指定されたブランチで行い、PR を作る。マージはユーザーが行う |
| chihirohashimotoac-coder/n02-tournament-viewer | GitHub Pages の公開先 | **手で編集しない**。ワークフローが `dist/pages/` を写して push する（Deploy key）。`config.js`・`admin/config.js`・`README.md`・`CNAME`・`.nojekyll` は写さない（残す） |

- v0.8.0 は PR [chihirohashimotoac-coder/n02#31](https://github.com/chihirohashimotoac-coder/n02/pull/31)（ブランチ `claude/zen-ride-35c2c3`）でマージ。
- GitHub の操作は MCP（`mcp__github__*`）。公開リポジトリの状態は `api.github.com` を curl でも読める。この環境から github.io・script.google.com・vercel.app へは直接つながらない（プロキシで拒否）。

## 3. 守ること

ユーザーの指示（要点）:
- マージ・自動マージの設定・本番反映の有効化は、ユーザーの指示なしにしない。
- 認証情報・refresh token・管理者の鍵・管理パスワードを、ソース・ログ・成果物・会話に出さない。ユーザーに貼らせない（GitHub の画面に直接入れてもらう）。
- PR で Secrets を使わない（`pull_request_target` を使わない）。匿名の管理 API を作らない。推測した ID・URL を書かない。保護設定を緩めない。有料サービスを契約しない。
- 不明な仕様・未実施のテストを推測で補わない（未検証は「未検証」と書く）。既存の画面のデザインは変えず、機能を足す。
- リポジトリ直下の [AGENTS.md](../../AGENTS.md)（依存の追加・更新、秘密情報の扱い）に従う。

運用上の約束:
- 返答は日本語（丁寧語・簡潔・正直）。手順は短く（長い手順は「わかりにくい」と言われたことがある）。こちらでできることはこちらでやる。
- 外部への操作（Google 側の変更・閲覧リポジトリへの push・ワークフローの実行など）は事前に承認を得る。
- OAuth クライアント ID・大会 ID・スクリプト ID は秘密ではない（会話でもらってよい）。

## 4. 構成

```
閲覧者 ─ GitHub Pages（/・/events/）──fetch(Cookie なし)──▶ 閲覧者用 Web アプリ（?format=json / list / version、readonly）──┐
主催者（Google ログイン）・共同主催者・店舗スタッフ（管理パスワード）                                                    │
       ─ GitHub Pages（/admin/、#e=大会ID）──POST──▶ 運営用 Web アプリ（doPost。セッション・鍵を毎回確認）────────────┼─▶ スプレッドシート「Tournament PoC」
管理者 ─ GitHub Pages（/admin/#admin）── ADMIN_KEY ─┘                                                               ┘
```

| 対象 | URL・名前 |
| --- | --- |
| ポータル | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/events/ |
| 閲覧ページ | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/ （`?event=EVT-…`、`&qr=0/1`、`&interval=秒`） |
| 運営画面 | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/admin/ （大会は `#e=EVT-…`、管理者は `#admin`） |
| 反映の確認 | https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/release.json （今の Pages のコミット） |
| 閲覧者用 Web アプリ | Apps Script「n02 Tournament Viewer」…`AKfycbyI8B7e…/exec`（Pages の `config.js`）。`?format=version` で版と release（コミット） |
| 運営用 Web アプリ | Apps Script「n02 Tournament Admin」…`AKfycbwC41CD…/exec`（Pages の `admin/config.js`）。GET で版・スキーマ・release |
| 保存先 | スプレッドシート「Tournament PoC」（マイドライブ「n02 Tournament」フォルダ。共有なし。ID はスクリプト プロパティ `SPREADSHEET_ID`） |
| Google Cloud | プロジェクト `n02-tournament`。OAuth クライアント ID `99512252323-um86…apps.googleusercontent.com`（承認済みの JavaScript 生成元 `https://chihirohashimotoac-coder.github.io`） |

- 運営用: スコープ `spreadsheets`・`script.external_request`（tokeninfo）。実行「自分」・アクセス「全員」。スクリプト プロパティ `SPREADSHEET_ID` `ADMIN_KEY` `GOOGLE_CLIENT_ID` `VIEWER_URL`、`SCHEMA_VERSION`（=2）、`WRITE_JOURNAL`（書き込み中だけ）。
- 閲覧者用: スコープ `spreadsheets.readonly`、高度なサービス Sheets API。
- 公開関数は運営用 `doGet`・`doPost`、閲覧者用 `doGet`・`getPublicSnapshot` だけ（`tests/security.test.mjs` で固定）。

## 5. 本番反映の仕組み（v0.8.0〜）

手順・初期設定・戻し方の詳細は [deploy.md](deploy.md) の「v0.8.0 から: main へのマージで本番に反映する」。

- 順序: 検証（Secrets なし）→ main が先に進んでいないか → 設定の確認 → **管理者の確認**（今の運営用 GAS の `bootstrap` を管理者の鍵で呼ぶ。鍵・保存先の異常なら何も書かずに止まる）→ バックアップ（コード・版番号。成果物 `tournament-backup-<SHA>`）→ 運営用 GAS → スキーマの移行 → 閲覧者用 GAS → 動作確認 → Pages → 公開確認（`release.json`）。
- 既存のデプロイの版を差し替える（URL は変わらない。新しいデプロイは作らない）。デプロイ ID は Pages の `config.js`・`admin/config.js` から読む。権限（スコープ）・公開設定が変わる版は自動では反映せず止まる（所有者がエディタで承認し直してから）。
- GitHub の設定（済み）: 環境 `tournament-production`（main のみ）に Variables `TOURNAMENT_ADMIN_SCRIPT_ID`・`TOURNAMENT_VIEWER_SCRIPT_ID`・`TOURNAMENT_PAGES_URL`・`TOURNAMENT_VIEWER_REPO`、Secrets `TOURNAMENT_CLASPRC_JSON`（clasp 3.4.1 の `.clasprc.json`）・`TOURNAMENT_ADMIN_KEY`・`TOURNAMENT_VIEWER_DEPLOY_KEY`。閲覧リポジトリに書き込み可の Deploy key。**リポジトリ**の変数 `TOURNAMENT_DEPLOY_ENABLED=true`（消すか `true` 以外にすると自動反映が止まる。手動の dry-run はできる）。
- 戻す: Actions「Tournament deploy」を mode `rollback`（運営用・閲覧者用の版番号）。v0.8.0 の前は運営用 版 12・閲覧者用 版 5。旧版（v0.6.0・v0.7.1）は移行後のシートでも読み書きできる（`tests/storage.test.mjs`）。Pages は閲覧リポジトリの `deploy: …` コミットを revert。
- 注意: `tournament-poc/**` を変える PR（ドキュメントだけでも）をマージすると、同じ内容でも反映が走り、GAS に新しい版ができる（害はない）。
- Actions の注意表示: `actions/checkout@v4`・`setup-node@v4`・`upload-artifact@v4` の Node.js 20 の終了予告（今は Node.js 24 で動いている）。版を上げるときは AGENTS.md の手順（目的・版・公開日の確認と承認）で。

## 6. v0.8.0 の要点（コードの地図）

- 形式 10 種（作成画面の順）: `robin_ko`（既定）・`elimination`・`robin_ab`・`double_elimination`・`robin`・`league`・`league_playoff`・`multi_robin_ko`・`series_playoff`・`swiss`。定義は `shared/formats.js` だけ（順・説明・流れ・予定試合数の見積もり）。
- v0.9.0: 認証 `02_auth.js`（ID トークンの sub・hd、セッションに sub）、紐付けと承認 `02b_identity.js`、移行の値の移し替え `03_storage.js` の `migrateRecords_`。
- サーバー（`admin/src/server/`）: 設定 `00_config.js`、保存 `03_storage.js`（まとめて書き込み `commitContext_`・スキーマ v2・`migrateStorage`）、勝敗・順位 `04_domain.js`、ブラケットの汎用の組み立て `04b_bracket.js`（SE・DE・シリーズの節・回戦ごとの抽選）、スイス式 `04c_swiss.js`、表示 `04e_view.js`、組分け `04f_draw.js`、操作 `06_actions.js`・`06b_ops.js`（F01〜F21）、API `07_api.js`。
- 画面: 運営 `admin/src/client/admin.js`（CSV `admin-io.js`・印刷 `print-landscape.css`）、閲覧 `viewer/src/client/`、ポータル `portal/src/client/`、一覧の要約 `shared/summary.js`。
- 回戦ごとの抽選（drawMode=redraw）の訂正: 抽選済みの後の試合が未開始なら勝者（と 3 位決定戦の敗者）を差し替え、始まっていれば拒否。後の回戦があれば確定の取り消しは拒否（`propagateRedrawn_`）。
- PR プレビュー: `tools/preview-site/`（`vercel-build.mjs`・`build-preview-site.mjs`・`mock-entry.mjs` のサンプル）。説明は [../../docs/preview-deployment.md](../../docs/preview-deployment.md)。リポジトリ直下の `vercel.json`・`package.json`（`build:preview-host`）・`vite.config.ts`（プレビューのビルドだけ Service Worker が `/tournament/` を置き換えない）も v0.8.0 で変更した（ユーザーの依頼による。本番の n02 の成果物は変わらない）。
- 本番反映: `tools/deploy/deploy.mjs`・`gas-api.mjs`。作業の記録は [v0.8-work.md](v0.8-work.md)。

## 7. 開発・テスト

```bash
cd /home/user/n02 && npm ci            # 初回のみ（Playwright を使うため）
cd tournament-poc
node tools/build.mjs                   # src → dist（dist もコミットする）
node tools/build.mjs --check           # dist が最新か（CI でも確認）
npm test                               # 単体・結合 194 件（node:test + tests/gas-mock.mjs）
npm run e2e                            # 画面テスト（PC・スマートフォン。件数は test-plan.md の 3.）
cd .. && npx eslint .                  # ルートの lint
```

- 画面テストは `tools/preview-server.mjs`（模擬 Apps Script、ポート 4180）。Google のログインは `fakeGoogle`・`googleLogin`（`e2e/helpers.mjs`）で模擬。
- Playwright を単体スクリプトで使うときは `chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`（`playwright install` はしない）。
- `tests/gas-mock.mjs` の `loadProject(app, { codePath })` で旧版のコード（`tests/fixtures/admin-v0.6.0.gs`・`admin-v0.7.1.gs`・`admin-v0.8.0.gs`・`viewer-v0.2.0.gs`）を動かせる（移行・ロールバックの確認用）。
- v0.9.0 のテスト: `loginAs(email, claims)` の claims で sub・hd を変える（`WORKSPACE` = hd あり。example.org のままでは Google が持ち主を保証しないアドレス）。紐付けは `link(auth)`。
- `tests/deploy.test.mjs` は Google を模擬して本番反映の順序と止める条件を確かめる（実物の旧版コードに `bootstrap` を答えさせる）。

## 8. 実環境の確認状況・残り

確認済み（実環境）:
- R-01〜R-05・R-07・R-08・R-14・R-17〜R-23（v0.6.0 まで。[test-plan.md](test-plan.md)）
- R-24（dry-run）・R-25（本番反映）: 2026-10-26 合格。ユーザーが画面を見て「問題なさそう」と報告

未検証（模擬環境・Chromium では合格）:
- R-26: 新しい形式（DE・スイス式・シリーズ・ディビジョンのリーグ）を本番で作って数試合入力
- R-27: 印刷（実際のプリンター・Safari）・CSV（Excel）
- Apps Script 上での大人数の処理時間（128 名・448 試合など。模擬環境では 1 操作数十 ms・公開データは上限の約 82%）
- 実機（iPhone・Android）、アプリ内ブラウザでの Google ログイン、R-09〜R-13、2 大会の同時進行

範囲外（依頼があれば見積もりから）: n02 との試合結果の連携、共同主催者への招待メール、祝日の自動判定。

相談済みの数値: 作成は 1 人 1 時間 5 件・全体 1 時間 10 件、ログイン（tokeninfo）は全体で 1 分 30 回、管理パスワードは 10 回間違いで 10 分停止、大会は全体で 200 件、1 大会の選手は 128 名、公開データは 40 万文字。スプレッドシートは 1 ファイル 1,000 万セル（二次情報）。

## 9. 版の履歴（要点）

- v0.1〜v0.2: GAS + スプレッドシートの PoC、閲覧ページを GitHub Pages に
- v0.4: 大会形式を主催者が組める（段階・A/B 進出・順位の決め方・セット制・3 位決定戦など）。v0.4.1〜v0.4.3: まとめて確定・QR コード・トーナメント表
- v0.5: Google ログイン＋大会ごとの管理パスワード。v0.5.1: 自動更新の間隔を延ばす
- v0.6: 大会の削除（JSON で保存してから）
- v0.7: ポータル「トーナメント・リーグ」・n02 本体の入口。v0.7.1: レビュー指摘の修正
- v0.8.0: 大会形式 10 種・F01〜F21・スキーマ v2・PR プレビュー・マージで本番反映（2026-10-26 本番反映）

## 10. ハマりどころ

- CSS の `display` が `hidden` 属性を上書きする → 両方の CSS に `[hidden] { display: none !important; }`。
- 閲覧ページの CSP は `style-src 'self'`（`style` 属性は不可、CSSOM は可）。運営ページは `accounts.google.com/gsi/` を許可。
- 公開データの項目は `tests/security.test.mjs`・`tests/v08-public.test.mjs` の許可リストで固定。項目を足すときはここも更新。
- 閲覧者用 GAS は公開データを 20 秒キャッシュする（反映の確認や画面テストでは待つ）。
- プレビューのサンプル作成は本番と同じ「1 人 1 時間 5 件」の制限に当たるので、模擬の時計を進めてから作っている（`mock-entry.mjs`）。
- 行の削除は `deleteRecords_`。見出し以外の全行を消すとスプレッドシートがエラーにするので空行を足してから消す。
- 画面テストで「大会を作成」ボタンを探すときは `exact: true`。
- スクラッチパッドのファイルはセッションをまたいで消える。
