/**
 * Шифрование медиафайлов на диске — AES-256-GCM, конвертная схема
 * (envelope encryption), с посегментной (chunked) структурой, чтобы
 * HTTP Range (перемотка/докачка) не требовал расшифровывать файл
 * целиком и не держал его целиком в памяти.
 *
 * Зачем конверт, а не один ключ на всё: мастер-ключ (из ENCRYPTION_KEY)
 * никогда не касается самого файла — им шифруется только маленький
 * одноразовый ключ файла (DEK, Data Encryption Key), сгенерированный
 * заново для каждого файла. Компрометация DEK одного файла не отдаёт
 * остальные; смена мастер-ключа возможна без перешифровки всех файлов
 * (только их DEK, см. server/rekey.mjs — тот же приём, что уже применён
 * к секретам 2FA в server/crypto.mjs).
 *
 * Зачем чанки, а не поток целиком под одним тегом аутентификации:
 * GCM не умеет начать расшифровку с произвольного места потока — тег
 * считается по всему шифртексту сразу. Поэтому файл режется на чанки
 * фиксированного размера, и у каждого свой тег: чтобы отдать байты
 * [start,end), читаем и расшифровываем только те чанки, что их
 * перекрывают, а не всё с начала. AAD с номером чанка и флагом
 * «последний» не даёт переставить или обрезать чанки незаметно —
 * иначе собрать чужой файл из середины чужого другого было бы можно.
 *
 * Формат на диске (см. HEADER_LEN):
 *   'SKE1' (4) | chunkSize u32LE (4) | plaintextSize u64LE (8)
 *   | nonceSalt (8) | wrapped DEK: iv(12) tag(16) ciphertext(32)
 * далее подряд чанки: ciphertext(<=chunkSize) + tag(16).
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { open as fsOpen, rm } from 'node:fs/promises';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.mjs';

const MAGIC = Buffer.from('SKE1');
const DEFAULT_CHUNK = 64 * 1024;
const TAG_LEN = 16;
const DEK_LEN = 32;
const HEADER_LEN = 4 + 4 + 8 + 8 + 12 + TAG_LEN + DEK_LEN; // 84

/**
 * Мастер-ключ медиахранилища. Отдельное пространство от 2FA-секретов
 * (server/crypto.mjs) и от подписи токенов — HKDF с собственным info
 * гарантирует, что компрометация одного производного ключа не отдаёт
 * остальные, даже если исходный материал общий (запасной путь ниже).
 */
const masterKeyMaterial = () => {
  if (config.encryptionKey) return Buffer.from(config.encryptionKey, 'utf8');
  console.warn('[mediacrypto] ENCRYPTION_KEY не задан — ключ медиахранилища выводится из '
    + 'JWT_SECRET. Задайте отдельный ключ для продакшена.');
  return Buffer.from(config.jwtSecret, 'utf8');
};

const masterKey = () => Buffer.from(
  crypto.hkdfSync('sha256', masterKeyMaterial(), Buffer.alloc(0), Buffer.from('sky-media-storage-v1'), 32),
);

const chunkAad = (index, isLast) => {
  const b = Buffer.alloc(5);
  b.writeUInt32LE(index, 0);
  b.writeUInt8(isLast ? 1 : 0, 4);
  return b;
};

const nonceFor = (salt, index) => {
  // 8 байт случайной соли файла + 4 байта номера чанка — уникален на
  // чанк внутри файла, соль не повторяется между файлами.
  const n = Buffer.alloc(12);
  salt.copy(n, 0);
  n.writeUInt32BE(index >>> 0, 8);
  return n;
};

/**
 * Зашифровать поток (например, тело запроса на загрузку) в файл по
 * указанному пути. Сигнатура намеренно повторяет существующий
 * saveStream(id, source, limitBytes) у *store.mjs-модулей — чтобы
 * заменить его вызов было механической правкой, а не переписыванием
 * вызывающего кода.
 */
export const encryptStreamToFile = async (source, destPath, limitBytes, { chunkSize = DEFAULT_CHUNK } = {}) => {
  const dek = crypto.randomBytes(DEK_LEN);
  const salt = crypto.randomBytes(8);

  const mk = masterKey();
  const wrapIv = crypto.randomBytes(12);
  const wrapCipher = crypto.createCipheriv('aes-256-gcm', mk, wrapIv);
  const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();

  const out = createWriteStream(destPath);
  let written = 0;      // байт исходника (plaintext), для контроля лимита
  let plaintextSize = 0;
  let index = 0;
  let pending = Buffer.alloc(0);

  const writeChunk = (buf, isLast) => new Promise((resolve, reject) => {
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, nonceFor(salt, index));
    cipher.setAAD(chunkAad(index, isLast));
    const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    index += 1;
    plaintextSize += buf.length;
    out.write(Buffer.concat([enc, tag]), (err) => (err ? reject(err) : resolve()));
  });

  // Заголовок дописываем в конце, когда известен точный plaintextSize —
  // но писать нужно последовательно, поэтому сначала пишем заглушку
  // правильной длины, а по завершении переписываем первые HEADER_LEN
  // байт через отдельный дескриптор (дешевле, чем буферизовать файл).
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header.writeUInt32LE(chunkSize, 4);
  // plaintextSize (8-15) и nonceSalt/DEK ниже допишем сразу — соль и
  // обёрнутый DEK не зависят от размера и известны уже сейчас.
  salt.copy(header, 16);
  wrapIv.copy(header, 24);
  wrapTag.copy(header, 36);
  wrappedDek.copy(header, 52);
  await new Promise((resolve, reject) => out.write(header, (err) => (err ? reject(err) : resolve())));

  let tooLarge = false;
  try {
    // Асинхронный итератор сам упорядочивает получение кусков и
    // держит backpressure — в отличие от 'data'-колбэка, он не
    // пришлёт следующий кусок, пока мы не закончили ждать текущий
    // await, поэтому шифрование чанков не гонится само с собой.
    for await (const chunk of source) {
      written += chunk.length;
      if (written > limitBytes) {
        tooLarge = true;
        throw new Error('too_large');
      }
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= chunkSize) {
        const piece = pending.subarray(0, chunkSize);
        pending = pending.subarray(chunkSize);
        await writeChunk(piece, false);
      }
    }
    await writeChunk(pending, true);
  } catch (err) {
    out.destroy();
    await rm(destPath, { force: true }).catch(() => {});
    if (tooLarge) return { error: 'file_too_large' };
    throw err;
  }

  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));

  // Дописываем настоящий plaintextSize в уже сброшенный на диск заголовок.
  const fh = await fsOpen(destPath, 'r+');
  try {
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64LE(BigInt(plaintextSize));
    await fh.write(sizeBuf, 0, 8, 8);
  } finally {
    await fh.close();
  }

  return { bytes: plaintextSize };
};

