/* 勝ち抜き戦の組み立て（v0.8。スプレッドシートに依存しない純粋な関数）
 *
 * どの勝ち抜き戦も「節点」の並びで表す。節点は 2 つの出所を持つ:
 *   { t: 'p', id }   … 選手が直接入る（シード・Bye の後の枠など）
 *   { t: 'w', key }  … 節点 key の勝者
 *   { t: 'l', key }  … 節点 key の敗者（ダブルエリミの敗者側・3 位決定戦）
 *   null             … 誰も来ない（空き枠）
 * 出所に誰が来るかは対戦結果によらず構造だけで決まるので、組み立てるときに
 *   両方に選手が来る節点 → 試合 / 片方だけ → 素通り（不戦。試合は作らない）/ どちらも来ない → 空
 * と決められる。こうすると、Bye 同士の試合や、1 人しかいない 3 位決定戦を運営者に入力させずに済む。
 */

/**
 * 節点を試合に解決する。nodes は出所の節点より後に並んでいること。
 * 戻り値: 試合だけの配列 [{ key, side, round, order, label, meta, p1, p2, nextKey, nextSlot, loserNextKey, loserNextSlot }]
 *         と、素通りの節点（Bye で次へ進む選手）の一覧 passes: { key: 選手 ID or 出所 }
 */
function resolveBracket_(nodes) {
  var kind = {};
  var sole = {};
  var eff = function (s) {
    if (!s) return null;
    if (s.t === 'p') return s.id ? s : null;
    var k = kind[s.key];
    if (k === undefined) throw new Error('bracket node order: ' + s.key);
    if (s.t === 'w') return k === 'match' ? { t: 'w', key: s.key } : k === 'pass' ? sole[s.key] : null;
    if (s.t === 'l') return k === 'match' ? { t: 'l', key: s.key } : null;
    return null;
  };
  var effective = {};
  nodes.forEach(function (n) {
    var e = [eff(n.src[0]), eff(n.src[1])];
    var present = e.filter(Boolean);
    if (present.length === 2) {
      kind[n.key] = 'match';
      effective[n.key] = e;
    } else if (present.length === 1) {
      kind[n.key] = 'pass';
      sole[n.key] = present[0];
    } else {
      kind[n.key] = 'empty';
    }
  });
  var matches = [];
  var byKey = {};
  nodes.forEach(function (n) {
    if (kind[n.key] !== 'match') return;
    var e = effective[n.key];
    var m = {
      key: n.key,
      side: n.side || '',
      round: n.round,
      order: n.order,
      label: n.label,
      meta: n.meta || null,
      p1: e[0].t === 'p' ? e[0].id : '',
      p2: e[1].t === 'p' ? e[1].id : '',
      nextKey: '',
      nextSlot: null,
      loserNextKey: '',
      loserNextSlot: null,
    };
    matches.push(m);
    byKey[n.key] = m;
  });
  matches.forEach(function (m) {
    effective[m.key].forEach(function (s, i) {
      if (s.t === 'w') {
        byKey[s.key].nextKey = m.key;
        byKey[s.key].nextSlot = i + 1;
      } else if (s.t === 'l') {
        byKey[s.key].loserNextKey = m.key;
        byKey[s.key].loserNextSlot = i + 1;
      }
    });
  });
  var passes = {};
  Object.keys(sole).forEach(function (k) {
    passes[k] = sole[k];
  });
  return { matches: matches, kind: kind, passes: passes };
}

