/* 大会の組み立て済みビュー（運営画面・閲覧ページの公開データの元。v0.8 で段階の種類を追加） */

/* ---------- 設定の読み込み ---------- */

var EVENT_TIMEZONE_DEFAULT_ = 'Asia/Tokyo';

/**
 * 大会の設定（Events.config_json）。v0.7 までの大会には何もないので、すべて「使わない」既定値になる
 * （自動終了・公開する項目などの新機能で、既存の大会の状態を書き換えないため）。
 */
function eventConfig_(event) {
  var c = safeJson_(event && event.config_json, {});
  var pub = c.publicFields && typeof c.publicFields === 'object' ? c.publicFields : {};
  var ann = c.announcement && typeof c.announcement === 'object' ? c.announcement : null;
  return {
    template: typeof c.template === 'string' && formatById_(c.template) ? c.template : '',
    timezone: typeof c.timezone === 'string' && c.timezone ? c.timezone : EVENT_TIMEZONE_DEFAULT_,
    announcement: ann && typeof ann.text === 'string' && ann.text ? { text: ann.text, updatedAt: String(ann.updatedAt || '') } : null,
    ruleDisplay: c.ruleDisplay && typeof c.ruleDisplay === 'object' ? c.ruleDisplay : null,
    publicFields: { affiliation: pub.affiliation === true, rating: pub.rating === true },
    autoFinish: c.autoFinish === true,
    autoFinishedAt: typeof c.autoFinishedAt === 'string' ? c.autoFinishedAt : '',
  };
}

function matchMeta_(m) {
  return safeJson_(m && m.meta_json, {});
}

function groupMeta_(g) {
  return safeJson_(g && g.meta_json, {});
}

function entryMeta_(e) {
  return safeJson_(e && e.meta_json, {});
}

function playerMeta_(p) {
  return safeJson_(p && p.meta_json, {});
}

/** 試合の予定（F07・F08）。{ date: 'YYYY-MM-DD', time: 'HH:MM' | '', venue, board, referee, status, original, reason, changedAt, changedBy } */
function scheduleOf_(m) {
  var s = safeJson_(m && m.schedule_json, null);
  if (!s) return null;
  return {
    date: typeof s.date === 'string' ? s.date : '',
    time: typeof s.time === 'string' ? s.time : '',
    venue: typeof s.venue === 'string' ? s.venue : '',
    board: typeof s.board === 'string' ? s.board : '',
    referee: typeof s.referee === 'string' ? s.referee : '',
    status: s.status === 'postponed' || s.status === 'rescheduled' ? s.status : '',
    original: s.original && typeof s.original === 'object' ? { date: String(s.original.date || ''), time: String(s.original.time || '') } : null,
    reason: typeof s.reason === 'string' ? s.reason : '',
    changedAt: typeof s.changedAt === 'string' ? s.changedAt : '',
    changedBy: typeof s.changedBy === 'string' ? s.changedBy : '',
  };
}

/* ---------- 1 試合の判定 ---------- */

/**
 * 1 試合の状態を公開用に判定する。シートを直接いじられた場合に備え、保存済みデータも再検証する。
 * 状態: scheduled / live / final / check（要確認）/ pending（勝ち抜き戦で対戦相手が未確定）/
 *       void（行わなくなった試合。数に入れない）/ bye（スイス式の不戦。数に入れない）
 */
