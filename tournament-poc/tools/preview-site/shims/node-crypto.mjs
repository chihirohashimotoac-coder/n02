// gas-mock.mjs が読み込む関数の名前だけ用意する（確認サイトでは mock-entry.mjs の決定的な乱数とハッシュを使う）
export function createHash() {
  throw new Error('createHash is not available in the browser preview');
}
export function randomUUID() {
  throw new Error('randomUUID is not available in the browser preview');
}
