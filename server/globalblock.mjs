/**
 * Глобальная блокировка: по Sky ID, устройству, адресу, почте и номеру — и на ВСЕ связанные Sky ID.
 *
 *  • Что считается связью: общее устройство (заголовок X-Sky-Device, в базе только HMAC), общая подтверждённая почта или номер,
 *    а при явном выборе администратора — общий IP-адрес (грубо: может задеть общий Wi-Fi/оператора, по умолчанию выключено).
 *  • Блокировка пишется в `sky_ids.blocked_until/blocked_reason = 'global:<группа>'` — это уже работающий механизм (HTTP отвечает
 *    403 account_blocked, сокет закрывается 4403), поэтому все существующие сессии закрываются без нового кода в каждом модуле.
 *    Новые входы с блокированного признака отсекаются в startSession (423 globally_blocked), а Sky ID, зашедший с блокированного
 *    устройства, сам становится частью группы.
 *  • Владелец (и Sky ID с его профилем) не блокируется никогда. Администраторы не блокируются «по связи» — только прямым выбором владельца.
 *  • Обжалование: человек без входа подаёт его по подписанному токену (выдаётся в ответе об отказе, 24 ч). Решает другой сотрудник
 *    (не тот, кто блокировал); принятая апелляция снимает блокировку только с этого Sky ID (запись в global_block_exempt).
 *  • Любое действие — в журнал администрации, критичные операции — с кодом подтверждения личности (`global_block`).
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { sessionStore } from './sessions.mjs';

export const STEP_PURPOSE = 'global_block';
const FOREVER = '2100-01-01T00:00:00Z';
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const KINDS = ['skyid', 'device', 'ip', 'email', 'phone'];
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const newId = (p) => `${p}-${crypto.randomBytes(9).toString('hex')}`;
const hmac = (kind, value) => crypto.createHmac('sha256', `${config.jwtSecret}:global-block:v1:${kind}`).update(String(value)).digest('hex');

const normPhone = (p) => String(p ?? '').replace(/\D/g, '');
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
export const deviceRaw = (req) => { const v = String(req?.headers?.['x-sky-device'] ?? ''); return ID_RE.test(v) ? v : null; };
const ipV = (ip) => { const s = String(ip ?? ''); if (!s || s === 'unknown') return null; return s.includes(':') ? s.split(':').slice(0, 4).join(':') : s; };   // IPv6 — по /64

const maskOf = (kind, value) => {
  const v = String(value);
  if (kind === 'email') { const [a, d] = v.split('@'); return `${a.slice(0, 1)}***@${d ?? ''}`; }
  if (kind === 'phone') return `+…${v.slice(-4)}`;
  if (kind === 'ip') return v.includes(':') ? `${v}::/64` : `${v.split('.').slice(0, 3).join('.')}.0/24`;
  if (kind === 'device') return `устройство …${hmac('device', v).slice(-6)}`;
  return `Sky ID …${v.slice(-6)}`;
};

/* ─── Токен обжалования (человек не вошёл, сессии у него нет) ─── */
const b64 = (b) => Buffer.from(b).toString('base64url');
export const signAppeal = (skyId, groupId) => {
  const payload = b64(`${skyId}|${groupId}|${Date.now() + 24 * 3600_000}`);
  return `${payload}.${crypto.createHmac('sha256', `${config.jwtSecret}:gblock-appeal:v1`).update(payload).digest('base64url')}`;
};
export const readAppealToken = (token) => {
  const [p, sig] = String(token ?? '').split('.');
  if (!p || !sig) return null;
  const want = crypto.createHmac('sha256', `${config.jwtSecret}:gblock-appeal:v1`).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [skyId, groupId, exp] = Buffer.from(p, 'base64url').toString().split('|');
  if (!skyId || !groupId || Number(exp) < Date.now()) return null;
  return { skyId, groupId };
};

