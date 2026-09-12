/**
 * Афиши мероприятий на диске.
 *
 * Устройство то же, что у кино и подкастов, и по тем же причинам.
 * Картинки меньше фильмов, но правило остаётся: путь никогда не
 * собирается из присланного клиентом. Имя файла — это идентификатор,
 * который выдал сервер, и он сверяется с образцом до любого обращения
 * к диску. Выйти из каталога через ../ невозможно не потому, что мы
 * это вычищаем, а потому, что такая строка образцу не соответствует и
 * дальше проверки не проходит.
 *
 * Присланное имя файла не используется вообще нигде — ни в пути, ни в
 * заголовках ответа.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.TICKETS_DIR || '/data/tickets';

/**
 * Идентификаторы, которые мы сами и выдали:
 *   tcv — обложка мероприятия,
 *   tim — дополнительная картинка.
 */
const ID_RE = /^(tcv|tim)-[0-9a-f-]{36}(-\d{1,2})?$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

/** Обложка мероприятия. Идентификатор выводится из идентификатора афиши. */
export const coverIdFor = (eventId) => {
  const s = String(eventId ?? '');
  if (!/^tev-[0-9a-f-]{36}$/.test(s)) throw new Error('bad_id');
  return `tcv-${s.slice(4)}`;
};

/** Дополнительная картинка: тот же идентификатор плюс порядковый номер. */
export const imageIdFor = (eventId, idx) => {
  const s = String(eventId ?? '');
  if (!/^tev-[0-9a-f-]{36}$/.test(s)) throw new Error('bad_id');
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n > 15) throw new Error('bad_id');
  return `tim-${s.slice(4)}-${n}`;
};

/**
 * Сохранить поток запроса в файл.
 *
 * Предел проверяется по мере поступления, а не по заголовку
 * Content-Length: заголовок пишет клиент, и он может соврать.
 */
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
    /* Недописанный файл убираем: иначе на диске копились бы огрызки
       от каждой неудачной попытки. */
    await rm(target, { force: true }).catch(() => {});
    if (tooBig) return { error: 'too_large' };
    return { error: err?.message === 'too_large' ? 'too_large' : 'write_failed' };
  }
  return { bytes: written };
};

export const sizeOf = async (id) => {
  try {
    const info = await stat(pathFor(checkId(id)));
    return info.size;
  } catch {
    return null;
  }
};

export const openStream = (id) => createReadStream(pathFor(checkId(id)));

export const remove = async (id) => {
  try { await rm(pathFor(checkId(id)), { force: true }); } catch { /* уже нет */ }
};

/** Все картинки мероприятия — при его удалении. */
export const removeEventFiles = async (eventId) => {
  const s = String(eventId ?? '');
  if (!/^tev-[0-9a-f-]{36}$/.test(s)) return;
  await remove(coverIdFor(s));
  for (let i = 0; i < 16; i += 1) {
    await remove(imageIdFor(s, i));
  }
};

/** Что лежит на диске — для уборки осиротевшего. */
export const listStoredIds = async () => {
  const out = [];
  let dirs;
  try { dirs = await readdir(ROOT); } catch { return out; }
  for (const d of dirs) {
    try {
      const files = await readdir(join(ROOT, d));
      for (const f of files) if (ID_RE.test(f)) out.push(f);
    } catch { /* каталог исчез между чтениями */ }
  }
  return out;
};
