/**
 * Публичные сценарии восстановления доступа (recovery.skymessenger.online): пользователь, администратор, владелец.
 *
 * Модель: запрос (`recovery_requests`) накапливает доказанные ФАКТОРЫ — email (код на подтверждённую резервную почту),
 * totp (код приложения), backup_code (резервный код), admin_token (токен восстановления администратора), owner_secret.
 * Итог решают правила `evaluate`, а не клиент:
 *   user   — email + (totp | резервный код) → сразу; email один → после ожидания (RECOVERY_EMAIL_WAIT_HOURS, 24 ч) с отменой
 *            по ссылке из писем; totp/резервный код без почты → можно только заменить резервную почту (аккаунт не открывается);
 *   admin  — токен + (totp | резервный код), а без аутентификатора — токен + email; токен один не даёт ничего;
 *   owner  — секрет владельца + любой из (email | totp | резервный код), затем обязательное ожидание
 *            (OWNER_RECOVERY_WAIT_HOURS, 12 ч) со ссылкой «отменить» во всех каналах.
 * Права, роли, баланс, Prime и подписки восстановление НЕ трогает; на выходе — обычная сессия (`startSession`), все прежние отозваны.
 * Ответы не раскрывают, есть ли аккаунт и какой фактор не подошёл.
 */
import { query } from './db.mjs';
import { findSkyIdById, findSkyIdByEmail, findSkyIdByPhone, verifySkyTwoFactor } from './skyid.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { consumeBackupCode, looksLikeBackupCode } from './accountrecovery.mjs';
import { sessionStore } from './sessions.mjs';
import { hashPassword, verifyPassword } from './security.mjs';
import { isOwnerRaw } from './admin.mjs';
import { L } from './lang.mjs';
import { newId, randomSecret, hashSecret, safeEqual, attempt, record, notifyAccount, recoveryOrigin, appOrigin, maskEmail, stamp, ipHash } from './recoverycore.mjs';
import { usableBackupEmail } from './recoverymail.mjs';
import { verifyAdminToken, verifyOwnerSecret, afterAdminRecovery, ownerSecretState } from './recoveryadmin.mjs';

const REQ_TTL_MS = 60 * 60_000;                   // запрос живёт час; ожидание — отдельный срок
const hours = (name, def) => Math.max(0, Number(process.env[name] ?? def));
const emailWaitMs = () => (process.env.RECOVERY_EMAIL_WAIT_SEC !== undefined ? Number(process.env.RECOVERY_EMAIL_WAIT_SEC) * 1000 : hours('RECOVERY_EMAIL_WAIT_HOURS', 24) * 3600_000);
const ownerWaitMs = () => (process.env.RECOVERY_OWNER_WAIT_SEC !== undefined ? Number(process.env.RECOVERY_OWNER_WAIT_SEC) * 1000 : hours('OWNER_RECOVERY_WAIT_HOURS', 12) * 3600_000);
const err = (error, extra = {}) => ({ error, ...extra });
const NEUTRAL = { message: 'Если аккаунт существует и данные указаны верно, мы предложим доступные способы восстановления.' };
const METHODS = {
  user: ['email', 'totp', 'backup_code'],
  admin: ['admin_token', 'email', 'totp', 'backup_code'],
  owner: ['owner_secret', 'email', 'totp', 'backup_code'],
};

/** Найти аккаунт по тому, что человек помнит: почта, телефон, @ник или идентификатор Sky ID. */
const resolve = async (identifier) => {
  const v = String(identifier ?? '').trim();
  if (!v || v.length > 200) return null;
  if (v.includes('@') && !v.startsWith('@')) return findSkyIdByEmail(v.toLowerCase());
  if (/^\+?[\d\s()-]{7,20}$/.test(v)) return findSkyIdByPhone(v.replace(/[\s()-]/g, '').replace(/^8/, '+7').replace(/^(\d)/, '+$1'));
  if (/^sky-[a-z0-9-]{8,}$/i.test(v)) return findSkyIdById(v);
  const name = v.replace(/^@/, '').toLowerCase();
  const { rows } = await query('SELECT sky_id FROM profiles WHERE lower(username) = $1 AND deleted_at IS NULL LIMIT 1', [name]);
  return rows[0] ? findSkyIdById(rows[0].sky_id) : null;
};

