/* 期制リーグ（v1.0）の操作: 作成・既存のリーグ大会からの移行・設定・入替戦・次期のプレビュー / 確定・前期の訂正の照合・会員の付け替え
 *
 * 権限は既存の大会ごとの仕組みに従う（07_api.js の scope と 02_auth.js）。期制リーグそのものには権限を持たせない。
 * - 期の大会を運営できる人（主催者・共同主催者・管理パスワード・管理者）: 入替戦を組む・プレビュー
 * - 期の大会の主催者・管理者だけ: 期制リーグの設定・次期の作成・訂正の照合・会員の付け替え・既存の大会の移行
 * - 次期の大会の主催者は前期の大会の主催者（同じ Google アカウント）。共同主催者・管理パスワードは引き継がない
 * 送られた大会 ID・会員 ID・選手 ID は、すべてサーバー側でその期制リーグのものか確かめる。
 */

/* ---------- 読み込み ---------- */

/** その大会の期の行（LeagueSeasons）。期制リーグの大会でなければ null */
function seasonRowOfEvent_(ctx, eventId) {
  var table = ctx.table('LeagueSeasons');
  var rows = table.rows.filter(function (r) {
    return r.event_id === eventId && !table.duplicates[r.season_key];
  });
  return rows.length === 1 ? rows[0] : null;
}

/** 大会の期制リーグの情報（collectEvent_ が bundle.season に入れる）。期制リーグでなければ null */
function seasonContext_(ctx, eventId) {
  var row = seasonRowOfEvent_(ctx, eventId);
  if (!row) return null;
  var league = ctx.table('Leagues').byKey[row.league_id];
  if (!league) return null;
  var all = ctx.table('LeagueSeasons')
    .rows.filter(function (r) {
      return r.league_id === row.league_id;
    })
    .sort(function (a, b) {
      return (a.season_no || 0) - (b.season_no || 0);
    });
  var next =
    all.filter(function (r) {
      return r.prev_event_id === eventId;
    })[0] || null;
  return { league: league, row: row, all: all, next: next, events: ctx.table('Events').byKey };
}

function requireSeason_(ctx, eventId) {
  var sc = seasonContext_(ctx, eventId);
  if (!sc) throw appError_('BAD_REQUEST', 'この大会は期制リーグの大会ではありません。');
  return sc;
}

function seasonLeagueStage_(bundle) {
  return (
    bundle.stages.filter(function (s) {
      return s.type === STAGE_TYPE.LEAGUE;
    })[0] || null
  );
}

function seasonPromotionStage_(bundle) {
  return (
    bundle.stages.filter(function (s) {
      return s.type === STAGE_TYPE.PROMOTION;
    })[0] || null
  );
}

/** 選手 ID → 会員 ID */
function memberOfPlayers_(bundle) {
  var out = {};
  bundle.players.forEach(function (p) {
    if (p.member_id) out[p.player_id] = p.member_id;
  });
  return out;
}

/**
 * 配置計算の入力: 今期のディビジョン（リーグ段階のグループ）の順位表と、入替戦の結果。
 * view は buildEventView_(bundle, true)
 */
function seasonInputs_(bundle, view) {
  var leagueStage = seasonLeagueStage_(bundle);
  if (!leagueStage) throw appError_('DATA_CONFLICT', 'この期の大会にリーグの段階がありません。');
  var lv = view.stages.filter(function (s) {
    return s.id === leagueStage.stage_id;
  })[0];
  var memberOf = memberOfPlayers_(bundle);
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  var missing = [];
  var divisions = (lv.groups || []).map(function (g, i) {
    var gp = g.progress;
    return {
      index: i + 1,
      groupId: g.id,
      name: g.name,
      complete: gp.total > 0 && gp.final === gp.total,
      progress: { final: gp.final, total: gp.total },
      rows: g.standings.map(function (s) {
        var p = playerById[s.playerId];
        var key = memberOf[s.playerId];
        if (!key) missing.push(p ? p.display_name : s.playerId);
        return { key: key || 'player:' + s.playerId, playerId: s.playerId, name: p ? p.display_name : '', rank: s.rank, tied: !!s.tied, withdrawn: p ? playerMeta_(p).withdrawn || null : null };
      }),
    };
  });
  var playoffs = [];
  var promo = seasonPromotionStage_(bundle);
  if (promo) {
    var pv = view.stages.filter(function (s) {
      return s.id === promo.stage_id;
    })[0];
    (pv.pairs || []).forEach(function (pair) {
      if (!pair.match) return;
      var m = pair.match;
      playoffs.push({
        upper: pair.upper,
        lower: pair.lower,
        upperKey: memberOf[m.p1.id] || '',
        lowerKey: memberOf[m.p2.id] || '',
        state: m.status,
        winnerKey: m.status === MATCH_STATUS.FINAL && m.winnerId ? memberOf[m.winnerId] || '' : '',
        confirmedAt: m.confirmedAt || '',
        resultType: m.resultType || '',
        matchId: m.id,
      });
    });
  }
  return { leagueStage: leagueStage, divisions: divisions, playoffs: playoffs, missing: missing };
}

/** 同じ期制リーグのほかの期の大会 ID（残っているものだけ） */
function seasonSiblings_(ctx, eventId) {
  var row = seasonRowOfEvent_(ctx, eventId);
  if (!row) return [];
  var events = ctx.table('Events').byKey;
  return ctx.table('LeagueSeasons')
    .rows.filter(function (r) {
      return r.league_id === row.league_id && r.event_id !== eventId && events[r.event_id];
    })
    .map(function (r) {
      return r.event_id;
    });
}

/** 期制リーグの会員（league の全員） */
function leagueMembers_(ctx, leagueId) {
  return ctx.table('LeagueMembers').rows.filter(function (m) {
    return m.league_id === leagueId;
  });
}

/** 今期にいない会員のうち、どこかの期に出たことがある人（復帰の候補） */
function rejoinCandidates_(ctx, sc, inSeason) {
  var seasonEvents = {};
  sc.all.forEach(function (r) {
    seasonEvents[r.event_id] = true;
  });
  var played = {};
  ctx.table('Players').rows.forEach(function (p) {
    if (p.member_id && seasonEvents[p.event_id]) played[p.member_id] = true;
  });
  var out = {};
  leagueMembers_(ctx, sc.league.league_id).forEach(function (m) {
    if (inSeason[m.member_id] || !played[m.member_id]) return;
    out[m.member_id] = { name: m.display_name, status: m.status || 'active' };
  });
  return out;
}

/* ---------- 入力の検証 ---------- */

function parseThresholds_(value) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value) || value.length > ADMIN_CONFIG.MAX_SEASON_DIVISIONS - 1) throw appError_('VALIDATION', 'ディビジョン数の境目の指定が不正です。');
  var out = value.map(function (v, i) {
    var n = typeof v === 'number' ? v : parseNonNegativeInt_(v);
    if (n === null || n < 2 || n > 9999 || Math.floor(n) !== n) throw appError_('VALIDATION', (i + 2) + ' 部制にする人数は 2〜9999 の整数で指定してください。');
    return n;
  });
  for (var i = 1; i < out.length; i++) {
    if (out[i] <= out[i - 1]) throw appError_('VALIDATION', 'ディビジョン数の境目は、部の数が増えるほど大きい人数にしてください（' + (i + 1) + ' 部制 ' + out[i - 1] + ' 人・' + (i + 2) + ' 部制 ' + out[i] + ' 人）。');
  }
  return out;
}

/** 部ごとの人数（目標人数・定員）。空欄は null */
function parseDivisionInts_(value, label) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value) || value.length > ADMIN_CONFIG.MAX_SEASON_DIVISIONS) throw appError_('VALIDATION', label + 'の指定が不正です。');
  return value.map(function (v, i) {
    if (v === '' || v === null || v === undefined) return null;
    var n = typeof v === 'number' ? v : parseNonNegativeInt_(v);
    if (n === null || n < 2 || n > 999 || Math.floor(n) !== n) throw appError_('VALIDATION', (i + 1) + '部の' + label + 'は 2〜999 の整数で指定してください（空欄 = 指定なし）。');
    return n;
  });
}

