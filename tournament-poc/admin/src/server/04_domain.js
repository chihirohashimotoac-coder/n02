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
 * グループ内の総当たり対戦表（サークル方式）。奇数人数のときは各ラウンドに 1 人休みが出る（不戦）。
 * cycles=2 で 2 回総当たり。戻り値: [{ round, order, p1, p2 }]
 */
function roundRobinPairings_(ids, cycles) {
  var once = roundRobinOnce_(ids);
  if (cycles !== 2 || !once.length) return once;
  // 2 回総当たり: 2 巡目は先後を入れ替え、ラウンド番号を続ける
  var lastRound = once[once.length - 1].round;
  var lastOrder = once[once.length - 1].order;
  return once.concat(
    once.map(function (m) {
      return { round: m.round + lastRound, order: m.order + lastOrder, p1: m.p2, p2: m.p1 };
    })
  );
}

function roundRobinOnce_(ids) {
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

/* ---------- 段階（ステージ）の設定 ---------- */

/** 順位の決め方に使える項目（並べた順に比べる。最後まで並んだら主催者が手で決める） */
var TIEBREAKERS = Object.freeze({
  wins: '勝数',
  leg_diff: 'Leg 差',
  legs_for: '得 Leg',
  set_diff: 'セット差',
  sets_for: '得セット',
  head_to_head: '直接対決',
});
var DEFAULT_TIEBREAKERS_ = ['wins', 'leg_diff', 'head_to_head', 'legs_for'];
var MAX_ROUND_LABEL_LENGTH_ = 30;

function isPositiveInt_(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1;
}

/** 段階の設定（config_json）を読み、欠けている項目を既定値で補う */
function stageConfig_(stage) {
  var c = {};
  try {
    c = stage && stage.config_json ? JSON.parse(stage.config_json) : {};
  } catch (e) {
    c = {};
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) c = {};
  var intMap = function (obj, valid) {
    var out = {};
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) {
        var n = Number(k);
        if (isPositiveInt_(n) && valid(obj[k])) out[String(n)] = obj[k];
      });
    }
    return out;
  };
  return {
    cycles: c.cycles === 2 ? 2 : 1,
    tiebreakers: Array.isArray(c.tiebreakers)
      ? c.tiebreakers.filter(function (k, i, arr) {
          return Object.prototype.hasOwnProperty.call(TIEBREAKERS, k) && arr.indexOf(k) === i;
        })
      : DEFAULT_TIEBREAKERS_.slice(),
    advancement: Array.isArray(c.advancement)
      ? c.advancement.filter(function (r) {
          return r && isPositiveInt_(r.fromRank) && isPositiveInt_(r.toRank) && r.fromRank <= r.toRank && isValidId_(r.targetStageId);
        })
      : [],
    advanced: c.advanced === true,
    advancedAt: typeof c.advancedAt === 'string' ? c.advancedAt : '',
    thirdPlace: c.thirdPlace === true,
    roundBestOf: intMap(c.roundBestOf, isValidBestOf_),
    roundLabels: intMap(c.roundLabels, function (v) {
      return typeof v === 'string' && v.length > 0 && v.length <= MAX_ROUND_LABEL_LENGTH_;
    }),
  };
}

function isGroupStage_(stage) {
  return !!stage && (stage.type === STAGE_TYPE.ROUND_ROBIN || stage.type === STAGE_TYPE.LEAGUE);
}

function isEliminationStage_(stage) {
  return !!stage && stage.type === STAGE_TYPE.SINGLE_ELIMINATION;
}

/* ---------- 試合ルール（Leg 制・セット制、ラウンドごとの Best of） ---------- */

function stageRule_(bundle, stage) {
  return (stage && bundle.ruleById[stage.rule_id]) || bundle.rule;
}

/**
 * 試合に適用するルール。{ format: 'legs' | 'sets', bestOf, setBestOf }
 * bestOf は Leg 制なら Leg 数、セット制ならセット数。トーナメントはラウンドごとの上書きを反映する。
 */
