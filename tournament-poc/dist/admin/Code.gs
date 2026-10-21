// ==== n02 Tournament PoC 運営用 Web アプリ / Code.gs ====
// このファイルは tools/build.mjs が admin/src/server/*.js から生成したものです。直接編集しないでください。

// ---- 00_config.js ----
/**
 * n02 Tournament PoC - 運営用 Web アプリ（サーバー側 API）
 *
 * このプロジェクトだけがスプレッドシートへ書き込む。閲覧者用 Web アプリは別プロジェクトで、
 * 読み取り専用スコープしか持たない（README「セキュリティ設計」参照）。
 *
 * 運営画面は GitHub Pages に置き、この Web アプリには fetch（doPost）で JSON を送る。
 * 公開されるトップレベル関数は doGet と doPost の 2 つだけ。それ以外は名前の末尾に "_" を付けた内部関数。
 * doPost は呼び出しのたびに、大会ごとの運営用の鍵（または管理者の鍵）を検証する（02_auth.js）。
 */

var ADMIN_CONFIG = Object.freeze({
  APP_VERSION: '0.4.1',
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
  // 誰でも主催できるため、悪用・誤操作で保存先が膨らまないよう上限を設ける（管理者は対象外）
  MAX_EVENTS_TOTAL: 200,
  MAX_CREATES_PER_HOUR: 10,
  MAX_STAGES: 8,
  MAX_ELIMINATION_ENTRANTS: 128,
  MAX_REQUEST_CHARS: 100000,
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
  ROUND_ROBIN: 'round_robin', // ロビン（グループごとの総当たり）
  LEAGUE: 'league', // リーグ（全員の総当たり。ラウンドを「節」と呼ぶ）
  SINGLE_ELIMINATION: 'single_elimination', // トーナメント（勝ち抜き）
});

var RULE_FORMAT = Object.freeze({
  BEST_OF_LEGS: 'best_of_legs', // Best of N Legs
  BEST_OF_SETS: 'best_of_sets', // Best of N セット（各セット Best of M Legs）
});