/** 期制リーグの設定（作成・変更で共通）。送られた項目だけを変える */
function parseLeagueConfig_(payload, current) {
  var cfg = current ? JSON.parse(JSON.stringify(current)) : {};
  if (payload.thresholds !== undefined) cfg.thresholds = parseThresholds_(payload.thresholds);
  if (payload.targets !== undefined) cfg.targets = parseDivisionInts_(payload.targets, '目標人数');
  if (payload.capacities !== undefined) cfg.capacities = parseDivisionInts_(payload.capacities, '定員');
  if (payload.cycles !== undefined) {
    // 総当たりの回数は既存と同じく 1 回・2 回だけ
    if (payload.cycles !== 1 && payload.cycles !== 2) throw appError_('VALIDATION', '総当たりの回数は 1 回か 2 回です。');
    cfg.cycles = payload.cycles;
  }
  if (payload.points !== undefined) cfg.points = parsePoints_(payload.points, { win: 2, draw: 1, loss: 0 });
  if (payload.rule !== undefined) cfg.rule = parseRuleInput_(payload.rule);
  if (payload.playoffRule !== undefined) {
    var pr = parseRuleInput_(payload.playoffRule);
    if (pr.format === 'fixed') throw appError_('VALIDATION', '入替戦は勝敗を決める必要があるため、固定 Leg 数（引き分けあり）は使えません。');
    cfg.playoffRule = pr;
  }
  // 勝ち点の既定値は、既存のリーグの作成と同じアプリの既定値（勝 2・分 1・負 0。主催者が変えられる）
  if (!isValidPoints_(cfg.points)) cfg.points = { win: 2, draw: 1, loss: 0 };
  if (cfg.cycles !== 2) cfg.cycles = 1;
  if (!cfg.thresholds) cfg.thresholds = [];
  if (!cfg.targets) cfg.targets = [];
  if (!cfg.capacities) cfg.capacities = [];
  (cfg.targets || []).forEach(function (t, i) {
    var cap = (cfg.capacities || [])[i];
    if (t && cap && t > cap) throw appError_('VALIDATION', (i + 1) + '部の目標人数（' + t + '）が定員（' + cap + '）を超えています。');
  });
  return cfg;
}

/**
 * 次期の配置の修正（プレビュー・確定で同じものを送る）。
 * edits = { leave: [会員 ID], rejoin: [会員 ID], join: [{ name }], moves: [{ key, division, reason }], names: [{ key, name }] }
 * join の選手は key = 'new:1'…（送った順）。会員 ID はこの期の会員・復帰の候補だけを受け付ける
 */
function parseSeasonEdits_(raw, inSeason, candidates) {
  var e = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var list = function (v, label, max) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > max) throw appError_('VALIDATION', label + 'の指定が不正です。');
    return v;
  };
  var seen = {};
  var leave = list(e.leave, '不参加', ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT).map(function (k) {
    if (!isValidId_(k) || !inSeason[k] || seen[k]) throw appError_('NOT_FOUND', '不参加にする選手が見つかりません。画面を再読み込みしてください。');
    seen[k] = true;
    return k;
  });
  var rejoin = list(e.rejoin, '復帰', ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT).map(function (k) {
    if (!isValidId_(k) || !candidates[k] || seen[k]) throw appError_('NOT_FOUND', '復帰させる会員が見つかりません。画面を再読み込みしてください。');
    seen[k] = true;
    return k;
  });
  var join = list(e.join, '新規参加', ADMIN_CONFIG.MAX_BULK_PLAYERS).map(function (j, i) {
    return { key: 'new:' + (i + 1), name: cleanText_(j && j.name, '新規参加の選手名（' + (i + 1) + '人目）', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH) };
  });
  var known = function (k) {
    return (inSeason[k] && !seen[k]) || rejoin.indexOf(k) !== -1 || /^new:\d{1,3}$/.test(k) && Number(k.slice(4)) >= 1 && Number(k.slice(4)) <= join.length;
  };
  var moves = {};
  list(e.moves, '手動の所属', ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT + ADMIN_CONFIG.MAX_BULK_PLAYERS).forEach(function (m) {
    var k = m && m.key;
    if (typeof k !== 'string' || !known(k) || moves[k]) throw appError_('NOT_FOUND', '手動の所属を指定した選手が見つかりません。画面を再読み込みしてください。');
    var div = typeof m.division === 'number' ? m.division : parseNonNegativeInt_(m.division);
    if (!(div >= 1 && div <= ADMIN_CONFIG.MAX_SEASON_DIVISIONS) || Math.floor(div) !== div) throw appError_('VALIDATION', '手動の所属のディビジョンが不正です。');
    moves[k] = { division: div, reason: cleanText_(m.reason, '手動の所属の理由', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true }) };
  });
  var names = {};
  list(e.names, '表示名', ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT).forEach(function (x) {
    var k = x && x.key;
    if (typeof k !== 'string' || !known(k) || names[k]) throw appError_('NOT_FOUND', '表示名を変える選手が見つかりません。画面を再読み込みしてください。');
    names[k] = cleanText_(x.name, '表示名', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
  });
  return { leave: leave, rejoin: rejoin, join: join, moves: moves, names: names };
}

/* ---------- 配置案（プレビュー・確定・照合で共通） ---------- */

/** 期の大会の配置案。edits は parseSeasonEdits_ 済み。何も書き込まない */
function seasonPlanFor_(ctx, eventId, edits, opts) {
  var sc = requireSeason_(ctx, eventId);
  var bundle = collectEvent_(ctx, eventId);
  var view = buildEventView_(bundle, true);
  var inputs = seasonInputs_(bundle, view);
  var inSeason = {};
  inputs.divisions.forEach(function (div) {
    div.rows.forEach(function (r) {
      inSeason[r.key] = true;
    });
  });
  var candidates = rejoinCandidates_(ctx, sc, inSeason);
  if (opts && opts.extraCandidates) {
    Object.keys(opts.extraCandidates).forEach(function (k) {
      candidates[k] = opts.extraCandidates[k];
    });
  }
  var cfg = leagueConfig_(sc.league);
  var plan = planSeasonPlacement_({
    seasonNo: sc.row.season_no,
    config: cfg,
    divisions: inputs.divisions,
    playoffs: inputs.playoffs,
    candidates: candidates,
    edits: edits || {},
  });
  if (inputs.missing.length) plan.problems.unshift('会員の ID がない選手がいます（' + inputs.missing.slice(0, 5).join('、') + '）。画面を再読み込みしてからもう一度お試しください。');
  var basis = seasonBasis_(inputs.divisions, plan.playoffs);
  var basisVersion = md5Hex_(JSON.stringify(basis));
  var planVersion = md5Hex_(JSON.stringify({ basis: basis, edits: edits || {}, config: cfg, eventId: eventId, rows: plan.rows.map(function (r) { return [r.key, r.name, r.newDivision]; }) }));
  return { sc: sc, bundle: bundle, view: view, inputs: inputs, plan: plan, basis: basis, basisVersion: basisVersion, planVersion: planVersion, candidates: candidates, config: cfg, inSeason: inSeason };
}

/** プレビューの応答（画面用）。会員 ID・名前・前期の所属と順位・昇降格・新しい所属・理由 */
function seasonPlanView_(res) {
  var plan = res.plan;
  return {
    seasonNo: res.sc.row.season_no,
    nextSeasonNo: res.sc.row.season_no + 1,
    leagueName: res.sc.league.name,
    divisionCount: plan.divisionCount,
    previousDivisionCount: plan.previousDivisionCount,
    total: plan.total,
    divisions: plan.divisions.map(function (d) {
      return { index: d.index, name: d.name, size: d.size, target: d.target, capacity: d.capacity };
    }),
    rows: plan.rows,
    playoffs: plan.playoffs,
    problems: plan.problems,
    warnings: plan.warnings,
    ok: plan.problems.length === 0,
    planVersion: res.planVersion,
    basisVersion: res.basisVersion,
    candidates: Object.keys(res.candidates).map(function (k) {
      return { key: k, name: res.candidates[k].name, status: res.candidates[k].status };
    }),
    thresholds: res.config.thresholds,
    targets: res.config.targets,
    capacities: res.config.capacities,
  };
}

