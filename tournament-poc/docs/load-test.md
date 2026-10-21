# 50 人同時閲覧の性能検証手順

> **状態: 未検証。** 本作業では Google の実環境に接続できないため、実際の Apps Script での負荷試験は実施していません。
> 実施済みなのは、(1) 模擬環境での計算上の試算、(2) 負荷試験スクリプトがローカル確認用サーバーに対して動くことの確認（Apps Script 版の画面と、GitHub Pages 版の閲覧ページ `?event=` 指定の両方）、の 2 点だけです。
> PC を用意しなくてよいように、GitHub Actions から実行する方法（[4-1.](#4-1-試験-a-を-github-actions-で実行する推奨)）を用意しました。

## 1. 目標と判定基準

| 項目 | 目標 | 根拠 |
| --- | --- | --- |
| 同時閲覧者 | 50 人 | 運用条件（20〜50 人） |
| 取得の成功率 | 99% 以上（失敗しても自動再試行で回復すること） | PoC の判定基準として設定 |
| 取得の応答時間 | p95 5 秒以内 | 同上（60 秒間隔の更新に対して十分短い） |
| 結果の反映 | 運営者が保存してから、全閲覧者の画面に反映されるまで 120 秒以内 | 設計値 最大 約 90 秒（閲覧側キャッシュ 20 秒 + 取得間隔 50〜70 秒）＋余裕 |
| エラー | `Service invoked too many times`・`同時実行数の上限` 等のクォータ系エラーが 0 件 | — |
| 費用 | 追加費用 0 円 | 運用条件 |

## 2. 設計上の負荷（試算）

- 閲覧者 1 人あたり約 1 回/分（60 秒 ± 10 秒）→ 50 人で **約 50 回/分**の `getPublicSnapshot` 実行。
- 閲覧側キャッシュ（`CacheService`、全閲覧者で共有、20 秒）が効くため、スプレッドシートを開くのは **最大 約 3 回/分**。キャッシュ切れの瞬間はロックで 1 リクエストだけが読み直します。
- タブが非表示の閲覧者は取得しないので、実際はこれより少なくなります。
- 模擬環境での試算結果（`tests/viewer-client.test.mjs` の最後のテスト。50 人 × 60 分、運営が毎分更新）:
  `requests/min = 50.4`、`spreadsheet opens/min = 3.02`、同じ 1 秒に集中した最大リクエスト数 = 6。
  これは**計算上の確認**であり、Google 側の応答時間・同時実行の制限は含みません。

### 注意すべき Google 側の制限（要確認）

検索で確認できた範囲では、Apps Script の割り当てページに「同時実行数: 1 ユーザーあたり 30」という記載があります
（[Quotas for Google Services](https://developers.google.com/apps-script/guides/services/quotas)。一次資料は公開前に直接確認してください）。
閲覧者用アプリは「実行: 自分」なので、全閲覧者の実行がデプロイしたアカウント 1 人分として数えられる可能性があります。
1 回の実行が 0.5 秒なら、50 回/分でも平均の同時実行数は 0.4 程度ですが、**一斉にページを開いた瞬間**（QR コードを同時に読み込む等）に集中する可能性があります。
この点が本試験で最も確認したい項目です。

## 3. 事前準備

1. [deploy.md](deploy.md) の手順で、運営者用・閲覧者用をデプロイ済みであること。
2. 運営画面で「検証用サンプル」を作成し、公開しておくこと（「作成後すぐ閲覧画面に公開する」）。
3. 試験は**大会当日ではない日**に行います（Google 側のクォータは 24 時間単位で消費されるため）。
4. 自動試験を行う PC: Node.js 22 以上、このリポジトリを取得し、直下で `npm ci`。
   Chromium が無い場合は `npx playwright install chromium`。
   50 画面を同時に開くとメモリを 3〜5 GB 程度使う見込みです（未計測）。足りない場合は 2 台に分けて 25 人ずつ実行してください。

## 4. 試験 A: 自動（ヘッドレスブラウザ 50 画面）

各画面は本物の閲覧画面を開き、通常どおり `google.script.run` で取得します（模擬ではありません）。

```bash
# リポジトリ直下で実行
# 段階 1: 10 人・5 分（スクリプトと環境の確認）
node tournament-poc/tools/loadtest.mjs --url "<閲覧者用 URL>" --clients 10 --minutes 5 --ramp 30

# 段階 2: 25 人・10 分
node tournament-poc/tools/loadtest.mjs --url "<閲覧者用 URL>" --clients 25 --minutes 10 --ramp 60

# 段階 3: 50 人・15 分（本試験）
node tournament-poc/tools/loadtest.mjs --url "<閲覧者用 URL>" --clients 50 --minutes 15 --ramp 60 --out loadtest-50.json

# 段階 4（任意）: 一斉アクセスの再現（50 人が 5 秒以内に開く）
node tournament-poc/tools/loadtest.mjs --url "<閲覧者用 URL>" --clients 50 --minutes 5 --ramp 5 --out loadtest-burst.json

# 段階 5（任意・ストレス）: 取得間隔 15 秒 = 200 人相当
node tournament-poc/tools/loadtest.mjs --url "<閲覧者用 URL>" --clients 50 --minutes 10 --ramp 60 --interval 15 --out loadtest-x4.json
```

`<閲覧者用 URL>` には、閲覧者に配る GitHub Pages の URL（例: `https://chihirohashimotoac-coder.github.io/n02-tournament-viewer/?event=EVT-…`）を指定します。`?event=` を省くと既定の大会（管理者が既定表示にした大会）を開きます。
各画面は閲覧ページから閲覧者用 Web アプリの `?format=json` を読みます（Apps Script の画面 `…/exec` を直接指定することもできます）。

本試験（段階 3）の実行中に、運営画面で **2〜3 分おきに 1 試合ずつ結果を確定**してください（反映時間の計測用）。

### 4-1. 試験 A を GitHub Actions で実行する（推奨）

公開先リポジトリ（n02-tournament-viewer）に、手動で実行する負荷テストを置いています（`.github/workflows/loadtest.yml` と `tools/loadtest.mjs`。
元はこのリポジトリの [`tools/pages-loadtest.yml`](../tools/pages-loadtest.yml) と [`tools/loadtest.mjs`](../tools/loadtest.mjs)）。
公開リポジトリの標準ランナーは料金がかかりません（[About billing for GitHub Actions](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions)）。
ランナーは GitHub のサーバー上の Linux（Chromium）で、通信元は GitHub のデータセンターです（店内の Wi-Fi やスマートフォン回線の条件は含みません）。

1. GitHub で n02-tournament-viewer を開き、「Actions」→ 左の「負荷テスト（閲覧ページ）」→「Run workflow」。
2. 入力欄: 大会 ID（`EVT-…`。公開中の検証用の大会）、画面の数、時間（分）、開き終えるまでの秒数、取得間隔（秒。空なら 60）。上の段階 1〜5 の数値をそのまま入れる。
3. 緑の「Run workflow」を押す。実行中に、運営画面で 2〜3 分おきに 1 試合ずつ結果を確定し、その時刻を控える。
4. 終わったら実行結果の画面を開く。判定（成功率・p95）と、公開データの版ごとの「最初に表示された時刻」が表で出る。
   控えた確定時刻との差が反映時間。詳しい数値は画面下の「Artifacts」の `loadtest-result`（JSON）。
5. 同じ時間帯に、閲覧者用 Apps Script の「実行数」でエラーを確認する（[6.](#6-サーバー側の確認)）。

### 出力の見方

| 項目 | 意味 |
| --- | --- |
| `opened` / `measured` | 開けた画面数 / 計測値を読めた画面数（50 であること） |
| `successRate` | 取得の成功率 |
| `errors` | 失敗の内訳（`NETWORK` = Google 側エラー・通信失敗、`TIMEOUT` = 25 秒以内に応答なし、`UNAVAILABLE` = サーバーでシートを読めず予備キャッシュもなし） |
| `stale` | シートが読めず予備キャッシュ（最大 6 時間前）を返した回数 |
| `latencyMs.p50 / p95 / max` | 1 回の取得にかかった時間 |
| `pageLoadMs` | 画面を開くのにかかった時間 |
| `versions[].spreadSec` | 公開データの各版が、最初の画面に表示されてから全画面に行き渡るまでの秒数（反映のばらつき） |

反映時間 = 「運営画面で確定した時刻」から「`versions` の該当版の `firstSeen` + `spreadSec`」までの差、で求めます。

## 5. 試験 B: 実機（スマートフォン・PC）

自動試験ではヘッドレスの Chromium しか使わないため、実機でも確認します（20 台程度で可）。

1. 参加者に閲覧者用 URL（QR コード）を配り、同時に開いてもらいます。
2. 10 分間そのまま表示してもらい、その間に運営画面で結果を 3 回確定します。
3. 各参加者に記録してもらう項目: 端末・ブラウザ、最初に表示されるまでの秒数、確定から自分の画面に反映されるまでの秒数、エラー表示の有無。
4. 1 回は機内モードにして 1 分後に戻し、「更新に失敗しました」の表示と自動復旧を確認してもらいます。

## 6. サーバー側の確認

試験の前後で、閲覧者用プロジェクトの Apps Script エディタ →「実行数」（左メニュー）を開き、次を確認します。

- 失敗した実行（ステータスが「失敗」）の件数とエラー内容
- 実行時間の分布（`getPublicSnapshot` が通常 1 秒未満か）
- クォータ・同時実行数に関するエラーがないか

## 7. 結果の記録（テンプレート）

| 日時 | 段階 | 人数 | 時間 | 成功率 | p95 (ms) | max (ms) | 反映最大 (s) | クォータ系エラー | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-21 11:03 | 試運転（GitHub Actions・既定の大会） | 2 | 1 分 | 100%（3 / 3 回） | 2346 | 2346 | — | なし | workflow の動作確認のみ（R-14 の判定ではない）。p50 1574 ms・画面を開く時間 508 ms |
| | 1 | 10 | 5 分 | | | | | | |
| | 2 | 25 | 10 分 | | | | | | |
| | 3 | 50 | 15 分 | | | | | | |
| | 4 | 50（一斉） | 5 分 | | | | | | |
| | 実機 | | 10 分 | | | | | | |

## 8. 基準を満たさなかったときの調整候補

| 症状 | 調整 |
| --- | --- |
| 一斉アクセス時だけ失敗する | 閲覧画面の初回取得を 0〜3 秒ランダムに遅らせる（`viewer.js` の `start`）、`CACHE_TTL_SEC` を延ばす |
| 常に応答が遅い | `CACHE_TTL_SEC` を 20 → 30 秒に延ばす（反映は遅くなる） |
| クォータ系エラー | 取得間隔を 60 → 90 秒に延ばす（`REFRESH_INTERVAL_SEC`）。それでも不足なら「GAS のみ」での運用は条件付きと判断 |
| 反映が遅すぎる | `CACHE_TTL_SEC` を短くする（シートの読み込み回数が増える） |
