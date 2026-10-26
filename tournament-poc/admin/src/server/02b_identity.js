/* v0.9: 主催者・共同主催者と Google アカウント（sub）の紐付け
 *
 * 権限は sub だけで判定する（02_auth.js の eventRole_）。メールアドレスは、まだ sub の分からない
 * 「既存の大会（v0.8 までに作成）」「管理者が付け替えた主催者」「共同主催者の招待」を、本人のログインで紐付ける手がかりにだけ使う。
 *
 * 紐付けの条件（linkCandidates_）:
 * - ログインで確かめたメールアドレスが、大会の owner_email・招待のメールアドレスと一致する
 * - Google がそのアドレスの今の持ち主を保証できる（@gmail.com、または Google Workspace = hd あり）
 * - そのアドレスが別の sub に、またはその sub が別のアドレスに、既に紐付いていない（アドレスの再割り当て・変更の疑い）
 * 満たせば本人のログインで自動的に紐付ける。満たさなければ「確認待ちのログイン」として記録するだけで権限は付けず、
 * 主催者（共同主催者の場合）か管理者（主催者の場合）が画面で承認したときに、その sub を紐付ける。
 * 画面・履歴には sub を出さず、見分け用の短い参照（subRef_）だけを出す。
 */

function subRef_(sub) {
  return sha256Hex_('n02-tournament-sub:' + sub).slice(0, 12);
}

function linkJson_(text) {
  var v = safeJson_(text, {});
  if (!Array.isArray(v.claims)) v.claims = [];
  v.claims = v.claims.filter(function (c) {
    return c && typeof c.sub === 'string' && SUB_PATTERN_.test(c.sub);
  });
  return v;
}

/**
 * 大会の主催者の sub。紐付けた時のメールアドレスと今の owner_email が違えば（旧版での付け替え・シートの手作業での変更）、
 * 紐付けは古いとみなして使わない（空欄 = 主催者が紐付いていない。管理者だけが操作できる）
 */
function ownerSubOf_(event) {
  if (!event || !event.owner_sub || !SUB_PATTERN_.test(event.owner_sub) || !event.owner_email) return '';
  var link = safeJson_(event.owner_link_json, {});
  return normalizeEmail_(link.email) === event.owner_email ? event.owner_sub : '';
}

/** 共同主催者の招待のメールアドレス（v0.8 の行は email 列） */
function collabEmailOf_(r) {
  return normalizeEmail_(r.invite_email) || normalizeEmail_(r.email);
}

/** 共同主催者として有効か（sub が紐付いている） */
function collabActive_(r) {
  return !!(r && typeof r.sub === 'string' && SUB_PATTERN_.test(r.sub));
}

/** 確認待ちのログインを画面に出す形（sub は出さない） */
function claimsView_(link) {
  return link.claims.map(function (c) {
    return { ref: subRef_(c.sub), email: normalizeEmail_(c.email), at: c.at || '' };
  });
}

/** 新しく作る大会の主催者（Google でログインした人。管理者が作った大会は主催者なし） */
function creatorOwner_(ctx) {
  var u = ctx.user;
  if (!u || u.kind !== 'google' || !u.sub) return { owner_email: '', owner_sub: '', owner_link_json: '' };
  return { owner_email: u.email, owner_sub: u.sub, owner_link_json: JSON.stringify({ email: u.email, via: 'created', at: ctx.now }) };
}

/**
 * 紐付け済みの (sub, メールアドレス) の組。アドレスの再割り当て・変更の疑いを見つけるのに使う。
 * 主催者の紐付け（有効なもの）と、有効な共同主催者から集める。
 */
function linkedPairs_(ctx) {
  var pairs = [];
  ctx.table('Events').rows.forEach(function (e) {
    var sub = ownerSubOf_(e);
    if (sub) pairs.push({ sub: sub, email: e.owner_email });
  });
  ctx.table('Collaborators').rows.forEach(function (r) {
    if (!collabActive_(r)) return;
    var link = safeJson_(r.link_json, {});
    pairs.push({ sub: r.sub, email: normalizeEmail_(link.email) || collabEmailOf_(r) });
  });
  return pairs;
}

