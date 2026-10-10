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
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs,
 * AES-256-GCM, конвертная схема, посегментно — Range работает без
 * расшифровки всего файла). Получивший доступ к тому/бэкапу видит
 * только шифротекст — не трек. Ключ шифрования никогда не уходит
 * клиенту: тот получает только расшифрованный поток байт после
 * обычной проверки доступа, как и раньше.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  encryptStreamToFile, encryptBytesToFile, openDecryptedRangeStream, plaintextSizeOf,
} from './mediacrypto.mjs';

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

/** Сохранить поток запроса в файл, не поднимая его в память целиком.
 *  На диске окажется уже зашифрованный файл — см. mediacrypto.mjs. */
export const saveStream = async (id, source, limitBytes) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  let result;
  try {
    result = await encryptStreamToFile(source, pathFor(safe), limitBytes);
  } catch {
    // Связь оборвалась на середине загрузки: исключение раньше уходило
    // наверх, запись о треке с зарезервированным местом оставалась
    // в базе (и съедала квоту), а в хранилище — неполный файл.
    await remove(safe).catch(() => {});
    return { error: 'upload_interrupted' };
  }
  if (result.error) await remove(safe).catch(() => {});
  return result;
};

/** Записать уже прочитанные байты (обложки — они маленькие), тоже зашифрованными. */
export const saveBytes = async (id, buf) => {
  const safe = checkId(id);
  await mkdir(dirFor(safe), { recursive: true });
  return encryptBytesToFile(buf, pathFor(safe));
};

/** Настоящий (расшифрованный) размер — не размер файла на диске. */
export const sizeOf = async (id) => plaintextSizeOf(pathFor(checkId(id)));

/**
 * Поток расшифрованных байт на чтение. `range` — уже проверенные
 * границы включительно; без него читается весь файл. Расшифровываются
 * только те сегменты файла, что перекрывают запрошенный диапазон —
 * перемотка не тянет файл целиком.
 */
export const openStream = (id, range) => {
  const safe = checkId(id);
  return openDecryptedRangeStream(pathFor(safe), range ?? null);
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
