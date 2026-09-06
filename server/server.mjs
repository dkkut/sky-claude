/**
 * HTTP-слой Sky.
 *
 * Сам файл — только оболочка: общие проверки, диспетчеризация по модулям
 * маршрутов и запуск. Логика входа лежит в routes/auth.mjs, управление
 * аккаунтом — в routes/skyid.mjs, кошелёк — в routes/wallet.mjs.
 */
import http from 'node:http';
import { config } from './config.mjs';
import { rateLimit } from './security.mjs';
import { json } from './http.mjs';
import { waitForDb, migrate, closeDb } from './db.mjs';
import { connectRedis, closeRedis } from './sessions.mjs';
import { startSignalHub } from './signal.mjs';
import { authRoutes } from './routes/auth.mjs';
import { skyIdRoutes } from './routes/skyid.mjs';
import { walletRoutes } from './routes/wallet.mjs';
import { purgeExpiredCodes } from './verification.mjs';
import { expirePrimeSubscriptions } from './skyid.mjs';

/** Порядок важен только тем, что более специфичные пути идут раньше. */
const ROUTES = [authRoutes, skyIdRoutes, walletRoutes];

const server = http.createServer(async (req, res) => {
  try {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimit(ip, config.rateLimitPerMinute)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    // Строку запроса отбрасываем: маршруты сравниваются по пути.
    const url = (req.url || '').split('?')[0];

    if (req.method === 'GET' && url === '/healthz') {
      return json(res, 200, { status: 'ok', uptime: process.uptime() });
    }

    for (const route of ROUTES) {
      // Модуль возвращает false, если путь не его.
      const handled = await route(req, res, url);
      if (handled !== false) return;
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('[api]', error);
    const message = config.nodeEnv === 'production' ? 'internal_error' : error.message;
    return json(res, 500, { error: message });
  }
});

/* ─── Запуск ─────────────────────────────────────────────────────────────
   БД и Redis должны быть готовы до приёма запросов, иначе первые из них
   упадут с 500.                                                          */
let signalHub = null;
let houseKeeping = null;

const start = async () => {
  await waitForDb();
  await migrate();
  await connectRedis();

  signalHub = startSignalHub();

  // Раз в час убираем отработавшие коды и гасим истёкшие подписки Prime.
  houseKeeping = setInterval(async () => {
    try {
      await purgeExpiredCodes();
      const expired = await expirePrimeSubscriptions();
      if (expired) console.log(`[prime] истекло подписок: ${expired}`);
    } catch (err) {
      console.error('[housekeeping]', err.message);
    }
  }, 60 * 60 * 1000);
  houseKeeping.unref();

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
    if (houseKeeping) clearInterval(houseKeeping);
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