function judgeMatch_(bundle, match, playerById, members) {
  var stage = bundle.stageById[match.stage_id];
  var rt = match.result_type || '';
  if (rt === RESULT_TYPE.NOT_NEEDED) return { state: 'void', input: null, winnerSide: 0, problems: [], resultType: rt };
  if (rt === RESULT_TYPE.BYE) {
    var okBye = !!playerById[match.player1_id] && !match.player2_id && (!members || members[match.player1_id]);
    return okBye
      ? { state: 'bye', input: null, winnerSide: 1, problems: [], resultType: rt }
      : { state: 'check', input: null, winnerSide: 0, problems: ['不戦（Bye）の記録が不正です'], resultType: rt };
  }
  var input = storedInput_(match);
  if (isBracketStage_(stage) && (!match.player1_id || !match.player2_id)) {
    if (!matchStarted_(match)) return { state: 'pending', input: null, winnerSide: 0, problems: [] };
  }
  var problems = [];
  if (!playerById[match.player1_id] || !playerById[match.player2_id]) problems.push('選手が見つかりません');
  if (match.player1_id === match.player2_id) problems.push('同じ選手同士の対戦です');
  if (members && (!members[match.player1_id] || !members[match.player2_id])) {
    problems.push('この段階・グループに属していない選手が含まれています');
  }
  var status = match.status || MATCH_STATUS.SCHEDULED;
  var spec = matchSpec_(bundle, match);
  if (rt === RESULT_TYPE.WALKOVER || rt === RESULT_TYPE.RETIRED || rt === RESULT_TYPE.DISQUALIFIED) {
    if (status !== MATCH_STATUS.FINAL) problems.push('不戦勝・棄権・失格は確定済みの試合だけに記録できます');
    var side = match.winner_id && match.winner_id === match.player1_id ? 1 : match.winner_id && match.winner_id === match.player2_id ? 2 : 0;
    if (!side) problems.push('勝者が記録されていません');
    if (rt === RESULT_TYPE.WALKOVER) {
      input = { p1Legs: null, p2Legs: null, p1Sets: 0, p2Sets: 0 };
    } else if (input.p1Legs !== null || input.p2Legs !== null) {
      // 棄権・失格の時点の Leg 数は、進行中の試合として成り立つ数（まだ勝敗が決まっていない）
      var at = evaluateMatchInput_(MATCH_STATUS.LIVE, input, spec);
      if (!at.ok) problems.push('棄権・失格の時点の Leg 数が不正です（' + at.problems.join(' / ') + '）');
    }
    if (problems.length) return { state: 'check', input: null, winnerSide: 0, problems: problems, resultType: rt };
    return { state: MATCH_STATUS.FINAL, input: input, winnerSide: side, problems: [], resultType: rt };
  }
  var result = evaluateMatchInput_(status, input, spec);
  problems = problems.concat(result.problems);
  if (result.draw && (isBracketStage_(stage) || stage.type === STAGE_TYPE.PROMOTION)) problems.push('勝ち抜き戦・入替戦では引き分けを確定できません');
  if (problems.length) return { state: 'check', input: null, winnerSide: 0, problems: problems };
  return { state: status, input: input, winnerSide: result.winnerSide, draw: !!result.draw, problems: [] };
}

/** 確定した試合を順位計算用の形にする（不戦勝の Leg 数の扱いは段階の設定） */
function finalRecord_(m, judge, spec, cfg) {
  if (judge.state === 'bye') return { p1: m.player1_id, p2: '', bye: true, winner: m.player1_id };
  var rec = {
    p1: m.player1_id,
    p2: m.player2_id,
    l1: judge.input ? judge.input.p1Legs : null,
    l2: judge.input ? judge.input.p2Legs : null,
    s1: judge.input ? judge.input.p1Sets : 0,
    s2: judge.input ? judge.input.p2Sets : 0,
    draw: !!judge.draw,
    winner: judge.winnerSide === 1 ? m.player1_id : judge.winnerSide === 2 ? m.player2_id : '',
    resultType: judge.resultType || '',
    countLegs: true,
  };
  if (judge.resultType === RESULT_TYPE.WALKOVER) {
    if (cfg.walkoverLegs === 'award' && spec) {
      var need = spec.format === 'fixed' ? Math.floor(spec.bestOf / 2) + 1 : legsToWin_(spec.bestOf);
      if (spec.format === 'sets') {
        rec.s1 = judge.winnerSide === 1 ? need : 0;
        rec.s2 = judge.winnerSide === 2 ? need : 0;
        rec.l1 = rec.l2 = 0;
      } else {
        rec.l1 = judge.winnerSide === 1 ? need : 0;
        rec.l2 = judge.winnerSide === 2 ? need : 0;
      }
    } else {
      rec.countLegs = false;
    }
  }
  return rec;
}

function countProgress_(progress, state) {
  if (state === 'void' || state === 'bye') return;
  progress.total++;
  progress[state] = (progress[state] || 0) + 1;
}

/* ---------- 大会全体のビュー ---------- */

/**
 * 運営画面・公開画面の両方で使う、大会の組み立て済みビュー。
 * includePrivate=false のとき、閲覧者に出してよい項目だけを含む。
 */
