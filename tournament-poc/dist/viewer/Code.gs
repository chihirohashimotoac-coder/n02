// ==== n02 Tournament PoC 閲覧者用 Web アプリ / Code.gs ====
// このファイルは tools/build.mjs が viewer/src/server/*.js から生成したものです。直接編集しないでください。

// ---- 00_viewer.js ----
/**
 * n02 Tournament PoC - 閲覧者用 Web アプリ（サーバー側）
 *
 * このプロジェクトは読み取り専用。
 * - OAuth スコープは spreadsheets.readonly のみ（appsscript.json で固定）。書き込み API を呼ぶ権限そのものを持たない
 * - 読み込みは Sheets API（高度なサービス「Google Sheets API」）の values.get。SpreadsheetApp は使わない
 * - google.script.run から呼べる関数は doGet と getPublicSnapshot の 2 つだけ
 * - 読むのは運営者用アプリが作った PublicSnapshots シート（公開してよい項目だけの JSON）だけ
 *
 * 読み込み負荷対策:
 * - CacheService（スクリプトキャッシュ、全閲覧者で共有）に CACHE_TTL_SEC 秒保持
 * - キャッシュ切れの瞬間に全員がシートを読みに行かないよう、ロックで 1 リクエストだけが再読込する
 * - シートが読めないときは、長めに保持している予備のキャッシュ（stale）を返す
 */

var VIEWER_CONFIG = Object.freeze({
  APP_VERSION: '0.1.1',
  CACHE_TTL_SEC: 20,
  STALE_TTL_SEC: 21600, // CacheService の上限（6 時間）
  NONE_TTL_SEC: 20,
  LOCK_WAIT_MS: 3000,
  REFRESH_INTERVAL_SEC: 60,
  REFRESH_JITTER_SEC: 10,
  // CacheService の 1 値あたりの上限は 100KB。余裕を持たせる
  MAX_CACHE_CHARS: 90000,
  SHEET_NAME: 'PublicSnapshots',
  CACHE_PREFIX: 'pub:v1:',
});

var VIEWER_EVENT_ID_PATTERN_ = /^EVT-[A-Z0-9]{4,32}$/;
var DEFAULT_KEY_ = '_default';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('n02 Tournament')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 公開データを返す。
 * request = { eventId?: string, knownVersion?: string }
 * 戻り値 = { ok, version, publishedAt, servedAt, stale, notModified?, data?, refresh } | { ok:false, error, refresh }
 * 例外は投げず、内部情報を含まない固定文言のエラーを返す。
 */
function getPublicSnapshot(request) {
  var refresh = { intervalSec: VIEWER_CONFIG.REFRESH_INTERVAL_SEC, jitterSec: VIEWER_CONFIG.REFRESH_JITTER_SEC };
  var servedAt = new Date().toISOString();
  try {
    var req = request && typeof request === 'object' ? request : {};
    var eventId = '';
    if (req.eventId !== undefined && req.eventId !== null && req.eventId !== '') {
      if (typeof req.eventId !== 'string' || !VIEWER_EVENT_ID_PATTERN_.test(req.eventId)) {
        return { ok: false, error: { code: 'BAD_REQUEST', message: '大会の指定が正しくありません。' }, servedAt: servedAt, refresh: refresh };
      }
      eventId = req.eventId;
    }
    var knownVersion = typeof req.knownVersion === 'string' ? req.knownVersion.slice(0, 64) : '';

    var entry = loadEntry_(eventId || DEFAULT_KEY_);
    if (!entry || entry.none) {
      return {
        ok: false,
        error: { code: 'NO_PUBLIC_EVENT', message: eventId ? 'この大会は公開されていません。' : '現在公開中の大会はありません。' },
        servedAt: servedAt,
        stale: !!(entry && entry.stale),
        refresh: refresh,
      };
    }
    var res = {
      ok: true,
      version: entry.version,
      publishedAt: entry.publishedAt,
      servedAt: servedAt,
      stale: !!entry.stale,
      cache: entry.source,
      refresh: refresh,
    };
    if (knownVersion && knownVersion === entry.version) {
      res.notModified = true;
    } else {
      res.data = JSON.parse(entry.json);
    }
    return res;
  } catch (err) {
    console.error('getPublicSnapshot failed', err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'UNAVAILABLE', message: 'データを取得できませんでした。' }, servedAt: servedAt, refresh: refresh };
  }
}

