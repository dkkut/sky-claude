import './envfile.mjs';
export const config = {
  apiPort: Number(process.env.API_PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change_me',
  refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'change_me_too',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  accessTtlSec: Number(process.env.ACCESS_TTL_SEC || 900),
  // Одноразовый refresh (ротация): каждое обновление выдаёт новый токен, старый ещё `refreshReuseGraceSec`
  // принимается (параллельные вкладки, потерянный ответ), после — это повторное предъявление: сессия гасится.
  // REFRESH_ROTATION=off возвращает прежнее поведение (аварийный рубильник).
  refreshRotation: process.env.REFRESH_ROTATION !== 'off',
  refreshReuseGraceSec: Number(process.env.REFRESH_REUSE_GRACE_SEC || 86400),
  refreshTtlSec: Number(process.env.REFRESH_TTL_SEC || 60 * 60 * 24 * 30),
  // 'demo' разрешает пополнение кошелька без настоящего платежа.
  // Любое другое значение (в том числе отсутствие) закрывает эту ручку:
  // иначе баланс можно было бы нарисовать себе одним запросом.
  paymentsMode: process.env.PAYMENTS_MODE || 'disabled',

  // Ник владельца сервиса. Права администратора у него всегда, и снять
  // их не может никто — иначе назначенный администратор мог бы отобрать
  // сервис у хозяина. Пусто — владельца нет, и назначать администраторов
  // некому.
  ownerUsername: process.env.OWNER_USERNAME || '',

  /**
   * Одноразовый ключ, которым владелец занимает свой ник.
   *
   * Без него ник владельца был бы обычным свободным ником: кто первым
   * зарегистрировался бы под ним, тот и получил бы всю экосистему. Это
   * не рассуждение — так и было, и проверка это показала.
   *
   * Ключ нужен ровно один раз: как только профиль с этим ником заведён,
   * занять его второй раз нельзя никаким ключом. После первого входа
   * строку из окружения можно убрать.
   *
   * Пусто — ник владельца не занять вовсе. Это безопасное умолчание:
   * сервис без владельца работает, сервис с чужим владельцем — нет.
   */
  ownerClaimToken: process.env.OWNER_CLAIM_TOKEN || '',

  // Отдельный ключ для шифрования секретов двухэтапной защиты.
  // Если не задан, выводится из jwtSecret — см. предупреждение в crypto.mjs.
  encryptionKey: process.env.ENCRYPTION_KEY || '',

  // Доставка кодов. 'log' пишет код в журнал сервера и никуда не шлёт —
  // годится для отладки, в бою нужен настоящий провайдер.
  smsMode:   process.env.SMS_MODE   || 'log',
  smsApiId:  process.env.SMS_API_ID || '',
  smsFrom:   process.env.SMS_FROM   || '',
  // TextBee: какой телефон-шлюз использовать. Пусто — тот, что выходил
  // на связь последним.
  smsDeviceId: process.env.SMS_DEVICE_ID || '',

  // otpmock — тестовый ящик SMS (https://otpmock.com). Работает ТОЛЬКО если задан OTPMOCK_URL;
  // задавать его можно лишь в тестовом/CI/staging-окружении. В боевом он пуст, SMS идут настоящим провайдером.
  otpmockUrl:         (process.env.OTPMOCK_URL || '').replace(/\/+$/, ''),
  otpmockApiKey:      process.env.OTPMOCK_API_KEY || '',
  smsWebhookUrl:      process.env.SMS_WEBHOOK_URL      || '',
  smsWebhookToken:    process.env.SMS_WEBHOOK_TOKEN    || '',

  emailMode:          process.env.EMAIL_MODE           || 'log',
  emailFrom:          process.env.EMAIL_FROM           || '',
  emailWebhookUrl:    process.env.EMAIL_WEBHOOK_URL    || '',
  emailWebhookToken:  process.env.EMAIL_WEBHOOK_TOKEN  || '',

  // Обычная почта хостинга: адрес сервера, порт и учётные данные ящика.
  smtpHost:           process.env.SMTP_HOST            || '',
  smtpPort:    Number(process.env.SMTP_PORT            || 465),
  smtpUser:           process.env.SMTP_USER            || '',
  smtpPass:           process.env.SMTP_PASS            || '',
  // true — сразу TLS (обычно порт 465), false — STARTTLS (587).
  smtpSecure:        (process.env.SMTP_SECURE ?? 'true') !== 'false',

  resendApiKey:       process.env.RESEND_API_KEY       || '',

  // Разрешает режим 'log' в бою. Без него коды в журнал не пишутся:
  // тот, кто читает логи, входил бы под любым аккаунтом.
  allowLogCodes:      process.env.ALLOW_LOG_CODES === '1',

  // Секреты вебхуков перевозчиков Sky Market. Каждый перевозчик
  // подписывает своё уведомление своим секретом; пустой секрет означает
  // «этот перевозчик не подключён», и его вебхук не принимается вовсе —
  // иначе уведомление о доставке мог бы прислать кто угодно.
  marketWebhookSecrets: {
    cdek:        process.env.MARKET_WEBHOOK_CDEK        || '',
    fivepost:    process.env.MARKET_WEBHOOK_FIVEPOST    || '',
    russianpost: process.env.MARKET_WEBHOOK_RUSSIANPOST || '',
  },

  // Ключи закрытой беты: «ключ:подпись» через запятую. Пустая строка —
  // калитки нет, сайт открыт всем.
  betaKeys: (process.env.BETA_KEYS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // Сколько живёт разрешение, выданное за верный ключ (30 дней).
  betaTtlSec: Number(process.env.BETA_TTL_SEC || 60 * 60 * 24 * 30),

  /**
   * Откуда разрешено открывать WebSocket.
   *
   * Рукопожатие сокета не подчиняется правилам обмена между сайтами:
   * без этой проверки чужая страница открывает соединения к хабу из
   * браузера посетителя. Пусто — проверки нет (локальная отладка).
   */
  publicOrigin: process.env.DOMAIN ? `https://${process.env.DOMAIN}` : '',
  extraOrigins: (process.env.EXTRA_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // Единственный адрес, на который разрешено увести посетителя с
  // одноразовым токеном входа (server/kutrentmarket.mjs, issueSsoToken/
  // /sso/start) — иначе «куда редиректить» решал бы запрос, а не сервер.
  marketOrigin: process.env.MARKET_DOMAIN ? `https://${process.env.MARKET_DOMAIN}` : '',

  /**
   * Белый список узлов, куда Sky TV вообще имеет право ходить за
   * эфиром и телепрограммой.
   *
   * Это не «дополнительная проверка», а условие существования: пустой
   * список означает, что сервер не пойдёт никуда. Подключить источник
   * нельзя, пока его узел не назван здесь явно — то есть пока владелец
   * не принял решение, что этому вещателю мы доверяем.
   *
   * Запись «example.com» разрешает и сам узел, и его поддомены:
   * сети доставки обычно раскиданы по «edge1.example.com». Записать
   * сюда «*», внутренний адрес или что-то похожее на них нельзя —
   * такие записи отбрасываются при чтении.
   */
  tvAllowedHosts: (process.env.TV_ALLOWED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
    .filter((s) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s))
    .filter((s) => !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(s)),

  /**
   * Языковая модель для пересказа выпусков подкастов.
   *
   * Ключ живёт только здесь, в окружении сервера, и наружу не выходит
   * ни разу: в браузер уходит уже готовый пересказ. Модель и адрес
   * тоже задаёт владелец сервера, а не клиент, — иначе присланным
   * полем можно было бы увести запрос с нашим ключом куда угодно.
   *
   * Пусто — пересказа нет. Это честное «не настроено», а не отказ:
   * ручка так и отвечает, вместо того чтобы показать выдуманный текст.
   */
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
  // Адрес без хвоста /v1: путь добавляется в ai.mjs (так же, как у STT/TTS).
  aiBaseUrl: (process.env.AI_BASE_URL || 'https://api.openai.com').replace(/\/+$/, '').replace(/\/v1$/, ''),
  // 'responses' — /v1/responses (OpenAI), 'chat' — /v1/chat/completions
  // (почти все посредники и совместимые шлюзы, в том числе для Claude).
  /* Пуши при закрытом приложении. Web Push (сайт, ПК, PWA) — ключи VAPID
     (npm run push:keys); Android — Firebase Cloud Messaging (сервисный
     аккаунт). Без ключей пуши тихо выключены, остальное работает. */
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@localhost',
  fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT_JSON ?? '',
  // Пусто: api.anthropic.com → родной формат Claude (/v1/messages), иначе /v1/responses. Явно: responses | chat | anthropic.
  aiApiStyle: (() => {
    const v = String(process.env.AI_API_STYLE ?? '').trim().toLowerCase();
    if (v === 'chat' || v === 'anthropic' || v === 'responses') return v;
    return /(^|\.)anthropic\.com(\/|$)/i.test(String(process.env.AI_BASE_URL ?? '').replace(/^https?:\/\//i, '')) ? 'anthropic' : 'responses';
  })(),

  // Расшифровка речи — отдельная работа и отдельный поставщик:
  // языковая модель этого не умеет. Ожидается обычная ручка
  // /v1/audio/transcriptions. Пока ключ не задан, расшифровки нет, и
  // сервер так и отвечает — выдумывать текст вместо неё нельзя.
  sttApiKey:  process.env.STT_API_KEY  || '',
  sttModel:   process.env.STT_MODEL    || 'whisper-1',
  // Адрес без хвоста /v1: путь добавляется в ai.mjs (как и для AI_BASE_URL).
  sttBaseUrl: (process.env.STT_BASE_URL || '').replace(/\/+$/, '').replace(/\/v1$/, ''),

  // Голосовой ответ (текст → речь) — свой поставщик, отдельный и от
  // языковой модели, и от расшифровки. У многих поставщиков это тот же
  // адрес и ключ, что и у расшифровки, поэтому по умолчанию берём их же,
  // если TTS_* не заданы отдельно. Ожидается обычная ручка
  // /v1/audio/speech (формат OpenAI). Пока ключ не задан — ответа нет.
  // TTS_DISABLED=1 — озвучки на сервере нет вовсе (ответ читает голос устройства),
  // даже если задан STT: у некоторых поставщиков (Groq) распознавание есть,
  // а озвучки под модель по умолчанию нет.
  ttsApiKey:  process.env.TTS_DISABLED === '1' ? '' : (process.env.TTS_API_KEY  || process.env.STT_API_KEY || ''),
  ttsModel:   process.env.TTS_MODEL    || 'tts-1',
  ttsBaseUrl: (process.env.TTS_BASE_URL || process.env.STT_BASE_URL || '').replace(/\/+$/, '').replace(/\/v1$/, ''),
  ttsVoice:   process.env.TTS_VOICE    || 'alloy',

  /**
   * Google Карты.
   *
   * Ключ один, и он серверный. Им подписываются запросы, которые делает
   * сам сервер: превращение адреса в координаты и картинка карты. В
   * браузер он не уходит ни разу.
   *
   * Живой карты Google, которую тянут перетаскиванием, здесь нет
   * сознательно. Её библиотека грузится в браузере, а политика
   * безопасности приложения разрешает скрипты только со своего адреса —
   * пустить туда чужой домен значит ослабить её для всей страницы, где
   * лежат переписка и кошелёк. Карта поэтому приходит картинкой от
   * нашего же сервера, а двигают и приближают её кнопками: сервер
   * присылает следующий кадр.
   *
   * Ограничить ключ в консоли Google следует по адресу нашего сервера.
   * Пусто — карт нет, и клиент так и пишет: «карта не настроена».
   * Рисовать вместо карты выдуманные точки нельзя — по ним поедут.
   */
  mapsKey: process.env.GOOGLE_MAPS_KEY || '',
  /* Яндекс Карты — второй поставщик (картинка карты и разбор адресов), как и Google, только на сервере: ключ в браузер не уходит.
     YANDEX_MAPS_KEY — «Static API», YANDEX_GEOCODER_KEY — «HTTP Геокодер» (если пусто, берётся первый). Какой поставщик
     рисует карту, решает место: РФ и соседи — Яндекс, остальное — Google; человек может выбрать сам (см. server/maps.mjs). */
  yandexMapsKey: process.env.YANDEX_MAPS_KEY || '',
  yandexGeocoderKey: process.env.YANDEX_GEOCODER_KEY || process.env.YANDEX_MAPS_KEY || '',
  yandexStaticBase: process.env.YANDEX_STATIC_BASE_URL || 'https://static-maps.yandex.ru',
  yandexGeocodeBase: process.env.YANDEX_GEOCODE_BASE_URL || 'https://geocode-maps.yandex.ru',

  // Отслеживание посылок (server/trackingproviders.mjs). Каждый источник
  // включается своими ключами; без них ручка отдаёт только ссылку на
  // страницу самой службы.
  tracking: {
    // СДЭК: https://api.cdek.ru/v2 (бой) или https://api.edu.cdek.ru/v2 (тест)
    cdekBase:             process.env.CDEK_API_BASE            || '',
    cdekClientId:         process.env.CDEK_CLIENT_ID           || '',
    cdekClientSecret:     process.env.CDEK_CLIENT_SECRET       || '',
    // Почта России — «Единый доступ» (трекинг), логин и пароль API
    russianPostLogin:     process.env.RUSSIANPOST_API_LOGIN    || '',
    russianPostPassword:  process.env.RUSSIANPOST_API_PASSWORD || '',
    // 17TRACK — зарубежные службы
    track17Key:           process.env.TRACK17_API_KEY          || '',
  },
  mapsBaseUrl: process.env.GOOGLE_MAPS_BASE_URL || 'https://maps.googleapis.com',
};

/**
 * В бою нельзя работать на секретах-заглушках. Подпись токенов тогда
 * известна каждому, кто читал исходники: достаточно выписать себе токен
 * с любым профилем (в том числе владельца). docker-compose и так не
 * запускается без JWT_SECRET, но `node server.mjs` напрямую молча брал
 * 'change_me'. Короткие, но заданные секреты не отвергаем — это не повод
 * ронять работающий сервис, только предупреждение в журнал.
 */
if (config.nodeEnv === 'production') {
  // Демо-платежи рисуют деньги одним запросом (пополнение, возврат, баллы). В бою их быть не может,
  // даже если PAYMENTS_MODE=demo попал в окружение по ошибке: молча закрываем и говорим об этом.
  if (config.paymentsMode === 'demo') {
    console.error('[config] PAYMENTS_MODE=demo в production игнорируется: демо-платежи создают деньги из ничего. '
      + 'Подключите настоящий приём платежей (SkyKassa) или оставьте disabled.');
    config.paymentsMode = 'disabled';
  }
  const placeholders = new Set(['change_me', 'change_me_too', 'changeme', 'secret', 'password', '']);
  if (placeholders.has(config.jwtSecret) || placeholders.has(config.refreshSecret)) {
    console.error('[config] JWT_SECRET / REFRESH_TOKEN_SECRET не заданы (или остались заглушкой). '
      + 'В production запуск запрещён: задайте длинные случайные значения (openssl rand -base64 48).');
    process.exit(1);
  }
  if (config.jwtSecret === config.refreshSecret) {
    console.error('[config] JWT_SECRET и REFRESH_TOKEN_SECRET совпадают: утечка одного раскрывает оба типа токенов.');
  }
  if (config.jwtSecret.length < 32 || config.refreshSecret.length < 32) {
    console.error('[config] секреты короче 32 символов — смените их (scripts/rotate-secrets.sh).');
  }
}