function buildEventView_(bundle, includePrivate) {
  var evCfg = eventConfig_(bundle.event);
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  var nameOf = function (pid) {
    if (!pid) return '';
    return playerById[pid] ? playerById[pid].display_name : '（不明な選手）';
  };
  /** 選手の公開してよい情報（所属は主催者が公開にした場合だけ） */
  var playerRef = function (pid) {
    var out = { id: pid, name: nameOf(pid) };
    var p = playerById[pid];
    if (p && (includePrivate || evCfg.publicFields.affiliation) && p.affiliation) out.affiliation = p.affiliation;
    if (p && (includePrivate || evCfg.publicFields.rating) && p.rating !== '') out.rating = p.rating;
    return out;
  };

  var matchView = function (m, judge, label) {
    var spec = matchSpec_(bundle, m);
    var sets = spec && spec.format === 'sets';
    var out = {
      id: m.match_id,
      round: m.round,
      order: m.order,
      label: label,
      bestOf: spec ? spec.bestOf : null,
      p1: { id: m.player1_id, name: nameOf(m.player1_id), legs: judge.input ? judge.input.p1Legs : null, sets: sets && judge.input ? judge.input.p1Sets : null },
      p2: { id: m.player2_id, name: nameOf(m.player2_id), legs: judge.input ? judge.input.p2Legs : null, sets: sets && judge.input ? judge.input.p2Sets : null },
      status: judge.state,
      winnerId: judge.winnerSide === 1 ? m.player1_id : judge.winnerSide === 2 ? m.player2_id : null,
    };
    if (spec && spec.format === 'fixed') out.fixedLegs = spec.bestOf;
    if (judge.draw) out.draw = true;
    if (judge.resultType) out.resultType = judge.resultType;
    if (m.bracket_side) out.side = m.bracket_side;
    var sch = scheduleOf_(m);
    if (sch && (sch.date || sch.time || sch.venue || sch.board || sch.referee || sch.status)) {
      out.schedule = { date: sch.date, time: sch.time, venue: sch.venue, board: sch.board, referee: sch.referee, status: sch.status, original: sch.original };
      if (includePrivate) {
        out.schedule.reason = sch.reason;
        out.schedule.changedAt = sch.changedAt;
        out.schedule.changedBy = sch.changedBy;
      }
    }
    if (includePrivate) {
      var meta = matchMeta_(m);
      out.rev = m.rev || 0;
      out.stageId = m.stage_id;
      out.groupId = m.group_id;
      out.storedStatus = m.status;
      out.storedP1Legs = m.player1_legs;
      out.storedP2Legs = m.player2_legs;
      out.storedP1Sets = m.player1_sets;
      out.storedP2Sets = m.player2_sets;
      out.resultNote = m.result_note || '';
      out.problems = judge.problems;
      out.updatedAt = m.updated_at;
      out.confirmedAt = m.confirmed_at;
      out.spec = spec;
      out.nextMatchId = m.next_match_id || '';
      out.loserNextMatchId = m.loser_next_match_id || '';
      if (meta.gf) out.grandFinal = meta.gf;
    }
    return out;
  };

  var allProgress = emptyProgress_();
  var stages = bundle.stages.map(function (stage) {
    var cfg = stageConfig_(stage);
    var stageMatches = bundle.matches.filter(function (m) {
      return m.stage_id === stage.stage_id;
    });
    var stageEntries = bundle.entries.filter(function (e) {
      return e.stage_id === stage.stage_id;
    });
    var ctxStage = { stage: stage, cfg: cfg, matches: stageMatches, entries: stageEntries, playerById: playerById, nameOf: nameOf, playerRef: playerRef, matchView: matchView, includePrivate: includePrivate };
    var view = {
      id: stage.stage_id,
      name: stage.name,
      type: stage.type,
      order: stage.order,
      rule: ruleView_(stageRule_(bundle, stage)),
    };
    var progress;
    if (isGroupStage_(stage)) progress = groupStageView_(bundle, ctxStage, view);
    else if (stage.type === STAGE_TYPE.SERIES) progress = seriesStageView_(bundle, ctxStage, view);
    else if (stage.type === STAGE_TYPE.DOUBLE_ELIMINATION) progress = doubleEliminationView_(bundle, ctxStage, view);
    else if (stage.type === STAGE_TYPE.PROMOTION) progress = promotionStageView_(bundle, ctxStage, view);
    else progress = eliminationView_(bundle, ctxStage, view);
    addProgress_(allProgress, progress);
    view.progress = progress;
    var done = stageCompletion_(view, cfg, stage);
    view.complete = done.complete;
    if (includePrivate) {
      var rule = stageRule_(bundle, stage);
      view.completion = done;
      view.rev = stage.rev || 0;
      view.config = cfg;
      view.ruleId = rule ? rule.rule_id : '';
      view.ruleRev = rule ? rule.rev || 0 : 0;
      view.ruleProvisional = rule ? rule.is_provisional : false;
      view.matchCount = stageMatches.length;
      view.hasResults = stageMatches.some(matchStarted_);
      view.entryCount = stageEntries.length;
      view.entries = stageEntries.map(function (e) {
        var em = entryMeta_(e);
        return {
          playerId: e.player_id,
          groupId: e.group_id,
          seed: e.seed,
          manualOrder: e.manual_order,
          source: e.source_label || '',
          startRound: e.start_round || 1,
          direct: em.direct === true,
          sourceGroupId: em.sourceGroupId || '',
        };
      });
      view.feeds = bundle.stages
        .filter(function (s) {
          return stageConfig_(s).advancement.some(function (r) {
            return r.targetStageId === stage.stage_id;
          });
        })
        .map(function (s) {
          return s.stage_id;
        });
    }
    return view;
  });

  var lastUpdated = '';
  bundle.matches.forEach(function (m) {
    if (m.updated_at && m.updated_at > lastUpdated) lastUpdated = m.updated_at;
  });
  if (bundle.event.updated_at > lastUpdated) lastUpdated = bundle.event.updated_at;

  var firstGroupStage = stages.filter(function (s) {
    return s.groups && s.type !== STAGE_TYPE.SWISS;
  })[0];
  var view = {
    event: {
      id: bundle.event.event_id,
      name: bundle.event.name,
      dateLabel: bundle.event.date_label,
      status: bundle.event.status,
      // 登録選手の人数（名前やメモは含まない。ポータルの一覧に出す）
      playerCount: bundle.players.length,
    },
    rule: ruleView_(bundle.rule),
    stages: stages,
    // 互換用（旧閲覧ページ・旧運営画面は最初のロビンの groups を読む）
    stage: bundle.stage ? { id: bundle.stage.stage_id, name: bundle.stage.name, type: bundle.stage.type } : null,
    groups: firstGroupStage ? firstGroupStage.groups : [],
    progress: allProgress,
    dataUpdatedAt: lastUpdated,
  };
  // v0.8: 形式（作成時のひな形）・お知らせ・ルールの表示（いずれも主催者が公開用に入力したもの）
  if (evCfg.template) view.event.format = evCfg.template;
  if (evCfg.announcement) view.event.announcement = evCfg.announcement;
  if (evCfg.ruleDisplay) view.event.ruleDisplay = evCfg.ruleDisplay;
  view.event.timezone = evCfg.timezone;
  // v1.0: 期制リーグの期（期の一覧・順位表の昇降格の帯・次期を確定した後の結果）
  if (bundle.season) view.event.season = seasonPublicView_(bundle, stages);
  var completion = eventCompletionFromStages_(stages);
  view.complete = completion.complete;
  if (includePrivate) {
    view.completion = completion;
    view.event.rev = bundle.event.rev || 0;
    view.event.isPublic = bundle.event.is_public;
    view.event.isFeatured = bundle.event.is_featured;
    view.event.isSample = bundle.event.is_sample;
    view.event.organizerName = bundle.event.organizer_name;
    view.event.ownerEmail = bundle.event.owner_email;
    view.event.staffPasswordSet = !!bundle.event.staff_pass_hash;
    view.event.staffPasswordSetAt = bundle.event.staff_pass_set_at;
    view.event.notes = bundle.event.notes;
    view.event.config = evCfg;
    if (view.rule && bundle.rule) {
      view.rule.id = bundle.rule.rule_id;
      view.rule.rev = bundle.rule.rev || 0;
      view.rule.notes = bundle.rule.notes;
    }
    view.tiebreakerLabels = TIEBREAKERS;
    view.tiebreakersFor = TIEBREAKERS_FOR_;
    view.players = bundle.players.map(function (p) {
      var memberships = bundle.entries.filter(function (e) {
        return e.player_id === p.player_id;
      });
      var first = memberships.filter(function (e) {
        return firstGroupStage && e.stage_id === firstGroupStage.id;
      })[0];
      var pm = playerMeta_(p);
      return {
        id: p.player_id,
        name: p.display_name,
        rev: p.rev || 0,
        affiliation: p.affiliation || '',
        rating: p.rating === null || p.rating === undefined ? '' : String(p.rating),
        seed: p.seed || null,
        notes: p.notes || '',
        withdrawn: pm.withdrawn || null,
        groupId: first ? first.group_id : '',
        stageIds: memberships.map(function (e) {
          return e.stage_id;
        }),
        matchCount: bundle.matches.filter(function (m) {
          return m.player1_id === p.player_id || m.player2_id === p.player_id;
        }).length,
      };
    });
  }
  return view;
}

