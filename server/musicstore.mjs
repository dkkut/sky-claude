/**
 * Файлы музыки на диске.
 *
 * Не в базе намеренно: трек весит мегабайты, и в Postgres он раздул бы
 * и саму базу, и каждую резервную копию, а при выдаче прошёл бы через
 * память сервера целиком. На диске файл отдаётся потоком по кускам —
 * оперативная память при этом почти не расходуется, сколько бы человек
 * ни слушали одновременно.
 *
 * Путь никогда не собирается из того, что прислал клиент: имя файла —
 * это идентификатор трека, а он выдан сервером и проверен по образцу.
 * Поэтому выйти из каталога через ../ невозможно в принципе.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

/** Куда складывать. В контейнере это отдельный том, а не образ. */
const ROOT = process.env.MUSIC_DIR || '/data/music';

/** Идентификаторы, которые мы сами и выдали. */
const ID_RE = /^(trk|cov)-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

/** Проверка идентификатора до любого обращения к диску. */
const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const musicRoot = () => ROOT;

/** Сохранить поток запроса в файл, не поднимая его в память целиком. */
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
  } catch (err) {
    await remove(safe).catch(() => {});
    if (tooLarge) return { error: 'file_too_large' };
    throw err;
  }
  return { bytes: written };
};

/** Записать уже прочитанные байты (обложки — они маленькие). */
export const saveBytes = async (id, buf) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  await pipeline(
    (async function* () { yield buf; })(),
    createWriteStream(pathFor(safe)),
  );
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

/** Разбор заголовка Range. Возвращает null, если он неверен или его нет. */
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
