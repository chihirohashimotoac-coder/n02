/* v0.8 で足した運営の操作（スイス式・シリーズ・選手の CSV 登録・棄権・予定・お知らせ・複製・共同主催者・復元・自動終了） */

/* ---------- スイス式 ---------- */

/**
 * 次の回戦を組む（前の回戦がすべて確定した後に主催者が押す。自動では組まない）。
 * 組み合わせの規則と、満たせなかった条件（緩めた内容・理由）は 04c_swiss.js。記録は段階の設定（pairingLog）と履歴に残す。
 */
function actionGenerateSwissRound_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'swiss');
  assertNotAdvanced_(stage);
  var cfg = stageConfig_(stage);
  var group = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  })[0];
  if (!group) throw appError_('DATA_CONFLICT', 'スイス式の組がありません。');
  var matches = bundle.matches.filter(function (m) {
    return m.stage_id === stage.stage_id && m.group_id === group.group_id;
  });
  var latest = matches.reduce(function (mx, m) {
    return Math.max(mx, m.round || 0);
  }, 0);
  if (latest >= cfg.rounds) throw appError_('LOCKED', '予定の ' + cfg.rounds + ' 回戦はすべて組みました。');
  var open = matches.filter(function (m) {
    return m.round === latest && m.result_type !== RESULT_TYPE.BYE && m.status !== MATCH_STATUS.FINAL;
  });
  if (open.length) throw appError_('LOCKED', '第' + latest + '回戦の結果がすべて確定してから、次の回戦を組んでください（未確定 ' + open.length + ' 試合）。');
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  var members = bundle.entries
    .filter(function (e) {
      return e.group_id === group.group_id && playerById[e.player_id] && !isWithdrawn_(playerById[e.player_id]);
    })
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    });
  if (members.length < 2) throw appError_('VALIDATION', '参加者が 2 名以上必要です（棄権・失格した選手は組みません）。');
  var view = buildEventView_(bundle, true).stages.filter(function (st) {
    return st.id === stage.stage_id;
  })[0];
  if (view.progress.check) throw appError_('LOCKED', '「要確認」の試合があります。先に結果を直してください。');
  var standing = view.groups[0].standings;
  var rankOf = {};
  var pointsOf = {};
  standing.forEach(function (r, i) {
    rankOf[r.playerId] = i;
    pointsOf[r.playerId] = r.points || 0;
  });
  var seedOf = {};
  members.forEach(function (e, i) {
    seedOf[e.player_id] = i;
  });
  var opponents = {};
  var byes = {};
  members.forEach(function (e) {
    opponents[e.player_id] = {};
    byes[e.player_id] = 0;
  });
  matches.forEach(function (m) {
    if (m.result_type === RESULT_TYPE.BYE) {
      if (byes[m.player1_id] !== undefined) byes[m.player1_id]++;
      return;
    }
    if (opponents[m.player1_id]) opponents[m.player1_id][m.player2_id] = (opponents[m.player1_id][m.player2_id] || 0) + 1;
    if (opponents[m.player2_id]) opponents[m.player2_id][m.player1_id] = (opponents[m.player2_id][m.player1_id] || 0) + 1;
  });
  var ordered;
  if (latest === 0) {
    ordered = cfg.firstRound === 'random' ? shuffle_(members.map(function (e) { return e.player_id; })) : members.map(function (e) { return e.player_id; });
  } else {
    ordered = members
      .map(function (e) {
        return e.player_id;
      })
      .sort(function (a, b) {
        return (rankOf[a] === undefined ? 999 : rankOf[a]) - (rankOf[b] === undefined ? 999 : rankOf[b]) || seedOf[a] - seedOf[b];
      });
  }
  var players = ordered.map(function (pid) {
    return { id: pid, points: latest === 0 ? 0 : pointsOf[pid] || 0, opponents: opponents[pid], byes: byes[pid] };
  });
  var res = swissPairRound_(players, { avoidRematch: true });
  var round = latest + 1;
  var taken = Object.assign({}, ctx.table('Matches').byKey);
  var records = [];
  res.pairs.forEach(function (pair, i) {
    var id = newId_('MAT', taken);
    taken[id] = true;
    var m = blankMatch_(ctx, stage, group.group_id, id);
    m.round = round;
    m.order = i + 1;
    m.player1_id = pair[0];
    m.player2_id = pair[1];
    records.push(m);
  });
  if (res.bye) {
    var bid = newId_('MAT', taken);
    var bye = blankMatch_(ctx, stage, group.group_id, bid);
    bye.round = round;
    bye.order = records.length + 1;
    bye.player1_id = res.bye;
    bye.status = MATCH_STATUS.FINAL;
    bye.result_type = RESULT_TYPE.BYE;
    bye.winner_id = res.bye;
    bye.confirmed_at = ctx.now;
    records.push(bye);
  }
  appendRecords_(ctx.table('Matches'), records);
  var nameOf = function (pid) {
    return playerById[pid] ? playerById[pid].display_name : '?';
  };
  var log = {
    round: round,
    at: ctx.now,
    by: ctx.user ? ctx.user.label : '',
    bye: res.bye ? nameOf(res.bye) : '',
    relaxed: res.relaxed,
    rematches: res.rematches.map(function (p) {
      return nameOf(p[0]) + ' vs ' + nameOf(p[1]);
    }),
    steps: res.steps,
  };
  var stageRec = ctx.table('Stages').byKey[stage.stage_id];
  cfg.pairingLog = cfg.pairingLog
    .filter(function (l) {
      return l && l.round !== round;
    })
    .concat([log]);
  saveStage_(ctx, stageRec, cfg, ['pairingLog']);
  ctx.touchedResults = true;
  recordHistory_(ctx, 'swiss.pair', 'Stage', stage.stage_id, eventId, null, {
    round: round,
    pairs: res.pairs,
    bye: res.bye,
    relaxed: res.relaxed,
    rematches: res.rematches,
  });
  return { eventId: eventId, round: round, created: res.pairs.length, relaxed: res.relaxed, rematches: log.rematches, bye: log.bye };
}

/** 最新の回戦の組み合わせを消す（その回戦の試合がどれも始まっていないときだけ。前の回戦の訂正のため） */
function actionDeleteSwissRound_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'swiss');
  assertNotAdvanced_(stage);
  var matches = stageMatchesOf_(bundle, stage);
  var latest = matches.reduce(function (mx, m) {
    return Math.max(mx, m.round || 0);
  }, 0);
  if (!latest) throw appError_('LOCKED', '組み合わせがありません。');
  var list = matches.filter(function (m) {
    return m.round === latest;
  });
  if (list.some(function (m) { return m.result_type !== RESULT_TYPE.BYE && matchStarted_(m); })) {
    throw appError_('LOCKED', '第' + latest + '回戦はすでに結果が入っている試合があるため、組み合わせを削除できません。');
  }
  deleteRecords_(ctx.table('Matches'), list);
  var cfg = stageConfig_(stage);
  cfg.pairingLog = cfg.pairingLog.filter(function (l) {
    return l && l.round !== latest;
  });
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg, ['pairingLog']);
  ctx.touchedResults = true;
  recordHistory_(ctx, 'swiss.unpair', 'Stage', stage.stage_id, eventId, { round: latest, matches: list.length }, null);
  return { eventId: eventId, removed: list.length, round: latest };
}