/* ---------- 段階の種類ごとのビュー ---------- */

/** ロビン・リーグ・スイス式（グループごとの順位表と対戦） */
function groupStageView_(bundle, c, view) {
  var stage = c.stage;
  var cfg = c.cfg;
  var progress = emptyProgress_();
  var league = stage.type === STAGE_TYPE.LEAGUE;
  var swiss = stage.type === STAGE_TYPE.SWISS;
  view.tiebreakers = cfg.tiebreakers;
  view.advanced = cfg.advanced;
  view.cycles = cfg.cycles;
  if (cfg.points) view.points = cfg.points;
  view.groups = bundle.groups
    .filter(function (g) {
      return g.stage_id === stage.stage_id;
    })
    .map(function (g) {
      var groupEntries = c.entries.filter(function (e) {
        return e.group_id === g.group_id;
      });
      var members = groupEntries.map(function (e) {
        return e.player_id;
      });
      var memberSet = {};
      var manual = {};
      groupEntries.forEach(function (e) {
        memberSet[e.player_id] = true;
        if (e.manual_order) manual[e.player_id] = e.manual_order;
      });
      var gProgress = emptyProgress_();
      var finals = [];
      var maxRound = 0;
      var matches = c.matches
        .filter(function (m) {
          return m.group_id === g.group_id;
        })
        .map(function (m) {
          var judge = judgeMatch_(bundle, m, c.playerById, memberSet);
          countProgress_(gProgress, judge.state);
          if (judge.state === MATCH_STATUS.FINAL || judge.state === 'bye') finals.push(finalRecord_(m, judge, matchSpec_(bundle, m), cfg));
          if (m.round > maxRound) maxRound = m.round;
          var label = cfg.roundLabels[String(m.round)] || (league ? '第' + m.round + '節' : swiss ? '第' + m.round + '回戦' : 'R' + m.round);
          return c.matchView(m, judge, label);
        });
      addProgress_(progress, gProgress);
      var standings = swiss ? swissStandings_(members, finals, cfg, manual) : computeStandings_(members, finals, cfg.tiebreakers, manual, cfg);
      var group = {
        id: g.group_id,
        name: g.name,
        players: members.map(c.playerRef),
        standings: standings,
        // 互換用（旧閲覧ページは summary を読む）
        summary: standings,
        complete: gProgress.total > 0 && gProgress.final === gProgress.total,
        progress: gProgress,
        matches: matches,
      };
      if (swiss) group.roundsPlayed = maxRound;
      if (c.includePrivate) group.rev = g.rev || 0;
      return group;
    });
  if (swiss) {
    var played = view.groups.length ? view.groups[0].roundsPlayed || 0 : 0;
    view.swiss = { rounds: cfg.rounds, generated: played };
    if (c.includePrivate) view.swiss.log = cfg.pairingLog;
  }
  return progress;
}

