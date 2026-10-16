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
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs).
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  encryptStreamToFile, encryptBytesToFile, openDecryptedRangeStream, plaintextSizeOf, removeMedia } from './mediacrypto.mjs';

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
  let result;
  try {
    result = await encryptStreamToFile(source, pathFor(safe), limitBytes);
  } catch (storageErr) {
    if (storageErr?.name === 'StorageBlocked') return { error: storageErr.code };
    await remove(safe).catch(() => {});
    return { error: 'upload_interrupted' };
  }
  if (result.error) {
    await remove(safe).catch(() => {});
    return result;
  }
  if (result.bytes === 0) {
    await remove(safe).catch(() => {});
    return { error: 'empty_file' };
  }
  return result;
};

/** Записать уже прочитанные байты. Только для обложек: они маленькие. */
export const saveBytes = async (id, buf) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  return encryptBytesToFile(buf, pathFor(safe));
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
