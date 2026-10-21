// ==== n02 Tournament PoC 運営用 Web アプリ / Code.gs ====
// このファイルは tools/build.mjs が admin/src/server/*.js から生成したものです。直接編集しないでください。

// ---- shared/formats.js ----
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

// ---- 00_config.js ----
/**
 * n02 Tournament PoC - 運営用 Web アプリ（サーバー側 API）
 *
 * このプロジェクトだけがスプレッドシートへ書き込む。閲覧者用 Web アプリは別プロジェクトで、
 * 読み取り専用スコープしか持たない（README「セキュリティ設計」参照）。
 *
 * 運営画面は GitHub Pages に置き、この Web アプリには fetch（doPost）で JSON を送る。
 * 公開されるトップレベル関数は doGet と doPost の 2 つだけ。それ以外は名前の末尾に "_" を付けた内部関数。
 * doPost は呼び出しのたびに、ログインのセッション（または管理者の鍵）を検証する（02_auth.js）。
 */

var ADMIN_CONFIG = Object.freeze({
  APP_VERSION: '0.8.0',
  // 1 = v0.7 まで。2 = v0.8（大会設定・所属/Rt・試合の予定/特殊な結果・共同主催者など。列とシートの追加だけ）
  SCHEMA_VERSION: 2,
  // 書き込みはスクリプトロックで直列化する。取れなければ BUSY を返し、クライアントが再試行する。
  LOCK_WAIT_MS: 10000,
  // 二重送信（ボタン連打・通信再試行）を requestId で弾く期間
  REQUEST_DEDUPE_TTL_SEC: 600,
  HISTORY_VIEW_LIMIT: 30,
  MAX_PLAYERS_PER_EVENT: 128,
  MAX_GROUPS: 16,
  MIN_GROUPS: 1,
  MAX_PLAYER_NAME_LENGTH: 40,
  MAX_EVENT_NAME_LENGTH: 80,
  MAX_LABEL_LENGTH: 40,
  MAX_NOTE_LENGTH: 200,
  MAX_BULK_PLAYERS: 64,
  // スプレッドシートの 1 セルは 50,000 文字まで。余裕を持って分割する。
  SNAPSHOT_CHUNK_SIZE: 40000,
  SNAPSHOT_MAX_CHUNKS: 10,
  HISTORY_CELL_LIMIT: 20000,
  BEST_OF_MAX: 21,
  // 誰でも主催できるため、悪用・誤操作で保存先が膨らまないよう上限を設ける（管理者は対象外）
  MAX_EVENTS_TOTAL: 200,
  MAX_CREATES_PER_HOUR: 10,
  MAX_CREATES_PER_USER_HOUR: 5,
  // Google ログインの確認（tokeninfo への問い合わせ）の回数。全体で 1 分あたり
  MAX_LOGINS_PER_MINUTE: 30,
  MAX_STAGES: 8,
  MAX_ELIMINATION_ENTRANTS: 128,
  MAX_REQUEST_CHARS: 100000,
  // JSON からの復元（restoreEvent）だけは大会 1 つ分のファイルを受け取るので大きくする
  MAX_RESTORE_REQUEST_CHARS: 2000000,
  // 公開データ（閲覧ページの JSON）の上限。セル 10 個 × 40,000 文字
  MAX_SNAPSHOT_CHARS: 400000,
  MAX_COLLABORATORS: 10,
  MAX_SERIES_NIGHTS: 30,
  MAX_SWISS_ROUNDS: 15,
  MAX_ANNOUNCEMENT_LENGTH: 1000,
  MAX_IMPORT_PLAYERS: 128,
  // ポータルの「作成した大会」に返す大会の上限（新しい順）
  MAX_MY_EVENTS: 100,
});

/** 試合状態（シートにはコード値で保存し、画面で日本語に変換する） */
var MATCH_STATUS = Object.freeze({
  SCHEDULED: 'scheduled', // 未開始
  LIVE: 'live', // 進行中
  FINAL: 'final', // 確定済み
});

var MATCH_STATUS_LABEL = Object.freeze({
  scheduled: '未開始',
  live: '進行中',
  final: '確定済み',
});

/** 大会の状態 */
var EVENT_STATUS = Object.freeze({
  DRAFT: 'draft', // 準備中
  RUNNING: 'running', // 開催中
  FINISHED: 'finished', // 終了
});

var EVENT_STATUS_LABEL = Object.freeze({
  draft: '準備中',
  running: '開催中',
  finished: '終了',
});

var STAGE_TYPE = Object.freeze({
  ROUND_ROBIN: 'round_robin', // ロビン（グループごとの総当たり）
  LEAGUE: 'league', // リーグ（全員の総当たり。ラウンドを「節」と呼ぶ）
  SINGLE_ELIMINATION: 'single_elimination', // トーナメント（勝ち抜き）
  DOUBLE_ELIMINATION: 'double_elimination', // v0.8: ダブルエリミネーション（勝者側・敗者側・グランドファイナル）
  SWISS: 'swiss', // v0.8: スイス式（成績の近い選手どうしを回戦ごとに組む）
  SERIES: 'series', // v0.8: ポイントシリーズ（節ごとの小トーナメントの順位ポイントを累計）
});

var RULE_FORMAT = Object.freeze({
  BEST_OF_LEGS: 'best_of_legs', // Best of N Legs
  BEST_OF_SETS: 'best_of_sets', // Best of N セット（各セット Best of M Legs）
  FIXED_LEGS: 'fixed_legs', // v0.8: 固定 Leg 数（N Legs をすべて投げる。同数なら引き分け。勝ち抜き戦では使えない）
});

/** v0.8: 試合の特殊な結果（空欄は通常の結果） */
var RESULT_TYPE = Object.freeze({
  NORMAL: '',
  WALKOVER: 'walkover', // 不戦勝（相手の当日棄権・不在）。Leg 数は記録しない
  RETIRED: 'retired', // 途中棄権（それまでの Leg 数は実際の数）
  DISQUALIFIED: 'disqualified', // 失格
  BYE: 'bye', // スイス式の不戦（相手なし）
  NOT_NEEDED: 'not_needed', // ダブルエリミのリセットの決勝など、行わなくてよくなった試合
});

var RESULT_TYPE_LABEL = Object.freeze({
  walkover: '不戦勝',
  retired: '途中棄権',
  disqualified: '失格',
  bye: '不戦（Bye）',
  not_needed: '実施なし',
});

var STAGE_TYPE_LABEL = Object.freeze({
  round_robin: 'ロビン',
  league: 'リーグ',
  single_elimination: 'トーナメント',
  double_elimination: 'ダブルエリミネーション',
  swiss: 'スイス式',
  series: 'ポイントシリーズ',
});

/**
 * シート定義。列は見出し名で参照するため、列の並べ替えや末尾への列追加には耐える。
 * 型: text = 文字列（書式「書式なしテキスト」で保存）, int = 整数, bool = 真偽値
 * 列の 3 つ目の値（2 など）は、その列を追加したスキーマの版。移行前のシートにその列がなくても読み込める（空として読む）。
 * シートの since も同じ（移行前はシートがなくても空として読む）。書き込みは移行が終わるまで受け付けない。
 */
