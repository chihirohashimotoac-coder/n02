/* 閲覧者向け公開データ（PublicSnapshots シート）の生成 */

var SNAPSHOT_CHUNK_PREFIX_ = '~'; // 分割した JSON の先頭が = や + になっても数式扱いされないための接頭辞
// v1.0: 分割した公開データの行の ID（大会 ID + ".P" + 2 桁）。閲覧者用アプリの旧版は大会 ID の形でない行を読まない
var SNAPSHOT_PART_SEPARATOR_ = '.P';

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

function snapshotLimit_() {
  return Math.min(ADMIN_CONFIG.MAX_SNAPSHOT_CHARS, ADMIN_CONFIG.SNAPSHOT_CHUNK_SIZE * ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS);
}

function isSnapshotPartKey_(key, eventId) {
  var k = String(key || '');
  return k.indexOf(eventId + SNAPSHOT_PART_SEPARATOR_) === 0 && /^\d{2}$/.test(k.slice(eventId.length + SNAPSHOT_PART_SEPARATOR_.length));
}

/* ---------- 分割（v1.0） ---------- */

var PART_STATUS_CODE_ = { scheduled: 's', live: 'l', final: 'f', check: 'c', pending: 'p', void: 'v', bye: 'b' };

/**
 * グループの試合 1 件を、閲覧ページが元の形に戻せる配列にする（閲覧ページの hydrateParts と対になる）。
 * [id, round, order, 選手1, 選手2, p1Legs, p2Legs, p1Sets, p2Sets, 状態, 勝者(0/1/2), bestOf, 追加の項目?]
 * 選手はグループの players の番号（グループにいない選手は [id, name]、空欄は -1）。
 * 追加の項目は matchView の任意の項目（draw・resultType・fixedLegs・side・schedule）だけ。ラベルはパートの labels に回戦ごとに持つ。
 */
function compactMatch_(m, indexOf) {
  var ref = function (p) {
    if (!p.id) return -1;
    return indexOf[p.id] !== undefined ? indexOf[p.id] : [p.id, p.name];
  };
  var winner = m.winnerId ? (m.winnerId === m.p1.id ? 1 : m.winnerId === m.p2.id ? 2 : [m.winnerId]) : 0;
  var row = [m.id, m.round, m.order, ref(m.p1), ref(m.p2), m.p1.legs, m.p2.legs, m.p1.sets, m.p2.sets, PART_STATUS_CODE_[m.status] || m.status, winner, m.bestOf];
  var extra = {};
  ['draw', 'resultType', 'fixedLegs', 'side', 'schedule'].forEach(function (k) {
    if (m[k] !== undefined) extra[k] = m[k];
  });
  if (Object.keys(extra).length) row.push(extra);
  return row;
}

/**
 * 公開データを、上限に収まる本体と分割行（パート）にする。
 * 上限内ならそのまま（従来と同じ出力・同じ版）。超えるときだけ、ロビン・リーグ・スイス式のグループの試合一覧を
 * 回戦の順に圧縮してパートへ移し、本体の各グループには matchesInParts・matchCount と、パートの一覧（parts）を入れる。
 * 戻り値: { json, parts: [{ key, json, version }], fullSize, partitioned }
 */
