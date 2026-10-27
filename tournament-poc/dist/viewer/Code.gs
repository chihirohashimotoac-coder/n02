// ==== n02 Tournament PoC 閲覧者用 Web アプリ / Code.gs ====
// このファイルは tools/build.mjs が viewer/src/server/*.js から生成したものです。直接編集しないでください。

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

// ---- 00_viewer.js ----
/**
 * n02 Tournament PoC - 閲覧者用 Web アプリ（サーバー側）
 *
 * このプロジェクトは読み取り専用。
 * - OAuth スコープは spreadsheets.readonly のみ（appsscript.json で固定）。書き込み API を呼ぶ権限そのものを持たない
 * - 読み込みは Sheets API（高度なサービス「Google Sheets API」）の values.get。SpreadsheetApp は使わない
 * - google.script.run から呼べる関数は doGet と getPublicSnapshot の 2 つだけ（一覧は doGet の ?format=list のみ）
 * - 読むのは運営者用アプリが作った PublicSnapshots シート（公開してよい項目だけの JSON）だけ
 *
 * 読み込み負荷対策:
 * - CacheService（スクリプトキャッシュ、全閲覧者で共有）に CACHE_TTL_SEC 秒保持
 * - キャッシュ切れの瞬間に全員がシートを読みに行かないよう、ロックで 1 リクエストだけが再読込する
 * - シートが読めないときは、長めに保持している予備のキャッシュ（stale）を返す
 */

var VIEWER_CONFIG = Object.freeze({
  APP_VERSION: '1.0.0',
  CACHE_TTL_SEC: 20,
  STALE_TTL_SEC: 21600, // CacheService の上限（6 時間）
  NONE_TTL_SEC: 20,
  LOCK_WAIT_MS: 3000,
  REFRESH_INTERVAL_SEC: 60,
  REFRESH_JITTER_SEC: 10,
  // CacheService の 1 値あたりの上限は 100KB（バイト）。日本語は 1 文字 3 バイトになるので、
  // 1 つの値は 30,000 文字までに分けて入れる（v0.8。以前は 90,000 文字を超える大会をキャッシュしなかった）
  MAX_CACHE_CHARS: 30000,
  MAX_CACHE_PARTS: 20,
  SHEET_NAME: 'PublicSnapshots',
  CACHE_PREFIX: 'pub:v1:',
});

var VIEWER_EVENT_ID_PATTERN_ = /^EVT-[A-Z0-9]{4,32}$/;
// v1.0: 大きな大会の試合一覧を分けた行（パート）の ID。大会 ID + ".P" + 2 桁
var VIEWER_PART_ID_PATTERN_ = /^(EVT-[A-Z0-9]{4,32})\.P(\d{2})$/;
var DEFAULT_KEY_ = '_default';
// 公開中の大会の一覧（ポータル用）。大会 ID の形（EVT-…）とは重ならない
var LIST_KEY_ = '_list';
// 一覧に載せる大会の上限（運営用アプリの MAX_EVENTS_TOTAL と同じ。キャッシュ 1 件の大きさを抑える）
var LIST_MAX_EVENTS_ = 200;
// シートを読めないときに返す予備の内容（stale:…）と、予備を持っている大会の一覧のキー
var STALE_PREFIX_ = 'stale:';
var STALE_IDS_KEY_ = '_ids';
// 本番反映のときに、反映した正本のコミット（SHA）に置き換わる
var VIEWER_RELEASE_ID_ = 'manual';
// 大きな値を分けて入れたときの目印（{ "__parts": n }）と、各部分のキーの付け方（キー + "#" + 番号）
var PART_SEPARATOR_ = '#';

