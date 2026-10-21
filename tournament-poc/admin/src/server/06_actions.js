/* 運営用 API の各操作。doPost から、認証・認可・ロック・二重送信チェックの後に呼ばれる。 */

var SAMPLE_GROUP_COUNT_ = 4;
var SAMPLE_PLAYER_COUNT_ = 16;
var MAX_BATCH_RESULTS_ = 64;

/* ---------- 読み取り ---------- */

/**
 * 画面の初期表示に必要な情報。誰が呼んだかで返す範囲を変える。
 * - 未認証: 保存先の準備ができているか・Google ログインの設定があるか・閲覧者用 URL だけ
 * - Google でログインした主催者: 自分が作った大会
 * - 管理パスワードでログインしたスタッフ: その大会 1 件
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
      return canManageEvent_(user, e);
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
        ownerEmail: user.isPlatformAdmin ? e.owner_email : undefined,
        staffPasswordSet: user.kind === 'staff' ? undefined : !!e.staff_pass_hash,
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
    role: { kind: user.kind, isPlatformAdmin: user.isPlatformAdmin, email: user.email, eventId: user.eventId },
    googleLoginReady: !!googleClientId_(),
    storage: storage,
    events: events,
    viewerUrl: props.getProperty('VIEWER_URL') || '',
  };
}

/**
 * ポータルの「作成した大会」: Google でログインした本人が作った大会だけを、公開・非公開・状態を問わず返す。
 * 絞り込みはサーバーのセッション（ログインで確かめたメールアドレス）と各大会の owner_email で行い、
 * 送られてきたメールアドレスや大会 ID は使わない。返すのは一覧の要約（公開データと同じ範囲）と公開状態だけ。
 */
function actionMyEvents_(ctx) {
  var user = ctx.user;
  var events = ctx.table('Events');
  var mine = events.rows
    .filter(function (e) {
      return !events.duplicates[e.event_id] && user.kind === 'google' && canManageEvent_(user, e);
    })
    .sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  var list = mine.slice(0, ADMIN_CONFIG.MAX_MY_EVENTS).map(function (e) {
    var s = summarizeEventView_(buildEventView_(collectEvent_(ctx, e.event_id), false), '');
    if (String(e.updated_at || '') > s.updatedAt) s.updatedAt = String(e.updated_at || '');
    s.isPublic = !!e.is_public;
    s.isSample = !!e.is_sample;
    return s;
  });
  return { email: user.email, events: list, truncated: mine.length > list.length };
}

function actionEventDetail_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  return eventDetail_(ctx, eventId);
}

/** 呼び出し元が最新の内容を読み込んだ ctx を渡す（書き込み後は syncPublication_ が読み直している） */
function eventDetail_(ctx, eventId) {
  var bundle = collectEvent_(ctx, eventId);
  var view = buildEventView_(bundle, true);
  // 主催者の Google アカウントは、本人と管理者にだけ見せる（店舗スタッフには出さない）
  if (!ctx.user || ctx.user.kind === 'staff') delete view.event.ownerEmail;
  view.event.canChangePassword = !!ctx.user && ctx.user.kind !== 'staff';
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
    owner_email: input.ownerEmail || '',
    staff_pass_hash: '',
    staff_pass_salt: '',
    staff_pass_set_at: '',
    notes: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), rules);
  appendRecords_(ctx.table('Stages'), stages);
  appendRecords_(ctx.table('Groups'), groups);
  ctx.invalidate();
  recordHistory_(ctx, 'event.create', 'Event', eventId, eventId, null, {
    event: eventForLog_(event),
    template: template,
    stages: stages.length,
    groups: groups.length,
    by: ctx.user ? ctx.user.label : '',
  });
  return { event: event, rules: rules, stages: stages, groups: groups };
}

/** 履歴に残す大会レコード（パスワードのハッシュ・ソルトは残さない） */
function eventForLog_(event) {
  var out = plain_(event);
  delete out.admin_key_hash;
  delete out.staff_pass_hash;
  delete out.staff_pass_salt;
  return out;
}

