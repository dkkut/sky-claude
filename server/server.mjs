import http from 'node:http';
import { config } from './config.mjs';
import { generateId, rateLimit, sanitizeInput, signToken, verifyToken } from './security.mjs';
import { userStore, seedDemoUsers } from './store.mjs';
import { sessionStore, connectRedis, closeRedis } from './sessions.mjs';
import { waitForDb, migrate, closeDb } from './db.mjs';
import { REFRESH_COOKIE, parseCookies, buildRefreshCookie, clearRefreshCookie } from './cookies.mjs';
import { wallet } from './wallet.mjs';
import { startSignalHub } from './signal.mjs';

const json = (res, code, body, extraHeaders = {}) => {
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

/** Достаёт refresh-токен: сначала из куки, потом из тела — для не-браузерных клиентов. */
const readRefreshToken = (req, body) => {
  const fromCookie = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
  if (fromCookie) return fromCookie;
  return typeof body?.refreshToken === 'string' ? body.refreshToken : '';
};

/** Access-токен из заголовка Authorization: Bearer <...> */
const readAccessToken = (req) => {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') return '';
  const [scheme, value] = raw.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : '';
};

const parseBody = (req) => new Promise((resolve, reject) => {
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

const createAuthPair = async (userId, previousSessionId = null) => {
  const sessionId = generateId();
  const accessToken = signToken({ sub: userId, typ: 'access' }, config.jwtSecret, config.accessTtlSec);
  const refreshToken = signToken({ sub: userId, sid: sessionId, typ: 'refresh' }, config.refreshSecret, config.refreshTtlSec);

  if (previousSessionId) await sessionStore.revoke(previousSessionId);
  await sessionStore.put({ id: sessionId, userId }, config.refreshTtlSec);

  // refreshToken наружу в теле НЕ отдаём — он уходит только в HttpOnly-куку.
  return {
    body:   { accessToken, expiresIn: config.accessTtlSec },
    cookie: buildRefreshCookie(refreshToken, config.refreshTtlSec),
  };
};

/**
 * Возвращает id пользователя из access-токена или null.
 *
 * Все денежные операции опираются только на него: идентификатор из тела
 * запроса брать нельзя, иначе можно было бы начислить или списать
 * с чужого счёта.
 */
const actorId = (req) => {
  const payload = verifyToken(readAccessToken(req), config.jwtSecret);
  return payload && payload.typ === 'access' ? payload.sub : null;
};

/* ─── Валидация регистрации ─────────────────────────────────────────────
   Пароль намеренно не проходит через sanitizeInput: тот вырезает символы
   <>$` , то есть молча превратил бы «p$ssw0rd» в другой пароль, и человек
   потом не смог бы войти.                                                */
const PHONE_RE    = /^\+?[0-9]{10,15}$/;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

const validateRegistration = ({ phone, username, name, password }) => {
  if (!PHONE_RE.test(phone))       return 'invalid_phone';
  if (!USERNAME_RE.test(username)) return 'invalid_username';
  if (!name || name.length > 64)   return 'invalid_name';
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return 'weak_password';
  return null;
};

const server = http.createServer(async (req, res) => {
  try {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimit(ip, config.rateLimitPerMinute)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    if (req.method === 'GET' && req.url === '/healthz') {
      return json(res, 200, { status: 'ok', uptime: process.uptime() });
    }

    /* ── Регистрация ── */
    if (req.method === 'POST' && req.url === '/api/auth/register') {
      const body = await parseBody(req);
      const phone    = sanitizeInput(body.phone    || '');
      const username = sanitizeInput(body.username || '');
      const name     = sanitizeInput(body.name     || '');
      const password = typeof body.password === 'string' ? body.password : '';

      const invalid = validateRegistration({ phone, username, name, password });
      if (invalid) return json(res, 400, { error: invalid });

      const created = await userStore.create({ phone, username, name, password });
      if (created.error) return json(res, 409, { error: created.error, field: created.field });

      const auth = await createAuthPair(created.user.id);
      return json(res, 201, { user: created.user, ...auth.body }, { 'Set-Cookie': auth.cookie });
    }

    /* ── Вход ── */
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const body = await parseBody(req);
      // Экран входа отдаёт ник, а телефонный сценарий — номер. Принимаем
      // и то и другое одним полем, чтобы не плодить два эндпоинта.
      const identifier = sanitizeInput(body.login || body.phone || body.username || '');
      const password   = typeof body.password === 'string' ? body.password : '';

      const row = identifier.startsWith('+') || /^[0-9]{10,15}$/.test(identifier)
        ? await userStore.findByPhone(identifier)
        : await userStore.findByUsername(identifier);
      // Ответ один и тот же и для несуществующего телефона, и для неверного
      // пароля — иначе по коду ответа можно перебирать список номеров.
      const ok = row ? await userStore.verifyPassword(row, password) : false;
      if (!ok) return json(res, 401, { error: 'invalid_credentials' });

      const auth = await createAuthPair(row.id);
      return json(res, 200, {
        userId: row.id,
        user: { id: row.id, phone: row.phone, username: row.username, name: row.name,
                isAdmin: row.is_admin, isPrime: row.is_prime },
        ...auth.body,
      }, { 'Set-Cookie': auth.cookie });
    }

    /* ── Обновление пары токенов ── */
    if (req.method === 'POST' && req.url === '/api/auth/refresh') {
      const body = await parseBody(req);
      const refreshToken = readRefreshToken(req, body);
      const payload = verifyToken(refreshToken, config.refreshSecret);
      if (!payload || payload.typ !== 'refresh' || !payload.sid) {
        return json(res, 401, { error: 'invalid_refresh' }, { 'Set-Cookie': clearRefreshCookie() });
      }

      const stored = await sessionStore.get(payload.sid);
      if (!stored || stored.userId !== payload.sub) {
        // Кука указывает на отозванную сессию — гасим её, чтобы клиент
        // не долбился в refresh на каждом запросе.
        return json(res, 401, { error: 'stale_session' }, { 'Set-Cookie': clearRefreshCookie() });
      }

      const auth = await createAuthPair(payload.sub, payload.sid);
      const user = await userStore.findById(payload.sub);
      return json(res, 200, { user, ...auth.body }, { 'Set-Cookie': auth.cookie });
    }

    /* ── Выход ── */
    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      const body = await parseBody(req);
      const refreshToken = readRefreshToken(req, body);
      const payload = verifyToken(refreshToken, config.refreshSecret);
      if (payload?.sid) await sessionStore.revoke(payload.sid);
      return json(res, 200, { ok: true }, { 'Set-Cookie': clearRefreshCookie() });
    }

    /* ── Смена пароля ──
       Требует и действующий access-токен, и старый пароль: одного
       угнанного токена мало, чтобы отобрать аккаунт. */
    if (req.method === 'POST' && req.url === '/api/auth/change-password') {
      const payload = verifyToken(readAccessToken(req), config.jwtSecret);
      if (!payload || payload.typ !== 'access') {
        return json(res, 401, { error: 'unauthorized' });
      }

      const body = await parseBody(req);
      const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return json(res, 400, { error: 'weak_password' });
      }

      const row = await userStore.findByPhone((await userStore.findById(payload.sub))?.phone ?? '');
      if (!row || !(await userStore.verifyPassword(row, oldPassword))) {
        return json(res, 403, { error: 'wrong_password' });
      }

      await userStore.changePassword(row.id, newPassword);
      // Все прочие устройства разлогиниваем: если пароль меняют из-за утечки,
      // чужая сессия не должна пережить смену.
      await sessionStore.revokeAllForUser(row.id);

      const auth = await createAuthPair(row.id);
      return json(res, 200, { ok: true, ...auth.body }, { 'Set-Cookie': auth.cookie });
    }

    /* ── Текущий пользователь ──
       Источник правды о том, кто вошёл и какие у него права: браузеру
       на слово не верим, локальные данные могут быть подправлены. */
    if (req.method === 'GET' && req.url === '/api/auth/me') {
      const payload = verifyToken(readAccessToken(req), config.jwtSecret);
      if (!payload || payload.typ !== 'access') {
        return json(res, 401, { error: 'unauthorized' });
      }
      const user = await userStore.findById(payload.sub);
      if (!user) return json(res, 401, { error: 'unauthorized' });
      return json(res, 200, { user });
    }

    /* ── Кошелёк ──
       Владелец операции — тот, чей токен предъявлен. Ни одна ручка
       не принимает чужой userId. */
    if (req.url?.startsWith('/api/wallet')) {
      const uid = actorId(req);
      if (!uid) return json(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && req.url === '/api/wallet') {
        return json(res, 200, await wallet.getState(uid));
      }

      if (req.method === 'POST' && req.url === '/api/wallet/topup') {
        // Пополнение создаёт деньги, поэтому в обычном режиме закрыто:
        // включать его можно только вместе с настоящим приёмом платежей.
        if (config.paymentsMode !== 'demo') {
          return json(res, 501, { error: 'payments_not_configured' });
        }
        const body = await parseBody(req);
        const result = await wallet.topUp(uid, body.amount, sanitizeInput(body.method || 'card'));
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      // refund и earn-points увеличивают баланс или баллы, поэтому
      // закрыты тем же флагом, что и пополнение: пока источник этих
      // начислений (семейный счёт, активность) считается в браузере,
      // открывать их в бою нельзя.
      if (req.method === 'POST' && req.url === '/api/wallet/refund') {
        if (config.paymentsMode !== 'demo') return json(res, 501, { error: 'payments_not_configured' });
        const body = await parseBody(req);
        const result = await wallet.refund(uid, body.amount, sanitizeInput(body.desc || 'Возврат'),
                                           body.ref ? sanitizeInput(body.ref) : null);
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      if (req.method === 'POST' && req.url === '/api/wallet/earn-points') {
        if (config.paymentsMode !== 'demo') return json(res, 501, { error: 'payments_not_configured' });
        const body = await parseBody(req);
        const result = await wallet.earnPoints(uid, body.amount, sanitizeInput(body.desc || 'Начисление'));
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      if (req.method === 'POST' && req.url === '/api/wallet/spend') {
        const body = await parseBody(req);
        const result = await wallet.spend(
          uid, body.amount, sanitizeInput(body.type || 'market'),
          sanitizeInput(body.desc || ''), body.ref ? sanitizeInput(body.ref) : null,
        );
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      if (req.method === 'POST' && req.url === '/api/wallet/transfer') {
        const body = await parseBody(req);
        const target = body.toUserId
          ? await userStore.findById(sanitizeInput(body.toUserId))
          : await userStore.findByUsername(sanitizeInput(body.toUsername || ''));
        if (!target) return json(res, 404, { error: 'recipient_not_found' });

        const result = await wallet.transfer(uid, target.id, body.amount);
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      if (req.method === 'POST' && req.url === '/api/wallet/exchange') {
        const body = await parseBody(req);
        const result = await wallet.exchangeToPoints(uid, body.rubles);
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      if (req.method === 'POST' && req.url === '/api/wallet/spend-points') {
        const body = await parseBody(req);
        const result = await wallet.spendPoints(
          uid, body.amount, sanitizeInput(body.desc || ''),
          body.ref ? sanitizeInput(body.ref) : null,
        );
        return result.error ? json(res, 400, result) : json(res, 200, result);
      }

      return json(res, 404, { error: 'not_found' });
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('[api]', error);
    const message = config.nodeEnv === 'production' ? 'internal_error' : error.message;
    return json(res, 500, { error: message });
  }
});

/* ─── Запуск ─────────────────────────────────────────────────────────────
   Порядок важен: БД и Redis должны быть готовы до того, как сервер начнёт
   принимать запросы, иначе первые из них упадут с 500.                    */
let signalHub = null;

const start = async () => {
  await waitForDb();
  await migrate();
  await seedDemoUsers();
  await connectRedis();

  signalHub = startSignalHub();

  server.listen(config.apiPort, () => {
    console.log(`[api] listening on :${config.apiPort}`);
  });
};

start().catch((err) => {
  console.error('[api] не удалось запуститься:', err.message);
  process.exit(1);
});

const shutdown = async (signal) => {
  console.log(`[api] ${signal} received, shutting down`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  try {
    await new Promise((resolve) => server.close(resolve));
    if (signalHub) await signalHub.close();
    await closeRedis();
    await closeDb();
  } catch (err) {
    console.error('[api] ошибка при остановке:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
