/**
 * Sky Storage — подтверждение новых подключений к УПРАВЛЕНИЮ хранилищем.
 *
 * Подключение = пара «профиль + устройство» (идентификатор устройства X-Sky-Device, хешируется вместе с профилем).
 * Первое обращение с нового устройства к управлению хранилищем создаёт запрос подтверждения; до решения доступа к
 * защищённым данным нет. Смена IP сама по себе подозрением не считается — только новое устройство.
 *   1. запись о попытке (профиль, сессия, устройство, время, оценка риска, сокращённые ua/ip);
 *   2. уведомление владельцу в приложении и push; если ответа нет — письмо на подтверждённую почту владельца;
 *   3. ссылка в письме: одноразовый токен (в базе только его хеш), срок ограничен, привязан к запросу; её открытие ничего
 *      не решает (GET отдаёт статичную страницу) — решение принимается явным действием на странице с кодом
 *      подтверждения личности владельца (аутентификатор или код с почты);
 *   4. нет ответа за таймаут (10 мин по умолчанию) → запрос «просрочен», сессия этой попытки отзывается,
 *      доступа нет, событие в журнале и уведомление. Молчание — не согласие.
 * Запись в письмо секретов/ключей не попадает.
 *
 * Режимы (settings.approvalScope):
 *   every_login — КАЖДЫЙ вход в управление хранилищем (каждая новая сессия, в том числе владельца и на знакомом устройстве) ждёт
 *                 подтверждения владельца, как вход по SSH: письмо уходит сразу, подтверждение — ссылка + код аутентификатора,
 *                 действует approvalValidMin минут и только для этой сессии. Действия самого сервера (чтение/запись медиа, резервные копии,
 *                 фоновые задачи) этим шлюзом не проходят — он стоит только на управлении;
 *   admin       — только новое устройство (прежнее поведение);  off — не требовать.
 * Сессию попытки отзываем при отказе/просрочке только если устройство было новым: владельца с известного устройства из-за
 * неподтверждённого входа в хранилище не выбрасывает из всего приложения (ему просто закрыто хранилище).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { sessionStore } from './sessions.mjs';
import { sendEmail } from './notify.mjs';
import { beginStepUp, consumeStepUp, logAdmin } from './adminsec.mjs';
import { isOwner } from './admin.mjs';
import { snapshot, logEvent, ownerIds, notifyOwners, newId, effective } from './skystoragestate.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const STEP_PURPOSE = 'storage_connection';

export const deviceHashOf = (profileId, req) => {
  const dev = String(req.headers['x-sky-device'] ?? '');
  const base = /^[A-Za-z0-9_-]{16,64}$/.test(dev) ? dev : `ua:${String(req.headers['user-agent'] ?? '').slice(0, 120)}`;
  return sha(`${profileId}|${base}`).slice(0, 40);
};

const shortUa = (ua) => String(ua ?? '').replace(/\s+/g, ' ').slice(0, 120);
const ipClass = (ip) => { const s = String(ip ?? ''); return s.includes(':') ? `${s.split(':').slice(0, 3).join(':')}::/48` : s.split('.').slice(0, 3).join('.') + '.0/24'; };

/** Попытка с нового устройства (в причинах есть «новое устройство») — только такую сессию отзываем при отказе/просрочке. */
const newDevice = (r) => (r.risk_reasons ?? []).some((x) => String(x).includes('новое устройство'));

const view = (r) => ({ id: r.id, profileId: r.profile_id, status: r.status, risk: r.risk, reasons: r.risk_reasons, info: r.info, createdAt: r.created_at, expiresAt: r.expires_at, decidedAt: r.decided_at, decidedVia: r.decided_via });

/**
 * Оценка и постановка запроса. Возвращает { allowed:true } либо { allowed:false, pending:{id,expiresAt} | status }.
 * Не создаёт запрос, если политика отключена (approvalScope = off).
 */