/* ---------- 作成・移行・設定 ---------- */

function newLeagueRecord_(ctx, name, cfg) {
  var table = ctx.table('Leagues');
  var id = newId_('LGS', table.byKey);
  var rec = { league_id: id, name: name, config_json: JSON.stringify(cfg), rev: 1, created_at: ctx.now, updated_at: ctx.now };
  appendRecords_(table, [rec]);
  return rec;
}

function newSeasonRecord_(ctx, leagueId, seasonNo, eventId, prevEventId, plan) {
  var table = ctx.table('LeagueSeasons');
  var id = newId_('LSN', table.byKey);
  var rec = {
    season_key: id,
    league_id: leagueId,
    season_no: seasonNo,
    event_id: eventId,
    prev_event_id: prevEventId || '',
    plan_json: plan ? JSON.stringify(plan) : '',
    confirmed_at: plan ? ctx.now : '',
    confirmed_by: plan && ctx.user ? ctx.user.label : '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  appendRecords_(table, [rec]);
  return rec;
}

function parseLeagueName_(value) {
  return cleanText_(value, '期制リーグの名前', ADMIN_CONFIG.MAX_LEAGUE_NAME_LENGTH);
}

function seasonEventName_(leagueName, no) {
  var name = leagueName + ' 第' + no + '期';
  return name.length > ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH ? name.slice(0, ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH) : name;
}

/** 入替戦の段階（ルールと、隣接するディビジョンの組ごとのグループ）を作る */
function addPromotionStage_(ctx, eventId, order, spec, divisionCount) {
  var rule = newRuleRecord_(ctx, eventId, spec, Object.assign({}, ctx.table('Rules').byKey));
  var stage = newStageRecord_(ctx, eventId, { name: '入替戦', type: STAGE_TYPE.PROMOTION, order: order, ruleId: rule.rule_id, config: {} }, Object.assign({}, ctx.table('Stages').byKey));
  appendRecords_(ctx.table('Rules'), [rule]);
  appendRecords_(ctx.table('Stages'), [stage]);
  syncPromotionGroups_(ctx, stage, divisionCount);
  return stage;
}

/** 入替戦の段階のグループを、ディビジョン数に合わせる（k 部・k+1 部の組ごとに 1 つ） */
function syncPromotionGroups_(ctx, stage, divisionCount) {
  var groups = ctx.table('Groups');
  var current = groups.rows
    .filter(function (g) {
      return g.stage_id === stage.stage_id;
    })
    .sort(byOrder_);
  var want = Math.max(0, divisionCount - 1);
  var taken = Object.assign({}, groups.byKey);
  var add = [];
  for (var k = 1; k <= want; k++) {
    var meta = JSON.stringify({ upper: k, lower: k + 1 });
    var name = k + '部・' + (k + 1) + '部 入替戦';
    var g = current[k - 1];
    if (g) {
      if (g.name !== name || g.meta_json !== meta || g.order !== k) {
        g.name = name;
        g.meta_json = meta;
        g.order = k;
        g.rev = (g.rev || 0) + 1;
        g.updated_at = ctx.now;
        updateRecord_(groups, g);
      }
    } else {
      var id = newId_('GRP', taken);
      taken[id] = true;
      add.push({ group_id: id, event_id: stage.event_id, stage_id: stage.stage_id, name: name, order: k, meta_json: meta, rev: 1, created_at: ctx.now, updated_at: ctx.now });
    }
  }
  appendRecords_(groups, add);
  if (current.length > want) deleteRecords_(groups, current.slice(want));
}

/** 入替戦のルール（期制リーグの設定。なければリーグのルール。固定 Leg 数のときは Best of 5 Legs） */
function playoffRuleSpec_(cfg, leagueRuleSpec) {
  if (cfg.playoffRule) return cfg.playoffRule;
  var base = leagueRuleSpec || { format: 'legs', bestOf: 5, setBestOf: null, provisional: true };
  if (base.format === 'fixed') return { format: 'legs', bestOf: 5, setBestOf: null, provisional: base.provisional };
  return base;
}

/**
 * 期制リーグを作る（1 期目の大会と一緒に）。1 期目は全員が 1 つのリーグで総当たり（1 回・2 回）。
 * payload = { name, dateLabel, organizerName, rule, cycles, points, thresholds, targets, capacities, playoffRule }
 */
function actionCreateSeasonLeague_(ctx, payload) {
  assertCreateAllowed_(ctx);
  var name = parseLeagueName_(payload.name);
  var cfg = parseLeagueConfig_({
    thresholds: payload.thresholds,
    targets: payload.targets,
    capacities: payload.capacities,
    cycles: payload.cycles === 2 ? 2 : 1,
    points: payload.points,
    rule: payload.rule || { format: 'legs', bestOf: 5, provisional: true },
    playoffRule: payload.playoffRule,
  });
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: seasonEventName_(name, 1),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    rule: cfg.rule,
    template: 'league',
    divisions: 1,
    cycles: cfg.cycles,
    points: cfg.points,
    owner: creatorOwner_(ctx),
  });
  var league = newLeagueRecord_(ctx, name, cfg);
  newSeasonRecord_(ctx, league.league_id, 1, created.event.event_id, '', null);
  recordHistory_(ctx, 'season.leagueCreate', 'League', league.league_id, created.event.event_id, null, { league: name, season: 1, config: cfg, by: ctx.user ? ctx.user.label : '' });
  return { eventId: created.event.event_id, leagueId: league.league_id };
}

/**
 * 既存のリーグの大会（リーグの段階だけの大会）を、期制リーグの期にする（移行）。
 * 選手ごとに新しい会員 ID を作る（名前で他の大会の選手と結び付けない）。ディビジョンが 2 つ以上なら入替戦の段階を足す
 * payload = { eventId, name, seasonNo?, thresholds, targets, capacities, playoffRule? }
 */
function actionConvertToSeasonLeague_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '期制リーグへの移行');
  if (seasonRowOfEvent_(ctx, eventId) || ctx.table('LeagueSeasons').rows.some(function (r) { return r.event_id === eventId; })) {
    throw appError_('LOCKED', 'この大会はすでに期制リーグの期です。');
  }
  var bundle = collectEvent_(ctx, eventId);
  if (bundle.stages.length !== 1 || bundle.stages[0].type !== STAGE_TYPE.LEAGUE) {
    throw appError_('VALIDATION', '期制リーグにできるのは、リーグの段階だけの大会です（プレーオフなど他の段階がある大会は移行できません）。');
  }
  var stage = bundle.stages[0];
  var stageCfg = stageConfig_(stage);
  var leagueRule = stageRule_(bundle, stage);
  var seasonNo = parseSmallInt_(payload.seasonNo, 'この大会の期', 1, ADMIN_CONFIG.MAX_LEAGUE_SEASONS, 1);
  var cfg = parseLeagueConfig_({
    thresholds: payload.thresholds,
    targets: payload.targets,
    capacities: payload.capacities,
    cycles: stageCfg.cycles,
    points: stageCfg.points || { win: 2, draw: 1, loss: 0 },
    rule: leagueRule ? ruleSpecOf_(leagueRule) : { format: 'legs', bestOf: 5, provisional: true },
    playoffRule: payload.playoffRule,
  });
  var league = newLeagueRecord_(ctx, parseLeagueName_(payload.name), cfg);
  newSeasonRecord_(ctx, league.league_id, seasonNo, eventId, '', null);
  var groups = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  if (groups.length > 1) addPromotionStage_(ctx, eventId, (stage.order || 1) + 1, playoffRuleSpec_(cfg, cfg.rule), groups.length);
  ensureSeasonMembers_(ctx, eventId);
  recordHistory_(ctx, 'season.convert', 'League', league.league_id, eventId, null, { league: league.name, season: seasonNo, divisions: groups.length, players: bundle.players.length });
  return { eventId: eventId, leagueId: league.league_id };
}

