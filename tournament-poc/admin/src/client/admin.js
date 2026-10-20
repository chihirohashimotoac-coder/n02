/* n02 Tournament PoC - 運営画面（クライアント側） */
(function (global) {
  'use strict';

  var MATCH_STATUS_LABEL = { scheduled: '未開始', live: '進行中', final: '確定済み', check: '要確認' };
  var EVENT_STATUS_LABEL = { draft: '準備中', running: '開催中', finished: '終了' };
  var BEST_OF_CHOICES = [1, 3, 5, 7, 9, 11, 13];
  var TABS = [
    { id: 'progress', label: '進行状況' },
    { id: 'matches', label: '試合結果' },
    { id: 'players', label: '選手' },
    { id: 'groups', label: 'グループ' },
    { id: 'settings', label: '大会設定' },
    { id: 'history', label: '履歴' },
  ];

  /* ---------- 共通 ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = String(v);
        else if (k === 'className') node.className = v;
        else if (k === 'onClick') node.addEventListener('click', v);
        else if (k === 'onSubmit') node.addEventListener('submit', v);
        else if (k === 'onChange') node.addEventListener('change', v);
        else if (k === 'value') node.value = v;
        else if (k === 'checked') node.checked = !!v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function newRequestId() {
    var bytes = new Uint8Array(16);
    (global.crypto || global.msCrypto).getRandomValues(bytes);
    return Array.prototype.map
      .call(bytes, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  function legsToWin(bestOf) {
    return Math.floor(bestOf / 2) + 1;
  }

  /** サーバーと同じ規則のクライアント側事前チェック（最終判定はサーバー） */
  function checkResult(status, p1, p2, bestOf) {
    var need = legsToWin(bestOf);
    if (!/^\d+$/.test(String(p1)) || !/^\d+$/.test(String(p2))) return '取得 Leg 数は 0 以上の整数で入力してください';
    p1 = Number(p1);
    p2 = Number(p2);
    if (p1 > need || p2 > need) return 'Best of ' + bestOf + ' では取得 Leg 数は最大 ' + need + ' です';
    if (status === 'scheduled' && (p1 || p2)) return '未開始にする場合は Leg 数を 0 にしてください';
    if (status === 'live' && (p1 >= need || p2 >= need)) return 'どちらかが ' + need + ' Leg に達しています。「確定」を押してください';
    if (status === 'final') {
      if (p1 === need && p2 === need) return '両者が ' + need + ' Leg になっています';
      if (p1 !== need && p2 !== need) return '確定するには、どちらかがちょうど ' + need + ' Leg 必要です';
    }
    return '';
  }

  /* ---------- サーバー呼び出し ---------- */

  function createApi(runner) {
    function callOnce(request) {
      return new Promise(function (resolve, reject) {
        runner(
          request,
          function (res) {
            if (res && res.ok) resolve(res.data);
            else reject((res && res.error) || { code: 'UNKNOWN', message: '不明な応答です。' });
          },
          function (err) {
            reject({ code: 'NETWORK', message: '通信に失敗しました。' + (err && err.message ? '（' + err.message + '）' : '') });
          }
        );
      });
    }
    return {
      query: function (action, payload) {
        return callOnce({ action: action, payload: payload || {} });
      },
      /**
       * 書き込み。通信エラーのときだけ、同じ requestId で 1 回だけ再送する。
       * サーバーは requestId で二重実行を防ぐので、再送しても 2 回反映されることはない。
       */
      mutate: function (action, payload) {
        var request = { action: action, payload: payload || {}, requestId: newRequestId() };
        return callOnce(request).catch(function (err) {
          if (err && (err.code === 'NETWORK' || err.code === 'BUSY')) {
            return new Promise(function (r) {
              setTimeout(r, 1500);
            }).then(function () {
              return callOnce(request);
            });
          }
          throw err;
        });
      },
    };
  }

  /* ---------- アプリ ---------- */

  function startApp(doc, runner) {
    var api = createApi(runner);
    var root = doc.getElementById('app');
    var toastBox = doc.getElementById('toast');
    var state = { boot: null, eventId: '', detail: null, tab: 'progress', busy: false, matchFilter: 'all', statusFilter: 'open', editing: {} };

    function toast(kind, text) {
      var item = el('div', { className: 'toast toast--' + kind, role: kind === 'error' ? 'alert' : 'status', text: text });
      toastBox.appendChild(item);
      setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, kind === 'error' ? 8000 : 4000);
    }

    function setBusy(busy) {
      state.busy = busy;
      doc.body.classList.toggle('is-busy', busy);
      Array.prototype.forEach.call(root.querySelectorAll('[data-mut]'), function (b) {
        b.disabled = busy || b.getAttribute('data-locked') === '1';
      });
    }

    function handleError(err) {
      toast('error', (err && err.message) || 'エラーが発生しました。');
      if (err && (err.code === 'CONFLICT' || err.code === 'NOT_FOUND' || err.code === 'ALREADY_FINAL') && state.eventId) {
        loadDetail(state.eventId);
      }
    }

    /** 書き込み操作の共通処理。実行中は他の書き込みボタンを押せなくする。 */
    function mutate(action, payload, okMessage) {
      if (state.busy) return Promise.resolve(null);
      setBusy(true);
      return api
        .mutate(action, payload)
        .then(function (data) {
          if (data && data.duplicate) {
            if (state.eventId) return loadDetail(state.eventId);
            return loadBoot();
          }
          if (data && data.detail) {
            state.detail = data.detail;
            state.eventId = data.detail.event.id;
          }
          if (data && data.storage) state.boot = data;
          if (okMessage) toast('ok', typeof okMessage === 'function' ? okMessage(data) : okMessage);
          render();
          return data;
        })
        .catch(handleError)
        .then(function (data) {
          setBusy(false);
          return data;
        });
    }

    function loadBoot() {
      return api
        .query('bootstrap')
        .then(function (data) {
          state.boot = data;
          render();
        })
        .catch(function (err) {
          root.textContent = '';
          root.appendChild(el('p', { className: 'panel error', text: (err && err.message) || '読み込みに失敗しました。' }));
          root.appendChild(el('button', { className: 'btn', type: 'button', text: '再読み込み', onClick: loadBoot }));
        });
    }

    function loadDetail(eventId) {
      return api
        .query('eventDetail', { eventId: eventId })
        .then(function (detail) {
          state.detail = detail;
          state.eventId = eventId;
          state.editing = {};
          render();
        })
        .catch(handleError);
    }

    function openEvent(eventId) {
      state.tab = 'progress';
      state.detail = null;
      state.eventId = eventId;
      render();
      loadDetail(eventId);
    }

    function goHome() {
      state.eventId = '';
      state.detail = null;
      render();
      loadBoot();
    }

    /* ---------- 描画 ---------- */

    function render() {
      root.textContent = '';
      var who = doc.getElementById('actor');
      if (who && state.boot) who.textContent = state.boot.actor;
      if (!state.boot) {
        root.appendChild(el('p', { className: 'panel', text: '読み込み中…' }));
        return;
      }
      var s = state.boot.storage;
      if (!s.configured || !s.accessible || !s.initialized) {
        root.appendChild(renderSetup(s));
        return;
      }
      if (state.eventId) root.appendChild(renderEvent());
      else root.appendChild(renderHome());
      setBusy(state.busy);
    }

    function renderSetup(s) {
      var panel = el('section', { className: 'panel' }, [el('h2', { text: '初期セットアップ' })]);
      if (!s.configured) {
        var input = el('input', { type: 'text', id: 'spreadsheet-id', className: 'input', autocomplete: 'off', placeholder: 'https://docs.google.com/spreadsheets/d/…' });
        panel.appendChild(el('p', { text: 'データ保存用のスプレッドシート（PoC 専用の空のもの）の共有リンク、または ID を入力してください。スプレッドシートを開く必要はありません（Google ドライブで右クリック →「リンクをコピー」）。' }));
        panel.appendChild(
          el('form', {
            className: 'row',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('configureStorage', { spreadsheetId: input.value }, '保存先を設定しました。');
            },
          }, [el('label', { className: 'visually-hidden', for: 'spreadsheet-id', text: 'スプレッドシート ID' }), input, el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '設定' })])
        );
        return panel;
      }
      if (!s.accessible) {
        panel.appendChild(el('p', { className: 'error', text: s.message }));
        return panel;
      }
      panel.appendChild(el('p', { text: '保存先: ' + s.spreadsheetName }));
      panel.appendChild(el('p', { text: '不足しているシート: ' + (s.missing.join('、') || 'なし') }));
      panel.appendChild(el('p', { className: 'muted', text: '初期化は何度実行しても既存データを消しません。管理対象外のデータがあるスプレッドシートでは中止します。' }));
      panel.appendChild(
        el('button', {
          className: 'btn btn--primary',
          type: 'button',
          'data-mut': true,
          text: '初期化する',
          onClick: function () {
            mutate('initializeStorage', {}, '初期化しました。');
          },
        })
      );
      return panel;
    }

    function renderHome() {
      var boot = state.boot;
      var wrap = el('div', { className: 'stack' });

      var list = el('section', { className: 'panel' }, [el('h2', { text: '大会一覧' })]);
      if (!boot.events.length) list.appendChild(el('p', { className: 'muted', text: 'まだ大会がありません。下のフォームから作成してください。' }));
      boot.events.forEach(function (ev) {
        list.appendChild(
          el('article', { className: 'event-card' }, [
            el('div', { className: 'event-card__main' }, [
              el('h3', { text: ev.name }),
              el('p', { className: 'muted', text: [ev.dateLabel, EVENT_STATUS_LABEL[ev.status] || ev.status, '選手 ' + ev.playerCount + ' 名', '確定 ' + ev.finalCount + ' / ' + ev.matchCount + ' 試合'].filter(Boolean).join('・') }),
              el('p', null, [
                el('span', { className: 'badge ' + (ev.isPublic ? 'badge--on' : ''), text: ev.isPublic ? '公開中' : '非公開' }),
                ev.isFeatured ? el('span', { className: 'badge badge--on', text: '既定表示' }) : null,
                ev.isSample ? el('span', { className: 'badge', text: 'サンプル' }) : null,
              ]),
            ]),
            el('button', { className: 'btn', type: 'button', text: '開く', onClick: function () { openEvent(ev.id); } }),
          ])
        );
      });
      wrap.appendChild(list);

      var name = el('input', { className: 'input', id: 'new-name', required: true, maxlength: 80 });
      var date = el('input', { className: 'input', id: 'new-date', maxlength: 40, placeholder: '例: 2026/11/03' });
      var bestOf = el('select', { className: 'input', id: 'new-bestof' }, BEST_OF_CHOICES.map(function (n) {
        return el('option', { value: String(n), text: 'Best of ' + n + ' Legs（先に ' + legsToWin(n) + ' Leg）', selected: n === 5 ? true : null });
      }));
      var provisional = el('input', { type: 'checkbox', id: 'new-provisional', checked: true });
      var groupCount = el('input', { className: 'input input--short', id: 'new-groups', type: 'number', min: 1, max: 16, value: '4', inputmode: 'numeric' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '大会を作成' }),
          el('form', {
            className: 'form',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('createEvent', { name: name.value, dateLabel: date.value, bestOf: Number(bestOf.value), provisional: provisional.checked, groupCount: Number(groupCount.value) }, '大会を作成しました。').then(function (data) {
                if (data && data.detail) state.tab = 'players';
                render();
              });
            },
          }, [
            field('大会名', name),
            field('開催日（表示用の文字列）', date),
            field('対戦形式', bestOf),
            el('label', { className: 'check' }, [provisional, ' 暫定ルールとして扱う（確定した大会ルールではない）']),
            field('ロビンのグループ数', groupCount),
            el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '作成' }),
          ]),
        ])
      );

      var publishSample = el('input', { type: 'checkbox', id: 'sample-publish' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '検証用サンプル' }),
          el('p', { className: 'muted', text: '16 名（サンプル選手01〜16）・4 人 × 4 グループのロビン、Best of 5 Legs（暫定）。確定・進行中・未開始の試合を含みます。' }),
          el('label', { className: 'check' }, [publishSample, ' 作成後すぐ閲覧画面に公開する']),
          el('button', {
            className: 'btn',
            type: 'button',
            'data-mut': true,
            text: 'サンプル大会を作成',
            onClick: function () {
              mutate('createSampleEvent', { publish: publishSample.checked }, 'サンプル大会を作成しました。');
            },
          }),
        ])
      );

      var viewerUrl = el('input', { className: 'input', id: 'viewer-url', value: boot.viewerUrl, placeholder: 'https://script.google.com/macros/s/…/exec' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h2', { text: '閲覧者用 URL' }),
          el('p', { className: 'muted', text: '閲覧者用 Web アプリをデプロイしたら URL を登録してください。運営画面からリンクを開けるようになります（任意）。' }),
          el('form', {
            className: 'row',
            onSubmit: function (e) {
              e.preventDefault();
              mutate('setViewerUrl', { url: viewerUrl.value }, '保存しました。');
            },
          }, [el('label', { className: 'visually-hidden', for: 'viewer-url', text: '閲覧者用 URL' }), viewerUrl, el('button', { className: 'btn', type: 'submit', 'data-mut': true, text: '保存' })]),
          el('p', { className: 'muted small', text: 'データ保存先: ' + boot.storage.spreadsheetName + '（ID: ' + boot.storage.spreadsheetId + '）。閲覧者用プロジェクトのスクリプト プロパティ SPREADSHEET_ID にも同じ ID を設定します。' }),
        ])
      );
      return wrap;
    }

    function field(label, control) {
      return el('label', { className: 'field' }, [el('span', { className: 'field__label', text: label }), control]);
    }

    function renderEvent() {
      var wrap = el('div', { className: 'stack' });
      var d = state.detail;
      wrap.appendChild(
        el('div', { className: 'event-head' }, [
          el('button', { className: 'btn btn--ghost', type: 'button', text: '← 大会一覧', onClick: goHome }),
          el('h2', { className: 'event-head__title', text: d ? d.event.name : '読み込み中…' }),
          d ? el('span', { className: 'badge ' + (d.event.isPublic ? 'badge--on' : ''), text: d.event.isPublic ? '公開中' : '非公開' }) : null,
        ])
      );
      if (!d) return wrap;
      var tabs = el('nav', { className: 'tabs', 'aria-label': '大会メニュー' });
      TABS.forEach(function (t) {
        tabs.appendChild(
          el('button', {
            type: 'button',
            className: 'tab',
            'aria-current': state.tab === t.id ? 'page' : null,
            text: t.label,
            onClick: function () {
              state.tab = t.id;
              render();
            },
          })
        );
      });
      wrap.appendChild(tabs);
      var body = {
        progress: renderProgress,
        matches: renderMatches,
        players: renderPlayers,
        groups: renderGroups,
        settings: renderSettings,
        history: renderHistory,
      }[state.tab]();
      wrap.appendChild(body);
      return wrap;
    }

    function renderProgress() {
      var d = state.detail;
      var p = d.progress;
      var panel = el('section', { className: 'panel' }, [el('h3', { text: '進行状況' })]);
      var pct = p.total ? Math.round((p.final / p.total) * 100) : 0;
      panel.appendChild(el('div', { className: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, [el('div', { className: 'meter__bar', style: 'width:' + pct + '%' })]));
      panel.appendChild(el('p', { text: '確定 ' + p.final + ' / ' + p.total + ' 試合（進行中 ' + p.live + '・未開始 ' + p.scheduled + (p.check ? '・要確認 ' + p.check : '') + '）' }));
      var table = el('table', { className: 'table' }, [
        el('thead', null, [el('tr', null, ['グループ', '選手', '確定', '進行中', '未開始'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
        el('tbody', null, d.groups.map(function (g) {
          return el('tr', null, [el('th', { scope: 'row', text: g.name }), el('td', { text: String(g.players.length) }), el('td', { text: g.progress.final + ' / ' + g.progress.total }), el('td', { text: String(g.progress.live) }), el('td', { text: String(g.progress.scheduled) })]);
        })),
      ]);
      panel.appendChild(table);

      var pub = el('section', { className: 'panel' }, [el('h3', { text: '公開' })]);
      if (d.publication.published) {
        pub.appendChild(el('p', { text: '閲覧画面に公開中（公開データ更新: ' + formatDateTime(d.publication.publishedAt) + '）' + (d.publication.isDefault ? '・既定表示の大会' : '') }));
      } else {
        pub.appendChild(el('p', { text: '非公開です。「大会設定」で公開にすると閲覧画面に表示されます。' }));
      }
      pub.appendChild(el('p', { className: 'muted small', text: '閲覧画面は約 60 秒ごとに自動更新されます（閲覧側のキャッシュを含め、反映まで最大 1〜2 分程度）。' }));
      var viewerUrl = state.boot && state.boot.viewerUrl;
      if (viewerUrl && d.publication.published) {
        var href = viewerUrl + '?event=' + encodeURIComponent(d.event.id);
        pub.appendChild(el('p', null, [el('a', { href: href, target: '_blank', rel: 'noopener', text: '閲覧画面を開く' })]));
      }
      pub.appendChild(
        el('button', {
          className: 'btn',
          type: 'button',
          'data-mut': true,
          text: '公開データを再生成',
          onClick: function () {
            mutate('republish', { eventId: d.event.id }, '公開データを再生成しました。');
          },
        })
      );
      return el('div', { className: 'stack' }, [panel, pub]);
    }

    function renderMatches() {
      var d = state.detail;
      var wrap = el('div', { className: 'stack' });
      var chips = el('div', { className: 'chips', role: 'group', 'aria-label': 'グループ' });
      [{ id: 'all', name: 'すべて' }].concat(d.groups).forEach(function (g) {
        chips.appendChild(el('button', { type: 'button', className: 'chip', 'aria-pressed': String(state.matchFilter === g.id), text: g.name, onClick: function () { state.matchFilter = g.id; render(); } }));
      });
      var chips2 = el('div', { className: 'chips', role: 'group', 'aria-label': '状態' });
      [{ id: 'open', name: '未確定のみ' }, { id: 'all', name: 'すべての状態' }, { id: 'final', name: '確定済みのみ' }].forEach(function (f) {
        chips2.appendChild(el('button', { type: 'button', className: 'chip', 'aria-pressed': String(state.statusFilter === f.id), text: f.name, onClick: function () { state.statusFilter = f.id; render(); } }));
      });
      wrap.appendChild(el('div', { className: 'panel panel--tight' }, [chips, chips2]));

      var any = false;
      d.groups.forEach(function (g) {
        if (state.matchFilter !== 'all' && state.matchFilter !== g.id) return;
        var ms = g.matches.filter(function (m) {
          if (state.statusFilter === 'open') return m.status !== 'final' || state.editing[m.id];
          if (state.statusFilter === 'final') return m.status === 'final';
          return true;
        });
        if (!ms.length) return;
        any = true;
        wrap.appendChild(el('section', { className: 'panel' }, [el('h3', { text: g.name })].concat(ms.map(function (m) { return renderMatchEditor(g, m); }))));
      });
      if (!any) wrap.appendChild(el('p', { className: 'panel muted', text: d.progress.total ? '該当する試合はありません。' : '対戦カードがありません。「グループ」タブで作成してください。' }));
      return wrap;
    }

    function renderMatchEditor(group, m) {
      var editing = !!state.editing[m.id];
      var locked = m.storedStatus === 'final' && !editing;
      var need = legsToWin(m.bestOf);
      var p1 = el('input', { className: 'legs-input', type: 'number', inputmode: 'numeric', min: 0, max: need, value: String(m.storedP1Legs === null ? 0 : m.storedP1Legs), disabled: locked, 'aria-label': m.p1.name + ' の取得 Leg' });
      var p2 = el('input', { className: 'legs-input', type: 'number', inputmode: 'numeric', min: 0, max: need, value: String(m.storedP2Legs === null ? 0 : m.storedP2Legs), disabled: locked, 'aria-label': m.p2.name + ' の取得 Leg' });
      var msg = el('p', { className: 'match-editor__msg', role: 'status' });

      function send(status) {
        var problem = checkResult(status, p1.value.trim(), p2.value.trim(), m.bestOf);
        if (problem) {
          msg.textContent = problem;
          return;
        }
        mutate('saveMatchResult', { matchId: m.id, rev: m.rev, status: status, p1Legs: p1.value.trim(), p2Legs: p2.value.trim(), correction: m.storedStatus === 'final' }, status === 'final' ? '結果を確定しました。' : '保存しました。').then(function (data) {
          if (data) {
            delete state.editing[m.id];
            render();
          }
        });
      }

      var buttons;
      if (locked) {
        buttons = [el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '訂正', onClick: function () { state.editing[m.id] = true; render(); } })];
      } else {
        buttons = [
          el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '進行中として保存', onClick: function () { send('live'); } }),
          el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: editing ? '訂正して確定' : '確定', onClick: function () { send('final'); } }),
          el('button', { className: 'btn btn--ghost', type: 'button', 'data-mut': true, text: '未開始に戻す', onClick: function () { p1.value = '0'; p2.value = '0'; send('scheduled'); } }),
        ];
        if (editing) buttons.push(el('button', { className: 'btn btn--ghost', type: 'button', text: 'キャンセル', onClick: function () { delete state.editing[m.id]; render(); } }));
      }
      var winner = m.status === 'final' ? (m.winnerId === m.p1.id ? m.p1.name : m.p2.name) : '';
      return el('article', { className: 'match-editor match-editor--' + m.status, 'data-match-id': m.id }, [
        el('div', { className: 'match-editor__meta' }, [
          el('span', { text: 'R' + m.round + '・Best of ' + m.bestOf }),
          el('span', { className: 'status status--' + m.status, text: MATCH_STATUS_LABEL[m.status] }),
        ]),
        el('div', { className: 'match-editor__row' }, [
          el('label', { className: 'match-editor__player' }, [el('span', { text: m.p1.name }), p1]),
          el('span', { className: 'match-editor__vs', text: 'vs' }),
          el('label', { className: 'match-editor__player match-editor__player--2' }, [p2, el('span', { text: m.p2.name })]),
        ]),
        winner ? el('p', { className: 'match-editor__winner', text: '勝者: ' + winner + (m.confirmedAt ? '（確定 ' + formatDateTime(m.confirmedAt) + '）' : '') }) : null,
        m.problems && m.problems.length ? el('p', { className: 'error small', text: '要確認: ' + m.problems.join(' / ') }) : null,
        msg,
        el('div', { className: 'btn-row' }, buttons),
      ]);
    }

    /** 削除など取り消しにくい操作は、2 回押しで実行する */
    function confirmButton(label, confirmLabel, onConfirm) {
      var armed = false;
      var timer = null;
      var b = el('button', { className: 'btn btn--danger', type: 'button', 'data-mut': true, text: label });
      b.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          b.textContent = confirmLabel;
          timer = setTimeout(function () {
            armed = false;
            b.textContent = label;
          }, 4000);
          return;
        }
        clearTimeout(timer);
        onConfirm();
      });
      return b;
    }

    function renderPlayers() {
      var d = state.detail;
      var wrap = el('div', { className: 'stack' });
      var area = el('textarea', { className: 'input', id: 'bulk-names', rows: 5, placeholder: '1 行に 1 名ずつ入力' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: '選手を追加' }),
          el('form', {
            className: 'form',
            onSubmit: function (e) {
              e.preventDefault();
              var names = area.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
              if (!names.length) {
                toast('error', '選手名を入力してください。');
                return;
              }
              mutate('addPlayers', { eventId: d.event.id, names: names }, function (r) { return (r && r.added) + ' 名を追加しました。'; });
            },
          }, [el('label', { className: 'visually-hidden', for: 'bulk-names', text: '選手名' }), area, el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '追加' })]),
        ])
      );
      var groupName = {};
      d.groups.forEach(function (g) {
        groupName[g.id] = g.name;
      });
      var list = el('section', { className: 'panel' }, [el('h3', { text: '登録選手（' + d.players.length + ' 名）' })]);
      d.players.forEach(function (p) {
        var input = el('input', { className: 'input', value: p.name, maxlength: 40, 'aria-label': '選手名' });
        list.appendChild(
          el('div', { className: 'player-row', 'data-player-id': p.id }, [
            input,
            el('span', { className: 'muted small', text: (groupName[p.groupId] || '未割当') + (p.matchCount ? '・' + p.matchCount + ' 試合' : '') }),
            el('div', { className: 'btn-row' }, [
              el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '名前を保存', onClick: function () { mutate('updatePlayer', { playerId: p.id, rev: p.rev, name: input.value }, '保存しました。'); } }),
              confirmButton('削除', '本当に削除', function () { mutate('deletePlayer', { playerId: p.id, rev: p.rev }, '削除しました。'); }),
            ]),
          ])
        );
      });
      wrap.appendChild(list);
      return wrap;
    }

    function renderGroups() {
      var d = state.detail;
      var wrap = el('div', { className: 'stack' });
      var hasMatches = d.progress.total > 0;
      var count = el('input', { className: 'input input--short', type: 'number', min: 1, max: 16, value: String(d.groups.length), inputmode: 'numeric', 'aria-label': 'グループ数' });
      wrap.appendChild(
        el('section', { className: 'panel' }, [
          el('h3', { text: 'グループ構成' }),
          el('div', { className: 'row' }, [
            el('span', { text: 'グループ数' }),
            count,
            el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': hasMatches ? '1' : null, text: '変更', onClick: function () { mutate('setGroupCount', { eventId: d.event.id, count: Number(count.value) }, 'グループ数を変更しました。'); } }),
            el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': hasMatches ? '1' : null, text: '登録順に自動割当', onClick: function () { mutate('autoAssign', { eventId: d.event.id }, '割り当てました。'); } }),
            el('button', { className: 'btn btn--primary', type: 'button', 'data-mut': true, text: '全グループの対戦カードを作成', onClick: function () { mutate('generateMatches', { eventId: d.event.id }, function (r) { return r.created + ' 試合を作成しました。' + (r.skipped && r.skipped.length ? '（対象外: ' + r.skipped.join('、') + '）' : ''); }); } }),
          ]),
          hasMatches ? el('p', { className: 'muted small', text: '対戦カード作成後は、グループ数の変更・自動割当はできません（カードを削除すると再びできます）。' }) : null,
        ])
      );

      var options = [{ id: '', name: '未割当' }].concat(d.groups);
      var assign = el('section', { className: 'panel' }, [el('h3', { text: '選手の割り当て' })]);
      d.players.forEach(function (p) {
        var sel = el('select', { className: 'input', 'aria-label': p.name + ' のグループ', 'data-mut': true }, options.map(function (g) {
          return el('option', { value: g.id, text: g.name, selected: g.id === p.groupId ? true : null });
        }));
        sel.addEventListener('change', function () {
          mutate('assignPlayer', { eventId: d.event.id, playerId: p.id, groupId: sel.value }, '割り当てを変更しました。');
        });
        assign.appendChild(el('div', { className: 'player-row' }, [el('span', { text: p.name }), sel]));
      });
      if (!d.players.length) assign.appendChild(el('p', { className: 'muted', text: '選手が登録されていません。' }));
      wrap.appendChild(assign);

      d.groups.forEach(function (g) {
        var name = el('input', { className: 'input', value: g.name, maxlength: 40, 'aria-label': 'グループ名' });
        wrap.appendChild(
          el('section', { className: 'panel' }, [
            el('div', { className: 'row' }, [name, el('button', { className: 'btn', type: 'button', 'data-mut': true, text: '名前を保存', onClick: function () { mutate('renameGroup', { groupId: g.id, rev: g.rev, name: name.value }, '保存しました。'); } })]),
            el('p', { text: '選手: ' + (g.players.map(function (p) { return p.name; }).join('、') || 'なし') }),
            el('p', { className: 'muted small', text: '対戦カード: ' + g.progress.total + ' 試合' }),
            el('div', { className: 'btn-row' }, [
              el('button', { className: 'btn', type: 'button', 'data-mut': true, 'data-locked': g.progress.total > 0 ? '1' : null, text: '対戦カードを作成', onClick: function () { mutate('generateMatches', { eventId: d.event.id, groupId: g.id }, function (r) { return r.created + ' 試合を作成しました。'; }); } }),
              g.progress.total > 0 ? confirmButton('対戦カードを削除', '本当に削除', function () { mutate('clearMatches', { eventId: d.event.id, groupId: g.id }, '対戦カードを削除しました。'); }) : null,
            ]),
          ])
        );
      });
      return wrap;
    }

    function renderSettings() {
      var d = state.detail;
      var ev = d.event;
      var name = el('input', { className: 'input', value: ev.name, maxlength: 80 });
      var date = el('input', { className: 'input', value: ev.dateLabel, maxlength: 40 });
      var status = el('select', { className: 'input' }, Object.keys(EVENT_STATUS_LABEL).map(function (k) {
        return el('option', { value: k, text: EVENT_STATUS_LABEL[k], selected: k === ev.status ? true : null });
      }));
      var isPublic = el('input', { type: 'checkbox', checked: ev.isPublic });
      var featured = el('input', { type: 'checkbox', checked: ev.isFeatured });
      var notes = el('input', { className: 'input', value: ev.notes || '', maxlength: 200 });
      var eventForm = el('section', { className: 'panel' }, [
        el('h3', { text: '大会情報' }),
        el('form', {
          className: 'form',
          onSubmit: function (e) {
            e.preventDefault();
            mutate('updateEvent', { eventId: ev.id, rev: ev.rev, name: name.value, dateLabel: date.value, status: status.value, isPublic: isPublic.checked, isFeatured: featured.checked, notes: notes.value }, '保存しました。');
          },
        }, [
          field('大会名', name),
          field('開催日（表示用）', date),
          field('状態', status),
          el('label', { className: 'check' }, [isPublic, ' 閲覧画面に公開する']),
          el('label', { className: 'check' }, [featured, ' 閲覧画面の既定表示にする（URL に大会指定がないときに表示）']),
          field('運営メモ（非公開）', notes),
          el('button', { className: 'btn btn--primary', type: 'submit', 'data-mut': true, text: '保存' }),
        ]),
      ]);

      var rule = d.rule || { bestOf: 5, provisional: true, rev: 0 };
      var bestOf = el('select', { className: 'input' }, BEST_OF_CHOICES.map(function (n) {
        return el('option', { value: String(n), text: 'Best of ' + n + ' Legs（先に ' + legsToWin(n) + ' Leg）', selected: n === rule.bestOf ? true : null });
      }));
      var provisional = el('input', { type: 'checkbox', checked: rule.provisional });
      var ruleForm = el('section', { className: 'panel' }, [
        el('h3', { text: 'ルール' }),
        el('form', {
          className: 'form',
          onSubmit: function (e) {
            e.preventDefault();
            mutate('updateRule', { eventId: ev.id, rev: rule.rev, bestOf: Number(bestOf.value), provisional: provisional.checked }, '保存しました。');
          },
        }, [
          field('対戦形式', bestOf),
          el('label', { className: 'check' }, [provisional, ' 暫定ルールとして扱う']),
          el('p', { className: 'muted small', text: '結果が入力された試合がある場合、Best of は変更できません。' }),
          el('button', { className: 'btn', type: 'submit', 'data-mut': true, text: 'ルールを保存' }),
        ]),
      ]);
      return el('div', { className: 'stack' }, [eventForm, ruleForm]);
    }

    function renderHistory() {
      var d = state.detail;
      var panel = el('section', { className: 'panel' }, [el('h3', { text: '変更履歴（直近 ' + d.history.length + ' 件）' })]);
      if (!d.history.length) panel.appendChild(el('p', { className: 'muted', text: '履歴はありません。' }));
      var list = el('ol', { className: 'history' });
      d.history.forEach(function (h) {
        list.appendChild(el('li', null, [el('span', { className: 'muted small', text: formatDateTime(h.at) + '・' + h.actor }), el('span', { text: h.action + ' ' + h.entity + (h.entityId ? ' ' + h.entityId : '') })]));
      });
      panel.appendChild(list);
      return panel;
    }

    render();
    loadBoot();
    return { state: state };
  }

  global.TPAdmin = { checkResult: checkResult, createApi: createApi, legsToWin: legsToWin };

  if (global.document && global.google && global.google.script) {
    var runner = function (request, ok, fail) {
      global.google.script.run.withSuccessHandler(ok).withFailureHandler(fail).adminCall(request);
    };
    var go = function () {
      global.__tpocAdmin = startApp(global.document, runner);
    };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(typeof window !== 'undefined' ? window : this);