export const evaluateConnection = async (profileId, req, sessionId) => {
  const st = snapshot();
  const set = st?.settings;
  if (set?.approvalScope === 'off') return { allowed: true, policy: 'off' };
  const strict = set?.approvalScope === 'every_login';
  const dev = deviceHashOf(profileId, req);
  const { rows } = await query(`SELECT * FROM storage_connections WHERE profile_id = $1 AND device_hash = $2 AND status IN ('pending','approved') ORDER BY created_at DESC LIMIT 1`, [profileId, dev]);
  let cur = rows[0];
  if (cur?.status === 'approved') {
    if (!strict) {
      if (sessionId && cur.session_id !== sessionId) await query('UPDATE storage_connections SET session_id = $2 WHERE id = $1', [cur.id, sessionId]);
      return { allowed: true };
    }
    // Каждый вход: подтверждение относится к этой сессии и живёт ограниченное время. Другая сессия / срок вышел — нужен новый запрос.
    const validMin = Math.max(5, Number(set?.approvalValidMin) || 480);
    const fresh = Date.now() - new Date(cur.decided_at).getTime() < validMin * 60000;
    if (sessionId && cur.session_id === sessionId && fresh) return { allowed: true };
    await query(`UPDATE storage_connections SET status = 'expired', decided_via = 'superseded' WHERE id = $1 AND status = 'approved'`, [cur.id]);
    cur = null;
  }
  if (cur?.status === 'pending') {
    if (new Date(cur.expires_at) < new Date()) { await expireOne(cur); return { allowed: false, status: 'expired' }; }
    if (strict && sessionId && cur.session_id !== sessionId) await query('UPDATE storage_connections SET session_id = $2 WHERE id = $1', [cur.id, sessionId]);
    return { allowed: false, status: 'pending', pending: { id: cur.id, expiresAt: cur.expires_at } };
  }
  if (!effective(st).connections) return { allowed: false, status: 'blocked' };
  // Первое подключение владельца, когда подтверждённых нет вовсе — начальная настройка (записывается в журнал). При «каждом входе» не применяется.
  const { rows: any } = await query(`SELECT 1 FROM storage_connections WHERE status = 'approved' LIMIT 1`);
  if (!strict && !any.length && (await isOwner(profileId))) {
    await query(`INSERT INTO storage_connections (id, profile_id, device_hash, session_id, status, risk, risk_reasons, info, expires_at, decided_at, decided_by, decided_via)
      VALUES ($1,$2,$3,$4,'approved',0,'["первое подключение владельца"]'::jsonb,$5::jsonb, now(), now(), $2, 'bootstrap')`,
      [newId('cn'), profileId, dev, sessionId ?? null, JSON.stringify({ ua: shortUa(req.headers['user-agent']), net: ipClass(req.socket?.remoteAddress) })]);
    await logEvent('connection_bootstrap', 'warn', { profileId }, profileId);
    return { allowed: true, bootstrap: true };
  }
  const { rows: known } = await query(`SELECT 1 FROM storage_connections WHERE profile_id = $1 AND device_hash = $2 AND (status = 'approved' OR (status = 'expired' AND decided_via = 'superseded')) LIMIT 1`, [profileId, dev]);
  const reasons = strict ? [known.length ? 'вход в управление (каждый вход подтверждается)' : 'новое устройство; каждый вход подтверждается'] : ['новое устройство'];
  const { rows: prev } = await query(`SELECT info FROM storage_connections WHERE profile_id = $1 AND status = 'approved' ORDER BY decided_at DESC LIMIT 1`, [profileId]);
  const net = ipClass(req.headers['x-real-ip'] ?? req.socket?.remoteAddress);
  if (prev[0]?.info?.net && prev[0].info.net !== net) reasons.push('другая сеть');
  if (!prev.length) reasons.push('нет ранее подтверждённых устройств');
  const risk = reasons.length;
  if (!strict && risk < (set?.approvalRiskThreshold ?? 1)) return { allowed: true };
  if (strict && !known.length) reasons.push('новое устройство');
  const id = newId('cn');
  const minutes = Math.max(1, Number(set?.approvalTimeoutMin) || 10);
  const info = { ua: shortUa(req.headers['user-agent']), net };
  try {
    await query(`INSERT INTO storage_connections (id, profile_id, device_hash, session_id, status, risk, risk_reasons, info, expires_at) VALUES ($1,$2,$3,$4,'pending',$5,$6::jsonb,$7::jsonb, now() + ($8 || ' minutes')::interval)`,
      [id, profileId, dev, sessionId ?? null, risk, JSON.stringify(reasons), JSON.stringify(info), String(minutes)]);
  } catch (e) { if (e.code === '23505') return { allowed: false, status: 'pending' }; throw e; }
  await logEvent('connection_request', 'warn', { id, profileId, risk, reasons, info }, profileId);
  await notifyOwners(`conn:${id}`, 'Новое подключение к Sky Storage', `Запрос на доступ к управлению хранилищем с нового устройства (${info.ua.slice(0, 60) || 'неизвестно'}). Подтвердите или отклоните в течение ${minutes} мин.`, { critical: false });
  const { rows: ex } = await query('SELECT * FROM storage_connections WHERE id = $1', [id]);
  if (strict) await mailOne(ex[0]).catch((e) => console.error('[storage] письмо:', e.message));   // как при входе по SSH — письмо сразу
  return { allowed: false, status: 'pending', pending: { id, expiresAt: ex[0].expires_at } };
};

