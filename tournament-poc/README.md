# n02 Tournament / League Manager — Phase 1 PoC

n02 から外部リンクで使う「トーナメント・ロビン・リーグ管理 Web アプリ」の前段階として、
**Google スプレッドシート + Google Apps Script（GAS）だけで、追加費用なしに運用できるか**を確かめるための PoC です。

- 運営者も閲覧者も、**専用の Web アプリだけ**を使います。スプレッドシートはデータ保存専用で、通常の運用では開きません。
- 運営者用と閲覧者用は**別々の Apps Script プロジェクト**です。閲覧者用は読み取り専用の権限しか持ちません。
- 既存の n02 本体（`src/` など）と League Order には一切手を加えていません。このフォルダ（`tournament-poc/`）だけで完結しています。

> 現時点の位置づけ: ローカルの模擬環境（Apps Script のサービスを Node.js で模したもの）では、自動テストで動作を確認済みです。
> **Google の実環境（Apps Script へのデプロイ・実機・50 人同時閲覧）では未検証**です。確認手順は [docs/deploy.md](docs/deploy.md)・[docs/test-plan.md](docs/test-plan.md)・[docs/load-test.md](docs/load-test.md) にあります。

---

## 1. 構成

```
                ┌──────────────────────────────┐
 運営者（本人）  │ 運営者用 Web アプリ（GAS #1）  │  実行: 自分 / アクセス: 自分のみ
 ─────────────▶ │  doGet / adminCall           │  スコープ: spreadsheets, userinfo.email
                │  ・毎回サーバー側で運営者を検証 │
                │  ・書き込みはロック + 版番号    │
                └──────────────┬───────────────┘
                               │ 読み書き（このプロジェクトだけが書く）
                               ▼
                ┌──────────────────────────────┐
                │ スプレッドシート（非公開・保存専用） │
                │ Events / Rules / Players / Stages │
                │ Groups / Entries / Matches       │
                │ History / PublicSnapshots        │
                └──────────────┬───────────────┘
                               │ PublicSnapshots だけを読む
                               ▼
                ┌──────────────────────────────┐
 閲覧者（ログイン │ 閲覧者用 Web アプリ（GAS #2）  │  実行: 自分 / アクセス: 全員（匿名可）
 不要・20〜50 人）│  doGet / getPublicSnapshot   │  スコープ: spreadsheets.readonly のみ
 ─────────────▶ │  ・CacheService で 20 秒共有   │
                │  ・約 60 秒ごとに自動更新        │
                └──────────────────────────────┘
```

閲覧者に配る URL は、GitHub Pages に置いた閲覧ページ（`dist/pages/`）です。このページは閲覧者用アプリの `?format=json` からデータだけを取得します。
Apps Script の画面（`…/exec`）を直接配らないのは、**ブラウザで複数の Google アカウントにログインしていると、URL が `/macros/u/1/…` に書き換えられて開けない**ことが実環境で分かったためです（ページ側は Cookie を送らないので影響を受けません）。

運営者が結果を保存すると、運営者用アプリが「公開してよい項目だけ」で組み立てた JSON を `PublicSnapshots` シートに書きます。
閲覧者用アプリはその JSON だけを読み、キャッシュして配ります。選手のメモ・履歴・操作者のメールアドレスなどは、閲覧者用アプリからは読めない構造です。

## 2. ファイル

| パス | 内容 |
| --- | --- |
| `dist/admin/Code.gs` `Index.html` `appsscript.json` | **運営者用プロジェクトに貼り付ける完成版**（3 ファイル） |
| `dist/viewer/Code.gs` `Index.html` `appsscript.json` | **閲覧者用プロジェクトに貼り付ける完成版**（3 ファイル） |
| `admin/src/server/*.js` | 運営者用のサーバー側ソース（設定・認可・保存・大会ロジック・公開・各操作・API） |
| `admin/src/client/*` | 運営画面の HTML / CSS / JavaScript |
| `viewer/src/server/00_viewer.js` | 閲覧者用のサーバー側ソース（読み取り・キャッシュ） |
| `viewer/src/client/*` | 閲覧画面の HTML / CSS / JavaScript（自動更新・再試行） |
| `dist/pages/` | **GitHub Pages に置く閲覧ページ**（`index.html` `viewer.css` `viewer.js` と、`config.js` の見本） |
| `viewer/src/pages/` | 閲覧ページ用の設定見本・README |
| `tools/build.mjs` | `src/` から `dist/` を生成（`--check` で一致確認） |
| `tools/preview-server.mjs` | Google に接続せずにブラウザで動作確認するためのローカルサーバー |
| `tools/loadtest.mjs` | 実際のデプロイ URL に N 人分の閲覧画面を開いて計測する負荷試験スクリプト |
| `tests/*.test.mjs` | 単体・結合テスト（Node.js 組み込みのテストランナー） |
| `tests/gas-mock.mjs` | Apps Script のサービス（SpreadsheetApp・CacheService など）の模擬実装 |
| `e2e/*.spec.mjs` | ブラウザでの画面テスト（Playwright、PC 1366×768 / スマートフォン 390×844） |
| `docs/deploy.md` | **Google Apps Script への導入・公開手順** |
| `docs/security.md` | セキュリティ設計と公開前チェックリスト |
| `docs/test-plan.md` | テスト項目・結果・未検証項目 |
| `docs/load-test.md` | **50 人同時閲覧の性能検証手順** |

