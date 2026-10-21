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
      return canManageEvent_(user, e, c);
    }).map(function (e) {
      // 不戦（スイス式の Bye の記録）は試合に数えない（閲覧ページ・ポータルの数え方と同じ）
      var ms = matches.filter(function (m) {
        return m.event_id === e.event_id && m.result_type !== RESULT_TYPE.BYE;
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
        role: eventRole_(user, e, c),
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
      return !events.duplicates[e.event_id] && user.kind === 'google' && canManageEvent_(user, e, ctx);
    })
    .sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  var list = mine.slice(0, ADMIN_CONFIG.MAX_MY_EVENTS).map(function (e) {
    var s = summarizeEventView_(buildEventView_(collectEvent_(ctx, e.event_id), false), '');
    if (String(e.updated_at || '') > s.updatedAt) s.updatedAt = String(e.updated_at || '');
    s.isPublic = !!e.is_public;
    s.isSample = !!e.is_sample;
    s.role = eventRole_(user, e, ctx);
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
  var role = eventRole_(ctx.user, bundle.event, ctx);
  // 主催者の Google アカウントは、本人と管理者にだけ見せる（店舗スタッフ・共同主催者には出さない）
  if (role !== 'owner' && role !== 'admin') delete view.event.ownerEmail;
  view.event.role = role;
  view.event.canChangePassword = role === 'owner' || role === 'admin';
  view.event.canManageCollaborators = role === 'owner' || role === 'admin';
  if (view.event.canManageCollaborators) {
    view.collaborators = ctx.table('Collaborators').rows
      .filter(function (r) {
        return r.event_id === eventId;
      })
      .map(function (r) {
        return { id: r.collab_id, email: r.email, role: r.role || 'editor', addedAt: r.created_at, rev: r.rev || 0 };
      });
  }
  view.snapshotBudget = snapshotBudget_(bundle);
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

/**
 * 初期化。空の保存先にはシート・列を作る。v0.7 までのデータがある保存先では、
 * バックアップを取ってから列を足す移行（migrateStorage_）を行う。
 */
function actionInitializeStorage_(ctx) {
  var ss = openStorage_();
  var status = getStorageStatus_();
  if (status.initialized && status.migrationRequired) return actionMigrateStorage_(ctx);
  var result = initializeStorage_(ss);
  var c = createContext_(ss, ctx.actor, ctx.user);
  recordHistory_(c, 'storage.initialize', 'Storage', '', '', null, result);
  flushHistory_(c);
  commitContext_(c);
  var boot = actionBootstrap_(ctx);
  boot.initializeResult = result;
  return boot;
}

/** 保存先の移行（管理者の鍵のみ。本番反映の手順からも呼ぶ）。結果は履歴にも残す */
function actionMigrateStorage_(ctx) {
  var ss = openStorage_();
  var result = migrateStorage_(ss, ctx.actor);
  if (result.migrated) {
    var c = createContext_(ss, ctx.actor, ctx.user);
    recordHistory_(c, 'storage.migrate', 'Storage', '', '', null, result);
    flushHistory_(c);
    commitContext_(c);
  }
  var boot = actionBootstrap_(ctx);
  boot.migrateResult = result;
  boot.migration = migrationState_();
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

/** 画面から送られたルール。{ format: 'legs' | 'sets' | 'fixed', bestOf, setBestOf, provisional }（fixed の bestOf は Leg 数） */
function parseRuleInput_(input) {
  var src = input && typeof input === 'object' ? input : {};
  var format = src.format === 'sets' ? 'sets' : src.format === 'fixed' ? 'fixed' : 'legs';
  var bestOf;
  if (format === 'fixed') {
    bestOf = typeof src.bestOf === 'number' ? src.bestOf : parseNonNegativeInt_(src.bestOf);
    if (!isValidFixedLegs_(bestOf)) throw appError_('VALIDATION', '固定 Leg 数は 1〜' + ADMIN_CONFIG.BEST_OF_MAX + ' で指定してください。');
  } else {
    bestOf = parseBestOf_(src.bestOf, format === 'sets' ? 'セット数の Best of' : 'Best of');
  }
  return {
    format: format,
    bestOf: bestOf,
    setBestOf: format === 'sets' ? parseBestOf_(src.setBestOf, '1 セットの Best of') : null,
    provisional: src.provisional === undefined ? true : requireBool_(src.provisional, '暫定ルール'),
  };
}

function ruleName_(spec, provisional) {
  var base =
    spec.format === 'sets'
      ? 'Best of ' + spec.bestOf + ' セット（各セット Best of ' + spec.setBestOf + ' Legs）'
      : spec.format === 'fixed'
        ? '固定 ' + spec.bestOf + ' Legs（引き分けあり）'
        : 'Best of ' + spec.bestOf + ' Legs';
  return base + (provisional ? '（暫定）' : '');
}

function applyRule_(rule, spec, now) {
  rule.format = spec.format === 'sets' ? RULE_FORMAT.BEST_OF_SETS : spec.format === 'fixed' ? RULE_FORMAT.FIXED_LEGS : RULE_FORMAT.BEST_OF_LEGS;
  rule.best_of = spec.bestOf;
  rule.set_best_of = spec.format === 'sets' ? spec.setBestOf : null;
  rule.is_provisional = spec.provisional;
  rule.name = ruleName_(spec, spec.provisional);
  rule.notes = spec.provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '';
  rule.updated_at = now;
}

function ruleSpecOf_(rule) {
  var sets = rule.format === RULE_FORMAT.BEST_OF_SETS;
  var fixed = rule.format === RULE_FORMAT.FIXED_LEGS;
  return { format: sets ? 'sets' : fixed ? 'fixed' : 'legs', bestOf: rule.best_of, setBestOf: sets ? rule.set_best_of : null, provisional: rule.is_provisional };
}

function newRuleRecord_(ctx, eventId, spec, taken) {
  var id = newId_('RUL', taken);
  taken[id] = true;
  var rule = { rule_id: id, event_id: eventId, rev: 1, created_at: ctx.now };
  applyRule_(rule, spec, ctx.now);
  return rule;
}

/* ---------- 段階の作成 ---------- */

/** 作成時のひな形（定義は shared/formats.js。ここは ID の一覧と、段階の組み立て） */
var TEMPLATES_ = {};
TOURNAMENT_FORMATS.forEach(function (f) {
  TEMPLATES_[f.id] = f.label;
});

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

/** グループの既定の名前（ロビン: グループA… / リーグ: リーグ・ディビジョン1… / シリーズ: 第1節… / スイス式: スイス式） */
function defaultGroupName_(type, index, count) {
  if (type === STAGE_TYPE.LEAGUE) return count > 1 ? 'ディビジョン' + (index + 1) : 'リーグ';
  if (type === STAGE_TYPE.SERIES) return '第' + (index + 1) + '節';
  if (type === STAGE_TYPE.SWISS) return 'スイス式';
  return groupLabel_(index);
}

function newGroupRecords_(ctx, eventId, stageId, count, taken, startIndex, typeOrLeague, total) {
  var type = typeOrLeague === true ? STAGE_TYPE.LEAGUE : typeOrLeague === false || !typeOrLeague ? STAGE_TYPE.ROUND_ROBIN : typeOrLeague;
  var out = [];
  for (var i = 0; i < count; i++) {
    var gid = newId_('GRP', taken);
    taken[gid] = true;
    out.push({
      group_id: gid,
      event_id: eventId,
      stage_id: stageId,
      name: defaultGroupName_(type, (startIndex || 0) + i, total || count),
      order: (startIndex || 0) + i + 1,
      meta_json: '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
  return out;
}

/**
 * 大会・段階・ルール・グループをひな形どおりに作る。
 * input = { name, dateLabel, organizerName, rule, template, groupCount, advanceCount, groupCount2, advanceCount2, thirdPlace, cycles,
 *           divisions, playoff, points, nights, nightPoints, swissRounds, grandFinal, isSample }
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
  var addGroups = function (stage, count) {
    groups = groups.concat(newGroupRecords_(ctx, eventId, stage.stage_id, count, groupTaken, 0, stage.type, count));
  };
  var setConfig = function (stage, cfg) {
    stage.config_json = JSON.stringify(cfg);
  };
  var robinConfig = function () {
    return { cycles: input.cycles === 2 ? 2 : 1, tiebreakers: DEFAULT_TIEBREAKERS_.slice() };
  };
  var koConfig = function () {
    return { thirdPlace: !!input.thirdPlace, avoidSameGroup: true };
  };
  // v0.7 までのひな形（robin / robin_ab / elimination / league の 1 ディビジョン）は、作る段階と設定を変えない
  var legacyGroupConfig = robinConfig();
  if (template === 'elimination') {
    addStage('トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
  } else if (template === 'robin' || template === 'robin_ab') {
    var robin = addStage(template === 'robin_ab' ? '予選ロビン' : 'ロビン', STAGE_TYPE.ROUND_ROBIN, legacyGroupConfig);
    addGroups(robin, input.groupCount);
    if (template === 'robin_ab') {
      var a = addStage('A トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      var b = addStage('B トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      var k = input.advanceCount || 2;
      legacyGroupConfig.advancement = [
        { fromRank: 1, toRank: k, targetStageId: a.stage_id },
        { fromRank: k + 1, toRank: 99, targetStageId: b.stage_id },
      ];
      setConfig(robin, legacyGroupConfig);
    }
  } else if (template === 'robin_ko') {
    var pre = addStage('予選ロビン', STAGE_TYPE.ROUND_ROBIN, robinConfig());
    addGroups(pre, input.groupCount);
    var fin = addStage('決勝トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, koConfig());
    var c1 = robinConfig();
    c1.advancement = [{ fromRank: 1, toRank: input.advanceCount || 2, targetStageId: fin.stage_id }];
    setConfig(pre, c1);
  } else if (template === 'double_elimination') {
    addStage('ダブルエリミネーション', STAGE_TYPE.DOUBLE_ELIMINATION, { grandFinal: input.grandFinal === 'single' ? 'single' : 'reset' });
  } else if (template === 'league' || template === 'league_playoff') {
    var D = input.divisions || 1;
    // v0.8 で作るリーグは勝ち点（勝・分・負）で順位を決める（アプリの既定値 2・1・0。主催者が変えられる）
    var lc = { cycles: input.cycles === 2 ? 2 : 1, points: input.points, tiebreakers: DEFAULT_POINTS_TIEBREAKERS_.slice() };
    var league = addStage('リーグ', STAGE_TYPE.LEAGUE, lc);
    addGroups(league, D);
    if (template === 'league_playoff') {
      var po = addStage('プレーオフ', STAGE_TYPE.SINGLE_ELIMINATION, koConfig());
      lc.advancement = [{ fromRank: 1, toRank: Math.max(1, Math.ceil((input.playoff || 4) / D)), targetStageId: po.stage_id }];
      setConfig(league, lc);
    }
  } else if (template === 'multi_robin_ko') {
    var r1 = addStage('予選ロビン', STAGE_TYPE.ROUND_ROBIN, robinConfig());
    addGroups(r1, input.groupCount);
    var r2 = addStage('2 次ロビン', STAGE_TYPE.ROUND_ROBIN, robinConfig());
    addGroups(r2, input.groupCount2 || 2);
    var f2 = addStage('決勝トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, koConfig());
    var a1 = robinConfig();
    a1.advancement = [{ fromRank: 1, toRank: input.advanceCount || 2, targetStageId: r2.stage_id }];
    setConfig(r1, a1);
    var a2 = robinConfig();
    a2.advancement = [{ fromRank: 1, toRank: input.advanceCount2 || 2, targetStageId: f2.stage_id }];
    setConfig(r2, a2);
  } else if (template === 'series_playoff') {
    var series = addStage('ポイントシリーズ', STAGE_TYPE.SERIES, { nights: input.nights || 16, nightPoints: input.nightPoints || [5, 3, 2, 0], tiebreakers: DEFAULT_SERIES_TIEBREAKERS_.slice() });
    addGroups(series, input.nights || 16);
    var spo = addStage('プレーオフ', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
    setConfig(series, { nights: input.nights || 16, nightPoints: input.nightPoints || [5, 3, 2, 0], tiebreakers: DEFAULT_SERIES_TIEBREAKERS_.slice(), advancement: [{ fromRank: 1, toRank: input.playoff || 4, targetStageId: spo.stage_id }] });
  } else if (template === 'swiss') {
    var sc = { rounds: input.swissRounds || 5, points: input.points, tiebreakers: DEFAULT_SWISS_TIEBREAKERS_.slice() };
    var sw = addStage('スイス式', STAGE_TYPE.SWISS, sc);
    addGroups(sw, 1);
    if (input.playoff >= 2) {
      var spo2 = addStage('決勝トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      sc.advancement = [{ fromRank: 1, toRank: input.playoff, targetStageId: spo2.stage_id }];
      setConfig(sw, sc);
    }
  }
  if (input.rule.format === 'fixed') {
    stages.forEach(function (st) {
      if (isBracketStage_(st)) {
        throw appError_('VALIDATION', '固定 Leg 数（引き分けあり）は勝ち抜き戦の段階（' + st.name + '）では使えません。Leg 制・セット制を選ぶか、勝ち抜き戦のない形式にしてください。');
      }
    });
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
    // v0.8 で作る大会: 形式を記録し、全段階が終わったら自動で「終了」にする（既存の大会には付けない）
    config_json: JSON.stringify({ template: template, autoFinish: true, timezone: EVENT_TIMEZONE_DEFAULT_ }),
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), rules);
  appendRecords_(ctx.table('Stages'), stages);
  appendRecords_(ctx.table('Groups'), groups);
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

function parseSmallInt_(value, label, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (n === null || !(n >= min && n <= max) || Math.floor(n) !== n) throw appError_('VALIDATION', label + ' は ' + min + '〜' + max + ' で指定してください。');
  return n;
}

/** 勝・分・負の点 { win, draw, loss }（-99〜99 の整数。勝ち ≧ 引き分け ≧ 負け） */
function parsePoints_(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) throw appError_('VALIDATION', '勝ち点の指定が不正です。');
  var read = function (k, label) {
    var v = value[k];
    var n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : NaN;
    if (!(n >= -99 && n <= 99) || Math.floor(n) !== n) throw appError_('VALIDATION', label + 'の点は -99〜99 の整数で指定してください。');
    return n;
  };
  var p = { win: read('win', '勝ち'), draw: read('draw', '引き分け'), loss: read('loss', '負け') };
  if (!(p.win >= p.draw && p.draw >= p.loss)) throw appError_('VALIDATION', '勝ち点は 勝ち ≧ 引き分け ≧ 負け にしてください。');
  return p;
}

function parseNightPoints_(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw appError_('VALIDATION', '節の順位ポイントは 2〜8 段階で指定してください（優勝・準優勝・準決勝敗退…）。');
  var out = value.map(function (v, i) {
    var n = typeof v === 'number' ? v : parseNonNegativeInt_(v);
    if (n === null || n > 999) throw appError_('VALIDATION', '節の順位ポイント（' + (i + 1) + '番目）は 0〜999 の整数で指定してください。');
    return n;
  });
  for (var i = 1; i < out.length; i++) {
    if (out[i] > out[i - 1]) throw appError_('VALIDATION', '節の順位ポイントは、上の順位ほど高く（同じでもよい）してください。');
  }
  return out;
}

function actionCreateEvent_(ctx, payload) {
  assertCreateAllowed_(ctx);
  var template = TEMPLATES_[payload.template] ? payload.template : 'robin';
  var needsGroups = template === 'robin' || template === 'robin_ab' || template === 'robin_ko' || template === 'multi_robin_ko';
  var hasPlayoff = template === 'league_playoff' || template === 'series_playoff';
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    rule: parseRuleInput_(payload.rule || { format: 'legs', bestOf: payload.bestOf, provisional: payload.provisional }),
    template: template,
    groupCount: needsGroups ? parseGroupCount_(payload.groupCount) : 0,
    advanceCount: template === 'robin_ab' || template === 'robin_ko' || template === 'multi_robin_ko' ? parseAdvanceCount_(payload.advanceCount) : 0,
    groupCount2: template === 'multi_robin_ko' ? parseGroupCount_(payload.groupCount2 === undefined ? 2 : payload.groupCount2) : 0,
    advanceCount2: template === 'multi_robin_ko' ? parseAdvanceCount_(payload.advanceCount2) : 0,
    thirdPlace: payload.thirdPlace === true,
    cycles: payload.cycles === 2 ? 2 : 1,
    divisions: template === 'league' || template === 'league_playoff' ? parseSmallInt_(payload.divisions, 'ディビジョン数', 1, ADMIN_CONFIG.MAX_GROUPS, 1) : 1,
    playoff: hasPlayoff ? parseSmallInt_(payload.playoff, 'プレーオフの人数', 2, 64, 4) : template === 'swiss' ? parseSmallInt_(payload.playoff, '決勝トーナメントの人数', 0, 64, 0) : 0,
    points: parsePoints_(payload.points, { win: 2, draw: 1, loss: 0 }),
    nights: template === 'series_playoff' ? parseSmallInt_(payload.nights, '節の数', 1, ADMIN_CONFIG.MAX_SERIES_NIGHTS, 16) : 0,
    nightPoints: template === 'series_playoff' ? parseNightPoints_(payload.nightPoints, [5, 3, 2, 0]) : null,
    swissRounds: template === 'swiss' ? parseSmallInt_(payload.swissRounds, '回戦数', 1, ADMIN_CONFIG.MAX_SWISS_ROUNDS, 5) : 0,
    grandFinal: payload.grandFinal === 'single' ? 'single' : 'reset',
    ownerEmail: creatorEmail_(ctx),
  });
  if (template === 'swiss' && created.stages.length === 1 && payload.playoff === 1) throw appError_('VALIDATION', '決勝トーナメントの人数は 0（なし）か 2 以上にしてください。');
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
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '管理パスワードの変更');
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
  return { eventId: eventId, alsoPublish: others };
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
    return { player_id: id, event_id: eventId, display_name: name, external_ref: '', notes: '', affiliation: '', rating: '', seed: null, meta_json: '', rev: 1, created_at: ctx.now, updated_at: ctx.now };
  });
  appendRecords_(players, records);
  recordHistory_(ctx, 'player.add', 'Player', '', eventId, null, records.map(plain_));
  return { eventId: eventId, added: records.length };
}

/** 選手の名前と、v0.8 の所属・Rt・シード・非公開メモ（送られた項目だけ変える） */
function actionUpdatePlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var before = plain_(player);
  if (payload.name !== undefined) {
    var name = cleanText_(payload.name, '選手名', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
    var dup = players.rows.some(function (p) {
      return p.event_id === player.event_id && p.player_id !== player.player_id && p.display_name === name;
    });
    if (dup) throw appError_('VALIDATION', '選手名「' + name + '」は既に登録されています。');
    player.display_name = name;
  }
  if (payload.affiliation !== undefined) player.affiliation = parseAffiliation_(payload.affiliation);
  if (payload.rating !== undefined) player.rating = parseRatingInput_(payload.rating);
  if (payload.seed !== undefined) {
    var seed = parseSeedInput_(payload.seed);
    if (seed && players.rows.some(function (p) { return p.event_id === player.event_id && p.player_id !== player.player_id && p.seed === seed; })) {
      throw appError_('VALIDATION', 'シード ' + seed + ' は他の選手に付いています。');
    }
    player.seed = seed;
  }
  if (payload.notes !== undefined) player.notes = cleanText_(payload.notes, 'メモ', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true });
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

function stageKindMatches_(st, kind) {
  if (!kind) return true;
  if (kind === 'group') return isGroupStage_(st);
  if (kind === 'robin') return isRoundRobinStage_(st);
  if (kind === 'elimination') return isEliminationStage_(st);
  if (kind === 'knockout') return st.type === STAGE_TYPE.SINGLE_ELIMINATION || st.type === STAGE_TYPE.DOUBLE_ELIMINATION;
  if (kind === 'assign' || kind === 'rankable') return isGroupStage_(st) || st.type === STAGE_TYPE.SERIES;
  if (kind === 'swiss') return st.type === STAGE_TYPE.SWISS;
  if (kind === 'series') return st.type === STAGE_TYPE.SERIES;
  return true;
}

/** payload.stageId の段階を返す（省略時は最初の段階。kind で種類を限定できる） */
function resolveStage_(bundle, payload, kind) {
  var stage;
  if (payload.stageId !== undefined && payload.stageId !== '') {
    var id = requireId_(payload.stageId, '段階');
    stage = bundle.stageById[id];
    if (!stage) throw appError_('NOT_FOUND', '段階が見つかりません。');
  } else {
    stage = bundle.stages.filter(function (st) {
      return stageKindMatches_(st, kind);
    })[0];
    if (!stage) throw appError_('NOT_FOUND', '対象の段階がありません。');
  }
  if (!stageKindMatches_(stage, kind)) {
    var what = { group: 'ロビン・リーグ・スイス式', robin: 'ロビン・リーグ', elimination: 'トーナメント', knockout: 'トーナメント・ダブルエリミネーション', assign: 'ロビン・リーグ・スイス式・シリーズ', rankable: 'ロビン・リーグ・スイス式・シリーズ', swiss: 'スイス式', series: 'ポイントシリーズ' }[kind];
    throw appError_('BAD_REQUEST', 'この操作は' + what + 'の段階でのみ使えます。');
  }
  return stage;
}

function stageMatchesOf_(bundle, stage) {
  return bundle.matches.filter(function (m) {
    return m.stage_id === stage.stage_id;
  });
}

/**
 * 段階の設定を保存する。stageConfig_ が補った既定値は保存しない（v0.7 の段階に v0.8 の項目を書き足さないため、
 * 送られた cfg のうち、元の config_json にあった項目と、変更した項目だけを書く）
 */
function saveStage_(ctx, stage, cfg, changedKeys) {
  var raw = safeJson_(stage.config_json, {});
  var keys = changedKeys || Object.keys(cfg);
  var defaults = stageConfig_({ type: stage.type, config_json: '' });
  keys.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(raw, k) || JSON.stringify(cfg[k]) !== JSON.stringify(defaults[k]) || changedKeys) raw[k] = cfg[k];
  });
  saveStageRaw_(ctx, stage, raw);
}

