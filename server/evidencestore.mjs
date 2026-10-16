/**
 * Доказательства по нарушениям (фото/видео/документы/скриншоты) на диске.
 *
 * То же устройство и по той же причине, что у videostore.mjs: файл
 * пишется потоком из запроса на диск и читается потоком с диска в
 * ответ — ничего не держится в памяти целиком, и ни одна резервная
 * копия базы не раздувается чужим видео.
 *
 * Путь никогда не собирается из присланного клиентом. Имя файла — это
 * идентификатор, который выдал сервер (vev-<uuid>), и он сверяется с
 * образцом до любого обращения к диску.
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs).
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf, removeMedia } from './mediacrypto.mjs';

const ROOT = process.env.EVIDENCE_DIR || '/data/evidence';

const ID_RE = /^vev-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const evidenceRoot = () => ROOT;

/** Сохранить поток запроса в файл. Предел — по факту записанного, не по Content-Length. */
export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  let result;
  try {
    result = await encryptStreamToFile(source, pathFor(safe), limitBytes);
  } catch (err) {
    await removeMedia(pathFor(safe));
    return { error: 'write_failed', detail: err.message };
  }
  if (result.error) {
    await removeMedia(pathFor(safe));
    return { error: 'too_large' };
  }
  return result;
};

/** Настоящий (расшифрованный) размер — не размер файла на диске. */
export const sizeOf = async (id) => plaintextSizeOf(pathFor(checkId(id)));

export const openStream = (id, range) => {
  const safe = checkId(id);
  return openDecryptedRangeStream(pathFor(safe), range ?? null);
};

export const remove = async (id) => {
  await removeMedia(pathFor(checkId(id)));
};

/** Что лежит на диске — для уборки осиротевшего. */
export const listStoredIds = async () => {
  const out = [];
  let dirs;
  try { dirs = await readdir(ROOT); } catch { return out; }
  for (const d of dirs) {
    try {
      const names = await readdir(join(ROOT, d));
      for (const n of names) if (ID_RE.test(n)) out.push(n);
    } catch { /* каталог исчез между чтениями */ }
  }
  return out;
};

/** Убрать файлы, у которых не осталось строки в базе (сначала диск, потом проверка — см. videostore.mjs). */
export const sweepOrphans = async (known) => {
  const stored = await listStoredIds();
  if (stored.length === 0) return 0;
  const alive = typeof known === 'function' ? await known() : known;
  const live = alive instanceof Set ? alive : new Set(alive ?? []);
  let removed = 0;
  for (const id of stored) {
    if (live.has(id)) continue;
    await remove(id);
    removed += 1;
  }
  return removed;
};
