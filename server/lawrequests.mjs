/**
 * Запросы уполномоченных органов: учёт обращения и выгрузка сведений о человеке.
 *
 *  • Только владелец сервиса (`isOwner`). Запрос заводится с номером дела, органом и правовым основанием; выгрузка — с кодом
 *    подтверждения личности (`law_export`), каждое действие пишется в журнал администрации. Автоматического и массового сбора нет.
 *  • В выгрузку попадает лишь то, что Sky уже хранит: учётная запись, подтверждённые контакты, активные сессии, устройства, журнал входов,
 *    кошелёк, заказы, обращения в поддержку, блокировки. Содержимое сообщений и файлов НЕ выдаётся; раздел `notStored` прямо перечисляет,
 *    чего у Sky нет (полный IP из истории, IP за VPN, аппаратные идентификаторы) — выдумывать такое нельзя.
 *  • Каждый раздел собирается отдельно: сбой одного не роняет остальные, а в файле виден как `error`.
 *  • Файл получает SHA-256; в базе остаются реквизиты запроса и контрольная сумма, но не сам файл.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { sessionStore } from './sessions.mjs';

export const STEP_PURPOSE = 'law_export';
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const newId = (p) => `${p}-${crypto.randomBytes(9).toString('hex')}`;
const adm = async () => ({ ...(await import('./admin.mjs')), ...(await import('./adminsec.mjs')) });
const asDate = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };

const gate = async (actor) => { const A = await adm(); return (await A.isOwner(actor)) ? A : null; };

export const stepUp = async (actor, meta) => {
  const A = await gate(actor); if (!A) return { error: 'not_allowed' };
  return A.beginStepUp(actor, STEP_PURPOSE, { meta });
};

const resolveSubject = async (raw) => {
  const t = clip(raw, 80); if (!t) return null;
  const [sql, arg] = t.startsWith('@') ? ['SELECT id, sky_id, username FROM profiles WHERE lower(username) = $1 LIMIT 1', t.slice(1).toLowerCase()]
    : t.startsWith('sky-') ? ['SELECT id, sky_id, username FROM profiles WHERE sky_id = $1 LIMIT 1', t]
      : ['SELECT id, sky_id, username FROM profiles WHERE id = $1 OR lower(username) = lower($1) LIMIT 1', t];
  const { rows: [p] } = await query(sql, [arg]);
  if (p) return { skyId: p.sky_id, profileId: p.id };
  if (t.startsWith('sky-') && (await query('SELECT 1 FROM sky_ids WHERE id = $1', [t])).rowCount) return { skyId: t, profileId: null };
  return null;
};

export const createRequest = async (actor, input, meta = {}) => {
  const A = await gate(actor); if (!A) return { error: 'not_allowed' };
  const caseNo = clip(input?.caseNo, 120); const authority = clip(input?.authority, 200); const basis = clip(input?.legalBasis, 600);
  if (caseNo.length < 3) return { error: 'case_no_required' };
  if (authority.length < 3) return { error: 'authority_required' };
  if (basis.length < 10) return { error: 'legal_basis_required' };
  const from = asDate(input?.periodFrom); const to = asDate(input?.periodTo);
  if (from === undefined || to === undefined || (from && to && from > to)) return { error: 'bad_period' };
  const subj = await resolveSubject(input?.target); if (!subj) return { error: 'not_found' };
  const id = newId('law');
  await query(`INSERT INTO law_requests (id, case_no, authority, legal_basis, subject_sky_id, subject_profile_id, period_from, period_to, note, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, caseNo, authority, basis, subj.skyId, subj.profileId, from, to, clip(input?.note, 500), actor]);
  await A.logAdmin({ actorId: actor, targetId: id, targetType: 'law_request', type: 'law_request_create', detail: `${caseNo} · ${authority}`.slice(0, 200), meta });
  return { ok: true, id };
};

export const listRequests = async (actor, { status = '' } = {}) => {
  if (!(await gate(actor))) return null;
  const { rows } = await query(
    `SELECT r.id, r.case_no, r.authority, r.legal_basis, r.status, r.created_at, r.closed_at, r.closed_reason, r.period_from, r.period_to, r.note,
            r.subject_sky_id, p.username,
            (SELECT count(*)::int FROM law_exports e WHERE e.request_id = r.id) AS exports,
            (SELECT max(created_at) FROM law_exports e WHERE e.request_id = r.id) AS last_export
       FROM law_requests r LEFT JOIN profiles p ON p.id = r.subject_profile_id
      WHERE ($1 = '' OR r.status = $1) ORDER BY r.created_at DESC LIMIT 200`, [clip(status, 20)]);
  return { requests: rows.map((r) => ({ id: r.id, caseNo: r.case_no, authority: r.authority, legalBasis: r.legal_basis, status: r.status, createdAt: r.created_at, closedAt: r.closed_at,
    closedReason: r.closed_reason, periodFrom: r.period_from, periodTo: r.period_to, note: r.note, skyId: r.subject_sky_id, username: r.username, exports: r.exports, lastExport: r.last_export })) };
};

export const closeRequest = async (actor, id, input, meta = {}) => {
  const A = await gate(actor); if (!A) return { error: 'not_allowed' };
  const reason = clip(input?.reason, 300); if (reason.length < 5) return { error: 'reason_required' };
  const rejected = input?.rejected === true;
  const r = await query(`UPDATE law_requests SET status = $2, closed_at = now(), closed_reason = $3 WHERE id = $1 AND status IN ('open','exported') RETURNING id`, [id, rejected ? 'rejected' : 'closed', reason]);
  if (!r.rowCount) return { error: 'not_found' };
  await A.logAdmin({ actorId: actor, targetId: id, targetType: 'law_request', type: rejected ? 'law_request_reject' : 'law_request_close', detail: reason.slice(0, 160), meta });
  return { ok: true };
};

const safe = async (fn) => { try { const v = await fn(); return Array.isArray(v) ? { count: v.length, rows: v } : v; } catch (e) { return { error: 'section_failed', detail: String(e.message ?? e).slice(0, 120) }; } };
const inPeriod = (col) => `(${col} >= COALESCE($2::timestamptz, '-infinity') AND ${col} <= COALESCE($3::timestamptz, 'infinity'))`;

/** Собрать досье. Содержимое сообщений и файлов не включается. */
const collect = async (req) => {
  const sky = req.subject_sky_id; const pids = (await query('SELECT id FROM profiles WHERE sky_id = $1', [sky])).rows.map((r) => r.id);
  const pf = req.period_from; const pt = req.period_to;
  const S = {};
  S.account = await safe(async () => (await query(`SELECT id, phone, email, email_verified, two_factor_enabled, created_at, blocked_until, blocked_reason FROM sky_ids WHERE id = $1`, [sky])).rows[0] ?? null);
  S.profiles = await safe(async () => (await query(`SELECT id, username, created_at, deleted_at, banned_until, muted_until, moderation_note, region_code FROM profiles WHERE sky_id = $1 ORDER BY created_at`, [sky])).rows);
  S.activeSessions = await safe(async () => (await sessionStore.listForUser(sky)).map((s) => ({ id: String(s.id ?? '').slice(-8), ip: s.ip ?? null, userAgent: s.ua ?? s.userAgent ?? null, label: s.label ?? null, via: s.via ?? null, createdAt: s.createdAt ?? null, lastSeenAt: s.lastSeenAt ?? null })));
  S.trustedDevices = await safe(async () => (await query(`SELECT right(device_hash, 8) AS device_fp, label, first_seen, last_seen FROM sky_trusted_devices WHERE sky_id = $1 ORDER BY last_seen DESC LIMIT 200`, [sky])).rows);
  S.seenFingerprints = await safe(async () => (await query(`SELECT kind, right(value_hash, 8) AS fp, first_seen, last_seen FROM sky_seen_ids WHERE sky_id = $1 AND ${inPeriod('last_seen')} ORDER BY last_seen DESC LIMIT 500`, [sky, pf, pt])).rows);
  S.loginEvents = await safe(async () => (await query(`SELECT at, type, result, reason, device, ip_hash FROM sky_events WHERE (actor_id = ANY($1) OR target_id = $4) AND type IN ('login','login_code_failed','login_2fa_failed','login_passkey_failed','logout') AND ${inPeriod('at')} ORDER BY at DESC LIMIT 1000`, [pids, pf, pt, sky])).rows);
  S.contactChanges = await safe(async () => (await query(`SELECT kind, old_masked, new_masked, ip, created_at FROM contact_change_log WHERE sky_id = $1 AND ${inPeriod('created_at')} ORDER BY created_at DESC LIMIT 200`, [sky, pf, pt])).rows);
  S.globalBlocks = await safe(async () => (await query(`SELECT kind, label, reason, created_at, expires_at, revoked_at FROM global_blocks WHERE origin_sky_id = $1 OR (kind = 'skyid' AND label LIKE '%' || right($1, 6)) ORDER BY created_at DESC LIMIT 100`, [sky])).rows);
  S.wallet = await safe(async () => {
    if (!pids.length) return { accounts: [], transactions: [] };
    const acc = (await query(`SELECT user_id, balance, points FROM wallet_accounts WHERE user_id = ANY($1)`, [pids])).rows;
    const tx = (await query(`SELECT id, user_id, type, amount, currency, descr, ref, created_at FROM wallet_transactions WHERE user_id = ANY($1) AND ${inPeriod('created_at')} ORDER BY created_at DESC LIMIT 2000`, [pids, pf, pt])).rows;
    return { accounts: acc, transactions: tx };
  });
  S.marketOrders = await safe(async () => (await query(`SELECT id, buyer_id, seller_id, status, total_kop, quantity, created_at FROM market_orders WHERE (buyer_id = ANY($1) OR seller_id = ANY($1)) AND ${inPeriod('created_at')} ORDER BY created_at DESC LIMIT 500`, [pids, pf, pt])).rows);
  S.supportTickets = await safe(async () => (await query(`SELECT id, kind, status, created_at FROM support_tickets WHERE author_id = ANY($1) AND ${inPeriod('created_at')} ORDER BY created_at DESC LIMIT 200`, [pids, pf, pt])).rows);
  return S;
};

