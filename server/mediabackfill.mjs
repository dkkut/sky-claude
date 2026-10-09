/**
 * Приведение уже лежащих на диске медиафайлов к шифрованному виду.
 *
 * Шифрование хранилища включили, а файлы, загруженные раньше, остались
 * открытыми — и раньше не открывались совсем (размер не читался, ручки
 * отвечали «не найдено»). Теперь mediacrypto читает и их, а этот проход
 * дошифровывает их на месте и перепаковывает ключ файлов, обёрнутых
 * прежним мастер-ключом. Запускается при старте API, не блокируя его;
 * повторный запуск ничего не портит: готовые файлы пропускаются.
 */
import { readdir, stat, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isLegacyMedia, encryptExistingFile, plaintextSizeOf, rewrapMediaKey,
} from './mediacrypto.mjs';

/** Каталоги медиа — те же переменные и значения по умолчанию, что у хранилищ. */
const roots = () => [
  [process.env.MUSIC_DIR, '/data/music'], [process.env.FILM_DIR, '/data/film'],
  [process.env.SKYVIDEO_DIR, '/data/skyvideo'], [process.env.PODCAST_DIR, '/data/podcasts'],
  [process.env.BOOKS_DIR, '/data/books'], [process.env.VIDEO_DIR, '/data/video'],
  [process.env.BLOOM_DIR, '/data/bloom'], [process.env.STORY_DIR, '/data/stories'],
  [process.env.GIFTS_DIR, '/data/gifts'], [process.env.ADS_DIR, '/data/ads'],
  [process.env.CAMPAIGNS_DIR, '/data/campaigns'], [process.env.SKIN_DIR, '/data/skins'],
  [process.env.EVIDENCE_DIR, '/data/evidence'], [process.env.MARKET_DIR, '/data/market'],
  [process.env.TICKETS_DIR, '/data/tickets'], [process.env.AI_FILES_DIR, '/data/aifiles'],
].map(([fromEnv, fallback]) => fromEnv || fallback);

/** Файл, который сейчас могут дописывать, трогать нельзя. */
const FRESH_MS = 2 * 60 * 1000;

async function* walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

export const encryptLegacyMedia = async () => {
  const stats = { encrypted: 0, rewrapped: 0, skipped: 0, failed: 0 };
  for (const root of roots()) {
    for await (const file of walk(root)) {
      if (/\.(tmp|part|enc-tmp)$/.test(file)) continue;
      try {
        const st = await stat(file);
        if (st.size === 0 || Date.now() - st.mtimeMs < FRESH_MS) { stats.skipped += 1; continue; }

        if (!(await isLegacyMedia(file))) {
          if (await rewrapMediaKey(file)) stats.rewrapped += 1;
          continue;
        }

        const tmp = `${file}.enc-tmp`;
        try {
          const r = await encryptExistingFile(file, tmp, Number.MAX_SAFE_INTEGER);
          if (r?.error || (await plaintextSizeOf(tmp)) !== st.size) throw new Error('verify_failed');
          // Пока шифровали, файл могли заменить: тогда оставляем как есть.
          if ((await stat(file)).mtimeMs !== st.mtimeMs) throw new Error('changed_during_encrypt');
          await rename(tmp, file);
          stats.encrypted += 1;
        } catch (err) {
          await rm(tmp, { force: true }).catch(() => {});
          throw err;
        }
      } catch (err) {
        stats.failed += 1;
        console.error(`[mediabackfill] ${file}: ${err.message}`);
      }
    }
  }
  return stats;
};
