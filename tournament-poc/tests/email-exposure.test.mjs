// 監査 PR-03（C-002）: メールアドレスは主催者本人と管理者にだけ返す。
// 共同主催者・店舗スタッフ・匿名の応答（大会詳細・保存後の応答・保存ファイル・期制リーグの照合ログ）には、
// 自分以外のメールアドレスを入れない。応答の全文を検査する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const SUB = { alice: '200000000000000000001', carol: '200000000000000000003' };
const ALICE = 'alice.owner@gmail.com';
const CAROL = 'carol.helper@gmail.com';
const STAFF_PASS = 'Shop-A-2026!';

function world() {
  const p = setupPair();
  p.ok('initializeStorage');
  const alice = p.loginAs(ALICE, { sub: SUB.alice });
  const carol = p.loginAs(CAROL, { sub: SUB.carol });
  // 期制リーグ（1 期目 6 人）→ 結果 → 次期の確定 → 照合（記録として承認）。主催者と共同主催者が操作する
  const id1 = p.ok('createSeasonLeague', { name: '個人情報の確認', thresholds: [3], rule: { format: 'legs', bestOf: 3 } }, { auth: alice }).eventId;
  p.ok('addCollaborator', { eventId: id1, email: CAROL }, { auth: alice });
  p.link(carol);
  p.ok('importPlayers', { eventId: id1, players: Array.from({ length: 6 }, (_, i) => ({ name: '選手0' + (i + 1) })) }, { auth: carol });
  let d = p.ok('eventDetail', { eventId: id1 }, { auth: alice });
  p.ok('autoAssign', { eventId: id1, stageId: d.stages[0].id, method: 'random' }, { auth: carol });
  p.ok('generateMatches', { eventId: id1, stageId: d.stages[0].id }, { auth: alice });
  d = p.ok('eventDetail', { eventId: id1 }, { auth: alice });
  const ms = d.stages[0].groups.flatMap((g) => g.matches);
  p.ok('setSchedule', { matchId: ms[0].id, rev: ms[0].rev, date: '2026-11-10', time: '19:00', venue: '店' }, { auth: carol });
  d = p.ok('eventDetail', { eventId: id1 }, { auth: alice });
  p.ok('saveMatchResults', { eventId: id1, results: d.stages[0].groups.flatMap((g) => g.matches).map((x) => ({ matchId: x.id, rev: x.rev, p1Legs: x.p1.name < x.p2.name ? 2 : 0, p2Legs: x.p1.name < x.p2.name ? 0 : 2 })) }, { auth: carol });
  d = p.ok('eventDetail', { eventId: id1 }, { auth: alice });
  p.ok('setStaffPassword', { eventId: id1, rev: d.event.rev, password: STAFF_PASS }, { auth: alice });
  const pv = p.ok('previewNextSeason', { eventId: id1 }, { auth: alice });
  const id2 = p.ok('confirmNextSeason', { eventId: id1, planVersion: pv.planVersion }, { auth: alice }).eventId;
  p.ok('addCollaborator', { eventId: id2, email: CAROL }, { auth: alice });
  p.link(carol);
  // 前期の結果を訂正して、次期との違いを作り、主催者が「記録として承認」する（照合ログに実行者が残る。照合は主催者・管理者だけ）
  d = p.ok('eventDetail', { eventId: id1 }, { auth: alice });
  const m = d.stages[0].groups.flatMap((g) => g.matches).find((x) => [x.p1.name, x.p2.name].includes('選手03') && [x.p1.name, x.p2.name].includes('選手04'));
  const p3first = m.p1.name === '選手03';
  p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', correction: true, p1Legs: p3first ? 0 : 2, p2Legs: p3first ? 2 : 0 }, { auth: alice });
  const d2 = p.ok('eventDetail', { eventId: id2 }, { auth: alice });
  p.ok('reconcileNextSeason', { eventId: id2, rev: d2.season.seasonRev, acknowledge: true, reason: '今期はこのまま' }, { auth: alice });
  d = p.ok('eventDetail', { eventId: id2 }, { auth: alice });
  p.ok('setStaffPassword', { eventId: id2, rev: d.event.rev, password: STAFF_PASS }, { auth: alice });
  return { p, alice, carol, id1, id2 };
}

const has = (value, email) => JSON.stringify(value).toLowerCase().includes(email.toLowerCase());

