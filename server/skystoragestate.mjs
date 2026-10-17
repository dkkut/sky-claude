/**
 * Sky Storage — независимые состояния хранилища и серверные «ворота».
 *
 * Состояния хранятся ОТДЕЛЬНО (строка storage_state, поле на каждое), а не одним переключателем:
 *   emergency     — аварийное отключение;
 *   maintenance   — технические работы (safe — дать операциям завершиться; emergency — остановить);
 *   skyAuth       — обязательная серверная авторизация Sky для доступа к хранилищу;
 *   restrictions  — активные ограничения безопасности, у каждого причина, инициатор, время, критичность.
 * Строгость определяется при каждой проверке: наиболее строгое активное ограничение выигрывает, а
 * снятие одного состояния НИКОГДА не меняет остальные. Изменения идут по версии (оптимистичная
 * блокировка): два администратора не перезапишут друг друга вслепую — второй получит conflict.
 *
 * Ворота (assertRead/assertWrite) вызываются ИЗ слоя шифрования медиа и из вложений мессенджера, то
 * есть на сервере для каждого обращения к файлам; интерфейс ничего не решает.
 */
import crypto from 'node:crypto';
import { statfs } from 'node:fs/promises';
import { query, pool } from './db.mjs';
import { config } from './config.mjs';
import { sendEmail } from './notify.mjs';
import { logEvent as skyLog } from './skylog.mjs';

export class StorageBlocked extends Error {
  constructor(code, message = '') { super(code); this.name = 'StorageBlocked'; this.code = code; this.userMessage = message; this.status = 503; }
}

export const DEFAULT_SETTINGS = {
  thresholds: { warn: 70, critical: 85, block: 95, full: 100 },
  totalBytes: null,                 // общий допустимый объём; null — по размеру диска данных
  reserveFreeBytes: 512 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024 * 1024,
  maxFiles: null,
  maxConcurrentUploads: 6,
  maxConcurrentIO: 64,
  maxBackgroundJobs: 1,
  uploadsPerMinute: 240,
  approvalTimeoutMin: 10,
  approvalScope: 'every_login',     // every_login — каждый вход в управление подтверждает владелец (как SSH); admin — только новое устройство; off — не требовать
  approvalValidMin: 480,            // сколько минут действует подтверждённый вход (every_login)
  approvalRiskThreshold: 1,
  skyAuthMaxTicketMin: 120,         // в режиме строгой авторизации пропуск старше этого срока недействителен
  backupRequiredForEnable: false,
  retention: { days: 30, maxBytes: null, minKeep: 2 },
  quarantineDays: 14,
  downloadLinkMinutes: 15,
  notifyEmail: true,
};

let cache = null;               // последняя прочитанная строка
let cacheAt = 0;
const TTL_MS = 2000;

const rowToState = (r) => ({
  version: Number(r.version), emergency: r.emergency ?? { active: false }, maintenance: r.maintenance ?? { active: false },
  skyAuth: r.sky_auth ?? { active: false }, restrictions: Array.isArray(r.restrictions) ? r.restrictions : [],
  ticketEpoch: Number(r.ticket_epoch ?? 0), settings: mergeSettings(r.settings), updatedBy: r.updated_by, updatedAt: r.updated_at,
});

const mergeSettings = (s) => ({
  ...DEFAULT_SETTINGS, ...(s ?? {}),
  thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(s?.thresholds ?? {}) },
  retention: { ...DEFAULT_SETTINGS.retention, ...(s?.retention ?? {}) },
});

export const loadState = async (force = false) => {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache;
  const { rows } = await query('SELECT * FROM storage_state WHERE id = 1');
  cache = rowToState(rows[0] ?? { version: 1 });
  cacheAt = Date.now();
  return cache;
};

/** Синхронный снимок для горячего пути; если ещё не читали — самые строгие допущения не делаем, но и не блокируем вслепую. */
export const snapshot = () => cache;
let timer = null;
export const startStateWatcher = () => {
  if (timer) return;
  loadState(true).catch(() => {});
  timer = setInterval(() => { loadState(true).catch(() => {}); }, TTL_MS);
  timer.unref?.();
};

/** Отметка «не раньше»: все пропуски, выданные до неё, недействительны (читают ticket-модули). */
export const ticketEpoch = () => cache?.ticketEpoch ?? 0;
export const strictTicketMaxAgeSec = () => (cache?.skyAuth?.active ? Math.max(5, Number(cache.settings.skyAuthMaxTicketMin) || 120) * 60 : 0);

