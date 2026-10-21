# n02 Tournament / League Manager — Phase 1 PoC

n02 から外部リンクで使う「トーナメント・ロビン・リーグ管理 Web アプリ」の前段階として、
**Google スプレッドシート + Google Apps Script（GAS）だけで、追加費用なしに運用できるか**を確かめるための PoC です。

- 運営者も閲覧者も、**専用の Web アプリだけ**を使います。スプレッドシートはデータ保存専用で、通常の運用では開きません。
- 運営者用と閲覧者用は**別々の Apps Script プロジェクト**です。閲覧者用は読み取り専用の権限しか持ちません。
- 既存の n02 本体（`src/` など）と League Order には一切手を加えていません。このフォルダ（`tournament-poc/`）だけで完結しています。

> 作業を引き継ぐ場合は、まず [docs/HANDOFF.md](docs/HANDOFF.md) を読んでください。

> 現時点の位置づけ: ローカルの模擬環境（Apps Script のサービスを Node.js で模したもの）では、自動テストで動作を確認済みです。
> **Google の実環境（Apps Script へのデプロイ・実機・50 人同時閲覧）では未検証**です。確認手順は [docs/deploy.md](docs/deploy.md)・[docs/test-plan.md](docs/test-plan.md)・[docs/load-test.md](docs/load-test.md) にあります。

---

## 1. 構成

```
 主催者（誰でも・ログイン不要）          閲覧者（ログイン不要・20〜50 人）
   │ 運営用 URL（#e=大会ID&k=鍵）           │ 閲覧ページの URL（?event=大会ID）
   ▼                                         ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ GitHub Pages（静的ページ）      │  │ GitHub Pages（静的ページ）      │
│  /admin/  運営画面              │  │  /        閲覧ページ            │
└──────────────┬──────────────┘  └──────────────┬──────────────┘
               │ fetch POST（Cookie なし）              │ fetch GET ?format=json（Cookie なし）
               ▼                                         ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│ 運営用 Apps Script（API のみ）   │  │ 閲覧者用 Apps Script            │
│  実行: 自分 / アクセス: 全員     │  │  実行: 自分 / アクセス: 全員     │
│  doGet / doPost                │  │  doGet / getPublicSnapshot     │
│  ・毎回、大会の鍵を検証          │  │  ・spreadsheets.readonly のみ   │
│  ・ロック + 版番号で同時更新防止 │  │  ・CacheService で 20 秒共有    │
│  スコープ: spreadsheets のみ    │  │                                │
└──────────────┬──────────────┘  └──────────────┬──────────────┘
               │ 読み書き（このプロジェクトだけが書く）    │ PublicSnapshots だけを読む
               ▼                                         │
┌──────────────────────────────────────────────┐   │
│ スプレッドシート（あなたの Drive・非公開・保存専用）       │◀─┘
│ Events / Rules / Players / Stages / Groups / Entries │
│ Matches / History / PublicSnapshots                   │
└──────────────────────────────────────────────┘
```

**主催者の確認方法（ログイン不要）**

- 誰でも運営画面から大会を作れます。作ると、その大会専用の「運営用 URL」が 1 回だけ表示されます。
  URL の `#` 以降に、推測できない長さの鍵（244 ビット相当の乱数）が入っています。
- この URL を持っている人が、その大会の主催者です。他の大会は操作できません（サーバー側で毎回確認）。
- シートには鍵そのものではなく、SHA-256 のハッシュだけを保存します。URL が漏れたら「再発行」で古い URL を無効にできます。
- 管理者（あなた）は、スクリプト プロパティ `ADMIN_KEY` に設定した文字列で `/admin/#admin` から入り、
  初期設定・全大会の管理・運営用 URL の再発行（紛失時）ができます。
- スクリプト プロパティ `CREATE_CODE`（作成コード）を設定すると、そのコードを知っている人だけが大会を作れます。
  未設定なら誰でも作れます（1 時間に 10 件までの上限あり）。

Apps Script の画面（`…/exec`）は、ブラウザで複数の Google アカウントにログインしていると開けないことが実環境で分かったため、
運営画面・閲覧ページとも GitHub Pages に置き、Apps Script とは Cookie を送らない fetch で通信します。

運営者が結果を保存すると、運営用アプリが「公開してよい項目だけ」で組み立てた JSON を `PublicSnapshots` シートに書きます。
閲覧者用アプリはその JSON だけを読み、キャッシュして配ります。選手のメモ・履歴・鍵のハッシュなどは、閲覧者用アプリからは読めない構造です。

