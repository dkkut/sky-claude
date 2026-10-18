/**
 * Sky Ads: сведения о видео без ffmpeg. Длительность MP4 читается из заголовка файла (moov → mvhd) короткими
 * чтениями по диапазону — файл целиком в память не поднимается. Перекодирования и сжатия в Sky нет; WebM принимается,
 * но длительность у него неизвестна (так и сказано рекламодателю).
 */
export const AD_VIDEO_MAX_SEC = Math.max(5, Number(process.env.AD_VIDEO_MAX_SEC) || 60);

/** Прочитать диапазон [start, end] расшифрованного файла целиком в Buffer. */
const readRange = async (openStream, id, start, end) => {
  const chunks = [];
  for await (const c of openStream(id, { start, end })) chunks.push(c);
  return Buffer.concat(chunks);
};

/** Разбор mvhd: version 0/1, timescale и duration. */
export const parseMvhd = (b) => {
  if (b.length < 20) return null;
  const v = b[0];
  let timescale; let duration;
  if (v === 0) { timescale = b.readUInt32BE(12); duration = b.readUInt32BE(16); }
  else if (v === 1 && b.length >= 32) { timescale = b.readUInt32BE(20); duration = Number(b.readBigUInt64BE(24)); }
  else return null;
  if (!timescale) return null;
  return duration / timescale;
};

/** Длительность в секундах или null, если файл не разобрался. */
export const mp4DurationSec = async (openStream, id, total) => {
  let off = 0; let hops = 0;
  while (off + 8 <= total && hops < 64) {
    hops += 1;
    const head = await readRange(openStream, id, off, Math.min(total - 1, off + 15));
    if (head.length < 8) return null;
    let size = head.readUInt32BE(0); const type = head.subarray(4, 8).toString('latin1'); let hdr = 8;
    if (size === 1) { if (head.length < 16) return null; size = Number(head.readBigUInt64BE(8)); hdr = 16; }
    else if (size === 0) size = total - off;
    if (size < hdr || off + size > total + 1) return null;
    if (type === 'moov') {
      if (size > 8 * 1024 * 1024) return null;                        // заголовок такого размера — не обычное рекламное видео
      const body = await readRange(openStream, id, off + hdr, off + size - 1);
      let p = 0;
      while (p + 8 <= body.length) {
        const s = body.readUInt32BE(p); const t = body.subarray(p + 4, p + 8).toString('latin1');
        if (s < 8 || p + s > body.length) break;
        if (t === 'mvhd') return parseMvhd(body.subarray(p + 8, p + s));
        p += s;
      }
      return null;
    }
    off += size;
  }
  return null;
};