/** 大会作成の権限（Google ログイン）と上限（全体の大会数・1 時間あたりの作成数）。管理者は対象外 */
function assertCreateAllowed_(ctx) {
  assertCanCreate_(ctx.user);
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
  var mine = bucket + ':' + sha256Hex_(ctx.user.email);
  var myCount = Number(cache.get(mine) || 0);
  if (myCount >= ADMIN_CONFIG.MAX_CREATES_PER_USER_HOUR) {
    throw appError_('LIMIT', '1 時間に作れる大会の数（' + ADMIN_CONFIG.MAX_CREATES_PER_USER_HOUR + '）を超えました。しばらくしてからお試しください。');
  }
  // 書き込みはスクリプトロックの中なので、数え間違いは起きない
  cache.put(bucket, String(count + 1), 3600);
  cache.put(mine, String(myCount + 1), 3600);
}

/** 作った大会の主催者（Google でログインしていればその人。管理者が作った大会は主催者なし） */
function creatorEmail_(ctx) {
  return ctx.user && ctx.user.kind === 'google' ? ctx.user.email : '';
}

function parseAdvanceCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value === undefined ? '2' : value);
  if (!isPositiveInt_(n) || n > 16) throw appError_('VALIDATION', '進出する順位は 1〜16 で指定してください。');
  return n;
}

function actionCreateEvent_(ctx, payload) {
  assertCreateAllowed_(ctx);
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
    ownerEmail: creatorEmail_(ctx),
  });
  return { eventId: created.event.event_id };
}

/* ---------- ログイン ---------- */

/** Google でログイン: ID トークンを確かめてセッションを発行する */
function actionLogin_(ctx, payload) {
  // ログインのたびに Google（tokeninfo）へ問い合わせるので、大量の呼び出しで外部通信の割り当てを使い切られないよう全体で上限を設ける
  var cache = CacheService.getScriptCache();
  var bucket = 'logins:' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(bucket) || 0);
  if (count >= ADMIN_CONFIG.MAX_LOGINS_PER_MINUTE) {
    throw appError_('LIMIT', 'ログインが混み合っています。1 分ほどしてからもう一度お試しください。');
  }
  cache.put(bucket, String(count + 1), 120);
  var email = verifyGoogleIdToken_(payload.idToken);
  var issued = issueSession_({ kind: 'google', email: email });
  return { session: issued.session, expiresAt: issued.expiresAt, email: email };
}

/** 店舗スタッフ: 大会と管理パスワードを確かめてセッションを発行する */
function actionStaffLogin_(ctx, payload) {
  var event = verifyStaffPassword_(ctx, payload.eventId, payload.password);
  var issued = issueSession_({ kind: 'staff', eventId: event.event_id, passStamp: staffPassStamp_(event) });
  return { session: issued.session, expiresAt: issued.expiresAt, eventId: event.event_id };
}

function actionLogout_(ctx, payload) {
  endSession_(payload.session);
  return { loggedOut: true };
}

/** 管理パスワードの設定・変更・解除（大会を作った本人と管理者だけ。変えると古いパスワードのセッションは切れる） */
function actionSetStaffPassword_(ctx, payload) {
  assertNotStaff_(ctx, '管理パスワードの変更');
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  if (payload.password === '' || payload.password === null) {
    event.staff_pass_hash = '';
    event.staff_pass_salt = '';
    event.staff_pass_set_at = '';
  } else {
    var password = validateStaffPassword_(payload.password);
    event.staff_pass_salt = newSecret_().slice(0, 32);
    event.staff_pass_hash = staffPasswordHash_(eventId, event.staff_pass_salt, password);
    event.staff_pass_set_at = ctx.now;
  }
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  CacheService.getScriptCache().remove(staffFailKey_(eventId));
  recordHistory_(ctx, event.staff_pass_hash ? 'event.setStaffPassword' : 'event.clearStaffPassword', 'Event', eventId, eventId, null, { at: ctx.now, by: ctx.user.label });
  return { eventId: eventId };
}

/** 大会の主催者（Google アカウント）を付け替える（管理者のみ。v0.4 以前に作った大会や、主催者の交代に使う） */
function actionSetOwner_(ctx, payload) {
  assertPlatformAdmin_(ctx.user);
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var email = '';
  if (payload.ownerEmail !== '' && payload.ownerEmail !== null && payload.ownerEmail !== undefined) {
    email = normalizeEmail_(payload.ownerEmail);
    if (!email) throw appError_('VALIDATION', '主催者の Google アカウント（メールアドレス）を正しく入力してください。');
  }
  var before = event.owner_email;
  event.owner_email = email;
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  recordHistory_(ctx, 'event.setOwner', 'Event', eventId, eventId, { owner_email: before }, { owner_email: email });
  return { eventId: eventId };
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
  recordHistory_(ctx, 'event.update', 'Event', eventId, eventId, eventForLog_(before), eventForLog_(event));
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

/* ---------- 大会の削除（アーカイブ） ---------- */

/** 大会に属する行を持つシート（Events・PublicSnapshots 以外） */
var EVENT_CHILD_TABLES_ = ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'History'];

