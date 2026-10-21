/* 抽選・組分け（v0.8。スプレッドシートに依存しない純粋な関数。乱数だけは Utilities を使う）
 *
 * 守る条件の優先順位（高い順）: ①人数の均衡（組の人数差は 1 以下。必ず守る）②シードの分散 ③レーティングの分散 ④所属の分散
 * 下位の条件は上位の条件を崩さない範囲でだけ整える（同じ強さの帯の中での入れ替えだけを行う）。満たせなかったものは報告する。
 * 所属が空欄の選手は「所属なし」として扱い、1 つの所属としてはまとめない。
 * レーティング（Rt）が未入力の選手は 0 とは扱わず、Rt のある選手を配った後に抽選で配る。
 */

/** 0 以上 n 未満の整数の乱数（Utilities.getUuid の乱数を使う。偏りが出ないよう棄却法） */
function randomInt_(n) {
  if (n <= 1) return 0;
  var limit = Math.floor(0x100000000 / n) * n;
  for (var i = 0; i < 20; i++) {
    var hex = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    var v = parseInt(hex, 16);
    if (v < limit) return v % n;
  }
  return Math.floor(Math.random() * n);
}

function shuffle_(list) {
  var a = list.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = randomInt_(i + 1);
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** レーティングの文字列を数にする（未入力は null。0 とは区別する） */
function parseRating_(value) {
  if (value === null || value === undefined) return null;
  var t = String(value).normalize('NFKC').trim();
  if (!t) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return NaN;
  return Number(t);
}

/** 組ごとの「同じ所属どうしの組み合わせ」の数（所属なしは数えない） */
function affiliationClashes_(groupsOfPlayers) {
  var total = 0;
  var detail = [];
  groupsOfPlayers.forEach(function (members, gi) {
    var count = {};
    members.forEach(function (p) {
      var a = p.affiliation ? String(p.affiliation).trim() : '';
      if (!a) return;
      count[a] = (count[a] || 0) + 1;
    });
    Object.keys(count).forEach(function (a) {
      if (count[a] > 1) {
        total += (count[a] * (count[a] - 1)) / 2;
        detail.push({ group: gi, affiliation: a, players: count[a] });
      }
    });
  });
  return { total: total, detail: detail };
}

/**
 * 選手を組に配る。
 * players: [{ id, affiliation, rating, seed, order }]（order は登録順）
 * groupCount: 組の数
 * opts: { method: 'registration' | 'random' | 'balanced', useSeeds, useRating, spreadAffiliation }
 * 戻り値: { groups: [[id…]], report: { method, sizes, seeds, rated, unrated, clashesBefore, clashes, swaps, notes } }
 */
function assignGroups_(players, groupCount, opts) {
  var o = opts || {};
  var method = o.method === 'random' || o.method === 'balanced' ? o.method : 'registration';
  var G = Math.max(1, groupCount);
  var sizes = splitEven_(players.length, G);
  var notes = [];
  var ordered;
  var tierOf = {};
  if (method === 'registration') {
    ordered = players.slice().sort(function (a, b) {
      return a.order - b.order;
    });
    ordered.forEach(function (p, i) {
      tierOf[p.id] = 'all';
    });
  } else if (method === 'random') {
    ordered = shuffle_(players);
    ordered.forEach(function (p) {
      tierOf[p.id] = 'all';
    });
  } else {
    var seeded = o.useSeeds
      ? players
          .filter(function (p) {
            return p.seed;
          })
          .sort(function (a, b) {
            return a.seed - b.seed;
          })
      : [];
    var rest = players.filter(function (p) {
      return seeded.indexOf(p) === -1;
    });
    var rated = o.useRating
      ? rest
          .filter(function (p) {
            return typeof p.ratingValue === 'number' && !isNaN(p.ratingValue);
          })
          .sort(function (a, b) {
            return b.ratingValue - a.ratingValue;
          })
      : [];
    var unrated = shuffle_(
      rest.filter(function (p) {
        return rated.indexOf(p) === -1;
      })
    );
    ordered = seeded.concat(rated).concat(unrated);
    // 同じ強さの帯 = 組の数ごとの区切り（シード → Rt の高い順 → 未入力は抽選）。所属の入れ替えはこの帯の中だけ
    ordered.forEach(function (p, i) {
      var band = Math.floor(i / G);
      tierOf[p.id] = (seeded.indexOf(p) !== -1 ? 's' : rated.indexOf(p) !== -1 ? 'r' : 'u') + (seeded.indexOf(p) !== -1 || rated.indexOf(p) !== -1 ? band : '');
    });
    if (o.useSeeds) notes.push('シード ' + seeded.length + ' 人を、別々の組に（上位から蛇行の順で）配りました。');
    if (o.useRating) notes.push('Rt のある ' + rated.length + ' 人を高い順に蛇行の順で配り、Rt が未入力の ' + unrated.length + ' 人は抽選で配りました（未入力を 0 とは扱っていません）。');
  }
  // 配る: 登録順・抽選は A, B, C, A, B, C…（従来どおり）、組分けは蛇行（A, B, C, C, B, A…）
  var groups = [];
  for (var g = 0; g < G; g++) groups.push([]);
  var snake = method === 'balanced';
  ordered.forEach(function (p, i) {
    var lap = Math.floor(i / G);
    var pos = i % G;
    var target = snake && lap % 2 === 1 ? G - 1 - pos : pos;
    // 人数の均衡を最優先: 満員の組は飛ばす
    var guard = 0;
    while (groups[target].length >= sizes[target] && guard++ < G) target = (target + 1) % G;
    groups[target].push(p);
  });
  var before = affiliationClashes_(groups);
  var swaps = 0;
  if (o.spreadAffiliation && before.total > 0) {
    for (var pass = 0; pass < 20; pass++) {
      var improved = false;
      for (var a = 0; a < G; a++) {
        for (var b = a + 1; b < G; b++) {
          for (var i1 = 0; i1 < groups[a].length; i1++) {
            for (var j1 = 0; j1 < groups[b].length; j1++) {
              var x = groups[a][i1];
              var y = groups[b][j1];
              if (tierOf[x.id] !== tierOf[y.id]) continue;
              var cur = affiliationClashes_(groups).total;
              groups[a][i1] = y;
              groups[b][j1] = x;
              if (affiliationClashes_(groups).total < cur) {
                swaps++;
                improved = true;
              } else {
                groups[a][i1] = x;
                groups[b][j1] = y;
              }
            }
          }
        }
      }
      if (!improved) break;
    }
  }
  var after = affiliationClashes_(groups);
  var hasAffiliation = players.some(function (p) {
    return p.affiliation;
  });
  if (o.spreadAffiliation && G > 1 && hasAffiliation) {
    notes.push(
      after.total
        ? '同じ所属の選手が同じ組に残っています（' +
            after.detail
              .map(function (d) {
                return d.affiliation + ' ' + d.players + ' 人';
              })
              .join('・') +
            '）。人数の均衡' + (method === 'balanced' ? '・シード・Rt の分散' : '') + 'を優先したため、これ以上は分けられませんでした。'
        : '同じ所属の選手が同じ組にならないように配りました。'
    );
  }
  return {
    groups: groups.map(function (list) {
      return list.map(function (p) {
        return p.id;
      });
    }),
    report: { method: method, sizes: sizes, clashesBefore: before.total, clashes: after.total, swaps: swaps, notes: notes },
  };
}