function saveStageRaw_(ctx, stage, raw) {
  stage.config_json = JSON.stringify(raw);
  stage.rev = (stage.rev || 0) + 1;
  stage.updated_at = ctx.now;
  updateRecord_(ctx.table('Stages'), stage);
}

/** 段階を追加したときの既定の設定（v0.7 からある種類は従来どおり） */
function defaultStageConfig_(type, nights) {
  if (type === STAGE_TYPE.SINGLE_ELIMINATION) return { thirdPlace: false };
  if (type === STAGE_TYPE.DOUBLE_ELIMINATION) return { grandFinal: 'reset' };
  if (type === STAGE_TYPE.SWISS) return { rounds: 5, points: { win: 2, draw: 1, loss: 0 }, tiebreakers: DEFAULT_SWISS_TIEBREAKERS_.slice() };
  if (type === STAGE_TYPE.SERIES) return { nights: nights, nightPoints: [5, 3, 2, 0], tiebreakers: DEFAULT_SERIES_TIEBREAKERS_.slice() };
  return { cycles: 1, tiebreakers: DEFAULT_TIEBREAKERS_.slice() };
}

function actionAddStage_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (bundle.stages.length >= ADMIN_CONFIG.MAX_STAGES) throw appError_('LIMIT', '段階は ' + ADMIN_CONFIG.MAX_STAGES + ' つまでです。');
  var type = payload.type;
  if (!STAGE_TYPE_LABEL[type]) throw appError_('VALIDATION', '段階の種類が不正です。');
  var name = cleanText_(payload.name || STAGE_TYPE_LABEL[type], '段階の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);
  var baseRule = bundle.rule ? ruleSpecOf_(bundle.rule) : { format: 'legs', bestOf: 5, setBestOf: null, provisional: true };
  // 勝ち抜き戦では引き分けありの固定 Leg 数は使えないので、その場合は Best of 5 Legs で作る（あとで変えられる）
  var bracketType = type === STAGE_TYPE.SINGLE_ELIMINATION || type === STAGE_TYPE.DOUBLE_ELIMINATION || type === STAGE_TYPE.SERIES;
  if (bracketType && baseRule.format === 'fixed') baseRule = { format: 'legs', bestOf: 5, setBestOf: null, provisional: baseRule.provisional };
  var rule = newRuleRecord_(ctx, eventId, baseRule, Object.assign({}, ctx.table('Rules').byKey));
  var order = bundle.stages.reduce(function (mx, st) {
    return Math.max(mx, st.order || 0);
  }, 0) + 1;
  var nights = type === STAGE_TYPE.SERIES ? parseSmallInt_(payload.nights, '節の数', 1, ADMIN_CONFIG.MAX_SERIES_NIGHTS, 8) : 0;
  var config = defaultStageConfig_(type, nights);
  var stage = newStageRecord_(ctx, eventId, { name: name, type: type, order: order, ruleId: rule.rule_id, config: config }, Object.assign({}, ctx.table('Stages').byKey));
  appendRecords_(ctx.table('Rules'), [rule]);
  appendRecords_(ctx.table('Stages'), [stage]);
  if (type !== STAGE_TYPE.SINGLE_ELIMINATION && type !== STAGE_TYPE.DOUBLE_ELIMINATION) {
    var count = type === STAGE_TYPE.SERIES ? nights : 1;
    appendRecords_(ctx.table('Groups'), newGroupRecords_(ctx, eventId, stage.stage_id, count, Object.assign({}, ctx.table('Groups').byKey), 0, type, count));
  }
  recordHistory_(ctx, 'stage.add', 'Stage', stage.stage_id, eventId, null, plain_(stage));
  return { eventId: eventId, stageId: stage.stage_id };
}