function matchSpec_(bundle, match) {
  var stage = bundle.stageById[match.stage_id];
  var rule = (match.rule_id && bundle.ruleById[match.rule_id]) || stageRule_(bundle, stage);
  if (!rule) return null;
  var format = rule.format === RULE_FORMAT.BEST_OF_SETS ? 'sets' : 'legs';
  var bestOf = rule.best_of;
  if (isEliminationStage_(stage)) {
    var override = stageConfig_(stage).roundBestOf[String(match.round)];
    if (override) bestOf = override;
  }
  return { format: format, bestOf: bestOf, setBestOf: format === 'sets' ? rule.set_best_of : null };
}

/**
 * 試合結果の検証（Leg 制・セット制の両方）。
 * input = { p1Legs, p2Legs, p1Sets, p2Sets }（数値。セット制の Leg 数は合計で、未入力なら null）
 * セット制: セット数を Best of の規則で判定し、Leg 数が入力されていればセット数と矛盾しないかも確かめる
 *   （勝ったセットではちょうど M 勝利数、負けたセット・進行中のセットでは M 勝利数未満）
 */
function evaluateMatchInput_(status, input, spec) {
  if (!spec) return { ok: false, winnerSide: 0, problems: ['ルールが見つかりません'] };
  if (spec.format !== 'sets') return evaluateResult_(status, input.p1Legs, input.p2Legs, spec.bestOf);
  if (!isValidBestOf_(spec.setBestOf)) return { ok: false, winnerSide: 0, problems: ['ルールのセット内 Best of 値が不正です'] };
  var base = evaluateResult_(status, input.p1Sets, input.p2Sets, spec.bestOf);
  if (!base.ok) {
    return { ok: false, winnerSide: 0, problems: base.problems.map(function (p) { return p.replace(/Leg/g, 'セット'); }) };
  }
  var l1 = input.p1Legs;
  var l2 = input.p2Legs;
  if (l1 === null || l1 === undefined || l2 === null || l2 === undefined) return base;
  if (status === MATCH_STATUS.SCHEDULED) {
    return l1 === 0 && l2 === 0 ? base : { ok: false, winnerSide: 0, problems: ['未開始の試合に Leg 数が入力されています'] };
  }
  var need = legsToWin_(spec.setBestOf);
  var extra = status === MATCH_STATUS.LIVE ? need - 1 : 0; // 進行中のセットで取った Leg
  var check = function (legs, won, lost) {
    return legs >= won * need && legs <= won * need + lost * (need - 1) + extra;
  };
  if (!check(l1, input.p1Sets, input.p2Sets) || !check(l2, input.p2Sets, input.p1Sets)) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数がセット数と合いません（各セットは先に ' + need + ' Leg）'] };
  }
  return base;
}

/* ---------- 順位 ---------- */

function emptyStats_(pid) {
  return { playerId: pid, played: 0, won: 0, lost: 0, legsFor: 0, legsAgainst: 0, setsFor: 0, setsAgainst: 0 };
}

/** 確定した試合だけで成績を数える */
function tallyStats_(memberIds, finals) {
  var stats = {};
  memberIds.forEach(function (pid) {
    stats[pid] = emptyStats_(pid);
  });
  finals.forEach(function (f) {
    var a = stats[f.p1];
    var b = stats[f.p2];
    if (!a || !b) return;
    a.played++;
    b.played++;
    a.legsFor += f.l1 || 0;
    a.legsAgainst += f.l2 || 0;
    b.legsFor += f.l2 || 0;
    b.legsAgainst += f.l1 || 0;
    a.setsFor += f.s1;
    a.setsAgainst += f.s2;
    b.setsFor += f.s2;
    b.setsAgainst += f.s1;
    if (f.winner === f.p1) {
      a.won++;
      b.lost++;
    } else {
      b.won++;
      a.lost++;
    }
  });
  return stats;
}