/** トーナメント（固定の表・回戦ごとの抽選） */
function eliminationView_(bundle, c, view) {
  var cfg = c.cfg;
  var progress = emptyProgress_();
  view.thirdPlace = cfg.thirdPlace;
  view.roundBestOf = cfg.roundBestOf;
  view.drawMode = cfg.drawMode;
  if (cfg.drawMode === 'redraw') view.fixedRounds = cfg.fixedRounds;
  var rounds = {};
  var champion = null;
  c.matches.forEach(function (m) {
    var judge = judgeMatch_(bundle, m, c.playerById, null);
    countProgress_(progress, judge.state);
    var key = String(m.round);
    if (!rounds[key]) rounds[key] = { round: m.round, label: '', matches: [] };
    var mv = c.matchView(m, judge, m.label || m.round + '回戦');
    rounds[key].matches.push(mv);
    if (m.label === '決勝' && mv.winnerId) champion = { id: mv.winnerId, name: c.nameOf(mv.winnerId) };
  });
  view.rounds = Object.keys(rounds)
    .map(function (k) {
      var r = rounds[k];
      var main = r.matches.filter(function (x) {
        return x.label !== '3位決定戦';
      })[0];
      r.label = main ? main.label : r.matches[0].label;
      return r;
    })
    .sort(function (a, b) {
      return a.round - b.round;
    });
  view.champion = champion;
  view.entrants = c.entries
    .slice()
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    })
    .map(function (e) {
      var out = c.playerRef(e.player_id);
      out.seed = e.seed;
      out.source = e.source_label || '';
      if (e.start_round > 1) out.startRound = e.start_round;
      if (entryMeta_(e).direct === true) out.direct = true;
      return out;
    });
  return progress;
}