/** キャッシュに入れる値: { version, publishedAt, json } または { none: true } */
function loadEntry_(key) {
  var cache = CacheService.getScriptCache();
  var hit = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + key);
  if (hit) {
    hit.source = 'hit';
    return hit;
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(VIEWER_CONFIG.LOCK_WAIT_MS);
  } catch (e) {
    locked = false;
  }
  try {
    if (locked) {
      // 待っている間に別のリクエストが読み直していればそれを使う
      hit = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + key);
      if (hit) {
        hit.source = 'hit-after-wait';
        return hit;
      }
    }
    var fresh;
    try {
      fresh = refreshFromSheet_(cache);
    } catch (e) {
      console.error('refreshFromSheet_ failed', e && e.message);
      var stale = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + 'stale:' + key);
      if (stale) {
        stale.stale = true;
        stale.source = 'stale';
        return stale;
      }
      throw e;
    }
    var entry = fresh[key];
    if (!entry) {
      // 公開されていない大会 ID への問い合わせも短時間キャッシュし、シートの再読込を繰り返さない
      entry = { none: true };
      cache.put(VIEWER_CONFIG.CACHE_PREFIX + key, JSON.stringify(entry), VIEWER_CONFIG.NONE_TTL_SEC);
    }
    entry.source = 'miss';
    return entry;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function readCache_(cache, fullKey) {
  var raw = cache.get(fullKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/**
 * PublicSnapshots シートを 1 回だけ読み、全公開大会と既定大会の分をまとめてキャッシュへ入れる。
 * 戻り値: { [eventId | '_default']: entry }
 */
function refreshFromSheet_(cache) {
  var entries = readPublishedEntries_();
  var fresh = {};
  var staleValues = {};
  var freshValues = {};
  var defaultEntry = null;
  var newest = null;
  entries.forEach(function (e) {
    fresh[e.eventId] = { version: e.version, publishedAt: e.publishedAt, json: e.json };
    if (e.isDefault && !defaultEntry) defaultEntry = e;
    if (!newest || e.publishedAt > newest.publishedAt) newest = e;
  });
  var def = defaultEntry || newest;
  fresh[DEFAULT_KEY_] = def ? { version: def.version, publishedAt: def.publishedAt, json: def.json } : { none: true };

  Object.keys(fresh).forEach(function (k) {
    var value = JSON.stringify(fresh[k]);
    if (value.length > VIEWER_CONFIG.MAX_CACHE_CHARS) {
      console.warn('snapshot too large for cache', k, value.length);
      return;
    }
    freshValues[VIEWER_CONFIG.CACHE_PREFIX + k] = value;
    if (!fresh[k].none) staleValues[VIEWER_CONFIG.CACHE_PREFIX + 'stale:' + k] = value;
  });
  if (fresh[DEFAULT_KEY_].none) {
    cache.put(VIEWER_CONFIG.CACHE_PREFIX + DEFAULT_KEY_, freshValues[VIEWER_CONFIG.CACHE_PREFIX + DEFAULT_KEY_], VIEWER_CONFIG.NONE_TTL_SEC);
    delete freshValues[VIEWER_CONFIG.CACHE_PREFIX + DEFAULT_KEY_];
  }
  if (Object.keys(freshValues).length) cache.putAll(freshValues, VIEWER_CONFIG.CACHE_TTL_SEC);
  if (Object.keys(staleValues).length) cache.putAll(staleValues, VIEWER_CONFIG.STALE_TTL_SEC);
  return fresh;
}

function readPublishedEntries_() {
  var id = (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(id)) throw new Error('SPREADSHEET_ID is not configured');
  // SpreadsheetApp.openById は読むだけでも spreadsheets（編集を含む）スコープを要求するため、
  // 参照専用スコープ（spreadsheets.readonly）で使える Sheets API（高度なサービス）で読む。
  var values;
  try {
    values = Sheets.Spreadsheets.Values.get(id, VIEWER_CONFIG.SHEET_NAME).values || [];
  } catch (e) {
    // 運営側でまだ初期化していない（シートがない）場合は「公開中の大会なし」として扱う
    if (/Unable to parse range/i.test(String(e && e.message))) return [];
    throw e;
  }
  if (values.length < 2) return [];
  var header = values[0].map(function (h) {
    return String(h).trim();
  });
  var col = function (name) {
    return header.indexOf(name);
  };
  var iEvent = col('event_id');
  var iDefault = col('is_default');
  var iVersion = col('version');
  var iPublished = col('published_at');
  var iCount = col('chunk_count');
  if (iEvent < 0 || iVersion < 0 || iCount < 0) throw new Error('PublicSnapshots header is broken');

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var eventId = String(row[iEvent] || '').trim();
    if (!VIEWER_EVENT_ID_PATTERN_.test(eventId)) continue;
    var count = Number(row[iCount]);
    if (!(count >= 1 && count <= 10)) continue;
    var json = '';
    var broken = false;
    for (var c = 1; c <= count; c++) {
      var idx = col('chunk_' + (c < 10 ? '0' : '') + c);
      var part = idx >= 0 ? String(row[idx] || '') : '';
      if (part.charAt(0) !== '~') {
        broken = true;
        break;
      }
      json += part.slice(1);
    }
    if (broken) continue;
    try {
      JSON.parse(json);
    } catch (e) {
      console.warn('broken snapshot', eventId);
      continue;
    }
    var published = row[iPublished];
    out.push({
      eventId: eventId,
      isDefault: row[iDefault] === true || String(row[iDefault]).toUpperCase() === 'TRUE',
      version: String(row[iVersion] || ''),
      publishedAt: Object.prototype.toString.call(published) === '[object Date]' ? published.toISOString() : String(published || ''),
      json: json,
    });
  }
  return out;
}
