/* 期制リーグの配置計算（v1.0。スプレッドシートに依存しない純粋な関数）
 *
 * 用語: 期 = 1 つの大会（Events の 1 行）。ディビジョン = 期の大会のリーグ段階のグループ（上から 1 部・2 部…）。
 * 会員 = 期をまたいで同じ人を指す ID（LeagueMembers。名前では対応付けない）。
 *
 * 隣接する上位ディビジョン A（a 人）と下位ディビジョン B について（依頼の仕様どおり）:
 *   B の 1 位 → A へ自動昇格 / A の最下位 → B へ自動降格 / A の下から 2 位 と B の 2 位 → 入替戦
 *   入替戦で A 側が勝てば両者とも残留、B 側が勝てば B 側が昇格・A 側が降格。最上位・最下位の外側には昇降格を作らない。
 * この関数は「次期の配置案」と、その理由・問題点（確定を止める理由）を返すだけで、何も書き込まない。
 */

/** 期制リーグの設定（Leagues.config_json）。主催者が決める値で、アプリが勝手に決める境目はない */
function leagueConfig_(league) {
  var c = safeJson_(league && league.config_json, {});
  var ints = function (arr, min, max) {
    return Array.isArray(arr)
      ? arr.map(function (v) {
          return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max ? v : null;
        })
      : [];
  };
  return {
    // thresholds[i] = (i + 2) ディビジョンにする最少の人数（空 = 人数によらず 1 ディビジョン）
    thresholds: ints(c.thresholds, 2, 9999).filter(function (v) {
      return v !== null;
    }),
    // targets[k - 1] = k 部の目標人数（空欄 = ディビジョン数が前期と同じなら前期と同じ人数、変わるときは残りを均等に分ける。最下位は常に残りの人数）
    targets: ints(c.targets, 2, 999),
    // capacities[k - 1] = k 部の定員（空欄 = なし）
    capacities: ints(c.capacities, 2, 999),
    cycles: c.cycles === 2 ? 2 : 1,
    points: isValidPoints_(c.points) ? { win: c.points.win, draw: c.points.draw, loss: c.points.loss } : { win: 2, draw: 1, loss: 0 },
    rule: c.rule && typeof c.rule === 'object' ? c.rule : null,
    playoffRule: c.playoffRule && typeof c.playoffRule === 'object' ? c.playoffRule : null,
  };
}

/** k 部の名前（1 ディビジョンなら「リーグ」） */
function seasonDivisionName_(k, count) {
  return count > 1 ? k + '部' : 'リーグ';
}

/** 次期の人数からディビジョン数を決める（主催者の境目だけで決める） */
function seasonDivisionCount_(n, thresholds) {
  var d = 1;
  (thresholds || []).forEach(function (t) {
    if (n >= t) d++;
  });
  return Math.min(d, ADMIN_CONFIG.MAX_SEASON_DIVISIONS);
}

/**
 * 各ディビジョンの人数。1〜(D-1) 部は目標人数があればその人数、なければ残りを均等に分ける。最下位は残り。
 * 割り切れない端数は下の部から 1 人ずつ多くする（上の部に多く配ると、降格した選手が端数の都合で上に戻ってしまうため）。
 * 戻り値: { sizes: [..], problems: [..] }
 */
function seasonDivisionSizes_(n, d, targets) {
  if (d === 1) return { sizes: [n], problems: [] };
  var fixed = {};
  var sum = 0;
  for (var k = 1; k < d; k++) {
    var t = targets[k - 1];
    if (t) {
      fixed[k] = t;
      sum += t;
    }
  }
  var free = [];
  for (var j = 1; j <= d; j++) if (!fixed[j]) free.push(j);
  var rest = n - sum;
  if (rest < free.length * 2) {
    return { sizes: [], problems: ['目標人数の合計（' + sum + ' 人）が多すぎて、残りのディビジョンに 2 人以上を入れられません（次期 ' + n + ' 人・' + d + ' 部制）。目標人数を見直してください。'] };
  }
  var base = Math.floor(rest / free.length);
  var extra = rest % free.length;
  var sizes = [];
  for (var i = 1; i <= d; i++) {
    if (fixed[i]) sizes.push(fixed[i]);
    else {
      var pos = free.length - 1 - free.indexOf(i);
      sizes.push(base + (pos < extra ? 1 : 0));
    }
  }
  return { sizes: sizes, problems: [] };
}