/**
 * ?format=json のときは画面ではなく公開データ（getPublicSnapshot と同じ内容）を JSON で返す。
 * Google の外（GitHub Pages）に置いた閲覧ページが fetch で読むための口。
 * ブラウザで複数の Google アカウントにログインしていると、Apps Script の画面（HtmlService）は
 * URL が /macros/u/1/… に書き換えられて開けないことが実環境で分かったため、閲覧ページを外に出せるようにした。
 * fetch は Cookie を送らない（匿名アクセス）ので、この問題の影響を受けない。
 */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.format === 'version') {
    // 本番反映の確認用（どの版のコードが動いているか。秘密の情報は含まない）
    var info = { ok: true, app: 'n02-tournament-viewer', version: VIEWER_CONFIG.APP_VERSION, release: VIEWER_RELEASE_ID_ };
    return ContentService.createTextOutput(JSON.stringify(info)).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.format === 'list') {
    var list = getPublicList_({ knownVersion: p.known || '' });
    return ContentService.createTextOutput(JSON.stringify(list)).setMimeType(ContentService.MimeType.JSON);
  }
  if (p.format === 'json') {
    var res = getPublicSnapshot({ eventId: p.event || '', part: p.part || '', knownVersion: p.known || '' });
    return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('n02 Tournament')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 公開データを返す。
 * request = { eventId?: string, part?: string, knownVersion?: string }
 * v1.0: part（"EVT-….P01"）を指定すると、その大会の分割した試合一覧（パート）を返す。大会の本体が公開中で、
 * 本体の parts に載っているパートだけを返す（消し忘れた行・非公開の大会のパートは返さない）。
 * 戻り値 = { ok, version, publishedAt, servedAt, stale, notModified?, data?, refresh } | { ok:false, error, refresh }
 * 例外は投げず、内部情報を含まない固定文言のエラーを返す。
 */
function getPublicSnapshot(request) {
  var refresh = { intervalSec: VIEWER_CONFIG.REFRESH_INTERVAL_SEC, jitterSec: VIEWER_CONFIG.REFRESH_JITTER_SEC };
  var servedAt = new Date().toISOString();
  try {
    var req = request && typeof request === 'object' ? request : {};
    var eventId = '';
    if (req.eventId !== undefined && req.eventId !== null && req.eventId !== '') {
      if (typeof req.eventId !== 'string' || !VIEWER_EVENT_ID_PATTERN_.test(req.eventId)) {
        return { ok: false, error: { code: 'BAD_REQUEST', message: '大会の指定が正しくありません。' }, servedAt: servedAt, refresh: refresh };
      }
      eventId = req.eventId;
    }
    var knownVersion = typeof req.knownVersion === 'string' ? req.knownVersion.slice(0, 64) : '';
    var part = '';
    if (req.part !== undefined && req.part !== null && req.part !== '') {
      var pm = typeof req.part === 'string' ? req.part.match(VIEWER_PART_ID_PATTERN_) : null;
      if (!pm || !eventId || pm[1] !== eventId) {
        return { ok: false, error: { code: 'BAD_REQUEST', message: '大会の指定が正しくありません。' }, servedAt: servedAt, refresh: refresh };
      }
      part = req.part;
    }

    var entry = loadEntry_(part || eventId || DEFAULT_KEY_);
    if (!entry || entry.none) {
      return {
        ok: false,
        error: { code: 'NO_PUBLIC_EVENT', message: eventId ? 'この大会は公開されていません。' : '現在公開中の大会はありません。' },
        servedAt: servedAt,
        stale: !!(entry && entry.stale),
        refresh: refresh,
      };
    }
    var res = {
      ok: true,
      version: entry.version,
      publishedAt: entry.publishedAt,
      servedAt: servedAt,
      stale: !!entry.stale,
      cache: entry.source,
      refresh: refresh,
    };
    if (knownVersion && knownVersion === entry.version) {
      res.notModified = true;
    } else {
      res.data = JSON.parse(entry.json);
    }
    return res;
  } catch (err) {
    console.error('getPublicSnapshot failed', err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'UNAVAILABLE', message: 'データを取得できませんでした。' }, servedAt: servedAt, refresh: refresh };
  }
}

/**
 * 公開中の大会の一覧（ポータル「トーナメント・リーグ」用）。?format=list で返す。
 * 公開データ（PublicSnapshots）から作った要約だけを返す。非公開の大会は PublicSnapshots に行がないので載らない。
 * 1 回のシート読み込みで全大会分を作り、各大会のデータと一緒にキャッシュする（大会ごとの問い合わせは発生しない）。
 * 戻り値 = { ok, version, servedAt, stale, notModified?, data?: { events: [...] }, refresh } | { ok:false, error, refresh }
 */