`dist/` は生成物です。修正は `admin/src`・`viewer/src` に行い、`node tools/build.mjs` で作り直してください。

## 3. 機能（Phase 1）

### 運営者用 Web 画面

| 操作 | 内容 |
| --- | --- |
| 初期セットアップ | 保存先スプレッドシートの指定（共有リンクを貼るだけ。開く必要なし）・シートの初期化（何度実行しても既存データを消さない） |
| 大会の作成・編集 | 大会名・開催日（表示用文字列）・状態（準備中 / 開催中 / 終了）・公開 / 非公開・閲覧画面の既定表示・運営メモ（非公開） |
| ルール | Best of N Legs（1〜21 の奇数）、暫定ルールの表示。結果入力後は Best of を変更不可 |
| 選手 | 一括登録（1 行 1 名）・名前変更・削除（対戦カードに入っている選手は削除不可） |
| ロビングループ | グループ数・名前、登録順の自動割当、手動割当、グループ内総当たりの対戦カード作成・削除（結果入力後は削除不可） |
| 試合結果 | 取得 Leg 数の入力、「進行中として保存」「確定」「未開始に戻す」、確定済みの「訂正」 |
| 進行状況 | 全体・グループ別の確定 / 進行中 / 未開始の数、公開状態、閲覧画面へのリンク、変更履歴 |
| サンプル | 16 名・4 人 × 4 グループ・Best of 5（暫定）の検証用大会をボタン 1 つで作成 |

### 閲覧者用 Web 画面（ログイン不要）

大会名・開催日・状態・ルール（暫定表示）、グループごとの選手と勝-敗・Leg 得-失（確定試合のみ）、対戦組み合わせ・取得 Leg 数・試合状態・勝者、
データ更新時刻・取得時刻・次回自動更新までの秒数、手動更新ボタン、通信失敗時の表示。PC・スマートフォン対応、ダークモード対応。

順位の決定方法は確定していないため、**順位は表示していません**（勝-敗と Leg 数のみ。並びは登録順）。

### 試合結果の判定（Best of N）

勝利に必要な Leg 数 = `floor(N / 2) + 1`（Best of 5 なら 3）。

| 状態 | 受け付ける Leg 数（Best of 5） | 勝者 |
| --- | --- | --- |
| 未開始 | 0-0 のみ | なし |
| 進行中 | 両者 0〜2 | なし |
| 確定済み | 3-0 / 3-1 / 3-2 / 0-3 / 1-3 / 2-3 のみ | 3 Leg 取った側 |

この判定は**サーバー側で必ず実行**し、満たさない結果は保存しません（画面側にも同じ事前チェックがあり、両者が一致することをテストで確認）。
確定済みの試合は「訂正」操作を明示しない限り上書きできません。万一シートが直接書き換えられて不整合が生じても、閲覧画面では「確認中」と表示し、勝者・Leg 数を出しません。

**Best of 5 は PoC 用の暫定ルールです。** 実際の大会ルールとして確定したものではありません（画面上も「暫定ルール」と表示します）。

## 4. データ構造

すべての行に一意の ID（`EVT-…` `PLY-…` `MAT-…` など、表示名に依存しない）を持たせ、ID で参照します。列は見出し名で参照するので、列の並べ替えや末尾への列追加に耐えます。