/** 期制リーグの設定（主催者・管理者）。payload = { eventId, rev（Leagues の版）, name?, thresholds?, targets?, capacities?, cycles?, points?, rule?, playoffRule? } */
function actionUpdateLeagueSettings_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '期制リーグの設定');
  var sc = requireSeason_(ctx, eventId);
  var table = ctx.table('Leagues');
  var league = findRecord_(table, sc.league.league_id, '期制リーグ');
  assertRev_(league, requireRev_(payload.rev), '期制リーグの設定');
  var before = safeJson_(league.config_json, {});
  var cfg = parseLeagueConfig_(payload, before);
  if (payload.name !== undefined) league.name = parseLeagueName_(payload.name);
  league.config_json = JSON.stringify(cfg);
  league.rev = (league.rev || 0) + 1;
  league.updated_at = ctx.now;
  updateRecord_(table, league);
  recordHistory_(ctx, 'season.settings', 'League', league.league_id, eventId, before, cfg);
  // 期の一覧（期制リーグの名前）が公開データに入るので、公開中の期を作り直す
  return { eventId: eventId, alsoPublish: seasonSiblings_(ctx, eventId) };
}

/* ---------- 会員の付与（書き込み操作の後に呼ぶ） ---------- */

/**
 * 期の大会の選手に会員 ID がなければ新しく作る（1 人に 1 つ。名前で他の期の選手と結び付けない）。
 * どの期の選手にもならなくなった参加中の会員（選手を消した場合）は消す。
 */
function ensureSeasonMembers_(ctx, eventId) {
  var row = seasonRowOfEvent_(ctx, eventId);
  if (!row) return 0;
  var players = ctx.table('Players');
  var members = ctx.table('LeagueMembers');
  var mine = players.rows.filter(function (p) {
    return p.event_id === eventId;
  });
  var taken = Object.assign({}, members.byKey);
  var add = [];
  mine.forEach(function (p) {
    if (p.member_id && members.byKey[p.member_id] && members.byKey[p.member_id].league_id === row.league_id) return;
    var id = newId_('LMB', taken);
    taken[id] = true;
    add.push({ member_id: id, league_id: row.league_id, display_name: p.display_name, status: 'active', meta_json: JSON.stringify({ joinedSeason: row.season_no, via: 'player', at: ctx.now }), rev: 1, created_at: ctx.now, updated_at: ctx.now });
    p.member_id = id;
    p.rev = (p.rev || 0) + 1;
    p.updated_at = ctx.now;
    updateRecord_(players, p);
  });
  if (leagueMembers_(ctx, row.league_id).length + add.length > ADMIN_CONFIG.MAX_LEAGUE_MEMBERS) throw appError_('LIMIT', '期制リーグの会員は ' + ADMIN_CONFIG.MAX_LEAGUE_MEMBERS + ' 人までです。');
  appendRecords_(members, add);
  // 参加中なのにどの選手にもなっていない会員（この期で選手を消した場合）を消す
  var used = {};
  players.rows.forEach(function (p) {
    if (p.member_id) used[p.member_id] = true;
  });
  var orphans = members.rows.filter(function (m) {
    return m.league_id === row.league_id && (m.status || 'active') === 'active' && !used[m.member_id] && safeJson_(m.meta_json, {}).via === 'player';
  });
  if (orphans.length) deleteRecords_(members, orphans);
  return add.length;
}

/**
 * 選手を、同じ期制リーグの別の会員に付け替える（主催者・管理者。期の途中で復帰した人を以前の会員に戻すなど）。
 * 付け替え先は、この期にまだいない会員だけ。名前での自動の対応付けはしない
 */
function actionSetPlayerMember_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '会員の付け替え');
  var sc = requireSeason_(ctx, eventId);
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  if (player.event_id !== eventId) throw appError_('NOT_FOUND', '選手が見つかりません。');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var memberId = requireId_(payload.memberId, '会員');
  var member = ctx.table('LeagueMembers').byKey[memberId];
  if (!member || member.league_id !== sc.league.league_id) throw appError_('NOT_FOUND', '会員が見つかりません。');
  var already = players.rows.some(function (p) {
    return p.event_id === eventId && p.member_id === memberId && p.player_id !== player.player_id;
  });
  if (already) throw appError_('VALIDATION', 'その会員はこの期の別の選手に付いています。');
  var before = player.member_id;
  player.member_id = memberId;
  player.rev = (player.rev || 0) + 1;
  player.updated_at = ctx.now;
  updateRecord_(players, player);
  if (member.status === 'left') {
    var meta = safeJson_(member.meta_json, {});
    meta.rejoinedSeason = sc.row.season_no;
    member.status = 'active';
    member.meta_json = JSON.stringify(meta);
    member.rev = (member.rev || 0) + 1;
    member.updated_at = ctx.now;
    updateRecord_(ctx.table('LeagueMembers'), member);
  }
  recordHistory_(ctx, 'season.setMember', 'Player', player.player_id, eventId, { member: before }, { member: memberId });
  return { eventId: eventId };
}

/* ---------- 入替戦 ---------- */

/**
 * 入替戦を組む（今期のリーグの全試合が確定した後）。A の下から 2 位（1 番目の枠）と B の 2 位（2 番目の枠）。
 * redo: true で組み直し（入替戦の試合がどれも始まっていないときだけ）。棄権・失格した選手の試合は相手の不戦勝にする
 */
