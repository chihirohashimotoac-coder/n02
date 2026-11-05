// 監査 PR-20（C-003）: 管理パスワードの照合は、スクリプト全体のロックを取らない（利用者の決定: ロックを外す）。
// 修正前は、誤りの回数を数えるためにスクリプトのロックを取っていたため、
// - 匿名の誤りの試行が続くと、同じ時間帯の運営の保存がロックを待たされ、BUSY の原因になりえた
// - 保存が長くロックを持っている間は、正しいパスワードでもスタッフがログインできなかった（BUSY）
// 締め出しの規則（同じ大会で 10 回の誤り → 600 秒受け付けない）は変えない。並列の誤りは少し数え漏らすことを許す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupPair } from './gas-mock.mjs';

const PASS_A = 'staff-pass-a-0001';
const PASS_B = 'staff-pass-b-0002';

function world() {
  const p = setupPair();
  p.ok('initializeStorage');
  const a = p.ok('createSampleEvent', { publish: true }).detail.event;
  const b = p.ok('createSampleEvent', { publish: true }).detail.event;
  p.ok('setStaffPassword', { eventId: a.id, rev: p.ok('eventDetail', { eventId: a.id }).event.rev, password: PASS_A });
  p.ok('setStaffPassword', { eventId: b.id, rev: p.ok('eventDetail', { eventId: b.id }).event.rev, password: PASS_B });
  return { p, a: a.id, b: b.id };
}

const login = (w, eventId, password) => w.p.call('staffLogin', { eventId, password }, { auth: 'anon' });

test('照合はスクリプトのロックを取らない: 誤り・正しいパスワードのどちらでもロックの取得回数が増えない', () => {
  const w = world();
  const before = w.p.admin.locks;
  assert.equal(login(w, w.a, 'wrong-pass-0000').error.code, 'AUTH_INVALID');
  assert.equal(login(w, w.a, PASS_A).ok, true);
  assert.equal(w.p.admin.locks, before, '誤りの試行でスクリプトのロックを取らない（運営の保存を待たせない）');
});

test('保存がスクリプトのロックを持っている間も、正しいパスワードでログインでき、誤りは AUTH_INVALID（BUSY にならない）', () => {
  const w = world();
  w.p.admin.lockBusy = true;
  const ok = login(w, w.a, PASS_A);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(login(w, w.a, 'wrong-pass-0000').error.code, 'AUTH_INVALID');
  w.p.admin.lockBusy = false;
});

test('締め出しの規則は変えない: 10 回の誤りで 11 回目と正しいパスワードを AUTH_LOCKED。600 秒後に解ける。ほかの大会・ログイン済みのセッションは影響なし', () => {
  const w = world();
  const before = w.p.staffLogin(w.a, PASS_A);
  for (let i = 0; i < 10; i++) assert.equal(login(w, w.a, 'wrong-' + i).error.code, 'AUTH_INVALID', i + 1 + ' 回目');
  assert.equal(login(w, w.a, 'wrong-10').error.code, 'AUTH_LOCKED');
  assert.equal(login(w, w.a, PASS_A).error.code, 'AUTH_LOCKED');
  assert.equal(login(w, w.b, PASS_B).ok, true, 'ほかの大会は影響なし');
  assert.equal(w.p.call('eventDetail', { eventId: w.a }, { auth: before }).ok, true, 'ログイン済みのスタッフは使える');
  w.p.clock.advance(599 * 1000);
  assert.equal(login(w, w.a, PASS_A).error.code, 'AUTH_LOCKED');
  w.p.clock.advance(2 * 1000);
  assert.equal(login(w, w.a, PASS_A).ok, true);
});

test('締め出しの間も、主催者がパスワードを設定し直すと解ける（従来どおり）', () => {
  const w = world();
  for (let i = 0; i < 10; i++) login(w, w.a, 'wrong-' + i);
  assert.equal(login(w, w.a, PASS_A).error.code, 'AUTH_LOCKED');
  const ev = w.p.ok('eventDetail', { eventId: w.a }).event;
  w.p.ok('setStaffPassword', { eventId: w.a, rev: ev.rev, password: 'staff-pass-new-0003' });
  assert.equal(login(w, w.a, 'staff-pass-new-0003').ok, true);
});