/** 次期にそのディビジョンで昇降格の規則を当てはめるのに必要な最少人数（重なりがないこと） */
function seasonMinSize_(k, d) {
  if (d === 1) return 2;
  if (k === 1 || k === d) return 2; // 最上位: 下から 2 位（入替戦）と最下位（自動降格）。最下位: 1 位（自動昇格）と 2 位（入替戦）
  return 4; // 中間: 1 位・2 位（上側）と下から 2 位・最下位（下側）が重ならない
}

var SEASON_MOVE_LABEL_ = {
  rank: '順位',
  stay: '残留',
  auto_promote: '自動昇格',
  auto_relegate: '自動降格',
  playoff_win_promote: '入替戦に勝って昇格',
  playoff_win_stay: '入替戦に勝って残留',
  playoff_lose_relegate: '入替戦に負けて降格',
  playoff_lose_stay: '入替戦に負けて残留',
  playoff_pending: '入替戦の結果待ち',
  new: '新規参加',
  return: '復帰',
  leave: '不参加（脱退）',
};

/**
 * 今期のディビジョンの順位から、各選手の役割（自動昇格・入替戦など）を決める。
 * divisions = [{ index, name, rows: [{ key, name, rank, tied }] }]（rows は順位表の順）
 * 戻り値: { roles: { key: { division, role, pos } }, problems: [..], playoffs: [{ upper, lower, upperKey, lowerKey }] }
 * 同順位の塊の中で役割が分かれるときは問題にする（名前順などで決めない。主催者が順位を手で決める）
 */
function seasonRoles_(divisions) {
  var d = divisions.length;
  var roles = {};
  var problems = [];
  var playoffs = [];
  divisions.forEach(function (div) {
    var a = div.rows.length;
    var k = div.index;
    var hasUpper = k > 1;
    var hasLower = k < d;
    var tooSmall = d > 1 && a < seasonMinSize_(k, d);
    if (tooSmall) {
      problems.push(div.name + ' は ' + a + ' 人のため、昇格・降格・入替戦の対象が重なります（この位置のディビジョンには ' + seasonMinSize_(k, d) + ' 人以上が必要）。次期の所属を手動で決めてください。');
    }
    div.rows.forEach(function (row, i) {
      var pos = i + 1;
      var role = 'stay';
      if (d === 1) role = 'rank';
      else if (!tooSmall) {
        if (hasUpper && pos === 1) role = 'auto_promote';
        else if (hasUpper && pos === 2) role = 'playoff_up';
        else if (hasLower && pos === a) role = 'auto_relegate';
        else if (hasLower && pos === a - 1) role = 'playoff_down';
      } else {
        role = 'conflict';
      }
      roles[row.key] = { division: k, role: role, pos: pos, rank: row.rank, tied: !!row.tied };
    });
    if (d > 1 && !tooSmall) {
      // 同順位の塊で役割が分かれていたら止める
      var seen = {};
      div.rows.forEach(function (row) {
        if (!row.tied) return;
        var r = roles[row.key];
        if (!seen[row.rank]) seen[row.rank] = {};
        seen[row.rank][r.role] = true;
      });
      Object.keys(seen).forEach(function (rank) {
        if (Object.keys(seen[rank]).length > 1) {
          problems.push(div.name + ' の ' + rank + '位が同順位のため、昇格・入替戦・降格の対象が決まりません。この期の大会の「組み合わせ」タブで順位を手動で決めてください。');
        }
      });
    }
  });
  if (d > 1) {
    for (var k = 1; k < d; k++) {
      var up = divisions[k - 1].rows;
      var low = divisions[k].rows;
      if (up.length < seasonMinSize_(k, d) || low.length < seasonMinSize_(k + 1, d)) continue;
      playoffs.push({ upper: k, lower: k + 1, upperKey: up[up.length - 2].key, lowerKey: low[1].key });
    }
  }
  return { roles: roles, problems: problems, playoffs: playoffs };
}

