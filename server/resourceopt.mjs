/**
 * Sky Resource Optimizer — единый контроллер нагрузки.
 *
 * Принципы:
 *  • Не новая инфраструктура, а надстройка над тем, что есть: замеры цикла событий и счётчики запросов — `bloxlimits.mjs`,
 *    учёт запросов БД — `db.mjs` (dbStats), диск — statfs, память — cgroup контейнера (если есть) или машины.
 *  • Лёгкие замеры: раз в 15 секунд, без обходов файловой системы. Подсчёт места по папкам — только по кнопке и с кэшем.
 *  • Режимы normal → economy → high → critical с гистерезисом: вверх — после 2 замеров подряд (30 с), вниз — на ступень после 8 спокойных (2 мин).
 *  • Что режимы делают: необязательные фоновые работы откладываются (`optionalAllowed`), тяжёлые новые загрузки при critical отклоняются
 *    понятной ошибкой (`heavyAllowed`), часовая уборка при critical переносится (не больше 3 раз подряд).
 *    Авторизация, проверки доступа, платежи, сообщения, защита от атак режимами НЕ отключаются.
 *  • Автооптимизацию можно выключить: замеры и журнал остаются, режим не меняется (всегда normal).
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { query, pool, dbStats } from './db.mjs';
import { setLevelFloor, collectMetrics, warningsFor } from './bloxlimits.mjs';
import { logAdmin } from './adminsec.mjs';
import { logEvent } from './skylog.mjs';
import { notifyGift } from './giftnotify.mjs';

export const MODES = ['normal', 'economy', 'high', 'critical'];
export const MODE_LABEL = { normal: 'Обычный', economy: 'Экономичный', high: 'Высокая нагрузка', critical: 'Критическая нагрузка' };

/** Ключ → [умолчание, минимум, максимум, подпись]; булевы — отдельно. Пороги определены по измерениям на 4 ядрах / 16 ГБ и правятся в админке. */
export const NUM = {
  maxHeavyParallel:  [2, 1, 16, 'Одновременных тяжёлых операций (перекодирование, большие загрузки)'],
  cacheMaxMb:        [64, 0, 4096, 'Предел локальных кэшей, МБ'],
  diskWarnPct:       [10, 2, 50, 'Предупреждение при свободном месте меньше, %'],
  diskCriticalPct:   [3, 1, 20, 'Критический остаток свободного места, %'],
  highLoadPerCore:   [85, 30, 300, 'Порог «высокая нагрузка»: загрузка CPU на ядро, %'],
  criticalLoadPerCore: [150, 60, 600, 'Порог «критическая»: загрузка CPU на ядро, %'],
  memHighPct:        [85, 50, 98, 'Порог «высокая»: занято памяти, %'],
  memCriticalPct:    [93, 60, 99, 'Порог «критическая»: занято памяти, %'],
  maxRetries:        [5, 0, 20, 'Максимум повторных попыток фоновых задач'],
  tempCleanupDays:   [7, 1, 90, 'Хранить временные файлы, дней'],
};
export const BOOL = {
  enabled:        [true, 'Автоматическая оптимизация'],
  economy:        [false, 'Экономия ресурсов (всегда не ниже экономичного режима)'],
  autoBackground: [true, 'Автоматическое управление фоновыми задачами'],
};
export const DEFAULTS = { ...Object.fromEntries(Object.entries(NUM).map(([k, v]) => [k, v[0]])), ...Object.fromEntries(Object.entries(BOOL).map(([k, v]) => [k, v[0]])) };

let cache = { at: 0, v: null };
export const loadSettings = async (force = false) => {
  if (!force && cache.v && Date.now() - cache.at < 10_000) return cache.v;
  let v = { ...DEFAULTS };
  try {
    const { rows } = await query('SELECT settings FROM resource_settings WHERE id = 1');
    v = { ...DEFAULTS, ...(rows[0]?.settings ?? {}) };
  } catch { /* до миграции — умолчания */ }
  cache = { at: Date.now(), v };
  return v;
};
const S = () => cache.v ?? DEFAULTS;

