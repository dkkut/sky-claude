/**
 * Медиа подарков (каталог Sky Gifts и карточка Prime) на диске.
 *
 * В отличие от обложек мероприятий/билетов/книг, где имя файла
 * выводится из id владеющей записи (замена всегда перезаписывает тот
 * же путь), здесь у КАЖДОЙ загрузки — свой новый случайный id. Это и
 * есть версионирование: старая версия не исчезает и не перезаписывается,
 * пока на неё ссылается хотя бы один уже отправленный экземпляр
 * подарка (gift_instances.media_id / prime_gift_instances что-то не
 * хранит медиа — только тема). Устаревшие версии, на которые никто не
 * ссылается, убирает отдельный sweep (см. server/server.mjs).
 *
 * Путь никогда не собирается из присланного клиентом — имя файла это
 * идентификатор, который выдал сервер сам.
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs).
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf, removeMedia } from './mediacrypto.mjs';

const ROOT = process.env.GIFTS_DIR || '/data/gifts';

const ID_RE = /^gfm-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

/** Новый идентификатор версии медиа — сервер выдаёт его сам. */
export const newMediaId = () => `gfm-${crypto.randomUUID()}`;

export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  try {
    await mkdir(dirFor(safe), { recursive: true });
  } catch {
    return { error: 'storage_unavailable' };
  }

  const target = pathFor(safe);
  let result;
  try {
    result = await encryptStreamToFile(source, target, limitBytes);
  } catch {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'write_failed' };
  }
  if (result.error) {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'too_large' };
  }
  if (result.bytes === 0) {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'empty_file' };
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
  try { await removeMedia(pathFor(checkId(id))); } catch { /* уже нет */ }
};

/** Что лежит на диске — для уборки версий, на которые никто не ссылается. */
export const listStoredIds = async () => {
  const out = [];
  let dirs;
  try { dirs = await readdir(ROOT); } catch { return out; }
  for (const d of dirs) {
    let files;
    try { files = await readdir(join(ROOT, d)); } catch { continue; }
    for (const f of files) if (ID_RE.test(f)) out.push(f);
  }
  return out;
};
