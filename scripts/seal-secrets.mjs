// Зашифровать секреты, лежавшие в базе открытым текстом (webhook-ключи ботов, секреты QR-билетов).
//   docker compose run --rm --no-deps -T api node scripts/seal-secrets.mjs            # только посчитать
//   docker compose run --rm --no-deps -T api node scripts/seal-secrets.mjs --apply    # зашифровать
// Перед --apply сделайте резервную копию базы (scripts/backup.sh). Значения не печатаются.
import { TARGETS, sealColumn } from '../server/sealsecrets.mjs';
import { pool } from '../server/db.mjs';
const apply = process.argv.includes('--apply');
let failed = 0;
for (const t of TARGETS) {
  const r = await sealColumn(t, { apply });
  failed += r.failed;
  console.log(`${t.what} (${t.table}.${t.col}): всего ${r.total}, открытым текстом ${r.plain}, уже зашифровано ${r.sealed}${apply ? `, зашифровано сейчас ${r.updated}, ошибок ${r.failed}` : ''}`);
}
if (!apply) console.log('Это пробный проход: ничего не изменено. Для шифрования добавьте --apply.');
await pool.end();
process.exit(failed ? 1 : 0);