/** ダブルエリミネーション（勝者側・敗者側・グランドファイナル） */
function doubleEliminationView_(bundle, c, view) {
  var progress = emptyProgress_();
  view.grandFinal = c.cfg.grandFinal;
  var sides = { W: {}, L: {}, GF: {} };
  var byKind = {};
  c.matches.forEach(function (m) {
    var judge = judgeMatch_(bundle, m, c.playerById, null);
    countProgress_(progress, judge.state);
    var side = sides[m.bracket_side] ? m.bracket_side : 'W';
    var key = String(m.round);
    if (!sides[side][key]) sides[side][key] = { round: m.round, label: '', matches: [] };
    var mv = c.matchView(m, judge, m.label || '');
    sides[side][key].matches.push(mv);
    var meta = matchMeta_(m);
    if (meta.gf) byKind['gf' + meta.gf] = { m: m, judge: judge, view: mv };
  });
  var toList = function (obj) {
    return Object.keys(obj)
      .map(function (k) {
        var r = obj[k];
        r.label = r.matches[0].label;
        return r;
      })
      .sort(function (a, b) {
        return a.round - b.round;
      });
  };
  view.sides = [
    { side: 'W', label: '勝者側', rounds: toList(sides.W) },
    { side: 'L', label: '敗者側', rounds: toList(sides.L) },
    { side: 'GF', label: 'グランドファイナル', rounds: toList(sides.GF) },
  ];
  // 優勝: リセットの決勝を行ったらその勝者、行わなかったら（またはリセットなしなら）グランドファイナルの勝者
  var gf1 = byKind.gf1;
  var gf2 = byKind.gf2;
  var champ = null;
  var runner = null;
  if (gf2 && gf2.judge.state === MATCH_STATUS.FINAL && gf2.view.winnerId) {
    champ = gf2.view.winnerId;
    runner = gf2.view.winnerId === gf2.m.player1_id ? gf2.m.player2_id : gf2.m.player1_id;
  } else if (gf1 && gf1.judge.state === MATCH_STATUS.FINAL && gf1.view.winnerId && (!gf2 || gf2.judge.state === 'void')) {
    champ = gf1.view.winnerId;
    runner = gf1.view.winnerId === gf1.m.player1_id ? gf1.m.player2_id : gf1.m.player1_id;
  }
  view.champion = champ ? { id: champ, name: c.nameOf(champ) } : null;
  view.runnerUp = runner ? { id: runner, name: c.nameOf(runner) } : null;
  view.entrants = c.entries
    .slice()
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    })
    .map(function (e) {
      var out = c.playerRef(e.player_id);
      out.seed = e.seed;
      out.source = e.source_label || '';
      return out;
    });
  return progress;
}

/**
 * ポイントシリーズ: 節（グループ）ごとの小トーナメントと、到達順位のポイントの累計。
 * 各節の得点は「到達した順位に対する総点」で、勝ち上がった回戦の点を足し合わせない（二重加算しない）。
 * 節の決勝が確定したら、その節の得点は確定。途中の節は、敗退が決まった選手の点だけを「暫定」として出す。
 * 中止にした節は点がなく、全節の完了の条件からも外す。
 */