function tiebreakValue_(key, pid, block, stats, finals) {
  var s = stats[pid];
  if (key === 'wins') return s.won;
  if (key === 'leg_diff') return s.legsFor - s.legsAgainst;
  if (key === 'legs_for') return s.legsFor;
  if (key === 'set_diff') return s.setsFor - s.setsAgainst;
  if (key === 'sets_for') return s.setsFor;
  if (key === 'head_to_head') {
    // 並んでいる選手どうしの試合だけで数えた勝数
    var inBlock = {};
    block.forEach(function (id) {
      inBlock[id] = true;
    });
    return finals.filter(function (f) {
      return f.winner === pid && inBlock[f.p1] && inBlock[f.p2];
    }).length;
  }
  return 0;
}

/** 並んだ選手の塊を、残りの項目で順に分けていく。最後まで並んだ塊は主催者の手動順位で分ける */
function splitTies_(ids, keys, stats, finals, manual) {
  if (ids.length <= 1) return [ids];
  if (!keys.length) {
    var set = ids.filter(function (id) {
      return manual[id];
    });
    var distinct = {};
    set.forEach(function (id) {
      distinct[manual[id]] = true;
    });
    if (set.length === ids.length && Object.keys(distinct).length === ids.length) {
      return ids
        .slice()
        .sort(function (a, b) {
          return manual[a] - manual[b];
        })
        .map(function (id) {
          return [id];
        });
    }
    return [ids];
  }
  var key = keys[0];
  var value = {};
  ids.forEach(function (id) {
    value[id] = tiebreakValue_(key, id, ids, stats, finals);
  });
  var sorted = ids.slice().sort(function (a, b) {
    return value[b] - value[a] || ids.indexOf(a) - ids.indexOf(b);
  });
  var blocks = [];
  sorted.forEach(function (id) {
    var last = blocks[blocks.length - 1];
    if (last && value[last[0]] === value[id]) last.push(id);
    else blocks.push([id]);
  });
  var out = [];
  blocks.forEach(function (b) {
    splitTies_(b, keys.slice(1), stats, finals, manual).forEach(function (x) {
      out.push(x);
    });
  });
  return out;
}

/**
 * グループ（ロビン・リーグ）の順位表。
 * 戻り値: [{ playerId, rank, tied, played, won, lost, legsFor, legsAgainst, setsFor, setsAgainst }]
 * tied=true は、設定した項目と手動順位でも決まらず同順位になっている選手。
 */
function computeStandings_(memberIds, finals, tiebreakers, manual) {
  var stats = tallyStats_(memberIds, finals);
  var blocks = splitTies_(memberIds.slice(), tiebreakers, stats, finals, manual || {});
  var out = [];
  var position = 1;
  blocks.forEach(function (b) {
    b.forEach(function (pid) {
      var s = stats[pid];
      out.push({
        playerId: pid,
        rank: position,
        tied: b.length > 1,
        played: s.played,
        won: s.won,
        lost: s.lost,
        legsFor: s.legsFor,
        legsAgainst: s.legsAgainst,
        setsFor: s.setsFor,
        setsAgainst: s.setsAgainst,
      });
    });
    position += b.length;
  });
  return out;
}

/* ---------- トーナメント表 ---------- */

/** 標準のシード配置（1 位と 2 位が決勝まで当たらない並び）。size は 2 のべき乗 */
function seedPositions_(size) {
  var arr = [1];
  while (arr.length < size) {
    var len = arr.length * 2;
    var next = [];
    arr.forEach(function (s) {
      next.push(s, len + 1 - s);
    });
    arr = next;
  }
  return arr;
}

function roundLabelForElimination_(round, rounds) {
  if (round === rounds) return '決勝';
  if (round === rounds - 1) return '準決勝';
  if (round === rounds - 2) return '準々決勝';
  return round + '回戦';
}