/** Записать уже прочитанные в память байты (обложки и т.п.). */
export const encryptBytesToFile = (buf, destPath, opts) =>
  encryptStreamToFile(Readable.from([buf]), destPath, buf.length + 1, opts);

const readHeader = async (path) => {
  const fh = await fsOpen(path, 'r');
  try {
    const buf = Buffer.alloc(HEADER_LEN);
    await fh.read(buf, 0, HEADER_LEN, 0);
    if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('not_encrypted_media');
    const chunkSize = buf.readUInt32LE(4);
    const plaintextSize = Number(buf.readBigUInt64LE(8));
    const salt = buf.subarray(16, 24);
    const wrapIv = buf.subarray(24, 36);
    const wrapTag = buf.subarray(36, 52);
    const wrappedDek = buf.subarray(52, 52 + DEK_LEN);

    const mk = masterKey();
    const unwrap = crypto.createDecipheriv('aes-256-gcm', mk, wrapIv);
    unwrap.setAuthTag(wrapTag);
    const dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);

    return { chunkSize, plaintextSize, salt, dek };
  } finally {
    await fh.close();
  }
};

/** Настоящий (расшифрованный) размер файла — то, что нужно parseRange
 *  и заголовку Content-Length, а не размер зашифрованного файла на диске. */
export const plaintextSizeOf = async (path) => {
  try { return (await readHeader(path)).plaintextSize; } catch { return null; }
};

/**
 * Поток расшифрованных байт в диапазоне [range.start, range.end]
 * (включительно) либо всего файла, если range не задан. Читает и
 * расшифровывает только те чанки, что действительно перекрывают
 * запрошенный диапазон — перемотка в большом файле не тянет его целиком.
 */
export const openDecryptedRangeStream = (path, range) => {
  const stream = new Readable({ read() {} });

  (async () => {
    const { chunkSize, plaintextSize, salt, dek } = await readHeader(path);
    const start = range ? range.start : 0;
    const end = range ? range.end : plaintextSize - 1;
    const onDiskChunkLen = chunkSize + TAG_LEN;

    const firstChunk = Math.floor(start / chunkSize);
    const lastChunk = Math.floor(end / chunkSize);
    const totalChunks = Math.ceil(plaintextSize / chunkSize) || 1;

    const fh = await fsOpen(path, 'r');
    try {
      for (let i = firstChunk; i <= lastChunk; i += 1) {
        const diskOffset = HEADER_LEN + i * onDiskChunkLen;
        const plainChunkLen = Math.min(chunkSize, plaintextSize - i * chunkSize);
        const encLen = plainChunkLen + TAG_LEN;
        const buf = Buffer.alloc(encLen);
        await fh.read(buf, 0, encLen, diskOffset);
        const ciphertext = buf.subarray(0, plainChunkLen);
        const tag = buf.subarray(plainChunkLen);

        const decipher = crypto.createDecipheriv('aes-256-gcm', dek, nonceFor(salt, i));
        decipher.setAAD(chunkAad(i, i === totalChunks - 1));
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

        const chunkStart = i * chunkSize;
        const sliceStart = Math.max(0, start - chunkStart);
        const sliceEnd = Math.min(plain.length, end - chunkStart + 1);
        stream.push(plain.subarray(sliceStart, sliceEnd));
      }
      stream.push(null);
    } finally {
      await fh.close();
    }
  })().catch((err) => stream.destroy(err));

  return stream;
};

/**
 * Перешифровать существующий (ещё не зашифрованный) файл на месте —
 * используется разовой миграцией, не обычным путём записи. Источник
 * читается потоком, не целиком в память; оригинал стирается только
 * после того, как новый файл подтверждённо расшифровывается обратно
 * (см. server/scripts/encrypt-media.mjs).
 */
export const encryptExistingFile = async (srcPath, destPath, maxBytes) =>
  encryptStreamToFile(createReadStream(srcPath), destPath, maxBytes);

/** Для миграции: скопировать расшифрованный файл во временный путь
 *  и дать вызывающему сверить его с оригиналом побайтово. */
export const decryptToFile = async (encPath, outPath) => {
  await pipeline(openDecryptedRangeStream(encPath, null), createWriteStream(outPath));
};

/** Расшифровать файл целиком в память — только там, где вызывающему и
 *  так нужен весь файл сразу (например, передать документ модели на
 *  разбор), не для обычной раздачи. */
export const decryptToBuffer = async (path) => {
  const chunks = [];
  for await (const chunk of openDecryptedRangeStream(path, null)) chunks.push(chunk);
  return Buffer.concat(chunks);
};