function getPublicList_(request) {
  var refresh = { intervalSec: VIEWER_CONFIG.REFRESH_INTERVAL_SEC, jitterSec: VIEWER_CONFIG.REFRESH_JITTER_SEC };
  var servedAt = new Date().toISOString();
  try {
    var req = request && typeof request === 'object' ? request : {};
    var knownVersion = typeof req.knownVersion === 'string' ? req.knownVersion.slice(0, 64) : '';
    var entry = loadEntry_(LIST_KEY_);
    if (!entry || entry.none) entry = { version: 'empty', json: '{"events":[]}' };
    var res = { ok: true, version: entry.version, servedAt: servedAt, stale: !!entry.stale, cache: entry.source, refresh: refresh };
    if (knownVersion && knownVersion === entry.version) res.notModified = true;
    else res.data = JSON.parse(entry.json);
    return res;
  } catch (err) {
    console.error('getPublicList failed', err && err.stack ? err.stack : err);
    return { ok: false, error: { code: 'UNAVAILABLE', message: '大会の一覧を取得できませんでした。' }, servedAt: servedAt, refresh: refresh };
  }
}

/** 公開データの JSON から一覧の要約を作る。壊れた・形の違うデータは載せない */
function buildListEntry_(entries) {
  var events = [];
  entries.forEach(function (e) {
    if (events.length >= LIST_MAX_EVENTS_) return;
    try {
      var view = JSON.parse(e.json);
      if (!view || !view.event || view.event.id !== e.eventId) return;
      events.push(summarizeEventView_(view, e.publishedAt));
    } catch (err) {
      console.warn('list summary failed', e.eventId, err && err.message);
    }
  });
  var json = JSON.stringify({ events: events });
  return { version: md5HexViewer_(json), publishedAt: '', json: json };
}

function md5HexViewer_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** キャッシュに入れる値: { version, publishedAt, json } または { none: true } */
function loadEntry_(key) {
  var cache = CacheService.getScriptCache();
  var hit = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + key);
  if (hit) {
    hit.source = 'hit';
    return hit;
  }

  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(VIEWER_CONFIG.LOCK_WAIT_MS);
  } catch (e) {
    locked = false;
  }
  try {
    // 待っている間に別のリクエストが読み直していればそれを使う
    hit = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + key);
    if (hit) {
      hit.source = 'hit-after-wait';
      return hit;
    }
    if (!locked) {
      // 読み直しが長引いている。待っている全員がシートを読みに行かないよう、前回の内容で答える
      var waiting = readStale_(cache, key);
      if (waiting) return waiting;
    }
    var fresh;
    try {
      fresh = refreshFromSheet_(cache);
    } catch (e) {
      console.error('refreshFromSheet_ failed', e && e.message);
      var stale = readStale_(cache, key);
      if (stale) return stale;
      throw e;
    }
    var entry = fresh[key];
    if (!entry) {
      // 公開されていない大会 ID への問い合わせも短時間キャッシュし、シートの再読込を繰り返さない
      entry = { none: true };
      cache.put(VIEWER_CONFIG.CACHE_PREFIX + key, JSON.stringify(entry), VIEWER_CONFIG.NONE_TTL_SEC);
    }
    entry.source = 'miss';
    return entry;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function readStale_(cache, key) {
  var stale = readCache_(cache, VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + key);
  if (!stale) return null;
  stale.stale = true;
  stale.source = 'stale';
  return stale;
}

function readCache_(cache, fullKey) {
  var raw = cache.get(fullKey);
  if (!raw) return null;
  try {
    var value = JSON.parse(raw);
    if (value && typeof value.__parts === 'number') {
      var keys = [];
      for (var i = 1; i <= value.__parts; i++) keys.push(fullKey + PART_SEPARATOR_ + i);
      var parts = cache.getAll(keys);
      var text = '';
      for (var j = 0; j < keys.length; j++) {
        if (typeof parts[keys[j]] !== 'string') return null; // 一部が消えていたら、無いものとして読み直す
        text += parts[keys[j]];
      }
      return JSON.parse(text);
    }
    return value;
  } catch (e) {
    return null;
  }
}