/* ---------- ポイントシリーズ（節） ---------- */

function resolveNight_(bundle, payload) {
  var gid = requireId_(payload.groupId, '節');
  var night = bundle.groups.filter(function (g) {
    return g.group_id === gid;
  })[0];
  if (!night) throw appError_('NOT_FOUND', '節が見つかりません。');
  var stage = bundle.stageById[night.stage_id];
  if (!stage || stage.type !== STAGE_TYPE.SERIES) throw appError_('BAD_REQUEST', 'この操作はポイントシリーズの節でのみ使えます。');
  return { night: night, stage: stage };
}

/** 節の参加者（節を組む前だけ）。空配列なら「全員（参加者名簿）」に戻す */
function actionSetNightParticipants_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var r = resolveNight_(bundle, payload);
  assertNotAdvanced_(r.stage);
  if (bundle.matches.some(function (m) { return m.group_id === r.night.group_id; })) throw appError_('LOCKED', 'この節の組み合わせを作った後は参加者を変更できません。先に組み合わせを削除してください。');
  if (!Array.isArray(payload.playerIds) || payload.playerIds.length > ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS) throw appError_('BAD_REQUEST', '参加者の指定が不正です。');
  var roster = {};
  bundle.entries.forEach(function (e) {
    if (e.stage_id === r.stage.stage_id && !e.group_id) roster[e.player_id] = true;
  });
  var seen = {};
  payload.playerIds.forEach(function (pid) {
    if (!isValidId_(pid) || !roster[pid] || seen[pid]) throw appError_('BAD_REQUEST', 'シリーズの参加者名簿にいる選手を指定してください。');
    seen[pid] = true;
  });
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.group_id === r.night.group_id;
  }));
  var taken = Object.assign({}, entries.byKey);
  appendRecords_(
    entries,
    payload.playerIds.map(function (pid, i) {
      return newEntry_(ctx, r.stage, r.night.group_id, pid, i + 1, taken);
    })
  );
  recordHistory_(ctx, 'night.participants', 'Group', r.night.group_id, eventId, null, { players: payload.playerIds });
  return { eventId: eventId };
}

/**
 * 節の小トーナメントを組む。参加者は節ごとに指定した選手（なければ参加者名簿の全員。棄権・失格した選手は除く）。
 * シードの決め方は段階の設定: random（既定。節ごとに独立した抽選）/ standing（その時点の累計順位）/ seed（名簿の順）。
 * 全節の総当たりの保証などはしない（各節は独立）。
 */
function actionGenerateNight_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var r = resolveNight_(bundle, payload);
  assertNotAdvanced_(r.stage);
  var meta = groupMeta_(r.night);
  if (meta.status === 'cancelled') throw appError_('LOCKED', 'この節は中止になっています。');
  if (bundle.matches.some(function (m) { return m.group_id === r.night.group_id; })) throw appError_('LOCKED', 'この節の組み合わせは作成済みです。');
  var rule = stageRule_(bundle, r.stage);
  if (rule && rule.format === RULE_FORMAT.FIXED_LEGS) throw appError_('VALIDATION', 'ポイントシリーズの節は勝ち抜き戦なので、固定 Leg 数（引き分けあり）は使えません。');
  var cfg = stageConfig_(r.stage);
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  var nightEntries = bundle.entries.filter(function (e) {
    return e.group_id === r.night.group_id;
  });
  var roster = bundle.entries
    .filter(function (e) {
      return e.stage_id === r.stage.stage_id && !e.group_id;
    })
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    });
  var ids = (nightEntries.length ? nightEntries.sort(function (a, b) { return (a.seed || 0) - (b.seed || 0); }) : roster)
    .map(function (e) {
      return e.player_id;
    })
    .filter(function (pid) {
      return playerById[pid] && !isWithdrawn_(playerById[pid]);
    });
  if (ids.length < 2) throw appError_('VALIDATION', 'この節の参加者が 2 名以上必要です（参加者名簿は「組み合わせ」タブの「参加者を登録」で作ります）。');
  var method = cfg.nightDraw;
  if (method === 'random') ids = shuffle_(ids);
  else if (method === 'standing') {
    var view = buildEventView_(bundle, true).stages.filter(function (st) {
      return st.id === r.stage.stage_id;
    })[0];
    var pos = {};
    view.standings.forEach(function (row, i) {
      pos[row.playerId] = i;
    });
    ids.sort(function (a, b) {
      return (pos[a] === undefined ? 999 : pos[a]) - (pos[b] === undefined ? 999 : pos[b]);
    });
  }
  var entries = ctx.table('Entries');
  deleteRecords_(entries, nightEntries);
  var taken = Object.assign({}, entries.byKey);
  appendRecords_(
    entries,
    ids.map(function (pid, i) {
      return newEntry_(ctx, r.stage, r.night.group_id, pid, i + 1, taken);
    })
  );
  var plan = planSingleElimination_(ids, {});
  var records = bracketRecords_(
    ctx,
    r.stage,
    plan.matches.map(function (m) {
      m.groupId = r.night.group_id;
      return m;
    }),
    { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '', nightDraw: method }
  );
  appendRecords_(ctx.table('Matches'), records);
  ctx.touchedResults = true;
  recordHistory_(ctx, 'night.draw', 'Group', r.night.group_id, eventId, null, { method: method, seeds: ids, matches: records.length });
  return { eventId: eventId, created: records.length };
}

/** 節の組み合わせを消す（結果の入った試合がないときだけ） */
function actionClearNight_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var r = resolveNight_(bundle, payload);
  assertNotAdvanced_(r.stage);
  var list = bundle.matches.filter(function (m) {
    return m.group_id === r.night.group_id;
  });
  if (list.some(matchStarted_)) throw appError_('LOCKED', '結果が入力された試合があるため削除できません。');
  deleteRecords_(ctx.table('Matches'), list);
  ctx.touchedResults = true;
  recordHistory_(ctx, 'night.clear', 'Group', r.night.group_id, eventId, { removed: list.length }, null);
  return { eventId: eventId, removed: list.length };
}

/** 節を中止にする（点なし・完了の条件から外す）・中止を取り消す。結果の入った試合があるときは中止できない */
function actionCancelNight_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var r = resolveNight_(bundle, payload);
  assertNotAdvanced_(r.stage);
  var group = ctx.table('Groups').byKey[r.night.group_id];
  assertRev_(group, requireRev_(payload.rev), '節');
  var meta = groupMeta_(group);
  if (payload.undo === true) {
    delete meta.status;
    delete meta.reason;
  } else {
    if (bundle.matches.some(function (m) { return m.group_id === group.group_id && matchStarted_(m); })) throw appError_('LOCKED', '結果が入力された試合があるため、この節は中止にできません。');
    meta.status = 'cancelled';
    meta.reason = cleanText_(payload.reason, '中止の理由', ADMIN_CONFIG.MAX_NOTE_LENGTH);
  }
  group.meta_json = JSON.stringify(meta);
  group.rev = (group.rev || 0) + 1;
  group.updated_at = ctx.now;
  updateRecord_(ctx.table('Groups'), group);
  ctx.touchedResults = true;
  recordHistory_(ctx, payload.undo === true ? 'night.uncancel' : 'night.cancel', 'Group', group.group_id, eventId, null, { reason: meta.reason || '' });
  return { eventId: eventId };
}

