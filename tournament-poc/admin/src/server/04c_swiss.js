/* スイス式の組み合わせ（v0.8。スプレッドシートに依存しない純粋な関数）
 *
 * このアプリで採用した汎用のスイス式で、特定の団体・大会の規則の再現ではない。
 * - 1 回戦: シード順で上半分と下半分を組む（1 対 n/2+1 …）。主催者が抽選を選んだときは並びを乱数で決める
 * - 2 回戦以降: 現在の順位（勝ち点 → Buchholz → Leg 差 → 得 Leg → シード）で並べ、同じ勝ち点の中で
 *   上半分と下半分を組む。組めないときは近い勝ち点の選手と組む
 * - 守る条件の優先順位: ①同じ回戦に同じ選手を 2 回出さない（絶対）②不戦（Bye）を同じ選手に 2 回与えない
 *   ③再戦を避ける ④勝ち点の近い選手どうしにする。②③は満たせないときだけ緩め、緩めた内容と理由を返す
 * - 再戦なしで組めないことを全部の組み合わせを調べて確かめた場合は「不可能」、調べきれなかった場合は「探索の打ち切り」と区別する
 */

var SWISS_SEARCH_BUDGET_ = 200000;

/**
 * players: 現在の順位の順に [{ id, points, opponents: { id: 対戦回数 }, byes: 回数 }]
 * opts: { avoidRematch: 既定 true, budget }
 * 戻り値: { pairs: [[id, id]], bye: id | '', relaxed: [{ rule, reason, detail }], rematches: [[id, id]], steps }
 */
function swissPairRound_(players, opts) {
  var o = opts || {};
  var budget = o.budget || SWISS_SEARCH_BUDGET_;
  var list = players.slice();
  var relaxed = [];
  var steps = 0;
  var byeId = '';
  var out = null;

  var tryPair = function (rest, allowRematch) {
    // 戻り値: 組の配列 / null（この条件では組めない）。予算を使い切ったら例外 TIMEOUT
    if (!rest.length) return [];
    var a = rest[0];
    var others = rest.slice(1);
    var group = others.filter(function (x) {
      return x.points === a.points;
    });
    // 同じ勝ち点の中では、上半分と下半分を組む（a の相手は同点グループの真ん中から）
    var preferred = group.length ? group[Math.max(0, Math.floor((group.length + 1) / 2) - 1)] : null;
    var cand = others.slice().sort(function (x, y) {
      var dx = Math.abs(x.points - a.points);
      var dy = Math.abs(y.points - a.points);
      if (dx !== dy) return dx - dy;
      if (preferred && x.points === a.points && y.points === a.points) {
        return Math.abs(others.indexOf(x) - others.indexOf(preferred)) - Math.abs(others.indexOf(y) - others.indexOf(preferred));
      }
      return others.indexOf(x) - others.indexOf(y);
    });
    for (var i = 0; i < cand.length; i++) {
      var b = cand[i];
      if (!allowRematch && a.opponents[b.id]) continue;
      if (++steps > budget) {
        var err = new Error('TIMEOUT');
        err.swissTimeout = true;
        throw err;
      }
      var rest2 = others.filter(function (x) {
        return x !== b;
      });
      var sub = tryPair(rest2, allowRematch);
      if (sub) return [[a.id, b.id]].concat(sub);
    }
    return null;
  };

  var attempt = function (pool, allowRematch) {
    try {
      return { pairs: tryPair(pool, allowRematch), timeout: false };
    } catch (e) {
      if (e && e.swissTimeout) return { pairs: null, timeout: true };
      throw e;
    }
  };

  var byeCandidates = function () {
    if (list.length % 2 === 0) return [null];
    var minByes = Math.min.apply(
      null,
      list.map(function (p) {
        return p.byes || 0;
      })
    );
    // 下位から、不戦の少ない選手を候補にする
    var cands = list
      .slice()
      .reverse()
      .filter(function (p) {
        return (p.byes || 0) === minByes;
      });
    if (minByes > 0) relaxed.push({ rule: 'bye', reason: 'all', detail: '全員が不戦（Bye）を受けているため、不戦の少ない下位の選手にもう一度不戦を割り当てます。' });
    return cands;
  };

  var cands = byeCandidates();
  var anyTimeout = false;
  for (var c = 0; c < cands.length && !out; c++) {
    var bye = cands[c];
    var pool = list.filter(function (p) {
      return p !== bye;
    });
    var r = attempt(pool, o.avoidRematch === false);
    if (r.timeout) anyTimeout = true;
    if (r.pairs) {
      out = r.pairs;
      byeId = bye ? bye.id : '';
    }
  }
  var rematches = [];
  if (!out) {
    // 再戦なしでは組めない: 再戦を許して、再戦の少ない組み合わせ（候補の並びで再戦でない相手を先に試す）にする
    relaxed.push({
      rule: 'rematch',
      reason: anyTimeout ? 'timeout' : 'impossible',
      detail: anyTimeout
        ? '再戦を避ける組み合わせを探しきれなかったため（探索の打ち切り: ' + budget + ' 手）、再戦を含めて組みました。'
        : '再戦を避ける組み合わせが存在しないことを確かめたため、再戦を含めて組みました。',
    });
    var bye2 = cands[0];
    var pool2 = list.filter(function (p) {
      return p !== bye2;
    });
    steps = 0;
    var greedy = function (rest) {
      if (!rest.length) return [];
      var a = rest[0];
      var others = rest.slice(1);
      var pick = others.filter(function (x) {
        return !a.opponents[x.id];
      })[0] || others[0];
      return [[a.id, pick.id]].concat(
        greedy(
          others.filter(function (x) {
            return x !== pick;
          })
        )
      );
    };
    out = greedy(pool2);
    byeId = bye2 ? bye2.id : '';
  }
  var byId = {};
  list.forEach(function (p) {
    byId[p.id] = p;
  });
  out.forEach(function (pair) {
    if (byId[pair[0]].opponents[pair[1]]) rematches.push(pair);
  });
  return { pairs: out, bye: byeId, relaxed: relaxed, rematches: rematches, steps: steps };
}

