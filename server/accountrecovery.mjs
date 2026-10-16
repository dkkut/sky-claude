/**
 * Модули 15–16: резервные коды второго фактора, сброс потерянного аутентификатора, защита смены почты и номера.
 *
 * Принципы:
 *  • Один канал не равен одному фактору. Почта (или SIM) сами по себе не снимают второй фактор и не меняют контакт:
 *    сброс аутентификатора — только с ожиданием (RECOVERY_WAIT_HOURS, по умолчанию 48 ч) и письмами о нём; смена
 *    подтверждённой почты/номера — только при действующем втором факторе (или коде на ТЕКУЩУЮ почту, если аутентификатора нет).
 *  • Администраторы и владелец сбрасывают второй фактор не сами: здесь отказ (admin_manual), процедура — scripts/reset-2fa.mjs на сервере.
 *  • Ответы не раскрывают, есть ли аккаунт, и не говорят, какой именно фактор не подошёл.
 *  • Всё хранится хешами (резервные коды, ссылки); письмо — единственное место, где открытые значения существуют.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { macOf } from './crypto.mjs';
import { sendEmail } from './notify.mjs';
import { sessionStore } from './sessions.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { rateLimit, rateLimitPerHour } from './security.mjs';
import { L } from './lang.mjs';

const waitSec = () => { const v = Number(process.env.RECOVERY_WAIT_SEC); return Number.isFinite(v) && v >= 0 && process.env.RECOVERY_WAIT_SEC !== undefined ? v : Number(process.env.RECOVERY_WAIT_HOURS ?? 48) * 3600; };
const expireSec = () => waitSec() + 7 * 86400;      // после готовности ссылка «завершить» живёт ещё неделю
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const mask = (email) => { const v = String(email ?? ''); const at = v.indexOf('@'); return at < 1 ? '' : `${v[0]}***${v.slice(at)}`; };
const maskPhone = (p) => { const v = String(p ?? ''); return v.length > 4 ? `${v.slice(0, 2)}***${v.slice(-2)}` : ''; };
const err = (code, extra = {}) => ({ error: code, ...extra });
const sky = async (id) => (await query('SELECT * FROM sky_ids WHERE id = $1', [id])).rows[0] ?? null;
const isAdminAccount = async (skyId) => (await query('SELECT 1 FROM profiles WHERE sky_id = $1 AND is_admin LIMIT 1', [skyId])).rowCount > 0;
const mail = (to, subject, text) => (to ? sendEmail(to, subject, text).catch((e) => console.error('[recovery] письмо:', e.message)) : Promise.resolve());

/* ─── Резервные коды ───────────────────────────────────────────────── */

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const BACKUP_RE = /^[A-Z2-9]{5}-?[A-Z2-9]{5}$/;
const normBackup = (c) => String(c ?? '').toUpperCase().replace(/[\s]/g, '');
export const looksLikeBackupCode = (c) => BACKUP_RE.test(normBackup(c));
const backupHash = (code) => macOf('backup2fa', normBackup(code).replace('-', ''));
const randomCode = () => { const b = crypto.randomBytes(10); let s = ''; for (let i = 0; i < 10; i++) s += ALPHABET[b[i] % ALPHABET.length]; return `${s.slice(0, 5)}-${s.slice(5)}`; };

/** Новый набор из 10 кодов; прежний набор перестаёт действовать. Открытые коды возвращаются ОДИН раз. */
export const generateBackupCodes = async (skyId) => {
  const codes = Array.from({ length: 10 }, randomCode);
  await query('DELETE FROM sky_backup_codes WHERE sky_id = $1', [skyId]);
  for (const c of codes) await query('INSERT INTO sky_backup_codes (sky_id, code_hash) VALUES ($1,$2)', [skyId, backupHash(c)]);
  return { codes };
};

export const backupCodesLeft = async (skyId) =>
  Number((await query('SELECT count(*)::int AS n FROM sky_backup_codes WHERE sky_id = $1 AND used_at IS NULL', [skyId])).rows[0]?.n ?? 0);