var STAGE_TYPE_LABEL = Object.freeze({
  round_robin: 'ロビン',
  league: 'リーグ',
  single_elimination: 'トーナメント',
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
      ['organizer_name', 'text'], // 主催者名（任意・非公開。管理者が誰の大会か分かるように）
      ['admin_key_hash', 'text'], // 運営用の鍵の SHA-256。空欄の大会は管理者だけが操作できる
      ['admin_key_issued_at', 'text'],
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
      ['best_of', 'int'], // Leg 制なら Leg 数、セット制ならセット数
      ['is_provisional', 'bool'],
      ['set_best_of', 'int'], // セット制のとき、1 セットの Best of（Leg 数）
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
      ['manual_order', 'int'], // 同順位を主催者が決めたときの順番
      ['source_label', 'text'], // 進出元（例: グループA 1位）
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
      ['player1_sets', 'int'],
      ['player2_sets', 'int'],
      ['label', 'text'], // トーナメントの「準決勝」「3位決定戦」など
      ['status', 'text'],
      ['winner_id', 'text'],
      ['rule_id', 'text'], // 空欄ならステージのルール。将来の試合ごとのルール上書き用
      ['next_match_id', 'text'], // 将来: トーナメントの勝ち上がり先
      ['next_match_slot', 'int'],
      ['loser_next_match_id', 'text'], // 敗者の行き先（3 位決定戦）
      ['loser_next_match_slot', 'int'],
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
/* 主催者の認証と認可（すべてサーバー側で判定する）
 *
 * ログインは使わず、大会ごとの「運営用の鍵」で主催者を確かめる。
 * - 大会を作ると、推測できない長さの鍵（244 ビット相当の乱数）を発行し、運営用 URL として 1 回だけ返す。
 *   シートには鍵そのものではなく SHA-256 のハッシュだけを保存する
 * - 運営画面はリクエストごとに { eventId, key } を送る。一致すればその大会だけを操作できる
 * - プラットフォーム管理者は、スクリプト プロパティ ADMIN_KEY（利用者が設定する長い文字列）を知っている人。
 *   保存先の設定・初期化・閲覧者用 URL・既定表示の大会、全大会の管理と運営用 URL の再発行ができる
 * - 大会の作成は、スクリプト プロパティ CREATE_CODE があればそれを入力した人だけ、なければ誰でも（上限あり）
 *
 * この Web アプリは「実行: 自分 / アクセス: 全員」で公開するため、呼び出し元は一切信用しない。
 */

var EVENT_KEY_PATTERN_ = /^[a-f0-9]{48,64}$/;
var MIN_SECRET_LENGTH_ = 24;

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** 長さと内容が同じかを、途中で打ち切らずに比べる */
function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 大会の運営用の鍵（16 進 64 文字。UUID v4 2 つ分の乱数 = 244 ビット） */
function newEventKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function eventKeyHash_(eventId, key) {
  return sha256Hex_('n02-tournament:' + eventId + ':' + key);
}

function readSecretProperty_(name) {
  var v = (PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  return v.length >= MIN_SECRET_LENGTH_ ? v : '';
}

/**
 * リクエストの auth から利用者を決める。
 * auth = { adminKey } | { eventId, key } | なし
 * 戻り値 = { kind: 'admin' | 'organizer' | 'anonymous', isPlatformAdmin, eventId, label }
 */
function authenticate_(ctxProvider, auth) {
  var a = auth && typeof auth === 'object' && !Array.isArray(auth) ? auth : {};
  if (a.adminKey !== undefined) {
    var adminKey = readSecretProperty_('ADMIN_KEY');
    if (!adminKey) throw appError_('AUTH_NOT_CONFIGURED', '管理者の鍵が未設定です（スクリプト プロパティ ADMIN_KEY に 24 文字以上の文字列を設定してください）。');
    if (typeof a.adminKey !== 'string' || !safeEqual_(sha256Hex_(a.adminKey), sha256Hex_(adminKey))) {
      throw appError_('AUTH_INVALID', '管理者の鍵が違います。');
    }
    return { kind: 'admin', isPlatformAdmin: true, eventId: '', label: 'admin' };
  }
  if (a.eventId !== undefined || a.key !== undefined) {
    if (!isValidId_(a.eventId) || typeof a.key !== 'string' || !EVENT_KEY_PATTERN_.test(a.key)) {
      throw appError_('AUTH_INVALID', '運営用 URL が正しくありません。URL を最後までコピーしたか確認してください。');
    }
    var ctx = ctxProvider();
    var event = ctx.table('Events').byKey[a.eventId];
    if (!event || ctx.table('Events').duplicates[a.eventId] || !event.admin_key_hash || !safeEqual_(eventKeyHash_(a.eventId, a.key), event.admin_key_hash)) {
      // 大会が存在するかどうかを推測されないよう、理由は区別しない
      throw appError_('AUTH_INVALID', '運営用 URL が正しくないか、再発行されて無効になっています。');
    }
    return { kind: 'organizer', isPlatformAdmin: false, eventId: a.eventId, label: 'organizer:' + a.eventId };
  }
  return { kind: 'anonymous', isPlatformAdmin: false, eventId: '', label: 'anonymous' };
}

function assertPlatformAdmin_(user) {
  if (!user || !user.isPlatformAdmin) throw appError_('FORBIDDEN', 'この操作は管理者だけが行えます。');
}

/** 大会の作成を許可するか（作成コードの確認） */
function assertCanCreate_(user, code) {
  if (user.isPlatformAdmin) return;
  var required = (PropertiesService.getScriptProperties().getProperty('CREATE_CODE') || '').trim();
  if (!required) return;
  if (typeof code !== 'string' || !safeEqual_(sha256Hex_(code.trim()), sha256Hex_(required))) {
    throw appError_('FORBIDDEN', '作成コードが違います。大会を作るには、管理者から教えてもらった作成コードを入力してください。');
  }
}

function createCodeRequired_() {
  return !!(PropertiesService.getScriptProperties().getProperty('CREATE_CODE') || '').trim();
}

/**
 * 操作対象の大会を、payload の eventId / matchId / playerId / groupId から特定し、
 * 呼び出し元がその大会を管理できることを確かめる。特定できた event_id を返す。
 */
function authorizeEventPayload_(ctx, payload) {
  var eventId = '';
  if (payload.eventId !== undefined) {
    eventId = requireId_(payload.eventId, '大会');
  } else if (payload.matchId !== undefined) {
    eventId = findRecord_(ctx.table('Matches'), requireId_(payload.matchId, '試合'), '試合').event_id;
  } else if (payload.playerId !== undefined) {
    eventId = findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手').event_id;
  } else if (payload.groupId !== undefined) {
    eventId = findRecord_(ctx.table('Groups'), requireId_(payload.groupId, 'グループ'), 'グループ').event_id;
  } else if (payload.stageId !== undefined) {
    eventId = findRecord_(ctx.table('Stages'), requireId_(payload.stageId, '段階'), '段階').event_id;
  } else {
    throw appError_('BAD_REQUEST', '操作対象の大会が指定されていません。');
  }
  var user = ctx.user;
  if (!user.isPlatformAdmin && user.eventId !== eventId) {
    // 他の大会の存在を知らせないよう「見つからない」と同じ扱いにする
    throw appError_('NOT_FOUND', '大会が見つからないか、この大会を管理する権限がありません。');
  }
  findRecord_(ctx.table('Events'), eventId, '大会');
  // eventId と一緒に送られた段階・グループ・試合・選手が、その大会のものであることも確かめる
  var checks = [['stageId', 'Stages', '段階'], ['groupId', 'Groups', 'グループ'], ['matchId', 'Matches', '試合'], ['playerId', 'Players', '選手']];
  checks.forEach(function (c) {
    var v = payload[c[0]];
    if (v === undefined || v === '' || v === null) return;
    var rec = ctx.table(c[1]).byKey[requireId_(v, c[2])];
    if (!rec || rec.event_id !== eventId) throw appError_('NOT_FOUND', c[2] + 'が見つかりません。');
  });
  if (Array.isArray(payload.playerIds)) {
    payload.playerIds.forEach(function (pid) {
      var p = isValidId_(pid) ? ctx.table('Players').byKey[pid] : null;
      if (!p || p.event_id !== eventId) throw appError_('NOT_FOUND', '選手が見つかりません。');
    });
  }
  return eventId;
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
    throw appError_('STORAGE_UNAVAILABLE', 'データ保存先のスプレッドシートを開けませんでした。ID と権限を確認してください。' + googleReason_(e));
  }
}

/** 運営画面（本人のみ）に出す、Google 側のエラー文。閲覧者用には使わない */
function googleReason_(e) {
  var msg = e && e.message ? String(e.message).slice(0, 300) : '';
  return msg ? '（Google からのエラー: ' + msg + '）' : '';
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
function createContext_(ss, actor, user) {
  var cache = {};
  return {
    ss: ss,
    actor: actor,
    user: user || null,
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
 * グループ内の総当たり対戦表（サークル方式）。奇数人数のときは各ラウンドに 1 人休みが出る（不戦）。
 * cycles=2 で 2 回総当たり。戻り値: [{ round, order, p1, p2 }]
 */
function roundRobinPairings_(ids, cycles) {
  var once = roundRobinOnce_(ids);
  if (cycles !== 2 || !once.length) return once;
  // 2 回総当たり: 2 巡目は先後を入れ替え、ラウンド番号を続ける
  var lastRound = once[once.length - 1].round;
  var lastOrder = once[once.length - 1].order;
  return once.concat(
    once.map(function (m) {
      return { round: m.round + lastRound, order: m.order + lastOrder, p1: m.p2, p2: m.p1 };
    })
  );
}

function roundRobinOnce_(ids) {
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

/* ---------- 段階（ステージ）の設定 ---------- */

/** 順位の決め方に使える項目（並べた順に比べる。最後まで並んだら主催者が手で決める） */
var TIEBREAKERS = Object.freeze({
  wins: '勝数',
  leg_diff: 'Leg 差',
  legs_for: '得 Leg',
  set_diff: 'セット差',
  sets_for: '得セット',
  head_to_head: '直接対決',
});
var DEFAULT_TIEBREAKERS_ = ['wins', 'leg_diff', 'head_to_head', 'legs_for'];
var MAX_ROUND_LABEL_LENGTH_ = 30;

function isPositiveInt_(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1;
}

/** 段階の設定（config_json）を読み、欠けている項目を既定値で補う */
function stageConfig_(stage) {
  var c = {};
  try {
    c = stage && stage.config_json ? JSON.parse(stage.config_json) : {};
  } catch (e) {
    c = {};
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) c = {};
  var intMap = function (obj, valid) {
    var out = {};
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) {
        var n = Number(k);
        if (isPositiveInt_(n) && valid(obj[k])) out[String(n)] = obj[k];
      });
    }
    return out;
  };
  return {
    cycles: c.cycles === 2 ? 2 : 1,
    tiebreakers: Array.isArray(c.tiebreakers)
      ? c.tiebreakers.filter(function (k, i, arr) {
          return Object.prototype.hasOwnProperty.call(TIEBREAKERS, k) && arr.indexOf(k) === i;
        })
      : DEFAULT_TIEBREAKERS_.slice(),
    advancement: Array.isArray(c.advancement)
      ? c.advancement.filter(function (r) {
          return r && isPositiveInt_(r.fromRank) && isPositiveInt_(r.toRank) && r.fromRank <= r.toRank && isValidId_(r.targetStageId);
        })
      : [],
    advanced: c.advanced === true,
    advancedAt: typeof c.advancedAt === 'string' ? c.advancedAt : '',
    thirdPlace: c.thirdPlace === true,
    roundBestOf: intMap(c.roundBestOf, isValidBestOf_),
    roundLabels: intMap(c.roundLabels, function (v) {
      return typeof v === 'string' && v.length > 0 && v.length <= MAX_ROUND_LABEL_LENGTH_;
    }),
  };
}

function isGroupStage_(stage) {
  return !!stage && (stage.type === STAGE_TYPE.ROUND_ROBIN || stage.type === STAGE_TYPE.LEAGUE);
}

function isEliminationStage_(stage) {
  return !!stage && stage.type === STAGE_TYPE.SINGLE_ELIMINATION;
}

/* ---------- 試合ルール（Leg 制・セット制、ラウンドごとの Best of） ---------- */

function stageRule_(bundle, stage) {
  return (stage && bundle.ruleById[stage.rule_id]) || bundle.rule;
}

/**
 * 試合に適用するルール。{ format: 'legs' | 'sets', bestOf, setBestOf }
 * bestOf は Leg 制なら Leg 数、セット制ならセット数。トーナメントはラウンドごとの上書きを反映する。
 */
function matchSpec_(bundle, match) {
  var stage = bundle.stageById[match.stage_id];
  var rule = (match.rule_id && bundle.ruleById[match.rule_id]) || stageRule_(bundle, stage);
  if (!rule) return null;
  var format = rule.format === RULE_FORMAT.BEST_OF_SETS ? 'sets' : 'legs';
  var bestOf = rule.best_of;
  if (isEliminationStage_(stage)) {
    var override = stageConfig_(stage).roundBestOf[String(match.round)];
    if (override) bestOf = override;
  }
  return { format: format, bestOf: bestOf, setBestOf: format === 'sets' ? rule.set_best_of : null };
}

/**
 * 試合結果の検証（Leg 制・セット制の両方）。
 * input = { p1Legs, p2Legs, p1Sets, p2Sets }（数値。セット制の Leg 数は合計で、未入力なら null）
 * セット制: セット数を Best of の規則で判定し、Leg 数が入力されていればセット数と矛盾しないかも確かめる
 *   （勝ったセットではちょうど M 勝利数、負けたセット・進行中のセットでは M 勝利数未満）
 */
function evaluateMatchInput_(status, input, spec) {
  if (!spec) return { ok: false, winnerSide: 0, problems: ['ルールが見つかりません'] };
  if (spec.format !== 'sets') return evaluateResult_(status, input.p1Legs, input.p2Legs, spec.bestOf);
  if (!isValidBestOf_(spec.setBestOf)) return { ok: false, winnerSide: 0, problems: ['ルールのセット内 Best of 値が不正です'] };
  var base = evaluateResult_(status, input.p1Sets, input.p2Sets, spec.bestOf);
  if (!base.ok) {
    return { ok: false, winnerSide: 0, problems: base.problems.map(function (p) { return p.replace(/Leg/g, 'セット'); }) };
  }
  var l1 = input.p1Legs;
  var l2 = input.p2Legs;
  if (l1 === null || l1 === undefined || l2 === null || l2 === undefined) return base;
  if (status === MATCH_STATUS.SCHEDULED) {
    return l1 === 0 && l2 === 0 ? base : { ok: false, winnerSide: 0, problems: ['未開始の試合に Leg 数が入力されています'] };
  }
  var need = legsToWin_(spec.setBestOf);
  var extra = status === MATCH_STATUS.LIVE ? need - 1 : 0; // 進行中のセットで取った Leg
  var check = function (legs, won, lost) {
    return legs >= won * need && legs <= won * need + lost * (need - 1) + extra;
  };
  if (!check(l1, input.p1Sets, input.p2Sets) || !check(l2, input.p2Sets, input.p1Sets)) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数がセット数と合いません（各セットは先に ' + need + ' Leg）'] };
  }
  return base;
}

/* ---------- 順位 ---------- */

function emptyStats_(pid) {
  return { playerId: pid, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0, setsFor: 0, setsAgainst: 0 };
}

/** 確定した試合だけで成績を数える */
function tallyStats_(memberIds, finals) {
  var stats = {};
  memberIds.forEach(function (pid) {
    stats[pid] = emptyStats_(pid);
  });
  finals.forEach(function (f) {
    var a = stats[f.p1];
    var b = stats[f.p2];
    if (!a || !b) return;
    a.played++;
    b.played++;
    a.legsFor += f.l1 || 0;
    a.legsAgainst += f.l2 || 0;
    b.legsFor += f.l2 || 0;
    b.legsAgainst += f.l1 || 0;
    a.setsFor += f.s1;
    a.setsAgainst += f.s2;
    b.setsFor += f.s2;
    b.setsAgainst += f.s1;
    if (f.winner === f.p1) {
      a.won++;
      b.lost++;
    } else {
      b.won++;
      a.lost++;
    }
  });
  return stats;
}

function tiebreakValue_(key, pid, block, stats, finals) {
  var s = stats[pid];
  if (key === 'wins') return s.won;
  if (key === 'leg_diff') return s.legsFor - s.legsAgainst;
  if (key === 'legs_for') return s.legsFor;
  if (key === 'set_diff') return s.setsFor - s.setsAgainst;
  if (key === 'sets_for') return s.setsFor;
  if (key === 'head_to_head') {
    // 並んでいる選手どうしの試合だけで数えた勝数
    var inBlock = {};
    block.forEach(function (id) {
      inBlock[id] = true;
    });
    return finals.filter(function (f) {
      return f.winner === pid && inBlock[f.p1] && inBlock[f.p2];
    }).length;
  }
  return 0;
}

/** 並んだ選手の塊を、残りの項目で順に分けていく。最後まで並んだ塊は主催者の手動順位で分ける */
function splitTies_(ids, keys, stats, finals, manual) {
  if (ids.length <= 1) return [ids];
  if (!keys.length) {
    var set = ids.filter(function (id) {
      return manual[id];
    });
    var distinct = {};
    set.forEach(function (id) {
      distinct[manual[id]] = true;
    });
    if (set.length === ids.length && Object.keys(distinct).length === ids.length) {
      return ids
        .slice()
        .sort(function (a, b) {
          return manual[a] - manual[b];
        })
        .map(function (id) {
          return [id];
        });
    }
    return [ids];
  }
  var key = keys[0];
  var value = {};
  ids.forEach(function (id) {
    value[id] = tiebreakValue_(key, id, ids, stats, finals);
  });
  var sorted = ids.slice().sort(function (a, b) {
    return value[b] - value[a] || ids.indexOf(a) - ids.indexOf(b);
  });
  var blocks = [];
  sorted.forEach(function (id) {
    var last = blocks[blocks.length - 1];
    if (last && value[last[0]] === value[id]) last.push(id);
    else blocks.push([id]);
  });
  var out = [];
  blocks.forEach(function (b) {
    splitTies_(b, keys.slice(1), stats, finals, manual).forEach(function (x) {
      out.push(x);
    });
  });
  return out;
}

/**
 * グループ（ロビン・リーグ）の順位表。
 * 戻り値: [{ playerId, rank, tied, played, won, lost, legsFor, legsAgainst, setsFor, setsAgainst }]
 * tied=true は、設定した項目と手動順位でも決まらず同順位になっている選手。
 */
function computeStandings_(memberIds, finals, tiebreakers, manual) {
  var stats = tallyStats_(memberIds, finals);
  var blocks = splitTies_(memberIds.slice(), tiebreakers, stats, finals, manual || {});
  var out = [];
  var position = 1;
  blocks.forEach(function (b) {
    b.forEach(function (pid) {
      var s = stats[pid];
      out.push({
        playerId: pid,
        rank: position,
        tied: b.length > 1,
        played: s.played,
        won: s.won,
        lost: s.lost,
        legsFor: s.legsFor,
        legsAgainst: s.legsAgainst,
        setsFor: s.setsFor,
        setsAgainst: s.setsAgainst,
      });
    });
    position += b.length;
  });
  return out;
}

/* ---------- トーナメント表 ---------- */

/** 標準のシード配置（1 位と 2 位が決勝まで当たらない並び）。size は 2 のべき乗 */
function seedPositions_(size) {
  var arr = [1];
  while (arr.length < size) {
    var len = arr.length * 2;
    var next = [];
    arr.forEach(function (s) {
      next.push(s, len + 1 - s);
    });
    arr = next;
  }
  return arr;
}

function roundLabelForElimination_(round, rounds) {
  if (round === rounds) return '決勝';
  if (round === rounds - 1) return '準決勝';
  if (round === rounds - 2) return '準々決勝';
  return round + '回戦';
}

/**
 * シード順に並んだ出場者からトーナメント表を作る（試合レコードの元データ）。
 * 出場者が 2 のべき乗に満たない枠は不戦勝（Bye）とし、その選手は 2 回戦の枠に直接入れる。
 * 戻り値: [{ key, round, order, label, p1, p2, nextKey, nextSlot, loserNextKey, loserNextSlot }]
 */
function planBracket_(entrantIds, thirdPlace) {
  var n = entrantIds.length;
  if (n < 2) return [];
  var size = 1;
  while (size < n) size *= 2;
  var rounds = Math.round(Math.log(size) / Math.LN2);
  var pos = seedPositions_(size);
  var plan = {};
  var list = [];
  for (var r = 1; r <= rounds; r++) {
    var count = size / Math.pow(2, r);
    for (var k = 0; k < count; k++) {
      var m = {
        key: r + '-' + k,
        round: r,
        order: k + 1,
        label: roundLabelForElimination_(r, rounds),
        p1: '',
        p2: '',
        nextKey: r < rounds ? r + 1 + '-' + Math.floor(k / 2) : '',
        nextSlot: r < rounds ? (k % 2) + 1 : null,
        loserNextKey: '',
        loserNextSlot: null,
        bye: false,
      };
      plan[m.key] = m;
      list.push(m);
    }
  }
  if (thirdPlace && rounds >= 2) {
    var third = { key: 'third', round: rounds, order: 2, label: '3位決定戦', p1: '', p2: '', nextKey: '', nextSlot: null, loserNextKey: '', loserNextSlot: null, bye: false };
    plan.third = third;
    list.push(third);
    [0, 1].forEach(function (k) {
      plan[rounds - 1 + '-' + k].loserNextKey = 'third';
      plan[rounds - 1 + '-' + k].loserNextSlot = k + 1;
    });
  }
  for (var j = 0; j < size / 2; j++) {
    var first = plan['1-' + j];
    var a = entrantIds[pos[2 * j] - 1] || '';
    var b = entrantIds[pos[2 * j + 1] - 1] || '';
    if (a && b) {
      first.p1 = a;
      first.p2 = b;
    } else {
      // 不戦勝: 1 回戦は作らず、次の回戦の枠に入れる
      first.bye = true;
      var next = plan[first.nextKey];
      if (next) next['p' + first.nextSlot] = a || b;
    }
  }
  return list.filter(function (m) {
    return !m.bye;
  });
}

/* ---------- 大会の組み立て ---------- */

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
  var stageById = {};
  stages.forEach(function (s) {
    stageById[s.stage_id] = s;
  });
  return {
    event: event,
    rule: ruleById[event.rule_id] || null,
    ruleById: ruleById,
    stage: stages[0] || null,
    stages: stages,
    stageById: stageById,
    groups: groups,
    entries: entries,
    players: players,
    matches: matches,
  };
}

/** 互換用: 試合の主となる Best of（Leg 制なら Leg 数、セット制ならセット数） */
function bestOfFor_(bundle, match) {
  var spec = matchSpec_(bundle, match);
  return spec ? spec.bestOf : null;
}

function matchStarted_(m) {
  return (
    (m.status || MATCH_STATUS.SCHEDULED) !== MATCH_STATUS.SCHEDULED ||
    (m.player1_legs || 0) !== 0 ||
    (m.player2_legs || 0) !== 0 ||
    (m.player1_sets || 0) !== 0 ||
    (m.player2_sets || 0) !== 0
  );
}

/** 保存済みの結果。セット数の空欄は 0、Leg 数の空欄は null（セット制で Leg 数を入れない運用を許す） */
function storedInput_(m) {
  var z = function (v) {
    return v === null || v === undefined || v === '' ? 0 : v;
  };
  var n = function (v) {
    return v === undefined || v === '' ? null : v;
  };
  return { p1Legs: n(m.player1_legs), p2Legs: n(m.player2_legs), p1Sets: z(m.player1_sets), p2Sets: z(m.player2_sets) };
}

/**
 * 1 試合の状態を公開用に判定する。シートを直接いじられた場合に備え、保存済みデータも再検証する。
 * 状態: scheduled / live / final / check（要確認）/ pending（トーナメントで対戦相手が未確定）
 */
function judgeMatch_(bundle, match, playerById, members) {
  var stage = bundle.stageById[match.stage_id];
  var input = storedInput_(match);
  if (isEliminationStage_(stage) && (!match.player1_id || !match.player2_id)) {
    if (!matchStarted_(match)) return { state: 'pending', input: null, winnerSide: 0, problems: [] };
  }
  var problems = [];
  if (!playerById[match.player1_id] || !playerById[match.player2_id]) problems.push('選手が見つかりません');
  if (match.player1_id === match.player2_id) problems.push('同じ選手同士の対戦です');
  if (members && (!members[match.player1_id] || !members[match.player2_id])) {
    problems.push('この段階・グループに属していない選手が含まれています');
  }
  var status = match.status || MATCH_STATUS.SCHEDULED;
  var result = evaluateMatchInput_(status, input, matchSpec_(bundle, match));
  problems = problems.concat(result.problems);
  if (problems.length) return { state: 'check', input: null, winnerSide: 0, problems: problems };
  return { state: status, input: input, winnerSide: result.winnerSide, problems: [] };
}

function emptyProgress_() {
  return { total: 0, scheduled: 0, live: 0, final: 0, check: 0, pending: 0 };
}

function addProgress_(into, from) {
  Object.keys(into).forEach(function (k) {
    into[k] += from[k] || 0;
  });
}

function ruleView_(rule) {
  if (!rule) return null;
  var sets = rule.format === RULE_FORMAT.BEST_OF_SETS;
  return {
    name: rule.name,
    format: sets ? 'sets' : 'legs',
    bestOf: rule.best_of,
    setBestOf: sets ? rule.set_best_of : null,
    legsToWin: !sets && isValidBestOf_(rule.best_of) ? legsToWin_(rule.best_of) : null,
    setsToWin: sets && isValidBestOf_(rule.best_of) ? legsToWin_(rule.best_of) : null,
    provisional: rule.is_provisional,
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
  var nameOf = function (pid) {
    if (!pid) return '';
    return playerById[pid] ? playerById[pid].display_name : '（不明な選手）';
  };

  var matchView = function (m, judge, label) {
    var spec = matchSpec_(bundle, m);
    var sets = spec && spec.format === 'sets';
    var out = {
      id: m.match_id,
      round: m.round,
      order: m.order,
      label: label,
      bestOf: spec ? spec.bestOf : null,
      p1: { id: m.player1_id, name: nameOf(m.player1_id), legs: judge.input ? judge.input.p1Legs : null, sets: sets && judge.input ? judge.input.p1Sets : null },
      p2: { id: m.player2_id, name: nameOf(m.player2_id), legs: judge.input ? judge.input.p2Legs : null, sets: sets && judge.input ? judge.input.p2Sets : null },
      status: judge.state,
      winnerId: judge.winnerSide === 1 ? m.player1_id : judge.winnerSide === 2 ? m.player2_id : null,
    };
    if (includePrivate) {
      out.rev = m.rev || 0;
      out.stageId = m.stage_id;
      out.groupId = m.group_id;
      out.storedStatus = m.status;
      out.storedP1Legs = m.player1_legs;
      out.storedP2Legs = m.player2_legs;
      out.storedP1Sets = m.player1_sets;
      out.storedP2Sets = m.player2_sets;
      out.problems = judge.problems;
      out.updatedAt = m.updated_at;
      out.confirmedAt = m.confirmed_at;
      out.spec = spec;
    }
    return out;
  };

  var allProgress = emptyProgress_();
  var stages = bundle.stages.map(function (stage) {
    var cfg = stageConfig_(stage);
    var stageMatches = bundle.matches.filter(function (m) {
      return m.stage_id === stage.stage_id;
    });
    var stageEntries = bundle.entries.filter(function (e) {
      return e.stage_id === stage.stage_id;
    });
    var progress = emptyProgress_();
    var view = {
      id: stage.stage_id,
      name: stage.name,
      type: stage.type,
      order: stage.order,
      rule: ruleView_(stageRule_(bundle, stage)),
    };

    if (isGroupStage_(stage)) {
      var league = stage.type === STAGE_TYPE.LEAGUE;
      view.tiebreakers = cfg.tiebreakers;
      view.advanced = cfg.advanced;
      view.cycles = cfg.cycles;
      view.groups = bundle.groups
        .filter(function (g) {
          return g.stage_id === stage.stage_id;
        })
        .map(function (g) {
          var groupEntries = stageEntries.filter(function (e) {
            return e.group_id === g.group_id;
          });
          var members = groupEntries.map(function (e) {
            return e.player_id;
          });
          var memberSet = {};
          var manual = {};
          groupEntries.forEach(function (e) {
            memberSet[e.player_id] = true;
            if (e.manual_order) manual[e.player_id] = e.manual_order;
          });
          var gProgress = emptyProgress_();
          var finals = [];
          var matches = stageMatches
            .filter(function (m) {
              return m.group_id === g.group_id;
            })
            .map(function (m) {
              var judge = judgeMatch_(bundle, m, playerById, memberSet);
              gProgress.total++;
              gProgress[judge.state]++;
              if (judge.state === MATCH_STATUS.FINAL) {
                finals.push({
                  p1: m.player1_id,
                  p2: m.player2_id,
                  l1: judge.input.p1Legs,
                  l2: judge.input.p2Legs,
                  s1: judge.input.p1Sets,
                  s2: judge.input.p2Sets,
                  winner: judge.winnerSide === 1 ? m.player1_id : m.player2_id,
                });
              }
              var label = cfg.roundLabels[String(m.round)] || (league ? '第' + m.round + '節' : 'R' + m.round);
              return matchView(m, judge, label);
            });
          addProgress_(progress, gProgress);
          var standings = computeStandings_(members, finals, cfg.tiebreakers, manual);
          var group = {
            id: g.group_id,
            name: g.name,
            players: members.map(function (pid) {
              return { id: pid, name: nameOf(pid) };
            }),
            standings: standings,
            // 互換用（旧閲覧ページは summary を読む）
            summary: standings,
            complete: gProgress.total > 0 && gProgress.final === gProgress.total,
            progress: gProgress,
            matches: matches,
          };
          if (includePrivate) group.rev = g.rev || 0;
          return group;
        });
    } else if (isEliminationStage_(stage)) {
      view.thirdPlace = cfg.thirdPlace;
      view.roundBestOf = cfg.roundBestOf;
      var rounds = {};
      var champion = null;
      stageMatches.forEach(function (m) {
        var judge = judgeMatch_(bundle, m, playerById, null);
        progress.total++;
        progress[judge.state]++;
        var key = String(m.round);
        if (!rounds[key]) rounds[key] = { round: m.round, label: '', matches: [] };
        var mv = matchView(m, judge, m.label || m.round + '回戦');
        rounds[key].matches.push(mv);
        if (m.label === '決勝' && mv.winnerId) champion = { id: mv.winnerId, name: nameOf(mv.winnerId) };
      });
      view.rounds = Object.keys(rounds)
        .map(function (k) {
          var r = rounds[k];
          var main = r.matches.filter(function (x) {
            return x.label !== '3位決定戦';
          })[0];
          r.label = main ? main.label : r.matches[0].label;
          return r;
        })
        .sort(function (a, b) {
          return a.round - b.round;
        });
      view.champion = champion;
      view.entrants = stageEntries.map(function (e) {
        return { id: e.player_id, name: nameOf(e.player_id), seed: e.seed, source: e.source_label || '' };
      });
    }
    addProgress_(allProgress, progress);
    view.progress = progress;
    if (includePrivate) {
      var rule = stageRule_(bundle, stage);
      view.rev = stage.rev || 0;
      view.config = cfg;
      view.ruleId = rule ? rule.rule_id : '';
      view.ruleRev = rule ? rule.rev || 0 : 0;
      view.ruleProvisional = rule ? rule.is_provisional : false;
      view.matchCount = stageMatches.length;
      view.hasResults = stageMatches.some(matchStarted_);
      view.entryCount = stageEntries.length;
      view.entries = stageEntries.map(function (e) {
        return { playerId: e.player_id, groupId: e.group_id, seed: e.seed, manualOrder: e.manual_order, source: e.source_label || '' };
      });
      view.feeds = bundle.stages
        .filter(function (s) {
          return stageConfig_(s).advancement.some(function (r) {
            return r.targetStageId === stage.stage_id;
          });
        })
        .map(function (s) {
          return s.stage_id;
        });
    }
    return view;
  });

  var lastUpdated = '';
  bundle.matches.forEach(function (m) {
    if (m.updated_at && m.updated_at > lastUpdated) lastUpdated = m.updated_at;
  });
  if (bundle.event.updated_at > lastUpdated) lastUpdated = bundle.event.updated_at;

  var firstGroupStage = stages.filter(function (s) {
    return s.groups;
  })[0];
  var view = {
    event: {
      id: bundle.event.event_id,
      name: bundle.event.name,
      dateLabel: bundle.event.date_label,
      status: bundle.event.status,
    },
    rule: ruleView_(bundle.rule),
    stages: stages,
    // 互換用（旧閲覧ページ・旧運営画面は最初のロビンの groups を読む）
    stage: bundle.stage ? { id: bundle.stage.stage_id, name: bundle.stage.name, type: bundle.stage.type } : null,
    groups: firstGroupStage ? firstGroupStage.groups : [],
    progress: allProgress,
    dataUpdatedAt: lastUpdated,
  };
  if (includePrivate) {
    view.event.rev = bundle.event.rev || 0;
    view.event.isPublic = bundle.event.is_public;
    view.event.isFeatured = bundle.event.is_featured;
    view.event.isSample = bundle.event.is_sample;
    view.event.organizerName = bundle.event.organizer_name;
    view.event.adminKeyIssuedAt = bundle.event.admin_key_issued_at;
    view.event.notes = bundle.event.notes;
    if (view.rule && bundle.rule) {
      view.rule.id = bundle.rule.rule_id;
      view.rule.rev = bundle.rule.rev || 0;
      view.rule.notes = bundle.rule.notes;
    }
    view.tiebreakerLabels = TIEBREAKERS;
    view.players = bundle.players.map(function (p) {
      var memberships = bundle.entries.filter(function (e) {
        return e.player_id === p.player_id;
      });
      var first = memberships.filter(function (e) {
        return firstGroupStage && e.stage_id === firstGroupStage.id;
      })[0];
      return {
        id: p.player_id,
        name: p.display_name,
        rev: p.rev || 0,
        groupId: first ? first.group_id : '',
        stageIds: memberships.map(function (e) {
          return e.stage_id;
        }),
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
/* 運営用 API の各操作。doPost から、認証・認可・ロック・二重送信チェックの後に呼ばれる。 */

var SAMPLE_GROUP_COUNT_ = 4;
var SAMPLE_PLAYER_COUNT_ = 16;
var MAX_BATCH_RESULTS_ = 64;

/* ---------- 読み取り ---------- */

/**
 * 画面の初期表示に必要な情報。誰が呼んだかで返す範囲を変える。
 * - 未認証: 保存先の準備ができているか・作成コードが必要か・閲覧者用 URL だけ
 * - 主催者: 自分の大会 1 件
 * - 管理者: 保存先の詳細と全大会
 */
function actionBootstrap_(ctx) {
  var user = ctx.user;
  var storage = getStorageStatus_();
  var events = [];
  if (storage.initialized && user.kind !== 'anonymous') {
    var c = createContext_(openStorage_(), ctx.actor, user);
    var matches = c.table('Matches').rows;
    var players = c.table('Players').rows;
    events = c.table('Events').rows.filter(function (e) {
      return user.isPlatformAdmin || e.event_id === user.eventId;
    }).map(function (e) {
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
        organizerName: user.isPlatformAdmin ? e.organizer_name : undefined,
        hasKey: user.isPlatformAdmin ? !!e.admin_key_hash : undefined,
      };
    });
  }
  var props = PropertiesService.getScriptProperties();
  if (!user.isPlatformAdmin) {
    // 保存先の情報は管理者にだけ見せる
    storage = {
      configured: storage.configured,
      accessible: storage.accessible,
      initialized: storage.initialized,
      message: storage.initialized ? '' : '準備中です。管理者の設定が終わるまでお待ちください。',
    };
  }
  return {
    appVersion: ADMIN_CONFIG.APP_VERSION,
    role: { kind: user.kind, isPlatformAdmin: user.isPlatformAdmin, eventId: user.eventId },
    createCodeRequired: createCodeRequired_(),
    storage: storage,
    events: events,
    viewerUrl: props.getProperty('VIEWER_URL') || '',
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
    console.error('configureStorage openById failed', e && e.message);
    throw appError_('STORAGE_UNAVAILABLE', 'そのスプレッドシートを開けませんでした。ID と、デプロイしたアカウントの権限を確認してください。' + googleReason_(e));
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  return actionBootstrap_(ctx);
}

function actionInitializeStorage_(ctx) {
  var ss = openStorage_();
  var result = initializeStorage_(ss);
  var c = createContext_(ss, ctx.actor, ctx.user);
  recordHistory_(c, 'storage.initialize', 'Storage', '', '', null, result);
  flushHistory_(c);
  var boot = actionBootstrap_(ctx);
  boot.initializeResult = result;
  return boot;
}

function actionSetViewerUrl_(ctx, payload) {
  var url = typeof payload.url === 'string' ? payload.url.trim() : '';
  var gas = /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var pages = /^https:\/\/[a-z0-9-]+\.github\.io\/[A-Za-z0-9._-]+\/?$/;
  if (url && !gas.test(url) && !pages.test(url)) {
    throw appError_('VALIDATION', '閲覧ページの URL（https://<ユーザー名>.github.io/<リポジトリ名>/ または https://script.google.com/macros/s/…/exec）を入力してください。');
  }
  var props = PropertiesService.getScriptProperties();
  if (url) props.setProperty('VIEWER_URL', url);
  else props.deleteProperty('VIEWER_URL');
  return actionBootstrap_(ctx);
}

/* ---------- ルール ---------- */

function parseBestOf_(value, label) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (!isValidBestOf_(n)) throw appError_('VALIDATION', (label || 'Best of') + ' は 1〜' + ADMIN_CONFIG.BEST_OF_MAX + ' の奇数で指定してください。');
  return n;
}

function parseGroupCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (n === null || n < ADMIN_CONFIG.MIN_GROUPS || n > ADMIN_CONFIG.MAX_GROUPS || Math.floor(n) !== n) {
    throw appError_('VALIDATION', 'グループ数は ' + ADMIN_CONFIG.MIN_GROUPS + '〜' + ADMIN_CONFIG.MAX_GROUPS + ' で指定してください。');
  }
  return n;
}

/** 画面から送られたルール。{ format: 'legs' | 'sets', bestOf, setBestOf, provisional } */
function parseRuleInput_(input) {
  var src = input && typeof input === 'object' ? input : {};
  var format = src.format === 'sets' ? 'sets' : 'legs';
  return {
    format: format,
    bestOf: parseBestOf_(src.bestOf, format === 'sets' ? 'セット数の Best of' : 'Best of'),
    setBestOf: format === 'sets' ? parseBestOf_(src.setBestOf, '1 セットの Best of') : null,
    provisional: src.provisional === undefined ? true : requireBool_(src.provisional, '暫定ルール'),
  };
}

function ruleName_(spec, provisional) {
  var base =
    spec.format === 'sets'
      ? 'Best of ' + spec.bestOf + ' セット（各セット Best of ' + spec.setBestOf + ' Legs）'
      : 'Best of ' + spec.bestOf + ' Legs';
  return base + (provisional ? '（暫定）' : '');
}

function applyRule_(rule, spec, now) {
  rule.format = spec.format === 'sets' ? RULE_FORMAT.BEST_OF_SETS : RULE_FORMAT.BEST_OF_LEGS;
  rule.best_of = spec.bestOf;
  rule.set_best_of = spec.format === 'sets' ? spec.setBestOf : null;
  rule.is_provisional = spec.provisional;
  rule.name = ruleName_(spec, spec.provisional);
  rule.notes = spec.provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '';
  rule.updated_at = now;
}

function ruleSpecOf_(rule) {
  var sets = rule.format === RULE_FORMAT.BEST_OF_SETS;
  return { format: sets ? 'sets' : 'legs', bestOf: rule.best_of, setBestOf: sets ? rule.set_best_of : null, provisional: rule.is_provisional };
}

function newRuleRecord_(ctx, eventId, spec, taken) {
  var id = newId_('RUL', taken);
  taken[id] = true;
  var rule = { rule_id: id, event_id: eventId, rev: 1, created_at: ctx.now };
  applyRule_(rule, spec, ctx.now);
  return rule;
}

/* ---------- 段階の作成 ---------- */

var TEMPLATES_ = {
  robin: 'ロビンのみ',
  robin_ab: 'ロビン → A / B トーナメント',
  elimination: 'トーナメントのみ',
  league: 'リーグ',
};

function newStageRecord_(ctx, eventId, input, taken) {
  var id = newId_('STG', taken);
  taken[id] = true;
  return {
    stage_id: id,
    event_id: eventId,
    name: input.name,
    type: input.type,
    order: input.order,
    rule_id: input.ruleId,
    parent_stage_id: '',
    config_json: JSON.stringify(input.config || {}),
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
}

function newGroupRecords_(ctx, eventId, stageId, count, taken, startIndex, league) {
  var out = [];
  for (var i = 0; i < count; i++) {
    var gid = newId_('GRP', taken);
    taken[gid] = true;
    out.push({
      group_id: gid,
      event_id: eventId,
      stage_id: stageId,
      name: league ? 'リーグ' : groupLabel_((startIndex || 0) + i),
      order: (startIndex || 0) + i + 1,
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
  return out;
}

/**
 * 大会・段階・ルール・グループをひな形どおりに作る。
 * input = { name, dateLabel, organizerName, rule, template, groupCount, advanceCount, thirdPlace, cycles, isSample }
 */
function createEventRecords_(ctx, input) {
  var events = ctx.table('Events');
  var eventId = newId_('EVT', events.byKey);
  var ruleTaken = Object.assign({}, ctx.table('Rules').byKey);
  var stageTaken = Object.assign({}, ctx.table('Stages').byKey);
  var groupTaken = Object.assign({}, ctx.table('Groups').byKey);
  var template = TEMPLATES_[input.template] ? input.template : 'robin';
  var rules = [];
  var stages = [];
  var groups = [];
  var addStage = function (name, type, config) {
    var rule = newRuleRecord_(ctx, eventId, input.rule, ruleTaken);
    rules.push(rule);
    var stage = newStageRecord_(ctx, eventId, { name: name, type: type, order: stages.length + 1, ruleId: rule.rule_id, config: config }, stageTaken);
    stages.push(stage);
    return stage;
  };
  var groupConfig = { cycles: input.cycles === 2 ? 2 : 1, tiebreakers: DEFAULT_TIEBREAKERS_.slice() };
  if (template === 'elimination') {
    addStage('トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
  } else if (template === 'league') {
    var league = addStage('リーグ', STAGE_TYPE.LEAGUE, groupConfig);
    groups = groups.concat(newGroupRecords_(ctx, eventId, league.stage_id, 1, groupTaken, 0, true));
  } else {
    var robin = addStage(template === 'robin_ab' ? '予選ロビン' : 'ロビン', STAGE_TYPE.ROUND_ROBIN, groupConfig);
    groups = groups.concat(newGroupRecords_(ctx, eventId, robin.stage_id, input.groupCount, groupTaken, 0, false));
    if (template === 'robin_ab') {
      var a = addStage('A トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      var b = addStage('B トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      var k = input.advanceCount || 2;
      groupConfig.advancement = [
        { fromRank: 1, toRank: k, targetStageId: a.stage_id },
        { fromRank: k + 1, toRank: 99, targetStageId: b.stage_id },
      ];
      robin.config_json = JSON.stringify(groupConfig);
    }
  }
  var event = {
    event_id: eventId,
    name: input.name,
    date_label: input.dateLabel,
    status: EVENT_STATUS.DRAFT,
    is_public: false,
    is_featured: false,
    rule_id: rules[0].rule_id,
    is_sample: !!input.isSample,
    organizer_name: input.organizerName || '',
    admin_key_hash: '',
    admin_key_issued_at: '',
    notes: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  // 運営用の鍵はここで 1 回だけ平文で返し、シートにはハッシュだけを残す
  var adminKey = newEventKey_();
  event.admin_key_hash = eventKeyHash_(eventId, adminKey);
  event.admin_key_issued_at = ctx.now;
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), rules);
  appendRecords_(ctx.table('Stages'), stages);
  appendRecords_(ctx.table('Groups'), groups);
  ctx.invalidate();
  var logged = plain_(event);
  delete logged.admin_key_hash;
  recordHistory_(ctx, 'event.create', 'Event', eventId, eventId, null, {
    event: logged,
    template: template,
    stages: stages.length,
    groups: groups.length,
    by: ctx.user ? ctx.user.label : '',
  });
  return { event: event, rules: rules, stages: stages, groups: groups, adminKey: adminKey };
}

/** 大会作成の権限（作成コード）と上限（全体の大会数・1 時間あたりの作成数）。管理者は対象外 */
function assertCreateAllowed_(ctx, payload) {
  assertCanCreate_(ctx.user, payload.createCode);
  if (ctx.user.isPlatformAdmin) return;
  if (ctx.table('Events').rows.length >= ADMIN_CONFIG.MAX_EVENTS_TOTAL) {
    throw appError_('LIMIT', '大会の登録数が上限に達しています。管理者に連絡してください。');
  }
  var cache = CacheService.getScriptCache();
  var bucket = 'creates:' + Math.floor(Date.now() / 3600000);
  var count = Number(cache.get(bucket) || 0);
  if (count >= ADMIN_CONFIG.MAX_CREATES_PER_HOUR) {
    throw appError_('LIMIT', '短時間に多くの大会が作成されたため、一時的に作成を止めています。しばらくしてからお試しください。');
  }
  // 書き込みはスクリプトロックの中なので、数え間違いは起きない
  cache.put(bucket, String(count + 1), 3600);
}

function parseAdvanceCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value === undefined ? '2' : value);
  if (!isPositiveInt_(n) || n > 16) throw appError_('VALIDATION', '進出する順位は 1〜16 で指定してください。');
  return n;
}

function actionCreateEvent_(ctx, payload) {
  assertCreateAllowed_(ctx, payload);
  var template = TEMPLATES_[payload.template] ? payload.template : 'robin';
  var needsGroups = template === 'robin' || template === 'robin_ab';
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    rule: parseRuleInput_(payload.rule || { format: 'legs', bestOf: payload.bestOf, provisional: payload.provisional }),
    template: template,
    groupCount: needsGroups ? parseGroupCount_(payload.groupCount) : 0,
    advanceCount: template === 'robin_ab' ? parseAdvanceCount_(payload.advanceCount) : 0,
    thirdPlace: payload.thirdPlace === true,
    cycles: payload.cycles === 2 ? 2 : 1,
  });
  return { eventId: created.event.event_id, adminKey: created.adminKey };
}

/** 運営用 URL の再発行。古い URL はすぐに使えなくなる */
function actionRotateKey_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var adminKey = newEventKey_();
  event.admin_key_hash = eventKeyHash_(eventId, adminKey);
  event.admin_key_issued_at = ctx.now;
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  recordHistory_(ctx, 'event.rotateKey', 'Event', eventId, eventId, null, { issuedAt: ctx.now, by: ctx.user.label });
  return { eventId: eventId, adminKey: adminKey };
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
  // 閲覧画面の既定表示（URL に大会指定がないときの表示）はプラットフォーム全体の設定なので、管理者だけが変えられる
  if (ctx.user.isPlatformAdmin) {
    event.is_featured = event.is_public && requireBool_(payload.isFeatured, '既定表示');
  } else {
    event.is_featured = event.is_public && event.is_featured;
  }
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

/** 互換用: 大会の既定ルール（最初の段階のルール）を変える。段階ごとの変更は updateStage */
function actionUpdateRule_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (!bundle.rule) throw appError_('DATA_CONFLICT', '大会のルールが見つかりません。');
  var rules = ctx.table('Rules');
  var rule = findRecord_(rules, bundle.rule.rule_id, 'ルール');
  assertRev_(rule, requireRev_(payload.rev), 'ルール');
  var spec = parseRuleInput_(payload.rule || { format: rule.format === RULE_FORMAT.BEST_OF_SETS ? 'sets' : 'legs', bestOf: payload.bestOf, setBestOf: rule.set_best_of, provisional: payload.provisional });
  assertRuleChangeAllowed_(bundle, rule, spec);
  var before = plain_(rule);
  applyRule_(rule, spec, ctx.now);
  rule.rev = (rule.rev || 0) + 1;
  updateRecord_(rules, rule);
  recordHistory_(ctx, 'rule.update', 'Rule', rule.rule_id, eventId, before, plain_(rule));
  return { eventId: eventId };
}

/** 結果が入った試合がある段階では、勝敗の条件（形式・Best of）を変えさせない */
function assertRuleChangeAllowed_(bundle, rule, spec) {
  var current = ruleSpecOf_(rule);
  var changed = current.format !== spec.format || current.bestOf !== spec.bestOf || (spec.format === 'sets' && current.setBestOf !== spec.setBestOf);
  if (!changed) return;
  var stageIds = bundle.stages
    .filter(function (st) {
      return st.rule_id === rule.rule_id;
    })
    .map(function (st) {
      return st.stage_id;
    });
  var started = bundle.matches.some(function (m) {
    return stageIds.indexOf(m.stage_id) !== -1 && matchStarted_(m);
  });
  if (started) throw appError_('LOCKED', '結果が入力された試合があるため、対戦形式（Leg / セット・Best of）は変更できません。');
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
    return { player_id: id, event_id: eventId, display_name: name, external_ref: '', notes: '', rev: 1, created_at: ctx.now, updated_at: ctx.now };
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
    throw appError_('LOCKED', '対戦カードに含まれている選手は削除できません。先にその段階・グループの対戦カードを削除してください。');
  }
  var entries = ctx.table('Entries');
  var before = plain_(player);
  deleteRecords_(
    entries,
    entries.rows.filter(function (e) {
      return e.player_id === player.player_id;
    })
  );
  deleteRecords_(players, [player]);
  ctx.invalidate();
  recordHistory_(ctx, 'player.delete', 'Player', before.player_id, before.event_id, before, null);
  return { eventId: before.event_id };
}

/* ---------- 段階（形式）の編集 ---------- */

/** payload.stageId の段階を返す（省略時は最初の段階。kind で種類を限定できる） */
function resolveStage_(bundle, payload, kind) {
  var stage;
  if (payload.stageId !== undefined && payload.stageId !== '') {
    var id = requireId_(payload.stageId, '段階');
    stage = bundle.stageById[id];
    if (!stage) throw appError_('NOT_FOUND', '段階が見つかりません。');
  } else {
    stage = bundle.stages.filter(function (st) {
      return kind === 'group' ? isGroupStage_(st) : kind === 'elimination' ? isEliminationStage_(st) : true;
    })[0];
    if (!stage) throw appError_('NOT_FOUND', '対象の段階がありません。');
  }
  if (kind === 'group' && !isGroupStage_(stage)) throw appError_('BAD_REQUEST', 'この操作はロビン・リーグの段階でのみ使えます。');
  if (kind === 'elimination' && !isEliminationStage_(stage)) throw appError_('BAD_REQUEST', 'この操作はトーナメントの段階でのみ使えます。');
  return stage;
}

function stageMatchesOf_(bundle, stage) {
  return bundle.matches.filter(function (m) {
    return m.stage_id === stage.stage_id;
  });
}

function saveStage_(ctx, stage, cfg) {
  stage.config_json = JSON.stringify(cfg);
  stage.rev = (stage.rev || 0) + 1;
  stage.updated_at = ctx.now;
  updateRecord_(ctx.table('Stages'), stage);
}

function actionAddStage_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (bundle.stages.length >= ADMIN_CONFIG.MAX_STAGES) throw appError_('LIMIT', '段階は ' + ADMIN_CONFIG.MAX_STAGES + ' つまでです。');
  var type = payload.type;
  if (!STAGE_TYPE_LABEL[type]) throw appError_('VALIDATION', '段階の種類が不正です。');
  var name = cleanText_(payload.name || STAGE_TYPE_LABEL[type], '段階の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);
  var baseRule = bundle.rule ? ruleSpecOf_(bundle.rule) : { format: 'legs', bestOf: 5, setBestOf: null, provisional: true };
  var rule = newRuleRecord_(ctx, eventId, baseRule, Object.assign({}, ctx.table('Rules').byKey));
  var order = bundle.stages.reduce(function (mx, st) {
    return Math.max(mx, st.order || 0);
  }, 0) + 1;
  var config = type === STAGE_TYPE.SINGLE_ELIMINATION ? { thirdPlace: false } : { cycles: 1, tiebreakers: DEFAULT_TIEBREAKERS_.slice() };
  var stage = newStageRecord_(ctx, eventId, { name: name, type: type, order: order, ruleId: rule.rule_id, config: config }, Object.assign({}, ctx.table('Stages').byKey));
  appendRecords_(ctx.table('Rules'), [rule]);
  appendRecords_(ctx.table('Stages'), [stage]);
  if (isGroupStage_(stage)) {
    appendRecords_(ctx.table('Groups'), newGroupRecords_(ctx, eventId, stage.stage_id, 1, Object.assign({}, ctx.table('Groups').byKey), 0, type === STAGE_TYPE.LEAGUE));
  }
  ctx.invalidate();
  recordHistory_(ctx, 'stage.add', 'Stage', stage.stage_id, eventId, null, plain_(stage));
  return { eventId: eventId, stageId: stage.stage_id };
}

function parseTiebreakers_(value) {
  if (!Array.isArray(value) || value.length > 6) throw appError_('VALIDATION', '順位の決め方の指定が不正です。');
  var seen = {};
  value.forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(TIEBREAKERS, k) || seen[k]) throw appError_('VALIDATION', '順位の決め方の指定が不正です。');
    seen[k] = true;
  });
  return value.slice();
}

function parseRoundMap_(value, parseValue) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw appError_('VALIDATION', 'ラウンドごとの設定が不正です。');
  var out = {};
  Object.keys(value).forEach(function (k) {
    var n = Number(k);
    if (!isPositiveInt_(n) || n > 99) throw appError_('VALIDATION', 'ラウンド番号が不正です。');
    var v = value[k];
    if (v === '' || v === null || v === undefined) return;
    out[String(n)] = parseValue(v, n);
  });
  return out;
}

