/**
 * Sky Blox: настраиваемые ограничения, состояние нагрузки и метрики.
 *
 * Все пределы действуют на сервере и читаются из blox_settings (с
 * кэшем на несколько секунд, чтобы не ходить в базу на каждый запрос).
 * Метрики — настоящие: загрузка и память процесса/машины, диск, сетевые
 * счётчики из /proc/net/dev, пул соединений с базой, задержка цикла
 * событий, число запросов и ошибок по счётчикам самого сервера. Если
 * показатель получить нельзя (не Linux, нет прав), он помечается как
 * недоступный, а не подменяется числом.
 */
import os from 'node:os';
import fs from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { query, pool } from './db.mjs';

/** Ключ → [умолчание, минимум, максимум, подпись]. Числа — целые. */
export const LIMITS = {
  maxUploadBytes:      [5 * 1024 * 1024, 64 * 1024, 25 * 1024 * 1024, 'Максимальный размер картинки, байт'],
  maxBodyBytes:        [256 * 1024, 4 * 1024, 2 * 1024 * 1024, 'Максимальный размер JSON-запроса, байт'],
  maxProjectsPerDev:   [5, 1, 200, 'Игровых проектов на разработчика'],
  maxServersPerDev:    [3, 0, 100, 'Подключённых серверов на разработчика'],
  maxPlacesPerGame:    [20, 1, 500, 'Плейсов на игру'],
  maxProductsPerGame:  [100, 0, 5000, 'Товаров в магазине игры'],
  apiRpmPerGame:       [120, 10, 6000, 'Запросов в минуту от игрового сервера'],
  userRpm:             [120, 20, 3000, 'Запросов в минуту от игрока к Blox'],
  maxConcurrentProbes: [4, 1, 50, 'Одновременных проверок серверов'],
  probeTimeoutMs:      [6000, 1000, 30000, 'Время ожидания ответа сервера, мс'],
  maxBgJobs:           [2, 1, 20, 'Параллельных фоновых задач'],
  probeIntervalMin:    [30, 5, 1440, 'Частота фоновых проверок доступности, мин'],
  manualProbeCooldownSec: [30, 5, 3600, 'Пауза между ручными проверками одного сервера, сек'],
  reviewsPerDay:       [10, 1, 200, 'Отзывов на игрока в сутки'],
  reportsPerDay:       [10, 1, 200, 'Жалоб на игрока в сутки'],
  reviewMinPlaySec:    [60, 0, 86400, 'Сколько секунд после первого запуска можно оставить отзыв'],
  launchesPerMinute:   [30, 1, 600, 'Запусков игр в минуту на игрока'],
  intentTtlSec:        [900, 60, 86400, 'Срок жизни запроса на покупку, сек'],
  launchTokenTtlSec:   [120, 30, 3600, 'Срок жизни токена запуска, сек'],
  commissionPercent:   [0, 0, 90, 'Комиссия платформы с каждой покупки, %'],
  payoutFeePercent:    [15, 0, 90, 'Удержание при выплате баллов разработчику, %'],
  holdDays:            [14, 0, 180, 'Удержание вознаграждения до доступности, дней'],
  minPayoutPoints:     [1000, 1, 10_000_000, 'Минимальная заявка на выплату, баллов'],
  payoutsEnabled:      [1, 0, 1, 'Выплата баллов разработчикам (1 — включена)'],
};

/** Финансовые параметры: меняет только финансовый сотрудник с подтверждением личности. */
export const FINANCE_KEYS = ['commissionPercent', 'payoutFeePercent', 'holdDays', 'minPayoutPoints', 'payoutsEnabled'];

let cache = { at: 0, values: null };
const TTL = 5000;

export const loadLimits = async (force = false) => {
  if (!force && cache.values && Date.now() - cache.at < TTL) return cache.values;
  const out = {};
  for (const [k, v] of Object.entries(LIMITS)) out[k] = v[0];
  try {
    const { rows } = await query('SELECT key, value FROM blox_settings');
    for (const r of rows) {
      const spec = LIMITS[r.key];
      if (spec && Number.isInteger(r.value) && r.value >= spec[1] && r.value <= spec[2]) out[r.key] = r.value;
    }
  } catch { /* таблицы может ещё не быть до миграции — берём умолчания */ }
  cache = { at: Date.now(), values: out };
  return out;
};

export const limit = async (key) => (await loadLimits())[key];

export const setLimit = async (actorId, key, value) => {
  const spec = LIMITS[key];
  if (!spec) return { error: 'bad_key' };
  if (!Number.isInteger(value) || value < spec[1] || value > spec[2]) return { error: 'bad_value', min: spec[1], max: spec[2] };
  await query(
    `INSERT INTO blox_settings (key, value, updated_by, updated_at) VALUES ($1,$2::jsonb,$3,now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_by = $3, updated_at = now()`,
    [key, JSON.stringify(value), actorId]);
  cache = { at: 0, values: null };
  return { ok: true };
};

/** Уровень доверия умножает квоты проектов и серверов. */
export const trustMultiplier = (level) => [1, 2, 4][level] ?? 1;

/* ─── Состояние нагрузки ───────────────────────────────────────────── */

const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

let counters = { total: 0, errors5xx: 0, errors4xx: 0, ms: 0, since: Date.now() };
const recent = []; // последние длительности для медианы/p95

export const recordRequest = (status, ms) => {
  counters.total += 1;
  counters.ms += ms;
  if (status >= 500) counters.errors5xx += 1;
  else if (status >= 400) counters.errors4xx += 1;
  recent.push(ms);
  if (recent.length > 500) recent.shift();
};

