# 引き継ぎ: n02 大会機能の監査指摘の修正（2026-11-04）

このファイルは、Claude Code のセッションを引き継ぐためのメモです。次のセッションは最初にこのファイルを読み、
「次にやること」から始めてください。指示の原文（統合監査報告書・実装指示）はセッションに添付されていたもので、リポジトリには入っていません。
必要なら利用者に添付し直してもらってください。

## 1. 前提（守ること）

- 指示: 監査で再現した不具合を、小さな独立 PR に分けて修正する。**マージ条件をすべて満たした PR は通常の手順でマージし、本番反映まで確認してよい**（利用者の承認済み範囲）。
  - マージ条件の要点: 最新 main で再現 → 修正 → 必須チェックが最新コミットで成功 → **PR 本文に大会プレビュー URL**、開けること・表示コミットが最新コミットと一致することを確認し、運営・閲覧の該当操作をプレビューで確認 → 権限・競技結果・保存データ・公開範囲に想定外の影響なし → 戻し先（GAS 2 つ・Pages）を把握 → PR に項目・原因・差分・再現・検証・未検証・コミット・プレビュー URL・影響・戻し方。
  - 競技ルールの解釈が要るもの・本番データの一括修復・シート構造の変更は承認範囲外（止めて利用者に聞く）。