function parseAdvancement_(value, bundle, stage) {
  if (!Array.isArray(value) || value.length > 8) throw appError_('VALIDATION', '進出ルールの指定が不正です。');
  var rules = value.map(function (r) {
    var from = parseNonNegativeInt_(r && r.fromRank !== undefined ? r.fromRank : '');
    var to = parseNonNegativeInt_(r && r.toRank !== undefined ? r.toRank : '');
    if (!from || !to || from > to || to > 99) throw appError_('VALIDATION', '進出する順位（何位から何位まで）を正しく指定してください。');
    var target = r && isValidId_(r.targetStageId) ? bundle.stageById[r.targetStageId] : null;
    if (!target || target.stage_id === stage.stage_id) throw appError_('VALIDATION', '進出先の段階を選んでください。');
    if (!(target.order > stage.order)) throw appError_('VALIDATION', '進出先には、この段階より後の段階を選んでください。');
    if (target.type === STAGE_TYPE.ROUND_ROBIN) throw appError_('VALIDATION', '進出先はトーナメントかリーグにしてください。');
    return { fromRank: from, toRank: to, targetStageId: target.stage_id };
  });
  rules.forEach(function (a, i) {
    rules.forEach(function (b, j) {
      if (i < j && a.fromRank <= b.toRank && b.fromRank <= a.toRank) throw appError_('VALIDATION', '進出ルールの順位の範囲が重なっています。');
    });
  });
  return rules;
}

