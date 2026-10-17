/**
 * Sky Recovery — общие помощники: случайные значения, хеши, история, журнал безопасности, уведомления, пределы попыток.
 *
 * Принципы системы восстановления (подробно — CLAUDE.md, раздел «Sky Recovery»):
 *  • никаких универсальных ключей: каждое средство привязано к одному аккаунту, одноразово или отзывается;
 *  • в базе только хеши; открытое значение существует в письме, на экране «один раз» или не существует вовсе;
 *  • в журнал и историю не пишутся пароли, токены, коды и секреты — только тип фактора и результат;
 *  • ответы публичных ручек одинаковы для существующего и несуществующего аккаунта.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { config } from './config.mjs';
import { macOf } from './crypto.mjs';
import { sendEmail } from './notify.mjs';
import { logEvent } from './skylog.mjs';
import { notifyGift } from './giftnotify.mjs';
import { L } from './lang.mjs';

export const newId = (p) => `${p}-${crypto.randomBytes(12).toString('hex')}`;
/** Секрет, который вообще не угадать: 32 байта, base64url. */
export const randomSecret = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
/** Хеш секрета для хранения (HMAC с серверным ключом: утечка таблицы без ключа ничего не даёт). */
export const hashSecret = (label, value) => macOf(`recovery:${label}`, String(value ?? ''));
export const safeEqual = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export const ipHash = (ip) => (ip ? crypto.createHmac('sha256', config.jwtSecret).update(`recovery-ip:${ip}`).digest('hex').slice(0, 24) : '');
export const maskEmail = (email) => { const v = String(email ?? ''); const at = v.indexOf('@'); return at < 1 ? '' : `${v[0]}***${v.slice(at)}`; };
export const normEmail = (e) => String(e ?? '').trim().toLowerCase();
export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** Адрес сайта восстановления. Задаётся RECOVERY_ORIGIN, иначе https://recovery.<домен основного сайта без web.>. */
export const recoveryOrigin = () => {
  if (process.env.RECOVERY_ORIGIN) return String(process.env.RECOVERY_ORIGIN).replace(/\/+$/, '');
  return 'https://recovery.skymessenger.online';
};
export const appOrigin = () => config.publicOrigin || recoveryOrigin().replace('recovery.', 'web.');

/* ── Пределы попыток, переживающие перезапуск (таблица recovery_attempts) ── */
/** Записывает попытку и говорит, укладывается ли ключ в max за окно. */
export const attempt = async (key, max, windowSec) => {
  const { rows } = await query(`SELECT count(*)::int AS n FROM recovery_attempts WHERE key = $1 AND at > now() - ($2 || ' seconds')::interval`, [key, String(windowSec)]);
  if ((rows[0]?.n ?? 0) >= max) return false;
  await query('INSERT INTO recovery_attempts (key) VALUES ($1)', [key]);
  return true;
};
export const sweepAttempts = () => query(`DELETE FROM recovery_attempts WHERE at < now() - interval '2 days'`);

/* ── История и журнал ── */
/** Событие восстановления: видно человеку («История восстановления») и пишется в журнал безопасности. Секретов не принимает. */
export const record = async ({ skyId = null, requestId = null, kind = 'user', event, factor = '', result = 'ok', ip = '', detail = '', level }) => {
  try {
    await query('INSERT INTO recovery_history (sky_id, request_id, kind, event, factor, result, ip_hash, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [skyId, requestId, kind, String(event).slice(0, 60), String(factor).slice(0, 30), result, ipHash(ip), String(detail).slice(0, 200)]);
  } catch (e) { console.error('[recovery] история:', e.message); }
  logEvent({ category: 'security', service: 'recovery', type: `recovery_${event}`.slice(0, 80), actorId: null, targetId: skyId, result: result === 'ok' ? 'ok' : result === 'denied' ? 'denied' : 'error',
    level: level ?? (result === 'ok' ? 'INFO' : 'WARN'), ip, detail: { kind, factor, requestId } });
};

export const historyFor = async (skyId, limit = 30) => {
  const { rows } = await query('SELECT kind, event, factor, result, created_at FROM recovery_history WHERE sky_id = $1 ORDER BY id DESC LIMIT $2', [skyId, limit]);
  return rows.map((r) => ({ kind: r.kind, event: r.event, factor: r.factor || undefined, result: r.result, at: r.created_at.toISOString() }));
};

/* ── Уведомления ── */
const sky = async (id) => (await query('SELECT id, email, email_verified, phone FROM sky_ids WHERE id = $1', [id])).rows[0] ?? null;
const profilesOf = async (skyId) => (await query('SELECT id FROM profiles WHERE sky_id = $1 AND deleted_at IS NULL', [skyId])).rows.map((r) => r.id);

/**
 * Сообщить владельцу аккаунта о событии безопасности: письмо на основную и (если она годится) резервную почту + запись в «Уведомлениях» (push — через неё).
 * Текст не содержит секретов; ссылки (если есть) передаёт вызывающий.
 */
export const notifyAccount = async (skyId, { title, text, links = '', both = true, refId = null }) => {
  const row = await sky(skyId); if (!row) return;
  const body = `${text}\n\n${links ? `${links}\n\n` : ''}${L('Если это были не вы — зайдите в Профиль → Sky ID → Безопасность и восстановление и завершите чужие сессии. Официальный сайт: ', 'If this was not you, open Profile → Sky ID → Security and recovery and end unknown sessions. Official site: ')}${recoveryOrigin()}`;
  const targets = new Set();
  if (row.email && row.email_verified) targets.add(row.email);
  if (both) {
    const { rows } = await query('SELECT email FROM sky_backup_emails WHERE sky_id = $1 AND email IS NOT NULL', [skyId]);
    if (rows[0]?.email) targets.add(rows[0].email);
  }
  for (const to of targets) sendEmail(to, `Sky — ${title}`, body).catch((e) => console.error('[recovery] письмо:', e.message));
  for (const pid of await profilesOf(skyId)) notifyGift(pid, 'security', title, String(text).slice(0, 200), refId).catch(() => {});
};

export const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