## 2. ファイル

| パス | 内容 |
| --- | --- |
| `dist/admin/Code.gs` `appsscript.json` | **運営用 Apps Script に貼り付ける完成版**（2 ファイル。画面は持たない） |
| `dist/viewer/Code.gs` `Index.html` `appsscript.json` | **閲覧者用 Apps Script に貼り付ける完成版**（3 ファイル） |
| `dist/pages/` | **GitHub Pages に置くファイル**。ルートが閲覧ページ、`admin/` が運営画面。各 `config.example.js` を `config.js` にして URL を設定 |
| `admin/src/server/*.js` | 運営用のサーバー側ソース（設定・認証・保存・大会ロジック・公開・各操作・API） |
| `admin/src/client/*` | 運営画面の HTML / CSS / JavaScript |
| `viewer/src/server/00_viewer.js` | 閲覧者用のサーバー側ソース（読み取り・キャッシュ・`?format=json`） |
| `viewer/src/client/*` | 閲覧画面の HTML / CSS / JavaScript（自動更新・再試行） |
| `tools/build.mjs` | `src/` から `dist/` を生成（`--check` で一致確認） |
| `tools/preview-server.mjs` | Google に接続せずにブラウザで動作確認するためのローカルサーバー |
| `tools/loadtest.mjs` | 実際の閲覧ページに N 人分の画面を開いて計測する負荷試験スクリプト |
| `tools/pages-loadtest.yml` | 上を GitHub Actions で手動実行する workflow（公開先リポジトリの `.github/workflows/loadtest.yml` にコピーして使う） |
| `tests/*.test.mjs` | 単体・結合テスト（Node.js 組み込みのテストランナー） |
| `tests/gas-mock.mjs` | Apps Script のサービス（SpreadsheetApp・CacheService など）の模擬実装 |
| `e2e/*.spec.mjs` | ブラウザでの画面テスト（Playwright、PC 1366×768 / スマートフォン 390×844） |
| `docs/deploy.md` | **Google Apps Script・GitHub Pages への導入・公開手順** |
| `docs/security.md` | セキュリティ設計と公開前チェックリスト |
| `docs/test-plan.md` | テスト項目・結果・実環境で判明したこと |
| `docs/load-test.md` | **50 人同時閲覧の性能検証手順** |

`dist/` は生成物です。修正は `admin/src`・`viewer/src` に行い、`node tools/build.mjs` で作り直してください。

## 3. 機能（Phase 1）

### 運営画面（GitHub Pages の `/admin/`）

| 操作 | 内容 |
| --- | --- |
| 大会の作成（誰でも） | 大会名・開催日・主催者名（任意・非公開）・大会の形式（下記のひな形）・対戦形式。作成コードが設定されていれば入力。作成後に運営用 URL を 1 回だけ表示 |
| 大会の編集 | 大会名・開催日・状態（準備中 / 開催中 / 終了）・公開 / 非公開・運営メモ（非公開）・運営用 URL の再発行 |
| ルール | 段階ごとに Leg 制（Best of N Legs）またはセット制（Best of N セット・各セット Best of M Legs）。トーナメントは回戦ごとに Best of を上書き可能。暫定ルールの表示。結果入力後は変更不可 |
| 形式（段階） | 「ロビン」「リーグ」「トーナメント」を最大 8 段階まで追加・削除・名前変更。順位の決め方、進出ルール、総当たりの回数、ラウンド表示名、3 位決定戦を段階ごとに設定 |
| 選手 | 一括登録（1 行 1 名）・名前変更・削除（対戦カードに入っている選手は削除不可） |
| 組み合わせ（ロビン・リーグ） | グループ数・名前、登録順の自動割当、手動割当、総当たりの対戦カード作成・削除（結果入力後は削除不可）、順位表、同順位の手動決定、「順位を確定して進出させる」・取り消し |
| 組み合わせ（トーナメント） | 出場者の選択とシード順の並べ替え（進出者は自動登録）、トーナメント表の作成・削除。不戦勝は上位シードに自動配置 |
| 試合結果 | 取得 Leg 数（セット制は取得セット数と Leg 合計）の入力、「進行中として保存」「確定」「未開始に戻す」、確定済みの「訂正」。トーナメントは確定で勝者（3 位決定戦は敗者）が次の試合へ自動で進む。次の試合が始まっていれば訂正不可。入力途中の値は他の試合を確定しても残り、確定できる入力が 2 試合以上あれば「まとめて確定」（全試合を検証してから保存。1 試合でも不成立なら何も保存しない） |
| 進行状況 | 全体・グループ別の確定 / 進行中 / 未開始の数、公開状態、この大会の閲覧ページへのリンクと QR コード（PNG で保存・URL のコピー）、変更履歴 |
| サンプル | 16 名・4 人 × 4 グループ・Best of 5（暫定）の検証用大会をボタン 1 つで作成 |
| 管理者（`#admin`） | 保存先の設定・初期化、全大会の一覧と管理、閲覧者用 URL、閲覧ページの既定表示の大会、運営用 URL の再発行 |

