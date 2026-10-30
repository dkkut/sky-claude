/**
 * Замок SkyMoney: пока доступ не подтверждён, финансовые данные и операции SkyMoney закрыты на СЕРВЕРЕ (не только экраном).
 *
 * Используются уже существующие механизмы Sky ID, новых «паролей» нет:
 *   • доверенное устройство — `sky_trusted_devices` (устройство становится доверенным после входа по коду, `trusteddevices.mjs`);
 *   • пароль Sky ID — `verifyPassword` (если пароль задан, его нужно подтвердить);
 *   • устройство не доверенное → его подтверждает код: из приложения-аутентификатора (если он включён) либо код на почту/SMS
 *     (`verification.mjs`, назначение `money_unlock`).
 * Допуск живёт в Redis (`moneyok:<sid>`), привязан к СЕССИИ, скользящий: `MONEY_UNLOCK_MIN` (15) минут без обращений к SkyMoney — снова закрыто.
 * Закрыты (403 `money_locked`): `/api/wallet` (состояние, история, пополнение, обмен, возврат), `/api/skykassa` (кроме вебхука партнёра),
 * `/api/codes/redeem|history`. Узкие пути для других сервисов остаются открытыми — `/api/wallet/balance` (только два числа для экранов
 * покупки), `/api/wallet/spend`, `/spend-points` (их вызывают Market, Музыка, Семья; сам по себе вызов требует входа и не отдаёт историю).
 */
import { query } from './db.mjs';
import { sessionStore } from './sessions.mjs';
import { verifyPassword, rateLimit, rateLimitPerHour } from './security.mjs';
import { isDeviceTrusted } from './trusteddevices.mjs';
import { issueCode, verifyCode } from './verification.mjs';
import { verifySkyTwoFactor } from './skyid.mjs';
import { logEvent } from './skylog.mjs';

export const UNLOCK_SEC = Math.max(60, (Number(process.env.MONEY_UNLOCK_MIN) || 15) * 60);

/** Нужен ли допуск для этого пути (без строки запроса). */
export const isMoneyPath = (pathname) => {
  const p = String(pathname || '');
  if (p === '/api/wallet/balance' || p === '/api/wallet/spend' || p === '/api/wallet/spend-points') return false;
  if (p === '/api/wallet' || p.startsWith('/api/wallet/')) return true;
  if (p.startsWith('/api/skykassa') && !p.startsWith('/api/skykassa/webhook')) return true;
  if (p === '/api/codes/redeem' || p === '/api/codes/history') return true;
  return false;
};

const load = async (skyId) => (await query(
  `SELECT id, email, email_verified, phone, phone_verified, password_hash, two_factor_enabled, two_factor_method FROM sky_ids WHERE id = $1`, [skyId])).rows[0] ?? null;

const mask = (v) => { const s = String(v ?? ''); return s.includes('@') ? s.replace(/^(.).*(@.*)$/, '$1***$2') : s.replace(/.(?=.{3})/g, '•'); };

/** Что подтверждено в этой сессии и чего не хватает. */
export const moneyState = async (skyId, sid, req) => {
  const row = await load(skyId);
  if (!row) return { unlocked: false, needPassword: false, needDevice: false, closed: true };
  const rec = (await sessionStore.getMoney(sid)) ?? {};
  const trusted = await isDeviceTrusted(skyId, req).catch(() => false);
  const passwordSet = Boolean(row.password_hash);
  const useApp = row.two_factor_enabled && (row.two_factor_method ?? 'app') === 'app';
  const channel = row.email_verified && row.email ? 'email' : (row.phone_verified && row.phone ? 'phone' : null);
  const needDevice = !trusted && !rec.dev;
  const needPassword = passwordSet && !rec.pw;
  return {
    unlocked: !needDevice && !needPassword,
    trustedDevice: trusted, passwordSet, needPassword, needDevice,
    deviceProof: needDevice ? (useApp ? 'authenticator' : channel) : null,
    destination: needDevice && !useApp && channel ? mask(channel === 'email' ? row.email : row.phone) : null,
    expiresInSec: UNLOCK_SEC,
  };
};

/** Проверка для шлюза: открыт ли допуск; при открытом — продлевает его (скользящий срок). */
export const moneyOpen = async (skyId, sid, req) => {
  const st = await moneyState(skyId, sid, req);
  if (!st.unlocked) return st;
  const rec = (await sessionStore.getMoney(sid)) ?? {};
  await sessionStore.setMoney(sid, { ...rec, at: Date.now() }, UNLOCK_SEC).catch(() => {});
  return st;
};

const deny = (error, extra = {}) => ({ ok: false, error, ...extra });

/** Отправить код подтверждения устройства (почта/SMS). Без аутентификатора. */
export const sendDeviceCode = async (skyId) => {
  const row = await load(skyId); if (!row) return deny('not_found');
  const useApp = row.two_factor_enabled && (row.two_factor_method ?? 'app') === 'app';
  if (useApp) return deny('use_authenticator');
  const channel = row.email_verified && row.email ? 'email' : (row.phone_verified && row.phone ? 'phone' : null);
  if (!channel) return deny('no_contact');
  const dest = channel === 'email' ? row.email : row.phone;
  const r = await issueCode(channel, dest, 'money_unlock', { devices: false });
  if (r.error) return deny(r.error, r.retryAfter ? { retryAfter: r.retryAfter } : {});
  return { ok: true, retryAfter: r.retryAfter, expiresIn: r.expiresIn };
};

/** Подтвердить доступ: можно прислать пароль и/или код устройства; что нужно — решает сервер. */
export const unlockMoney = async (skyId, sid, req, { password, code } = {}) => {
  if (!rateLimit(`moneyunlock:${skyId}`, 8) || !rateLimitPerHour(`moneyunlock:${skyId}`, 40)) return deny('too_many_requests');
  const row = await load(skyId); if (!row) return deny('not_found');
  const st = await moneyState(skyId, sid, req);
  const rec = { ...((await sessionStore.getMoney(sid)) ?? {}) };

  if (st.needPassword) {
    if (typeof password !== 'string' || !password) return deny('password_required');
    const ok = await verifyPassword(password, row.password_hash);
    if (!ok) { try { logEvent({ category: 'security', service: 'money', type: 'money_unlock_failed', targetId: skyId, detail: { step: 'password' } }); } catch { /* журнал */ } return deny('invalid_credentials'); }
    rec.pw = Date.now();
  }
  if (st.needDevice) {
    if (!code) return deny('device_code_required', { deviceProof: st.deviceProof });
    if (st.deviceProof === 'authenticator') {
      const v = await verifySkyTwoFactor(skyId, String(code));
      if (!v.ok) return deny(v.error === 'too_many_attempts' ? 'too_many_attempts' : 'invalid_code');
    } else {
      const channel = st.deviceProof; const dest = channel === 'email' ? row.email : row.phone;
      const v = await verifyCode(channel, dest, 'money_unlock', String(code));
      if (!v.ok) return deny(v.error ?? 'invalid_code');
    }
    rec.dev = Date.now();
  }
  await sessionStore.setMoney(sid, rec, UNLOCK_SEC);
  try { logEvent({ category: 'security', service: 'money', type: 'money_unlocked', targetId: skyId, detail: { password: Boolean(rec.pw), device: Boolean(rec.dev) } }); } catch { /* журнал */ }
  return { ok: true, ...(await moneyState(skyId, sid, req)) };
};

export const lockMoney = async (sid) => { await sessionStore.setMoney(sid, null, 1); return { ok: true }; };