/**
 * 段階の設定を変える。payload の項目は省略可能（送られた項目だけ変更）。
 * { stageId, rev, name?, rule?, cycles?, tiebreakers?, advancement?, roundLabels?, thirdPlace?, roundBestOf? }
 */
function actionUpdateStage_(ctx, payload) {
  var stages = ctx.table('Stages');
  var stage = findRecord_(stages, requireId_(payload.stageId, '段階'), '段階');
  assertRev_(stage, requireRev_(payload.rev), '段階');
  var bundle = collectEvent_(ctx, stage.event_id);
  stage = bundle.stageById[stage.stage_id];
  var cfg = stageConfig_(stage);
  var matches = stageMatchesOf_(bundle, stage);
  var started = matches.some(matchStarted_);
  var before = plain_(stage);

  if (payload.name !== undefined) stage.name = cleanText_(payload.name, '段階の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);

  if (payload.rule !== undefined) {
    var rules = ctx.table('Rules');
    var rule = findRecord_(rules, stage.rule_id, 'ルール');
    var spec = parseRuleInput_(payload.rule);
    assertRuleChangeAllowed_(bundle, rule, spec);
    applyRule_(rule, spec, ctx.now);
    rule.rev = (rule.rev || 0) + 1;
    updateRecord_(rules, rule);
  }

  if (isGroupStage_(stage)) {
    if (payload.cycles !== undefined) {
      var cycles = payload.cycles === 2 ? 2 : payload.cycles === 1 ? 1 : null;
      if (!cycles) throw appError_('VALIDATION', '総当たりの回数は 1 回か 2 回です。');
      if (cycles !== cfg.cycles && matches.length) throw appError_('LOCKED', '対戦カード作成後は総当たりの回数を変更できません。先に対戦カードを削除してください。');
      cfg.cycles = cycles;
    }
    if (payload.tiebreakers !== undefined) {
      if (cfg.advanced) throw appError_('LOCKED', '進出確定後は順位の決め方を変更できません。');
      cfg.tiebreakers = parseTiebreakers_(payload.tiebreakers);
    }
    if (payload.advancement !== undefined) {
      if (cfg.advanced) throw appError_('LOCKED', '進出確定後は進出ルールを変更できません。先に「進出を取り消す」を行ってください。');
      cfg.advancement = parseAdvancement_(payload.advancement, bundle, stage);
    }
    if (payload.roundLabels !== undefined) {
      cfg.roundLabels = parseRoundMap_(payload.roundLabels, function (v) {
        return cleanText_(v, 'ラウンドの表示名', MAX_ROUND_LABEL_LENGTH_);
      });
    }
  } else if (isEliminationStage_(stage)) {
    if (payload.thirdPlace !== undefined) {
      var third = requireBool_(payload.thirdPlace, '3 位決定戦');
      if (third !== cfg.thirdPlace && matches.length) throw appError_('LOCKED', 'トーナメント表の作成後は 3 位決定戦の有無を変更できません。先にトーナメント表を削除してください。');
      cfg.thirdPlace = third;
    }
    if (payload.roundBestOf !== undefined) {
      var map = parseRoundMap_(payload.roundBestOf, function (v) {
        return parseBestOf_(v, 'ラウンドの Best of');
      });
      // 結果の入った試合があるラウンドの Best of は変えさせない
      matches.forEach(function (m) {
        if (matchStarted_(m) && String(map[String(m.round)] || '') !== String(cfg.roundBestOf[String(m.round)] || '')) {
          throw appError_('LOCKED', m.round + ' 回戦（' + (m.label || '') + '）は結果が入力されているため、Best of を変更できません。');
        }
      });
      cfg.roundBestOf = map;
    }
  }
  saveStage_(ctx, stage, cfg);
  ctx.invalidate();
  recordHistory_(ctx, 'stage.update', 'Stage', stage.stage_id, stage.event_id, before, plain_(stage));
  return { eventId: stage.event_id, stageId: stage.stage_id, started: started };
}

function actionDeleteStage_(ctx, payload) {
  var stages = ctx.table('Stages');
  var stage = findRecord_(stages, requireId_(payload.stageId, '段階'), '段階');
  assertRev_(stage, requireRev_(payload.rev), '段階');
  var bundle = collectEvent_(ctx, stage.event_id);
  if (bundle.stages.length <= 1) throw appError_('LOCKED', '最後の段階は削除できません。');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', '対戦カードがある段階は削除できません。先に対戦カード・トーナメント表を削除してください。');
  var feeding = bundle.stages.filter(function (st) {
    return stageConfig_(st).advancement.some(function (r) {
      return r.targetStageId === stage.stage_id;
    });
  });
  if (feeding.length) throw appError_('LOCKED', '「' + feeding[0].name + '」の進出先になっています。先にその進出ルールを外してください。');
  var before = plain_(stage);
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  var groups = ctx.table('Groups');
  deleteRecords_(groups, groups.rows.filter(function (g) {
    return g.stage_id === stage.stage_id;
  }));
  var rules = ctx.table('Rules');
  var event = findRecord_(ctx.table('Events'), stage.event_id, '大会');
  var stillUsed = bundle.stages.some(function (st) {
    return st.stage_id !== stage.stage_id && st.rule_id === stage.rule_id;
  });
  if (!stillUsed && event.rule_id !== stage.rule_id && rules.byKey[stage.rule_id]) deleteRecords_(rules, [rules.byKey[stage.rule_id]]);
  deleteRecords_(stages, [stages.byKey[stage.stage_id]]);
  ctx.invalidate();
  // 既定ルールを持っていた段階を消した場合は、残った最初の段階のルールを既定にする
  var after = collectEvent_(ctx, before.event_id);
  if (before.rule_id === after.event.rule_id && after.stages.length && after.stages[0].rule_id !== before.rule_id) {
    var events = ctx.table('Events');
    var ev = events.byKey[before.event_id];
    ev.rule_id = after.stages[0].rule_id;
    ev.rev = (ev.rev || 0) + 1;
    ev.updated_at = ctx.now;
    updateRecord_(events, ev);
    ctx.invalidate();
  }
  recordHistory_(ctx, 'stage.delete', 'Stage', before.stage_id, before.event_id, before, null);
  return { eventId: before.event_id };
}

/* ---------- ロビン・リーグ（グループ） ---------- */

function assertNotAdvanced_(stage) {
  if (stageConfig_(stage).advanced) throw appError_('LOCKED', '進出確定後はこの段階を変更できません。先に「進出を取り消す」を行ってください。');
}

function actionSetGroupCount_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'group');
  if (stage.type === STAGE_TYPE.LEAGUE) throw appError_('BAD_REQUEST', 'リーグのグループは 1 つです。');
  var count = parseGroupCount_(payload.count);
  if (stageMatchesOf_(bundle, stage).length) {
    throw appError_('LOCKED', '対戦カード作成後はグループ数を変更できません。先に対戦カードを削除してください。');
  }
  var groups = ctx.table('Groups');
  var current = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  if (count > current.length) {
    appendRecords_(groups, newGroupRecords_(ctx, eventId, stage.stage_id, count - current.length, Object.assign({}, groups.byKey), current.length, false));
  } else if (count < current.length) {
    var removed = current.slice(count);
    var removedIds = {};
    removed.forEach(function (g) {
      removedIds[g.group_id] = true;
    });
    var entries = ctx.table('Entries');
    deleteRecords_(entries, entries.rows.filter(function (e) {
      return removedIds[e.group_id];
    }));
    deleteRecords_(groups, removed.map(function (g) {
      return groups.byKey[g.group_id];
    }));
  }
  ctx.invalidate();
  recordHistory_(ctx, 'group.count', 'Stage', stage.stage_id, eventId, { count: current.length }, { count: count });
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

