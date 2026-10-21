// ブラウザ用の確認サイトでは vm を使わない（Code.gs は build-preview-site.mjs が関数に包んで読み込む）
export default {};
export function createContext() {
  throw new Error('vm is not available in the browser preview');
}
export function runInContext() {
  throw new Error('vm is not available in the browser preview');
}