/** Погасить резервный код (один раз). Возвращает { ok, left } либо { error }. */
export const consumeBackupCode = async (skyId, code) => {
  if (!looksLikeBackupCode(code)) return err('invalid_code');
  if (!rateLimit(`backup:${skyId}`, 10) || !rateLimitPerHour(`backup:${skyId}`, 30)) return err('too_many_attempts');
  const { rowCount } = await query(
    'UPDATE sky_backup_codes SET used_at = now() WHERE sky_id = $1 AND code_hash = $2 AND used_at IS NULL', [skyId, backupHash(code)]);
  if (!rowCount) return err('invalid_code');
  const left = await backupCodesLeft(skyId);
  const row = await sky(skyId);
  if (row?.email_verified) {
    await mail(row.email, L('Использован резервный код Sky ID', 'A Sky ID backup code was used'),
      L(`Для входа использован резервный код второго фактора. Осталось кодов: ${left}.\n\nЕсли это были не вы — немедленно смените пароль, завершите чужие сессии в Профиль → Sky ID → Устройства и создайте новые резервные коды.`,
        `A two-factor backup code was used to sign in. Codes left: ${left}.\n\nIf this was not you, change your password right away, end unknown sessions in Profile → Sky ID → Devices and create new backup codes.`));
  }
  await cancelOpenReset(skyId, 'login');
  return { ok: true, left };
};

/* ─── Сброс потерянного аутентификатора ────────────────────────────── */

const cancelOpenReset = async (skyId, why) => {
  const { rowCount } = await query(`UPDATE two_factor_resets SET status = 'cancelled', decided_at = now() WHERE sky_id = $1 AND status = 'pending'`, [skyId]);
  return rowCount > 0 ? why : null;
};