var SCHEMA = Object.freeze({
  Events: {
    key: 'event_id',
    columns: [
      ['event_id', 'text'],
      ['name', 'text'],
      ['date_label', 'text'],
      ['status', 'text'],
      ['is_public', 'bool'],
      ['is_featured', 'bool'],
      ['rule_id', 'text'],
      ['is_sample', 'bool'],
      ['organizer_name', 'text'], // 主催者名（任意・非公開。管理者が誰の大会か分かるように）
      ['admin_key_hash', 'text'], // v0.4 までの運営用の鍵（v0.5 以降は使わない。既存のシートとの互換のため列だけ残す）
      ['admin_key_issued_at', 'text'],
      ['owner_email', 'text'], // 大会を作った Google アカウント（小文字）。空欄の大会は管理者だけが操作できる
      ['staff_pass_hash', 'text'], // 店舗スタッフ用の管理パスワードのソルト付き SHA-256。空欄なら未設定
      ['staff_pass_salt', 'text'],
      ['staff_pass_set_at', 'text'],
      ['notes', 'text'],
      ['config_json', 'text', 2], // v0.8: 大会の設定（形式・お知らせ・ルール表示・公開する項目・自動終了など）
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Rules: {
    key: 'rule_id',
    columns: [
      ['rule_id', 'text'],
      ['event_id', 'text'],
      ['name', 'text'],
      ['format', 'text'],
      ['best_of', 'int'], // Leg 制なら Leg 数、セット制ならセット数
      ['is_provisional', 'bool'],
      ['set_best_of', 'int'], // セット制のとき、1 セットの Best of（Leg 数）
      ['notes', 'text'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Players: {
    key: 'player_id',
    columns: [
      ['player_id', 'text'],
      ['event_id', 'text'],
      ['display_name', 'text'],
      ['external_ref', 'text'], // 将来の n02 連携用
      ['notes', 'text'], // 非公開メモ（閲覧画面には出さない）
      ['affiliation', 'text', 2], // v0.8: 所属（任意。空欄は「所属なし」）
      ['rating', 'text', 2], // v0.8: レーティング（任意。未入力は空欄で、0 とは区別する）
      ['seed', 'int', 2], // v0.8: シード（任意）
      ['meta_json', 'text', 2], // v0.8: 棄権・失格など
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Stages: {
    key: 'stage_id',
    columns: [
      ['stage_id', 'text'],
      ['event_id', 'text'],
      ['name', 'text'],
      ['type', 'text'],
      ['order', 'int'],
      ['rule_id', 'text'],
      ['parent_stage_id', 'text'], // 将来: ロビン → A/B トーナメントの接続
      ['config_json', 'text'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Groups: {
    key: 'group_id',
    columns: [
      ['group_id', 'text'],
      ['event_id', 'text'],
      ['stage_id', 'text'],
      ['name', 'text'],
      ['order', 'int'],
      ['meta_json', 'text', 2], // v0.8: シリーズの節の予定・中止など
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Entries: {
    key: 'entry_id',
    columns: [
      ['entry_id', 'text'],
      ['event_id', 'text'],
      ['stage_id', 'text'],
      ['group_id', 'text'],
      ['player_id', 'text'],
      ['seed', 'int'],
      ['manual_order', 'int'], // 同順位を主催者が決めたときの順番
      ['source_label', 'text'], // 進出元（例: グループA 1位）
      ['start_round', 'int', 2], // v0.8: トーナメントの途中回戦から出場するシード（空欄は 1 回戦から）
      ['meta_json', 'text', 2], // v0.8: 進出元のグループ・直接出場など
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  Matches: {
    key: 'match_id',
    columns: [
      ['match_id', 'text'],
      ['event_id', 'text'],
      ['stage_id', 'text'],
      ['group_id', 'text'],
      ['round', 'int'],
      ['order', 'int'],
      ['player1_id', 'text'],
      ['player2_id', 'text'],
      ['player1_legs', 'int'],
      ['player2_legs', 'int'],
      ['player1_sets', 'int'],
      ['player2_sets', 'int'],
      ['label', 'text'], // トーナメントの「準決勝」「3位決定戦」など
      ['status', 'text'],
      ['winner_id', 'text'],
      ['rule_id', 'text'], // 空欄ならステージのルール。将来の試合ごとのルール上書き用
      ['next_match_id', 'text'], // 将来: トーナメントの勝ち上がり先
      ['next_match_slot', 'int'],
      ['loser_next_match_id', 'text'], // 敗者の行き先（3 位決定戦）
      ['loser_next_match_slot', 'int'],
      ['external_ref', 'text'], // 将来: n02 の試合との対応
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
      ['confirmed_at', 'text'],
      ['result_type', 'text', 2], // v0.8: 空欄=通常 / walkover=不戦勝 / retired=途中棄権 / disqualified=失格 / bye=スイスの不戦 / not_needed=不要になった試合
      ['result_note', 'text', 2], // v0.8: 特殊な結果の理由
      ['schedule_json', 'text', 2], // v0.8: 予定（日付・時刻・会場・ボード・審判・延期）
      ['bracket_side', 'text', 2], // v0.8: ダブルエリミの W / L / GF
      ['meta_json', 'text', 2], // v0.8: 試合の補足（リセットの決勝・抽選の記録など）
    ],
  },
  History: {
    key: 'history_id',
    columns: [
      ['history_id', 'text'],
      ['at', 'text'],
      ['actor', 'text'],
      ['action', 'text'],
      ['entity', 'text'],
      ['entity_id', 'text'],
      ['event_id', 'text'],
      ['before_json', 'text'],
      ['after_json', 'text'],
    ],
  },
  // v0.8: 共同主催者（Google アカウント単位）。招待メールは送らない
  Collaborators: {
    key: 'collab_id',
    since: 2,
    columns: [
      ['collab_id', 'text'],
      ['event_id', 'text'],
      ['email', 'text'],
      ['role', 'text'],
      ['added_by', 'text'],
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
    ],
  },
  PublicSnapshots: {
    key: 'event_id',
    columns: [
      ['event_id', 'text'],
      ['is_default', 'bool'],
      ['version', 'text'],
      ['published_at', 'text'],
      ['chunk_count', 'int'],
      ['chunk_01', 'text'],
      ['chunk_02', 'text'],
      ['chunk_03', 'text'],
      ['chunk_04', 'text'],
      ['chunk_05', 'text'],
      ['chunk_06', 'text'],
      ['chunk_07', 'text'],
      ['chunk_08', 'text'],
      ['chunk_09', 'text'],
      ['chunk_10', 'text'],
    ],
  },
});

/** シートを作る順番（左から） */
var SHEET_ORDER = Object.freeze([
  'Events',
  'Rules',
  'Players',
  'Stages',
  'Groups',
  'Entries',
  'Matches',
  'History',
  'PublicSnapshots',
  'Collaborators',
]);

// ---- 01_util.js ----
/* 共通ユーティリティ */

/** 利用者に見せてよいエラー。code はクライアントの分岐用、message は画面にそのまま出す。 */
function appError_(code, message, detail) {
  var err = new Error(message);
  err.appCode = code;
  err.publicMessage = message;
  if (detail !== undefined) err.detail = detail;
  return err;
}

function nowIso_() {
  return new Date().toISOString();
}

/** 衝突しにくい ID を作る。prefix は種類の目印で、表示名には依存しない。 */
function newId_(prefix, taken) {
  for (var i = 0; i < 5; i++) {
    var id = prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
    if (!taken || !taken[id]) return id;
  }
  throw appError_('INTERNAL', 'ID の採番に失敗しました。もう一度実行してください。');
}

var ID_PATTERN_ = /^[A-Z]{2,4}-[A-Z0-9]{4,32}$/;

function isValidId_(value) {
  return typeof value === 'string' && ID_PATTERN_.test(value);
}

function requireId_(value, label) {
  if (!isValidId_(value)) throw appError_('BAD_REQUEST', label + ' の指定が不正です。');
  return value;
}

/** シートから読んだ値を列の型に合わせる（スプレッドシート側の自動変換に備える）。 */
function coerceCell_(value, type) {
  if (type === 'int') {
    if (value === '' || value === null || value === undefined) return null;
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    return isFinite(n) && Math.floor(n) === n ? n : NaN;
  }
  if (type === 'bool') {
    if (value === true) return true;
    if (typeof value === 'string') return value.trim().toUpperCase() === 'TRUE';
    return false;
  }
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString();
  }
  return String(value);
}

/** シートへ書く値。文字列は数式として解釈されないよう検証済みであることが前提。 */
function toCell_(value, type) {
  if (type === 'int') return value === null || value === undefined || value === '' ? '' : Number(value);
  if (type === 'bool') return value === true;
  return value === null || value === undefined ? '' : String(value);
}

/**
 * 利用者が入力する文字列の検証。
 * - 前後の空白を除き、制御文字を拒否する
 * - 先頭が = + - @ の文字列は、スプレッドシートで数式として解釈される恐れがあるため拒否する
 */
function cleanText_(value, label, maxLength, options) {
  var opts = options || {};
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw appError_('VALIDATION', label + ' の形式が不正です。');
  }
  var text = String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) {
    if (opts.allowEmpty) return '';
    throw appError_('VALIDATION', label + ' を入力してください。');
  }
  if (text.length > maxLength) {
    throw appError_('VALIDATION', label + ' は ' + maxLength + ' 文字以内で入力してください。');
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw appError_('VALIDATION', label + ' に使用できない文字が含まれています。');
  }
  if (/^[=+\-@]/.test(text)) {
    throw appError_('VALIDATION', label + ' の先頭に = + - @ は使用できません。');
  }
  return text;
}

/** 全角数字を含む入力を 0 以上の整数にする。整数でなければ null。 */
function parseNonNegativeInt_(value) {
  if (typeof value === 'number') {
    return isFinite(value) && Math.floor(value) === value && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;
  var text = value.normalize('NFKC').trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  return Number(text);
}

function requireBool_(value, label) {
  if (value === true || value === false) return value;
  throw appError_('BAD_REQUEST', label + ' の指定が不正です。');
}

function requireRev_(value) {
  if (typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0) return value;
  throw appError_('BAD_REQUEST', '更新対象の版番号（rev）がありません。画面を再読み込みしてください。');
}

/** 履歴に残す JSON。セルの文字数上限を超えないよう切り詰める。 */
function historyJson_(value) {
  if (value === undefined || value === null) return '';
  var text = JSON.stringify(value);
  if (text.length > ADMIN_CONFIG.HISTORY_CELL_LIMIT) {
    text = text.slice(0, ADMIN_CONFIG.HISTORY_CELL_LIMIT) + '…(truncated)';
  }
  return text;
}

function md5Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function groupLabel_(index) {
  var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return 'グループ' + (index < letters.length ? letters.charAt(index) : String(index + 1));
}

function byOrder_(a, b) {
  return (a.order || 0) - (b.order || 0);
}

// ---- 02_auth.js ----
/* 認証と認可（すべてサーバー側で判定する）
 *
 * - 主催者: Google アカウントでログインする。運営画面（GitHub Pages）が Google Identity Services で受け取った
 *   ID トークンを送り、ここで Google の tokeninfo に問い合わせて確かめる（宛先 aud = スクリプト プロパティ
 *   GOOGLE_CLIENT_ID・発行元・有効期限・メール確認済み）。大会を作った Google アカウント（owner_email）だけが、
 *   その大会を運営できる。誰でも大会を作れる（上限あり）
 * - 店舗スタッフ: 主催者が大会ごとに設定した「管理パスワード」でその大会だけを運営できる。
 *   シートには乱数のソルト付き SHA-256 だけを保存する。間違いが続いたら一定時間止める
 * - ログインに成功したら推測できない長さのセッション（244 ビット相当の乱数）を発行し、以後はそれで呼ぶ。
 *   セッションはサーバーのキャッシュ（CacheService）にだけ置き、6 時間で切れる。管理パスワードを変えると、
 *   そのパスワードで作ったセッションは使えなくなる
 * - プラットフォーム管理者は、スクリプト プロパティ ADMIN_KEY（利用者が設定する長い文字列）を知っている人。
 *   保存先の設定・初期化・閲覧者用 URL・既定表示の大会、全大会の管理と主催者の付け替えができる
 *
 * この Web アプリは「実行: 自分 / アクセス: 全員」で公開するため、呼び出し元は一切信用しない。
 */

var MIN_SECRET_LENGTH_ = 24;
var SESSION_PATTERN_ = /^[a-f0-9]{64}$/;
var SESSION_TTL_SEC_ = 6 * 3600;
var ID_TOKEN_PATTERN_ = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
var ID_TOKEN_MAX_LENGTH_ = 4096;
var GOOGLE_ISSUERS_ = ['accounts.google.com', 'https://accounts.google.com'];
var EMAIL_PATTERN_ = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var STAFF_PASSWORD_MIN_ = 8;
var STAFF_PASSWORD_MAX_ = 64;
var STAFF_FAIL_LIMIT_ = 10;
var STAFF_FAIL_WINDOW_SEC_ = 600;

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** 長さと内容が同じかを、途中で打ち切らずに比べる */
function safeEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 推測できない乱数（16 進 64 文字。UUID v4 2 つ分 = 244 ビット） */
function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

function readSecretProperty_(name) {
  var v = (PropertiesService.getScriptProperties().getProperty(name) || '').trim();
  return v.length >= MIN_SECRET_LENGTH_ ? v : '';
}

function googleClientId_() {
  return (PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID') || '').trim();
}

function normalizeEmail_(value) {
  var v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v.length <= 254 && EMAIL_PATTERN_.test(v) ? v : '';
}

/* ---------- Google ログイン ---------- */

/**
 * Google の ID トークンを確かめ、ログインした人のメールアドレス（小文字）を返す。
 * 署名の検証は Google の tokeninfo エンドポイントに任せる（Apps Script では Google の検証ライブラリを使えないため）。
 */
function verifyGoogleIdToken_(token) {
  var clientId = googleClientId_();
  if (!clientId) {
    throw appError_('AUTH_NOT_CONFIGURED', 'Google ログインが未設定です（スクリプト プロパティ GOOGLE_CLIENT_ID に OAuth クライアント ID を設定してください）。');
  }
  if (typeof token !== 'string' || token.length > ID_TOKEN_MAX_LENGTH_ || !ID_TOKEN_PATTERN_.test(token)) {
    throw appError_('AUTH_INVALID', 'Google のログイン情報が正しくありません。もう一度ログインしてください。');
  }
  var res;
  try {
    res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: false,
    });
  } catch (e) {
    console.error('tokeninfo fetch failed', e && e.message);
    throw appError_('UNAVAILABLE', 'Google に接続できませんでした。時間をおいてもう一度お試しください。');
  }
  var claims = null;
  if (res.getResponseCode() === 200) {
    try {
      claims = JSON.parse(res.getContentText());
    } catch (e) {
      claims = null;
    }
  }
  var nowSec = Math.floor(Date.now() / 1000);
  var ok =
    claims &&
    claims.aud === clientId &&
    GOOGLE_ISSUERS_.indexOf(claims.iss) >= 0 &&
    Number(claims.exp) > nowSec &&
    (claims.email_verified === true || claims.email_verified === 'true');
  var email = ok ? normalizeEmail_(claims.email) : '';
  if (!email) {
    throw appError_('AUTH_INVALID', 'Google のログイン情報を確認できませんでした。もう一度ログインしてください。');
  }
  return email;
}

/* ---------- セッション ---------- */

function sessionCacheKey_(session) {
  return 'sess:' + sha256Hex_('n02-tournament-session:' + session);
}

/** data = { kind: 'google', email } | { kind: 'staff', eventId, passStamp } */
function issueSession_(data) {
  var session = newSecret_();
  var expiresAt = new Date(Date.now() + SESSION_TTL_SEC_ * 1000).toISOString();
  var stored = Object.assign({}, data, { expiresAt: expiresAt });
  CacheService.getScriptCache().put(sessionCacheKey_(session), JSON.stringify(stored), SESSION_TTL_SEC_);
  return { session: session, expiresAt: expiresAt };
}

function readSession_(session) {
  if (typeof session !== 'string' || !SESSION_PATTERN_.test(session)) return null;
  var raw = CacheService.getScriptCache().get(sessionCacheKey_(session));
  if (!raw) return null;
  try {
    var data = JSON.parse(raw);
    return data && Date.parse(data.expiresAt) > Date.now() ? data : null;
  } catch (e) {
    return null;
  }
}

function endSession_(session) {
  if (typeof session === 'string' && SESSION_PATTERN_.test(session)) CacheService.getScriptCache().remove(sessionCacheKey_(session));
}

/* ---------- 管理パスワード（店舗スタッフ用） ---------- */

function staffPasswordHash_(eventId, salt, password) {
  return sha256Hex_('n02-tournament-staff:' + eventId + ':' + salt + ':' + password);
}

function validateStaffPassword_(password) {
  if (typeof password !== 'string' || password.length < STAFF_PASSWORD_MIN_ || password.length > STAFF_PASSWORD_MAX_ || /\s/.test(password)) {
    throw appError_('VALIDATION', '管理パスワードは空白を含まない ' + STAFF_PASSWORD_MIN_ + '〜' + STAFF_PASSWORD_MAX_ + ' 文字で設定してください。');
  }
  return password;
}

/** 今の管理パスワードの目印（設定のたびに変わるソルトから作る）。セッションに入れ、変更後の古いセッションを見分ける */
function staffPassStamp_(event) {
  return sha256Hex_('n02-tournament-stamp:' + event.staff_pass_salt).slice(0, 32);
}

function staffFailKey_(eventId) {
  return 'staff-fail:' + eventId;
}

/**
 * 管理パスワードを確かめる。同じ大会で間違いが続いたら、しばらく受け付けない（総当たり対策）。
 * 大会が存在するかどうかを推測されないよう、理由は区別しない。
 */
function verifyStaffPassword_(ctx, eventId, password) {
  if (!isValidId_(eventId) || typeof password !== 'string' || !password || password.length > STAFF_PASSWORD_MAX_) {
    throw appError_('AUTH_INVALID', '大会または管理パスワードが違います。');
  }
  // 回数の確認から書き戻しまでをロックの中で行う。並列に送られた間違いも 1 回ずつ数える
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_CONFIG.LOCK_WAIT_MS)) {
    throw appError_('BUSY', '他の処理が実行中です。数秒後にもう一度お試しください。');
  }
  try {
    var cache = CacheService.getScriptCache();
    var fails = Number(cache.get(staffFailKey_(eventId)) || 0);
    if (fails >= STAFF_FAIL_LIMIT_) {
      throw appError_('AUTH_LOCKED', '管理パスワードの間違いが続いたため、10 分間この大会はパスワードで開けません。時間をおいてお試しください。');
    }
    var events = ctx.table('Events');
    var event = events.byKey[eventId];
    var matched =
      event &&
      !events.duplicates[eventId] &&
      event.staff_pass_hash &&
      event.staff_pass_salt &&
      safeEqual_(staffPasswordHash_(eventId, event.staff_pass_salt, password), event.staff_pass_hash);
    if (!matched) {
      cache.put(staffFailKey_(eventId), String(fails + 1), STAFF_FAIL_WINDOW_SEC_);
      throw appError_('AUTH_INVALID', '大会または管理パスワードが違います。');
    }
    return event;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 利用者の判定 ---------- */

/**
 * リクエストの auth から利用者を決める。
 * auth = { adminKey } | { session } | なし
 * 戻り値 = { kind: 'admin' | 'google' | 'staff' | 'anonymous', isPlatformAdmin, email, eventId, label }
 */
function authenticate_(ctxProvider, auth) {
  var a = auth && typeof auth === 'object' && !Array.isArray(auth) ? auth : {};
  if (a.adminKey !== undefined) {
    var adminKey = readSecretProperty_('ADMIN_KEY');
    if (!adminKey) throw appError_('AUTH_NOT_CONFIGURED', '管理者の鍵が未設定です（スクリプト プロパティ ADMIN_KEY に 24 文字以上の文字列を設定してください）。');
    if (typeof a.adminKey !== 'string' || !safeEqual_(sha256Hex_(a.adminKey), sha256Hex_(adminKey))) {
      throw appError_('AUTH_INVALID', '管理者の鍵が違います。');
    }
    return { kind: 'admin', isPlatformAdmin: true, email: '', eventId: '', label: 'admin' };
  }
  if (a.session !== undefined) {
    var data = readSession_(a.session);
    if (data && data.kind === 'google' && normalizeEmail_(data.email)) {
      return { kind: 'google', isPlatformAdmin: false, email: data.email, eventId: '', label: 'google:' + data.email };
    }
    if (data && data.kind === 'staff' && isValidId_(data.eventId)) {
      // 管理パスワードが変わった・消された後は、古いパスワードで作ったセッションを使えなくする
      var event = ctxProvider().table('Events').byKey[data.eventId];
      if (event && event.staff_pass_hash && safeEqual_(staffPassStamp_(event), data.passStamp)) {
        return { kind: 'staff', isPlatformAdmin: false, email: '', eventId: data.eventId, label: 'staff:' + data.eventId };
      }
    }
    throw appError_('AUTH_EXPIRED', 'ログインの有効期限が切れたか、管理パスワードが変更されました。もう一度ログインしてください。');
  }
  return { kind: 'anonymous', isPlatformAdmin: false, email: '', eventId: '', label: 'anonymous' };
}

function assertPlatformAdmin_(user) {
  if (!user || !user.isPlatformAdmin) throw appError_('FORBIDDEN', 'この操作は管理者だけが行えます。');
}

/** 大会の作成は、Google でログインした人（と管理者）だけ */
function assertCanCreate_(user) {
  if (user.isPlatformAdmin || user.kind === 'google') return;
  throw appError_('AUTH_REQUIRED', '大会を作るには、Google でログインしてください。');
}

/**
 * 大会ごとの共同主催者（v0.8）のメールアドレス。ctx ごとに 1 回だけ作る。
 * 毎回シートから読むので、解除するとその人の古いセッションでもすぐに操作できなくなる。
 */
function collaboratorIndex_(ctx) {
  if (!ctx) return {};
  if (ctx._collab) return ctx._collab;
  var index = {};
  ctx.table('Collaborators').rows.forEach(function (r) {
    var email = normalizeEmail_(r.email);
    if (!email || !isValidId_(r.event_id)) return;
    if (!index[r.event_id]) index[r.event_id] = [];
    if (index[r.event_id].indexOf(email) === -1) index[r.event_id].push(email);
  });
  ctx._collab = index;
  return index;
}

/**
 * その大会での役割。admin = 管理者 / owner = 作った本人 / editor = 共同主催者 / staff = 管理パスワード / '' = 権限なし
 */
function eventRole_(user, event, ctx) {
  if (!user || !event) return '';
  if (user.isPlatformAdmin) return 'admin';
  if (user.kind === 'google') {
    if (event.owner_email && event.owner_email === user.email) return 'owner';
    var list = collaboratorIndex_(ctx)[event.event_id] || [];
    return list.indexOf(user.email) !== -1 ? 'editor' : '';
  }
  if (user.kind === 'staff') return user.eventId === event.event_id ? 'staff' : '';
  return '';
}

/** その大会を運営できるか（管理者・作った本人・共同主催者・その大会の管理パスワードでログインした人） */
function canManageEvent_(user, event, ctx) {
  return eventRole_(user, event, ctx) !== '';
}

/** 大会の削除・管理パスワード・共同主催者の管理は、作った本人と管理者だけ */
function assertOwnerRole_(ctx, eventId, what) {
  var event = ctx.table('Events').byKey[eventId];
  var role = eventRole_(ctx.user, event, ctx);
  if (role !== 'owner' && role !== 'admin') throw appError_('FORBIDDEN', what + 'は、大会を作った本人（Google ログイン）か管理者だけが行えます。');
}

/**
 * 操作対象の大会を、payload の eventId / matchId / playerId / groupId から特定し、
 * 呼び出し元がその大会を管理できることを確かめる。特定できた event_id を返す。
 */
function authorizeEventPayload_(ctx, payload) {
  var eventId = '';
  if (payload.eventId !== undefined) {
    eventId = requireId_(payload.eventId, '大会');
  } else if (payload.matchId !== undefined) {
    eventId = findRecord_(ctx.table('Matches'), requireId_(payload.matchId, '試合'), '試合').event_id;
  } else if (payload.playerId !== undefined) {
    eventId = findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手').event_id;
  } else if (payload.groupId !== undefined) {
    eventId = findRecord_(ctx.table('Groups'), requireId_(payload.groupId, 'グループ'), 'グループ').event_id;
  } else if (payload.stageId !== undefined) {
    eventId = findRecord_(ctx.table('Stages'), requireId_(payload.stageId, '段階'), '段階').event_id;
  } else {
    throw appError_('BAD_REQUEST', '操作対象の大会が指定されていません。');
  }
  var user = ctx.user;
  var events = ctx.table('Events');
  if (!canManageEvent_(user, events.duplicates[eventId] ? null : events.byKey[eventId], ctx)) {
    // 他の大会の存在を知らせないよう「見つからない」と同じ扱いにする
    throw appError_('NOT_FOUND', '大会が見つからないか、この大会を管理する権限がありません。');
  }
  findRecord_(events, eventId, '大会');
  // eventId と一緒に送られた段階・グループ・試合・選手が、その大会のものであることも確かめる
  var checks = [['stageId', 'Stages', '段階'], ['groupId', 'Groups', 'グループ'], ['matchId', 'Matches', '試合'], ['playerId', 'Players', '選手']];
  checks.forEach(function (c) {
    var v = payload[c[0]];
    if (v === undefined || v === '' || v === null) return;
    var rec = ctx.table(c[1]).byKey[requireId_(v, c[2])];
    if (!rec || rec.event_id !== eventId) throw appError_('NOT_FOUND', c[2] + 'が見つかりません。');
  });
  if (Array.isArray(payload.playerIds)) {
    payload.playerIds.forEach(function (pid) {
      var p = isValidId_(pid) ? ctx.table('Players').byKey[pid] : null;
      if (!p || p.event_id !== eventId) throw appError_('NOT_FOUND', '選手が見つかりません。');
    });
  }
  return eventId;
}

// ---- 03_storage.js ----
/* スプレッドシート（データ保存専用）の読み書き */

var SPREADSHEET_ID_PATTERN_ = /^[A-Za-z0-9_-]{25,100}$/;

function getSpreadsheetId_() {
  return (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
}

function openStorage_() {
  var id = getSpreadsheetId_();
  if (!id) {
    throw appError_('NOT_CONFIGURED', 'データ保存先のスプレッドシートが未設定です。');
  }
  if (!SPREADSHEET_ID_PATTERN_.test(id)) {
    throw appError_('NOT_CONFIGURED', 'スクリプト プロパティ SPREADSHEET_ID の形式が不正です。');
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    console.error('openById failed', e && e.message);
    throw appError_('STORAGE_UNAVAILABLE', 'データ保存先のスプレッドシートを開けませんでした。ID と権限を確認してください。' + googleReason_(e));
  }
}

/** 運営画面（本人のみ）に出す、Google 側のエラー文。閲覧者用には使わない */
function googleReason_(e) {
  var msg = e && e.message ? String(e.message).slice(0, 300) : '';
  return msg ? '（Google からのエラー: ' + msg + '）' : '';
}

function headerOf_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1 || sheet.getLastRow() < 1) return [];
  var header = sheet
    .getRange(1, 1, 1, lastCol)
    .getValues()[0]
    .map(function (h) {
      return String(h).trim();
    });
  while (header.length && !header[header.length - 1]) header.pop();
  return header;
}

/** 列の定義のうち、その版のスキーマで追加された列か（移行前のシートにはない） */
function columnSince_(col) {
  return col[2] || 1;
}

/** 移行前でも読めるよう、表の定義のうち since が新しいシート・列は無くてもよい */
function isOptionalColumn_(col) {
  return columnSince_(col) > 1;
}

/**
 * シートを読み、列定義に従って型をそろえたレコードの配列にする。
 * 見出しで列を引くので、列の順番が変わっても動く。主キーが空の行は無視する。
 *
 * v0.8: 読んだ表はメモリ上で変更し（appendRecords_ / updateRecord_ / deleteRecords_）、操作の最後に
 * commitContext_ でまとめて書き込む。途中で検証に失敗した操作は何も書き込まない。
 */
function readTable_(ss, name) {
  var def = SCHEMA[name];
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    if ((def.since || 1) > 1) return emptyTable_(name, null);
    throw appError_('NOT_INITIALIZED', 'シート「' + name + '」がありません。初期化を実行してください。');
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    throw appError_('NOT_INITIALIZED', 'シート「' + name + '」に見出しがありません。初期化を実行してください。');
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });
  var index = {};
  headers.forEach(function (h, i) {
    if (h && index[h] === undefined) index[h] = i;
  });
  var missing = [];
  def.columns.forEach(function (c) {
    if (index[c[0]] !== undefined) return;
    if (isOptionalColumn_(c)) missing.push(c[0]);
    else throw appError_('NOT_INITIALIZED', 'シート「' + name + '」に列「' + c[0] + '」がありません。初期化を実行してください。');
  });

  var table = emptyTable_(name, sheet);
  table.headers = headers;
  table.index = index;
  table.width = lastCol;
  table.lastRow = lastRow;
  table.missing = missing;
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    var key = coerceCell_(raw[index[def.key]], 'text').trim();
    if (!key) continue;
    var rec = { _row: r + 1, _raw: raw };
    def.columns.forEach(function (c) {
      rec[c[0]] = coerceCell_(index[c[0]] === undefined ? '' : raw[index[c[0]]], c[1]);
    });
    rec[def.key] = key;
    table.rows.push(rec);
  }
  reindexTable_(table);
  return table;
}

function emptyTable_(name, sheet) {
  return {
    name: name,
    def: SCHEMA[name],
    sheet: sheet,
    headers: [],
    index: {},
    width: 0,
    lastRow: 1,
    missing: [],
    rows: [],
    byKey: {},
    duplicates: {},
    // 書き込み待ち
    added: [],
    deleted: [],
    changed: false,
  };
}

/** 主キーの索引を作り直す（行の追加・削除の後） */
function reindexTable_(table) {
  var key = table.def.key;
  table.byKey = {};
  table.duplicates = {};
  table.rows.forEach(function (rec) {
    if (table.byKey[rec[key]]) table.duplicates[rec[key]] = true;
    else table.byKey[rec[key]] = rec;
  });
}

/** 主キーで 1 件取り出す。重複している ID は壊れたデータとして扱い、書き込ませない。 */
function findRecord_(table, id, label) {
  var rec = table.byKey[id];
  if (!rec) throw appError_('NOT_FOUND', label + ' が見つかりません。画面を再読み込みしてください。');
  if (table.duplicates[id]) {
    throw appError_('DATA_CONFLICT', label + ' の ID がシート内で重複しています。管理者に連絡してください。');
  }
  return rec;
}

/** 楽観ロック: 画面が読み込んだ版と現在の版が違えば、他で更新されたとみなして拒否する。 */
function assertRev_(rec, expectedRev, label) {
  if ((rec.rev || 0) !== expectedRev) {
    throw appError_('CONFLICT', label + ' は別の画面で更新されています。最新の内容を読み込み直しました。もう一度操作してください。');
  }
}

function rowValues_(table, rec, base) {
  var out = base ? base.slice(0, table.width) : [];
  while (out.length < table.width) out.push('');
  table.def.columns.forEach(function (c) {
    if (table.index[c[0]] === undefined) return;
    if (Object.prototype.hasOwnProperty.call(rec, c[0])) {
      out[table.index[c[0]]] = toCell_(rec[c[0]], c[1]);
    }
  });
  return out;
}

/** 既存行の変更を書き込み待ちにする（定義外の列は読み込んだ値のまま残す）。 */
function updateRecord_(table, rec) {
  if (rec._new) return; // まだ書いていない行は、追加のときに今の値で書く
  if (!rec._row) throw appError_('INTERNAL', '更新対象の行が不明です。');
  rec._dirty = true;
  table.changed = true;
}

function appendRecords_(table, records) {
  if (!records.length) return;
  records.forEach(function (rec) {
    rec._new = true;
    table.rows.push(rec);
    table.added.push(rec);
  });
  table.changed = true;
  reindexTable_(table);
}

/** 行を削除待ちにする（書き込みは commitContext_）。 */
function deleteRecords_(table, records) {
  if (!records.length) return;
  var gone = [];
  records.forEach(function (rec) {
    if (!rec || rec._deleted) return;
    rec._deleted = true;
    gone.push(rec);
    if (rec._new) {
      table.added = table.added.filter(function (x) {
        return x !== rec;
      });
    } else {
      table.deleted.push(rec);
    }
  });
  if (!gone.length) return;
  table.rows = table.rows.filter(function (rec) {
    return !rec._deleted;
  });
  table.changed = true;
  reindexTable_(table);
}

/* ---------- 書き込み（まとめて） ---------- */

function writeUpdates_(table) {
  var dirty = table.rows
    .filter(function (rec) {
      return rec._dirty && rec._row && !rec._deleted;
    })
    .sort(function (a, b) {
      return a._row - b._row;
    });
  var i = 0;
  while (i < dirty.length) {
    var block = [dirty[i]];
    while (i + 1 < dirty.length && dirty[i + 1]._row === block[block.length - 1]._row + 1) {
      i++;
      block.push(dirty[i]);
    }
    table.sheet.getRange(block[0]._row, 1, block.length, table.width).setValues(
      block.map(function (rec) {
        return rowValues_(table, rec, rec._raw);
      })
    );
    i++;
  }
}

/**
 * 行を消す。行番号の大きい順に、連続した行はまとめて消す（先に上を消すと下の行番号がずれるため）。
 * 見出し以外の行をすべて消すとスプレッドシートがエラーにするので、その場合は先に空の行を 1 行足しておく。
 */
function writeDeletes_(table) {
  var rows = table.deleted
    .map(function (r) {
      return r._row;
    })
    .sort(function (a, b) {
      return b - a;
    });
  if (!rows.length) return;
  var sheet = table.sheet;
  if (rows.length >= sheet.getMaxRows() - 1) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  var i = 0;
  while (i < rows.length) {
    var end = rows[i];
    var start = end;
    while (i + 1 < rows.length && rows[i + 1] === start - 1) {
      i++;
      start = rows[i];
    }
    sheet.deleteRows(start, end - start + 1);
    i++;
  }
}

function writeAppends_(table) {
  var records = table.added;
  if (!records.length) return;
  var sheet = table.sheet;
  var start = sheet.getLastRow() + 1;
  var needed = start + records.length - 1 - sheet.getMaxRows();
  if (needed > 0) {
    var firstNew = sheet.getMaxRows() + 1;
    sheet.insertRowsAfter(sheet.getMaxRows(), needed);
    applyTextFormats_(sheet, table.def, table.index, firstNew, needed);
  }
  var values = records.map(function (rec) {
    return rowValues_(table, rec, null);
  });
  sheet.getRange(start, 1, values.length, table.width).setValues(values);
}

/**
 * 書き込み待ちの変更をシートへ書く。順番は、途中で止まっても後からやり直しやすいように
 * 公開データの削除 → 大会に属する行 → 大会の行 → 履歴 → 公開データの更新。
 * 各表の中では 更新 → 削除 → 追加（更新は読み込んだときの行番号で書くため、削除より先）。
 */
var COMMIT_ORDER_ = ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'Collaborators', 'Events', 'History'];

function commitContext_(ctx) {
  var tables = ctx.loadedTables();
  var pending = Object.keys(tables).filter(function (n) {
    return tables[n].changed;
  });
  if (!pending.length) return { tables: [] };
  pending.forEach(function (n) {
    if (!tables[n].sheet) throw appError_('MIGRATION_REQUIRED', 'データの保存先の更新（移行）が終わっていません。管理者に連絡してください。');
    if (tables[n].missing.length) throw appError_('MIGRATION_REQUIRED', 'データの保存先の更新（移行）が終わっていません。管理者に連絡してください。');
  });
  var snap = tables.PublicSnapshots;
  var snapOnlyDeletes = snap && snap.changed && !snap.added.length && !snap.rows.some(function (r) {
    return r._dirty;
  });
  var order = (snapOnlyDeletes ? ['PublicSnapshots'] : []).concat(COMMIT_ORDER_).concat(snap && snap.changed && !snapOnlyDeletes ? ['PublicSnapshots'] : []);
  pending.forEach(function (n) {
    if (order.indexOf(n) === -1) order.push(n);
  });
  var done = [];
  order.forEach(function (n) {
    var table = tables[n];
    if (!table || !table.changed) return;
    writeUpdates_(table);
    writeDeletes_(table);
    writeAppends_(table);
    table.changed = false;
    done.push(n);
  });
  return { tables: done };
}

function applyTextFormats_(sheet, def, index, fromRow, count) {
  if (count < 1) return;
  def.columns.forEach(function (c) {
    if (c[1] === 'text' && index[c[0]] !== undefined) {
      sheet.getRange(fromRow, index[c[0]] + 1, count, 1).setNumberFormat('@');
    }
  });
}

/**
 * 保存先の初期化。何度実行しても既存データは消さない。
 * - 足りないシートを作る / 足りない列を末尾に足す（既存列の並べ替え・削除はしない）
 * - まだ初期化されていないスプレッドシートに管理対象外のデータがあれば中止する
 *   （既存の大会ファイルなどを誤って指定した場合に書き込まないため）
 */
function initializeStorage_(ss, options) {
  var sheets = ss.getSheets();
  var byName = {};
  sheets.forEach(function (s) {
    byName[s.getName()] = s;
  });

  var problems = [];
  var alreadyInitialized = !!byName.Events && headerOf_(byName.Events).indexOf('event_id') !== -1;
  if (!alreadyInitialized) {
    sheets.forEach(function (s) {
      if (SCHEMA[s.getName()] || s.getName().indexOf(BACKUP_PREFIX_) === 0) return;
      if (s.getLastRow() > 0 || s.getLastColumn() > 0) {
        problems.push('管理対象外のシート「' + s.getName() + '」にデータがあります');
      }
    });
  }
  SHEET_ORDER.forEach(function (name) {
    var s = byName[name];
    if (!s) return;
    var header = headerOf_(s);
    if (header.length && header.indexOf(SCHEMA[name].key) === -1) {
      problems.push('シート「' + name + '」の見出しにこのアプリの列がありません');
    }
  });
  if (problems.length) {
    throw appError_(
      'UNSAFE_TARGET',
      '既存データを保護するため初期化を中止しました（' + problems.join(' / ') + '）。PoC 専用の空のスプレッドシートを指定してください。'
    );
  }

  var created = [];
  var extended = [];
  SHEET_ORDER.forEach(function (name, i) {
    var def = SCHEMA[name];
    var sheet = byName[name];
    if (!sheet) {
      sheet = ss.insertSheet(name, Math.min(i, ss.getSheets().length));
      created.push(name);
    }
    var header = headerOf_(sheet);
    var missing = def.columns
      .map(function (c) {
        return c[0];
      })
      .filter(function (col) {
        return header.indexOf(col) === -1;
      });
    if (missing.length) {
      var startCol = header.length + 1;
      var needCols = startCol + missing.length - 1 - sheet.getMaxColumns();
      if (needCols > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols);
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      if (header.length) extended.push(name + ': ' + missing.join(', '));
      header = header.concat(missing);
    }
    var index = {};
    header.forEach(function (h, idx) {
      if (index[h] === undefined) index[h] = idx;
    });
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    if (sheet.getMaxRows() > 1) applyTextFormats_(sheet, def, index, 2, sheet.getMaxRows() - 1);
  });

  // 空の保存先を初めて初期化したときは、データの移し替えが要らないので最新の版にする。
  // 既存のデータがある保存先の版は migrateStorage_ が（バックアップと件数の確認の後に）上げる
  if (!(options && options.keepVersion) && !alreadyInitialized) {
    PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(ADMIN_CONFIG.SCHEMA_VERSION));
  }
  return { created: created, extended: extended };
}

/** 画面の「セットアップ」表示用。書き込みはしない。 */
function getStorageStatus_() {
  var status = {
    configured: false,
    accessible: false,
    initialized: false,
    migrationRequired: false,
    schemaVersion: storedSchemaVersion_(),
    appSchemaVersion: ADMIN_CONFIG.SCHEMA_VERSION,
    spreadsheetId: '',
    spreadsheetName: '',
    missing: [],
    message: '',
  };
  var id = getSpreadsheetId_();
  if (!id) {
    status.message = 'データ保存先のスプレッドシートが未設定です。';
    return status;
  }
  status.configured = true;
  status.spreadsheetId = id;
  var ss;
  try {
    ss = openStorage_();
  } catch (e) {
    status.message = e.publicMessage || 'スプレッドシートを開けませんでした。';
    return status;
  }
  status.accessible = true;
  status.spreadsheetName = ss.getName();
  var required = [];
  SHEET_ORDER.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    var def = SCHEMA[name];
    if (!sheet) {
      status.missing.push(name);
      if ((def.since || 1) <= 1) required.push(name);
      return;
    }
    var header = headerOf_(sheet);
    var lacking = def.columns.filter(function (c) {
      return header.indexOf(c[0]) === -1;
    });
    if (lacking.length) status.missing.push(name + '（列不足）');
    if (lacking.some(function (c) { return !isOptionalColumn_(c); })) required.push(name);
  });
  // v0.7 までの列がそろっていれば、移行前でも画面は開ける（書き込みだけを移行まで止める）
  status.initialized = required.length === 0;
  status.migrationRequired = status.initialized && (status.missing.length > 0 || status.schemaVersion < ADMIN_CONFIG.SCHEMA_VERSION);
  status.message = !status.initialized ? '初期化が必要です。' : status.migrationRequired ? '保存先の更新（移行）が必要です。' : '';
  return status;
}

function storedSchemaVersion_() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('SCHEMA_VERSION') || 0);
  return isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** 書き込みの前に、保存先がこの版のスキーマに移行済みかを確かめる */
function assertSchemaCurrent_() {
  if (storedSchemaVersion_() < ADMIN_CONFIG.SCHEMA_VERSION) {
    throw appError_('MIGRATION_REQUIRED', '新しい版に合わせた保存先の更新（移行）が終わるまで、変更は保存できません。しばらくしてからもう一度お試しください（閲覧はできます）。');
  }
}

/* ---------- 移行（スキーマの版を上げる） ---------- */

var BACKUP_PREFIX_ = 'bak-';

/**
 * 保存先を ADMIN_CONFIG.SCHEMA_VERSION に移行する。管理者の鍵でだけ呼べる（migrateStorage 操作）。
 * 1. 移行前の件数を数える  2. 各シートを同じスプレッドシート内に複製してバックアップ
 * 3. 足りないシート・列を追加（initializeStorage_ と同じ。既存の列・値は動かさない）
 * 4. 件数が変わっていないことを確かめてから SCHEMA_VERSION を上げる
 * 何度呼んでも安全（移行済みなら何もしない）。途中で失敗しても、既存の列・値は変わっていない。
 * 公開閲覧（閲覧者用 Web アプリ）からは呼ばれない。
 */
function migrateStorage_(ss, actor) {
  var props = PropertiesService.getScriptProperties();
  var from = storedSchemaVersion_();
  var to = ADMIN_CONFIG.SCHEMA_VERSION;
  var status = getStorageStatus_();
  if (!status.initialized) throw appError_('NOT_INITIALIZED', '保存先が初期化されていません。先に「初期化する」を実行してください。');
  if (from >= to && !status.migrationRequired) return { from: from, to: to, migrated: false, message: '移行済みです。' };

  var counts = {};
  SHEET_ORDER.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    counts[name] = sheet ? readTable_(ss, name).rows.length : 0;
  });
  var stamp = nowIso_().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  var state = { from: from, to: to, status: 'running', startedAt: nowIso_(), backups: [], counts: counts, by: actor };
  props.setProperty('MIGRATION_STATE', JSON.stringify(state));
  SHEET_ORDER.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) return;
    var copy = sheet.copyTo(ss);
    var backupName = BACKUP_PREFIX_ + 's' + from + '-' + stamp + '-' + name;
    copy.setName(backupName);
    state.backups.push(backupName);
  });
  props.setProperty('MIGRATION_STATE', JSON.stringify(state));
  var init = initializeStorage_(ss, { keepVersion: true });
  var after = {};
  var mismatch = [];
  SHEET_ORDER.forEach(function (name) {
    after[name] = readTable_(ss, name).rows.length;
    if (after[name] !== counts[name]) mismatch.push(name + ' ' + counts[name] + '→' + after[name]);
  });
  if (mismatch.length) {
    state.status = 'failed';
    state.problem = mismatch.join(', ');
    props.setProperty('MIGRATION_STATE', JSON.stringify(state));
    throw appError_('MIGRATION_FAILED', '移行後の件数が一致しません（' + state.problem + '）。バックアップ（' + state.backups.join('、') + '）から確認してください。');
  }
  props.setProperty('SCHEMA_VERSION', String(to));
  state.status = 'done';
  state.finishedAt = nowIso_();
  state.added = init;
  props.setProperty('MIGRATION_STATE', JSON.stringify(state));
  return { from: from, to: to, migrated: true, backups: state.backups, added: init, counts: after };
}

function migrationState_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('MIGRATION_STATE') || 'null');
  } catch (e) {
    return null;
  }
}

/**
 * 1 リクエスト内でテーブルの読み込みを使い回す入れ物。
 * v0.8: 変更はメモリ上の表に入り、commitContext_ でまとめて書く。invalidate は互換のために残しているが、
 * 表はいつも書き込み待ちの変更を含めた最新の内容なので、読み直しはしない。
 */
function createContext_(ss, actor, user) {
  var cache = {};
  return {
    ss: ss,
    actor: actor,
    user: user || null,
    now: nowIso_(),
    history: [],
    table: function (name) {
      if (!cache[name]) cache[name] = readTable_(ss, name);
      return cache[name];
    },
    invalidate: function () {},
    loadedTables: function () {
      return cache;
    },
  };
}

function recordHistory_(ctx, action, entity, entityId, eventId, before, after) {
  ctx.history.push({
    history_id: null,
    at: ctx.now,
    actor: ctx.actor,
    action: action,
    entity: entity,
    entity_id: entityId || '',
    event_id: eventId || '',
    before_json: historyJson_(before),
    after_json: historyJson_(after),
  });
}

function flushHistory_(ctx) {
  if (!ctx.history.length) return;
  var table = ctx.table('History');
  var taken = {};
  ctx.history.forEach(function (h) {
    h.history_id = newId_('HIS', taken);
    taken[h.history_id] = true;
  });
  appendRecords_(table, ctx.history);
  ctx.history = [];
}

/** 記録から画面・履歴に出す値だけを取り出す（_row などの内部情報を除く） */
function plain_(rec) {
  if (!rec) return null;
  var out = {};
  Object.keys(rec).forEach(function (k) {
    if (k.charAt(0) !== '_') out[k] = rec[k];
  });
  return out;
}

// ---- 04_domain.js ----
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

// ---- 04b_bracket.js ----
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

// ---- 04c_swiss.js ----
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
      // 調べた候補の数（再戦で飛ばした候補も数える）が予算を超えたら打ち切る
      if (++steps > budget) {
        var err = new Error('TIMEOUT');
        err.swissTimeout = true;
        throw err;
      }
      if (!allowRematch && a.opponents[b.id]) continue;
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

// ---- 04e_view.js ----
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
  if (result.draw && isBracketStage_(stage)) problems.push('勝ち抜き戦では引き分けを確定できません');
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

// ---- 04f_draw.js ----
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

// ---- 05_publish.js ----
/* 閲覧者向け公開データ（PublicSnapshots シート）の生成 */