/** 節の名前・開催日 */
function actionUpdateNight_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var r = resolveNight_(bundle, payload);
  var group = ctx.table('Groups').byKey[r.night.group_id];
  assertRev_(group, requireRev_(payload.rev), '節');
  var meta = groupMeta_(group);
  if (payload.name !== undefined) group.name = cleanText_(payload.name, '節の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);
  if (payload.date !== undefined) {
    var d = parseDateInput_(payload.date, '開催日');
    if (d) meta.date = d;
    else delete meta.date;
  }
  group.meta_json = JSON.stringify(meta);
  group.rev = (group.rev || 0) + 1;
  group.updated_at = ctx.now;
  updateRecord_(ctx.table('Groups'), group);
  recordHistory_(ctx, 'night.update', 'Group', group.group_id, eventId, null, { name: group.name, date: meta.date || '' });
  return { eventId: eventId };
}

/* ---------- 選手（所属・Rt・シード・CSV 登録・棄権） ---------- */

function parseAffiliation_(value) {
  return cleanText_(value, '所属', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true });
}

/** Rt（任意）。空欄は未入力（0 とは別）。0〜999.99 */
function parseRatingInput_(value) {
  if (value === null || value === undefined || value === '') return '';
  var v = parseRating_(value);
  if (v === null) return '';
  if (isNaN(v)) throw appError_('VALIDATION', 'Rt は 0〜999.99 の数で入力してください（未入力は空欄）。');
  return String(v);
}

function parseSeedInput_(value) {
  if (value === null || value === undefined || value === '') return null;
  return parseSmallInt_(value, 'シード', 1, ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT, null);
}

/**
 * CSV などからの一括登録（F11）。画面でプレビューして確認した行だけを送る。
 * players = [{ name, affiliation?, rating?, seed? }]。1 行でも不正なら何も登録しない（一部だけ登録しない）。
 * 同じ名前の選手（既存・ファイル内）は同一人物とみなさず、エラーとして止める（画面で名前を変えるか行を外す）。
 */
function actionImportPlayers_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  findRecord_(ctx.table('Events'), eventId, '大会');
  if (!Array.isArray(payload.players) || !payload.players.length) throw appError_('VALIDATION', '登録する選手がありません。');
  if (payload.players.length > ADMIN_CONFIG.MAX_IMPORT_PLAYERS) throw appError_('VALIDATION', '一度に登録できるのは ' + ADMIN_CONFIG.MAX_IMPORT_PLAYERS + ' 名までです。');
  var players = ctx.table('Players');
  var current = players.rows.filter(function (p) {
    return p.event_id === eventId;
  });
  if (current.length + payload.players.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) {
    throw appError_('VALIDATION', '1 大会の選手は ' + ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT + ' 名までです（今 ' + current.length + ' 名・追加 ' + payload.players.length + ' 名）。');
  }
  var names = {};
  current.forEach(function (p) {
    names[p.display_name] = 'existing';
  });
  var seeds = {};
  current.forEach(function (p) {
    if (p.seed) seeds[p.seed] = p.display_name;
  });
  var problems = [];
  var cleaned = payload.players.map(function (row, i) {
    var line = i + 1;
    try {
      if (!row || typeof row !== 'object') throw appError_('VALIDATION', '形式が不正です。');
      var name = cleanText_(row.name, '選手名', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
      if (names[name] === 'existing') throw appError_('VALIDATION', '「' + name + '」は既に登録されています（同名の別人なら名前を区別してください）。');
      if (names[name]) throw appError_('VALIDATION', '「' + name + '」がファイル内で重複しています。');
      names[name] = 'file';
      var seed = parseSeedInput_(row.seed);
      if (seed && seeds[seed]) throw appError_('VALIDATION', 'シード ' + seed + ' は「' + seeds[seed] + '」と重複しています。');
      if (seed) seeds[seed] = name;
      return { name: name, affiliation: parseAffiliation_(row.affiliation), rating: parseRatingInput_(row.rating), seed: seed };
    } catch (e) {
      if (!e.appCode) throw e;
      problems.push(line + ' 行目: ' + e.publicMessage);
      return null;
    }
  });
  if (problems.length) throw appError_('VALIDATION', '登録していません。次の行を直してください: ' + problems.slice(0, 10).join(' / ') + (problems.length > 10 ? ' ほか ' + (problems.length - 10) + ' 件' : ''));
  var taken = Object.assign({}, players.byKey);
  var records = cleaned.map(function (x) {
    var id = newId_('PLY', taken);
    taken[id] = true;
    return { player_id: id, event_id: eventId, display_name: x.name, external_ref: '', notes: '', affiliation: x.affiliation, rating: x.rating, seed: x.seed, meta_json: '', rev: 1, created_at: ctx.now, updated_at: ctx.now };
  });
  appendRecords_(players, records);
  recordHistory_(ctx, 'player.import', 'Player', '', eventId, null, { count: records.length, names: records.map(function (r) { return r.display_name; }) });
  return { eventId: eventId, added: records.length };
}

/** 棄権・失格の影響（プレビュー）: 未消化の試合と、その扱い */
function withdrawImpact_(bundle, playerId) {
  var list = [];
  bundle.matches.forEach(function (m) {
    if (m.player1_id !== playerId && m.player2_id !== playerId) return;
    if (m.status === MATCH_STATUS.FINAL || m.result_type === RESULT_TYPE.BYE || m.result_type === RESULT_TYPE.NOT_NEEDED) return;
    var other = m.player1_id === playerId ? m.player2_id : m.player1_id;
    list.push({ match: m, opponent: other, live: m.status === MATCH_STATUS.LIVE || matchStarted_(m) });
  });
  return list;
}