/** 削除・パスワードなどの設定は、大会を作った本人と管理者だけ（店舗スタッフは不可） */
function assertNotStaff_(ctx, what) {
  if (ctx.user.kind === 'staff') throw appError_('FORBIDDEN', what + 'は、大会を作った本人（Google ログイン）か管理者だけが行えます。');
}

/**
 * 大会の全データ（保存用）。各シートの行をそのまま入れ、閲覧ページと同じ形の結果（順位表・トーナメント表）も添える。
 * 管理パスワードのハッシュ・ソルトなどの秘密は含めない。
 */
function eventArchive_(ctx, eventId) {
  var event = findRecord_(ctx.table('Events'), eventId, '大会');
  var tables = {};
  EVENT_CHILD_TABLES_.forEach(function (name) {
    tables[name] = ctx.table(name).rows
      .filter(function (r) {
        return r.event_id === eventId;
      })
      .map(plain_);
  });
  return {
    format: 'n02-tournament-archive',
    formatVersion: 1,
    appVersion: ADMIN_CONFIG.APP_VERSION,
    exportedAt: ctx.now,
    exportedBy: ctx.user ? ctx.user.label : '',
    event: eventForLog_(event),
    tables: tables,
    results: buildPublicSnapshot_(collectEvent_(ctx, eventId)),
  };
}

function actionExportEvent_(ctx, payload) {
  assertNotStaff_(ctx, '大会データの保存');
  return eventArchive_(ctx, requireId_(payload.eventId, '大会'));
}

/**
 * 大会の削除。確認のため大会名の入力が必要。
 * 途中で止まっても再実行できるよう、公開データ → 大会に属する行 → 大会の行 の順に消す（大会の行が残っていれば、もう一度削除できる）。
 * 削除したことは履歴（大会に属さない行）に残すが、大会の中身は残さない。
 */
function actionDeleteEvent_(ctx, payload) {
  assertNotStaff_(ctx, '大会の削除');
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var typed = typeof payload.confirmName === 'string' ? payload.confirmName.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (typed !== event.name) throw appError_('VALIDATION', '確認のため、大会名「' + event.name + '」を正しく入力してください。');

  var counts = {};
  ['PublicSnapshots'].concat(EVENT_CHILD_TABLES_).forEach(function (name) {
    var table = ctx.table(name);
    var rows = table.rows.filter(function (r) {
      return r.event_id === eventId;
    });
    counts[name] = rows.length;
    deleteRecords_(table, rows);
    ctx.invalidate(name);
  });
  deleteRecords_(events, events.rows.filter(function (e) {
    return e.event_id === eventId;
  }));
  ctx.invalidate();
  recordHistory_(ctx, 'event.delete', 'Event', eventId, '', null, {
    eventId: eventId,
    name: event.name,
    ownerEmail: event.owner_email,
    createdAt: event.created_at,
    deletedRows: counts,
    by: ctx.user.label,
  });
  // eventId を返すと、削除後に公開データの同期・詳細の再読み込みが走るので、別の名前で返す
  return { deletedEventId: eventId, deletedName: event.name };
}

/* ---------- サンプル ---------- */

/**
 * 検証用サンプル: 16 名・4 人 × 4 グループのロビン、Best of 5 Legs（暫定）。
 * 選手名は架空の「サンプル選手01〜16」。結果は表示確認用に、確定・進行中・未開始を混ぜて入れる。
 */
function actionCreateSampleEvent_(ctx, payload) {
  assertCreateAllowed_(ctx);
  var publish = payload.publish === true;
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: 'サンプル大会（PoC 検証用）',
    dateLabel: '日付未定',
    rule: { format: 'legs', bestOf: 5, setBestOf: null, provisional: true },
    template: 'robin',
    groupCount: SAMPLE_GROUP_COUNT_,
    isSample: true,
    ownerEmail: creatorEmail_(ctx),
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
