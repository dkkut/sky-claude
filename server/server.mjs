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
import { json, originAllowed, readSession } from './http.mjs';
import { isOwner, isAdmin } from './admin.mjs';
import { shutdownState, maintenanceState } from './platform.mjs';
import { waitForDb, migrate, closeDb, query } from './db.mjs';
import { encryptExistingContent } from './encryptbackfill.mjs';
import { encryptLegacyMedia } from './mediabackfill.mjs';
import { connectRedis, closeRedis, redisAlive } from './sessions.mjs';
import { startSignalHub, isOnline } from './signal.mjs';
import { verifyToken } from './security.mjs';
import { BETA_COOKIE, parseCookies } from './cookies.mjs';
import { betaEnabled, syncBetaKeys, betaHashLive } from './beta.mjs';
import { betaRoutes } from './routes/beta.mjs';
import { authRoutes } from './routes/auth.mjs';
import { passwordRoutes } from './routes/password.mjs';
import { skyIdRoutes } from './routes/skyid.mjs';
import { walletRoutes } from './routes/wallet.mjs';
import { supportRoutes } from './routes/support.mjs';
import { directoryRoutes } from './routes/directory.mjs';
import { fileRoutes } from './routes/files.mjs';
import { musicRoutes } from './routes/music.mjs';
import { filmRoutes } from './routes/film.mjs';
import { skyVideoRoutes } from './routes/skyvideo.mjs';
import { primePulseRoutes } from './routes/primepulse.mjs';
import { tvRoutes } from './routes/tv.mjs';
import { podcastRoutes } from './routes/podcasts.mjs';
import { bookRoutes } from './routes/books.mjs';
import { botRoutes } from './routes/bots.mjs';
import { ticketRoutes } from './routes/tickets.mjs';
import { aiRoutes } from './routes/ai.mjs';
import { togetherRoutes } from './routes/together.mjs';
import { marketRoutes } from './routes/market.mjs';
import { logisticsRoutes } from './routes/logistics.mjs';
import { sharedWarehouseRoutes } from './routes/sharedwh.mjs';
import { pvzRoutes } from './routes/pvz.mjs';
import { pvzShipmentRoutes } from './routes/pvzshipments.mjs';
import { campaignRoutes } from './routes/campaigns.mjs';
import { sweepOrphanCampaignCovers } from './campaigns.mjs';
import { giftRoutes } from './routes/gifts.mjs';
import { sweepOrphanGiftMedia } from './gifts.mjs';
import { mapsRoutes } from './routes/maps.mjs';
import { familyRoutes } from './routes/family.mjs';
import { adminChannelRoutes } from './routes/adminchannels.mjs';
import { garantRoutes } from './routes/garant.mjs';
import { violationsRoutes } from './routes/violations.mjs';
import { platformRoutes } from './routes/platform.mjs';
import { customizationRoutes } from './routes/customization.mjs';
import { liveEvidenceIds } from './violations.mjs';
import { sweepOrphans as sweepEvidenceFiles } from './evidencestore.mjs';
import { storageShareRoutes } from './routes/storageshare.mjs';
import { mediaActivityRoutes } from './routes/mediaActivity.mjs';
import { followsRoutes } from './routes/follows.mjs';
import { friendsRoutes } from './routes/friends.mjs';
import { contentFlagsRoutes } from './routes/contentflags.mjs';
import { gamesRoutes } from './routes/games.mjs';
import { voicePartyRoutes } from './routes/voiceparty.mjs';
import { bloomRoutes } from './routes/bloom.mjs';
import { sweepOrphanBloomMedia } from './bloom.mjs';
import { storiesRoutes } from './routes/stories.mjs';
import { sweepOrphanStoryMedia } from './stories.mjs';
import { quickMenuRoutes } from './routes/quickmenu.mjs';
import { petsRoutes } from './routes/pets.mjs';
import { sweepOrphanSkinMedia } from './skinMarket.mjs';
import { streamsRoutes } from './routes/streams.mjs';
import { weatherRoutes } from './routes/weather.mjs';
import { runWithLang } from './lang.mjs';
import { marketVerifyRoutes } from './routes/marketverify.mjs';
import { codesRoutes } from './routes/codes.mjs';
import { bloxRoutes } from './routes/blox.mjs';
import { recordRequest, optionalAllowed, loadLimits } from './bloxlimits.mjs';
import { pruneNonces } from './bloxshop.mjs';
import { probeGame } from './bloxnet.mjs';
import { trackingRoutes } from './routes/tracking.mjs';
import { notifyRoutes } from './routes/notify.mjs';
import { dispatchDueBroadcasts, sweepStaleBroadcastRuns } from './notifyBroadcast.mjs';
import { adsRoutes } from './routes/ads.mjs';
import { kutrentMarketRoutes } from './routes/kutrentmarket.mjs';
import { activateDueCampaigns, completeExpiredCampaigns, sweepOrphanAdMedia } from './ads.mjs';
import { sweepStartedTournaments } from './tournaments.mjs';
import { checkAllSources } from './tv.mjs';
import { sweepOrphanFilms } from './film.mjs';
import { sweepOrphanVideos } from './skyvideo.mjs';
import { sweepOrphanPodcastFiles } from './podcasts.mjs';
import { sweepBots } from './bots.mjs';
import { expireOrganizers, closePastEvents, sweepOrphanTicketImages } from './tickets.mjs';
import { sweepAiUsage } from './aichat.mjs';
import { sweepTogether } from './together.mjs';
import { sweepUnusedPersonalFiles } from './storagequota.mjs';
import { sweepSellerSubscriptions, liveFileIds } from './market.mjs';
import { sweepOrphans as sweepMarketFiles } from './marketstore.mjs';
import { sweepOrphans as sweepVideoFiles } from './videostore.mjs';
import { liveVideoIds } from './videoreview.mjs';
import { sweepExpiredRentals } from './sharedwarehouse.mjs';
import { sweepStepUp, sweepPendingActions } from './adminsec.mjs';
import { sweepPickupExpiry } from './marketdelivery.mjs';
import { sweepAiFiles } from './aitools.mjs';
import { retryPendingWebhooks } from './botevents.mjs';
import { sweepOrphans } from './attachments.mjs';
import { purgeExpiredCodes } from './verification.mjs';
import { checkDeliverySetup, closeMailer } from './notify.mjs';
import { expirePrimeSubscriptions } from './skyid.mjs';
import { confirmSshLogin } from './breach.mjs';