/* ─── Запись «что видел Sky ID» и проверка при входе ─── */
const ownerInside = async (skyId) => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return false;
  return (await query('SELECT 1 FROM profiles WHERE sky_id = $1 AND lower(username) = $2', [skyId, name])).rowCount > 0;
};
const adminInside = async (skyId) => (await query('SELECT 1 FROM profiles WHERE sky_id = $1 AND is_admin', [skyId])).rowCount > 0;

export const recordSeen = async (skyId, req, ip) => {
  const dev = deviceRaw(req); const ipv = ipV(ip);
  if (dev) await query(`INSERT INTO sky_seen_ids (sky_id, kind, value_hash) VALUES ($1,'device',$2) ON CONFLICT (sky_id, kind, value_hash) DO UPDATE SET last_seen = now()`, [skyId, hmac('device', dev)]);
  if (ipv) await query(`INSERT INTO sky_seen_ids (sky_id, kind, value_hash) VALUES ($1,'ip',$2) ON CONFLICT (sky_id, kind, value_hash) DO UPDATE SET last_seen = now()`, [skyId, hmac('ip', ipv)]);
};

const activeMatch = async (skyRow, req, ip) => {
  const dev = deviceRaw(req); const ipv = ipV(ip);
  const { rows } = await query(
    `SELECT b.* FROM global_blocks b
      WHERE b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at > now())
        AND ((b.kind = 'skyid' AND b.value_hash = $1) OR (b.kind = 'device' AND b.value_hash = $2) OR (b.kind = 'ip' AND b.value_hash = $3)
          OR (b.kind = 'email' AND b.value_hash = $4) OR (b.kind = 'phone' AND b.value_hash = $5))
        AND NOT EXISTS (SELECT 1 FROM global_block_exempt e WHERE e.sky_id = $6 AND e.group_id = b.group_id)
      ORDER BY b.created_at LIMIT 1`,
    [hmac('skyid', skyRow.id), dev ? hmac('device', dev) : 'none', ipv ? hmac('ip', ipv) : 'none',
      skyRow.email && skyRow.email_verified ? hmac('email', normEmail(skyRow.email)) : 'none', skyRow.phone ? hmac('phone', normPhone(skyRow.phone)) : 'none', skyRow.id]);
  return rows[0] ?? null;
};

const blockSky = async (c, skyId, groupId, until) => {
  await c.query(`UPDATE sky_ids SET blocked_until = $2, blocked_reason = $3, blocked_by = NULL, blocked_at = now() WHERE id = $1`, [skyId, until ?? FOREVER, `global:${groupId}`]);
};