export const saveSettings = async (actorId, patch, meta) => {
  const cur = await loadSettings(true); const next = { ...cur };
  for (const [k, [, lo, hi]] of Object.entries(NUM)) {
    if (patch?.[k] === undefined) continue;
    const n = Number(patch[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return { error: 'bad_field', field: k };
    next[k] = Math.trunc(n);
  }
  for (const k of Object.keys(BOOL)) if (patch?.[k] !== undefined) next[k] = patch[k] === true;
  if (next.highLoadPerCore >= next.criticalLoadPerCore) return { error: 'bad_field', field: 'highLoadPerCore' };
  if (next.memHighPct >= next.memCriticalPct) return { error: 'bad_field', field: 'memHighPct' };
  if (next.diskCriticalPct >= next.diskWarnPct) return { error: 'bad_field', field: 'diskCriticalPct' };
  await query('UPDATE resource_settings SET settings = $1::jsonb, updated_by = $2, updated_at = now() WHERE id = 1', [JSON.stringify(next), actorId]);
  cache = { at: 0, v: null }; await loadSettings(true);
  const changed = Object.keys(next).filter((k) => next[k] !== cur[k]).map((k) => `${k}: ${cur[k]}→${next[k]}`).join('; ').slice(0, 240);
  await note('settings', '', changed || 'без изменений');
  await logAdmin({ actorId, targetType: 'system', type: 'resource_settings', detail: changed || 'без изменений', meta });
  return { ok: true, settings: next };
};

/* ── События ── */
const note = (kind, mode, detail) => query('INSERT INTO resource_events (kind, mode, detail) VALUES ($1,$2,$3)', [kind, mode, String(detail).slice(0, 400)]).catch(() => {});
export const recentEvents = async (n = 50) => {
  try { return (await query('SELECT ts, kind, mode, detail FROM resource_events ORDER BY id DESC LIMIT $1', [n])).rows.map((r) => ({ at: r.ts.toISOString(), kind: r.kind, mode: r.mode, detail: r.detail })); } catch { return []; }
};

/* ── Замеры ── */
const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
const readNum = (f) => { try { const t = fs.readFileSync(f, 'utf8').trim(); return t === 'max' ? Infinity : Number(t); } catch { return null; } };
const cgroupMem = () => {
  const cur = readNum('/sys/fs/cgroup/memory.current') ?? readNum('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  let max = readNum('/sys/fs/cgroup/memory.max') ?? readNum('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (max != null && (!Number.isFinite(max) || max > os.totalmem() * 4)) max = null; // «без лимита»
  return cur != null ? { current: cur, limit: max } : null;
};
const diskFree = (dir = process.env.DISK_PROBE_DIR || '/') => {
  try { const s = fs.statfsSync(dir); const total = s.blocks * s.bsize; return { total, free: s.bavail * s.bsize, pct: total ? (s.bavail * s.bsize) / total * 100 : null }; } catch { return null; }
};

const samples = [];            // последний час, шаг 15 с
let prevDb = { total: 0, ms: 0 };
const takeSample = () => {
  const cores = Math.max(1, os.cpus().length);
  const cg = cgroupMem();
  const memPct = cg?.limit ? cg.current / cg.limit * 100 : (1 - os.freemem() / os.totalmem()) * 100;
  const dsk = diskFree();
  const dq = dbStats.total - prevDb.total; const dms = dbStats.totalMs - prevDb.ms; prevDb = { total: dbStats.total, ms: dbStats.totalMs };
  const sm = {
    t: Date.now(),
    loadPct: +(os.loadavg()[0] / cores * 100).toFixed(0),
    memPct: +memPct.toFixed(1), rssMb: Math.round(process.memoryUsage().rss / 1048576),
    lagP99: +(lag.percentile(99) / 1e6).toFixed(0), lagMean: +(lag.mean / 1e6).toFixed(1),
    diskFreePct: dsk?.pct != null ? +dsk.pct.toFixed(1) : null,
    dbQ: dq, dbAvgMs: dq ? +(dms / dq).toFixed(1) : 0, dbWait: pool.waitingCount, dbBusy: pool.totalCount - pool.idleCount,
  };
  lag.reset();
  samples.push(sm); if (samples.length > 240) samples.shift();
  return sm;
};

/** Какой режим «хотят» показатели сейчас (0..3) и почему. */
const rawLevel = (sm, st) => {
  const why = [];
  let lvl = 0;
  const up = (l, t) => { if (l > lvl) lvl = l; why.push(t); };
  if (sm.loadPct >= st.criticalLoadPerCore) up(3, `CPU ${sm.loadPct}% на ядро`); else if (sm.loadPct >= st.highLoadPerCore) up(2, `CPU ${sm.loadPct}% на ядро`); else if (sm.loadPct >= 60) up(1, `CPU ${sm.loadPct}% на ядро`);
  if (sm.memPct >= st.memCriticalPct) up(3, `память ${sm.memPct}%`); else if (sm.memPct >= st.memHighPct) up(2, `память ${sm.memPct}%`); else if (sm.memPct >= 75) up(1, `память ${sm.memPct}%`);
  if (sm.lagP99 >= 1000) up(3, `задержка цикла ${sm.lagP99} мс`); else if (sm.lagP99 >= 200) up(2, `задержка цикла ${sm.lagP99} мс`);
  if (sm.diskFreePct != null) { if (sm.diskFreePct <= st.diskCriticalPct) up(3, `диск: свободно ${sm.diskFreePct}%`); else if (sm.diskFreePct <= st.diskWarnPct) up(1, `диск: свободно ${sm.diskFreePct}%`); }
  const max = pool.options?.max ?? 10;
  if (sm.dbWait >= max) up(3, `очередь к БД ${sm.dbWait}`); else if (sm.dbWait >= 3) up(2, `очередь к БД ${sm.dbWait}`);
  if (st.economy && lvl < 1) { lvl = 1; why.push('включена «Экономия ресурсов»'); }
  return { lvl, why };
};

let state = { level: 0, since: Date.now(), up: 0, down: 0, why: [], deferred: 0, deferredInRow: 0 };
const modeOf = () => MODES[state.level];
export const currentMode = () => modeOf();
/** Необязательные фоновые работы (проверки, догрузка, прогрев): только пока нагрузка ниже «высокой». */
export const optionalAllowed = () => !S().autoBackground || state.level < 2;
/** Тяжёлые новые операции (большие загрузки, перекодирование): не при критической. */
export const heavyAllowed = () => !S().enabled || state.level < 3;
/** Сколько тяжёлых операций можно вести одновременно в текущем режиме. */
export const heavySlots = () => { const m = S().maxHeavyParallel; return state.level >= 3 ? 0 : state.level === 2 ? Math.max(1, Math.floor(m / 2)) : m; };

/** Перенос часовой уборки: при критической нагрузке — не больше 3 раз подряд. */
export const shouldDeferHousekeeping = () => {
  if (!S().enabled || !S().autoBackground || state.level < 3 || state.deferredInRow >= 3) { state.deferredInRow = 0; return false; }
  state.deferredInRow += 1; state.deferred += 1;
  note('deferred', modeOf(), `часовая уборка отложена (${state.deferredInRow}/3)`);
  return true;
};

const alerts = { memGrowthAt: 0, errAt: 0 };
const detectProblems = async (sm) => {
  // рост памяти процесса: за последние 15 минут +30 % и не меньше +150 МБ, без «ступенек вниз»
  const win = samples.slice(-60);
  if (win.length >= 60 && Date.now() - alerts.memGrowthAt > 3600_000) {
    const first = win[0].rssMb, last = win[win.length - 1].rssMb;
    let drops = 0; for (let i = 1; i < win.length; i++) if (win[i].rssMb < win[i - 1].rssMb - 5) drops += 1;
    if (last - first >= 150 && last >= first * 1.3 && drops <= 3) {
      alerts.memGrowthAt = Date.now();
      await note('warning', modeOf(), `Процесс API: память выросла с ${first} до ${last} МБ за 15 минут без снижений — возможна утечка.`);
      logEvent({ category: 'server', type: 'resource_memory_growth', level: 'WARN', detail: { from: first, to: last } });
    }
  }
};

/** Гистерезис: вверх — после 2 замеров подряд, вниз — на одну ступень после 8 спокойных. Чистая функция (проверяется тестами). */
export const nextLevel = (cur, target) => {
  if (target > cur.level) { const up = cur.up + 1; return up >= 2 ? { level: target, up: 0, down: 0, changed: true } : { level: cur.level, up, down: 0, changed: false }; }
  if (target < cur.level) { const down = cur.down + 1; return down >= 8 ? { level: cur.level - 1, up: 0, down: 0, changed: true } : { level: cur.level, up: 0, down, changed: false }; }
  return { level: cur.level, up: 0, down: 0, changed: false };
};

const tick = async () => {
  const st = await loadSettings();
  const sm = takeSample();
  const { lvl, why } = rawLevel(sm, st);
  // Только для проверок (не в production): принудительный «желаемый» уровень.
  const forced = process.env.NODE_ENV !== 'production' && process.env.RESOURCE_FORCE_LEVEL !== undefined ? Number(process.env.RESOURCE_FORCE_LEVEL) : null;
  const want = forced != null && forced >= 0 && forced <= 3 ? forced : lvl;
  const target = st.enabled ? want : 0;
  const n = nextLevel(state, target);
  if (n.changed) await switchTo(n.level, forced != null ? ['принудительно (проверка)'] : (why.length ? why : ['показатели в норме']));
  else { state.up = n.up; state.down = n.down; if (why.length) state.why = why; }
  await detectProblems(sm).catch(() => {});
};
/** Владельцу — при подъёме до высокой/критической нагрузки, не чаще раза в 30 минут на режим (письма и push через общий канал безопасности). */
const notifiedAt = {};
const notifyOwners = async (title, text) => {
  if (Date.now() - (notifiedAt[title] ?? 0) < 30 * 60_000) return;
  notifiedAt[title] = Date.now();
  try {
    const name = String(process.env.OWNER_USERNAME ?? '').trim().toLowerCase().replace(/^@/, '');
    if (!name) return;
    const { rows } = await query(`SELECT p.id FROM profiles p WHERE lower(p.username) = $1 AND p.deleted_at IS NULL LIMIT 1`, [name]);
    if (rows[0]) await notifyGift(rows[0].id, 'security', title, text.slice(0, 200), null);
  } catch (e) { console.error('[resources] уведомление владельцу', e.message); }
};
const switchTo = async (lvl, why) => {
  const from = modeOf();
  state = { ...state, level: lvl, since: Date.now(), up: 0, down: 0, why };
  await note('mode', modeOf(), `${MODE_LABEL[from]} → ${MODE_LABEL[modeOf()]}: ${why.join(', ')}`);
  if (lvl >= 2 && lvl > ['normal', 'economy', 'high', 'critical'].indexOf(from)) notifyOwners(`Sky: ${MODE_LABEL[modeOf()]}`, `Режим нагрузки сервера: ${MODE_LABEL[from]} → ${MODE_LABEL[modeOf()]}. Причины: ${why.join(', ')}. Подробности — Sky Admin → Оптимизация ресурсов. Вход и платежи работают как обычно; необязательные фоновые работы отложены.`);
  logEvent({ category: 'server', type: 'resource_mode', level: lvl >= 3 ? 'ERROR' : lvl === 2 ? 'WARN' : 'INFO', detail: { from, to: modeOf(), why: why.join(', ').slice(0, 200) } });
};

let timer = null;
export const startResourceOptimizer = () => {
  if (timer) return;
  setLevelFloor(() => (S().enabled ? [0, 1, 2, 2][state.level] : 0));
  void loadSettings();
  // В тестах режим можно проверить сразу, не ожидая 30 секунд.
  if (process.env.NODE_ENV !== 'production' && process.env.RESOURCE_FORCE_LEVEL !== undefined) setTimeout(() => { tick().then(tick).catch(() => {}); }, 1500).unref();
  timer = setInterval(() => { tick().catch((e) => console.error('[resources] замер', e.message)); }, 15_000);
  timer.unref();
};
export const stopResourceOptimizer = () => { if (timer) clearInterval(timer); timer = null; };
/** Для тестов: один замер и решение без ожидания таймера. */
export const _tickForTest = tick;
export const _force = (lvl) => { state = { ...state, level: lvl, since: Date.now() }; };

/* ── Место на диске по категориям (по кнопке, с кэшем) ── */
const DIRS = [
  ['Пользовательские медиа', ['MUSIC_DIR', 'FILM_DIR', 'VIDEO_DIR', 'SKYVIDEO_DIR', 'PODCAST_DIR', 'BOOKS_DIR', 'STORY_DIR', 'BLOOM_DIR', 'GIFTS_DIR', 'CAMPAIGNS_DIR', 'TICKETS_DIR', 'ADS_DIR', 'MARKET_DIR']],
  ['Файлы обработки / временные', ['AI_FILES_DIR', 'SKIN_DIR']],
  ['Сайт (загрузки)', ['SITE_DIR']],
  ['Резервные копии (локальные)', ['STORAGE_BACKUP_LOCAL_DIR', 'BACKUP_DIR']],
];
let scan = { at: 0, running: false, data: null };
const dirSize = async (dir, budget) => {
  let bytes = 0, files = 0; const stack = [dir];
  while (stack.length && budget.n > 0) {
    const d = stack.pop();
    let h; try { h = await fs.promises.opendir(d); } catch { continue; }
    for await (const e of h) {
      if (--budget.n <= 0) break;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { bytes += (await fs.promises.stat(p)).size; files += 1; } catch { /* исчез */ } }
      if (budget.n % 500 === 0) await new Promise((r) => setImmediate(r));
    }
  }
  return { bytes, files, truncated: budget.n <= 0 };
};
export const scanDisk = async () => {
  if (scan.running) return { running: true, ...(scan.data ?? {}) };
  if (scan.data && Date.now() - scan.at < 10 * 60_000) return scan.data;
  scan.running = true;
  try {
    const cats = [];
    for (const [label, envs] of DIRS) {
      let bytes = 0, files = 0, truncated = false, any = false;
      for (const e of envs) { const d = process.env[e]; if (!d) continue; any = true; const r = await dirSize(d, { n: 200_000 }); bytes += r.bytes; files += r.files; truncated = truncated || r.truncated; }
      if (any) cats.push({ label, bytes, files, truncated });
    }
    let db = null; try { db = Number((await query('SELECT pg_database_size(current_database()) AS s')).rows[0].s); } catch { /* ok */ }
    let logs = null; try { logs = Number((await query(`SELECT COALESCE(pg_total_relation_size('sky_events'),0) AS s`)).rows[0].s); } catch { /* ok */ }
    if (db != null) cats.unshift({ label: 'База данных', bytes: db });
    if (logs != null) cats.push({ label: 'Журналы событий (в базе)', bytes: logs });
    scan = { at: Date.now(), running: false, data: { at: new Date().toISOString(), categories: cats, disk: diskFree() } };
    return scan.data;
  } finally { scan.running = false; }
};

/* ── Сводка для админки ── */
const causes = (sm, st) => {
  const c = [];
  if (!sm) return c;
  if (sm.loadPct >= st.highLoadPerCore) c.push('Высокая загрузка процессора: проверьте медленные запросы к базе и число одновременных загрузок.');
  if (sm.memPct >= st.memHighPct) c.push('Память почти исчерпана: тяжёлые загрузки и фоновые операции ограничиваются.');
  if (sm.dbWait >= 3) c.push('Запросы ждут соединения с базой: возможны долгие транзакции или медленные запросы (см. список ниже).');
  if (sm.diskFreePct != null && sm.diskFreePct <= st.diskWarnPct) c.push('Мало свободного места на диске: проверьте «Место по категориям» и сроки хранения копий.');
  if (sm.lagP99 >= 200) c.push('Цикл событий Node занят: вероятна тяжёлая синхронная операция или всплеск запросов.');
  if (dbStats.slow.length > 10) c.push('Накопилось много медленных запросов — кандидаты на индекс или пагинацию.');
  return c;
};
export const overview = async () => {
  const st = await loadSettings();
  const m = await collectMetrics().catch(() => null);
  const sm = samples[samples.length - 1] ?? takeSample();
  const dq = dbStats.total, upMin = Math.max(1, (Date.now() - dbStats.since) / 60000);
  return {
    mode: modeOf(), modeLabel: MODE_LABEL[modeOf()], since: new Date(state.since).toISOString(), why: state.why, deferredHousekeeping: state.deferred,
    settings: st, limits: Object.fromEntries(Object.entries(NUM).map(([k, [def, lo, hi, label]]) => [k, { def, lo, hi, label }])),
    bools: Object.fromEntries(Object.entries(BOOL).map(([k, [def, label]]) => [k, { def, label }])),
    now: sm, series: samples.slice(-60).map((x) => ({ t: x.t, load: x.loadPct, mem: x.memPct, lag: x.lagP99, dbq: x.dbQ })),
    process: { rssMb: Math.round(process.memoryUsage().rss / 1048576), heapMb: Math.round(process.memoryUsage().heapUsed / 1048576), uptimeSec: Math.round(process.uptime()), cores: os.cpus().length, machineMemMb: Math.round(os.totalmem() / 1048576), cgroup: cgroupMem() },
    database: { queriesTotal: dq, queriesPerMin: +(dq / upMin).toFixed(1), avgMs: dq ? +(dbStats.totalMs / dq).toFixed(1) : 0, errors: dbStats.errors, pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options?.max ?? null }, slowThresholdMs: dbStats.slowMs },
    slowQueries: [...dbStats.slow].reverse().slice(0, 20),
    requests: m?.requests ?? null, warnings: m ? warningsFor(m) : [], causes: causes(sm, st), events: await recentEvents(50),
    containers: 'Показан только процесс API: из него видны его собственные cgroup-пределы. Остальные контейнеры — `docker stats` на сервере.',
  };
};
