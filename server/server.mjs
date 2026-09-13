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
import { waitForDb, migrate, closeDb, query } from './db.mjs';
import { encryptExistingContent } from './encryptbackfill.mjs';
import { connectRedis, closeRedis, redisAlive } from './sessions.mjs';
import { startSignalHub, isOnline } from './signal.mjs';
import { verifyToken } from './security.mjs';
import { BETA_COOKIE, parseCookies } from './cookies.mjs';
import { betaEnabled, syncBetaKeys, betaHashLive } from './beta.mjs';
import { betaRoutes } from './routes/beta.mjs';
import { authRoutes } from './routes/auth.mjs';
import { skyIdRoutes } from './routes/skyid.mjs';
import { walletRoutes } from './routes/wallet.mjs';
import { supportRoutes } from './routes/support.mjs';
import { directoryRoutes } from './routes/directory.mjs';
import { fileRoutes } from './routes/files.mjs';
import { musicRoutes } from './routes/music.mjs';
import { filmRoutes } from './routes/film.mjs';
import { tvRoutes } from './routes/tv.mjs';
import { podcastRoutes } from './routes/podcasts.mjs';
import { botRoutes } from './routes/bots.mjs';
import { ticketRoutes } from './routes/tickets.mjs';
import { aiRoutes } from './routes/ai.mjs';
import { togetherRoutes } from './routes/together.mjs';
import { marketRoutes } from './routes/market.mjs';
import { logisticsRoutes } from './routes/logistics.mjs';
import { checkAllSources } from './tv.mjs';
import { sweepOrphanFilms } from './film.mjs';
import { sweepOrphanPodcastFiles } from './podcasts.mjs';
import { sweepBots } from './bots.mjs';
import { expireOrganizers, closePastEvents, sweepOrphanTicketImages } from './tickets.mjs';
import { sweepAiUsage } from './aichat.mjs';
import { sweepTogether } from './together.mjs';
import { sweepSellerSubscriptions } from './market.mjs';
import { sweepPickupExpiry } from './marketdelivery.mjs';
import { sweepAiFiles } from './aitools.mjs';
import { retryPendingWebhooks } from './botevents.mjs';
import { sweepOrphans } from './attachments.mjs';
import { purgeExpiredCodes } from './verification.mjs';
import { checkDeliverySetup, closeMailer } from './notify.mjs';
import { expirePrimeSubscriptions } from './skyid.mjs';

/** Порядок важен только тем, что более специфичные пути идут раньше. */
const ROUTES = [betaRoutes, authRoutes, skyIdRoutes, walletRoutes, directoryRoutes, fileRoutes,
                supportRoutes, musicRoutes, filmRoutes, tvRoutes, podcastRoutes, botRoutes,
                ticketRoutes, aiRoutes, togetherRoutes, marketRoutes, logisticsRoutes];

/**
 * Пропущен ли запрос через калитку беты.
 *
 * Проверка стоит на сервере, а не в браузере: экран с полем для ключа
 * закрывал бы только глаза, а API отвечал бы кому угодно.
 */
