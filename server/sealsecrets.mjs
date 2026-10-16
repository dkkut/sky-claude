/**
 * Шифрование ранее записанных открытым текстом секретов в базе. Безопасная поэтапная миграция:
 *   — по умолчанию только считает (dry-run), ничего не меняет;
 *   — каждое значение шифруется, РАСШИФРОВЫВАЕТСЯ обратно и сверяется с исходным, и только потом записывается;
 *   — запись условная (`WHERE col = старое значение`): параллельная смена секрета не затирается;
 *   — повторный запуск ничего не портит (уже зашифрованные пропускаются).
 * Чтение везде идёт через openSecret(), который понимает и открытые, и зашифрованные значения, — поэтому порядок «сначала код, потом миграция» безопасен.
 */
import { query } from './db.mjs';
import { encryptSecret, openSecret, isSealed } from './crypto.mjs';

export const TARGETS = [
  { table: 'bot_runtimes', id: 'id', col: 'webhook_secret', what: 'ключи подписи вебхуков ботов' },
  { table: 'tickets', id: 'id', col: 'qr_secret', what: 'секреты QR-билетов' },
];

export const sealColumn = async ({ table, id, col }, { apply = false } = {}) => {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(id) || !/^[a-z_]+$/.test(col)) throw new Error('bad_identifier');
  const { rows } = await query(`SELECT ${id} AS id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
  const out = { table, col, total: rows.length, plain: 0, sealed: 0, updated: 0, failed: 0 };
  for (const r of rows) {
    if (isSealed(r.v)) { out.sealed += 1; continue; }
    out.plain += 1;
    if (!apply) continue;
    const blob = encryptSecret(r.v);
    if (openSecret(blob) !== r.v) { out.failed += 1; continue; }   // не записываем, если проверка обратной расшифровки не сошлась
    const u = await query(`UPDATE ${table} SET ${col} = $3 WHERE ${id} = $1 AND ${col} = $2`, [r.id, r.v, blob]);
    out.updated += u.rowCount;
  }
  return out;
};
