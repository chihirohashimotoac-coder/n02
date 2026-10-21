// Apps Script のサービスを Node 上で模したテスト用ハーネス。
// dist/<app>/Code.gs（実際に貼り付けるファイル）をそのまま vm で読み込んで動かす。
//
// 注意: これは Google の実装ではない。仕様として確認できている範囲の動作を真似たもので、
// 実環境での動作確認（docs/test-plan.md の「実環境」項目）の代わりにはならない。
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SPREADSHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd';

/* ---------- Spreadsheet ---------- */

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_LIKE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}([ T].*)?|\d{1,2}\/\d{1,2}(\/\d{2,4})?)$/;

/** 書式が「書式なしテキスト」でないセルに文字列を書いたときの、スプレッドシートの自動変換を近似する */
function autoParse(value, format) {
  if (typeof value !== 'string' || format === '@') return value;
  if (value.startsWith('=')) throw new Error(`formula written to sheet: ${value}`);
  const t = value.trim();
  if (t === '') return '';
  if (NUMERIC.test(t)) return Number(t);
  if (/^(TRUE|FALSE)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  if (DATE_LIKE.test(t)) {
    const d = new Date(t.replace(/\//g, '-'));
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) throw new Error('Invalid range dimensions');
    if (row + numRows - 1 > sheet.maxRows || col + numCols - 1 > sheet.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    }
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const s = this.sheet;
    s.book.store.stats.reads++;
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = s.cell(this.row + r, this.col + c);
        line.push(v instanceof Date ? new Date(v.getTime()) : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() {
    return this.getValues()[0][0];
  }
  setValues(values) {
    const s = this.sheet;
    if (s.book.store.failWrites) throw new Error('Service Spreadsheets failed (simulated)');
    if (!Array.isArray(values) || values.length !== this.numRows) throw new Error('row count mismatch');
    values.forEach((line) => {
      if (!Array.isArray(line) || line.length !== this.numCols) throw new Error('column count mismatch');
    });
    s.book.store.stats.writes++;
    values.forEach((line, r) =>
      line.forEach((v, c) => {
        if (v !== null && typeof v === 'object' && !(v instanceof Date)) throw new Error('invalid cell value');
        if (typeof v === 'string' && v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
        s.setCell(this.row + r, this.col + c, autoParse(v, s.format(this.row + r, this.col + c)));
      })
    );
    return this;
  }
  setValue(v) {
    return this.setValues([[v]]);
  }
  setNumberFormat(fmt) {
    for (let r = 0; r < this.numRows; r++) for (let c = 0; c < this.numCols; c++) this.sheet.setFormat(this.row + r, this.col + c, fmt);
    return this;
  }
  setFontWeight() {
    return this;
  }
}

class FakeSheet {
  constructor(book, name, maxRows = 1000, maxCols = 26) {
    Object.assign(this, { book, name, maxRows, maxCols, rows: [], formats: [], frozen: 0 });
  }
  cell(r, c) {
    const line = this.rows[r - 1];
    const v = line ? line[c - 1] : undefined;
    return v === undefined || v === null ? '' : v;
  }
  setCell(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v;
  }
  format(r, c) {
    const line = this.formats[r - 1];
    return line ? line[c - 1] : undefined;
  }
  setFormat(r, c, f) {
    while (this.formats.length < r) this.formats.push([]);
    this.formats[r - 1][c - 1] = f;
  }
  getName() {
    return this.name;
  }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) if ((this.rows[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((line) => line.forEach((v, i) => {
      if (v !== '' && v !== undefined && v !== null) max = Math.max(max, i + 1);
    }));
    return max;
  }
  getMaxRows() {
    return this.maxRows;
  }
  getMaxColumns() {
    return this.maxCols;
  }
  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  insertRowsAfter(after, n) {
    // 新しい行には書式を引き継がない（悲観的な前提でテストする）
    this.rows.splice(after, 0, ...Array.from({ length: n }, () => []));
    this.formats.splice(after, 0, ...Array.from({ length: n }, () => []));
    this.maxRows += n;
    return this;
  }
  insertColumnsAfter(after, n) {
    this.maxCols += n;
    return this;
  }
  deleteRows(r, n) {
    if (this.book.store.failWrites) throw new Error('Service Spreadsheets failed (simulated)');
    // 実際のスプレッドシートと同じく、固定行以外をすべて消そうとするとエラーにする
    if (n >= this.maxRows - 1) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
    this.book.store.stats.writes++;
    this.rows.splice(r - 1, n);
    this.formats.splice(r - 1, n);
    this.maxRows -= n;
    return this;
  }
  deleteRow(r) {
    if (this.book.store.failWrites) throw new Error('Service Spreadsheets failed (simulated)');
    this.book.store.stats.writes++;
    this.rows.splice(r - 1, 1);
    this.formats.splice(r - 1, 1);
    this.maxRows -= 1;
    return this;
  }
  setFrozenRows(n) {
    this.frozen = n;
  }
  /** テスト用: 見出し行をオブジェクトの配列として読む */
  records() {
    const header = (this.rows[0] || []).map(String);
    return this.rows.slice(1).filter((l) => l.some((v) => v !== '' && v !== undefined)).map((line) => Object.fromEntries(header.map((h, i) => [h, line[i] === undefined ? '' : line[i]])));
  }
}

class FakeSpreadsheet {
  constructor(store, id, name) {
    Object.assign(this, { store, id, name, sheets: [new FakeSheet(this, 'シート1')] });
  }
  getId() {
    return this.id;
  }
  getName() {
    return this.name;
  }
  getSheets() {
    return this.sheets.slice();
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.name === name) || null;
  }
  insertSheet(name, index) {
    if (this.getSheetByName(name)) throw new Error(`A sheet with the name "${name}" already exists.`);
    const sheet = new FakeSheet(this, name, this.store.defaultMaxRows);
    this.sheets.splice(index === undefined ? this.sheets.length : index, 0, sheet);
    return sheet;
  }
}

export function createStore() {
  const store = {
    books: new Map(),
    stats: { reads: 0, writes: 0, opens: 0 },
    failOpen: false,
    failWrites: false,
    defaultMaxRows: 1000,
    add(id = SPREADSHEET_ID, name = 'Tournament PoC') {
      const book = new FakeSpreadsheet(store, id, name);
      store.books.set(id, book);
      return book;
    },
    get(id = SPREADSHEET_ID) {
      return store.books.get(id);
    },
    /** 書き込みの有無を確認するためのスナップショット */
    dump() {
      return JSON.stringify([...store.books.values()].map((b) => b.sheets.map((s) => [s.name, s.rows])));
    },
  };
  return store;
}

/* ---------- 時計・キャッシュ・ロック・プロパティ ---------- */

export function createClock(start = Date.UTC(2026, 9, 20, 9, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

function createCache(clock) {
  const map = new Map();
  const cache = {
    stats: { gets: 0, puts: 0 },
    get(key) {
      cache.stats.gets++;
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
        const v = cache.get(k);
        if (v !== null) out[k] = v;
      });
      return out;
    },
    put(key, value, ttl = 600) {
      if (typeof key !== 'string' || key.length > 250) throw new Error('Argument too large: key');
      if (typeof value !== 'string') throw new Error('value must be string');
      if (Buffer.byteLength(value, 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
      if (ttl < 1 || ttl > 21600) throw new Error('expirationInSeconds out of range');
      cache.stats.puts++;
      map.set(key, { value, exp: clock.now() + ttl * 1000 });
    },
    putAll(values, ttl) {
      Object.entries(values).forEach(([k, v]) => cache.put(k, v, ttl));
    },
    remove(key) {
      map.delete(key);
    },
    removeAll(keys) {
      keys.forEach((k) => map.delete(k));
    },
    clear() {
      map.clear();
    },
    expireAll() {
      for (const e of map.values()) e.exp = 0;
    },
    expireFresh(prefix) {
      for (const [k, e] of map.entries()) if (k.startsWith(prefix) && !k.includes('stale:')) e.exp = 0;
    },
  };
  return cache;
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

function createLock(project) {
  return {
    tryLock() {
      if (project.lockBusy) return false;
      project.locks++;
      return true;
    },
    waitLock() {
      if (project.lockBusy) throw new Error('Lock timeout');
      project.locks++;
    },
    releaseLock() {},
    hasLock: () => true,
  };
}

/* ---------- プロジェクトの読み込み ---------- */

/**
 * dist/<app>/Code.gs を読み込んだ 1 つの Apps Script プロジェクトを作る。
 * options: { store, clock, owner, activeUser, properties }
 */
export function loadProject(app, options = {}) {
  const store = options.store || createStore();
  const clock = options.clock || createClock();
  const project = {
    app,
    store,
    clock,
    owner: options.owner === undefined ? 'owner@example.com' : options.owner,
    activeUser: options.activeUser === undefined ? 'owner@example.com' : options.activeUser,
    lockBusy: false,
    locks: 0,
    fetches: [],
    urlFetchFail: false,
    logs: [],
  };
  project.properties = createProperties(options.properties);
  project.cache = createCache(clock);
  const htmlPath = join(ROOT, 'dist', app, 'Index.html');
  const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : null;

  const htmlOutput = (content) => {
    const out = {
      content,
      title: '',
      meta: {},
      setTitle(t) {
        out.title = t;
        return out;
      },
      addMetaTag(k, v) {
        out.meta[k] = v;
        return out;
      },
      setXFrameOptionsMode() {
        throw new Error('setXFrameOptionsMode should not be used (keep the default)');
      },
      getContent: () => out.content,
    };
    return out;
  };

  class MockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(clock.now());
      else super(...args);
    }
    static now() {
      return clock.now();
    }
  }

  const globals = {
    Date: MockDate,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    isFinite,
    isNaN,
    parseInt,
    console: {
      log: (...a) => project.logs.push(['log', ...a]),
      info: (...a) => project.logs.push(['info', ...a]),
      warn: (...a) => project.logs.push(['warn', ...a]),
      error: (...a) => project.logs.push(['error', ...a]),
    },
    Logger: { log: (...a) => project.logs.push(['Logger', ...a]) },
    SpreadsheetApp: {
      openById(id) {
        store.stats.opens++;
        if (store.failOpen) throw new Error('Service Spreadsheets failed while accessing document (simulated)');
        const book = store.get(id);
        if (!book) throw new Error('Unexpected error while getting the method or property openById on object SpreadsheetApp.');
        return book;
      },
      getActiveSpreadsheet: () => null,
      flush() {},
    },
    // 高度なサービス「Google Sheets API」（values.get のみ）。既定の FORMATTED_VALUE を近似し、値を文字列で返す
    Sheets: {
      Spreadsheets: {
        Values: {
          get(id, range) {
            store.stats.opens++;
            if (store.failOpen) throw new Error('API call to sheets.spreadsheets.values.get failed with error: Internal error (simulated)');
            const book = store.get(id);
            if (!book) throw new Error('API call to sheets.spreadsheets.values.get failed with error: Requested entity was not found.');
            const sheet = book.getSheetByName(range);
            if (!sheet) throw new Error(`API call to sheets.spreadsheets.values.get failed with error: Unable to parse range: ${range}`);
            store.stats.reads++;
            const fmt = (v) => (v === true ? 'TRUE' : v === false ? 'FALSE' : v instanceof Date ? v.toISOString() : v === undefined || v === null ? '' : String(v));
            const values = sheet.rows.slice(0, sheet.getLastRow()).map((line) => {
              const out = line.map(fmt);
              while (out.length && out[out.length - 1] === '') out.pop();
              return out;
            });
            return values.length ? { range, majorDimension: 'ROWS', values } : { range, majorDimension: 'ROWS' };
          },
        },
      },
    },
    // Google の tokeninfo（https://oauth2.googleapis.com/tokeninfo?id_token=…）だけを模す。
    // fakeIdToken() が作るトークンは「ヘッダー.クレーム（base64url の JSON）.署名」で、署名が 'valid-signature' なら本物として扱う
    UrlFetchApp: {
      fetch(url, params = {}) {
        project.fetches.push(url);
        if (project.urlFetchFail) throw new Error('Address unavailable (simulated)');
        const m = String(url).match(/^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=([^&]+)$/);
        if (!m) throw new Error('unexpected UrlFetchApp.fetch ' + url);
        if (params.muteHttpExceptions !== true) throw new Error('muteHttpExceptions must be true');
        const [, body, sig] = decodeURIComponent(m[1]).split('.');
        let claims = null;
        try {
          claims = sig === 'valid-signature' ? JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) : null;
        } catch {
          claims = null;
        }
        const expired = claims && Number(claims.exp) * 1000 <= clock.now();
        const code = claims && !expired ? 200 : 400;
        const text = code === 200 ? JSON.stringify(claims) : JSON.stringify({ error: 'invalid_token', error_description: 'Invalid Value' });
        return { getResponseCode: () => code, getContentText: () => text };
      },
    },
    PropertiesService: { getScriptProperties: () => project.properties },
    CacheService: { getScriptCache: () => project.cache },
    LockService: { getScriptLock: () => createLock(project) },
    Session: {
      getActiveUser: () => ({ getEmail: () => project.activeUser || '' }),
      getEffectiveUser: () => ({ getEmail: () => project.owner || '' }),
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { MD5: 'MD5', SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest(alg, text) {
        const algo = { MD5: 'md5', SHA_256: 'sha256' }[alg];
        if (!algo) throw new Error('unsupported digest ' + alg);
        return Array.from(createHash(algo).update(text, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        const out = {
          text,
          mimeType: 'text/plain',
          setMimeType(m) {
            out.mimeType = m;
            return out;
          },
          getContent: () => out.text,
        };
        return out;
      },
    },
    HtmlService: {
      createHtmlOutputFromFile(name) {
        if (name !== 'Index' || html === null) throw new Error('No HTML file named ' + name);
        return htmlOutput(html);
      },
      createHtmlOutput: (content) => htmlOutput(content),
    },
  };
  const baseKeys = new Set(Object.getOwnPropertyNames(globals));
  const context = vm.createContext(globals);
  // options.codePath: 別の版のコードで動かす（版の更新の確認用）
  const code = readFileSync(options.codePath || join(ROOT, 'dist', app, 'Code.gs'), 'utf8');
  vm.runInContext(code, context, { filename: `${app}/Code.gs` });
  project.context = context;

  /** トップレベルに定義された関数名の一覧 */
  project.topLevelFunctions = () => Object.getOwnPropertyNames(context).filter((k) => typeof context[k] === 'function' && !baseKeys.has(k));

  /** 内部関数を直接呼ぶ（単体テスト用） */
  project.fn = (name) => {
    const f = context[name];
    if (typeof f !== 'function') throw new Error(`no function ${name}`);
    return f;
  };

  /**
   * google.script.run を模した呼び出し。
   * - 引数と戻り値は JSON 相当に変換する（google.script.run は関数・DOM などを渡せない）
   * - 末尾が "_" の関数は呼べない前提（Google の HTML Service ガイドの「private functions」に基づく。実環境で要確認）
   */
  project.run = (name, ...args) => {
    if (name.endsWith('_')) throw new Error(`private function ${name} cannot be called from google.script.run`);
    if (!project.topLevelFunctions().includes(name)) throw new Error(`Script function not found: ${name}`);
    const f = context[name];
    const res = f(...JSON.parse(JSON.stringify(args)));
    return res === undefined ? undefined : JSON.parse(JSON.stringify(res));
  };
  /** 運営用 Web アプリの doPost を、fetch で JSON を送ったときと同じ形で呼ぶ */
  project.post = (request) => {
    const body = typeof request === 'string' ? request : JSON.stringify(request);
    const out = project.run('doPost', { postData: { contents: body, type: 'text/plain' } });
    if (!out || out.mimeType !== 'application/json') throw new Error('doPost must return JSON');
    return JSON.parse(out.text);
  };
  return project;
}

export const ADMIN_KEY = 'test-admin-key-0123456789-abcdefghij';
export const GOOGLE_CLIENT_ID = '123456789012-testclientid0preview.apps.googleusercontent.com';

/** テスト用の Google ID トークン（UrlFetchApp の模擬 tokeninfo が本物として扱う形）。claims で上書きできる */
export function fakeIdToken(email, clock, claims = {}, signature = 'valid-signature') {
  const nowSec = Math.floor((clock ? clock.now() : Date.now()) / 1000);
  const body = {
    iss: 'https://accounts.google.com',
    aud: GOOGLE_CLIENT_ID,
    sub: 'sub-' + email,
    email,
    email_verified: 'true',
    iat: String(nowSec),
    exp: String(nowSec + 3600),
    ...claims,
  };
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(body)}.${signature}`;
}

/** 運営者用・閲覧者用の 2 プロジェクトを同じスプレッドシートにつないで用意する */
export function setupPair(options = {}) {
  const store = options.store || createStore();
  const clock = options.clock || createClock();
  if (!store.get()) store.add();
  const admin = loadProject('admin', { store, clock, properties: { SPREADSHEET_ID, ADMIN_KEY, GOOGLE_CLIENT_ID }, ...options.admin });
  const viewer = loadProject('viewer', { store, clock, properties: { SPREADSHEET_ID }, activeUser: '', ...options.viewer });
  let n = 0;
  // extra.auth: 省略 = 管理者 / 'anon' = 未認証 / { session } = ログインした主催者・スタッフ / { adminKey } など任意
  const call = (action, payload = {}, extra = {}) => {
    const auth = extra.auth === undefined ? { adminKey: ADMIN_KEY } : extra.auth === 'anon' ? undefined : extra.auth;
    return admin.post({ action, payload, requestId: extra.requestId || `test-request-${String(++n).padStart(8, '0')}`, auth, ...extra.request });
  };
  const ok = (action, payload, extra) => {
    const res = call(action, payload, extra);
    if (!res.ok) throw new Error(`${action} failed: ${res.error.code} ${res.error.message}`);
    return res.data;
  };
  /** Google でログインしてセッションの auth を返す */
  const loginAs = (email) => ({ session: ok('login', { idToken: fakeIdToken(email, clock) }, { auth: 'anon' }).session });
  /** 管理パスワードでログインしてセッションの auth を返す */
  const staffLogin = (eventId, password) => ({ session: ok('staffLogin', { eventId, password }, { auth: 'anon' }).session });
  return { store, clock, admin, viewer, call, ok, loginAs, staffLogin };
}
