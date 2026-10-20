/* 大会ロジック（スプレッドシートに依存しない純粋な関数） */

function isValidBestOf_(n) {
  return typeof n === 'number' && Math.floor(n) === n && n >= 1 && n <= ADMIN_CONFIG.BEST_OF_MAX && n % 2 === 1;
}

/** Best of N で勝ちに必要な Leg 数 */
function legsToWin_(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * 試合結果の検証。保存時（サーバー側で必ず実行）と公開データの生成時の両方で使う。
 *   未開始   : 両者 0 Leg
 *   進行中   : 両者とも勝利数未満（Best of 5 なら 0〜2）
 *   確定済み : 片方がちょうど勝利数、もう片方が勝利数未満（Best of 5 なら 3-0 / 3-1 / 3-2）
 * 戻り値の winnerSide は確定済みで成立しているときだけ 1 または 2、それ以外は 0。
 */
function evaluateResult_(status, p1Legs, p2Legs, bestOf) {
  var problems = [];
  if (!isValidBestOf_(bestOf)) {
    return { ok: false, winnerSide: 0, problems: ['ルールの Best of 値が不正です'] };
  }
  var need = legsToWin_(bestOf);
  if (p1Legs === null || p2Legs === null || isNaN(p1Legs) || isNaN(p2Legs)) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数は 0 以上の整数で入力してください'] };
  }
  if (p1Legs < 0 || p2Legs < 0 || Math.floor(p1Legs) !== p1Legs || Math.floor(p2Legs) !== p2Legs) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数は 0 以上の整数で入力してください'] };
  }
  if (p1Legs > need || p2Legs > need) {
    problems.push('Best of ' + bestOf + ' では取得 Leg 数は最大 ' + need + ' です');
  }
  if (status === MATCH_STATUS.SCHEDULED) {
    if (p1Legs !== 0 || p2Legs !== 0) problems.push('未開始の試合に Leg 数が入力されています');
  } else if (status === MATCH_STATUS.LIVE) {
    if (p1Legs >= need || p2Legs >= need) {
      problems.push('どちらかが ' + need + ' Leg に達しています。確定済みにしてください');
    }
  } else if (status === MATCH_STATUS.FINAL) {
    if (p1Legs === need && p2Legs === need) {
      problems.push('両者が ' + need + ' Leg になっています');
    } else if (p1Legs !== need && p2Legs !== need) {
      problems.push('確定するには、どちらかがちょうど ' + need + ' Leg 必要です（Best of ' + bestOf + '）');
    }
  } else {
    problems.push('試合状態が不正です');
  }
  if (problems.length) return { ok: false, winnerSide: 0, problems: problems };
  var winnerSide = 0;
  if (status === MATCH_STATUS.FINAL) winnerSide = p1Legs === need ? 1 : 2;
  return { ok: true, winnerSide: winnerSide, problems: [] };
}

/**
 * グループ内の総当たり対戦表（サークル方式）。奇数人数のときは各ラウンドに 1 人休みが出る。
 * 戻り値: [{ round, order, p1, p2 }]
 */
function roundRobinPairings_(ids) {
  var list = ids.slice();
  if (list.length < 2) return [];
  if (list.length % 2 === 1) list.push(null);
  var n = list.length;
  var out = [];
  var order = 1;
  for (var round = 1; round < n; round++) {
    for (var i = 0; i < n / 2; i++) {
      var a = list[i];
      var b = list[n - 1 - i];
      if (a !== null && b !== null) {
        // 先後が偏らないようラウンドごとに入れ替える
        var swap = round % 2 === 0 && i === 0;
        out.push({ round: round, order: order++, p1: swap ? b : a, p2: swap ? a : b });
      }
    }
    // 先頭を固定して残りを 1 つ回す
    list.splice(1, 0, list.pop());
  }
  return out;
}