var SNAPSHOT_CHUNK_PREFIX_ = '~'; // 分割した JSON の先頭が = や + になっても数式扱いされないための接頭辞

function chunkColumns_() {
  var cols = [];
  for (var i = 1; i <= ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS; i++) cols.push('chunk_' + (i < 10 ? '0' : '') + i);
  return cols;
}

/** 閲覧画面に出す内容だけで組み立てた公開データ（選手メモ・履歴・rev などは含まない） */
function buildPublicSnapshot_(bundle) {
  var view = buildEventView_(bundle, false);
  view.schema = 1;
  return view;
}

/**
 * 大会の公開状態をシートへ反映する。書き込み系の操作の最後に必ず呼ぶ。
 * - 公開中: 公開データを作り直して保存（内容が同じなら書き込まない）
 * - 非公開: 公開データの行を削除する（閲覧画面から消える）
 * v0.8: 他の変更と同じく書き込み待ちにするだけで、シートへは commitContext_ が書く。
 * 公開データが上限を超えるときは、その操作ごと保存しない（TOO_LARGE）。
 */
function syncPublication_(ctx, eventId) {
  ctx.invalidate();
  var bundle = collectEvent_(ctx, eventId);
  var table = ctx.table('PublicSnapshots');
  var rows = table.rows.filter(function (r) {
    return r.event_id === eventId;
  });

  if (!bundle.event.is_public) {
    if (rows.length) {
      deleteRecords_(table, rows);
      ctx.invalidate('PublicSnapshots');
    }
    return { published: false };
  }

  var json = JSON.stringify(buildPublicSnapshot_(bundle));
  assertSnapshotSize_(json);
  var version = md5Hex_(json);
  var existing = rows[0] || null;
  if (rows.length > 1) {
    // 手作業などで重複した行は 1 行にまとめる
    deleteRecords_(table, rows.slice(1));
    ctx.invalidate('PublicSnapshots');
    table = ctx.table('PublicSnapshots');
    existing = table.byKey[eventId] || null;
  }
  if (existing && existing.version === version && existing.is_default === bundle.event.is_featured) {
    return { published: true, version: version, publishedAt: existing.published_at, unchanged: true };
  }

  var size = ADMIN_CONFIG.SNAPSHOT_CHUNK_SIZE;
  var chunks = [];
  for (var i = 0; i < json.length; i += size) chunks.push(SNAPSHOT_CHUNK_PREFIX_ + json.slice(i, i + size));
  if (chunks.length > ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS) assertSnapshotSize_(json, true);
  var rec = {
    event_id: eventId,
    is_default: bundle.event.is_featured,
    version: version,
    published_at: ctx.now,
    chunk_count: chunks.length,
  };
  chunkColumns_().forEach(function (col, idx) {
    rec[col] = chunks[idx] || '';
  });
  if (existing) {
    Object.keys(rec).forEach(function (k) {
      existing[k] = rec[k];
    });
    updateRecord_(table, existing);
  } else {
    appendRecords_(table, [rec]);
  }
  ctx.invalidate('PublicSnapshots');
  return { published: true, version: version, publishedAt: ctx.now, unchanged: false };
}

/** 公開データの大きさの確認。上限を超えるなら、その操作を保存しない */
function assertSnapshotSize_(json, force) {
  var limit = Math.min(ADMIN_CONFIG.MAX_SNAPSHOT_CHARS, ADMIN_CONFIG.SNAPSHOT_CHUNK_SIZE * ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS);
  if (force || json.length > limit) {
    throw appError_(
      'TOO_LARGE',
      '閲覧ページの公開データが上限を超えるため、この変更は保存していません（' + json.length + ' 文字 / 上限 ' + limit + ' 文字）。段階・グループを分けるか、大会を非公開にしてから操作してください。'
    );
  }
}

/** 公開データの大きさの目安（運営画面の表示用。公開していない大会でも、公開したときの大きさを返す） */
function snapshotBudget_(bundle) {
  var limit = Math.min(ADMIN_CONFIG.MAX_SNAPSHOT_CHARS, ADMIN_CONFIG.SNAPSHOT_CHUNK_SIZE * ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS);
  var size = JSON.stringify(buildPublicSnapshot_(bundle)).length;
  return { size: size, limit: limit, percent: Math.floor((size * 100) / limit) };
}

/** 公開状態の概要（運営画面の表示用） */
function publicationStatus_(ctx, eventId) {
  var row = ctx.table('PublicSnapshots').byKey[eventId];
  if (!row) return { published: false };
  return { published: true, version: row.version, publishedAt: row.published_at, isDefault: row.is_default };
}

// ---- 06_actions.js ----
/* 運営用 API の各操作。doPost から、認証・認可・ロック・二重送信チェックの後に呼ばれる。 */

var SAMPLE_GROUP_COUNT_ = 4;
var SAMPLE_PLAYER_COUNT_ = 16;
var MAX_BATCH_RESULTS_ = 64;

/* ---------- 読み取り ---------- */

/**
 * 画面の初期表示に必要な情報。誰が呼んだかで返す範囲を変える。
 * - 未認証: 保存先の準備ができているか・Google ログインの設定があるか・閲覧者用 URL だけ
 * - Google でログインした主催者: 自分が作った大会
 * - 管理パスワードでログインしたスタッフ: その大会 1 件
 * - 管理者: 保存先の詳細と全大会
 */
function actionBootstrap_(ctx) {
  var user = ctx.user;
  var storage = getStorageStatus_();
  var events = [];
  if (storage.initialized && user.kind !== 'anonymous') {
    var c = createContext_(openStorage_(), ctx.actor, user);
    var matches = c.table('Matches').rows;
    var players = c.table('Players').rows;
    events = c.table('Events').rows.filter(function (e) {
      return canManageEvent_(user, e, c);
    }).map(function (e) {
      var ms = matches.filter(function (m) {
        return m.event_id === e.event_id;
      });
      return {
        id: e.event_id,
        name: e.name,
        dateLabel: e.date_label,
        status: e.status,
        isPublic: e.is_public,
        isFeatured: e.is_featured,
        isSample: e.is_sample,
        playerCount: players.filter(function (p) {
          return p.event_id === e.event_id;
        }).length,
        matchCount: ms.length,
        finalCount: ms.filter(function (m) {
          return m.status === MATCH_STATUS.FINAL;
        }).length,
        updatedAt: e.updated_at,
        organizerName: user.isPlatformAdmin ? e.organizer_name : undefined,
        ownerEmail: user.isPlatformAdmin ? e.owner_email : undefined,
        staffPasswordSet: user.kind === 'staff' ? undefined : !!e.staff_pass_hash,
        role: eventRole_(user, e, c),
      };
    });
  }
  var props = PropertiesService.getScriptProperties();
  if (!user.isPlatformAdmin) {
    // 保存先の情報は管理者にだけ見せる
    storage = {
      configured: storage.configured,
      accessible: storage.accessible,
      initialized: storage.initialized,
      message: storage.initialized ? '' : '準備中です。管理者の設定が終わるまでお待ちください。',
    };
  }
  return {
    appVersion: ADMIN_CONFIG.APP_VERSION,
    role: { kind: user.kind, isPlatformAdmin: user.isPlatformAdmin, email: user.email, eventId: user.eventId },
    googleLoginReady: !!googleClientId_(),
    storage: storage,
    events: events,
    viewerUrl: props.getProperty('VIEWER_URL') || '',
  };
}

/**
 * ポータルの「作成した大会」: Google でログインした本人が作った大会だけを、公開・非公開・状態を問わず返す。
 * 絞り込みはサーバーのセッション（ログインで確かめたメールアドレス）と各大会の owner_email で行い、
 * 送られてきたメールアドレスや大会 ID は使わない。返すのは一覧の要約（公開データと同じ範囲）と公開状態だけ。
 */
function actionMyEvents_(ctx) {
  var user = ctx.user;
  var events = ctx.table('Events');
  var mine = events.rows
    .filter(function (e) {
      return !events.duplicates[e.event_id] && user.kind === 'google' && canManageEvent_(user, e, ctx);
    })
    .sort(function (a, b) {
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });
  var list = mine.slice(0, ADMIN_CONFIG.MAX_MY_EVENTS).map(function (e) {
    var s = summarizeEventView_(buildEventView_(collectEvent_(ctx, e.event_id), false), '');
    if (String(e.updated_at || '') > s.updatedAt) s.updatedAt = String(e.updated_at || '');
    s.isPublic = !!e.is_public;
    s.isSample = !!e.is_sample;
    s.role = eventRole_(user, e, ctx);
    return s;
  });
  return { email: user.email, events: list, truncated: mine.length > list.length };
}

function actionEventDetail_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  return eventDetail_(ctx, eventId);
}

/** 呼び出し元が最新の内容を読み込んだ ctx を渡す（書き込み後は syncPublication_ が読み直している） */
function eventDetail_(ctx, eventId) {
  var bundle = collectEvent_(ctx, eventId);
  var view = buildEventView_(bundle, true);
  var role = eventRole_(ctx.user, bundle.event, ctx);
  // 主催者の Google アカウントは、本人と管理者にだけ見せる（店舗スタッフ・共同主催者には出さない）
  if (role !== 'owner' && role !== 'admin') delete view.event.ownerEmail;
  view.event.role = role;
  view.event.canChangePassword = role === 'owner' || role === 'admin';
  view.event.canManageCollaborators = role === 'owner' || role === 'admin';
  if (view.event.canManageCollaborators) {
    view.collaborators = ctx.table('Collaborators').rows
      .filter(function (r) {
        return r.event_id === eventId;
      })
      .map(function (r) {
        return { id: r.collab_id, email: r.email, role: r.role || 'editor', addedAt: r.created_at, rev: r.rev || 0 };
      });
  }
  view.snapshotBudget = snapshotBudget_(bundle);
  view.publication = publicationStatus_(ctx, eventId);
  view.history = ctx
    .table('History')
    .rows.filter(function (h) {
      return h.event_id === eventId;
    })
    .slice(-ADMIN_CONFIG.HISTORY_VIEW_LIMIT)
    .reverse()
    .map(function (h) {
      return { at: h.at, actor: h.actor, action: h.action, entity: h.entity, entityId: h.entity_id, after: h.after_json };
    });
  return view;
}

/* ---------- セットアップ ---------- */

function actionConfigureStorage_(ctx, payload) {
  if (getSpreadsheetId_()) {
    throw appError_('ALREADY_CONFIGURED', '保存先は設定済みです。変更する場合は Apps Script のスクリプト プロパティを編集してください。');
  }
  var id = typeof payload.spreadsheetId === 'string' ? payload.spreadsheetId.trim() : '';
  var m = id.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (m) id = m[1];
  if (!SPREADSHEET_ID_PATTERN_.test(id)) {
    throw appError_('VALIDATION', 'スプレッドシートの ID（または共有リンク）を入力してください。');
  }
  try {
    SpreadsheetApp.openById(id).getName();
  } catch (e) {
    console.error('configureStorage openById failed', e && e.message);
    throw appError_('STORAGE_UNAVAILABLE', 'そのスプレッドシートを開けませんでした。ID と、デプロイしたアカウントの権限を確認してください。' + googleReason_(e));
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  return actionBootstrap_(ctx);
}

/**
 * 初期化。空の保存先にはシート・列を作る。v0.7 までのデータがある保存先では、
 * バックアップを取ってから列を足す移行（migrateStorage_）を行う。
 */
function actionInitializeStorage_(ctx) {
  var ss = openStorage_();
  var status = getStorageStatus_();
  if (status.initialized && status.migrationRequired) return actionMigrateStorage_(ctx);
  var result = initializeStorage_(ss);
  var c = createContext_(ss, ctx.actor, ctx.user);
  recordHistory_(c, 'storage.initialize', 'Storage', '', '', null, result);
  flushHistory_(c);
  commitContext_(c);
  var boot = actionBootstrap_(ctx);
  boot.initializeResult = result;
  return boot;
}

/** 保存先の移行（管理者の鍵のみ。本番反映の手順からも呼ぶ）。結果は履歴にも残す */
function actionMigrateStorage_(ctx) {
  var ss = openStorage_();
  var result = migrateStorage_(ss, ctx.actor);
  if (result.migrated) {
    var c = createContext_(ss, ctx.actor, ctx.user);
    recordHistory_(c, 'storage.migrate', 'Storage', '', '', null, result);
    flushHistory_(c);
    commitContext_(c);
  }
  var boot = actionBootstrap_(ctx);
  boot.migrateResult = result;
  boot.migration = migrationState_();
  return boot;
}

function actionSetViewerUrl_(ctx, payload) {
  var url = typeof payload.url === 'string' ? payload.url.trim() : '';
  var gas = /^https:\/\/script\.google\.com\/(a\/macros\/[A-Za-z0-9.-]+\/)?macros\/s\/[A-Za-z0-9_-]+\/exec$/;
  var pages = /^https:\/\/[a-z0-9-]+\.github\.io\/[A-Za-z0-9._-]+\/?$/;
  if (url && !gas.test(url) && !pages.test(url)) {
    throw appError_('VALIDATION', '閲覧ページの URL（https://<ユーザー名>.github.io/<リポジトリ名>/ または https://script.google.com/macros/s/…/exec）を入力してください。');
  }
  var props = PropertiesService.getScriptProperties();
  if (url) props.setProperty('VIEWER_URL', url);
  else props.deleteProperty('VIEWER_URL');
  return actionBootstrap_(ctx);
}

/* ---------- ルール ---------- */

function parseBestOf_(value, label) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (!isValidBestOf_(n)) throw appError_('VALIDATION', (label || 'Best of') + ' は 1〜' + ADMIN_CONFIG.BEST_OF_MAX + ' の奇数で指定してください。');
  return n;
}

function parseGroupCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (n === null || n < ADMIN_CONFIG.MIN_GROUPS || n > ADMIN_CONFIG.MAX_GROUPS || Math.floor(n) !== n) {
    throw appError_('VALIDATION', 'グループ数は ' + ADMIN_CONFIG.MIN_GROUPS + '〜' + ADMIN_CONFIG.MAX_GROUPS + ' で指定してください。');
  }
  return n;
}

/** 画面から送られたルール。{ format: 'legs' | 'sets' | 'fixed', bestOf, setBestOf, provisional }（fixed の bestOf は Leg 数） */
function parseRuleInput_(input) {
  var src = input && typeof input === 'object' ? input : {};
  var format = src.format === 'sets' ? 'sets' : src.format === 'fixed' ? 'fixed' : 'legs';
  var bestOf;
  if (format === 'fixed') {
    bestOf = typeof src.bestOf === 'number' ? src.bestOf : parseNonNegativeInt_(src.bestOf);
    if (!isValidFixedLegs_(bestOf)) throw appError_('VALIDATION', '固定 Leg 数は 1〜' + ADMIN_CONFIG.BEST_OF_MAX + ' で指定してください。');
  } else {
    bestOf = parseBestOf_(src.bestOf, format === 'sets' ? 'セット数の Best of' : 'Best of');
  }
  return {
    format: format,
    bestOf: bestOf,
    setBestOf: format === 'sets' ? parseBestOf_(src.setBestOf, '1 セットの Best of') : null,
    provisional: src.provisional === undefined ? true : requireBool_(src.provisional, '暫定ルール'),
  };
}

function ruleName_(spec, provisional) {
  var base =
    spec.format === 'sets'
      ? 'Best of ' + spec.bestOf + ' セット（各セット Best of ' + spec.setBestOf + ' Legs）'
      : spec.format === 'fixed'
        ? '固定 ' + spec.bestOf + ' Legs（引き分けあり）'
        : 'Best of ' + spec.bestOf + ' Legs';
  return base + (provisional ? '（暫定）' : '');
}

function applyRule_(rule, spec, now) {
  rule.format = spec.format === 'sets' ? RULE_FORMAT.BEST_OF_SETS : spec.format === 'fixed' ? RULE_FORMAT.FIXED_LEGS : RULE_FORMAT.BEST_OF_LEGS;
  rule.best_of = spec.bestOf;
  rule.set_best_of = spec.format === 'sets' ? spec.setBestOf : null;
  rule.is_provisional = spec.provisional;
  rule.name = ruleName_(spec, spec.provisional);
  rule.notes = spec.provisional ? 'PoC 用の暫定ルール。実大会のルールとして確定したものではない。' : '';
  rule.updated_at = now;
}

function ruleSpecOf_(rule) {
  var sets = rule.format === RULE_FORMAT.BEST_OF_SETS;
  var fixed = rule.format === RULE_FORMAT.FIXED_LEGS;
  return { format: sets ? 'sets' : fixed ? 'fixed' : 'legs', bestOf: rule.best_of, setBestOf: sets ? rule.set_best_of : null, provisional: rule.is_provisional };
}

function newRuleRecord_(ctx, eventId, spec, taken) {
  var id = newId_('RUL', taken);
  taken[id] = true;
  var rule = { rule_id: id, event_id: eventId, rev: 1, created_at: ctx.now };
  applyRule_(rule, spec, ctx.now);
  return rule;
}

/* ---------- 段階の作成 ---------- */

/** 作成時のひな形（定義は shared/formats.js。ここは ID の一覧と、段階の組み立て） */
var TEMPLATES_ = {};
TOURNAMENT_FORMATS.forEach(function (f) {
  TEMPLATES_[f.id] = f.label;
});

function newStageRecord_(ctx, eventId, input, taken) {
  var id = newId_('STG', taken);
  taken[id] = true;
  return {
    stage_id: id,
    event_id: eventId,
    name: input.name,
    type: input.type,
    order: input.order,
    rule_id: input.ruleId,
    parent_stage_id: '',
    config_json: JSON.stringify(input.config || {}),
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
}

/** グループの既定の名前（ロビン: グループA… / リーグ: リーグ・ディビジョン1… / シリーズ: 第1節… / スイス式: スイス式） */
function defaultGroupName_(type, index, count) {
  if (type === STAGE_TYPE.LEAGUE) return count > 1 ? 'ディビジョン' + (index + 1) : 'リーグ';
  if (type === STAGE_TYPE.SERIES) return '第' + (index + 1) + '節';
  if (type === STAGE_TYPE.SWISS) return 'スイス式';
  return groupLabel_(index);
}

function newGroupRecords_(ctx, eventId, stageId, count, taken, startIndex, typeOrLeague, total) {
  var type = typeOrLeague === true ? STAGE_TYPE.LEAGUE : typeOrLeague === false || !typeOrLeague ? STAGE_TYPE.ROUND_ROBIN : typeOrLeague;
  var out = [];
  for (var i = 0; i < count; i++) {
    var gid = newId_('GRP', taken);
    taken[gid] = true;
    out.push({
      group_id: gid,
      event_id: eventId,
      stage_id: stageId,
      name: defaultGroupName_(type, (startIndex || 0) + i, total || count),
      order: (startIndex || 0) + i + 1,
      meta_json: '',
      rev: 1,
      created_at: ctx.now,
      updated_at: ctx.now,
    });
  }
  return out;
}

/**
 * 大会・段階・ルール・グループをひな形どおりに作る。
 * input = { name, dateLabel, organizerName, rule, template, groupCount, advanceCount, groupCount2, advanceCount2, thirdPlace, cycles,
 *           divisions, playoff, points, nights, nightPoints, swissRounds, grandFinal, isSample }
 */
function createEventRecords_(ctx, input) {
  var events = ctx.table('Events');
  var eventId = newId_('EVT', events.byKey);
  var ruleTaken = Object.assign({}, ctx.table('Rules').byKey);
  var stageTaken = Object.assign({}, ctx.table('Stages').byKey);
  var groupTaken = Object.assign({}, ctx.table('Groups').byKey);
  var template = TEMPLATES_[input.template] ? input.template : 'robin';
  var rules = [];
  var stages = [];
  var groups = [];
  var addStage = function (name, type, config) {
    var rule = newRuleRecord_(ctx, eventId, input.rule, ruleTaken);
    rules.push(rule);
    var stage = newStageRecord_(ctx, eventId, { name: name, type: type, order: stages.length + 1, ruleId: rule.rule_id, config: config }, stageTaken);
    stages.push(stage);
    return stage;
  };
  var addGroups = function (stage, count) {
    groups = groups.concat(newGroupRecords_(ctx, eventId, stage.stage_id, count, groupTaken, 0, stage.type, count));
  };
  var setConfig = function (stage, cfg) {
    stage.config_json = JSON.stringify(cfg);
  };
  var robinConfig = function () {
    return { cycles: input.cycles === 2 ? 2 : 1, tiebreakers: DEFAULT_TIEBREAKERS_.slice() };
  };
  var koConfig = function () {
    return { thirdPlace: !!input.thirdPlace, avoidSameGroup: true };
  };
  // v0.7 までのひな形（robin / robin_ab / elimination / league の 1 ディビジョン）は、作る段階と設定を変えない
  var legacyGroupConfig = robinConfig();
  if (template === 'elimination') {
    addStage('トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
  } else if (template === 'robin' || template === 'robin_ab') {
    var robin = addStage(template === 'robin_ab' ? '予選ロビン' : 'ロビン', STAGE_TYPE.ROUND_ROBIN, legacyGroupConfig);
    addGroups(robin, input.groupCount);
    if (template === 'robin_ab') {
      var a = addStage('A トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      var b = addStage('B トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      var k = input.advanceCount || 2;
      legacyGroupConfig.advancement = [
        { fromRank: 1, toRank: k, targetStageId: a.stage_id },
        { fromRank: k + 1, toRank: 99, targetStageId: b.stage_id },
      ];
      setConfig(robin, legacyGroupConfig);
    }
  } else if (template === 'robin_ko') {
    var pre = addStage('予選ロビン', STAGE_TYPE.ROUND_ROBIN, robinConfig());
    addGroups(pre, input.groupCount);
    var fin = addStage('決勝トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, koConfig());
    var c1 = robinConfig();
    c1.advancement = [{ fromRank: 1, toRank: input.advanceCount || 2, targetStageId: fin.stage_id }];
    setConfig(pre, c1);
  } else if (template === 'double_elimination') {
    addStage('ダブルエリミネーション', STAGE_TYPE.DOUBLE_ELIMINATION, { grandFinal: input.grandFinal === 'single' ? 'single' : 'reset' });
  } else if (template === 'league' || template === 'league_playoff') {
    var D = input.divisions || 1;
    // v0.8 で作るリーグは勝ち点（勝・分・負）で順位を決める（アプリの既定値 2・1・0。主催者が変えられる）
    var lc = { cycles: input.cycles === 2 ? 2 : 1, points: input.points, tiebreakers: DEFAULT_POINTS_TIEBREAKERS_.slice() };
    var league = addStage('リーグ', STAGE_TYPE.LEAGUE, lc);
    addGroups(league, D);
    if (template === 'league_playoff') {
      var po = addStage('プレーオフ', STAGE_TYPE.SINGLE_ELIMINATION, koConfig());
      lc.advancement = [{ fromRank: 1, toRank: Math.max(1, Math.ceil((input.playoff || 4) / D)), targetStageId: po.stage_id }];
      setConfig(league, lc);
    }
  } else if (template === 'multi_robin_ko') {
    var r1 = addStage('予選ロビン', STAGE_TYPE.ROUND_ROBIN, robinConfig());
    addGroups(r1, input.groupCount);
    var r2 = addStage('2 次ロビン', STAGE_TYPE.ROUND_ROBIN, robinConfig());
    addGroups(r2, input.groupCount2 || 2);
    var f2 = addStage('決勝トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, koConfig());
    var a1 = robinConfig();
    a1.advancement = [{ fromRank: 1, toRank: input.advanceCount || 2, targetStageId: r2.stage_id }];
    setConfig(r1, a1);
    var a2 = robinConfig();
    a2.advancement = [{ fromRank: 1, toRank: input.advanceCount2 || 2, targetStageId: f2.stage_id }];
    setConfig(r2, a2);
  } else if (template === 'series_playoff') {
    var series = addStage('ポイントシリーズ', STAGE_TYPE.SERIES, { nights: input.nights || 16, nightPoints: input.nightPoints || [5, 3, 2, 0], tiebreakers: DEFAULT_SERIES_TIEBREAKERS_.slice() });
    addGroups(series, input.nights || 16);
    var spo = addStage('プレーオフ', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
    setConfig(series, { nights: input.nights || 16, nightPoints: input.nightPoints || [5, 3, 2, 0], tiebreakers: DEFAULT_SERIES_TIEBREAKERS_.slice(), advancement: [{ fromRank: 1, toRank: input.playoff || 4, targetStageId: spo.stage_id }] });
  } else if (template === 'swiss') {
    var sc = { rounds: input.swissRounds || 5, points: input.points, tiebreakers: DEFAULT_SWISS_TIEBREAKERS_.slice() };
    var sw = addStage('スイス式', STAGE_TYPE.SWISS, sc);
    addGroups(sw, 1);
    if (input.playoff >= 2) {
      var spo2 = addStage('決勝トーナメント', STAGE_TYPE.SINGLE_ELIMINATION, { thirdPlace: !!input.thirdPlace });
      sc.advancement = [{ fromRank: 1, toRank: input.playoff, targetStageId: spo2.stage_id }];
      setConfig(sw, sc);
    }
  }
  if (input.rule.format === 'fixed') {
    stages.forEach(function (st) {
      if (isBracketStage_(st)) {
        throw appError_('VALIDATION', '固定 Leg 数（引き分けあり）は勝ち抜き戦の段階（' + st.name + '）では使えません。Leg 制・セット制を選ぶか、勝ち抜き戦のない形式にしてください。');
      }
    });
  }
  var event = {
    event_id: eventId,
    name: input.name,
    date_label: input.dateLabel,
    status: EVENT_STATUS.DRAFT,
    is_public: false,
    is_featured: false,
    rule_id: rules[0].rule_id,
    is_sample: !!input.isSample,
    organizer_name: input.organizerName || '',
    admin_key_hash: '',
    admin_key_issued_at: '',
    owner_email: input.ownerEmail || '',
    staff_pass_hash: '',
    staff_pass_salt: '',
    staff_pass_set_at: '',
    notes: '',
    // v0.8 で作る大会: 形式を記録し、全段階が終わったら自動で「終了」にする（既存の大会には付けない）
    config_json: JSON.stringify({ template: template, autoFinish: true, timezone: EVENT_TIMEZONE_DEFAULT_ }),
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  appendRecords_(events, [event]);
  appendRecords_(ctx.table('Rules'), rules);
  appendRecords_(ctx.table('Stages'), stages);
  appendRecords_(ctx.table('Groups'), groups);
  recordHistory_(ctx, 'event.create', 'Event', eventId, eventId, null, {
    event: eventForLog_(event),
    template: template,
    stages: stages.length,
    groups: groups.length,
    by: ctx.user ? ctx.user.label : '',
  });
  return { event: event, rules: rules, stages: stages, groups: groups };
}

/** 履歴に残す大会レコード（パスワードのハッシュ・ソルトは残さない） */
function eventForLog_(event) {
  var out = plain_(event);
  delete out.admin_key_hash;
  delete out.staff_pass_hash;
  delete out.staff_pass_salt;
  return out;
}

/** 大会作成の権限（Google ログイン）と上限（全体の大会数・1 時間あたりの作成数）。管理者は対象外 */
function assertCreateAllowed_(ctx) {
  assertCanCreate_(ctx.user);
  if (ctx.user.isPlatformAdmin) return;
  if (ctx.table('Events').rows.length >= ADMIN_CONFIG.MAX_EVENTS_TOTAL) {
    throw appError_('LIMIT', '大会の登録数が上限に達しています。管理者に連絡してください。');
  }
  var cache = CacheService.getScriptCache();
  var bucket = 'creates:' + Math.floor(Date.now() / 3600000);
  var count = Number(cache.get(bucket) || 0);
  if (count >= ADMIN_CONFIG.MAX_CREATES_PER_HOUR) {
    throw appError_('LIMIT', '短時間に多くの大会が作成されたため、一時的に作成を止めています。しばらくしてからお試しください。');
  }
  var mine = bucket + ':' + sha256Hex_(ctx.user.email);
  var myCount = Number(cache.get(mine) || 0);
  if (myCount >= ADMIN_CONFIG.MAX_CREATES_PER_USER_HOUR) {
    throw appError_('LIMIT', '1 時間に作れる大会の数（' + ADMIN_CONFIG.MAX_CREATES_PER_USER_HOUR + '）を超えました。しばらくしてからお試しください。');
  }
  // 書き込みはスクリプトロックの中なので、数え間違いは起きない
  cache.put(bucket, String(count + 1), 3600);
  cache.put(mine, String(myCount + 1), 3600);
}

/** 作った大会の主催者（Google でログインしていればその人。管理者が作った大会は主催者なし） */
function creatorEmail_(ctx) {
  return ctx.user && ctx.user.kind === 'google' ? ctx.user.email : '';
}

function parseAdvanceCount_(value) {
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value === undefined ? '2' : value);
  if (!isPositiveInt_(n) || n > 16) throw appError_('VALIDATION', '進出する順位は 1〜16 で指定してください。');
  return n;
}

function parseSmallInt_(value, label, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  var n = typeof value === 'number' ? value : parseNonNegativeInt_(value);
  if (n === null || !(n >= min && n <= max) || Math.floor(n) !== n) throw appError_('VALIDATION', label + ' は ' + min + '〜' + max + ' で指定してください。');
  return n;
}

/** 勝・分・負の点 { win, draw, loss }（-99〜99 の整数。勝ち ≧ 引き分け ≧ 負け） */
function parsePoints_(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'object' || Array.isArray(value)) throw appError_('VALIDATION', '勝ち点の指定が不正です。');
  var read = function (k, label) {
    var v = value[k];
    var n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : NaN;
    if (!(n >= -99 && n <= 99) || Math.floor(n) !== n) throw appError_('VALIDATION', label + 'の点は -99〜99 の整数で指定してください。');
    return n;
  };
  var p = { win: read('win', '勝ち'), draw: read('draw', '引き分け'), loss: read('loss', '負け') };
  if (!(p.win >= p.draw && p.draw >= p.loss)) throw appError_('VALIDATION', '勝ち点は 勝ち ≧ 引き分け ≧ 負け にしてください。');
  return p;
}

function parseNightPoints_(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) throw appError_('VALIDATION', '節の順位ポイントは 2〜8 段階で指定してください（優勝・準優勝・準決勝敗退…）。');
  var out = value.map(function (v, i) {
    var n = typeof v === 'number' ? v : parseNonNegativeInt_(v);
    if (n === null || n > 999) throw appError_('VALIDATION', '節の順位ポイント（' + (i + 1) + '番目）は 0〜999 の整数で指定してください。');
    return n;
  });
  for (var i = 1; i < out.length; i++) {
    if (out[i] > out[i - 1]) throw appError_('VALIDATION', '節の順位ポイントは、上の順位ほど高く（同じでもよい）してください。');
  }
  return out;
}

function actionCreateEvent_(ctx, payload) {
  assertCreateAllowed_(ctx);
  var template = TEMPLATES_[payload.template] ? payload.template : 'robin';
  var needsGroups = template === 'robin' || template === 'robin_ab' || template === 'robin_ko' || template === 'multi_robin_ko';
  var hasPlayoff = template === 'league_playoff' || template === 'series_playoff';
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH),
    dateLabel: cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    rule: parseRuleInput_(payload.rule || { format: 'legs', bestOf: payload.bestOf, provisional: payload.provisional }),
    template: template,
    groupCount: needsGroups ? parseGroupCount_(payload.groupCount) : 0,
    advanceCount: template === 'robin_ab' || template === 'robin_ko' || template === 'multi_robin_ko' ? parseAdvanceCount_(payload.advanceCount) : 0,
    groupCount2: template === 'multi_robin_ko' ? parseGroupCount_(payload.groupCount2 === undefined ? 2 : payload.groupCount2) : 0,
    advanceCount2: template === 'multi_robin_ko' ? parseAdvanceCount_(payload.advanceCount2) : 0,
    thirdPlace: payload.thirdPlace === true,
    cycles: payload.cycles === 2 ? 2 : 1,
    divisions: template === 'league' || template === 'league_playoff' ? parseSmallInt_(payload.divisions, 'ディビジョン数', 1, ADMIN_CONFIG.MAX_GROUPS, 1) : 1,
    playoff: hasPlayoff ? parseSmallInt_(payload.playoff, 'プレーオフの人数', 2, 64, 4) : template === 'swiss' ? parseSmallInt_(payload.playoff, '決勝トーナメントの人数', 0, 64, 0) : 0,
    points: parsePoints_(payload.points, { win: 2, draw: 1, loss: 0 }),
    nights: template === 'series_playoff' ? parseSmallInt_(payload.nights, '節の数', 1, ADMIN_CONFIG.MAX_SERIES_NIGHTS, 16) : 0,
    nightPoints: template === 'series_playoff' ? parseNightPoints_(payload.nightPoints, [5, 3, 2, 0]) : null,
    swissRounds: template === 'swiss' ? parseSmallInt_(payload.swissRounds, '回戦数', 1, ADMIN_CONFIG.MAX_SWISS_ROUNDS, 5) : 0,
    grandFinal: payload.grandFinal === 'single' ? 'single' : 'reset',
    ownerEmail: creatorEmail_(ctx),
  });
  if (template === 'swiss' && created.stages.length === 1 && payload.playoff === 1) throw appError_('VALIDATION', '決勝トーナメントの人数は 0（なし）か 2 以上にしてください。');
  return { eventId: created.event.event_id };
}

/* ---------- ログイン ---------- */

/** Google でログイン: ID トークンを確かめてセッションを発行する */
function actionLogin_(ctx, payload) {
  // ログインのたびに Google（tokeninfo）へ問い合わせるので、大量の呼び出しで外部通信の割り当てを使い切られないよう全体で上限を設ける
  var cache = CacheService.getScriptCache();
  var bucket = 'logins:' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(bucket) || 0);
  if (count >= ADMIN_CONFIG.MAX_LOGINS_PER_MINUTE) {
    throw appError_('LIMIT', 'ログインが混み合っています。1 分ほどしてからもう一度お試しください。');
  }
  cache.put(bucket, String(count + 1), 120);
  var email = verifyGoogleIdToken_(payload.idToken);
  var issued = issueSession_({ kind: 'google', email: email });
  return { session: issued.session, expiresAt: issued.expiresAt, email: email };
}

