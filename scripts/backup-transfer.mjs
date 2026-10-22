#!/usr/bin/env node
/**
 * Перенос резервного хранилища (копии Sky Storage: объекты SBK1, манифесты, цепочка) на другой сервер/бакет/каталог.
 *
 *   node scripts/backup-transfer.mjs plan      # только сравнение: что есть тут, что уже там, сколько копировать (по умолчанию, ничего не меняет)
 *   node scripts/backup-transfer.mjs copy      # докопировать недостающее/другого размера; источник НЕ трогается и НЕ удаляется
 *   node scripts/backup-transfer.mjs verify    # сверить размер и SHA-256 каждого объекта на обеих сторонах (читает всё: долго)
 *
 * Откуда: текущая цель копий (STORAGE_BACKUP_TARGET=s3|local и STORAGE_BACKUP_S3_* / STORAGE_S3_* / STORAGE_BACKUP_DIR) — как её видит сервер.
 * Куда (одно из):
 *   NEW_BACKUP_TARGET=s3     NEW_BACKUP_S3_ENDPOINT / _REGION / _BUCKET / _ACCESS_KEY / _SECRET_KEY / _PREFIX / _PATH_STYLE
 *   NEW_BACKUP_TARGET=local  NEW_BACKUP_DIR=/mnt/новый-том
 * Секреты в вывод не попадают. Объекты зашифрованы (SBK1, ключ KEK из STORAGE_KEK_*): на новом сервере нужны те же KEK — иначе копии не открыть.
 * Запуск на действующем сервере: `docker compose exec -T api node scripts/backup-transfer.mjs plan` (NEW_* передать через `-e`).
 */
import { createHash } from 'node:crypto';
import { getTarget } from '../server/skystoragetarget.mjs';

const mode = (process.argv[2] ?? 'plan').toLowerCase();
if (!['plan', 'copy', 'verify'].includes(mode)) { console.error('Режим: plan | copy | verify'); process.exit(2); }
const env = process.env;
const NEW = env.NEW_BACKUP_TARGET?.toLowerCase();
if (!NEW || !['s3', 'local'].includes(NEW)) { console.error('Задайте NEW_BACKUP_TARGET=s3|local и параметры нового хранилища (см. заголовок скрипта).'); process.exit(2); }

const fmt = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} ГБ` : n >= 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} МБ` : `${n} Б`);

// 1) источник — как сейчас настроен сервер
const src = getTarget();
// 2) приёмник — те же фабрики, но с переключённым окружением
const keep = { t: env.STORAGE_BACKUP_TARGET, d: env.STORAGE_BACKUP_DIR, ind: env.STORAGE_BACKUP_INDEPENDENT };
const s3keys = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY', 'SECRET_KEY', 'PREFIX', 'PATH_STYLE'];
const savedS3 = Object.fromEntries(s3keys.map((k) => [k, env[`STORAGE_BACKUP_S3_${k}`]]));
env.STORAGE_BACKUP_TARGET = NEW;
if (NEW === 'local') env.STORAGE_BACKUP_DIR = env.NEW_BACKUP_DIR ?? '';
else for (const k of s3keys) { const v = env[`NEW_BACKUP_S3_${k}`]; if (v !== undefined) env[`STORAGE_BACKUP_S3_${k}`] = v; else delete env[`STORAGE_BACKUP_S3_${k}`]; }
let dst;
try { dst = getTarget(); } catch (e) { console.error(`Новое хранилище не настроено: ${e.code}${e.detail ? ` (${e.detail})` : ''}`); process.exit(2); }
// вернуть окружение (источник уже создан, но на всякий случай)
env.STORAGE_BACKUP_TARGET = keep.t; env.STORAGE_BACKUP_DIR = keep.d; env.STORAGE_BACKUP_INDEPENDENT = keep.ind;
for (const k of s3keys) { if (savedS3[k] === undefined) delete env[`STORAGE_BACKUP_S3_${k}`]; else env[`STORAGE_BACKUP_S3_${k}`] = savedS3[k]; }

const same = src.kind === dst.kind && src.label === dst.label && (src.prefix ?? '') === (dst.prefix ?? '');
if (same) { console.error('Источник и приёмник совпадают — переносить некуда.'); process.exit(2); }

const hd = await dst.health?.(); if (hd && hd.ok === false) { console.error(`Новое хранилище недоступно: ${hd.code ?? 'error'}`); process.exit(1); }
const hs = await src.health?.(); if (hs && hs.ok === false) { console.error(`Текущее хранилище недоступно: ${hs.code ?? 'error'}`); process.exit(1); }

const sha = async (stream) => { const h = createHash('sha256'); for await (const c of stream) h.update(c); return h.digest('hex'); };
const items = (await src.list('')).sort((a, b) => a.key.localeCompare(b.key));
const total = items.reduce((s, x) => s + x.size, 0);
console.log(`Источник: ${src.kind} ${src.label}${src.prefix ? ` (${src.prefix})` : ''} — объектов: ${items.length}, ${fmt(total)}`);
console.log(`Приёмник: ${dst.kind} ${dst.label}${dst.prefix ? ` (${dst.prefix})` : ''}`);
if (!items.length) { console.log('Копировать нечего.'); process.exit(0); }

let copy = 0, copyBytes = 0, skip = 0, fail = 0, done = 0, bad = 0;
for (const it of items) {
  const h = await dst.head(it.key).catch(() => null);
  const have = h && h.size === it.size;
  if (mode === 'verify') {
    if (!have) { bad++; console.log(`НЕТ/РАЗМЕР  ${it.key}`); continue; }
    const [a, b] = await Promise.all([sha(await src.get(it.key)), sha(await dst.get(it.key))]);
    if (a !== b) { bad++; console.log(`SHA-256 РАЗНЫЕ  ${it.key}`); } else done++;
    continue;
  }
  if (have) { skip++; continue; }
  copy++; copyBytes += it.size;
  if (mode === 'plan') continue;
  try {
    await dst.put(it.key, await src.get(it.key));
    const after = await dst.head(it.key);
    if (!after || after.size !== it.size) { fail++; console.log(`ОШИБКА размера после копирования: ${it.key}`); } else done++;
  } catch (e) { fail++; console.log(`ОШИБКА ${it.key}: ${e.code ?? e.message}`); }
}
if (mode === 'plan') console.log(`План: уже на месте ${skip}, скопировать ${copy} (${fmt(copyBytes)}). Ничего не изменено.`);
else if (mode === 'copy') { console.log(`Скопировано ${done}, уже было ${skip}, ошибок ${fail}. Источник не тронут. Дальше: verify.`); process.exit(fail ? 1 : 0); }
else { console.log(`Сверено ${done} из ${items.length}, расхождений ${bad}. ${bad ? 'ПЕРЕКЛЮЧАТЬСЯ РАНО.' : 'Копии идентичны.'}`); process.exit(bad ? 1 : 0); }
