/**
 * Общие мелочи HTTP-слоя: ответы, разбор тела, чтение токенов.
 *
 * Вынесено отдельно, чтобы модули маршрутов не тянули друг друга ради
 * пары функций и чтобы заголовки безопасности задавались в одном месте.
 */
import { config } from './config.mjs';
import { verifyToken } from './security.mjs';
import { REFRESH_COOKIE, parseCookies } from './cookies.mjs';
import { sessionStore } from './sessions.mjs';

export const json = (res, code, body, extraHeaders = {}) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
};

export const parseBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) {
      reject(new Error('Payload too large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      reject(new Error('Invalid JSON'));
    }
  });
  req.on('error', reject);
});

export const readAccessToken = (req) => {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return '';
  const [scheme, value] = raw.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : '';
};

export const readRefreshToken = (req, body) => {
  const fromCookie = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
  if (fromCookie) return fromCookie;
  return typeof body?.refreshToken === 'string' ? body.refreshToken : '';
};

/**
 * Разбирает access-токен и сверяет его с живой сессией.
 *
 * Одной подписи мало: после «Выйти из Sky ID» токен формально остаётся
 * действительным до конца своего срока, и укравший его продолжал бы
 * работать. Поэтому каждый запрос проверяет, что серверная сессия ещё
 * существует.
 *
 * Активный профиль тоже берём из сессии, а не из токена: она —
 * единственный источник правды, поэтому смена профиля в одной вкладке
 * мгновенно действует во всех, а старый токен не открывает прежний
 * профиль.
 *
 * Возвращает { skyId, profileId, sessionId } либо null. profileId может
 * быть null: так выглядит состояние «в Sky ID вошли, профиль ещё не
 * выбран». Проверять его наличие обязаны те ручки, которым нужен именно
 * профиль, — см. requireProfile.
 */
export const readSession = async (req) => {
  const payload = verifyToken(readAccessToken(req), config.jwtSecret);
  if (!payload || payload.typ !== 'access' || !payload.sky || !payload.sid) return null;

  const stored = await sessionStore.get(payload.sid);
  // Сессии нет — вышли, отозвали или истекла: доступа нет.
  if (!stored) return null;
  // Токен от другой учётной записи с тем же номером сессии не подойдёт.
  if (stored.userId !== payload.sky) return null;

  return { skyId: payload.sky, profileId: stored.profileId ?? null, sessionId: payload.sid };
};

/** Нужен только вход в Sky ID — профиль может быть не выбран. */
export const requireSkyId = async (req, res) => {
  const session = await readSession(req);
  if (!session) { json(res, 401, { error: 'unauthorized' }); return null; }
  return session;
};

/** Нужен активный профиль: без него операция бессмысленна. */
export const requireProfile = async (req, res) => {
  const session = await readSession(req);
  if (!session) { json(res, 401, { error: 'unauthorized' }); return null; }
  if (!session.profileId) { json(res, 409, { error: 'no_active_profile' }); return null; }
  return session;
};
