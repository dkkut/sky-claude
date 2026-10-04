/**
 * Файлы, отданные Sky AI на разбор.
 *
 * Устройство то же, что у кино, подкастов и афиш, и по тем же
 * причинам. Путь никогда не собирается из присланного клиентом: имя
 * файла — это идентификатор, который выдал сервер, и он сверяется с
 * образцом до любого обращения к диску. Выйти из каталога через ../
 * невозможно не потому, что мы это вычищаем, а потому, что такая
 * строка образцу не соответствует.
 *
 * Присланное имя файла не используется нигде — ни в пути, ни в
 * заголовках ответа. Оно хранится отдельной колонкой в базе, только
 * чтобы показать человеку, что он загружал.
 *
 * Отличие от остальных хранилищ одно, и оно важное: здесь файл живёт
 * недолго. Его разбирают и сразу удаляют — держать чужой паспорт,
 * присланный «посмотри, что тут написано», дольше необходимого не
 * нужно никому.
 *
 * На диске файлы лежат зашифрованными (server/mediacrypto.mjs) — живут
 * недолго, но пока лежат, тоже видны только как шифротекст.
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf, decryptToBuffer,
} from './mediacrypto.mjs';

const ROOT = process.env.AI_FILES_DIR || '/data/aifiles';

/** Идентификаторы, которые мы сами и выдали. */
const ID_RE = /^aif-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
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
  let result;
  try {
    result = await encryptStreamToFile(source, target, limitBytes);
  } catch (err) {
    /* Недописанный файл убираем: иначе на диске копились бы огрызки
       от каждой неудачной попытки. */
    await rm(target, { force: true }).catch(() => {});
    return { error: err?.message === 'too_large' ? 'too_large' : 'write_failed' };
  }
  if (result.error) {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'too_large' };
  }
  if (result.bytes === 0) {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'empty_file' };
  }
  return result;
};

/** Настоящий (расшифрованный) размер — не размер файла на диске. */
export const sizeOf = async (id) => plaintextSizeOf(pathFor(checkId(id)));

/**
 * Прочитать файл целиком.
 *
 * Целиком — потому что и модели, и разбору документа нужен весь файл
 * сразу; потоком тут выиграть нечего. Держит это в рамках предел
 * размера на загрузке, а не надежда на порядочность: без предела
 * несколько больших файлов подряд положили бы сервер по памяти.
 */
export const readWhole = async (id, maxBytes) => {
  const safe = checkId(id);
  const size = await sizeOf(safe);
  if (size === null) return { error: 'not_found' };
  if (size > maxBytes) return { error: 'too_large' };
  try {
    return { data: await decryptToBuffer(pathFor(safe)) };
  } catch {
    return { error: 'not_found' };
  }
};

export const openStream = (id) => openDecryptedRangeStream(pathFor(checkId(id)), null);

export const remove = async (id) => {
  try { await rm(pathFor(checkId(id)), { force: true }); } catch { /* уже нет */ }
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
