// v0.8: 運営画面の CSV の読み書き（admin-io.js）と、一覧の要約（shared/summary.js）の新しい形式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, setupPair } from './gas-mock.mjs';

function loadIO() {
  const ctx = vm.createContext({ TextDecoder, Uint8Array });
  vm.runInContext(readFileSync(join(ROOT, 'admin/src/client/admin-io.js'), 'utf8'), ctx);
  return ctx.TPAdminIO;
}
const IO = loadIO();

test('CSV の書き出し: UTF-8 の BOM・CRLF。カンマ・引用符・改行は引用符で囲み、数式になる先頭文字には \' を付ける', () => {
  assert.equal(IO.csvCell('田中, 一郎'), '"田中, 一郎"');
  assert.equal(IO.csvCell('A"B'), '"A""B"');
  assert.equal(IO.csvCell('1行目\n2行目'), '"1行目\n2行目"');
  assert.equal(IO.csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(IO.csvCell('+81'), "'+81");
  assert.equal(IO.csvCell('-3'), "'-3");
  assert.equal(IO.csvCell('@x'), "'@x");
  assert.equal(IO.csvCell(null), '');
  assert.equal(IO.csvCell(12.5), '12.5');
  const csv = IO.toCsv([['名前', '所属'], ['山田', '"東京", 本店']]);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv, '﻿名前,所属\r\n山田,"""東京"", 本店"\r\n');
});

test('CSV の読み込み: 書き出した CSV を往復できる（日本語・カンマ・引用符・改行・数式の先頭文字・長い名前）', () => {
  const rows = [
    ['名前', '所属', 'Rt', 'シード'],
    ['田中, 一郎', 'A"B', '12.5', '1'],
    ['佐藤\n花子', '', '', ''],
    ['-山本', '=CMD', '', ''],
    ['長'.repeat(41), '', '', ''],
  ];
  const parsed = IO.parseCsv(IO.toCsv(rows));
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [
    ['名前', '所属', 'Rt', 'シード'],
    ['田中, 一郎', 'A"B', '12.5', '1'],
    ['佐藤\n花子', '', '', ''],
    ["'-山本", "'=CMD", '', ''],
    ['長'.repeat(41), '', '', ''],
  ]);
  const imp = JSON.parse(JSON.stringify(IO.importRows(parsed, ['既存'], 40)));
  assert.equal(imp.headerFound, true);
  assert.deepEqual(imp.rows.map((r) => r.name), ['田中, 一郎', '佐藤 花子', '-山本', '長'.repeat(41)]);
  assert.equal(imp.rows[0].rating, '12.5');
  assert.deepEqual(imp.rows[0].problems, []);
  assert.match(imp.rows[2].problems.join(), /= \+ - @/, '書き出しで付けた \' は外し、数式の先頭文字は止める');
  assert.match(imp.rows[3].problems.join(), /40 文字/);
});

test('CSV の読み込み: 見出しなし・不正な見出し・空の Rt・重複名・既存の同名・重複シード', () => {
  const noHeader = JSON.parse(JSON.stringify(IO.importRows(IO.parseCsv('山田,東京,10\r\n鈴木,,\r\n'), [], 40)));
  assert.equal(noHeader.headerFound, false);
  assert.deepEqual(noHeader.rows.map((r) => [r.line, r.name, r.affiliation, r.rating]), [[1, '山田', '東京', '10'], [2, '鈴木', '', '']]);
  const bad = JSON.parse(JSON.stringify(IO.importRows(IO.parseCsv('所属,Rt\nA,1\n'), [], 40)));
  assert.match(bad.problem, /名前/);
  const dup = JSON.parse(JSON.stringify(IO.importRows(IO.parseCsv('名前,シード,Rt\n山田,1,abc\n山田,1,\n既存,,\n'), ['既存'], 40)));
  assert.match(dup.rows[0].problems.join(), /Rt/);
  assert.match(dup.rows[1].problems.join(), /同じ名前/);
  assert.match(dup.rows[1].problems.join(), /シード 1/);
  assert.match(dup.rows[2].warnings.join(), /登録済み/);
  assert.deepEqual(dup.rows[2].problems, []);
});

test('CSV の文字コード: UTF-8（BOM あり・なし）と Shift_JIS（Excel の既定）を読める', () => {
  const utf8 = IO.decodeCsvBytes(new TextEncoder().encode('﻿名前\n山田'));
  assert.equal(utf8.encoding, 'UTF-8');
  assert.equal(utf8.text, '名前\n山田');
  // 「名前,所属\n山田,東京」の Shift_JIS
  const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f, 0x2c, 0x8f, 0x8a, 0x91, 0xae, 0x0a, 0x8e, 0x52, 0x93, 0x63, 0x2c, 0x93, 0x8c, 0x8b, 0x9e]);
  const dec = IO.decodeCsvBytes(sjis);
  assert.equal(dec.encoding, 'Shift_JIS');
  assert.equal(dec.text, '名前,所属\n山田,東京');
});

test('一覧の要約: 新しい形式の分類・名前と、1 回戦ずつ組む形式（スイス式・シリーズ）の進捗の見積もり', () => {
  const p = setupPair();
  p.ok('initializeStorage');
  const summarize = p.viewer.fn('summarizeEventView_');
  const make = (template, extra) => {
    const id = p.ok('createEvent', { name: template, template, rule: { format: 'legs', bestOf: 3 }, ...extra }).eventId;
    p.ok('addPlayers', { eventId: id, names: ['A', 'B', 'C', 'D', 'E', 'F'] });
    return id;
  };
  const sw = make('swiss', { swissRounds: 3, playoff: 4 });
  let d = p.ok('eventDetail', { eventId: sw });
  p.ok('autoAssign', { eventId: sw, stageId: d.stages[0].id });
  p.ok('generateSwissRound', { eventId: sw, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: sw });
  const s1 = JSON.parse(JSON.stringify(summarize(JSON.parse(JSON.stringify(d)), '')));
  assert.deepEqual(s1.format, { kind: 'swiss', label: 'スイス式', flow: 'スイス式 → トーナメント', id: 'swiss' });
  // 1 回戦 3 試合を組んだだけ。残り 2 回戦（6 試合）とプレーオフを見積もるので 100% にならない
  assert.equal(s1.matchCount, 3);
  assert.ok(s1.progress.estimated >= 6);
  assert.equal(s1.progress.complete, false);
  const se = make('series_playoff', { nights: 2, playoff: 4 });
  d = p.ok('eventDetail', { eventId: se });
  p.ok('autoAssign', { eventId: se, stageId: d.stages[0].id });
  d = p.ok('eventDetail', { eventId: se });
  const s2 = JSON.parse(JSON.stringify(summarize(JSON.parse(JSON.stringify(d)), '')));
  assert.equal(s2.format.kind, 'series');
  assert.equal(s2.stages[0].estimated, 2 * 5);
  const de = make('double_elimination', {});
  d = p.ok('eventDetail', { eventId: de });
  p.ok('setEntrants', { eventId: de, stageId: d.stages[0].id, playerIds: d.players.map((x) => x.id) });
  d = p.ok('eventDetail', { eventId: de });
  const s3 = JSON.parse(JSON.stringify(summarize(JSON.parse(JSON.stringify(d)), '')));
  assert.deepEqual(s3.format, { kind: 'tournament', label: 'ダブルエリミネーション', flow: 'ダブルエリミネーション', id: 'double_elimination' });
  assert.equal(s3.stages[0].estimated, 10);
});
