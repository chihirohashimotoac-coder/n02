// v0.8: 運営機能（F01〜F21 のサーバー側）。抽選・CSV 登録・予定・延期・お知らせ・ルール表示・複製・毎週の日程・
// 引き分け/勝ち点・棄権/失格・所属/Rt の組分け・共同主催者・JSON からの復元
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

function ready() {
  const p = setupPair();
  p.ok('initializeStorage');
  return p;
}
const names = (n, prefix = '選手') => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
const detail = (p, id, auth) => p.ok('eventDetail', { eventId: id }, auth ? { auth } : undefined);

/* ---------- F01 / F16 / F17 抽選・組分け ---------- */

test('F01 抽選: 全員を重複・欠落なく配り、組の人数差は 1 以下。結果は保存され、やり直しは確認が必要', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '抽選', template: 'robin', groupCount: 3, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(11) });
  let d = detail(p, id);
  const st = d.stages[0];
  const res = p.ok('autoAssign', { eventId: id, stageId: st.id, method: 'random' });
  d = res.detail;
  const sizes = d.stages[0].groups.map((g) => g.players.length).sort();
  assert.deepEqual(sizes, [3, 4, 4]);
  const all = d.stages[0].groups.flatMap((g) => g.players.map((x) => x.id));
  assert.equal(new Set(all).size, 11);
  assert.ok(d.history.some((h) => h.action === 'entry.draw'));
  // 読み直しても同じ
  assert.deepEqual(detail(p, id).stages[0].groups.map((g) => g.players.map((x) => x.id)), d.stages[0].groups.map((g) => g.players.map((x) => x.id)));
  // やり直しは確認付き
  assert.equal(p.call('autoAssign', { eventId: id, stageId: st.id, method: 'random' }).error.code, 'CONFIRM_REQUIRED');
  p.ok('autoAssign', { eventId: id, stageId: st.id, method: 'random', confirmRedraw: true });
  // カード作成後はできない
  p.ok('generateMatches', { eventId: id, stageId: st.id });
  assert.equal(p.call('autoAssign', { eventId: id, stageId: st.id, method: 'random', confirmRedraw: true }).error.code, 'LOCKED');
});

test('F16 / F17 組分け: シードは別の組へ、Rt の高い順に蛇行、Rt 未入力は 0 と扱わず抽選、所属はなるべく分ける（空欄の所属はまとめない）', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '組分け', template: 'robin', groupCount: 4, rule: { format: 'legs', bestOf: 3 } }).eventId;
  const rows = [];
  for (let i = 0; i < 16; i++) {
    rows.push({ name: '選手' + String(i + 1).padStart(2, '0'), affiliation: i < 8 ? ['北', '南', '東', '西'][i % 4] : i < 12 ? '北' : '', rating: i < 12 ? String(20 - i) : '', seed: i < 4 ? String(i + 1) : '' });
  }
  p.ok('importPlayers', { eventId: id, players: rows });
  let d = detail(p, id);
  const res = p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id, method: 'balanced', useSeeds: true, useRating: true, spreadAffiliation: true });
  d = res.detail;
  const byName = {};
  d.players.forEach((x) => (byName[x.id] = x));
  const groups = d.stages[0].groups.map((g) => g.players.map((x) => byName[x.id]));
  assert.deepEqual(groups.map((g) => g.length), [4, 4, 4, 4]);
  // シード 1〜4 は別々の組
  assert.deepEqual(groups.map((g) => g.filter((x) => x.seed).length), [1, 1, 1, 1]);
  // Rt 未入力（空欄）は 0 ではなく空のまま
  assert.ok(d.players.filter((x) => !x.rating).length === 4);
  assert.ok(res.report.notes.some((n) => /未入力を 0 とは扱っていません/.test(n)));
  // 「北」は 7 人いるので 4 組では必ずどこかで重なる。重なりは最小限（各組 2 人まで）で、報告する
  groups.forEach((g) => assert.ok(g.filter((x) => x.affiliation === '北').length <= 2));
  assert.equal(typeof res.report.clashes, 'number');
  // 空欄の所属どうしは重なりに数えない
  assert.ok(!res.report.notes.join().includes('所属なし'));
});