function actionPreviewWithdraw_(ctx, payload) {
  var bundle = collectEvent_(ctx, findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手').event_id);
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var stageName = {};
  bundle.stages.forEach(function (st) {
    stageName[st.stage_id] = st.name;
  });
  var finals = bundle.matches.filter(function (m) {
    return (m.player1_id === payload.playerId || m.player2_id === payload.playerId) && m.status === MATCH_STATUS.FINAL;
  }).length;
  return {
    finals: finals,
    affected: withdrawImpact_(bundle, payload.playerId).map(function (x) {
      return {
        matchId: x.match.match_id,
        stage: stageName[x.match.stage_id] || '',
        label: x.match.label || (x.match.round ? x.match.round + '' : ''),
        opponent: x.opponent ? nameOf[x.opponent] || '' : '',
        action: !x.opponent ? 'pending' : x.live ? 'retired' : 'walkover',
      };
    }),
  };
}

/**
 * 棄権・失格（F15）。確定済みの試合は消さずに残し、未消化の試合だけを処理する:
 *   未開始 → 相手の不戦勝（Leg 数は記録しない） / 進行中 → 途中棄権・失格（その時点の Leg 数のまま相手の勝ち）
 *   相手がまだ決まっていない勝ち抜き戦の試合 → 相手が決まった時点で不戦勝にする
 * 以後のスイス式の組み合わせ・シリーズの節には入れない。
 */
function actionWithdrawPlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var kind = payload.kind === 'disqualified' ? 'disqualified' : payload.kind === 'withdrawn' ? 'withdrawn' : '';
  if (!kind) throw appError_('VALIDATION', '棄権か失格かを選んでください。');
  var reason = cleanText_(payload.reason, '理由', ADMIN_CONFIG.MAX_NOTE_LENGTH);
  var meta = playerMeta_(player);
  if (meta.withdrawn) throw appError_('LOCKED', 'この選手は既に' + (meta.withdrawn.kind === 'disqualified' ? '失格' : '棄権') + 'として記録されています。');
  meta.withdrawn = { kind: kind, reason: reason, at: ctx.now, by: ctx.user ? ctx.user.label : '' };
  player.meta_json = JSON.stringify(meta);
  player.rev = (player.rev || 0) + 1;
  player.updated_at = ctx.now;
  updateRecord_(players, player);
  var bundle = collectEvent_(ctx, player.event_id);
  var touched = 0;
  withdrawImpact_(bundle, player.player_id).forEach(function (x) {
    if (!x.opponent) return;
    var m = x.match;
    var stage = bundle.stageById[m.stage_id];
    var before = pickResult_(m);
    var beforeWinner = '';
    m.status = MATCH_STATUS.FINAL;
    m.winner_id = x.opponent;
    if (x.live) {
      m.result_type = kind === 'disqualified' ? RESULT_TYPE.DISQUALIFIED : RESULT_TYPE.RETIRED;
    } else {
      m.result_type = kind === 'disqualified' ? RESULT_TYPE.DISQUALIFIED : RESULT_TYPE.WALKOVER;
      m.player1_legs = null;
      m.player2_legs = null;
      m.player1_sets = 0;
      m.player2_sets = 0;
    }
    m.result_note = reason;
    m.confirmed_at = ctx.now;
    m.rev = (m.rev || 0) + 1;
    m.updated_at = ctx.now;
    if (isBracketStage_(stage)) propagateElimination_(ctx, m, beforeWinner, m.winner_id);
    updateRecord_(ctx.table('Matches'), m);
    recordHistory_(ctx, 'match.withdraw', 'Match', m.match_id, m.event_id, before, pickResult_(m));
    touched++;
  });
  bundle.stages.forEach(function (st) {
    if (isBracketStage_(st)) touched += autoForfeitWithdrawn_(ctx, player.event_id, st.stage_id);
  });
  ctx.touchedResults = true;
  recordHistory_(ctx, kind === 'disqualified' ? 'player.disqualify' : 'player.withdraw', 'Player', player.player_id, player.event_id, null, { reason: reason, matches: touched });
  return { eventId: player.event_id, matches: touched };
}

/** 棄権・失格の記録を外す（以後の組み合わせに戻す）。処理済みの試合の結果は戻さない（必要なら試合ごとに訂正する） */
function actionReinstatePlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var meta = playerMeta_(player);
  if (!meta.withdrawn) return { eventId: player.event_id };
  var before = meta.withdrawn;
  delete meta.withdrawn;
  player.meta_json = Object.keys(meta).length ? JSON.stringify(meta) : '';
  player.rev = (player.rev || 0) + 1;
  player.updated_at = ctx.now;
  updateRecord_(players, player);
  recordHistory_(ctx, 'player.reinstate', 'Player', player.player_id, player.event_id, before, null);
  return { eventId: player.event_id };
}

/* ---------- 予定（日時・会場・ボード・審判・延期・毎週の日程） ---------- */

/** 'YYYY-MM-DD'（大会のタイムゾーンの日付。空欄は未定） */
function parseDateInput_(value, label) {
  if (value === null || value === undefined || value === '') return '';
  var t = String(value).normalize('NFKC').trim().replace(/\//g, '-');
  var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) throw appError_('VALIDATION', (label || '日付') + 'は 2026-11-03 の形で入力してください。');
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var d = Number(m[3]);
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) throw appError_('VALIDATION', (label || '日付') + 'が正しくありません。');
  return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
}

/** 'HH:MM'（24 時間。空欄は時刻未定） */
function parseTimeInput_(value) {
  if (value === null || value === undefined || value === '') return '';
  var t = String(value).normalize('NFKC').trim();
  var m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw appError_('VALIDATION', '時刻は 19:30 の形（24 時間）で入力してください。');
  return (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2];
}

function writeSchedule_(ctx, match, sch) {
  match.schedule_json = JSON.stringify(sch);
  match.rev = (match.rev || 0) + 1;
  match.updated_at = ctx.now;
  updateRecord_(ctx.table('Matches'), match);
}

