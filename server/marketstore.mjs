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
 *   mpl — логотип товара,
 *   msa — витрина продавца (аватар магазина),
 *   mgc — обложка игры,
 *   lwp — фотография склада.
 */
const ID_RE = /^(mpi|mpl|msa|mgc|lwp)-[0-9a-f-]{36}$/;

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

/** Логотип товара. Выводится из идентификатора самого товара. */
export const productLogoIdFor = (productId) => {
  const s = String(productId ?? '');
  if (!/^mp-[0-9a-f-]{36}$/.test(s)) throw new Error('bad_id');
  return `mpl-${s.slice(3)}`;
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

/**
 * Уборка осиротевших файлов.
 *
 * Файл без строки в базе — это байты, которые уже никто не откроет и
 * никто не удалит: удаление идёт от строки, а строки нет. Появляются
 * они после каскадных удалений — ушёл человек, ушли его товары и
 * склады, а файлы остались.
 *
 * Список известных идентификаторов приходит снаружи: этот файл про
 * диск и ничего не знает про таблицы.
 */
export const sweepOrphans = async (known) => {
  /* Сначала диск, и только потом база — порядок здесь важен.
     Загрузка пишет строку в базу раньше, чем файл на диск. Если
     спросить базу первой, то картинка, загруженная в тот же миг,
     в ответе базы ещё не появится, а на диске уже будет лежать —
     и уборка сотрёт её как ничейную, оставив в карточке пустоту.
     При обратном порядке у всякого увиденного файла строка была
     записана заведомо раньше, и спрошенная после база её вернёт. */
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
