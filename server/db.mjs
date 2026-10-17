/**
 * Подключение к PostgreSQL и накатывание миграций.
 *
 * Миграции выполняются при старте API: отдельного шага в деплое нет,
 * поэтому контейнер поднимается сразу готовым к работе. Применённые
 * файлы записываются в таблицу schema_migrations, повторно не идут.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Postgres поднят рядом в docker-сети, соединения дешёвые.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Ошибка на простаивающем соединении не должна ронять процесс:
  // пул откроет новое при следующем запросе.
  console.error('[db] ошибка простаивающего соединения:', err.message);
});

/* Лёгкий учёт запросов для Sky Resource Optimizer: счётчик, суммарное время и кольцо медленных запросов.
   В журнал идёт только форма запроса (литералы и числа заменены на «?»), параметры и данные не сохраняются. */
export const dbStats = { total: 0, totalMs: 0, errors: 0, slow: [], top: new Map(), since: Date.now(), slowMs: Number(process.env.DB_SLOW_MS) || 300 };
const shape = (t) => String(t).replace(/'(?:[^']|'')*'/g, "'?'").replace(/\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim().slice(0, 220);
export const query = async (text, params) => {
  const t0 = Date.now();
  try {
    return await pool.query(text, params);
  } catch (e) {
    dbStats.errors += 1; throw e;
  } finally {
    const ms = Date.now() - t0;
    dbStats.total += 1; dbStats.totalMs += ms;
    // Самые частые формы запросов (ключ — начало текста без пробелов; не больше 400 разных, остальные не учитываются).
    { const k = (typeof text === 'string' ? text : text?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
      const e = dbStats.top.get(k); if (e) { e.n += 1; e.ms += ms; } else if (dbStats.top.size < 400) dbStats.top.set(k, { n: 1, ms }); }
    if (ms >= dbStats.slowMs) {
      dbStats.slow.push({ at: new Date().toISOString(), ms, sql: shape(typeof text === 'string' ? text : text?.text ?? '') });
      if (dbStats.slow.length > 50) dbStats.slow.shift();
    }
  }
};

/** Ждём, пока БД начнёт отвечать: контейнер может стартовать дольше API. */
export const waitForDb = async ({ attempts = 30, delayMs = 1000 } = {}) => {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw new Error(`БД недоступна после ${attempts} попыток: ${err.message}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
};

/**
 * Накатывает *.sql из server/migrations в алфавитном порядке.
 * Каждый файл идёт в своей транзакции: упавшая миграция не оставит
 * схему наполовину применённой.
 */
/** Файлы миграций, которых ещё нет в schema_migrations (пусто — схема актуальна). Только читает. */
export const pendingMigrations = async () => {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  let applied = new Set();
  try {
    const { rows } = await pool.query('SELECT name FROM schema_migrations');
    applied = new Set(rows.map((r) => r.name));
  } catch { /* таблицы ещё нет — значит, не применено ничего */ }
  return files.filter((f) => !applied.has(f));
};

export const migrate = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[db] миграция применена: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`миграция ${file} не применилась: ${err.message}`);
    } finally {
      client.release();
    }
  }
};

export const closeDb = () => pool.end();
