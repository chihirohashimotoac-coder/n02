/**
 * n02 Tournament PoC - 運営用 Web アプリ（サーバー側 API）
 *
 * このプロジェクトだけがスプレッドシートへ書き込む。閲覧者用 Web アプリは別プロジェクトで、
 * 読み取り専用スコープしか持たない（README「セキュリティ設計」参照）。
 *
 * 運営画面は GitHub Pages に置き、この Web アプリには fetch（doPost）で JSON を送る。
 * 公開されるトップレベル関数は doGet と doPost の 2 つだけ。それ以外は名前の末尾に "_" を付けた内部関数。
 * doPost は呼び出しのたびに、大会ごとの運営用の鍵（または管理者の鍵）を検証する（02_auth.js）。
 */

var ADMIN_CONFIG = Object.freeze({
  APP_VERSION: '0.4.0',
  SCHEMA_VERSION: 1,
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
  MAX_STAGES: 8,
  MAX_ELIMINATION_ENTRANTS: 128,
  MAX_REQUEST_CHARS: 100000,
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
});

var RULE_FORMAT = Object.freeze({
  BEST_OF_LEGS: 'best_of_legs', // Best of N Legs
  BEST_OF_SETS: 'best_of_sets', // Best of N セット（各セット Best of M Legs）
});

var STAGE_TYPE_LABEL = Object.freeze({
  round_robin: 'ロビン',
  league: 'リーグ',
  single_elimination: 'トーナメント',
});

/**
 * シート定義。列は見出し名で参照するため、列の並べ替えや末尾への列追加には耐える。
 * 型: text = 文字列（書式「書式なしテキスト」で保存）, int = 整数, bool = 真偽値
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
      ['admin_key_hash', 'text'], // 運営用の鍵の SHA-256。空欄の大会は管理者だけが操作できる
      ['admin_key_issued_at', 'text'],
      ['notes', 'text'],
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
]);
