/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* 大会形式（ひな形）の定義。ここが唯一の定義で、次の場所が同じものを使う（tools/build.mjs が組み込む）。
 * - 運営用 Apps Script（作成時の検証・段階の組み立て）・閲覧者用 Apps Script（一覧の形式名）
 * - 運営画面（作成欄のプルダウン・説明・予定試合数）・ポータル（形式名・絞り込み）
 *
 * 並び順は「公式採用例と国内外の個人大会での選びやすさ」に基づく初期推奨順で、利用率の統計ではない。
 * 大会の進め方（ロビン・勝ち抜きなど）だけを定義し、1 試合のルール（Leg 制・セット制など）は別に選ぶ。
 * 各団体の規則の完全再現ではない（説明文にも「公式」「準拠」とは書かない）。
 * 既存の ID（robin / robin_ab / elimination / league）は変えない。
 */
var TOURNAMENT_FORMATS = [
  {
    id: 'robin_ko',
    group: 'basic',
    label: '予選ロビン → 決勝トーナメント',
    flow: '予選ロビン → 決勝トーナメント',
    description: '各組の総当たりで順位を決め、指定した順位までが 1 本の決勝トーナメントへ進みます。同じ組の選手は決勝の初戦でなるべく当たらないように配置します。',
    fields: ['groups', 'advance', 'cycles', 'thirdPlace'],
    category: 'mixed',
  },
  {
    id: 'elimination',
    group: 'basic',
    label: 'トーナメントのみ',
    flow: 'トーナメント（シングルエリミネーション）',
    description: '1 回負けたら敗退する勝ち抜き戦です。人数が 2 のべき乗に満たない分は上位シードが不戦勝になります。',
    fields: ['thirdPlace'],
    category: 'tournament',
  },
  {
    id: 'robin_ab',
    group: 'basic',
    label: '予選ロビン → A／Bトーナメント',
    flow: '予選ロビン → A トーナメント ／ B トーナメント',
    description: '各組の上位が A トーナメント、それ以外が B トーナメントへ進みます（順位の範囲で 2 つの決勝表に分かれます）。',
    fields: ['groups', 'advance', 'cycles', 'thirdPlace'],
    category: 'mixed',
  },
  {
    id: 'double_elimination',
    group: 'basic',
    label: 'ダブルエリミネーション',
    flow: '勝者側 → 敗者側 → グランドファイナル',
    description: '原則 2 回負けると敗退します。初めて負けた選手は敗者側に回り、勝者側の優勝者と敗者側の優勝者がグランドファイナルで対戦します。',
    fields: ['grandFinal'],
    category: 'tournament',
  },
  {
    id: 'robin',
    group: 'basic',
    label: 'ロビンのみ',
    flow: 'ロビン（グループごとの総当たり）',
    description: 'グループごとに総当たりを行い、グループ内の順位を決めます。',
    fields: ['groups', 'cycles'],
    category: 'robin',
  },
  {
    id: 'league',
    group: 'basic',
    label: 'リーグ〈節ごとの総当たり〉',
    flow: 'リーグ（節ごとの総当たり）',
    description: '全員と総当たりで対戦し、節（ラウンド）ごとに進めます。1 回・2 回総当たり、複数ディビジョンに対応します。',
    fields: ['divisions', 'cycles', 'points'],
    category: 'league',
  },
  {
    id: 'league_playoff',
    group: 'advanced',
    label: 'リーグ → プレーオフ',
    flow: 'リーグ → プレーオフ（勝ち抜き）',
    description: 'リーグ（ディビジョンごと）の上位がプレーオフの勝ち抜き戦へ進みます。',
    fields: ['divisions', 'cycles', 'points', 'playoff', 'thirdPlace'],
    category: 'mixed',
  },
  {
    id: 'multi_robin_ko',
    group: 'advanced',
    label: '複数段階ロビン → 決勝トーナメント',
    flow: '予選ロビン → 2 次ロビン → 決勝トーナメント',
    description: '予選ロビンの上位で 2 次ロビンの組を作り直し、その上位が決勝トーナメントへ進みます。2 次ロビンは予選の成績を持ち越しません（初期仕様）。',
    fields: ['groups', 'advance', 'groups2', 'advance2', 'cycles', 'thirdPlace'],
    category: 'mixed',
  },
  {
    id: 'series_playoff',
    group: 'advanced',
    label: 'ポイントシリーズ → プレーオフ',
    flow: '各節の小トーナメント × 節数 → 累計ポイント上位のプレーオフ',
    description: '節ごとに小さなトーナメントを行い、到達した順位に応じたポイントを累計します。全節が終わったら累計上位がプレーオフへ進みます。',
    fields: ['nights', 'nightPoints', 'playoff', 'thirdPlace'],
    category: 'series',
  },
  {
    id: 'swiss',
    group: 'advanced',
    label: 'スイス式',
    flow: 'スイス式（指定回戦） → 決勝トーナメント（任意）',
    description: '成績の近い選手どうしを回戦ごとに組み合わせ、指定した回戦の後に順位を決めます。上位で決勝トーナメントを行うこともできます。',
    fields: ['swissRounds', 'points', 'playoffOptional', 'thirdPlace'],
    category: 'swiss',
  },
];

