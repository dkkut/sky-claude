/**
 * Личный токен администратора и владельца — ещё один фактор поверх почты и аутентификатора.
 *
 * Где нужен (решает сервер, не интерфейс):
 *  • вход в панель: ссылка с почты + код аутентификатора + токен (admingate.confirmLink);
 *  • любое подтверждение (step-up, adminsec.consumeStepUp): токен приходит вместе с кодом;
 *  • настройки: изменения в /api/admin/* и настройки администратора (/api/owner|staff/notify-prefs) —
 *    после «открытия настроек» токеном на `UNLOCK_MIN` минут для этой сессии (server.mjs, adminSettingsBlocks).
 * Создаёт себе сам администратор — в Профиль → Sky ID, с кодом аутентификатора; показывается один раз, в базе только HMAC.
 * Перебор: 5 неверных — блок 15 минут, дальше ×2 до суток. `ADMIN_TOKEN=off` выключает требование целиком (аварийно).
 * Потерян токен: заново выдать можно только с кодом аутентификатора; совсем нельзя — `scripts/reset-admin-token.mjs` на сервере.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { logAdmin, logSecurityEvent } from './adminsec.mjs';
import { adminNow } from './admingate.mjs';
import { rateLimitPerHour } from './security.mjs';
import { L } from './lang.mjs';

export const UNLOCK_MIN = Math.max(5, Number(process.env.ADMIN_TOKEN_UNLOCK_MIN) || 30);
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const err = (error, extra = {}) => ({ error, ...extra });

export const tokenRequired = () => process.env.ADMIN_TOKEN !== 'off';
const hashOf = (profileId, raw) => crypto.createHmac('sha256', `${config.jwtSecret}:admin-token:v1:${profileId}`).update(canon(raw)).digest('hex');
/** Регистр, пробелы и дефисы не важны. */
export const canon = (raw) => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const generate = () => {
  const part = () => Array.from({ length: 5 }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('');
  return `SKA-${part()}-${part()}-${part()}-${part()}`;
};

export const tokenState = async (profileId) => {
  const { rows } = await query('SELECT last4, created_at, last_used_at, blocked_until FROM admin_tokens WHERE profile_id = $1', [profileId]);
  const r = rows[0];
  return { required: tokenRequired(), has: Boolean(r), last4: r?.last4 ?? null, createdAt: r?.created_at?.toISOString() ?? null, lastUsedAt: r?.last_used_at?.toISOString() ?? null,
    blockedFor: r?.blocked_until && r.blocked_until > new Date() ? Math.ceil((r.blocked_until - Date.now()) / 1000) : 0 };
};

/** Выдать (или заменить) токен. Нужен аутентификатор и его код; администратор — только действующий. */
export const issueToken = async (profileId, code) => {
  const who = await adminNow(profileId);
  if (!who) return err('not_allowed');
  if (!who.twoFactor) return err('two_factor_required');
  if (!rateLimitPerHour(`admtok:issue:${profileId}`, 6)) return err('too_many_requests');
  const secret = decryptSecret(who.secret);
  if (!secret || !verifyTotp(secret, String(code ?? '').replace(/\s+/g, ''))) {
    await logSecurityEvent(profileId, 'admin_token_bad_code', '', {});
    return err('bad_code');
  }
  const shown = generate();
  await query(`INSERT INTO admin_tokens (profile_id, token_hash, last4) VALUES ($1,$2,$3)
    ON CONFLICT (profile_id) DO UPDATE SET token_hash = $2, last4 = $3, fails = 0, blocked_until = NULL, created_at = now(), last_used_at = NULL`,
  [profileId, hashOf(profileId, shown), canon(shown).slice(-4)]);
  await query('DELETE FROM admin_token_unlock WHERE profile_id = $1', [profileId]);
  await logAdmin({ actorId: profileId, type: 'admin_token_issued', targetType: 'user', targetId: profileId, detail: 'выдан личный токен администратора' });
  return { ok: true, token: shown, last4: canon(shown).slice(-4) };
};

/** Отозвать свой токен (с кодом аутентификатора). Пока требование включено, без токена панель закрыта — выдайте новый. */
export const revokeToken = async (profileId, code) => {
  const who = await adminNow(profileId);
  if (!who) return err('not_allowed');
  const secret = decryptSecret(who.secret);
  if (!who.twoFactor || !secret || !verifyTotp(secret, String(code ?? '').replace(/\s+/g, ''))) return err('bad_code');
  await query('DELETE FROM admin_tokens WHERE profile_id = $1', [profileId]);
  await query('DELETE FROM admin_token_unlock WHERE profile_id = $1', [profileId]);
  await logAdmin({ actorId: profileId, type: 'admin_token_revoked', targetType: 'user', targetId: profileId, detail: 'токен администратора отозван' });
  return { ok: true };
};

/** Проверить токен. `ok:true` либо {error}; неверные считаются, перебор блокируется. */
export const verifyToken = async (profileId, raw, { force = false } = {}) => {
  if (!force && !tokenRequired()) return { ok: true, skipped: true };   // force: SSH требует токен всегда, даже при ADMIN_TOKEN=off
  const c = canon(raw);
  if (!c) return err('admin_token_required');
  const { rows } = await query('SELECT token_hash, fails, blocked_until FROM admin_tokens WHERE profile_id = $1', [profileId]);
  const r = rows[0];
  if (!r) return err('admin_token_missing');
  if (r.blocked_until && r.blocked_until > new Date()) return err('admin_token_blocked', { retryAfter: Math.ceil((r.blocked_until - Date.now()) / 1000) });
  const want = Buffer.from(r.token_hash); const got = Buffer.from(hashOf(profileId, raw));
  if (want.length === got.length && crypto.timingSafeEqual(want, got)) {
    await query('UPDATE admin_tokens SET fails = 0, blocked_until = NULL, last_used_at = now() WHERE profile_id = $1', [profileId]);
    return { ok: true };
  }
  const fails = r.fails + 1;
  const wait = fails >= 5 ? Math.min(86400, 900 * 2 ** Math.floor((fails - 5) / 5)) : 0;
  await query('UPDATE admin_tokens SET fails = $2, blocked_until = $3 WHERE profile_id = $1', [profileId, fails, wait ? new Date(Date.now() + wait * 1000) : null]);
  await logSecurityEvent(profileId, 'admin_token_failed', `подряд: ${fails}`, {});
  return err('admin_token_invalid', { left: Math.max(0, 5 - fails) });
};

/** Открыть настройки для этой сессии (нужен верный токен). */
export const unlockSettings = async (sid, profileId, raw) => {
  const who = await adminNow(profileId);
  if (!who) return err('not_allowed');
  if (!rateLimitPerHour(`admtok:unlock:${profileId}`, 60)) return err('too_many_requests');
  const v = await verifyToken(profileId, raw);
  if (v.error) return v;
  await query(`INSERT INTO admin_token_unlock (sid, profile_id, expires_at) VALUES ($1,$2, now() + ($3 || ' minutes')::interval)
    ON CONFLICT (sid) DO UPDATE SET profile_id = $2, expires_at = excluded.expires_at`, [sid, profileId, String(UNLOCK_MIN)]);
  return { ok: true, minutes: UNLOCK_MIN };
};
export const lockSettings = async (sid) => { await query('DELETE FROM admin_token_unlock WHERE sid = $1', [sid]); return { ok: true }; };
export const settingsOpen = async (sid, profileId) => {
  if (!tokenRequired()) return true;
  const { rows } = await query('SELECT 1 FROM admin_token_unlock WHERE sid = $1 AND profile_id = $2 AND expires_at > now()', [sid, profileId]);
  return Boolean(rows[0]);
};

/** Человек — администратор или владелец (токен нужен только им). */
export const isAdminProfile = async (profileId) => Boolean(await adminNow(profileId));

export const sweepAdminToken = async () => { await query('DELETE FROM admin_token_unlock WHERE expires_at < now() - interval \'1 day\''); };