/**
 * シード順に並んだ出場者からトーナメント表を作る（試合レコードの元データ）。
 * 出場者が 2 のべき乗に満たない枠は不戦勝（Bye）とし、その選手は 2 回戦の枠に直接入れる。
 * 戻り値: [{ key, round, order, label, p1, p2, nextKey, nextSlot, loserNextKey, loserNextSlot }]
 */
function planBracket_(entrantIds, thirdPlace) {
  var n = entrantIds.length;
  if (n < 2) return [];
  var size = 1;
  while (size < n) size *= 2;
  var rounds = Math.round(Math.log(size) / Math.LN2);
  var pos = seedPositions_(size);
  var plan = {};
  var list = [];
  for (var r = 1; r <= rounds; r++) {
    var count = size / Math.pow(2, r);
    for (var k = 0; k < count; k++) {
      var m = {
        key: r + '-' + k,
        round: r,
        order: k + 1,
        label: roundLabelForElimination_(r, rounds),
        p1: '',
        p2: '',
        nextKey: r < rounds ? r + 1 + '-' + Math.floor(k / 2) : '',
        nextSlot: r < rounds ? (k % 2) + 1 : null,
        loserNextKey: '',
        loserNextSlot: null,
        bye: false,
      };
      plan[m.key] = m;
      list.push(m);
    }
  }
  if (thirdPlace && rounds >= 2) {
    var third = { key: 'third', round: rounds, order: 2, label: '3位決定戦', p1: '', p2: '', nextKey: '', nextSlot: null, loserNextKey: '', loserNextSlot: null, bye: false };
    plan.third = third;
    list.push(third);
    [0, 1].forEach(function (k) {
      plan[rounds - 1 + '-' + k].loserNextKey = 'third';
      plan[rounds - 1 + '-' + k].loserNextSlot = k + 1;
    });
  }
  for (var j = 0; j < size / 2; j++) {
    var first = plan['1-' + j];
    var a = entrantIds[pos[2 * j] - 1] || '';
    var b = entrantIds[pos[2 * j + 1] - 1] || '';
    if (a && b) {
      first.p1 = a;
      first.p2 = b;
    } else {
      // 不戦勝: 1 回戦は作らず、次の回戦の枠に入れる
      first.bye = true;
      var next = plan[first.nextKey];
      if (next) next['p' + first.nextSlot] = a || b;
    }
  }
  return list.filter(function (m) {
    return !m.bye;
  });
}

/* ---------- 大会の組み立て ---------- */

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
  var stageById = {};
  stages.forEach(function (s) {
    stageById[s.stage_id] = s;
  });
  return {
    event: event,
    rule: ruleById[event.rule_id] || null,
    ruleById: ruleById,
    stage: stages[0] || null,
    stages: stages,
    stageById: stageById,
    groups: groups,
    entries: entries,
    players: players,
    matches: matches,
  };
}

/** 互換用: 試合の主となる Best of（Leg 制なら Leg 数、セット制ならセット数） */
function bestOfFor_(bundle, match) {
  var spec = matchSpec_(bundle, match);
  return spec ? spec.bestOf : null;
}

function matchStarted_(m) {
  return (
    (m.status || MATCH_STATUS.SCHEDULED) !== MATCH_STATUS.SCHEDULED ||
    (m.player1_legs || 0) !== 0 ||
    (m.player2_legs || 0) !== 0 ||
    (m.player1_sets || 0) !== 0 ||
    (m.player2_sets || 0) !== 0
  );
}

/** 保存済みの結果。セット数の空欄は 0、Leg 数の空欄は null（セット制で Leg 数を入れない運用を許す） */
function storedInput_(m) {
  var z = function (v) {
    return v === null || v === undefined || v === '' ? 0 : v;
  };
  var n = function (v) {
    return v === undefined || v === '' ? null : v;
  };
  return { p1Legs: n(m.player1_legs), p2Legs: n(m.player2_legs), p1Sets: z(m.player1_sets), p2Sets: z(m.player2_sets) };
}

