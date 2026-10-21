// 確認用プレビューサイト（tools/preview-site）の模擬 Utilities.computeDigest が Node.js の crypto と同じ結果になること
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Bytes, md5Bytes } from '../tools/preview-site/hash.mjs';

test('SHA-256 と MD5 が Node.js の crypto と一致する（ブロック境界・日本語を含む）', () => {
  const samples = ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(119), 'n02-tournament-session:' + 'f'.repeat(64), '日本語の大会名・ダーツ'.repeat(40)];
  for (const s of samples) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(Buffer.from(sha256Bytes(bytes)).toString('hex'), createHash('sha256').update(s, 'utf8').digest('hex'), `sha256 ${s.length}`);
    assert.equal(Buffer.from(md5Bytes(bytes)).toString('hex'), createHash('md5').update(s, 'utf8').digest('hex'), `md5 ${s.length}`);
  }
});
