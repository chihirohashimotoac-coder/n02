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
    migrateStorage: { fn: actionMigrateStorage_, scope: 'platform', mutating: true, needsStorage: false },
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
    // v0.8
    previewAdvancement: { fn: actionPreviewAdvancement_, scope: 'event', mutating: false },
    previewBracket: { fn: actionPreviewBracket_, scope: 'event', mutating: false },
    drawNextRound: { fn: actionDrawNextRound_, scope: 'event', mutating: true },
    generateSwissRound: { fn: actionGenerateSwissRound_, scope: 'event', mutating: true },
    deleteSwissRound: { fn: actionDeleteSwissRound_, scope: 'event', mutating: true },
    setNightParticipants: { fn: actionSetNightParticipants_, scope: 'event', mutating: true },
    generateNight: { fn: actionGenerateNight_, scope: 'event', mutating: true },
    clearNight: { fn: actionClearNight_, scope: 'event', mutating: true },
    cancelNight: { fn: actionCancelNight_, scope: 'event', mutating: true },
    updateNight: { fn: actionUpdateNight_, scope: 'event', mutating: true },
    importPlayers: { fn: actionImportPlayers_, scope: 'event', mutating: true },
    previewWithdraw: { fn: actionPreviewWithdraw_, scope: 'event', mutating: false },
    withdrawPlayer: { fn: actionWithdrawPlayer_, scope: 'event', mutating: true },
    reinstatePlayer: { fn: actionReinstatePlayer_, scope: 'event', mutating: true },
    setSchedule: { fn: actionSetSchedule_, scope: 'event', mutating: true },
    postponeMatch: { fn: actionPostponeMatch_, scope: 'event', mutating: true },
    previewWeeklySchedule: { fn: actionPreviewWeeklySchedule_, scope: 'event', mutating: false },
    applyWeeklySchedule: { fn: actionApplyWeeklySchedule_, scope: 'event', mutating: true },
    updateEventSettings: { fn: actionUpdateEventSettings_, scope: 'event', mutating: true },
    duplicateEvent: { fn: actionDuplicateEvent_, scope: 'event', mutating: true },
    addCollaborator: { fn: actionAddCollaborator_, scope: 'event', mutating: true },
    removeCollaborator: { fn: actionRemoveCollaborator_, scope: 'event', mutating: true },
    restoreEvent: { fn: actionRestoreEvent_, scope: 'create', mutating: true },
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 運営画面は GitHub Pages にある。ここを直接開いた人には案内だけを返す。
 * version / release は本番反映の確認用（どの版のコードが動いているか。秘密の情報は含まない）。
 */
function doGet() {
  return jsonOutput_({
    ok: true,
    app: 'n02-tournament-admin-api',
    version: ADMIN_CONFIG.APP_VERSION,
    schema: ADMIN_CONFIG.SCHEMA_VERSION,
    release: RELEASE_ID_,
    message: 'この URL は運営画面（GitHub Pages）から使う API です。',
  });
}

/** 本番反映のときに、反映した正本のコミット（SHA）に置き換わる。手で貼り付けた場合は 'manual' のまま */
var RELEASE_ID_ = 'manual';

/**
 * 運営画面からの API 呼び出し。本文は JSON（Content-Type: text/plain で送る。CORS のプリフライトを避けるため）。
 * request = { action, payload, requestId?, auth?: { session } | { adminKey } }
 * 戻り値  = { ok: true, data } | { ok: false, error: { code, message } }
 */