/* ---------- F11 CSV 登録 ---------- */

test('F11 CSV 登録: 1 行でも不正なら何も登録しない。同名・重複シード・数式文字・不正な Rt を行番号付きで返す', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: 'CSV', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: ['既存'] });
  const bad = p.call('importPlayers', {
    eventId: id,
    players: [
      { name: '田中, 一郎', affiliation: 'A"B', rating: '12.5', seed: '1' },
      { name: '既存' },
      { name: '=HYPERLINK("x")' },
      { name: '山田', rating: 'abc' },
      { name: '鈴木', seed: '1' },
    ],
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /2 行目.*既に登録/);
  assert.match(bad.error.message, /3 行目.*= \+ - @/);
  assert.match(bad.error.message, /4 行目.*Rt/);
  assert.match(bad.error.message, /5 行目.*シード 1/);
  assert.equal(detail(p, id).players.length, 1, '何も登録しない');
  const ok = p.ok('importPlayers', { eventId: id, players: [{ name: '田中, 一郎', affiliation: 'A"B', rating: '12.5', seed: '1' }, { name: '佐藤\n花子' }] });
  assert.equal(ok.added, 2);
  const tanaka = ok.detail.players.find((x) => x.name === '田中, 一郎');
  assert.equal(tanaka.affiliation, 'A"B');
  assert.equal(tanaka.rating, '12.5');
  assert.equal(tanaka.seed, 1);
  assert.ok(ok.detail.players.some((x) => x.name === '佐藤 花子'), '改行は空白にそろえる');
});

/* ---------- F07 / F08 予定・延期、F13 毎週の日程 ---------- */

test('F07 / F08 予定と延期: 当初の予定・理由・操作者を残し、延期は勝敗として数えない。時刻未定は未定のまま', () => {
  const p = ready();
  const d0 = p.ok('createSampleEvent', { publish: true }).detail;
  const m = d0.groups[3].matches[0];
  let d = p.ok('setSchedule', { matchId: m.id, rev: m.rev, date: '2026/11/3', time: '', venue: '本店', board: '3', referee: '審判 A' }).detail;
  let mv = d.groups[3].matches[0];
  assert.deepEqual([mv.schedule.date, mv.schedule.time, mv.schedule.board], ['2026-11-03', '', '3']);
  assert.equal(p.call('setSchedule', { matchId: m.id, rev: mv.rev, date: '2026-02-30' }).error.code, 'VALIDATION');
  assert.equal(p.call('postponeMatch', { matchId: m.id, rev: mv.rev, reason: '' }).error.code, 'VALIDATION');
  d = p.ok('postponeMatch', { matchId: m.id, rev: mv.rev, reason: '会場の都合' }).detail;
  mv = d.groups[3].matches[0];
  assert.equal(mv.schedule.status, 'postponed');
  assert.deepEqual(mv.schedule.original, { date: '2026-11-03', time: '' });
  assert.equal(mv.status, 'scheduled', '結果の状態は変わらない');
  d = p.ok('postponeMatch', { matchId: m.id, rev: mv.rev, date: '2026-11-10', time: '19:30', reason: '振替' }).detail;
  mv = d.groups[3].matches[0];
  assert.equal(mv.schedule.status, 'rescheduled');
  assert.deepEqual(mv.schedule.original, { date: '2026-11-03', time: '' }, '最初の予定を残す');
  assert.equal(mv.schedule.changedBy, 'admin');
  const standings = d.groups[3].standings;
  assert.ok(standings.every((r) => r.played === 0), '延期は勝敗に数えない');
  // 公開データには理由・操作者を出さない
  const pub = p.viewer.run('getPublicSnapshot', { eventId: d0.event.id });
  const pm = pub.data.groups[3].matches[0];
  assert.equal(pm.schedule.status, 'rescheduled');
  assert.equal(pm.schedule.reason, undefined);
  assert.equal(pm.schedule.changedBy, undefined);
});