/** 店舗スタッフ: 大会と管理パスワードを確かめてセッションを発行する */
function actionStaffLogin_(ctx, payload) {
  var event = verifyStaffPassword_(ctx, payload.eventId, payload.password);
  var issued = issueSession_({ kind: 'staff', eventId: event.event_id, passStamp: staffPassStamp_(event) });
  return { session: issued.session, expiresAt: issued.expiresAt, eventId: event.event_id };
}

function actionLogout_(ctx, payload) {
  endSession_(payload.session);
  return { loggedOut: true };
}

/** 管理パスワードの設定・変更・解除（大会を作った本人と管理者だけ。変えると古いパスワードのセッションは切れる） */
function actionSetStaffPassword_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '管理パスワードの変更');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  if (payload.password === '' || payload.password === null) {
    event.staff_pass_hash = '';
    event.staff_pass_salt = '';
    event.staff_pass_set_at = '';
  } else {
    var password = validateStaffPassword_(payload.password);
    event.staff_pass_salt = newSecret_().slice(0, 32);
    event.staff_pass_hash = staffPasswordHash_(eventId, event.staff_pass_salt, password);
    event.staff_pass_set_at = ctx.now;
  }
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  CacheService.getScriptCache().remove(staffFailKey_(eventId));
  recordHistory_(ctx, event.staff_pass_hash ? 'event.setStaffPassword' : 'event.clearStaffPassword', 'Event', eventId, eventId, null, { at: ctx.now, by: ctx.user.label });
  return { eventId: eventId };
}

/** 大会の主催者（Google アカウント）を付け替える（管理者のみ。v0.4 以前に作った大会や、主催者の交代に使う） */
function actionSetOwner_(ctx, payload) {
  assertPlatformAdmin_(ctx.user);
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var email = '';
  if (payload.ownerEmail !== '' && payload.ownerEmail !== null && payload.ownerEmail !== undefined) {
    email = normalizeEmail_(payload.ownerEmail);
    if (!email) throw appError_('VALIDATION', '主催者の Google アカウント（メールアドレス）を正しく入力してください。');
  }
  var before = event.owner_email;
  event.owner_email = email;
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  recordHistory_(ctx, 'event.setOwner', 'Event', eventId, eventId, { owner_email: before }, { owner_email: email });
  return { eventId: eventId };
}

function actionUpdateEvent_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var before = plain_(event);
  var status = payload.status;
  if (!EVENT_STATUS_LABEL[status]) throw appError_('VALIDATION', '大会の状態が不正です。');
  event.name = cleanText_(payload.name, '大会名', ADMIN_CONFIG.MAX_EVENT_NAME_LENGTH);
  event.date_label = cleanText_(payload.dateLabel, '開催日', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true });
  event.notes = cleanText_(payload.notes, 'メモ', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true });
  event.status = status;
  event.is_public = requireBool_(payload.isPublic, '公開設定');
  // 閲覧画面の既定表示（URL に大会指定がないときの表示）はプラットフォーム全体の設定なので、管理者だけが変えられる
  if (ctx.user.isPlatformAdmin) {
    event.is_featured = event.is_public && requireBool_(payload.isFeatured, '既定表示');
  } else {
    event.is_featured = event.is_public && event.is_featured;
  }
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);

  // 既定表示の大会は 1 つだけ
  var others = [];
  if (event.is_featured) {
    events.rows.forEach(function (e) {
      if (e.event_id !== eventId && e.is_featured && !events.duplicates[e.event_id]) {
        e.is_featured = false;
        e.rev = (e.rev || 0) + 1;
        e.updated_at = ctx.now;
        updateRecord_(events, e);
        others.push(e.event_id);
      }
    });
  }
  ctx.invalidate();
  recordHistory_(ctx, 'event.update', 'Event', eventId, eventId, eventForLog_(before), eventForLog_(event));
  return { eventId: eventId, alsoPublish: others };
}

/** 互換用: 大会の既定ルール（最初の段階のルール）を変える。段階ごとの変更は updateStage */
function actionUpdateRule_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (!bundle.rule) throw appError_('DATA_CONFLICT', '大会のルールが見つかりません。');
  var rules = ctx.table('Rules');
  var rule = findRecord_(rules, bundle.rule.rule_id, 'ルール');
  assertRev_(rule, requireRev_(payload.rev), 'ルール');
  var spec = parseRuleInput_(payload.rule || { format: rule.format === RULE_FORMAT.BEST_OF_SETS ? 'sets' : 'legs', bestOf: payload.bestOf, setBestOf: rule.set_best_of, provisional: payload.provisional });
  assertRuleChangeAllowed_(bundle, rule, spec);
  var before = plain_(rule);
  applyRule_(rule, spec, ctx.now);
  rule.rev = (rule.rev || 0) + 1;
  updateRecord_(rules, rule);
  recordHistory_(ctx, 'rule.update', 'Rule', rule.rule_id, eventId, before, plain_(rule));
  return { eventId: eventId };
}

/** 結果が入った試合がある段階では、勝敗の条件（形式・Best of）を変えさせない */
function assertRuleChangeAllowed_(bundle, rule, spec) {
  var current = ruleSpecOf_(rule);
  var changed = current.format !== spec.format || current.bestOf !== spec.bestOf || (spec.format === 'sets' && current.setBestOf !== spec.setBestOf);
  if (!changed) return;
  var stageIds = bundle.stages
    .filter(function (st) {
      return st.rule_id === rule.rule_id;
    })
    .map(function (st) {
      return st.stage_id;
    });
  var started = bundle.matches.some(function (m) {
    return stageIds.indexOf(m.stage_id) !== -1 && matchStarted_(m);
  });
  if (started) throw appError_('LOCKED', '結果が入力された試合があるため、対戦形式（Leg / セット・Best of）は変更できません。');
}

/* ---------- 選手 ---------- */

function actionAddPlayers_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  findRecord_(ctx.table('Events'), eventId, '大会');
  if (!Array.isArray(payload.names) || payload.names.length === 0) {
    throw appError_('VALIDATION', '登録する選手名を入力してください。');
  }
  if (payload.names.length > ADMIN_CONFIG.MAX_BULK_PLAYERS) {
    throw appError_('VALIDATION', '一度に登録できるのは ' + ADMIN_CONFIG.MAX_BULK_PLAYERS + ' 名までです。');
  }
  var players = ctx.table('Players');
  var current = players.rows.filter(function (p) {
    return p.event_id === eventId;
  });
  var names = {};
  current.forEach(function (p) {
    names[p.display_name] = true;
  });
  var cleaned = payload.names.map(function (n, i) {
    var name = cleanText_(n, '選手名（' + (i + 1) + '行目）', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
    if (names[name]) throw appError_('VALIDATION', '選手名「' + name + '」は既に登録されています。');
    names[name] = true;
    return name;
  });
  if (current.length + cleaned.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) {
    throw appError_('VALIDATION', '1 大会の選手は ' + ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT + ' 名までです。');
  }
  var taken = Object.assign({}, players.byKey);
  var records = cleaned.map(function (name) {
    var id = newId_('PLY', taken);
    taken[id] = true;
    return { player_id: id, event_id: eventId, display_name: name, external_ref: '', notes: '', affiliation: '', rating: '', seed: null, meta_json: '', rev: 1, created_at: ctx.now, updated_at: ctx.now };
  });
  appendRecords_(players, records);
  recordHistory_(ctx, 'player.add', 'Player', '', eventId, null, records.map(plain_));
  return { eventId: eventId, added: records.length };
}

/** 選手の名前と、v0.8 の所属・Rt・シード・非公開メモ（送られた項目だけ変える） */
function actionUpdatePlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var before = plain_(player);
  if (payload.name !== undefined) {
    var name = cleanText_(payload.name, '選手名', ADMIN_CONFIG.MAX_PLAYER_NAME_LENGTH);
    var dup = players.rows.some(function (p) {
      return p.event_id === player.event_id && p.player_id !== player.player_id && p.display_name === name;
    });
    if (dup) throw appError_('VALIDATION', '選手名「' + name + '」は既に登録されています。');
    player.display_name = name;
  }
  if (payload.affiliation !== undefined) player.affiliation = parseAffiliation_(payload.affiliation);
  if (payload.rating !== undefined) player.rating = parseRatingInput_(payload.rating);
  if (payload.seed !== undefined) {
    var seed = parseSeedInput_(payload.seed);
    if (seed && players.rows.some(function (p) { return p.event_id === player.event_id && p.player_id !== player.player_id && p.seed === seed; })) {
      throw appError_('VALIDATION', 'シード ' + seed + ' は他の選手に付いています。');
    }
    player.seed = seed;
  }
  if (payload.notes !== undefined) player.notes = cleanText_(payload.notes, 'メモ', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true });
  player.rev = (player.rev || 0) + 1;
  player.updated_at = ctx.now;
  updateRecord_(players, player);
  recordHistory_(ctx, 'player.update', 'Player', player.player_id, player.event_id, before, plain_(player));
  return { eventId: player.event_id };
}

function actionDeletePlayer_(ctx, payload) {
  var players = ctx.table('Players');
  var player = findRecord_(players, requireId_(payload.playerId, '選手'), '選手');
  assertRev_(player, requireRev_(payload.rev), '選手');
  var used = ctx.table('Matches').rows.some(function (m) {
    return m.player1_id === player.player_id || m.player2_id === player.player_id;
  });
  if (used) {
    throw appError_('LOCKED', '対戦カードに含まれている選手は削除できません。先にその段階・グループの対戦カードを削除してください。');
  }
  var entries = ctx.table('Entries');
  var before = plain_(player);
  deleteRecords_(
    entries,
    entries.rows.filter(function (e) {
      return e.player_id === player.player_id;
    })
  );
  deleteRecords_(players, [player]);
  ctx.invalidate();
  recordHistory_(ctx, 'player.delete', 'Player', before.player_id, before.event_id, before, null);
  return { eventId: before.event_id };
}

/* ---------- 段階（形式）の編集 ---------- */

function stageKindMatches_(st, kind) {
  if (!kind) return true;
  if (kind === 'group') return isGroupStage_(st);
  if (kind === 'robin') return isRoundRobinStage_(st);
  if (kind === 'elimination') return isEliminationStage_(st);
  if (kind === 'knockout') return st.type === STAGE_TYPE.SINGLE_ELIMINATION || st.type === STAGE_TYPE.DOUBLE_ELIMINATION;
  if (kind === 'assign' || kind === 'rankable') return isGroupStage_(st) || st.type === STAGE_TYPE.SERIES;
  if (kind === 'swiss') return st.type === STAGE_TYPE.SWISS;
  if (kind === 'series') return st.type === STAGE_TYPE.SERIES;
  return true;
}

/** payload.stageId の段階を返す（省略時は最初の段階。kind で種類を限定できる） */
function resolveStage_(bundle, payload, kind) {
  var stage;
  if (payload.stageId !== undefined && payload.stageId !== '') {
    var id = requireId_(payload.stageId, '段階');
    stage = bundle.stageById[id];
    if (!stage) throw appError_('NOT_FOUND', '段階が見つかりません。');
  } else {
    stage = bundle.stages.filter(function (st) {
      return stageKindMatches_(st, kind);
    })[0];
    if (!stage) throw appError_('NOT_FOUND', '対象の段階がありません。');
  }
  if (!stageKindMatches_(stage, kind)) {
    var what = { group: 'ロビン・リーグ・スイス式', robin: 'ロビン・リーグ', elimination: 'トーナメント', knockout: 'トーナメント・ダブルエリミネーション', assign: 'ロビン・リーグ・スイス式・シリーズ', rankable: 'ロビン・リーグ・スイス式・シリーズ', swiss: 'スイス式', series: 'ポイントシリーズ' }[kind];
    throw appError_('BAD_REQUEST', 'この操作は' + what + 'の段階でのみ使えます。');
  }
  return stage;
}

function stageMatchesOf_(bundle, stage) {
  return bundle.matches.filter(function (m) {
    return m.stage_id === stage.stage_id;
  });
}

/**
 * 段階の設定を保存する。stageConfig_ が補った既定値は保存しない（v0.7 の段階に v0.8 の項目を書き足さないため、
 * 送られた cfg のうち、元の config_json にあった項目と、変更した項目だけを書く）
 */
function saveStage_(ctx, stage, cfg, changedKeys) {
  var raw = safeJson_(stage.config_json, {});
  var keys = changedKeys || Object.keys(cfg);
  var defaults = stageConfig_({ type: stage.type, config_json: '' });
  keys.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(raw, k) || JSON.stringify(cfg[k]) !== JSON.stringify(defaults[k]) || changedKeys) raw[k] = cfg[k];
  });
  saveStageRaw_(ctx, stage, raw);
}

function saveStageRaw_(ctx, stage, raw) {
  stage.config_json = JSON.stringify(raw);
  stage.rev = (stage.rev || 0) + 1;
  stage.updated_at = ctx.now;
  updateRecord_(ctx.table('Stages'), stage);
}

/** 段階を追加したときの既定の設定（v0.7 からある種類は従来どおり） */
function defaultStageConfig_(type, nights) {
  if (type === STAGE_TYPE.SINGLE_ELIMINATION) return { thirdPlace: false };
  if (type === STAGE_TYPE.DOUBLE_ELIMINATION) return { grandFinal: 'reset' };
  if (type === STAGE_TYPE.SWISS) return { rounds: 5, points: { win: 2, draw: 1, loss: 0 }, tiebreakers: DEFAULT_SWISS_TIEBREAKERS_.slice() };
  if (type === STAGE_TYPE.SERIES) return { nights: nights, nightPoints: [5, 3, 2, 0], tiebreakers: DEFAULT_SERIES_TIEBREAKERS_.slice() };
  return { cycles: 1, tiebreakers: DEFAULT_TIEBREAKERS_.slice() };
}

function actionAddStage_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  if (bundle.stages.length >= ADMIN_CONFIG.MAX_STAGES) throw appError_('LIMIT', '段階は ' + ADMIN_CONFIG.MAX_STAGES + ' つまでです。');
  var type = payload.type;
  if (!STAGE_TYPE_LABEL[type]) throw appError_('VALIDATION', '段階の種類が不正です。');
  var name = cleanText_(payload.name || STAGE_TYPE_LABEL[type], '段階の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);
  var baseRule = bundle.rule ? ruleSpecOf_(bundle.rule) : { format: 'legs', bestOf: 5, setBestOf: null, provisional: true };
  // 勝ち抜き戦では引き分けありの固定 Leg 数は使えないので、その場合は Best of 5 Legs で作る（あとで変えられる）
  var bracketType = type === STAGE_TYPE.SINGLE_ELIMINATION || type === STAGE_TYPE.DOUBLE_ELIMINATION || type === STAGE_TYPE.SERIES;
  if (bracketType && baseRule.format === 'fixed') baseRule = { format: 'legs', bestOf: 5, setBestOf: null, provisional: baseRule.provisional };
  var rule = newRuleRecord_(ctx, eventId, baseRule, Object.assign({}, ctx.table('Rules').byKey));
  var order = bundle.stages.reduce(function (mx, st) {
    return Math.max(mx, st.order || 0);
  }, 0) + 1;
  var nights = type === STAGE_TYPE.SERIES ? parseSmallInt_(payload.nights, '節の数', 1, ADMIN_CONFIG.MAX_SERIES_NIGHTS, 8) : 0;
  var config = defaultStageConfig_(type, nights);
  var stage = newStageRecord_(ctx, eventId, { name: name, type: type, order: order, ruleId: rule.rule_id, config: config }, Object.assign({}, ctx.table('Stages').byKey));
  appendRecords_(ctx.table('Rules'), [rule]);
  appendRecords_(ctx.table('Stages'), [stage]);
  if (type !== STAGE_TYPE.SINGLE_ELIMINATION && type !== STAGE_TYPE.DOUBLE_ELIMINATION) {
    var count = type === STAGE_TYPE.SERIES ? nights : 1;
    appendRecords_(ctx.table('Groups'), newGroupRecords_(ctx, eventId, stage.stage_id, count, Object.assign({}, ctx.table('Groups').byKey), 0, type, count));
  }
  recordHistory_(ctx, 'stage.add', 'Stage', stage.stage_id, eventId, null, plain_(stage));
  return { eventId: eventId, stageId: stage.stage_id };
}

function parseTiebreakers_(value, type) {
  var allowed = TIEBREAKERS_FOR_[type] || Object.keys(TIEBREAKERS);
  if (!Array.isArray(value) || value.length > 8) throw appError_('VALIDATION', '順位の決め方の指定が不正です。');
  var seen = {};
  value.forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(TIEBREAKERS, k) || seen[k] || allowed.indexOf(k) === -1) throw appError_('VALIDATION', '順位の決め方の指定が不正です。');
    seen[k] = true;
  });
  return value.slice();
}

function parseRoundMap_(value, parseValue) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw appError_('VALIDATION', 'ラウンドごとの設定が不正です。');
  var out = {};
  Object.keys(value).forEach(function (k) {
    var n = Number(k);
    if (!isPositiveInt_(n) || n > 99) throw appError_('VALIDATION', 'ラウンド番号が不正です。');
    var v = value[k];
    if (v === '' || v === null || v === undefined) return;
    out[String(n)] = parseValue(v, n);
  });
  return out;
}

/** 進出ルール。v0.8 から進出先にロビン（2 次ロビン）・スイス式・ダブルエリミ・シリーズも選べる */
function parseAdvancement_(value, bundle, stage) {
  if (!Array.isArray(value) || value.length > 8) throw appError_('VALIDATION', '進出ルールの指定が不正です。');
  var rules = value.map(function (r) {
    var from = parseNonNegativeInt_(r && r.fromRank !== undefined ? r.fromRank : '');
    var to = parseNonNegativeInt_(r && r.toRank !== undefined ? r.toRank : '');
    if (!from || !to || from > to || to > 99) throw appError_('VALIDATION', '進出する順位（何位から何位まで）を正しく指定してください。');
    var target = r && isValidId_(r.targetStageId) ? bundle.stageById[r.targetStageId] : null;
    if (!target || target.stage_id === stage.stage_id) throw appError_('VALIDATION', '進出先の段階を選んでください。');
    if (!(target.order > stage.order)) throw appError_('VALIDATION', '進出先には、この段階より後の段階を選んでください。');
    return { fromRank: from, toRank: to, targetStageId: target.stage_id };
  });
  rules.forEach(function (a, i) {
    rules.forEach(function (b, j) {
      if (i < j && a.fromRank <= b.toRank && b.fromRank <= a.toRank) throw appError_('VALIDATION', '進出ルールの順位の範囲が重なっています。');
    });
  });
  return rules;
}

/** 手動の加減点（F14）。[{ playerId, points, reason }]。理由は必須。記録した時刻・操作者を残す */
function parseAdjustments_(value, bundle, stage, before, ctx) {
  if (!Array.isArray(value) || value.length > 64) throw appError_('VALIDATION', '加減点の指定が不正です。');
  var members = {};
  bundle.entries.forEach(function (e) {
    if (e.stage_id === stage.stage_id) members[e.player_id] = true;
  });
  return value.map(function (a, i) {
    var pid = a && isValidId_(a.playerId) && members[a.playerId] ? a.playerId : '';
    if (!pid) throw appError_('VALIDATION', '加減点（' + (i + 1) + '件目）の選手がこの段階にいません。');
    var pts = typeof a.points === 'number' ? a.points : typeof a.points === 'string' && /^[+-]?\d{1,3}$/.test(a.points.trim()) ? Number(a.points.trim()) : NaN;
    if (!(pts >= -999 && pts <= 999) || Math.floor(pts) !== pts || pts === 0) throw appError_('VALIDATION', '加減点（' + (i + 1) + '件目）は 0 以外の整数で指定してください。');
    var reason = cleanText_(a.reason, '加減点（' + (i + 1) + '件目）の理由', ADMIN_CONFIG.MAX_NOTE_LENGTH);
    var same = (before || []).filter(function (b) {
      return b.playerId === pid && b.points === pts && b.reason === reason;
    })[0];
    return { playerId: pid, points: pts, reason: reason, at: same ? same.at : ctx.now, by: same ? same.by : ctx.user ? ctx.user.label : '' };
  });
}

/**
 * 段階の設定を変える。payload の項目は省略可能（送られた項目だけ変更）。
 * 共通: { stageId, rev, name?, rule?, tiebreakers?, advancement?, points?, adjustments?, walkoverLegs? }
 * ロビン・リーグ: cycles?, roundLabels?, distribution?（進出先になったときの配り方）
 * トーナメント: thirdPlace?, roundBestOf?, drawMode?, fixedRounds?, avoidSameGroup?, maxEntrants?
 * ダブルエリミ: grandFinal?  スイス式: rounds?, firstRound?, byePoints?  シリーズ: nights?, nightPoints?, nightDraw?
 */
