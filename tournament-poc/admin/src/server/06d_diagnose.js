/* 整合性の診断（管理者だけ・読み取りだけ）。
 * シートの行どうしの参照の切れ・勝ち上がりの不一致・読めない JSON・途中で止まった次期の作成の跡などを一覧にする。
 * 何も書き換えない（修復は対象と復旧の根拠を確かめてから、別の操作で行う）。
 */

var DIAGNOSE_LIMIT_ = 300;

var DIAGNOSE_KINDS_ = {
  orphan_event: '大会がない行',
  missing_rule: '大会のルールがない',
  missing_ref: '参照先の行がない',
  other_event: '参照先が別の大会の行',
  duplicate_key: 'ID の重複',
  duplicate_entry: '同じ段階に同じ選手が 2 回',
  bracket_mismatch: '勝ち上がりの不一致',
  bracket_stale: '未確定の試合の行き先に選手がいる',
  bad_json: '読めない JSON',
  season_trace: '次期の作成が途中で止まった跡',
  missing_member: '会員がない',
};

/** payload なし。戻り値 = { checkedAt, counts: { シート名: 行数 }, kinds: [{ kind, label, count }], issues: [...], truncated } */
function actionDiagnoseStorage_(ctx) {
  var t = function (name) {
    return ctx.table(name);
  };
  var issues = [];
  var countOf = {};
  var add = function (kind, sheet, id, eventId, detail) {
    countOf[kind] = (countOf[kind] || 0) + 1;
    if (issues.length < DIAGNOSE_LIMIT_) issues.push({ kind: kind, label: DIAGNOSE_KINDS_[kind], sheet: sheet, id: String(id || ''), eventId: String(eventId || ''), detail: detail });
  };
  var live = function (name) {
    return t(name).rows.filter(function (r) {
      return !r._deleted;
    });
  };
  var names = ['Events', 'Rules', 'Players', 'Stages', 'Groups', 'Entries', 'Matches', 'Collaborators', 'PublicSnapshots', 'Leagues', 'LeagueSeasons', 'LeagueMembers'];
  var counts = {};
  names.forEach(function (n) {
    counts[n] = live(n).length;
    Object.keys(t(n).duplicates || {}).forEach(function (k) {
      add('duplicate_key', n, k, '', n + ' の ID「' + k + '」が複数の行にあります。');
    });
  });

  var events = t('Events').byKey;
  var rules = t('Rules').byKey;
  var players = t('Players').byKey;
  var stages = t('Stages').byKey;
  var groups = t('Groups').byKey;
  var matches = t('Matches').byKey;
  var leagues = t('Leagues').byKey;
  var members = t('LeagueMembers').byKey;

  var json = function (sheet, row, id, col) {
    var v = row[col];
    if (v === '' || v === null || v === undefined) return;
    try {
      JSON.parse(String(v));
    } catch (e) {
      add('bad_json', sheet, id, row.event_id, sheet + '.' + col + ' を JSON として読めません。');
    }
  };

  // 大会
  live('Events').forEach(function (e) {
    if (e.rule_id && !rules[e.rule_id]) add('missing_rule', 'Events', e.event_id, e.event_id, '大会のルール（' + e.rule_id + '）が Rules にありません。');
    json('Events', e, e.event_id, 'config_json');
  });

  // 大会に属する行: 大会がない行（作成・削除が途中で止まった跡など）
  var orphanCheck = function (sheet, keyCol) {
    live(sheet).forEach(function (r) {
      var eventId = r.event_id;
      if (sheet === 'PublicSnapshots') {
        var k = String(r.event_id || '');
        var at = k.lastIndexOf(SNAPSHOT_PART_SEPARATOR_);
        if (at > 0 && /^\d{2}$/.test(k.slice(at + SNAPSHOT_PART_SEPARATOR_.length))) eventId = k.slice(0, at);
      }
      if (!events[eventId]) add('orphan_event', sheet, r[keyCol], eventId, sheet + ' の行の大会（' + eventId + '）が Events にありません。');
    });
  };
  orphanCheck('Rules', 'rule_id');
  orphanCheck('Players', 'player_id');
  orphanCheck('Stages', 'stage_id');
  orphanCheck('Groups', 'group_id');
  orphanCheck('Entries', 'entry_id');
  orphanCheck('Matches', 'match_id');
  orphanCheck('Collaborators', 'collab_id');
  orphanCheck('PublicSnapshots', 'event_id');

  // 参照（同じ大会の行を指しているか）
  var ref = function (sheet, row, id, label, table, refId, required) {
    if (!refId) {
      if (required) add('missing_ref', sheet, id, row.event_id, label + 'が空欄です。');
      return null;
    }
    var target = table[refId];
    if (!target || target._deleted) {
      add('missing_ref', sheet, id, row.event_id, label + '（' + refId + '）がありません。');
      return null;
    }
    if (target.event_id !== undefined && row.event_id && target.event_id !== row.event_id) {
      add('other_event', sheet, id, row.event_id, label + '（' + refId + '）は別の大会（' + target.event_id + '）の行です。');
      return null;
    }
    return target;
  };

  live('Players').forEach(function (p) {
    json('Players', p, p.player_id, 'meta_json');
    if (p.member_id && !members[p.member_id]) add('missing_member', 'Players', p.player_id, p.event_id, '選手の会員（' + p.member_id + '）が LeagueMembers にありません。');
  });
  live('Stages').forEach(function (s) {
    json('Stages', s, s.stage_id, 'config_json');
    if (s.rule_id) ref('Stages', s, s.stage_id, '段階のルール', rules, s.rule_id, false);
  });
  live('Groups').forEach(function (g) {
    json('Groups', g, g.group_id, 'meta_json');
    ref('Groups', g, g.group_id, 'グループの段階', stages, g.stage_id, true);
  });
  var seenEntry = {};
  live('Entries').forEach(function (e) {
    json('Entries', e, e.entry_id, 'meta_json');
    var st = ref('Entries', e, e.entry_id, '出場の段階', stages, e.stage_id, true);
    ref('Entries', e, e.entry_id, '出場の選手', players, e.player_id, true);
    var g = e.group_id ? ref('Entries', e, e.entry_id, '出場のグループ', groups, e.group_id, false) : null;
    if (g && st && g.stage_id !== st.stage_id) add('other_event', 'Entries', e.entry_id, e.event_id, '出場のグループ（' + g.group_id + '）は別の段階（' + g.stage_id + '）のグループです。');
    var key = e.stage_id + '|' + e.player_id;
    if (e.stage_id && e.player_id) {
      if (seenEntry[key]) add('duplicate_entry', 'Entries', e.entry_id, e.event_id, '段階（' + e.stage_id + '）に選手（' + e.player_id + '）の出場が複数あります（' + seenEntry[key] + '）。');
      else seenEntry[key] = e.entry_id;
    }
  });
  live('Matches').forEach(function (m) {
    json('Matches', m, m.match_id, 'meta_json');
    json('Matches', m, m.match_id, 'schedule_json');
    ref('Matches', m, m.match_id, '試合の段階', stages, m.stage_id, true);
    if (m.group_id) ref('Matches', m, m.match_id, '試合のグループ', groups, m.group_id, false);
    if (m.player1_id) ref('Matches', m, m.match_id, '試合の選手 1', players, m.player1_id, false);
    if (m.player2_id) ref('Matches', m, m.match_id, '試合の選手 2', players, m.player2_id, false);
    var moves = [
      { to: m.next_match_id, slot: m.next_match_slot, who: m.status === MATCH_STATUS.FINAL ? m.winner_id : '', label: '勝者' },
      { to: m.loser_next_match_id, slot: m.loser_next_match_slot, who: m.status === MATCH_STATUS.FINAL && m.winner_id ? (m.winner_id === m.player1_id ? m.player2_id : m.player1_id) : '', label: '敗者' },
    ];
    moves.forEach(function (mv) {
      if (!mv.to) return;
      var next = ref('Matches', m, m.match_id, mv.label + 'の行き先の試合', matches, mv.to, false);
      if (!next) return;
      var occupant = next['player' + (mv.slot === 2 ? 2 : 1) + '_id'] || '';
      if (m.status === MATCH_STATUS.FINAL && m.winner_id) {
        if (mv.who && occupant !== mv.who) add('bracket_mismatch', 'Matches', m.match_id, m.event_id, mv.label + '（' + mv.who + '）が行き先の試合（' + next.match_id + '）の枠 ' + (mv.slot === 2 ? 2 : 1) + ' にいません（' + (occupant || '空き') + '）。');
      } else if (occupant && m.result_type !== RESULT_TYPE.NOT_NEEDED) {
        add('bracket_stale', 'Matches', m.match_id, m.event_id, '確定していない試合の' + mv.label + 'の行き先（' + next.match_id + ' の枠 ' + (mv.slot === 2 ? 2 : 1) + '）に選手（' + occupant + '）がいます。');
      }
    });
  });

  // 期制リーグ
  live('Leagues').forEach(function (l) {
    json('Leagues', l, l.league_id, 'config_json');
  });
  live('LeagueMembers').forEach(function (mb) {
    json('LeagueMembers', mb, mb.member_id, 'meta_json');
    if (!leagues[mb.league_id]) add('missing_ref', 'LeagueMembers', mb.member_id, '', '会員のリーグ（' + mb.league_id + '）がありません。');
  });
  live('LeagueSeasons').forEach(function (s) {
    if (!leagues[s.league_id]) add('missing_ref', 'LeagueSeasons', s.season_key, s.event_id, '期のリーグ（' + s.league_id + '）がありません。');
    if (!events[s.event_id]) add('season_trace', 'LeagueSeasons', s.season_key, s.event_id, '第' + s.season_no + '期の大会（' + s.event_id + '）が Events にありません。前期の「次期の作成」をもう一度確定すると片づけて作り直します。');
    if (s.prev_event_id && !events[s.prev_event_id]) add('missing_ref', 'LeagueSeasons', s.season_key, s.event_id, '前期の大会（' + s.prev_event_id + '）が Events にありません。');
  });

  var kinds = Object.keys(DIAGNOSE_KINDS_)
    .filter(function (k) {
      return countOf[k];
    })
    .map(function (k) {
      return { kind: k, label: DIAGNOSE_KINDS_[k], count: countOf[k] };
    });
  var total = kinds.reduce(function (s, k) {
    return s + k.count;
  }, 0);
  return { checkedAt: ctx.now, counts: counts, kinds: kinds, issues: issues, total: total, truncated: total > issues.length };
}