test('F13 毎週の日程: 開始日・曜日・間隔・休催日から節ごとの日付を作り、未実施の試合だけに適用する', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '週次', template: 'league', rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(4) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('autoAssign', { eventId: id, stageId: st.id });
  d = p.ok('generateMatches', { eventId: id, stageId: st.id }).detail;
  // 2026-11-04 は水曜。毎週水曜、11/11 は休み
  const pv = p.ok('previewWeeklySchedule', { eventId: id, stageId: st.id, startDate: '2026-11-04', weekdays: [3], intervalWeeks: 1, skipDates: ['2026-11-11'], time: '20:00' });
  assert.deepEqual(pv.plan.map((x) => x.date), ['2026-11-04', '2026-11-18', '2026-11-25']);
  assert.deepEqual(pv.skipped, ['2026-11-11']);
  // 第 1 節の 1 試合は結果入力済み → 変更しない
  const m1 = d.stages[0].groups[0].matches.find((m) => m.round === 1);
  p.ok('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', p1Legs: 2, p2Legs: 0 });
  const res = p.ok('applyWeeklySchedule', { eventId: id, stageId: st.id, startDate: '2026-11-04', weekdays: [3], intervalWeeks: 1, skipDates: ['2026-11-11'], time: '20:00' });
  assert.equal(res.untouched, 1);
  assert.equal(res.changed, 5);
  const ms = res.detail.stages[0].groups[0].matches;
  assert.equal(ms.find((m) => m.id === m1.id).schedule, undefined);
  assert.ok(ms.filter((m) => m.round === 3).every((m) => m.schedule.date === '2026-11-25' && m.schedule.time === '20:00'));
});

/* ---------- F09 お知らせ・F10 ルール表示・公開する項目 ---------- */

test('F09 / F10: お知らせとルール表示は公開データに入り、運営メモ・所属（非公開の設定）は入らない。ルールの組み合わせを検証する', () => {
  const p = ready();
  const d0 = p.ok('createSampleEvent', { publish: true }).detail;
  const id = d0.event.id;
  let ev = d0.event;
  p.ok('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: ev.status, isPublic: true, isFeatured: false, notes: '非公開の運営メモ' });
  ev = detail(p, id).event;
  assert.equal(p.call('updateEventSettings', { eventId: id, rev: ev.rev, ruleDisplay: { category: 'steel', bull: 'fat' } }).error.code, 'VALIDATION');
  const d = p.ok('updateEventSettings', {
    eventId: id,
    rev: ev.rev,
    announcement: '本日の受付は 18:30 まで。\n\n駐車場はありません。',
    ruleDisplay: { category: 'steel', startScore: 501, inMode: 'open', outMode: 'double', bull: 'separate', roundLimit: '', note: '' },
    publicFields: { affiliation: false, rating: false },
  }).detail;
  const player = d.players[0];
  p.ok('updatePlayer', { playerId: player.id, rev: player.rev, affiliation: '秘密の所属', notes: '個人メモ' });
  const pub = p.viewer.run('getPublicSnapshot', { eventId: id }).data;
  assert.equal(pub.event.announcement.text, '本日の受付は 18:30 まで。\n\n駐車場はありません。');
  assert.equal(pub.event.ruleDisplay.outMode, 'double');
  const text = JSON.stringify(pub);
  assert.ok(!text.includes('非公開の運営メモ'));
  assert.ok(!text.includes('秘密の所属'));
  assert.ok(!text.includes('個人メモ'));
  // 所属を公開にしたら出る
  ev = detail(p, id).event;
  p.ok('updateEventSettings', { eventId: id, rev: ev.rev, publicFields: { affiliation: true, rating: false } });
  p.clock.advance(21000); // 閲覧者用のキャッシュ（20 秒）が切れてから
  assert.ok(JSON.stringify(p.viewer.run('getPublicSnapshot', { eventId: id }).data).includes('秘密の所属'));
});

/* ---------- F14 / F15 棄権・失格・不戦勝 ---------- */

test('F15 不戦勝・途中棄権: Leg 数を作らない・実際の Leg 数を残す。理由が必要で、記録上の勝者と Leg 成績を分ける', () => {
  const p = ready();
  const d0 = p.ok('createSampleEvent', {}).detail;
  const [m1, m2] = d0.groups[3].matches;
  assert.equal(p.call('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', resultType: 'walkover', winnerSide: 1, note: '' }).error.code, 'VALIDATION');
  let d = p.ok('saveMatchResult', { matchId: m1.id, rev: m1.rev, status: 'final', resultType: 'walkover', winnerSide: 2, note: '当日欠席', p1Legs: 3, p2Legs: 0 }).detail;
  let mv = d.groups[3].matches[0];
  assert.equal(mv.resultType, 'walkover');
  assert.equal(mv.winnerId, m1.p2.id);
  assert.equal(mv.p1.legs, null);
  assert.equal(mv.p2.legs, null);
  // 途中棄権: 勝敗が決まっていない Leg 数（2-1 など）のまま相手の勝ち
  assert.equal(p.call('saveMatchResult', { matchId: m2.id, rev: m2.rev, status: 'final', resultType: 'retired', winnerSide: 2, note: '体調', p1Legs: 3, p2Legs: 1 }).error.code, 'VALIDATION');
  d = p.ok('saveMatchResult', { matchId: m2.id, rev: m2.rev, status: 'final', resultType: 'retired', winnerSide: 2, note: '体調', p1Legs: 2, p2Legs: 1 }).detail;
  mv = d.groups[3].matches[1];
  assert.deepEqual([mv.p1.legs, mv.p2.legs, mv.winnerId], [2, 1, m2.p2.id]);
  // 不戦勝は既定で Leg 数を数えない。途中棄権は実際の Leg 数を数える
  const s = d.groups[3].standings;
  const legs = (pid) => s.find((r) => r.playerId === pid);
  assert.equal(legs(m1.p2.id).won, 1);
  assert.equal(legs(m2.p1.id).legsFor >= 2, true);
});

