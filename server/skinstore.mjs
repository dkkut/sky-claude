/**
 * Медиа скинов Sky Skin Market (превью-картинка/анимация, 3D-модель) на
 * диске — по образцу storystore.mjs/bloomstore.mjs.
 */
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { encryptStreamToFile, openDecryptedRangeStream, plaintextSizeOf } from './mediacrypto.mjs';

const ROOT = process.env.SKIN_DIR || '/data/skins';

const ID_RE = /^skm-[0-9a-f-]{36}$/;

const dirFor = (id) => join(ROOT, id.slice(4, 6));
const pathFor = (id) => join(dirFor(id), id);

const checkId = (id) => {
  const s = String(id ?? '');
  if (!ID_RE.test(s)) throw new Error('bad_id');
  return s;
};

export const newMediaId = () => `skm-${crypto.randomUUID()}`;

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
  } catch {
    await rm(target, { force: true }).catch(() => {});
    return { error: 'write_failed' };
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

export const openStream = (id, range) => {
  const safe = checkId(id);
  return openDecryptedRangeStream(pathFor(safe), range ?? null);
};

export const remove = async (id) => {
  try { await rm(pathFor(checkId(id)), { force: true }); } catch { /* уже нет */ }
};

/** Все id, реально лежащие на диске — для сверки с базой (сирота-медиа). */
export const listStoredIds = async () => {
  const out = [];
  let dirs;
  try { dirs = await readdir(ROOT); } catch { return out; }
  for (const d of dirs) {
    let files;
    try { files = await readdir(join(ROOT, d)); } catch { continue; }
    for (const f of files) if (ID_RE.test(f)) out.push(f);
  }
  return out;
};
