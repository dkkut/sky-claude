// Сверка баланса и баллов с журналом операций. Только чтение: ничего не исправляет.
// Запуск на сервере: docker compose exec api node scripts/wallet-reconcile.mjs [--json]
import { reconcileLedger } from '../server/wallet.mjs';
import { pool } from '../server/db.mjs';
const r = await reconcileLedger({ sample: 200 });
if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
else {
  console.log(`Счетов: ${r.accounts}; сверено: ${r.checked}; не сверено (записи без валюты): ${r.unchecked}`);
  console.log(`Расхождения в рублях: ${r.driftRubCount}; в баллах: ${r.driftPtsCount}`);
  for (const d of r.driftRub) console.log(`  ₽  ${d.userId}  баланс − журнал = ${d.drift}`);
  for (const d of r.driftPts) console.log(`  pt ${d.userId}  баллы − журнал = ${d.drift}`);
  console.log('Расхождение не исправляется автоматически: сначала найдите причину по журналу (wallet_transactions).');
}
await pool.end();
process.exit(r.driftRubCount || r.driftPtsCount ? 2 : 0);
