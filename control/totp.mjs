/**
 * Одноразовые коды по времени (TOTP, RFC 6238).
 *
 * Реализовано на node:crypto без внешних библиотек: алгоритм короткий,
 * а лишняя зависимость в образе бэкенда — лишняя поверхность атаки.
 *
 * Совместимо с обычными приложениями-аутентификаторами: SHA-1, 6 цифр,
 * шаг 30 секунд — те же параметры, что понимают Google Authenticator и
 * аналоги.
 */
import crypto from 'node:crypto';

const DIGITS = 6;
const PERIOD = 30;
/** Допуск в один шаг в обе стороны: часы на телефоне могут расходиться. */
const WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Секрет в base32 — формат, который принимают приложения-аутентификаторы. */
export const generateSecret = (bytes = 20) => {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
};

const base32Decode = (secret) => {
  const clean = String(secret).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) return null;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const codeForCounter = (key, counter) => {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  // Динамическое усечение по RFC 4226: смещение берётся из младших
  // четырёх бит последнего байта.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = ((hmac[offset] & 0x7f) << 24)
              | ((hmac[offset + 1] & 0xff) << 16)
              | ((hmac[offset + 2] & 0xff) << 8)
              | (hmac[offset + 3] & 0xff);
  return String(value % 10 ** DIGITS).padStart(DIGITS, '0');
};

/**
 * Проверяет код. Сравнение идёт по всем допустимым шагам без раннего
 * выхода, чтобы время ответа не зависело от того, какой именно шаг
 * совпал.
 */
export const verifyTotp = (secret, code, at = Date.now()) => {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return false;

  const input = String(code ?? '').replace(/\D/g, '');
  if (input.length !== DIGITS) return false;

  const counter = Math.floor(at / 1000 / PERIOD);
  let matched = false;
  for (let drift = -WINDOW; drift <= WINDOW; drift += 1) {
    const expected = codeForCounter(key, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(input);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) matched = true;
  }
  return matched;
};

/** Ссылка otpauth:// — по ней приложение-аутентификатор заводит запись. */
export const otpauthUri = (secret, label, issuer = 'Sky ID') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}`
  + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}`
  + `&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;

/** Текущий код — нужен только тестам и отладке. */
export const currentTotp = (secret, at = Date.now()) => {
  const key = base32Decode(secret);
  return key ? codeForCounter(key, Math.floor(at / 1000 / PERIOD)) : null;
};
