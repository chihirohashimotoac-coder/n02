// 監査 PR-07（W-002 / C-018）: 「リーグ → プレーオフ」の作成前の見積もりを、作成後に実際に進出する人数・試合数に合わせる。
// 作成時は各ディビジョンの上位 ceil(プレーオフの人数 / ディビジョン数) 人が進む（06_actions.js の league_playoff）。競技規則は変えない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProject, setupPair } from './gas-mock.mjs';

const admin = loadProject('admin');
const est = (params) => JSON.parse(JSON.stringify(admin.fn('estimateFormat_')('league_playoff', params)));
// 見積もりの表示名は「決勝トーナメント」（作成される段階の名前は「プレーオフ」のまま）
const playoffOf = (e) => e.stages.find((s) => s.name === '決勝トーナメント');

/** 実際に作成し、全試合を確定してから進出させ、プレーオフの人数と試合数を返す */
function actual({ players, divisions, playoff, thirdPlace = false }) {
  const p = setupPair();
  p.ok('initializeStorage');
  const id = p.ok('createEvent', { name: 'L', template: 'league_playoff', divisions, playoff, thirdPlace, rule: { format: 'legs', bestOf: 3 } }).eventId;
  p.ok('addPlayers', { eventId: id, names: Array.from({ length: players }, (_, i) => '選手' + String(i + 1).padStart(2, '0')) });
  let d = p.ok('eventDetail', { eventId: id });
  const league = d.stages[0].id;
  p.ok('autoAssign', { eventId: id, stageId: league });
  p.ok('generateMatches', { eventId: id, stageId: league });
  d = p.ok('eventDetail', { eventId: id });
  const results = d.stages[0].groups.flatMap((g) => g.matches).map((m) => ({ matchId: m.id, rev: m.rev, p1Legs: m.p1.name < m.p2.name ? 2 : 0, p2Legs: m.p1.name < m.p2.name ? 0 : 2 }));
  for (let i = 0; i < results.length; i += 60) p.ok('saveMatchResults', { eventId: id, results: results.slice(i, i + 60) });
  const sizes = p.ok('eventDetail', { eventId: id }).stages[0].groups.map((g) => g.standings.length);
  p.ok('confirmAdvancement', { eventId: id, stageId: league });
  d = p.ok('eventDetail', { eventId: id });
  const po = d.stages[1];
  p.ok('generateBracket', { eventId: id, stageId: po.id });
  d = p.ok('eventDetail', { eventId: id });
  const real = d.stages[1].rounds.flatMap((r) => r.matches).filter((m) => m.resultType !== 'bye' && !(m.p1 && !m.p2 && m.status === 'final'));
  return { entrants: d.stages[1].entries.length, sizes, bracketMatches: real.length };
}

test('12 人・3 ディビジョン・プレーオフ 4 人: 各ディビジョン 2 人・合計 6 人・勝ち抜き 5 試合と見積もる（作成後と一致）', () => {
  const e = est({ players: 12, divisions: 3, playoff: 4 });
  const po = playoffOf(e);
  assert.match(po.note, /^6 人/);
  assert.equal(po.matches, 5);
  assert.match(e.notes.join(), /各ディビジョンの上位 2 人/);
  assert.match(e.notes.join(), /3 ディビジョン × 2 人 = 6 人/);
  const a = actual({ players: 12, divisions: 3, playoff: 4 });
  assert.equal(a.entrants, 6);
});

for (const c of [
  { players: 6, divisions: 1, playoff: 4, entrants: 4, matches: 3 },
  { players: 11, divisions: 3, playoff: 8, entrants: 9, matches: 8 }, // 4・4・3 人 → 3 + 3 + 3
  { players: 5, divisions: 2, playoff: 6, entrants: 5, matches: 4 }, // 3・2 人 → 3 + 2（小さいディビジョンは全員）
  { players: 12, divisions: 3, playoff: 4, thirdPlace: true, entrants: 6, matches: 6 }, // 3 位決定戦 +1
  { players: 8, divisions: 2, playoff: 4, entrants: 4, matches: 3 }, // 割り切れる場合は従来と同じ
]) {
  test(`見積もりと作成後の一致: ${c.players} 人・${c.divisions} ディビジョン・プレーオフ ${c.playoff} 人${c.thirdPlace ? '・3 位決定戦' : ''}`, () => {
    const po = playoffOf(est(c));
    assert.match(po.note, new RegExp('^' + c.entrants + ' 人'));
    assert.equal(po.matches, c.matches);
    const a = actual(c);
    assert.equal(a.entrants, c.entrants, '作成後の進出人数 ' + a.sizes.join('・'));
  });
}

test('ディビジョンが 1 つのときは注記を出さない（従来どおり）', () => {
  assert.ok(!est({ players: 8, divisions: 1, playoff: 4 }).notes.some((n) => /ディビジョン/.test(n)));
});