| シート | 主な列 | 後続フェーズへの備え |
| --- | --- | --- |
| Events | event_id, name, date_label, status, is_public, is_featured, rule_id, is_sample, notes | 複数大会を並行管理可能 |
| Rules | rule_id, event_id, name, format, best_of, is_provisional | format に将来 Sets 制などを追加 |
| Players | player_id, event_id, display_name, external_ref, notes | external_ref で n02 の選手と対応付け |
| Stages | stage_id, event_id, name, type, order, rule_id, parent_stage_id, config_json | type: round_robin / single_elimination / league。parent_stage_id でロビン → A・B トーナメントを接続 |
| Groups | group_id, event_id, stage_id, name, order | — |
| Entries | entry_id, event_id, stage_id, group_id, player_id, seed | ステージへの出場枠。トーナメントのシード配置に流用 |
| Matches | match_id, event_id, stage_id, group_id, round, order, player1/2_id, player1/2_legs, status, winner_id, rule_id, next_match_id, next_match_slot, external_ref, confirmed_at | next_match_id/slot でブラケットの勝ち上がり、rule_id で試合ごとのルール、external_ref で n02 の試合と対応 |
| History | history_id, at, actor, action, entity, entity_id, event_id, before_json, after_json | 監査・訂正の追跡 |
| PublicSnapshots | event_id, is_default, version, published_at, chunk_count, chunk_01〜10 | 閲覧者向けの公開データ（最大 40 万文字） |

全行に `rev`（版番号）と `created_at` / `updated_at`（ISO 8601、UTC）があります。文字列の列は「書式なしテキスト」にして、`1/2` のような名前が日付に自動変換されないようにしています。

## 5. 安全性の要点（詳細は [docs/security.md](docs/security.md)）

- 運営者用と閲覧者用を**別プロジェクト**に分離。閲覧者用のコードには書き込み処理が存在せず、権限も `spreadsheets.readonly` のみ。
  読み込みには高度なサービス「Google Sheets API」の `values.get` を使います（`SpreadsheetApp.openById` は読むだけでも編集を含むスコープを要求することが、実環境で確認できたため）。
- `google.script.run` から呼べる関数は各プロジェクト 2 つだけ（運営者用: `doGet` `adminCall`、閲覧者用: `doGet` `getPublicSnapshot`）。
- 運営者用は Google 側で「自分のみ」に制限したうえで、**`adminCall` の呼び出しごとにサーバー側でメールアドレスを検証**（取得できなければ拒否）。
- 書き込みはスクリプトロックで直列化し、版番号（rev）が古ければ拒否（同時更新による上書きを防止）。`requestId` で二重送信を無視。
- 入力はサーバー側で型・範囲・長さ・参照先を検証。先頭が `= + - @` の文字列は数式として解釈されうるため拒否。
- 画面はデータを `textContent` で表示（HTML として解釈しない）。
- ソースコードにスプレッドシート ID・メールアドレス・認証情報を含めない（ID はスクリプト プロパティに保存）。

## 6. 開発・テスト

```bash
# リポジトリ直下で（初回のみ。画面テストの Playwright を使うため）
npm ci

cd tournament-poc
node tools/build.mjs        # src → dist
npm test                    # 単体・結合テスト（Node.js 22 以上）
npm run e2e                 # 画面テスト（Chromium）
npm run preview             # http://127.0.0.1:4180/ でローカル確認（Google 非接続）
```

ローカル確認用サーバーは、`dist/` のコードを模擬 Apps Script 上で動かします。
`/admin` が運営画面、`/viewer` が閲覧画面、`/admin?as=anonymous` は権限のないアクセスの再現です。

## 7. 今回実装していないもの（後続フェーズ）

本格的なトーナメント自動生成、ロビン順位による A・B トーナメントへの振り分け、順位決定方法、リーグの自動スケジュール生成、
n02 との試合結果の自動同期、Firebase 連携、大会の削除（Phase 1 は「非公開・終了」で代替）、棄権・不戦勝の扱い、複数管理者の運用（構造のみ用意）。

## 8. 既知の制約

- スプレッドシートにはトランザクションがありません。1 つの操作が複数シートに書く途中で Google 側のエラーが起きると、途中まで書かれた状態が残る可能性があります（入力検証はすべて書き込み前に行っています）。
- Apps Script の Web アプリには、個人アカウントの場合「このアプリケーションは Google ではなく、別のユーザーによって作成されたものです」という帯が表示されます。
- 閲覧画面への反映は、閲覧側キャッシュ（20 秒）+ 取得間隔（50〜70 秒）により、保存から**最大 90 秒程度**かかる設計です（実環境では未計測）。