function newEntry_(ctx, stage, groupId, playerId, seed, taken, sourceLabel) {
  var id = newId_('ENT', taken);
  taken[id] = true;
  return {
    entry_id: id,
    event_id: stage.event_id,
    stage_id: stage.stage_id,
    group_id: groupId || '',
    player_id: playerId,
    seed: seed,
    manual_order: null,
    source_label: sourceLabel || '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
}

function actionAssignPlayer_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var player = findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手');
  if (player.event_id !== eventId) throw appError_('BAD_REQUEST', '選手と大会の組み合わせが不正です。');
  var groupId = payload.groupId ? requireId_(payload.groupId, 'グループ') : '';
  var stage;
  var target = null;
  if (groupId) {
    target = bundle.groups.filter(function (g) {
      return g.group_id === groupId;
    })[0];
    if (!target) throw appError_('NOT_FOUND', 'グループが見つかりません。');
    stage = bundle.stageById[target.stage_id];
    if (payload.stageId && payload.stageId !== stage.stage_id) throw appError_('BAD_REQUEST', 'グループと段階の組み合わせが不正です。');
  } else {
    stage = resolveStage_(bundle, payload, 'group');
  }
  if (!isGroupStage_(stage)) throw appError_('BAD_REQUEST', 'この操作はロビン・リーグの段階でのみ使えます。');
  assertNotAdvanced_(stage);
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.player_id === player.player_id && e.stage_id === stage.stage_id;
  });
  var affected = {};
  if (groupId) affected[groupId] = true;
  current.forEach(function (e) {
    affected[e.group_id] = true;
  });
  var locked = bundle.matches.some(function (m) {
    return m.stage_id === stage.stage_id && affected[m.group_id];
  });
  if (locked) {
    throw appError_('LOCKED', '対戦カード作成済みのグループの所属は変更できません。先にそのグループの対戦カードを削除してください。');
  }
  if (current.length === 1 && current[0].group_id === groupId) return { eventId: eventId };
  deleteRecords_(entries, current);
  ctx.invalidate('Entries');
  if (target) {
    var seed = bundle.entries.filter(function (e) {
      return e.group_id === groupId;
    }).length + 1;
    appendRecords_(ctx.table('Entries'), [newEntry_(ctx, stage, groupId, player.player_id, seed, Object.assign({}, ctx.table('Entries').byKey))]);
  }
  ctx.invalidate();
  recordHistory_(ctx, 'entry.assign', 'Player', player.player_id, eventId, { groups: current.map(function (e) { return e.group_id; }) }, { group: groupId, stage: stage.stage_id });
  return { eventId: eventId };
}

