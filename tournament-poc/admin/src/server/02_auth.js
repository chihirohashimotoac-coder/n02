/* 認証と認可（すべてサーバー側で判定する）
 *
 * - 主催者: Google アカウントでログインする。運営画面（GitHub Pages）が Google Identity Services で受け取った
 *   ID トークンを送り、ここで Google の tokeninfo に問い合わせて確かめる（宛先 aud = スクリプト プロパティ
 *   GOOGLE_CLIENT_ID・発行元・有効期限・メール確認済み）。大会を作った Google アカウント（owner_email）だけが、
 *   その大会を運営できる。誰でも大会を作れる（上限あり）
 * - 店舗スタッフ: 主催者が大会ごとに設定した「管理パスワード」でその大会だけを運営できる。
 *   シートには乱数のソルト付き SHA-256 だけを保存する。間違いが続いたら一定時間止める
 * - ログインに成功したら推測できない長さのセッション（244 ビット相当の乱数）を発行し、以後はそれで呼ぶ。
 *   セッションはサーバーのキャッシュ（CacheService）にだけ置き、6 時間で切れる。管理パスワードを変えると、
 *   そのパスワードで作ったセッションは使えなくなる
 * - プラットフォーム管理者は、スクリプト プロパティ ADMIN_KEY（利用者が設定する長い文字列）を知っている人。
 *   保存先の設定・初期化・閲覧者用 URL・既定表示の大会、全大会の管理と主催者の付け替えができる
 *
 * この Web アプリは「実行: 自分 / アクセス: 全員」で公開するため、呼び出し元は一切信用しない。
 */

var MIN_SECRET_LENGTH_ = 24;
var SESSION_PATTERN_ = /^[a-f0-9]{64}$/;
var SESSION_TTL_SEC_ = 6 * 3600;
var ID_TOKEN_PATTERN_ = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
var ID_TOKEN_MAX_LENGTH_ = 4096;
var GOOGLE_ISSUERS_ = ['accounts.google.com', 'https://accounts.google.com'];
var EMAIL_PATTERN_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var STAFF_PASSWORD_MIN_ = 8;
var STAFF_PASSWORD_MAX_ = 64;
var STAFF_FAIL_LIMIT_ = 10;
var STAFF_FAIL_WINDOW_SEC_ = 600;

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