function parseTiebreakers_(value, type) {
  var allowed = TIEBREAKERS_FOR_[type] || Object.keys(TIEBREAKERS);
  if (!Array.isArray(value) || value.length > 8) throw appError_('VALIDATION', '順位の決め方の指定が不正です。');
  var seen = {};
  value.forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(TIEBREAKERS, k) || seen[k] || allowed.indexOf(k) === -1) throw appError_('VALIDATION', '順位の決め方の指定が不正です。');
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

/** 進出ルール。v0.8 から進出先にロビン（2 次ロビン）・スイス式・ダブルエリミ・シリーズも選べる */
function parseAdvancement_(value, bundle, stage) {
  if (!Array.isArray(value) || value.length > 8) throw appError_('VALIDATION', '進出ルールの指定が不正です。');
  var rules = value.map(function (r) {
    var from = parseNonNegativeInt_(r && r.fromRank !== undefined ? r.fromRank : '');
    var to = parseNonNegativeInt_(r && r.toRank !== undefined ? r.toRank : '');
    if (!from || !to || from > to || to > 99) throw appError_('VALIDATION', '進出する順位（何位から何位まで）を正しく指定してください。');
    var target = r && isValidId_(r.targetStageId) ? bundle.stageById[r.targetStageId] : null;
    if (!target || target.stage_id === stage.stage_id) throw appError_('VALIDATION', '進出先の段階を選んでください。');
    if (!(target.order > stage.order)) throw appError_('VALIDATION', '進出先には、この段階より後の段階を選んでください。');
    return { fromRank: from, toRank: to, targetStageId: target.stage_id };
  });
  rules.forEach(function (a, i) {
    rules.forEach(function (b, j) {
      if (i < j && a.fromRank <= b.toRank && b.fromRank <= a.toRank) throw appError_('VALIDATION', '進出ルールの順位の範囲が重なっています。');
    });
  });
  return rules;
}

/** 手動の加減点（F14）。[{ playerId, points, reason }]。理由は必須。記録した時刻・操作者を残す */
function parseAdjustments_(value, bundle, stage, before, ctx) {
  if (!Array.isArray(value) || value.length > 64) throw appError_('VALIDATION', '加減点の指定が不正です。');
  var members = {};
  bundle.entries.forEach(function (e) {
    if (e.stage_id === stage.stage_id) members[e.player_id] = true;
  });
  return value.map(function (a, i) {
    var pid = a && isValidId_(a.playerId) && members[a.playerId] ? a.playerId : '';
    if (!pid) throw appError_('VALIDATION', '加減点（' + (i + 1) + '件目）の選手がこの段階にいません。');
    var pts = typeof a.points === 'number' ? a.points : typeof a.points === 'string' && /^[+-]?\d{1,3}$/.test(a.points.trim()) ? Number(a.points.trim()) : NaN;
    if (!(pts >= -999 && pts <= 999) || Math.floor(pts) !== pts || pts === 0) throw appError_('VALIDATION', '加減点（' + (i + 1) + '件目）は 0 以外の整数で指定してください。');
    var reason = cleanText_(a.reason, '加減点（' + (i + 1) + '件目）の理由', ADMIN_CONFIG.MAX_NOTE_LENGTH);
    var same = (before || []).filter(function (b) {
      return b.playerId === pid && b.points === pts && b.reason === reason;
    })[0];
    return { playerId: pid, points: pts, reason: reason, at: same ? same.at : ctx.now, by: same ? same.by : ctx.user ? ctx.user.label : '' };
  });
}

