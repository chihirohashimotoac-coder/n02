# n02 Tournament 閲覧ページ（GitHub Pages 用）

n02 Tournament PoC の閲覧画面を、Google の外（GitHub Pages）から表示するための静的ページです。
データは閲覧者用 Apps Script Web アプリの `?format=json` から取得します。

Apps Script の画面（`…/exec`）は、ブラウザで複数の Google アカウントにログインしていると
「現在、ファイルを開くことができません」となって開けないことがあります。
このページは Google のログイン情報を送らずにデータだけを取得するので、その影響を受けません。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `index.html` `viewer.css` `viewer.js` | 閲覧ページ本体（n02 リポジトリの `tournament-poc/tools/build.mjs` が生成） |
| `config.js` | 閲覧者用 Web アプリの URL（`config.example.js` をコピーして作成） |

## URL の指定

- `?event=EVT-…` 特定の大会を表示（省略時は既定表示の大会）
- `?interval=15` 自動更新の間隔（秒、15〜600。試験用）

ソースと設計資料: https://github.com/chihirohashimotoac-coder/n02/tree/claude/bold-albattani-5vsk78/tournament-poc
