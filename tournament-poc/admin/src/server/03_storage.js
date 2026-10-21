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

/**
 * シートを読み、列定義に従って型をそろえたレコードの配列にする。
 * 見出しで列を引くので、列の順番が変わっても動く。主キーが空の行は無視する。
 */
function readTable_(ss, name) {
  var def = SCHEMA[name];
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw appError_('NOT_INITIALIZED', 'シート「' + name + '」がありません。初期化を実行してください。');
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
  def.columns.forEach(function (c) {
    if (index[c[0]] === undefined) {
      throw appError_('NOT_INITIALIZED', 'シート「' + name + '」に列「' + c[0] + '」がありません。初期化を実行してください。');
    }
  });

  var rows = [];
  var byKey = {};
  var duplicates = {};
  for (var r = 1; r < values.length; r++) {
    var raw = values[r];
    var key = coerceCell_(raw[index[def.key]], 'text').trim();
    if (!key) continue;
    var rec = { _row: r + 1, _raw: raw };
    def.columns.forEach(function (c) {
      rec[c[0]] = coerceCell_(raw[index[c[0]]], c[1]);
    });
    rec[def.key] = key;
    if (byKey[key]) {
      duplicates[key] = true;
    } else {
      byKey[key] = rec;
    }
    rows.push(rec);
  }
  return {
    name: name,
    def: def,
    sheet: sheet,
    headers: headers,
    index: index,
    width: lastCol,
    lastRow: lastRow,
    rows: rows,
    byKey: byKey,
    duplicates: duplicates,
  };
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
    if (Object.prototype.hasOwnProperty.call(rec, c[0])) {
      out[table.index[c[0]]] = toCell_(rec[c[0]], c[1]);
    }
  });
  return out;
}

/** 既存行を 1 行まるごと書き戻す（定義外の列は読み込んだ値のまま残す）。 */
function updateRecord_(table, rec) {
  if (!rec._row) throw appError_('INTERNAL', '更新対象の行が不明です。');
  table.sheet.getRange(rec._row, 1, 1, table.width).setValues([rowValues_(table, rec, rec._raw)]);
}

function appendRecords_(table, records) {
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
 * 行を消す。行番号の大きい順に、連続した行はまとめて消す（先に上を消すと下の行番号がずれるため）。
 * 見出し以外の行をすべて消すとスプレッドシートがエラーにするので、その場合は先に空の行を 1 行足しておく。
 */
function deleteRecords_(table, records) {
  var rows = records
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
function initializeStorage_(ss) {
  var sheets = ss.getSheets();
  var byName = {};
  sheets.forEach(function (s) {
    byName[s.getName()] = s;
  });

  var problems = [];
  var alreadyInitialized = !!byName.Events && headerOf_(byName.Events).indexOf('event_id') !== -1;
  if (!alreadyInitialized) {
    sheets.forEach(function (s) {
      if (SCHEMA[s.getName()]) return;
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

  PropertiesService.getScriptProperties().setProperty('SCHEMA_VERSION', String(ADMIN_CONFIG.SCHEMA_VERSION));
  return { created: created, extended: extended };
}

/** 画面の「セットアップ」表示用。書き込みはしない。 */
function getStorageStatus_() {
  var status = {
    configured: false,
    accessible: false,
    initialized: false,
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
  SHEET_ORDER.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      status.missing.push(name);
      return;
    }
    var header = headerOf_(sheet);
    var lacking = SCHEMA[name].columns.filter(function (c) {
      return header.indexOf(c[0]) === -1;
    });
    if (lacking.length) status.missing.push(name + '（列不足）');
  });
  status.initialized = status.missing.length === 0;
  status.message = status.initialized ? '' : '初期化が必要です。';
  return status;
}

/** 1 リクエスト内でテーブルの読み込みを使い回すための入れ物 */
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
    invalidate: function (name) {
      if (name) delete cache[name];
      else cache = {};
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
  ctx.invalidate('History');
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