/* ─── Решение ──────────────────────────────────────────────────────── */

const decideRow = async (r, approve, by, via) => {
  const { rowCount } = await query(
    `UPDATE storage_connections SET status = $2, decided_at = now(), decided_by = $3, decided_via = $4, token_used_at = CASE WHEN $5 THEN now() ELSE token_used_at END
      WHERE id = $1 AND status = 'pending' AND expires_at > now()`, [r.id, approve ? 'approved' : 'denied', by, via, via === 'email']);
  if (!rowCount) return false;
  if (!approve && r.session_id && newDevice(r)) await sessionStore.revoke(r.session_id).catch(() => {});   // отказ: сессия этой попытки отзывается (если устройство было новым)
  await logEvent(approve ? 'connection_approved' : 'connection_denied', approve ? 'info' : 'warn', { id: r.id, profileId: r.profile_id, via }, by);
  return true;
};

/** Решение из панели (владелец, повторная проверка личности — consume выполняет вызывающий). */
export const decideInPanel = async (actorId, id, approve, meta) => {
  const { rows } = await query(`SELECT * FROM storage_connections WHERE id = $1`, [String(id).slice(0, 60)]);
  const r = rows[0]; if (!r) return { error: 'not_found' };
  if (r.status !== 'pending') return { error: 'not_pending' };
  if (!(await decideRow(r, approve, actorId, 'panel'))) return { error: 'expired' };
  await logAdmin({ actorId, targetId: r.profile_id, targetType: 'storage', type: approve ? 'storage_conn_approve' : 'storage_conn_deny', detail: `Подключение ${id}`, meta });
  return { ok: true };
};

export const revokeConnection = async (actorId, id, meta) => {
  const { rows } = await query(`UPDATE storage_connections SET status = 'revoked', decided_at = now(), decided_by = $2, decided_via = 'panel' WHERE id = $1 AND status = 'approved' RETURNING *`, [String(id).slice(0, 60), actorId]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].session_id) await sessionStore.revoke(rows[0].session_id).catch(() => {});
  await logAdmin({ actorId, targetId: rows[0].profile_id, targetType: 'storage', type: 'storage_conn_revoke', detail: `Подключение ${id} отозвано`, meta });
  return { ok: true };
};

/* ─── Письмо и страница подтверждения ──────────────────────────────── */

const origin = () => config.publicOrigin || '';

/** Письмо владельцу о запросе без ответа. Токен создаётся здесь (в базе — только хеш) и существует только в письме. */
const mailOne = async (r) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const { rowCount } = await query(`UPDATE storage_connections SET token_hash = $2, mailed_at = now() WHERE id = $1 AND status = 'pending' AND mailed_at IS NULL`, [r.id, sha(token)]);
  if (!rowCount) return false;
  const link = `${origin()}/storage-verify?t=${token}`;
  const owners = await query(`SELECT s.email, s.email_verified FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = ANY($1::text[])`, [await ownerIds()]);
  const mins = Math.max(1, Math.round((new Date(r.expires_at) - Date.now()) / 60000));
  for (const o of owners.rows) {
    if (!o.email || !o.email_verified) continue;
    await sendEmail(o.email, 'Sky Storage: вход в управление ждёт подтверждения',
      `Кто-то входит в управление Sky Storage (S3-хранилище, резервные копии, доступ).\n\nВремя: ${new Date(r.created_at).toLocaleString('ru-RU')}\nУстройство: ${r.info?.ua ?? 'неизвестно'}\nСеть: ${r.info?.net ?? 'неизвестно'}\nПочему проверка: ${(r.risk_reasons ?? []).join(', ')}\n\n` +
      `Если это вы — откройте страницу и подтвердите. Если нет — отклоните: доступа этому устройству не будет. Молчание считается отказом: через ${mins} мин. запрос закроется сам.\n\n${link}\n\n` +
      'Ссылка одноразовая. Само открытие ссылки ничего не подтверждает — решение вы принимаете на странице, с кодом подтверждения личности. В письме нет паролей и ключей шифрования; Sky никогда их не просит.').catch((e) => console.error('[storage] письмо:', e.message));
  }
  await logEvent('connection_mailed', 'info', { id: r.id });
  return true;
};

