/** Файлы пользовательских подарков на диске, зашифрованные (mediacrypto). Отдельный каталог: уборщик подарков каталога Sky Gifts (gift_media) их не трогает. Путь выводится из id, который выдал сервер. */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf, removeMedia } from './mediacrypto.mjs';

const ROOT = process.env.CUSTOM_GIFTS_DIR || '/data/custom-gifts';
const ID_RE = /^cgm-[0-9a-f-]{36}$/;
const pathFor = (id) => { const s = String(id ?? ''); if (!ID_RE.test(s)) throw new Error('bad_id'); return join(ROOT, s.slice(4, 6), s); };
export const saveMedia = async (id, source, limit) => {
  const target = pathFor(id);
  try { await mkdir(join(target, '..'), { recursive: true }); } catch { return { error: 'storage_unavailable' }; }
  try { const r = await encryptStreamToFile(source, target, limit); if (r.error || !r.bytes) { await rm(target, { force: true }).catch(() => {}); return { error: 'write_failed' }; } return r; }
  catch { await rm(target, { force: true }).catch(() => {}); return { error: 'write_failed' }; }
};
export const mediaSize = (id) => plaintextSizeOf(pathFor(id));
export const openMedia = (id, range) => openDecryptedRangeStream(pathFor(id), range ?? null);
export const removeMediaFile = async (id) => { try { await removeMedia(pathFor(id)); } catch { /* уже нет */ } };
