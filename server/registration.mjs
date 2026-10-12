/**
 * Ограничение регистрации новых аккаунтов (Sky ID).
 *
 * Работает ТОЛЬКО в момент создания Sky ID (`ensureSkyId*` в skyid.mjs): вход в существующий аккаунт, привязка
 * почты и телефона, профили и всё прочее не затрагиваются. Проверка и вставка идут в одной транзакции под
 * advisory-замком, поэтому два одновременных запроса не проскочат мимо предела.
 *
 * Что можно ограничить (редактирует сотрудник с правом `registration`, правка пишется в журнал администрации):
 *   • вкл/выкл — пока выключено, новые аккаунты не создаются;
 *   • предел за последние 24 часа на всю платформу;
 *   • предел на один адрес за N часов (хранится только хеш адреса);
 *   • своё сообщение людям вместо стандартного.
 * Всё считается по настоящим строкам `sky_ids`; выдуманных цифр нет.
 */
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { config } from './config.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';

const LOCK_KEY = 7_340_122;
const MAX_MESSAGE = 300;
const ipHash = (ip) => (ip ? crypto.createHmac('sha256', `${config.jwtSecret}:reg-ip:v1`).update(String(ip)).digest('hex') : null);
const num = (v, min, max, def) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };

export const loadSettings = async () => (await query('SELECT * FROM registration_settings WHERE id')).rows[0]
  ?? { enabled: true, daily_limit: 0, per_ip_limit: 0, per_ip_hours: 24, message: '' };

const countDay = async (c = pool) => Number((await c.query(`SELECT count(*) FROM sky_ids WHERE created_at > now() - interval '24 hours'`)).rows[0].count);

/** Для экрана входа (без сессии): можно ли сейчас завести новый аккаунт и что сказать человеку. */
export const publicStatus = async () => {
  const s = await loadSettings();
  const full = s.daily_limit > 0 && (await countDay()) >= s.daily_limit;
  const open = s.enabled && !full;
  return { open, message: open ? '' : s.message, reason: open ? null : (!s.enabled ? 'closed' : 'daily_limit') };
};

const refuse = async (reason, s) => {
  await query('INSERT INTO registration_blocked (reason) VALUES ($1)', [reason]);
  throw Object.assign(new Error(`registration_${reason}`), { status: 403, code: `registration_${reason}`, message: s.message || '' });
};

/**
 * Создаёт Sky ID, если предел позволяет. `insert(client)` выполняет сам INSERT и возвращает строку (или null при конфликте).
 * Возвращает то, что вернул insert.
 */
export const registerLimited = async (ip, insert) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    const s = (await client.query('SELECT * FROM registration_settings WHERE id')).rows[0]
      ?? { enabled: true, daily_limit: 0, per_ip_limit: 0, per_ip_hours: 24, message: '' };
    const h = ipHash(ip);
    let deny = null;
    if (!s.enabled) deny = 'closed';
    else if (s.daily_limit > 0 && (await countDay(client)) >= s.daily_limit) deny = 'daily_limit';
    else if (s.per_ip_limit > 0 && h) {
      const n = Number((await client.query(
        `SELECT count(*) FROM sky_ids WHERE reg_ip_hash = $1 AND created_at > now() - ($2 || ' hours')::interval`, [h, String(s.per_ip_hours)])).rows[0].count);
      if (n >= s.per_ip_limit) deny = 'ip_limit';
    }
    if (deny) { await client.query('ROLLBACK'); return refuse(deny, s); }
    const row = await insert(client);
    if (row && h) await client.query('UPDATE sky_ids SET reg_ip_hash = $2 WHERE id = $1', [row.id, h]);
    await client.query('COMMIT');
    return row;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

/* ── Админка ─────────────────────────────────────────────────────── */

const view = (s) => ({ enabled: s.enabled, dailyLimit: s.daily_limit, perIpLimit: s.per_ip_limit, perIpHours: s.per_ip_hours, message: s.message,
  updatedAt: s.updated_at?.toISOString?.() ?? null });

export const adminOverview = async (actorId) => {
  if (!(await can(actorId, 'registration'))) return null;
  const s = await loadSettings();
  const c = (await query(
    `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS h1,
            count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS h24,
            count(*) FILTER (WHERE created_at > now() - interval '7 days') AS d7,
            count(*) AS total FROM sky_ids`)).rows[0];
  const b = (await query(
    `SELECT reason, count(*)::int AS n FROM registration_blocked WHERE at > now() - interval '24 hours' GROUP BY reason`)).rows;
  const blocked = { closed: 0, daily_limit: 0, ip_limit: 0 };
  for (const r of b) blocked[r.reason] = r.n;
  return {
    settings: view(s),
    stats: { lastHour: Number(c.h1), last24h: Number(c.h24), last7d: Number(c.d7), total: Number(c.total), blocked24h: blocked },
    open: s.enabled && !(s.daily_limit > 0 && Number(c.h24) >= s.daily_limit),
  };
};

export const adminSave = async (actorId, body, meta) => {
  if (!(await can(actorId, 'registration'))) return { error: 'not_allowed' };
  const cur = await loadSettings();
  const next = {
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : cur.enabled,
    daily_limit: num(body?.dailyLimit, 0, 1_000_000, cur.daily_limit),
    per_ip_limit: num(body?.perIpLimit, 0, 10_000, cur.per_ip_limit),
    per_ip_hours: num(body?.perIpHours, 1, 720, cur.per_ip_hours),
    message: body?.message === undefined ? cur.message : String(body.message).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_MESSAGE),
  };
  await query(
    `UPDATE registration_settings SET enabled=$1, daily_limit=$2, per_ip_limit=$3, per_ip_hours=$4, message=$5, updated_by=$6, updated_at=now() WHERE id`,
    [next.enabled, next.daily_limit, next.per_ip_limit, next.per_ip_hours, next.message, actorId]);
  await logAdmin({
    actorId, targetType: 'system', type: 'registration_settings',
    detail: `${next.enabled ? 'открыта' : 'закрыта'}; в сутки ${next.daily_limit || '∞'}; с адреса ${next.per_ip_limit || '∞'}/${next.per_ip_hours} ч`, meta,
  });
  return { ok: true, settings: view(await loadSettings()) };
};