/** 一覧（ポータル）の絞り込みに使う大分類 */
var FORMAT_CATEGORY_LABEL = {
  tournament: 'トーナメント',
  robin: 'ロビン',
  league: 'リーグ',
  mixed: '複合',
  series: 'シリーズ',
  swiss: 'スイス式',
};

/** 段階の種類（運営画面・閲覧画面・一覧で共通の表示名） */
var STAGE_KIND_LABEL = {
  round_robin: 'ロビン',
  league: 'リーグ',
  single_elimination: 'トーナメント',
  double_elimination: 'ダブルエリミネーション',
  swiss: 'スイス式',
  series: 'ポイントシリーズ',
};

/** 新しい大会の作成欄で最初に選ばれている形式 */
var DEFAULT_FORMAT_ID = 'robin_ko';

/** 作成時の既定値（説明用。アプリの既定値で、どこかの団体の規則ではない） */
var FORMAT_DEFAULTS = {
  groups: 4,
  advance: 2,
  groups2: 2,
  advance2: 2,
  cycles: 1,
  divisions: 1,
  playoff: 4,
  points: { win: 2, draw: 1, loss: 0 },
  nights: 16,
  // 8 人の各節トーナメントの例: 優勝 5・準優勝 3・準決勝敗退 2・初戦敗退 0
  nightPoints: [5, 3, 2, 0],
  swissRounds: 5,
  grandFinal: 'reset',
};

function formatById_(id) {
  for (var i = 0; i < TOURNAMENT_FORMATS.length; i++) if (TOURNAMENT_FORMATS[i].id === id) return TOURNAMENT_FORMATS[i];
  return null;
}

/** 総当たりの試合数（k 人・cycles 回） */
function robinMatchCount_(k, cycles) {
  return k >= 2 ? ((k * (k - 1)) / 2) * (cycles === 2 ? 2 : 1) : 0;
}

/** n 人をできるだけ均等に g 組へ分けたときの各組の人数 */
function splitEven_(n, g) {
  var out = [];
  for (var i = 0; i < g; i++) out.push(Math.floor(n / g) + (i < n % g ? 1 : 0));
  return out;
}

/** 勝ち抜き戦の試合数（Bye を除く）。3 位決定戦は 4 人以上のときだけ */
function knockoutMatchCount_(n, thirdPlace) {
  return n >= 2 ? n - 1 + (thirdPlace && n >= 4 ? 1 : 0) : 0;
}

/**
 * 節ごとの順位ポイント（各節のトーナメントで到達した段階に対する総点）。
 * points = [優勝, 準優勝, 準決勝敗退, 準々決勝敗退, …]。足りない段階は最後の値
 * 戻り値: 敗退した回戦（決勝 = 0、準決勝 = 1 …）から点への関数
 */
function nightPointsFor_(points, depthFromFinal, isWinner) {
  var list = Array.isArray(points) && points.length ? points : FORMAT_DEFAULTS.nightPoints;
  var idx = isWinner ? 0 : depthFromFinal + 1;
  return list[Math.min(idx, list.length - 1)];
}

/**
 * 作成前の見積もり: 予定試合数と、成り立たない条件。
 * params = { players, groups, advance, groups2, advance2, cycles, divisions, playoff, nights, swissRounds, thirdPlace, grandFinal }
 * 戻り値: { stages: [{ name, matches, note? }], total, max, problems: [文字列], notes: [文字列] }
 * max はダブルエリミのリセットの決勝など「最大でこの数」のとき total と異なる。
 */