function actionGeneratePlayoffs_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var sc = requireSeason_(ctx, eventId);
  var bundle = collectEvent_(ctx, eventId);
  var view = buildEventView_(bundle, true);
  var inputs = seasonInputs_(bundle, view);
  var d = inputs.divisions.length;
  if (d < 2) throw appError_('VALIDATION', 'ディビジョンが 1 つの期には入替戦はありません。');
  var open = inputs.divisions.filter(function (div) {
    return !div.complete;
  });
  if (open.length) throw appError_('LOCKED', 'リーグの全試合が確定してから入替戦を組んでください（' + open.map(function (div) { return div.name + ' 確定 ' + div.progress.final + ' / ' + div.progress.total; }).join('、') + '）。');
  var roles = seasonRoles_(inputs.divisions);
  if (roles.problems.length) throw appError_('TIE', roles.problems.join(' / '));
  var stage = seasonPromotionStage_(bundle);
  var cfg = leagueConfig_(sc.league);
  if (!stage) {
    var lr = stageRule_(bundle, inputs.leagueStage);
    stage = addPromotionStage_(ctx, eventId, bundle.stages.reduce(function (mx, s) { return Math.max(mx, s.order || 0); }, 0) + 1, playoffRuleSpec_(cfg, lr ? ruleSpecOf_(lr) : null), d);
  } else {
    syncPromotionGroups_(ctx, stage, d);
  }
  var matchesTable = ctx.table('Matches');
  var existing = matchesTable.rows.filter(function (m) {
    return m.stage_id === stage.stage_id;
  });
  var memberOf = memberOfPlayers_(bundle);
  var playerOfMember = {};
  Object.keys(memberOf).forEach(function (pid) {
    playerOfMember[memberOf[pid]] = pid;
  });
  var same = existing.length === roles.playoffs.length && roles.playoffs.every(function (pf) {
    return existing.some(function (m) {
      return memberOf[m.player1_id] === pf.upperKey && memberOf[m.player2_id] === pf.lowerKey;
    });
  });
  if (existing.length && same && payload.redo !== true) throw appError_('LOCKED', '入替戦は組んであります（今の順位と同じ対戦です）。');
  if (existing.some(matchStarted_)) throw appError_('LOCKED', '入替戦の試合に結果が入っているため組み直せません。組み直す場合は、先に入替戦の試合を「未開始に戻す」にしてください。');
  deleteRecords_(matchesTable, existing);
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  var groups = ctx.table('Groups').rows
    .filter(function (g) {
      return g.stage_id === stage.stage_id;
    })
    .sort(byOrder_);
  var taken = Object.assign({}, matchesTable.byKey);
  var entTaken = Object.assign({}, entries.byKey);
  var newMatches = [];
  var newEntries = [];
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  roles.playoffs.forEach(function (pf, i) {
    var g = groups[pf.upper - 1];
    var up = inputs.divisions[pf.upper - 1];
    var low = inputs.divisions[pf.lower - 1];
    var p1 = playerOfMember[pf.upperKey];
    var p2 = playerOfMember[pf.lowerKey];
    var rank1 = up.rows[up.rows.length - 2].rank;
    var rank2 = low.rows[1].rank;
    newEntries.push(newEntry_(ctx, stage, g.group_id, p1, 1, entTaken, up.name + ' ' + rank1 + '位'));
    newEntries.push(newEntry_(ctx, stage, g.group_id, p2, 2, entTaken, low.name + ' ' + rank2 + '位'));
    var id = newId_('MAT', taken);
    taken[id] = true;
    var m = blankMatch_(ctx, stage, g.group_id, id);
    m.round = 1;
    m.order = i + 1;
    m.label = '入替戦';
    m.player1_id = p1;
    m.player2_id = p2;
    m.meta_json = JSON.stringify({ playoff: { upper: pf.upper, lower: pf.lower, upperRank: rank1, lowerRank: rank2, at: ctx.now } });
    // 棄権・失格した選手（片方だけ）の入替戦は相手の不戦勝
    var w1 = isWithdrawn_(playerById[p1]);
    var w2 = isWithdrawn_(playerById[p2]);
    if (w1 !== w2) {
      var loser = w1 ? playerById[p1] : playerById[p2];
      var wd = playerMeta_(loser).withdrawn;
      m.status = MATCH_STATUS.FINAL;
      m.result_type = wd.kind === 'disqualified' ? RESULT_TYPE.DISQUALIFIED : RESULT_TYPE.WALKOVER;
      m.result_note = wd.reason || '';
      m.player1_legs = null;
      m.player2_legs = null;
      m.winner_id = w1 ? p2 : p1;
      m.confirmed_at = ctx.now;
    }
    newMatches.push(m);
  });
  appendRecords_(entries, newEntries);
  appendRecords_(matchesTable, newMatches);
  recordHistory_(ctx, existing.length ? 'season.playoffsRedo' : 'season.playoffs', 'Stage', stage.stage_id, eventId, existing.length ? { removed: existing.length } : null, {
    pairs: newMatches.map(function (m) {
      return [m.player1_id, m.player2_id, m.result_type || ''];
    }),
  });
  return { eventId: eventId, created: newMatches.length };
}

/** 入替戦の組み合わせを消す（どれも始まっていないときだけ） */
function actionClearPlayoffs_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  requireSeason_(ctx, eventId);
  var bundle = collectEvent_(ctx, eventId);
  var stage = seasonPromotionStage_(bundle);
  if (!stage) return { eventId: eventId, removed: 0 };
  var table = ctx.table('Matches');
  var list = table.rows.filter(function (m) {
    return m.stage_id === stage.stage_id;
  });
  if (list.some(matchStarted_)) throw appError_('LOCKED', '入替戦の試合に結果が入っているため消せません。先に「未開始に戻す」にしてください。');
  deleteRecords_(table, list);
  deleteRecords_(ctx.table('Entries'), ctx.table('Entries').rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  recordHistory_(ctx, 'season.playoffsClear', 'Stage', stage.stage_id, eventId, { removed: list.length }, null);
  return { eventId: eventId, removed: list.length };
}

/* ---------- 次期のプレビュー・確定 ---------- */

function actionPreviewNextSeason_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var sc = requireSeason_(ctx, eventId);
  var probe = seasonPlanFor_(ctx, eventId, {});
  var edits = parseSeasonEdits_(payload.edits, probe.inSeason, probe.candidates);
  var res = seasonPlanFor_(ctx, eventId, edits);
  var out = seasonPlanView_(res);
  if (sc.next) out.nextEventId = ctx.table('Events').byKey[sc.next.event_id] ? sc.next.event_id : '';
  out.canConfirm = eventRole_(ctx.user, ctx.table('Events').byKey[eventId], ctx) === 'owner' || eventRole_(ctx.user, ctx.table('Events').byKey[eventId], ctx) === 'admin';
  return out;
}

/**
 * 次期の作成が途中で止まった跡（期の行はあるが大会の行がない）を消す。大会に属する行も消してから作り直す
 */
function removeBrokenSeason_(ctx, seasonRow) {
  var id = seasonRow.event_id;
  ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'Collaborators'].forEach(function (name) {
    var t = ctx.table(name);
    deleteRecords_(t, t.rows.filter(function (r) {
      return r.event_id === id;
    }));
  });
  deleteRecords_(ctx.table('LeagueSeasons'), [seasonRow]);
  recordHistory_(ctx, 'season.repair', 'League', seasonRow.league_id, '', null, { removedEventId: id, seasonNo: seasonRow.season_no });
}

/**
 * 確定して次期の大会を作る（期の大会の主催者・管理者）。
 * payload = { eventId（今期）, edits, planVersion（プレビューの版）, name?, dateLabel? }
 * - 同じ期から次期を 2 つ作らない（作成済みなら、その大会を返すだけ。二重送信・再試行・別の画面からの確定）
 * - プレビューの後に結果・設定・修正が変わっていたら作らない（CONFLICT。プレビューし直してもらう）
 * - 問題（同順位・入替戦の未確定・人数不足・定員超過など）が残っていれば作らない
 */
