// ==== n02 Tournament PoC 運営者用 Web アプリ / Code.gs ====
// このファイルは tools/build.mjs が admin/src/server/*.js から生成したものです。直接編集しないでください。

// ---- 00_config.js ----
/**
 * n02 Tournament PoC - 運営者用 Web アプリ（サーバー側）
 *
 * このプロジェクトだけがスプレッドシートへ書き込む。閲覧者用 Web アプリは別プロジェクトで、
 * 読み取り専用スコープしか持たない（README「セキュリティ設計」参照）。
 *
 * google.script.run から呼べる関数は doGet と adminCall の 2 つだけにしてある。
 * それ以外のトップレベル関数はすべて名前の末尾に "_" を付けた内部関数。
 * adminCall は呼び出しのたびにサーバー側で運営者のメールアドレスを検証する。
 */

var ADMIN_CONFIG = Object.freeze({
  APP_VERSION: '0.1.0',
  SCHEMA_VERSION: 1,
  // 書き込みはスクリプトロックで直列化する。取れなければ BUSY を返し、クライアントが再試行する。
  LOCK_WAIT_MS: 10000,
  // 二重送信（ボタン連打・通信再試行）を requestId で弾く期間
  REQUEST_DEDUPE_TTL_SEC: 600,
  HISTORY_VIEW_LIMIT: 30,
  MAX_PLAYERS_PER_EVENT: 128,
  MAX_GROUPS: 16,
  MIN_GROUPS: 1,
  MAX_PLAYER_NAME_LENGTH: 40,
  MAX_EVENT_NAME_LENGTH: 80,
  MAX_LABEL_LENGTH: 40,
  MAX_NOTE_LENGTH: 200,
  MAX_BULK_PLAYERS: 64,
  // スプレッドシートの 1 セルは 50,000 文字まで。余裕を持って分割する。
  SNAPSHOT_CHUNK_SIZE: 40000,
  SNAPSHOT_MAX_CHUNKS: 10,
  HISTORY_CELL_LIMIT: 20000,
  BEST_OF_MAX: 21,
});

/** 試合状態（シートにはコード値で保存し、画面で日本語に変換する） */
var MATCH_STATUS = Object.freeze({
  SCHEDULED: 'scheduled', // 未開始
  LIVE: 'live', // 進行中
  FINAL: 'final', // 確定済み
});

var MATCH_STATUS_LABEL = Object.freeze({
  scheduled: '未開始',
  live: '進行中',
  final: '確定済み',
});

/** 大会の状態 */
var EVENT_STATUS = Object.freeze({
  DRAFT: 'draft', // 準備中
  RUNNING: 'running', // 開催中
  FINISHED: 'finished', // 終了
});

var EVENT_STATUS_LABEL = Object.freeze({
  draft: '準備中',
  running: '開催中',
  finished: '終了',
});

var STAGE_TYPE = Object.freeze({
  ROUND_ROBIN: 'round_robin',
  // 以下は後続フェーズ用の予約値（Phase 1 では生成しない）
  SINGLE_ELIMINATION: 'single_elimination',
  LEAGUE: 'league',
});

var RULE_FORMAT = Object.freeze({
  BEST_OF_LEGS: 'best_of_legs',
});

/**
 * シート定義。列は見出し名で参照するため、列の並べ替えや末尾への列追加には耐える。
 * 型: text = 文字列（書式「書式なしテキスト」で保存）, int = 整数, bool = 真偽値
 */
