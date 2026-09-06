import http from 'node:http';
import { config } from './config.mjs';
import { generateId, rateLimit, sanitizeInput, signToken, verifyToken } from './security.mjs';
import { sessionStore, userStore } from './store.mjs';
import './signal.mjs'; // WebRTC сигнальный сервер на порту 8081

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

const createAuthPair = (userId, previousSessionId = null) => {
  const sessionId = generateId();
  const accessToken = signToken({ sub: userId, typ: 'access' }, config.jwtSecret, config.accessTtlSec);
  const refreshToken = signToken({ sub: userId, sid: sessionId, typ: 'refresh' }, config.refreshSecret, config.refreshTtlSec);

  if (previousSessionId) sessionStore.revoke(previousSessionId);
  sessionStore.put({ id: sessionId, userId, createdAt: Date.now() });

  return { accessToken, refreshToken, sessionId };
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

    if (req.method === 'POST' && req.url === '/api/auth/login') {
      const body = await parseBody(req);
      const phone = sanitizeInput(body.phone || '');
      const password = sanitizeInput(body.password || '');

      const user = userStore.findByPhone(phone);
      if (!user || !userStore.verifyPassword(user, password)) {
        return json(res, 401, { error: 'invalid_credentials' });
      }

      const tokens = createAuthPair(user.id);
      return json(res, 200, { userId: user.id, ...tokens });
    }

    if (req.method === 'POST' && req.url === '/api/auth/refresh') {
      const body = await parseBody(req);
      const refreshToken = sanitizeInput(body.refreshToken || '');
      const payload = verifyToken(refreshToken, config.refreshSecret);
      if (!payload || payload.typ !== 'refresh' || !payload.sid) {
        return json(res, 401, { error: 'invalid_refresh' });
      }

      const stored = sessionStore.get(payload.sid);
      if (!stored || stored.userId !== payload.sub) {
        return json(res, 401, { error: 'stale_session' });
      }

      const tokens = createAuthPair(payload.sub, payload.sid);
      return json(res, 200, tokens);
    }

    if (req.method === 'POST' && req.url === '/api/auth/logout') {
      const body = await parseBody(req);
      const refreshToken = sanitizeInput(body.refreshToken || '');
      const payload = verifyToken(refreshToken, config.refreshSecret);
      if (payload?.sid) sessionStore.revoke(payload.sid);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = config.nodeEnv === 'production' ? 'internal_error' : error.message;
    return json(res, 500, { error: message });
  }
});

server.listen(config.apiPort, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${config.apiPort}`);
});

const shutdown = (signal) => {
  // eslint-disable-next-line no-console
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
