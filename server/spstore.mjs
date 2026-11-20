/** Файлы картинок Sky Pets: на диске, зашифрованы слоем mediacrypto (как у пользовательских подарков). В базе — только описание. */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf, removeMedia } from './mediacrypto.mjs';

const ROOT = process.env.PETS_DIR || '/data/pets';
const ID_RE = /^pim-[0-9a-f-]{36}(-t)?$/;
export const validImageId = (s) => ID_RE.test(String(s ?? ''));
const pathFor = (id) => { const s = String(id ?? ''); if (!ID_RE.test(s)) throw new Error('bad_id'); return join(ROOT, s.slice(4, 6), s); };
export const savePetFile = async (id, buf) => {
  const target = pathFor(id);
  try { await mkdir(join(target, '..'), { recursive: true }); } catch { return { error: 'storage_unavailable' }; }
  try { const r = await encryptStreamToFile(Readable.from([buf]), target, buf.length + 1024); if (r.error || !r.bytes) { await rm(target, { force: true }).catch(() => {}); return { error: 'write_failed' }; } return r; }
  catch { await rm(target, { force: true }).catch(() => {}); return { error: 'write_failed' }; }
};
export const petFileSize = (id) => plaintextSizeOf(pathFor(id));
export const openPetFile = (id) => openDecryptedRangeStream(pathFor(id), null);
export const removePetFile = async (id) => { try { await removeMedia(pathFor(id)); } catch { /* уже нет */ } };
