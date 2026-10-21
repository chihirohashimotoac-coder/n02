export function existsSync() {
  return false;
}
export function readFileSync() {
  throw new Error('fs is not available in the browser preview');
}