function buildPublication_(bundle) {
  var view = buildPublicSnapshot_(bundle);
  var json = JSON.stringify(view);
  var limit = snapshotLimit_();
  if (json.length <= limit) return { json: json, parts: [], fullSize: json.length, partitioned: false };
  var fullSize = json.length;
  var eventId = bundle.event.event_id;
  var target = ADMIN_CONFIG.SNAPSHOT_PART_TARGET_CHARS;
  var parts = [];
  var list = [];
  (view.stages || []).forEach(function (st) {
    (st.groups || []).forEach(function (g) {
      if (!g.matches || !g.matches.length) return;
      var indexOf = {};
      (g.players || []).forEach(function (p, i) {
        indexOf[p.id] = i;
      });
      var current = null;
      var flush = function () {
        if (!current || !current.rows.length) return;
        var body = { schema: 1, kind: 'matches', eventId: eventId, stageId: st.id, groupId: g.id, labels: current.labels, rows: current.rows };
        parts.push({ body: body, meta: { stageId: st.id, groupId: g.id, fromRound: current.from, toRound: current.to, count: current.rows.length } });
        current = null;
      };
      // 回戦の途中では区切らない（閲覧ページの節の切り替えで、1 つの節が 2 つのパートにまたがらないように）
      var byRound = [];
      g.matches.forEach(function (m) {
        var last = byRound[byRound.length - 1];
        if (last && last.round === m.round) last.matches.push(m);
        else byRound.push({ round: m.round, label: m.label, matches: [m] });
      });
      byRound.forEach(function (r) {
        var rows = r.matches.map(function (m) {
          return compactMatch_(m, indexOf);
        });
        var size = JSON.stringify(rows).length;
        if (current && current.size + size > target) flush();
        if (!current) current = { rows: [], labels: {}, size: 0, from: r.round, to: r.round };
        current.rows = current.rows.concat(rows);
        current.labels[String(r.round)] = r.label;
        current.size += size;
        current.to = r.round;
      });
      flush();
      g.matchCount = g.matches.length;
      g.matchesInParts = true;
      g.matches = [];
    });
  });
  if (parts.length > ADMIN_CONFIG.MAX_SNAPSHOT_PARTS) {
    throw appError_(
      'TOO_LARGE',
      '閲覧ページの公開データが大きすぎるため、この変更は保存していません（試合一覧の分割が ' + parts.length + ' 個 / 上限 ' + ADMIN_CONFIG.MAX_SNAPSHOT_PARTS + ' 個）。段階・グループを分けるか、大会を非公開にしてから操作してください。'
    );
  }
  var out = parts.map(function (p, i) {
    var key = eventId + SNAPSHOT_PART_SEPARATOR_ + (i < 9 ? '0' : '') + (i + 1);
    var pj = JSON.stringify(p.body);
    assertSnapshotSize_(pj);
    var version = md5Hex_(pj);
    list.push({ id: key, version: version, stageId: p.meta.stageId, groupId: p.meta.groupId, fromRound: p.meta.fromRound, toRound: p.meta.toRound, count: p.meta.count });
    return { key: key, json: pj, version: version };
  });
  view.parts = list;
  json = JSON.stringify(view);
  assertSnapshotSize_(json);
  return { json: json, parts: out, fullSize: fullSize, partitioned: true };
}

/** 公開データの行（本体・パート）を書き込み待ちにする。内容が同じなら書かない */
function upsertSnapshotRow_(ctx, table, key, json, version, isDefault) {
  var existing = table.byKey[key] || null;
  if (existing && existing.version === version && existing.is_default === isDefault) return false;
  var size = ADMIN_CONFIG.SNAPSHOT_CHUNK_SIZE;
  var chunks = [];
  for (var i = 0; i < json.length; i += size) chunks.push(SNAPSHOT_CHUNK_PREFIX_ + json.slice(i, i + size));
  if (chunks.length > ADMIN_CONFIG.SNAPSHOT_MAX_CHUNKS) assertSnapshotSize_(json, true);
  var rec = { event_id: key, is_default: isDefault, version: version, published_at: ctx.now, chunk_count: chunks.length };
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
  return true;
}

/**
 * 大会の公開状態をシートへ反映する。書き込み系の操作の最後に必ず呼ぶ。
 * - 公開中: 公開データを作り直して保存（内容が同じなら書き込まない）
 * - 非公開: 公開データの行を削除する（閲覧画面から消える）
 * v0.8: 他の変更と同じく書き込み待ちにするだけで、シートへは commitContext_ が書く。
 * 公開データが上限を超えるときは、その操作ごと保存しない（TOO_LARGE）。
 * v1.0: 上限を超える大会は本体とパート（分割行）に分ける。使わなくなったパートの行は消す。
 */