/** キャッシュに入れる値を 1 つ足す。大きい値は分けて入れる（入れられない大きさなら入れない） */
function addCacheValue_(bag, fullKey, value) {
  if (value.length <= VIEWER_CONFIG.MAX_CACHE_CHARS) {
    bag[fullKey] = value;
    return true;
  }
  var count = Math.ceil(value.length / VIEWER_CONFIG.MAX_CACHE_CHARS);
  if (count > VIEWER_CONFIG.MAX_CACHE_PARTS) return false;
  bag[fullKey] = JSON.stringify({ __parts: count });
  for (var i = 0; i < count; i++) {
    bag[fullKey + PART_SEPARATOR_ + (i + 1)] = value.slice(i * VIEWER_CONFIG.MAX_CACHE_CHARS, (i + 1) * VIEWER_CONFIG.MAX_CACHE_CHARS);
  }
  return true;
}

/**
 * PublicSnapshots シートを 1 回だけ読み、全公開大会と既定大会の分をまとめてキャッシュへ入れる。
 * 戻り値: { [eventId | '_default']: entry }
 */
function refreshFromSheet_(cache) {
  var all = readPublishedEntries_();
  // v1.0: パートは、公開中の本体が parts に載せているものだけを配る
  var listed = {};
  var entries = all.filter(function (e) {
    if (e.partOf) return false;
    e.partIds.forEach(function (id) {
      listed[id] = e.eventId;
    });
    return true;
  });
  var fresh = {};
  all.forEach(function (e) {
    if (e.partOf && listed[e.eventId] === e.partOf) fresh[e.eventId] = { version: e.version, publishedAt: e.publishedAt, json: e.json };
  });
  var staleValues = {};
  var freshValues = {};
  var defaultEntry = null;
  var newest = null;
  entries.forEach(function (e) {
    fresh[e.eventId] = { version: e.version, publishedAt: e.publishedAt, json: e.json };
    if (e.isDefault && !defaultEntry) defaultEntry = e;
    if (!newest || e.publishedAt > newest.publishedAt) newest = e;
  });
  var def = defaultEntry || newest;
  fresh[DEFAULT_KEY_] = def ? { version: def.version, publishedAt: def.publishedAt, json: def.json } : { none: true };
  fresh[LIST_KEY_] = buildListEntry_(entries);

  Object.keys(fresh).forEach(function (k) {
    var value = JSON.stringify(fresh[k]);
    if (!addCacheValue_(freshValues, VIEWER_CONFIG.CACHE_PREFIX + k, value)) {
      console.warn('snapshot too large for cache', k, value.length);
      return;
    }
    if (!fresh[k].none) addCacheValue_(staleValues, VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + k, value);
  });
  // 公開をやめた・削除した大会の予備（stale）を消す。残すと、シートを読めないときに非公開の大会を返してしまう
  var staleIdsKey = VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + STALE_IDS_KEY_;
  var previousIds = readCache_(cache, staleIdsKey);
  if (!Array.isArray(previousIds)) previousIds = [];
  var currentIds = Object.keys(staleValues)
    .filter(function (fullKey) {
      return fullKey.indexOf(PART_SEPARATOR_) === -1;
    })
    .map(function (fullKey) {
      return fullKey.slice((VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_).length);
    });
  var gone = [];
  previousIds
    .filter(function (k) {
      return currentIds.indexOf(k) < 0;
    })
    .forEach(function (k) {
      var key = VIEWER_CONFIG.CACHE_PREFIX + STALE_PREFIX_ + k;
      gone.push(key);
      for (var i = 1; i <= VIEWER_CONFIG.MAX_CACHE_PARTS; i++) gone.push(key + PART_SEPARATOR_ + i);
    });
  if (gone.length) cache.removeAll(gone);
  staleValues[staleIdsKey] = JSON.stringify(currentIds);
  if (fresh[DEFAULT_KEY_].none) {
    cache.put(VIEWER_CONFIG.CACHE_PREFIX + DEFAULT_KEY_, freshValues[VIEWER_CONFIG.CACHE_PREFIX + DEFAULT_KEY_], VIEWER_CONFIG.NONE_TTL_SEC);
    delete freshValues[VIEWER_CONFIG.CACHE_PREFIX + DEFAULT_KEY_];
  }
  if (Object.keys(freshValues).length) cache.putAll(freshValues, VIEWER_CONFIG.CACHE_TTL_SEC);
  if (Object.keys(staleValues).length) cache.putAll(staleValues, VIEWER_CONFIG.STALE_TTL_SEC);
  return fresh;
}

