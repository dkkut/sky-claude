/**
 * Ограниченный доступ на неподтверждённом устройстве (настройка Sky ID).
 *
 * Включено → сессия, начатая на устройстве, которого нет среди доверенных (sky_trusted_devices), «ограничена»: чтение разрешено,
 * любые изменения и вся переписка (сокет мессенджера, файлы, голосовые комнаты) закрыты, пока вход не подтверждён:
 *   • с доверенного устройства (открытая НЕограниченная сессия того же Sky ID): уведомление + ползунок на Sky Island → /decide;
 *   • «доступ утерян»: код на подтверждённую резервную почту (она же обязательное условие самой настройки).
 * Решение принимает сервер по сессии; жест на экране — лишь отправка. После подтверждения устройство становится доверенным.
 * Входы по коду на таком аккаунте сами устройство доверенным НЕ делают (иначе ограничение ничего бы не значило).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { sessionStore } from './sessions.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { L } from './lang.mjs';
import { usableBackupEmail } from './recoverymail.mjs';
import { attempt, record, notifyAccount, maskEmail } from './recoverycore.mjs';
import { pushGoEvent } from './signal.mjs';
import { logEvent as skyLog } from './skylog.mjs';

const TTL_MS = 24 * 3600_000;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const err = (error, extra = {}) => ({ error, ...extra });
const hashOf = (id) => crypto.createHmac('sha256', `${config.jwtSecret}:trusted-device:v1`).update(id).digest('hex');
const deviceHash = (req) => { const v = String(req?.headers?.['x-sky-device'] ?? ''); return ID_RE.test(v) ? hashOf(v) : null; };
const newId = () => crypto.randomBytes(12).toString('hex');
const profilesOf = async (skyId) => (await query('SELECT id FROM profiles WHERE sky_id = $1 AND deleted_at IS NULL', [skyId])).rows.map((r) => r.id);

export const isEnabled = async (skyId) => Boolean((await query('SELECT limit_untrusted AS on FROM sky_ids WHERE id = $1', [skyId])).rows[0]?.on);
const isTrusted = async (skyId, hash) => Boolean(hash) && (await query('SELECT 1 FROM sky_trusted_devices WHERE sky_id = $1 AND device_hash = $2', [skyId, hash])).rowCount > 0;

const trustHash = async (skyId, hash, label) => {
  if (!hash) return;
  await query(`INSERT INTO sky_trusted_devices (sky_id, device_hash, label) VALUES ($1,$2,$3)
    ON CONFLICT (sky_id, device_hash) DO UPDATE SET last_seen = now()`, [skyId, hash, label]);
};

const tellDevices = async (skyId, msg) => { try { pushGoEvent(await profilesOf(skyId), msg); } catch { /* сокет необязателен */ } };

/**
 * Вызывается из startSession ПОСЛЕ создания сессии. Возвращает true, если сессия ограничена (тогда вызывающий не делает устройство доверенным).
 */
