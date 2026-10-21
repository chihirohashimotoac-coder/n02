/* このファイルは tools/build.mjs が生成したものです。直接編集しないでください。 */
/* n02 Tournament - 運営画面の入出力（CSV の読み書き）。画面に依存しない関数だけ（Node のテストからも使う） */
(function (global) {
  'use strict';

  /* ---------- CSV の書き出し（F02） ---------- */

  /**
   * 1 つのセル。カンマ・引用符・改行を含むときは引用符で囲み、引用符は 2 つにする（RFC 4180）。
   * 先頭が = + - @ タブ 改行 の文字列は、Excel などで数式として実行されないよう先頭に ' を付ける（数式注入対策）。
   */
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    var text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  /** 行の配列から CSV（Excel で文字化けしないよう UTF-8 の BOM 付き・改行は CRLF） */
  function toCsv(rows) {
    return '﻿' + rows.map(function (r) {
      return r.map(csvCell).join(',');
    }).join('\r\n') + '\r\n';
  }

  /* ---------- CSV の読み込み（F11） ---------- */

  /** バイト列を文字列に。UTF-8（BOM あり・なし）として読めなければ Shift_JIS（Excel の既定の保存形式）として読む */
  function decodeCsvBytes(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      var text = new TextDecoder('utf-8', { fatal: true }).decode(u8);
      return { text: text.replace(/^﻿/, ''), encoding: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('shift_jis').decode(u8), encoding: 'Shift_JIS' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(u8).replace(/^﻿/, ''), encoding: 'UTF-8（読めない文字あり）' };
      }
    }
  }

  /** CSV を行の配列にする（引用符の中のカンマ・改行・"" に対応） */
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    var i = 0;
    var s = String(text || '').replace(/^﻿/, '');
    while (i < s.length) {
      var c = s.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (s.charAt(i + 1) === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          quoted = false;
          i++;
          continue;
        }
        cell += c;
        i++;
        continue;
      }
      if (c === '"' && cell === '') {
        quoted = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(cell);
        cell = '';
        i++;
        continue;
      }
      if (c === '\r' || c === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        i += c === '\r' && s.charAt(i + 1) === '\n' ? 2 : 1;
        continue;
      }
      cell += c;
      i++;
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (r) {
      return r.some(function (x) {
        return String(x).trim() !== '';
      });
    });
  }

  var HEADER_ALIASES = {
    name: ['名前', '選手名', '氏名', '選手', 'name', 'player'],
    affiliation: ['所属', 'チーム', '店舗', 'affiliation', 'team', 'club'],
    rating: ['rt', 'レーティング', 'rating', 'レート'],
    seed: ['シード', 'seed'],
  };

  function normHeader(h) {
    return String(h || '').normalize('NFKC').trim().toLowerCase().replace(/^'/, '');
  }

  /**
   * 選手の CSV を、登録する行の候補にする。1 行目が見出し（名前・所属・Rt・シード など）なら列を見出しで決め、
   * 見出しがなければ 1 列目を名前・2 列目を所属・3 列目を Rt・4 列目をシードとして読む。
   * 書き出しのときに付けた先頭の ' は外す（往復できるように）。
   * 戻り値: { columns, rows: [{ line, name, affiliation, rating, seed, problems: [], warnings: [] }], headerFound, unknownHeaders }
   */
  function importRows(table, existingNames, maxNameLength) {
    var max = maxNameLength || 40;
    var first = table[0] || [];
    var map = {};
    var unknown = [];
    var headerFound = false;
    first.forEach(function (h, i) {
      var n = normHeader(h);
      var key = Object.keys(HEADER_ALIASES).filter(function (k) {
        return HEADER_ALIASES[k].indexOf(n) !== -1;
      })[0];
      if (key && map[key] === undefined) {
        map[key] = i;
        headerFound = true;
      } else if (n) unknown.push(String(h));
    });
    if (!headerFound || map.name === undefined) {
      if (headerFound && map.name === undefined) {
        return { columns: map, rows: [], headerFound: true, unknownHeaders: unknown, problem: '見出しに「名前」（または 選手名・氏名）の列がありません。' };
      }
      map = { name: 0, affiliation: 1, rating: 2, seed: 3 };
      unknown = [];
    }
    var body = headerFound ? table.slice(1) : table;
    var seen = {};
    var existing = {};
    (existingNames || []).forEach(function (n) {
      existing[n] = true;
    });
    var seeds = {};
    var unquote = function (v) {
      var t = v === undefined || v === null ? '' : String(v);
      return t.charAt(0) === "'" && /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
    };
    var rows = body.map(function (r, idx) {
      var line = idx + (headerFound ? 2 : 1);
      var get = function (k) {
        return map[k] === undefined ? '' : unquote(r[map[k]]).normalize('NFC').replace(/\s+/g, ' ').trim();
      };
      var out = { line: line, name: get('name'), affiliation: get('affiliation'), rating: get('rating').normalize('NFKC'), seed: get('seed').normalize('NFKC'), problems: [], warnings: [] };
      if (!out.name) out.problems.push('名前が空です');
      else if (out.name.length > max) out.problems.push('名前が ' + max + ' 文字を超えています');
      if (/^[=+\-@]/.test(out.name) || /^[=+\-@]/.test(out.affiliation)) out.problems.push('先頭に = + - @ は使えません');
      if (out.rating && !/^\d{1,3}(\.\d{1,2})?$/.test(out.rating)) out.problems.push('Rt は 0〜999.99 の数（未入力は空欄）');
      if (out.seed && !/^\d{1,3}$/.test(out.seed)) out.problems.push('シードは 1 以上の整数');
      if (out.seed) {
        if (seeds[out.seed]) out.problems.push('シード ' + out.seed + ' が ' + seeds[out.seed] + ' 行目と重複');
        else seeds[out.seed] = line;
      }
      if (out.name && existing[out.name]) out.warnings.push('同じ名前の選手が登録済みです（同一人物か確認してください）');
      if (out.name && seen[out.name]) out.problems.push(seen[out.name] + ' 行目と同じ名前です');
      if (out.name && !seen[out.name]) seen[out.name] = line;
      return out;
    });
    return { columns: map, rows: rows, headerFound: headerFound, unknownHeaders: unknown };
  }

  global.TPAdminIO = { csvCell: csvCell, toCsv: toCsv, parseCsv: parseCsv, decodeCsvBytes: decodeCsvBytes, importRows: importRows };
})(typeof window !== 'undefined' ? window : this);