/**
 * Проверка пропуска (подпись уже проверена модулем сервиса). `exp` — срок его действия, `ttlSec` — полный
 * срок жизни, отсюда «возраст». Возвращает false, если пропуск выдан до отметки эпохи или слишком стар в строгом режиме.
 */
let lastDeniedLog = 0;
const noteDenied = (why) => {
  counters.ticketDenied += 1;
  if (Date.now() - lastDeniedLog > 60_000) { lastDeniedLog = Date.now(); void logEvent('ticket_denied', 'warn', { why, total: counters.ticketDenied }); }
};
export const ticketAcceptable = (exp, ttlSec) => {
  if (!cache) return true;
  const issued = exp - ttlSec;
  if (issued < cache.ticketEpoch) { noteDenied('epoch'); return false; }
  const max = strictTicketMaxAgeSec();
  if (max && Math.floor(Date.now() / 1000) - issued > max) { noteDenied('strict_age'); return false; }
  return true;
};

/* ─── Вычисление «что сейчас можно» ───────────────────────────────── */

export const effective = (st = cache) => {
  if (!st) return { read: true, write: true, connections: true, reasons: [] };
  const reasons = [];
  let read = true; let write = true; let connections = true;
  const rs = st.restrictions;
  if (st.emergency.active) {
    reasons.push({ code: 'emergency', text: 'Аварийное отключение хранилища' });
    write = false; if ((st.emergency.mode ?? 'full') === 'full') read = false; connections = false;
  }
  if (st.maintenance.active) {
    reasons.push({ code: 'maintenance', text: `Технические работы (${st.maintenance.mode === 'emergency' ? 'аварийная остановка' : 'безопасное обслуживание'})` });
    write = false; if (st.maintenance.mode === 'emergency') read = false;
  }
  for (const r of rs) {
    if (r.kind === 'lock_all') { read = false; write = false; connections = false; reasons.push({ code: r.kind, text: r.reason }); }
    else if (r.kind === 'readonly') { write = false; reasons.push({ code: r.kind, text: r.reason }); }
    else if (r.kind === 'compromise') { write = false; connections = false; reasons.push({ code: r.kind, text: r.reason }); }
    else if (r.kind === 'no_new_connections') { connections = false; reasons.push({ code: r.kind, text: r.reason }); }
  }
  if (!read) write = false;
  return { read, write, connections, reasons };
};

/* ─── Ворота ──────────────────────────────────────────────────────── */

export const counters = { reads: 0, writes: 0, readsBlocked: 0, writesBlocked: 0, ticketDenied: 0, authDenied: 0, uploadsOk: 0, uploadsFailed: 0, downloadsOk: 0 };

export const assertRead = () => {
  const e = effective();
  if (!e.read) { counters.readsBlocked += 1; throw new StorageBlocked('storage_unavailable', 'Хранилище временно недоступно.'); }
  counters.reads += 1;
};
export const assertWrite = () => {
  const e = effective();
  if (!e.write) { counters.writesBlocked += 1; throw new StorageBlocked(cache?.maintenance?.active && !cache?.emergency?.active ? 'storage_maintenance' : 'storage_unavailable', 'Загрузка файлов сейчас недоступна.'); }
  counters.writes += 1;
};

/* ─── Журнал и уведомления ────────────────────────────────────────── */

export const logEvent = async (kind, level = 'info', detail = {}, actorId = null) => {
  const safe = JSON.stringify(detail, (k, v) => (/secret|token|password|key$/i.test(k) ? '[скрыто]' : v));
  // Копия в единый журнал событий (Sky Admin → Журналы): уровень берётся из уровня события хранилища.
  skyLog({ category: level === 'critical' || /(access|unlock|denied|key|emergency)/.test(kind) ? 'security' : 'server', service: 'storage', type: `storage_${kind}`.slice(0, 80), level: level === 'critical' ? 'CRITICAL' : level === 'error' ? 'ERROR' : level === 'warn' || level === 'warning' ? 'WARN' : 'INFO', actorId, result: level === 'critical' || level === 'error' ? 'error' : 'ok', detail });
  await query('INSERT INTO storage_events (kind, level, detail, actor_id) VALUES ($1,$2,$3::jsonb,$4)', [kind, level, safe, actorId]).catch((e) => console.error('[storage] журнал:', e.message));
};