/** 試合の予定（F07）。結果の状態とは別に管理する（延期は勝敗として数えない） */
function actionSetSchedule_(ctx, payload) {
  var match = findRecord_(ctx.table('Matches'), requireId_(payload.matchId, '試合'), '試合');
  assertRev_(match, requireRev_(payload.rev), '試合');
  var cur = scheduleOf_(match) || {};
  var sch = {
    date: parseDateInput_(payload.date, '日付'),
    time: parseTimeInput_(payload.time),
    venue: cleanText_(payload.venue, '会場', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    board: cleanText_(payload.board, 'ボード', 20, { allowEmpty: true }),
    referee: cleanText_(payload.referee, '審判', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    status: cur.status || '',
    original: cur.original || null,
    reason: cur.reason || '',
    changedAt: ctx.now,
    changedBy: ctx.user ? ctx.user.label : '',
  };
  if (sch.time && !sch.date) throw appError_('VALIDATION', '時刻を入れるときは日付も入れてください。');
  var before = scheduleOf_(match);
  writeSchedule_(ctx, match, sch);
  recordHistory_(ctx, 'match.schedule', 'Match', match.match_id, match.event_id, before, sch);
  return { eventId: match.event_id };
}

/**
 * 延期・振替（F08）。当初の予定（最初の 1 回）・変更後の予定・理由・操作者を残す。
 * 新しい日付がなければ「延期（日程未定）」、あれば「振替」。確定済みの試合は延期にできない。
 */
function actionPostponeMatch_(ctx, payload) {
  var match = findRecord_(ctx.table('Matches'), requireId_(payload.matchId, '試合'), '試合');
  assertRev_(match, requireRev_(payload.rev), '試合');
  if (match.status === MATCH_STATUS.FINAL) throw appError_('LOCKED', '確定済みの試合は延期にできません。');
  var cur = scheduleOf_(match) || { date: '', time: '', venue: '', board: '', referee: '' };
  var date = parseDateInput_(payload.date, '振替日');
  var time = parseTimeInput_(payload.time);
  var reason = cleanText_(payload.reason, '延期の理由', ADMIN_CONFIG.MAX_NOTE_LENGTH);
  var sch = {
    date: date,
    time: date ? time : '',
    venue: cur.venue || '',
    board: cur.board || '',
    referee: cur.referee || '',
    status: date ? 'rescheduled' : 'postponed',
    original: cur.original || { date: cur.date || '', time: cur.time || '' },
    reason: reason,
    changedAt: ctx.now,
    changedBy: ctx.user ? ctx.user.label : '',
  };
  writeSchedule_(ctx, match, sch);
  recordHistory_(ctx, 'match.postpone', 'Match', match.match_id, match.event_id, cur, sch);
  return { eventId: match.event_id };
}

/**
 * 毎週の日程（F13）。開始日・開催曜日・間隔（何週ごと）・休催日から、節（リーグの第 n 節・シリーズの節）ごとの日付を作る。
 * 祝日は自動では判定しない（休催日として入力してもらう）。適用は未実施（未開始で結果なし）の試合だけ。
 */
function weeklyPlan_(bundle, stage, payload) {
  var start = parseDateInput_(payload.startDate, '開始日');
  if (!start) throw appError_('VALIDATION', '開始日を入力してください。');
  var weekdays = Array.isArray(payload.weekdays) ? payload.weekdays : [];
  if (!weekdays.length || weekdays.some(function (w) { return !(w >= 0 && w <= 6) || Math.floor(w) !== w; })) throw appError_('VALIDATION', '開催する曜日を 1 つ以上選んでください。');
  var interval = parseSmallInt_(payload.intervalWeeks, '間隔（週）', 1, 8, 1);
  var skips = {};
  (Array.isArray(payload.skipDates) ? payload.skipDates : []).forEach(function (d) {
    var v = parseDateInput_(d, '休催日');
    if (v) skips[v] = true;
  });
  var time = parseTimeInput_(payload.time);
  var venue = cleanText_(payload.venue, '会場', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true });
  var units;
  if (stage.type === STAGE_TYPE.SERIES) {
    units = bundle.groups
      .filter(function (g) {
        return g.stage_id === stage.stage_id && groupMeta_(g).status !== 'cancelled';
      })
      .sort(byOrder_)
      .map(function (g) {
        return { key: g.group_id, label: g.name };
      });
  } else {
    var maxRound = bundle.matches.reduce(function (mx, m) {
      return m.stage_id === stage.stage_id ? Math.max(mx, m.round || 0) : mx;
    }, 0);
    if (!maxRound) throw appError_('VALIDATION', '先に対戦カードを作成してください（節ごとの日付を決めるため）。');
    var cfg = stageConfig_(stage);
    units = [];
    for (var r = 1; r <= maxRound; r++) units.push({ key: r, label: cfg.roundLabels[String(r)] || (stage.type === STAGE_TYPE.LEAGUE ? '第' + r + '節' : 'R' + r) });
  }
  var p = start.split('-');
  var day = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  var startWeek = Math.floor((day.getTime() / 86400000 + 3) / 7); // 月曜始まりの週番号
  var out = [];
  var guard = 0;
  var skipped = [];
  while (out.length < units.length && guard++ < 2000) {
    var ymd = day.toISOString().slice(0, 10);
    var week = Math.floor((day.getTime() / 86400000 + 3) / 7);
    if (weekdays.indexOf(day.getUTCDay()) !== -1 && (week - startWeek) % interval === 0) {
      if (skips[ymd]) skipped.push(ymd);
      else out.push({ key: units[out.length].key, label: units[out.length].label, date: ymd, time: time });
    }
    day = new Date(day.getTime() + 86400000);
  }
  if (out.length < units.length) throw appError_('VALIDATION', '日付を割り当てきれませんでした。条件を見直してください。');
  return { plan: out, skipped: skipped, venue: venue, time: time };
}

function actionPreviewWeeklySchedule_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, '');
  var res = weeklyPlan_(bundle, stage, payload);
  var keep = 0;
  bundle.matches.forEach(function (m) {
    if (m.stage_id === stage.stage_id && (matchStarted_(m) || m.status === MATCH_STATUS.FINAL)) keep++;
  });
  return { plan: res.plan, skipped: res.skipped, untouched: keep };
}

function actionApplyWeeklySchedule_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, '');
  var res = weeklyPlan_(bundle, stage, payload);
  var dateOf = {};
  res.plan.forEach(function (x) {
    dateOf[String(x.key)] = x.date;
  });
  var changed = 0;
  var untouched = 0;
  var table = ctx.table('Matches');
  bundle.matches.forEach(function (m) {
    if (m.stage_id !== stage.stage_id) return;
    var key = stage.type === STAGE_TYPE.SERIES ? m.group_id : String(m.round);
    if (!dateOf[key]) return;
    if (matchStarted_(m) || m.status === MATCH_STATUS.FINAL || m.result_type) {
      untouched++;
      return;
    }
    var cur = scheduleOf_(m) || {};
    var sch = { date: dateOf[key], time: res.time, venue: res.venue || cur.venue || '', board: cur.board || '', referee: cur.referee || '', status: cur.status || '', original: cur.original || null, reason: cur.reason || '', changedAt: ctx.now, changedBy: ctx.user ? ctx.user.label : '' };
    writeSchedule_(ctx, table.byKey[m.match_id], sch);
    changed++;
  });
  if (stage.type === STAGE_TYPE.SERIES) {
    var groups = ctx.table('Groups');
    res.plan.forEach(function (x) {
      var g = groups.byKey[x.key];
      if (!g) return;
      var meta = groupMeta_(g);
      meta.date = x.date;
      g.meta_json = JSON.stringify(meta);
      g.rev = (g.rev || 0) + 1;
      g.updated_at = ctx.now;
      updateRecord_(groups, g);
    });
  }
  recordHistory_(ctx, 'schedule.weekly', 'Stage', stage.stage_id, eventId, null, { plan: res.plan, skipped: res.skipped, changed: changed, untouched: untouched });
  return { eventId: eventId, changed: changed, untouched: untouched };
}

/* ---------- 大会の設定（お知らせ・ルール表示・公開する項目・自動終了） ---------- */

var TIMEZONES_ = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Singapore', 'Australia/Sydney', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC'];

/** 改行を残す文章（お知らせ）。制御文字は改行以外を拒否し、行ごとに前後の空白を除く */
function cleanMultiline_(value, label, maxLength) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw appError_('VALIDATION', label + ' の形式が不正です。');
  var text = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(function (l) {
      return l.replace(/[ \t　]+/g, ' ').trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > maxLength) throw appError_('VALIDATION', label + ' は ' + maxLength + ' 文字以内で入力してください。');
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) throw appError_('VALIDATION', label + ' に使用できない文字が含まれています。');
  return text;
}

/**
 * ルールの表示（F10）。表示のための情報で、n02 の採点には使わない。
 * category: soft（ソフトダーツ）/ steel（スティールダーツ）。startScore: 開始点数（01）。
 * inMode / outMode: open（制限なし）/ double（ダブル）/ master（ダブル・トリプル）。bull: fat（ブルを 1 つの点にする）/ separate（25・50）。
 * roundLimit: ラウンド上限（1〜99）。legFormat は段階のルール（Leg 制・セット制）から表示するので、ここでは持たない。
 */
var RULE_DISPLAY_CHOICES_ = {
  category: ['', 'soft', 'steel'],
  inMode: ['', 'open', 'double', 'master'],
  outMode: ['', 'open', 'double', 'master'],
  bull: ['', 'fat', 'separate'],
  startScore: [null, 101, 301, 501, 701, 901, 1101, 1501],
};

function parseRuleDisplay_(value) {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw appError_('VALIDATION', 'ルールの表示の指定が不正です。');
  var pick = function (key, label) {
    var v = value[key] === undefined ? (key === 'startScore' ? null : '') : value[key];
    if (key === 'startScore' && v !== null && v !== '') v = Number(v);
    if (key === 'startScore' && v === '') v = null;
    if (RULE_DISPLAY_CHOICES_[key].indexOf(v) === -1) throw appError_('VALIDATION', label + 'の指定が不正です。');
    return v;
  };
  var out = {
    category: pick('category', '競技区分'),
    startScore: pick('startScore', '開始点数'),
    inMode: pick('inMode', 'イン'),
    outMode: pick('outMode', 'アウト'),
    bull: pick('bull', 'ブル'),
    roundLimit: value.roundLimit === undefined || value.roundLimit === null || value.roundLimit === '' ? null : parseSmallInt_(value.roundLimit, 'ラウンド上限', 1, 99, null),
    note: cleanText_(value.note, 'ルールの補足', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true }),
  };
  if (out.category === 'steel' && out.bull === 'fat') throw appError_('VALIDATION', 'スティールダーツでは、ブルを 1 つの点にする（ファットブル）設定は使いません。「25・50 に分ける」を選んでください。');
  return out;
}

