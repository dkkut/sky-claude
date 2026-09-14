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
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

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
    // Оборвалась связь — файл тоже неполный, и держать его незачем.
    return { error: 'upload_interrupted' };
  }
  if (written === 0) {
    await remove(safe).catch(() => {});
    return { error: 'empty_file' };
  }
  return { bytes: written };
};

/** Записать уже прочитанные байты. Только для постеров: они маленькие. */
export const saveBytes = async (id, buf) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  await pipeline((async function* () { yield buf; })(), createWriteStream(pathFor(safe)));
  return { bytes: buf.length };
};

export const sizeOf = async (id) => {
  try { return (await stat(pathFor(checkId(id)))).size; } catch { return null; }
};

/**
 * Поток на чтение. `range` — уже проверенные границы включительно;
 * без него читается весь файл.
 */
export const openStream = (id, range) => {
  const safe = checkId(id);
  return range
    ? createReadStream(pathFor(safe), { start: range.start, end: range.end })
    : createReadStream(pathFor(safe));
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