const betaAllowed = (req) => {
  if (!betaEnabled()) return true;
  const token = parseCookies(req.headers.cookie)[BETA_COOKIE];
  const payload = verifyToken(token ?? '', config.jwtSecret);
  return Boolean(payload && payload.typ === 'beta' && betaHashLive(payload.k));
};

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

    /*
     * Готовность, а не просто «процесс жив».
     *
     * healthz отвечает, даже когда приложение не может достучаться до
     * базы или кэша: контейнер запущен, а сайт не работает. После смены
     * паролей важно отличать одно от другого, поэтому здесь настоящая
     * проверка обоих хранилищ.
     *
     * Наружу не рассказываем, что именно отказало: подробности нужны в
     * журнале, а не постороннему.
     */
    if (req.method === 'GET' && url === '/readyz') {
      let db = false;
      try { await query('SELECT 1'); db = true; } catch (err) {
        console.error('[readyz] база', err.message);
      }
      const cache = await redisAlive();
      if (db && cache) return json(res, 200, { ready: true });
      console.error(`[readyz] не готово: база=${db}, кэш=${cache}`);
      return json(res, 503, { ready: false });
    }

    /*
     * Сама калитка и проверка здоровья открыты всегда — иначе ключ
     * негде было бы ввести.
     *
     * Bot API тоже мимо калитки, и это не послабление. Калитка держит
     * ЛЮДЕЙ, которым рано видеть приложение: ключ вводят в браузере, и
     * он живёт в куке. За Bot API стоит не браузер, а программа на
     * сервере владельца бота — куки ей взять неоткуда, а пускать её
     * через ключ беты значило бы раздать этот ключ всем владельцам
     * ботов. Вход туда охраняется своим, более строгим способом:
     * секретом runtime, выданным при привязке, и токеном на час. Без
     * них /api/bots/rt/ не отвечает ничего.
     */
    const isBotApi = url.startsWith('/api/bots/rt/');
    if (url.startsWith('/api/') && !url.startsWith('/api/beta') && !isBotApi && !betaAllowed(req)) {
      return json(res, 403, { error: 'beta_required' });
    }

    for (const route of ROUTES) {
      // Модуль возвращает false, если путь не его.
      const handled = await route(req, res, url);
      if (handled !== false) return;
    }

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    // Кривое или слишком большое тело — вина запроса, а не сервера:
    // отвечаем 400 и молча, без записи о сбое. Иначе достаточно было
    // послать «не json», чтобы получить 500 и строчку в журнале.
    if (error?.status === 400) return json(res, 400, { error: error.code ?? 'bad_request' });
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
let botRetry = null;