/**
 * 段階の設定を変える。payload の項目は省略可能（送られた項目だけ変更）。
 * 共通: { stageId, rev, name?, rule?, tiebreakers?, advancement?, points?, adjustments?, walkoverLegs? }
 * ロビン・リーグ: cycles?, roundLabels?, distribution?（進出先になったときの配り方）
 * トーナメント: thirdPlace?, roundBestOf?, drawMode?, fixedRounds?, avoidSameGroup?, maxEntrants?
 * ダブルエリミ: grandFinal?  スイス式: rounds?, firstRound?, byePoints?  シリーズ: nights?, nightPoints?, nightDraw?
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
  var changed = [];
  var set = function (key, value) {
    cfg[key] = value;
    changed.push(key);
  };
  var type = stage.type;
  var bracket = isBracketStage_(stage);

  if (payload.name !== undefined) stage.name = cleanText_(payload.name, '段階の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);

  if (payload.rule !== undefined) {
    var rules = ctx.table('Rules');
    var rule = findRecord_(rules, stage.rule_id, 'ルール');
    var spec = parseRuleInput_(payload.rule);
    if (spec.format === 'fixed' && bracket) throw appError_('VALIDATION', '固定 Leg 数（引き分けあり）は勝ち抜き戦の段階では使えません（決着がつかないため）。');
    assertRuleChangeAllowed_(bundle, rule, spec);
    applyRule_(rule, spec, ctx.now);
    rule.rev = (rule.rev || 0) + 1;
    updateRecord_(rules, rule);
  }

  if (payload.tiebreakers !== undefined && (isGroupStage_(stage) || type === STAGE_TYPE.SERIES)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は順位の決め方を変更できません。');
    set('tiebreakers', parseTiebreakers_(payload.tiebreakers, type));
  }
  if (payload.advancement !== undefined && (isGroupStage_(stage) || type === STAGE_TYPE.SERIES)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は進出ルールを変更できません。先に「進出を取り消す」を行ってください。');
    set('advancement', parseAdvancement_(payload.advancement, bundle, stage));
  }
  if (payload.points !== undefined && isGroupStage_(stage)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は勝ち点を変更できません。');
    if (payload.points === null) {
      if (type === STAGE_TYPE.SWISS) throw appError_('VALIDATION', 'スイス式は勝ち点で組み合わせを決めるため、勝ち点なしにはできません。');
      set('points', null);
    } else {
      set('points', parsePoints_(payload.points, null));
    }
  }
  if (payload.adjustments !== undefined && isGroupStage_(stage)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は加減点を変更できません。');
    if (!cfg.points && payload.adjustments.length) throw appError_('VALIDATION', '加減点は勝ち点を使う段階でだけ設定できます。先に勝ち点を設定してください。');
    set('adjustments', parseAdjustments_(payload.adjustments, bundle, stage, cfg.adjustments, ctx));
  }
  if (payload.walkoverLegs !== undefined && (isGroupStage_(stage) || type === STAGE_TYPE.SERIES)) {
    if (payload.walkoverLegs !== 'exclude' && payload.walkoverLegs !== 'award') throw appError_('VALIDATION', '不戦勝の Leg 数の扱いが不正です。');
    set('walkoverLegs', payload.walkoverLegs);
  }

  if (isRoundRobinStage_(stage)) {
    if (payload.cycles !== undefined) {
      var cycles = payload.cycles === 2 ? 2 : payload.cycles === 1 ? 1 : null;
      if (!cycles) throw appError_('VALIDATION', '総当たりの回数は 1 回か 2 回です。');
      if (cycles !== cfg.cycles && matches.length) throw appError_('LOCKED', '対戦カード作成後は総当たりの回数を変更できません。先に対戦カードを削除してください。');
      set('cycles', cycles);
    }
    if (payload.distribution !== undefined) {
      if (payload.distribution !== 'snake' && payload.distribution !== 'rank') throw appError_('VALIDATION', '進出者の配り方が不正です。');
      set('distribution', payload.distribution);
    }
  }
  if (isGroupStage_(stage) && payload.roundLabels !== undefined) {
    set(
      'roundLabels',
      parseRoundMap_(payload.roundLabels, function (v) {
        return cleanText_(v, 'ラウンドの表示名', MAX_ROUND_LABEL_LENGTH_);
      })
    );
  }
  if (type === STAGE_TYPE.SWISS) {
    var generated = matches.reduce(function (mx, m) {
      return Math.max(mx, m.round || 0);
    }, 0);
    if (payload.rounds !== undefined) {
      var rounds = parseSmallInt_(payload.rounds, '回戦数', 1, ADMIN_CONFIG.MAX_SWISS_ROUNDS, cfg.rounds);
      if (rounds < generated) throw appError_('LOCKED', 'すでに ' + generated + ' 回戦まで組んでいるため、回戦数をそれより少なくできません。');
      set('rounds', rounds);
    }
    if (payload.firstRound !== undefined) {
      if (payload.firstRound !== 'seed' && payload.firstRound !== 'random') throw appError_('VALIDATION', '1 回戦の組み方が不正です。');
      if (generated) throw appError_('LOCKED', '1 回戦を組んだ後は変更できません。');
      set('firstRound', payload.firstRound);
    }
    if (payload.byePoints !== undefined) {
      if (generated) throw appError_('LOCKED', '組み合わせを作った後は、不戦（Bye）の点を変更できません。');
      set('byePoints', parseSmallInt_(payload.byePoints, '不戦（Bye）の点', 0, 99, cfg.byePoints));
    }
  }
  if (isEliminationStage_(stage)) {
    if (payload.thirdPlace !== undefined) {
      var third = requireBool_(payload.thirdPlace, '3 位決定戦');
      if (third !== cfg.thirdPlace && matches.length) throw appError_('LOCKED', 'トーナメント表の作成後は 3 位決定戦の有無を変更できません。先にトーナメント表を削除してください。');
      set('thirdPlace', third);
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
      set('roundBestOf', map);
    }
    var structural = ['drawMode', 'fixedRounds', 'avoidSameGroup'].filter(function (k) {
      return payload[k] !== undefined;
    });
    if (structural.length && matches.length) {
      var same = structural.every(function (k) {
        return payload[k] === cfg[k];
      });
      if (!same) throw appError_('LOCKED', 'トーナメント表の作成後は、表の作り方（固定 / 回戦ごとの抽選・同組の初戦回避）を変更できません。先にトーナメント表を削除してください。');
    }
    if (payload.drawMode !== undefined) {
      if (payload.drawMode !== 'fixed' && payload.drawMode !== 'redraw') throw appError_('VALIDATION', '表の作り方が不正です。');
      set('drawMode', payload.drawMode);
    }
    if (payload.fixedRounds !== undefined) set('fixedRounds', parseSmallInt_(payload.fixedRounds, '固定の表で行う回戦数', 0, 6, 0));
    if (payload.avoidSameGroup !== undefined) set('avoidSameGroup', requireBool_(payload.avoidSameGroup, '同じ組の初戦の回避'));
    if (payload.maxEntrants !== undefined) {
      var max = parseSmallInt_(payload.maxEntrants, '決勝の枠数', 0, ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS, 0);
      var current = bundle.entries.filter(function (e) {
        return e.stage_id === stage.stage_id;
      }).length;
      if (max && current > max) throw appError_('VALIDATION', 'すでに ' + current + ' 人が出場者に入っているため、枠数を ' + max + ' にはできません。');
      set('maxEntrants', max);
    }
  }
  if (type === STAGE_TYPE.DOUBLE_ELIMINATION && payload.grandFinal !== undefined) {
    if (payload.grandFinal !== 'reset' && payload.grandFinal !== 'single') throw appError_('VALIDATION', 'グランドファイナルの方式が不正です。');
    if (payload.grandFinal !== cfg.grandFinal && matches.length) throw appError_('LOCKED', '表の作成後はグランドファイナルの方式を変更できません。先に表を削除してください。');
    set('grandFinal', payload.grandFinal);
  }
  if (type === STAGE_TYPE.SERIES) {
    if (payload.nightPoints !== undefined) set('nightPoints', parseNightPoints_(payload.nightPoints, cfg.nightPoints));
    if (payload.nightDraw !== undefined) {
      if (['random', 'standing', 'seed'].indexOf(payload.nightDraw) === -1) throw appError_('VALIDATION', '節の組み合わせの決め方が不正です。');
      set('nightDraw', payload.nightDraw);
    }
    if (payload.nights !== undefined) {
      var nights = parseSmallInt_(payload.nights, '節の数', 1, ADMIN_CONFIG.MAX_SERIES_NIGHTS, cfg.nights);
      resizeSeriesNights_(ctx, bundle, stage, nights);
      set('nights', nights);
    }
  }
  saveStage_(ctx, stage, cfg, changed);
  recordHistory_(ctx, 'stage.update', 'Stage', stage.stage_id, stage.event_id, before, plain_(stage));
  return { eventId: stage.event_id, stageId: stage.stage_id, started: started };
}

/** シリーズの節の数を変える。減らすときは、後ろの節のうち組み合わせも参加者もない節だけを消す */
function resizeSeriesNights_(ctx, bundle, stage, count) {
  var nights = bundle.groups
    .filter(function (g) {
      return g.stage_id === stage.stage_id;
    })
    .sort(byOrder_);
  if (count > nights.length) {
    appendRecords_(ctx.table('Groups'), newGroupRecords_(ctx, stage.event_id, stage.stage_id, count - nights.length, Object.assign({}, ctx.table('Groups').byKey), nights.length, STAGE_TYPE.SERIES, count));
  } else if (count < nights.length) {
    var removed = nights.slice(count);
    removed.forEach(function (g) {
      var used = bundle.matches.some(function (m) {
        return m.group_id === g.group_id;
      }) || bundle.entries.some(function (e) {
        return e.group_id === g.group_id;
      });
      if (used) throw appError_('LOCKED', '「' + g.name + '」には組み合わせか参加者があるため、節の数を減らせません。');
    });
    deleteRecords_(ctx.table('Groups'), removed.map(function (g) {
      return ctx.table('Groups').byKey[g.group_id];
    }));
  }
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

/** グループ数（ロビン）・ディビジョン数（リーグ、v0.8）を変える。対戦カード作成前だけ */
function actionSetGroupCount_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'robin');
  var count = parseGroupCount_(payload.count);
  if (stageMatchesOf_(bundle, stage).length) {
    throw appError_('LOCKED', '対戦カード作成後は' + (stage.type === STAGE_TYPE.LEAGUE ? 'ディビジョン数' : 'グループ数') + 'を変更できません。先に対戦カードを削除してください。');
  }
  assertNotAdvanced_(stage);
  var groups = ctx.table('Groups');
  var current = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  if (count > current.length) {
    appendRecords_(groups, newGroupRecords_(ctx, eventId, stage.stage_id, count - current.length, Object.assign({}, groups.byKey), current.length, stage.type, count));
    // リーグを 1 → 複数ディビジョンにしたとき、既定の名前「リーグ」を「ディビジョン1」にそろえる
    if (stage.type === STAGE_TYPE.LEAGUE && current.length === 1 && current[0].name === 'リーグ') {
      var g0 = groups.byKey[current[0].group_id];
      g0.name = 'ディビジョン1';
      g0.rev = (g0.rev || 0) + 1;
      g0.updated_at = ctx.now;
      updateRecord_(groups, g0);
    }
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
    start_round: null,
    meta_json: '',
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

/** 棄権・失格した選手（meta_json.withdrawn）。以後の組み合わせ・節の参加から外す */
function isWithdrawn_(player) {
  return !!(player && playerMeta_(player).withdrawn);
}

/**
 * 選手を段階のグループに配る（v0.8: 登録順・抽選・組分け〈シード・Rt・所属〉）。
 * 既存の割り当てを消して作り直す。スイス式は 1 グループに全員、シリーズは参加者名簿（グループなし）に全員。
 */
function assignAllRoundRobin_(ctx, bundle, stage, opts) {
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  var groups = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  var players = bundle.players.filter(function (p) {
    return !isWithdrawn_(p);
  });
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var records = [];
  var report = null;
  if (stage.type === STAGE_TYPE.SERIES) {
    players
      .slice()
      .sort(function (a, b) {
        return (a.seed || 999) - (b.seed || 999) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
      })
      .forEach(function (p, i) {
        records.push(newEntry_(ctx, stage, '', p.player_id, i + 1, taken));
      });
  } else {
    var input = players
      .slice()
      .sort(function (a, b) {
        return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
      })
      .map(function (p, i) {
        return { id: p.player_id, affiliation: p.affiliation || '', rating: p.rating, ratingValue: parseRating_(p.rating), seed: p.seed || null, order: i };
      });
    var result = assignGroups_(input, groups.length, opts || {});
    report = result.report;
    result.groups.forEach(function (ids, gi) {
      ids.forEach(function (pid, k) {
        records.push(newEntry_(ctx, stage, groups[gi].group_id, pid, k + 1, taken));
      });
    });
  }
  appendRecords_(ctx.table('Entries'), records);
  return { records: records, report: report };
}

/**
 * 自動割り当て（F01・F16・F17）。method = registration（登録順）/ random（抽選）/ balanced（組分け）
 * 対戦カードを作る前だけ。やり直す（再抽選）ときは、画面で確認してから confirmRedraw: true を送る。
 * 抽選の結果は Entries に保存するので、画面を読み直しても変わらない。
 */
function actionAutoAssign_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'assign');
  if (stageMatchesOf_(bundle, stage).length) {
    throw appError_('LOCKED', '対戦カード作成後は自動割り当てできません。先に対戦カードを削除してください。');
  }
  assertNotAdvanced_(stage);
  if (stage.type !== STAGE_TYPE.SERIES && !bundle.groups.some(function (g) { return g.stage_id === stage.stage_id; })) throw appError_('VALIDATION', 'グループがありません。');
  if (!bundle.players.length) throw appError_('VALIDATION', '選手が登録されていません。');
  var method = payload.method === 'random' || payload.method === 'balanced' ? payload.method : 'registration';
  var already = bundle.entries.some(function (e) {
    return e.stage_id === stage.stage_id;
  });
  if (already && method !== 'registration' && payload.confirmRedraw !== true) {
    throw appError_('CONFIRM_REQUIRED', 'すでに割り当てがあります。抽選し直すと今の割り当ては置き換わります。よろしければ「抽選し直す」を押してください。');
  }
  var opts = {
    method: method,
    useSeeds: payload.useSeeds === true,
    useRating: payload.useRating === true,
    spreadAffiliation: payload.spreadAffiliation === true,
  };
  var res = assignAllRoundRobin_(ctx, bundle, stage, opts);
  var cfg = stageConfig_(stage);
  var stageRec = ctx.table('Stages').byKey[stage.stage_id];
  var raw = safeJson_(stageRec.config_json, {});
  raw.lastDraw = { method: method, at: ctx.now, by: ctx.user ? ctx.user.label : '', options: opts, report: res.report };
  saveStageRaw_(ctx, stageRec, raw);
  recordHistory_(ctx, method === 'registration' ? 'entry.autoAssign' : 'entry.draw', 'Stage', stage.stage_id, eventId, null, {
    assigned: res.records.length,
    method: method,
    options: opts,
    report: res.report,
    groups: res.records.map(function (e) {
      return [e.player_id, e.group_id];
    }),
  });
  void cfg;
  return { eventId: eventId, report: res.report, assigned: res.records.length };
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
    result_type: '',
    result_note: '',
    schedule_json: '',
    bracket_side: '',
    meta_json: '',
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
  var targetStage = targets.length ? bundle.stageById[targets[0].stage_id] : null;
  if (targetStage && targetStage.type === STAGE_TYPE.SWISS) {
    throw appError_('BAD_REQUEST', 'スイス式は 1 回戦ずつ組みます。「次の回戦を組む」を使ってください。');
  }
  if (targetStage && !isRoundRobinStage_(targetStage)) throw appError_('BAD_REQUEST', 'この操作はロビン・リーグの段階でのみ使えます。');
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

