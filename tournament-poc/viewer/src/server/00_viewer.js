/**
 * n02 Tournament PoC - 閲覧者用 Web アプリ（サーバー側）
 *
 * このプロジェクトは読み取り専用。
 * - OAuth スコープは spreadsheets.readonly のみ（appsscript.json で固定）。書き込み API を呼ぶ権限そのものを持たない
 * - 読み込みは Sheets API（高度なサービス「Google Sheets API」）の values.get。SpreadsheetApp は使わない
 * - google.script.run から呼べる関数は doGet と getPublicSnapshot の 2 つだけ（一覧は doGet の ?format=list のみ）
 * - 読むのは運営者用アプリが作った PublicSnapshots シート（公開してよい項目だけの JSON）だけ
 *
 * 読み込み負荷対策:
 * - CacheService（スクリプトキャッシュ、全閲覧者で共有）に CACHE_TTL_SEC 秒保持
 * - キャッシュ切れの瞬間に全員がシートを読みに行かないよう、ロックで 1 リクエストだけが再読込する
 * - シートが読めないときは、長めに保持している予備のキャッシュ（stale）を返す
 */

var VIEWER_CONFIG = Object.freeze({
  APP_VERSION: '0.7.1',
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
// 公開中の大会の一覧（ポータル用）。大会 ID の形（EVT-…）とは重ならない
var LIST_KEY_ = '_list';
// 一覧に載せる大会の上限（運営用アプリの MAX_EVENTS_TOTAL と同じ。キャッシュ 1 件の大きさを抑える）
var LIST_MAX_EVENTS_ = 200;
// シートを読めないときに返す予備の内容（stale:…）と、予備を持っている大会の一覧のキー
var STALE_PREFIX_ = 'stale:';
var STALE_IDS_KEY_ = '_ids';

/**
 * ?format=json のときは画面ではなく公開データ（getPublicSnapshot と同じ内容）を JSON で返す。
 * Google の外（GitHub Pages）に置いた閲覧ページが fetch で読むための口。
 * ブラウザで複数の Google アカウントにログインしていると、Apps Script の画面（HtmlService）は
 * URL が /macros/u/1/… に書き換えられて開けないことが実環境で分かったため、閲覧ページを外に出せるようにした。
 * fetch は Cookie を送らない（匿名アクセス）ので、この問題の影響を受けない。
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.format === 'list') {
    var list = getPublicList_({ knownVersion: p.known || '' });
    return ContentService.createTextOutput(JSON.stringify(list)).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.format === 'json') {
    var res = getPublicSnapshot({ eventId: p.event || '', knownVersion: p.known || '' });
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }
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

/**
 * 公開中の大会の一覧（ポータル「トーナメント・リーグ」用）。?format=list で返す。
 * 公開データ（PublicSnapshots）から作った要約だけを返す。非公開の大会は PublicSnapshots に行がないので載らない。
 * 1 回のシート読み込みで全大会分を作り、各大会のデータと一緒にキャッシュする（大会ごとの問い合わせは発生しない）。
 * 戻り値 = { ok, version, servedAt, stale, notModified?, data?: { events: [...] }, refresh } | { ok:false, error, refresh }
 */
function getPublicList_(request) {
  var refresh = { intervalSec: VIEWER_CONFIG.REFRESH_INTERVAL_SEC, jitterSec: VIEWER_CONFIG.REFRESH_JITTER_SEC };
  var servedAt = new Date().toISOString();
  try {
    var req = request && typeof request === 'object' ? request : {};
    var knownVersion = typeof req.knownVersion === 'string' ? req.knownVersion.slice(0, 64) : '';
    var entry = loadEntry_(LIST_KEY_);
    if (!entry || entry.none) entry = { version: 'empty', json: '{"events":[]}' };
    var res = { ok: true, version: entry.version, servedAt: servedAt, stale: !!entry.stale, cache: entry.source, refresh: refresh };
    if (knownVersion && knownVersion === entry.version) res.notModified = true;
    else res.data = JSON.parse(entry.json);
    return res;
  } catch (err) {
    console.error('getPublicList failed', err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'UNAVAILABLE', message: '大会の一覧を取得できませんでした。' }, servedAt: servedAt, refresh: refresh };
  }
}

/** 公開データの JSON から一覧の要約を作る。壊れた・形の違うデータは載せない */
function buildListEntry_(entries) {
  var events = [];
  entries.forEach(function (e) {
    if (events.length >= LIST_MAX_EVENTS_) return;
    try {
      var view = JSON.parse(e.json);
      if (!view || !view.event || view.event.id !== e.eventId) return;
      events.push(summarizeEventView_(view, e.publishedAt));
    } catch (err) {
      console.warn('list summary failed', e.eventId, err && err.message);
    }
  });
  var json = JSON.stringify({ events: events });
  return { version: md5HexViewer_(json), publishedAt: '', json: json };
}

function md5HexViewer_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
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
    // 待っている間に別のリクエストが読み直していればそれを使う
    hit = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + key);
    if (hit) {
      hit.source = 'hit-after-wait';
      return hit;
    }
    if (!locked) {
      // 読み直しが長引いている。待っている全員がシートを読みに行かないよう、前回の内容で答える
      var waiting = readStale_(cache, key);
      if (waiting) return waiting;
    }
    var fresh;
    try {
      fresh = refreshFromSheet_(cache);
    } catch (e) {
      console.error('refreshFromSheet_ failed', e && e.message);
      var stale = readStale_(cache, key);
      if (stale) return stale;
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

function readStale_(cache, key) {
  var stale = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + key);
  if (!stale) return null;
  stale.stale = true;
  stale.source = 'stale';
  return stale;
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
  fresh[LIST_KEY_] = buildListEntry_(entries);

  Object.keys(fresh).forEach(function (k) {
    var value = JSON.stringify(fresh[k]);
    if (value.length > VIEWER_CONFIG.MAX_CACHE_CHARS) {
      console.warn('snapshot too large for cache', k, value.length);
      return;
    }
    freshValues[VIEWER_CONFIG.CACHE_PREFIX + k] = value;
    if (!fresh[k].none) staleValues[VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + k] = value;
  });
  // 公開をやめた・削除した大会の予備（stale）を消す。残すと、シートを読めないときに非公開の大会を返してしまう
  var staleIdsKey = VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + STALE_IDS_KEY_;
  var previousIds = readCache_(cache, staleIdsKey);
  if (!Array.isArray(previousIds)) previousIds = [];
  var currentIds = Object.keys(staleValues).map(function (fullKey) {
    return fullKey.slice((VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_).length);
  });
  var gone = previousIds
    .filter(function (k) {
      return currentIds.indexOf(k) < 0;
    })
    .map(function (k) {
      return VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + k;
    });
  if (gone.length) cache.removeAll(gone);
  staleValues[staleIdsKey] = JSON.stringify(currentIds);
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