export const accountClass = async (skyId) => {
  const { rows } = await query('SELECT id, is_admin FROM profiles WHERE sky_id = $1 AND deleted_at IS NULL', [skyId]);
  let owner = false;
  for (const r of rows) if (await isOwnerRaw(r.id)) owner = true;
  return { owner, admin: rows.some((r) => r.is_admin) && !owner, profiles: rows.map((r) => r.id) };
};

const loadReq = async (id, secret) => {
  if (typeof id !== 'string' || typeof secret !== 'string') return null;
  const { rows } = await query('SELECT * FROM recovery_requests WHERE id = $1', [id]);
  const r = rows[0];
  if (!r || !safeEqual(r.secret_hash, hashSecret('reqsecret', secret))) return null;
  if (r.expires_at < new Date() && !['waiting', 'ready'].includes(r.status)) return null;
  return r;
};

/* ─── Старт ─────────────────────────────────────────────────────────── */

export const start = async ({ identifier, kind, ip, ua }) => {
  const k = ['user', 'admin', 'owner'].includes(kind) ? kind : 'user';
  const h = ipHash(ip);
  if (!(await attempt(`start:ip:${h}`, 12, 3600)) || !(await attempt(`start:id:${String(identifier ?? '').toLowerCase().slice(0, 80)}`, 6, 3600))) return err('too_many_requests');
  const row = await resolve(identifier);
  const id = newId('rcv'); const secret = randomSecret(24);
  // Запрос заводится и для несуществующего аккаунта (sky_id пуст) — ответ и время одинаковы.
  await query(`INSERT INTO recovery_requests (id, secret_hash, sky_id, kind, ip_hash, device, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, hashSecret('reqsecret', secret), row?.id ?? null, k, h, String(ua ?? '').slice(0, 160), new Date(Date.now() + REQ_TTL_MS)]);
  if (row) await record({ skyId: row.id, requestId: id, kind: k, event: 'started', ip });
  if (row && await attempt(`startnote:${row.id}`, 1, 600)) {
    await notifyAccount(row.id, { title: L('Запрос восстановления доступа', 'Access recovery requested'), text: L(`${stamp()}: кто-то начал восстановление доступа к вашему Sky ID. Если это вы — продолжайте на сайте восстановления. Если нет — ничего делать не нужно: без ваших факторов доступ не откроется.`, `${stamp()}: someone started access recovery for your Sky ID. If it was you, continue on the recovery site. If not, do nothing — access will not open without your factors.`) });
  }
  return { requestId: id, secret, methods: METHODS[k], ...NEUTRAL };
};

/* ─── Факторы ───────────────────────────────────────────────────────── */

/** Код на резервную почту. Ответ одинаков, ушло письмо или нет. */
export const sendEmailCode = async ({ requestId, secret, ip }) => {
  const r = await loadReq(requestId, secret); if (!r) return err('invalid_request');
  if (!(await attempt(`mail:req:${r.id}`, 4, 3600)) || !(await attempt(`mail:ip:${ipHash(ip)}`, 20, 3600))) return err('too_many_requests');
  if (r.sky_id) {
    const to = await usableBackupEmail(r.sky_id);
    if (to) {
      const c = await issueCode('email', to, `recovery:${r.id}`);
      await record({ skyId: r.sky_id, requestId: r.id, kind: r.kind, event: 'email_code_sent', factor: 'email', result: c.error ? 'error' : 'ok', ip });
    } else await record({ skyId: r.sky_id, requestId: r.id, kind: r.kind, event: 'email_code_unavailable', factor: 'email', result: 'denied', ip });
  }
  return { ok: true, message: 'Если на аккаунте есть подтверждённая резервная почта, мы отправили на неё код.' };
};

const addFactor = async (r, factor) => {
  await query(`UPDATE recovery_requests SET factors = (SELECT to_jsonb(array(SELECT DISTINCT e FROM jsonb_array_elements_text(factors || to_jsonb($2::text)) e))) WHERE id = $1`, [r.id, factor]);
};
const fail = async (r, factor, ip) => {
  await query('UPDATE recovery_requests SET fails = fails + 1, risk = risk + 1 WHERE id = $1', [r.id]);
  if (r.sky_id) await record({ skyId: r.sky_id, requestId: r.id, kind: r.kind, event: 'factor_failed', factor, result: 'denied', ip, level: 'WARN' });
  const { rows } = await query('SELECT fails FROM recovery_requests WHERE id = $1', [r.id]);
  if ((rows[0]?.fails ?? 0) >= 10) {
    await query(`UPDATE recovery_requests SET status = 'blocked' WHERE id = $1`, [r.id]);
    if (r.sky_id) await notifyAccount(r.sky_id, { title: L('Подозрительные попытки восстановления', 'Suspicious recovery attempts'), text: L('На запрос восстановления доступа к вашему Sky ID введено много неверных значений. Запрос заблокирован. Если это были не вы — смените пароль и завершите чужие сессии.', 'Many wrong values were entered for a recovery request on your Sky ID. The request is blocked. If it was not you, change your password and end unknown sessions.') });
  }
  return err('verification_failed');
};

/** Проверить один фактор. Одинаковый отказ на любую причину. */
export const verifyFactor = async ({ requestId, secret, factor, value, ip }) => {
  const r = await loadReq(requestId, secret); if (!r) return err('invalid_request');
  if (r.status === 'blocked') return err('verification_failed');
  if (!METHODS[r.kind].includes(factor)) return err('verification_failed');
  if (!(await attempt(`verify:req:${r.id}`, 12, 3600)) || !(await attempt(`verify:ip:${ipHash(ip)}`, 60, 3600))
    || (r.sky_id && !(await attempt(`verify:sky:${r.sky_id}`, 30, 3600)))) return err('too_many_requests');
  if (!r.sky_id) { await new Promise((x) => setTimeout(x, 150)); return err('verification_failed'); }
  const v = String(value ?? '').trim();
  let ok = false;
  if (factor === 'email') {
    const to = await usableBackupEmail(r.sky_id);
    ok = Boolean(to) && !(await verifyCode('email', to, `recovery:${r.id}`, v)).error;
  } else if (factor === 'totp') {
    if (!/^\d{6}$/.test(v)) return fail(r, factor, ip);
    const row = await findSkyIdById(r.sky_id);
    ok = Boolean(row?.two_factor_enabled) && !(await verifySkyTwoFactor(r.sky_id, v))?.error;
  } else if (factor === 'backup_code') {
    ok = looksLikeBackupCode(v) && !(await consumeBackupCode(r.sky_id, v)).error;
  } else if (factor === 'admin_token') {
    ok = r.kind === 'admin' && await verifyAdminToken(r.sky_id, v);
  } else if (factor === 'owner_secret') {
    ok = r.kind === 'owner' && await verifyOwnerSecret(r.sky_id, v);
  }
  if (!ok) return fail(r, factor, ip);
  await addFactor(r, factor);
  await record({ skyId: r.sky_id, requestId: r.id, kind: r.kind, event: 'factor_ok', factor, ip });
  return { ok: true, factor };
};

/* ─── Итог ──────────────────────────────────────────────────────────── */

/** Что позволяют доказанные факторы. Возвращает { path: 'now' | 'wait' | 'limited' | 'none', waitMs?, resetTwoFactor? }. */
export const evaluate = (kind, has2fa, factors) => {
  const f = new Set(factors);
  const strong = f.has('totp') || f.has('backup_code');
  if (kind === 'user') {
    if (f.has('email') && strong) return { path: 'now' };
    if (f.has('email')) return { path: 'wait', waitMs: emailWaitMs(), resetTwoFactor: has2fa };
    if (strong) return { path: 'limited' };
    return { path: 'none' };
  }
  if (kind === 'admin') {
    if (!f.has('admin_token')) return { path: 'none' };
    if (has2fa ? strong : f.has('email')) return { path: 'now' };
    return { path: 'none' };
  }
  if (kind === 'owner') {
    if (!f.has('owner_secret')) return { path: 'none' };
    if (f.has('email') || strong) return { path: 'wait', waitMs: ownerWaitMs(), resetTwoFactor: has2fa && !strong };
    return { path: 'none' };
  }
  return { path: 'none' };
};

export const status = async ({ requestId, secret }) => {
  const r = await loadReq(requestId, secret); if (!r) return err('invalid_request');
  const row = r.sky_id ? await findSkyIdById(r.sky_id) : null;
  const ev = evaluate(r.kind, Boolean(row?.two_factor_enabled), r.factors);
  return { kind: r.kind, status: r.status, factors: r.factors, path: ev.path, readyAt: r.ready_at ?? null, methods: METHODS[r.kind] };
};

const prepareGrant = async (r, row, { resetTwoFactor, newPassword }) => {
  await sessionStore.revokeAllForUser(row.id);
  if (resetTwoFactor) {
    await query(`UPDATE sky_ids SET two_factor_enabled = FALSE, two_factor_secret = NULL, two_factor_method = 'app', updated_at = now() WHERE id = $1`, [row.id]);
    await query('DELETE FROM sky_backup_codes WHERE sky_id = $1', [row.id]);
  }
  if (newPassword && row.password_hash) {
    await query(`UPDATE sky_ids SET password_hash = $2, password_set_at = now(), password_fail_count = 0, password_locked_until = NULL WHERE id = $1`, [row.id, await hashPassword(newPassword)]);
  }
  // Сессию создаёт основное приложение по одноразовому коду: кука должна встать на ЕГО домене.
  const code = randomSecret(24);
  await query(`INSERT INTO recovery_handoffs (code_hash, sky_id, kind, request_id, expires_at) VALUES ($1,$2,$3,$4, now() + interval '5 minutes')`,
    [hashSecret('handoff', code), row.id, r.kind, r.id]);
  return code;
};

/** Обмен одноразового кода на настоящую сессию (вызывается на домене приложения). */
export const exchangeHandoff = async ({ code, req, ip, deps }) => {
  if (typeof code !== 'string' || code.length < 20) return err('invalid_code');
  if (!(await attempt(`handoff:${ipHash(ip)}`, 20, 600))) return err('too_many_requests');
  const { rows } = await query(`UPDATE recovery_handoffs SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING sky_id, kind`, [hashSecret('handoff', code)]);
  if (!rows[0]) return err('invalid_code');
  const row = await findSkyIdById(rows[0].sky_id); if (!row) return err('invalid_code');
  const session = await deps.startSession(row, req, { via: { kind: 'recovery', label: rows[0].kind } });
  await record({ skyId: row.id, kind: rows[0].kind, event: 'session_issued', ip });
  return { ok: true, session: session.body, cookie: session.cookie, refreshToken: session.refreshToken };
};

/** Завершить: открыть доступ сразу или назначить ожидание. `deps` — startSession/appBody из роутов (избегаем круговых импортов). */
export const complete = async ({ requestId, secret, newPassword, ip }) => {
  const r = await loadReq(requestId, secret); if (!r) return err('invalid_request');
  if (!r.sky_id || ['done', 'cancelled', 'blocked', 'expired'].includes(r.status)) return err('verification_failed');
  const row = await findSkyIdById(r.sky_id); if (!row) return err('verification_failed');
  const cls = await accountClass(row.id);
  if ((r.kind === 'owner') !== cls.owner || (r.kind === 'admin' && !cls.admin)) return err('wrong_account_type');
  if (r.kind === 'user' && (cls.admin || cls.owner)) return err('wrong_account_type');
  if (newPassword != null && (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200)) return err('bad_password');
  const ev = evaluate(r.kind, Boolean(row.two_factor_enabled), r.factors);
  if (ev.path === 'none') return err('not_enough_factors');
  if (ev.path === 'limited') return err('limited_only', { scope: 'backup_email' });

  if (ev.path === 'wait') {
    if (r.status === 'waiting') return { ok: true, waiting: true, readyAt: r.ready_at };
    const finish = randomSecret(); const cancel = randomSecret();
    const readyAt = new Date(Date.now() + ev.waitMs);
    await query(`UPDATE recovery_requests SET status = 'waiting', ready_at = $2, finish_hash = $3, cancel_hash = $4, expires_at = $5 WHERE id = $1`,
      [r.id, readyAt, hashSecret('finish', finish), hashSecret('cancel', cancel), new Date(readyAt.getTime() + 7 * 86400_000)]);
    await record({ skyId: row.id, requestId: r.id, kind: r.kind, event: 'waiting_started', ip, detail: `до ${readyAt.toISOString()}` });
    const o = recoveryOrigin();
    await notifyAccount(row.id, {
      title: L('Восстановление доступа ожидает завершения', 'Access recovery is waiting'),
      text: L(`${stamp()}: запрошено восстановление доступа${r.kind === 'owner' ? ' владельца' : ''}. Завершить его можно после ${readyAt.toISOString().replace('T', ' ').slice(0, 16)} UTC. Если это были не вы — отмените запрос по ссылке ниже: он закроется, а доступ останется прежним.`,
        `${stamp()}: access recovery${r.kind === 'owner' ? ' of the owner' : ''} was requested. It can be completed after ${readyAt.toISOString().replace('T', ' ').slice(0, 16)} UTC. If it was not you, cancel it with the link below.`),
      links: `${L('Отменить запрос (это не я)', 'Cancel the request (not me)')}: ${o}/cancel#t=${cancel}\n${L('Завершить после ожидания', 'Finish after the wait')}: ${o}/finish#t=${finish}`,
    });
    return { ok: true, waiting: true, readyAt, message: 'Ссылки для отмены и завершения отправлены на почту аккаунта.' };
  }

  // Сразу. Заявку закрываем ДО выдачи сессии (повтор и гонка не откроют второй раз).
  const closed = await query(`UPDATE recovery_requests SET status = 'done', finished_at = now() WHERE id = $1 AND status IN ('open','ready') RETURNING id`, [r.id]);
  if (!closed.rowCount) return err('verification_failed');
  const handoff = await prepareGrant(r, row, { resetTwoFactor: false, newPassword });
  await afterRecovery(r, row, ip, false);
  return { ok: true, handoff, appUrl: appOrigin(), next: nextSteps(r.kind, row) };
};

