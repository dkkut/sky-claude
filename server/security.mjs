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

/**
 * Счётчики обращений.
 *
 * На каждый ключ хранится одно окно и число попыток в нём. Раньше на
 * каждую новую минуту заводилась ещё одна запись, а старые не убирались
 * никогда: за сутки работы это тысячи мёртвых ключей на каждого, кто
 * заходил. Теперь запись одна на ключ, а те, чьё окно давно прошло,
 * выметаются — иначе счётчик течёт памятью тем сильнее, чем дольше
 * сервер живёт.
 */
const buckets = new Map();
let sweptAt = 0;

const hit = (key, window, limit, windowMs) => {
  const now = Date.now();
  // Уборка редкая: проходить всю карту на каждом запросе дороже, чем
  // подержать лишнюю минуту несколько просроченных записей.
  if (now - sweptAt > 10 * 60_000) {
    sweptAt = now;
    for (const [k, v] of buckets) {
      if (now - v.at > 2 * v.span) buckets.delete(k);
    }
  }
  const cur = buckets.get(key);
  if (!cur || cur.window !== window) {
    buckets.set(key, { window, count: 1, at: now, span: windowMs });
    return 1 <= limit;
  }
  cur.count += 1;
  cur.at = now;
  return cur.count <= limit;
};

export const rateLimit = (key, perMinute) =>
  hit(`m:${key}`, Math.floor(Date.now() / 60_000), perMinute, 60_000);

/**
 * То же самое, но окно в час. Нужно там, где обращение стоит денег или
 * заметного времени: минутный предел такое пропускает шестьюдесятью
 * порциями в час, и это не предел вовсе.
 */
export const rateLimitPerHour = (key, perHour) =>
  hit(`h:${key}`, Math.floor(Date.now() / 3_600_000), perHour, 3_600_000);

export const generateId = () => crypto.randomUUID();

/* ─── Пароли ───────────────────────────────────────────────────────────── */

/**
 * Параметры scrypt. N — главный множитель стоимости; память под перебор
 * считается как 128 * N * r ≈ 16 МБ на попытку, что делает перебор на GPU
 * дорогим. Хранятся вместе с хешем, поэтому их можно поднять позже,
 * не ломая уже сохранённые пароли.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16 };

const scryptAsync = (password, salt, params) => new Promise((resolve, reject) => {
  crypto.scrypt(
    password, salt, params.keylen,
    { N: params.N, r: params.r, p: params.p },
    (err, derived) => (err ? reject(err) : resolve(derived)),
  );
});

/**
 * Возвращает строку вида scrypt$N$r$p$соль$хеш (соль и хеш в base64).
 * Алгоритм и параметры лежат внутри самой строки — при их смене старые
 * пароли продолжают проверяться прежними параметрами.
 */
export const hashPassword = async (password) => {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('пустой пароль');
  }
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const hash = await scryptAsync(password, salt, SCRYPT);
  return [
    'scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('base64'), hash.toString('base64'),
  ].join('$');
};

/**
 * Проверяет пароль. Никогда не бросает исключение: любой мусор на входе —
 * это просто false, иначе кривой хеш в базе превращался бы в 500.
 */
export const verifyPassword = async (password, stored) => {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const params = {
    N: Number(nRaw), r: Number(rRaw), p: Number(pRaw),
    keylen: Buffer.from(hashB64, 'base64').length,
  };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r)
      || !Number.isInteger(params.p) || !params.keylen) return false;

  try {
    const expected = Buffer.from(hashB64, 'base64');
    const actual   = await scryptAsync(password, Buffer.from(saltB64, 'base64'), params);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
};

