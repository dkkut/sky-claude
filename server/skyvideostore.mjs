/**
 * Файлы Sky Video/Studio на диске.
 *
 * Устройство то же, что у кино (filmstore.mjs), и по той же причине:
 * ролик весит не мегабайты, а гигабайты. Запись идёт потоком из
 * запроса на диск, чтение — потоком с диска в ответ, кусками по
 * запрошенному диапазону, чтобы память не росла от числа одновременных
 * просмотров.
 *
 * Каталог свой, не переиспользует VIDEO_DIR: та переменная уже занята
 * видеообзорами складов (server/videostore.mjs, логистика — совсем
 * другой домен с другими правами доступа), и общий каталог смешал бы
 * два разных набора идентификаторов на одном диске.
 *
 * Путь никогда не собирается из присланного клиентом — имя файла это
 * идентификатор, который выдал сервер, и он сверяется с образцом до
 * любого обращения к диску.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.SKYVIDEO_DIR || '/data/skyvideo';

/** Идентификаторы, которые мы сами и выдали: ролик и обложка к нему. */
const ID_RE = /^(svid|svtn)-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(5, 7));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const skyVideoRoot = () => ROOT;
export const thumbnailIdFor = (videoId) => `svtn-${checkId(videoId).slice(5)}`;

/**
 * Сохранить поток запроса в файл. Предел проверяется по мере
 * поступления, а не по Content-Length — заголовок пишет клиент и может
 * соврать. Недописанный файл после обрыва убирается: иначе на диске
 * копились бы огрызки от каждой неудачной попытки.
 */
export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  let written = 0;
  let tooLarge = false;
  source.on('data', (chunk) => {
    written += chunk.length;
    if (written > limitBytes && !tooLarge) {
      tooLarge = true;
      source.destroy(new Error('too_large'));
    }
  });
  try {
    await pipeline(source, createWriteStream(pathFor(safe)));
  } catch {
    await remove(safe).catch(() => {});
    if (tooLarge) return { error: 'file_too_large' };
    return { error: 'upload_interrupted' };
  }
  if (written === 0) {
    await remove(safe).catch(() => {});
    return { error: 'empty_file' };
  }
  return { bytes: written };
};

/** Записать уже прочитанные байты. Только для обложек: они маленькие. */
export const saveBytes = async (id, buf) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  await pipeline((async function* () { yield buf; })(), createWriteStream(pathFor(safe)));
  return { bytes: buf.length };
};

export const sizeOf = async (id) => {
  try { return (await stat(pathFor(checkId(id)))).size; } catch { return null; }
};

/** Поток на чтение. `range` — уже проверенные границы включительно. */
export const openStream = (id, range) => {
  const safe = checkId(id);
  return range
    ? createReadStream(pathFor(safe), { start: range.start, end: range.end })
    : createReadStream(pathFor(safe));
};

export const remove = async (id) => {
  await rm(pathFor(checkId(id)), { force: true });
};

/** Ролик и его обложка убираются вместе: обложка без ролика не нужна. */
export const removeVideoFiles = async (videoId) => {
  await remove(videoId).catch(() => {});
  await remove(thumbnailIdFor(videoId)).catch(() => {});
};

/** Что лежит на диске — нужно уборке осиротевших файлов. */
export const listStoredIds = async () => {
  const out = [];
  let dirs;
  try { dirs = await readdir(ROOT); } catch { return out; }
  for (const d of dirs) {
    let names;
    try { names = await readdir(join(ROOT, d)); } catch { continue; }
    for (const n of names) if (ID_RE.test(n)) out.push(n);
  }
  return out;
};

/** Тот же разбор Range, что у кино — см. filmstore.mjs про составные диапазоны. */
export const parseRange = (header, size) => {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    const tail = Number(rawEnd);
    if (!Number.isFinite(tail) || tail <= 0) return null;
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start < 0 || end < start || start >= size) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
};