/**
 * 同順位の選手の順番を主催者が決める（playerIds の並び順。空配列で解除）。
 * groupId を指定するとそのグループ、シリーズ（段階全体の累計順位）は groupId を省いて stageId を指定する。
 */
function actionSetManualOrder_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var entries = ctx.table('Entries');
  var members;
  var stage;
  var scope;
  if (payload.groupId) {
    var gid = requireId_(payload.groupId, 'グループ');
    var group = findRecord_(ctx.table('Groups'), gid, 'グループ');
    if (group.event_id !== eventId) throw appError_('NOT_FOUND', 'グループが見つかりません。');
    stage = findRecord_(ctx.table('Stages'), group.stage_id, '段階');
    if (stage.type === STAGE_TYPE.SERIES) throw appError_('BAD_REQUEST', 'シリーズの順位は段階全体で決めます（節ごとには決めません）。');
    members = entries.rows.filter(function (e) {
      return e.group_id === gid;
    });
    scope = gid;
  } else {
    stage = findRecord_(ctx.table('Stages'), requireId_(payload.stageId, '段階'), '段階');
    if (stage.event_id !== eventId || stage.type !== STAGE_TYPE.SERIES) throw appError_('BAD_REQUEST', 'グループを指定してください。');
    members = entries.rows.filter(function (e) {
      return e.stage_id === stage.stage_id && !e.group_id;
    });
    scope = stage.stage_id;
  }
  assertNotAdvanced_(stage);
  if (!Array.isArray(payload.playerIds) || payload.playerIds.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) throw appError_('BAD_REQUEST', '選手の指定が不正です。');
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
  recordHistory_(ctx, 'entry.manualOrder', 'Group', scope, eventId, null, { order: payload.playerIds });
  return { eventId: eventId };
}

/* ---------- 進出（ロビン・リーグ・スイス式・シリーズ → 次の段階） ---------- */

/** 進出元の順位（グループごと）。シリーズは段階全体で 1 つ */
function sourceRankings_(stageView) {
  if (stageView.type === STAGE_TYPE.SERIES) {
    return [{ groupId: '', name: stageView.name, index: 0, standings: stageView.standings || [] }];
  }
  return (stageView.groups || []).map(function (g, gi) {
    return { groupId: g.id, name: g.name, index: gi, standings: g.standings };
  });
}

/**
 * 進出の計画（確定・プレビューで共通）。書き込みはしない。
 * - 同順位が進出の境目をまたいでいたら止める（主催者が手動で順位を決める。名前順などで勝手に決めない）
 * - 進出先がトーナメント・ダブルエリミ: 直接出場の選手（あらかじめ登録）を残し、その後に「順位 → グループ」の順でシード
 *   直接出場と進出者の重複、決勝の枠数の超過は止める
 * - 進出先がロビン・リーグ: 進出者を各グループへ配る（順位の帯ごとに蛇行。同じ進出元のグループの選手を同じ組にしない）
 * - 進出先がスイス式・シリーズ: 全員を 1 つの組（参加者名簿）へ
 * 戻り値: { targets: [{ stage, rows: [{ playerId, groupId, seed, label, sourceGroupId, sourceRank, direct }], report }] }
 */
function planAdvancement_(bundle, stage) {
  var cfg = stageConfig_(stage);
  if (!cfg.advancement.length) throw appError_('VALIDATION', '進出ルールが設定されていません。「形式」タブで設定してください。');
  var view = buildEventView_(bundle, true).stages.filter(function (st) {
    return st.id === stage.stage_id;
  })[0];
  var matches = stageMatchesOf_(bundle, stage);
  if (stage.type === STAGE_TYPE.SERIES) {
    if (!view.complete) throw appError_('LOCKED', 'すべての節が終わってから（または中止にしてから）進出を確定してください。' + (view.completion ? view.completion.reason : ''));
  } else {
    var real = matches.filter(function (m) {
      return m.result_type !== RESULT_TYPE.BYE;
    });
    if (!real.length || real.some(function (m) { return m.status !== MATCH_STATUS.FINAL; })) {
      throw appError_('LOCKED', 'すべての試合が確定してから進出を確定してください。');
    }
    if (stage.type === STAGE_TYPE.SWISS && !view.complete) throw appError_('LOCKED', '予定の回戦がすべて終わってから進出を確定してください。' + view.completion.reason);
  }
  if (view.progress.check) throw appError_('LOCKED', '「要確認」の試合があります。先に結果を直してください。');
  var rankings = sourceRankings_(view);
  var byTarget = {};
  var order = [];
  cfg.advancement.forEach(function (rule) {
    var target = bundle.stageById[rule.targetStageId];
    if (!target) throw appError_('DATA_CONFLICT', '進出先の段階が見つかりません。');
    if (stageMatchesOf_(bundle, target).length) throw appError_('LOCKED', '進出先「' + target.name + '」には対戦カードがあります。先に削除してください。');
    if (!byTarget[target.stage_id]) {
      byTarget[target.stage_id] = [];
      order.push(target.stage_id);
    }
    rankings.forEach(function (g) {
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
          var label = stage.type === STAGE_TYPE.SERIES ? stage.name + ' ' + row.rank + '位' : (rankings.length > 1 || stage.type !== STAGE_TYPE.SWISS ? g.name + ' ' : '') + row.rank + '位';
          byTarget[target.stage_id].push({ playerId: row.playerId, rank: row.rank, groupIndex: g.index, sourceGroupId: g.groupId, label: label });
        }
      });
    });
  });
  var targets = order.map(function (targetId) {
    var target = bundle.stageById[targetId];
    var tcfg = stageConfig_(target);
    var list = byTarget[targetId].sort(function (a, b) {
      return a.rank - b.rank || a.groupIndex - b.groupIndex;
    });
    var rows = [];
    var report = { notes: [] };
    if (target.type === STAGE_TYPE.SINGLE_ELIMINATION || target.type === STAGE_TYPE.DOUBLE_ELIMINATION) {
      var direct = bundle.entries
        .filter(function (e) {
          return e.stage_id === targetId && entryMeta_(e).direct === true;
        })
        .sort(function (a, b) {
          return (a.seed || 0) - (b.seed || 0);
        });
      var directIds = {};
      direct.forEach(function (e) {
        directIds[e.player_id] = true;
      });
      list.forEach(function (r) {
        if (directIds[r.playerId]) {
          var p = bundle.players.filter(function (x) {
            return x.player_id === r.playerId;
          })[0];
          throw appError_('VALIDATION', (p ? p.display_name : '選手') + ' は「' + target.name + '」の直接出場者に登録されていて、進出者と重複しています。どちらかを外してください。');
        }
      });
      direct.forEach(function (e, i) {
        rows.push({ playerId: e.player_id, groupId: '', seed: i + 1, label: e.source_label || '直接出場', direct: true, startRound: e.start_round || 1 });
      });
      list.forEach(function (r) {
        rows.push({ playerId: r.playerId, groupId: '', seed: rows.length + 1, label: r.label, sourceGroupId: r.sourceGroupId, sourceRank: r.rank });
      });
      if (tcfg.maxEntrants && rows.length > tcfg.maxEntrants) {
        throw appError_('VALIDATION', '「' + target.name + '」の枠は ' + tcfg.maxEntrants + ' 人ですが、直接出場 ' + direct.length + ' 人 + 進出 ' + list.length + ' 人 = ' + rows.length + ' 人になります。進出ルールか枠数を見直してください。');
      }
      if (direct.length) report.notes.push('直接出場 ' + direct.length + ' 人を上位シードに置き、続けて進出者を「順位 → グループ」の順に並べます。');
    } else if (isRoundRobinStage_(target)) {
      var groups = bundle.groups
        .filter(function (g) {
          return g.stage_id === targetId;
        })
        .sort(byOrder_);
      if (!groups.length) throw appError_('VALIDATION', '進出先「' + target.name + '」にグループがありません。');
      var res = assignGroups_(
        list.map(function (r, i) {
          return { id: r.playerId, affiliation: r.sourceGroupId, seed: i + 1, order: i };
        }),
        groups.length,
        tcfg.distribution === 'rank' ? { method: 'registration' } : { method: 'balanced', useSeeds: true, spreadAffiliation: true }
      );
      var info = {};
      list.forEach(function (r) {
        info[r.playerId] = r;
      });
      res.groups.forEach(function (ids, gi) {
        if (ids.length < 2) throw appError_('VALIDATION', '進出先「' + target.name + '」の' + groups[gi].name + 'が ' + ids.length + ' 人になります（総当たりには 2 人以上必要）。グループ数か進出人数を見直してください。');
        ids.forEach(function (pid, k) {
          rows.push({ playerId: pid, groupId: groups[gi].group_id, seed: k + 1, label: info[pid].label, sourceGroupId: info[pid].sourceGroupId, sourceRank: info[pid].rank });
        });
      });
      report.notes.push('進出者を順位の帯ごとに蛇行の順で配り、同じ進出元のグループの選手がなるべく同じ組にならないようにしました。前の段階の成績は持ち越しません。');
      if (res.report.clashes) report.notes.push('同じ進出元のグループの選手が同じ組になった組み合わせが ' + res.report.clashes + ' 組あります（人数の均衡と順位の帯を優先しました）。');
    } else {
      var g1 = bundle.groups.filter(function (g) {
        return g.stage_id === targetId;
      })[0];
      list.forEach(function (r) {
        rows.push({ playerId: r.playerId, groupId: target.type === STAGE_TYPE.SERIES ? '' : g1 ? g1.group_id : '', seed: rows.length + 1, label: r.label, sourceGroupId: r.sourceGroupId, sourceRank: r.rank });
      });
    }
    return { stage: target, rows: rows, report: report };
  });
  return { targets: targets };
}

