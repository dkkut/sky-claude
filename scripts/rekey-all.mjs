#!/usr/bin/env node
/**
 * Перешифровка записей базы на ТЕКУЩИЙ ENCRYPTION_KEY (после ротации: новый ключ в ENCRYPTION_KEY, прежний в ENCRYPTION_KEY_PREV).
 *   node scripts/rekey-all.mjs            # пробный проход: сколько записей ещё на прежних ключах (ничего не меняет)
 *   node scripts/rekey-all.mjs --apply    # перешифровать
 * Обходит ВСЕ текстовые колонки всех таблиц с первичным ключом, где значение похоже на шифротекст `v1.<iv>.<tag>.<data>`. Для каждого:
 * читается текущим ключом — пропуск; читается прежним (секретным или «содержимым») — шифруется текущим, расшифровывается обратно, сверяется,
 * и только потом условный UPDATE (WHERE колонка = старое значение: параллельная правка не затирается). Повтор безопасен.
 * НЕ трогает: файлы (SKE1; их перепаковывает mediabackfill), jsonb с вложенными шифротекстами, HMAC (ключ стабилен — см. crypto.stableMaterial).
 * Перед --apply — копия базы (scripts/backup.sh). Убирать прежний ключ из ENCRYPTION_KEY_PREV можно, когда пробный проход показал 0
 * и файлы перепакованы. В контейнере: docker compose exec api node scripts/rekey-all.mjs [--apply]
 */
import crypto from 'node:crypto';
import { query } from '../server/db.mjs';
import { readKeysFor } from '../server/crypto.mjs';
import { config } from '../server/config.mjs';

const apply = process.argv.includes('--apply');
if (!config.encryptionKey) { console.error('ENCRYPTION_KEY не задан.'); process.exit(1); }
const K = { secret: readKeysFor('secret'), content: readKeysFor('content') };
if (K.secret.length < 2) console.log('ENCRYPTION_KEY_PREV пуст — переносить нечего (пробный проход покажет только нечитаемые записи).');

const open = (key, blob) => {
  const [, iv, tag, data] = blob.split('.');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
};
const seal = (key, plain) => {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
};
/** → { kind, plain, current } или null, если ни одним ключом не читается. */
const classify = (blob) => {
  for (const kind of ['secret', 'content']) {
    for (let i = 0; i < K[kind].length; i++) { const p = open(K[kind][i], blob); if (p !== null) return { kind, plain: p, current: i === 0 }; }
  }
  return null;
};

const cols = (await query(`
  SELECT c.table_name t, c.column_name col FROM information_schema.columns c
  JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema AND tb.table_type = 'BASE TABLE'
  WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying') ORDER BY 1, 2`)).rows;
const pks = {};
for (const r of (await query(`
  SELECT kcu.table_name t, kcu.column_name col FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public' AND tc.constraint_type = 'PRIMARY KEY' ORDER BY kcu.ordinal_position`)).rows) (pks[r.t] ??= []).push(r.col);

let total = { current: 0, moved: 0, todo: 0, unreadable: 0, nopk: 0, failed: 0 };
for (const { t, col } of cols) {
  if (!/^[a-z_0-9]+$/.test(t) || !/^[a-z_0-9]+$/.test(col)) continue;
  let rows;
  try { rows = (await query(`SELECT ${(pks[t] ?? []).concat(col).map((c) => `"${c}"`).join(', ')} FROM "${t}" WHERE "${col}" ~ '^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'`)).rows; }
  catch { continue; }
  if (!rows.length) continue;
  let stat = { current: 0, moved: 0, todo: 0, unreadable: 0 };
  for (const r of rows) {
    const v = r[col]; const cl = classify(v);
    if (!cl) { stat.unreadable++; continue; }
    if (cl.current) { stat.current++; continue; }
    stat.todo++;
    if (!apply) continue;
    if (!pks[t]) { total.nopk++; continue; }
    const key = K[cl.kind][0]; const blob = seal(key, cl.plain);
    if (open(key, blob) !== cl.plain) { total.failed++; continue; }
    const where = pks[t].map((c, i) => `"${c}" = $${i + 1}`).join(' AND ');
    const u = await query(`UPDATE "${t}" SET "${col}" = $${pks[t].length + 1} WHERE ${where} AND "${col}" = $${pks[t].length + 2}`, [...pks[t].map((c) => r[c]), blob, v]);
    stat.moved += u.rowCount;
  }
  for (const k of Object.keys(stat)) total[k] += stat[k];
  console.log(`${t}.${col}: на текущем ключе ${stat.current}, на прежних ${stat.todo}${apply ? ` (перенесено ${stat.moved})` : ''}${stat.unreadable ? `, НЕ ЧИТАЕТСЯ ${stat.unreadable}` : ''}`);
}
console.log(`\nИтого: на текущем ключе ${total.current}, на прежних ${total.todo}${apply ? `, перенесено ${total.moved}` : ' (пробный проход)'}, не читается ${total.unreadable}${total.nopk ? `, без первичного ключа ${total.nopk}` : ''}${total.failed ? `, сбой проверки ${total.failed}` : ''}`);
process.exit(total.failed || (apply && total.nopk) ? 1 : 0);
