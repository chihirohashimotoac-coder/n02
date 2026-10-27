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
  points: '勝ち点', // v0.8: 勝・分・負の点（段階の設定）と手動の加減点
  buchholz: 'Buchholz', // v0.8: スイス式。対戦相手の勝ち点の合計（不戦は 0）
  night_wins: '節優勝回数', // v0.8: ポイントシリーズ
});
/** 段階の種類ごとに選べる項目（運営画面の選択肢・サーバーの検証） */
var TIEBREAKERS_FOR_ = {
  round_robin: ['wins', 'points', 'leg_diff', 'legs_for', 'set_diff', 'sets_for', 'head_to_head'],
  league: ['wins', 'points', 'leg_diff', 'legs_for', 'set_diff', 'sets_for', 'head_to_head'],
  swiss: ['points', 'buchholz', 'wins', 'leg_diff', 'legs_for', 'set_diff', 'sets_for', 'head_to_head'],
  series: ['points', 'night_wins', 'leg_diff', 'legs_for'],
};
/** v0.8 で作る段階の既定の順位の決め方（提案値。主催者が変えられる。既存の段階の設定は変えない） */
var DEFAULT_POINTS_TIEBREAKERS_ = ['points', 'leg_diff', 'head_to_head', 'legs_for'];
var DEFAULT_SWISS_TIEBREAKERS_ = ['points', 'buchholz', 'leg_diff', 'legs_for'];
var DEFAULT_SERIES_TIEBREAKERS_ = ['points', 'night_wins', 'leg_diff', 'legs_for'];
var DEFAULT_TIEBREAKERS_ = ['wins', 'leg_diff', 'head_to_head', 'legs_for'];
var MAX_ROUND_LABEL_LENGTH_ = 30;

function isPositiveInt_(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1;
}

