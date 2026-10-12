/**
 * PIN-код при смене IP — по желанию человека, настройка Sky ID.
 *
 * Включил — и если запросы его сессии вдруг приходят с адреса, которого эта сессия ещё не видела
 * (украденный токен, чужое устройство), сервер отвечает 403 pin_required на всё, кроме самого ввода
 * PIN, пока человек не введёт свои четыре цифры. Адрес входа в сессию считается «своим»; адреса,
 * где PIN введён, запоминаются на срок сессии (sessions.mjs, ipKnown/ipAllow).
 *
 * PIN из четырёх цифр — десять тысяч вариантов, поэтому защита стоит не на секретности, а на
 * ограничении перебора: после 5 неверных ввод блокируется на 15 минут, дальше срок удваивается
 * (до суток), счётчик сбрасывается только верным вводом или сбросом PIN; на 10-й неверной попытке
 * сессия, с которой подбирали, завершается, а человеку приходит письмо.
 *
 * Включить PIN можно только с подтверждённой почтой и аутентификатором: именно они — единственный
 * способ сбросить забытый PIN (код на почту И код аутентификатора вместе). Без них забытый PIN
 * закрыл бы аккаунт навсегда.
 *
 * Хранится только хеш (scrypt, соль, «перец» от JWT_SECRET).
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { decryptSecret } from './crypto.mjs';
import { verifyTotp } from './totp.mjs';
import { sendEmail } from './notify.mjs';
import { sessionStore } from './sessions.mjs';
import { rateLimitPerHour } from './security.mjs';
import { L } from './lang.mjs';

const LOCK_AFTER = 5;
const KILL_AFTER = 10;
const RESET_TTL_MIN = 15;
const RESET_ATTEMPTS = 5;

/* ─── Хеш PIN ─── */
const hashPin = (pin, salt = crypto.randomBytes(16).toString('hex')) =>
  `${salt}:${crypto.scryptSync(`${config.jwtSecret}:ip-pin:${pin}`, salt, 32).toString('hex')}`;