var SCHEMA = Object.freeze({
  Events: {
    key: 'event_id',
    columns: [
      ['event_id', 'text'],
      ['name', 'text'],
      ['date_label', 'text'],
      ['status', 'text'],
      ['is_public', 'bool'],
      ['is_featured', 'bool'],
      ['rule_id', 'text'],
      ['is_sample', 'bool'],
      ['notes', 'text'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Rules: {
    key: 'rule_id',
    columns: [
      ['rule_id', 'text'],
      ['event_id', 'text'],
      ['name', 'text'],
      ['format', 'text'],
      ['best_of', 'int'],
      ['is_provisional', 'bool'],
      ['notes', 'text'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Players: {
    key: 'player_id',
    columns: [
      ['player_id', 'text'],
      ['event_id', 'text'],
      ['display_name', 'text'],
      ['external_ref', 'text'], // 将来の n02 連携用
      ['notes', 'text'], // 非公開メモ（閲覧画面には出さない）
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Stages: {
    key: 'stage_id',
    columns: [
      ['stage_id', 'text'],
      ['event_id', 'text'],
      ['name', 'text'],
      ['type', 'text'],
      ['order', 'int'],
      ['rule_id', 'text'],
      ['parent_stage_id', 'text'], // 将来: ロビン → A/B トーナメントの接続
      ['config_json', 'text'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Groups: {
    key: 'group_id',
    columns: [
      ['group_id', 'text'],
      ['event_id', 'text'],
      ['stage_id', 'text'],
      ['name', 'text'],
      ['order', 'int'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Entries: {
    key: 'entry_id',
    columns: [
      ['entry_id', 'text'],
      ['event_id', 'text'],
      ['stage_id', 'text'],
      ['group_id', 'text'],
      ['player_id', 'text'],
      ['seed', 'int'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Matches: {
    key: 'match_id',
    columns: [
      ['match_id', 'text'],
      ['event_id', 'text'],
      ['stage_id', 'text'],
      ['group_id', 'text'],
      ['round', 'int'],
      ['order', 'int'],
      ['player1_id', 'text'],
      ['player2_id', 'text'],
      ['player1_legs', 'int'],
      ['player2_legs', 'int'],
      ['status', 'text'],
      ['winner_id', 'text'],
      ['rule_id', 'text'], // 空欄ならステージのルール。将来の試合ごとのルール上書き用
      ['next_match_id', 'text'], // 将来: トーナメントの勝ち上がり先
      ['next_match_slot', 'int'],
      ['external_ref', 'text'], // 将来: n02 の試合との対応
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
      ['confirmed_at', 'text'],
    ],
  },
  History: {
    key: 'history_id',
    columns: [
      ['history_id', 'text'],
      ['at', 'text'],
      ['actor', 'text'],
      ['action', 'text'],
      ['entity', 'text'],
      ['entity_id', 'text'],
      ['event_id', 'text'],
      ['before_json', 'text'],
      ['after_json', 'text'],
    ],
  },
  PublicSnapshots: {
    key: 'event_id',
    columns: [
      ['event_id', 'text'],
      ['is_default', 'bool'],
      ['version', 'text'],
      ['published_at', 'text'],
      ['chunk_count', 'int'],
      ['chunk_01', 'text'],
      ['chunk_02', 'text'],
      ['chunk_03', 'text'],
      ['chunk_04', 'text'],
      ['chunk_05', 'text'],
      ['chunk_06', 'text'],
      ['chunk_07', 'text'],
      ['chunk_08', 'text'],
      ['chunk_09', 'text'],
      ['chunk_10', 'text'],
    ],
  },
});

/** シートを作る順番（左から） */
var SHEET_ORDER = Object.freeze([
  'Events',
  'Rules',
  'Players',
  'Stages',
  'Groups',
  'Entries',
  'Matches',
  'History',
  'PublicSnapshots',
]);

// ---- 01_util.js ----
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

// ---- 02_auth.js ----
/* 運営者の認可（すべてサーバー側で判定する） */

function readEmail_(getter) {
  try {
    var email = getter();
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
  } catch (e) {
    return '';
  }
}

/**
 * 運営者として許可するメールアドレスの一覧。
 * スクリプト プロパティ ADMIN_EMAILS（カンマ区切り）があればそれを使い、
 * なければデプロイしたアカウント（実行ユーザー）本人だけを許可する。
 * どちらも取れなければ空配列となり、誰も許可しない（フェイルクローズ）。
 */
function getAdminEmails_() {
  var raw = '';
  try {
    raw = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '';
  } catch (e) {
    raw = '';
  }
  var list = raw
    .split(/[\s,;]+/)
    .map(function (s) {
      return s.trim().toLowerCase();
    })
    .filter(function (s) {
      return /^[^@\s]+@[^@\s]+$/.test(s);
    });
  if (list.length) return list;
  var owner = readEmail_(function () {
    return Session.getEffectiveUser().getEmail();
  });
  return owner ? [owner] : [];
}

/**
 * 呼び出し元が運営者であることを確認し、そのメールアドレスを返す。
 * Web アプリの公開範囲（Google 側のアクセス制御）とは独立に、毎回ここで検証する。
 */
function requireAdmin_() {
  var active = readEmail_(function () {
    return Session.getActiveUser().getEmail();
  });
  if (!active) {
    throw appError_('FORBIDDEN', '運営者として認証できませんでした。運営者用 URL に、許可された Google アカウントでアクセスしてください。');
  }
  if (getAdminEmails_().indexOf(active) === -1) {
    throw appError_('FORBIDDEN', 'このアカウントには運営者の権限がありません。');
  }
  return active;
}

// ---- 03_storage.js ----
/* スプレッドシート（データ保存専用）の読み書き */

var SPREADSHEET_ID_PATTERN_ = /^[A-Za-z0-9_-]{25,100}$/;

function getSpreadsheetId_() {
  return (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
}

function openStorage_() {
  var id = getSpreadsheetId_();
  if (!id) {
    throw appError_('NOT_CONFIGURED', 'データ保存先のスプレッドシートが未設定です。');
  }
  if (!SPREADSHEET_ID_PATTERN_.test(id)) {
    throw appError_('NOT_CONFIGURED', 'スクリプト プロパティ SPREADSHEET_ID の形式が不正です。');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    console.error('openById failed', e && e.message);
    throw appError_('STORAGE_UNAVAILABLE', 'データ保存先のスプレッドシートを開けませんでした。ID と権限を確認してください。');
  }
}

function headerOf_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1 || sheet.getLastRow() < 1) return [];
  var header = sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function (h) {
      return String(h).trim();
    });
  while (header.length && !header[header.length - 1]) header.pop();
  return header;
}

/**
 * シートを読み、列定義に従って型をそろえたレコードの配列にする。
 * 見出しで列を引くので、列の順番が変わっても動く。主キーが空の行は無視する。
 */
function readTable_(ss, name) {
  var def = SCHEMA[name];
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw appError_('NOT_INITIALIZED', 'シート「' + name + '」がありません。初期化を実行してください。');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    throw appError_('NOT_INITIALIZED', 'シート「' + name + '」に見出しがありません。初期化を実行してください。');
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });
  var index = {};
  headers.forEach(function (h, i) {
    if (h && index[h] === undefined) index[h] = i;
  });
  def.columns.forEach(function (c) {
    if (index[c[0]] === undefined) {
      throw appError_('NOT_INITIALIZED', 'シート「' + name + '」に列「' + c[0] + '」がありません。初期化を実行してください。');
    }
  });

  var rows = [];
  var byKey = {};
  var duplicates = {};
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    var key = coerceCell_(raw[index[def.key]], 'text').trim();
    if (!key) continue;
    var rec = { _row: r + 1, _raw: raw };
    def.columns.forEach(function (c) {
      rec[c[0]] = coerceCell_(raw[index[c[0]]], c[1]);
    });
    rec[def.key] = key;
    if (byKey[key]) {
      duplicates[key] = true;
    } else {
      byKey[key] = rec;
    }
    rows.push(rec);
  }
  return {
    name: name,
    def: def,
    sheet: sheet,
    headers: headers,
    index: index,
    width: lastCol,
    lastRow: lastRow,
    rows: rows,
    byKey: byKey,
    duplicates: duplicates,
  };
}

/** 主キーで 1 件取り出す。重複している ID は壊れたデータとして扱い、書き込ませない。 */
function findRecord_(table, id, label) {
  var rec = table.byKey[id];
  if (!rec) throw appError_('NOT_FOUND', label + ' が見つかりません。画面を再読み込みしてください。');
  if (table.duplicates[id]) {
    throw appError_('DATA_CONFLICT', label + ' の ID がシート内で重複しています。管理者に連絡してください。');
  }
  return rec;
}

/** 楽観ロック: 画面が読み込んだ版と現在の版が違えば、他で更新されたとみなして拒否する。 */
function assertRev_(rec, expectedRev, label) {
  if ((rec.rev || 0) !== expectedRev) {
    throw appError_('CONFLICT', label + ' は別の画面で更新されています。最新の内容を読み込み直しました。もう一度操作してください。');
  }
}

function rowValues_(table, rec, base) {
  var out = base ? base.slice(0, table.width) : [];
  while (out.length < table.width) out.push('');
  table.def.columns.forEach(function (c) {
    if (Object.prototype.hasOwnProperty.call(rec, c[0])) {
      out[table.index[c[0]]] = toCell_(rec[c[0]], c[1]);
    }
  });
  return out;
}

/** 既存行を 1 行まるごと書き戻す（定義外の列は読み込んだ値のまま残す）。 */
function updateRecord_(table, rec) {
  if (!rec._row) throw appError_('INTERNAL', '更新対象の行が不明です。');
  table.sheet.getRange(rec._row, 1, 1, table.width).setValues([rowValues_(table, rec, rec._raw)]);
}

function appendRecords_(table, records) {
  if (!records.length) return;
  var sheet = table.sheet;
  var start = sheet.getLastRow() + 1;
  var needed = start + records.length - 1 - sheet.getMaxRows();
  if (needed > 0) {
    var firstNew = sheet.getMaxRows() + 1;
    sheet.insertRowsAfter(sheet.getMaxRows(), needed);
    applyTextFormats_(sheet, table.def, table.index, firstNew, needed);
  }
  var values = records.map(function (rec) {
    return rowValues_(table, rec, null);
  });
  sheet.getRange(start, 1, values.length, table.width).setValues(values);
}

/** 行番号の大きい順に消す（先に上を消すと下の行番号がずれるため）。 */
function deleteRecords_(table, records) {
  var rows = records
    .map(function (r) {
      return r._row;
    })
    .sort(function (a, b) {
      return b - a;
    });
  rows.forEach(function (row) {
    table.sheet.deleteRow(row);
  });
}

function applyTextFormats_(sheet, def, index, fromRow, count) {
  if (count < 1) return;
  def.columns.forEach(function (c) {
    if (c[1] === 'text' && index[c[0]] !== undefined) {
      sheet.getRange(fromRow, index[c[0]] + 1, count, 1).setNumberFormat('@');
    }
  });
}

/**
 * 保存先の初期化。何度実行しても既存データは消さない。
 * - 足りないシートを作る / 足りない列を末尾に足す（既存列の並べ替え・削除はしない）
 * - まだ初期化されていないスプレッドシートに管理対象外のデータがあれば中止する
 *   （既存の大会ファイルなどを誤って指定した場合に書き込まないため）
 */
function initializeStorage_(ss) {
  var sheets = ss.getSheets();
  var byName = {};
  sheets.forEach(function (s) {
    byName[s.getName()] = s;
  });

  var problems = [];
  var alreadyInitialized = !!byName.Events && headerOf_(byName.Events).indexOf('event_id') !== -1;
  if (!alreadyInitialized) {
    sheets.forEach(function (s) {
      if (SCHEMA[s.getName()]) return;
      if (s.getLastRow() > 0 || s.getLastColumn() > 0) {
        problems.push('管理対象外のシート「' + s.getName() + '」にデータがあります');
      }
    });
  }
  SHEET_ORDER.forEach(function (name) {
    var s = byName[name];
    if (!s) return;
    var header = headerOf_(s);
    if (header.length && header.indexOf(SCHEMA[name].key) === -1) {
      problems.push('シート「' + name + '」の見出しにこのアプリの列がありません');
    }
  });
  if (problems.length) {
    throw appError_(
      'UNSAFE_TARGET',
      '既存データを保護するため初期化を中止しました（' + problems.join(' / ') + '）。PoC 専用の空のスプレッドシートを指定してください。'
    );
  }

  var created = [];
  var extended = [];
  SHEET_ORDER.forEach(function (name, i) {
    var def = SCHEMA[name];
    var sheet = byName[name];
    if (!sheet) {
      sheet = ss.insertSheet(name, Math.min(i, ss.getSheets().length));
      created.push(name);
    }
    var header = headerOf_(sheet);
    var missing = def.columns
      .map(function (c) {
        return c[0];
      })
      .filter(function (col) {
        return header.indexOf(col) === -1;
      });
    if (missing.length) {
      var startCol = header.length + 1;
      var needCols = startCol + missing.length - 1 - sheet.getMaxColumns();
      if (needCols > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols);
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      if (header.length) extended.push(name + ': ' + missing.join(', '));
      header = header.concat(missing);
    }
    var index = {};
    header.forEach(function (h, idx) {
      if (index[h] === undefined) index[h] = idx;
    });
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    if (sheet.getMaxRows() > 1) applyTextFormats_(sheet, def, index, 2, sheet.getMaxRows() - 1);
  });

  PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(ADMIN_CONFIG.SCHEMA_VERSION));
  return { created: created, extended: extended };
}

/** 画面の「セットアップ」表示用。書き込みはしない。 */
function getStorageStatus_() {
  var status = {
    configured: false,
    accessible: false,
    initialized: false,
    spreadsheetId: '',
    spreadsheetName: '',
    missing: [],
    message: '',
  };
  var id = getSpreadsheetId_();
  if (!id) {
    status.message = 'データ保存先のスプレッドシートが未設定です。';
    return status;
  }
  status.configured = true;
  status.spreadsheetId = id;
  var ss;
  try {
    ss = openStorage_();
  } catch (e) {
    status.message = e.publicMessage || 'スプレッドシートを開けませんでした。';
    return status;
  }
  status.accessible = true;
  status.spreadsheetName = ss.getName();
  SHEET_ORDER.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      status.missing.push(name);
      return;
    }
    var header = headerOf_(sheet);
    var lacking = SCHEMA[name].columns.filter(function (c) {
      return header.indexOf(c[0]) === -1;
    });
    if (lacking.length) status.missing.push(name + '（列不足）');
  });
  status.initialized = status.missing.length === 0;
  status.message = status.initialized ? '' : '初期化が必要です。';
  return status;
}

/** 1 リクエスト内でテーブルの読み込みを使い回すための入れ物 */
function createContext_(ss, actor) {
  var cache = {};
  return {
    ss: ss,
    actor: actor,
    now: nowIso_(),
    history: [],
    table: function (name) {
      if (!cache[name]) cache[name] = readTable_(ss, name);
      return cache[name];
    },
    invalidate: function (name) {
      if (name) delete cache[name];
      else cache = {};
    },
  };
}

function recordHistory_(ctx, action, entity, entityId, eventId, before, after) {
  ctx.history.push({
    history_id: null,
    at: ctx.now,
    actor: ctx.actor,
    action: action,
    entity: entity,
    entity_id: entityId || '',
    event_id: eventId || '',
    before_json: historyJson_(before),
    after_json: historyJson_(after),
  });
}

function flushHistory_(ctx) {
  if (!ctx.history.length) return;
  var table = ctx.table('History');
  var taken = {};
  ctx.history.forEach(function (h) {
    h.history_id = newId_('HIS', taken);
    taken[h.history_id] = true;
  });
  appendRecords_(table, ctx.history);
  ctx.history = [];
  ctx.invalidate('History');
}

/** 記録から画面・履歴に出す値だけを取り出す（_row などの内部情報を除く） */
function plain_(rec) {
  if (!rec) return null;
  var out = {};
  Object.keys(rec).forEach(function (k) {
    if (k.charAt(0) !== '_') out[k] = rec[k];
  });
  return out;
}

// ---- 04_domain.js ----
/* 大会ロジック（スプレッドシートに依存しない純粋な関数） */

function isValidBestOf_(n) {
  return typeof n === 'number' && Math.floor(n) === n && n >= 1 && n <= ADMIN_CONFIG.BEST_OF_MAX && n % 2 === 1;
}

/** Best of N で勝ちに必要な Leg 数 */
function legsToWin_(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * 試合結果の検証。保存時（サーバー側で必ず実行）と公開データの生成時の両方で使う。
 *   未開始   : 両者 0 Leg
 *   進行中   : 両者とも勝利数未満（Best of 5 なら 0〜2）
 *   確定済み : 片方がちょうど勝利数、もう片方が勝利数未満（Best of 5 なら 3-0 / 3-1 / 3-2）
 * 戻り値の winnerSide は確定済みで成立しているときだけ 1 または 2、それ以外は 0。
 */
function evaluateResult_(status, p1Legs, p2Legs, bestOf) {
  var problems = [];
  if (!isValidBestOf_(bestOf)) {
    return { ok: false, winnerSide: 0, problems: ['ルールの Best of 値が不正です'] };
  }
  var need = legsToWin_(bestOf);
  if (p1Legs === null || p2Legs === null || isNaN(p1Legs) || isNaN(p2Legs)) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数は 0 以上の整数で入力してください'] };
  }
  if (p1Legs < 0 || p2Legs < 0 || Math.floor(p1Legs) !== p1Legs || Math.floor(p2Legs) !== p2Legs) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数は 0 以上の整数で入力してください'] };
  }
  if (p1Legs > need || p2Legs > need) {
    problems.push('Best of ' + bestOf + ' では取得 Leg 数は最大 ' + need + ' です');
  }
  if (status === MATCH_STATUS.SCHEDULED) {
    if (p1Legs !== 0 || p2Legs !== 0) problems.push('未開始の試合に Leg 数が入力されています');
  } else if (status === MATCH_STATUS.LIVE) {
    if (p1Legs >= need || p2Legs >= need) {
      problems.push('どちらかが ' + need + ' Leg に達しています。確定済みにしてください');
    }
  } else if (status === MATCH_STATUS.FINAL) {
    if (p1Legs === need && p2Legs === need) {
      problems.push('両者が ' + need + ' Leg になっています');
    } else if (p1Legs !== need && p2Legs !== need) {
      problems.push('確定するには、どちらかがちょうど ' + need + ' Leg 必要です（Best of ' + bestOf + '）');
    }
  } else {
    problems.push('試合状態が不正です');
  }
  if (problems.length) return { ok: false, winnerSide: 0, problems: problems };
  var winnerSide = 0;
  if (status === MATCH_STATUS.FINAL) winnerSide = p1Legs === need ? 1 : 2;
  return { ok: true, winnerSide: winnerSide, problems: [] };
}

/**
 * グループ内の総当たり対戦表（サークル方式）。奇数人数のときは各ラウンドに 1 人休みが出る。
 * 戻り値: [{ round, order, p1, p2 }]
 */
function roundRobinPairings_(ids) {
  var list = ids.slice();
  if (list.length < 2) return [];
  if (list.length % 2 === 1) list.push(null);
  var n = list.length;
  var out = [];
  var order = 1;
  for (var round = 1; round < n; round++) {
    for (var i = 0; i < n / 2; i++) {
      var a = list[i];
      var b = list[n - 1 - i];
      if (a !== null && b !== null) {
        // 先後が偏らないようラウンドごとに入れ替える
        var swap = round % 2 === 0 && i === 0;
        out.push({ round: round, order: order++, p1: swap ? b : a, p2: swap ? a : b });
      }
    }
    // 先頭を固定して残りを 1 つ回す
    list.splice(1, 0, list.pop());
  }
  return out;
}

/** 大会の構成要素を event_id で取り出す */
function collectEvent_(ctx, eventId) {
  var event = findRecord_(ctx.table('Events'), eventId, '大会');
  var filter = function (name) {
    return ctx.table(name).rows.filter(function (r) {
      return r.event_id === eventId;
    });
  };
  var rules = filter('Rules');
  var stages = filter('Stages').sort(byOrder_);
  var groups = filter('Groups').sort(byOrder_);
  var entries = filter('Entries').sort(function (a, b) {
    return (a.seed || 0) - (b.seed || 0);
  });
  var players = filter('Players');
  var matches = filter('Matches').sort(function (a, b) {
    return (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0);
  });
  var ruleById = {};
  rules.forEach(function (r) {
    ruleById[r.rule_id] = r;
  });
  return {
    event: event,
    rule: ruleById[event.rule_id] || null,
    ruleById: ruleById,
    stage: stages[0] || null,
    stages: stages,
    groups: groups,
    entries: entries,
    players: players,
    matches: matches,
  };
}

function bestOfFor_(bundle, match) {
  var rule = (match && match.rule_id && bundle.ruleById[match.rule_id]) || bundle.rule;
  return rule ? rule.best_of : null;
}

/** 1 試合の状態を公開用に判定する。シートを直接いじられた場合に備え、保存済みデータも再検証する。 */
function judgeMatch_(bundle, match, playerById, groupMembers) {
  var problems = [];
  var p1 = playerById[match.player1_id];
  var p2 = playerById[match.player2_id];
  if (!p1 || !p2) problems.push('選手が見つかりません');
  if (match.player1_id === match.player2_id) problems.push('同じ選手同士の対戦です');
  if (groupMembers && (!groupMembers[match.player1_id] || !groupMembers[match.player2_id])) {
    problems.push('グループに属していない選手が含まれています');
  }
  var status = match.status || MATCH_STATUS.SCHEDULED;
  var p1Legs = match.player1_legs === null ? 0 : match.player1_legs;
  var p2Legs = match.player2_legs === null ? 0 : match.player2_legs;
  var result = evaluateResult_(status, p1Legs, p2Legs, bestOfFor_(bundle, match));
  problems = problems.concat(result.problems);
  if (problems.length) {
    return { state: 'check', p1Legs: null, p2Legs: null, winnerSide: 0, problems: problems };
  }
  return { state: status, p1Legs: p1Legs, p2Legs: p2Legs, winnerSide: result.winnerSide, problems: [] };
}

/** グループごとの進行状況と、確定試合だけで数えた勝敗・Leg 数（順位付けはしない） */
function summarizeGroup_(members, judged) {
  var stats = {};
  members.forEach(function (pid) {
    stats[pid] = { playerId: pid, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 };
  });
  var progress = { total: 0, scheduled: 0, live: 0, final: 0, check: 0 };
  judged.forEach(function (j) {
    progress.total++;
    progress[j.judge.state]++;
    if (j.judge.state !== MATCH_STATUS.FINAL) return;
    var a = stats[j.match.player1_id];
    var b = stats[j.match.player2_id];
    if (!a || !b) return;
    a.played++;
    b.played++;
    a.legsFor += j.judge.p1Legs;
    a.legsAgainst += j.judge.p2Legs;
    b.legsFor += j.judge.p2Legs;
    b.legsAgainst += j.judge.p1Legs;
    if (j.judge.winnerSide === 1) {
      a.won++;
      b.lost++;
    } else {
      b.won++;
      a.lost++;
    }
  });
  return {
    summary: members.map(function (pid) {
      return stats[pid];
    }),
    progress: progress,
  };
}

/**
 * 運営画面・公開画面の両方で使う、大会の組み立て済みビュー。
 * includePrivate=false のとき、閲覧者に出してよい項目だけを含む。
 */
function buildEventView_(bundle, includePrivate) {
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  var rule = bundle.rule;
  var groups = bundle.groups.map(function (g) {
    var members = bundle.entries
      .filter(function (e) {
        return e.group_id === g.group_id;
      })
      .map(function (e) {
        return e.player_id;
      });
    var memberSet = {};
    members.forEach(function (pid) {
      memberSet[pid] = true;
    });
    var judged = bundle.matches
      .filter(function (m) {
        return m.group_id === g.group_id;
      })
      .map(function (m) {
        return { match: m, judge: judgeMatch_(bundle, m, playerById, memberSet) };
      });
    var sum = summarizeGroup_(members, judged);
    var group = {
      id: g.group_id,
      name: g.name,
      players: members.map(function (pid) {
        var p = playerById[pid];
        return { id: pid, name: p ? p.display_name : '（不明な選手）' };
      }),
      summary: sum.summary,
      progress: sum.progress,
      matches: judged.map(function (j) {
        var m = j.match;
        var out = {
          id: m.match_id,
          round: m.round,
          order: m.order,
          p1: { id: m.player1_id, name: playerById[m.player1_id] ? playerById[m.player1_id].display_name : '（不明）', legs: j.judge.p1Legs },
          p2: { id: m.player2_id, name: playerById[m.player2_id] ? playerById[m.player2_id].display_name : '（不明）', legs: j.judge.p2Legs },
          status: j.judge.state,
          winnerId: j.judge.winnerSide === 1 ? m.player1_id : j.judge.winnerSide === 2 ? m.player2_id : null,
        };
        if (includePrivate) {
          out.rev = m.rev || 0;
          out.storedStatus = m.status;
          out.storedP1Legs = m.player1_legs;
          out.storedP2Legs = m.player2_legs;
          out.problems = j.judge.problems;
          out.updatedAt = m.updated_at;
          out.confirmedAt = m.confirmed_at;
          out.bestOf = bestOfFor_(bundle, m);
        }
        return out;
      }),
    };
    if (includePrivate) group.rev = g.rev || 0;
    return group;
  });

  var progress = { total: 0, scheduled: 0, live: 0, final: 0, check: 0 };
  groups.forEach(function (g) {
    Object.keys(progress).forEach(function (k) {
      progress[k] += g.progress[k];
    });
  });

  var lastUpdated = '';
  bundle.matches.forEach(function (m) {
    if (m.updated_at && m.updated_at > lastUpdated) lastUpdated = m.updated_at;
  });
  if (bundle.event.updated_at > lastUpdated) lastUpdated = bundle.event.updated_at;

  var view = {
    event: {
      id: bundle.event.event_id,
      name: bundle.event.name,
      dateLabel: bundle.event.date_label,
      status: bundle.event.status,
    },
    rule: rule
      ? {
          name: rule.name,
          bestOf: rule.best_of,
          legsToWin: isValidBestOf_(rule.best_of) ? legsToWin_(rule.best_of) : null,
          provisional: rule.is_provisional,
        }
      : null,
    stage: bundle.stage ? { id: bundle.stage.stage_id, name: bundle.stage.name, type: bundle.stage.type } : null,
    groups: groups,
    progress: progress,
    dataUpdatedAt: lastUpdated,
  };
  if (includePrivate) {
    view.event.rev = bundle.event.rev || 0;
    view.event.isPublic = bundle.event.is_public;
    view.event.isFeatured = bundle.event.is_featured;
    view.event.isSample = bundle.event.is_sample;
    view.event.notes = bundle.event.notes;
    if (view.rule) {
      view.rule.id = rule.rule_id;
      view.rule.rev = rule.rev || 0;
      view.rule.notes = rule.notes;
    }
    var grouped = {};
    bundle.entries.forEach(function (e) {
      grouped[e.player_id] = e.group_id;
    });
    view.players = bundle.players.map(function (p) {
      return {
        id: p.player_id,
        name: p.display_name,
        rev: p.rev || 0,
        groupId: grouped[p.player_id] || '',
        matchCount: bundle.matches.filter(function (m) {
          return m.player1_id === p.player_id || m.player2_id === p.player_id;
        }).length,
      };
    });
  }
  return view;
}

// ---- 05_publish.js ----
/* 閲覧者向け公開データ（PublicSnapshots シート）の生成 */

var SNAPSHOT_CHUNK_PREFIX_ = '~'; // 分割した JSON の先頭が = や + になっても数式扱いされないための接頭辞

function chunkColumns_() {
  var cols = [];
  for (var i = 1; i <= ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS; i++) cols.push('chunk_' + (i < 10 ? '0' : '') + i);
  return cols;
}

/** 閲覧画面に出す内容だけで組み立てた公開データ（選手メモ・履歴・rev などは含まない） */
function buildPublicSnapshot_(bundle) {
  var view = buildEventView_(bundle, false);
  view.schema = 1;
  return view;
}

/**
 * 大会の公開状態をシートへ反映する。書き込み系の操作の最後に必ず呼ぶ。
 * - 公開中: 公開データを作り直して保存（内容が同じなら書き込まない）
 * - 非公開: 公開データの行を削除する（閲覧画面から消える）
 */
function syncPublication_(ctx, eventId) {
  ctx.invalidate();
  var bundle = collectEvent_(ctx, eventId);
  var table = ctx.table('PublicSnapshots');
  var rows = table.rows.filter(function (r) {
    return r.event_id === eventId;
  });

  if (!bundle.event.is_public) {
    if (rows.length) {
      deleteRecords_(table, rows);
      ctx.invalidate('PublicSnapshots');
    }
    return { published: false };
  }

  var json = JSON.stringify(buildPublicSnapshot_(bundle));
  var version = md5Hex_(json);
  var existing = rows[0] || null;
  if (rows.length > 1) {
    // 手作業などで重複した行は 1 行にまとめる
    deleteRecords_(table, rows.slice(1));
    ctx.invalidate('PublicSnapshots');
    table = ctx.table('PublicSnapshots');
    existing = table.byKey[eventId] || null;
  }
  if (existing && existing.version === version && existing.is_default === bundle.event.is_featured) {
    return { published: true, version: version, publishedAt: existing.published_at, unchanged: true };
  }

  var size = ADMIN_CONFIG.SNAPSHOT_CHUNK_SIZE;
  var chunks = [];
  for (var i = 0; i < json.length; i += size) chunks.push(SNAPSHOT_CHUNK_PREFIX_ + json.slice(i, i + size));
  if (chunks.length > ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS) {
    throw appError_('TOO_LARGE', '公開データが大きすぎます（' + json.length + ' 文字）。');
  }
  var rec = {
    event_id: eventId,
    is_default: bundle.event.is_featured,
    version: version,
    published_at: ctx.now,
    chunk_count: chunks.length,
  };
  chunkColumns_().forEach(function (col, idx) {
    rec[col] = chunks[idx] || '';
  });
  if (existing) {
    Object.keys(rec).forEach(function (k) {
      existing[k] = rec[k];
    });
    updateRecord_(table, existing);
  } else {
    appendRecords_(table, [rec]);
  }
  ctx.invalidate('PublicSnapshots');
  return { published: true, version: version, publishedAt: ctx.now, unchanged: false };
}

/** 公開状態の概要（運営画面の表示用） */
function publicationStatus_(ctx, eventId) {
  var row = ctx.table('PublicSnapshots').byKey[eventId];
  if (!row) return { published: false };
  return { published: true, version: row.version, publishedAt: row.published_at, isDefault: row.is_default };
}

// ---- 06_actions.js ----
/* 運営者用 API の各操作。adminCall から、認可・ロック・二重送信チェックの後に呼ばれる。 */

var SAMPLE_GROUP_COUNT_ = 4;
var SAMPLE_PLAYER_COUNT_ = 16;

/* ---------- 読み取り ---------- */

function actionBootstrap_(ctx) {
  var storage = getStorageStatus_();
  var events = [];
  if (storage.initialized) {
    var c = createContext_(openStorage_(), ctx.actor);
    var matches = c.table('Matches').rows;
    var players = c.table('Players').rows;
    events = c.table('Events').rows.map(function (e) {
      var ms = matches.filter(function (m) {
        return m.event_id === e.event_id;
      });
      return {
        id: e.event_id,
        name: e.name,
        dateLabel: e.date_label,
        status: e.status,
        isPublic: e.is_public,
        isFeatured: e.is_featured,
        isSample: e.is_sample,
        playerCount: players.filter(function (p) {
          return p.event_id === e.event_id;
        }).length,
        matchCount: ms.length,
        finalCount: ms.filter(function (m) {
          return m.status === MATCH_STATUS.FINAL;
        }).length,
        updatedAt: e.updated_at,
      };
    });
  }
  var props = PropertiesService.getScriptProperties();
  return {
    appVersion: ADMIN_CONFIG.APP_VERSION,
    actor: ctx.actor,
    storage: storage,
    events: events,
    viewerUrl: props.getProperty('VIEWER_URL') || '',
    adminEmailsConfigured: !!props.getProperty('ADMIN_EMAILS'),
  };
}

function actionEventDetail_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  return eventDetail_(ctx, eventId);
}

/** 呼び出し元が最新の内容を読み込んだ ctx を渡す（書き込み後は syncPublication_ が読み直している） */
function eventDetail_(ctx, eventId) {
  var bundle = collectEvent_(ctx, eventId);
  var view = buildEventView_(bundle, true);
  view.publication = publicationStatus_(ctx, eventId);
  view.history = ctx
    .table('History')
    .rows.filter(function (h) {
      return h.event_id === eventId;
    })
    .slice(-ADMIN_CONFIG.HISTORY_VIEW_LIMIT)
    .reverse()
    .map(function (h) {
      return { at: h.at, actor: h.actor, action: h.action, entity: h.entity, entityId: h.entity_id, after: h.after_json };
    });
  return view;
}

/* ---------- セットアップ ---------- */

function actionConfigureStorage_(ctx, payload) {
  if (getSpreadsheetId_()) {
    throw appError_('ALREADY_CONFIGURED', '保存先は設定済みです。変更する場合は Apps Script のスクリプト プロパティを編集してください。');
  }
  var id = typeof payload.spreadsheetId === 'string' ? payload.spreadsheetId.trim() : '';
  var m = id.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (m) id = m[1];
  if (!SPREADSHEET_ID_PATTERN_.test(id)) {
    throw appError_('VALIDATION', 'スプレッドシートの ID（または共有リンク）を入力してください。');
  }
  try {
    SpreadsheetApp.openById(id).getName();
  } catch (e) {
    throw appError_('STORAGE_UNAVAILABLE', 'そのスプレッドシートを開けませんでした。ID と、デプロイしたアカウントの権限を確認してください。');
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  return actionBootstrap_(ctx);
}

function actionInitializeStorage_(ctx) {
  var ss = openStorage_();
  var result = initializeStorage_(ss);
  var c = createContext_(ss, ctx.actor);
  recordHistory_(c, 'storage.initialize', 'Storage', '', '', null, result);
  flushHistory_(c);
  var boot = actionBootstrap_(ctx);
  boot.initializeResult = result;
  return boot;
}

function actionSetViewerUrl_(ctx, payload) {
  var url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (url && !/^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) {
    throw appError_('VALIDATION', '閲覧者用 Web アプリの URL（https://script.google.com/macros/s/…/exec）を入力してください。');
  }
  var props = PropertiesService.getScriptProperties();
  if (url) props.setProperty('VIEWER_URL', url);
  else props.deleteProperty('VIEWER_URL');
  return actionBootstrap_(ctx);
}

/* ---------- 大会 ---------- */

function ruleName_(bestOf, provisional) {
  return 'Best of ' + bestOf + ' Legs' + (provisional ? '（暫定）' : '');
}

function parseBestOf_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (!isValidBestOf_(n)) throw appError_('VALIDATION', 'Best of は 1〜' + ADMIN_CONFIG.BEST_OF_MAX + ' の奇数で指定してください。');
  return n;
}

function parseGroupCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (n === null || n < ADMIN_CONFIG.MIN_GROUPS || n > ADMIN_CONFIG.MAX_GROUPS || Math.floor(n) !== n) {
    throw appError_('VALIDATION', 'グループ数は ' + ADMIN_CONFIG.MIN_GROUPS + '〜' + ADMIN_CONFIG.MAX_GROUPS + ' で指定してください。');
  }
  return n;
}

/** 大会・ルール・ロビンのステージ・グループをまとめて作る */
function createEventRecords_(ctx, input) {
  var events = ctx.table('Events');
  var eventId = newId_('EVT', events.byKey);
  var ruleId = newId_('RUL', ctx.table('Rules').byKey);
  var stageId = newId_('STG', ctx.table('Stages').byKey);
  var event = {
    event_id: eventId,
    name: input.name,
    date_label: input.dateLabel,
    status: EVENT_STATUS.DRAFT,
    is_public: false,
    is_featured: false,
    rule_id: ruleId,
    is_sample: !!input.isSample,
    notes: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  var rule = {
    rule_id: ruleId,
    event_id: eventId,
    name: ruleName_(input.bestOf, input.provisional),
    format: RULE_FORMAT.BEST_OF_LEGS,
    best_of: input.bestOf,
    is_provisional: input.provisional,
    notes: input.provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  var stage = {
    stage_id: stageId,
    event_id: eventId,
    name: 'ロビン',
    type: STAGE_TYPE.ROUND_ROBIN,
    order: 1,
    rule_id: ruleId,
    parent_stage_id: '',
    config_json: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  var groupTable = ctx.table('Groups');
  var taken = Object.assign({}, groupTable.byKey);
  var groups = [];
  for (var i = 0; i < input.groupCount; i++) {
    var gid = newId_('GRP', taken);
    taken[gid] = true;
    groups.push({
      group_id: gid,
      event_id: eventId,
      stage_id: stageId,
      name: groupLabel_(i),
      order: i + 1,
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), [rule]);
  appendRecords_(ctx.table('Stages'), [stage]);
  appendRecords_(groupTable, groups);
  ctx.invalidate();
  recordHistory_(ctx, 'event.create', 'Event', eventId, eventId, null, { event: event, rule: rule, groups: groups.length });
  return { event: event, rule: rule, stage: stage, groups: groups };
}

function actionCreateEvent_(ctx, payload) {
  var created = createEventRecords_(ctx, {
    name: cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    bestOf: parseBestOf_(payload.bestOf),
    provisional: payload.provisional === undefined ? true : requireBool_(payload.provisional, '暫定ルール'),
    groupCount: parseGroupCount_(payload.groupCount),
  });
  return { eventId: created.event.event_id };
}

function actionUpdateEvent_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var before = plain_(event);
  var status = payload.status;
  if (!EVENT_STATUS_LABEL[status]) throw appError_('VALIDATION', '大会の状態が不正です。');
  event.name = cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH);
  event.date_label = cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true });
  event.notes = cleanText_(payload.notes, 'メモ', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true });
  event.status = status;
  event.is_public = requireBool_(payload.isPublic, '公開設定');
  event.is_featured = event.is_public && requireBool_(payload.isFeatured, '既定表示');
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);

  // 既定表示の大会は 1 つだけ
  var others = [];
  if (event.is_featured) {
    events.rows.forEach(function (e) {
      if (e.event_id !== eventId && e.is_featured && !events.duplicates[e.event_id]) {
        e.is_featured = false;
        e.rev = (e.rev || 0) + 1;
        e.updated_at = ctx.now;
        updateRecord_(events, e);
        others.push(e.event_id);
      }
    });
  }
  ctx.invalidate();
  recordHistory_(ctx, 'event.update', 'Event', eventId, eventId, before, plain_(event));
  others.forEach(function (id) {
    syncPublication_(ctx, id);
  });
  return { eventId: eventId };
}

function hasAnyResult_(matches) {
  return matches.some(function (m) {
    return m.status !== MATCH_STATUS.SCHEDULED || (m.player1_legs || 0) !== 0 || (m.player2_legs || 0) !== 0;
  });
}

function actionUpdateRule_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (!bundle.rule) throw appError_('DATA_CONFLICT', '大会のルールが見つかりません。');
  var rules = ctx.table('Rules');
  var rule = findRecord_(rules, bundle.rule.rule_id, 'ルール');
  assertRev_(rule, requireRev_(payload.rev), 'ルール');
  var bestOf = parseBestOf_(payload.bestOf);
  if (bestOf !== rule.best_of && hasAnyResult_(bundle.matches)) {
    throw appError_('LOCKED', '結果が入力された試合があるため、Best of は変更できません。');
  }
  var before = plain_(rule);
  rule.best_of = bestOf;
  rule.is_provisional = requireBool_(payload.provisional, '暫定ルール');
  rule.name = ruleName_(bestOf, rule.is_provisional);
  rule.notes = rule.is_provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '';
  rule.rev = (rule.rev || 0) + 1;
  rule.updated_at = ctx.now;
  updateRecord_(rules, rule);
  recordHistory_(ctx, 'rule.update', 'Rule', rule.rule_id, eventId, before, plain_(rule));
  return { eventId: eventId };
}

/* ---------- 選手 ---------- */

function actionAddPlayers_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  findRecord_(ctx.table('Events'), eventId, '大会');
  if (!Array.isArray(payload.names) || payload.names.length === 0) {
    throw appError_('VALIDATION', '登録する選手名を入力してください。');
  }
  if (payload.names.length > ADMIN_CONFIG.MAX_BULK_PLAYERS) {
    throw appError_('VALIDATION', '一度に登録できるのは ' + ADMIN_CONFIG.MAX_BULK_PLAYERS + ' 名までです。');
  }
  var players = ctx.table('Players');
  var current = players.rows.filter(function (p) {
    return p.event_id === eventId;
  });
  var names = {};
  current.forEach(function (p) {
    names[p.display_name] = true;
  });
  var cleaned = payload.names.map(function (n, i) {
    var name = cleanText_(n, '選手名（' + (i + 1) + '行目）', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
    if (names[name]) throw appError_('VALIDATION', '選手名「' + name + '」は既に登録されています。');
    names[name] = true;
    return name;
  });
  if (current.length + cleaned.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) {
    throw appError_('VALIDATION', '1 大会の選手は ' + ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT + ' 名までです。');
  }
  var taken = Object.assign({}, players.byKey);
  var records = cleaned.map(function (name) {
    var id = newId_('PLY', taken);
    taken[id] = true;
    return {
      player_id: id,
      event_id: eventId,
      display_name: name,
      external_ref: '',
      notes: '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
  });
  appendRecords_(players, records);
  recordHistory_(ctx, 'player.add', 'Player', '', eventId, null, records.map(plain_));
  return { eventId: eventId, added: records.length };
}

function actionUpdatePlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var name = cleanText_(payload.name, '選手名', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
  var dup = players.rows.some(function (p) {
    return p.event_id === player.event_id && p.player_id !== player.player_id && p.display_name === name;
  });
  if (dup) throw appError_('VALIDATION', '選手名「' + name + '」は既に登録されています。');
  var before = plain_(player);
  player.display_name = name;
  player.rev = (player.rev || 0) + 1;
  player.updated_at = ctx.now;
  updateRecord_(players, player);
  recordHistory_(ctx, 'player.update', 'Player', player.player_id, player.event_id, before, plain_(player));
  return { eventId: player.event_id };
}

function actionDeletePlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var used = ctx.table('Matches').rows.some(function (m) {
    return m.player1_id === player.player_id || m.player2_id === player.player_id;
  });
  if (used) {
    throw appError_('LOCKED', '対戦カードに含まれている選手は削除できません。先にそのグループの対戦カードを削除してください。');
  }
  var entries = ctx.table('Entries');
  var ownEntries = entries.rows.filter(function (e) {
    return e.player_id === player.player_id;
  });
  var before = plain_(player);
  deleteRecords_(entries, ownEntries);
  deleteRecords_(players, [player]);
  ctx.invalidate();
  recordHistory_(ctx, 'player.delete', 'Player', before.player_id, before.event_id, before, null);
  return { eventId: before.event_id };
}

/* ---------- グループ ---------- */

function stageMatches_(ctx, eventId) {
  return ctx.table('Matches').rows.filter(function (m) {
    return m.event_id === eventId;
  });
}

function actionSetGroupCount_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (!bundle.stage) throw appError_('DATA_CONFLICT', 'ロビンのステージが見つかりません。');
  var count = parseGroupCount_(payload.count);
  if (bundle.matches.length) {
    throw appError_('LOCKED', '対戦カード作成後はグループ数を変更できません。先に対戦カードを削除してください。');
  }
  var groups = ctx.table('Groups');
  var current = bundle.groups;
  if (count > current.length) {
    var taken = Object.assign({}, groups.byKey);
    var add = [];
    for (var i = current.length; i < count; i++) {
      var gid = newId_('GRP', taken);
      taken[gid] = true;
      add.push({
        group_id: gid,
        event_id: eventId,
        stage_id: bundle.stage.stage_id,
        name: groupLabel_(i),
        order: i + 1,
        rev: 1,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    }
    appendRecords_(groups, add);
  } else if (count < current.length) {
    var removed = current.slice(count);
    var removedIds = {};
    removed.forEach(function (g) {
      removedIds[g.group_id] = true;
    });
    var entries = ctx.table('Entries');
    deleteRecords_(
      entries,
      entries.rows.filter(function (e) {
        return removedIds[e.group_id];
      })
    );
    deleteRecords_(groups, removed);
  }
  ctx.invalidate();
  recordHistory_(ctx, 'group.count', 'Stage', bundle.stage.stage_id, eventId, { count: current.length }, { count: count });
  return { eventId: eventId };
}

function actionRenameGroup_(ctx, payload) {
  var groups = ctx.table('Groups');
  var group = findRecord_(groups, requireId_(payload.groupId, 'グループ'), 'グループ');
  assertRev_(group, requireRev_(payload.rev), 'グループ');
  var before = plain_(group);
  group.name = cleanText_(payload.name, 'グループ名', ADMIN_CONFIG.MAX_LABEL_LENGTH);
  group.rev = (group.rev || 0) + 1;
  group.updated_at = ctx.now;
  updateRecord_(groups, group);
  recordHistory_(ctx, 'group.rename', 'Group', group.group_id, group.event_id, before, plain_(group));
  return { eventId: group.event_id };
}

function actionAssignPlayer_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var player = findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手');
  if (player.event_id !== eventId) throw appError_('BAD_REQUEST', '選手と大会の組み合わせが不正です。');
  var groupId = payload.groupId ? requireId_(payload.groupId, 'グループ') : '';
  var target = null;
  if (groupId) {
    target = bundle.groups.filter(function (g) {
      return g.group_id === groupId;
    })[0];
    if (!target) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  }
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.player_id === player.player_id;
  });
  var affected = {};
  if (groupId) affected[groupId] = true;
  current.forEach(function (e) {
    affected[e.group_id] = true;
  });
  var locked = bundle.matches.some(function (m) {
    return affected[m.group_id];
  });
  if (locked) {
    throw appError_('LOCKED', '対戦カード作成済みのグループの所属は変更できません。先にそのグループの対戦カードを削除してください。');
  }
  if (current.length === 1 && current[0].group_id === groupId) return { eventId: eventId };
  deleteRecords_(entries, current);
  ctx.invalidate('Entries');
  if (target) {
    var seed =
      bundle.entries.filter(function (e) {
        return e.group_id === groupId;
      }).length + 1;
    appendRecords_(ctx.table('Entries'), [
      {
        entry_id: newId_('ENT', ctx.table('Entries').byKey),
        event_id: eventId,
        stage_id: target.stage_id,
        group_id: groupId,
        player_id: player.player_id,
        seed: seed,
        rev: 1,
        created_at: ctx.now,
        updated_at: ctx.now,
      },
    ]);
  }
  ctx.invalidate();
  recordHistory_(ctx, 'entry.assign', 'Player', player.player_id, eventId, { groups: current.map(function (e) { return e.group_id; }) }, { group: groupId });
  return { eventId: eventId };
}