test('F15 棄権・失格: 確定済みの試合は残し、未消化の試合だけ処理する（トーナメントは相手が勝ち上がり、後から入る試合も不戦勝）', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: 'KO', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: names(4) });
  let d = detail(p, id);
  const st = d.stages[0];
  p.ok('setEntrants', { eventId: id, stageId: st.id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('generateBracket', { eventId: id, stageId: st.id }).detail;
  const semis = d.stages[0].rounds[0].matches;
  // 準決勝 1 は通常どおり確定
  p.ok('saveMatchResult', { matchId: semis[0].id, rev: semis[0].rev, status: 'final', p1Legs: 2, p2Legs: 0 });
  // 準決勝 1 の勝者が失格 → 決勝は相手が決まった時点で不戦勝
  const winner = semis[0].p1;
  const pl = detail(p, id).players.find((x) => x.id === winner.id);
  const pv = p.ok('previewWithdraw', { eventId: id, playerId: pl.id });
  assert.equal(pv.finals, 1);
  assert.equal(pv.affected.length, 1);
  assert.equal(pv.affected[0].action, 'pending');
  d = p.ok('withdrawPlayer', { eventId: id, playerId: pl.id, rev: pl.rev, kind: 'disqualified', reason: '規定違反' }).detail;
  assert.equal(d.stages[0].rounds[0].matches[0].status, 'final', '確定済みの試合は残す');
  const semi2 = d.stages[0].rounds[0].matches[1];
  d = p.ok('saveMatchResult', { matchId: semi2.id, rev: semi2.rev, status: 'final', p1Legs: 2, p2Legs: 1 }).detail;
  const final = d.stages[0].rounds[1].matches[0];
  assert.equal(final.status, 'final');
  assert.equal(final.resultType, 'disqualified');
  assert.equal(final.winnerId, semi2.p1.id);
  assert.equal(d.stages[0].champion.id, semi2.p1.id);
  assert.ok(d.history.some((h) => h.action === 'match.autoWalkover'));
});

/* ---------- F12 複製・F21 復元 ---------- */

