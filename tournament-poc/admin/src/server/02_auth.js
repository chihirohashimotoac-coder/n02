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