/**
 * この利用者（Google ログイン）に紐付けられる大会・招待。
 * 戻り値 { bind: [...], claim: [...], pending: [...] }。各要素は { kind: 'owner', event } | { kind: 'collaborator', event, rec }
 * - bind: 本人のログインで自動的に紐付けてよい
 * - claim: 確認待ちとして記録する（まだ記録していない）
 * - pending: この人の確認待ちが記録済み（承認を待っている）
 */
function linkCandidates_(ctx, user) {
  var out = { bind: [], claim: [], pending: [] };
  if (!user || user.kind !== 'google' || !user.sub || !user.email) return out;
  var events = ctx.table('Events');
  var conflict = linkedPairs_(ctx).some(function (p) {
    return (p.email === user.email && p.sub !== user.sub) || (p.sub === user.sub && p.email !== user.email);
  });
  var auto = user.emailAuthoritative === true && !conflict;
  var place = function (item, link) {
    var claimed = link.claims.some(function (c) {
      return c.sub === user.sub;
    });
    if (claimed) out.pending.push(item);
    else if (auto) out.bind.push(item);
    else out.claim.push(item);
  };
  events.rows.forEach(function (e) {
    if (events.duplicates[e.event_id] || !e.owner_email || e.owner_email !== user.email || ownerSubOf_(e)) return;
    place({ kind: 'owner', event: e }, linkJson_(e.owner_link_json));
  });
  ctx.table('Collaborators').rows.forEach(function (r) {
    if (collabActive_(r) || collabEmailOf_(r) !== user.email) return;
    var e = events.byKey[r.event_id];
    if (!e || events.duplicates[r.event_id] || ownerSubOf_(e) === user.sub) return;
    place({ kind: 'collaborator', event: e, rec: r }, linkJson_(r.link_json));
  });
  return out;
}

/** 画面に返す件数（bootstrap・myEvents）。available があれば、画面が linkAccount を呼ぶ */
function linkSummary_(ctx, user) {
  var c = linkCandidates_(ctx, user);
  return { available: c.bind.length + c.claim.length, pending: c.pending.length };
}

function addClaim_(link, user, now) {
  if (link.claims.length >= ADMIN_CONFIG.MAX_LINK_CLAIMS) return false;
  link.claims.push({ sub: user.sub, email: user.email, at: now });
  return true;
}

/** 紐付ける: 主催者は owner_sub、共同主催者は sub。共同主催者の v0.8 の email 列は invite_email へ移す */
function bindItem_(ctx, item, sub, email, via) {
  var link = { email: email, via: via, at: ctx.now };
  if (ctx.user && ctx.user.kind !== 'google') link.by = ctx.user.label;
  if (item.kind === 'owner') {
    item.event.owner_sub = sub;
    item.event.owner_link_json = JSON.stringify(link);
    updateRecord_(ctx.table('Events'), item.event);
    recordHistory_(ctx, 'owner.link', 'Event', item.event.event_id, item.event.event_id, null, { via: via, account: subRef_(sub) });
    return;
  }
  var r = item.rec;
  r.invite_email = collabEmailOf_(r);
  r.email = '';
  r.sub = sub;
  r.link_json = JSON.stringify(link);
  r.rev = (r.rev || 0) + 1;
  r.updated_at = ctx.now;
  updateRecord_(ctx.table('Collaborators'), r);
  recordHistory_(ctx, 'collaborator.link', 'Event', item.event.event_id, item.event.event_id, null, { email: r.invite_email, via: via, account: subRef_(sub) });
}

/**
 * ログインした本人の大会・招待を紐付ける（画面がログインの後に呼ぶ）。
 * 自動で紐付けてよいものは紐付け、そうでないものは確認待ちとして記録する（権限は付かない）。
 */
