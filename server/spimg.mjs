/**
 * Безопасная обработка картинок Sky Pets БЕЗ внешних библиотек.
 *  • PNG: разбираем и ДЕКОДИРУЕМ сами (zlib), проверяем размеры и прозрачность по пикселям, затем ПЕРЕКОДИРУЕМ заново:
 *    в сохранённый файл не попадает ничего из чужих байтов (метаданные, хвосты, лишние блоки). Делаем основную версию
 *    (до 512 px) и миниатюру (до 128 px) усреднением по площади.
 *  • WebP: строгий обход RIFF (допустимы только VP8/VP8L/VP8X/ALPH), размер и флаг прозрачности из заголовка; пиксели не
 *    декодируем — поэтому у WebP нет проверки «прозрачные ли края» и миниатюры (честно: рекомендуем PNG).
 *  • Бомбы распаковки: предел на выход inflate и на размер холста. Ничего из файла не исполняется.
 */
import zlib from 'node:zlib';

export const MAX_BYTES = 2 * 1024 * 1024, MAX_SIDE = 2048, MIN_SIDE = 32;
const err = (code, hint = '') => ({ error: code, hint });
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const o = Buffer.alloc(12 + data.length); o.writeUInt32BE(data.length, 0); o.write(type, 4, 'latin1'); data.copy(o, 8); o.writeUInt32BE(crc32(o.subarray(4, 8 + data.length)), 8 + data.length); return o; };

export const sniff = (b) => {
  if (b.length >= 8 && b.subarray(0, 8).equals(SIG)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
};

/** Декодирует PNG в RGBA (8 бит, без чересстрочности). */
export const decodePng = (buf) => {
  let p = 8, ihdr = null, plte = null, trns = null; const idat = [];
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('latin1', p + 4, p + 8);
    if (len > buf.length || p + 12 + len > buf.length) return err('png_broken');
    const data = buf.subarray(p + 8, p + 8 + len);
    if (crc32(buf.subarray(p + 4, p + 8 + len)) !== buf.readUInt32BE(p + 8 + len)) return err('png_broken', 'контрольная сумма не сошлась');
    if (type === 'IHDR') ihdr = data; else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data; else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (!ihdr || ihdr.length !== 13 || !idat.length) return err('png_broken');
  const w = ihdr.readUInt32BE(0), h = ihdr.readUInt32BE(4), depth = ihdr[8], ct = ihdr[9], inter = ihdr[12];
  if (w < MIN_SIDE || h < MIN_SIDE) return err('image_too_small', `минимум ${MIN_SIDE}×${MIN_SIDE}`);
  if (w > MAX_SIDE || h > MAX_SIDE) return err('image_too_large', `максимум ${MAX_SIDE}×${MAX_SIDE}`);
  if (depth !== 8 || inter !== 0 || ![0, 2, 3, 4, 6].includes(ct)) return err('png_unsupported', 'сохраните как PNG 32 бита (RGBA), без чересстрочности');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct]; const stride = w * ch;
  let raw; try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * h + 16 }); } catch { return err('png_broken', 'данные изображения повреждены'); }
  if (raw.length < (stride + 1) * h) return err('png_broken');
  const px = Buffer.alloc(stride * h); const bpp = ch;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const src = y * (stride + 1) + 1; const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, b = y > 0 ? px[dst - stride + x] : 0, c = x >= bpp && y > 0 ? px[dst - stride + x - bpp] : 0; const v = raw[src + x];
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else return err('png_broken');
      px[dst + x] = r & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4); let hasAlphaChannel = ct === 4 || ct === 6 || (trns && trns.length > 0);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ct === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; a = px[i * 4 + 3]; }
    else if (ct === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0; }
    else if (ct === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    else if (ct === 0) { r = g = b = px[i]; if (trns && trns.length >= 2 && px[i] === trns[1]) a = 0; }
    else { const idx = px[i]; if (!plte || idx * 3 + 2 >= plte.length) return err('png_broken'); r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2]; a = trns && idx < trns.length ? trns[idx] : 255; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { w, h, rgba, hasAlphaChannel: Boolean(hasAlphaChannel) };
};

export const encodePng = (w, h, rgba) => {
  const stride = w * 4; const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
};

/** Уменьшение усреднением по площади (с учётом прозрачности). Увеличивать не будем. */
export const resize = (w, h, rgba, max) => {
  const k = Math.min(1, max / Math.max(w, h)); if (k >= 1) return { w, h, rgba };
  const nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k)); const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor((y * h) / nh), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor((x * w) / nw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / nw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * w + xx) * 4; const al = rgba[i + 3]; r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al; n++; }
      const o = (y * nw + x) * 4; if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); } out[o + 3] = Math.round(a / n);
    }
  }
  return { w: nw, h: nh, rgba: out };
};

