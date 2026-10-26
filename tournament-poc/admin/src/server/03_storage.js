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
 * 3b. v3 への移行だけ: 共同主催者の v0.8 の email 列（メールアドレスだけで権限があった）を invite_email（招待）へ移す（migrateRecords_）
 * 4. 件数（と 3b の結果）が正しいことを確かめてから SCHEMA_VERSION を上げる
 * 何度呼んでも安全（移行済みなら何もしない）。途中で止まっても、やり直せば続きから終わる（3b は移していない行だけを移す）。
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
    // 途中で止まった移行を同じ秒にやり直すと名前が重なるので、番号を付けて分ける（前のバックアップは消さない）
    for (var k = 2; ss.getSheetByName(backupName); k++) backupName = BACKUP_PREFIX_ + 's' + from + '-' + stamp + '-' + k + '-' + name;
    copy.setName(backupName);
    state.backups.push(backupName);
  });
  props.setProperty('MIGRATION_STATE', JSON.stringify(state));
  var init = initializeStorage_(ss, { keepVersion: true });
  var records = migrateRecords_(ss, from);
  state.records = records;
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
  return { from: from, to: to, migrated: true, backups: state.backups, added: init, counts: after, records: records };
}

/**
 * 値の移し替え（列の追加の後）。v3: 共同主催者の email 列を invite_email へ移し、email 列を空にする。
 * 移した行は「招待中」（権限なし）になり、本人がログインして sub を紐付けると有効になる。
 * email 列を空にするのは、旧版（v0.8 まで。email 列で権限を判定する）に戻したときに、招待に権限が付かないようにするため。
 */
function migrateRecords_(ss, from) {
  var out = { collaboratorsMoved: 0 };
  if (from >= 3 || !ss.getSheetByName('Collaborators')) return out;
  var table = readTable_(ss, 'Collaborators');
  table.rows.forEach(function (r) {
    if (!r.email || collabActive_(r)) return;
    r.invite_email = r.invite_email || normalizeEmail_(r.email) || r.email;
    r.email = '';
    r._dirty = true;
    out.collaboratorsMoved++;
  });
  if (out.collaboratorsMoved) writeUpdates_(table);
  var left = readTable_(ss, 'Collaborators').rows.filter(function (r) {
    return r.email && !collabActive_(r);
  });
  if (left.length) throw appError_('MIGRATION_FAILED', '共同主催者の移し替えが終わっていません（残り ' + left.length + ' 件）。もう一度移行を実行してください。');
  return out;
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
