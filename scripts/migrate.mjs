// Накатывает миграции под ТЕМ пользователем БД, чей DATABASE_URL передан (владелец схемы).
// Нужен, когда приложение работает под ролью sky_app без прав на DDL (scripts/db-harden.sh).
//   docker compose run --rm --no-deps -e DATABASE_URL=postgres://sky:…@postgres:5432/sky api node scripts/migrate.mjs
import { waitForDb, migrate, pendingMigrations, closeDb } from '../server/db.mjs';
await waitForDb();
const before = await pendingMigrations();
await migrate();
console.log(before.length ? `[migrate] применено миграций: ${before.length}` : '[migrate] схема уже актуальна');
await closeDb();
