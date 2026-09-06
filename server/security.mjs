import crypto from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);

export const signToken = (payload, secret, ttlSec) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, exp: nowSec() + ttlSec, iat: nowSec() };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedBody = b64url(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(`${encodedHeader}.${encodedBody}`).digest('base64url');
  return `${encodedHeader}.${encodedBody}.${signature}`;
};

export const verifyToken = (token, secret) => {
  if (typeof token !== 'string') return null;
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;

  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const actualBuf   = Buffer.from(s);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual выбрасывает RangeError на буферах разной длины,
  // а подпись приходит от клиента и может быть любой. Длину сверяем
  // отдельно: для HMAC фиксированного размера она не секрет.
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

  // Тело тоже клиентское — JSON.parse на мусоре бросает исключение.
  let payload;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.exp || payload.exp < nowSec()) return null;
  return payload;
};

export const sanitizeInput = (value) => String(value).replace(/[<>$`]/g, '').trim();

const buckets = new Map();
export const rateLimit = (key, perMinute) => {
  const now = Date.now();
  const minute = Math.floor(now / 60000);
  const bucketKey = `${key}:${minute}`;
  const count = buckets.get(bucketKey) || 0;
  buckets.set(bucketKey, count + 1);
  return count + 1 <= perMinute;
};

export const generateId = () => crypto.randomUUID();