function actionConfirmNextSeason_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '次期の作成');
  var sc = requireSeason_(ctx, eventId);
  if (sc.next) {
    if (ctx.table('Events').byKey[sc.next.event_id]) return { eventId: sc.next.event_id, existing: true };
    removeBrokenSeason_(ctx, sc.next);
  }
  var later = sc.all.filter(function (r) {
    return (r.season_no || 0) > (sc.row.season_no || 0) && ctx.table('Events').byKey[r.event_id];
  });
  if (later.length) throw appError_('LOCKED', 'この期より後の期（第' + later[0].season_no + '期）があるため、次期は作れません。');
  if (sc.row.season_no >= ADMIN_CONFIG.MAX_LEAGUE_SEASONS) throw appError_('LIMIT', '期は ' + ADMIN_CONFIG.MAX_LEAGUE_SEASONS + ' 期までです。');
  var probe = seasonPlanFor_(ctx, eventId, {});
  var edits = parseSeasonEdits_(payload.edits, probe.inSeason, probe.candidates);
  var res = seasonPlanFor_(ctx, eventId, edits);
  if (typeof payload.planVersion !== 'string' || payload.planVersion !== res.planVersion) {
    throw appError_('CONFLICT', 'プレビューの後に結果・設定・修正が変わりました。もう一度「次期の配置をプレビュー」してから確定してください。');
  }
  if (res.plan.problems.length) throw appError_('VALIDATION', '次の点を解決するまで次期は作れません: ' + res.plan.problems.slice(0, 6).join(' / ') + (res.plan.problems.length > 6 ? ' ほか ' + (res.plan.problems.length - 6) + ' 件' : ''));
  // 大会の作成の上限（1 時間あたりの作成数など）は、作れることが分かってから数える
  assertCreateAllowed_(ctx);
  var prev = res.bundle.event;
  var cfg = res.config;
  var nextNo = sc.row.season_no + 1;
  var plan = res.plan;
  var leagueStagePrev = res.inputs.leagueStage;
  var prevRule = stageRule_(res.bundle, leagueStagePrev);
  var ruleSpec = cfg.rule || (prevRule ? ruleSpecOf_(prevRule) : { format: 'legs', bestOf: 5, setBestOf: null, provisional: true });
  var created = createEventRecords_(ctx, {
    organizerName: prev.organizer_name || '',
    name: payload.name ? cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH) : seasonEventName_(sc.league.name, nextNo),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    rule: ruleSpec,
    template: 'league',
    divisions: plan.divisionCount,
    cycles: cfg.cycles,
    points: cfg.points,
    // 主催者は前期と同じ（管理者が作っても主催者は変わらない）。共同主催者・管理パスワードは引き継がない
    owner: { owner_email: prev.owner_email, owner_sub: prev.owner_sub, owner_link_json: prev.owner_link_json },
  });
  var ev = created.event;
  // 前期の大会の表示の設定（タイムゾーン・ルールの表示・公開する項目）を引き継ぐ。お知らせは引き継がない
  var prevCfg = safeJson_(prev.config_json, {});
  var evCfg = safeJson_(ev.config_json, {});
  ['timezone', 'ruleDisplay', 'publicFields'].forEach(function (k) {
    if (prevCfg[k] !== undefined) evCfg[k] = prevCfg[k];
  });
  ev.config_json = JSON.stringify(evCfg);
  var leagueStage = created.stages[0];
  var lsCfg = safeJson_(leagueStage.config_json, {});
  var prevLsCfg = safeJson_(leagueStagePrev.config_json, {});
  if (Array.isArray(prevLsCfg.tiebreakers)) lsCfg.tiebreakers = prevLsCfg.tiebreakers;
  if (prevLsCfg.walkoverLegs) lsCfg.walkoverLegs = prevLsCfg.walkoverLegs;
  leagueStage.config_json = JSON.stringify(lsCfg);
  var groups = created.groups.sort(byOrder_);
  groups.forEach(function (g, i) {
    g.name = seasonDivisionName_(i + 1, plan.divisionCount);
  });
  if (plan.divisionCount > 1) addPromotionStage_(ctx, ev.event_id, 2, playoffRuleSpec_(cfg, ruleSpec), plan.divisionCount);

  // 会員: 新規参加を作り、復帰を参加中に、不参加を脱退にする。表示名は今期の名前（変えたものはその名前）
  var membersTable = ctx.table('LeagueMembers');
  var memTaken = Object.assign({}, membersTable.byKey);
  var keyToMember = {};
  var addMembers = [];
  plan.rows.forEach(function (row) {
    if (row.movement === 'new') {
      var id = newId_('LMB', memTaken);
      memTaken[id] = true;
      keyToMember[row.key] = id;
      addMembers.push({ member_id: id, league_id: sc.league.league_id, display_name: row.name, status: 'active', meta_json: JSON.stringify({ joinedSeason: nextNo, via: 'season', at: ctx.now, names: [] }), rev: 1, created_at: ctx.now, updated_at: ctx.now });
      return;
    }
    keyToMember[row.key] = row.key;
    var m = membersTable.byKey[row.key];
    if (!m) return;
    var meta = safeJson_(m.meta_json, {});
    var changed = false;
    if (row.movement === 'leave') {
      if (m.status !== 'left') {
        m.status = 'left';
        meta.leftAfterSeason = sc.row.season_no;
        changed = true;
      }
    } else {
      if (m.status === 'left' || row.movement === 'return') {
        m.status = 'active';
        meta.rejoinedSeason = nextNo;
        changed = true;
      }
      if (m.display_name !== row.name) {
        meta.names = (Array.isArray(meta.names) ? meta.names : []).concat([{ name: m.display_name, until: ctx.now }]).slice(-20);
        m.display_name = row.name;
        changed = true;
      }
      // 期をまたいで続く会員は、選手を消しても会員は消さない
      if (meta.via === 'player') {
        meta.via = 'season';
        changed = true;
      }
    }
    if (changed) {
      m.meta_json = JSON.stringify(meta);
      m.rev = (m.rev || 0) + 1;
      m.updated_at = ctx.now;
      updateRecord_(membersTable, m);
    }
  });
  appendRecords_(membersTable, addMembers);

  // 選手と所属（梯子の順をシードにする）。所属・Rt は前期の選手から写す（非公開メモは写さない）
  var prevPlayerOf = {};
  res.bundle.players.forEach(function (p) {
    if (p.member_id) prevPlayerOf[p.member_id] = p;
  });
  var playersTable = ctx.table('Players');
  var plTaken = Object.assign({}, playersTable.byKey);
  var newPlayers = [];
  var playerOfKey = {};
  plan.rows.forEach(function (row) {
    if (row.movement === 'leave') return;
    var pid = newId_('PLY', plTaken);
    plTaken[pid] = true;
    var old = prevPlayerOf[row.key];
    playerOfKey[row.key] = pid;
    newPlayers.push({ player_id: pid, event_id: ev.event_id, display_name: row.name, external_ref: '', notes: '', affiliation: old ? old.affiliation || '' : '', rating: old && old.rating !== null && old.rating !== undefined ? String(old.rating) : '', seed: null, meta_json: '', rev: 1, created_at: ctx.now, updated_at: ctx.now, member_id: keyToMember[row.key] });
  });
  if (newPlayers.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) throw appError_('VALIDATION', '1 大会の選手は ' + ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT + ' 名までです（次期 ' + newPlayers.length + ' 名）。');
  appendRecords_(playersTable, newPlayers);
  var entTaken = Object.assign({}, ctx.table('Entries').byKey);
  var newEntries = [];
  plan.divisions.forEach(function (div) {
    var g = groups[div.index - 1];
    div.members.forEach(function (key, i) {
      newEntries.push(newEntry_(ctx, leagueStage, g.group_id, playerOfKey[key], i + 1, entTaken, ''));
    });
  });
  appendRecords_(ctx.table('Entries'), newEntries);

  // 確定の記録（前期の所属・順位・昇降格・入替戦・新しい所属・理由・手動の修正）
  var record = {
    planVersion: res.planVersion,
    basis: res.basis,
    basisVersion: res.basisVersion,
    divisionCount: plan.divisionCount,
    sizes: plan.divisions.map(function (dv) {
      return dv.size;
    }),
    playoffs: plan.playoffs,
    edits: {
      leave: edits.leave,
      rejoin: edits.rejoin.concat(
        edits.join.map(function (j) {
          return keyToMember[j.key];
        })
      ),
      moves: Object.keys(edits.moves).map(function (k) {
        return { key: keyToMember[k] || k, division: edits.moves[k].division, reason: edits.moves[k].reason };
      }),
      names: Object.keys(edits.names).map(function (k) {
        return { key: keyToMember[k] || k, name: edits.names[k] };
      }),
    },
    rows: plan.rows.map(function (r) {
      return { key: keyToMember[r.key] || r.key, name: r.name, from: r.from, movement: r.movement, autoDivision: r.autoDivision, newDivision: r.newDivision, reasons: r.reasons, manual: r.manual };
    }),
    warnings: plan.warnings,
    log: [],
  };
  newSeasonRecord_(ctx, sc.league.league_id, nextNo, ev.event_id, eventId, record);
  recordHistory_(ctx, 'season.next', 'League', sc.league.league_id, eventId, null, { nextEventId: ev.event_id, season: nextNo, divisions: plan.divisionCount, sizes: record.sizes, by: ctx.user ? ctx.user.label : '' });
  recordHistory_(ctx, 'season.created', 'League', sc.league.league_id, ev.event_id, null, { from: eventId, season: nextNo, rows: record.rows.length });
  return { eventId: ev.event_id, alsoPublish: [eventId], createdFrom: eventId };
}

/* ---------- 前期の訂正の照合（次期を作った後） ---------- */

/** 確定の記録（plan_json）から、照合に使う修正（会員 ID に置き換えたもの）を作る */
function storedEdits_(record) {
  var e = record && record.edits ? record.edits : {};
  var moves = {};
  (e.moves || []).forEach(function (m) {
    moves[m.key] = { division: m.division, reason: m.reason };
  });
  var names = {};
  (e.names || []).forEach(function (x) {
    names[x.key] = x.name;
  });
  return { leave: e.leave || [], rejoin: e.rejoin || [], join: [], moves: moves, names: names };
}

