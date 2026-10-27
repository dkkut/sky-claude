#!/usr/bin/env node
/**
 * Хостовые копии Sky (scripts/backup.sh: db-*, files-*, config-* в .age) ↔ ХРАНИЛИЩЕ КОПИЙ (S3, STORAGE_BACKUP_S3_*).
 * Запускается в контейнере api от root (читает каталог копий), см. scripts/use-backup-storage.sh и install-backup.sh --storage:
 *   check                      — доступность и права (список, запись, чтение, удаление пробы)
 *   push <каталог>             — загрузить недостающие/другого размера файлы *.age (открытые копии пропускаются)
 *   list                       — что лежит в хранилище
 *   pull <имя|latest|all> <каталог> — скачать (latest — свежие db, files, config и host-config)
 *   prune <N>                  — оставить в хранилище по N последних копий каждого вида (остальное удалить)
 * Объекты лежат под префиксом <STORAGE_BACKUP_S3_PREFIX>host/ — отдельно от копий самого Sky Storage. Файлы уже зашифрованы age
 * (ключ — секретный ключ age, он хранится вне сервера); открытый текст в хранилище копий не пишем.
 * Каждая загрузка сверяется по размеру. Код выхода ненулевой при любой ошибке.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createS3, backupS3Config } from '../server/skystorages3.mjs';

const [mode = 'list', a1, a2] = process.argv.slice(2);
const base = backupS3Config();
if (!base.ok) { console.error(`Хранилище копий не настроено: ${base.missing.join(', ')}. Запустите: bash scripts/setup-storage.sh --backup-bucket`); process.exit(2); }
const s3 = createS3({ ...base, prefix: `${base.prefix}host/` });
const fmt = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} ГБ` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`);
const KINDS = ['db', 'files', 'config', 'host-config', 'certs'];
const kindOf = (n) => KINDS.find((k) => n.startsWith(`${k}-`));
const SAFE = /^[\w.-]{1,160}$/;
let bad = 0;

const push = async (dir) => {
  const have = new Map((await s3.list('')).map((o) => [o.key, o.size]));
  const files = fs.readdirSync(dir).filter((n) => kindOf(n) && /\.age$/.test(n)).sort();
  const skipped = fs.readdirSync(dir).filter((n) => kindOf(n) && !/\.age$/.test(n));
  for (const n of skipped) console.log(`  пропущено ${n}: открытая копия (в хранилище копий — только зашифрованные .age)`);
  let up = 0; let same = 0; let bytes = 0;
  for (const n of files) {
    const f = path.join(dir, n); const size = fs.statSync(f).size;
    if (have.get(n) === size) { same += 1; continue; }
    await s3.put(n, fs.createReadStream(f));
    const h = await s3.head(n);
    if (!h || h.size !== size) { console.error(`  ✖ ${n}: после загрузки размер не сошёлся (${h?.size ?? 'нет'} ≠ ${size})`); bad += 1; continue; }
    up += 1; bytes += size; console.log(`  ✔ ${n} (${fmt(size)})`);
  }
  console.log(`Загружено: ${up} (${fmt(bytes)}), уже было: ${same}${bad ? `, ошибок: ${bad}` : ''}`);
};

const list = async () => {
  const items = (await s3.list('')).filter((o) => kindOf(o.key)).sort((x, y) => (x.key < y.key ? 1 : -1));
  let total = 0;
  for (const o of items) { total += o.size; console.log(`${o.key}\t${fmt(o.size)}`); }
  console.log(`Всего: ${items.length}, ${fmt(total)}`);
  return items;
};

const pull = async (what, dir) => {
  if (!dir) { console.error('Укажите каталог назначения.'); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const items = (await s3.list('')).filter((o) => kindOf(o.key)).sort((x, y) => (x.key < y.key ? 1 : -1));
  let want;
  if (what === 'all') want = items;
  else if (what === 'latest') want = KINDS.filter((k) => k !== 'certs').map((k) => items.find((o) => kindOf(o.key) === k)).filter(Boolean);
  else { if (!SAFE.test(what)) { console.error('Недопустимое имя.'); process.exit(2); } want = items.filter((o) => o.key === what); }
  if (!want.length) { console.error('В хранилище нет подходящих копий.'); process.exit(1); }
  for (const o of want) {
    const out = path.join(dir, o.key);
    await pipeline(await s3.get(o.key), fs.createWriteStream(out, { mode: 0o600 }));
    const got = fs.statSync(out).size;
    if (got !== o.size) { console.error(`  ✖ ${o.key}: скачано ${got} из ${o.size}`); bad += 1; fs.rmSync(out, { force: true }); continue; }
    console.log(`  ✔ ${o.key} (${fmt(got)})`);
  }
};

const prune = async (keepArg) => {
  const keep = Math.max(1, Number(keepArg) || 30);
  const items = (await s3.list('')).filter((o) => kindOf(o.key)).sort((x, y) => (x.key < y.key ? 1 : -1));
  const seen = {};
  for (const o of items) {
    const k = kindOf(o.key); seen[k] = (seen[k] ?? 0) + 1;
    if (seen[k] > keep) { await s3.del(o.key); console.log(`  удалено ${o.key}`); }
  }
  console.log(`Оставлено по ${keep} последних каждого вида.`);
};

const check = async () => {
  const h = await s3.health();
  console.log(`${h.ok ? '✔' : '✖'} доступность и право на список (${h.ms} мс${h.ok ? '' : `, ${h.code}`})`); if (!h.ok) process.exit(1);
  const key = `.probe-${crypto.randomBytes(5).toString('hex')}`; const data = crypto.randomBytes(32 * 1024);
  await s3.put(key, (async function* () { yield data; })());
  const back = await s3.readAll(await s3.get(key)); await s3.del(key);
  const ok = back.equals(data);
  console.log(`${ok ? '✔' : '✖'} запись, чтение, сверка и удаление пробного объекта`); if (!ok) process.exit(1);
  console.log(`Хранилище копий: ${base.endpoint}, бакет ${base.bucket}, префикс ${base.prefix}host/`);
};

try {
  if (mode === 'check') await check();
  else if (mode === 'push') { if (!a1) { console.error('Укажите каталог копий.'); process.exit(2); } await push(a1); }
  else if (mode === 'list') await list();
  else if (mode === 'pull') await pull(a1 ?? 'latest', a2);
  else if (mode === 'prune') await prune(a1);
  else { console.error('Режим: check | push <каталог> | list | pull <имя|latest|all> <каталог> | prune <N>'); process.exit(2); }
} catch (e) { console.error(`Ошибка: ${e.code ?? e.message}${e.status ? ` (HTTP ${e.status})` : ''}`); process.exit(1); }
process.exit(bad ? 1 : 0);