/** 推測できない乱数（16 進 64 文字。UUID v4 2 つ分 = 244 ビット） */
function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function readSecretProperty_(name) {
  var v = (PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  return v.length >= MIN_SECRET_LENGTH_ ? v : '';
}

function googleClientId_() {
  return (PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim();
}

function normalizeEmail_(value) {
  var v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v.length <= 254 && EMAIL_PATTERN_.test(v) ? v : '';
}

/* ---------- Google ログイン ---------- */

/**
 * Google の ID トークンを確かめ、ログインした人のメールアドレス（小文字）を返す。
 * 署名の検証は Google の tokeninfo エンドポイントに任せる（Apps Script では Google の検証ライブラリを使えないため）。
 */
function verifyGoogleIdToken_(token) {
  var clientId = googleClientId_();
  if (!clientId) {
    throw appError_('AUTH_NOT_CONFIGURED', 'Google ログインが未設定です（スクリプト プロパティ GOOGLE_CLIENT_ID に OAuth クライアント ID を設定してください）。');
  }
  if (typeof token !== 'string' || token.length > ID_TOKEN_MAX_LENGTH_ || !ID_TOKEN_PATTERN_.test(token)) {
    throw appError_('AUTH_INVALID', 'Google のログイン情報が正しくありません。もう一度ログインしてください。');
  }
  var res;
  try {
    res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    console.error('tokeninfo fetch failed', e && e.message);
    throw appError_('UNAVAILABLE', 'Google に接続できませんでした。時間をおいてもう一度お試しください。');
  }
  var claims = null;
  if (res.getResponseCode() === 200) {
    try {
      claims = JSON.parse(res.getContentText());
    } catch (e) {
      claims = null;
    }
  }
  var nowSec = Math.floor(Date.now() / 1000);
  var ok =
    claims &&
    claims.aud === clientId &&
    GOOGLE_ISSUERS_.indexOf(claims.iss) >= 0 &&
    Number(claims.exp) > nowSec &&
    (claims.email_verified === true || claims.email_verified === 'true');
  var email = ok ? normalizeEmail_(claims.email) : '';
  if (!email) {
    throw appError_('AUTH_INVALID', 'Google のログイン情報を確認できませんでした。もう一度ログインしてください。');
  }
  return email;
}

/* ---------- セッション ---------- */

function sessionCacheKey_(session) {
  return 'sess:' + sha256Hex_('n02-tournament-session:' + session);
}

/** data = { kind: 'google', email } | { kind: 'staff', eventId, passStamp } */
function issueSession_(data) {
  var session = newSecret_();
  var expiresAt = new Date(Date.now() + SESSION_TTL_SEC_ * 1000).toISOString();
  var stored = Object.assign({}, data, { expiresAt: expiresAt });
  CacheService.getScriptCache().put(sessionCacheKey_(session), JSON.stringify(stored), SESSION_TTL_SEC_);
  return { session: session, expiresAt: expiresAt };
}

function readSession_(session) {
  if (typeof session !== 'string' || !SESSION_PATTERN_.test(session)) return null;
  var raw = CacheService.getScriptCache().get(sessionCacheKey_(session));
  if (!raw) return null;
  try {
    var data = JSON.parse(raw);
    return data && Date.parse(data.expiresAt) > Date.now() ? data : null;
  } catch (e) {
    return null;
  }
}

function endSession_(session) {
  if (typeof session === 'string' && SESSION_PATTERN_.test(session)) CacheService.getScriptCache().remove(sessionCacheKey_(session));
}

/* ---------- 管理パスワード（店舗スタッフ用） ---------- */

function staffPasswordHash_(eventId, salt, password) {
  return sha256Hex_('n02-tournament-staff:' + eventId + ':' + salt + ':' + password);
}

function validateStaffPassword_(password) {
  if (typeof password !== 'string' || password.length < STAFF_PASSWORD_MIN_ || password.length > STAFF_PASSWORD_MAX_ || /\s/.test(password)) {
    throw appError_('VALIDATION', '管理パスワードは空白を含まない ' + STAFF_PASSWORD_MIN_ + '〜' + STAFF_PASSWORD_MAX_ + ' 文字で設定してください。');
  }
  return password;
}

/** 今の管理パスワードの目印（設定のたびに変わるソルトから作る）。セッションに入れ、変更後の古いセッションを見分ける */
function staffPassStamp_(event) {
  return sha256Hex_('n02-tournament-stamp:' + event.staff_pass_salt).slice(0, 32);
}

function staffFailKey_(eventId) {
  return 'staff-fail:' + eventId;
}

/**
 * 管理パスワードを確かめる。同じ大会で間違いが続いたら、しばらく受け付けない（総当たり対策）。
 * 大会が存在するかどうかを推測されないよう、理由は区別しない。
 */
function verifyStaffPassword_(ctx, eventId, password) {
  if (!isValidId_(eventId) || typeof password !== 'string' || !password || password.length > STAFF_PASSWORD_MAX_) {
    throw appError_('AUTH_INVALID', '大会または管理パスワードが違います。');
  }
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get(staffFailKey_(eventId)) || 0);
  if (fails >= STAFF_FAIL_LIMIT_) {
    throw appError_('AUTH_LOCKED', '管理パスワードの間違いが続いたため、10 分間この大会はパスワードで開けません。時間をおいてお試しください。');
  }
  var events = ctx.table('Events');
  var event = events.byKey[eventId];
  var matched =
    event &&
    !events.duplicates[eventId] &&
    event.staff_pass_hash &&
    event.staff_pass_salt &&
    safeEqual_(staffPasswordHash_(eventId, event.staff_pass_salt, password), event.staff_pass_hash);
  if (!matched) {
    cache.put(staffFailKey_(eventId), String(fails + 1), STAFF_FAIL_WINDOW_SEC_);
    throw appError_('AUTH_INVALID', '大会または管理パスワードが違います。');
  }
  return event;
}

/* ---------- 利用者の判定 ---------- */

/**
 * リクエストの auth から利用者を決める。
 * auth = { adminKey } | { session } | なし
 * 戻り値 = { kind: 'admin' | 'google' | 'staff' | 'anonymous', isPlatformAdmin, email, eventId, label }
 */
function authenticate_(ctxProvider, auth) {
  var a = auth && typeof auth === 'object' && !Array.isArray(auth) ? auth : {};
  if (a.adminKey !== undefined) {
    var adminKey = readSecretProperty_('ADMIN_KEY');
    if (!adminKey) throw appError_('AUTH_NOT_CONFIGURED', '管理者の鍵が未設定です（スクリプト プロパティ ADMIN_KEY に 24 文字以上の文字列を設定してください）。');
    if (typeof a.adminKey !== 'string' || !safeEqual_(sha256Hex_(a.adminKey), sha256Hex_(adminKey))) {
      throw appError_('AUTH_INVALID', '管理者の鍵が違います。');
    }
    return { kind: 'admin', isPlatformAdmin: true, email: '', eventId: '', label: 'admin' };
  }
  if (a.session !== undefined) {
    var data = readSession_(a.session);
    if (data && data.kind === 'google' && normalizeEmail_(data.email)) {
      return { kind: 'google', isPlatformAdmin: false, email: data.email, eventId: '', label: 'google:' + data.email };
    }
    if (data && data.kind === 'staff' && isValidId_(data.eventId)) {
      // 管理パスワードが変わった・消された後は、古いパスワードで作ったセッションを使えなくする
      var event = ctxProvider().table('Events').byKey[data.eventId];
      if (event && event.staff_pass_hash && safeEqual_(staffPassStamp_(event), data.passStamp)) {
        return { kind: 'staff', isPlatformAdmin: false, email: '', eventId: data.eventId, label: 'staff:' + data.eventId };
      }
    }
    throw appError_('AUTH_EXPIRED', 'ログインの有効期限が切れたか、管理パスワードが変更されました。もう一度ログインしてください。');
  }
  return { kind: 'anonymous', isPlatformAdmin: false, email: '', eventId: '', label: 'anonymous' };
}

function assertPlatformAdmin_(user) {
  if (!user || !user.isPlatformAdmin) throw appError_('FORBIDDEN', 'この操作は管理者だけが行えます。');
}

/** 大会の作成は、Google でログインした人（と管理者）だけ */
function assertCanCreate_(user) {
  if (user.isPlatformAdmin || user.kind === 'google') return;
  throw appError_('AUTH_REQUIRED', '大会を作るには、Google でログインしてください。');
}

/** その大会を運営できるか（管理者・作った本人・その大会の管理パスワードでログインした人） */
function canManageEvent_(user, event) {
  if (!user || !event) return false;
  if (user.isPlatformAdmin) return true;
  if (user.kind === 'google') return !!event.owner_email && event.owner_email === user.email;
  if (user.kind === 'staff') return user.eventId === event.event_id;
  return false;
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
  var events = ctx.table('Events');
  if (!canManageEvent_(user, events.duplicates[eventId] ? null : events.byKey[eventId])) {
    // 他の大会の存在を知らせないよう「見つからない」と同じ扱いにする
    throw appError_('NOT_FOUND', '大会が見つからないか、この大会を管理する権限がありません。');
  }
  findRecord_(events, eventId, '大会');
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