/**
 * スイス式の順位表。
 * rounds の試合（確定したもの）から勝ち点・Buchholz・Leg 差などを数える。
 * - 勝ち点: 勝ち win・引き分け draw・負け loss。不戦（Bye）は byePoints（既定は勝ちと同じ）
 * - Buchholz: 実際に対戦した相手（不戦は含まない）の勝ち点の合計。不戦は 0 として数える（このアプリの定義）
 *   棄権・失格・不戦勝の試合の相手も「対戦した相手」として数える
 * finals: [{ p1, p2, winner, draw, l1, l2, s1, s2, bye, countLegs }]
 */
function swissStandings_(memberIds, finals, cfg, manual) {
  var pts = cfg.points || { win: 2, draw: 1, loss: 0 };
  var byePoints = typeof cfg.byePoints === 'number' ? cfg.byePoints : pts.win;
  var stats = {};
  memberIds.forEach(function (pid) {
    stats[pid] = emptyStats_(pid);
    stats[pid].points = 0;
    stats[pid].byes = 0;
    stats[pid].opponents = [];
  });
  finals.forEach(function (f) {
    if (f.bye) {
      var s = stats[f.p1];
      if (!s) return;
      s.byes++;
      s.points += byePoints;
      return;
    }
    var a = stats[f.p1];
    var b = stats[f.p2];
    if (!a || !b) return;
    a.opponents.push(f.p2);
    b.opponents.push(f.p1);
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
      a.drawn = (a.drawn || 0) + 1;
      b.drawn = (b.drawn || 0) + 1;
      a.points += pts.draw;
      b.points += pts.draw;
    } else if (f.winner === f.p1) {
      a.won++;
      b.lost++;
      a.points += pts.win;
      b.points += pts.loss;
    } else {
      b.won++;
      a.lost++;
      b.points += pts.win;
      a.points += pts.loss;
    }
  });
  memberIds.forEach(function (pid) {
    var s = stats[pid];
    s.buchholz = s.opponents.reduce(function (sum, oid) {
      return sum + (stats[oid] ? stats[oid].points : 0);
    }, 0);
  });
  return computeStandingsFromStats_(memberIds, stats, finals, cfg.tiebreakers || ['points', 'buchholz', 'leg_diff', 'legs_for'], manual || {});
}