/** Для startSession: если вход идёт с блокированного признака — отказ (423) и Sky ID входит в группу. */
export const assertNotGloballyBlocked = async (skyRow, req, ip) => {
  if (await ownerInside(skyRow.id)) return;
  const m = await activeMatch(skyRow, req, ip);
  if (!m) { await recordSeen(skyRow.id, req, ip).catch(() => {}); return; }
  if (m.kind !== 'skyid' && await adminInside(skyRow.id)) return;     // администратора «по связи» не блокируем
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO global_blocks (id, group_id, kind, value_hash, label, origin_sky_id, reason, public_reason, created_by, expires_at)
                   VALUES ($1,$2,'skyid',$3,$4,$5,$6,$7,NULL,$8) ON CONFLICT DO NOTHING`,
      [newId('gb'), m.group_id, hmac('skyid', skyRow.id), maskOf('skyid', skyRow.id), m.origin_sky_id, `Связан с заблокированным признаком (${m.kind})`, m.public_reason, m.expires_at]);
    await blockSky(c, skyRow.id, m.group_id, m.expires_at);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  await sessionStore.revokeAllForUser(skyRow.id).catch(() => {});
  throw Object.assign(new Error('globally_blocked'), {
    status: 423, code: 'globally_blocked', publicReason: m.public_reason || '', since: m.created_at.toISOString(),
    until: m.expires_at ? m.expires_at.toISOString() : null, appealToken: signAppeal(skyRow.id, m.group_id),
  });
};

/** Для ответов HTTP: «account_blocked» с пометкой глобальной блокировки и токеном обжалования. */
export const blockedBody = (skyId, until, reason) => {
  const g = String(reason ?? '').startsWith('global:') ? String(reason).slice(7) : null;
  const body = { error: 'account_blocked', until: until.toISOString() };
  if (g) { body.global = true; body.appealToken = signAppeal(skyId, g); }
  return body;
};

/* ─── Человек: статус и обжалование (без входа, по токену) ─── */
export const appealInfo = async (token) => {
  const t = readAppealToken(token); if (!t) return { error: 'bad_token' };
  const { rows: [b] } = await query(`SELECT public_reason, created_at, expires_at, revoked_at FROM global_blocks WHERE group_id = $1 AND kind = 'skyid' AND value_hash = $2 ORDER BY created_at DESC LIMIT 1`, [t.groupId, hmac('skyid', t.skyId)]);
  const { rows: [a] } = await query('SELECT status, decision, message, created_at, decided_at FROM global_block_appeals WHERE sky_id = $1 ORDER BY created_at DESC LIMIT 1', [t.skyId]);
  return {
    block: b ? { reason: b.public_reason, since: b.created_at.toISOString(), until: b.expires_at?.toISOString() ?? null, active: !b.revoked_at } : null,
    appeal: a ? { status: a.status, decision: a.decision, message: a.message, createdAt: a.created_at.toISOString(), decidedAt: a.decided_at?.toISOString() ?? null } : null,
  };
};

export const submitAppeal = async (token, input) => {
  const t = readAppealToken(token); if (!t) return { error: 'bad_token' };
  const message = clip(input?.message, 2000); const contact = clip(input?.contact, 200);
  if (message.length < 20) return { error: 'message_too_short', min: 20 };
  const { rows: [s] } = await query('SELECT blocked_until, blocked_reason FROM sky_ids WHERE id = $1', [t.skyId]);
  if (!s || !String(s.blocked_reason).startsWith('global:') || !(s.blocked_until > new Date())) return { error: 'not_blocked' };
  const { rows: [cnt] } = await query(`SELECT COUNT(*)::int c FROM global_block_appeals WHERE sky_id = $1 AND created_at > now() - interval '30 days'`, [t.skyId]);
  if (cnt.c >= 3) return { error: 'appeal_limit' };
  const id = newId('gba');
  const ins = await query(`INSERT INTO global_block_appeals (id, group_id, sky_id, message, contact) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [id, t.groupId, t.skyId, message, contact]);
  if (!ins.rowCount) return { error: 'appeal_pending' };
  try { const { notifyStaff } = await import('./staffnotify.mjs'); void notifyStaff('gblock_appeal', { title: 'Апелляция на глобальную блокировку', body: 'Новая апелляция ждёт решения.', dedupe: id }); } catch { /* не мешает */ }
  return { ok: true, id };
};

/* ─── Админка ─── */
const adm = async () => ({ ...(await import('./admin.mjs')), ...(await import('./adminsec.mjs')) });
const allowed = async (actor) => { const { can } = await adm(); return can(actor, 'global_block'); };

export const stepUp = async (actor, meta) => { if (!(await allowed(actor))) return { error: 'not_allowed' }; const { beginStepUp } = await adm(); return beginStepUp(actor, STEP_PURPOSE, { meta }); };

const resolveTarget = async (raw) => {
  const t = clip(raw, 80); if (!t) return null;
  const [sql, arg] = t.startsWith('@') ? ['SELECT sky_id, id, username FROM profiles WHERE lower(username) = $1 LIMIT 1', t.slice(1).toLowerCase()]
    : t.startsWith('sky-') ? ['SELECT sky_id, id, username FROM profiles WHERE sky_id = $1 LIMIT 1', t] : ['SELECT sky_id, id, username FROM profiles WHERE id = $1 OR lower(username) = lower($1) LIMIT 1', t];
  const { rows: [p] } = await query(sql, [arg]);
  if (p) return p.sky_id;
  return t.startsWith('sky-') && (await query('SELECT 1 FROM sky_ids WHERE id = $1', [t])).rowCount ? t : null;
};

