# CLAUDE.md

@AGENTS.md

## 本番の戻し方の記録（大会運営 tournament-poc）

利用者が「戻したい」「元に戻して」「ロールバック」と言ったら、この記録の版番号を使う。実行前に、どこまで戻すか（GAS だけか、Pages も含めるか）を利用者に確認する。手順の詳細は `tournament-poc/docs/deploy.md` の「戻す（ロールバック）」。

### v1.0.0（期制リーグ・昇降格・入替戦・公開データの分割）

- 反映: 2026-10-27 03:27〜03:29 UTC。PR #36 のマージ `aa6fde9`、Actions「Tournament deploy」run 40444205503（成功）
- 戻し先（反映前 = v0.9.0）: **運営用 GAS 版 16**・**閲覧者用 GAS 版 9**・閲覧リポジトリ（n02-tournament-viewer）main `5186cab`
- 反映後: 運営用 GAS 版 17・閲覧者用 GAS 版 10・閲覧リポジトリ `2e17572`（`deploy: n02 aa6fde9…`）・スキーマ v3 → v4

戻す手順:

1. GAS: Actions →「Tournament deploy」→ Run workflow → mode `rollback`、`rollback_admin_version` = `16`、`rollback_viewer_version` = `9`
2. GitHub Pages: 閲覧リポジトリの `deploy: n02 aa6fde9…` のコミット（`2e17572`）を revert して push
3. スプレッドシートは戻さなくてよい（v4 で増やした Leagues・LeagueSeasons・LeagueMembers シートと Players.member_id 列は旧版が無視する）。移行前の内容は `bak-s3-…` のシートに残っている
4. 戻した後の制約（`tournament-poc/docs/v1.0-season-league.md` §6。模擬環境で確認済み）: 期の大会は読み書きできるが、次期の作成・入替戦の操作はできない（入替戦はトーナメントとして表示）。公開データを分割した大きい大会は、閲覧ページに試合一覧が出ず（順位表は出る）、旧版の運営用では保存できない