test('F12 大会設定の複製: 新しい ID・準備中・非公開。結果・履歴・所有者・管理パスワード・共同主催者は写さない。選手は選んだときだけ', () => {
  const p = ready();
  const alice = p.loginAs('alice@example.org');
  const d0 = p.ok('createSampleEvent', { publish: true }, { auth: alice }).detail;
  let ev = d0.event;
  p.ok('setStaffPassword', { eventId: ev.id, rev: ev.rev, password: 'staff-pass-01' }, { auth: alice });
  p.ok('addCollaborator', { eventId: ev.id, email: 'bob@example.org' }, { auth: alice });
  const bob = p.loginAs('bob@example.org');
  // 共同主催者が複製すると、新しい大会の主催者は複製した人
  const dup = p.ok('duplicateEvent', { eventId: ev.id, name: '複製した大会', includePlayers: false }, { auth: bob });
  const d = dup.detail;
  assert.notEqual(d.event.id, ev.id);
  assert.equal(d.event.status, 'draft');
  assert.equal(d.event.isPublic, false);
  assert.equal(d.event.ownerEmail, 'bob@example.org');
  assert.equal(d.event.staffPasswordSet, false);
  assert.equal(d.players.length, 0);
  assert.equal(d.progress.total, 0);
  assert.equal((d.collaborators || []).length, 0);
  assert.equal(d.stages[0].groups.length, d0.stages[0].groups.length);
  assert.ok(d.stages.every((s) => !d0.stages.some((o) => o.id === s.id)), '新しい段階 ID');
  const withPlayers = p.ok('duplicateEvent', { eventId: ev.id, name: '選手も', includePlayers: true }, { auth: alice }).detail;
  assert.equal(withPlayers.players.length, 16);
  assert.ok(withPlayers.players.every((x) => !d0.players.some((o) => o.id === x.id)));
  assert.ok(withPlayers.stages[0].groups.every((g) => g.players.length === 0), '割り当て（結果の一部）は写さない');
});

test('F21 JSON からの復元: 新しい大会として ID を付け直し、既存の大会は上書きしない。不正なファイルは何も登録しない', () => {
  const p = ready();
  const alice = p.loginAs('alice@example.org');
  const d0 = p.ok('createSampleEvent', { publish: true }, { auth: alice }).detail;
  const archive = p.ok('exportEvent', { eventId: d0.event.id }, { auth: alice });
  assert.equal(archive.formatVersion, 2);
  assert.ok(!JSON.stringify(archive).includes('staff_pass_hash'));
  const before = p.store.dump();
  // 参照が壊れたファイル
  const broken = JSON.parse(JSON.stringify(archive));
  broken.tables.Matches[0].player1_id = 'PLY-NOTEXIST0001';
  const bad = p.call('restoreEvent', { archive: broken, mode: 'full' }, { auth: alice });
  assert.equal(bad.error.code, 'VALIDATION');
  assert.equal(p.store.dump(), before, '何も登録しない');
  // 不成立の結果を含むファイル
  const invalid = JSON.parse(JSON.stringify(archive));
  const fm = invalid.tables.Matches.find((m) => m.status === 'final');
  fm.player1_legs = 9;
  assert.equal(p.call('restoreEvent', { archive: invalid, mode: 'full' }, { auth: alice }).error.code, 'VALIDATION');
  assert.equal(p.store.dump(), before);
  // 結果ありの復元
  const full = p.ok('restoreEvent', { archive, mode: 'full' }, { auth: alice });
  const d = full.detail;
  assert.notEqual(d.event.id, d0.event.id);
  assert.equal(d.event.name, d0.event.name + '（復元）');
  assert.equal(d.event.isPublic, false);
  assert.equal(d.event.ownerEmail, 'alice@example.org');
  assert.equal(d.progress.final, d0.progress.final);
  assert.deepEqual(
    d.groups.map((g) => g.standings.map((r) => [r.rank, r.won, r.legsFor])),
    d0.groups.map((g) => g.standings.map((r) => [r.rank, r.won, r.legsFor]))
  );
  assert.ok(d.players.every((x) => !d0.players.some((o) => o.id === x.id)), '新しい選手 ID');
  // 元の大会はそのまま
  assert.equal(detail(p, d0.event.id, alice).progress.final, d0.progress.final);
  // 設定のみの復元
  const settings = p.ok('restoreEvent', { archive, mode: 'settings', name: '設定だけ' }, { auth: alice }).detail;
  assert.equal(settings.players.length, 0);
  assert.equal(settings.progress.total, 0);
  assert.equal(settings.stages.length, d0.stages.length);
  // 未ログイン・スタッフは復元できない
  assert.equal(p.call('restoreEvent', { archive, mode: 'full' }, { auth: 'anon' }).error.code, 'AUTH_REQUIRED');
});