/** 進出の確認（プレビュー）: 誰がどこへ、どのシード・組に入るか。書き込みはしない */
function actionPreviewAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'rankable');
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var groupName = {};
  bundle.groups.forEach(function (g) {
    groupName[g.group_id] = g.name;
  });
  try {
    var plan = planAdvancement_(bundle, stage);
    return {
      ok: true,
      targets: plan.targets.map(function (t) {
        return {
          stageId: t.stage.stage_id,
          name: t.stage.name,
          type: t.stage.type,
          notes: t.report.notes,
          rows: t.rows.map(function (r) {
            return { playerId: r.playerId, name: nameOf[r.playerId] || '', seed: r.seed, label: r.label, group: r.groupId ? groupName[r.groupId] || '' : '', direct: !!r.direct };
          }),
        };
      }),
    };
  } catch (e) {
    if (!e.appCode) throw e;
    return { ok: false, code: e.appCode, message: e.publicMessage };
  }
}

function actionConfirmAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'rankable');
  var cfg = stageConfig_(stage);
  if (cfg.advanced) throw appError_('LOCKED', 'この段階の進出は確定済みです。');
  var plan = planAdvancement_(bundle, stage);
  var entries = ctx.table('Entries');
  var taken = Object.assign({}, entries.byKey);
  var added = [];
  plan.targets.forEach(function (t) {
    // 直接出場の選手は残し、それ以外（前回の進出者・手で入れた選手）を入れ替える
    deleteRecords_(entries, entries.rows.filter(function (e) {
      return e.stage_id === t.stage.stage_id && !(entryMeta_(e).direct === true && isBracketStage_(t.stage));
    }));
    t.rows.forEach(function (r) {
      if (r.direct) {
        var keep = entries.rows.filter(function (e) {
          return e.stage_id === t.stage.stage_id && e.player_id === r.playerId;
        })[0];
        if (keep && keep.seed !== r.seed) {
          keep.seed = r.seed;
          keep.rev = (keep.rev || 0) + 1;
          keep.updated_at = ctx.now;
          updateRecord_(entries, keep);
        }
        return;
      }
      var e = newEntry_(ctx, t.stage, r.groupId, r.playerId, r.seed, taken, r.label);
      e.meta_json = JSON.stringify({ sourceGroupId: r.sourceGroupId || '', sourceRank: r.sourceRank || null, fromStageId: stage.stage_id });
      added.push(e);
    });
  });
  appendRecords_(entries, added);
  cfg.advanced = true;
  cfg.advancedAt = ctx.now;
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg, ['advanced', 'advancedAt']);
  recordHistory_(ctx, 'stage.advance', 'Stage', stage.stage_id, eventId, null, {
    advanced: added.length,
    targets: plan.targets.map(function (t) {
      return { stageId: t.stage.stage_id, rows: t.rows.map(function (r) { return [r.playerId, r.seed, r.groupId, r.label]; }) };
    }),
  });
  return { eventId: eventId, advanced: added.length };
}

function actionUndoAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'rankable');
  var cfg = stageConfig_(stage);
  if (!cfg.advanced) return { eventId: eventId };
  var targets = {};
  cfg.advancement.forEach(function (r) {
    targets[r.targetStageId] = true;
  });
  var targetMatches = bundle.matches.filter(function (m) {
    return targets[m.stage_id];
  });
  if (targetMatches.some(function (m) { return matchStarted_(m) && m.result_type !== RESULT_TYPE.BYE; })) {
    throw appError_('LOCKED', '進出先の段階で結果が入力されているため取り消せません。先に進出先の結果を「未開始」に戻してください。');
  }
  deleteRecords_(ctx.table('Matches'), ctx.table('Matches').rows.filter(function (m) {
    return targets[m.stage_id];
  }));
  // 直接出場の選手（進出とは別に登録したもの）は残す
  deleteRecords_(ctx.table('Entries'), ctx.table('Entries').rows.filter(function (e) {
    return targets[e.stage_id] && entryMeta_(e).direct !== true;
  }));
  cfg.advanced = false;
  cfg.advancedAt = '';
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg, ['advanced', 'advancedAt']);
  recordHistory_(ctx, 'stage.undoAdvance', 'Stage', stage.stage_id, eventId, null, { removedMatches: targetMatches.length });
  return { eventId: eventId };
}

/* ---------- トーナメント・ダブルエリミネーション ---------- */

/**
 * 出場者とシード順を決める（並び = シード 1, 2, 3…）。表の作成前のみ。
 * payload.playerIds（従来）か payload.entrants = [{ playerId, startRound?, direct? }]（v0.8: 途中回戦から出場するシード・直接出場）
 */
function actionSetEntrants_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', 'トーナメント表の作成後は出場者を変更できません。先にトーナメント表を削除してください。');
  var cfg = stageConfig_(stage);
  var list = Array.isArray(payload.entrants)
    ? payload.entrants
    : Array.isArray(payload.playerIds)
      ? payload.playerIds.map(function (pid) {
          return { playerId: pid };
        })
      : null;
  if (!list || list.length > ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS) {
    throw appError_('VALIDATION', '出場者は ' + ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS + ' 名までです。');
  }
  if (cfg.maxEntrants && list.length > cfg.maxEntrants) throw appError_('VALIDATION', 'この段階の枠は ' + cfg.maxEntrants + ' 人です（' + list.length + ' 人が指定されました）。');
  var playerIds = {};
  bundle.players.forEach(function (p) {
    playerIds[p.player_id] = true;
  });
  // 直接出場は、前の段階（この段階へ進出させる段階）の参加者とは重ならないようにする
  var feederMembers = {};
  bundle.stages.forEach(function (st) {
    if (!stageConfig_(st).advancement.some(function (r) { return r.targetStageId === stage.stage_id; })) return;
    bundle.entries.forEach(function (e) {
      if (e.stage_id === st.stage_id) feederMembers[e.player_id] = st.name;
    });
  });
  var seen = {};
  var parsed = list.map(function (x) {
    var pid = x && x.playerId;
    if (!isValidId_(pid) || !playerIds[pid] || seen[pid]) throw appError_('BAD_REQUEST', '出場者の指定が不正です。');
    seen[pid] = true;
    var startRound = x.startRound === undefined || x.startRound === null || x.startRound === '' ? 1 : parseSmallInt_(x.startRound, '出場する回戦', 1, 8, 1);
    if (startRound > 1 && stage.type === STAGE_TYPE.DOUBLE_ELIMINATION) throw appError_('VALIDATION', 'ダブルエリミネーションでは途中の回戦から出場するシードは指定できません。');
    var direct = x.direct === true;
    if (direct && feederMembers[pid]) {
      var p = bundle.players.filter(function (y) {
        return y.player_id === pid;
      })[0];
      throw appError_('VALIDATION', (p ? p.display_name : '選手') + ' は「' + feederMembers[pid] + '」の参加者なので、直接出場にはできません（進出で入ります）。');
    }
    return { playerId: pid, startRound: startRound, direct: direct };
  });
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  });
  var prev = {};
  current.forEach(function (e) {
    prev[e.player_id] = e;
  });
  deleteRecords_(entries, current);
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var records = parsed.map(function (x, i) {
    var old = prev[x.playerId];
    var meta = old ? entryMeta_(old) : {};
    if (x.direct) meta.direct = true;
    else delete meta.direct;
    var label = x.direct ? '直接出場' : old && old.source_label !== '直接出場' ? old.source_label : '';
    var e = newEntry_(ctx, stage, '', x.playerId, i + 1, taken, label);
    e.start_round = x.startRound > 1 ? x.startRound : null;
    e.meta_json = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return e;
  });
  appendRecords_(ctx.table('Entries'), records);
  recordHistory_(ctx, 'entry.seed', 'Stage', stage.stage_id, eventId, null, { entrants: parsed });
  return { eventId: eventId };
}

/**
 * トーナメント表の計画（作成・プレビューで共通。書き込みはしない）。
 * 戻り値: { matches: 試合の元データ, order: シードを付け直した並び（同組の初戦回避の結果）, conflicts, problems, notes, drawn }
 */
function bracketPlanFor_(bundle, stage) {
  var cfg = stageConfig_(stage);
  var rule = stageRule_(bundle, stage);
  var problems = [];
  var notes = [];
  if (rule && rule.format === RULE_FORMAT.FIXED_LEGS) problems.push('この段階のルールが固定 Leg 数（引き分けあり）です。勝ち抜き戦では使えないので、「形式」タブで Leg 制かセット制にしてください。');
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var list = bundle.entries
    .filter(function (e) {
      return e.stage_id === stage.stage_id;
    })
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    })
    .map(function (e, i) {
      var meta = entryMeta_(e);
      return { id: e.player_id, seed: i + 1, startRound: e.start_round || 1, label: nameOf[e.player_id] || '', group: meta.sourceGroupId || '', tier: meta.sourceRank || (meta.direct ? 0 : null) };
    });
  if (list.length < 2) problems.push('出場者が 2 名以上必要です。');
  var withdrawn = bundle.players.filter(function (p) {
    return isWithdrawn_(p) && list.some(function (x) { return x.id === p.player_id; });
  });
  if (withdrawn.length) notes.push('棄権・失格した選手が出場者にいます（' + withdrawn.map(function (p) { return p.display_name; }).join('、') + '）。表を作ると、その選手の試合は不戦勝として扱います。');
  var out = { matches: [], order: list.map(function (x) { return x.id; }), conflicts: [], problems: problems, notes: notes, drawn: false, list: list };
  if (problems.length) return out;
  if (stage.type === STAGE_TYPE.DOUBLE_ELIMINATION) {
    var de = planDoubleElimination_(list, { grandFinal: cfg.grandFinal });
    out.matches = de.matches;
    out.problems = out.problems.concat(de.problems);
    notes.push('勝者側 ' + de.winnerRounds + ' 回戦・敗者側 ' + de.loserRounds + ' 回戦・グランドファイナル' + (cfg.grandFinal === 'reset' ? '（敗者側の選手が勝てばリセットの決勝をもう 1 試合）' : '（1 試合のみ。勝者側の優勝者もここで負けると 1 敗で敗退します）') + '。');
    return out;
  }
  if (cfg.drawMode === 'redraw') {
    var sched = redrawSchedule_(list, cfg.fixedRounds);
    out.problems = out.problems.concat(sched.problems);
    out.schedule = sched.rounds;
    if (out.problems.length) return out;
    var first = list.filter(function (x) {
      return x.startRound <= 1 || x.startRound <= cfg.fixedRounds;
    });
    if (cfg.fixedRounds > 0) {
      var fixed = planSingleElimination_(first, { lastRound: cfg.fixedRounds });
      out.matches = fixed.matches;
      notes.push('1〜' + cfg.fixedRounds + ' 回戦は固定の表で行い、' + (cfg.fixedRounds + 1) + ' 回戦からは前の回戦が終わるたびに主催者が抽選します。');
    } else {
      out.drawn = true;
      var pool = shuffle_(first.map(function (x) { return x.id; }));
      for (var i = 0; i < pool.length; i += 2) {
        out.matches.push({ key: '1-' + i / 2, round: 1, order: i / 2 + 1, label: redrawRoundLabel_(pool.length, 1), p1: pool[i], p2: pool[i + 1], nextKey: '', nextSlot: null, loserNextKey: '', loserNextSlot: null, meta: { draw: true } });
      }
      notes.push('1 回戦から、回戦ごとに抽選します（次の回戦は前の回戦がすべて確定した後に主催者が抽選）。');
    }
    return out;
  }
  // 固定の表: 同じ予選グループの選手が 1 回戦で当たらないように（同じ順位の帯の中だけで入れ替える）
  var ordered = list;
  if (cfg.avoidSameGroup && list.some(function (x) { return x.group; })) {
    var avoided = avoidSameGroupFirstRound_(list, function (x) {
      return x.tier === null || x.tier === undefined ? 'n' : String(x.tier);
    });
    ordered = avoided.order;
    out.conflicts = avoided.conflicts;
    if (avoided.swaps) notes.push('同じ予選グループの選手が 1 回戦で当たらないよう、同じ順位の選手どうしのシードを ' + avoided.swaps + ' 回入れ替えました。');
    if (avoided.conflicts.length) {
      notes.push(
        '次の組み合わせは同じ予選グループどうしのまま残りました（シードの順位の帯を保つと避けられません）: ' +
          avoided.conflicts
            .map(function (c) {
              return (nameOf[c[0]] || '?') + ' vs ' + (nameOf[c[1]] || '?');
            })
            .join('、') +
          '。必要なら「出場者とシード」で手で並べ替えてください。'
      );
    }
  }
  var seeded = ordered.map(function (x, i) {
    return { id: x.id, seed: i + 1, startRound: x.startRound, label: x.label };
  });
  var plan = planSingleElimination_(seeded, { thirdPlace: cfg.thirdPlace });
  out.problems = out.problems.concat(plan.problems);
  out.matches = plan.matches;
  out.order = ordered.map(function (x) {
    return x.id;
  });
  var late = seeded.filter(function (x) {
    return x.startRound > 1;
  });
  if (late.length) notes.push(late.length + ' 人のシードは途中の回戦から出場します（不戦勝ではなく「シード（n 回戦から）」として表示します）。');
  return out;
}

function actionPreviewBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  var plan = bracketPlanFor_(bundle, stage);
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var firstRound = plan.matches
    .filter(function (m) {
      return m.round === 1 && (!m.side || m.side === 'W') && m.p1 && m.p2;
    })
    .map(function (m) {
      return { p1: nameOf[m.p1] || '', p2: nameOf[m.p2] || '' };
    });
  return {
    ok: !plan.problems.length,
    problems: plan.problems,
    notes: plan.notes,
    matchCount: plan.matches.length,
    firstRound: plan.drawn ? [] : firstRound,
    drawnAtCreate: plan.drawn,
    schedule: plan.schedule || null,
    seeds: plan.order.map(function (pid, i) {
      return { seed: i + 1, name: nameOf[pid] || '' };
    }),
  };
}

function bracketRecords_(ctx, stage, plan, extraMeta) {
  var taken = Object.assign({}, ctx.table('Matches').byKey);
  var idOf = {};
  plan.forEach(function (p) {
    idOf[p.key] = newId_('MAT', taken);
    taken[idOf[p.key]] = true;
  });
  return plan.map(function (p) {
    var m = blankMatch_(ctx, stage, p.groupId || '', idOf[p.key]);
    m.round = p.round;
    m.order = p.order;
    m.label = p.label;
    m.player1_id = p.p1;
    m.player2_id = p.p2;
    m.next_match_id = p.nextKey && idOf[p.nextKey] ? idOf[p.nextKey] : '';
    m.next_match_slot = m.next_match_id ? p.nextSlot : null;
    m.loser_next_match_id = p.loserNextKey && idOf[p.loserNextKey] ? idOf[p.loserNextKey] : '';
    m.loser_next_match_slot = m.loser_next_match_id ? p.loserNextSlot : null;
    m.bracket_side = p.side || '';
    var meta = Object.assign({}, p.meta || {}, extraMeta || {});
    m.meta_json = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return m;
  });
}

function actionGenerateBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', 'トーナメント表は作成済みです。');
  var plan = bracketPlanFor_(bundle, stage);
  if (plan.problems.length) throw appError_('VALIDATION', plan.problems.join(' / '));
  // 同組の初戦回避でシードを付け直したときは、出場者のシードも合わせる（閲覧ページのシード番号と表の位置を一致させる）
  var entries = ctx.table('Entries');
  plan.order.forEach(function (pid, i) {
    var e = entries.rows.filter(function (x) {
      return x.stage_id === stage.stage_id && x.player_id === pid;
    })[0];
    if (e && e.seed !== i + 1) {
      e.seed = i + 1;
      e.rev = (e.rev || 0) + 1;
      e.updated_at = ctx.now;
      updateRecord_(entries, e);
    }
  });
  var records = bracketRecords_(ctx, stage, plan.matches, plan.drawn ? { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '' } : null);
  appendRecords_(ctx.table('Matches'), records);
  autoForfeitWithdrawn_(ctx, eventId, stage.stage_id);
  recordHistory_(ctx, plan.drawn ? 'bracket.draw' : 'bracket.generate', 'Stage', stage.stage_id, eventId, null, {
    entrants: plan.order.length,
    matches: records.length,
    conflicts: plan.conflicts,
    notes: plan.notes,
    pairs: records.map(function (m) {
      return [m.round, m.player1_id, m.player2_id];
    }),
  });
  return { eventId: eventId, created: records.length, notes: plan.notes };
}

/**
 * 回戦ごとの抽選（v0.8、UK Open などの採用例を参考にした汎用の設定）。
 * 前の回戦がすべて確定した後に主催者が押す。勝ち残った選手と、この回戦から出場するシードを抽選で組む。
 * 抽選の結果は保存するので、画面を読み直しても変わらない。やり直しは、その回戦の試合がどれも始まっていないときだけ
 * （redo: true。前の抽選の内容は履歴に残す）。
 */
function actionDrawNextRound_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'elimination');
  var cfg = stageConfig_(stage);
  if (cfg.drawMode !== 'redraw') throw appError_('BAD_REQUEST', 'この段階は固定の表です（回戦ごとの抽選ではありません）。');
  var matchesTable = ctx.table('Matches');
  var matches = stageMatchesOf_(bundle, stage);
  if (!matches.length) throw appError_('LOCKED', '先に「トーナメント表を作成」を押してください。');
  var latest = matches.reduce(function (mx, m) {
    return Math.max(mx, m.round || 0);
  }, 0);
  var before = null;
  if (payload.redo === true) {
    var redoList = matches.filter(function (m) {
      return m.round === latest;
    });
    if (latest <= cfg.fixedRounds) throw appError_('LOCKED', '固定の表の回戦は抽選のやり直しができません。');
    if (redoList.some(matchStarted_)) throw appError_('LOCKED', latest + ' 回戦はすでに始まっている試合があるため、抽選をやり直せません。');
    before = redoList.map(function (m) {
      return [m.player1_id, m.player2_id];
    });
    deleteRecords_(matchesTable, redoList);
    matches = matches.filter(function (m) {
      return redoList.indexOf(m) === -1;
    });
    latest = latest - 1;
    if (latest === 0) {
      // 1 回戦の抽選のやり直し
      var plan1 = bracketPlanFor_(bundle, stage);
      var rec1 = bracketRecords_(ctx, stage, plan1.matches, { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '' });
      appendRecords_(matchesTable, rec1);
      recordHistory_(ctx, 'bracket.redraw', 'Stage', stage.stage_id, eventId, { round: 1, pairs: before }, { round: 1, pairs: rec1.map(function (m) { return [m.player1_id, m.player2_id]; }) });
      return { eventId: eventId, round: 1, created: rec1.length };
    }
  }
  var last = matches.filter(function (m) {
    return m.round === latest && m.label !== '3位決定戦';
  });
  if (last.some(function (m) { return m.status !== MATCH_STATUS.FINAL || !m.winner_id; })) {
    throw appError_('LOCKED', latest + ' 回戦の結果がすべて確定してから、次の回戦を抽選してください。');
  }
  if (last.length === 1 && last[0].label === '決勝') throw appError_('LOCKED', '決勝まで終わっています。');
  var entrants = bundle.entries.filter(function (e) {
    return e.stage_id === stage.stage_id;
  });
  var pool = last.map(function (m) {
    return m.winner_id;
  });
  // 固定の表の最後の回戦で、不戦（Bye）のまま勝ち残った選手
  if (latest === cfg.fixedRounds && cfg.fixedRounds > 0) {
    var listFixed = entrants
      .filter(function (e) {
        return !(e.start_round > cfg.fixedRounds);
      })
      .sort(function (a, b) {
        return (a.seed || 0) - (b.seed || 0);
      })
      .map(function (e, i) {
        return { id: e.player_id, seed: i + 1, startRound: e.start_round || 1, label: '' };
      });
    var fixedPlan = planSingleElimination_(listFixed, { lastRound: cfg.fixedRounds });
    Object.keys(fixedPlan.passes).forEach(function (key) {
      if (key.indexOf(cfg.fixedRounds + '-') === 0 && fixedPlan.passes[key].t === 'p') pool.push(fixedPlan.passes[key].id);
    });
  }
  var nextRound = latest + 1;
  entrants.forEach(function (e) {
    if (e.start_round === nextRound) pool.push(e.player_id);
  });
  if (pool.length < 2) throw appError_('LOCKED', '次の回戦に進む選手がいません。');
  if (pool.length % 2 === 1) throw appError_('VALIDATION', nextRound + ' 回戦に進む選手が ' + pool.length + ' 人（奇数）です。途中から出場するシードの人数を見直してください。');
  var drawn = shuffle_(pool);
  var label = redrawRoundLabel_(drawn.length, nextRound);
  var plan = [];
  for (var i = 0; i < drawn.length; i += 2) {
    plan.push({ key: 'r' + i, round: nextRound, order: i / 2 + 1, label: label, p1: drawn[i], p2: drawn[i + 1], meta: { draw: true } });
  }
  // 決勝の抽選のとき、3 位決定戦は準決勝の敗者どうし
  if (drawn.length === 2 && cfg.thirdPlace && last.length === 2) {
    var losers = last.map(function (m) {
      return m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
    });
    plan.push({ key: 'third', round: nextRound, order: 2, label: '3位決定戦', p1: losers[0], p2: losers[1], meta: { draw: true } });
  }
  var records = bracketRecords_(ctx, stage, plan, { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '', pool: drawn.length });
  appendRecords_(matchesTable, records);
  autoForfeitWithdrawn_(ctx, eventId, stage.stage_id);
  recordHistory_(ctx, before ? 'bracket.redraw' : 'bracket.draw', 'Stage', stage.stage_id, eventId, before ? { round: nextRound, pairs: before } : null, {
    round: nextRound,
    pairs: records.map(function (m) {
      return [m.player1_id, m.player2_id];
    }),
  });
  return { eventId: eventId, round: nextRound, created: records.length };
}

function actionClearBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  var matches = stageMatchesOf_(bundle, stage);
  if (matches.some(matchStarted_)) throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  var table = ctx.table('Matches');
  deleteRecords_(table, table.rows.filter(function (m) {
    return m.stage_id === stage.stage_id;
  }));
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
 * 勝ち抜き戦の勝者・敗者を次の試合の枠へ入れる（訂正時は入れ替える）。
 * 次の試合がすでに始まっている場合は、結果を変えさせない（進行中の対戦を壊さない・同じ選手を二重に進めない）。
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
    updateRecord_(table, next);
  });
  var meta = matchMeta_(match);
  if (meta.gf === 1) syncGrandFinalReset_(ctx, match);
}

/**
 * ダブルエリミのリセットの決勝（GF2）。グランドファイナル（GF1）で敗者側の選手（2 番目の枠）が勝ったときだけ行う。
 * 勝者側の選手が勝った・リセットなしの設定のときは「実施なし」。GF1 を訂正したら合わせ直す（GF2 が始まっていたら止める）。
 */
function syncGrandFinalReset_(ctx, gf1) {
  var table = ctx.table('Matches');
  var gf2 = table.rows.filter(function (m) {
    return m.stage_id === gf1.stage_id && matchMeta_(m).gf === 2;
  })[0];
  if (!gf2) return;
  var want;
  if (gf1.status !== MATCH_STATUS.FINAL || !gf1.winner_id) want = { p1: '', p2: '', type: '' };
  else if (gf1.winner_id === gf1.player2_id) want = { p1: gf1.player1_id, p2: gf1.player2_id, type: '' };
  else want = { p1: '', p2: '', type: RESULT_TYPE.NOT_NEEDED };
  if (gf2.player1_id === want.p1 && gf2.player2_id === want.p2 && (gf2.result_type || '') === want.type) return;
  if (matchStarted_(gf2) && gf2.result_type !== RESULT_TYPE.NOT_NEEDED) {
    throw appError_('LOCKED', 'リセットの決勝が始まっているため、グランドファイナルの結果は変更できません。先にリセットの決勝を「未開始」に戻してください。');
  }
  gf2.player1_id = want.p1;
  gf2.player2_id = want.p2;
  gf2.result_type = want.type;
  gf2.status = MATCH_STATUS.SCHEDULED;
  gf2.winner_id = '';
  gf2.rev = (gf2.rev || 0) + 1;
  gf2.updated_at = ctx.now;
  updateRecord_(table, gf2);
}

/**
 * 棄権・失格した選手が勝ち抜き戦の次の試合に入ったら、その試合は相手の不戦勝にする（F15）。
 * 両方とも棄権済みの試合は主催者が決める（そのまま残す）。連鎖して次の試合に入った場合も同じように処理する。
 */
function autoForfeitWithdrawn_(ctx, eventId, stageId) {
  var withdrawn = {};
  ctx.table('Players').rows.forEach(function (p) {
    if (p.event_id === eventId && isWithdrawn_(p)) withdrawn[p.player_id] = playerMeta_(p).withdrawn;
  });
  if (!Object.keys(withdrawn).length) return 0;
  var table = ctx.table('Matches');
  var stage = ctx.table('Stages').byKey[stageId];
  if (!isBracketStage_(stage)) return 0;
  var count = 0;
  for (var guard = 0; guard < 300; guard++) {
    var target = table.rows.filter(function (m) {
      if (m.stage_id !== stageId || m.status !== MATCH_STATUS.SCHEDULED || matchStarted_(m) || !m.player1_id || !m.player2_id) return false;
      return !!withdrawn[m.player1_id] !== !!withdrawn[m.player2_id];
    })[0];
    if (!target) break;
    var loser = withdrawn[target.player1_id] ? target.player1_id : target.player2_id;
    var winner = loser === target.player1_id ? target.player2_id : target.player1_id;
    var before = pickResult_(target);
    target.status = MATCH_STATUS.FINAL;
    target.result_type = withdrawn[loser].kind === 'disqualified' ? RESULT_TYPE.DISQUALIFIED : RESULT_TYPE.WALKOVER;
    target.result_note = withdrawn[loser].reason || '';
    target.player1_legs = null;
    target.player2_legs = null;
    target.player1_sets = 0;
    target.player2_sets = 0;
    target.winner_id = winner;
    target.confirmed_at = ctx.now;
    target.rev = (target.rev || 0) + 1;
    target.updated_at = ctx.now;
    propagateElimination_(ctx, target, '', winner);
    updateRecord_(table, target);
    recordHistory_(ctx, 'match.autoWalkover', 'Match', target.match_id, eventId, before, pickResult_(target));
    count++;
  }
  return count;
}

var SPECIAL_RESULTS_ = [RESULT_TYPE.WALKOVER, RESULT_TYPE.RETIRED, RESULT_TYPE.DISQUALIFIED];

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
  if (match.result_type === RESULT_TYPE.BYE) throw appError_('LOCKED', '不戦（Bye）の記録は変更できません。');
  if (match.result_type === RESULT_TYPE.NOT_NEEDED) throw appError_('LOCKED', 'この試合は行わないことになっています（グランドファイナルで勝者側の選手が勝ったため）。');
  var resultType = payload.resultType === undefined || payload.resultType === null ? '' : payload.resultType;
  if (resultType !== '' && SPECIAL_RESULTS_.indexOf(resultType) === -1) throw appError_('VALIDATION', '特殊な結果の種類が不正です。');
  if (resultType && status !== MATCH_STATUS.FINAL) throw appError_('VALIDATION', '不戦勝・途中棄権・失格は「確定」として保存してください。');

  var bundle = collectEvent_(ctx, match.event_id);
  var stage = bundle.stageById[match.stage_id];
  if (isGroupStage_(stage) || stage.type === STAGE_TYPE.SERIES) assertNotAdvanced_(stage);
  if (stage.type === STAGE_TYPE.SWISS) {
    // スイス式: 後の回戦を組んだ後は、前の回戦の結果を変えない（組み合わせの前提が変わるため）
    var latest = bundle.matches.reduce(function (mx, m) {
      return m.stage_id === stage.stage_id && m.group_id === match.group_id ? Math.max(mx, m.round || 0) : mx;
    }, 0);
    if (match.round < latest) throw appError_('LOCKED', '第' + latest + '回戦の組み合わせを作った後は、第' + match.round + '回戦の結果を変更できません。先に第' + latest + '回戦の組み合わせを削除してください（まだ始まっていない場合のみ）。');
  }
  if (stage.type === STAGE_TYPE.SERIES && match.group_id) {
    var night = bundle.groups.filter(function (g) {
      return g.group_id === match.group_id;
    })[0];
    if (night && groupMeta_(night).status === 'cancelled') throw appError_('LOCKED', 'この節は中止になっています。');
  }
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
  var note = cleanText_(payload.note, '理由', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true });
  var input;
  var winnerSide;
  var draw = false;
  if (resultType) {
    winnerSide = payload.winnerSide === 1 || payload.winnerSide === 2 ? payload.winnerSide : 0;
    if (!winnerSide) throw appError_('VALIDATION', '不戦勝・途中棄権・失格では、勝者（記録上の勝者）を選んでください。');
    if (resultType === RESULT_TYPE.WALKOVER) {
      // 不戦勝: 実際には試合をしていないので、Leg 数は記録しない（捏造しない）
      input = { p1Legs: null, p2Legs: null, p1Sets: 0, p2Sets: 0 };
    } else {
      // 途中棄権・失格: その時点までの実際の Leg 数（任意）。勝敗が決まっていない数であること
      input = {
        p1Legs: parseCount_(payload.p1Legs, '取得 Leg 数', true),
        p2Legs: parseCount_(payload.p2Legs, '取得 Leg 数', true),
        p1Sets: sets ? parseCount_(payload.p1Sets, '取得セット数', true) || 0 : 0,
        p2Sets: sets ? parseCount_(payload.p2Sets, '取得セット数', true) || 0 : 0,
      };
      if ((input.p1Legs === null) !== (input.p2Legs === null)) throw appError_('VALIDATION', '取得 Leg 数は両方入力するか、両方空欄にしてください。');
      if (input.p1Legs !== null) {
        var at = evaluateMatchInput_(MATCH_STATUS.LIVE, input, spec);
        if (!at.ok) throw appError_('VALIDATION', '棄権・失格の時点の Leg 数は、まだ勝敗が決まっていない数にしてください（' + at.problems.join(' / ') + '）。');
      }
    }
    if (!note) throw appError_('VALIDATION', '不戦勝・途中棄権・失格の理由を入力してください（運営画面にだけ残ります）。');
  } else {
    input = {
      p1Legs: parseCount_(payload.p1Legs, '取得 Leg 数', sets),
      p2Legs: parseCount_(payload.p2Legs, '取得 Leg 数', sets),
      p1Sets: sets ? parseCount_(payload.p1Sets, '取得セット数', false) : 0,
      p2Sets: sets ? parseCount_(payload.p2Sets, '取得セット数', false) : 0,
    };
    if (sets && (input.p1Legs === null) !== (input.p2Legs === null)) throw appError_('VALIDATION', '取得 Leg 数は両方入力するか、両方空欄にしてください。');
    var result = evaluateMatchInput_(status, input, spec);
    if (!result.ok) throw appError_('VALIDATION', result.problems.join(' / '));
    if (result.draw && isBracketStage_(stage)) throw appError_('VALIDATION', '勝ち抜き戦では引き分けを確定できません。');
    winnerSide = result.winnerSide;
    draw = !!result.draw;
  }
  return {
    match: match,
    stage: stage,
    status: status,
    sets: sets,
    input: input,
    winnerSide: winnerSide,
    draw: draw,
    resultType: resultType,
    note: resultType ? note : '',
    names: [playerById[match.player1_id].display_name, playerById[match.player2_id].display_name],
  };
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
  match.result_type = prep.resultType || '';
  match.result_note = prep.note || '';
  match.confirmed_at = prep.status === MATCH_STATUS.FINAL ? ctx.now : '';
  match.rev = (match.rev || 0) + 1;
  match.updated_at = ctx.now;
  if (isBracketStage_(prep.stage)) propagateElimination_(ctx, match, beforeWinner, match.winner_id);
  updateRecord_(ctx.table('Matches'), match);
  if (isBracketStage_(prep.stage)) autoForfeitWithdrawn_(ctx, match.event_id, match.stage_id);
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
 * 対象は未確定の試合の「確定」だけ（訂正・進行中の保存・特殊な結果は 1 試合ずつ）。
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
    result_type: m.result_type || '',
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
var EVENT_CHILD_TABLES_ = ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'History', 'Collaborators'];
/** 保存用ファイル（JSON）に入れるシート。共同主催者のメールアドレスは入れない */
var ARCHIVE_TABLES_ = ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'History'];

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
  ARCHIVE_TABLES_.forEach(function (name) {
    tables[name] = ctx.table(name).rows
      .filter(function (r) {
        return r.event_id === eventId;
      })
      .map(plain_);
  });
  return {
    format: 'n02-tournament-archive',
    // 2 = v0.8（列が増えた。共同主催者は入れない）。復元は 1 と 2 の両方を受け付ける
    formatVersion: 2,
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
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '大会の削除');
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