/** 並べ替えの鍵（配列）を前から比べる */
function compareKeys_(a, b) {
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/**
 * ディビジョン数が前期と同じときの所属。成績で決まった所属（昇降格・入替戦の結果）を基準に、上の部から順に人数を合わせる。
 * - 目標人数がない部（最下位を除く）は前期と同じ人数を保つ。最下位の部は残り（不参加・新規参加による増減を受け持つ）
 * - 人数が足りない部は、すぐ下の部から繰り上げる。順番は、下の部に残った選手の順位の順（入替戦に負けた 2 位 → 3 位 …）
 *   → さらに下の部から上がってきた選手 → 上の部から降格した選手（最後の手段）→ 新規参加・復帰。成績による降格は欠員では取り消さない
 * - 人数が多すぎる部（目標人数を減らしたときなど）は、その部に残った選手の下位から下げる（成績で上がった・降りてきた選手は後）
 * - 繰り上げ・繰り下げが同順位の塊の途中で切れるときは問題にする（名前順などで決めない）
 * entries = [{ key, base, from（前期の部。新規は null）, fromName, rank, tied, joined }]
 * 戻り値: { auto: { key: 部 }, sizes, source: ['target' | 'previous' | 'rest'], problems }
 */
function seasonFillDivisions_(d, entries, targets, prevSizes) {
  var sizes = [];
  var source = [];
  var sum = 0;
  for (var k = 1; k < d; k++) {
    var t = targets[k - 1];
    sizes.push(t || prevSizes[k - 1]);
    source.push(t ? 'target' : 'previous');
    sum += sizes[k - 1];
  }
  sizes.push(Math.max(0, entries.length - sum));
  source.push('rest');
  var cur = {};
  entries.forEach(function (e) {
    cur[e.key] = e.joined ? d : e.base;
  });
  var inDiv = function (k) {
    return entries.filter(function (e) {
      return cur[e.key] === k;
    });
  };
  // 小さいほど先に動かす
  var fillKey = function (e, k) {
    if (e.joined) return [3, 0, 0];
    if (e.from === k + 1) return [0, 0, e.rank];
    if (e.from > k + 1) return [1, e.from, e.rank];
    return [2, e.from, e.rank];
  };
  var pushKey = function (e, k) {
    if (e.joined) return [0, 0, 0];
    if (e.from === k) return [1, 0, -e.rank];
    if (e.from < k) return [2, -e.from, -e.rank];
    return [3, -e.from, -e.rank];
  };
  var problems = [];
  var tieCheck = function (moved, stayed, word, k) {
    moved.forEach(function (e) {
      if (!e.tied) return;
      var split = stayed.some(function (x) {
        return x.tied && x.from === e.from && x.rank === e.rank;
      });
      if (split) problems.push(e.fromName + ' の ' + e.rank + '位の同順位が、' + seasonDivisionName_(k, d) + ' への' + word + 'の対象にかかります。この期の大会の「組み合わせ」タブで順位を手動で決めてください。');
    });
  };
  var pick = function (list, keyFn, k) {
    return list.slice().sort(function (a, b) {
      return compareKeys_(keyFn(a, k), keyFn(b, k));
    })[0];
  };
  for (k = 1; k < d; k++) {
    var moved = [];
    while (inDiv(k).length < sizes[k - 1]) {
      var below = inDiv(k + 1);
      if (!below.length) break;
      var up = pick(below, fillKey, k);
      cur[up.key] = k;
      moved.push(up);
    }
    tieCheck(moved, inDiv(k + 1), '繰り上げ', k);
    moved = [];
    while (inDiv(k).length > sizes[k - 1]) {
      var down = pick(inDiv(k), pushKey, k);
      cur[down.key] = k + 1;
      moved.push(down);
    }
    tieCheck(moved, inDiv(k), '繰り下げ', k + 1);
  }
  var actual = [];
  for (k = 1; k <= d; k++) actual.push(inDiv(k).length);
  return { auto: cur, sizes: sizes, actual: actual, source: source, problems: problems };
}

/**
 * 次期の配置案。
 * input = {
 *   seasonNo, config（leagueConfig_）,
 *   divisions: [{ index, name, complete, progress: { final, total }, rows: [{ key, name, rank, tied, withdrawn }] }],
 *   playoffs: [{ upper, lower, upperKey, lowerKey, state, winnerKey, confirmedAt, resultType }]（生成済みの入替戦）,
 *   candidates: { key: { name, status } }（今期にいない会員。復帰の候補）,
 *   edits: { leave: [key], join: [{ key, name }], rejoin: [key], moves: { key: { division, reason } }, names: { key: name } }
 * }
 * 戻り値: { divisionCount, sizes, divisions, rows, problems, warnings, counts, basis }
 */
function planSeasonPlacement_(input) {
  var cfg = input.config;
  var edits = input.edits || {};
  var problems = [];
  var warnings = [];
  var divisions = input.divisions;
  var d = divisions.length;
  var label = input.seasonNo ? '第' + input.seasonNo + '期' : '今期';

  divisions.forEach(function (div) {
    if (!div.complete) problems.push(label + 'の ' + div.name + ' の全試合が確定していません（確定 ' + div.progress.final + ' / ' + div.progress.total + '）。');
  });
  var r = seasonRoles_(divisions);
  problems = problems.concat(r.problems);
  var rowOf = {};
  divisions.forEach(function (div) {
    div.rows.forEach(function (row) {
      rowOf[row.key] = row;
    });
  });

  // 入替戦の結果
  var moves = edits.moves || {};
  var movement = {};
  var base = {};
  Object.keys(r.roles).forEach(function (key) {
    var role = r.roles[key];
    var k = role.division;
    if (role.role === 'rank') {
      movement[key] = 'rank';
      base[key] = null; // 次期の境目で決める
    } else if (role.role === 'auto_promote') {
      movement[key] = 'auto_promote';
      base[key] = k - 1;
    } else if (role.role === 'auto_relegate') {
      movement[key] = 'auto_relegate';
      base[key] = k + 1;
    } else {
      movement[key] = 'stay';
      base[key] = k;
    }
  });
  var playoffInfo = [];
  r.playoffs.forEach(function (exp) {
    var got = (input.playoffs || []).filter(function (p) {
      return p.upper === exp.upper;
    })[0];
    var upName = divisions[exp.upper - 1].name;
    var lowName = divisions[exp.lower - 1].name;
    var title = upName + '・' + lowName + 'の入替戦';
    var info = { upper: exp.upper, lower: exp.lower, upperKey: exp.upperKey, lowerKey: exp.lowerKey, state: got ? got.state : 'none', winnerKey: '', confirmedAt: got ? got.confirmedAt || '' : '', resultType: got ? got.resultType || '' : '', matchId: got ? got.matchId || '' : '' };
    playoffInfo.push(info);
    var manualBoth = moves[exp.upperKey] && moves[exp.lowerKey];
    var pend = function (msg) {
      movement[exp.upperKey] = 'playoff_pending';
      movement[exp.lowerKey] = 'playoff_pending';
      if (!manualBoth) problems.push(msg);
    };
    if (!got) return pend(title + 'がまだ組まれていません（この期の大会の「期・昇降格」タブで「入替戦を組む」）。行わない場合は、対象の 2 人の次期の所属を手動で決めてください。');
    if (got.upperKey !== exp.upperKey || got.lowerKey !== exp.lowerKey) {
      info.mismatch = true;
      return pend(title + 'の対戦者が今の順位と合いません（入替戦を組んだ後に順位が変わった可能性があります）。入替戦を組み直すか、対象の選手の次期の所属を手動で決めてください。');
    }
    if (got.state !== 'final' || !got.winnerKey) return pend(title + 'の結果が確定していません。');
    info.winnerKey = got.winnerKey;
    if (got.winnerKey === exp.upperKey) {
      movement[exp.upperKey] = 'playoff_win_stay';
      movement[exp.lowerKey] = 'playoff_lose_stay';
      base[exp.upperKey] = exp.upper;
      base[exp.lowerKey] = exp.lower;
    } else {
      movement[exp.upperKey] = 'playoff_lose_relegate';
      movement[exp.lowerKey] = 'playoff_win_promote';
      base[exp.upperKey] = exp.lower;
      base[exp.lowerKey] = exp.upper;
    }
  });
  if (d > 1) {
    // 入替戦を組んだが、今の規則では入替戦がない組（人数不足など）
    (input.playoffs || []).forEach(function (p) {
      if (!r.playoffs.some(function (e) { return e.upper === p.upper; })) warnings.push((divisions[p.upper - 1] ? divisions[p.upper - 1].name : p.upper + '部') + 'の下の入替戦は、今の人数では規則に当てはまらないため、配置に使っていません。');
    });
  }

  // 昇降格の後の並び（梯子）。次期の部は梯子を上から目標人数で区切って決める
  var ladder = [];
  var tieKey = function (key) {
    var row = rowOf[key];
    var role = r.roles[key];
    return row && row.tied ? role.division + ':' + row.rank : key;
  };
  if (d === 1) {
    divisions[0].rows.forEach(function (row) {
      ladder.push({ key: row.key, tie: tieKey(row.key) });
    });
  } else {
    for (var b = 1; b <= d; b++) {
      var down = [];
      var stay = [];
      var upIn = [];
      divisions.forEach(function (div) {
        div.rows.forEach(function (row) {
          if (base[row.key] !== b) return;
          if (div.index === b - 1) down.push(row);
          else if (div.index === b) stay.push(row);
          else if (div.index === b + 1) upIn.push(row);
        });
      });
      // 降りてきた選手は上位のディビジョンでの順位の順、残留は順位の順、上がってきた選手は下位のディビジョンでの順位の順
      down.concat(stay, upIn).forEach(function (row) {
        ladder.push({ key: row.key, tie: tieKey(row.key) });
      });
    }
  }

  // 参加・不参加
  var leave = {};
  (edits.leave || []).forEach(function (key) {
    if (!rowOf[key]) problems.push('不参加にした選手（' + key + '）はこの期にいません。');
    leave[key] = true;
  });
  ladder = ladder.filter(function (x) {
    return !leave[x.key];
  });
  var names = {};
  Object.keys(rowOf).forEach(function (key) {
    names[key] = rowOf[key].name;
  });
  var kinds = {};
  (edits.rejoin || []).forEach(function (key) {
    var c = (input.candidates || {})[key];
    if (!c) {
      problems.push('復帰させる会員（' + key + '）が見つからないか、すでにこの期にいます。');
      return;
    }
    names[key] = c.name;
    kinds[key] = 'return';
    ladder.push({ key: key, tie: key, joined: true });
  });
  (edits.join || []).forEach(function (j) {
    names[j.key] = j.name;
    kinds[j.key] = 'new';
    ladder.push({ key: j.key, tie: j.key, joined: true });
  });
  Object.keys(edits.names || {}).forEach(function (key) {
    if (names[key] !== undefined) names[key] = edits.names[key];
  });

  var n = ladder.length;
  var nd = seasonDivisionCount_(n, cfg.thresholds);
  var auto = {};
  var bands = [];
  var sizes;
  var fill = null;
  if (d > 1 && nd === d) {
    // ディビジョン数が前期と同じ: 成績で決まった所属を基準に、欠員は下の部の次点から埋める（seasonFillDivisions_）
    var entries = ladder.map(function (x) {
      var role = r.roles[x.key];
      var row = rowOf[x.key];
      return { key: x.key, base: base[x.key], from: role ? role.division : null, fromName: role ? divisions[role.division - 1].name : '', rank: row ? row.rank : 0, tied: !!(row && row.tied), joined: !!x.joined };
    });
    fill = seasonFillDivisions_(d, entries, cfg.targets, divisions.map(function (div) {
      return div.rows.length;
    }));
    problems = problems.concat(fill.problems);
    auto = fill.auto;
    sizes = fill.actual;
    // 表示の並び: 新しい部ごとに、前期の上の部の選手から順位の順（新規参加・復帰は最後）
    var order = {};
    ladder.forEach(function (x, i) {
      order[x.key] = i;
    });
    var sorted = entries.slice().sort(function (a, b) {
      return compareKeys_([auto[a.key], a.joined ? 1 : 0, a.from || 0, a.rank, order[a.key]], [auto[b.key], b.joined ? 1 : 0, b.from || 0, b.rank, order[b.key]]);
    });
    ladder = sorted.map(function (e) {
      return { key: e.key, tie: e.key, joined: e.joined };
    });
  } else {
    var sz = seasonDivisionSizes_(n, nd, cfg.targets);
    problems = problems.concat(sz.problems);
    sizes = sz.sizes.length ? sz.sizes : [n];
    if (!sz.sizes.length) nd = 1;
    var start = 0;
    sizes.forEach(function (size, i) {
      for (var p = start; p < start + size; p++) auto[ladder[p].key] = i + 1;
      bands.push({ index: i + 1, from: start + 1, to: start + size });
      if (i > 0) {
        var a = ladder[start - 1];
        var c = ladder[start];
        if (a && c && a.tie === c.tie && !a.joined) {
          var row = rowOf[c.key];
          var role = r.roles[c.key];
          problems.push(divisions[role.division - 1].name + ' の ' + row.rank + '位の同順位が、次期の ' + seasonDivisionName_(i, nd) + ' と ' + seasonDivisionName_(i + 1, nd) + ' の境目にかかります。この期の大会の「組み合わせ」タブで順位を手動で決めてください。');
        }
      }
      start += size;
    });
  }

  // 行（理由つき）
  var rows = [];
  var finalOf = {};
  var reasonOfChange = function (key, autoDiv, baseDiv) {
    if (nd > d) return 'ディビジョン増設（次期 ' + n + ' 人 → ' + nd + ' 部制）により ' + seasonDivisionName_(autoDiv, nd);
    if (nd < d) return 'ディビジョン統合（次期 ' + n + ' 人 → ' + nd + ' 部制）により ' + seasonDivisionName_(autoDiv, nd);
    if (fill) {
      // 人数を合わせた部（繰り上げなら移った先、繰り下げなら元の部）
      var k = autoDiv < baseDiv ? autoDiv : baseDiv;
      var how = fill.source[k - 1] === 'target' ? '目標人数 ' + fill.sizes[k - 1] + ' 人' : '前期と同じ ' + fill.sizes[k - 1] + ' 人';
      if (autoDiv < baseDiv) return '欠員の補充（' + seasonDivisionName_(k, nd) + ' は' + how + '）のため ' + seasonDivisionName_(autoDiv, nd) + ' へ繰り上げ';
      return '人数調整（' + seasonDivisionName_(k, nd) + ' は' + how + '）のため ' + seasonDivisionName_(autoDiv, nd) + ' へ繰り下げ';
    }
    if (autoDiv < baseDiv) return '人数調整（目標人数・欠員）のため ' + seasonDivisionName_(autoDiv, nd) + ' へ繰り上げ';
    return '人数調整（目標人数・欠員）のため ' + seasonDivisionName_(autoDiv, nd) + ' へ繰り下げ';
  };
  var ladderPos = {};
  ladder.forEach(function (x, i) {
    ladderPos[x.key] = i + 1;
  });
  var allKeys = Object.keys(rowOf).concat(
    ladder
      .filter(function (x) {
        return x.joined;
      })
      .map(function (x) {
        return x.key;
      })
  );
  allKeys.forEach(function (key) {
    var row = rowOf[key];
    var role = r.roles[key];
    var kind = leave[key] ? 'leave' : kinds[key] || movement[key];
    var out = {
      key: key,
      name: names[key],
      from: row ? { division: role.division, divisionName: divisions[role.division - 1].name, rank: row.rank, tied: !!row.tied, withdrawn: row.withdrawn || null } : null,
      movement: kind,
      movementLabel: SEASON_MOVE_LABEL_[kind] || kind,
      ladder: ladderPos[key] || null,
      baseDivision: null,
      autoDivision: null,
      newDivision: null,
      reasons: [],
      manual: null,
    };
    if (kind === 'leave') {
      out.reasons.push('次期は不参加（脱退）');
      rows.push(out);
      return;
    }
    out.autoDivision = auto[key];
    var baseDiv = kinds[key] ? nd : base[key];
    out.baseDivision = baseDiv;
    if (row && kind !== 'leave') {
      if (kind === 'rank') {
        var band = bands[auto[key] - 1];
        out.reasons.push((d === 1 && input.seasonNo === 1 ? '1期目 ' : '') + row.rank + '位' + (row.tied ? '（同順位）' : '') + 'のため ' + seasonDivisionName_(auto[key], nd) + (nd > 1 ? '（' + band.from + '〜' + band.to + '位が ' + seasonDivisionName_(auto[key], nd) + '）' : ''));
      } else {
        out.reasons.push(divisions[role.division - 1].name + ' ' + row.rank + '位・' + out.movementLabel);
        if (baseDiv !== null && baseDiv !== auto[key]) out.reasons.push(reasonOfChange(key, auto[key], baseDiv));
        else if (nd !== d) out.reasons.push((nd > d ? 'ディビジョン増設' : 'ディビジョン統合') + '（次期 ' + n + ' 人 → ' + nd + ' 部制）・' + seasonDivisionName_(auto[key], nd) + 'のまま');
      }
      if (row.withdrawn) warnings.push(row.name + ' は' + label + 'を' + (row.withdrawn.kind === 'disqualified' ? '失格' : '棄権') + 'しています。次期に参加するか確かめてください（参加しないなら「不参加」）。');
    } else if (kinds[key]) {
      out.reasons.push((kinds[key] === 'new' ? '新規参加' : '復帰（前期は不参加）') + 'のため最下位の ' + seasonDivisionName_(nd, nd) + '（変える場合は手動で）');
      if (auto[key] !== nd) out.reasons.push(reasonOfChange(key, auto[key], nd));
    }
    var mv = moves[key];
    if (mv) {
      out.manual = { division: mv.division, reason: mv.reason || '' };
      if (!(mv.division >= 1 && mv.division <= nd)) problems.push(names[key] + ' の手動の所属（' + mv.division + '）が、次期のディビジョン（1〜' + nd + '）の範囲にありません。');
      if (!mv.reason) problems.push(names[key] + ' の手動の所属の理由を入力してください。');
      out.newDivision = mv.division;
      out.reasons.push('手動で ' + seasonDivisionName_(mv.division, nd) + (mv.reason ? '（' + mv.reason + '）' : ''));
    } else {
      out.newDivision = auto[key];
      if (kind === 'playoff_pending') problems.push(names[key] + ' の次期の所属は、入替戦が終わるか手動で決めるまで確定できません。');
      if (role && role.role === 'conflict') problems.push(names[key] + ' の次期の所属を手動で決めてください（' + divisions[role.division - 1].name + ' の人数不足）。');
    }
    finalOf[key] = out.newDivision;
    rows.push(out);
  });
  Object.keys(moves).forEach(function (key) {
    if (!names[key] || leave[key]) problems.push('手動の所属を指定した選手（' + key + '）は次期の参加者にいません。');
  });

  // 次期の各ディビジョンの人数と規則の成り立ち
  var outDivisions = [];
  for (var k = 1; k <= nd; k++) {
    var members = rows
      .filter(function (x) {
        return x.newDivision === k;
      })
      .sort(function (a, b) {
        return (a.ladder || 9999) - (b.ladder || 9999);
      })
      .map(function (x) {
        return x.key;
      });
    var cap = cfg.capacities[k - 1] || null;
    var target = k < nd ? cfg.targets[k - 1] || null : null;
    outDivisions.push({ index: k, name: seasonDivisionName_(k, nd), size: members.length, target: target, capacity: cap, members: members });
    if (members.length < seasonMinSize_(k, nd)) {
      problems.push('次期の ' + seasonDivisionName_(k, nd) + ' は ' + members.length + ' 人です。' + (nd > 1 ? '昇格・降格・入替戦の対象が重ならないよう、' : '総当たりには ') + seasonMinSize_(k, nd) + ' 人以上が必要です。所属を変えるか、ディビジョン数の境目・目標人数を見直してください。');
    }
    if (cap && members.length > cap) problems.push('次期の ' + seasonDivisionName_(k, nd) + ' は ' + members.length + ' 人で、定員（' + cap + ' 人）を超えています。所属を変えるか、定員・目標人数を見直してください。');
  }
  var namesSeen = {};
  rows.forEach(function (x) {
    if (x.movement === 'leave') return;
    if (namesSeen[x.name]) problems.push('次期に同じ表示名「' + x.name + '」が 2 人います。どちらかの表示名を区別してください（同じ人として扱うことはありません）。');
    namesSeen[x.name] = true;
  });

  return {
    divisionCount: nd,
    previousDivisionCount: d,
    total: n,
    sizes: sizes,
    divisions: outDivisions,
    rows: rows,
    playoffs: playoffInfo,
    problems: problems.filter(function (p, i) {
      return problems.indexOf(p) === i;
    }),
    warnings: warnings.filter(function (p, i) {
      return warnings.indexOf(p) === i;
    }),
    finalOf: finalOf,
  };
}

/**
 * 配置の根拠（前期の順位と入替戦の結果）。次期を作った後に前期の結果が変わったかを見分ける。
 * 名前・時刻は入れない（表示名を変えただけでは変わらない）
 */
function seasonBasis_(divisions, playoffs) {
  return {
    divisions: divisions.map(function (div) {
      return {
        complete: !!div.complete,
        rows: div.rows.map(function (r) {
          return [r.key, r.rank, r.tied ? 1 : 0];
        }),
      };
    }),
    playoffs: (playoffs || []).map(function (p) {
      return [p.upper, p.upperKey, p.lowerKey, p.state, p.winnerKey || ''];
    }),
  };
}