const accountsOf = async (skyIds) => {
  if (!skyIds.length) return [];
  const { rows } = await query(`SELECT s.id AS sky_id, s.blocked_until, p.id AS profile_id, p.username FROM sky_ids s LEFT JOIN profiles p ON p.sky_id = s.id AND p.deleted_at IS NULL WHERE s.id = ANY($1) ORDER BY s.id`, [skyIds]);
  const by = new Map();
  for (const r of rows) { const a = by.get(r.sky_id) ?? { skyId: r.sky_id, profiles: [] }; if (r.profile_id) a.profiles.push({ id: r.profile_id, username: r.username }); by.set(r.sky_id, a); }
  return [...by.values()];
};

export const createBlock = async (actor, input, meta = {}) => {
  const A = await adm();
  if (!(await A.can(actor, 'global_block'))) return { error: 'not_allowed' };
  const reason = clip(input?.reason, 500); if (reason.length < 5) return { error: 'reason_required' };
  if (input?.confirm !== true) return { error: 'confirm_required' };
  const skyId = await resolveTarget(input?.target); if (!skyId) return { error: 'not_found' };
  if (await ownerInside(skyId)) return { error: 'owner_protected' };
  const step = await A.consumeStepUp(actor, STEP_PURPOSE, input?.code, { meta }); if (step?.error) return step;

  const days = input?.days == null || Number(input.days) === 0 ? null : Math.floor(Number(input.days));
  if (days !== null && (!(days >= 1) || days > 3650)) return { error: 'bad_days' };
  const until = days === null ? null : new Date(Date.now() + days * 86_400_000);
  const scope = { devices: input?.scope?.devices !== false, ips: input?.scope?.ips === true, contacts: input?.scope?.contacts !== false };
  const publicReason = clip(input?.publicReason, 300);
  const groupId = newId('gbg');

  const { rows: [sky] } = await query('SELECT id, email, email_verified, phone FROM sky_ids WHERE id = $1', [skyId]);
  const ids = [{ kind: 'skyid', value: skyId, hash: hmac('skyid', skyId) }];
  if (scope.devices) for (const r of (await query(`SELECT value_hash FROM sky_seen_ids WHERE sky_id = $1 AND kind = 'device' ORDER BY last_seen DESC LIMIT 50`, [skyId])).rows) ids.push({ kind: 'device', hash: r.value_hash, label: `устройство …${r.value_hash.slice(-6)}` });
  if (scope.ips) for (const r of (await query(`SELECT value_hash FROM sky_seen_ids WHERE sky_id = $1 AND kind = 'ip' ORDER BY last_seen DESC LIMIT 20`, [skyId])).rows) ids.push({ kind: 'ip', hash: r.value_hash, label: `адрес …${r.value_hash.slice(-6)}` });
  if (scope.contacts) {
    if (sky.email && sky.email_verified) ids.push({ kind: 'email', value: normEmail(sky.email), hash: hmac('email', normEmail(sky.email)) });
    if (sky.phone) ids.push({ kind: 'phone', value: normPhone(sky.phone), hash: hmac('phone', normPhone(sky.phone)) });
  }

  const c = await pool.connect(); const affected = new Set([skyId]); const via = new Map([[skyId, 'прямая цель']]);
  try {
    await c.query('BEGIN');
    for (const x of ids) {
      await c.query(`INSERT INTO global_blocks (id, group_id, kind, value_hash, label, origin_sky_id, reason, public_reason, created_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [newId('gb'), groupId, x.kind, x.hash, x.label ?? maskOf(x.kind, x.value ?? skyId), skyId, reason, publicReason, actor, until]);
    }
    // связанные Sky ID: делят устройство/адрес, подтверждённую почту или номер
    const dh = ids.filter((x) => x.kind === 'device').map((x) => x.hash); const ih = ids.filter((x) => x.kind === 'ip').map((x) => x.hash);
    const found = [];
    if (dh.length) found.push(...(await c.query(`SELECT DISTINCT sky_id, 'устройство' AS via FROM sky_seen_ids WHERE kind = 'device' AND value_hash = ANY($1)`, [dh])).rows);
    if (ih.length) found.push(...(await c.query(`SELECT DISTINCT sky_id, 'адрес' AS via FROM sky_seen_ids WHERE kind = 'ip' AND value_hash = ANY($1)`, [ih])).rows);
    if (scope.contacts && sky.email && sky.email_verified) found.push(...(await c.query(`SELECT id AS sky_id, 'почта' AS via FROM sky_ids WHERE email_verified AND lower(email) = $1`, [normEmail(sky.email)])).rows);
    if (scope.contacts && sky.phone) found.push(...(await c.query(`SELECT id AS sky_id, 'номер' AS via FROM sky_ids WHERE regexp_replace(phone, '\\D', '', 'g') = $1`, [normPhone(sky.phone)])).rows);
    for (const f of found) {
      if (affected.has(f.sky_id)) continue;
      if (await ownerInside(f.sky_id) || await adminInside(f.sky_id)) continue;          // связь не блокирует владельца и администраторов
      affected.add(f.sky_id); via.set(f.sky_id, f.via);
      await c.query(`INSERT INTO global_blocks (id, group_id, kind, value_hash, label, origin_sky_id, reason, public_reason, created_by, expires_at) VALUES ($1,$2,'skyid',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [newId('gb'), groupId, hmac('skyid', f.sky_id), maskOf('skyid', f.sky_id), skyId, `${reason} (связь: ${f.via})`, publicReason, actor, until]);
    }
    for (const id of affected) await blockSky(c, id, groupId, until);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[gblock]', e.message); return { error: 'failed' }; } finally { c.release(); }

  for (const id of affected) await sessionStore.revokeAllForUser(id).catch(() => {});
  await A.logAdmin({ actorId: actor, targetId: groupId, targetType: 'global_block', type: 'global_block_create', detail: `Sky ID ${[...affected].length}: ${reason.slice(0, 120)}`, meta });
  return { ok: true, groupId, accounts: (await accountsOf([...affected])).map((a) => ({ ...a, via: via.get(a.skyId) })) };
};

export const listBlocks = async (actor, { status = 'active', q = '' } = {}) => {
  if (!(await allowed(actor))) return null;
  const like = `%${clip(q, 60).toLowerCase()}%`;
  const { rows } = await query(
    `SELECT g.group_id, MIN(g.created_at) AS created_at, MAX(g.created_at) AS last_at, (array_agg(g.reason ORDER BY g.created_at))[1] AS reason, (array_agg(g.public_reason ORDER BY g.created_at))[1] AS public_reason,
            (array_agg(g.created_by ORDER BY g.created_at))[1] AS created_by, (array_agg(g.origin_sky_id ORDER BY g.created_at))[1] AS origin,
            MAX(g.expires_at) AS expires_at, BOOL_AND(g.revoked_at IS NOT NULL) AS revoked, COUNT(*) FILTER (WHERE g.kind = 'skyid')::int AS accounts,
            (SELECT COUNT(*)::int FROM global_block_appeals a WHERE a.group_id = g.group_id AND a.status = 'pending') AS appeals
       FROM global_blocks g
      WHERE ($1 = 'all' OR ($1 = 'active' AND g.revoked_at IS NULL) OR ($1 = 'revoked' AND g.revoked_at IS NOT NULL))
        AND ($2 = '%%' OR EXISTS (SELECT 1 FROM profiles p WHERE p.sky_id = g.origin_sky_id AND (lower(p.username) LIKE $2 OR p.id LIKE $2)) OR lower(g.reason) LIKE $2 OR g.group_id LIKE $2)
      GROUP BY g.group_id ORDER BY MIN(g.created_at) DESC LIMIT 100`, [status, like]);
  const names = await accountsOf([...new Set(rows.map((r) => r.origin).filter(Boolean))]);
  const nm = new Map(names.map((a) => [a.skyId, a.profiles.map((p) => `@${p.username}`).join(', ')]));
  return { blocks: rows.map((r) => ({ groupId: r.group_id, createdAt: r.created_at.toISOString(), reason: r.reason, publicReason: r.public_reason, createdBy: r.created_by, origin: nm.get(r.origin) || r.origin,
    expiresAt: r.expires_at?.toISOString() ?? null, revoked: r.revoked, accounts: r.accounts, pendingAppeals: r.appeals })) };
};

export const blockDetail = async (actor, groupId) => {
  if (!(await allowed(actor))) return null;
  const { rows } = await query('SELECT kind, label, origin_sky_id, revoked_at, revoke_reason FROM global_blocks WHERE group_id = $1 ORDER BY created_at', [clip(groupId, 60)]);
  if (!rows.length) return { error: 'not_found' };
  const { rows: sk } = await query(`SELECT value_hash FROM global_blocks WHERE group_id = $1 AND kind = 'skyid'`, [groupId]);
  const { rows: skys } = await query(`SELECT s.id FROM sky_ids s WHERE s.blocked_reason = $1`, [`global:${groupId}`]);
  return { identifiers: rows.filter((r) => r.kind !== 'skyid').map((r) => ({ kind: r.kind, label: r.label })), accounts: await accountsOf(skys.map((s) => s.id)), skyIdBlocks: sk.length, revokedAt: rows[0].revoked_at?.toISOString() ?? null, revokeReason: rows[0].revoke_reason };
};

export const revokeBlock = async (actor, groupId, input, meta = {}) => {
  const A = await adm();
  if (!(await A.can(actor, 'global_block'))) return { error: 'not_allowed' };
  const reason = clip(input?.reason, 500); if (reason.length < 5) return { error: 'reason_required' };
  const step = await A.consumeStepUp(actor, STEP_PURPOSE, input?.code, { meta }); if (step?.error) return step;
  const g = clip(groupId, 60);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(`UPDATE global_blocks SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE group_id = $1 AND revoked_at IS NULL`, [g, actor, reason]);
    if (!r.rowCount) { await c.query('ROLLBACK'); return { error: 'not_found' }; }
    await c.query(`UPDATE sky_ids SET blocked_until = NULL, blocked_reason = '', blocked_at = NULL WHERE blocked_reason = $1`, [`global:${g}`]);
    await c.query(`UPDATE global_block_appeals SET status = 'accepted', decision = 'Блокировка снята администрацией.', decided_by = $2, decided_at = now() WHERE group_id = $1 AND status = 'pending'`, [g, actor]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[gblock]', e.message); return { error: 'failed' }; } finally { c.release(); }
  await A.logAdmin({ actorId: actor, targetId: g, targetType: 'global_block', type: 'global_block_revoke', detail: reason.slice(0, 160), meta });
  return { ok: true };
};

export const listAppeals = async (actor, status = 'pending') => {
  if (!(await allowed(actor))) return null;
  const { rows } = await query(`SELECT a.*, (SELECT created_by FROM global_blocks b WHERE b.group_id = a.group_id ORDER BY b.created_at LIMIT 1) AS blocked_by FROM global_block_appeals a WHERE ($1 = 'all' OR a.status = $1) ORDER BY a.created_at DESC LIMIT 100`, [status]);
  const acc = new Map((await accountsOf([...new Set(rows.map((r) => r.sky_id))])).map((a) => [a.skyId, a.profiles.map((p) => `@${p.username}`).join(', ')]));
  return { appeals: rows.map((r) => ({ id: r.id, groupId: r.group_id, account: acc.get(r.sky_id) || r.sky_id, message: r.message, contact: r.contact, status: r.status, decision: r.decision, createdAt: r.created_at.toISOString(), blockedBy: r.blocked_by })) };
};

export const decideAppeal = async (actor, id, input, meta = {}) => {
  const A = await adm();
  if (!(await A.can(actor, 'global_block'))) return { error: 'not_allowed' };
  const accept = input?.decision === 'accept'; if (!accept && input?.decision !== 'reject') return { error: 'bad_decision' };
  const text = clip(input?.reason, 600); if (text.length < 5) return { error: 'reason_required' };
  const step = await A.consumeStepUp(actor, STEP_PURPOSE, input?.code, { meta }); if (step?.error) return step;
  const { rows: [ap] } = await query("SELECT * FROM global_block_appeals WHERE id = $1 AND status = 'pending'", [clip(id, 60)]);
  if (!ap) return { error: 'not_found' };
  const { rows: [bl] } = await query('SELECT created_by FROM global_blocks WHERE group_id = $1 ORDER BY created_at LIMIT 1', [ap.group_id]);
  if (bl?.created_by === actor && !(await A.isOwner(actor))) return { error: 'self_review' };          // решает не тот, кто блокировал
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const up = await c.query(`UPDATE global_block_appeals SET status = $2, decision = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND status = 'pending'`, [ap.id, accept ? 'accepted' : 'rejected', text, actor]);
    if (!up.rowCount) { await c.query('ROLLBACK'); return { error: 'not_found' }; }
    if (accept) {
      const { rows: [sky] } = await c.query('SELECT id, email, email_verified, phone FROM sky_ids WHERE id = $1', [ap.sky_id]);
      const seen = (await c.query('SELECT kind, value_hash FROM sky_seen_ids WHERE sky_id = $1', [ap.sky_id])).rows;
      const hs = { skyid: [hmac('skyid', ap.sky_id)], email: sky?.email && sky.email_verified ? [hmac('email', normEmail(sky.email))] : [], phone: sky?.phone ? [hmac('phone', normPhone(sky.phone))] : [],
        device: seen.filter((s) => s.kind === 'device').map((s) => s.value_hash), ip: seen.filter((s) => s.kind === 'ip').map((s) => s.value_hash) };
      const groups = new Set([ap.group_id]);
      for (const k of KINDS) if (hs[k].length) for (const r of (await c.query('SELECT DISTINCT group_id FROM global_blocks WHERE revoked_at IS NULL AND kind = $1 AND value_hash = ANY($2)', [k, hs[k]])).rows) groups.add(r.group_id);
      for (const g of groups) await c.query('INSERT INTO global_block_exempt (sky_id, group_id, appeal_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [ap.sky_id, g, ap.id]);
      await c.query(`UPDATE global_blocks SET revoked_at = now(), revoked_by = $2, revoke_reason = $3 WHERE kind = 'skyid' AND value_hash = $1 AND revoked_at IS NULL`, [hmac('skyid', ap.sky_id), actor, 'Апелляция принята']);
      await c.query(`UPDATE sky_ids SET blocked_until = NULL, blocked_reason = '', blocked_at = NULL WHERE id = $1 AND blocked_reason LIKE 'global:%'`, [ap.sky_id]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[gblock]', e.message); return { error: 'failed' }; } finally { c.release(); }
  await A.logAdmin({ actorId: actor, targetId: ap.id, targetType: 'global_block_appeal', type: accept ? 'global_block_appeal_accept' : 'global_block_appeal_reject', detail: text.slice(0, 160), meta });
  try {   // человек не может войти и увидеть уведомления — пишем на подтверждённую почту, если она есть
    const { rows: [s] } = await query('SELECT email, email_verified FROM sky_ids WHERE id = $1', [ap.sky_id]);
    if (s?.email && s.email_verified) { const { sendEmail } = await import('./notify.mjs'); const { L } = await import('./lang.mjs');
      await sendEmail(s.email, L('Sky: ответ на апелляцию', 'Sky: appeal decision'), `${accept ? L('Блокировка снята.', 'Your block was lifted.') : L('Апелляция отклонена.', 'Your appeal was rejected.')}\n\n${text}`); }
  } catch { /* письмо не обязательно */ }
  return { ok: true };
};
