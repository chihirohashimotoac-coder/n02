# n02 Checkout Arena

本アプリは、橋本千尋の企画・仕様設計・監修のもと、
AI支援を活用して開発された独立したダーツ練習アプリです。

本プロジェクトは、n01およびその原作者とは提携・関係のない
独立したプロジェクトです。

本リポジトリには、n01のソースコードおよび画像・CSS・JavaScript等の
制作物は含まれていません。

---

## ゲームモード

| モード | 内容 |
| --- | --- |
| 通常01 | 501 / 701 / 901 / 1101。ダブルアウト、Bust、Leg管理、COM対戦、ハンディキャップ、3DA等の統計 |
| チェックアウト練習 | ランダムな残り点数を2人で攻略。01エンジンを共有。勝利条件の既定は「なし（Legを継続）」 |
| ペンタスロン | 5種目の総合競技。JDA / n01・i-Pentathlon の2ルールセット、1人／2人プレイ対応 |

ペンタスロンで採用した各種目のルールと、その出典・未確定事項は
[`docs/pentathlon-rules.md`](docs/pentathlon-rules.md) に記載しています。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm run verify     # lint + typecheck + unit test + build
npm run test       # Vitest（ドメインロジックの単体テスト）
npm run test:e2e   # Playwright（既存モードの回帰 + ペンタスロン通し）
npm run build      # 本番ビルド → リポジトリ直下へ配置
```

### 構成

```
src/
  domain/            ゲームロジック（UIから独立）
    darts.ts           1投単位のダーツ表現・チェックアウト判定
    x01Core.ts         01の共通処理（Bust / チェックアウト / 使用ダーツ数）
    x01Engine.ts       通常01・チェックアウト練習の対戦エンジン
    pentathlon/
      types.ts         Pentathlon共通型・DisciplineEngineインターフェース
      session.ts       Session Controller（種目進行・先攻計算・Undo）
      presets.ts       JDA / n01 のプリセット定義
      engines/         種目ごとの独立したGame Engine
  components/        画面
  storage/           LocalStorage（既存キーと後方互換）
  share/             リザルト画像生成
web/                 Viteのエントリ（index.html・public）
```

ビルド成果物（`index.html` / `assets/` / `sw.js` / `manifest.webmanifest`）は
GitHub Pagesがリポジトリ直下を配信するため、`npm run build` で直下へ出力されます。
これらは生成物のため直接編集しないでください。

### LocalStorage

| キー | 用途 |
| --- | --- |
| `n02-current-v1` | 進行中の01／チェックアウト対戦 |
| `n02-history-v1` | 直近の成績履歴 |
| `n02-theme-v1` | テーマ設定 |
| `n02-pentathlon-v1` | 進行中のペンタスロン（既存キーとは独立） |