function actionUpdateEventSettings_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var raw = safeJson_(event.config_json, {});
  var before = JSON.parse(JSON.stringify(raw));
  if (payload.announcement !== undefined) {
    var text = cleanMultiline_(payload.announcement, 'お知らせ', ADMIN_CONFIG.MAX_ANNOUNCEMENT_LENGTH);
    if (text) raw.announcement = { text: text, updatedAt: ctx.now };
    else delete raw.announcement;
  }
  if (payload.ruleDisplay !== undefined) {
    var rd = parseRuleDisplay_(payload.ruleDisplay);
    if (rd) raw.ruleDisplay = rd;
    else delete raw.ruleDisplay;
  }
  if (payload.autoFinish !== undefined) {
    raw.autoFinish = requireBool_(payload.autoFinish, '自動終了');
    if (!raw.autoFinish) delete raw.autoFinishedAt;
  }
  if (payload.publicFields !== undefined) {
    var pf = payload.publicFields;
    if (!pf || typeof pf !== 'object') throw appError_('VALIDATION', '公開する項目の指定が不正です。');
    raw.publicFields = { affiliation: pf.affiliation === true, rating: pf.rating === true };
  }
  if (payload.timezone !== undefined) {
    if (TIMEZONES_.indexOf(payload.timezone) === -1) throw appError_('VALIDATION', 'タイムゾーンの指定が不正です。');
    raw.timezone = payload.timezone;
  }
  event.config_json = JSON.stringify(raw);
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  recordHistory_(ctx, 'event.settings', 'Event', eventId, eventId, before, raw);
  return { eventId: eventId };
}

/* ---------- 大会の設定を複製（F12） ---------- */

/** 段階の設定のうち、複製・設定のみの復元で持ち越さないもの（結果や進行の記録） */
var STAGE_RUNTIME_KEYS_ = ['advanced', 'advancedAt', 'pairingLog', 'lastDraw', 'adjustments'];

/**
 * 別の大会に、段階・ルール・組の設定・順位の決め方などを写して新しい ID で作る（大会設定の複製・設定のみの復元で共通）。
 * source = { event, rules, stages, groups, players }（シートの行の形）。結果・履歴・所有者・管理パスワード・共同主催者は写さない。
 */
function cloneEventStructure_(ctx, source, opts) {
  var events = ctx.table('Events');
  var eventId = newId_('EVT', events.byKey);
  var ruleTaken = Object.assign({}, ctx.table('Rules').byKey);
  var stageTaken = Object.assign({}, ctx.table('Stages').byKey);
  var groupTaken = Object.assign({}, ctx.table('Groups').byKey);
  var playerTaken = Object.assign({}, ctx.table('Players').byKey);
  var ruleMap = {};
  var stageMap = {};
  var groupMap = {};
  var playerMap = {};
  var rules = source.rules.map(function (r) {
    var id = newId_('RUL', ruleTaken);
    ruleTaken[id] = true;
    ruleMap[r.rule_id] = id;
    return { rule_id: id, event_id: eventId, name: r.name, format: r.format, best_of: r.best_of, is_provisional: r.is_provisional, set_best_of: r.set_best_of, notes: r.notes, rev: 1, created_at: ctx.now, updated_at: ctx.now };
  });
  source.stages.forEach(function (st) {
    var id = newId_('STG', stageTaken);
    stageTaken[id] = true;
    stageMap[st.stage_id] = id;
  });
  var stages = source.stages.map(function (st) {
    var cfg = safeJson_(st.config_json, {});
    if (!opts.keepRuntime) STAGE_RUNTIME_KEYS_.forEach(function (k) {
      delete cfg[k];
    });
    if (Array.isArray(cfg.advancement)) {
      cfg.advancement = cfg.advancement
        .filter(function (a) {
          return a && stageMap[a.targetStageId];
        })
        .map(function (a) {
          return { fromRank: a.fromRank, toRank: a.toRank, targetStageId: stageMap[a.targetStageId] };
        });
    }
    if (Array.isArray(cfg.adjustments)) {
      cfg.adjustments = cfg.adjustments.filter(function (a) {
        return a && playerMapFor_(source, a.playerId);
      });
    }
    return { stage_id: stageMap[st.stage_id], event_id: eventId, name: st.name, type: st.type, order: st.order, rule_id: ruleMap[st.rule_id] || rules[0].rule_id, parent_stage_id: '', config_json: JSON.stringify(cfg), rev: 1, created_at: ctx.now, updated_at: ctx.now };
  });
  var groups = source.groups
    .filter(function (g) {
      return stageMap[g.stage_id];
    })
    .map(function (g) {
      var id = newId_('GRP', groupTaken);
      groupTaken[id] = true;
      groupMap[g.group_id] = id;
      var meta = safeJson_(g.meta_json, {});
      if (!opts.keepRuntime) {
        delete meta.status;
        delete meta.reason;
      }
      return { group_id: id, event_id: eventId, stage_id: stageMap[g.stage_id], name: g.name, order: g.order, meta_json: Object.keys(meta).length ? JSON.stringify(meta) : '', rev: 1, created_at: ctx.now, updated_at: ctx.now };
    });
  var players = (opts.players ? source.players : []).map(function (p) {
    var id = newId_('PLY', playerTaken);
    playerTaken[id] = true;
    playerMap[p.player_id] = id;
    var meta = opts.keepRuntime ? safeJson_(p.meta_json, {}) : {};
    return {
      player_id: id,
      event_id: eventId,
      display_name: p.display_name,
      external_ref: '',
      notes: opts.keepNotes ? p.notes || '' : '',
      affiliation: p.affiliation || '',
      rating: p.rating === null || p.rating === undefined ? '' : String(p.rating),
      seed: p.seed || null,
      meta_json: Object.keys(meta).length ? JSON.stringify(meta) : '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
  });
  // 加減点は、選手を写したときだけ ID を付け替えて残す（結果の一部なので、設定のみの複製では消える）
  stages.forEach(function (st) {
    var cfg = safeJson_(st.config_json, {});
    if (Array.isArray(cfg.adjustments)) {
      cfg.adjustments = cfg.adjustments
        .filter(function (a) {
          return playerMap[a.playerId];
        })
        .map(function (a) {
          return Object.assign({}, a, { playerId: playerMap[a.playerId] });
        });
      st.config_json = JSON.stringify(cfg);
    }
  });
  var cfgEv = safeJson_(source.event.config_json, {});
  var owner = creatorOwner_(ctx);
  delete cfgEv.autoFinishedAt;
  if (!opts.keepAnnouncement) delete cfgEv.announcement;
  var event = {
    event_id: eventId,
    name: opts.name,
    date_label: opts.dateLabel === undefined ? '' : opts.dateLabel,
    status: EVENT_STATUS.DRAFT,
    is_public: false,
    is_featured: false,
    rule_id: ruleMap[source.event.rule_id] || rules[0].rule_id,
    is_sample: false,
    organizer_name: '',
    admin_key_hash: '',
    admin_key_issued_at: '',
    owner_email: owner.owner_email,
    staff_pass_hash: '',
    staff_pass_salt: '',
    staff_pass_set_at: '',
    notes: '',
    config_json: JSON.stringify(cfgEv),
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
    owner_sub: owner.owner_sub,
    owner_link_json: owner.owner_link_json,
  };
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), rules);
  appendRecords_(ctx.table('Stages'), stages);
  appendRecords_(ctx.table('Groups'), groups);
  appendRecords_(ctx.table('Players'), players);
  return { event: event, maps: { rule: ruleMap, stage: stageMap, group: groupMap, player: playerMap } };
}