/** 登録順に A, B, C, D, A, B… と配る（リーグは全員を 1 グループへ） */
function assignAllRoundRobin_(ctx, bundle, stage) {
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  ctx.invalidate('Entries');
  var groups = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  var players = bundle.players.slice().sort(function (a, b) {
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var seeds = {};
  var records = players.map(function (p, i) {
    var g = groups[i % groups.length];
    seeds[g.group_id] = (seeds[g.group_id] || 0) + 1;
    return newEntry_(ctx, stage, g.group_id, p.player_id, seeds[g.group_id], taken);
  });
  appendRecords_(ctx.table('Entries'), records);
  ctx.invalidate();
  return records;
}

function actionAutoAssign_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'group');
  if (stageMatchesOf_(bundle, stage).length) {
    throw appError_('LOCKED', '対戦カード作成後は自動割り当てできません。先に対戦カードを削除してください。');
  }
  if (!bundle.groups.some(function (g) { return g.stage_id === stage.stage_id; })) throw appError_('VALIDATION', 'グループがありません。');
  if (!bundle.players.length) throw appError_('VALIDATION', '選手が登録されていません。');
  var records = assignAllRoundRobin_(ctx, bundle, stage);
  recordHistory_(ctx, 'entry.autoAssign', 'Stage', stage.stage_id, eventId, null, { assigned: records.length });
  return { eventId: eventId };
}

function blankMatch_(ctx, stage, groupId, id) {
  return {
    match_id: id,
    event_id: stage.event_id,
    stage_id: stage.stage_id,
    group_id: groupId || '',
    round: 1,
    order: 1,
    player1_id: '',
    player2_id: '',
    player1_legs: 0,
    player2_legs: 0,
    player1_sets: 0,
    player2_sets: 0,
    label: '',
    status: MATCH_STATUS.SCHEDULED,
    winner_id: '',
    rule_id: '',
    next_match_id: '',
    next_match_slot: null,
    loser_next_match_id: '',
    loser_next_match_slot: null,
    external_ref: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
    confirmed_at: '',
  };
}

function generateGroupMatches_(ctx, bundle, group, taken) {
  var stage = bundle.stageById[group.stage_id];
  var members = bundle.entries
    .filter(function (e) {
      return e.group_id === group.group_id;
    })
    .map(function (e) {
      return e.player_id;
    });
  return roundRobinPairings_(members, stageConfig_(stage).cycles).map(function (p) {
    var id = newId_('MAT', taken);
    taken[id] = true;
    var m = blankMatch_(ctx, stage, group.group_id, id);
    m.round = p.round;
    m.order = p.order;
    m.player1_id = p.p1;
    m.player2_id = p.p2;
    return m;
  });
}

function actionGenerateMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var targets;
  if (payload.groupId) {
    var gid = requireId_(payload.groupId, 'グループ');
    targets = bundle.groups.filter(function (g) {
      return g.group_id === gid;
    });
    if (!targets.length) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  } else {
    var stage = resolveStage_(bundle, payload, 'group');
    targets = bundle.groups.filter(function (g) {
      return g.stage_id === stage.stage_id;
    });
  }
  var matchesTable = ctx.table('Matches');
  var taken = Object.assign({}, matchesTable.byKey);
  var created = [];
  var skipped = [];
  targets.forEach(function (g) {
    if (bundle.matches.some(function (m) { return m.group_id === g.group_id; })) {
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
  if (created.length) recordHistory_(ctx, 'match.generate', 'Stage', targets[0] ? targets[0].stage_id : '', eventId, null, { created: created.length });
  return { eventId: eventId, created: created.length, skipped: skipped };
}

function actionClearMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var gid = requireId_(payload.groupId, 'グループ');
  var group = findRecord_(ctx.table('Groups'), gid, 'グループ');
  if (group.event_id !== eventId) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  var stage = findRecord_(ctx.table('Stages'), group.stage_id, '段階');
  assertNotAdvanced_(stage);
  var matchesTable = ctx.table('Matches');
  var targets = matchesTable.rows.filter(function (m) {
    return m.event_id === eventId && m.group_id === gid;
  });
  if (!targets.length) return { eventId: eventId, removed: 0 };
  if (targets.some(matchStarted_)) {
    throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  }
  deleteRecords_(matchesTable, targets);
  ctx.invalidate();
  recordHistory_(ctx, 'match.clear', 'Group', gid, eventId, { removed: targets.length }, null);
  return { eventId: eventId, removed: targets.length };
}

/** 同順位の選手の順番を主催者が決める（playerIds の並び順。空配列で解除） */
function actionSetManualOrder_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var gid = requireId_(payload.groupId, 'グループ');
  var group = findRecord_(ctx.table('Groups'), gid, 'グループ');
  if (group.event_id !== eventId) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  assertNotAdvanced_(findRecord_(ctx.table('Stages'), group.stage_id, '段階'));
  if (!Array.isArray(payload.playerIds) || payload.playerIds.length > 64) throw appError_('BAD_REQUEST', '選手の指定が不正です。');
  var entries = ctx.table('Entries');
  var members = entries.rows.filter(function (e) {
    return e.group_id === gid;
  });
  var byPlayer = {};
  members.forEach(function (e) {
    byPlayer[e.player_id] = e;
  });
  var seen = {};
  payload.playerIds.forEach(function (pid) {
    if (!isValidId_(pid) || !byPlayer[pid] || seen[pid]) throw appError_('BAD_REQUEST', 'このグループの選手を指定してください。');
    seen[pid] = true;
  });
  members.forEach(function (e) {
    var idx = payload.playerIds.indexOf(e.player_id);
    var next = payload.playerIds.length === 0 ? null : idx === -1 ? e.manual_order : idx + 1;
    if (next !== e.manual_order) {
      e.manual_order = next;
      e.rev = (e.rev || 0) + 1;
      e.updated_at = ctx.now;
      updateRecord_(entries, e);
    }
  });
  ctx.invalidate();
  recordHistory_(ctx, 'entry.manualOrder', 'Group', gid, eventId, null, { order: payload.playerIds });
  return { eventId: eventId };
}

/* ---------- 進出（ロビン・リーグ → 次の段階） ---------- */

function actionConfirmAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'group');
  var cfg = stageConfig_(stage);
  if (cfg.advanced) throw appError_('LOCKED', 'この段階の進出は確定済みです。');
  if (!cfg.advancement.length) throw appError_('VALIDATION', '進出ルールが設定されていません。「形式」タブで設定してください。');
  var matches = stageMatchesOf_(bundle, stage);
  if (!matches.length || matches.some(function (m) { return m.status !== MATCH_STATUS.FINAL; })) {
    throw appError_('LOCKED', 'すべての試合が確定してから進出を確定してください。');
  }
  var view = buildEventView_(bundle, true).stages.filter(function (st) {
    return st.id === stage.stage_id;
  })[0];
  if (view.progress.check) throw appError_('LOCKED', '「要確認」の試合があります。先に結果を直してください。');

  // 進出先ごとに、順位 → グループの順で並べる
  var byTarget = {};
  cfg.advancement.forEach(function (rule) {
    var target = bundle.stageById[rule.targetStageId];
    if (!target) throw appError_('DATA_CONFLICT', '進出先の段階が見つかりません。');
    if (stageMatchesOf_(bundle, target).length) throw appError_('LOCKED', '進出先「' + target.name + '」には対戦カードがあります。先に削除してください。');
    if (!byTarget[target.stage_id]) byTarget[target.stage_id] = [];
    view.groups.forEach(function (g, gi) {
      // 同順位の塊が進出の境目をまたいでいたら、手動で順位を決めてもらう
      g.standings.forEach(function (row) {
        if (!row.tied) return;
        var size = g.standings.filter(function (x) {
          return x.rank === row.rank;
        }).length;
        var last = row.rank + size - 1;
        var inside = row.rank >= rule.fromRank && last <= rule.toRank;
        var outside = last < rule.fromRank || row.rank > rule.toRank;
        if (!inside && !outside) {
          throw appError_('TIE', g.name + ' に同順位（' + row.rank + '位）の選手がいて進出者が決まりません。「組み合わせ」タブで順位を手動で決めてください。');
        }
      });
      g.standings.forEach(function (row) {
        if (row.rank >= rule.fromRank && row.rank <= rule.toRank) {
          byTarget[target.stage_id].push({ playerId: row.playerId, rank: row.rank, groupIndex: gi, label: g.name + ' ' + row.rank + '位' });
        }
      });
    });
  });

  var entries = ctx.table('Entries');
  var taken = Object.assign({}, entries.byKey);
  var added = [];
  Object.keys(byTarget).forEach(function (targetId) {
    var target = bundle.stageById[targetId];
    deleteRecords_(entries, entries.rows.filter(function (e) {
      return e.stage_id === targetId;
    }));
    var list = byTarget[targetId].sort(function (a, b) {
      return a.rank - b.rank || a.groupIndex - b.groupIndex;
    });
    var groupId = '';
    if (target.type === STAGE_TYPE.LEAGUE) {
      var g = bundle.groups.filter(function (x) {
        return x.stage_id === targetId;
      })[0];
      groupId = g ? g.group_id : '';
    }
    list.forEach(function (row, i) {
      var e = newEntry_(ctx, target, groupId, row.playerId, i + 1, taken, row.label);
      added.push(e);
    });
    ctx.invalidate('Entries');
    entries = ctx.table('Entries');
  });
  appendRecords_(ctx.table('Entries'), added);
  cfg.advanced = true;
  cfg.advancedAt = ctx.now;
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg);
  ctx.invalidate();
  recordHistory_(ctx, 'stage.advance', 'Stage', stage.stage_id, eventId, null, { advanced: added.length });
  return { eventId: eventId, advanced: added.length };
}

function actionUndoAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'group');
  var cfg = stageConfig_(stage);
  if (!cfg.advanced) return { eventId: eventId };
  var targets = {};
  cfg.advancement.forEach(function (r) {
    targets[r.targetStageId] = true;
  });
  var targetMatches = bundle.matches.filter(function (m) {
    return targets[m.stage_id];
  });
  if (targetMatches.some(matchStarted_)) {
    throw appError_('LOCKED', '進出先の段階で結果が入力されているため取り消せません。先に進出先の結果を「未開始」に戻してください。');
  }
  deleteRecords_(ctx.table('Matches'), ctx.table('Matches').rows.filter(function (m) {
    return targets[m.stage_id];
  }));
  ctx.invalidate();
  deleteRecords_(ctx.table('Entries'), ctx.table('Entries').rows.filter(function (e) {
    return targets[e.stage_id];
  }));
  ctx.invalidate();
  cfg.advanced = false;
  cfg.advancedAt = '';
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg);
  ctx.invalidate();
  recordHistory_(ctx, 'stage.undoAdvance', 'Stage', stage.stage_id, eventId, null, { removedMatches: targetMatches.length });
  return { eventId: eventId };
}

/* ---------- トーナメント ---------- */

/** 出場者とシード順を決める（playerIds の並び = シード 1, 2, 3…）。トーナメント表の作成前のみ */
function actionSetEntrants_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'elimination');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', 'トーナメント表の作成後は出場者を変更できません。先にトーナメント表を削除してください。');
  if (!Array.isArray(payload.playerIds) || payload.playerIds.length > ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS) {
    throw appError_('VALIDATION', '出場者は ' + ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS + ' 名までです。');
  }
  var playerIds = {};
  bundle.players.forEach(function (p) {
    playerIds[p.player_id] = true;
  });
  var seen = {};
  payload.playerIds.forEach(function (pid) {
    if (!isValidId_(pid) || !playerIds[pid] || seen[pid]) throw appError_('BAD_REQUEST', '出場者の指定が不正です。');
    seen[pid] = true;
  });
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  });
  var labels = {};
  current.forEach(function (e) {
    labels[e.player_id] = e.source_label;
  });
  deleteRecords_(entries, current);
  ctx.invalidate('Entries');
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var records = payload.playerIds.map(function (pid, i) {
    return newEntry_(ctx, stage, '', pid, i + 1, taken, labels[pid] || '');
  });
  appendRecords_(ctx.table('Entries'), records);
  ctx.invalidate();
  recordHistory_(ctx, 'entry.seed', 'Stage', stage.stage_id, eventId, null, { entrants: payload.playerIds });
  return { eventId: eventId };
}

function actionGenerateBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'elimination');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', 'トーナメント表は作成済みです。');
  var entrants = bundle.entries
    .filter(function (e) {
      return e.stage_id === stage.stage_id;
    })
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    })
    .map(function (e) {
      return e.player_id;
    });
  if (entrants.length < 2) throw appError_('VALIDATION', '出場者が 2 名以上必要です。');
  var plan = planBracket_(entrants, stageConfig_(stage).thirdPlace);
  var matchesTable = ctx.table('Matches');
  var taken = Object.assign({}, matchesTable.byKey);
  var idOf = {};
  plan.forEach(function (p) {
    idOf[p.key] = newId_('MAT', taken);
    taken[idOf[p.key]] = true;
  });
  var records = plan.map(function (p) {
    var m = blankMatch_(ctx, stage, '', idOf[p.key]);
    m.round = p.round;
    m.order = p.order;
    m.label = p.label;
    m.player1_id = p.p1;
    m.player2_id = p.p2;
    m.next_match_id = p.nextKey && idOf[p.nextKey] ? idOf[p.nextKey] : '';
    m.next_match_slot = m.next_match_id ? p.nextSlot : null;
    m.loser_next_match_id = p.loserNextKey ? idOf[p.loserNextKey] : '';
    m.loser_next_match_slot = m.loser_next_match_id ? p.loserNextSlot : null;
    return m;
  });
  appendRecords_(matchesTable, records);
  ctx.invalidate();
  recordHistory_(ctx, 'bracket.generate', 'Stage', stage.stage_id, eventId, null, { entrants: entrants.length, matches: records.length });
  return { eventId: eventId, created: records.length };
}

function actionClearBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'elimination');
  var matches = stageMatchesOf_(bundle, stage);
  if (matches.some(matchStarted_)) throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  var table = ctx.table('Matches');
  deleteRecords_(table, table.rows.filter(function (m) {
    return m.stage_id === stage.stage_id;
  }));
  ctx.invalidate();
  recordHistory_(ctx, 'bracket.clear', 'Stage', stage.stage_id, eventId, { removed: matches.length }, null);
  return { eventId: eventId, removed: matches.length };
}

/* ---------- 試合結果 ---------- */

function parseCount_(value, label, allowBlank) {
  if (allowBlank && (value === '' || value === null || value === undefined)) return null;
  var n = parseNonNegativeInt_(value === '' || value === undefined ? 0 : value);
  if (n === null) throw appError_('VALIDATION', label + 'は 0 以上の整数で入力してください。');
  return n;
}

/**
 * トーナメントの勝者・敗者を次の試合の枠へ入れる（訂正時は入れ替える）。
 * 次の試合がすでに始まっている場合は、結果を変えさせない。
 */
function propagateElimination_(ctx, match, beforeWinner, afterWinner) {
  var table = ctx.table('Matches');
  var loserOf = function (winner) {
    if (!winner) return '';
    return winner === match.player1_id ? match.player2_id : match.player1_id;
  };
  var moves = [
    { id: match.next_match_id, slot: match.next_match_slot, before: beforeWinner, after: afterWinner },
    { id: match.loser_next_match_id, slot: match.loser_next_match_slot, before: loserOf(beforeWinner), after: loserOf(afterWinner) },
  ];
  moves.forEach(function (mv) {
    if (!mv.id || mv.before === mv.after) return;
    var next = table.byKey[mv.id];
    if (!next) return;
    if (matchStarted_(next)) {
      throw appError_('LOCKED', '次の試合（' + (next.label || next.round + '回戦') + '）が始まっているため変更できません。先に次の試合を「未開始」に戻してください。');
    }
    next['player' + (mv.slot === 2 ? 2 : 1) + '_id'] = mv.after || '';
    next.rev = (next.rev || 0) + 1;
    next.updated_at = ctx.now;
  });
  moves.forEach(function (mv) {
    if (!mv.id || mv.before === mv.after || !table.byKey[mv.id]) return;
    updateRecord_(table, table.byKey[mv.id]);
  });
}

/** 1 試合分の結果を検証する（書き込みはしない）。戻り値を applyMatchResult_ に渡して保存する */
function prepareMatchResult_(ctx, payload) {
  var matchesTable = ctx.table('Matches');
  var match = findRecord_(matchesTable, requireId_(payload.matchId, '試合'), '試合');
  assertRev_(match, requireRev_(payload.rev), '試合');
  var status = payload.status;
  if (!MATCH_STATUS_LABEL[status]) throw appError_('VALIDATION', '試合状態が不正です。');
  if (match.status === MATCH_STATUS.FINAL && payload.correction !== true) {
    throw appError_('ALREADY_FINAL', '確定済みの試合です。結果を直す場合は「訂正」から操作してください。');
  }

  var bundle = collectEvent_(ctx, match.event_id);
  var stage = bundle.stageById[match.stage_id];
  if (isGroupStage_(stage)) assertNotAdvanced_(stage);
  if (!match.player1_id || !match.player2_id) throw appError_('LOCKED', '対戦相手が決まっていません。前の試合の結果を確定してください。');
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  if (!playerById[match.player1_id] || !playerById[match.player2_id] || match.player1_id === match.player2_id) {
    throw appError_('DATA_CONFLICT', 'この試合の選手情報が不正なため保存できません。');
  }
  var spec = matchSpec_(bundle, match);
  var sets = spec && spec.format === 'sets';
  var input = {
    p1Legs: parseCount_(payload.p1Legs, '取得 Leg 数', sets),
    p2Legs: parseCount_(payload.p2Legs, '取得 Leg 数', sets),
    p1Sets: sets ? parseCount_(payload.p1Sets, '取得セット数', false) : 0,
    p2Sets: sets ? parseCount_(payload.p2Sets, '取得セット数', false) : 0,
  };
  if (sets && (input.p1Legs === null) !== (input.p2Legs === null)) throw appError_('VALIDATION', '取得 Leg 数は両方入力するか、両方空欄にしてください。');
  var result = evaluateMatchInput_(status, input, spec);
  if (!result.ok) throw appError_('VALIDATION', result.problems.join(' / '));
  return { match: match, stage: stage, status: status, sets: sets, input: input, winnerSide: result.winnerSide, names: [playerById[match.player1_id].display_name, playerById[match.player2_id].display_name] };
}

function applyMatchResult_(ctx, prep) {
  var match = prep.match;
  var before = plain_(match);
  var beforeWinner = match.status === MATCH_STATUS.FINAL ? match.winner_id : '';
  match.player1_legs = prep.input.p1Legs;
  match.player2_legs = prep.input.p2Legs;
  match.player1_sets = prep.sets ? prep.input.p1Sets : 0;
  match.player2_sets = prep.sets ? prep.input.p2Sets : 0;
  match.status = prep.status;
  match.winner_id = prep.winnerSide === 1 ? match.player1_id : prep.winnerSide === 2 ? match.player2_id : '';
  match.confirmed_at = prep.status === MATCH_STATUS.FINAL ? ctx.now : '';
  match.rev = (match.rev || 0) + 1;
  match.updated_at = ctx.now;
  if (isEliminationStage_(prep.stage)) propagateElimination_(ctx, match, beforeWinner, match.winner_id);
  updateRecord_(ctx.table('Matches'), match);
  var action = before.status === MATCH_STATUS.FINAL ? 'match.correct' : 'match.result';
  recordHistory_(ctx, action, 'Match', match.match_id, match.event_id, pickResult_(before), pickResult_(match));
}

