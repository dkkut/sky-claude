/**
 * Картинки Sky Market на диске.
 *
 * Устройство то же, что у афиш и кино, и по той же причине: путь к файлу
 * никогда не собирается из присланного клиентом. Имя файла — это
 * идентификатор, который выдал сервер, и он сверяется с образцом до
 * любого обращения к диску. Строка вроде ../../etc/passwd образцу не
 * соответствует и до файловой системы не доходит.
 *
 * Присланное имя файла не используется нигде — ни в пути, ни в заголовках
 * ответа.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.MARKET_DIR || '/data/market';

/**
 * Идентификаторы, которые мы сами и выдали:
 *   mpi — картинка товара,
 *   msa — витрина продавца (аватар магазина),
 *   mgc — обложка игры,
 *   lwp — фотография склада.
 */
const ID_RE = /^(mpi|msa|mgc|lwp)-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

/** Аватар магазина. Выводится из идентификатора профиля продавца. */
export const sellerAvatarIdFor = (profileId) => {
  const s = String(profileId ?? '');
  if (!/^acc-[0-9a-f-]{36}$/.test(s)) throw new Error('bad_id');
  return `msa-${s.slice(4)}`;
};

/** Обложка игры. */
export const gameCoverIdFor = (gameId) => {
  const s = String(gameId ?? '');
  if (!/^mg-[0-9a-f-]{36}$/.test(s)) throw new Error('bad_id');
  return `mgc-${s.slice(3)}`;
};

/**
 * Сохранить поток запроса в файл.
 *
 * Предел считается по мере поступления байтов, а не по заголовку
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
  let written = 0;
  let tooBig = false;

  const counter = async function* (stream) {
    for await (const chunk of stream) {
      written += chunk.length;
      if (written > limitBytes) { tooBig = true; throw new Error('too_large'); }
      yield chunk;
    }
  };

  try {
    await pipeline(source, counter, createWriteStream(target));
  } catch (err) {
    /* Недописанный файл убираем: иначе на диске копились бы огрызки от
       каждой неудачной попытки. */
    await rm(target, { force: true }).catch(() => {});
    if (tooBig) return { error: 'too_large' };
    return { error: err?.message === 'too_large' ? 'too_large' : 'write_failed' };
  }
  return { bytes: written };
};

export const sizeOf = async (id) => {
  try {
    const info = await stat(pathFor(checkId(id)));
    return info.size;
  } catch {
    return null;
  }
};

export const openStream = (id) => createReadStream(pathFor(checkId(id)));

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
