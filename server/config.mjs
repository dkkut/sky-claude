export const config = {
  apiPort: Number(process.env.API_PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change_me',
  refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'change_me_too',
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  accessTtlSec: Number(process.env.ACCESS_TTL_SEC || 900),
  refreshTtlSec: Number(process.env.REFRESH_TTL_SEC || 60 * 60 * 24 * 30),
  // 'demo' разрешает пополнение кошелька без настоящего платежа.
  // Любое другое значение (в том числе отсутствие) закрывает эту ручку:
  // иначе баланс можно было бы нарисовать себе одним запросом.
  paymentsMode: process.env.PAYMENTS_MODE || 'disabled',

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
};