function actionSaveMatchResult_(ctx, payload) {
  var prep = prepareMatchResult_(ctx, payload);
  applyMatchResult_(ctx, prep);
  return { eventId: prep.match.event_id };
}

/**
 * 複数の試合をまとめて確定する。すべての結果を先に検証し、1 つでも成立しなければ何も保存しない。
 * 対象は未確定の試合の「確定」だけ（訂正・進行中の保存は 1 試合ずつ）。
 */
function actionSaveMatchResults_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var list = payload.results;
  if (!Array.isArray(list) || !list.length) throw appError_('VALIDATION', '確定する試合がありません。');
  if (list.length > MAX_BATCH_RESULTS_) throw appError_('VALIDATION', '一度に確定できるのは ' + MAX_BATCH_RESULTS_ + ' 試合までです。');
  var seen = {};
  var preps = list.map(function (r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw appError_('BAD_REQUEST', '結果の形式が不正です。');
    var matchId = requireId_(r.matchId, '試合');
    if (seen[matchId]) throw appError_('BAD_REQUEST', '同じ試合が重複しています。');
    seen[matchId] = true;
    var match = findRecord_(ctx.table('Matches'), matchId, '試合');
    // 他の大会の試合は存在しないものとして扱う（authorizeEventPayload_ と同じ方針）
    if (match.event_id !== eventId) throw appError_('NOT_FOUND', '試合 が見つかりません。画面を再読み込みしてください。');
    if (match.status === MATCH_STATUS.FINAL) throw appError_('ALREADY_FINAL', '確定済みの試合が含まれています。画面を再読み込みしてください。');
    try {
      return prepareMatchResult_(ctx, { matchId: matchId, rev: r.rev, status: MATCH_STATUS.FINAL, p1Legs: r.p1Legs, p2Legs: r.p2Legs, p1Sets: r.p1Sets, p2Sets: r.p2Sets });
    } catch (e) {
      if (!e.appCode) throw e;
      var p1 = ctx.table('Players').byKey[match.player1_id];
      var p2 = ctx.table('Players').byKey[match.player2_id];
      var label = (p1 ? p1.display_name : '?') + ' vs ' + (p2 ? p2.display_name : '?');
      throw appError_(e.appCode, label + ': ' + e.publicMessage + '（どの試合も保存していません）');
    }
  });
  preps.forEach(function (prep) {
    applyMatchResult_(ctx, prep);
  });
  return { eventId: eventId, saved: preps.length };
}

function pickResult_(m) {
  return {
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    player1_legs: m.player1_legs,
    player2_legs: m.player2_legs,
    player1_sets: m.player1_sets,
    player2_sets: m.player2_sets,
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
  assertCreateAllowed_(ctx, payload);
  var publish = payload.publish === true;
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: 'サンプル大会（PoC 検証用）',
    dateLabel: '日付未定',
    rule: { format: 'legs', bestOf: 5, setBestOf: null, provisional: true },
    template: 'robin',
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
  var stage = bundle.stages[0];
  var players = bundle.players.slice().sort(function (a, b) {
    return a.display_name < b.display_name ? -1 : 1;
  });
  var taken = {};
  var entries = players.map(function (p, idx) {
    var g = bundle.groups[Math.floor(idx / 4)];
    return newEntry_(ctx, stage, g.group_id, p.player_id, (idx % 4) + 1, taken);
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
  return { eventId: eventId, adminKey: created.adminKey };
}

// ---- 07_api.js ----
/* 公開エントリポイント（外部から呼べるのはこのファイルの doGet と doPost だけ） */

/**
 * 操作の一覧。
 * - scope: public = 誰でも（未認証可）/ create = 大会の作成（作成コードを確認）/
 *          platform = 管理者のみ / event = その大会の運営用の鍵を持つ人（または管理者）のみ
 * - mutating=true の操作は、スクリプトロックの中で実行し、二重送信を requestId で弾き、最後に公開データを同期する
 * - needsStorage=false の操作は保存先が未設定・未初期化でも実行できる
 */
function adminActions_() {
  return {
    bootstrap: { fn: actionBootstrap_, scope: 'public', mutating: false, needsStorage: false },
    eventDetail: { fn: actionEventDetail_, scope: 'event', mutating: false },
    configureStorage: { fn: actionConfigureStorage_, scope: 'platform', mutating: true, needsStorage: false },
    initializeStorage: { fn: actionInitializeStorage_, scope: 'platform', mutating: true, needsStorage: false },
    setViewerUrl: { fn: actionSetViewerUrl_, scope: 'platform', mutating: true, needsStorage: false },
    createEvent: { fn: actionCreateEvent_, scope: 'create', mutating: true },
    createSampleEvent: { fn: actionCreateSampleEvent_, scope: 'create', mutating: true },
    rotateKey: { fn: actionRotateKey_, scope: 'event', mutating: true },
    updateEvent: { fn: actionUpdateEvent_, scope: 'event', mutating: true },
    updateRule: { fn: actionUpdateRule_, scope: 'event', mutating: true },
    addPlayers: { fn: actionAddPlayers_, scope: 'event', mutating: true },
    updatePlayer: { fn: actionUpdatePlayer_, scope: 'event', mutating: true },
    deletePlayer: { fn: actionDeletePlayer_, scope: 'event', mutating: true },
    setGroupCount: { fn: actionSetGroupCount_, scope: 'event', mutating: true },
    renameGroup: { fn: actionRenameGroup_, scope: 'event', mutating: true },
    assignPlayer: { fn: actionAssignPlayer_, scope: 'event', mutating: true },
    autoAssign: { fn: actionAutoAssign_, scope: 'event', mutating: true },
    generateMatches: { fn: actionGenerateMatches_, scope: 'event', mutating: true },
    clearMatches: { fn: actionClearMatches_, scope: 'event', mutating: true },
    saveMatchResult: { fn: actionSaveMatchResult_, scope: 'event', mutating: true },
    saveMatchResults: { fn: actionSaveMatchResults_, scope: 'event', mutating: true },
    republish: { fn: actionRepublish_, scope: 'event', mutating: true },
    addStage: { fn: actionAddStage_, scope: 'event', mutating: true },
    updateStage: { fn: actionUpdateStage_, scope: 'event', mutating: true },
    deleteStage: { fn: actionDeleteStage_, scope: 'event', mutating: true },
    setManualOrder: { fn: actionSetManualOrder_, scope: 'event', mutating: true },
    confirmAdvancement: { fn: actionConfirmAdvancement_, scope: 'event', mutating: true },
    undoAdvancement: { fn: actionUndoAdvancement_, scope: 'event', mutating: true },
    setEntrants: { fn: actionSetEntrants_, scope: 'event', mutating: true },
    generateBracket: { fn: actionGenerateBracket_, scope: 'event', mutating: true },
    clearBracket: { fn: actionClearBracket_, scope: 'event', mutating: true },
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 運営画面は GitHub Pages にある。ここを直接開いた人には案内だけを返す */
function doGet() {
  return jsonOutput_({ ok: true, app: 'n02-tournament-admin-api', message: 'この URL は運営画面（GitHub Pages）から使う API です。' });
}

/**
 * 運営画面からの API 呼び出し。本文は JSON（Content-Type: text/plain で送る。CORS のプリフライトを避けるため）。
 * request = { action, payload, requestId?, auth?: { eventId, key } | { adminKey } }
 * 戻り値  = { ok: true, data } | { ok: false, error: { code, message } }
 */
function doPost(e) {
  var startedAt = Date.now();
  var text = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!text || text.length > ADMIN_CONFIG.MAX_REQUEST_CHARS) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  var request;
  try {
    request = JSON.parse(text);
  } catch (err) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  return jsonOutput_(handleAdminRequest_(request, startedAt));
}

function handleAdminRequest_(request, startedAt) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw appError_('BAD_REQUEST', 'リクエストが不正です。');
    var actions = adminActions_();
    var action = typeof request.action === 'string' ? request.action : '';
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw appError_('BAD_REQUEST', '不明な操作です。');
    }
    var spec = actions[action];
    var shared = null;
    var getCtx = function () {
      if (!shared) shared = createContext_(openStorage_(), '', null);
      return shared;
    };
    var user = authenticate_(getCtx, request.auth);
    if (spec.scope === 'platform') assertPlatformAdmin_(user);
    if (spec.scope === 'event' && user.kind === 'anonymous') {
      throw appError_('AUTH_REQUIRED', '運営用 URL から開いてください。');
    }
    var payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload) ? request.payload : {};
    var data = spec.mutating ? runMutation_(user, action, spec, payload, request.requestId, request.auth) : runQuery_(user, spec, payload, shared);
    return { ok: true, data: data, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    return errorResponse_(err, startedAt);
  }
}

function errorResponse_(err, startedAt) {
  if (err && err.appCode) {
    return { ok: false, error: { code: err.appCode, message: err.publicMessage }, elapsedMs: Date.now() - startedAt };
  }
  console.error('admin request failed', err && err.stack ? err.stack : err);
  return {
    ok: false,
    error: { code: 'INTERNAL', message: '処理中にエラーが発生しました。時間をおいて再度お試しください。' },
    elapsedMs: Date.now() - startedAt,
  };
}

function contextFor_(user, reuse) {
  var ctx = reuse || createContext_(openStorage_(), user.label, user);
  ctx.actor = user.label;
  ctx.user = user;
  return ctx;
}

function runQuery_(user, spec, payload, reuse) {
  if (spec.needsStorage === false) return spec.fn({ actor: user.label, user: user }, payload);
  var ctx = contextFor_(user, reuse);
  if (spec.scope === 'event') authorizeEventPayload_(ctx, payload);
  return spec.fn(ctx, payload);
}

var REQUEST_ID_PATTERN_ = /^[A-Za-z0-9-]{16,64}$/;

function runMutation_(user, action, spec, payload, requestId, auth) {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN_.test(requestId)) {
    throw appError_('BAD_REQUEST', 'requestId がありません。画面を再読み込みしてください。');
  }
  var cache = CacheService.getScriptCache();
  // 別の利用者の requestId と衝突しないよう、利用者ごとに分ける
  var dedupeKey = 'req:' + sha256Hex_(user.label + ':' + requestId);
  var done = cache.get(dedupeKey);
  if (done) return duplicateResult_(done);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_CONFIG.LOCK_WAIT_MS)) {
    throw appError_('BUSY', '他の更新処理が実行中です。数秒後にもう一度お試しください。');
  }
  try {
    // ロック待ちの間に同じ requestId の処理が終わっていることがあるので、もう一度確認する
    done = cache.get(dedupeKey);
    if (done) return duplicateResult_(done);
    var result;
    if (spec.needsStorage === false) {
      result = spec.fn({ actor: user.label, user: user }, payload);
    } else {
      var ctx = contextFor_(user, null);
      // 鍵の確認と権限の確認は、ロックの中で最新のデータに対してやり直す（再発行と同時に操作された場合に備える）
      if (user.kind === 'organizer') {
        user = authenticate_(function () {
          return ctx;
        }, auth);
        ctx.user = user;
      }
      if (spec.scope === 'event') authorizeEventPayload_(ctx, payload);
      result = spec.fn(ctx, payload) || {};
      flushHistory_(ctx);
      if (result.eventId) {
        result.publication = syncPublication_(ctx, result.eventId);
        result.detail = eventDetail_(ctx, result.eventId);
      }
      delete result.forceRepublish;
    }
    SpreadsheetApp.flush();
    // 大会作成・鍵の再発行は、通信が切れて再送されても同じ鍵を返せるよう結果の要点を保存する（サーバー内のみ・10 分）
    var memo = result && result.adminKey ? { eventId: result.eventId, adminKey: result.adminKey } : {};
    cache.put(dedupeKey, JSON.stringify(memo), ADMIN_CONFIG.REQUEST_DEDUPE_TTL_SEC);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function duplicateResult_(stored) {
  var memo = {};
  try {
    memo = JSON.parse(stored) || {};
  } catch (e) {
    memo = {};
  }
  memo.duplicate = true;
  return memo;
}