export const onLogin = async (skyId, sid, req, meta) => {
  if (!(await isEnabled(skyId))) return false;
  const hash = deviceHash(req);
  if (await isTrusted(skyId, hash)) { await query('UPDATE sky_trusted_devices SET last_seen = now() WHERE sky_id = $1 AND device_hash = $2', [skyId, hash]); return false; }
  await sessionStore.patch(sid, { limited: true });
  const id = newId();
  const label = String(meta?.ua ?? '').slice(0, 160);
  await query(`INSERT INTO device_approvals (id, sky_id, sid, device_hash, label, ip, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, skyId, sid, hash, label, String(meta?.ip ?? ''), new Date(Date.now() + TTL_MS)]);
  await record({ skyId, event: 'limited_login', factor: 'device', result: 'pending', ip: meta?.ip }).catch(() => {});
  skyLog({ category: 'security', service: 'limited', type: 'limited_login', targetId: skyId, ip: meta?.ip, detail: { approval: id } });
  // Основная почта + запись в «Уведомлениях» (оттуда уходит push). Ссылок нет: подтверждение — только в приложении, с доверенного устройства.
  notifyAccount(skyId, {
    title: L('Подтвердите вход с нового устройства', 'Confirm sign-in from a new device'),
    text: L('В ваш Sky ID выполнен вход с устройства, которое вы ещё не подтверждали. Пока вход не подтверждён, доступ там ограничен: только просмотр, чаты закрыты. Откройте Sky на доверенном устройстве и передвиньте ползунок вправо, чтобы разрешить вход. Если это не вы — завершите чужую сессию в Профиль → Sky ID → Устройства.',
      'Your Sky ID was signed in from a device you have not confirmed yet. Until you confirm, access there is limited: view only, chats are closed. Open Sky on a trusted device and slide to confirm. If this was not you, end the unknown session in Profile → Sky ID → Devices.'),
    both: false, refId: id,
  }).catch(() => {});
  await tellDevices(skyId, { type: 'limited:pending', payload: { id } });
  return true;
};

const expireOld = () => query(`UPDATE device_approvals SET status = 'expired', decided_at = now() WHERE status = 'pending' AND expires_at < now()`);

const pendingFor = async (skyId) => {
  await expireOld();
  const { rows } = await query(`SELECT id, label, ip, created_at, expires_at FROM device_approvals WHERE sky_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 10`, [skyId]);
  return rows.map((r) => ({ id: r.id, label: r.label, ip: r.ip, createdAt: r.created_at.toISOString(), expiresAt: r.expires_at.toISOString() }));
};

/** Сводка для НЕограниченной сессии: настройка, условия, ожидающие входы. */
export const settings = async (skyId) => {
  const enabled = await isEnabled(skyId);
  const email = await usableBackupEmail(skyId);
  return { enabled, canEnable: Boolean(email), backupEmail: email ? maskEmail(email) : null, pending: await pendingFor(skyId) };
};

export const setEnabled = async (skyId, on, req) => {
  if (on) {
    if (!(await usableBackupEmail(skyId))) return err('backup_email_required');
    // Текущее устройство становится доверенным, иначе человек запер бы сам себя.
    await trustHash(skyId, deviceHash(req), String(req?.headers?.['user-agent'] ?? '').slice(0, 160));
  }
  await query('UPDATE sky_ids SET limit_untrusted = $2 WHERE id = $1', [skyId, Boolean(on)]);
  await record({ skyId, event: on ? 'limited_enabled' : 'limited_disabled', factor: 'session', result: 'ok' }).catch(() => {});
  notifyAccount(skyId, {
    title: on ? L('Включён ограниченный доступ на новых устройствах', 'Limited access on new devices enabled') : L('Ограниченный доступ на новых устройствах выключен', 'Limited access on new devices disabled'),
    text: on ? L('Вход с неподтверждённого устройства теперь даёт только просмотр, пока вы не подтвердите его.', 'Signing in from an unconfirmed device now gives view-only access until you confirm it.')
      : L('Вход с новых устройств больше не ограничивается.', 'Sign-ins from new devices are no longer limited.'),
  }).catch(() => {});
  return { ok: true, enabled: Boolean(on) };
};

const lift = async (row, via) => {
  await sessionStore.patch(row.sid, { limited: false });
  await trustHash(row.sky_id, row.device_hash, row.label);
  await query(`UPDATE device_approvals SET status = 'approved', decided_via = $2, decided_at = now() WHERE id = $1`, [row.id, via]);
  await record({ skyId: row.sky_id, event: 'limited_approved', factor: via, result: 'ok' }).catch(() => {});
  skyLog({ category: 'security', service: 'limited', type: 'limited_approved', targetId: row.sky_id, detail: { approval: row.id, via } });
};

/** Решение с доверенного устройства (НЕограниченная сессия). */
export const decide = async (skyId, id, approve) => {
  await expireOld();
  const { rows } = await query(`SELECT * FROM device_approvals WHERE id = $1 AND sky_id = $2`, [String(id ?? ''), skyId]);
  const row = rows[0];
  if (!row) return err('not_found');
  if (row.status !== 'pending') return err('already_decided', { status: row.status });
  if (approve) { await lift(row, 'device'); return { ok: true, status: 'approved' }; }
  await query(`UPDATE device_approvals SET status = 'denied', decided_via = 'denied', decided_at = now() WHERE id = $1`, [row.id]);
  await sessionStore.revoke(row.sid);
  await record({ skyId, event: 'limited_denied', factor: 'device', result: 'denied' }).catch(() => {});
  return { ok: true, status: 'denied' };
};

/** Состояние ограниченной сессии (для неё самой): разрешили ли, отказали ли, есть ли резервная почта. */
export const statusFor = async (skyId, sid) => {
  await expireOld();
  const stored = await sessionStore.get(sid);
  if (!stored) return err('session_ended');
  const { rows } = await query('SELECT status FROM device_approvals WHERE sid = $1', [sid]);
  const email = await usableBackupEmail(skyId);
  return { limited: Boolean(stored.limited), status: rows[0]?.status ?? null, canUseBackupEmail: Boolean(email), backupEmail: email ? maskEmail(email) : null };
};

/** «Доступ утерян»: код на подтверждённую резервную почту. Ответ не раскрывает лишнего. */
export const lostStart = async (skyId, sid, ip) => {
  const stored = await sessionStore.get(sid);
  if (!stored?.limited) return err('not_limited');
  if (!(await attempt(`lim:start:${sid}`, 3, 3600)) || !(await attempt(`lim:start:sky:${skyId}`, 6, 3600))) return err('too_many_requests');
  const to = await usableBackupEmail(skyId);
  if (!to) return err('no_backup_email');
  const c = await issueCode('email', to, `limited:${sid}`);
  if (c.error === 'too_soon') return err('too_soon', { retryAfter: c.retryAfter });
  await record({ skyId, event: 'limited_lost_code', factor: 'backup_email', result: c.error ? 'error' : 'ok', ip }).catch(() => {});
  return { ok: true, sentTo: maskEmail(to) };
};

export const lostFinish = async (skyId, sid, code, ip) => {
  const stored = await sessionStore.get(sid);
  if (!stored?.limited) return err('not_limited');
  if (!(await attempt(`lim:fin:${sid}`, 6, 3600))) return err('too_many_requests');
  const to = await usableBackupEmail(skyId);
  if (!to) return err('no_backup_email');
  const v = await verifyCode('email', to, `limited:${sid}`, String(code ?? '').replace(/\s+/g, ''));
  if (v.error) { await record({ skyId, event: 'limited_lost_failed', factor: 'backup_email', result: 'denied', ip, level: 'WARN' }).catch(() => {}); return err('invalid_code'); }
  const { rows } = await query(`SELECT * FROM device_approvals WHERE sid = $1`, [sid]);
  if (!rows[0]) return err('not_found');
  await lift(rows[0], 'backup_email');
  notifyAccount(skyId, {
    title: L('Вход подтверждён через резервную почту', 'Sign-in confirmed via backup email'),
    text: L('Новое устройство получило полный доступ после подтверждения кодом на резервную почту. Если это были не вы — завершите чужую сессию в Профиль → Sky ID → Устройства.', 'A new device got full access after a code sent to the backup email. If this was not you, end the unknown session in Profile → Sky ID → Devices.'),
  }).catch(() => {});
  return { ok: true };
};

/** Что ограниченной сессии можно: чтение без чатов/файлов/комнат + вход, выход, этот модуль и выбор профиля. */
const BLOCKED_READ = /^\/api\/(files|voiceparty|calls?|chats?|messages?|attachments?)(\/|$)/;
const ALLOWED_WRITE = /^\/api\/(auth\/(logout|refresh|session)$|skyid\/limited(\/|$)|skyid\/profiles\/[\w.-]+\/select$)/;
export const limitedBlocks = (method, url) => {
  const read = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  if (ALLOWED_WRITE.test(url)) return false;
  if (read) return BLOCKED_READ.test(url);
  return true;
};

export const sweepLimited = async () => { await expireOld(); };
