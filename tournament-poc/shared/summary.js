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
