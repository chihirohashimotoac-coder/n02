export function join(...parts) {
  return parts.join('/');
}
export function dirname(p) {
  return String(p).replace(/\/[^/]*$/, '');
}
