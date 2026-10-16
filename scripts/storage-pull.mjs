// Вернуть на диск сервера все медиафайлы, которые лежат только в S3 (перед отключением STORAGE_PRIMARY).
// Запускается в контейнере api:  docker compose run --rm -e STORAGE_PRIMARY=s3 api node scripts/storage-pull.mjs
// Ничего не удаляет ни на диске, ни в S3. Код выхода 0 — всё на диске; 1 — часть файлов не скачана.
import { serviceRoots } from '../server/skystoragelimits.mjs';
import * as P from '../server/skystorageprimary.mjs';
import { stat } from 'node:fs/promises';

if (!P.enabled()) { console.error('S3 не настроен (STORAGE_S3_*) или STORAGE_PRIMARY не равен s3.'); process.exit(2); }
let got = 0, had = 0, failed = 0;
for (const { service, root } of serviceRoots()) {
  let list = [];
  try { list = await P.listRemote(root); } catch (e) { console.error(`${service}: список из S3 не получен (${e.code ?? e.message})`); failed += 1; continue; }
  for (const o of list) {
    try {
      if (await stat(o.path).then((s) => s.size === o.size, () => false)) { had += 1; continue; }
      await P.ensureLocal(o.path); got += 1;
    } catch (e) { failed += 1; console.error(`не скачан ${o.path}: ${e.code ?? e.message}`); }
  }
  console.log(`${service}: в S3 ${list.length}`);
}
console.log(`скачано: ${got}, уже на диске: ${had}, ошибок: ${failed}`);
process.exit(failed ? 1 : 0);
