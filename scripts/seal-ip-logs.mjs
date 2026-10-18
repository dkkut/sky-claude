#!/usr/bin/env node
/**
 * Приведение СТАРЫХ записей журналов безопасности к укрупнённому адресу (ip → a.b.c.0/24 или IPv6 /48) + отпечаток полного адреса (ip_fp).
 *   node scripts/seal-ip-logs.mjs            # пробный проход: сколько записей
 *   node scripts/seal-ip-logs.mjs --apply    # выполнить (условный UPDATE по старому значению; повторный запуск безопасен)
 * Полный адрес после этого из базы исчезает. Перед --apply — копия базы. В контейнере: docker compose exec api node scripts/seal-ip-logs.mjs [--apply]
 */
import { query } from '../server/db.mjs';
import { ipMask, ipFp, isMasked } from '../server/ipmask.mjs';

const apply = process.argv.includes('--apply');
const TARGETS = [
  ['admin_gate_requests', 'id', 'ip', 'ip_fp'], ['ssh_gate_requests', 'id', 'ip', 'ip_fp'], ['device_links', 'id', 'ip', 'ip_fp'],
  ['device_links', 'id', 'decided_ip', 'decided_ip_fp'], ['account_freeze_log', 'id', 'ip', 'ip_fp'], ['two_factor_resets', 'id', 'ip', 'ip_fp'],
  ['contact_change_log', 'id', 'ip', 'ip_fp'], ['device_approvals', 'id', 'ip', 'ip_fp'],
];
for (const [table, idc, col, fp] of TARGETS) {
  let rows;
  try { rows = (await query(`SELECT ${idc} AS id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`)).rows; }
  catch (e) { console.log(`${table}.${col}: пропуск (${e.code || e.message})`); continue; }
  const todo = rows.filter((r) => !isMasked(r.v));
  let done = 0;
  if (apply) for (const r of todo) done += (await query(`UPDATE ${table} SET ${col} = $3, ${fp} = $4 WHERE ${idc} = $1 AND ${col} = $2`, [r.id, r.v, ipMask(r.v), ipFp(r.v)])).rowCount;
  console.log(`${table}.${col}: к приведению ${todo.length}${apply ? `, приведено ${done}` : ' (пробный проход)'}`);
}
process.exit(0);