const checkPin = (pin, stored) => {
  const [salt, h] = String(stored ?? '').split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(hashPin(pin, salt).split(':')[1], 'hex'); const b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
export const validPin = (pin) => /^\d{4}$/.test(String(pin ?? ''));

/** Адрес для сравнения: IPv4 как есть, IPv6 — по первым 64 битам (домашняя сеть, а не устройство). */
export const ipKey = (ip) => {
  const v = String(ip ?? '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (!v.includes(':')) return v;
  const [head, tail] = v.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':');
};

/* ─── Кэш «включён ли PIN»: спрашивается на каждый запрос ─── */
const cache = new Map();
const CACHE_MS = 15_000;
const forget = (skyId) => cache.delete(skyId);
const enabledFor = async (skyId) => {
  const hit = cache.get(skyId);
  if (hit && hit.until > Date.now()) return hit.on;
  const { rows } = await query('SELECT ip_pin_enabled AS on FROM sky_ids WHERE id = $1', [skyId]);
  const on = Boolean(rows[0]?.on);
  cache.set(skyId, { on, until: Date.now() + CACHE_MS });
  return on;
};

/**
 * Закрыта ли эта сессия для этого адреса. Вызывается на каждом запросе (server.mjs) и при
 * подключении сокета (signal.mjs).
 */
export const pinRequired = async (skyId, sid, stored, ip) => {
  if (!(await enabledFor(skyId))) return false;
  const key = ipKey(ip);
  if (!key || key === ipKey(stored?.ip)) return false;
  return !(await sessionStore.ipKnown(sid, key));
};

const load = async (skyId) => {
  const { rows } = await query(
    `SELECT id, email, email_verified, two_factor_enabled, two_factor_method, two_factor_secret,
            ip_pin_enabled, ip_pin_hash, ip_pin_fails, ip_pin_locked_until
       FROM sky_ids WHERE id = $1`, [skyId]);
  return rows[0] ?? null;
};
const hasEmail = (r) => Boolean(r?.email && r.email_verified);
const hasTotp = (r) => Boolean(r?.two_factor_enabled && (r.two_factor_method ?? 'app') === 'app' && r.two_factor_secret);
const totpOk = (r, code) => {
  const secret = decryptSecret(r.two_factor_secret);
  return Boolean(secret) && verifyTotp(secret, String(code ?? '').replace(/\s+/g, ''));
};
const lockedFor = (r) => (r.ip_pin_locked_until && r.ip_pin_locked_until > new Date()
  ? Math.ceil((r.ip_pin_locked_until.getTime() - Date.now()) / 1000) : 0);

export const pinState = async (skyId) => {
  const r = await load(skyId);
  if (!r) return { error: 'not_found' };
  return {
    enabled: r.ip_pin_enabled, canEnable: hasEmail(r) && hasTotp(r),
    missing: { email: !hasEmail(r), authenticator: !hasTotp(r) },
    lockedFor: lockedFor(r),
  };
};

const notify = async (r, ruSubject, enSubject, ru, en) => {
  if (!hasEmail(r)) return;
  await sendEmail(r.email, L(ruSubject, enSubject), L(ru, en)).catch(() => {});
};

/** Включить PIN: нужны почта, аутентификатор и его код — чтобы чужая сессия не поставила свой PIN. */
export const enablePin = async (skyId, sid, ip, { pin, totp }) => {
  const r = await load(skyId);
  if (!r) return { error: 'not_found' };
  if (r.ip_pin_enabled) return { error: 'already_enabled' };
  if (!hasEmail(r)) return { error: 'email_required' };
  if (!hasTotp(r)) return { error: 'authenticator_required' };
  if (!validPin(pin)) return { error: 'bad_pin' };
  if (!totpOk(r, totp)) return { error: 'bad_code' };
  await query(`UPDATE sky_ids SET ip_pin_enabled = TRUE, ip_pin_hash = $2, ip_pin_fails = 0, ip_pin_locked_until = NULL, updated_at = now() WHERE id = $1`, [skyId, hashPin(pin)]);
  forget(skyId);
  await sessionStore.ipAllow(sid, ipKey(ip));
  await notify(r, 'PIN при смене IP включён', 'IP-change PIN enabled',
    'В вашем аккаунте Sky ID включён PIN-код при смене IP. Если это были не вы — смените пароль и завершите сессии в настройках Sky ID.',
    'The IP-change PIN was enabled on your Sky ID. If it was not you, change your password and end your sessions in Sky ID settings.');
  return { ok: true };
};

/** Общая проверка PIN с ограничением перебора. Возвращает { ok } или { error, … }. */
const guard = async (skyId, sid, pin) => {
  const r = await load(skyId);
  if (!r?.ip_pin_enabled) return { error: 'not_enabled' };
  const wait = lockedFor(r);
  if (wait) return { error: 'locked', lockedFor: wait };
  if (!validPin(pin)) return { error: 'bad_pin' };
  if (checkPin(pin, r.ip_pin_hash)) {
    if (r.ip_pin_fails) await query('UPDATE sky_ids SET ip_pin_fails = 0, ip_pin_locked_until = NULL WHERE id = $1', [skyId]);
    return { ok: true, row: r };
  }
  const { rows } = await query('UPDATE sky_ids SET ip_pin_fails = ip_pin_fails + 1 WHERE id = $1 RETURNING ip_pin_fails AS f', [skyId]);
  const fails = rows[0]?.f ?? 1;
  let lockSec = 0;
  if (fails >= LOCK_AFTER && fails % LOCK_AFTER === 0) {
    lockSec = Math.min(24 * 3600, 15 * 60 * 2 ** (fails / LOCK_AFTER - 1));
    await query(`UPDATE sky_ids SET ip_pin_locked_until = now() + ($2 || ' seconds')::interval WHERE id = $1`, [skyId, String(lockSec)]);
  }
  if (fails >= KILL_AFTER) {
    await sessionStore.revoke(sid);
    await notify(r, 'Подбор PIN-кода', 'PIN guessing',
      'Кто-то подбирал PIN-код вашего аккаунта Sky ID с нового адреса. Сессия, с которой подбирали, завершена, ввод заблокирован. Если это были не вы — смените пароль.',
      'Someone was guessing the PIN of your Sky ID from a new address. That session was ended and entry is locked. If it was not you, change your password.');
    return { error: 'session_ended' };
  }
  return lockSec ? { error: 'locked', lockedFor: lockSec } : { error: 'wrong_pin', left: LOCK_AFTER - (fails % LOCK_AFTER) };
};

/** Ввод PIN с нового адреса: адрес запоминается для этой сессии. */
export const verifyPin = async (skyId, sid, ip, pin) => {
  const g = await guard(skyId, sid, pin);
  if (!g.ok) return g;
  await sessionStore.ipAllow(sid, ipKey(ip));
  return { ok: true };
};

export const changePin = async (skyId, sid, { pin, newPin }) => {
  if (!validPin(newPin)) return { error: 'bad_pin' };
  const g = await guard(skyId, sid, pin);
  if (!g.ok) return g;
  await query('UPDATE sky_ids SET ip_pin_hash = $2, updated_at = now() WHERE id = $1', [skyId, hashPin(newPin)]);
  return { ok: true };
};

export const disablePin = async (skyId, sid, { pin }) => {
  const g = await guard(skyId, sid, pin);
  if (!g.ok) return g;
  await query('UPDATE sky_ids SET ip_pin_enabled = FALSE, ip_pin_hash = NULL, ip_pin_fails = 0, ip_pin_locked_until = NULL, updated_at = now() WHERE id = $1', [skyId]);
  forget(skyId);
  await notify(g.row, 'PIN при смене IP выключен', 'IP-change PIN disabled',
    'В вашем аккаунте Sky ID выключен PIN-код при смене IP. Если это были не вы — смените пароль и завершите сессии.',
    'The IP-change PIN was disabled on your Sky ID. If it was not you, change your password and end your sessions.');
  return { ok: true };
};

/* ─── Сброс забытого PIN: код на почту И код аутентификатора ─── */
const codeHash = (skyId, code) => crypto.createHash('sha256').update(`${config.jwtSecret}:ip-pin-reset:${skyId}:${code}`).digest('hex');

export const startReset = async (skyId) => {
  const r = await load(skyId);
  if (!r?.ip_pin_enabled) return { error: 'not_enabled' };
  if (!hasEmail(r)) return { error: 'email_required' };
  if (!hasTotp(r)) return { error: 'authenticator_required' };
  if (!rateLimitPerHour(`ippin:reset:${skyId}`, 5)) return { error: 'too_many_requests' };
  await query('UPDATE ip_pin_resets SET used_at = now() WHERE sky_id = $1 AND used_at IS NULL', [skyId]);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await query(
    `INSERT INTO ip_pin_resets (id, sky_id, code_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`,
    [`ipr-${crypto.randomUUID()}`, skyId, codeHash(skyId, code), String(RESET_TTL_MIN)]);
  const sent = await sendEmail(r.email, L('Сброс PIN-кода Sky ID', 'Sky ID PIN reset'),
    L(`Код для сброса PIN-кода: ${code}\n\nДля сброса понадобится ещё и код из приложения-аутентификатора. Код действует ${RESET_TTL_MIN} минут. Если вы ничего не запрашивали — проигнорируйте письмо и смените пароль.`,
      `PIN reset code: ${code}\n\nYou will also need the code from your authenticator app. The code is valid for ${RESET_TTL_MIN} minutes. If you did not ask for it, ignore this email and change your password.`))
    .catch((e) => ({ ok: false, error: e.message }));
  if (sent && sent.ok === false) return { error: 'email_failed' };
  return { ok: true, expiresIn: RESET_TTL_MIN * 60, emailHint: r.email.replace(/^(.).*(@.*)$/, '$1•••$2') };
};

/**
 * Сброс: верны оба кода — PIN снимается или заменяется на новый. Нужны ОБА фактора сразу; при
 * любой ошибке не сказано, какой из них неверный — подбирать по одному не получится.
 */
export const finishReset = async (skyId, sid, ip, { emailCode, totp, newPin }) => {
  const r = await load(skyId);
  if (!r?.ip_pin_enabled) return { error: 'not_enabled' };
  if (!hasTotp(r)) return { error: 'authenticator_required' };
  if (newPin != null && newPin !== '' && !validPin(newPin)) return { error: 'bad_pin' };
  const { rows } = await query(
    `SELECT * FROM ip_pin_resets WHERE sky_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [skyId]);
  const req = rows[0];
  if (!req) return { error: 'no_request' };
  if (req.attempts >= RESET_ATTEMPTS) {
    await query('UPDATE ip_pin_resets SET used_at = now() WHERE id = $1', [req.id]);
    return { error: 'no_request' };
  }
  const code = String(emailCode ?? '').replace(/\s+/g, '');
  const a = Buffer.from(codeHash(skyId, code), 'hex'); const b = Buffer.from(req.code_hash, 'hex');
  const emailGood = /^\d{6}$/.test(code) && crypto.timingSafeEqual(a, b);
  const totpGood = totpOk(r, totp);
  if (!(emailGood && totpGood)) {
    const left = RESET_ATTEMPTS - (await query('UPDATE ip_pin_resets SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts', [req.id])).rows[0].attempts;
    return { error: 'bad_codes', left: Math.max(0, left) };
  }
  await query('UPDATE ip_pin_resets SET used_at = now() WHERE id = $1', [req.id]);
  if (newPin) {
    await query('UPDATE sky_ids SET ip_pin_hash = $2, ip_pin_fails = 0, ip_pin_locked_until = NULL, updated_at = now() WHERE id = $1', [skyId, hashPin(newPin)]);
  } else {
    await query('UPDATE sky_ids SET ip_pin_enabled = FALSE, ip_pin_hash = NULL, ip_pin_fails = 0, ip_pin_locked_until = NULL, updated_at = now() WHERE id = $1', [skyId]);
  }
  forget(skyId);
  await sessionStore.ipAllow(sid, ipKey(ip));
  await notify(r, 'PIN-код сброшен', 'PIN reset',
    newPin ? 'PIN-код вашего аккаунта Sky ID сброшен и заменён новым (подтверждено кодом с почты и из аутентификатора).'
      : 'PIN-код вашего аккаунта Sky ID сброшен и выключен (подтверждено кодом с почты и из аутентификатора).',
    newPin ? 'The PIN of your Sky ID was reset and replaced (confirmed with the email and authenticator codes).'
      : 'The PIN of your Sky ID was reset and turned off (confirmed with the email and authenticator codes).');
  return { ok: true, enabled: Boolean(newPin) };
};

export const sweepIpPin = async () => {
  await query("DELETE FROM ip_pin_resets WHERE created_at < now() - interval '2 days'");
};
