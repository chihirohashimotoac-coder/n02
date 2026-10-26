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
  APP_VERSION: '0.9.0',
  // 1 = v0.7 まで。2 = v0.8（大会設定・所属/Rt・試合の予定/特殊な結果・共同主催者など。列とシートの追加だけ）
  // 3 = v0.9（主催者・共同主催者を Google の不変 ID（sub）で識別する列。共同主催者の旧 email 列は invite_email へ移す）
  SCHEMA_VERSION: 3,
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
  // v0.9: 1 つの大会・招待に記録する「確認待ちのログイン」（同じメールアドレスの別アカウント）の上限
  MAX_LINK_CLAIMS: 5,
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
      ['owner_email', 'text'], // 主催者の Google アカウントのメールアドレス（小文字）。v0.9 から表示と紐付けの手がかりだけに使い、権限は owner_sub で判定する。空欄の大会は管理者だけが操作できる
      ['staff_pass_hash', 'text'], // 店舗スタッフ用の管理パスワードのソルト付き SHA-256。空欄なら未設定
      ['staff_pass_salt', 'text'],
      ['staff_pass_set_at', 'text'],
      ['notes', 'text'],
      ['config_json', 'text', 2], // v0.8: 大会の設定（形式・お知らせ・ルール表示・公開する項目・自動終了など）
      ['rev', 'int'],
      ['created_at', 'text'],
      ['updated_at', 'text'],
      ['owner_sub', 'text', 3], // v0.9: 主催者の Google アカウントの不変 ID（ID トークンの sub）。権限の判定に使う。画面・公開データには出さない
      ['owner_link_json', 'text', 3], // v0.9: 紐付けた時のメールアドレス・方法、確認待ちのログイン（02b_identity.js）
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
  // v0.9: 主催者が入力したメールアドレスは「招待」（invite_email）で、権限はない。招待先がログインして sub を紐付けると有効になる。
  //       email 列は v0.8 の形式（メールアドレスだけで権限があった）。v0.9 は書かず、移行で invite_email へ移す（旧版に戻しても招待に権限が付かない）
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
      ['invite_email', 'text', 3], // v0.9: 招待したメールアドレス（小文字）
      ['sub', 'text', 3], // v0.9: 紐付けた Google アカウントの不変 ID。空欄なら招待中（権限なし）
      ['link_json', 'text', 3], // v0.9: 紐付けた時のメールアドレス・方法、確認待ちのログイン
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