function readPublishedEntries_() {
  var id = (PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim();
  if (!/^[A-Za-z0-9_-]{25,100}$/.test(id)) throw new Error('SPREADSHEET_ID is not configured');
  // SpreadsheetApp.openById は読むだけでも spreadsheets（編集を含む）スコープを要求するため、
  // 参照専用スコープ（spreadsheets.readonly）で使える Sheets API（高度なサービス）で読む。
  var values;
  try {
    values = Sheets.Spreadsheets.Values.get(id, VIEWER_CONFIG.SHEET_NAME).values || [];
  } catch (e) {
    // 運営側でまだ初期化していない（シートがない）場合は「公開中の大会なし」として扱う
    if (/Unable to parse range/i.test(String(e && e.message))) return [];
    throw e;
  }
  if (values.length < 2) return [];
  var header = values[0].map(function (h) {
    return String(h).trim();
  });
  var col = function (name) {
    return header.indexOf(name);
  };
  var iEvent = col('event_id');
  var iDefault = col('is_default');
  var iVersion = col('version');
  var iPublished = col('published_at');
  var iCount = col('chunk_count');
  if (iEvent < 0 || iVersion < 0 || iCount < 0) throw new Error('PublicSnapshots header is broken');

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var eventId = String(row[iEvent] || '').trim();
    var partOf = eventId.match(VIEWER_PART_ID_PATTERN_);
    if (!VIEWER_EVENT_ID_PATTERN_.test(eventId) && !partOf) continue;
    var count = Number(row[iCount]);
    if (!(count >= 1 && count <= 10)) continue;
    var json = '';
    var parsed = null;
    var broken = false;
    for (var c = 1; c <= count; c++) {
      var idx = col('chunk_' + (c < 10 ? '0' : '') + c);
      var part = idx >= 0 ? String(row[idx] || '') : '';
      if (part.charAt(0) !== '~') {
        broken = true;
        break;
      }
      json += part.slice(1);
    }
    if (broken) continue;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      console.warn('broken snapshot', eventId);
      continue;
    }
    var published = row[iPublished];
    out.push({
      eventId: eventId,
      partOf: partOf ? partOf[1] : '',
      partIds: !partOf && parsed && Array.isArray(parsed.parts)
        ? parsed.parts.map(function (x) {
            return x && x.id;
          })
        : [],
      isDefault: row[iDefault] === true || String(row[iDefault]).toUpperCase() === 'TRUE',
      version: String(row[iVersion] || ''),
      publishedAt: Object.prototype.toString.call(published) === '[object Date]' ? published.toISOString() : String(published || ''),
      json: json,
    });
  }
  return out;
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
  promotion: '入替戦',
});

/** 段階の種類 → 一覧の大分類（shared/formats.js の FORMAT_CATEGORY_LABEL） */
var SUMMARY_STAGE_KIND_ = Object.freeze({
  round_robin: 'robin',
  league: 'league',
  single_elimination: 'tournament',
  double_elimination: 'tournament',
  swiss: 'swiss',
  series: 'series',
  promotion: 'league',
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
  if (stage.type === 'promotion') {
    // v1.0: 期制リーグの入替戦（隣接するディビジョンの組ごとに 1 試合）
    var pairs = (stage.pairs || []).length;
    return pairs ? pairs : null;
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
