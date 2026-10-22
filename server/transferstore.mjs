/**
 * Временные куски передач Sky Transfer на диске. Каждый кусок — отдельный файл `xfr-<id>-<n>`, зашифрованный слоем
 * mediacrypto (SKE1, ключ сервера): получивший доступ к тому или копии видит шифротекст. Имя файла собирается только из
 * идентификатора, выданного сервером, и номера куска — выйти из каталога нельзя. Файлы удаляются сразу после получения,
 * отмены или срока (transfer.mjs → sweepTransfers). ВАЖНО: это шифрование «на диске», а не сквозное — сервер может расшифровать.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { encryptBytesToFile, openDecryptedRangeStream, plaintextSizeOf, removeMedia } from './mediacrypto.mjs';

const ROOT = process.env.TRANSFER_DIR || '/data/transfer';
const ID_RE = /^xfr-[0-9a-f-]{36}$/;
const chunkId = (id, n) => {
  if (!ID_RE.test(String(id)) || !Number.isInteger(n) || n < 0 || n > 100000) throw new Error('bad_id');
  return `${id}-${n}`;
};
const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id, n) => join(dirFor(id), chunkId(id, n));

export const saveChunk = async (id, n, buf) => { await mkdir(dirFor(id), { recursive: true }); return encryptBytesToFile(buf, pathFor(id, n)); };
export const chunkSize = (id, n) => plaintextSizeOf(pathFor(id, n));
export const openChunk = (id, n) => openDecryptedRangeStream(pathFor(id, n), null);
export const removeChunk = (id, n) => removeMedia(pathFor(id, n));