const nextSteps = (kind, row) => ({ setupTwoFactor: !row.two_factor_enabled, changeBackupEmail: true, endSessions: true, adminToken: kind === 'admin' });

const afterRecovery = async (r, row, ip, reset) => {
  await record({ skyId: row.id, requestId: r.id, kind: r.kind, event: 'completed', ip, level: 'WARN', detail: reset ? 'второй фактор сброшен' : '' });
  await notifyAccount(row.id, { title: L('Доступ восстановлен', 'Access restored'), text: L(`${stamp()}: доступ к вашему Sky ID восстановлен${reset ? ', второй фактор сброшен — настройте его заново' : ''}. Все прежние сессии завершены.`, `${stamp()}: access to your Sky ID was restored${reset ? ', the second factor was reset — set it up again' : ''}. All previous sessions were ended.`) });
  if (r.kind === 'admin') await afterAdminRecovery(row.id, ip);
  if (r.kind === 'owner') {
    const { logEvent } = await import('./skylog.mjs');
    logEvent({ category: 'security', service: 'recovery', type: 'owner_recovered', level: 'CRITICAL', targetId: row.id, ip, detail: { requestId: r.id } });
  }
};

/* ─── Ожидание: отмена и завершение по ссылкам ─────────────────────── */

export const cancelByLink = async (token, ip) => {
  if (typeof token !== 'string' || token.length < 20) return err('invalid_link');
  const { rows } = await query(`UPDATE recovery_requests SET status = 'cancelled', finished_at = now() WHERE cancel_hash = $1 AND status IN ('waiting','ready','open') RETURNING id, sky_id, kind`, [hashSecret('cancel', token)]);
  if (!rows[0]) return err('invalid_link');
  await record({ skyId: rows[0].sky_id, requestId: rows[0].id, kind: rows[0].kind, event: 'cancelled_by_owner', ip, level: 'WARN' });
  await notifyAccount(rows[0].sky_id, { title: L('Запрос восстановления отменён', 'Recovery request cancelled'), text: L('Запрос восстановления доступа отменён по вашей ссылке. Рекомендуем сменить пароль и завершить чужие сессии.', 'The recovery request was cancelled via your link. We recommend changing your password and ending unknown sessions.') });
  return { ok: true };
};

