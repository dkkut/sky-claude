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
import { query } from './db.mjs';

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

/**
 * Ошибка запроса, а не сервера.
 *
 * Кривое тело — это то, что прислал клиент, и отвечать на него надо
 * «неверный запрос». Без этой пометки такая ошибка доходила до общего
 * обработчика наравне с поломкой внутри сервера: человек получал 500, в
 * журнал попадала запись о сбое, а вне боевого режима наружу уходил ещё
 * и текст ошибки. Достаточно было отправить в любую ручку строку «не
 * json».
 */
export class BadRequest extends Error {
  constructor(code) { super(code); this.status = 400; this.code = code; }
}

export const parseBody = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) {
      reject(new BadRequest('payload_too_large'));
      req.destroy();
    }
  });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      reject(new BadRequest('invalid_json'));
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

/**
 * Что забаненному оставляем открытым.
 *
 * Выход — чтобы он мог уйти. Обновление токена — чтобы страница не
 * рассыпалась на полуслове. Поддержка — чтобы он мог обжаловать: бан без
 * способа оспорить это не наказание, а стена. Выбор профиля — чтобы
 * перейти на свой второй, если он не забанен.
 */
const BANNED_MAY = [
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/support/',
  '/api/skyid/profiles/',
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Нужен активный профиль: без него операция бессмысленна.
 *
 * Здесь же проверяется бан — и это единственное место, где его вообще
 * можно проверить один раз на все ручки. До этого он спрашивался только
 * на сокете, и означал ровно «нельзя переписываться»: забаненный
 * продавец продолжал торговать, принимать чужие деньги и снимать ячейки
 * на складах. Администратор при этом был уверен, что убрал человека с
 * платформы.
 *
 * Закрываем изменяющие запросы, а чтение оставляем. Человек должен
 * видеть, что с ним произошло, и иметь возможность это оспорить;
 * молчаливо переставшая работать страница не объясняет ничего.
 *
 * Спрашивается у базы, а не из токена: снятый бан должен действовать
 * сразу, а снимают его обычно как раз тогда, когда ждать нельзя.
 */
export const requireProfile = async (req, res) => {
  const session = await readSession(req);
  if (!session) { json(res, 401, { error: 'unauthorized' }); return null; }
  if (!session.profileId) { json(res, 409, { error: 'no_active_profile' }); return null; }

  if (!SAFE_METHODS.has(req.method)) {
    const path = String(req.url ?? '').split('?')[0];
    if (!BANNED_MAY.some((prefix) => path.startsWith(prefix))) {
      const { rows } = await query(
        'SELECT banned_until FROM profiles WHERE id = $1', [session.profileId]);
      const until = rows[0]?.banned_until;
      if (until && until > new Date()) {
        json(res, 403, { error: 'banned', until: until.toISOString() });
        return null;
      }
    }
  }

  return session;
};