const NOT_STORED = [
  'Полный IP-адрес из истории входов: в журналах хранится укрупнённая сеть (/24, IPv6 /48) и HMAC-отпечаток; точный адрес есть только у ещё живых сессий (раздел activeSessions).',
  'Настоящий IP за VPN/прокси: сервер видит только адрес, с которого пришло соединение; способа узнать другой адрес без скрытых приёмов Sky не использует.',
  'Аппаратные идентификаторы (IMEI, серийные номера, SIM): приложение их не собирает; устройство опознаётся случайным идентификатором из хранилища браузера, который человек может стереть.',
  'Содержимое сообщений, звонков и файлов: в выгрузку не включается.',
  'Геолокация по адресу: сервис не подключён.',
];

export const exportRequest = async (actor, id, input, meta = {}) => {
  const A = await gate(actor); if (!A) return { error: 'not_allowed' };
  if (input?.confirm !== true) return { error: 'confirm_required' };
  const { rows: [req] } = await query(`SELECT * FROM law_requests WHERE id = $1`, [clip(id, 40)]);
  if (!req) return { error: 'not_found' };
  if (req.status === 'closed' || req.status === 'rejected') return { error: 'request_closed' };
  const step = await A.consumeStepUp(actor, STEP_PURPOSE, input?.code, { meta }); if (step?.error) return step;

  const sections = await collect(req);
  const dossier = {
    format: 'sky-law-export/1',
    generatedAt: new Date().toISOString(),
    request: { id: req.id, caseNo: req.case_no, authority: req.authority, legalBasis: req.legal_basis, period: { from: req.period_from, to: req.period_to } },
    subject: { skyId: req.subject_sky_id },
    notStored: NOT_STORED,
    sections,
  };
  const body = JSON.stringify(dossier, null, 2);
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const counts = Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v?.error ? 'error' : Array.isArray(v) ? v.length : v?.count ?? 1]));
  await query(`INSERT INTO law_exports (id, request_id, actor_id, sha256, bytes, sections) VALUES ($1,$2,$3,$4,$5,$6)`, [newId('lex'), req.id, actor, sha256, Buffer.byteLength(body), JSON.stringify(counts)]);
  await query(`UPDATE law_requests SET status = 'exported' WHERE id = $1 AND status = 'open'`, [req.id]);
  await A.logAdmin({ actorId: actor, targetId: req.id, targetType: 'law_request', type: 'law_request_export', detail: `${req.case_no} · sha256 ${sha256.slice(0, 16)} · ${Buffer.byteLength(body)} байт`, meta });
  return { ok: true, sha256, bytes: Buffer.byteLength(body), body, filename: `sky-law-${req.id}.json` };
};