function actionUpdateStage_(ctx, payload) {
  var stages = ctx.table('Stages');
  var stage = findRecord_(stages, requireId_(payload.stageId, '段階'), '段階');
  assertRev_(stage, requireRev_(payload.rev), '段階');
  var bundle = collectEvent_(ctx, stage.event_id);
  stage = bundle.stageById[stage.stage_id];
  var cfg = stageConfig_(stage);
  var matches = stageMatchesOf_(bundle, stage);
  var started = matches.some(matchStarted_);
  var before = plain_(stage);
  var changed = [];
  var set = function (key, value) {
    cfg[key] = value;
    changed.push(key);
  };
  var type = stage.type;
  var bracket = isBracketStage_(stage);

  if (payload.name !== undefined) stage.name = cleanText_(payload.name, '段階の名前', ADMIN_CONFIG.MAX_LABEL_LENGTH);

  if (payload.rule !== undefined) {
    var rules = ctx.table('Rules');
    var rule = findRecord_(rules, stage.rule_id, 'ルール');
    var spec = parseRuleInput_(payload.rule);
    if (spec.format === 'fixed' && bracket) throw appError_('VALIDATION', '固定 Leg 数（引き分けあり）は勝ち抜き戦の段階では使えません（決着がつかないため）。');
    assertRuleChangeAllowed_(bundle, rule, spec);
    applyRule_(rule, spec, ctx.now);
    rule.rev = (rule.rev || 0) + 1;
    updateRecord_(rules, rule);
  }

  if (payload.tiebreakers !== undefined && (isGroupStage_(stage) || type === STAGE_TYPE.SERIES)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は順位の決め方を変更できません。');
    set('tiebreakers', parseTiebreakers_(payload.tiebreakers, type));
  }
  if (payload.advancement !== undefined && (isGroupStage_(stage) || type === STAGE_TYPE.SERIES)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は進出ルールを変更できません。先に「進出を取り消す」を行ってください。');
    set('advancement', parseAdvancement_(payload.advancement, bundle, stage));
  }
  if (payload.points !== undefined && isGroupStage_(stage)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は勝ち点を変更できません。');
    if (payload.points === null) {
      if (type === STAGE_TYPE.SWISS) throw appError_('VALIDATION', 'スイス式は勝ち点で組み合わせを決めるため、勝ち点なしにはできません。');
      set('points', null);
    } else {
      set('points', parsePoints_(payload.points, null));
    }
  }
  if (payload.adjustments !== undefined && isGroupStage_(stage)) {
    if (cfg.advanced) throw appError_('LOCKED', '進出確定後は加減点を変更できません。');
    if (!cfg.points && payload.adjustments.length) throw appError_('VALIDATION', '加減点は勝ち点を使う段階でだけ設定できます。先に勝ち点を設定してください。');
    set('adjustments', parseAdjustments_(payload.adjustments, bundle, stage, cfg.adjustments, ctx));
  }
  if (payload.walkoverLegs !== undefined && (isGroupStage_(stage) || type === STAGE_TYPE.SERIES)) {
    if (payload.walkoverLegs !== 'exclude' && payload.walkoverLegs !== 'award') throw appError_('VALIDATION', '不戦勝の Leg 数の扱いが不正です。');
    set('walkoverLegs', payload.walkoverLegs);
  }

  if (isRoundRobinStage_(stage)) {
    if (payload.cycles !== undefined) {
      var cycles = payload.cycles === 2 ? 2 : payload.cycles === 1 ? 1 : null;
      if (!cycles) throw appError_('VALIDATION', '総当たりの回数は 1 回か 2 回です。');
      if (cycles !== cfg.cycles && matches.length) throw appError_('LOCKED', '対戦カード作成後は総当たりの回数を変更できません。先に対戦カードを削除してください。');
      set('cycles', cycles);
    }
    if (payload.distribution !== undefined) {
      if (payload.distribution !== 'snake' && payload.distribution !== 'rank') throw appError_('VALIDATION', '進出者の配り方が不正です。');
      set('distribution', payload.distribution);
    }
  }
  if (isGroupStage_(stage) && payload.roundLabels !== undefined) {
    set(
      'roundLabels',
      parseRoundMap_(payload.roundLabels, function (v) {
        return cleanText_(v, 'ラウンドの表示名', MAX_ROUND_LABEL_LENGTH_);
      })
    );
  }
  if (type === STAGE_TYPE.SWISS) {
    var generated = matches.reduce(function (mx, m) {
      return Math.max(mx, m.round || 0);
    }, 0);
    if (payload.rounds !== undefined) {
      var rounds = parseSmallInt_(payload.rounds, '回戦数', 1, ADMIN_CONFIG.MAX_SWISS_ROUNDS, cfg.rounds);
      if (rounds < generated) throw appError_('LOCKED', 'すでに ' + generated + ' 回戦まで組んでいるため、回戦数をそれより少なくできません。');
      set('rounds', rounds);
    }
    if (payload.firstRound !== undefined) {
      if (payload.firstRound !== 'seed' && payload.firstRound !== 'random') throw appError_('VALIDATION', '1 回戦の組み方が不正です。');
      if (generated) throw appError_('LOCKED', '1 回戦を組んだ後は変更できません。');
      set('firstRound', payload.firstRound);
    }
    if (payload.byePoints !== undefined) {
      if (generated) throw appError_('LOCKED', '組み合わせを作った後は、不戦（Bye）の点を変更できません。');
      set('byePoints', parseSmallInt_(payload.byePoints, '不戦（Bye）の点', 0, 99, cfg.byePoints));
    }
  }
  if (isEliminationStage_(stage)) {
    if (payload.thirdPlace !== undefined) {
      var third = requireBool_(payload.thirdPlace, '3 位決定戦');
      if (third !== cfg.thirdPlace && matches.length) throw appError_('LOCKED', 'トーナメント表の作成後は 3 位決定戦の有無を変更できません。先にトーナメント表を削除してください。');
      set('thirdPlace', third);
    }
    if (payload.roundBestOf !== undefined) {
      var map = parseRoundMap_(payload.roundBestOf, function (v) {
        return parseBestOf_(v, 'ラウンドの Best of');
      });
      // 結果の入った試合があるラウンドの Best of は変えさせない
      matches.forEach(function (m) {
        if (matchStarted_(m) && String(map[String(m.round)] || '') !== String(cfg.roundBestOf[String(m.round)] || '')) {
          throw appError_('LOCKED', m.round + ' 回戦（' + (m.label || '') + '）は結果が入力されているため、Best of を変更できません。');
        }
      });
      set('roundBestOf', map);
    }
    var structural = ['drawMode', 'fixedRounds', 'avoidSameGroup'].filter(function (k) {
      return payload[k] !== undefined;
    });
    if (structural.length && matches.length) {
      var same = structural.every(function (k) {
        return payload[k] === cfg[k];
      });
      if (!same) throw appError_('LOCKED', 'トーナメント表の作成後は、表の作り方（固定 / 回戦ごとの抽選・同組の初戦回避）を変更できません。先にトーナメント表を削除してください。');
    }
    if (payload.drawMode !== undefined) {
      if (payload.drawMode !== 'fixed' && payload.drawMode !== 'redraw') throw appError_('VALIDATION', '表の作り方が不正です。');
      set('drawMode', payload.drawMode);
    }
    if (payload.fixedRounds !== undefined) set('fixedRounds', parseSmallInt_(payload.fixedRounds, '固定の表で行う回戦数', 0, 6, 0));
    if (payload.avoidSameGroup !== undefined) set('avoidSameGroup', requireBool_(payload.avoidSameGroup, '同じ組の初戦の回避'));
    if (payload.maxEntrants !== undefined) {
      var max = parseSmallInt_(payload.maxEntrants, '決勝の枠数', 0, ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS, 0);
      var current = bundle.entries.filter(function (e) {
        return e.stage_id === stage.stage_id;
      }).length;
      if (max && current > max) throw appError_('VALIDATION', 'すでに ' + current + ' 人が出場者に入っているため、枠数を ' + max + ' にはできません。');
      set('maxEntrants', max);
    }
  }
  if (type === STAGE_TYPE.DOUBLE_ELIMINATION && payload.grandFinal !== undefined) {
    if (payload.grandFinal !== 'reset' && payload.grandFinal !== 'single') throw appError_('VALIDATION', 'グランドファイナルの方式が不正です。');
    if (payload.grandFinal !== cfg.grandFinal && matches.length) throw appError_('LOCKED', '表の作成後はグランドファイナルの方式を変更できません。先に表を削除してください。');
    set('grandFinal', payload.grandFinal);
  }
  if (type === STAGE_TYPE.SERIES) {
    if (payload.nightPoints !== undefined) set('nightPoints', parseNightPoints_(payload.nightPoints, cfg.nightPoints));
    if (payload.nightDraw !== undefined) {
      if (['random', 'standing', 'seed'].indexOf(payload.nightDraw) === -1) throw appError_('VALIDATION', '節の組み合わせの決め方が不正です。');
      set('nightDraw', payload.nightDraw);
    }
    if (payload.nights !== undefined) {
      var nights = parseSmallInt_(payload.nights, '節の数', 1, ADMIN_CONFIG.MAX_SERIES_NIGHTS, cfg.nights);
      resizeSeriesNights_(ctx, bundle, stage, nights);
      set('nights', nights);
    }
  }
  saveStage_(ctx, stage, cfg, changed);
  recordHistory_(ctx, 'stage.update', 'Stage', stage.stage_id, stage.event_id, before, plain_(stage));
  return { eventId: stage.event_id, stageId: stage.stage_id, started: started };
}

/** シリーズの節の数を変える。減らすときは、後ろの節のうち組み合わせも参加者もない節だけを消す */
function resizeSeriesNights_(ctx, bundle, stage, count) {
  var nights = bundle.groups
    .filter(function (g) {
      return g.stage_id === stage.stage_id;
    })
    .sort(byOrder_);
  if (count > nights.length) {
    appendRecords_(ctx.table('Groups'), newGroupRecords_(ctx, stage.event_id, stage.stage_id, count - nights.length, Object.assign({}, ctx.table('Groups').byKey), nights.length, STAGE_TYPE.SERIES, count));
  } else if (count < nights.length) {
    var removed = nights.slice(count);
    removed.forEach(function (g) {
      var used = bundle.matches.some(function (m) {
        return m.group_id === g.group_id;
      }) || bundle.entries.some(function (e) {
        return e.group_id === g.group_id;
      });
      if (used) throw appError_('LOCKED', '「' + g.name + '」には組み合わせか参加者があるため、節の数を減らせません。');
    });
    deleteRecords_(ctx.table('Groups'), removed.map(function (g) {
      return ctx.table('Groups').byKey[g.group_id];
    }));
  }
}

function actionDeleteStage_(ctx, payload) {
  var stages = ctx.table('Stages');
  var stage = findRecord_(stages, requireId_(payload.stageId, '段階'), '段階');
  assertRev_(stage, requireRev_(payload.rev), '段階');
  var bundle = collectEvent_(ctx, stage.event_id);
  if (bundle.stages.length <= 1) throw appError_('LOCKED', '最後の段階は削除できません。');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', '対戦カードがある段階は削除できません。先に対戦カード・トーナメント表を削除してください。');
  var feeding = bundle.stages.filter(function (st) {
    return stageConfig_(st).advancement.some(function (r) {
      return r.targetStageId === stage.stage_id;
    });
  });
  if (feeding.length) throw appError_('LOCKED', '「' + feeding[0].name + '」の進出先になっています。先にその進出ルールを外してください。');
  var before = plain_(stage);
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  var groups = ctx.table('Groups');
  deleteRecords_(groups, groups.rows.filter(function (g) {
    return g.stage_id === stage.stage_id;
  }));
  var rules = ctx.table('Rules');
  var event = findRecord_(ctx.table('Events'), stage.event_id, '大会');
  var stillUsed = bundle.stages.some(function (st) {
    return st.stage_id !== stage.stage_id && st.rule_id === stage.rule_id;
  });
  if (!stillUsed && event.rule_id !== stage.rule_id && rules.byKey[stage.rule_id]) deleteRecords_(rules, [rules.byKey[stage.rule_id]]);
  deleteRecords_(stages, [stages.byKey[stage.stage_id]]);
  ctx.invalidate();
  // 既定ルールを持っていた段階を消した場合は、残った最初の段階のルールを既定にする
  var after = collectEvent_(ctx, before.event_id);
  if (before.rule_id === after.event.rule_id && after.stages.length && after.stages[0].rule_id !== before.rule_id) {
    var events = ctx.table('Events');
    var ev = events.byKey[before.event_id];
    ev.rule_id = after.stages[0].rule_id;
    ev.rev = (ev.rev || 0) + 1;
    ev.updated_at = ctx.now;
    updateRecord_(events, ev);
    ctx.invalidate();
  }
  recordHistory_(ctx, 'stage.delete', 'Stage', before.stage_id, before.event_id, before, null);
  return { eventId: before.event_id };
}

/* ---------- ロビン・リーグ（グループ） ---------- */

function assertNotAdvanced_(stage) {
  if (stageConfig_(stage).advanced) throw appError_('LOCKED', '進出確定後はこの段階を変更できません。先に「進出を取り消す」を行ってください。');
}

/** グループ数（ロビン）・ディビジョン数（リーグ、v0.8）を変える。対戦カード作成前だけ */
function actionSetGroupCount_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'robin');
  var count = parseGroupCount_(payload.count);
  if (stageMatchesOf_(bundle, stage).length) {
    throw appError_('LOCKED', '対戦カード作成後は' + (stage.type === STAGE_TYPE.LEAGUE ? 'ディビジョン数' : 'グループ数') + 'を変更できません。先に対戦カードを削除してください。');
  }
  assertNotAdvanced_(stage);
  var groups = ctx.table('Groups');
  var current = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  if (count > current.length) {
    appendRecords_(groups, newGroupRecords_(ctx, eventId, stage.stage_id, count - current.length, Object.assign({}, groups.byKey), current.length, stage.type, count));
    // リーグを 1 → 複数ディビジョンにしたとき、既定の名前「リーグ」を「ディビジョン1」にそろえる
    if (stage.type === STAGE_TYPE.LEAGUE && current.length === 1 && current[0].name === 'リーグ') {
      var g0 = groups.byKey[current[0].group_id];
      g0.name = 'ディビジョン1';
      g0.rev = (g0.rev || 0) + 1;
      g0.updated_at = ctx.now;
      updateRecord_(groups, g0);
    }
  } else if (count < current.length) {
    var removed = current.slice(count);
    var removedIds = {};
    removed.forEach(function (g) {
      removedIds[g.group_id] = true;
    });
    var entries = ctx.table('Entries');
    deleteRecords_(entries, entries.rows.filter(function (e) {
      return removedIds[e.group_id];
    }));
    deleteRecords_(groups, removed.map(function (g) {
      return groups.byKey[g.group_id];
    }));
  }
  recordHistory_(ctx, 'group.count', 'Stage', stage.stage_id, eventId, { count: current.length }, { count: count });
  return { eventId: eventId };
}

function actionRenameGroup_(ctx, payload) {
  var groups = ctx.table('Groups');
  var group = findRecord_(groups, requireId_(payload.groupId, 'グループ'), 'グループ');
  assertRev_(group, requireRev_(payload.rev), 'グループ');
  var before = plain_(group);
  group.name = cleanText_(payload.name, 'グループ名', ADMIN_CONFIG.MAX_LABEL_LENGTH);
  group.rev = (group.rev || 0) + 1;
  group.updated_at = ctx.now;
  updateRecord_(groups, group);
  recordHistory_(ctx, 'group.rename', 'Group', group.group_id, group.event_id, before, plain_(group));
  return { eventId: group.event_id };
}

function newEntry_(ctx, stage, groupId, playerId, seed, taken, sourceLabel) {
  var id = newId_('ENT', taken);
  taken[id] = true;
  return {
    entry_id: id,
    event_id: stage.event_id,
    stage_id: stage.stage_id,
    group_id: groupId || '',
    player_id: playerId,
    seed: seed,
    manual_order: null,
    source_label: sourceLabel || '',
    start_round: null,
    meta_json: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
}

function actionAssignPlayer_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var player = findRecord_(ctx.table('Players'), requireId_(payload.playerId, '選手'), '選手');
  if (player.event_id !== eventId) throw appError_('BAD_REQUEST', '選手と大会の組み合わせが不正です。');
  var groupId = payload.groupId ? requireId_(payload.groupId, 'グループ') : '';
  var stage;
  var target = null;
  if (groupId) {
    target = bundle.groups.filter(function (g) {
      return g.group_id === groupId;
    })[0];
    if (!target) throw appError_('NOT_FOUND', 'グループが見つかりません。');
    stage = bundle.stageById[target.stage_id];
    if (payload.stageId && payload.stageId !== stage.stage_id) throw appError_('BAD_REQUEST', 'グループと段階の組み合わせが不正です。');
  } else {
    stage = resolveStage_(bundle, payload, 'group');
  }
  if (!isGroupStage_(stage)) throw appError_('BAD_REQUEST', 'この操作はロビン・リーグの段階でのみ使えます。');
  assertNotAdvanced_(stage);
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.player_id === player.player_id && e.stage_id === stage.stage_id;
  });
  var affected = {};
  if (groupId) affected[groupId] = true;
  current.forEach(function (e) {
    affected[e.group_id] = true;
  });
  var locked = bundle.matches.some(function (m) {
    return m.stage_id === stage.stage_id && affected[m.group_id];
  });
  if (locked) {
    throw appError_('LOCKED', '対戦カード作成済みのグループの所属は変更できません。先にそのグループの対戦カードを削除してください。');
  }
  if (current.length === 1 && current[0].group_id === groupId) return { eventId: eventId };
  deleteRecords_(entries, current);
  ctx.invalidate('Entries');
  if (target) {
    var seed = bundle.entries.filter(function (e) {
      return e.group_id === groupId;
    }).length + 1;
    appendRecords_(ctx.table('Entries'), [newEntry_(ctx, stage, groupId, player.player_id, seed, Object.assign({}, ctx.table('Entries').byKey))]);
  }
  ctx.invalidate();
  recordHistory_(ctx, 'entry.assign', 'Player', player.player_id, eventId, { groups: current.map(function (e) { return e.group_id; }) }, { group: groupId, stage: stage.stage_id });
  return { eventId: eventId };
}

/** 棄権・失格した選手（meta_json.withdrawn）。以後の組み合わせ・節の参加から外す */
function isWithdrawn_(player) {
  return !!(player && playerMeta_(player).withdrawn);
}

/**
 * 選手を段階のグループに配る（v0.8: 登録順・抽選・組分け〈シード・Rt・所属〉）。
 * 既存の割り当てを消して作り直す。スイス式は 1 グループに全員、シリーズは参加者名簿（グループなし）に全員。
 */
function assignAllRoundRobin_(ctx, bundle, stage, opts) {
  var entries = ctx.table('Entries');
  deleteRecords_(entries, entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  }));
  var groups = bundle.groups.filter(function (g) {
    return g.stage_id === stage.stage_id;
  });
  var players = bundle.players.filter(function (p) {
    return !isWithdrawn_(p);
  });
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var records = [];
  var report = null;
  if (stage.type === STAGE_TYPE.SERIES) {
    players
      .slice()
      .sort(function (a, b) {
        return (a.seed || 999) - (b.seed || 999) || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
      })
      .forEach(function (p, i) {
        records.push(newEntry_(ctx, stage, '', p.player_id, i + 1, taken));
      });
  } else {
    var input = players
      .slice()
      .sort(function (a, b) {
        return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
      })
      .map(function (p, i) {
        return { id: p.player_id, affiliation: p.affiliation || '', rating: p.rating, ratingValue: parseRating_(p.rating), seed: p.seed || null, order: i };
      });
    var result = assignGroups_(input, groups.length, opts || {});
    report = result.report;
    result.groups.forEach(function (ids, gi) {
      ids.forEach(function (pid, k) {
        records.push(newEntry_(ctx, stage, groups[gi].group_id, pid, k + 1, taken));
      });
    });
  }
  appendRecords_(ctx.table('Entries'), records);
  return { records: records, report: report };
}

/**
 * 自動割り当て（F01・F16・F17）。method = registration（登録順）/ random（抽選）/ balanced（組分け）
 * 対戦カードを作る前だけ。やり直す（再抽選）ときは、画面で確認してから confirmRedraw: true を送る。
 * 抽選の結果は Entries に保存するので、画面を読み直しても変わらない。
 */
function actionAutoAssign_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'assign');
  if (stageMatchesOf_(bundle, stage).length) {
    throw appError_('LOCKED', '対戦カード作成後は自動割り当てできません。先に対戦カードを削除してください。');
  }
  assertNotAdvanced_(stage);
  if (stage.type !== STAGE_TYPE.SERIES && !bundle.groups.some(function (g) { return g.stage_id === stage.stage_id; })) throw appError_('VALIDATION', 'グループがありません。');
  if (!bundle.players.length) throw appError_('VALIDATION', '選手が登録されていません。');
  var method = payload.method === 'random' || payload.method === 'balanced' ? payload.method : 'registration';
  var already = bundle.entries.some(function (e) {
    return e.stage_id === stage.stage_id;
  });
  if (already && method !== 'registration' && payload.confirmRedraw !== true) {
    throw appError_('CONFIRM_REQUIRED', 'すでに割り当てがあります。抽選し直すと今の割り当ては置き換わります。よろしければ「抽選し直す」を押してください。');
  }
  var opts = {
    method: method,
    useSeeds: payload.useSeeds === true,
    useRating: payload.useRating === true,
    spreadAffiliation: payload.spreadAffiliation === true,
  };
  var res = assignAllRoundRobin_(ctx, bundle, stage, opts);
  var cfg = stageConfig_(stage);
  var stageRec = ctx.table('Stages').byKey[stage.stage_id];
  var raw = safeJson_(stageRec.config_json, {});
  raw.lastDraw = { method: method, at: ctx.now, by: ctx.user ? ctx.user.label : '', options: opts, report: res.report };
  saveStageRaw_(ctx, stageRec, raw);
  recordHistory_(ctx, method === 'registration' ? 'entry.autoAssign' : 'entry.draw', 'Stage', stage.stage_id, eventId, null, {
    assigned: res.records.length,
    method: method,
    options: opts,
    report: res.report,
    groups: res.records.map(function (e) {
      return [e.player_id, e.group_id];
    }),
  });
  void cfg;
  return { eventId: eventId, report: res.report, assigned: res.records.length };
}

function blankMatch_(ctx, stage, groupId, id) {
  return {
    match_id: id,
    event_id: stage.event_id,
    stage_id: stage.stage_id,
    group_id: groupId || '',
    round: 1,
    order: 1,
    player1_id: '',
    player2_id: '',
    player1_legs: 0,
    player2_legs: 0,
    player1_sets: 0,
    player2_sets: 0,
    label: '',
    status: MATCH_STATUS.SCHEDULED,
    winner_id: '',
    rule_id: '',
    next_match_id: '',
    next_match_slot: null,
    loser_next_match_id: '',
    loser_next_match_slot: null,
    external_ref: '',
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
    confirmed_at: '',
    result_type: '',
    result_note: '',
    schedule_json: '',
    bracket_side: '',
    meta_json: '',
  };
}

function generateGroupMatches_(ctx, bundle, group, taken) {
  var stage = bundle.stageById[group.stage_id];
  var members = bundle.entries
    .filter(function (e) {
      return e.group_id === group.group_id;
    })
    .map(function (e) {
      return e.player_id;
    });
  return roundRobinPairings_(members, stageConfig_(stage).cycles).map(function (p) {
    var id = newId_('MAT', taken);
    taken[id] = true;
    var m = blankMatch_(ctx, stage, group.group_id, id);
    m.round = p.round;
    m.order = p.order;
    m.player1_id = p.p1;
    m.player2_id = p.p2;
    return m;
  });
}

function actionGenerateMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var targets;
  if (payload.groupId) {
    var gid = requireId_(payload.groupId, 'グループ');
    targets = bundle.groups.filter(function (g) {
      return g.group_id === gid;
    });
    if (!targets.length) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  } else {
    var stage = resolveStage_(bundle, payload, 'group');
    targets = bundle.groups.filter(function (g) {
      return g.stage_id === stage.stage_id;
    });
  }
  var targetStage = targets.length ? bundle.stageById[targets[0].stage_id] : null;
  if (targetStage && targetStage.type === STAGE_TYPE.SWISS) {
    throw appError_('BAD_REQUEST', 'スイス式は 1 回戦ずつ組みます。「次の回戦を組む」を使ってください。');
  }
  if (targetStage && !isRoundRobinStage_(targetStage)) throw appError_('BAD_REQUEST', 'この操作はロビン・リーグの段階でのみ使えます。');
  var matchesTable = ctx.table('Matches');
  var taken = Object.assign({}, matchesTable.byKey);
  var created = [];
  var skipped = [];
  targets.forEach(function (g) {
    if (bundle.matches.some(function (m) { return m.group_id === g.group_id; })) {
      skipped.push(g.name + '（作成済み）');
      return;
    }
    var list = generateGroupMatches_(ctx, bundle, g, taken);
    if (!list.length) {
      skipped.push(g.name + '（選手 2 名未満）');
      return;
    }
    created = created.concat(list);
  });
  appendRecords_(matchesTable, created);
  ctx.invalidate();
  if (created.length) recordHistory_(ctx, 'match.generate', 'Stage', targets[0] ? targets[0].stage_id : '', eventId, null, { created: created.length });
  return { eventId: eventId, created: created.length, skipped: skipped };
}

function actionClearMatches_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var gid = requireId_(payload.groupId, 'グループ');
  var group = findRecord_(ctx.table('Groups'), gid, 'グループ');
  if (group.event_id !== eventId) throw appError_('NOT_FOUND', 'グループが見つかりません。');
  var stage = findRecord_(ctx.table('Stages'), group.stage_id, '段階');
  assertNotAdvanced_(stage);
  var matchesTable = ctx.table('Matches');
  var targets = matchesTable.rows.filter(function (m) {
    return m.event_id === eventId && m.group_id === gid;
  });
  if (!targets.length) return { eventId: eventId, removed: 0 };
  if (targets.some(matchStarted_)) {
    throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  }
  deleteRecords_(matchesTable, targets);
  ctx.invalidate();
  recordHistory_(ctx, 'match.clear', 'Group', gid, eventId, { removed: targets.length }, null);
  return { eventId: eventId, removed: targets.length };
}

/**
 * 同順位の選手の順番を主催者が決める（playerIds の並び順。空配列で解除）。
 * groupId を指定するとそのグループ、シリーズ（段階全体の累計順位）は groupId を省いて stageId を指定する。
 */
