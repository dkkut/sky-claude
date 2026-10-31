/**
 * Отдельный пароль кошелька SkyMoney. Необязателен; задаёт сам человек в настройках SkyMoney.
 * Если задан — нужен в КАЖДОЙ сессии, в том числе на доверенном устройстве (сверх пароля Sky ID и подтверждения устройства).
 * В базе только хеш (`hashPassword`). Перебор: 5 неверных подряд — пауза 15 минут, дальше ×2 (до суток).
 * Забыл пароль: сбросить можно только на доверенном устройстве, подтвердив личность кодом аутентификатора (или кодом на почту/SMS, если аутентификатора нет).
 */
import { query } from './db.mjs';
import { hashPassword, verifyPassword } from './security.mjs';
import { logEvent } from './skylog.mjs';

const row = async (skyId) => (await query(`SELECT * FROM money_password WHERE sky_id = $1`, [skyId])).rows[0] ?? null;
export const hasWalletPassword = async (skyId) => Boolean(await row(skyId));
const log = (type, skyId) => { try { logEvent({ category: 'security', service: 'money', type, targetId: skyId }); } catch { /* журнал */ } };

/** Проверка пароля с защитой от перебора. */
export const checkWalletPassword = async (skyId, password) => {
  const r = await row(skyId); if (!r) return { ok: true };
  if (r.locked_until && new Date(r.locked_until) > new Date()) return { ok: false, error: 'too_many_attempts', retryAfter: Math.ceil((new Date(r.locked_until) - Date.now()) / 1000) };
  if (typeof password !== 'string' || !password) return { ok: false, error: 'wallet_password_required' };
  if (await verifyPassword(password, r.hash)) {
    if (r.fails) await query(`UPDATE money_password SET fails = 0, locked_until = NULL WHERE sky_id = $1`, [skyId]);
    return { ok: true };
  }
  const fails = r.fails + 1;
  const pause = fails >= 5 ? Math.min(86400, 900 * 2 ** Math.floor((fails - 5) / 5)) : 0;
  await query(`UPDATE money_password SET fails = $2, locked_until = CASE WHEN $3 > 0 THEN now() + ($3 || ' seconds')::interval ELSE NULL END WHERE sky_id = $1`, [skyId, fails, pause]);
  log('money_wallet_password_failed', skyId);
  return { ok: false, error: pause ? 'too_many_attempts' : 'invalid_wallet_password', ...(pause ? { retryAfter: pause } : {}) };
};

const valid = (p) => typeof p === 'string' && p.length >= 6 && p.length <= 64;

/** Задать или сменить пароль. Если уже задан — нужен текущий. Вызывающий обязан проверить доверенное устройство и открытую сессию. */
export const setWalletPassword = async (skyId, { current, next }) => {
  if (!valid(next)) return { ok: false, error: 'weak_wallet_password' };
  if (await hasWalletPassword(skyId)) {
    const c = await checkWalletPassword(skyId, current); if (!c.ok) return c;
  }
  await query(`INSERT INTO money_password (sky_id, hash) VALUES ($1,$2)
    ON CONFLICT (sky_id) DO UPDATE SET hash = $2, fails = 0, locked_until = NULL, updated_at = now()`, [skyId, await hashPassword(next)]);
  log('money_wallet_password_set', skyId);
  return { ok: true };
};

/** Убрать пароль (нужен текущий). */
export const removeWalletPassword = async (skyId, { current }) => {
  if (!(await hasWalletPassword(skyId))) return { ok: true };
  const c = await checkWalletPassword(skyId, current); if (!c.ok) return c;
  await query(`DELETE FROM money_password WHERE sky_id = $1`, [skyId]);
  log('money_wallet_password_removed', skyId);
  return { ok: true };
};

/** Сброс забытого пароля — вызывать только после подтверждения личности кодом. Задаёт новый или убирает (next=null). */
export const resetWalletPassword = async (skyId, next) => {
  if (next == null || next === '') { await query(`DELETE FROM money_password WHERE sky_id = $1`, [skyId]); log('money_wallet_password_reset', skyId); return { ok: true, hasPassword: false }; }
  if (!valid(next)) return { ok: false, error: 'weak_wallet_password' };
  await query(`INSERT INTO money_password (sky_id, hash) VALUES ($1,$2)
    ON CONFLICT (sky_id) DO UPDATE SET hash = $2, fails = 0, locked_until = NULL, updated_at = now()`, [skyId, await hashPassword(next)]);
  log('money_wallet_password_reset', skyId);
  return { ok: true, hasPassword: true };
};
