/**
 * Sky Storage — шифрование резервных копий (конвертная схема, потоковое, AES-256-GCM).
 *
 * Ключи доступа к Sky (JWT_SECRET, сессии) и ключи шифрования хранилища — РАЗНЫЕ сущности:
 *   KEK (ключ шифрования ключей) — переменные STORAGE_KEK_<ID> (base64, 32 байта) в защищённой
 *   конфигурации сервера; активный — STORAGE_KEK_ACTIVE. Ни в базе, ни в журналах, ни в браузере их нет.
 *   DEK — случайный ключ на каждый объект; в заголовке объекта лежит обёрнутым KEK-ом.
 *
 * Формат объекта SBK1 (всё в одном потоке, без временных файлов):
 *   'SBK1'(4) | ver u8 | chunkSize u32LE | kid(16, дополнено нулями) | nonceSalt(8)
 *   | wrapIv(12) | wrapTag(16) | wrappedDek(32) | idHash(32)  — HEADER_LEN = 125
 * далее чанки: ciphertext(<=chunkSize) + tag(16). Каждый чанк — отдельный GCM-тег с AAD
 * (номер чанка, признак последнего, хеш идентификатора объекта): чанки нельзя переставить,
 * обрезать (последний чанк обязан быть помечен последним) или подсунуть из другого объекта.
 *
 * Это шифрование на стороне сервера: ключ у сервера. Оно защищает копию от утечки носителя/бакета,
 * но это не сквозное шифрование.
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

const MAGIC = Buffer.from('SBK1');
const VERSION = 1;
export const CHUNK = 1024 * 1024;
const TAG = 16;
const KID_LEN = 16;
export const HEADER_LEN = 4 + 1 + 4 + KID_LEN + 8 + 12 + TAG + 32 + 32;

export class CryptoError extends Error {
  constructor(code, detail = '') { super(code); this.code = code; this.detail = detail; }
}

/* ─── Кольцо ключей (из окружения) ─────────────────────────────────── */

const envKey = (kid) => process.env[`STORAGE_KEK_${kid}`] ?? '';

export const kekKids = () => Object.keys(process.env)
  .filter((k) => k.startsWith('STORAGE_KEK_') && k !== 'STORAGE_KEK_ACTIVE')
  .map((k) => k.slice('STORAGE_KEK_'.length))
  .filter((k) => /^[A-Za-z0-9]{1,16}$/.test(k));

export const activeKid = () => {
  const a = process.env.STORAGE_KEK_ACTIVE ?? '';
  return /^[A-Za-z0-9]{1,16}$/.test(a) ? a : '';
};

const keyOf = (kid) => {
  const raw = envKey(kid);
  if (!raw) throw new CryptoError('kek_missing', kid);
  const b = Buffer.from(raw, 'base64');
  if (b.length !== 32) throw new CryptoError('kek_bad_length', kid);
  return b;
};

/** Состояние ключей без раскрытия материала: какие есть, какой активный, годен ли. */
export const keyStatus = () => {
  const active = activeKid();
  const kids = kekKids();
  const usable = kids.filter((k) => { try { keyOf(k); return true; } catch { return false; } });
  return { configured: Boolean(active) && usable.includes(active), active: active || null, kids, usable };
};

/** Контрольное значение: HMAC константы под ключом — позволяет убедиться, что ключ тот же, не раскрывая его. */
export const checkValue = (kid) => crypto.createHmac('sha256', keyOf(kid)).update('sky-storage-kek-check-v1').digest('hex').slice(0, 24);

const idHash = (id) => crypto.createHash('sha256').update(`sky-storage-object:${id}`).digest();
const nonceFor = (salt, i) => { const n = Buffer.alloc(12); salt.copy(n, 0); n.writeUInt32LE(i, 8); return n; };
const chunkAad = (ih, i, last) => { const b = Buffer.alloc(5 + 32); b.writeUInt32LE(i, 0); b.writeUInt8(last ? 1 : 0, 4); ih.copy(b, 5); return b; };
const wrapAad = (kid, ih) => Buffer.concat([Buffer.from(`sky-storage-dek|${kid}|`), ih]);

const buildHeader = ({ kid, salt, dek, ih, chunkSize }) => {
  const kek = keyOf(kid);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(wrapAad(kid, ih));
  const wrapped = Buffer.concat([c.update(dek), c.final()]);
  const h = Buffer.alloc(HEADER_LEN);
  let o = 0;
  MAGIC.copy(h, o); o += 4;
  h.writeUInt8(VERSION, o); o += 1;
  h.writeUInt32LE(chunkSize, o); o += 4;
  Buffer.from(kid.padEnd(KID_LEN, '\0')).copy(h, o); o += KID_LEN;
  salt.copy(h, o); o += 8;
  iv.copy(h, o); o += 12;
  c.getAuthTag().copy(h, o); o += TAG;
  wrapped.copy(h, o); o += 32;
  ih.copy(h, o);
  return h;
};