const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

/**
 * 0 — нормально, 1 — занято, 2 — критично. Решение принимается по двум
 * независимым признакам: задержка цикла событий (процесс не успевает) и
 * загрузка машины на ядро.
 */
let levelFloor = () => 0;
/** Sky Resource Optimizer поднимает уровень (но не опускает ниже собственных измерений). */
export const setLevelFloor = (fn) => { levelFloor = typeof fn === 'function' ? fn : () => 0; };
let fwFloor = () => 0;
/** Файрвол (уровни «Тревога»/«Атака») откладывает необязательные работы так же, как высокая нагрузка. */
export const setFirewallFloor = (fn) => { fwFloor = typeof fn === 'function' ? fn : () => 0; };
export const loadLevel = () => Math.max(ownLevel(), levelFloor() | 0, fwFloor() | 0);
const ownLevel = () => {
  const lagMs = lag.mean / 1e6; // нс → мс
  const p99 = lag.percentile(99) / 1e6;
  const ratio = os.loadavg()[0] / Math.max(1, os.cpus().length);
  if (p99 > 1000 || ratio > 1.5) return 2;
  if (p99 > 200 || ratio > 0.85 || lagMs > 100) return 1;
  return 0;
};

/** Необязательные операции откладываются при нагрузке; основные остаются. */
export const optionalAllowed = () => loadLevel() < 2;

/* ─── Ограничение одновременных операций ───────────────────────────── */

const running = new Map();
export const runLimited = async (name, max, fn) => {
  const n = running.get(name) ?? 0;
  if (n >= max) return { error: 'busy' };
  running.set(name, n + 1);
  try { return { value: await fn() }; } finally { running.set(name, (running.get(name) ?? 1) - 1); }
};
export const runningCount = (name) => running.get(name) ?? 0;

/* ─── Метрики ──────────────────────────────────────────────────────── */

const netBytes = () => {
  try {
    const t = fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2);
    let rx = 0, tx = 0;
    for (const l of t) {
      const [name, rest] = l.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0] || 0; tx += f[8] || 0;
    }
    return { rx, tx };
  } catch { return null; }
};

const disk = () => {
  try {
    const s = fs.statfsSync(process.env.MARKET_DIR || '/');
    return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch { return null; }
};

export const collectMetrics = async () => {
  const mem = process.memoryUsage();
  const cpus = os.cpus().length;
  const load = os.loadavg();
  const elapsed = Math.max(1, (Date.now() - counters.since) / 1000);
  let dbOk = true; let dbMs = null;
  const t0 = Date.now();
  try { await query('SELECT 1'); dbMs = Date.now() - t0; } catch { dbOk = false; }
  let servers = null;
  try {
    const { rows } = await query(`SELECT conn_status, count(*)::int AS n FROM blox_games WHERE server_url <> '' OR client_url <> '' GROUP BY 1`);
    servers = Object.fromEntries(rows.map((r) => [r.conn_status, r.n]));
  } catch { /* до миграции */ }
  const net = netBytes();
  return {
    level: loadLevel(),
    cpu: { cores: cpus, load1: +load[0].toFixed(2), load5: +load[1].toFixed(2), loadPerCore: +(load[0] / cpus).toFixed(2) },
    memory: {
      machineTotal: os.totalmem(), machineFree: os.freemem(),
      processRss: mem.rss, processHeapUsed: mem.heapUsed, processHeapTotal: mem.heapTotal,
    },
    disk: disk(),
    network: net ? { rxBytes: net.rx, txBytes: net.tx } : null,
    eventLoop: { meanMs: +(lag.mean / 1e6).toFixed(1), p99Ms: +(lag.percentile(99) / 1e6).toFixed(1) },
    requests: {
      sinceStart: counters.total, perSecond: +(counters.total / elapsed).toFixed(2),
      errors5xx: counters.errors5xx, errors4xx: counters.errors4xx,
      medianMs: percentile(recent, 50), p95Ms: percentile(recent, 95),
    },
    database: {
      ok: dbOk, pingMs: dbMs,
      pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max ?? null },
    },
    jobs: { probesRunning: runningCount('probe'), bgRunning: runningCount('bg') },
    gameServers: servers,
    uptimeSec: Math.round(process.uptime()),
  };
};

/** Предупреждения администратору: только по реальным показателям. */
export const warningsFor = (m) => {
  const w = [];
  if (m.level === 2) w.push({ level: 'critical', text: 'Критическая нагрузка: необязательные операции Blox отложены.' });
  else if (m.level === 1) w.push({ level: 'warn', text: 'Повышенная нагрузка: фоновые проверки замедлены.' });
  if (m.cpu.loadPerCore > 1) w.push({ level: 'warn', text: `Загрузка процессора на ядро: ${m.cpu.loadPerCore}` });
  const free = m.memory.machineFree / m.memory.machineTotal;
  if (free < 0.1) w.push({ level: 'critical', text: 'Свободной памяти меньше 10%.' });
  if (m.disk && m.disk.freeBytes / m.disk.totalBytes < 0.1) w.push({ level: 'critical', text: 'На диске осталось меньше 10%.' });
  if (m.database.pool.waiting > 0) w.push({ level: 'warn', text: `Запросов ждёт соединения с базой: ${m.database.pool.waiting}` });
  if (!m.database.ok) w.push({ level: 'critical', text: 'База данных не отвечает.' });
  if (m.requests.sinceStart > 50 && m.requests.errors5xx / m.requests.sinceStart > 0.05) w.push({ level: 'warn', text: 'Больше 5% запросов заканчиваются ошибкой сервера.' });
  return w;
};