function seriesStageView_(bundle, c, view) {
  var cfg = c.cfg;
  var progress = emptyProgress_();
  view.planned = cfg.nights;
  view.nightPoints = cfg.nightPoints;
  view.tiebreakers = cfg.tiebreakers;
  view.advanced = cfg.advanced;
  var roster = c.entries.filter(function (e) {
    return !e.group_id;
  });
  var rosterIds = roster
    .slice()
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    })
    .map(function (e) {
      return e.player_id;
    });
  var manual = {};
  roster.forEach(function (e) {
    if (e.manual_order) manual[e.player_id] = e.manual_order;
  });
  var total = {};
  var provisional = {};
  var nightWins = {};
  var legStats = tallyStats_(rosterIds, [], null);
  rosterIds.forEach(function (pid) {
    total[pid] = 0;
    provisional[pid] = 0;
    nightWins[pid] = 0;
  });
  view.nights = bundle.groups
    .filter(function (g) {
      return g.stage_id === c.stage.stage_id;
    })
    .map(function (g) {
      var meta = groupMeta_(g);
      var participants = c.entries
        .filter(function (e) {
          return e.group_id === g.group_id;
        })
        .sort(function (a, b) {
          return (a.seed || 0) - (b.seed || 0);
        });
      var gm = c.matches.filter(function (m) {
        return m.group_id === g.group_id;
      });
      var nProgress = emptyProgress_();
      var rounds = {};
      var maxRound = 0;
      var champion = '';
      var results = {};
      var size = participants.length >= 2 ? nextPow2_(participants.length) : 0;
      var totalRounds = size ? Math.round(Math.log(size) / Math.LN2) : 0;
      gm.forEach(function (m) {
        var judge = judgeMatch_(bundle, m, c.playerById, null);
        countProgress_(nProgress, judge.state);
        if (m.round > maxRound) maxRound = m.round;
        var key = String(m.round);
        if (!rounds[key]) rounds[key] = { round: m.round, label: m.label || '', matches: [] };
        var mv = c.matchView(m, judge, m.label || m.round + '回戦');
        rounds[key].matches.push(mv);
        if (judge.state === MATCH_STATUS.FINAL && mv.winnerId) {
          var loser = mv.winnerId === m.player1_id ? m.player2_id : m.player1_id;
          var depth = totalRounds - m.round; // 決勝で負け = 0（準優勝）、準決勝で負け = 1 …
          results[loser] = { points: nightPointsFor_(cfg.nightPoints, depth, false), place: depth === 0 ? 2 : Math.pow(2, depth) + 1 };
          if (m.round === totalRounds && m.label === '決勝') {
            champion = mv.winnerId;
            results[mv.winnerId] = { points: nightPointsFor_(cfg.nightPoints, 0, true), place: 1 };
          }
          var f = finalRecord_(m, judge, matchSpec_(bundle, m), cfg);
          if (f.countLegs !== false) {
            [
              [f.p1, f.l1, f.l2],
              [f.p2, f.l2, f.l1],
            ].forEach(function (x) {
              if (!legStats[x[0]]) return;
              legStats[x[0]].legsFor += x[1] || 0;
              legStats[x[0]].legsAgainst += x[2] || 0;
            });
          }
        }
      });
      var cancelled = meta.status === 'cancelled';
      var status = cancelled ? 'cancelled' : !gm.length ? (participants.length ? 'ready' : 'planned') : champion ? 'complete' : nProgress.final || nProgress.live ? 'running' : 'drawn';
      if (!cancelled) addProgress_(progress, nProgress);
      Object.keys(results).forEach(function (pid) {
        if (total[pid] === undefined) return;
        if (status === 'complete') total[pid] += results[pid].points;
        else if (!cancelled) provisional[pid] += results[pid].points;
      });
      if (status === 'complete' && champion && nightWins[champion] !== undefined) nightWins[champion]++;
      var night = {
        id: g.group_id,
        name: g.name,
        order: g.order,
        status: status,
        date: typeof meta.date === 'string' ? meta.date : '',
        participants: participants.map(function (e) {
          var r = c.playerRef(e.player_id);
          r.seed = e.seed;
          return r;
        }),
        rounds: Object.keys(rounds)
          .map(function (k) {
            return rounds[k];
          })
          .sort(function (a, b) {
            return a.round - b.round;
          }),
        champion: champion ? { id: champion, name: c.nameOf(champion) } : null,
        results: Object.keys(results).map(function (pid) {
          return { playerId: pid, points: results[pid].points, place: results[pid].place, provisional: status !== 'complete' };
        }),
        progress: nProgress,
      };
      if (cancelled && c.includePrivate) night.cancelReason = typeof meta.reason === 'string' ? meta.reason : '';
      if (c.includePrivate) night.rev = g.rev || 0;
      return night;
    });
  rosterIds.forEach(function (pid) {
    legStats[pid].points = total[pid];
    legStats[pid].nightWins = nightWins[pid];
  });
  var standings = computeStandingsFromStats_(rosterIds, legStats, [], cfg.tiebreakers, manual, { points: true });
  standings.forEach(function (row) {
    row.provisionalPoints = provisional[row.playerId] || 0;
    row.nights = view.nights.map(function (n) {
      var r = n.results.filter(function (x) {
        return x.playerId === row.playerId;
      })[0];
      return r ? r.points : null;
    });
  });
  view.standings = standings;
  view.roster = rosterIds.map(c.playerRef);
  view.nightsComplete = view.nights.filter(function (n) {
    return n.status === 'complete' || n.status === 'cancelled';
  }).length;
  return progress;
}

