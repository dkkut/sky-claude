/**
 * Видеообзоры объектов на диске.
 *
 * Устройство то же, что у кино, и по той же причине: обзор склада — это
 * десятки и сотни мегабайт. Файл, собранный в память целиком, положил бы
 * сервер, а в Postgres он раздул бы каждую резервную копию.
 *
 * Поэтому здесь нет ни одной функции, которая держала бы видео в
 * памяти: запись идёт потоком из запроса на диск, чтение — потоком с
 * диска в ответ, кусками по запрошенному диапазону.
 *
 * Путь никогда не собирается из присланного клиентом. Имя файла — это
 * идентификатор, который выдал сервер, и он сверяется с образцом до
 * любого обращения к диску: строка вроде ../../etc/passwd образцу не
 * соответствует и до файловой системы не доходит.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.VIDEO_DIR || '/data/video';

/** Идентификатор видеообзора, который мы сами и выдали. */
const ID_RE = /^lvr-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const videoRoot = () => ROOT;

/**
 * Сохранить поток запроса в файл.
 *
 * Предел считается по мере поступления, а не по заголовку
 * Content-Length: заголовок пишет клиент, и он может соврать. Как
 * только написано больше разрешённого, поток обрывается, а недописанный
 * файл убирается — иначе на диске копились бы огрызки от каждой
 * неудачной попытки.
 */
export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  let written = 0;
  let tooBig = false;
  const out = createWriteStream(pathFor(safe));
  const guard = async function* (src) {
    for await (const chunk of src) {
      written += chunk.length;
      if (written > limitBytes) { tooBig = true; break; }
      yield chunk;
    }
  };
  try {
    await pipeline(source, guard, out);
  } catch (err) {
    await rm(pathFor(safe), { force: true });
    return { error: 'write_failed', detail: err.message };
  }
  if (tooBig) {
    await rm(pathFor(safe), { force: true });
    return { error: 'too_large' };
  }
  return { bytes: written };
};

export const sizeOf = async (id) => {
  try { return (await stat(pathFor(checkId(id)))).size; }
  catch { return null; }
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

/** Что лежит на диске — для уборки осиротевшего. */
export const listStoredIds = async () => {
  const out = [];
  let dirs;
  try { dirs = await readdir(ROOT); } catch { return out; }
  for (const d of dirs) {
    try {
      const names = await readdir(join(ROOT, d));
      for (const n of names) if (ID_RE.test(n)) out.push(n);
    } catch { /* каталог исчез между чтениями */ }
  }
  return out;
};

/**
 * Убрать файлы, у которых не осталось строки в базе.
 *
 * Сначала диск, потом база — тот же порядок и по той же причине, что в
 * маркете: загрузка пишет строку раньше файла, и обратный порядок
 * стирал бы обзор, загруженный посреди уборки.
 */
export const sweepOrphans = async (known) => {
  const stored = await listStoredIds();
  if (stored.length === 0) return 0;
  const alive = typeof known === 'function' ? await known() : known;
  const live = alive instanceof Set ? alive : new Set(alive ?? []);
  let removed = 0;
  for (const id of stored) {
    if (live.has(id)) continue;
    await remove(id);
    removed += 1;
  }
  return removed;
};

/**
 * Разбор заголовка Range. Возвращает null, если заголовка нет или он не
 * той формы, и { invalid: true } — если диапазон за пределами файла: на
 * такое положено отвечать 416, а не тихо подставлять другие границы.
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