function actionSetManualOrder_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var entries = ctx.table('Entries');
  var members;
  var stage;
  var scope;
  if (payload.groupId) {
    var gid = requireId_(payload.groupId, 'グループ');
    var group = findRecord_(ctx.table('Groups'), gid, 'グループ');
    if (group.event_id !== eventId) throw appError_('NOT_FOUND', 'グループが見つかりません。');
    stage = findRecord_(ctx.table('Stages'), group.stage_id, '段階');
    if (stage.type === STAGE_TYPE.SERIES) throw appError_('BAD_REQUEST', 'シリーズの順位は段階全体で決めます（節ごとには決めません）。');
    members = entries.rows.filter(function (e) {
      return e.group_id === gid;
    });
    scope = gid;
  } else {
    stage = findRecord_(ctx.table('Stages'), requireId_(payload.stageId, '段階'), '段階');
    if (stage.event_id !== eventId || stage.type !== STAGE_TYPE.SERIES) throw appError_('BAD_REQUEST', 'グループを指定してください。');
    members = entries.rows.filter(function (e) {
      return e.stage_id === stage.stage_id && !e.group_id;
    });
    scope = stage.stage_id;
  }
  assertNotAdvanced_(stage);
  if (!Array.isArray(payload.playerIds) || payload.playerIds.length > ADMIN_CONFIG.MAX_PLAYERS_PER_EVENT) throw appError_('BAD_REQUEST', '選手の指定が不正です。');
  var byPlayer = {};
  members.forEach(function (e) {
    byPlayer[e.player_id] = e;
  });
  var seen = {};
  payload.playerIds.forEach(function (pid) {
    if (!isValidId_(pid) || !byPlayer[pid] || seen[pid]) throw appError_('BAD_REQUEST', 'このグループの選手を指定してください。');
    seen[pid] = true;
  });
  members.forEach(function (e) {
    var idx = payload.playerIds.indexOf(e.player_id);
    var next = payload.playerIds.length === 0 ? null : idx === -1 ? e.manual_order : idx + 1;
    if (next !== e.manual_order) {
      e.manual_order = next;
      e.rev = (e.rev || 0) + 1;
      e.updated_at = ctx.now;
      updateRecord_(entries, e);
    }
  });
  recordHistory_(ctx, 'entry.manualOrder', 'Group', scope, eventId, null, { order: payload.playerIds });
  return { eventId: eventId };
}

/* ---------- 進出（ロビン・リーグ・スイス式・シリーズ → 次の段階） ---------- */

/** 進出元の順位（グループごと）。シリーズは段階全体で 1 つ */
function sourceRankings_(stageView) {
  if (stageView.type === STAGE_TYPE.SERIES) {
    return [{ groupId: '', name: stageView.name, index: 0, standings: stageView.standings || [] }];
  }
  return (stageView.groups || []).map(function (g, gi) {
    return { groupId: g.id, name: g.name, index: gi, standings: g.standings };
  });
}

/**
 * 進出の計画（確定・プレビューで共通）。書き込みはしない。
 * - 同順位が進出の境目をまたいでいたら止める（主催者が手動で順位を決める。名前順などで勝手に決めない）
 * - 進出先がトーナメント・ダブルエリミ: 直接出場の選手（あらかじめ登録）を残し、その後に「順位 → グループ」の順でシード
 *   直接出場と進出者の重複、決勝の枠数の超過は止める
 * - 進出先がロビン・リーグ: 進出者を各グループへ配る（順位の帯ごとに蛇行。同じ進出元のグループの選手を同じ組にしない）
 * - 進出先がスイス式・シリーズ: 全員を 1 つの組（参加者名簿）へ
 * 戻り値: { targets: [{ stage, rows: [{ playerId, groupId, seed, label, sourceGroupId, sourceRank, direct }], report }] }
 */
function planAdvancement_(bundle, stage) {
  var cfg = stageConfig_(stage);
  if (!cfg.advancement.length) throw appError_('VALIDATION', '進出ルールが設定されていません。「形式」タブで設定してください。');
  var view = buildEventView_(bundle, true).stages.filter(function (st) {
    return st.id === stage.stage_id;
  })[0];
  var matches = stageMatchesOf_(bundle, stage);
  if (stage.type === STAGE_TYPE.SERIES) {
    if (!view.complete) throw appError_('LOCKED', 'すべての節が終わってから（または中止にしてから）進出を確定してください。' + (view.completion ? view.completion.reason : ''));
  } else {
    var real = matches.filter(function (m) {
      return m.result_type !== RESULT_TYPE.BYE;
    });
    if (!real.length || real.some(function (m) { return m.status !== MATCH_STATUS.FINAL; })) {
      throw appError_('LOCKED', 'すべての試合が確定してから進出を確定してください。');
    }
    if (stage.type === STAGE_TYPE.SWISS && !view.complete) throw appError_('LOCKED', '予定の回戦がすべて終わってから進出を確定してください。' + view.completion.reason);
  }
  if (view.progress.check) throw appError_('LOCKED', '「要確認」の試合があります。先に結果を直してください。');
  var rankings = sourceRankings_(view);
  var byTarget = {};
  var order = [];
  cfg.advancement.forEach(function (rule) {
    var target = bundle.stageById[rule.targetStageId];
    if (!target) throw appError_('DATA_CONFLICT', '進出先の段階が見つかりません。');
    if (stageMatchesOf_(bundle, target).length) throw appError_('LOCKED', '進出先「' + target.name + '」には対戦カードがあります。先に削除してください。');
    if (!byTarget[target.stage_id]) {
      byTarget[target.stage_id] = [];
      order.push(target.stage_id);
    }
    rankings.forEach(function (g) {
      // 同順位の塊が進出の境目をまたいでいたら、手動で順位を決めてもらう
      g.standings.forEach(function (row) {
        if (!row.tied) return;
        var size = g.standings.filter(function (x) {
          return x.rank === row.rank;
        }).length;
        var last = row.rank + size - 1;
        var inside = row.rank >= rule.fromRank && last <= rule.toRank;
        var outside = last < rule.fromRank || row.rank > rule.toRank;
        if (!inside && !outside) {
          throw appError_('TIE', g.name + ' に同順位（' + row.rank + '位）の選手がいて進出者が決まりません。「組み合わせ」タブで順位を手動で決めてください。');
        }
      });
      g.standings.forEach(function (row) {
        if (row.rank >= rule.fromRank && row.rank <= rule.toRank) {
          var label = stage.type === STAGE_TYPE.SERIES ? stage.name + ' ' + row.rank + '位' : (rankings.length > 1 || stage.type !== STAGE_TYPE.SWISS ? g.name + ' ' : '') + row.rank + '位';
          byTarget[target.stage_id].push({ playerId: row.playerId, rank: row.rank, groupIndex: g.index, sourceGroupId: g.groupId, label: label });
        }
      });
    });
  });
  var targets = order.map(function (targetId) {
    var target = bundle.stageById[targetId];
    var tcfg = stageConfig_(target);
    var list = byTarget[targetId].sort(function (a, b) {
      return a.rank - b.rank || a.groupIndex - b.groupIndex;
    });
    var rows = [];
    var report = { notes: [] };
    if (target.type === STAGE_TYPE.SINGLE_ELIMINATION || target.type === STAGE_TYPE.DOUBLE_ELIMINATION) {
      var direct = bundle.entries
        .filter(function (e) {
          return e.stage_id === targetId && entryMeta_(e).direct === true;
        })
        .sort(function (a, b) {
          return (a.seed || 0) - (b.seed || 0);
        });
      var directIds = {};
      direct.forEach(function (e) {
        directIds[e.player_id] = true;
      });
      list.forEach(function (r) {
        if (directIds[r.playerId]) {
          var p = bundle.players.filter(function (x) {
            return x.player_id === r.playerId;
          })[0];
          throw appError_('VALIDATION', (p ? p.display_name : '選手') + ' は「' + target.name + '」の直接出場者に登録されていて、進出者と重複しています。どちらかを外してください。');
        }
      });
      direct.forEach(function (e, i) {
        rows.push({ playerId: e.player_id, groupId: '', seed: i + 1, label: e.source_label || '直接出場', direct: true, startRound: e.start_round || 1 });
      });
      list.forEach(function (r) {
        rows.push({ playerId: r.playerId, groupId: '', seed: rows.length + 1, label: r.label, sourceGroupId: r.sourceGroupId, sourceRank: r.rank });
      });
      if (tcfg.maxEntrants && rows.length > tcfg.maxEntrants) {
        throw appError_('VALIDATION', '「' + target.name + '」の枠は ' + tcfg.maxEntrants + ' 人ですが、直接出場 ' + direct.length + ' 人 + 進出 ' + list.length + ' 人 = ' + rows.length + ' 人になります。進出ルールか枠数を見直してください。');
      }
      if (direct.length) report.notes.push('直接出場 ' + direct.length + ' 人を上位シードに置き、続けて進出者を「順位 → グループ」の順に並べます。');
    } else if (isRoundRobinStage_(target)) {
      var groups = bundle.groups
        .filter(function (g) {
          return g.stage_id === targetId;
        })
        .sort(byOrder_);
      if (!groups.length) throw appError_('VALIDATION', '進出先「' + target.name + '」にグループがありません。');
      var res = assignGroups_(
        list.map(function (r, i) {
          return { id: r.playerId, affiliation: r.sourceGroupId, seed: i + 1, order: i };
        }),
        groups.length,
        tcfg.distribution === 'rank' ? { method: 'registration' } : { method: 'balanced', useSeeds: true, spreadAffiliation: true }
      );
      var info = {};
      list.forEach(function (r) {
        info[r.playerId] = r;
      });
      res.groups.forEach(function (ids, gi) {
        if (ids.length < 2) throw appError_('VALIDATION', '進出先「' + target.name + '」の' + groups[gi].name + 'が ' + ids.length + ' 人になります（総当たりには 2 人以上必要）。グループ数か進出人数を見直してください。');
        ids.forEach(function (pid, k) {
          rows.push({ playerId: pid, groupId: groups[gi].group_id, seed: k + 1, label: info[pid].label, sourceGroupId: info[pid].sourceGroupId, sourceRank: info[pid].rank });
        });
      });
      report.notes.push('進出者を順位の帯ごとに蛇行の順で配り、同じ進出元のグループの選手がなるべく同じ組にならないようにしました。前の段階の成績は持ち越しません。');
      if (res.report.clashes) report.notes.push('同じ進出元のグループの選手が同じ組になった組み合わせが ' + res.report.clashes + ' 組あります（人数の均衡と順位の帯を優先しました）。');
    } else {
      var g1 = bundle.groups.filter(function (g) {
        return g.stage_id === targetId;
      })[0];
      list.forEach(function (r) {
        rows.push({ playerId: r.playerId, groupId: target.type === STAGE_TYPE.SERIES ? '' : g1 ? g1.group_id : '', seed: rows.length + 1, label: r.label, sourceGroupId: r.sourceGroupId, sourceRank: r.rank });
      });
    }
    return { stage: target, rows: rows, report: report };
  });
  return { targets: targets };
}

/** 進出の確認（プレビュー）: 誰がどこへ、どのシード・組に入るか。書き込みはしない */
function actionPreviewAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'rankable');
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var groupName = {};
  bundle.groups.forEach(function (g) {
    groupName[g.group_id] = g.name;
  });
  try {
    var plan = planAdvancement_(bundle, stage);
    return {
      ok: true,
      targets: plan.targets.map(function (t) {
        return {
          stageId: t.stage.stage_id,
          name: t.stage.name,
          type: t.stage.type,
          notes: t.report.notes,
          rows: t.rows.map(function (r) {
            return { playerId: r.playerId, name: nameOf[r.playerId] || '', seed: r.seed, label: r.label, group: r.groupId ? groupName[r.groupId] || '' : '', direct: !!r.direct };
          }),
        };
      }),
    };
  } catch (e) {
    if (!e.appCode) throw e;
    return { ok: false, code: e.appCode, message: e.publicMessage };
  }
}

function actionConfirmAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'rankable');
  var cfg = stageConfig_(stage);
  if (cfg.advanced) throw appError_('LOCKED', 'この段階の進出は確定済みです。');
  var plan = planAdvancement_(bundle, stage);
  var entries = ctx.table('Entries');
  var taken = Object.assign({}, entries.byKey);
  var added = [];
  plan.targets.forEach(function (t) {
    // 直接出場の選手は残し、それ以外（前回の進出者・手で入れた選手）を入れ替える
    deleteRecords_(entries, entries.rows.filter(function (e) {
      return e.stage_id === t.stage.stage_id && !(entryMeta_(e).direct === true && isBracketStage_(t.stage));
    }));
    t.rows.forEach(function (r) {
      if (r.direct) {
        var keep = entries.rows.filter(function (e) {
          return e.stage_id === t.stage.stage_id && e.player_id === r.playerId;
        })[0];
        if (keep && keep.seed !== r.seed) {
          keep.seed = r.seed;
          keep.rev = (keep.rev || 0) + 1;
          keep.updated_at = ctx.now;
          updateRecord_(entries, keep);
        }
        return;
      }
      var e = newEntry_(ctx, t.stage, r.groupId, r.playerId, r.seed, taken, r.label);
      e.meta_json = JSON.stringify({ sourceGroupId: r.sourceGroupId || '', sourceRank: r.sourceRank || null, fromStageId: stage.stage_id });
      added.push(e);
    });
  });
  appendRecords_(entries, added);
  cfg.advanced = true;
  cfg.advancedAt = ctx.now;
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg, ['advanced', 'advancedAt']);
  recordHistory_(ctx, 'stage.advance', 'Stage', stage.stage_id, eventId, null, {
    advanced: added.length,
    targets: plan.targets.map(function (t) {
      return { stageId: t.stage.stage_id, rows: t.rows.map(function (r) { return [r.playerId, r.seed, r.groupId, r.label]; }) };
    }),
  });
  return { eventId: eventId, advanced: added.length };
}

function actionUndoAdvancement_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'rankable');
  var cfg = stageConfig_(stage);
  if (!cfg.advanced) return { eventId: eventId };
  var targets = {};
  cfg.advancement.forEach(function (r) {
    targets[r.targetStageId] = true;
  });
  var targetMatches = bundle.matches.filter(function (m) {
    return targets[m.stage_id];
  });
  if (targetMatches.some(function (m) { return matchStarted_(m) && m.result_type !== RESULT_TYPE.BYE; })) {
    throw appError_('LOCKED', '進出先の段階で結果が入力されているため取り消せません。先に進出先の結果を「未開始」に戻してください。');
  }
  deleteRecords_(ctx.table('Matches'), ctx.table('Matches').rows.filter(function (m) {
    return targets[m.stage_id];
  }));
  // 直接出場の選手（進出とは別に登録したもの）は残す
  deleteRecords_(ctx.table('Entries'), ctx.table('Entries').rows.filter(function (e) {
    return targets[e.stage_id] && entryMeta_(e).direct !== true;
  }));
  cfg.advanced = false;
  cfg.advancedAt = '';
  saveStage_(ctx, ctx.table('Stages').byKey[stage.stage_id], cfg, ['advanced', 'advancedAt']);
  recordHistory_(ctx, 'stage.undoAdvance', 'Stage', stage.stage_id, eventId, null, { removedMatches: targetMatches.length });
  return { eventId: eventId };
}

/* ---------- トーナメント・ダブルエリミネーション ---------- */

/**
 * 出場者とシード順を決める（並び = シード 1, 2, 3…）。表の作成前のみ。
 * payload.playerIds（従来）か payload.entrants = [{ playerId, startRound?, direct? }]（v0.8: 途中回戦から出場するシード・直接出場）
 */
function actionSetEntrants_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', 'トーナメント表の作成後は出場者を変更できません。先にトーナメント表を削除してください。');
  var cfg = stageConfig_(stage);
  var list = Array.isArray(payload.entrants)
    ? payload.entrants
    : Array.isArray(payload.playerIds)
      ? payload.playerIds.map(function (pid) {
          return { playerId: pid };
        })
      : null;
  if (!list || list.length > ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS) {
    throw appError_('VALIDATION', '出場者は ' + ADMIN_CONFIG.MAX_ELIMINATION_ENTRANTS + ' 名までです。');
  }
  if (cfg.maxEntrants && list.length > cfg.maxEntrants) throw appError_('VALIDATION', 'この段階の枠は ' + cfg.maxEntrants + ' 人です（' + list.length + ' 人が指定されました）。');
  var playerIds = {};
  bundle.players.forEach(function (p) {
    playerIds[p.player_id] = true;
  });
  // 直接出場は、前の段階（この段階へ進出させる段階）の参加者とは重ならないようにする
  var feederMembers = {};
  bundle.stages.forEach(function (st) {
    if (!stageConfig_(st).advancement.some(function (r) { return r.targetStageId === stage.stage_id; })) return;
    bundle.entries.forEach(function (e) {
      if (e.stage_id === st.stage_id) feederMembers[e.player_id] = st.name;
    });
  });
  var seen = {};
  var parsed = list.map(function (x) {
    var pid = x && x.playerId;
    if (!isValidId_(pid) || !playerIds[pid] || seen[pid]) throw appError_('BAD_REQUEST', '出場者の指定が不正です。');
    seen[pid] = true;
    var startRound = x.startRound === undefined || x.startRound === null || x.startRound === '' ? 1 : parseSmallInt_(x.startRound, '出場する回戦', 1, 8, 1);
    if (startRound > 1 && stage.type === STAGE_TYPE.DOUBLE_ELIMINATION) throw appError_('VALIDATION', 'ダブルエリミネーションでは途中の回戦から出場するシードは指定できません。');
    var direct = x.direct === true;
    if (direct && feederMembers[pid]) {
      var p = bundle.players.filter(function (y) {
        return y.player_id === pid;
      })[0];
      throw appError_('VALIDATION', (p ? p.display_name : '選手') + ' は「' + feederMembers[pid] + '」の参加者なので、直接出場にはできません（進出で入ります）。');
    }
    return { playerId: pid, startRound: startRound, direct: direct };
  });
  var entries = ctx.table('Entries');
  var current = entries.rows.filter(function (e) {
    return e.stage_id === stage.stage_id;
  });
  var prev = {};
  current.forEach(function (e) {
    prev[e.player_id] = e;
  });
  deleteRecords_(entries, current);
  var taken = Object.assign({}, ctx.table('Entries').byKey);
  var records = parsed.map(function (x, i) {
    var old = prev[x.playerId];
    var meta = old ? entryMeta_(old) : {};
    if (x.direct) meta.direct = true;
    else delete meta.direct;
    var label = x.direct ? '直接出場' : old && old.source_label !== '直接出場' ? old.source_label : '';
    var e = newEntry_(ctx, stage, '', x.playerId, i + 1, taken, label);
    e.start_round = x.startRound > 1 ? x.startRound : null;
    e.meta_json = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return e;
  });
  appendRecords_(ctx.table('Entries'), records);
  recordHistory_(ctx, 'entry.seed', 'Stage', stage.stage_id, eventId, null, { entrants: parsed });
  return { eventId: eventId };
}

/**
 * トーナメント表の計画（作成・プレビューで共通。書き込みはしない）。
 * 戻り値: { matches: 試合の元データ, order: シードを付け直した並び（同組の初戦回避の結果）, conflicts, problems, notes, drawn }
 */
function bracketPlanFor_(bundle, stage) {
  var cfg = stageConfig_(stage);
  var rule = stageRule_(bundle, stage);
  var problems = [];
  var notes = [];
  if (rule && rule.format === RULE_FORMAT.FIXED_LEGS) problems.push('この段階のルールが固定 Leg 数（引き分けあり）です。勝ち抜き戦では使えないので、「形式」タブで Leg 制かセット制にしてください。');
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var list = bundle.entries
    .filter(function (e) {
      return e.stage_id === stage.stage_id;
    })
    .sort(function (a, b) {
      return (a.seed || 0) - (b.seed || 0);
    })
    .map(function (e, i) {
      var meta = entryMeta_(e);
      return { id: e.player_id, seed: i + 1, startRound: e.start_round || 1, label: nameOf[e.player_id] || '', group: meta.sourceGroupId || '', tier: meta.sourceRank || (meta.direct ? 0 : null) };
    });
  if (list.length < 2) problems.push('出場者が 2 名以上必要です。');
  var withdrawn = bundle.players.filter(function (p) {
    return isWithdrawn_(p) && list.some(function (x) { return x.id === p.player_id; });
  });
  if (withdrawn.length) notes.push('棄権・失格した選手が出場者にいます（' + withdrawn.map(function (p) { return p.display_name; }).join('、') + '）。表を作ると、その選手の試合は不戦勝として扱います。');
  var out = { matches: [], order: list.map(function (x) { return x.id; }), conflicts: [], problems: problems, notes: notes, drawn: false, list: list };
  if (problems.length) return out;
  if (stage.type === STAGE_TYPE.DOUBLE_ELIMINATION) {
    var de = planDoubleElimination_(list, { grandFinal: cfg.grandFinal });
    out.matches = de.matches;
    out.problems = out.problems.concat(de.problems);
    notes.push('勝者側 ' + de.winnerRounds + ' 回戦・敗者側 ' + de.loserRounds + ' 回戦・グランドファイナル' + (cfg.grandFinal === 'reset' ? '（敗者側の選手が勝てばリセットの決勝をもう 1 試合）' : '（1 試合のみ。勝者側の優勝者もここで負けると 1 敗で敗退します）') + '。');
    return out;
  }
  if (cfg.drawMode === 'redraw') {
    var sched = redrawSchedule_(list, cfg.fixedRounds);
    out.problems = out.problems.concat(sched.problems);
    out.schedule = sched.rounds;
    if (out.problems.length) return out;
    var first = list.filter(function (x) {
      return x.startRound <= 1 || x.startRound <= cfg.fixedRounds;
    });
    if (cfg.fixedRounds > 0) {
      var fixed = planSingleElimination_(first, { lastRound: cfg.fixedRounds });
      out.matches = fixed.matches;
      notes.push('1〜' + cfg.fixedRounds + ' 回戦は固定の表で行い、' + (cfg.fixedRounds + 1) + ' 回戦からは前の回戦が終わるたびに主催者が抽選します。');
    } else {
      out.drawn = true;
      var pool = shuffle_(first.map(function (x) { return x.id; }));
      for (var i = 0; i < pool.length; i += 2) {
        out.matches.push({ key: '1-' + i / 2, round: 1, order: i / 2 + 1, label: redrawRoundLabel_(pool.length, 1), p1: pool[i], p2: pool[i + 1], nextKey: '', nextSlot: null, loserNextKey: '', loserNextSlot: null, meta: { draw: true } });
      }
      notes.push('1 回戦から、回戦ごとに抽選します（次の回戦は前の回戦がすべて確定した後に主催者が抽選）。');
    }
    return out;
  }
  // 固定の表: 同じ予選グループの選手が 1 回戦で当たらないように（同じ順位の帯の中だけで入れ替える）
  var ordered = list;
  if (cfg.avoidSameGroup && list.some(function (x) { return x.group; })) {
    var avoided = avoidSameGroupFirstRound_(list, function (x) {
      return x.tier === null || x.tier === undefined ? 'n' : String(x.tier);
    });
    ordered = avoided.order;
    out.conflicts = avoided.conflicts;
    if (avoided.swaps) notes.push('同じ予選グループの選手が 1 回戦で当たらないよう、同じ順位の選手どうしのシードを ' + avoided.swaps + ' 回入れ替えました。');
    if (avoided.conflicts.length) {
      notes.push(
        '次の組み合わせは同じ予選グループどうしのまま残りました（シードの順位の帯を保つと避けられません）: ' +
          avoided.conflicts
            .map(function (c) {
              return (nameOf[c[0]] || '?') + ' vs ' + (nameOf[c[1]] || '?');
            })
            .join('、') +
          '。必要なら「出場者とシード」で手で並べ替えてください。'
      );
    }
  }
  var seeded = ordered.map(function (x, i) {
    return { id: x.id, seed: i + 1, startRound: x.startRound, label: x.label };
  });
  var plan = planSingleElimination_(seeded, { thirdPlace: cfg.thirdPlace });
  out.problems = out.problems.concat(plan.problems);
  out.matches = plan.matches;
  out.order = ordered.map(function (x) {
    return x.id;
  });
  var late = seeded.filter(function (x) {
    return x.startRound > 1;
  });
  if (late.length) notes.push(late.length + ' 人のシードは途中の回戦から出場します（不戦勝ではなく「シード（n 回戦から）」として表示します）。');
  return out;
}

function actionPreviewBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  var plan = bracketPlanFor_(bundle, stage);
  var nameOf = {};
  bundle.players.forEach(function (p) {
    nameOf[p.player_id] = p.display_name;
  });
  var firstRound = plan.matches
    .filter(function (m) {
      return m.round === 1 && (!m.side || m.side === 'W') && m.p1 && m.p2;
    })
    .map(function (m) {
      return { p1: nameOf[m.p1] || '', p2: nameOf[m.p2] || '' };
    });
  return {
    ok: !plan.problems.length,
    problems: plan.problems,
    notes: plan.notes,
    matchCount: plan.matches.length,
    firstRound: plan.drawn ? [] : firstRound,
    drawnAtCreate: plan.drawn,
    schedule: plan.schedule || null,
    seeds: plan.order.map(function (pid, i) {
      return { seed: i + 1, name: nameOf[pid] || '' };
    }),
  };
}

function bracketRecords_(ctx, stage, plan, extraMeta) {
  var taken = Object.assign({}, ctx.table('Matches').byKey);
  var idOf = {};
  plan.forEach(function (p) {
    idOf[p.key] = newId_('MAT', taken);
    taken[idOf[p.key]] = true;
  });
  return plan.map(function (p) {
    var m = blankMatch_(ctx, stage, p.groupId || '', idOf[p.key]);
    m.round = p.round;
    m.order = p.order;
    m.label = p.label;
    m.player1_id = p.p1;
    m.player2_id = p.p2;
    m.next_match_id = p.nextKey && idOf[p.nextKey] ? idOf[p.nextKey] : '';
    m.next_match_slot = m.next_match_id ? p.nextSlot : null;
    m.loser_next_match_id = p.loserNextKey && idOf[p.loserNextKey] ? idOf[p.loserNextKey] : '';
    m.loser_next_match_slot = m.loser_next_match_id ? p.loserNextSlot : null;
    m.bracket_side = p.side || '';
    var meta = Object.assign({}, p.meta || {}, extraMeta || {});
    m.meta_json = Object.keys(meta).length ? JSON.stringify(meta) : '';
    return m;
  });
}

function actionGenerateBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  if (stageMatchesOf_(bundle, stage).length) throw appError_('LOCKED', 'トーナメント表は作成済みです。');
  var plan = bracketPlanFor_(bundle, stage);
  if (plan.problems.length) throw appError_('VALIDATION', plan.problems.join(' / '));
  // 同組の初戦回避でシードを付け直したときは、出場者のシードも合わせる（閲覧ページのシード番号と表の位置を一致させる）
  var entries = ctx.table('Entries');
  plan.order.forEach(function (pid, i) {
    var e = entries.rows.filter(function (x) {
      return x.stage_id === stage.stage_id && x.player_id === pid;
    })[0];
    if (e && e.seed !== i + 1) {
      e.seed = i + 1;
      e.rev = (e.rev || 0) + 1;
      e.updated_at = ctx.now;
      updateRecord_(entries, e);
    }
  });
  var records = bracketRecords_(ctx, stage, plan.matches, plan.drawn ? { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '' } : null);
  appendRecords_(ctx.table('Matches'), records);
  autoForfeitWithdrawn_(ctx, eventId, stage.stage_id);
  recordHistory_(ctx, plan.drawn ? 'bracket.draw' : 'bracket.generate', 'Stage', stage.stage_id, eventId, null, {
    entrants: plan.order.length,
    matches: records.length,
    conflicts: plan.conflicts,
    notes: plan.notes,
    pairs: records.map(function (m) {
      return [m.round, m.player1_id, m.player2_id];
    }),
  });
  return { eventId: eventId, created: records.length, notes: plan.notes };
}