test('前提: 主催者・管理者の応答には履歴・照合ログの実行者のメールアドレスが入る（記録そのものは残っている）', () => {
  const w = world();
  for (const auth of [{ auth: w.alice }, undefined]) {
    for (const id of [w.id1, w.id2]) {
      const d = w.p.ok('eventDetail', { eventId: id }, auth);
      assert.ok(has(d, ALICE), '主催者');
      assert.ok(has(d, CAROL), '共同主催者');
    }
  }
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 }, { auth: w.alice });
  assert.ok(d2.season.plan.log.some((l) => l.by === 'google:' + ALICE), '照合ログの実行者');
  assert.ok(has(w.p.ok('exportEvent', { eventId: w.id1 }, { auth: w.alice }), CAROL));
});

test('共同主催者: 大会詳細・保存後の応答・保存ファイル・照合ログに、主催者のメールアドレスを入れない（自分のものは残る）', () => {
  const w = world();
  for (const id of [w.id1, w.id2]) {
    const d = w.p.ok('eventDetail', { eventId: id }, { auth: w.carol });
    assert.equal(d.event.role, 'editor');
    assert.ok(!has(d, ALICE), '大会詳細 ' + id);
    assert.ok(d.history.length > 0);
    // 実行者は「主催者」として分かる
    assert.ok(d.history.some((h) => h.actor === '主催者（Google）'));
  }
  const d2 = w.p.ok('eventDetail', { eventId: w.id2 }, { auth: w.carol });
  assert.ok(d2.season.plan.log.length > 0);
  // 保存後の応答（detail を含む）
  const ev = w.p.ok('eventDetail', { eventId: w.id1 }, { auth: w.carol }).event;
  const saved = w.p.ok('updateEvent', { eventId: w.id1, rev: ev.rev, name: ev.name, dateLabel: '', status: ev.status, isPublic: false, isFeatured: false, notes: '' }, { auth: w.carol });
  assert.ok(saved.detail);
  assert.ok(!has(saved, ALICE), '保存後の応答');
  // 保存ファイル（共同主催者の保存の可否は変えない。中身から主催者のメールアドレスを除く）
  const file = w.p.ok('exportEvent', { eventId: w.id1 }, { auth: w.carol });
  assert.ok(!has(file, ALICE), '保存ファイル');
  assert.equal(file.event.owner_email, '');
});

test('店舗スタッフ: 大会詳細・保存後の応答・照合ログに、誰のメールアドレスも入れない', () => {
  const w = world();
  for (const id of [w.id1, w.id2]) {
    const staff = w.p.staffLogin(id, STAFF_PASS);
    const d = w.p.ok('eventDetail', { eventId: id }, { auth: staff });
    assert.equal(d.event.role, 'staff');
    assert.ok(!has(d, ALICE) && !has(d, CAROL), '大会詳細 ' + id);
    assert.ok(!/@/.test(JSON.stringify(d.history)), '履歴');
    const m = (d.stages[0].groups || []).flatMap((g) => g.matches).find((x) => x.status === 'scheduled' && x.p1 && x.p2);
    if (m) {
      const saved = w.p.ok('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'live', p1Legs: 1, p2Legs: 0 }, { auth: staff });
      assert.ok(!has(saved, ALICE) && !has(saved, CAROL), '保存後の応答');
    }
    assert.equal(w.p.call('exportEvent', { eventId: id }, { auth: staff }).error.code, 'FORBIDDEN', 'スタッフは従来どおり保存できない');
  }
});

test('匿名・無関係な人: 大会詳細は返さない（従来どおり）', () => {
  const w = world();
  assert.equal(w.p.call('eventDetail', { eventId: w.id1 }, { auth: 'anon' }).ok, false);
  const mallory = w.p.loginAs('mallory@gmail.com', { sub: '200000000000000000099' });
  assert.equal(w.p.call('eventDetail', { eventId: w.id1 }, { auth: mallory }).error.code, 'NOT_FOUND');
  assert.equal(w.p.call('exportEvent', { eventId: w.id1 }, { auth: mallory }).error.code, 'NOT_FOUND');
});

test('共同主催者の保存ファイルからも復元できる（主催者は復元した人。結果も戻る）', () => {
  const w = world();
  const file = w.p.ok('exportEvent', { eventId: w.id1 }, { auth: w.carol });
  const res = w.p.ok('restoreEvent', { archive: file, mode: 'full' }, { auth: w.carol });
  const d = w.p.ok('eventDetail', { eventId: res.eventId }, { auth: w.carol });
  assert.equal(d.event.role, 'owner');
  const orig = w.p.ok('eventDetail', { eventId: w.id1 }, { auth: w.alice });
  assert.equal(d.players.length, orig.players.length);
  assert.equal(d.stages[0].groups.flatMap((g) => g.matches).filter((x) => x.status === 'final').length, orig.stages[0].groups.flatMap((g) => g.matches).filter((x) => x.status === 'final').length);
});
