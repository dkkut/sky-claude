#!/usr/bin/env node
/**
 * Перенос почты старых обращений сайта (site_appeals, site_releases) в шифрованный вид.
 *   node scripts/seal-site-emails.mjs            # только посчитать (ничего не меняет)
 *   node scripts/seal-site-emails.mjs --apply    # заполнить email_enc/email_hmac и очистить открытую колонку email
 * Каждая запись: шифруем → расшифровываем обратно → сверяем → условный UPDATE (WHERE email = старое значение): параллельное изменение не затирается.
 * Повторный запуск безопасен. Перед --apply сделайте копию базы (scripts/backup.sh).
 * В контейнере: docker compose exec api node scripts/seal-site-emails.mjs [--apply]
 */
import { query } from '../server/db.mjs';
import { encryptSecret, openSecret, macOf } from '../server/crypto.mjs';

const apply = process.argv.includes('--apply');
let failed = 0;
for (const table of ['site_appeals', 'site_releases']) {
  const { rows } = await query(`SELECT id, email FROM ${table} WHERE email <> '' AND (email_enc IS NULL OR email_hmac IS NULL)`);
  let done = 0;
  for (const r of rows) {
    if (!apply) continue;
    const e = String(r.email).trim().toLowerCase();
    const enc = encryptSecret(e);
    if (openSecret(enc) !== e) { failed += 1; continue; }
    const u = await query(`UPDATE ${table} SET email_enc = $3, email_hmac = $4, email = '' WHERE id = $1 AND email = $2`, [r.id, r.email, enc, macOf('site-email', e)]);
    done += u.rowCount;
  }
  console.log(`${table}: к переносу ${rows.length}${apply ? `, перенесено ${done}` : ' (пробный проход, ничего не изменено)'}`);
}
if (failed) { console.error(`Не прошла проверка обратной расшифровки: ${failed}`); process.exit(1); }
process.exit(0);