function playerMapFor_(source, pid) {
  return (source.players || []).some(function (p) {
    return p.player_id === pid;
  });
}

function actionDuplicateEvent_(ctx, payload) {
  var srcId = requireId_(payload.eventId, '大会');
  assertCreateAllowed_(ctx);
  var bundle = collectEvent_(ctx, srcId);
  if (!bundle.stages.length || !bundle.rule) throw appError_('DATA_CONFLICT', '複製元の大会の段階・ルールが見つかりません。');
  var name = cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH);
  var res = cloneEventStructure_(ctx, { event: bundle.event, rules: ctx.table('Rules').rows.filter(function (r) { return r.event_id === srcId; }), stages: bundle.stages, groups: bundle.groups, players: bundle.players }, {
    name: name,
    players: payload.includePlayers === true,
  });
  recordHistory_(ctx, 'event.duplicate', 'Event', res.event.event_id, res.event.event_id, null, { from: srcId, players: payload.includePlayers === true, by: ctx.user ? ctx.user.label : '' });
  return { eventId: res.event.event_id, duplicatedFrom: srcId };
}

/* ---------- 共同主催者（F20） ---------- */

function actionAddCollaborator_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '共同主催者の追加');
  var event = findRecord_(ctx.table('Events'), eventId, '大会');
  var email = normalizeEmail_(payload.email);
  if (!email) throw appError_('VALIDATION', '共同主催者の Google アカウント（メールアドレス）を正しく入力してください。');
  if (email === event.owner_email) throw appError_('VALIDATION', 'この大会を作った本人です。');
  var table = ctx.table('Collaborators');
  var current = table.rows.filter(function (r) {
    return r.event_id === eventId;
  });
  if (current.some(function (r) { return collabEmailOf_(r) === email; })) throw appError_('VALIDATION', 'この Google アカウントは既に共同主催者（または招待中）です。');
  if (current.length >= ADMIN_CONFIG.MAX_COLLABORATORS) throw appError_('LIMIT', '共同主催者は ' + ADMIN_CONFIG.MAX_COLLABORATORS + ' 人までです。');
  var id = newId_('COL', table.byKey);
  // v0.9: 入力したメールアドレスは招待（invite_email）。相手がログインして紐付くまで権限はない。email 列は書かない（旧版はこの列で権限を判定するため）
  appendRecords_(table, [{ collab_id: id, event_id: eventId, email: '', invite_email: email, sub: '', link_json: '', role: 'editor', added_by: ctx.user.label, rev: 1, created_at: ctx.now, updated_at: ctx.now }]);
  recordHistory_(ctx, 'collaborator.add', 'Event', eventId, eventId, null, { email: email });
  return { eventId: eventId };
}

function actionRemoveCollaborator_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '共同主催者の解除');
  var table = ctx.table('Collaborators');
  var rec = findRecord_(table, requireId_(payload.collabId, '共同主催者'), '共同主催者');
  if (rec.event_id !== eventId) throw appError_('NOT_FOUND', '共同主催者が見つかりません。');
  deleteRecords_(table, [rec]);
  recordHistory_(ctx, 'collaborator.remove', 'Event', eventId, eventId, { email: collabEmailOf_(rec) }, null);
  return { eventId: eventId };
}

/* ---------- 保存したファイル（JSON）からの復元（F21） ---------- */

var RESTORE_LIMITS_ = { Rules: 16, Players: 128, Stages: 8, Groups: 64, Entries: 2000, Matches: 10000 };

/**
 * 「大会のデータを保存」で作ったファイルから、新しい大会として復元する。既存の大会は上書きしない。
 * mode: settings = 段階・ルール・組の設定（と、選べば選手）だけ / full = 選手・組み合わせ・結果も
 * 所有者は復元する人（Google ログイン）。管理パスワード・共同主催者・履歴は復元しない。ID はすべて新しく付け、参照を付け替える。
 * 検証に失敗したら何も登録しない（まとめて書き込むので途中まで登録されることもない）。
 */
