# qrcode-generator（同梱）

閲覧ページ・運営画面で QR コードを作るためのライブラリです。CDN から読み込むと CSP（`script-src 'self'`）で許可するサイトが増えるため、ファイルをそのまま同梱しています。

| 項目 | 内容 |
| --- | --- |
| パッケージ | [qrcode-generator](https://www.npmjs.com/package/qrcode-generator) 2.0.4（`dist/qrcode.js`、無改変） |
| 作者 | Kazuhiko Arase |
| ライセンス | MIT（ファイル先頭に記載） |
| SHA-256 | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c` |

`tools/build.mjs` が `dist/pages/qrcode.js` と `dist/pages/admin/qrcode.js` にコピーします。