/** Порядок важен только тем, что более специфичные пути идут раньше. */
const ROUTES = [betaRoutes, authRoutes, passwordRoutes, skyIdRoutes, walletRoutes, directoryRoutes, fileRoutes,
                supportRoutes, musicRoutes, filmRoutes, skyVideoRoutes, tvRoutes, podcastRoutes, bookRoutes,
                botRoutes, ticketRoutes, aiRoutes, togetherRoutes, marketVerifyRoutes, marketRoutes, bloxRoutes, primePulseRoutes,
                pvzRoutes, pvzShipmentRoutes, campaignRoutes, giftRoutes, sharedWarehouseRoutes, logisticsRoutes, mapsRoutes,
                familyRoutes, garantRoutes, mediaActivityRoutes, followsRoutes, friendsRoutes, contentFlagsRoutes, gamesRoutes, voicePartyRoutes, bloomRoutes, weatherRoutes, trackingRoutes, codesRoutes,
                notifyRoutes, adsRoutes, kutrentMarketRoutes, storiesRoutes, quickMenuRoutes, petsRoutes, streamsRoutes,
                violationsRoutes, storageShareRoutes, platformRoutes, customizationRoutes, adminChannelRoutes];

/**
 * Пропущен ли запрос через калитку беты.
 *
 * Проверка стоит на сервере, а не в браузере: экран с полем для ключа
 * закрывал бы только глаза, а API отвечал бы кому угодно.
 */
const betaAllowed = (req) => {
  if (!betaEnabled()) return true;
  // Родное приложение не носит куки (свой origin, не боевой домен) —
  // держит пропуск сам и шлёт его заголовком X-Sky-Beta. Кука остаётся
  // основным путём для браузера, заголовок — запасной, только для него.
  const token = parseCookies(req.headers.cookie)[BETA_COOKIE]
    || (typeof req.headers['x-sky-beta'] === 'string' ? req.headers['x-sky-beta'] : '');
  const payload = verifyToken(token ?? '', config.jwtSecret);
  return Boolean(payload && payload.typ === 'beta' && betaHashLive(payload.k));
};