function safeJson_(text, fallback) {
  if (!text) return fallback;
  try {
    var v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function isValidPoints_(p) {
  var ok = function (n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= -99 && n <= 99;
  };
  return !!p && ok(p.win) && ok(p.draw) && ok(p.loss);
}

/**
 * 段階の設定（config_json）を読み、欠けている項目を既定値で補う。
 * v0.7 までの段階には v0.8 の項目がないので、従来どおりの動き（勝ち点なし・固定の表など）になる。
 */
function stageConfig_(stage) {
  var c = safeJson_(stage && stage.config_json, {});
  var type = stage ? stage.type : '';
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
  var defaultTb = type === STAGE_TYPE.SWISS ? DEFAULT_SWISS_TIEBREAKERS_ : type === STAGE_TYPE.SERIES ? DEFAULT_SERIES_TIEBREAKERS_ : DEFAULT_TIEBREAKERS_;
  var allowedTb = TIEBREAKERS_FOR_[type] || Object.keys(TIEBREAKERS);
  var points = isValidPoints_(c.points) ? { win: c.points.win, draw: c.points.draw, loss: c.points.loss } : null;
  if (!points && type === STAGE_TYPE.SWISS) points = { win: 2, draw: 1, loss: 0 };
  var nightPoints = Array.isArray(c.nightPoints)
    ? c.nightPoints.filter(function (n) {
        return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 999;
      })
    : [];
  return {
    cycles: c.cycles === 2 ? 2 : 1,
    tiebreakers: Array.isArray(c.tiebreakers)
      ? c.tiebreakers.filter(function (k, i, arr) {
          return Object.prototype.hasOwnProperty.call(TIEBREAKERS, k) && allowedTb.indexOf(k) !== -1 && arr.indexOf(k) === i;
        })
      : defaultTb.slice(),
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
    // v0.8: 勝ち点（null は勝ち点を使わない従来の段階）と手動の加減点
    points: points,
    adjustments: Array.isArray(c.adjustments)
      ? c.adjustments.filter(function (a) {
          return a && isValidId_(a.playerId) && typeof a.points === 'number' && isFinite(a.points) && Math.floor(a.points) === a.points && a.points !== 0;
        })
      : [],
    // 不戦勝の試合の Leg 数: exclude = 数えない（既定）/ award = 勝者に勝利に必要な Leg 数・敗者に 0
    walkoverLegs: c.walkoverLegs === 'award' ? 'award' : 'exclude',
    // トーナメント: fixed = 最初に表を作る / redraw = 指定した回戦から回戦ごとに抽選
    drawMode: c.drawMode === 'redraw' ? 'redraw' : 'fixed',
    fixedRounds: typeof c.fixedRounds === 'number' && c.fixedRounds >= 0 && c.fixedRounds <= 7 ? Math.floor(c.fixedRounds) : 0,
    avoidSameGroup: c.avoidSameGroup === true,
    maxEntrants: isPositiveInt_(c.maxEntrants) && c.maxEntrants <= ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS ? c.maxEntrants : 0,
    // ダブルエリミ: reset = 敗者側の選手が勝ったらもう 1 試合 / single = 1 試合のみ
    grandFinal: c.grandFinal === 'single' ? 'single' : 'reset',
    // スイス式
    rounds: isPositiveInt_(c.rounds) && c.rounds <= ADMIN_CONFIG.MAX_SWISS_ROUNDS ? c.rounds : type === STAGE_TYPE.SWISS ? 5 : 0,
    byePoints: typeof c.byePoints === 'number' && isFinite(c.byePoints) ? c.byePoints : points ? points.win : 0,
    firstRound: c.firstRound === 'random' ? 'random' : 'seed',
    pairingLog: Array.isArray(c.pairingLog) ? c.pairingLog : [],
    // ポイントシリーズ
    nights: isPositiveInt_(c.nights) && c.nights <= ADMIN_CONFIG.MAX_SERIES_NIGHTS ? c.nights : type === STAGE_TYPE.SERIES ? 16 : 0,
    nightPoints: nightPoints.length ? nightPoints : [5, 3, 2, 0],
    nightDraw: c.nightDraw === 'standing' || c.nightDraw === 'seed' ? c.nightDraw : 'random',
    // 進出（ロビン → ロビン）: 進出先のグループへの配り方
    distribution: c.distribution === 'rank' ? 'rank' : 'snake',
    lastDraw: c.lastDraw && typeof c.lastDraw === 'object' ? c.lastDraw : null,
  };
}

function isGroupStage_(stage) {
  return !!stage && (stage.type === STAGE_TYPE.ROUND_ROBIN || stage.type === STAGE_TYPE.LEAGUE || stage.type === STAGE_TYPE.SWISS);
}

/** 総当たり（ロビン・リーグ）。グループの全員が当たる対戦カードを一度に作る段階 */
function isRoundRobinStage_(stage) {
  return !!stage && (stage.type === STAGE_TYPE.ROUND_ROBIN || stage.type === STAGE_TYPE.LEAGUE);
}

function isEliminationStage_(stage) {
  return !!stage && stage.type === STAGE_TYPE.SINGLE_ELIMINATION;
}

/** 勝者（・敗者）が次の試合へ進む段階（トーナメント・ダブルエリミ・シリーズの各節） */
function isBracketStage_(stage) {
  return !!stage && (stage.type === STAGE_TYPE.SINGLE_ELIMINATION || stage.type === STAGE_TYPE.DOUBLE_ELIMINATION || stage.type === STAGE_TYPE.SERIES);
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
  var format = rule.format === RULE_FORMAT.BEST_OF_SETS ? 'sets' : rule.format === RULE_FORMAT.FIXED_LEGS ? 'fixed' : 'legs';
  var bestOf = rule.best_of;
  if (isEliminationStage_(stage) && format !== 'fixed') {
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
  if (spec.format === 'fixed') return evaluateFixedLegs_(status, input.p1Legs, input.p2Legs, spec.bestOf);
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

/**
 * v0.8: 固定 Leg 数（N Legs をすべて投げる。同数なら引き分け）。勝ち抜き戦では使わない（進む選手が決まらないため）
 *   未開始: 0-0 / 進行中: 合計 < N / 確定: 合計 = N（多い方の勝ち、同数は引き分け winnerSide 0・draw true）
 */
function isValidFixedLegs_(n) {
  return typeof n === 'number' && Math.floor(n) === n && n >= 1 && n <= ADMIN_CONFIG.BEST_OF_MAX;
}

function evaluateFixedLegs_(status, l1, l2, legs) {
  if (!isValidFixedLegs_(legs)) return { ok: false, winnerSide: 0, problems: ['ルールの Leg 数が不正です'] };
  if (l1 === null || l2 === null || l1 === undefined || l2 === undefined || isNaN(l1) || isNaN(l2) || l1 < 0 || l2 < 0 || Math.floor(l1) !== l1 || Math.floor(l2) !== l2) {
    return { ok: false, winnerSide: 0, problems: ['取得 Leg 数は 0 以上の整数で入力してください'] };
  }
  var sum = l1 + l2;
  if (status === MATCH_STATUS.SCHEDULED) {
    return l1 === 0 && l2 === 0 ? { ok: true, winnerSide: 0, problems: [] } : { ok: false, winnerSide: 0, problems: ['未開始の試合に Leg 数が入力されています'] };
  }
  if (status === MATCH_STATUS.LIVE) {
    return sum < legs ? { ok: true, winnerSide: 0, problems: [] } : { ok: false, winnerSide: 0, problems: ['合計が ' + legs + ' Leg に達しています。確定済みにしてください'] };
  }
  if (status === MATCH_STATUS.FINAL) {
    if (sum !== legs) return { ok: false, winnerSide: 0, problems: ['確定するには、合計がちょうど ' + legs + ' Leg 必要です（固定 ' + legs + ' Legs）'] };
    return { ok: true, winnerSide: l1 > l2 ? 1 : l2 > l1 ? 2 : 0, draw: l1 === l2, problems: [] };
  }
  return { ok: false, winnerSide: 0, problems: ['試合状態が不正です'] };
}

/* ---------- 順位 ---------- */

function emptyStats_(pid) {
  return { playerId: pid, played: 0, won: 0, lost: 0, drawn: 0, legsFor: 0, legsAgainst: 0, setsFor: 0, setsAgainst: 0, points: 0, adjustment: 0 };
}

/**
 * 確定した試合だけで成績を数える。
 * finals: [{ p1, p2, winner, draw, l1, l2, s1, s2, countLegs }]（countLegs=false は不戦勝などで Leg 数を数えない試合）
 * cfg.points があれば勝ち点（勝・分・負の点 + 手動の加減点）も数える。ない段階（v0.7 までの大会）は従来どおり
 */
function tallyStats_(memberIds, finals, cfg) {
  var pts = cfg && cfg.points ? cfg.points : null;
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
    if (f.countLegs !== false) {
      a.legsFor += f.l1 || 0;
      a.legsAgainst += f.l2 || 0;
      b.legsFor += f.l2 || 0;
      b.legsAgainst += f.l1 || 0;
      a.setsFor += f.s1 || 0;
      a.setsAgainst += f.s2 || 0;
      b.setsFor += f.s2 || 0;
      b.setsAgainst += f.s1 || 0;
    }
    if (f.draw) {
      a.drawn++;
      b.drawn++;
      if (pts) {
        a.points += pts.draw;
        b.points += pts.draw;
      }
    } else if (f.winner === f.p1) {
      a.won++;
      b.lost++;
      if (pts) {
        a.points += pts.win;
        b.points += pts.loss;
      }
    } else {
      b.won++;
      a.lost++;
      if (pts) {
        b.points += pts.win;
        a.points += pts.loss;
      }
    }
  });
  if (pts && cfg.adjustments) {
    cfg.adjustments.forEach(function (adj) {
      var s = stats[adj.playerId];
      if (!s) return;
      s.points += adj.points;
      s.adjustment += adj.points;
    });
  }
  return stats;
}

function tiebreakValue_(key, pid, block, stats, finals) {
  var s = stats[pid];
  if (key === 'wins') return s.won;
  if (key === 'leg_diff') return s.legsFor - s.legsAgainst;
  if (key === 'legs_for') return s.legsFor;
  if (key === 'set_diff') return s.setsFor - s.setsAgainst;
  if (key === 'sets_for') return s.setsFor;
  if (key === 'points') return s.points || 0;
  if (key === 'buchholz') return s.buchholz || 0;
  if (key === 'night_wins') return s.nightWins || 0;
  if (key === 'head_to_head') {
    // 並んでいる選手どうしの試合だけで数えた勝数（引き分けは数えない）
    var inBlock = {};
    block.forEach(function (id) {
      inBlock[id] = true;
    });
    return finals.filter(function (f) {
      return !f.draw && !f.bye && f.winner === pid && inBlock[f.p1] && inBlock[f.p2];
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
 * 戻り値: [{ playerId, rank, tied, played, won, lost, drawn, legsFor, legsAgainst, setsFor, setsAgainst, points? }]
 * tied=true は、設定した項目と手動順位でも決まらず同順位になっている選手。
 */
function computeStandings_(memberIds, finals, tiebreakers, manual, cfg) {
  return computeStandingsFromStats_(memberIds, tallyStats_(memberIds, finals, cfg), finals, tiebreakers, manual || {}, cfg);
}

function computeStandingsFromStats_(memberIds, stats, finals, tiebreakers, manual, cfg) {
  var blocks = splitTies_(memberIds.slice(), tiebreakers, stats, finals, manual || {});
  var withPoints = !!(cfg && cfg.points) || tiebreakers.indexOf('points') !== -1;
  var out = [];
  var position = 1;
  blocks.forEach(function (b) {
    b.forEach(function (pid) {
      var s = stats[pid];
      var row = {
        playerId: pid,
        rank: position,
        tied: b.length > 1,
        played: s.played,
        won: s.won,
        lost: s.lost,
        drawn: s.drawn || 0,
        legsFor: s.legsFor,
        legsAgainst: s.legsAgainst,
        setsFor: s.setsFor,
        setsAgainst: s.setsAgainst,
      };
      if (withPoints) row.points = s.points || 0;
      if (s.adjustment) row.adjustment = s.adjustment;
      if (s.buchholz !== undefined) row.buchholz = s.buchholz;
      if (s.byes) row.byes = s.byes;
      if (s.nightWins !== undefined) row.nightWins = s.nightWins;
      out.push(row);
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

/* planBracket_ は 04b_bracket.js（v0.8 の汎用の組み立て）に移した */

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
    // v1.0: 期制リーグの期なら、その系列と前後の期（06c_season.js）。期制リーグでなければ null
    season: seasonContext_(ctx, eventId),
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
  if (rule.format === RULE_FORMAT.FIXED_LEGS) {
    return { name: rule.name, format: 'fixed', bestOf: rule.best_of, setBestOf: null, legsToWin: null, setsToWin: null, provisional: rule.is_provisional };
  }
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

/* buildEventView_ は 04e_view.js（v0.8）に移した */