function nextPow2_(n) {
  var size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * シングルエリミネーションの節点。entrants = [{ id, seed, startRound }]（seed の昇順に並べ替えて使う）
 * opts = { thirdPlace, lastRound }  lastRound を指定すると、その回戦までで止める（再抽選の前の固定の回戦）
 * 途中回戦から出場するシード（startRound > 1）は、その回戦までの枠に他の選手がいない位置でなければならない。
 * 戻り値: { nodes, size, rounds, problems: [理由] }
 */
function singleEliminationNodes_(entrants, opts) {
  var o = opts || {};
  var list = entrants.slice().sort(function (a, b) {
    return (a.seed || 0) - (b.seed || 0);
  });
  var n = list.length;
  var problems = [];
  if (n < 2) return { nodes: [], size: 0, rounds: 0, problems: ['出場者が 2 名以上必要です。'] };
  var size = nextPow2_(n);
  var rounds = Math.round(Math.log(size) / Math.LN2);
  var pos = seedPositions_(size);
  var leaf = []; // 位置 → 選手
  for (var i = 0; i < size; i++) leaf.push(list[pos[i] - 1] || null);
  // 途中回戦から出場するシード: その回戦より前の枠（2^(r-1) 個のかたまり）に他の選手がいないこと
  leaf.forEach(function (e, idx) {
    if (!e || !(e.startRound > 1)) return;
    var r = e.startRound;
    if (r > rounds) {
      problems.push((e.label || 'シード ' + e.seed) + ' は ' + r + ' 回戦から出場する設定ですが、この人数のトーナメントは ' + rounds + ' 回戦までです。');
      return;
    }
    var block = Math.pow(2, r - 1);
    var start = Math.floor(idx / block) * block;
    for (var k = start; k < start + block; k++) {
      if (k !== idx && leaf[k]) {
        problems.push(
          (e.label || 'シード ' + e.seed) + ' を ' + r + ' 回戦から出場させるには、' + (r - 1) + ' 回戦までの相手の枠が空いている必要がありますが、' +
            (leaf[k].label || 'シード ' + leaf[k].seed) + ' が入ります。出場者を減らすか、途中から出場するシードを見直してください。'
        );
        return;
      }
    }
  });
  var last = o.lastRound && o.lastRound < rounds ? o.lastRound : rounds;
  var nodes = [];
  for (var r = 1; r <= last; r++) {
    var count = size / Math.pow(2, r);
    for (var k2 = 0; k2 < count; k2++) {
      var src;
      if (r === 1) {
        src = [leaf[2 * k2] ? { t: 'p', id: leaf[2 * k2].id } : null, leaf[2 * k2 + 1] ? { t: 'p', id: leaf[2 * k2 + 1].id } : null];
      } else {
        src = [{ t: 'w', key: r - 1 + '-' + 2 * k2 }, { t: 'w', key: r - 1 + '-' + (2 * k2 + 1) }];
      }
      nodes.push({ key: r + '-' + k2, round: r, order: k2 + 1, label: roundLabelForElimination_(r, rounds), src: src });
    }
  }
  if (o.thirdPlace && rounds >= 2 && last === rounds) {
    nodes.push({ key: 'third', round: rounds, order: 2, label: '3位決定戦', src: [{ t: 'l', key: rounds - 1 + '-0' }, { t: 'l', key: rounds - 1 + '-1' }] });
  }
  return { nodes: nodes, size: size, rounds: rounds, lastRound: last, problems: problems };
}

/**
 * ダブルエリミネーションの節点（勝者側 W・敗者側 L・グランドファイナル GF）。
 * 勝者側の 2 回戦以降の敗者は、早い再戦を減らすため、敗者側へ入る順番を回戦ごとに逆順・半分入れ替えにする。
 * opts = { grandFinal: 'reset' | 'single' }
 */
function doubleEliminationNodes_(entrants, opts) {
  var list = entrants.slice().sort(function (a, b) {
    return (a.seed || 0) - (b.seed || 0);
  });
  var n = list.length;
  if (n < 2) return { nodes: [], problems: ['出場者が 2 名以上必要です。'] };
  var size = nextPow2_(n);
  var k = Math.round(Math.log(size) / Math.LN2);
  var pos = seedPositions_(size);
  var nodes = [];
  var wKey = function (r, i) {
    return 'W' + r + '-' + i;
  };
  var lKey = function (r, i) {
    return 'L' + r + '-' + i;
  };
  for (var r = 1; r <= k; r++) {
    var count = size / Math.pow(2, r);
    for (var i = 0; i < count; i++) {
      var src;
      if (r === 1) {
        var a = list[pos[2 * i] - 1];
        var b = list[pos[2 * i + 1] - 1];
        src = [a ? { t: 'p', id: a.id } : null, b ? { t: 'p', id: b.id } : null];
      } else {
        src = [{ t: 'w', key: wKey(r - 1, 2 * i) }, { t: 'w', key: wKey(r - 1, 2 * i + 1) }];
      }
      nodes.push({ key: wKey(r, i), side: 'W', round: r, order: i + 1, label: r === k ? '勝者側決勝' : '勝者側 ' + r + '回戦', src: src });
    }
  }
  var lbRounds = k >= 2 ? 2 * (k - 1) : 0;
  var lbLabel = function (j) {
    return j === lbRounds ? '敗者側決勝' : '敗者側 ' + j + '回戦';
  };
  if (k >= 2) {
    for (var i1 = 0; i1 < size / 4; i1++) {
      nodes.push({ key: lKey(1, i1), side: 'L', round: 1, order: i1 + 1, label: lbLabel(1), src: [{ t: 'l', key: wKey(1, 2 * i1) }, { t: 'l', key: wKey(1, 2 * i1 + 1) }] });
    }
    for (var d = 1; d <= k - 1; d++) {
      var m = size / Math.pow(2, d + 1);
      for (var j = 0; j < m; j++) {
        var drop = d % 2 === 1 ? m - 1 - j : (j + Math.floor(m / 2)) % m;
        nodes.push({ key: lKey(2 * d, j), side: 'L', round: 2 * d, order: j + 1, label: lbLabel(2 * d), src: [{ t: 'w', key: lKey(2 * d - 1, j) }, { t: 'l', key: wKey(d + 1, drop) }] });
      }
      if (d <= k - 2) {
        var m2 = size / Math.pow(2, d + 2);
        for (var j2 = 0; j2 < m2; j2++) {
          nodes.push({ key: lKey(2 * d + 1, j2), side: 'L', round: 2 * d + 1, order: j2 + 1, label: lbLabel(2 * d + 1), src: [{ t: 'w', key: lKey(2 * d, 2 * j2) }, { t: 'w', key: lKey(2 * d, 2 * j2 + 1) }] });
        }
      }
    }
  }
  var lbChampion = k >= 2 ? { t: 'w', key: lKey(lbRounds, 0) } : { t: 'l', key: wKey(1, 0) };
  nodes.push({ key: 'GF', side: 'GF', round: 1, order: 1, label: 'グランドファイナル', src: [{ t: 'w', key: wKey(k, 0) }, lbChampion], meta: { gf: 1, reset: (opts && opts.grandFinal) !== 'single' } });
  return { nodes: nodes, size: size, winnerRounds: k, loserRounds: lbRounds, problems: [] };
}

/**
 * ダブルエリミネーションの試合の一覧。リセットの決勝（GF2）は、敗者側の選手がグランドファイナルに勝ったときだけ行う。
 * 組み立て時には選手の入らない試合として作り、GF の結果で選手を入れる（または「実施なし」にする）。
 */
function planDoubleElimination_(entrants, opts) {
  var built = doubleEliminationNodes_(entrants, opts);
  if (built.problems.length) return { matches: [], problems: built.problems };
  var resolved = resolveBracket_(built.nodes);
  var matches = resolved.matches;
  var gf = matches.filter(function (x) {
    return x.key === 'GF';
  })[0];
  if (gf && gf.meta && gf.meta.reset) {
    matches.push({ key: 'GF2', side: 'GF', round: 2, order: 1, label: 'グランドファイナル（リセット）', meta: { gf: 2 }, p1: '', p2: '', nextKey: '', nextSlot: null, loserNextKey: '', loserNextSlot: null });
  }
  return { matches: matches, problems: [], winnerRounds: built.winnerRounds, loserRounds: built.loserRounds, size: built.size };
}

/**
 * シングルエリミネーションの試合の一覧（従来の planBracket_ と同じ形）。
 * entrants は選手 ID の配列（シード順）か、{ id, seed, startRound, label } の配列。
 */
function planSingleElimination_(entrants, opts) {
  var list = entrants.map(function (e, i) {
    return typeof e === 'string' ? { id: e, seed: i + 1, startRound: 1 } : e;
  });
  var built = singleEliminationNodes_(list, opts);
  if (!built.nodes.length) return { matches: [], problems: built.problems, rounds: 0, size: 0, passes: {} };
  var resolved = resolveBracket_(built.nodes);
  return { matches: resolved.matches, problems: built.problems, rounds: built.rounds, size: built.size, lastRound: built.lastRound, passes: resolved.passes, kind: resolved.kind };
}

/** 互換用（v0.7 までの関数名）: 選手 ID の配列（シード順）からトーナメント表 */
function planBracket_(entrantIds, thirdPlace) {
  return planSingleElimination_(entrantIds, { thirdPlace: thirdPlace }).matches;
}

/**
 * 回戦ごとに抽選する勝ち抜き戦の人数の検証（v0.8）。
 * fixedRounds: 抽選の前に固定の表で行う回戦数（0 なら 1 回戦から抽選）
 * 各回戦の出場者 = 前の回戦の勝者 + その回戦から出場するシード。各回戦は偶数でなければならない（Bye は作らない）。
 * 戻り値: { rounds: [{ round, players, joining, fixed? }], problems }
 */
function redrawSchedule_(entrants, fixedRounds) {
  var problems = [];
  var byRound = {};
  var first = [];
  entrants.forEach(function (e) {
    var r = e.startRound > 1 ? e.startRound : 1;
    if (r > 1 && r <= fixedRounds) {
      problems.push((e.label || 'シード ' + e.seed) + ' は固定の回戦（' + fixedRounds + ' 回戦まで）の途中からは出場できません。抽選が始まる ' + (fixedRounds + 1) + ' 回戦以降を指定してください。');
    }
    if (r === 1 || r <= fixedRounds) first.push(e);
    else byRound[r] = (byRound[r] || 0) + 1;
  });
  var rounds = [];
  var round;
  var pool;
  if (fixedRounds > 0) {
    if (first.length < 2) return { rounds: [], problems: problems.concat(['1 回戦の出場者が 2 名以上必要です。']) };
    var plan = planSingleElimination_(first, { lastRound: fixedRounds });
    if (plan.rounds <= fixedRounds) {
      return { rounds: [], problems: problems.concat(['固定の表で行う回戦数（' + fixedRounds + '）が、1 回戦の出場者 ' + first.length + ' 人のトーナメントの回戦数以上です。']) };
    }
    var survivors = 0;
    Object.keys(plan.kind).forEach(function (key) {
      if (key.indexOf(fixedRounds + '-') === 0 && plan.kind[key] !== 'empty') survivors++;
    });
    for (var f = 1; f <= fixedRounds; f++) {
      rounds.push({
        round: f,
        players: f === 1 ? first.length : null,
        joining: 0,
        fixed: true,
      });
    }
    round = fixedRounds + 1;
    pool = survivors + (byRound[round] || 0);
  } else {
    round = 1;
    pool = first.length;
  }
  var later = function (r) {
    return Object.keys(byRound).some(function (x) {
      return Number(x) > r;
    });
  };
  for (var guard = 0; guard < 20; guard++) {
    if (pool === 1 && !later(round - 1)) break;
    if (pool < 2) {
      problems.push(round + ' 回戦の出場者が足りません（' + pool + ' 人）。');
      break;
    }
    if (pool % 2 === 1) {
      problems.push(round + ' 回戦の出場者が ' + pool + ' 人（奇数）になります。回戦ごとに抽選する方式では、各回戦の人数を偶数にしてください（途中から出場するシードの人数で調整できます）。');
      break;
    }
    rounds.push({ round: round, players: pool, joining: byRound[round] || 0 });
    pool = pool / 2 + (byRound[round + 1] || 0);
    round++;
  }
  Object.keys(byRound).forEach(function (r) {
    if (Number(r) >= round) problems.push(r + ' 回戦から出場するシードがいますが、その前に勝ち抜き戦が終わります。');
  });
  return { rounds: rounds, problems: problems };
}

/** 回戦ごとの抽選での回戦名（残り人数から） */
function redrawRoundLabel_(players, round) {
  if (players === 2) return '決勝';
  if (players === 4) return '準決勝';
  if (players === 8) return '準々決勝';
  return round + '回戦';
}

/**
 * 同じ予選グループの選手が 1 回戦で当たらないように、シードの近い選手どうしを入れ替える（v0.8）。
 * entrants: シード順 [{ id, seed, group }]。入れ替えるのは「同じ順位帯（tier）」の中だけで、シードの意味を大きく変えない。
 * 戻り値: { order: 入れ替え後の並び（シード順）, conflicts: [[id, id]], swaps: 回数 }
 * 両立できない場合は残った組み合わせを conflicts に返す（完全な保証はしない）。
 */
function avoidSameGroupFirstRound_(entrants, tierOf) {
  var order = entrants.slice();
  var n = order.length;
  if (n < 4) return { order: order, conflicts: [], swaps: 0 };
  var firstRoundPairs = function (list) {
    var plan = planSingleElimination_(
      list.map(function (e, i) {
        return { id: e.id, seed: i + 1, startRound: e.startRound || 1 };
      }),
      {}
    );
    var byId = {};
    list.forEach(function (e) {
      byId[e.id] = e;
    });
    var pairs = [];
    plan.matches.forEach(function (m) {
      if (m.p1 && m.p2) pairs.push([byId[m.p1], byId[m.p2]]);
    });
    return pairs;
  };
  var clash = function (list) {
    return firstRoundPairs(list).filter(function (p) {
      return p[0].group && p[0].group === p[1].group;
    });
  };
  var swaps = 0;
  var guard = 0;
  var current = clash(order);
  while (current.length && guard++ < 200) {
    var improved = false;
    var bad = current[0][1];
    var bi = order.indexOf(bad);
    for (var j = 0; j < n && !improved; j++) {
      if (j === bi || tierOf(order[j]) !== tierOf(bad)) continue;
      var trial = order.slice();
      trial[bi] = order[j];
      trial[j] = bad;
      var next = clash(trial);
      if (next.length < current.length) {
        order = trial;
        current = next;
        swaps++;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return {
    order: order,
    swaps: swaps,
    conflicts: current.map(function (p) {
      return [p[0].id, p[1].id];
    }),
  };
}