function estimateFormat_(id, params) {
  var p = params || {};
  var n = Math.max(0, Math.floor(Number(p.players) || 0));
  var cycles = p.cycles === 2 ? 2 : 1;
  var third = !!p.thirdPlace;
  var stages = [];
  var problems = [];
  var notes = [];
  var extra = 0;
  var robin = function (name, count, groups) {
    var sizes = splitEven_(count, groups);
    var m = 0;
    sizes.forEach(function (k) {
      m += robinMatchCount_(k, cycles);
    });
    stages.push({ name: name, matches: m, note: groups + ' 組（' + sizes.join('・') + ' 人）' });
    if (sizes.some(function (k) { return k < 2; })) problems.push(name + ': 2 人未満の組ができます（' + count + ' 人を ' + groups + ' 組）。');
    return sizes;
  };
  var advancing = function (sizes, adv) {
    var t = 0;
    sizes.forEach(function (k) {
      t += Math.min(adv, k);
    });
    return t;
  };
  var ko = function (name, count) {
    stages.push({ name: name, matches: knockoutMatchCount_(count, third), note: count + ' 人' + (third && count >= 4 ? '・3 位決定戦あり' : '') });
    if (count < 2) problems.push(name + ': 出場者が 2 人以上必要です（' + count + ' 人）。');
  };
  var G = Math.max(1, Math.floor(Number(p.groups) || 1));
  var adv = Math.max(1, Math.floor(Number(p.advance) || 1));
  if (n < 2) problems.push('参加人数を 2 人以上にしてください。');
  if (id === 'robin_ko' || id === 'robin_ab') {
    var sizes = robin('予選ロビン', n, G);
    var toKo = advancing(sizes, adv);
    if (id === 'robin_ko') {
      ko('決勝トーナメント', toKo);
      if (sizes.some(function (k) { return k > 0 && adv >= k; })) notes.push('全員が通過する組があります（通過順位 ' + adv + ' 位まで）。');
    } else {
      ko('A トーナメント', toKo);
      ko('B トーナメント', n - toKo);
    }
  } else if (id === 'elimination') {
    ko('トーナメント', n);
  } else if (id === 'double_elimination') {
    var de = n >= 2 ? 2 * n - 2 : 0;
    stages.push({ name: 'ダブルエリミネーション', matches: de, note: p.grandFinal === 'single' ? 'グランドファイナル 1 試合' : 'グランドファイナルで敗者側が勝てば、もう 1 試合（リセット）' });
    if (p.grandFinal !== 'single' && n >= 2) extra += 1;
    if (n < 2) problems.push('出場者が 2 人以上必要です。');
  } else if (id === 'robin') {
    robin('ロビン', n, G);
  } else if (id === 'league' || id === 'league_playoff') {
    var D = Math.max(1, Math.floor(Number(p.divisions) || 1));
    var ds = robin('リーグ', n, D);
    if (id === 'league_playoff') {
      var po = Math.max(2, Math.floor(Number(p.playoff) || 2));
      var reach = Math.min(po, ds.reduce(function (a, k) { return a + k; }, 0));
      ko('プレーオフ', reach);
      if (D > 1) notes.push('プレーオフへは各ディビジョンの上位が進みます（' + D + ' ディビジョン × 上位 ' + Math.ceil(po / D) + ' 人の目安）。');
    }
  } else if (id === 'multi_robin_ko') {
    var s1 = robin('予選ロビン', n, G);
    var a1 = advancing(s1, adv);
    var G2 = Math.max(1, Math.floor(Number(p.groups2) || 1));
    var s2 = robin('2 次ロビン', a1, G2);
    var adv2 = Math.max(1, Math.floor(Number(p.advance2) || 1));
    ko('決勝トーナメント', advancing(s2, adv2));
    notes.push('2 次ロビンは予選の成績を持ち越しません。');
  } else if (id === 'series_playoff') {
    var N = Math.max(1, Math.floor(Number(p.nights) || 1));
    stages.push({ name: 'ポイントシリーズ', matches: N * knockoutMatchCount_(n, false), note: N + ' 節 × ' + knockoutMatchCount_(n, false) + ' 試合（全員が毎節出場する場合）' });
    var po2 = Math.max(2, Math.floor(Number(p.playoff) || 2));
    if (po2 > n) problems.push('プレーオフの人数（' + po2 + '）が参加人数より多くなっています。');
    ko('プレーオフ', Math.min(po2, n));
    notes.push('各節の得点は到達した順位に対する総点です（準決勝・決勝の点を足し合わせません）。');
  } else if (id === 'swiss') {
    var R = Math.max(1, Math.floor(Number(p.swissRounds) || 1));
    stages.push({ name: 'スイス式', matches: R * Math.floor(n / 2), note: R + ' 回戦' + (n % 2 ? '・毎回戦 1 人が不戦（Bye）' : '') });
    if (n >= 2 && R > n - 1) problems.push('回戦数（' + R + '）が多すぎます。' + n + ' 人では ' + (n - 1) + ' 回戦までしか全員が再戦なしで組めません。');
    else if (n >= 2 && R > Math.ceil(Math.log(n) / Math.LN2) + 2) notes.push('回戦数が多いと、後半は成績の近い相手と再戦なしで組めないことがあります（その場合は理由を表示します）。');
    var po3 = Math.floor(Number(p.playoff) || 0);
    if (po3 >= 2) ko('決勝トーナメント', Math.min(po3, n));
  } else {
    problems.push('大会の形式が不明です。');
  }
  var total = 0;
  stages.forEach(function (s) {
    total += s.matches;
  });
  return { stages: stages, total: total, max: total + extra, problems: problems, notes: notes };
}