function actionRestoreEvent_(ctx, payload) {
  assertCreateAllowed_(ctx);
  var a = payload.archive;
  if (!a || typeof a !== 'object' || a.format !== 'n02-tournament-archive' || (a.formatVersion !== 1 && a.formatVersion !== 2)) {
    throw appError_('VALIDATION', 'n02 の大会データのファイル（「大会のデータを保存」で作ったもの）を選んでください。');
  }
  var mode = payload.mode === 'full' ? 'full' : 'settings';
  var ev = a.event;
  if (!ev || typeof ev !== 'object' || !isValidId_(ev.event_id)) throw appError_('VALIDATION', 'ファイルの大会の情報が不正です。');
  var t = a.tables && typeof a.tables === 'object' ? a.tables : {};
  var rows = {};
  var problems = [];
  ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches'].forEach(function (name) {
    var list = Array.isArray(t[name]) ? t[name] : [];
    if (list.length > RESTORE_LIMITS_[name]) problems.push(name + ' の行が多すぎます（' + list.length + '）');
    list.forEach(function (r, i) {
      if (!r || typeof r !== 'object' || r.event_id !== ev.event_id || !isValidId_(r[SCHEMA[name].key])) problems.push(name + ' の ' + (i + 1) + ' 行目が不正です');
    });
    rows[name] = list;
  });
  if (!rows.Rules.length || !rows.Stages.length) problems.push('ルールか段階がありません');
  var byId = function (list, key) {
    var out = {};
    list.forEach(function (r) {
      out[r[key]] = r;
    });
    return out;
  };
  var ruleById = byId(rows.Rules, 'rule_id');
  var stageById = byId(rows.Stages, 'stage_id');
  var groupById = byId(rows.Groups, 'group_id');
  var playerById = byId(rows.Players, 'player_id');
  var matchById = byId(rows.Matches, 'match_id');
  rows.Stages.forEach(function (st) {
    if (!ruleById[st.rule_id]) problems.push('段階「' + st.name + '」のルールがありません');
    if (!STAGE_TYPE_LABEL[st.type]) problems.push('段階「' + st.name + '」の種類が不明です');
  });
  rows.Groups.forEach(function (g) {
    if (!stageById[g.stage_id]) problems.push('グループ「' + g.name + '」の段階がありません');
  });
  var names = {};
  rows.Players.forEach(function (p) {
    try {
      var n = cleanText_(p.display_name, '選手名', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
      if (names[n]) problems.push('選手名「' + n + '」が重複しています');
      names[n] = true;
    } catch (e) {
      problems.push('選手名が不正です');
    }
  });
  if (mode === 'full') {
    rows.Entries.forEach(function (e) {
      if (!stageById[e.stage_id] || (e.group_id && !groupById[e.group_id]) || !playerById[e.player_id]) problems.push('出場者の参照が不正です');
    });
    rows.Matches.forEach(function (m) {
      var refs = [m.player1_id, m.player2_id, m.winner_id].filter(Boolean);
      if (!stageById[m.stage_id] || (m.group_id && !groupById[m.group_id]) || refs.some(function (pid) { return !playerById[pid]; })) problems.push('試合の参照が不正です');
      [m.next_match_id, m.loser_next_match_id].forEach(function (id) {
        if (id && !matchById[id]) problems.push('勝ち上がり先の試合がありません');
      });
      if (m.rule_id && !ruleById[m.rule_id]) problems.push('試合のルールがありません');
    });
  }
  if (problems.length) {
    var uniq = problems.filter(function (p, i) {
      return problems.indexOf(p) === i;
    });
    throw appError_('VALIDATION', '復元していません（ファイルの内容が不正です）: ' + uniq.slice(0, 8).join(' / ') + (uniq.length > 8 ? ' ほか' : ''));
  }
  var name = cleanText_(payload.name || ev.name + '（復元）', '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH);
  var res = cloneEventStructure_(ctx, { event: ev, rules: rows.Rules, stages: rows.Stages, groups: rows.Groups, players: rows.Players }, {
    name: name,
    dateLabel: typeof ev.date_label === 'string' ? cleanText_(ev.date_label, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }) : '',
    players: mode === 'full' || payload.includePlayers === true,
    keepRuntime: mode === 'full',
    keepNotes: mode === 'full',
    keepAnnouncement: mode === 'full',
  });
  var maps = res.maps;
  var counts = { players: Object.keys(maps.player).length, stages: rows.Stages.length, entries: 0, matches: 0 };
  if (mode === 'full') {
    var entTaken = Object.assign({}, ctx.table('Entries').byKey);
    var entries = rows.Entries.map(function (e) {
      var id = newId_('ENT', entTaken);
      entTaken[id] = true;
      return {
        entry_id: id,
        event_id: res.event.event_id,
        stage_id: maps.stage[e.stage_id],
        group_id: e.group_id ? maps.group[e.group_id] : '',
        player_id: maps.player[e.player_id],
        seed: e.seed,
        manual_order: e.manual_order,
        source_label: e.source_label || '',
        start_round: e.start_round || null,
        meta_json: remapEntryMeta_(e.meta_json, maps),
        rev: 1,
        created_at: ctx.now,
        updated_at: ctx.now,
      };
    });
    var matTaken = Object.assign({}, ctx.table('Matches').byKey);
    var matchMap = {};
    rows.Matches.forEach(function (m) {
      var id = newId_('MAT', matTaken);
      matTaken[id] = true;
      matchMap[m.match_id] = id;
    });
    var pmap = function (pid) {
      return pid ? maps.player[pid] : '';
    };
    var matches = rows.Matches.map(function (m) {
      return {
        match_id: matchMap[m.match_id],
        event_id: res.event.event_id,
        stage_id: maps.stage[m.stage_id],
        group_id: m.group_id ? maps.group[m.group_id] : '',
        round: m.round,
        order: m.order,
        player1_id: pmap(m.player1_id),
        player2_id: pmap(m.player2_id),
        player1_legs: m.player1_legs,
        player2_legs: m.player2_legs,
        player1_sets: m.player1_sets,
        player2_sets: m.player2_sets,
        label: m.label || '',
        status: m.status,
        winner_id: pmap(m.winner_id),
        rule_id: m.rule_id ? maps.rule[m.rule_id] : '',
        next_match_id: m.next_match_id ? matchMap[m.next_match_id] : '',
        next_match_slot: m.next_match_slot,
        loser_next_match_id: m.loser_next_match_id ? matchMap[m.loser_next_match_id] : '',
        loser_next_match_slot: m.loser_next_match_slot,
        external_ref: '',
        rev: 1,
        created_at: ctx.now,
        updated_at: ctx.now,
        confirmed_at: m.confirmed_at || '',
        result_type: m.result_type || '',
        result_note: m.result_note || '',
        schedule_json: typeof m.schedule_json === 'string' ? m.schedule_json : '',
        bracket_side: m.bracket_side || '',
        meta_json: typeof m.meta_json === 'string' ? m.meta_json : '',
      };
    });
    appendRecords_(ctx.table('Entries'), entries);
    appendRecords_(ctx.table('Matches'), matches);
    counts.entries = entries.length;
    counts.matches = matches.length;
    // 復元した結果を、保存する前に検証する（不成立の結果があれば、何も登録しない）
    var view = buildEventView_(collectEvent_(ctx, res.event.event_id), true);
    if (view.progress.check) throw appError_('VALIDATION', '復元していません: ファイルの試合結果に、ルールと合わないものが ' + view.progress.check + ' 試合あります。');
  }
  recordHistory_(ctx, 'event.restore', 'Event', res.event.event_id, res.event.event_id, null, { from: ev.event_id, exportedAt: a.exportedAt || '', mode: mode, counts: counts, by: ctx.user ? ctx.user.label : '' });
  return { eventId: res.event.event_id, restored: counts, mode: mode };
}

function remapEntryMeta_(text, maps) {
  var meta = safeJson_(text, {});
  if (meta.sourceGroupId) meta.sourceGroupId = maps.group[meta.sourceGroupId] || '';
  if (meta.fromStageId) meta.fromStageId = maps.stage[meta.fromStageId] || '';
  return Object.keys(meta).length ? JSON.stringify(meta) : '';
}

/* ---------- 操作の後処理（F05 自動終了） ---------- */

/**
 * 大会を変更する操作の後に呼ぶ（runMutation_ が公開データを作る前）。
 * 自動終了が有効な大会（v0.8 で作った大会。既存の大会は主催者が設定で有効にしたときだけ）で、結果・組み合わせが変わったとき:
 * - すべての段階が終わった（未作成の本戦・未実施の節・リセットの決勝・3 位決定戦を含む）→「終了」
 * - 自動で終了にした大会で、訂正などにより終わっていない段階ができた →「開催中」に戻す（主催者が手で終了にした大会は戻さない）
 */
function afterEventChange_(ctx, eventId) {
  var events = ctx.table('Events');
  var event = events.byKey[eventId];
  if (!event || !ctx.touchedResults) return;
  var cfg = eventConfig_(event);
  if (!cfg.autoFinish) return;
  var view = buildEventView_(collectEvent_(ctx, eventId), true);
  var raw = safeJson_(event.config_json, {});
  if (view.complete && event.status !== EVENT_STATUS.FINISHED) {
    raw.autoFinishedAt = ctx.now;
    event.status = EVENT_STATUS.FINISHED;
    recordHistory_(ctx, 'event.autoFinish', 'Event', eventId, eventId, null, { at: ctx.now });
  } else if (!view.complete && event.status === EVENT_STATUS.FINISHED && cfg.autoFinishedAt) {
    delete raw.autoFinishedAt;
    event.status = EVENT_STATUS.RUNNING;
    recordHistory_(ctx, 'event.autoReopen', 'Event', eventId, eventId, null, { reasons: view.completion.reasons.slice(0, 5) });
  } else {
    return;
  }
  event.config_json = JSON.stringify(raw);
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
}