/**
 * CORS только для /api/*: до сих пор всё было same-origin (веб грузится с
 * боевого домена, что и есть API), заголовков не было вовсе. Родное
 * приложение живёт на другом origin (https://localhost у Capacitor,
 * app://sky у Electron) — без явного разрешения браузер/WebView просто
 * не отдаст ему ответ. Отражаем ровно тот origin, что уже разрешён для
 * WebSocket-рукопожатия (originAllowed, см. http.mjs) — никогда wildcard,
 * и без Allow-Credentials: нативные запросы не носят куки кросс-доменно,
 * так что это не открывает CSRF.
 */
const applyCors = (req, res) => {
  const origin = req.headers.origin;
  if (!origin || !originAllowed(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Sky-Client, X-Sky-Beta, X-Sky-Lang, X-Sky-Media-Url');
    res.setHeader('Access-Control-Max-Age', '600');
  }
};

const server = http.createServer((req, res) => runWithLang(req, async () => {
  const t0 = Date.now();
  res.on('finish', () => recordRequest(res.statusCode, Date.now() - t0));
  try {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!rateLimit(ip, config.rateLimitPerMinute)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    // Строку запроса отбрасываем: маршруты сравниваются по пути.
    const url = (req.url || '').split('?')[0];

    applyCors(req, res);
    if (req.method === 'OPTIONS' && url.startsWith('/api/')) {
      res.writeHead(204);
      return res.end();
    }

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
     * Подтверждение «это я входил по SSH» по ссылке из письма
     * (server/breach.mjs, хук на хосте — ssh-login-hook.sh). Страница
     * без входа в сайт: тот, кто получил письмо, мог не иметь под
     * рукой открытой сессии Sky, а ждать 10 минут не вариант. Сам
     * токен в ссылке — секрет, его одного достаточно.
     */
    if (req.method === 'GET' && url === '/ssh-confirm') {
      const token = new URLSearchParams((req.url.split('?')[1] || '')).get('token');
      const ok = await confirmSshLogin(token);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(ok
        ? '<!doctype html><meta charset="utf-8"><title>Sky</title>' +
          '<p>Подтверждено: вход по SSH — это были вы. Автоматическое ' +
          'аварийное выключение сервера отменено.</p>'
        : '<!doctype html><meta charset="utf-8"><title>Sky</title>' +
          '<p>Ссылка недействительна или устарела (срок — 10 минут с ' +
          'момента входа). Если вход не ваш, сервер будет выключен ' +
          'автоматически по истечении этого времени.</p>');
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
     *
     * Переход по ссылке участника мероприятия — та же история: её
     * кликает случайный зритель ролика в соцсети, у которого никогда
     * не было браузера с ключом беты и не будет. Свой секрет у неё
     * тоже есть — случайный токен участника, который сверяется на
     * сервере constant-time сравнением; без него запрос ничего не
     * находит и ничего не считает.
     *
     * KutRent Market — отдельный сайт-партнёр на своём домене
     * (market.kutrent.online), и это не послабление, а другой домен:
     * кука с ключом беты Sky живёт на боевом домене Sky и сюда прийти
     * не может, а экрана для ввода этого ключа на сайте партнёра нет и
     * не должно быть — это чужой сайт, а не часть Sky. У него своя
     * калитка (простой клиентский ключ на самом market-site) и своя
     * настоящая проверка личности — вход только через Sky ID
     * (requireProfile в /sso/start, одноразовый токен в /sso/consume),
     * так что беспроверочно открытым для анонимного POST'а /api/kutrent-
     * market/ всё равно не остаётся.
     */
    const isBotApi = url.startsWith('/api/bots/rt/');
    const isCampaignClick = /^\/api\/campaigns\/r\//.test(url);
    const isKutrentMarket = url.startsWith('/api/kutrent-market/');
    /* Игровые серверы Sky Blox — программы, а не люди: у них подпись запроса вместо ключа беты. */
    const isBloxServer = url.startsWith('/api/blox/server/');
    if (url.startsWith('/api/') && !url.startsWith('/api/beta') && !isBotApi && !isCampaignClick && !isKutrentMarket && !isBloxServer && !betaAllowed(req)) {
      return json(res, 403, { error: 'beta_required' });
    }

    /*
     * «Аварийные работы» и «Технические работы» — два отдельных
     * системных режима для сайта целиком (server/platform.mjs), не
     * путать с аварийным режимом панели администратора (admin_lockdown
     * в server/adminsec.mjs — тот закрывает только саму панель и
     * пускает владельца всегда). Вход (/api/auth/...) и собственная
     * ручка статуса режима остаются открытыми всегда: иначе владелец
     * не смог бы ни войти и выключить режим, ни браузер — понять,
     * почему сайт не отвечает, и показать нужный экран.
     */
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/') && url !== '/api/platform/status') {
      const shutdown = await shutdownState();
      if (shutdown.active) {
        const session = await readSession(req);
        const owner = session?.profileId ? await isOwner(session.profileId) : false;
        if (!owner) return json(res, 503, { error: 'platform_shutdown', reason: shutdown.reason });
      } else {
        const maintenance = await maintenanceState();
        if (maintenance.active) {
          const session = await readSession(req);
          const admin = session?.profileId ? await isAdmin(session.profileId) : false;
          if (!admin) return json(res, 503, { error: 'platform_maintenance', reason: maintenance.reason });
        }
      }
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
}));

/* ─── Запуск ─────────────────────────────────────────────────────────────
   БД и Redis должны быть готовы до приёма запросов, иначе первые из них
   упадут с 500.                                                          */
let signalHub = null;
let houseKeeping = null;
let bloxSchedule;
let botRetry = null;
let notifyDispatch = null;
let adsSchedule = null;
let tourneySchedule = null;

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
  // Файлы, загруженные до шифрования, читаются и так; дошифровываем их в
  // фоне, не задерживая запуск API.
  encryptLegacyMedia()
    .then((r) => console.log(`[mediabackfill] зашифровано: ${r.encrypted}, перепаковано: ${r.rewrapped}, пропущено: ${r.skipped}, ошибок: ${r.failed}`))
    .catch((err) => console.error('[mediabackfill] сбой прохода:', err.message));
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

  // Рассылки: та же логика «не лежать вечно, если только не пришли за
  // ней сами» — запланированная отправка не должна ждать, пока кто-то
  // откроет приложение. Раз в 20 секунд — достаточно быстро для
  // «Отправить сейчас», не создавая нагрузки чаще, чем нужно.
  notifyDispatch = setInterval(() => {
    dispatchDueBroadcasts().catch((err) => console.error('[рассылки] worker', err.message));
  }, 20 * 1000);
  notifyDispatch.unref();

  // Sky Ads: кампания должна сама перейти в active/completed по
  // серверному времени, не дожидаясь, пока кто-то откроет приложение.
  adsSchedule = setInterval(() => {
    activateDueCampaigns().catch((err) => console.error('[ads] активация', err.message));
    completeExpiredCampaigns().catch((err) => console.error('[ads] завершение', err.message));
  }, 30 * 1000);
  adsSchedule.unref();

  // Турнир Sky Games сам переходит upcoming → live, как только настало
  // объявленное время начала — организатор не обязан заходить и жать
  // кнопку, чтобы список честно показывал «идёт», а не вечное «скоро».
  tourneySchedule = setInterval(() => {
    sweepStartedTournaments().catch((err) => console.error('[games] турниры', err.message));
  }, 30 * 1000);
  tourneySchedule.unref();

  // Sky Blox: раз в минуту — чистка одноразовых меток, просроченные запросы на покупку
  // и фоновая проверка доступности опубликованных игр. Частота и число параллельных
  // задач берутся из «Ограничений»; при высокой нагрузке проверки пропускаются.
  bloxSchedule = setInterval(async () => {
    try {
      await pruneNonces();
      await query(`UPDATE blox_purchases SET status = 'expired' WHERE status = 'pending' AND intent_expires_at < now()`);
      if (!optionalAllowed()) return;
      const l = await loadLimits();
      const { rows } = await query(
        `SELECT * FROM blox_games WHERE moderation_status IN ('published','approved') AND (client_url <> '' OR server_url <> '')
            AND (conn_checked_at IS NULL OR conn_checked_at < now() - ($1 || ' minutes')::interval) AND conn_status <> 'checking'
          ORDER BY conn_checked_at NULLS FIRST LIMIT $2`, [String(l.probeIntervalMin), l.maxBgJobs]);
      await Promise.all(rows.map((g) => probeGame(g, { source: 'background' }).catch((e) => console.error('[blox] проверка', e.message))));
    } catch (err) { console.error('[blox] фон', err.message); }
  }, 60 * 1000);
  bloxSchedule.unref();

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
      const skyvideos = await sweepOrphanVideos();
      if (skyvideos) console.log(`[skyvideo] убрано осиротевших файлов: ${skyvideos}`);
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
      const campaignCovers = await sweepOrphanCampaignCovers();
      if (campaignCovers) console.log(`[campaigns] убрано осиротевших обложек: ${campaignCovers}`);
      // Старая версия обложки/видео подарка или карточки Prime, на
      // которую больше никто не ссылается (каталог её сменил, а ни
      // один уже отправленный подарок к ней не привязан).
      const giftMedia = await sweepOrphanGiftMedia();
      if (giftMedia.removed) console.log(`[gifts] убрано осиротевших версий медиа: ${giftMedia.removed}`);
      // Медиа поста Bloom, загруженное, но так и не привязанное ни к
      // одному посту (человек закрыл вкладку между загрузкой и публикацией).
      const bloomMedia = await sweepOrphanBloomMedia();
      if (bloomMedia.removed) console.log(`[bloom] убрано осиротевшего медиа: ${bloomMedia.removed}`);
      // Медиа истории, загруженное, но так и не привязанное ни к одной
      // истории — тот же случай, что и с Bloom выше.
      const storyMedia = await sweepOrphanStoryMedia();
      if (storyMedia.removed) console.log(`[stories] убрано осиротевшего медиа: ${storyMedia.removed}`);
      // Превью/модель скина Sky Skin Market, загруженные администратором,
      // но так и не привязанные к товару (закрыл форму до сохранения).
      const skinMedia = await sweepOrphanSkinMedia();
      if (skinMedia.removed) console.log(`[pets] убрано осиротевшего медиа скинов: ${skinMedia.removed}`);
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
      // Файл без строки в базе уже никто не откроет и никто не удалит:
      // удаление идёт от строки, а строки нет.
      const orphans = await sweepMarketFiles(liveFileIds);
      if (orphans) console.log(`[market] убрано осиротевших файлов: ${orphans}`);
      // Аренда ячейки кончается по времени, а не по нажатию. Саму ячейку
      // при этом не освобождаем: внутри может остаться товар, и решать,
      // что с ним, — дело склада и регламента, а не расписания.
      const rents = await sweepExpiredRentals();
      if (rents) console.log(`[склады] закрыто аренд по сроку: ${rents}`);
      // Оборвавшаяся загрузка обзора оставляет файл без строки в базе.
      const videos = await sweepVideoFiles(liveVideoIds);
      if (videos) console.log(`[склады] убрано осиротевших обзоров: ${videos}`);
      // То же самое для доказательств по нарушениям: оборванная загрузка
      // (beginEvidence прошёл, saveStream не дописал) убирается сама в
      // handleEvidenceUpload, а здесь — на случай, если процесс упал
      // посреди записи и dropEvidence не успел выполниться.
      const evidenceFiles = await sweepEvidenceFiles(liveEvidenceIds);
      if (evidenceFiles) console.log(`[нарушения] убрано осиротевших доказательств: ${evidenceFiles}`);
      // Панель администратора: отработавшие подтверждения личности и
      // заявки, о которых забыли. Заявка, ждущая вечно, однажды будет
      // подтверждена не глядя.
      await sweepStepUp();
      const staleRequests = await sweepPendingActions();
      if (staleRequests) console.log(`[админ] просрочено заявок: ${staleRequests}`);
      // Запуск рассылки, зависший в processing дольше окна (сервер упал
      // посреди отправки), — считаем упавшим, чтобы он не блокировал
      // повторную попытку на этот же момент времени навсегда.
      await sweepStaleBroadcastRuns();
      // Рекламный материал, загруженный, но так и не привязанный ни к
      // одной кампании (человек закрыл вкладку между загрузкой и оплатой).
      const adMedia = await sweepOrphanAdMedia();
      if (adMedia.removed) console.log(`[ads] убрано осиротевшего медиа: ${adMedia.removed}`);
      // Личное кино и музыка, которые владелец сам не открывал 20 дней
      // и не защитил от уборки — см. storagequota.mjs: активная комната
      // «Вместе» спасает файл от удаления даже тогда.
      const personal = await sweepUnusedPersonalFiles();
      if (personal.films || personal.tracks) {
        console.log(`[storage] убрано неиспользуемого личного: кино ${personal.films}, музыка ${personal.tracks}`);
      }
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
    if (notifyDispatch) clearInterval(notifyDispatch);
    if (adsSchedule) clearInterval(adsSchedule);
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
