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