### 閲覧者用 Web 画面（ログイン不要）

大会名・開催日・状態・ルール（暫定表示）、段階ごとの見出しとルール、グループごとの順位表（順位・勝-敗・セット / Leg 得-失。確定試合のみ）、
対戦組み合わせ・ラウンド表示名（「第 1 節」など）・取得 Leg / セット数・試合状態・勝者、トーナメント表（回戦ごと・3 位決定戦・優勝者）、
段階・グループでの絞り込み、データ更新時刻・取得時刻・次回自動更新までの秒数、手動更新ボタン、通信失敗時の表示。PC・スマートフォン対応、ダークモード対応。

**QR コード**（GitHub Pages の閲覧ページのみ）: 内容の右に余白がある画面（幅 1504px 以上。店内モニターなど）では、その余白に収まる大きさ（最大 200px）で右下に固定表示し、スクロールしても同じ位置に残ります。内容は動かさず、重なりません。余白がない画面（縦長の窓など）では固定表示せず、上の「QR コード」ボタンで表示します。
スマートフォンでは「QR コード」ボタンで拡大表示。URL に `&qr=0` を付けると固定表示をやめ、`&qr=1` を付けると幅に関係なく固定表示します。
QR コードの生成には [qrcode-generator](vendor/qrcode-generator/README.md)（MIT）を同梱しており、外部サイトへの通信はありません。

順位は主催者が設定した決め方（既定: 勝数 → Leg 差 → 直接対決 → 得 Leg）で計算し、決まらない場合は「同」と表示します（主催者が手動で決定可能）。

### 組める大会形式（v0.4.0）

| 項目 | 設定できる内容 |
| --- | --- |
| ひな形（作成時） | ロビンのみ / ロビン → A・B トーナメント / トーナメントのみ / リーグ。作成後に「形式」タブで自由に変更 |
| 段階の種類 | ロビン（グループ内総当たり）・リーグ（全員総当たり・節ごと）・シングルエリミネーション（トーナメント）。最大 8 段階 |
| 複数段階 | 段階を並べ、ロビン / リーグの順位で後の段階へ進出（例: 各組 1〜2 位 → A トーナメント、3 位以下 → B トーナメント）。進出者は「組 1 位 → 2 位 …」の順にシード |
| 順位の決め方 | 勝数・Leg 差・得 Leg・セット差・得セット・直接対決（並んだ選手どうしの成績）を任意の順で。最後は主催者が手動で決定 |
| 2 回総当たり | 総当たりの回数 1 / 2（2 回目は先攻・後攻を入れ替え） |
| リーグの節 | 節（ラウンド）ごとの表示名を自由に設定（空欄なら「第 n 節」） |
| Best of | 段階ごと（ロビン・リーグ・トーナメント）、トーナメントは回戦ごと（例: 決勝だけ Best of 7） |
| セット制 | Best of N セット・各セット Best of M Legs。Leg 合計は成立しうる範囲だけ受け付ける |
| 3 位決定戦 | トーナメントごとに有無を設定 |
| シード・不戦勝 | 出場者の並び順がシード。2 のべき乗に満たない人数は上位シードが不戦勝（2〜128 名） |

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
| Events | event_id, name, date_label, status, is_public, is_featured, rule_id, is_sample, organizer_name, admin_key_hash, admin_key_issued_at, notes | 複数大会を並行管理可能。主催者ごとの運営用の鍵（ハッシュ） |
| Rules | rule_id, event_id, name, format, best_of, set_best_of, is_provisional | format: best_of_legs / best_of_sets。段階ごとに 1 行 |
| Players | player_id, event_id, display_name, external_ref, notes | external_ref で n02 の選手と対応付け |
| Stages | stage_id, event_id, name, type, order, rule_id, parent_stage_id, config_json | type: round_robin / league / single_elimination。config_json に総当たり回数・順位の決め方・進出ルール・3 位決定戦・回戦ごとの Best of・ラウンド表示名 |
| Groups | group_id, event_id, stage_id, name, order | — |
| Entries | entry_id, event_id, stage_id, group_id, player_id, seed, manual_order, source_label | 段階への出場枠。seed はトーナメントのシード、manual_order は手動の順位、source_label は「グループA 1位」などの進出元 |
| Matches | match_id, event_id, stage_id, group_id, round, order, label, player1/2_id, player1/2_legs, player1/2_sets, status, winner_id, rule_id, next_match_id/slot, loser_next_match_id/slot, external_ref, confirmed_at | next_match_* で勝者、loser_next_match_*（3 位決定戦）で敗者の行き先。external_ref で n02 の試合と対応 |
| History | history_id, at, actor, action, entity, entity_id, event_id, before_json, after_json | 監査・訂正の追跡 |
| PublicSnapshots | event_id, is_default, version, published_at, chunk_count, chunk_01〜10 | 閲覧者向けの公開データ（最大 40 万文字） |

