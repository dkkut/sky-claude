/**
 * Файлы книг на диске: озвучка глав и обложка.
 *
 * То же устройство, что у подкастов, и по той же причине: озвучка
 * весит десятки-сотни мегабайт, и собранная в память она положила бы
 * сервер. Запись и чтение идут потоком, чтение — кусками по
 * запрошенному диапазону.
 *
 * Путь никогда не собирается из присланного клиентом: имя файла — это
 * идентификатор, который выдал сервер, и он сверяется с образцом до
 * любого обращения к диску.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.BOOKS_DIR || '/data/books';

/** bau — озвучка главы, bcv — обложка книги. */
const ID_RE = /^(bau|bcv)-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const booksRoot = () => ROOT;

export const audioIdFor = (chapterId) => `bau-${String(chapterId).slice(4)}`;
export const coverIdFor = (bookId) => `bcv-${String(bookId).slice(4)}`;

export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  try {
    await mkdir(dirFor(safe), { recursive: true });
  } catch (err) {
    console.error('[books] хранилище недоступно:', err.code ?? err.message);
    return { error: 'storage_unavailable' };
  }
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

export const openStream = (id, range) => {
  const safe = checkId(id);
  return range
    ? createReadStream(pathFor(safe), { start: range.start, end: range.end })
    : createReadStream(pathFor(safe));
};

export const remove = async (id) => {
  await rm(pathFor(checkId(id)), { force: true });
};

export const removeChapterAudio = async (chapterId) => {
  await remove(audioIdFor(chapterId)).catch(() => {});
};

export const removeBookFiles = async (bookId) => {
  await remove(coverIdFor(bookId)).catch(() => {});
};

/** Что лежит на диске. Нужно уборке: файл без строки в базе не откроют. */
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