const lookupByToken = async (token) => {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(token ?? ''))) return null;
  const { rows } = await query(`SELECT * FROM storage_connections WHERE token_hash = $1`, [sha(token)]);
  return rows[0] ?? null;
};

/** Шаг 1 страницы: сведения о запросе и отправка кода владельцу. Решения не принимает. */
export const lookupForPage = async (token, meta) => {
  const r = await lookupByToken(token);
  if (!r) return { error: 'invalid' };
  if (r.token_used_at || r.status !== 'pending') return { error: r.status === 'pending' ? 'used' : r.status };
  if (new Date(r.expires_at) < new Date()) { await expireOne(r); return { error: 'expired' }; }
  const ow = (await ownerIds())[0];
  if (!ow) return { error: 'no_owner' };
  const step = await beginStepUp(ow, STEP_PURPOSE, { meta });
  if (step.error) return { error: step.error };
  return { request: { when: r.created_at, ua: r.info?.ua, net: r.info?.net, reasons: r.risk_reasons, expiresAt: r.expires_at }, method: step.method };
};

/** Шаг 2: явное решение с кодом подтверждения личности владельца. */
export const decideByToken = async (token, approve, code, meta) => {
  const r = await lookupByToken(token);
  if (!r) return { error: 'invalid' };
  if (r.token_used_at || r.status !== 'pending') return { error: r.status === 'pending' ? 'used' : r.status };
  if (new Date(r.expires_at) < new Date()) { await expireOne(r); return { error: 'expired' }; }
  const ow = (await ownerIds())[0];
  const step = await consumeStepUp(ow, STEP_PURPOSE, code, { meta });
  if (step.error) return { error: step.error };
  if (!(await decideRow(r, approve === true, ow, 'email'))) return { error: 'used' };
  return { ok: true, status: approve ? 'approved' : 'denied' };
};

/* ─── Просрочка и рассылка (вызывается фоновой задачей) ────────────── */

const expireOne = async (r) => {
  const { rowCount } = await query(`UPDATE storage_connections SET status = 'expired', decided_at = now(), decided_via = 'timeout' WHERE id = $1 AND status = 'pending'`, [r.id]);
  if (!rowCount) return;
  if (r.session_id && newDevice(r)) await sessionStore.revoke(r.session_id).catch(() => {});       // временные разрешения этой попытки
  await logEvent('connection_expired', 'warn', { id: r.id, profileId: r.profile_id });
  await notifyOwners(`conn_exp:${r.id}`, 'Подключение к Sky Storage не подтверждено', 'Запрос на подключение не был подтверждён вовремя. Доступ не выдан, сессия этой попытки закрыта.', { critical: true });
};

export const sweepConnections = async () => {
  const { rows } = await query(`SELECT * FROM storage_connections WHERE status = 'pending'`);
  let expired = 0; let mailed = 0;
  const timeout = Math.max(1, Number(snapshot()?.settings.approvalTimeoutMin) || 10);
  const strict = snapshot()?.settings.approvalScope === 'every_login';
  for (const r of rows) {
    if (new Date(r.expires_at) <= new Date()) { await expireOne(r); expired += 1; continue; }
    const waited = (Date.now() - new Date(r.created_at).getTime()) / 60000;
    if (!r.mailed_at && (strict || waited >= Math.max(1, Math.floor(timeout / 3)))) { if (await mailOne(r)) mailed += 1; }
  }
  return { expired, mailed };
};

export const listConnections = async (limit = 100) => {
  const { rows } = await query(`SELECT c.*, p.username FROM storage_connections c LEFT JOIN profiles p ON p.id = c.profile_id ORDER BY c.created_at DESC LIMIT $1`, [limit]);
  return rows.map((r) => ({ ...view(r), username: r.username }));
};
