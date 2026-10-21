/* 公開エントリポイント（外部から呼べるのはこのファイルの doGet と doPost だけ） */

/**
 * 操作の一覧。
 * - scope: public = 誰でも（未認証可）/ login = ログイン（送られた auth は見ない）/
 *          create = 大会の作成（Google ログインした人と管理者）/ google = Google でログインした人のみ / platform = 管理者のみ /
 *          event = その大会を運営できる人（作った本人・その大会の管理パスワードでログインした人・管理者）のみ
 * - mutating=true の操作は、スクリプトロックの中で実行し、二重送信を requestId で弾き、最後に公開データを同期する
 * - needsStorage=false の操作は保存先が未設定・未初期化でも実行できる
 */
function adminActions_() {
  return {
    bootstrap: { fn: actionBootstrap_, scope: 'public', mutating: false, needsStorage: false },
    login: { fn: actionLogin_, scope: 'login', mutating: false, needsStorage: false },
    staffLogin: { fn: actionStaffLogin_, scope: 'login', mutating: false },
    logout: { fn: actionLogout_, scope: 'login', mutating: false, needsStorage: false },
    myEvents: { fn: actionMyEvents_, scope: 'google', mutating: false },
    eventDetail: { fn: actionEventDetail_, scope: 'event', mutating: false },
    configureStorage: { fn: actionConfigureStorage_, scope: 'platform', mutating: true, needsStorage: false },
    initializeStorage: { fn: actionInitializeStorage_, scope: 'platform', mutating: true, needsStorage: false },
    setViewerUrl: { fn: actionSetViewerUrl_, scope: 'platform', mutating: true, needsStorage: false },
    createEvent: { fn: actionCreateEvent_, scope: 'create', mutating: true },
    createSampleEvent: { fn: actionCreateSampleEvent_, scope: 'create', mutating: true },
    setStaffPassword: { fn: actionSetStaffPassword_, scope: 'event', mutating: true },
    setOwner: { fn: actionSetOwner_, scope: 'event', mutating: true },
    exportEvent: { fn: actionExportEvent_, scope: 'event', mutating: false },
    deleteEvent: { fn: actionDeleteEvent_, scope: 'event', mutating: true },
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
 * request = { action, payload, requestId?, auth?: { session } | { adminKey } }
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
    // ログインの操作では、送られてきた（期限切れかもしれない）セッションを見ない
    var user = spec.scope === 'login' ? authenticate_(getCtx, null) : authenticate_(getCtx, request.auth);
    if (spec.scope === 'platform') assertPlatformAdmin_(user);
    if (spec.scope === 'google' && user.kind !== 'google') {
      throw appError_('AUTH_REQUIRED', 'Google でログインしてください。');
    }
    if (spec.scope === 'event' && user.kind === 'anonymous') {
      throw appError_('AUTH_REQUIRED', 'Google でログインするか、管理パスワードを入力してください。');
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
      // ログインの確認と権限の確認は、ロックの中で最新のデータに対してやり直す（パスワード変更・主催者の付け替えと同時に操作された場合に備える）
      if (user.kind === 'staff' || user.kind === 'google') {
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
    // 大会作成は、通信が切れて再送されても作った大会を開けるよう、大会 ID を保存する（サーバー内のみ・10 分）
    var memo = (action === 'createEvent' || action === 'createSampleEvent') && result && result.eventId ? { eventId: result.eventId } : {};
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