function syncPublication_(ctx, eventId) {
  ctx.invalidate();
  var bundle = collectEvent_(ctx, eventId);
  var table = ctx.table('PublicSnapshots');
  var rows = table.rows.filter(function (r) {
    return r.event_id === eventId;
  });
  var partRows = table.rows.filter(function (r) {
    return isSnapshotPartKey_(r.event_id, eventId);
  });

  if (!bundle.event.is_public) {
    if (rows.length || partRows.length) {
      deleteRecords_(table, rows.concat(partRows));
      ctx.invalidate('PublicSnapshots');
    }
    return { published: false };
  }

  var pub = buildPublication_(bundle);
  var version = md5Hex_(pub.json);
  if (rows.length > 1) {
    // 手作業などで重複した行は 1 行にまとめる
    deleteRecords_(table, rows.slice(1));
    ctx.invalidate('PublicSnapshots');
    table = ctx.table('PublicSnapshots');
  }
  var keep = {};
  var partsChanged = false;
  pub.parts.forEach(function (p) {
    keep[p.key] = true;
    if (table.duplicates[p.key]) {
      deleteRecords_(table, table.rows.filter(function (r) { return r.event_id === p.key; }).slice(1));
    }
    if (upsertSnapshotRow_(ctx, table, p.key, p.json, p.version, false)) partsChanged = true;
  });
  var stale = partRows.filter(function (r) {
    return !keep[r.event_id] && !r._deleted;
  });
  if (stale.length) {
    deleteRecords_(table, stale);
    partsChanged = true;
  }
  var existing = table.byKey[eventId] || null;
  var info = { published: true, version: version, parts: pub.parts.length, partitioned: pub.partitioned };
  if (!upsertSnapshotRow_(ctx, table, eventId, pub.json, version, bundle.event.is_featured) && !partsChanged) {
    info.publishedAt = existing.published_at;
    info.unchanged = true;
    return info;
  }
  ctx.invalidate('PublicSnapshots');
  info.publishedAt = ctx.now;
  info.unchanged = false;
  return info;
}

/** 大会の公開データの行（本体とパート）。削除のときに使う */
function snapshotRowsOf_(table, eventId) {
  return table.rows.filter(function (r) {
    return r.event_id === eventId || isSnapshotPartKey_(r.event_id, eventId);
  });
}

/** 公開データの大きさの確認。上限を超えるなら、その操作を保存しない */
function assertSnapshotSize_(json, force) {
  var limit = snapshotLimit_();
  if (force || json.length > limit) {
    throw appError_(
      'TOO_LARGE',
      '閲覧ページの公開データが上限を超えるため、この変更は保存していません（' + json.length + ' 文字 / 上限 ' + limit + ' 文字）。段階・グループを分けるか、大会を非公開にしてから操作してください。'
    );
  }
}

/**
 * 公開データの大きさの目安（運営画面の表示用。公開していない大会でも、公開したときの大きさを返す）。
 * v1.0: 分割したときは本体の大きさ（size）・分割前の大きさ（fullSize）・パートの数と合計を返す。上限を超えて公開できないときは error
 */
function snapshotBudget_(bundle) {
  var limit = snapshotLimit_();
  try {
    var pub = buildPublication_(bundle);
    var total = pub.parts.reduce(function (sum, p) {
      return sum + p.json.length;
    }, pub.json.length);
    return { size: pub.json.length, limit: limit, percent: Math.floor((pub.json.length * 100) / limit), partitioned: pub.partitioned, parts: pub.parts.length, totalSize: total, fullSize: pub.fullSize };
  } catch (e) {
    if (!e || e.appCode !== 'TOO_LARGE') throw e;
    var size = JSON.stringify(buildPublicSnapshot_(bundle)).length;
    return { size: size, limit: limit, percent: Math.floor((size * 100) / limit), error: e.publicMessage };
  }
}

/** 公開状態の概要（運営画面の表示用） */
function publicationStatus_(ctx, eventId) {
  var table = ctx.table('PublicSnapshots');
  var row = table.byKey[eventId];
  if (!row) return { published: false };
  var parts = table.rows.filter(function (r) {
    return isSnapshotPartKey_(r.event_id, eventId);
  }).length;
  var out = { published: true, version: row.version, publishedAt: row.published_at, isDefault: row.is_default };
  if (parts) out.parts = parts;
  return out;
}