/** 登録順に A, B, C, D, A, B… と配る（シード・実力による振り分けはしない） */
function assignAllRoundRobin_(ctx, bundle) {
  var entries = ctx.table('Entries');
  deleteRecords_(entries, bundle.entries);
  ctx.invalidate('Entries');
  var players = bundle.players.slice().sort(function (a, b) {
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var seeds = {};
  var records = players.map(function (p, i) {
    var g = bundle.groups[i % bundle.groups.length];
    seeds[g.group_id] = (seeds[g.group_id] || 0) + 1;
    var id = newId_('ENT', taken);
    taken[id] = true;
    return {
      entry_id: id,
      event_id: bundle.event.event_id,
      stage_id: g.stage_id,
      group_id: g.group_id,
      player_id: p.player_id,
      seed: seeds[g.group_id],
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
  });
  appendRecords_(ctx.table('Entries'), records);
  ctx.invalidate();
  return records;
}

function actionAutoAssign_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (bundle.matches.length) {
    throw appError_('LOCKED', '対戦カード作成後は自動割り当てできません。先に対戦カードを削除してください。');
  }
  if (!bundle.groups.length) throw appError_('VALIDATION', 'グループがありません。');
  if (!bundle.players.length) throw appError_('VALIDATION', '選手が登録されていません。');
  var records = assignAllRoundRobin_(ctx, bundle);
  recordHistory_(ctx, 'entry.autoAssign', 'Stage', bundle.stage ? bundle.stage.stage_id : '', eventId, null, { assigned: records.length });
  return { eventId: eventId };
}

/* ---------- 対戦カード ---------- */

function generateGroupMatches_(ctx, bundle, group, taken) {
  var members = bundle.entries
    .filter(function (e) {
      return e.group_id === group.group_id;
    })
    .map(function (e) {
      return e.player_id;
    });
  return roundRobinPairings_(members).map(function (p) {
    var id = newId_('MAT', taken);
    taken[id] = true;
    return {
      match_id: id,
      event_id: bundle.event.event_id,
      stage_id: group.stage_id,
      group_id: group.group_id,
      round: p.round,
      order: p.order,
      player1_id: p.p1,
      player2_id: p.p2,
      player1_legs: 0,
      player2_legs: 0,
      status: MATCH_STATUS.SCHEDULED,
      winner_id: '',
      rule_id: '',
      next_match_id: '',
      next_match_slot: null,
      external_ref: '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
      confirmed_at: '',
    };
  });
}

function actionGenerateMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var targets = bundle.groups;
  if (payload.groupId) {
    var gid = requireId_(payload.groupId, 'グループ');
    targets = targets.filter(function (g) {
      return g.group_id === gid;
    });
    if (!targets.length) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  }
  var matchesTable = ctx.table('Matches');
  var taken = Object.assign({}, matchesTable.byKey);
  var created = [];
  var skipped = [];
  targets.forEach(function (g) {
    var exists = bundle.matches.some(function (m) {
      return m.group_id === g.group_id;
    });
    if (exists) {
      skipped.push(g.name + '（作成済み）');
      return;
    }
    var list = generateGroupMatches_(ctx, bundle, g, taken);
    if (!list.length) {
      skipped.push(g.name + '（選手 2 名未満）');
      return;
    }
    created = created.concat(list);
  });
  appendRecords_(matchesTable, created);
  ctx.invalidate();
  if (created.length) recordHistory_(ctx, 'match.generate', 'Stage', bundle.stage ? bundle.stage.stage_id : '', eventId, null, { created: created.length });
  return { eventId: eventId, created: created.length, skipped: skipped };
}

function actionClearMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var gid = requireId_(payload.groupId, 'グループ');
  var matchesTable = ctx.table('Matches');
  var targets = matchesTable.rows.filter(function (m) {
    return m.event_id === eventId && m.group_id === gid;
  });
  if (!targets.length) return { eventId: eventId, removed: 0 };
  if (hasAnyResult_(targets)) {
    throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  }
  deleteRecords_(matchesTable, targets);
  ctx.invalidate();
  recordHistory_(ctx, 'match.clear', 'Group', gid, eventId, { removed: targets.length }, null);
  return { eventId: eventId, removed: targets.length };
}

