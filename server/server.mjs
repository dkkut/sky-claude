import http from 'node:http';
import { config } from './config.mjs';
import { generateId, rateLimit, sanitizeInput, signToken, verifyToken } from './security.mjs';
import { userStore, seedDemoUsers } from './store.mjs';
import { sessionStore, connectRedis, closeRedis } from './sessions.mjs';
import { waitForDb, migrate, closeDb } from './db.mjs';
import { startSignalHub } from './signal.mjs';

const json = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
  });
  res.end(JSON.stringify(body));
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

  return { accessToken, refreshToken, sessionId };
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

      const tokens = await createAuthPair(created.user.id);
      return json(res, 201, { user: created.user, ...tokens });
    }

    /* ── Вход ── */
    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const body = await parseBody(req);
      const phone    = sanitizeInput(body.phone || '');
      const password = typeof body.password === 'string' ? body.password : '';

      const row = await userStore.findByPhone(phone);
      // Ответ один и тот же и для несуществующего телефона, и для неверного
      // пароля — иначе по коду ответа можно перебирать список номеров.
      const ok = row ? await userStore.verifyPassword(row, password) : false;
      if (!ok) return json(res, 401, { error: 'invalid_credentials' });

      const tokens = await createAuthPair(row.id);
      return json(res, 200, {
        userId: row.id,
        user: { id: row.id, phone: row.phone, username: row.username, name: row.name,
                isAdmin: row.is_admin, isPrime: row.is_prime },
        ...tokens,
      });
    }

    /* ── Обновление пары токенов ── */
    if (req.method === 'POST' && req.url === '/api/auth/refresh') {
      const body = await parseBody(req);
      const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
      const payload = verifyToken(refreshToken, config.refreshSecret);
      if (!payload || payload.typ !== 'refresh' || !payload.sid) {
        return json(res, 401, { error: 'invalid_refresh' });
      }

      const stored = await sessionStore.get(payload.sid);
      if (!stored || stored.userId !== payload.sub) {
        return json(res, 401, { error: 'stale_session' });
      }

      const tokens = await createAuthPair(payload.sub, payload.sid);
      return json(res, 200, tokens);
    }

    /* ── Выход ── */
    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      const body = await parseBody(req);
      const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
      const payload = verifyToken(refreshToken, config.refreshSecret);
      if (payload?.sid) await sessionStore.revoke(payload.sid);
      return json(res, 200, { ok: true });
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