function actionLinkAccount_(ctx) {
  var user = ctx.user;
  var c = linkCandidates_(ctx, user);
  c.bind.forEach(function (item) {
    bindItem_(ctx, item, user.sub, user.email, 'email');
  });
  var claimed = 0;
  c.claim.forEach(function (item) {
    var table = item.kind === 'owner' ? ctx.table('Events') : ctx.table('Collaborators');
    var rec = item.kind === 'owner' ? item.event : item.rec;
    var field = item.kind === 'owner' ? 'owner_link_json' : 'link_json';
    var link = linkJson_(rec[field]);
    if (!addClaim_(link, user, ctx.now)) return;
    rec[field] = JSON.stringify(link);
    if (item.kind === 'collaborator') {
      rec.rev = (rec.rev || 0) + 1;
      rec.updated_at = ctx.now;
    }
    updateRecord_(table, rec);
    claimed++;
    recordHistory_(ctx, item.kind === 'owner' ? 'owner.claim' : 'collaborator.claim', 'Event', item.event.event_id, item.event.event_id, null, { email: user.email, account: subRef_(user.sub) });
  });
  var owners = c.bind.filter(function (i) {
    return i.kind === 'owner';
  }).length;
  return { linked: { owner: owners, collaborator: c.bind.length - owners }, claimed: claimed, pending: c.pending.length + claimed };
}

/** 確認待ちのログインから 1 件を選ぶ（画面からは参照 ref だけを受け取る） */
function pickClaim_(link, ref, email) {
  if (typeof ref !== 'string' || !/^[a-f0-9]{12}$/.test(ref)) throw appError_('BAD_REQUEST', '承認するログインの指定が不正です。');
  var found = link.claims.filter(function (c) {
    return subRef_(c.sub) === ref && normalizeEmail_(c.email) === email;
  })[0];
  if (!found) throw appError_('NOT_FOUND', '確認待ちのログインが見つかりません。画面を再読み込みしてください。');
  return found;
}

/** 管理者: 主催者の確認待ちのログインを承認して、その Google アカウントを主催者にする */
function actionApproveOwnerClaim_(ctx, payload) {
  assertPlatformAdmin_(ctx.user);
  var eventId = requireId_(payload.eventId, '大会');
  var events = ctx.table('Events');
  var event = findRecord_(events, eventId, '大会');
  assertRev_(event, requireRev_(payload.rev), '大会');
  if (!event.owner_email) throw appError_('VALIDATION', 'この大会には主催者のメールアドレスが設定されていません。');
  var claim = pickClaim_(linkJson_(event.owner_link_json), payload.ref, event.owner_email);
  bindItem_(ctx, { kind: 'owner', event: event }, claim.sub, event.owner_email, 'approved');
  event.rev = (event.rev || 0) + 1;
  event.updated_at = ctx.now;
  updateRecord_(events, event);
  return { eventId: eventId };
}

/** 主催者・管理者: 共同主催者の確認待ちのログインを承認して、有効にする */
function actionApproveCollaborator_(ctx, payload) {
  var eventId = requireId_(payload.eventId, '大会');
  assertOwnerRole_(ctx, eventId, '共同主催者の承認');
  var event = findRecord_(ctx.table('Events'), eventId, '大会');
  var table = ctx.table('Collaborators');
  var rec = findRecord_(table, requireId_(payload.collabId, '共同主催者'), '共同主催者');
  if (rec.event_id !== eventId) throw appError_('NOT_FOUND', '共同主催者が見つかりません。');
  assertRev_(rec, requireRev_(payload.rev), '共同主催者');
  if (collabActive_(rec)) throw appError_('VALIDATION', 'この共同主催者は既に有効です。');
  var email = collabEmailOf_(rec);
  var claim = pickClaim_(linkJson_(rec.link_json), payload.ref, email);
  if (claim.sub === ownerSubOf_(event)) throw appError_('VALIDATION', 'この大会の主催者本人です。');
  bindItem_(ctx, { kind: 'collaborator', event: event, rec: rec }, claim.sub, email, 'approved');
  return { eventId: eventId };
}
