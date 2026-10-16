/**
 * Файлы кино на диске.
 *
 * Отдельно от музыки и от базы, и по более веской причине: фильм весит
 * не мегабайты, а гигабайты. У контейнера api памяти всего гигабайт, и
 * файл, собранный в память целиком, положил бы сервер с первого же
 * просмотра — не говоря о том, что в Postgres он раздул бы каждую
 * резервную копию.
 *
 * Поэтому здесь нет ни одной функции, которая держала бы фильм в
 * памяти: запись идёт потоком из запроса на диск, чтение — потоком с
 * диска в ответ, кусками по запрошенному диапазону. Сколько бы людей
 * ни смотрели одновременно, расход памяти остаётся тем же.
 *
 * Путь никогда не собирается из присланного клиентом: имя файла — это
 * идентификатор, который выдал сервер, и он сверяется с образцом до
 * любого обращения к диску. Выйти из каталога через ../ невозможно не
 * потому, что мы это вычищаем, а потому, что такая строка образцу не
 * соответствует и дальше проверки не проходит.
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs,
 * AES-256-GCM, конвертная схема, посегментно — перемотка работает без
 * расшифровки файла целиком). Получивший доступ к тому/бэкапу видит
 * только шифротекст.
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  encryptStreamToFile, encryptBytesToFile, openDecryptedRangeStream, plaintextSizeOf,
} from './mediacrypto.mjs';

/** Куда складывать. В контейнере это отдельный том, а не образ. */
const ROOT = process.env.FILM_DIR || '/data/film';

/** Идентификаторы, которые мы сами и выдали: фильм и постер к нему. */
const ID_RE = /^(mov|pst)-[0-9a-f-]{36}$/;

/**
 * Раскладка по подкаталогам из двух символов идентификатора. Тысячи
 * файлов в одном каталоге замедляют любую работу с ним, а так их
 * получается около двухсот пятидесяти шести ровных стопок.
 */
const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const filmRoot = () => ROOT;
export const posterIdFor = (movieId) => `pst-${checkId(movieId).slice(4)}`;

/**
 * Сохранить поток запроса в файл.
 *
 * Предел проверяется по мере поступления, а не по заголовку
 * Content-Length: заголовок пишет клиент, и он может соврать. Как
 * только написано больше разрешённого, поток обрывается, а недописанный
 * файл убирается — иначе на диске копились бы огрызки от каждой
 * неудачной попытки.
 */
export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  let result;
  try {
    result = await encryptStreamToFile(source, pathFor(safe), limitBytes);
  } catch (storageErr) {
    if (storageErr?.name === 'StorageBlocked') return { error: storageErr.code };
    await remove(safe).catch(() => {});
    // Оборвалась связь — файл тоже неполный, и держать его незачем.
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

/** Записать уже прочитанные байты. Только для постеров: они маленькие. */
export const saveBytes = async (id, buf) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  return encryptBytesToFile(buf, pathFor(safe));
};

/** Настоящий (расшифрованный) размер — не размер файла на диске. */
export const sizeOf = async (id) => plaintextSizeOf(pathFor(checkId(id)));

/**
 * Поток на чтение. `range` — уже проверенные границы включительно;
 * без него читается весь файл.
 */
export const openStream = (id, range) => {
  const safe = checkId(id);
  return openDecryptedRangeStream(pathFor(safe), range ?? null);
};

export const remove = async (id) => {
  await rm(pathFor(checkId(id)), { force: true });
};

/** Фильм и его постер убираются вместе: постер без фильма никому не нужен. */
export const removeMovieFiles = async (movieId) => {
  await remove(movieId).catch(() => {});
  await remove(posterIdFor(movieId)).catch(() => {});
};

/**
 * Что лежит на диске. Нужно уборке: файл без строки в базе никто
 * никогда не откроет, но место он занимает.
 */
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
 * Возвращает null, если заголовка нет или он не той формы (тогда
 * отдаётся весь файл), и { invalid: true }, если диапазон запрошен
 * за пределами файла — на такое положено отвечать 416, а не тихо
 * подставлять другие границы.
 *
 * Составные диапазоны («bytes=0-99,200-299») намеренно не
 * поддерживаются: ни один проигрыватель их не просит, а ответ на них
 * требует многочастного тела, то есть лишнего кода на пути, по
 * которому идут гигабайты чужих файлов.
 */
export const parseRange = (header, size) => {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // «последние N байт»
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