/* ---------- F20 共同主催者 ---------- */

test('F20 共同主催者: 本人だけが追加・解除でき、解除は古いセッションにもすぐ効く。他の大会には権限が及ばない。招待メールは送らない', () => {
  const p = ready();
  const alice = p.loginAs('alice@example.org');
  const bob = p.loginAs('bob@example.org');
  const carol = p.loginAs('carol@example.org');
  const a = p.ok('createSampleEvent', {}, { auth: alice }).detail;
  const other = p.ok('createSampleEvent', {}, { auth: alice }).detail;
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: bob }).error.code, 'NOT_FOUND');
  p.ok('addCollaborator', { eventId: a.event.id, email: 'Bob@Example.org' }, { auth: alice });
  const asBob = detail(p, a.event.id, bob);
  assert.equal(asBob.event.role, 'editor');
  assert.equal(asBob.event.ownerEmail, undefined, '共同主催者には主催者のメールを見せない');
  assert.equal(asBob.collaborators, undefined);
  // 共同主催者は結果を入力できるが、共同主催者の管理・管理パスワード・削除はできない
  const m = asBob.groups[3].matches[0];
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 3, p2Legs: 0 }, { auth: bob });
  assert.equal(p.call('addCollaborator', { eventId: a.event.id, email: 'carol@example.org' }, { auth: bob }).error.code, 'FORBIDDEN');
  assert.equal(p.call('setStaffPassword', { eventId: a.event.id, rev: asBob.event.rev, password: 'xxxxxxxx1' }, { auth: bob }).error.code, 'FORBIDDEN');
  assert.equal(p.call('deleteEvent', { eventId: a.event.id, rev: asBob.event.rev, confirmName: a.event.name }, { auth: bob }).error.code, 'FORBIDDEN');
  // 他の大会には及ばない
  assert.equal(p.call('eventDetail', { eventId: other.event.id }, { auth: bob }).error.code, 'NOT_FOUND');
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: carol }).error.code, 'NOT_FOUND');
  // 一覧（ポータルの「作成した大会」）にも出る
  assert.ok(p.ok('myEvents', {}, { auth: bob }).events.some((e) => e.id === a.event.id && e.role === 'editor'));
  // 解除: bob の同じセッションで、すぐに操作できなくなる
  const list = detail(p, a.event.id, alice).collaborators;
  assert.equal(list.length, 1);
  assert.equal(list[0].email, 'bob@example.org');
  p.ok('removeCollaborator', { eventId: a.event.id, collabId: list[0].id }, { auth: alice });
  assert.equal(p.call('eventDetail', { eventId: a.event.id }, { auth: bob }).error.code, 'NOT_FOUND');
  assert.equal(p.admin.fetches.filter((u) => !u.includes('tokeninfo')).length, 0, '外部への通信（招待メールなど）はしない');
});

/* ---------- F05 自動終了（既存の大会は変えない） ---------- */

test('F05 自動終了: 既存の大会（設定なし）は自動で終了にしない。設定で有効にすると対象になる', () => {
  const p = ready();
  const id = p.ok('createEvent', { name: '旧', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 1 } }).eventId;
  // v0.7 の大会を模す: 設定（config_json）を消す
  const events = p.store.get().getSheetByName('Events');
  const col = events.rows[0].indexOf('config_json');
  events.rows[1][col] = '';
  p.ok('addPlayers', { eventId: id, names: names(2) });
  let d = detail(p, id);
  p.ok('autoAssign', { eventId: id, stageId: d.stages[0].id });
  d = p.ok('generateMatches', { eventId: id, stageId: d.stages[0].id }).detail;
  const m = d.stages[0].groups[0].matches[0];
  d = p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: 1, p2Legs: 0 }).detail;
  assert.equal(d.complete, true);
  assert.equal(d.event.status, 'draft', '既存の大会の状態は書き換えない');
});