function doPost(e) {
  var startedAt = Date.now();
  var text = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!text || text.length > ADMIN_CONFIG.MAX_RESTORE_REQUEST_CHARS) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  var request;
  try {
    request = JSON.parse(text);
  } catch (err) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  // 大会ファイルからの復元だけは大きな本文を受け付ける。それ以外の操作は従来どおりの上限
  if (text.length > ADMIN_CONFIG.MAX_REQUEST_CHARS && !(request && request.action === 'restoreEvent')) {
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
var NO_COMPLETION_CHECK_ = [
  'updateEvent', 'updateEventSettings', 'setStaffPassword', 'setOwner', 'addCollaborator', 'removeCollaborator', 'republish', 'renameGroup',
  'updatePlayer', 'setSchedule', 'postponeMatch', 'applyWeeklySchedule', 'updateNight', 'createEvent', 'createSampleEvent', 'duplicateEvent',
  'restoreEvent', 'importPlayers', 'addPlayers', 'deleteEvent', 'reinstatePlayer',
];
var WRITE_JOURNAL_KEY_ = 'WRITE_JOURNAL';

/**
 * 書き込みの途中で止まった操作の目印（スクリプト プロパティ）。書き込みの直前に置き、書き終えたら消す。
 * 残っていれば、前の操作の書き込みが途中で止まった（Google 側のエラー・時間切れ）可能性がある。
 */
function readWriteJournal_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(WRITE_JOURNAL_KEY_) || 'null');
  } catch (e) {
    return null;
  }
}

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
    var props = PropertiesService.getScriptProperties();
    var journal = readWriteJournal_();
    if (journal && journal.key === dedupeKey) {
      // 同じ操作の再送: 前回の書き込みが途中で止まっている可能性があるので、もう一度は実行しない
      throw appError_('PARTIAL_WRITE', '前回の保存が途中で止まった可能性があります。画面を再読み込みして内容を確認してから、必要ならもう一度操作してください。');
    }
    var result;
    if (spec.needsStorage === false) {
      result = spec.fn({ actor: user.label, user: user }, payload);
    } else {
      assertSchemaCurrent_();
      var ctx = contextFor_(user, null);
      if (journal) {
        // 別の操作の書き込みが途中で止まっていた: 記録だけ残して先へ進む（管理者が履歴で確認できる）
        recordHistory_(ctx, 'storage.incompleteWrite', 'Storage', '', journal.eventId || '', null, { action: journal.action, at: journal.at, actor: journal.actor });
        props.deleteProperty(WRITE_JOURNAL_KEY_);
      }
      // ログインの確認と権限の確認は、ロックの中で最新のデータに対してやり直す（パスワード変更・主催者の付け替えと同時に操作された場合に備える）
      if (user.kind === 'staff' || user.kind === 'google') {
        user = authenticate_(function () {
          return ctx;
        }, auth);
        ctx.user = user;
      }
      if (spec.scope === 'event') authorizeEventPayload_(ctx, payload);
      // 自動終了（F05）の判定は、試合・組み合わせ・段階が変わりうる操作の後だけ（大会設定の保存などでは判定しない）
      ctx.touchedResults = NO_COMPLETION_CHECK_.indexOf(action) === -1;
      result = spec.fn(ctx, payload) || {};
      var eventIds = [];
      if (result.eventId) eventIds.push(result.eventId);
      (result.alsoPublish || []).forEach(function (id) {
        if (eventIds.indexOf(id) === -1) eventIds.push(id);
      });
      delete result.alsoPublish;
      eventIds.forEach(function (id) {
        afterEventChange_(ctx, id);
      });
      flushHistory_(ctx);
      // 公開データも書き込む前に組み立てる。大きすぎるときは何も保存せずに止める（保存してから気づくことがないように）
      var publications = {};
      eventIds.forEach(function (id) {
        try {
          publications[id] = syncPublication_(ctx, id);
        } catch (e) {
          if (e && e.appCode === 'TOO_LARGE') throw e;
          // 公開データを作る処理の思わぬ失敗では、操作そのものは保存する（結果の入力を止めない）。
          // 閲覧ページへの反映は「公開データを再生成」でやり直せる
          console.error('syncPublication_ failed', id, e && e.message);
          publications[id] = { published: false, failed: true, message: (e && e.publicMessage) || '公開データを書き込めませんでした' };
        }
      });
      props.setProperty(WRITE_JOURNAL_KEY_, JSON.stringify({ key: dedupeKey, action: action, eventId: result.eventId || '', at: ctx.now, actor: user.label }));
      commitContext_(ctx);
      if (result.eventId) {
        result.publication = publications[result.eventId];
        result.detail = eventDetail_(ctx, result.eventId);
      }
      delete result.forceRepublish;
    }
    SpreadsheetApp.flush();
    // 大会作成は、通信が切れて再送されても作った大会を開けるよう、大会 ID を保存する（サーバー内のみ・10 分）
    var memo = (action === 'createEvent' || action === 'createSampleEvent' || action === 'duplicateEvent' || action === 'restoreEvent') && result && result.eventId ? { eventId: result.eventId } : {};
    cache.put(dedupeKey, JSON.stringify(memo), ADMIN_CONFIG.REQUEST_DEDUPE_TTL_SEC);
    props.deleteProperty(WRITE_JOURNAL_KEY_);
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