const byFinish = async (token) => {
  if (typeof token !== 'string' || token.length < 20) return null;
  const { rows } = await query(`SELECT * FROM recovery_requests WHERE finish_hash = $1`, [hashSecret('finish', token)]);
  return rows[0] ?? null;
};

export const finishInfo = async (token) => {
  const r = await byFinish(token);
  if (!r || r.status !== 'waiting') return err('invalid_link');
  return { kind: r.kind, readyAt: r.ready_at, ready: r.ready_at <= new Date(), needsOwnerSecret: r.kind === 'owner' };
};

/** После ожидания нужен свежий код на резервную почту (ссылка из письма одна не открывает доступ). */
export const finishSendCode = async ({ token, ip }) => {
  const r = await byFinish(token); if (!r || r.status !== 'waiting' || r.ready_at > new Date()) return err('invalid_link');
  if (!(await attempt(`finishmail:${r.id}`, 4, 3600))) return err('too_many_requests');
  const to = await usableBackupEmail(r.sky_id);
  if (to) await issueCode('email', to, `recovery-finish:${r.id}`);
  return { ok: true };
};

export const finish = async ({ token, code, ownerSecret, newPassword, ip }) => {
  const r = await byFinish(token); if (!r || r.status !== 'waiting') return err('invalid_link');
  if (r.ready_at > new Date()) return err('not_ready', { readyAt: r.ready_at });
  if (!(await attempt(`finish:${r.id}`, 8, 3600))) return err('too_many_requests');
  const to = await usableBackupEmail(r.sky_id);
  if (!to || (await verifyCode('email', to, `recovery-finish:${r.id}`, String(code ?? ''))).error) return fail(r, 'email', ip);
  if (r.kind === 'owner' && !(await verifyOwnerSecret(r.sky_id, String(ownerSecret ?? '')))) return fail(r, 'owner_secret', ip);
  const row = await findSkyIdById(r.sky_id); if (!row) return err('invalid_link');
  if (newPassword != null && (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 200)) return err('bad_password');
  const closed = await query(`UPDATE recovery_requests SET status = 'done', finished_at = now() WHERE id = $1 AND status = 'waiting' RETURNING id`, [r.id]);
  if (!closed.rowCount) return err('invalid_link');
  const ev = evaluate(r.kind, Boolean(row.two_factor_enabled), r.factors);
  const handoff = await prepareGrant(r, row, { resetTwoFactor: Boolean(ev.resetTwoFactor), newPassword });
  await afterRecovery(r, row, ip, Boolean(ev.resetTwoFactor));
  return { ok: true, handoff, appUrl: appOrigin(), next: nextSteps(r.kind, row) };
};

/* ─── Только замена резервной почты (есть totp/резервный код, но нет почты) ─── */
export const limitedSetBackupEmail = async ({ requestId, secret, email, ip }) => {
  const r = await loadReq(requestId, secret); if (!r?.sky_id) return err('invalid_request');
  const f = new Set(r.factors);
  if (!(f.has('totp') || f.has('backup_code'))) return err('not_enough_factors');
  const mail = await import('./recoverymail.mjs');
  return mail.startSetProven(r.sky_id, email, ip, f.has('totp') ? 'totp' : 'backup_code');
};
export { maskEmail };
