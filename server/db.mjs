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

export const query = (text, params) => pool.query(text, params);

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
