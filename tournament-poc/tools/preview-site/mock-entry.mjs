// 確認用プレビューサイトの「ブラウザ内の模擬 Apps Script」。
//
// - 運営用・閲覧者用の Code.gs（dist/ の実物）を、tests/gas-mock.mjs と同じ模擬スプレッドシートの上でブラウザ内で動かす
// - ページの fetch のうち、設定にある模擬 URL（script.google.com/macros/s/PREVIEW-…/exec）への通信だけをここで受ける。
//   本物の Google（Apps Script・スプレッドシート・ログイン）には一切つながらない
// - 状態は「最初のサンプル作成 + 運営用への全リクエストの記録」を localStorage に置き、ページを開くたびに同じ順で再生して作り直す。
//   乱数（大会 ID・セッション）は固定の種から作るので、再生すると同じ ID・同じセッションになる
import { createStore, SPREADSHEET_ID } from '../../tests/gas-mock.mjs';
import { sha256Bytes, md5Bytes } from './hash.mjs';

// v2: v0.8 のサンプルを足した（サンプルが変わると記録の再生が合わなくなるので、キーを変えて作り直す）
const LOG_KEY = 'tpoc-preview-log-v2';
const SEED_KEY = 'tpoc-preview-seeded-at-v2';
export const PREVIEW_ADMIN_KEY = 'preview-admin-key-0123456789-abcdefghij';
export const PREVIEW_CLIENT_ID = '000000000000-preview0mock.apps.googleusercontent.com';
export const VIEWER_ENDPOINT = 'https://script.google.com/macros/s/PREVIEW-VIEWER/exec';
export const ADMIN_ENDPOINT = 'https://script.google.com/macros/s/PREVIEW-ADMIN/exec';
export const ACCOUNTS = [
  { email: 'organizer@example.org', label: '主催者 A' },
  { email: 'other@example.net', label: '主催者 B' },
];
export const STAFF_PASSWORD = 'demo-staff-2026';

const memory = {};
function load(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return memory[key] === undefined ? null : memory[key];
  }
}
function save(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch (e) {
    if (value === null) delete memory[key];
    else memory[key] = value;
  }
}

/* ---------- 決定的な乱数（mulberry32） ---------- */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function utf8(text) {
  return new TextEncoder().encode(String(text));
}