全行に `rev`（版番号）と `created_at` / `updated_at`（ISO 8601、UTC）があります。文字列の列は「書式なしテキスト」にして、`1/2` のような名前が日付に自動変換されないようにしています。

## 5. 安全性の要点（詳細は [docs/security.md](docs/security.md)）

- 運営用と閲覧者用を**別プロジェクト**に分離。閲覧者用のコードには書き込み処理が存在せず、権限も `spreadsheets.readonly` のみ
  （読み込みは Sheets API の `values.get`。`SpreadsheetApp.openById` は読むだけでも編集を含むスコープを要求することが実環境で分かったため）。
- 外部から呼べる関数は各プロジェクト 2 つだけ（運営用: `doGet` `doPost`、閲覧者用: `doGet` `getPublicSnapshot`）。
- 運営用は匿名でも届くが、**操作のたびにサーバー側で大会の鍵（または管理者の鍵）を検証**し、その大会以外は操作させない。
  鍵はハッシュで保存し、比較は途中で打ち切らない方法で行う。運営用アプリの権限はスプレッドシートのみ（外部通信・メール・Drive 操作なし）。
- 書き込みはスクリプトロックで直列化し、版番号（rev）が古ければ拒否（同時更新による上書きを防止）。`requestId` で二重送信を無視。
- 入力はサーバー側で型・範囲・長さ・参照先を検証。先頭が `= + - @` の文字列は数式として解釈されうるため拒否。
- 画面はデータを `textContent` で表示（HTML として解釈しない）。GitHub Pages のページは CSP で通信先とスクリプトを限定。
- ソースコードにスプレッドシート ID・鍵・メールアドレスを含めない（すべてスクリプト プロパティ）。

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
画面テストでは、GitHub Pages のページ（`/pages/`・`/pages/admin/`）から Apps Script への通信をローカルの模擬環境に振り替えます。

## 7. 今回実装していないもの（後続フェーズ）

ダブルエリミネーション、スイスドロー、試合ごとの棄権・不戦勝の入力（トーナメントの人数不足による不戦勝は対応済み）、日時・ボードの割り当て、
n02 との試合結果の自動同期、Firebase 連携、大会の削除（Phase 1 は「非公開・終了」で代替）、共同主催者（運営用 URL を共有すれば複数人で運営は可能）。

## 8. 既知の制約

- スプレッドシートにはトランザクションがありません。1 つの操作が複数シートに書く途中で Google 側のエラーが起きると、途中まで書かれた状態が残る可能性があります（入力検証はすべて書き込み前に行っています）。
- Apps Script の Web アプリには、個人アカウントの場合「このアプリケーションは Google ではなく、別のユーザーによって作成されたものです」という帯が表示されます。
- 主催者の確認は「運営用 URL を持っているか」だけです。URL が漏れると他人も運営できます（再発行で無効化可能）。Google ログインのような本人確認ではありません。
- すべての処理があなたの Google アカウントの Apps Script の割り当て（同時実行 30 など）を共有します。主催者 1〜3 人・同時開催 1〜2 大会を想定した構成です。
- 閲覧画面への反映は、閲覧側キャッシュ（20 秒）+ 取得間隔（50〜70 秒）により、保存から**最大 90 秒程度**かかる設計です（実環境では未計測）。