const start = async () => {
  // Содержимое переписки лежит в базе зашифрованным, и ключ для этого
  // нужен собственный. Вывод из JWT_SECRET здесь недопустим: смена
  // подписи токенов — обычное дело при подозрении на утечку, а она
  // сделала бы нечитаемой всю переписку разом.
  if (config.nodeEnv === 'production' && !config.encryptionKey) {
    console.error('[запуск] не задан ENCRYPTION_KEY. Переписка хранится зашифрованной, '
                + 'и без отдельного ключа её нельзя ни записать, ни прочитать надёжно. '
                + 'Задайте ENCRYPTION_KEY в .env (scripts/rotate-secrets.sh сделает это сам) '
                + 'и храните его отдельно от резервных копий базы.');
    process.exit(1);
  }

  await waitForDb();
  await migrate();
  await encryptExistingContent();
  await connectRedis();

  // Список ключей беты приводим в соответствие с .env при каждом
  // запуске: убранный оттуда ключ должен переставать работать.
  // Про неработающую доставку кодов лучше узнать при запуске, а не
  // тогда, когда кто-то не сможет войти.
  checkDeliverySetup();

  const removed = await syncBetaKeys();
  if (betaEnabled()) {
    console.log(`[beta] калитка включена, ключей: ${config.betaKeys.length}` +
                (removed ? `, отозвано: ${removed}` : ''));
  }

  signalHub = startSignalHub();

  /*
   * Досылка вебхуков ботов.
   *
   * Отдельно от часовой уборки и куда чаще: сервер владельца бота мог
   * лежать ровно в ту минуту, когда пришло событие, и ждать час, чтобы
   * попробовать снова, — значит не доставить вовсе. Тех, кто забирает
   * события сам, это не касается: они висят на запросе и получают
   * событие в момент появления.
   */
  botRetry = setInterval(() => {
    retryPendingWebhooks().catch((err) => console.error('[bots] досылка', err.message));
  }, 60 * 1000);
  botRetry.unref();

  // Раз в час убираем отработавшие коды и гасим истёкшие подписки Prime.
  houseKeeping = setInterval(async () => {
    try {
      await purgeExpiredCodes();
      await sweepOrphans();
      // Кино на диске весит больше всего остального вместе взятого,
      // поэтому осиротевшие файлы убираем отдельно: фильм без владельца
      // и файл без записи в базе никто уже не откроет, а место они
      // занимают.
      const films = await sweepOrphanFilms();
      if (films) console.log(`[film] убрано осиротевших файлов: ${films}`);
      // Неотвечающий телеканал должен превращаться в честное «временно
      // недоступен» на карточке, а не в чёрный экран после нажатия.
      // То же и с подкастами: оборвавшаяся загрузка оставляет файл
      // без строки в базе, а место он занимает.
      const pods = await sweepOrphanPodcastFiles();
      if (pods) console.log(`[podcasts] убрано осиротевших файлов: ${pods}`);
      const tv = await checkAllSources();
      if (tv.bad) console.log(`[tv] источников не отвечает: ${tv.bad} из ${tv.ok + tv.bad}`);
      const expired = await expirePrimeSubscriptions();
      if (expired) console.log(`[prime] истекло подписок: ${expired}`);
      // Событие, которое сервер владельца бота не забрал за сутки,
      // забирать уже некому: очередь без потолка растёт вечно.
      const botEvents = await sweepBots();
      if (botEvents) console.log(`[bots] выброшено просроченных событий: ${botEvents}`);
      // Подписка организатора кончается по времени, а не по нажатию:
      // без этого кабинет оставался бы открытым до следующего входа.
      // Мероприятия и билеты при этом не трогаем — закрываются только
      // действия организатора.
      const orgs = await expireOrganizers();
      if (orgs) console.log(`[tickets] истекло подписок организаторов: ${orgs}`);
      // Прошедшее мероприятие должно само становиться завершённым, а его
      // билеты — просроченными: иначе «действителен» висел бы годами.
      const past = await closePastEvents();
      if (past) console.log(`[tickets] завершено прошедших мероприятий: ${past}`);
      const posters = await sweepOrphanTicketImages();
      if (posters) console.log(`[tickets] убрано осиротевших афиш: ${posters}`);
      // Файл, отданный Sky AI на разбор, живёт до разбора и не дольше.
      // Человек закрыл вкладку между загрузкой и разбором — держать
      // его документ сутками незачем.
      const aiFiles = await sweepAiFiles();
      if (aiFiles) console.log(`[ai] убрано неразобранных файлов: ${aiFiles}`);
      const aiDays = await sweepAiUsage();
      if (aiDays) console.log(`[ai] убрано старых счётчиков: ${aiDays}`);
      // Брошенная сессия «Вместе» — та, где полсуток ничего не
      // происходило. Такие остаются после закрытых вкладок: сокет
      // умер, а строка так и висит «живой».
      const rooms = await sweepTogether({ isOnline });
      if (rooms) console.log(`[вместе] закрыто брошенных сессий: ${rooms}`);
      // Подписка продавца Sky Market кончается по времени. Колонка
      // должна говорить правду и без запроса: иначе выборки по
      // sub_status = active считают торгующими тех, у кого срок вышел.
      const shops = await sweepSellerSubscriptions();
      if (shops) console.log(`[market] истекло подписок продавцов: ${shops}`);
      // Посылка, за которой не пришли в пункт выдачи, не должна висеть
      // «ждёт получателя» вечно: срок хранения кончился — это спор.
      const stale = await sweepPickupExpiry();
      if (stale) console.log(`[market] просрочено хранение посылок: ${stale}`);
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
    if (botRetry) clearInterval(botRetry);
    await new Promise((resolve) => server.close(resolve));
    if (signalHub) await signalHub.close();
    closeMailer();
    await closeRedis();
    await closeDb();
  } catch (err) {
    console.error('[api] ошибка при остановке:', err.message);
  }
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
