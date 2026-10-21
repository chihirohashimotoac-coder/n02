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
  if (chunks.length > ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS) {
    throw appError_('TOO_LARGE', '公開データが大きすぎます（' + json.length + ' 文字）。');
  }
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

/** 公開状態の概要（運営画面の表示用） */
function publicationStatus_(ctx, eventId) {
  var row = ctx.table('PublicSnapshots').byKey[eventId];
  if (!row) return { published: false };
  return { published: true, version: row.version, publishedAt: row.published_at, isDefault: row.is_default };
}