/** 大会の構成要素を event_id で取り出す */
function collectEvent_(ctx, eventId) {
  var event = findRecord_(ctx.table('Events'), eventId, '大会');
  var filter = function (name) {
    return ctx.table(name).rows.filter(function (r) {
      return r.event_id === eventId;
    });
  };
  var rules = filter('Rules');
  var stages = filter('Stages').sort(byOrder_);
  var groups = filter('Groups').sort(byOrder_);
  var entries = filter('Entries').sort(function (a, b) {
    return (a.seed || 0) - (b.seed || 0);
  });
  var players = filter('Players');
  var matches = filter('Matches').sort(function (a, b) {
    return (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0);
  });
  var ruleById = {};
  rules.forEach(function (r) {
    ruleById[r.rule_id] = r;
  });
  return {
    event: event,
    rule: ruleById[event.rule_id] || null,
    ruleById: ruleById,
    stage: stages[0] || null,
    stages: stages,
    groups: groups,
    entries: entries,
    players: players,
    matches: matches,
  };
}

function bestOfFor_(bundle, match) {
  var rule = (match && match.rule_id && bundle.ruleById[match.rule_id]) || bundle.rule;
  return rule ? rule.best_of : null;
}

/** 1 試合の状態を公開用に判定する。シートを直接いじられた場合に備え、保存済みデータも再検証する。 */
function judgeMatch_(bundle, match, playerById, groupMembers) {
  var problems = [];
  var p1 = playerById[match.player1_id];
  var p2 = playerById[match.player2_id];
  if (!p1 || !p2) problems.push('選手が見つかりません');
  if (match.player1_id === match.player2_id) problems.push('同じ選手同士の対戦です');
  if (groupMembers && (!groupMembers[match.player1_id] || !groupMembers[match.player2_id])) {
    problems.push('グループに属していない選手が含まれています');
  }
  var status = match.status || MATCH_STATUS.SCHEDULED;
  var p1Legs = match.player1_legs === null ? 0 : match.player1_legs;
  var p2Legs = match.player2_legs === null ? 0 : match.player2_legs;
  var result = evaluateResult_(status, p1Legs, p2Legs, bestOfFor_(bundle, match));
  problems = problems.concat(result.problems);
  if (problems.length) {
    return { state: 'check', p1Legs: null, p2Legs: null, winnerSide: 0, problems: problems };
  }
  return { state: status, p1Legs: p1Legs, p2Legs: p2Legs, winnerSide: result.winnerSide, problems: [] };
}

/** グループごとの進行状況と、確定試合だけで数えた勝敗・Leg 数（順位付けはしない） */
function summarizeGroup_(members, judged) {
  var stats = {};
  members.forEach(function (pid) {
    stats[pid] = { playerId: pid, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0 };
  });
  var progress = { total: 0, scheduled: 0, live: 0, final: 0, check: 0 };
  judged.forEach(function (j) {
    progress.total++;
    progress[j.judge.state]++;
    if (j.judge.state !== MATCH_STATUS.FINAL) return;
    var a = stats[j.match.player1_id];
    var b = stats[j.match.player2_id];
    if (!a || !b) return;
    a.played++;
    b.played++;
    a.legsFor += j.judge.p1Legs;
    a.legsAgainst += j.judge.p2Legs;
    b.legsFor += j.judge.p2Legs;
    b.legsAgainst += j.judge.p1Legs;
    if (j.judge.winnerSide === 1) {
      a.won++;
      b.lost++;
    } else {
      b.won++;
      a.lost++;
    }
  });
  return {
    summary: members.map(function (pid) {
      return stats[pid];
    }),
    progress: progress,
  };
}

/**
 * 運営画面・公開画面の両方で使う、大会の組み立て済みビュー。
 * includePrivate=false のとき、閲覧者に出してよい項目だけを含む。
 */
