/* 運営用 API の各操作。doPost から、認証・認可・ロック・二重送信チェックの後に呼ばれる。 */

var SAMPLE_GROUP_COUNT_ = 4;
var SAMPLE_PLAYER_COUNT_ = 16;

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

/* ---------- 大会 ---------- */

function ruleName_(bestOf, provisional) {
  return 'Best of ' + bestOf + ' Legs' + (provisional ? '（暫定）' : '');
}

function parseBestOf_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (!isValidBestOf_(n)) throw appError_('VALIDATION', 'Best of は 1〜' + ADMIN_CONFIG.BEST_OF_MAX + ' の奇数で指定してください。');
  return n;
}

function parseGroupCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (n === null || n < ADMIN_CONFIG.MIN_GROUPS || n > ADMIN_CONFIG.MAX_GROUPS || Math.floor(n) !== n) {
    throw appError_('VALIDATION', 'グループ数は ' + ADMIN_CONFIG.MIN_GROUPS + '〜' + ADMIN_CONFIG.MAX_GROUPS + ' で指定してください。');
  }
  return n;
}

/** 大会・ルール・ロビンのステージ・グループをまとめて作る */
function createEventRecords_(ctx, input) {
  var events = ctx.table('Events');
  var eventId = newId_('EVT', events.byKey);
  var ruleId = newId_('RUL', ctx.table('Rules').byKey);
  var stageId = newId_('STG', ctx.table('Stages').byKey);
  var event = {
    event_id: eventId,
    name: input.name,
    date_label: input.dateLabel,
    status: EVENT_STATUS.DRAFT,
    is_public: false,
    is_featured: false,
    rule_id: ruleId,
    is_sample: !!input.isSample,
    organizer_name: input.organizerName || '',
    admin_key_hash: '',
    admin_key_issued_at: '',
    notes: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  var rule = {
    rule_id: ruleId,
    event_id: eventId,
    name: ruleName_(input.bestOf, input.provisional),
    format: RULE_FORMAT.BEST_OF_LEGS,
    best_of: input.bestOf,
    is_provisional: input.provisional,
    notes: input.provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  var stage = {
    stage_id: stageId,
    event_id: eventId,
    name: 'ロビン',
    type: STAGE_TYPE.ROUND_ROBIN,
    order: 1,
    rule_id: ruleId,
    parent_stage_id: '',
    config_json: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  var groupTable = ctx.table('Groups');
  var taken = Object.assign({}, groupTable.byKey);
  var groups = [];
  for (var i = 0; i < input.groupCount; i++) {
    var gid = newId_('GRP', taken);
    taken[gid] = true;
    groups.push({
      group_id: gid,
      event_id: eventId,
      stage_id: stageId,
      name: groupLabel_(i),
      order: i + 1,
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
  // 運営用の鍵はここで 1 回だけ平文で返し、シートにはハッシュだけを残す
  var adminKey = newEventKey_();
  event.admin_key_hash = eventKeyHash_(eventId, adminKey);
  event.admin_key_issued_at = ctx.now;
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), [rule]);
  appendRecords_(ctx.table('Stages'), [stage]);
  appendRecords_(groupTable, groups);
  ctx.invalidate();
  var logged = plain_(event);
  delete logged.admin_key_hash;
  recordHistory_(ctx, 'event.create', 'Event', eventId, eventId, null, { event: logged, rule: rule, groups: groups.length, by: ctx.user ? ctx.user.label : '' });
  return { event: event, rule: rule, stage: stage, groups: groups, adminKey: adminKey };
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

function actionCreateEvent_(ctx, payload) {
  assertCreateAllowed_(ctx, payload);
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    bestOf: parseBestOf_(payload.bestOf),
    provisional: payload.provisional === undefined ? true : requireBool_(payload.provisional, '暫定ルール'),
    groupCount: parseGroupCount_(payload.groupCount),
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

function hasAnyResult_(matches) {
  return matches.some(function (m) {
    return m.status !== MATCH_STATUS.SCHEDULED || (m.player1_legs || 0) !== 0 || (m.player2_legs || 0) !== 0;
  });
}

function actionUpdateRule_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (!bundle.rule) throw appError_('DATA_CONFLICT', '大会のルールが見つかりません。');
  var rules = ctx.table('Rules');
  var rule = findRecord_(rules, bundle.rule.rule_id, 'ルール');
  assertRev_(rule, requireRev_(payload.rev), 'ルール');
  var bestOf = parseBestOf_(payload.bestOf);
  if (bestOf !== rule.best_of && hasAnyResult_(bundle.matches)) {
    throw appError_('LOCKED', '結果が入力された試合があるため、Best of は変更できません。');
  }
  var before = plain_(rule);
  rule.best_of = bestOf;
  rule.is_provisional = requireBool_(payload.provisional, '暫定ルール');
  rule.name = ruleName_(bestOf, rule.is_provisional);
  rule.notes = rule.is_provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '';
  rule.rev = (rule.rev || 0) + 1;
  rule.updated_at = ctx.now;
  updateRecord_(rules, rule);
  recordHistory_(ctx, 'rule.update', 'Rule', rule.rule_id, eventId, before, plain_(rule));
  return { eventId: eventId };
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
    return {
      player_id: id,
      event_id: eventId,
      display_name: name,
      external_ref: '',
      notes: '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
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
    throw appError_('LOCKED', '対戦カードに含まれている選手は削除できません。先にそのグループの対戦カードを削除してください。');
  }
  var entries = ctx.table('Entries');
  var ownEntries = entries.rows.filter(function (e) {
    return e.player_id === player.player_id;
  });
  var before = plain_(player);
  deleteRecords_(entries, ownEntries);
  deleteRecords_(players, [player]);
  ctx.invalidate();
  recordHistory_(ctx, 'player.delete', 'Player', before.player_id, before.event_id, before, null);
  return { eventId: before.event_id };
}

/* ---------- グループ ---------- */

function stageMatches_(ctx, eventId) {
  return ctx.table('Matches').rows.filter(function (m) {
    return m.event_id === eventId;
  });
}

function actionSetGroupCount_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (!bundle.stage) throw appError_('DATA_CONFLICT', 'ロビンのステージが見つかりません。');
  var count = parseGroupCount_(payload.count);
  if (bundle.matches.length) {
    throw appError_('LOCKED', '対戦カード作成後はグループ数を変更できません。先に対戦カードを削除してください。');
  }
  var groups = ctx.table('Groups');
  var current = bundle.groups;
  if (count > current.length) {
    var taken = Object.assign({}, groups.byKey);
    var add = [];
    for (var i = current.length; i < count; i++) {
      var gid = newId_('GRP', taken);
      taken[gid] = true;
      add.push({
        group_id: gid,
        event_id: eventId,
        stage_id: bundle.stage.stage_id,
        name: groupLabel_(i),
        order: i + 1,
        rev: 1,
        created_at: ctx.now,
        updated_at: ctx.now,
      });
    }
    appendRecords_(groups, add);
  } else if (count < current.length) {
    var removed = current.slice(count);
    var removedIds = {};
    removed.forEach(function (g) {
      removedIds[g.group_id] = true;
    });
    var entries = ctx.table('Entries');
    deleteRecords_(
      entries,
      entries.rows.filter(function (e) {
        return removedIds[e.group_id];
      })
    );
    deleteRecords_(groups, removed);
  }
  ctx.invalidate();
  recordHistory_(ctx, 'group.count', 'Stage', bundle.stage.stage_id, eventId, { count: current.length }, { count: count });
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

function actionAssignPlayer_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var player = findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手');
  if (player.event_id !== eventId) throw appError_('BAD_REQUEST', '選手と大会の組み合わせが不正です。');
  var groupId = payload.groupId ? requireId_(payload.groupId, 'グループ') : '';
  var target = null;
  if (groupId) {
    target = bundle.groups.filter(function (g) {
      return g.group_id === groupId;
    })[0];
    if (!target) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  }
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.player_id === player.player_id;
  });
  var affected = {};
  if (groupId) affected[groupId] = true;
  current.forEach(function (e) {
    affected[e.group_id] = true;
  });
  var locked = bundle.matches.some(function (m) {
    return affected[m.group_id];
  });
  if (locked) {
    throw appError_('LOCKED', '対戦カード作成済みのグループの所属は変更できません。先にそのグループの対戦カードを削除してください。');
  }
  if (current.length === 1 && current[0].group_id === groupId) return { eventId: eventId };
  deleteRecords_(entries, current);
  ctx.invalidate('Entries');
  if (target) {
    var seed =
      bundle.entries.filter(function (e) {
        return e.group_id === groupId;
      }).length + 1;
    appendRecords_(ctx.table('Entries'), [
      {
        entry_id: newId_('ENT', ctx.table('Entries').byKey),
        event_id: eventId,
        stage_id: target.stage_id,
        group_id: groupId,
        player_id: player.player_id,
        seed: seed,
        rev: 1,
        created_at: ctx.now,
        updated_at: ctx.now,
      },
    ]);
  }
  ctx.invalidate();
  recordHistory_(ctx, 'entry.assign', 'Player', player.player_id, eventId, { groups: current.map(function (e) { return e.group_id; }) }, { group: groupId });
  return { eventId: eventId };
}

/** 登録順に A, B, C, D, A, B… と配る（シード・実力による振り分けはしない） */
function assignAllRoundRobin_(ctx, bundle) {
  var entries = ctx.table('Entries');
  deleteRecords_(entries, bundle.entries);
  ctx.invalidate('Entries');
  var players = bundle.players.slice().sort(function (a, b) {
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var seeds = {};
  var records = players.map(function (p, i) {
    var g = bundle.groups[i % bundle.groups.length];
    seeds[g.group_id] = (seeds[g.group_id] || 0) + 1;
    var id = newId_('ENT', taken);
    taken[id] = true;
    return {
      entry_id: id,
      event_id: bundle.event.event_id,
      stage_id: g.stage_id,
      group_id: g.group_id,
      player_id: p.player_id,
      seed: seeds[g.group_id],
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
  });
  appendRecords_(ctx.table('Entries'), records);
  ctx.invalidate();
  return records;
}

function actionAutoAssign_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (bundle.matches.length) {
    throw appError_('LOCKED', '対戦カード作成後は自動割り当てできません。先に対戦カードを削除してください。');
  }
  if (!bundle.groups.length) throw appError_('VALIDATION', 'グループがありません。');
  if (!bundle.players.length) throw appError_('VALIDATION', '選手が登録されていません。');
  var records = assignAllRoundRobin_(ctx, bundle);
  recordHistory_(ctx, 'entry.autoAssign', 'Stage', bundle.stage ? bundle.stage.stage_id : '', eventId, null, { assigned: records.length });
  return { eventId: eventId };
}

/* ---------- 対戦カード ---------- */

function generateGroupMatches_(ctx, bundle, group, taken) {
  var members = bundle.entries
    .filter(function (e) {
      return e.group_id === group.group_id;
    })
    .map(function (e) {
      return e.player_id;
    });
  return roundRobinPairings_(members).map(function (p) {
    var id = newId_('MAT', taken);
    taken[id] = true;
    return {
      match_id: id,
      event_id: bundle.event.event_id,
      stage_id: group.stage_id,
      group_id: group.group_id,
      round: p.round,
      order: p.order,
      player1_id: p.p1,
      player2_id: p.p2,
      player1_legs: 0,
      player2_legs: 0,
      status: MATCH_STATUS.SCHEDULED,
      winner_id: '',
      rule_id: '',
      next_match_id: '',
      next_match_slot: null,
      external_ref: '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
      confirmed_at: '',
    };
  });
}

function actionGenerateMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var targets = bundle.groups;
  if (payload.groupId) {
    var gid = requireId_(payload.groupId, 'グループ');
    targets = targets.filter(function (g) {
      return g.group_id === gid;
    });
    if (!targets.length) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  }
  var matchesTable = ctx.table('Matches');
  var taken = Object.assign({}, matchesTable.byKey);
  var created = [];
  var skipped = [];
  targets.forEach(function (g) {
    var exists = bundle.matches.some(function (m) {
      return m.group_id === g.group_id;
    });
    if (exists) {
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
  if (created.length) recordHistory_(ctx, 'match.generate', 'Stage', bundle.stage ? bundle.stage.stage_id : '', eventId, null, { created: created.length });
  return { eventId: eventId, created: created.length, skipped: skipped };
}

function actionClearMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var gid = requireId_(payload.groupId, 'グループ');
  var group = findRecord_(ctx.table('Groups'), gid, 'グループ');
  if (group.event_id !== eventId) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  var matchesTable = ctx.table('Matches');
  var targets = matchesTable.rows.filter(function (m) {
    return m.event_id === eventId && m.group_id === gid;
  });
  if (!targets.length) return { eventId: eventId, removed: 0 };
  if (hasAnyResult_(targets)) {
    throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  }
  deleteRecords_(matchesTable, targets);
  ctx.invalidate();
  recordHistory_(ctx, 'match.clear', 'Group', gid, eventId, { removed: targets.length }, null);
  return { eventId: eventId, removed: targets.length };
}

/* ---------- 試合結果 ---------- */

function actionSaveMatchResult_(ctx, payload) {
  var matchesTable = ctx.table('Matches');
  var match = findRecord_(matchesTable, requireId_(payload.matchId, '試合'), '試合');
  assertRev_(match, requireRev_(payload.rev), '試合');
  var status = payload.status;
  if (!MATCH_STATUS_LABEL[status]) throw appError_('VALIDATION', '試合状態が不正です。');
  var p1 = parseNonNegativeInt_(payload.p1Legs === '' || payload.p1Legs === undefined ? 0 : payload.p1Legs);
  var p2 = parseNonNegativeInt_(payload.p2Legs === '' || payload.p2Legs === undefined ? 0 : payload.p2Legs);
  if (p1 === null || p2 === null) throw appError_('VALIDATION', '取得 Leg 数は 0 以上の整数で入力してください。');
  if (match.status === MATCH_STATUS.FINAL && payload.correction !== true) {
    throw appError_('ALREADY_FINAL', '確定済みの試合です。結果を直す場合は「訂正」から操作してください。');
  }

  var bundle = collectEvent_(ctx, match.event_id);
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  if (!playerById[match.player1_id] || !playerById[match.player2_id] || match.player1_id === match.player2_id) {
    throw appError_('DATA_CONFLICT', 'この試合の選手情報が不正なため保存できません。');
  }
  var bestOf = bestOfFor_(bundle, match);
  var result = evaluateResult_(status, p1, p2, bestOf);
  if (!result.ok) throw appError_('VALIDATION', result.problems.join(' / '));

  var before = plain_(match);
  match.player1_legs = p1;
  match.player2_legs = p2;
  match.status = status;
  match.winner_id = result.winnerSide === 1 ? match.player1_id : result.winnerSide === 2 ? match.player2_id : '';
  match.confirmed_at = status === MATCH_STATUS.FINAL ? ctx.now : '';
  match.rev = (match.rev || 0) + 1;
  match.updated_at = ctx.now;
  updateRecord_(matchesTable, match);
  var action = before.status === MATCH_STATUS.FINAL ? 'match.correct' : 'match.result';
  recordHistory_(ctx, action, 'Match', match.match_id, match.event_id, pickResult_(before), pickResult_(match));
  return { eventId: match.event_id };
}

function pickResult_(m) {
  return {
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    player1_legs: m.player1_legs,
    player2_legs: m.player2_legs,
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
    bestOf: 5,
    provisional: true,
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
  var players = bundle.players.slice().sort(function (a, b) {
    return a.display_name < b.display_name ? -1 : 1;
  });
  var taken = {};
  var entries = players.map(function (p, idx) {
    var g = bundle.groups[Math.floor(idx / 4)];
    var id = newId_('ENT', taken);
    taken[id] = true;
    return {
      entry_id: id,
      event_id: eventId,
      stage_id: g.stage_id,
      group_id: g.group_id,
      player_id: p.player_id,
      seed: (idx % 4) + 1,
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
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
