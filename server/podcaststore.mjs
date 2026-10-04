/**
 * Файлы подкастов на диске.
 *
 * Устроено так же, как хранилище кино, и по тем же причинам: выпуск с
 * видео весит сотни мегабайт, и собранный в память он положил бы
 * сервер — у контейнера api памяти гигабайт. Запись идёт потоком из
 * запроса на диск, чтение — потоком с диска в ответ, кусками по
 * запрошенному диапазону.
 *
 * Путь никогда не собирается из присланного клиентом: имя файла — это
 * идентификатор, который выдал сервер, и он сверяется с образцом до
 * любого обращения к диску. Выйти из каталога через ../ невозможно не
 * потому, что мы это вычищаем, а потому, что такая строка образцу не
 * соответствует.
 *
 * Отдельный каталог, а не общий с кино: подкасты и фильмы меряют,
 * чистят и переносят порознь.
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs).
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  encryptStreamToFile, encryptBytesToFile, openDecryptedRangeStream, plaintextSizeOf,
} from './mediacrypto.mjs';

const ROOT = process.env.PODCAST_DIR || '/data/podcasts';

/**
 * Идентификаторы, которые мы сами и выдали:
 *   pau — звук выпуска, pvd — видео выпуска,
 *   pec — обложка выпуска, pcv — обложка передачи.
 */
const ID_RE = /^(pau|pvd|pec|pcv)-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const podcastRoot = () => ROOT;

/** Имена файлов выпуска и передачи — из их идентификаторов. */
export const audioIdFor = (episodeId) => `pau-${String(episodeId).slice(4)}`;
export const videoIdFor = (episodeId) => `pvd-${String(episodeId).slice(4)}`;
export const epCoverIdFor = (episodeId) => `pec-${String(episodeId).slice(4)}`;
export const showCoverIdFor = (podcastId) => `pcv-${String(podcastId).slice(4)}`;

/**
 * Сохранить поток запроса в файл.
 *
 * Предел считается по фактически пришедшим байтам, а не по заголовку
 * Content-Length: заголовок пишет клиент, и он может соврать. Как
 * только написано больше разрешённого, поток обрывается, а недописанный
 * файл убирается — иначе на диске копились бы огрызки.
 */
export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  // Если каталог не создаётся — диск полон или права не те. Это не
  // «ошибка запроса», но и не повод отдавать 500 без объяснения:
  // ручка получит понятный отказ, а подробности останутся в журнале.
  try {
    await mkdir(dirFor(safe), { recursive: true });
  } catch (err) {
    console.error('[podcasts] хранилище недоступно:', err.code ?? err.message);
    return { error: 'storage_unavailable' };
  }
  let result;
  try {
    result = await encryptStreamToFile(source, pathFor(safe), limitBytes);
  } catch {
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
  await rm(pathFor(checkId(id)), { force: true });
};

/** Все файлы выпуска убираются вместе: порознь они никому не нужны. */
export const removeEpisodeFiles = async (episodeId) => {
  for (const id of [audioIdFor(episodeId), videoIdFor(episodeId), epCoverIdFor(episodeId)]) {
    await remove(id).catch(() => {});
  }
};

export const removeShowFiles = async (podcastId) => {
  await remove(showCoverIdFor(podcastId)).catch(() => {});
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

/**
 * Разбор заголовка Range.
 *
 * null — заголовка нет или он не той формы (отдаём весь файл);
 * { invalid: true } — запрошено за пределами файла, и на такое положено
 * отвечать 416, а не тихо подставлять другие границы.
 */
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
