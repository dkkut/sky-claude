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
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';

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
  let written = 0;
  let tooBig = false;

  const counter = async function* (stream) {
    for await (const chunk of stream) {
      written += chunk.length;
      if (written > limitBytes) { tooBig = true; throw new Error('too_large'); }
      yield chunk;
    }
  };

  try {
    await pipeline(source, counter, createWriteStream(target));
  } catch (err) {
    await rm(target, { force: true }).catch(() => {});
    if (tooBig) return { error: 'too_large' };
    return { error: err?.message === 'too_large' ? 'too_large' : 'write_failed' };
  }
  if (written === 0) {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'empty_file' };
  }
  return { bytes: written };
};

export const sizeOf = async (id) => {
  try {
    return (await stat(pathFor(checkId(id)))).size;
  } catch {
    return null;
  }
};

export const openStream = (id, range) => {
  const safe = checkId(id);
  return range
    ? createReadStream(pathFor(safe), { start: range.start, end: range.end })
    : createReadStream(pathFor(safe));
};

export const remove = async (id) => {
  try { await rm(pathFor(checkId(id)), { force: true }); } catch { /* уже нет */ }
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
