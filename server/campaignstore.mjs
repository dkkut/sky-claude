/**
 * Обложки мероприятий на диске.
 *
 * Устройство то же, что у афиш Sky Tickets (ticketstore.mjs), и по тем
 * же причинам: путь никогда не собирается из присланного клиентом,
 * имя файла — идентификатор, который выдал сервер сам.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const ROOT = process.env.CAMPAIGNS_DIR || '/data/campaigns';

/** ccv — обложка мероприятия. */
const ID_RE = /^ccv-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const coverIdFor = (campaignId) => {
  const s = String(campaignId ?? '');
  if (!/^camp-[0-9a-f-]{36}$/.test(s)) throw new Error('bad_id');
  return `ccv-${s.slice(5)}`;
};

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