/**
 * 回戦ごとの抽選（v0.8、UK Open などの採用例を参考にした汎用の設定）。
 * 前の回戦がすべて確定した後に主催者が押す。勝ち残った選手と、この回戦から出場するシードを抽選で組む。
 * 抽選の結果は保存するので、画面を読み直しても変わらない。やり直しは、その回戦の試合がどれも始まっていないときだけ
 * （redo: true。前の抽選の内容は履歴に残す）。
 */
function actionDrawNextRound_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'elimination');
  var cfg = stageConfig_(stage);
  if (cfg.drawMode !== 'redraw') throw appError_('BAD_REQUEST', 'この段階は固定の表です（回戦ごとの抽選ではありません）。');
  var matchesTable = ctx.table('Matches');
  var matches = stageMatchesOf_(bundle, stage);
  if (!matches.length) throw appError_('LOCKED', '先に「トーナメント表を作成」を押してください。');
  var latest = matches.reduce(function (mx, m) {
    return Math.max(mx, m.round || 0);
  }, 0);
  var before = null;
  if (payload.redo === true) {
    var redoList = matches.filter(function (m) {
      return m.round === latest;
    });
    if (latest <= cfg.fixedRounds) throw appError_('LOCKED', '固定の表の回戦は抽選のやり直しができません。');
    if (redoList.some(matchStarted_)) throw appError_('LOCKED', latest + ' 回戦はすでに始まっている試合があるため、抽選をやり直せません。');
    before = redoList.map(function (m) {
      return [m.player1_id, m.player2_id];
    });
    deleteRecords_(matchesTable, redoList);
    matches = matches.filter(function (m) {
      return redoList.indexOf(m) === -1;
    });
    latest = latest - 1;
    if (latest === 0) {
      // 1 回戦の抽選のやり直し
      var plan1 = bracketPlanFor_(bundle, stage);
      var rec1 = bracketRecords_(ctx, stage, plan1.matches, { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '' });
      appendRecords_(matchesTable, rec1);
      recordHistory_(ctx, 'bracket.redraw', 'Stage', stage.stage_id, eventId, { round: 1, pairs: before }, { round: 1, pairs: rec1.map(function (m) { return [m.player1_id, m.player2_id]; }) });
      return { eventId: eventId, round: 1, created: rec1.length };
    }
  }
  var last = matches.filter(function (m) {
    return m.round === latest && m.label !== '3位決定戦';
  });
  if (last.some(function (m) { return m.status !== MATCH_STATUS.FINAL || !m.winner_id; })) {
    throw appError_('LOCKED', latest + ' 回戦の結果がすべて確定してから、次の回戦を抽選してください。');
  }
  if (last.length === 1 && last[0].label === '決勝') throw appError_('LOCKED', '決勝まで終わっています。');
  var entrants = bundle.entries.filter(function (e) {
    return e.stage_id === stage.stage_id;
  });
  var pool = last.map(function (m) {
    return m.winner_id;
  });
  // 固定の表の最後の回戦で、不戦（Bye）のまま勝ち残った選手
  if (latest === cfg.fixedRounds && cfg.fixedRounds > 0) {
    var listFixed = entrants
      .filter(function (e) {
        return !(e.start_round > cfg.fixedRounds);
      })
      .sort(function (a, b) {
        return (a.seed || 0) - (b.seed || 0);
      })
      .map(function (e, i) {
        return { id: e.player_id, seed: i + 1, startRound: e.start_round || 1, label: '' };
      });
    var fixedPlan = planSingleElimination_(listFixed, { lastRound: cfg.fixedRounds });
    Object.keys(fixedPlan.passes).forEach(function (key) {
      if (key.indexOf(cfg.fixedRounds + '-') === 0 && fixedPlan.passes[key].t === 'p') pool.push(fixedPlan.passes[key].id);
    });
  }
  var nextRound = latest + 1;
  entrants.forEach(function (e) {
    if (e.start_round === nextRound) pool.push(e.player_id);
  });
  if (pool.length < 2) throw appError_('LOCKED', '次の回戦に進む選手がいません。');
  if (pool.length % 2 === 1) throw appError_('VALIDATION', nextRound + ' 回戦に進む選手が ' + pool.length + ' 人（奇数）です。途中から出場するシードの人数を見直してください。');
  var drawn = shuffle_(pool);
  var label = redrawRoundLabel_(drawn.length, nextRound);
  var plan = [];
  for (var i = 0; i < drawn.length; i += 2) {
    plan.push({ key: 'r' + i, round: nextRound, order: i / 2 + 1, label: label, p1: drawn[i], p2: drawn[i + 1], meta: { draw: true } });
  }
  // 決勝の抽選のとき、3 位決定戦は準決勝の敗者どうし
  if (drawn.length === 2 && cfg.thirdPlace && last.length === 2) {
    var losers = last.map(function (m) {
      return m.winner_id === m.player1_id ? m.player2_id : m.player1_id;
    });
    plan.push({ key: 'third', round: nextRound, order: 2, label: '3位決定戦', p1: losers[0], p2: losers[1], meta: { draw: true } });
  }
  var records = bracketRecords_(ctx, stage, plan, { drawnAt: ctx.now, drawnBy: ctx.user ? ctx.user.label : '', pool: drawn.length });
  appendRecords_(matchesTable, records);
  autoForfeitWithdrawn_(ctx, eventId, stage.stage_id);
  recordHistory_(ctx, before ? 'bracket.redraw' : 'bracket.draw', 'Stage', stage.stage_id, eventId, before ? { round: nextRound, pairs: before } : null, {
    round: nextRound,
    pairs: records.map(function (m) {
      return [m.player1_id, m.player2_id];
    }),
  });
  return { eventId: eventId, round: nextRound, created: records.length };
}

function actionClearBracket_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var bundle = collectEvent_(ctx, eventId);
  var stage = resolveStage_(bundle, payload, 'knockout');
  var matches = stageMatchesOf_(bundle, stage);
  if (matches.some(matchStarted_)) throw appError_('LOCKED', '結果が入力された試合があるため削除できません。結果を「未開始」に戻してから実行してください。');
  var table = ctx.table('Matches');
  deleteRecords_(table, table.rows.filter(function (m) {
    return m.stage_id === stage.stage_id;
  }));
  recordHistory_(ctx, 'bracket.clear', 'Stage', stage.stage_id, eventId, { removed: matches.length }, null);
  return { eventId: eventId, removed: matches.length };
}

/* ---------- 試合結果 ---------- */

function parseCount_(value, label, allowBlank) {
  if (allowBlank && (value === '' || value === null || value === undefined)) return null;
  var n = parseNonNegativeInt_(value === '' || value === undefined ? 0 : value);
  if (n === null) throw appError_('VALIDATION', label + 'は 0 以上の整数で入力してください。');
  return n;
}

/**
 * 勝ち抜き戦の勝者・敗者を次の試合の枠へ入れる（訂正時は入れ替える）。
 * 次の試合がすでに始まっている場合は、結果を変えさせない（進行中の対戦を壊さない・同じ選手を二重に進めない）。
 */
function propagateElimination_(ctx, match, beforeWinner, afterWinner) {
  var table = ctx.table('Matches');
  var loserOf = function (winner) {
    if (!winner) return '';
    return winner === match.player1_id ? match.player2_id : match.player1_id;
  };
  var moves = [
    { id: match.next_match_id, slot: match.next_match_slot, before: beforeWinner, after: afterWinner },
    { id: match.loser_next_match_id, slot: match.loser_next_match_slot, before: loserOf(beforeWinner), after: loserOf(afterWinner) },
  ];
  moves.forEach(function (mv) {
    if (!mv.id || mv.before === mv.after) return;
    var next = table.byKey[mv.id];
    if (!next) return;
    if (matchStarted_(next)) {
      throw appError_('LOCKED', '次の試合（' + (next.label || next.round + '回戦') + '）が始まっているため変更できません。先に次の試合を「未開始」に戻してください。');
    }
    next['player' + (mv.slot === 2 ? 2 : 1) + '_id'] = mv.after || '';
    next.rev = (next.rev || 0) + 1;
    next.updated_at = ctx.now;
    updateRecord_(table, next);
  });
  var meta = matchMeta_(match);
  if (meta.gf === 1) syncGrandFinalReset_(ctx, match);
}

/**
 * ダブルエリミのリセットの決勝（GF2）。グランドファイナル（GF1）で敗者側の選手（2 番目の枠）が勝ったときだけ行う。
 * 勝者側の選手が勝った・リセットなしの設定のときは「実施なし」。GF1 を訂正したら合わせ直す（GF2 が始まっていたら止める）。
 */
function syncGrandFinalReset_(ctx, gf1) {
  var table = ctx.table('Matches');
  var gf2 = table.rows.filter(function (m) {
    return m.stage_id === gf1.stage_id && matchMeta_(m).gf === 2;
  })[0];
  if (!gf2) return;
  var want;
  if (gf1.status !== MATCH_STATUS.FINAL || !gf1.winner_id) want = { p1: '', p2: '', type: '' };
  else if (gf1.winner_id === gf1.player2_id) want = { p1: gf1.player1_id, p2: gf1.player2_id, type: '' };
  else want = { p1: '', p2: '', type: RESULT_TYPE.NOT_NEEDED };
  if (gf2.player1_id === want.p1 && gf2.player2_id === want.p2 && (gf2.result_type || '') === want.type) return;
  if (matchStarted_(gf2) && gf2.result_type !== RESULT_TYPE.NOT_NEEDED) {
    throw appError_('LOCKED', 'リセットの決勝が始まっているため、グランドファイナルの結果は変更できません。先にリセットの決勝を「未開始」に戻してください。');
  }
  gf2.player1_id = want.p1;
  gf2.player2_id = want.p2;
  gf2.result_type = want.type;
  gf2.status = MATCH_STATUS.SCHEDULED;
  gf2.winner_id = '';
  gf2.rev = (gf2.rev || 0) + 1;
  gf2.updated_at = ctx.now;
  updateRecord_(table, gf2);
}

/**
 * 棄権・失格した選手が勝ち抜き戦の次の試合に入ったら、その試合は相手の不戦勝にする（F15）。
 * 両方とも棄権済みの試合は主催者が決める（そのまま残す）。連鎖して次の試合に入った場合も同じように処理する。
 */
function autoForfeitWithdrawn_(ctx, eventId, stageId) {
  var withdrawn = {};
  ctx.table('Players').rows.forEach(function (p) {
    if (p.event_id === eventId && isWithdrawn_(p)) withdrawn[p.player_id] = playerMeta_(p).withdrawn;
  });
  if (!Object.keys(withdrawn).length) return 0;
  var table = ctx.table('Matches');
  var stage = ctx.table('Stages').byKey[stageId];
  if (!isBracketStage_(stage)) return 0;
  var count = 0;
  for (var guard = 0; guard < 300; guard++) {
    var target = table.rows.filter(function (m) {
      if (m.stage_id !== stageId || m.status !== MATCH_STATUS.SCHEDULED || matchStarted_(m) || !m.player1_id || !m.player2_id) return false;
      return !!withdrawn[m.player1_id] !== !!withdrawn[m.player2_id];
    })[0];
    if (!target) break;
    var loser = withdrawn[target.player1_id] ? target.player1_id : target.player2_id;
    var winner = loser === target.player1_id ? target.player2_id : target.player1_id;
    var before = pickResult_(target);
    target.status = MATCH_STATUS.FINAL;
    target.result_type = withdrawn[loser].kind === 'disqualified' ? RESULT_TYPE.DISQUALIFIED : RESULT_TYPE.WALKOVER;
    target.result_note = withdrawn[loser].reason || '';
    target.player1_legs = null;
    target.player2_legs = null;
    target.player1_sets = 0;
    target.player2_sets = 0;
    target.winner_id = winner;
    target.confirmed_at = ctx.now;
    target.rev = (target.rev || 0) + 1;
    target.updated_at = ctx.now;
    propagateElimination_(ctx, target, '', winner);
    updateRecord_(table, target);
    recordHistory_(ctx, 'match.autoWalkover', 'Match', target.match_id, eventId, before, pickResult_(target));
    count++;
  }
  return count;
}

var SPECIAL_RESULTS_ = [RESULT_TYPE.WALKOVER, RESULT_TYPE.RETIRED, RESULT_TYPE.DISQUALIFIED];

/** 1 試合分の結果を検証する（書き込みはしない）。戻り値を applyMatchResult_ に渡して保存する */
function prepareMatchResult_(ctx, payload) {
  var matchesTable = ctx.table('Matches');
  var match = findRecord_(matchesTable, requireId_(payload.matchId, '試合'), '試合');
  assertRev_(match, requireRev_(payload.rev), '試合');
  var status = payload.status;
  if (!MATCH_STATUS_LABEL[status]) throw appError_('VALIDATION', '試合状態が不正です。');
  if (match.status === MATCH_STATUS.FINAL && payload.correction !== true) {
    throw appError_('ALREADY_FINAL', '確定済みの試合です。結果を直す場合は「訂正」から操作してください。');
  }
  if (match.result_type === RESULT_TYPE.BYE) throw appError_('LOCKED', '不戦（Bye）の記録は変更できません。');
  if (match.result_type === RESULT_TYPE.NOT_NEEDED) throw appError_('LOCKED', 'この試合は行わないことになっています（グランドファイナルで勝者側の選手が勝ったため）。');
  var resultType = payload.resultType === undefined || payload.resultType === null ? '' : payload.resultType;
  if (resultType !== '' && SPECIAL_RESULTS_.indexOf(resultType) === -1) throw appError_('VALIDATION', '特殊な結果の種類が不正です。');
  if (resultType && status !== MATCH_STATUS.FINAL) throw appError_('VALIDATION', '不戦勝・途中棄権・失格は「確定」として保存してください。');

  var bundle = collectEvent_(ctx, match.event_id);
  var stage = bundle.stageById[match.stage_id];
  if (isGroupStage_(stage) || stage.type === STAGE_TYPE.SERIES) assertNotAdvanced_(stage);
  if (stage.type === STAGE_TYPE.SWISS) {
    // スイス式: 後の回戦を組んだ後は、前の回戦の結果を変えない（組み合わせの前提が変わるため）
    var latest = bundle.matches.reduce(function (mx, m) {
      return m.stage_id === stage.stage_id && m.group_id === match.group_id ? Math.max(mx, m.round || 0) : mx;
    }, 0);
    if (match.round < latest) throw appError_('LOCKED', '第' + latest + '回戦の組み合わせを作った後は、第' + match.round + '回戦の結果を変更できません。先に第' + latest + '回戦の組み合わせを削除してください（まだ始まっていない場合のみ）。');
  }
  if (stage.type === STAGE_TYPE.SERIES && match.group_id) {
    var night = bundle.groups.filter(function (g) {
      return g.group_id === match.group_id;
    })[0];
    if (night && groupMeta_(night).status === 'cancelled') throw appError_('LOCKED', 'この節は中止になっています。');
  }
  if (!match.player1_id || !match.player2_id) throw appError_('LOCKED', '対戦相手が決まっていません。前の試合の結果を確定してください。');
  var playerById = {};
  bundle.players.forEach(function (p) {
    playerById[p.player_id] = p;
  });
  if (!playerById[match.player1_id] || !playerById[match.player2_id] || match.player1_id === match.player2_id) {
    throw appError_('DATA_CONFLICT', 'この試合の選手情報が不正なため保存できません。');
  }
  var spec = matchSpec_(bundle, match);
  var sets = spec && spec.format === 'sets';
  var note = cleanText_(payload.note, '理由', ADMIN_CONFIG.MAX_NOTE_LENGTH, { allowEmpty: true });
  var input;
  var winnerSide;
  var draw = false;
  if (resultType) {
    winnerSide = payload.winnerSide === 1 || payload.winnerSide === 2 ? payload.winnerSide : 0;
    if (!winnerSide) throw appError_('VALIDATION', '不戦勝・途中棄権・失格では、勝者（記録上の勝者）を選んでください。');
    if (resultType === RESULT_TYPE.WALKOVER) {
      // 不戦勝: 実際には試合をしていないので、Leg 数は記録しない（捏造しない）
      input = { p1Legs: null, p2Legs: null, p1Sets: 0, p2Sets: 0 };
    } else {
      // 途中棄権・失格: その時点までの実際の Leg 数（任意）。勝敗が決まっていない数であること
      input = {
        p1Legs: parseCount_(payload.p1Legs, '取得 Leg 数', true),
        p2Legs: parseCount_(payload.p2Legs, '取得 Leg 数', true),
        p1Sets: sets ? parseCount_(payload.p1Sets, '取得セット数', true) || 0 : 0,
        p2Sets: sets ? parseCount_(payload.p2Sets, '取得セット数', true) || 0 : 0,
      };
      if ((input.p1Legs === null) !== (input.p2Legs === null)) throw appError_('VALIDATION', '取得 Leg 数は両方入力するか、両方空欄にしてください。');
      if (input.p1Legs !== null) {
        var at = evaluateMatchInput_(MATCH_STATUS.LIVE, input, spec);
        if (!at.ok) throw appError_('VALIDATION', '棄権・失格の時点の Leg 数は、まだ勝敗が決まっていない数にしてください（' + at.problems.join(' / ') + '）。');
      }
    }
    if (!note) throw appError_('VALIDATION', '不戦勝・途中棄権・失格の理由を入力してください（運営画面にだけ残ります）。');
  } else {
    input = {
      p1Legs: parseCount_(payload.p1Legs, '取得 Leg 数', sets),
      p2Legs: parseCount_(payload.p2Legs, '取得 Leg 数', sets),
      p1Sets: sets ? parseCount_(payload.p1Sets, '取得セット数', false) : 0,
      p2Sets: sets ? parseCount_(payload.p2Sets, '取得セット数', false) : 0,
    };
    if (sets && (input.p1Legs === null) !== (input.p2Legs === null)) throw appError_('VALIDATION', '取得 Leg 数は両方入力するか、両方空欄にしてください。');
    var result = evaluateMatchInput_(status, input, spec);
    if (!result.ok) throw appError_('VALIDATION', result.problems.join(' / '));
    if (result.draw && isBracketStage_(stage)) throw appError_('VALIDATION', '勝ち抜き戦では引き分けを確定できません。');
    winnerSide = result.winnerSide;
    draw = !!result.draw;
  }
  return {
    match: match,
    stage: stage,
    status: status,
    sets: sets,
    input: input,
    winnerSide: winnerSide,
    draw: draw,
    resultType: resultType,
    note: resultType ? note : '',
    names: [playerById[match.player1_id].display_name, playerById[match.player2_id].display_name],
  };
}

function applyMatchResult_(ctx, prep) {
  var match = prep.match;
  var before = plain_(match);
  var beforeWinner = match.status === MATCH_STATUS.FINAL ? match.winner_id : '';
  match.player1_legs = prep.input.p1Legs;
  match.player2_legs = prep.input.p2Legs;
  match.player1_sets = prep.sets ? prep.input.p1Sets : 0;
  match.player2_sets = prep.sets ? prep.input.p2Sets : 0;
  match.status = prep.status;
  match.winner_id = prep.winnerSide === 1 ? match.player1_id : prep.winnerSide === 2 ? match.player2_id : '';
  match.result_type = prep.resultType || '';
  match.result_note = prep.note || '';
  match.confirmed_at = prep.status === MATCH_STATUS.FINAL ? ctx.now : '';
  match.rev = (match.rev || 0) + 1;
  match.updated_at = ctx.now;
  if (isBracketStage_(prep.stage)) propagateElimination_(ctx, match, beforeWinner, match.winner_id);
  updateRecord_(ctx.table('Matches'), match);
  if (isBracketStage_(prep.stage)) autoForfeitWithdrawn_(ctx, match.event_id, match.stage_id);
  var action = before.status === MATCH_STATUS.FINAL ? 'match.correct' : 'match.result';
  recordHistory_(ctx, action, 'Match', match.match_id, match.event_id, pickResult_(before), pickResult_(match));
}

function actionSaveMatchResult_(ctx, payload) {
  var prep = prepareMatchResult_(ctx, payload);
  applyMatchResult_(ctx, prep);
  return { eventId: prep.match.event_id };
}

/**
 * 複数の試合をまとめて確定する。すべての結果を先に検証し、1 つでも成立しなければ何も保存しない。
 * 対象は未確定の試合の「確定」だけ（訂正・進行中の保存・特殊な結果は 1 試合ずつ）。
 */
function actionSaveMatchResults_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  var list = payload.results;
  if (!Array.isArray(list) || !list.length) throw appError_('VALIDATION', '確定する試合がありません。');
  if (list.length > MAX_BATCH_RESULTS_) throw appError_('VALIDATION', '一度に確定できるのは ' + MAX_BATCH_RESULTS_ + ' 試合までです。');
  var seen = {};
  var preps = list.map(function (r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw appError_('BAD_REQUEST', '結果の形式が不正です。');
    var matchId = requireId_(r.matchId, '試合');
    if (seen[matchId]) throw appError_('BAD_REQUEST', '同じ試合が重複しています。');
    seen[matchId] = true;
    var match = findRecord_(ctx.table('Matches'), matchId, '試合');
    // 他の大会の試合は存在しないものとして扱う（authorizeEventPayload_ と同じ方針）
    if (match.event_id !== eventId) throw appError_('NOT_FOUND', '試合 が見つかりません。画面を再読み込みしてください。');
    if (match.status === MATCH_STATUS.FINAL) throw appError_('ALREADY_FINAL', '確定済みの試合が含まれています。画面を再読み込みしてください。');
    try {
      return prepareMatchResult_(ctx, { matchId: matchId, rev: r.rev, status: MATCH_STATUS.FINAL, p1Legs: r.p1Legs, p2Legs: r.p2Legs, p1Sets: r.p1Sets, p2Sets: r.p2Sets });
    } catch (e) {
      if (!e.appCode) throw e;
      var p1 = ctx.table('Players').byKey[match.player1_id];
      var p2 = ctx.table('Players').byKey[match.player2_id];
      var label = (p1 ? p1.display_name : '?') + ' vs ' + (p2 ? p2.display_name : '?');
      throw appError_(e.appCode, label + ': ' + e.publicMessage + '（どの試合も保存していません）');
    }
  });
  preps.forEach(function (prep) {
    applyMatchResult_(ctx, prep);
  });
  return { eventId: eventId, saved: preps.length };
}

function pickResult_(m) {
  return {
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    player1_legs: m.player1_legs,
    player2_legs: m.player2_legs,
    player1_sets: m.player1_sets,
    player2_sets: m.player2_sets,
    status: m.status,
    winner_id: m.winner_id,
    result_type: m.result_type || '',
    rev: m.rev,
  };
}

function actionRepublish_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  findRecord_(ctx.table('Events'), eventId, '大会');
  return { eventId: eventId, forceRepublish: true };
}

/* ---------- 大会の削除（アーカイブ） ---------- */

/** 大会に属する行を持つシート（Events・PublicSnapshots 以外） */
var EVENT_CHILD_TABLES_ = ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'History', 'Collaborators'];
/** 保存用ファイル（JSON）に入れるシート。共同主催者のメールアドレスは入れない */
var ARCHIVE_TABLES_ = ['Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'History'];

/** 削除・パスワードなどの設定は、大会を作った本人と管理者だけ（店舗スタッフは不可） */
function assertNotStaff_(ctx, what) {
  if (ctx.user.kind === 'staff') throw appError_('FORBIDDEN', what + 'は、大会を作った本人（Google ログイン）か管理者だけが行えます。');
}

/**
 * 大会の全データ（保存用）。各シートの行をそのまま入れ、閲覧ページと同じ形の結果（順位表・トーナメント表）も添える。
 * 管理パスワードのハッシュ・ソルトなどの秘密は含めない。
 */
function eventArchive_(ctx, eventId) {
  var event = findRecord_(ctx.table('Events'), eventId, '大会');
  var tables = {};
  ARCHIVE_TABLES_.forEach(function (name) {
    tables[name] = ctx.table(name).rows
      .filter(function (r) {
        return r.event_id === eventId;
      })
      .map(plain_);
  });
  return {
    format: 'n02-tournament-archive',
    // 2 = v0.8（列が増えた。共同主催者は入れない）。復元は 1 と 2 の両方を受け付ける
    formatVersion: 2,
    appVersion: ADMIN_CONFIG.APP_VERSION,
    exportedAt: ctx.now,
    exportedBy: ctx.user ? ctx.user.label : '',
    event: eventForLog_(event),
    tables: tables,
    results: buildPublicSnapshot_(collectEvent_(ctx, eventId)),
  };
}

function actionExportEvent_(ctx, payload) {
  assertNotStaff_(ctx, '大会データの保存');
  return eventArchive_(ctx, requireId_(payload.eventId, '大会'));
}

/**
 * 大会の削除。確認のため大会名の入力が必要。
 * 途中で止まっても再実行できるよう、公開データ → 大会に属する行 → 大会の行 の順に消す（大会の行が残っていれば、もう一度削除できる）。
 * 削除したことは履歴（大会に属さない行）に残すが、大会の中身は残さない。
 */
function actionDeleteEvent_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '大会の削除');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  var typed = typeof payload.confirmName === 'string' ? payload.confirmName.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (typed !== event.name) throw appError_('VALIDATION', '確認のため、大会名「' + event.name + '」を正しく入力してください。');

  var counts = {};
  ['PublicSnapshots'].concat(EVENT_CHILD_TABLES_).forEach(function (name) {
    var table = ctx.table(name);
    var rows = table.rows.filter(function (r) {
      return r.event_id === eventId;
    });
    counts[name] = rows.length;
    deleteRecords_(table, rows);
    ctx.invalidate(name);
  });
  deleteRecords_(events, events.rows.filter(function (e) {
    return e.event_id === eventId;
  }));
  ctx.invalidate();
  recordHistory_(ctx, 'event.delete', 'Event', eventId, '', null, {
    eventId: eventId,
    name: event.name,
    ownerEmail: event.owner_email,
    createdAt: event.created_at,
    deletedRows: counts,
    by: ctx.user.label,
  });
  // eventId を返すと、削除後に公開データの同期・詳細の再読み込みが走るので、別の名前で返す
  return { deletedEventId: eventId, deletedName: event.name };
}

/* ---------- サンプル ---------- */

/**
 * 検証用サンプル: 16 名・4 人 × 4 グループのロビン、Best of 5 Legs（暫定）。
 * 選手名は架空の「サンプル選手01〜16」。結果は表示確認用に、確定・進行中・未開始を混ぜて入れる。
 */
