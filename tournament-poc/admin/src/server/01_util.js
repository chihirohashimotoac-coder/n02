/* 共通ユーティリティ */

/** 利用者に見せてよいエラー。code はクライアントの分岐用、message は画面にそのまま出す。 */
function appError_(code, message, detail) {
  var err = new Error(message);
  err.appCode = code;
  err.publicMessage = message;
  if (detail !== undefined) err.detail = detail;
  return err;
}

function nowIso_() {
  return new Date().toISOString();
}

/** 衝突しにくい ID を作る。prefix は種類の目印で、表示名には依存しない。 */
function newId_(prefix, taken) {
  for (var i = 0; i < 5; i++) {
    var id = prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
    if (!taken || !taken[id]) return id;
  }
  throw appError_('INTERNAL', 'ID の採番に失敗しました。もう一度実行してください。');
}

var ID_PATTERN_ = /^[A-Z]{2,4}-[A-Z0-9]{4,32}$/;

function isValidId_(value) {
  return typeof value === 'string' && ID_PATTERN_.test(value);
}

function requireId_(value, label) {
  if (!isValidId_(value)) throw appError_('BAD_REQUEST', label + ' の指定が不正です。');
  return value;
}

/** シートから読んだ値を列の型に合わせる（スプレッドシート側の自動変換に備える）。 */
function coerceCell_(value, type) {
  if (type === 'int') {
    if (value === '' || value === null || value === undefined) return null;
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    return isFinite(n) && Math.floor(n) === n ? n : NaN;
  }
  if (type === 'bool') {
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';
    return false;
  }
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

/** シートへ書く値。文字列は数式として解釈されないよう検証済みであることが前提。 */
function toCell_(value, type) {
  if (type === 'int') return value === null || value === undefined || value === '' ? '' : Number(value);
  if (type === 'bool') return value === true;
  return value === null || value === undefined ? '' : String(value);
}

/**
 * 利用者が入力する文字列の検証。
 * - 前後の空白を除き、制御文字を拒否する
 * - 先頭が = + - @ の文字列は、スプレッドシートで数式として解釈される恐れがあるため拒否する
 */
function cleanText_(value, label, maxLength, options) {
  var opts = options || {};
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw appError_('VALIDATION', label + ' の形式が不正です。');
  }
  var text = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) {
    if (opts.allowEmpty) return '';
    throw appError_('VALIDATION', label + ' を入力してください。');
  }
  if (text.length > maxLength) {
    throw appError_('VALIDATION', label + ' は ' + maxLength + ' 文字以内で入力してください。');
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw appError_('VALIDATION', label + ' に使用できない文字が含まれています。');
  }
  if (/^[=+\-@]/.test(text)) {
    throw appError_('VALIDATION', label + ' の先頭に = + - @ は使用できません。');
  }
  return text;
}

/** 全角数字を含む入力を 0 以上の整数にする。整数でなければ null。 */
function parseNonNegativeInt_(value) {
  if (typeof value === 'number') {
    return isFinite(value) && Math.floor(value) === value && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  var text = value.normalize('NFKC').trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  return Number(text);
}

function requireBool_(value, label) {
  if (value === true || value === false) return value;
  throw appError_('BAD_REQUEST', label + ' の指定が不正です。');
}

function requireRev_(value) {
  if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0) return value;
  throw appError_('BAD_REQUEST', '更新対象の版番号（rev）がありません。画面を再読み込みしてください。');
}

/** 履歴に残す JSON。セルの文字数上限を超えないよう切り詰める。 */
function historyJson_(value) {
  if (value === undefined || value === null) return '';
  var text = JSON.stringify(value);
  if (text.length > ADMIN_CONFIG.HISTORY_CELL_LIMIT) {
    text = text.slice(0, ADMIN_CONFIG.HISTORY_CELL_LIMIT) + '…(truncated)';
  }
  return text;
}

function md5Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function groupLabel_(index) {
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return 'グループ' + (index < letters.length ? letters.charAt(index) : String(index + 1));
}

function byOrder_(a, b) {
  return (a.order || 0) - (b.order || 0);
}