/**
 * 1 試合の状態を公開用に判定する。シートを直接いじられた場合に備え、保存済みデータも再検証する。
 * 状態: scheduled / live / final / check（要確認）/ pending（トーナメントで対戦相手が未確定）
 */
function judgeMatch_(bundle, match, playerById, members) {
  var stage = bundle.stageById[match.stage_id];
  var input = storedInput_(match);
  if (isEliminationStage_(stage) && (!match.player1_id || !match.player2_id)) {
    if (!matchStarted_(match)) return { state: 'pending', input: null, winnerSide: 0, problems: [] };
  }
  var problems = [];
  if (!playerById[match.player1_id] || !playerById[match.player2_id]) problems.push('選手が見つかりません');
  if (match.player1_id === match.player2_id) problems.push('同じ選手同士の対戦です');
  if (members && (!members[match.player1_id] || !members[match.player2_id])) {
    problems.push('この段階・グループに属していない選手が含まれています');
  }
  var status = match.status || MATCH_STATUS.SCHEDULED;
  var result = evaluateMatchInput_(status, input, matchSpec_(bundle, match));
  problems = problems.concat(result.problems);
  if (problems.length) return { state: 'check', input: null, winnerSide: 0, problems: problems };
  return { state: status, input: input, winnerSide: result.winnerSide, problems: [] };
}

function emptyProgress_() {
  return { total: 0, scheduled: 0, live: 0, final: 0, check: 0, pending: 0 };
}

function addProgress_(into, from) {
  Object.keys(into).forEach(function (k) {
    into[k] += from[k] || 0;
  });
}