/* ---------- 試合結果 ---------- */

function actionSaveMatchResult_(ctx, payload) {
  var matchesTable = ctx.table('Matches');
  var match = findRecord_(matchesTable, requireId_(payload.matchId, '試合'), '試合');
  assertRev_(match, requireRev_(payload.rev), '試合');
  var status = payload.status;
  if (!MATCH_STATUS_LABEL[status]) throw appError_('VALIDATION', '試合状態が不正です。');
  var p1 = parseNonNegativeInt_(payload.p1Legs === '' || payload.p1Legs === undefined ? 0 : payload.p1Legs);
  var p2 = parseNonNegativeInt_(payload.p2Legs === '' || payload.p2Legs === undefined ? 0 : payload.p2Legs);
  if (p1 === null || p2 === null) throw appError_('VALIDATION', '取得 Leg 数は 0 以上の整数で入力してください。');
  if (match.status === MATCH_STATUS.FINAL && payload.correction !== true) {
    throw appError_('ALREADY_FINAL', '確定済みの試合です。結果を直す場合は「訂正」から操作してください。');
  }

  var bundle = collectEvent_(ctx, match.event_id);
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  if (!playerById[match.player1_id] || !playerById[match.player2_id] || match.player1_id === match.player2_id) {
    throw appError_('DATA_CONFLICT', 'この試合の選手情報が不正なため保存できません。');
  }
  var bestOf = bestOfFor_(bundle, match);
  var result = evaluateResult_(status, p1, p2, bestOf);
  if (!result.ok) throw appError_('VALIDATION', result.problems.join(' / '));

  var before = plain_(match);
  match.player1_legs = p1;
  match.player2_legs = p2;
  match.status = status;
  match.winner_id = result.winnerSide === 1 ? match.player1_id : result.winnerSide === 2 ? match.player2_id : '';
  match.confirmed_at = status === MATCH_STATUS.FINAL ? ctx.now : '';
  match.rev = (match.rev || 0) + 1;
  match.updated_at = ctx.now;
  updateRecord_(matchesTable, match);
  var action = before.status === MATCH_STATUS.FINAL ? 'match.correct' : 'match.result';
  recordHistory_(ctx, action, 'Match', match.match_id, match.event_id, pickResult_(before), pickResult_(match));
  return { eventId: match.event_id };
}