/**
 * 次期（nextRow）を作った後に前期の結果が変わったか。変わっていれば、今の結果で計算した所属と、次期の実際の所属の違い。
 * 次期の所属は黙って書き換えない（主催者が照合の画面で、反映か承認（記録として残す）を選ぶ）
 */
function seasonDrift_(ctx, nextRow) {
  var record = safeJson_(nextRow.plan_json, null);
  if (!record || !nextRow.prev_event_id || !ctx.table('Events').byKey[nextRow.prev_event_id]) return null;
  var nextEvent = ctx.table('Events').byKey[nextRow.event_id];
  if (!nextEvent) return null;
  var edits = storedEdits_(record);
  // 次期に作った会員（新規参加）は前期にいないので、復帰の候補として扱う
  var extra = {};
  record.rows.forEach(function (r) {
    if (r.movement === 'new') extra[r.key] = { name: r.name, status: 'active' };
  });
  var res;
  try {
    res = seasonPlanFor_(ctx, nextRow.prev_event_id, edits, { extraCandidates: extra });
  } catch (e) {
    if (!e.appCode) throw e;
    return { changed: true, problems: [e.publicMessage], diffs: [], basisVersion: '' };
  }
  var changed = res.basisVersion !== record.basisVersion;
  var nextBundle = collectEvent_(ctx, nextRow.event_id);
  var nls = seasonLeagueStage_(nextBundle);
  var groups = nextBundle.groups
    .filter(function (g) {
      return nls && g.stage_id === nls.stage_id;
    })
    .sort(byOrder_);
  var divOfGroup = {};
  groups.forEach(function (g, i) {
    divOfGroup[g.group_id] = i + 1;
  });
  var memberOf = memberOfPlayers_(nextBundle);
  var actual = {};
  nextBundle.entries.forEach(function (e) {
    if (nls && e.stage_id === nls.stage_id && memberOf[e.player_id]) actual[memberOf[e.player_id]] = divOfGroup[e.group_id];
  });
  var started = {};
  nextBundle.matches.forEach(function (m) {
    var k = divOfGroup[m.group_id];
    if (!k) return;
    if (matchStarted_(m)) started[k] = 'started';
    else if (!started[k]) started[k] = 'cards';
  });
  var diffs = [];
  res.plan.rows.forEach(function (r) {
    if (r.movement === 'leave' || !r.newDivision) return;
    var now = actual[r.key];
    if (now === undefined || now === r.newDivision) return;
    var lock = started[now] === 'started' || started[r.newDivision] === 'started' ? 'started' : started[now] || started[r.newDivision] || '';
    diffs.push({
      key: r.key,
      name: r.name,
      confirmed: now,
      confirmedName: groups[now - 1] ? groups[now - 1].name : now + '部',
      now: r.newDivision,
      nowName: groups[r.newDivision - 1] ? groups[r.newDivision - 1].name : r.newDivision + '部',
      reasons: r.reasons,
      canApply: !lock && !res.plan.problems.length && r.newDivision <= groups.length,
      lock: lock === 'started' ? '次期の該当ディビジョンの試合が始まっているため、所属は変えられません（記録として承認してください）。' : lock === 'cards' ? '次期の該当ディビジョンに対戦カードがあります。試合が始まっていなければ、先に対戦カードを削除すると反映できます。' : r.newDivision > groups.length ? '次期のディビジョン数が足りません。' : '',
    });
  });
  var ack = record.acknowledged && record.acknowledged.basisVersion === res.basisVersion ? record.acknowledged : null;
  return { changed: changed, acknowledged: ack, diffs: diffs, problems: res.plan.problems, basisVersion: res.basisVersion, confirmedBasisVersion: record.basisVersion, log: record.log || [] };
}

/**
 * 前期の訂正を次期に反映する・記録として承認する（次期の大会の主催者・管理者）。
 * payload = { eventId（次期）, rev（期の行の版）, apply: [会員 ID], acknowledge?: true, reason }
 * 反映は、次期の該当ディビジョンに対戦カードがないときだけ（試合が始まった所属は変えない）
 */
function actionReconcileNextSeason_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '次期の所属の照合');
  var row = seasonRowOfEvent_(ctx, eventId);
  if (!row || !row.prev_event_id) throw appError_('BAD_REQUEST', 'この大会は、前期から作った期ではありません。');
  var seasons = ctx.table('LeagueSeasons');
  row = findRecord_(seasons, row.season_key, '期');
  assertRev_(row, requireRev_(payload.rev), '期');
  var drift = seasonDrift_(ctx, row);
  if (!drift || !drift.changed) throw appError_('LOCKED', '前期の結果は、次期を作った時から変わっていません。');
  var reason = cleanText_(payload.reason, '理由', ADMIN_CONFIG.MAX_NOTE_LENGTH);
  var record = safeJson_(row.plan_json, {});
  var apply = Array.isArray(payload.apply) ? payload.apply : [];
  if (apply.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) throw appError_('BAD_REQUEST', '指定が多すぎます。');
  var applied = [];
  if (apply.length) {
    var byKey = {};
    drift.diffs.forEach(function (x) {
      byKey[x.key] = x;
    });
    var nextBundle = collectEvent_(ctx, eventId);
    var nls = seasonLeagueStage_(nextBundle);
    var groups = nextBundle.groups
      .filter(function (g) {
        return g.stage_id === nls.stage_id;
      })
      .sort(byOrder_);
    var memberOf = memberOfPlayers_(nextBundle);
    var entries = ctx.table('Entries');
    var seen = {};
    apply.forEach(function (key) {
      var x = isValidId_(key) ? byKey[key] : null;
      if (!x || seen[key]) throw appError_('NOT_FOUND', '反映する会員が、違いの一覧にありません。画面を再読み込みしてください。');
      seen[key] = true;
      if (!x.canApply) throw appError_('LOCKED', x.name + ': ' + (x.lock || '反映できません。'));
      var entry = entries.rows.filter(function (e) {
        return e.stage_id === nls.stage_id && memberOf[e.player_id] === key;
      })[0];
      var target = groups[x.now - 1];
      var seed = entries.rows.filter(function (e) {
        return e.group_id === target.group_id;
      }).length + 1;
      entry.group_id = target.group_id;
      entry.seed = seed;
      entry.rev = (entry.rev || 0) + 1;
      entry.updated_at = ctx.now;
      updateRecord_(entries, entry);
      applied.push({ key: key, name: x.name, from: x.confirmed, to: x.now });
      (record.rows || []).forEach(function (r) {
        if (r.key === key) {
          r.newDivision = x.now;
          r.reasons = (r.reasons || []).concat(['前期の訂正を反映して ' + x.nowName + ' へ（' + reason + '）']);
        }
      });
    });
    // 反映後の人数が規則に合うか
    var counts = {};
    entries.rows.forEach(function (e) {
      if (e.stage_id === nls.stage_id) counts[e.group_id] = (counts[e.group_id] || 0) + 1;
    });
    groups.forEach(function (g, i) {
      var need = seasonMinSize_(i + 1, groups.length);
      if ((counts[g.group_id] || 0) < need) throw appError_('VALIDATION', '反映すると ' + g.name + ' が ' + (counts[g.group_id] || 0) + ' 人になります（' + need + ' 人以上が必要）。反映する選手を見直してください。');
    });
  }
  var remaining = drift.diffs.filter(function (x) {
    return !applied.some(function (a) {
      return a.key === x.key;
    });
  });
  record.log = (record.log || []).concat([{ at: ctx.now, by: ctx.user ? ctx.user.label : '', reason: reason, applied: applied, acknowledged: payload.acknowledge === true, basisVersion: drift.basisVersion }]).slice(-50);
  if (!remaining.length && !drift.problems.length) {
    // 違いがなくなった: 今の前期の結果を、次期の根拠にする
    record.basisVersion = drift.basisVersion;
    record.basis = seasonPlanFor_(ctx, row.prev_event_id, storedEdits_(record), { extraCandidates: {} }).basis;
    delete record.acknowledged;
  } else if (payload.acknowledge === true) {
    record.acknowledged = { basisVersion: drift.basisVersion, at: ctx.now, by: ctx.user ? ctx.user.label : '', reason: reason, kept: remaining.map(function (x) { return { key: x.key, name: x.name, confirmed: x.confirmed, now: x.now }; }) };
  } else if (!applied.length) {
    throw appError_('VALIDATION', '反映する選手を選ぶか、「記録として承認」を選んでください。');
  }
  row.plan_json = JSON.stringify(record);
  row.rev = (row.rev || 0) + 1;
  row.updated_at = ctx.now;
  updateRecord_(seasons, row);
  recordHistory_(ctx, 'season.reconcile', 'League', row.league_id, eventId, null, { applied: applied, acknowledged: payload.acknowledge === true, reason: reason });
  return { eventId: eventId, applied: applied.length, alsoPublish: [row.prev_event_id] };
}

