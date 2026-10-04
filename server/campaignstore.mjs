/**
 * Обложки мероприятий на диске.
 *
 * Устройство то же, что у афиш Sky Tickets (ticketstore.mjs), и по тем
 * же причинам: путь никогда не собирается из присланного клиентом,
 * имя файла — идентификатор, который выдал сервер сам.
 */
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf } from './mediacrypto.mjs';

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
  let result;
  try {
    result = await encryptStreamToFile(source, target, limitBytes);
  } catch (err) {
    await rm(target, { force: true }).catch(() => {});
    return { error: err?.message === 'too_large' ? 'too_large' : 'write_failed' };
  }
  if (result.error) {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'too_large' };
  }
  return result;
};

/** Настоящий (расшифрованный) размер — не размер файла на диске. */
export const sizeOf = async (id) => plaintextSizeOf(pathFor(checkId(id)));

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