function pickResult_(m) {
  return {
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    player1_legs: m.player1_legs,
    player2_legs: m.player2_legs,
    status: m.status,
    winner_id: m.winner_id,
    rev: m.rev,
  };
}

function actionRepublish_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  findRecord_(ctx.table('Events'), eventId, '大会');
  return { eventId: eventId, forceRepublish: true };
}

/* ---------- サンプル ---------- */

/**
 * 検証用サンプル: 16 名・4 人 × 4 グループのロビン、Best of 5 Legs（暫定）。
 * 選手名は架空の「サンプル選手01〜16」。結果は表示確認用に、確定・進行中・未開始を混ぜて入れる。
 */
function actionCreateSampleEvent_(ctx, payload) {
  var publish = payload.publish === true;
  var created = createEventRecords_(ctx, {
    name: 'サンプル大会（PoC 検証用）',
    dateLabel: '日付未定',
    bestOf: 5,
    provisional: true,
    groupCount: SAMPLE_GROUP_COUNT_,
    isSample: true,
  });
  var eventId = created.event.event_id;
  var names = [];
  for (var i = 1; i <= SAMPLE_PLAYER_COUNT_; i++) names.push('サンプル選手' + (i < 10 ? '0' : '') + i);
  actionAddPlayers_(ctx, { eventId: eventId, names: names });
  ctx.invalidate();

  // 4 名ずつ順番にグループへ（01-04 が A、05-08 が B…）
  var bundle = collectEvent_(ctx, eventId);
  var players = bundle.players.slice().sort(function (a, b) {
    return a.display_name < b.display_name ? -1 : 1;
  });
  var taken = {};
  var entries = players.map(function (p, idx) {
    var g = bundle.groups[Math.floor(idx / 4)];
    var id = newId_('ENT', taken);
    taken[id] = true;
    return {
      entry_id: id,
      event_id: eventId,
      stage_id: g.stage_id,
      group_id: g.group_id,
      player_id: p.player_id,
      seed: (idx % 4) + 1,
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
  });
  appendRecords_(ctx.table('Entries'), entries);
  ctx.invalidate();
  bundle = collectEvent_(ctx, eventId);

  // グループ A: 全試合確定 / B: 確定 4・進行中 1・未開始 1 / C: 確定 2・進行中 1 / D: 全試合未開始
  var plan = [
    [[3, 1], [3, 2], [2, 3], [3, 0], [1, 3], [3, 2]],
    [[3, 0], [2, 3], [3, 1], [3, 2], 'live21', null],
    [[3, 1], [0, 3], 'live11', null, null, null],
    [null, null, null, null, null, null],
  ];
  var matchesTaken = Object.assign({}, ctx.table('Matches').byKey);
  var matches = [];
  bundle.groups.forEach(function (g, gi) {
    generateGroupMatches_(ctx, bundle, g, matchesTaken).forEach(function (m, mi) {
      var r = plan[gi] && plan[gi][mi];
      if (Array.isArray(r)) {
        m.player1_legs = r[0];
        m.player2_legs = r[1];
        m.status = MATCH_STATUS.FINAL;
        m.winner_id = r[0] > r[1] ? m.player1_id : m.player2_id;
        m.confirmed_at = ctx.now;
      } else if (r === 'live21' || r === 'live11') {
        m.player1_legs = r === 'live21' ? 2 : 1;
        m.player2_legs = 1;
        m.status = MATCH_STATUS.LIVE;
      }
      matches.push(m);
    });
  });
  appendRecords_(ctx.table('Matches'), matches);
  ctx.invalidate();

  if (publish) {
    var events = ctx.table('Events');
    var ev = findRecord_(events, eventId, '大会');
    ev.is_public = true;
    ev.status = EVENT_STATUS.RUNNING;
    ev.rev = (ev.rev || 0) + 1;
    ev.updated_at = ctx.now;
    updateRecord_(events, ev);
    ctx.invalidate();
  }
  recordHistory_(ctx, 'event.sample', 'Event', eventId, eventId, null, { players: names.length, matches: matches.length, publish: publish });
  return { eventId: eventId };
}

// ---- 07_api.js ----
/* 公開エントリポイント（google.script.run から呼べるのはこのファイルの 2 関数だけ） */

/**
 * 操作の一覧。mutating=true の操作は、スクリプトロックの中で実行し、
 * 二重送信を requestId で弾き、最後に公開データを同期する。
 * needsStorage=false の操作は保存先が未設定・未初期化でも実行できる。
 */
function adminActions_() {
  return {
    bootstrap: { fn: actionBootstrap_, mutating: false, needsStorage: false },
    eventDetail: { fn: actionEventDetail_, mutating: false },
    configureStorage: { fn: actionConfigureStorage_, mutating: true, needsStorage: false },
    initializeStorage: { fn: actionInitializeStorage_, mutating: true, needsStorage: false },
    setViewerUrl: { fn: actionSetViewerUrl_, mutating: true, needsStorage: false },
    createEvent: { fn: actionCreateEvent_, mutating: true },
    createSampleEvent: { fn: actionCreateSampleEvent_, mutating: true },
    updateEvent: { fn: actionUpdateEvent_, mutating: true },
    updateRule: { fn: actionUpdateRule_, mutating: true },
    addPlayers: { fn: actionAddPlayers_, mutating: true },
    updatePlayer: { fn: actionUpdatePlayer_, mutating: true },
    deletePlayer: { fn: actionDeletePlayer_, mutating: true },
    setGroupCount: { fn: actionSetGroupCount_, mutating: true },
    renameGroup: { fn: actionRenameGroup_, mutating: true },
    assignPlayer: { fn: actionAssignPlayer_, mutating: true },
    autoAssign: { fn: actionAutoAssign_, mutating: true },
    generateMatches: { fn: actionGenerateMatches_, mutating: true },
    clearMatches: { fn: actionClearMatches_, mutating: true },
    saveMatchResult: { fn: actionSaveMatchResult_, mutating: true },
    republish: { fn: actionRepublish_, mutating: true },
  };
}

function doGet() {
  try {
    requireAdmin_();
  } catch (e) {
    return HtmlService.createHtmlOutput(
      '<!doctype html><meta charset="utf-8"><title>アクセスできません</title>' +
        '<p style="font-family:sans-serif;padding:24px">このページは運営者専用です。</p>'
    ).setTitle('アクセスできません');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('n02 Tournament 運営')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 運営者用 API の唯一の入口。
 * request = { action: string, payload: object, requestId?: string }
 * 戻り値  = { ok: true, data } | { ok: false, error: { code, message } }
 */
function adminCall(request) {
  var startedAt = Date.now();
  try {
    var actor = requireAdmin_();
    if (!request || typeof request !== 'object') throw appError_('BAD_REQUEST', 'リクエストが不正です。');
    var actions = adminActions_();
    var action = typeof request.action === 'string' ? request.action : '';
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw appError_('BAD_REQUEST', '不明な操作です。');
    }
    var spec = actions[action];
    var payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
    var data = spec.mutating ? runMutation_(actor, action, spec, payload, request.requestId) : runQuery_(actor, spec, payload);
    return { ok: true, data: data, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    return errorResponse_(err, startedAt);
  }
}

function errorResponse_(err, startedAt) {
  if (err && err.appCode) {
    return { ok: false, error: { code: err.appCode, message: err.publicMessage }, elapsedMs: Date.now() - startedAt };
  }
  console.error('adminCall failed', err && err.stack ? err.stack : err);
  return {
    ok: false,
    error: { code: 'INTERNAL', message: '処理中にエラーが発生しました。時間をおいて再度お試しください。（' + (err && err.message ? String(err.message).slice(0, 200) : 'unknown') + '）' },
    elapsedMs: Date.now() - startedAt,
  };
}

function runQuery_(actor, spec, payload) {
  if (spec.needsStorage === false) return spec.fn({ actor: actor }, payload);
  return spec.fn(createContext_(openStorage_(), actor), payload);
}

var REQUEST_ID_PATTERN_ = /^[A-Za-z0-9-]{16,64}$/;

function runMutation_(actor, action, spec, payload, requestId) {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN_.test(requestId)) {
    throw appError_('BAD_REQUEST', 'requestId がありません。画面を再読み込みしてください。');
  }
  var cache = CacheService.getScriptCache();
  var dedupeKey = 'req:' + requestId;
  if (cache.get(dedupeKey)) return { duplicate: true };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_CONFIG.LOCK_WAIT_MS)) {
    throw appError_('BUSY', '他の更新処理が実行中です。数秒後にもう一度お試しください。');
  }
  try {
    // ロック待ちの間に同じ requestId の処理が終わっていることがあるので、もう一度確認する
    if (cache.get(dedupeKey)) return { duplicate: true };
    var result;
    if (spec.needsStorage === false) {
      result = spec.fn({ actor: actor }, payload);
    } else {
      var ctx = createContext_(openStorage_(), actor);
      result = spec.fn(ctx, payload) || {};
      flushHistory_(ctx);
      if (result.eventId) {
        result.publication = syncPublication_(ctx, result.eventId);
        result.detail = eventDetail_(ctx, result.eventId);
      }
      delete result.forceRepublish;
    }
    SpreadsheetApp.flush();
    cache.put(dedupeKey, action, ADMIN_CONFIG.REQUEST_DEDUPE_TTL_SEC);
    return result;
  } finally {
    lock.releaseLock();
  }
}