/**
 * v1.0: 期制リーグの入替戦。隣接するディビジョンの組（グループ）ごとに 1 試合。
 * 選手の source（「1部 5位」など）は入替戦を組んだ時の順位
 */
function promotionStageView_(bundle, c, view) {
  var progress = emptyProgress_();
  view.pairs = bundle.groups
    .filter(function (g) {
      return g.stage_id === c.stage.stage_id;
    })
    .sort(byOrder_)
    .map(function (g) {
      var meta = groupMeta_(g);
      var match = null;
      c.matches.forEach(function (m) {
        if (m.group_id !== g.group_id || match) return;
        var judge = judgeMatch_(bundle, m, c.playerById, null);
        countProgress_(progress, judge.state);
        match = c.matchView(m, judge, m.label || '入替戦');
      });
      var pair = {
        id: g.group_id,
        name: g.name,
        upper: meta.upper || 0,
        lower: meta.lower || 0,
        players: c.entries
          .filter(function (e) {
            return e.group_id === g.group_id;
          })
          .sort(function (a, b) {
            return (a.seed || 0) - (b.seed || 0);
          })
          .map(function (e) {
            var r = c.playerRef(e.player_id);
            r.source = e.source_label || '';
            return r;
          }),
        match: match,
      };
      if (c.includePrivate && match) match.confirmedAt = match.confirmedAt || '';
      return pair;
    });
  return progress;
}

/* ---------- 完了の判定（F05 自動終了） ---------- */

/** 段階が終わったか。理由（終わっていない理由）も返す */
function stageCompletion_(view, cfg, stage) {
  var p = view.progress;
  var pendingMatches = p.total - p.final;
  if (stage.type === STAGE_TYPE.SERIES) {
    if ((view.nights || []).length < cfg.nights) return { complete: false, reason: '予定の ' + cfg.nights + ' 節のうち ' + (view.nights || []).length + ' 節しか作られていません。' };
    var open = (view.nights || []).filter(function (n) {
      return n.status !== 'complete' && n.status !== 'cancelled';
    });
    if (open.length) return { complete: false, reason: '終わっていない節があります（' + open.map(function (n) { return n.name; }).join('、') + '）。' };
    if (!(view.nights || []).some(function (n) { return n.status === 'complete'; })) return { complete: false, reason: '終わった節がありません。' };
    return { complete: true, reason: '' };
  }
  if (!p.total) return { complete: false, reason: '対戦カード・トーナメント表がまだありません。' };
  if (pendingMatches > 0) return { complete: false, reason: '確定していない試合が ' + pendingMatches + ' 試合あります。' };
  if (stage.type === STAGE_TYPE.SWISS) {
    var gen = view.swiss ? view.swiss.generated : 0;
    if (gen < cfg.rounds) return { complete: false, reason: cfg.rounds + ' 回戦のうち ' + gen + ' 回戦までしか組まれていません。' };
  }
  if (stage.type === STAGE_TYPE.SINGLE_ELIMINATION || stage.type === STAGE_TYPE.DOUBLE_ELIMINATION) {
    if (!view.champion) return { complete: false, reason: stage.type === STAGE_TYPE.DOUBLE_ELIMINATION ? 'グランドファイナル（リセットを含む）が終わっていません。' : '決勝がまだです。' };
  }
  return { complete: true, reason: '' };
}

function eventCompletionFromStages_(stages) {
  var reasons = [];
  stages.forEach(function (st) {
    if (!st.complete) reasons.push(st.name + ': ' + ((st.completion && st.completion.reason) || '終わっていません。'));
  });
  return { complete: stages.length > 0 && reasons.length === 0, reasons: reasons };
}