function ruleView_(rule) {
  if (!rule) return null;
  var sets = rule.format === RULE_FORMAT.BEST_OF_SETS;
  return {
    name: rule.name,
    format: sets ? 'sets' : 'legs',
    bestOf: rule.best_of,
    setBestOf: sets ? rule.set_best_of : null,
    legsToWin: !sets && isValidBestOf_(rule.best_of) ? legsToWin_(rule.best_of) : null,
    setsToWin: sets && isValidBestOf_(rule.best_of) ? legsToWin_(rule.best_of) : null,
    provisional: rule.is_provisional,
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
  var nameOf = function (pid) {
    if (!pid) return '';
    return playerById[pid] ? playerById[pid].display_name : '（不明な選手）';
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
    if (includePrivate) {
      out.rev = m.rev || 0;
      out.stageId = m.stage_id;
      out.groupId = m.group_id;
      out.storedStatus = m.status;
      out.storedP1Legs = m.player1_legs;
      out.storedP2Legs = m.player2_legs;
      out.storedP1Sets = m.player1_sets;
      out.storedP2Sets = m.player2_sets;
      out.problems = judge.problems;
      out.updatedAt = m.updated_at;
      out.confirmedAt = m.confirmed_at;
      out.spec = spec;
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
    var progress = emptyProgress_();
    var view = {
      id: stage.stage_id,
      name: stage.name,
      type: stage.type,
      order: stage.order,
      rule: ruleView_(stageRule_(bundle, stage)),
    };

    if (isGroupStage_(stage)) {
      var league = stage.type === STAGE_TYPE.LEAGUE;
      view.tiebreakers = cfg.tiebreakers;
      view.advanced = cfg.advanced;
      view.cycles = cfg.cycles;
      view.groups = bundle.groups
        .filter(function (g) {
          return g.stage_id === stage.stage_id;
        })
        .map(function (g) {
          var groupEntries = stageEntries.filter(function (e) {
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
          var matches = stageMatches
            .filter(function (m) {
              return m.group_id === g.group_id;
            })
            .map(function (m) {
              var judge = judgeMatch_(bundle, m, playerById, memberSet);
              gProgress.total++;
              gProgress[judge.state]++;
              if (judge.state === MATCH_STATUS.FINAL) {
                finals.push({
                  p1: m.player1_id,
                  p2: m.player2_id,
                  l1: judge.input.p1Legs,
                  l2: judge.input.p2Legs,
                  s1: judge.input.p1Sets,
                  s2: judge.input.p2Sets,
                  winner: judge.winnerSide === 1 ? m.player1_id : m.player2_id,
                });
              }
              var label = cfg.roundLabels[String(m.round)] || (league ? '第' + m.round + '節' : 'R' + m.round);
              return matchView(m, judge, label);
            });
          addProgress_(progress, gProgress);
          var standings = computeStandings_(members, finals, cfg.tiebreakers, manual);
          var group = {
            id: g.group_id,
            name: g.name,
            players: members.map(function (pid) {
              return { id: pid, name: nameOf(pid) };
            }),
            standings: standings,
            // 互換用（旧閲覧ページは summary を読む）
            summary: standings,
            complete: gProgress.total > 0 && gProgress.final === gProgress.total,
            progress: gProgress,
            matches: matches,
          };
          if (includePrivate) group.rev = g.rev || 0;
          return group;
        });
    } else if (isEliminationStage_(stage)) {
      view.thirdPlace = cfg.thirdPlace;
      view.roundBestOf = cfg.roundBestOf;
      var rounds = {};
      var champion = null;
      stageMatches.forEach(function (m) {
        var judge = judgeMatch_(bundle, m, playerById, null);
        progress.total++;
        progress[judge.state]++;
        var key = String(m.round);
        if (!rounds[key]) rounds[key] = { round: m.round, label: '', matches: [] };
        var mv = matchView(m, judge, m.label || m.round + '回戦');
        rounds[key].matches.push(mv);
        if (m.label === '決勝' && mv.winnerId) champion = { id: mv.winnerId, name: nameOf(mv.winnerId) };
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
      view.entrants = stageEntries.map(function (e) {
        return { id: e.player_id, name: nameOf(e.player_id), seed: e.seed, source: e.source_label || '' };
      });
    }
    addProgress_(allProgress, progress);
    view.progress = progress;
    if (includePrivate) {
      var rule = stageRule_(bundle, stage);
      view.rev = stage.rev || 0;
      view.config = cfg;
      view.ruleId = rule ? rule.rule_id : '';
      view.ruleRev = rule ? rule.rev || 0 : 0;
      view.ruleProvisional = rule ? rule.is_provisional : false;
      view.matchCount = stageMatches.length;
      view.hasResults = stageMatches.some(matchStarted_);
      view.entryCount = stageEntries.length;
      view.entries = stageEntries.map(function (e) {
        return { playerId: e.player_id, groupId: e.group_id, seed: e.seed, manualOrder: e.manual_order, source: e.source_label || '' };
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
    return s.groups;
  })[0];
  var view = {
    event: {
      id: bundle.event.event_id,
      name: bundle.event.name,
      dateLabel: bundle.event.date_label,
      status: bundle.event.status,
    },
    rule: ruleView_(bundle.rule),
    stages: stages,
    // 互換用（旧閲覧ページ・旧運営画面は最初のロビンの groups を読む）
    stage: bundle.stage ? { id: bundle.stage.stage_id, name: bundle.stage.name, type: bundle.stage.type } : null,
    groups: firstGroupStage ? firstGroupStage.groups : [],
    progress: allProgress,
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
    if (view.rule && bundle.rule) {
      view.rule.id = bundle.rule.rule_id;
      view.rule.rev = bundle.rule.rev || 0;
      view.rule.notes = bundle.rule.notes;
    }
    view.tiebreakerLabels = TIEBREAKERS;
    view.players = bundle.players.map(function (p) {
      var memberships = bundle.entries.filter(function (e) {
        return e.player_id === p.player_id;
      });
      var first = memberships.filter(function (e) {
        return firstGroupStage && e.stage_id === firstGroupStage.id;
      })[0];
      return {
        id: p.player_id,
        name: p.display_name,
        rev: p.rev || 0,
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