- `tournament-poc/**` を変えるマージは、文書だけでも本番配信（運営用 GAS → スキーマの移行 → 閲覧者用 GAS → Pages）を起動する。1 件ずつマージし、配信の完了と 3 つの `release` の SHA を照合してから次へ。
- `CLAUDE.md`（リポジトリ直下）・`docs/`（直下）だけの変更は配信を起動しない。配信のたびに `CLAUDE.md` の「本番の戻し方の記録」の表に行を足す（`CLAUDE.md` だけの PR で）。
- GitHub は MCP ツール（`mcp__github__*`）で操作する。`gh` は検索だけ。
- ブランチ名: `claude/wonderful-brahmagupta-imajc6-<用途>`（例 `-pr06`）。PR は Draft で作り、確認が済んだら ready にしてマージ（`merge_method: merge`、`expectedHeadSha` は 40 桁）。
- コミットの末尾:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AjWJm1RJoJCe2byMZhEpjo
  ```
  PR 本文の末尾: `🤖 Generated with [Claude Code](https://claude.com/claude-code)` と上のセッション URL。

## 2. 確認の道具（このセッションで使ったもの）

- ネットワーク: 利用者が `*.vercel.app`・`chihirohashimotoac-coder.github.io`・`script.google.com`・`script.googleusercontent.com` を許可済み。Vercel のプレビューの認証も外してある。
- **プレビュー URL**: ブランチ名が長いので Vercel が別名を短縮する（例 `n02-git-claude-wonderful-brahmagupta-i-<6 桁>-chihiro-hashimoto.vercel.app`）。PR の check run「Vercel Preview Comments」の出力（`mcp__github__get_check_run`）に書いてある URL を使う。説明ページ `<URL>/tournament/` に表示コミット（40 桁）が出る。
- プレビューの中は実物の Code.gs が模擬環境で動く。Playwright（`require('/opt/node_modules/playwright')` 相当。スクリプトでは `createRequire('/opt/')('playwright')`）で操作し、模擬 API は `fetch('https://script.google.com/macros/s/PREVIEW-ADMIN/exec', { method: 'POST', body: JSON.stringify({ action, payload, requestId, auth: { adminKey: 'preview-admin-key-0123456789-abcdefghij' } }) })`。管理者の画面は `sessionStorage['tpoc-admin-key']` に同じ鍵を入れて `site/admin/index.html#admin`。大会一覧のカードは「開く」ボタン。模擬キャッシュはページの再読み込みで消える（シートは残る）。
- 本番の照合（読み取りだけ）: 運営用 GAS の URL は閲覧リポジトリの `admin/config.js`、閲覧者用は `config.js`。運営用は匿名 GET で `{ release, schema }`、閲覧者用は `?format=version` で `{ release }`、Pages は `…/n02-tournament-viewer/release.json`。版番号は Actions「Tournament deploy」の deploy ジョブのログ（`mcp__github__get_job_logs`、tail 140〜175 行で「運営用 GAS の更新: 版 X → Y」が見える）。
- n02 本体の CI（`lint / typecheck / test / build / e2e`）は 25 分前後かかり、上限 30 分。push と pull_request の 2 回走る。片方が上限で取り消された場合は原因を確かめ、もう片方の成功で判断した例がある（PR #42）。
- ローカル: `node tournament-poc/tools/build.mjs`（dist の再生成）・`--check`、`cd tournament-poc && node --test "tests/*.test.mjs"`、`npm run e2e -- <spec>`（Chromium は導入済み。`npm ci` は既存のロックファイルどおり）。

## 3. ここまでの結果（すべて本番確認済み）

| 監査案 | PR | 内容 | 運営用 GAS | 閲覧者用 GAS | Pages |
| --- | --- | --- | --- | --- | --- |
| 01 | #41 | 戻し方を GAS と Pages の版の組み合わせで訂正 | 19 | 12 | `6f1d289` |
| 02 | #42 | 複数予選から同じ決勝への進出で他の進出者を消さない（シード順は利用者承認済み） | 20 | 13 | `c543311` |
| 03 | #43 | 共同主催者・スタッフへのメールアドレスの返却を止める | 21 | 14 | `c024ca7` |
| 07 | #44 | リーグ→プレーオフの見積もりを各部の実際の枠に合わせる | 22 | 15 | `b11b76e` |
| 04 | #45 | 復元ファイルを書き込む前に全列を検査（実シートでの数式の扱いは未検証のまま、利用者承認でマージ） | 23 | 16 | `a0833f4` |
| 05 保存側 | #47 | 作成・追加の 8 操作の再送を、レコードに残した要求の印で照合（キャッシュ消失でも二重実行しない） | 24 | 17 | `7a94b19` |
| 05 運営画面側 | #48 | 通信の期限・保存済み／保存されなかった／確認できないの区別・遅れた応答で画面を戻さない | **25** | **18** | **`bfb453f`** |
| 記録 | #46・#49 | `CLAUDE.md` の戻し方の記録（配信なし） | — | — | — |

本番の現在値（2026-11-04 04:20 UTC 頃）: 運営用・閲覧者用 GAS とも `release` = `7813abe`、スキーマ 4、Pages `release.json` = `7813abe`。main の先頭は `f31b1f3`（#49）。

残る確認事項（利用者に伝え済み）: 分離した Google スプレッドシートでの数式の扱い（PR-04）、本番の既存データの点検（進出者が消えた大会・不正な復元行）、実機（iPhone Safari）、期限 45 秒の妥当性、出場者・シードの下書きが保存失敗で消える件（監査 PR-14 で対応予定）。

## 4. 次にやること: 監査案 06（次期作成の途中失敗からの復旧）

作業ブランチ `claude/wonderful-brahmagupta-imajc6-pr06` はまだ作っていない（リモートにもない）。**最新 main（`f31b1f3` 以降）から切る。**

### 4.1 原因（コードの読み取り。試験での再現はまだ）

- 次期の作成は `admin/src/server/06c_season.js` の `actionConfirmNextSeason_`（798 行付近）。大会・ルール・段階・組（`createEventRecords_`）、会員の追加と状態の変更（`LeagueMembers`）、選手、出場者、期の行（`newSeasonRecord_` → `LeagueSeasons`）を同じ ctx に積み、最後に `commitContext_` で書く。
- 書き込みの順は `admin/src/server/03_storage.js` の `COMMIT_ORDER_` = Rules → Players → Stages → Groups → Entries → Matches → Collaborators → **LeagueMembers** → Leagues → **LeagueSeasons** → **Events** → History（その後 PublicSnapshots）。
- 途中で止まったときの既存の修復は `removeBrokenSeason_`（779 行付近）。入口は「期の行（`sc.next`）はあるが大会の行がない」ときだけで、その大会 ID の Rules〜Collaborators と期の行を消す。**会員の変更は戻さない。**
- そのため:
  1. **期の行より前で止まる**（Rules〜LeagueMembers・Leagues のどこか）: 次期の大会の子の行が孤立して残る。次の確定は `sc.next` がないので気づかず、新しい ID で作る → 孤立した行が残り続ける。LeagueMembers まで書けていれば、新規参加の会員が二重に追加され、不参加の会員の「脱退」（`status = 'left'`・`meta.leftAfterSeason`）が残る。
  2. **期の行の後・大会の行の前で止まる**: `removeBrokenSeason_` が子の行と期の行を消して作り直すが、会員の変更が残る → 新規参加が二重、復帰（`meta.rejoinedSeason`）・脱退・名前の変更（`meta.names`）が二重に積まれる。
  3. 同じ requestId の再送は `PARTIAL_WRITE` で止まる（`07_api.js`。`confirmNextSeason` は #47 の印の対象外）。別の requestId・別の操作を挟むと `WRITE_JOURNAL` が片づき、上の 1・2 の状態のまま次の確定に進む。
- 監査の記述（C-027・C-008）: 故障注入で孤立行・会員重複・脱退状態の残留を確認済み、「会員・子行が期行より先に書かれ、既存修復は『期行あり／大会行なし』が入口」。

### 4.2 修正方針（案。実装・試験はこれから）

1. **次期の作成のときだけ、期の行（LeagueSeasons）を最初に書く**: ctx に `commitFirst = ['LeagueSeasons']` のような指定を足し、`commitContext_` がそれを先頭に書く（他の操作の書き込み順は変えない）。こうすれば、どこで止まっても「期の行あり・大会の行なし」になり、既存の修復の入口に乗る。
2. **修復で会員の変更も戻す**（`removeBrokenSeason_` の拡張）: 期の行の確定記録（`readSeasonPlan_` の `rows`・`edits`）を使い、その期の作成で変えた分だけを戻す。
   - 新規参加（`movement: 'new'`、記録の `key` が会員 ID）: その会員が `meta.joinedSeason === 次期の番号` で、**他の大会の選手から参照されていなければ**消す。
   - 不参加（`leave`）: `status === 'left'` かつ `meta.leftAfterSeason === 今期の番号` なら `active` に戻し、印を消す。
   - 復帰（`return`、または脱退中から続ける行）: `meta.rejoinedSeason === 次期の番号` なら `left` に戻し、印を消す。
   - 名前の変更: 新しいコードでは `meta.names` に積む項目に `season: 次期の番号` を付け、修復ではその印のあるものだけ戻す（印のない古い項目は触らない）。
   - 無関係な大会・会員の行には触らない。何を戻したかを履歴（`season.repair`）に残す。
3. **読み取りを先に**: `previewNextSeason` の応答に「途中で止まった次期の作成の跡（消す行の件数・戻す会員）」を出し、運営画面のプレビューで見せる（書き込みは確定のときだけ）。
4. 既存の本番データの一括修復はしない（承認範囲外）。古いコードで期の行より前に止まった跡（孤立行）は、この修正では見つけられない → 読み取り専用の診断（監査 第 6 節「整合性診断」）は別 PR・別判断。

### 4.3 受け入れ条件（監査 PR-06 の行）

- Rules〜Events（と History・PublicSnapshots）の各段階で故障を注入し、**新しい requestId での再試行・同じ requestId の再送（PARTIAL_WRITE）・別の操作を挟んだ再試行**のどれでも、次期・会員が重複せず、最終状態が故障なしの場合と一致する（会員の件数・状態・表示名、各シートの行数）。
- 同時試行（2 つ目は作成済みの次期を返す）。
- 無関係な大会・既存会員の行を巻き込まない。
- 古い記録（このコードより前に作られた期の行）でも修復が安全に動く（印のない名前の変更は戻さない）。
- 故障注入の書き方の例: `tests/request-dedupe.test.mjs` の `failOnce(p, sheetName)`（そのシートへの最初の `setValues` だけ失敗させる）。期制リーグの組み立ては `tests/v10-season.test.mjs`・`tests/email-exposure.test.mjs` の `world()` が参考になる。

### 4.4 その後の候補

- 監査 PR-08・14・15・17（画面の復帰と入力保持。小さい PR に分ける）。
- 監査 PR-09〜13・19（順位・所属・訂正。競技ルールの解釈が要るものは止めて利用者に聞く）。
- 監査 PR-16・18（検索・作成時の警告）、PR-20〜23（スタッフ入口・性能。計測から）。