/** Запрос сброса: вызывается после первого фактора (challenge). Письмо со ссылками «отменить» и «завершить» (после ожидания). */
export const startReset = async (skyId, { ip = '', ua = '' } = {}) => {
  const row = await sky(skyId);
  if (!row || !row.two_factor_enabled) return err('not_configured');
  if (await isAdminAccount(skyId)) return err('admin_manual');
  if (!row.email_verified || !row.email) return err('email_required');
  if (!rateLimitPerHour(`reset2fa:start:${skyId}`, 3)) return err('too_many_requests');
  const open = (await query(`SELECT * FROM two_factor_resets WHERE sky_id = $1 AND status = 'pending' AND expires_at > now()`, [skyId])).rows[0];
  if (open) return { ok: true, readyAt: open.ready_at, already: true };
  await query(`UPDATE two_factor_resets SET status = 'expired', decided_at = now() WHERE sky_id = $1 AND status = 'pending'`, [skyId]);
  const finish = crypto.randomBytes(32).toString('base64url'); const cancel = crypto.randomBytes(32).toString('base64url');
  const readyAt = new Date(Date.now() + waitSec() * 1000); const expiresAt = new Date(Date.now() + expireSec() * 1000);
  await query(
    `INSERT INTO two_factor_resets (id, sky_id, finish_hash, cancel_hash, ip, ua, ready_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [`rst-${crypto.randomUUID()}`, skyId, sha(finish), sha(cancel), String(ip).slice(0, 60), String(ua).slice(0, 200), readyAt, expiresAt]);
  const when = readyAt.toISOString().replace('T', ' ').slice(0, 16);
  await mail(row.email, L('Sky ID: запрошен сброс второго фактора', 'Sky ID: second-factor reset requested'),
    L(`Кто-то запросил сброс приложения-аутентификатора для вашего Sky ID (адрес запроса: ${ip || 'неизвестен'}).\n\n` +
      `Сброс не произойдёт раньше ${when} (UTC): это время ожидания для вашей защиты. До этого входить по-прежнему нужно с кодом.\n\n` +
      `ЕСЛИ ЭТО БЫЛИ НЕ ВЫ — отмените запрос и смените пароль:\n${config.publicOrigin}/2fa-reset?c=${cancel}\n\n` +
      `Если это вы, после ${when} откройте ссылку и завершите сброс (она одноразовая, действует неделю после этого времени):\n${config.publicOrigin}/2fa-reset?f=${finish}\n\n` +
      'Любой успешный вход с кодом или резервным кодом отменяет запрос автоматически.',
      `Someone asked to reset the authenticator app for your Sky ID (request address: ${ip || 'unknown'}).\n\n` +
      `The reset cannot happen before ${when} (UTC): this waiting time protects you. Until then you still need a code to sign in.\n\n` +
      `IF THIS WAS NOT YOU — cancel the request and change your password:\n${config.publicOrigin}/2fa-reset?c=${cancel}\n\n` +
      `If it was you, after ${when} open this link to finish the reset (single-use, valid for a week after that time):\n${config.publicOrigin}/2fa-reset?f=${finish}\n\n` +
      'Any successful sign-in with a code or a backup code cancels the request automatically.'));
  return { ok: true, readyAt };
};

/** Состояние запроса по ссылке (для страницы): без раскрытия лишнего. */
export const resetInfo = async (token, kind) => {
  const col = kind === 'cancel' ? 'cancel_hash' : 'finish_hash';
  const r = (await query(`SELECT status, ready_at, expires_at FROM two_factor_resets WHERE ${col} = $1`, [sha(token ?? '')])).rows[0];
  if (!r || r.status !== 'pending' || r.expires_at.getTime() < Date.now()) return err('invalid_link');
  return { ok: true, readyAt: r.ready_at, ready: r.ready_at.getTime() <= Date.now() };
};

export const cancelReset = async (token) => {
  const { rows } = await query(
    `UPDATE two_factor_resets SET status = 'cancelled', decided_at = now() WHERE cancel_hash = $1 AND status = 'pending' RETURNING sky_id`, [sha(token ?? '')]);
  if (!rows[0]) return err('invalid_link');
  const row = await sky(rows[0].sky_id);
  await mail(row?.email, L('Sky ID: сброс второго фактора отменён', 'Sky ID: second-factor reset cancelled'),
    L('Запрос на сброс аутентификатора отменён по вашей ссылке. Рекомендуем сменить пароль и проверить список устройств в Профиль → Sky ID → Устройства.',
      'The authenticator reset request was cancelled from your link. We recommend changing your password and checking Profile → Sky ID → Devices.'));
  return { ok: true };
};

/**
 * Завершить сброс. Нужны ОБА: ссылка из письма (после ожидания) и первый фактор текущего входа (challenge проверяет маршрут).
 * Одним UPDATE: статус pending → done; затем второй фактор и резервные коды снимаются, все сессии завершаются.
 */
export const finishReset = async (skyId, token) => {
  const { rows } = await query(
    `UPDATE two_factor_resets SET status = 'done', decided_at = now()
      WHERE finish_hash = $1 AND sky_id = $2 AND status = 'pending' AND ready_at <= now() AND expires_at > now() RETURNING id`, [sha(token ?? ''), skyId]);
  if (!rows[0]) {
    const early = (await query(`SELECT ready_at FROM two_factor_resets WHERE finish_hash = $1 AND sky_id = $2 AND status = 'pending' AND expires_at > now()`, [sha(token ?? ''), skyId])).rows[0];
    return early ? err('too_early', { readyAt: early.ready_at }) : err('invalid_link');
  }
  await query(`UPDATE sky_ids SET two_factor_enabled = FALSE, two_factor_secret = NULL, two_factor_method = 'app', updated_at = now() WHERE id = $1`, [skyId]);
  await query('DELETE FROM sky_backup_codes WHERE sky_id = $1', [skyId]);
  await sessionStore.revokeAllForUser(skyId);
  const row = await sky(skyId);
  await mail(row?.email, L('Sky ID: второй фактор сброшен', 'Sky ID: second factor reset'),
    L('Приложение-аутентификатор отвязано от вашего Sky ID, все сессии завершены. Войдите заново и включите защиту снова (Профиль → Sky ID → Защита). Если это были не вы — свяжитесь с поддержкой.',
      'The authenticator app was removed from your Sky ID and all sessions were ended. Sign in again and turn protection back on (Profile → Sky ID → Protection). If this was not you, contact support.'));
  return { ok: true };
};

export const resetStatus = async (skyId) => {
  const r = (await query(`SELECT ready_at, created_at FROM two_factor_resets WHERE sky_id = $1 AND status = 'pending' AND expires_at > now()`, [skyId])).rows[0];
  return r ? { pending: true, readyAt: r.ready_at, createdAt: r.created_at } : { pending: false };
};

/* ─── Смена подтверждённой почты / номера ──────────────────────────── */

/**
 * Защита замены УЖЕ подтверждённого контакта (первая привязка не затрагивается).
 *  • включён аутентификатор → нужен его код (`body.twoFactorCode`) — без него украденная сессия контакт не перепривяжет;
 *  • аутентификатора нет → нужен код, присланный на ТЕКУЩУЮ подтверждённую почту (`body.currentEmailCode`, /api/skyid/contact/guard-code);
 *  • нет ни того, ни другого (нечем доказать владение) → замена закрыта, только поддержка.
 * Возвращает null — можно менять, либо { error }.
 */
export const guardContactChange = async (skyId, kind, body, verifyTwoFactor) => {
  const row = await sky(skyId);
  if (!row) return err('not_found');
  const has = kind === 'email' ? row.email_verified && row.email : row.phone_verified && row.phone;
  if (!has) return null;
  if (row.two_factor_enabled) {
    if (!body?.twoFactorCode) return err('two_factor_required');
    const c = await verifyTwoFactor(skyId, String(body.twoFactorCode));
    return c?.error ? err(c.error === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_code') : null;
  }
  if (!row.email_verified || !row.email) return err('cannot_prove_ownership');
  if (!body?.currentEmailCode) return err('current_email_code_required');
  const c = await verifyCode('email', row.email, `guard:${skyId}`, String(body.currentEmailCode));
  return c.error ? err('invalid_code') : null;
};

/** Код на ТЕКУЩУЮ почту для подтверждения замены контакта (когда нет аутентификатора). */
export const sendContactGuardCode = async (skyId) => {
  const row = await sky(skyId);
  if (!row?.email_verified || !row.email) return err('cannot_prove_ownership');
  const r = await issueCode('email', row.email, `guard:${skyId}`);
  return r.error ? r : { ok: true, email: mask(row.email), retryAfter: r.retryAfter };
};

/** После замены: запись в журнал и письмо на прежнюю почту (если была). */
export const noteContactChanged = async (skyId, kind, before, after, ip = '') => {
  await query('INSERT INTO contact_change_log (sky_id, kind, old_masked, new_masked, ip) VALUES ($1,$2,$3,$4,$5)',
    [skyId, kind, kind === 'email' ? mask(before) : maskPhone(before), kind === 'email' ? mask(after) : maskPhone(after), String(ip).slice(0, 60)]);
  if (before && String(before).toLowerCase() === String(after).toLowerCase()) return;
  const oldEmail = kind === 'email' ? before : (await sky(skyId))?.email;
  if (!oldEmail) return;
  const what = kind === 'email' ? L('почта', 'email') : L('номер телефона', 'phone number');
  await mail(oldEmail, L(`Sky ID: изменён ${what === 'почта' ? 'адрес почты' : 'номер телефона'}`, `Sky ID: ${what} changed`),
    L(`В вашем Sky ID изменён контакт (${kind === 'email' ? 'почта' : 'номер'}): было ${kind === 'email' ? mask(before) : maskPhone(before)}, стало ${kind === 'email' ? mask(after) : maskPhone(after)}.\n\n` +
      'Если это были не вы — немедленно смените пароль, завершите чужие сессии в Профиль → Sky ID → Устройства и заморозьте новые входы там же.',
      `A contact on your Sky ID was changed (${kind}): was ${kind === 'email' ? mask(before) : maskPhone(before)}, now ${kind === 'email' ? mask(after) : maskPhone(after)}.\n\n` +
      'If this was not you, change your password immediately, end unknown sessions in Profile → Sky ID → Devices and freeze new sign-ins there.'));
};