/* ---------- 運営画面の情報 ---------- */

/**
 * 運営画面の「期・昇降格」タブの情報（eventDetail に入れる）。
 * 期制リーグの大会でなければ、移行できるか（リーグの段階だけの大会・主催者か管理者）だけを返す
 */
function seasonDetail_(ctx, bundle, view, role) {
  var eventId = bundle.event.event_id;
  var sc = bundle.season;
  var owner = role === 'owner' || role === 'admin';
  if (!sc) {
    var convertible = bundle.stages.length === 1 && bundle.stages[0].type === STAGE_TYPE.LEAGUE;
    return convertible ? { linked: false, convertible: true, canEdit: owner } : null;
  }
  var events = ctx.table('Events').byKey;
  var out = {
    linked: true,
    canEdit: owner,
    league: { id: sc.league.league_id, name: sc.league.name, rev: sc.league.rev || 0, config: leagueConfig_(sc.league) },
    seasonNo: sc.row.season_no,
    seasonRev: sc.row.rev || 0,
    seasons: sc.all.map(function (r) {
      var ev = events[r.event_id];
      return { no: r.season_no, eventId: r.event_id, name: ev ? ev.name : '（削除済み）', exists: !!ev, isPublic: ev ? !!ev.is_public : false, current: r.event_id === eventId, canOpen: !!ev && canManageEvent_(ctx.user, ev, ctx) };
    }),
    next: null,
    prevEventId: sc.row.prev_event_id || '',
  };
  // 入替戦（今の順位から決まる対戦と、組んだ入替戦）
  try {
    var inputs = seasonInputs_(bundle, view);
    var roles = seasonRoles_(inputs.divisions);
    out.divisions = inputs.divisions.map(function (d) {
      return { index: d.index, name: d.name, size: d.rows.length, complete: d.complete, progress: d.progress };
    });
    out.playoffs = {
      expected: roles.playoffs.map(function (pf) {
        var got = inputs.playoffs.filter(function (p) {
          return p.upper === pf.upper;
        })[0];
        var nameOf = function (key) {
          var row = null;
          inputs.divisions.forEach(function (d) {
            d.rows.forEach(function (r) {
              if (r.key === key) row = r;
            });
          });
          return row ? row.name : '';
        };
        return { upper: pf.upper, lower: pf.lower, upperName: nameOf(pf.upperKey), lowerName: nameOf(pf.lowerKey), generated: !!got, matches: got ? got.upperKey === pf.upperKey && got.lowerKey === pf.lowerKey : false, state: got ? got.state : 'none', winnerName: got && got.winnerKey ? nameOf(got.winnerKey) : '' };
      }),
      problems: roles.problems,
      ready: inputs.divisions.every(function (d) {
        return d.complete;
      }),
      generated: inputs.playoffs.length,
    };
    var memberOf = memberOfPlayers_(bundle);
    out.members = bundle.players.map(function (p) {
      return { playerId: p.player_id, memberId: memberOf[p.player_id] || '', name: p.display_name, rev: p.rev || 0 };
    });
    var inSeason = {};
    bundle.players.forEach(function (p) {
      if (p.member_id) inSeason[p.member_id] = true;
    });
    var cand = rejoinCandidates_(ctx, sc, inSeason);
    out.otherMembers = Object.keys(cand).map(function (k) {
      return { memberId: k, name: cand[k].name, status: cand[k].status };
    });
  } catch (e) {
    if (!e.appCode) throw e;
    out.error = e.publicMessage;
  }
  if (sc.next) {
    var nev = events[sc.next.event_id];
    out.next = { eventId: sc.next.event_id, no: sc.next.season_no, name: nev ? nev.name : '（削除済み）', exists: !!nev, confirmedAt: sc.next.confirmed_at, confirmedBy: owner ? sc.next.confirmed_by : '' };
    if (nev) out.next.drift = seasonDrift_(ctx, sc.next);
  }
  if (sc.row.prev_event_id) {
    var record = safeJson_(sc.row.plan_json, null);
    out.plan = record ? { rows: record.rows, divisionCount: record.divisionCount, sizes: record.sizes, playoffs: record.playoffs, warnings: record.warnings || [], confirmedAt: sc.row.confirmed_at, confirmedBy: owner ? sc.row.confirmed_by : '', log: record.log || [], acknowledged: record.acknowledged || null } : null;
    out.drift = seasonDrift_(ctx, sc.row);
  }
  return out;
}

/**
 * 公開データの期制リーグの情報（閲覧ページ）。期の一覧は公開中の期だけ大会 ID を出す。
 * 次期を確定した後は、各選手の昇降格の結果と次期の所属（理由・手動の修正の内容は出さない）
 */
function seasonPublicView_(bundle, stages) {
  var sc = bundle.season;
  var eventId = bundle.event.event_id;
  var out = {
    league: sc.league.name,
    no: sc.row.season_no,
    seasons: sc.all
      .filter(function (r) {
        return sc.events[r.event_id];
      })
      .map(function (r) {
        var ev = sc.events[r.event_id];
        var pub = !!ev.is_public;
        return { no: r.season_no, eventId: pub || r.event_id === eventId ? r.event_id : null, current: r.event_id === eventId };
      }),
  };
  // 順位表の昇降格の帯（規則から決まるもの。確定前は「予定」）
  var league = stages.filter(function (s) {
    return s.type === STAGE_TYPE.LEAGUE;
  })[0];
  if (league && league.groups && league.groups.length > 1) {
    var d = league.groups.length;
    league.groups.forEach(function (g, i) {
      var k = i + 1;
      var a = g.standings.length;
      if (a < seasonMinSize_(k, d)) return;
      g.standings.forEach(function (s, idx) {
        var pos = idx + 1;
        var zone = '';
        if (k > 1 && pos === 1) zone = 'promote';
        else if (k > 1 && pos === 2) zone = 'playoff';
        else if (k < d && pos === a) zone = 'relegate';
        else if (k < d && pos === a - 1) zone = 'playoff';
        if (zone) s.zone = zone;
      });
    });
  }
  if (sc.next && sc.events[sc.next.event_id]) {
    var record = safeJson_(sc.next.plan_json, null);
    if (record && Array.isArray(record.rows)) {
      var playerOfMember = {};
      bundle.players.forEach(function (p) {
        if (p.member_id) playerOfMember[p.member_id] = p.player_id;
      });
      out.next = {
        no: sc.next.season_no,
        eventId: sc.events[sc.next.event_id].is_public ? sc.next.event_id : null,
        outcome: record.rows
          .filter(function (r) {
            return playerOfMember[r.key];
          })
          .map(function (r) {
            return { playerId: playerOfMember[r.key], kind: r.movement, to: r.movement === 'leave' ? '' : seasonDivisionName_(r.newDivision, record.divisionCount) };
          }),
      };
    }
  }
  return out;
}