const parseHeader = (h, id) => {
  if (h.length < HEADER_LEN || !h.subarray(0, 4).equals(MAGIC)) throw new CryptoError('bad_format');
  if (h.readUInt8(4) !== VERSION) throw new CryptoError('bad_version');
  let o = 5;
  const chunkSize = h.readUInt32LE(o); o += 4;
  if (chunkSize < 1024 || chunkSize > 64 * 1024 * 1024) throw new CryptoError('bad_format');
  const kid = h.subarray(o, o + KID_LEN).toString().replace(/\0+$/, ''); o += KID_LEN;
  const salt = h.subarray(o, o + 8); o += 8;
  const iv = h.subarray(o, o + 12); o += 12;
  const tag = h.subarray(o, o + TAG); o += TAG;
  const wrapped = h.subarray(o, o + 32); o += 32;
  const ih = h.subarray(o, o + 32);
  if (id !== undefined && !ih.equals(idHash(id))) throw new CryptoError('wrong_object');
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf(kid), iv);
  d.setAAD(wrapAad(kid, ih));
  d.setAuthTag(tag);
  let dek;
  try { dek = Buffer.concat([d.update(wrapped), d.final()]); } catch { throw new CryptoError('bad_key_or_header'); }
  return { kid, chunkSize, salt, dek, ih };
};

/** Читает ровно n байт из асинхронного итератора буферов, возвращая остаток. */
class Reader {
  constructor(src) { this.it = src[Symbol.asyncIterator](); this.buf = Buffer.alloc(0); this.done = false; }
  async read(n) {
    while (this.buf.length < n && !this.done) {
      const { value, done } = await this.it.next();
      if (done) this.done = true; else this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : Buffer.from(value);
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(out.length);
    return out;
  }
  async eof() { if (this.buf.length) return false; const { done, value } = await this.it.next(); if (done) { this.done = true; return true; } this.buf = Buffer.from(value); return false; }
  rest() { const self = this; return (async function* () { if (self.buf.length) yield self.buf; self.buf = Buffer.alloc(0); while (!self.done) { const { value, done } = await self.it.next(); if (done) { self.done = true; return; } yield value; } })(); }
}

/**
 * Поток открытых байт → поток SBK1. `id` привязывает содержимое к объекту.
 * Память: не больше одного чанка (по умолчанию 1 МиБ).
 */
export const encryptStream = (source, { id, kid = activeKid(), chunkSize = CHUNK } = {}) => {
  if (!kid) throw new CryptoError('kek_not_configured');
  const salt = crypto.randomBytes(8);
  const dek = crypto.randomBytes(32);
  const ih = idHash(id);
  const header = buildHeader({ kid, salt, dek, ih, chunkSize });
  async function* gen() {
    yield header;
    let idx = 0; let pending = Buffer.alloc(0);
    const seal = (buf, last) => {
      const c = crypto.createCipheriv('aes-256-gcm', dek, nonceFor(salt, idx));
      c.setAAD(chunkAad(ih, idx, last)); idx += 1;
      const enc = Buffer.concat([c.update(buf), c.final()]);
      return Buffer.concat([enc, c.getAuthTag()]);
    };
    for await (const part of source) {
      pending = pending.length ? Buffer.concat([pending, part]) : Buffer.from(part);
      // Держим хвост: последний чанк обязан быть помечен «последний», а он неизвестен, пока не кончился поток.
      while (pending.length > chunkSize) { yield seal(pending.subarray(0, chunkSize), false); pending = pending.subarray(chunkSize); }
    }
    yield seal(pending, true);
    dek.fill(0);
  }
  return Readable.from(gen(), { objectMode: false });
};

/** Поток SBK1 → поток открытых байт. Любое повреждение/обрезание/подмена — исключение CryptoError. */
export const decryptStream = (source, { id } = {}) => {
  async function* gen() {
    const rd = new Reader(source);
    const h = await rd.read(HEADER_LEN);
    const { chunkSize, salt, dek, ih } = parseHeader(h, id);
    let idx = 0;
    for (;;) {
      const blk = await rd.read(chunkSize + TAG);
      if (blk.length < TAG) throw new CryptoError('truncated');
      const last = blk.length < chunkSize + TAG || await rd.eof();
      const d = crypto.createDecipheriv('aes-256-gcm', dek, nonceFor(salt, idx));
      d.setAAD(chunkAad(ih, idx, last)); d.setAuthTag(blk.subarray(blk.length - TAG));
      let plain;
      try { plain = Buffer.concat([d.update(blk.subarray(0, blk.length - TAG)), d.final()]); } catch { throw new CryptoError('corrupt', `chunk ${idx}`); }
      idx += 1;
      if (plain.length) yield plain;
      if (last) break;
    }
    dek.fill(0);
  }
  return Readable.from(gen(), { objectMode: false });
};

/** Заголовок объекта (для проверки ключа без чтения тела). */
export const readKid = (headerBytes) => {
  if (headerBytes.length < HEADER_LEN || !headerBytes.subarray(0, 4).equals(MAGIC)) throw new CryptoError('bad_format');
  return headerBytes.subarray(9, 9 + KID_LEN).toString().replace(/\0+$/, '');
};

/**
 * Ротация: тот же объект под другим KEK — переписывается только заголовок (DEK обёрнут заново),
 * тело (чанки) не трогается и не расшифровывается. Возвращает поток нового объекта.
 */
export const rewrapStream = async (source, { id, toKid = activeKid() } = {}) => {
  if (!toKid) throw new CryptoError('kek_not_configured');
  const rd = new Reader(source);
  const h = await rd.read(HEADER_LEN);
  const { chunkSize, salt, dek, ih } = parseHeader(h, id);
  const header = buildHeader({ kid: toKid, salt, dek, ih, chunkSize });
  return Readable.from((async function* () { yield header; yield* rd.rest(); })(), { objectMode: false });
};