function b64url(text) {
  const bytes = utf8(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** 模擬 tokeninfo が本物として扱う ID トークン（署名の部分が 'preview-signature'） */
export function previewIdToken(email, nowMs) {
  const nowSec = Math.floor(nowMs / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: PREVIEW_CLIENT_ID, sub: 'preview-' + email, email, email_verified: 'true', iat: String(nowSec), exp: String(nowSec + 3600) };
  return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.preview-signature`;
}

/* ---------- Apps Script のサービス（tests/gas-mock.mjs の loadProject と同じ振る舞い） ---------- */

function createCache(clock) {
  const map = new Map();
  return {
    get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.exp <= clock.now()) {
        map.delete(key);
        return null;
      }
      return e.value;
    },
    getAll(keys) {
      const out = {};
      keys.forEach((k) => {
        const v = this.get(k);
        if (v !== null) out[k] = v;
      });
      return out;
    },
    put(key, value, ttl = 600) {
      if (typeof value !== 'string') throw new Error('value must be string');
      if (utf8(value).length > 100 * 1024) throw new Error('Argument too large: value');
      map.set(key, { value, exp: clock.now() + ttl * 1000 });
    },
    putAll(values, ttl) {
      Object.keys(values).forEach((k) => this.put(k, values[k], ttl));
    },
    remove(key) {
      map.delete(key);
    },
    removeAll(keys) {
      keys.forEach((k) => map.delete(k));
    },
  };
}

function createProperties(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getProperty: (k) => (map.has(k) ? map.get(k) : null),
    setProperty(k, v) {
      map.set(k, String(v));
      return this;
    },
    deleteProperty(k) {
      map.delete(k);
      return this;
    },
    getProperties: () => Object.fromEntries(map),
  };
}

function signed(bytes) {
  return Array.from(bytes, (b) => (b > 127 ? b - 256 : b));
}

function createProject(factory, { store, clock, random, properties }) {
  const props = createProperties(properties);
  const cache = createCache(clock);
  class MockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(clock.now());
      else super(...args);
    }
    static now() {
      return clock.now();
    }
  }
  const uuid = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  const textOutput = (text) => {
    const out = {
      text,
      setMimeType() {
        return out;
      },
      getContent: () => out.text,
    };
    return out;
  };
  const htmlOutput = () => {
    const out = { setTitle: () => out, addMetaTag: () => out, getContent: () => '<!doctype html><p>preview</p>' };
    return out;
  };
  const G = {
    Date: MockDate,
    console: { log() {}, info() {}, warn() {}, error() {} },
    Logger: { log() {} },
    SpreadsheetApp: {
      openById(id) {
        const book = store.get(id);
        if (!book) throw new Error('Unexpected error while getting the method or property openById on object SpreadsheetApp.');
        return book;
      },
      getActiveSpreadsheet: () => null,
      flush() {},
    },
    Sheets: {
      Spreadsheets: {
        Values: {
          get(id, range) {
            const book = store.get(id);
            if (!book) throw new Error('API call to sheets.spreadsheets.values.get failed with error: Requested entity was not found.');
            const sheet = book.getSheetByName(range);
            if (!sheet) throw new Error(`API call to sheets.spreadsheets.values.get failed with error: Unable to parse range: ${range}`);
            const fmt = (v) => (v === true ? 'TRUE' : v === false ? 'FALSE' : v instanceof Date ? v.toISOString() : v === undefined || v === null ? '' : String(v));
            const values = sheet.rows.slice(0, sheet.getLastRow()).map((line) => {
              const out = line.map(fmt);
              while (out.length && out[out.length - 1] === '') out.pop();
              return out;
            });
            return values.length ? { range, values } : { range };
          },
        },
      },
    },
    UrlFetchApp: {
      fetch(url) {
        const m = String(url).match(/^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=([^&]+)$/);
        if (!m) throw new Error('unexpected UrlFetchApp.fetch');
        const [, body, sig] = decodeURIComponent(m[1]).split('.');
        let claims = null;
        try {
          claims = sig === 'preview-signature' ? JSON.parse(fromB64url(body)) : null;
        } catch (e) {
          claims = null;
        }
        const ok = claims && Number(claims.exp) * 1000 > clock.now();
        const text = ok ? JSON.stringify(claims) : '{"error":"invalid_token"}';
        return { getResponseCode: () => (ok ? 200 : 400), getContentText: () => text };
      },
    },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {}, hasLock: () => true }) },
    Session: { getActiveUser: () => ({ getEmail: () => '' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Utilities: {
      getUuid: uuid,
      DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(alg, text) {
        if (alg === 'MD5') return signed(md5Bytes(utf8(text)));
        if (alg === 'SHA_256') return signed(sha256Bytes(utf8(text)));
        throw new Error('unsupported digest ' + alg);
      },
    },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: textOutput },
    HtmlService: { createHtmlOutputFromFile: htmlOutput, createHtmlOutput: htmlOutput },
  };
  return factory(G);
}

/* ---------- 世界の組み立て（毎回、同じ順で作り直す） ---------- */

function createWorld() {
  const store = createStore();
  store.add(SPREADSHEET_ID, 'Tournament PoC（プレビュー）');
  const clock = { t: 0, now: () => clock.t };
  const random = prng(20261021);
  const admin = createProject(window.__TPOC_GAS_ADMIN, {
    store,
    clock,
    random,
    properties: { SPREADSHEET_ID, ADMIN_KEY: PREVIEW_ADMIN_KEY, GOOGLE_CLIENT_ID: PREVIEW_CLIENT_ID },
  });
  const viewer = createProject(window.__TPOC_GAS_VIEWER, { store, clock, random: prng(7), properties: { SPREADSHEET_ID } });
  let seq = 0;
  const post = (request) => JSON.parse(admin.doPost({ postData: { contents: typeof request === 'string' ? request : JSON.stringify(request), type: 'text/plain' } }).getContent());
  const call = (action, payload, auth) => {
    const res = post({ action, payload, requestId: 'preview-seed-request-' + String(++seq).padStart(6, '0'), auth: auth === undefined ? { adminKey: PREVIEW_ADMIN_KEY } : auth });
    if (!res.ok) throw new Error(action + ': ' + res.error.message);
    return res.data;
  };
  return { store, clock, admin, viewer, post, call };
}

/** 最初に入れておくサンプル（主催者 A・B の大会。開催中・準備中・終了・非公開） */
function seed(w, at) {
  let t = at;
  const tick = () => (w.clock.t = t += 1000);
  tick();
  w.call('initializeStorage', {});
  const login = (email) => {
    tick();
    return { session: w.call('login', { idToken: previewIdToken(email, w.clock.t) }, null).session };
  };
  const a = login(ACCOUNTS[0].email);
  const b = login(ACCOUNTS[1].email);
  const c = (action, payload, auth) => {
    tick();
    return w.call(action, payload, auth);
  };
  const setEvent = (auth, id, patch) => {
    const ev = c('eventDetail', { eventId: id }, auth).event;
    return c('updateEvent', { eventId: id, rev: ev.rev, name: ev.name, dateLabel: ev.dateLabel, status: ev.status, isPublic: ev.isPublic, isFeatured: false, notes: '', ...patch }, auth);
  };
  const finish = (auth, id, stageIndex, limit, score = [3, 1]) => {
    let n = 0;
    for (;;) {
      const d = c('eventDetail', { eventId: id }, auth);
      const st = d.stages[stageIndex];
      const all = st.groups ? st.groups.flatMap((g) => g.matches) : st.rounds.flatMap((r) => r.matches);
      const m = all.find((x) => x.status === 'scheduled');
      if (!m || n >= limit) return;
      const need = Math.floor(m.bestOf / 2) + 1;
      c('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: Math.min(score[0], need), p2Legs: Math.min(score[1], need - 1) }, auth);
      n++;
    }
  };
  // 主催者 A: 開催中のロビン（サンプル）
  const open = c('createSampleEvent', { publish: true }, a).eventId;
  setEvent(a, open, { name: '第12回 n02 オープン', dateLabel: '2026/10/21', status: 'running' });
  // 主催者 A: 準備中のロビン → A/B トーナメント
  const night = c('createEvent', { name: 'ナイトカップ 11月', template: 'robin_ab', groupCount: 2, advanceCount: 2, rule: { format: 'legs', bestOf: 5 } }, a).eventId;
  c('addPlayers', { eventId: night, names: ['青木 蒼', '石田 樹', '上野 海', '江口 栞', '大西 律', '加藤 凛', '木村 朔', '久保 葵'] }, a);
  let d = c('eventDetail', { eventId: night }, a);
  c('autoAssign', { eventId: night, stageId: d.stages[0].id }, a);
  c('generateMatches', { eventId: night, stageId: d.stages[0].id }, a);
  setEvent(a, night, { isPublic: true, status: 'draft', dateLabel: '2026/11/03' });
  // 主催者 A: 非公開の練習会
  c('createEvent', { name: '水曜練習会（非公開）', template: 'robin', groupCount: 1, rule: { format: 'legs', bestOf: 3 } }, a);
  // 主催者 B: 開催中のリーグ
  const league = c('createEvent', { name: '秋季ダーツリーグ 2026', template: 'league', rule: { format: 'legs', bestOf: 5 } }, b).eventId;
  c('addPlayers', { eventId: league, names: ['佐藤', '鈴木', '高橋', '田中', '中村', '小林'] }, b);
  d = c('eventDetail', { eventId: league }, b);
  c('autoAssign', { eventId: league, stageId: d.stages[0].id }, b);
  c('generateMatches', { eventId: league, stageId: d.stages[0].id }, b);
  finish(b, league, 0, 9);
  setEvent(b, league, { isPublic: true, status: 'running', dateLabel: '2026/09/01〜2026/12/15' });
  // 主催者 B: 終了したトーナメント（管理パスワードあり）
  const cup = c('createEvent', { name: 'ウィークエンド・トーナメント', template: 'elimination', thirdPlace: true, rule: { format: 'legs', bestOf: 3 } }, b).eventId;
  c('addPlayers', { eventId: cup, names: ['山本', '森', '池田', '橋本', '石井', '前田', '藤田', '岡田'] }, b);
  d = c('eventDetail', { eventId: cup }, b);
  c('setEntrants', { eventId: cup, stageId: d.stages[0].id, playerIds: d.players.map((p) => p.id) }, b);
  c('generateBracket', { eventId: cup, stageId: d.stages[0].id }, b);
  finish(b, cup, 0, 99, [2, 0]);
  setEvent(b, cup, { isPublic: true, status: 'finished', dateLabel: '2026/10/12' });
  const ev = c('eventDetail', { eventId: cup }, b).event;
  c('setStaffPassword', { eventId: cup, rev: ev.rev, password: STAFF_PASSWORD }, b);
  // 大会の作成は主催者 1 人あたり 1 時間に 5 件まで（本番と同じ制限）。模擬の時計を進めてから作る
  const jump = () => (t += 61 * 60 * 1000);
  seedV08(a, b, c, setEvent, jump);
  seedV10(a, b, c, setEvent, jump);
  jump();
  return t;
}

/* ---------- v0.8 の形式のサンプル（形式ごとに、途中まで進めた状態） ---------- */

function matchesOf(st) {
  if (st.groups) return st.groups.flatMap((g) => g.matches);
  if (st.sides) return st.sides.flatMap((s) => s.rounds.flatMap((r) => r.matches));
  if (st.nights) return st.nights.flatMap((n) => n.rounds.flatMap((r) => r.matches));
  return st.rounds.flatMap((r) => r.matches);
}

function seedV08(a, b, c, setEvent, jump) {
  jump();
  const detail = (auth, id) => c('eventDetail', { eventId: id }, auth);
  // 未確定の試合を limit 試合まで確定する（上の選手が勝つ。固定 Leg は 3-1・2-2・1-3 を順に）
  const play = (auth, id, stageIndex, limit, filter) => {
    for (let n = 0; n < limit; n++) {
      const st = detail(auth, id).stages[stageIndex];
      const m = matchesOf(st).find((x) => x.status === 'scheduled' && (!filter || filter(x)));
      if (!m) return n;
      const spec = m.spec || { format: 'legs', bestOf: m.bestOf };
      let legs;
      if (spec.format === 'fixed') legs = [[3, 1], [2, 2], [1, 3]][n % 3];
      else {
        const need = Math.floor(m.bestOf / 2) + 1;
        legs = [need, n % 2 ? need - 1 : 0];
      }
      c('saveMatchResult', { matchId: m.id, rev: m.rev, status: 'final', p1Legs: legs[0], p2Legs: legs[1] }, auth);
    }
    return limit;
  };
  const people = (prefix, n, affs) => Array.from({ length: n }, (_, i) => ({ name: prefix + (i + 1), affiliation: affs ? affs[i % affs.length] : '', rating: String(20 - i) }));
  const notice = (auth, id, text, ruleDisplay) => {
    const ev = detail(auth, id).event;
    c('updateEventSettings', { eventId: id, rev: ev.rev, announcement: text, ruleDisplay: ruleDisplay || null, publicFields: { affiliation: true, rating: false }, autoFinish: true, timezone: 'Asia/Tokyo' }, auth);
  };

  // 1. 予選ロビン→決勝トーナメント: 3 人の組で全員 1 勝 1 敗（同順位）→ 主催者が順位を決めるまで進出できない
  const rk = c('createEvent', { name: 'サンプル: 予選ロビン→決勝（同順位あり）', template: 'robin_ko', groupCount: 2, advanceCount: 1, rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('importPlayers', { eventId: rk, players: people('ロビン', 6, ['東店', '西店', '南店']) }, a);
  let d = detail(a, rk);
  c('autoAssign', { eventId: rk, stageId: d.stages[0].id, method: 'balanced', useSeeds: true, useRating: true, spreadAffiliation: true }, a);
  c('generateMatches', { eventId: rk, stageId: d.stages[0].id }, a);
  play(a, rk, 0, 99);
  notice(a, rk, '予選が終わりました。各組の 1 位を運営が決めてから決勝トーナメントを組みます。', { category: 'steel', startScore: 501, inMode: 'open', outMode: 'double', bull: 'separate', roundLimit: '', note: '' });
  setEvent(a, rk, { isPublic: true, status: 'running', dateLabel: '2026/10/25' });

  // 2. ダブルエリミネーション 5 名（途中まで）
  const de = c('createEvent', { name: 'サンプル: ダブルエリミネーション 5 名', template: 'double_elimination', grandFinal: 'reset', rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('addPlayers', { eventId: de, names: ['DE 1', 'DE 2', 'DE 3', 'DE 4', 'DE 5'] }, a);
  d = detail(a, de);
  c('setEntrants', { eventId: de, stageId: d.stages[0].id, playerIds: d.players.map((p) => p.id) }, a);
  c('generateBracket', { eventId: de, stageId: d.stages[0].id }, a);
  play(a, de, 0, 3);
  setEvent(a, de, { isPublic: true, status: 'running' });

  // 3. 複数段階ロビン: 予選が終わり 2 次ロビン（成績は持ち越さない）を作成済み
  const mr = c('createEvent', { name: 'サンプル: 複数段階ロビン→決勝', template: 'multi_robin_ko', groupCount: 2, advanceCount: 2, groupCount2: 1, advanceCount2: 2, rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('addPlayers', { eventId: mr, names: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'] }, a);
  d = detail(a, mr);
  c('autoAssign', { eventId: mr, stageId: d.stages[0].id }, a);
  c('generateMatches', { eventId: mr, stageId: d.stages[0].id }, a);
  play(a, mr, 0, 99);
  c('confirmAdvancement', { eventId: mr, stageId: d.stages[0].id }, a);
  c('generateMatches', { eventId: mr, stageId: d.stages[1].id }, a);
  play(a, mr, 1, 2);
  setEvent(a, mr, { isPublic: true, status: 'running' });

  jump();
  // 4. ポイントシリーズ 8 名・4 節: 第 1 節は終了（不戦勝あり）・第 2 節は中止・第 3 節は途中
  const se = c('createEvent', { name: 'サンプル: ポイントシリーズ 8 名・4 節', template: 'series_playoff', nights: 4, playoff: 4, nightPoints: [5, 3, 2, 0], rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('importPlayers', { eventId: se, players: people('シリーズ', 8, ['A 店', 'B 店']) }, a);
  d = detail(a, se);
  const ss = d.stages[0];
  c('autoAssign', { eventId: se, stageId: ss.id }, a);
  c('generateNight', { eventId: se, groupId: ss.nights[0].id }, a);
  const firstNight = detail(a, se).stages[0].nights[0].rounds[0].matches.find((m) => m.status === 'scheduled');
  c('saveMatchResult', { matchId: firstNight.id, rev: firstNight.rev, status: 'final', resultType: 'walkover', winnerSide: 1, note: '相手の当日不在（プレビューの例）' }, a);
  play(a, se, 0, 99);
  d = detail(a, se);
  c('cancelNight', { eventId: se, groupId: d.stages[0].nights[1].id, rev: d.stages[0].nights[1].rev, reason: '会場の都合（プレビューの例）' }, a);
  c('generateNight', { eventId: se, groupId: d.stages[0].nights[2].id }, a);
  play(a, se, 0, 2);
  notice(a, se, '第 2 節は会場の都合で中止しました（点なし）。');
  setEvent(a, se, { isPublic: true, status: 'running', dateLabel: '2026/09〜2026/12' });

  // 5. スイス式 7 名（毎回 1 人が不戦）: 第 1 回戦が終わり、第 2 回戦を組んだところ
  const sw = c('createEvent', { name: 'サンプル: スイス式 7 名（不戦あり）', template: 'swiss', swissRounds: 3, playoff: 0, rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('addPlayers', { eventId: sw, names: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] }, a);
  d = detail(a, sw);
  c('autoAssign', { eventId: sw, stageId: d.stages[0].id }, a);
  c('generateSwissRound', { eventId: sw, stageId: d.stages[0].id }, a);
  play(a, sw, 0, 99);
  c('generateSwissRound', { eventId: sw, stageId: d.stages[0].id }, a);
  setEvent(a, sw, { isPublic: true, status: 'running' });

  // 6. 回戦ごとの抽選・途中回戦から出場するシード: 12 名のうち上位 4 名が 2 回戦から。1 回戦が終わり、2 回戦の抽選待ち
  const rd = c('createEvent', { name: 'サンプル: 回戦ごとの抽選（シードは 2 回戦から）', template: 'elimination', rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('importPlayers', { eventId: rd, players: people('R', 12).map((p, i) => ({ ...p, seed: i < 4 ? String(i + 1) : '' })) }, a);
  d = detail(a, rd);
  c('setEntrants', { eventId: rd, stageId: d.stages[0].id, entrants: d.players.map((p, i) => ({ playerId: p.id, startRound: i < 4 ? 2 : 1 })) }, a);
  d = detail(a, rd);
  c('updateStage', { stageId: d.stages[0].id, rev: d.stages[0].rev, drawMode: 'redraw', fixedRounds: 0 }, a);
  c('generateBracket', { eventId: rd, stageId: d.stages[0].id }, a);
  play(a, rd, 0, 99);
  setEvent(a, rd, { isPublic: false, status: 'running' });

  // 7. 主催者 B: リーグ（2 ディビジョン・固定 4 Legs で引き分けあり）。予定・延期あり
  const lg = c('createEvent', { name: 'サンプル: 2 ディビジョンのリーグ（固定 4 Legs）', template: 'league', divisions: 2, rule: { format: 'fixed', bestOf: 4 } }, b).eventId;
  c('importPlayers', { eventId: lg, players: people('L', 8, ['北', '南']) }, b);
  d = detail(b, lg);
  c('autoAssign', { eventId: lg, stageId: d.stages[0].id }, b);
  c('generateMatches', { eventId: lg, stageId: d.stages[0].id }, b);
  c('applyWeeklySchedule', { eventId: lg, stageId: d.stages[0].id, startDate: '2026-11-04', weekdays: [3], intervalWeeks: 1, skipDates: ['2026-11-25'], time: '20:00', venue: 'n02 ダーツバー' }, b);
  play(b, lg, 0, 5);
  const later = matchesOf(detail(b, lg).stages[0]).find((m) => m.status === 'scheduled');
  if (later) c('postponeMatch', { matchId: later.id, rev: later.rev, reason: '選手の都合（プレビューの例）' }, b);
  notice(b, lg, '毎週水曜 20:00 から。延期した試合は日程が決まりしだいお知らせします。', { category: 'soft', startScore: 501, inMode: 'open', outMode: 'open', bull: 'fat', roundLimit: 15, note: '' });
  setEvent(b, lg, { isPublic: true, status: 'running', dateLabel: '2026/11/04〜' });

  // 8. 主催者 B: リーグ→プレーオフ。リーグ戦が終わり、上位 4 名のプレーオフへの進出を確認できる
  const lp = c('createEvent', { name: 'サンプル: リーグ→プレーオフ', template: 'league_playoff', divisions: 1, playoff: 4, rule: { format: 'legs', bestOf: 3 } }, b).eventId;
  c('addPlayers', { eventId: lp, names: ['LP1', 'LP2', 'LP3', 'LP4', 'LP5', 'LP6'] }, b);
  d = detail(b, lp);
  c('autoAssign', { eventId: lp, stageId: d.stages[0].id }, b);
  c('generateMatches', { eventId: lp, stageId: d.stages[0].id }, b);
  play(b, lp, 0, 99);
  setEvent(b, lp, { isPublic: true, status: 'running' });
}

/* ---------- v1.0 の期制リーグのサンプル ---------- */

function seedV10(a, b, c, setEvent, jump) {
  jump();
  const detail = (auth, id) => c('eventDetail', { eventId: id }, auth);
  // 未確定の試合をまとめて確定する（名前の小さい方の勝ち。1 回 64 試合まで）
  const playAll = (auth, id, stageIndex, limit = 99999) => {
    let n = 0;
    for (let guard = 0; guard < 100 && n < limit; guard++) {
      const st = detail(auth, id).stages[stageIndex];
      const open = (st.groups ? st.groups.flatMap((g) => g.matches) : []).filter((m) => m.status === 'scheduled' && m.p1.id && m.p2.id).slice(0, Math.min(64, limit - n));
      if (!open.length) return;
      c('saveMatchResults', { eventId: id, results: open.map((m) => (m.p1.name < m.p2.name ? { matchId: m.id, rev: m.rev, p1Legs: 2, p2Legs: 1 } : { matchId: m.id, rev: m.rev, p1Legs: 1, p2Legs: 2 })) }, auth);
      n += open.length;
    }
  };
  // 9. 主催者 A: 期制リーグ。第 1 期（10 人の総当たり）が終わり、第 2 期（2 部制 5・5 人）のリーグも終わって入替戦の結果待ち
  const s1 = c('createSeasonLeague', { name: 'サンプル期制リーグ', thresholds: [8], cycles: 1, rule: { format: 'legs', bestOf: 3 } }, a).eventId;
  c('addPlayers', { eventId: s1, names: ['期 01', '期 02', '期 03', '期 04', '期 05', '期 06', '期 07', '期 08', '期 09', '期 10'] }, a);
  let d = detail(a, s1);
  c('autoAssign', { eventId: s1, stageId: d.stages[0].id }, a);
  c('generateMatches', { eventId: s1, stageId: d.stages[0].id }, a);
  playAll(a, s1, 0);
  jump();
  const pv = c('previewNextSeason', { eventId: s1 }, a);
  const s2 = c('confirmNextSeason', { eventId: s1, planVersion: pv.planVersion, dateLabel: '2027/01〜' }, a).eventId;
  d = detail(a, s2);
  c('generateMatches', { eventId: s2, stageId: d.stages[0].id }, a);
  playAll(a, s2, 0);
  c('generatePlayoffs', { eventId: s2 }, a);
  setEvent(a, s1, { isPublic: true, status: 'finished', dateLabel: '2026/10〜2026/12' });
  setEvent(a, s2, { isPublic: true, status: 'running' });
  jump();
  // 10. 主催者 B: 50 人の期制リーグ第 1 期（1 回総当たり 1,225 試合。公開データは試合一覧を分けて公開）。第 3 節まで確定
  const big = c('createSeasonLeague', { name: 'サンプル 50 人リーグ', thresholds: [12, 30], cycles: 1, rule: { format: 'legs', bestOf: 3 } }, b).eventId;
  c('addPlayers', { eventId: big, names: Array.from({ length: 50 }, (_, i) => '会員' + String(i + 1).padStart(2, '0')) }, b);
  d = detail(b, big);
  c('autoAssign', { eventId: big, stageId: d.stages[0].id }, b);
  c('generateMatches', { eventId: big, stageId: d.stages[0].id }, b);
  setEvent(b, big, { isPublic: true, status: 'running' });
  playAll(b, big, 0, 75);
}

function readLog() {
  try {
    const v = JSON.parse(load(LOG_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function boot() {
  let seededAt = Number(load(SEED_KEY));
  if (!seededAt) {
    // サンプルは数時間前に作ったことにする（作成数の制限の 1 時間に、サンプルの分を数えないように）。
    // サンプルの作成は制限を避けるために模擬の時計を 1 時間ずつ進めるので、その合計（v1.0 で約 9 時間）より前から始める
    seededAt = Date.now() - 12 * 60 * 60 * 1000;
    save(SEED_KEY, String(seededAt));
    save(LOG_KEY, '[]');
  }
  const w = createWorld();
  let last = seed(w, seededAt);
  const log = readLog();
  log.forEach((entry) => {
    w.clock.t = last = Math.max(last, entry.at);
    try {
      w.post(entry.body);
    } catch (e) {
      /* 記録の再生で失敗した操作は、記録したときも失敗している */
    }
  });
  const now = () => (last = Math.max(last + 1, Date.now()));
  return {
    viewerGet(params) {
      w.clock.t = now();
      return w.viewer.doGet({ parameter: params }).getContent();
    },
    adminPost(body) {
      const at = now();
      w.clock.t = at;
      const out = JSON.stringify(w.post(body));
      const next = readLog();
      next.push({ at, body });
      save(LOG_KEY, JSON.stringify(next));
      return out;
    },
  };
}

export function reset() {
  save(LOG_KEY, null);
  save(SEED_KEY, null);
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.indexOf('tpoc-') === 0)
      .forEach((k) => window.localStorage.removeItem(k));
  } catch (e) {
    /* 保存できない環境 */
  }
}

let world = null;
function getWorld() {
  if (!world) world = boot();
  return world;
}

/** 模擬 URL への fetch だけを受ける。それ以外は本来の fetch に渡す */
const realFetch = window.fetch ? window.fetch.bind(window) : null;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : input && input.url;
  const json = (text) => Promise.resolve(new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  try {
    if (url && url.indexOf(VIEWER_ENDPOINT) === 0) {
      const params = Object.fromEntries(new URL(url).searchParams);
      return new Promise((resolve) => setTimeout(resolve, 120)).then(() => json(getWorld().viewerGet(params)));
    }
    if (url === ADMIN_ENDPOINT) {
      const body = (init && init.body) || '';
      return new Promise((resolve) => setTimeout(resolve, 160)).then(() => json(getWorld().adminPost(body)));
    }
  } catch (e) {
    return Promise.reject(e);
  }
  return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
};

window.TPOC_PREVIEW = { ACCOUNTS, STAFF_PASSWORD, PREVIEW_CLIENT_ID, previewIdToken, reset };