/** Края прозрачные? Доля пикселей рамки с alpha < 16; сплошная белая/чёрная подложка — отдельный признак. */
export const borderReport = (w, h, rgba) => {
  let total = 0, clear = 0, white = 0, black = 0, solidAll = 0;
  const look = (x, y) => { const i = (y * w + x) * 4; total++; const a = rgba[i + 3]; if (a < 16) clear++; else if (a > 240) { solidAll++; const m = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]), M = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]); if (m > 240) white++; else if (M < 16) black++; } };
  for (let x = 0; x < w; x++) { look(x, 0); look(x, h - 1); } for (let y = 1; y < h - 1; y++) { look(0, y); look(w - 1, y); }
  let any = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) { any = 1; break; }
  return { transparentShare: clear / total, whiteShare: white / total, blackShare: black / total, anyTransparent: Boolean(any) };
};

const webpInfo = (b) => {
  if (b.readUInt32LE(4) + 8 !== b.length) return err('webp_broken');
  let p = 12, w = 0, h = 0, alpha = false, hasImage = false;
  while (p + 8 <= b.length) {
    const tag = b.toString('latin1', p, p + 4), len = b.readUInt32LE(p + 4), body = p + 8; if (body + len > b.length) return err('webp_broken');
    if (tag === 'VP8X') { if (len < 10) return err('webp_broken'); const flags = b[body]; if (flags & 0x02) return err('webp_unsupported', 'анимация не поддерживается'); alpha = Boolean(flags & 0x10); w = 1 + (b[body + 4] | (b[body + 5] << 8) | (b[body + 6] << 16)); h = 1 + (b[body + 7] | (b[body + 8] << 8) | (b[body + 9] << 16)); }
    else if (tag === 'VP8L') { if (len < 5 || b[body] !== 0x2f) return err('webp_broken'); const v = b.readUInt32LE(body + 1); w = (v & 0x3fff) + 1; h = ((v >> 14) & 0x3fff) + 1; alpha = alpha || Boolean((v >> 28) & 1); hasImage = true; }
    else if (tag === 'VP8 ') { if (len < 10) return err('webp_broken'); w = w || (b.readUInt16LE(body + 6) & 0x3fff); h = h || (b.readUInt16LE(body + 8) & 0x3fff); hasImage = true; }
    else if (tag === 'ALPH') alpha = true;
    else return err('webp_unsupported', 'в файле есть посторонние блоки (метаданные)');
    p = body + len + (len & 1);
  }
  if (!hasImage || !w || !h) return err('webp_broken');
  if (w > MAX_SIDE || h > MAX_SIDE) return err('image_too_large'); if (w < MIN_SIDE || h < MIN_SIDE) return err('image_too_small');
  return { w, h, alpha };
};

/**
 * @param opts.opaqueOk — картинка может быть непрозрачной (обои, пол): тогда про фон не спрашиваем.
 * Возвращает { mime, width, height, hasAlpha, files: [{name:'full'|'thumb', buf, w, h}], warnings } или { error, hint }.
 */
export const processImage = (buf, opts = {}) => {
  if (!Buffer.isBuffer(buf) || !buf.length) return err('empty_file');
  if (buf.length > MAX_BYTES) return err('file_too_large', `не больше ${MAX_BYTES / 1024 / 1024} МБ`);
  const kind = sniff(buf); if (!kind) return err('bad_format', 'нужен PNG или WebP с прозрачностью');
  if (kind === 'webp') {
    const i = webpInfo(buf); if (i.error) return i;
    if (!i.alpha && !opts.opaqueOk) return err('background_not_transparent', 'у WebP нет канала прозрачности');
    return { mime: 'image/webp', width: i.w, height: i.h, hasAlpha: i.alpha, files: [{ name: 'full', buf, w: i.w, h: i.h }], warnings: ['webp_no_pixel_check'] };
  }
  const d = decodePng(buf); if (d.error) return d;
  const rep = borderReport(d.w, d.h, d.rgba); const warnings = [];
  if (!opts.opaqueOk) {
    if (!d.hasAlphaChannel || !rep.anyTransparent) return err('background_not_transparent', 'на картинке нет прозрачных областей — уберите фон');
    if (rep.whiteShare > 0.3 || rep.blackShare > 0.3) return err('background_not_transparent', 'по краям сплошная белая или чёрная подложка');
    if (rep.transparentShare < 0.5) warnings.push('border_not_clear');
  }
  const full = resize(d.w, d.h, d.rgba, 512), thumb = resize(d.w, d.h, d.rgba, 128);
  return { mime: 'image/png', width: full.w, height: full.h, hasAlpha: d.hasAlphaChannel, warnings,
    files: [{ name: 'full', buf: encodePng(full.w, full.h, full.rgba), w: full.w, h: full.h }, { name: 'thumb', buf: encodePng(thumb.w, thumb.h, thumb.rgba), w: thumb.w, h: thumb.h }] };
};