function actionCreateSampleEvent_(ctx, payload) {
  assertCreateAllowed_(ctx);
  var publish = payload.publish === true;
  var created = createEventRecords_(ctx, {
    organizerName: cleanText_(payload.organizerName, '主催者名', ADMIN_CONFIG.MAX_LABEL_LENGTH, { allowEmpty: true }),
    name: 'サンプル大会（PoC 検証用）',
    dateLabel: '日付未定',
    rule: { format: 'legs', bestOf: 5, setBestOf: null, provisional: true },
    template: 'robin',
    groupCount: SAMPLE_GROUP_COUNT_,
    isSample: true,
    ownerEmail: creatorEmail_(ctx),
  });
  var eventId = created.event.event_id;
  var names = [];
  for (var i = 1; i <= SAMPLE_PLAYER_COUNT_; i++) names.push('サンプル選手' + (i < 10 ? '0' : '') + i);
  actionAddPlayers_(ctx, { eventId: eventId, names: names });
  ctx.invalidate();

  // 4 名ずつ順番にグループへ（01-04 が A、05-08 が B…）
  var bundle = collectEvent_(ctx, eventId);
  var stage = bundle.stages[0];
  var players = bundle.players.slice().sort(function (a, b) {
    return a.display_name < b.display_name ? -1 : 1;
  });
  var taken = {};
  var entries = players.map(function (p, idx) {
    var g = bundle.groups[Math.floor(idx / 4)];
    return newEntry_(ctx, stage, g.group_id, p.player_id, (idx % 4) + 1, taken);
  });
  appendRecords_(ctx.table('Entries'), entries);
  ctx.invalidate();
  bundle = collectEvent_(ctx, eventId);

  // グループ A: 全試合確定 / B: 確定 4・進行中 1・未開始 1 / C: 確定 2・進行中 1 / D: 全試合未開始
  var plan = [
    [[3, 1], [3, 2], [2, 3], [3, 0], [1, 3], [3, 2]],
    [[3, 0], [2, 3], [3, 1], [3, 2], 'live21', null],
    [[3, 1], [0, 3], 'live11', null, null, null],
    [null, null, null, null, null, null],
  ];
  var matchesTaken = Object.assign({}, ctx.table('Matches').byKey);
  var matches = [];
  bundle.groups.forEach(function (g, gi) {
    generateGroupMatches_(ctx, bundle, g, matchesTaken).forEach(function (m, mi) {
      var r = plan[gi] && plan[gi][mi];
      if (Array.isArray(r)) {
        m.player1_legs = r[0];
        m.player2_legs = r[1];
        m.status = MATCH_STATUS.FINAL;
        m.winner_id = r[0] > r[1] ? m.player1_id : m.player2_id;
        m.confirmed_at = ctx.now;
      } else if (r === 'live21' || r === 'live11') {
        m.player1_legs = r === 'live21' ? 2 : 1;
        m.player2_legs = 1;
        m.status = MATCH_STATUS.LIVE;
      }
      matches.push(m);
    });
  });
  appendRecords_(ctx.table('Matches'), matches);
  ctx.invalidate();

  if (publish) {
    var events = ctx.table('Events');
    var ev = findRecord_(events, eventId, '大会');
    ev.is_public = true;
    ev.status = EVENT_STATUS.RUNNING;
    ev.rev = (ev.rev || 0) + 1;
    ev.updated_at = ctx.now;
    updateRecord_(events, ev);
    ctx.invalidate();
  }
  recordHistory_(ctx, 'event.sample', 'Event', eventId, eventId, null, { players: names.length, matches: matches.length, publish: publish });
  return { eventId: eventId, adminKey: created.adminKey };
}

// ---- 06b_ops.js ----
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
    owner_email: creatorEmail_(ctx),
    staff_pass_hash: '',
    staff_pass_salt: '',
    staff_pass_set_at: '',
    notes: '',
    config_json: JSON.stringify(cfgEv),
    rev: 1,
    created_at: ctx.now,
    updated_at: ctx.now,
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
  if (current.some(function (r) { return normalizeEmail_(r.email) === email; })) throw appError_('VALIDATION', 'この Google アカウントは既に共同主催者です。');
  if (current.length >= ADMIN_CONFIG.MAX_COLLABORATORS) throw appError_('LIMIT', '共同主催者は ' + ADMIN_CONFIG.MAX_COLLABORATORS + ' 人までです。');
  var id = newId_('COL', table.byKey);
  appendRecords_(table, [{ collab_id: id, event_id: eventId, email: email, role: 'editor', added_by: ctx.user.label, rev: 1, created_at: ctx.now, updated_at: ctx.now }]);
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
  recordHistory_(ctx, 'collaborator.remove', 'Event', eventId, eventId, { email: rec.email }, null);
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

// ---- 07_api.js ----
/* 公開エントリポイント（外部から呼べるのはこのファイルの doGet と doPost だけ） */

/**
 * 操作の一覧。
 * - scope: public = 誰でも（未認証可）/ login = ログイン（送られた auth は見ない）/
 *          create = 大会の作成（Google ログインした人と管理者）/ google = Google でログインした人のみ / platform = 管理者のみ /
 *          event = その大会を運営できる人（作った本人・その大会の管理パスワードでログインした人・管理者）のみ
 * - mutating=true の操作は、スクリプトロックの中で実行し、二重送信を requestId で弾き、最後に公開データを同期する
 * - needsStorage=false の操作は保存先が未設定・未初期化でも実行できる
 */
function adminActions_() {
  return {
    bootstrap: { fn: actionBootstrap_, scope: 'public', mutating: false, needsStorage: false },
    login: { fn: actionLogin_, scope: 'login', mutating: false, needsStorage: false },
    staffLogin: { fn: actionStaffLogin_, scope: 'login', mutating: false },
    logout: { fn: actionLogout_, scope: 'login', mutating: false, needsStorage: false },
    myEvents: { fn: actionMyEvents_, scope: 'google', mutating: false },
    eventDetail: { fn: actionEventDetail_, scope: 'event', mutating: false },
    configureStorage: { fn: actionConfigureStorage_, scope: 'platform', mutating: true, needsStorage: false },
    initializeStorage: { fn: actionInitializeStorage_, scope: 'platform', mutating: true, needsStorage: false },
    migrateStorage: { fn: actionMigrateStorage_, scope: 'platform', mutating: true, needsStorage: false },
    setViewerUrl: { fn: actionSetViewerUrl_, scope: 'platform', mutating: true, needsStorage: false },
    createEvent: { fn: actionCreateEvent_, scope: 'create', mutating: true },
    createSampleEvent: { fn: actionCreateSampleEvent_, scope: 'create', mutating: true },
    setStaffPassword: { fn: actionSetStaffPassword_, scope: 'event', mutating: true },
    setOwner: { fn: actionSetOwner_, scope: 'event', mutating: true },
    exportEvent: { fn: actionExportEvent_, scope: 'event', mutating: false },
    deleteEvent: { fn: actionDeleteEvent_, scope: 'event', mutating: true },
    updateEvent: { fn: actionUpdateEvent_, scope: 'event', mutating: true },
    updateRule: { fn: actionUpdateRule_, scope: 'event', mutating: true },
    addPlayers: { fn: actionAddPlayers_, scope: 'event', mutating: true },
    updatePlayer: { fn: actionUpdatePlayer_, scope: 'event', mutating: true },
    deletePlayer: { fn: actionDeletePlayer_, scope: 'event', mutating: true },
    setGroupCount: { fn: actionSetGroupCount_, scope: 'event', mutating: true },
    renameGroup: { fn: actionRenameGroup_, scope: 'event', mutating: true },
    assignPlayer: { fn: actionAssignPlayer_, scope: 'event', mutating: true },
    autoAssign: { fn: actionAutoAssign_, scope: 'event', mutating: true },
    generateMatches: { fn: actionGenerateMatches_, scope: 'event', mutating: true },
    clearMatches: { fn: actionClearMatches_, scope: 'event', mutating: true },
    saveMatchResult: { fn: actionSaveMatchResult_, scope: 'event', mutating: true },
    saveMatchResults: { fn: actionSaveMatchResults_, scope: 'event', mutating: true },
    republish: { fn: actionRepublish_, scope: 'event', mutating: true },
    addStage: { fn: actionAddStage_, scope: 'event', mutating: true },
    updateStage: { fn: actionUpdateStage_, scope: 'event', mutating: true },
    deleteStage: { fn: actionDeleteStage_, scope: 'event', mutating: true },
    setManualOrder: { fn: actionSetManualOrder_, scope: 'event', mutating: true },
    confirmAdvancement: { fn: actionConfirmAdvancement_, scope: 'event', mutating: true },
    undoAdvancement: { fn: actionUndoAdvancement_, scope: 'event', mutating: true },
    setEntrants: { fn: actionSetEntrants_, scope: 'event', mutating: true },
    generateBracket: { fn: actionGenerateBracket_, scope: 'event', mutating: true },
    clearBracket: { fn: actionClearBracket_, scope: 'event', mutating: true },
    // v0.8
    previewAdvancement: { fn: actionPreviewAdvancement_, scope: 'event', mutating: false },
    previewBracket: { fn: actionPreviewBracket_, scope: 'event', mutating: false },
    drawNextRound: { fn: actionDrawNextRound_, scope: 'event', mutating: true },
    generateSwissRound: { fn: actionGenerateSwissRound_, scope: 'event', mutating: true },
    deleteSwissRound: { fn: actionDeleteSwissRound_, scope: 'event', mutating: true },
    setNightParticipants: { fn: actionSetNightParticipants_, scope: 'event', mutating: true },
    generateNight: { fn: actionGenerateNight_, scope: 'event', mutating: true },
    clearNight: { fn: actionClearNight_, scope: 'event', mutating: true },
    cancelNight: { fn: actionCancelNight_, scope: 'event', mutating: true },
    updateNight: { fn: actionUpdateNight_, scope: 'event', mutating: true },
    importPlayers: { fn: actionImportPlayers_, scope: 'event', mutating: true },
    previewWithdraw: { fn: actionPreviewWithdraw_, scope: 'event', mutating: false },
    withdrawPlayer: { fn: actionWithdrawPlayer_, scope: 'event', mutating: true },
    reinstatePlayer: { fn: actionReinstatePlayer_, scope: 'event', mutating: true },
    setSchedule: { fn: actionSetSchedule_, scope: 'event', mutating: true },
    postponeMatch: { fn: actionPostponeMatch_, scope: 'event', mutating: true },
    previewWeeklySchedule: { fn: actionPreviewWeeklySchedule_, scope: 'event', mutating: false },
    applyWeeklySchedule: { fn: actionApplyWeeklySchedule_, scope: 'event', mutating: true },
    updateEventSettings: { fn: actionUpdateEventSettings_, scope: 'event', mutating: true },
    duplicateEvent: { fn: actionDuplicateEvent_, scope: 'event', mutating: true },
    addCollaborator: { fn: actionAddCollaborator_, scope: 'event', mutating: true },
    removeCollaborator: { fn: actionRemoveCollaborator_, scope: 'event', mutating: true },
    restoreEvent: { fn: actionRestoreEvent_, scope: 'create', mutating: true },
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 運営画面は GitHub Pages にある。ここを直接開いた人には案内だけを返す。
 * version / release は本番反映の確認用（どの版のコードが動いているか。秘密の情報は含まない）。
 */
function doGet() {
  return jsonOutput_({
    ok: true,
    app: 'n02-tournament-admin-api',
    version: ADMIN_CONFIG.APP_VERSION,
    schema: ADMIN_CONFIG.SCHEMA_VERSION,
    release: RELEASE_ID_,
    message: 'この URL は運営画面（GitHub Pages）から使う API です。',
  });
}

/** 本番反映のときに、反映した正本のコミット（SHA）に置き換わる。手で貼り付けた場合は 'manual' のまま */
var RELEASE_ID_ = 'manual';

/**
 * 運営画面からの API 呼び出し。本文は JSON（Content-Type: text/plain で送る。CORS のプリフライトを避けるため）。
 * request = { action, payload, requestId?, auth?: { session } | { adminKey } }
 * 戻り値  = { ok: true, data } | { ok: false, error: { code, message } }
 */
function doPost(e) {
  var startedAt = Date.now();
  var text = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  if (!text || text.length > ADMIN_CONFIG.MAX_RESTORE_REQUEST_CHARS) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  var request;
  try {
    request = JSON.parse(text);
  } catch (err) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  // 大会ファイルからの復元だけは大きな本文を受け付ける。それ以外の操作は従来どおりの上限
  if (text.length > ADMIN_CONFIG.MAX_REQUEST_CHARS && !(request && request.action === 'restoreEvent')) {
    return jsonOutput_(errorResponse_(appError_('BAD_REQUEST', 'リクエストが不正です。'), startedAt));
  }
  return jsonOutput_(handleAdminRequest_(request, startedAt));
}

function handleAdminRequest_(request, startedAt) {
  try {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw appError_('BAD_REQUEST', 'リクエストが不正です。');
    var actions = adminActions_();
    var action = typeof request.action === 'string' ? request.action : '';
    if (!Object.prototype.hasOwnProperty.call(actions, action)) {
      throw appError_('BAD_REQUEST', '不明な操作です。');
    }
    var spec = actions[action];
    var shared = null;
    var getCtx = function () {
      if (!shared) shared = createContext_(openStorage_(), '', null);
      return shared;
    };
    // ログインの操作では、送られてきた（期限切れかもしれない）セッションを見ない
    var user = spec.scope === 'login' ? authenticate_(getCtx, null) : authenticate_(getCtx, request.auth);
    if (spec.scope === 'platform') assertPlatformAdmin_(user);
    if (spec.scope === 'google' && user.kind !== 'google') {
      throw appError_('AUTH_REQUIRED', 'Google でログインしてください。');
    }
    if (spec.scope === 'event' && user.kind === 'anonymous') {
      throw appError_('AUTH_REQUIRED', 'Google でログインするか、管理パスワードを入力してください。');
    }
    var payload = request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload) ? request.payload : {};
    var data = spec.mutating ? runMutation_(user, action, spec, payload, request.requestId, request.auth) : runQuery_(user, spec, payload, shared);
    return { ok: true, data: data, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    return errorResponse_(err, startedAt);
  }
}

function errorResponse_(err, startedAt) {
  if (err && err.appCode) {
    return { ok: false, error: { code: err.appCode, message: err.publicMessage }, elapsedMs: Date.now() - startedAt };
  }
  console.error('admin request failed', err && err.stack ? err.stack : err);
  return {
    ok: false,
    error: { code: 'INTERNAL', message: '処理中にエラーが発生しました。時間をおいて再度お試しください。' },
    elapsedMs: Date.now() - startedAt,
  };
}

function contextFor_(user, reuse) {
  var ctx = reuse || createContext_(openStorage_(), user.label, user);
  ctx.actor = user.label;
  ctx.user = user;
  return ctx;
}

function runQuery_(user, spec, payload, reuse) {
  if (spec.needsStorage === false) return spec.fn({ actor: user.label, user: user }, payload);
  var ctx = contextFor_(user, reuse);
  if (spec.scope === 'event') authorizeEventPayload_(ctx, payload);
  return spec.fn(ctx, payload);
}

var REQUEST_ID_PATTERN_ = /^[A-Za-z0-9-]{16,64}$/;
var NO_COMPLETION_CHECK_ = [
  'updateEvent', 'updateEventSettings', 'setStaffPassword', 'setOwner', 'addCollaborator', 'removeCollaborator', 'republish', 'renameGroup',
  'updatePlayer', 'setSchedule', 'postponeMatch', 'applyWeeklySchedule', 'updateNight', 'createEvent', 'createSampleEvent', 'duplicateEvent',
  'restoreEvent', 'importPlayers', 'addPlayers', 'deleteEvent', 'reinstatePlayer',
];
var WRITE_JOURNAL_KEY_ = 'WRITE_JOURNAL';

/**
 * 書き込みの途中で止まった操作の目印（スクリプト プロパティ）。書き込みの直前に置き、書き終えたら消す。
 * 残っていれば、前の操作の書き込みが途中で止まった（Google 側のエラー・時間切れ）可能性がある。
 */
function readWriteJournal_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(WRITE_JOURNAL_KEY_) || 'null');
  } catch (e) {
    return null;
  }
}

function runMutation_(user, action, spec, payload, requestId, auth) {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN_.test(requestId)) {
    throw appError_('BAD_REQUEST', 'requestId がありません。画面を再読み込みしてください。');
  }
  var cache = CacheService.getScriptCache();
  // 別の利用者の requestId と衝突しないよう、利用者ごとに分ける
  var dedupeKey = 'req:' + sha256Hex_(user.label + ':' + requestId);
  var done = cache.get(dedupeKey);
  if (done) return duplicateResult_(done);

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ADMIN_CONFIG.LOCK_WAIT_MS)) {
    throw appError_('BUSY', '他の更新処理が実行中です。数秒後にもう一度お試しください。');
  }
  try {
    // ロック待ちの間に同じ requestId の処理が終わっていることがあるので、もう一度確認する
    done = cache.get(dedupeKey);
    if (done) return duplicateResult_(done);
    var props = PropertiesService.getScriptProperties();
    var journal = readWriteJournal_();
    if (journal && journal.key === dedupeKey) {
      // 同じ操作の再送: 前回の書き込みが途中で止まっている可能性があるので、もう一度は実行しない
      throw appError_('PARTIAL_WRITE', '前回の保存が途中で止まった可能性があります。画面を再読み込みして内容を確認してから、必要ならもう一度操作してください。');
    }
    var result;
    if (spec.needsStorage === false) {
      result = spec.fn({ actor: user.label, user: user }, payload);
    } else {
      assertSchemaCurrent_();
      var ctx = contextFor_(user, null);
      if (journal) {
        // 別の操作の書き込みが途中で止まっていた: 記録だけ残して先へ進む（管理者が履歴で確認できる）
        recordHistory_(ctx, 'storage.incompleteWrite', 'Storage', '', journal.eventId || '', null, { action: journal.action, at: journal.at, actor: journal.actor });
        props.deleteProperty(WRITE_JOURNAL_KEY_);
      }
      // ログインの確認と権限の確認は、ロックの中で最新のデータに対してやり直す（パスワード変更・主催者の付け替えと同時に操作された場合に備える）
      if (user.kind === 'staff' || user.kind === 'google') {
        user = authenticate_(function () {
          return ctx;
        }, auth);
        ctx.user = user;
      }
      if (spec.scope === 'event') authorizeEventPayload_(ctx, payload);
      // 自動終了（F05）の判定は、試合・組み合わせ・段階が変わりうる操作の後だけ（大会設定の保存などでは判定しない）
      ctx.touchedResults = NO_COMPLETION_CHECK_.indexOf(action) === -1;
      result = spec.fn(ctx, payload) || {};
      var eventIds = [];
      if (result.eventId) eventIds.push(result.eventId);
      (result.alsoPublish || []).forEach(function (id) {
        if (eventIds.indexOf(id) === -1) eventIds.push(id);
      });
      delete result.alsoPublish;
      eventIds.forEach(function (id) {
        afterEventChange_(ctx, id);
      });
      flushHistory_(ctx);
      // 公開データも書き込む前に組み立てる。大きすぎるときは何も保存せずに止める（保存してから気づくことがないように）
      var publications = {};
      eventIds.forEach(function (id) {
        try {
          publications[id] = syncPublication_(ctx, id);
        } catch (e) {
          if (e && e.appCode === 'TOO_LARGE') throw e;
          // 公開データを作る処理の思わぬ失敗では、操作そのものは保存する（結果の入力を止めない）。
          // 閲覧ページへの反映は「公開データを再生成」でやり直せる
          console.error('syncPublication_ failed', id, e && e.message);
          publications[id] = { published: false, failed: true, message: (e && e.publicMessage) || '公開データを書き込めませんでした' };
        }
      });
      props.setProperty(WRITE_JOURNAL_KEY_, JSON.stringify({ key: dedupeKey, action: action, eventId: result.eventId || '', at: ctx.now, actor: user.label }));
      commitContext_(ctx);
      if (result.eventId) {
        result.publication = publications[result.eventId];
        result.detail = eventDetail_(ctx, result.eventId);
      }
      delete result.forceRepublish;
    }
    SpreadsheetApp.flush();
    // 大会作成は、通信が切れて再送されても作った大会を開けるよう、大会 ID を保存する（サーバー内のみ・10 分）
    var memo = (action === 'createEvent' || action === 'createSampleEvent' || action === 'duplicateEvent' || action === 'restoreEvent') && result && result.eventId ? { eventId: result.eventId } : {};
    cache.put(dedupeKey, JSON.stringify(memo), ADMIN_CONFIG.REQUEST_DEDUPE_TTL_SEC);
    props.deleteProperty(WRITE_JOURNAL_KEY_);
    return result;
  } finally {
    lock.releaseLock();
  }
}

function duplicateResult_(stored) {
  var memo = {};
  try {
    memo = JSON.parse(stored) || {};
  } catch (e) {
    memo = {};
  }
  memo.duplicate = true;
  return memo;
}

// ---- shared/summary.js ----
/* 大会一覧の要約（ポータル「トーナメント・リーグ」に出す 1 大会分の情報）
 *
 * 運営用・閲覧者用の両方の Code.gs に入る（tools/build.mjs が末尾に付ける）。
 * 入力は公開データと同じ形（運営用の buildEventView_(bundle, false)、閲覧者用は PublicSnapshots の JSON）なので、
 * 公開データに含まれない項目（選手メモ・主催者・パスワードなど）はここに来ない。
 *
 * 進捗率は「確定した試合 ÷ 全試合」。まだ対戦カード・トーナメント表を作っていない段階があるときは、
 * その段階の試合数を出場者から見積もって分母に足し、見積もれない段階があれば 100% にはしない
 * （全試合確定の判定と同じく「試合のない段階がないこと」を完了の条件にする）。
 */

var SUMMARY_STAGE_LABEL_ = Object.freeze({
  round_robin: 'ロビン',
  league: 'リーグ',
  single_elimination: 'トーナメント',
  double_elimination: 'ダブルエリミネーション',
  swiss: 'スイス式',
  series: 'ポイントシリーズ',
});

/** 段階の種類 → 一覧の大分類（shared/formats.js の FORMAT_CATEGORY_LABEL） */
var SUMMARY_STAGE_KIND_ = Object.freeze({
  round_robin: 'robin',
  league: 'league',
  single_elimination: 'tournament',
  double_elimination: 'tournament',
  swiss: 'swiss',
  series: 'series',
});

/** 対戦カードを作る前の段階の試合数の見積もり。見積もれないときは null */
function estimateStageMatches_(stage) {
  if (stage.type === 'single_elimination') {
    var n = (stage.entrants || []).length;
    if (n < 2) return null;
    return n - 1 + (stage.thirdPlace && n >= 4 ? 1 : 0);
  }
  if (stage.type === 'double_elimination') {
    var de = (stage.entrants || []).length;
    return de >= 2 ? 2 * de - 2 : null;
  }
  if (stage.type === 'swiss') {
    var sw = (stage.groups && stage.groups[0] ? stage.groups[0].players : []).length;
    var rounds = stage.swiss ? stage.swiss.rounds : 0;
    return sw >= 2 && rounds ? rounds * Math.floor(sw / 2) : null;
  }
  if (stage.type === 'series') {
    var roster = (stage.roster || []).length;
    return roster >= 2 && stage.planned ? stage.planned * (roster - 1) : null;
  }
  var cycles = stage.cycles === 2 ? 2 : 1;
  var sum = 0;
  (stage.groups || []).forEach(function (g) {
    var k = (g.players || []).length;
    if (k >= 2) sum += ((k * (k - 1)) / 2) * cycles;
  });
  return sum > 0 ? sum : null;
}

/**
 * 大会の形式: 実際の段階の種類から決める（作成後に「形式」タブで段階を変えられるので、作成時のひな形の名前は使わない）。
 * シリーズ・スイス式を含む大会はその分類、それ以外は「ロビン」「リーグ」「トーナメント」「複合」。
 * formatId は作成時のひな形（v0.8 以降）。参考として返すだけ
 */
function summaryFormat_(stages, formatId) {
  var flow = [];
  stages.forEach(function (st) {
    var label = SUMMARY_STAGE_LABEL_[st.type] || '';
    if (label && flow[flow.length - 1] !== label) flow.push(label);
  });
  var kinds = {};
  stages.forEach(function (st) {
    if (SUMMARY_STAGE_LABEL_[st.type]) kinds[st.type] = true;
  });
  var types = Object.keys(kinds);
  var out;
  if (!types.length) out = { kind: 'none', label: '未設定', flow: '' };
  else if (kinds.series) out = { kind: 'series', label: 'ポイントシリーズ', flow: flow.join(' → ') };
  else if (kinds.swiss) out = { kind: 'swiss', label: 'スイス式', flow: flow.join(' → ') };
  else if (types.length > 1) out = { kind: 'mixed', label: '複合', flow: flow.join(' → ') };
  else out = { kind: SUMMARY_STAGE_KIND_[types[0]] || 'robin', label: SUMMARY_STAGE_LABEL_[types[0]], flow: flow.join(' → ') };
  if (formatId) out.id = formatId;
  return out;
}

/**
 * view: 公開データの形の大会（{ event, stages, dataUpdatedAt }）
 * publishedAt: 公開データを書いた時刻（閲覧者用のみ。更新時刻が読めない古いデータの代わり）
 */
function summarizeEventView_(view, publishedAt) {
  var ev = (view && view.event) || {};
  var stages = ((view && view.stages) || []).slice().sort(function (a, b) {
    return (a.order || 0) - (b.order || 0);
  });
  var total = 0;
  var final = 0;
  var live = 0;
  var estimated = 0;
  var unknown = false;
  var list = stages.map(function (st) {
    var p = st.progress || {};
    var t = Number(p.total) || 0;
    var f = Number(p.final) || 0;
    var l = Number(p.live) || 0;
    var generated = t > 0;
    // スイス式・シリーズは 1 回戦・1 節ずつ組むので、組んでいない回戦・節の分を見積もって足す
    var stepwise = st.type === 'swiss' || st.type === 'series';
    var est = generated && !stepwise ? 0 : estimateStageMatches_(st);
    if (est === null) {
      unknown = !generated;
      est = 0;
    } else if (stepwise) {
      est = Math.max(0, est - t);
    }
    total += t;
    final += f;
    live += l;
    estimated += est;
    return {
      name: String(st.name || ''),
      type: String(st.type || ''),
      total: t,
      final: f,
      live: l,
      generated: generated,
      estimated: generated && !stepwise ? 0 : est,
      // v0.8 の公開データには段階の完了（未実施の節・回戦・リセットの決勝を含む）がある。古いデータは試合数で判定
      complete: typeof st.complete === 'boolean' ? st.complete : generated && f === t,
    };
  });
  var complete = list.length > 0 && list.every(function (s) {
    return s.complete;
  });
  var denom = total + estimated;
  var percent = denom > 0 ? Math.floor((final * 100) / denom) : 0;
  if (!complete && percent >= 100) percent = 99;
  if (complete) percent = 100;

  var current = null;
  for (var i = 0; i < list.length; i++) {
    if (!list[i].complete) {
      current = { name: list[i].name, type: list[i].type, state: list[i].generated ? (list[i].final || list[i].live ? 'running' : 'ready') : 'ungenerated' };
      break;
    }
  }
  if (!current && list.length) {
    var last = list[list.length - 1];
    current = { name: last.name, type: last.type, state: 'done' };
  }

  return {
    id: String(ev.id || ''),
    name: String(ev.name || ''),
    dateLabel: String(ev.dateLabel || ''),
    status: String(ev.status || ''),
    format: summaryFormat_(stages, ev.format),
    // 古い公開データ（v0.6.0 以前に作られたもの）には人数がない。ないものは null（画面では「—」）
    playerCount: typeof ev.playerCount === 'number' ? ev.playerCount : null,
    matchCount: total,
    finalCount: final,
    liveCount: live,
    progress: {
      percent: percent,
      complete: complete,
      pendingStages: list.filter(function (s) {
        return !s.generated;
      }).length,
      estimated: estimated,
      partial: unknown,
    },
    stages: list,
    currentStage: current,
    updatedAt: String((view && view.dataUpdatedAt) || publishedAt || ''),
  };
}