function buildEventView_(bundle, includePrivate) {
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  var rule = bundle.rule;
  var groups = bundle.groups.map(function (g) {
    var members = bundle.entries
      .filter(function (e) {
        return e.group_id === g.group_id;
      })
      .map(function (e) {
        return e.player_id;
      });
    var memberSet = {};
    members.forEach(function (pid) {
      memberSet[pid] = true;
    });
    var judged = bundle.matches
      .filter(function (m) {
        return m.group_id === g.group_id;
      })
      .map(function (m) {
        return { match: m, judge: judgeMatch_(bundle, m, playerById, memberSet) };
      });
    var sum = summarizeGroup_(members, judged);
    var group = {
      id: g.group_id,
      name: g.name,
      players: members.map(function (pid) {
        var p = playerById[pid];
        return { id: pid, name: p ? p.display_name : '（不明な選手）' };
      }),
      summary: sum.summary,
      progress: sum.progress,
      matches: judged.map(function (j) {
        var m = j.match;
        var out = {
          id: m.match_id,
          round: m.round,
          order: m.order,
          p1: { id: m.player1_id, name: playerById[m.player1_id] ? playerById[m.player1_id].display_name : '（不明）', legs: j.judge.p1Legs },
          p2: { id: m.player2_id, name: playerById[m.player2_id] ? playerById[m.player2_id].display_name : '（不明）', legs: j.judge.p2Legs },
          status: j.judge.state,
          winnerId: j.judge.winnerSide === 1 ? m.player1_id : j.judge.winnerSide === 2 ? m.player2_id : null,
        };
        if (includePrivate) {
          out.rev = m.rev || 0;
          out.storedStatus = m.status;
          out.storedP1Legs = m.player1_legs;
          out.storedP2Legs = m.player2_legs;
          out.problems = j.judge.problems;
          out.updatedAt = m.updated_at;
          out.confirmedAt = m.confirmed_at;
          out.bestOf = bestOfFor_(bundle, m);
        }
        return out;
      }),
    };
    if (includePrivate) group.rev = g.rev || 0;
    return group;
  });

  var progress = { total: 0, scheduled: 0, live: 0, final: 0, check: 0 };
  groups.forEach(function (g) {
    Object.keys(progress).forEach(function (k) {
      progress[k] += g.progress[k];
    });
  });

  var lastUpdated = '';
  bundle.matches.forEach(function (m) {
    if (m.updated_at && m.updated_at > lastUpdated) lastUpdated = m.updated_at;
  });
  if (bundle.event.updated_at > lastUpdated) lastUpdated = bundle.event.updated_at;

  var view = {
    event: {
      id: bundle.event.event_id,
      name: bundle.event.name,
      dateLabel: bundle.event.date_label,
      status: bundle.event.status,
    },
    rule: rule
      ? {
          name: rule.name,
          bestOf: rule.best_of,
          legsToWin: isValidBestOf_(rule.best_of) ? legsToWin_(rule.best_of) : null,
          provisional: rule.is_provisional,
        }
      : null,
    stage: bundle.stage ? { id: bundle.stage.stage_id, name: bundle.stage.name, type: bundle.stage.type } : null,
    groups: groups,
    progress: progress,
    dataUpdatedAt: lastUpdated,
  };
  if (includePrivate) {
    view.event.rev = bundle.event.rev || 0;
    view.event.isPublic = bundle.event.is_public;
    view.event.isFeatured = bundle.event.is_featured;
    view.event.isSample = bundle.event.is_sample;
    view.event.organizerName = bundle.event.organizer_name;
    view.event.adminKeyIssuedAt = bundle.event.admin_key_issued_at;
    view.event.notes = bundle.event.notes;
    if (view.rule) {
      view.rule.id = rule.rule_id;
      view.rule.rev = rule.rev || 0;
      view.rule.notes = rule.notes;
    }
    var grouped = {};
    bundle.entries.forEach(function (e) {
      grouped[e.player_id] = e.group_id;
    });
    view.players = bundle.players.map(function (p) {
      return {
        id: p.player_id,
        name: p.display_name,
        rev: p.rev || 0,
        groupId: grouped[p.player_id] || '',
        matchCount: bundle.matches.filter(function (m) {
          return m.player1_id === p.player_id || m.player2_id === p.player_id;
        }).length,
      };
    });
  }
  return view;
}