const ownerRows = async () => {
  const name = String(config.ownerUsername ?? '').trim().toLowerCase();
  if (!name) return [];
  const { rows } = await query(
    `SELECT p.id, s.email, s.email_verified FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE lower(p.username) = $1`, [name]);
  return rows;
};
export const ownerIds = async () => (await ownerRows()).map((r) => r.id);

const lastSent = new Map();
/** Уведомление владельцу: группировка и ограничение частоты (одно и то же — не чаще раза в 10 минут). Без секретов. */
export const notifyOwners = async (key, title, body, { critical = false } = {}) => {
  const now = Date.now();
  const prev = lastSent.get(key);
  if (prev && now - prev.at < 10 * 60_000) { prev.n += 1; return false; }
  const extra = prev?.n ? ` (повторов за это время: ${prev.n})` : '';
  lastSent.set(key, { at: now, n: 0 });
  try {
    const { notifyGift } = await import('./giftnotify.mjs');
    const { pushToOffline } = await import('./webpush.mjs');
    for (const o of await ownerRows()) {
      await notifyGift(o.id, 'storage', title, `${body}${extra}`, `storage:${key}:${Math.floor(now / 600000)}`).catch(() => {});
      void pushToOffline([o.id], { title, body: String(body).slice(0, 140), url: '/', tag: `storage:${key}` }).catch(() => {});
      if ((critical || cache?.settings?.notifyEmail) && o.email && o.email_verified && critical) {
        await sendEmail(o.email, `Sky Storage: ${title}`, `${body}${extra}\n\nОткройте панель администратора → Sky Storage. В письме нет ключей и токенов.`).catch(() => {});
      }
    }
  } catch (e) { console.error('[storage] уведомление:', e.message); }
  return true;
};

/* ─── Изменение состояния (версия + аудит) ─────────────────────────── */

export class Conflict extends Error { constructor() { super('conflict'); this.code = 'conflict'; } }

/**
 * Применить изменение к строке состояния. `mutate(state)` возвращает набор колонок для записи.
 * Запись идёт только если версия не изменилась (иначе Conflict) — «последний писатель» не затирает чужое.
 */
export const mutateState = async (actorId, expectedVersion, mutate) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM storage_state WHERE id = 1 FOR UPDATE');
    const before = rowToState(rows[0]);
    if (expectedVersion !== undefined && expectedVersion !== null && Number(expectedVersion) !== before.version) { await client.query('ROLLBACK'); throw new Conflict(); }
    const patch = await mutate(before);
    if (!patch) { await client.query('ROLLBACK'); return { state: before, changed: false }; }
    const cols = []; const args = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!['emergency', 'maintenance', 'sky_auth', 'restrictions', 'ticket_epoch', 'settings'].includes(k)) throw new Error('bad_column');
      args.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
      cols.push(`${k} = $${args.length}${typeof v === 'object' && v !== null ? '::jsonb' : ''}`);
    }
    args.push(actorId ?? null);
    const { rows: after } = await client.query(
      `UPDATE storage_state SET ${cols.join(', ')}, version = version + 1, updated_by = $${args.length}, updated_at = now() WHERE id = 1 RETURNING *`, args);
    await client.query('COMMIT');
    cache = rowToState(after[0]); cacheAt = Date.now();
    return { state: cache, before, changed: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
};

export const newId = (p = 'r') => `${p}-${crypto.randomBytes(8).toString('hex')}`;

/* ─── Объём и пороги ───────────────────────────────────────────────── */

export const diskInfo = async (dir = process.env.MUSIC_DIR ? process.env.MUSIC_DIR.replace(/\/[^/]+$/, '') : '/data') => {
  try { const s = await statfs(dir); return { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) }; }
  catch { try { const s = await statfs('/'); return { total: Number(s.blocks) * Number(s.bsize), free: Number(s.bavail) * Number(s.bsize) }; } catch { return { total: 0, free: 0 }; } }
};

/** Уровень заполнения: ok | warn | critical | block | full — по настраиваемым порогам. */
export const levelFor = (usedPct, th) => (usedPct >= th.full ? 'full' : usedPct >= th.block ? 'block' : usedPct >= th.critical ? 'critical' : usedPct >= th.warn ? 'warn' : 'ok');
