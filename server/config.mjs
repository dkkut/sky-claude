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

  emailMode:          process.env.EMAIL_MODE           || 'log',
  emailWebhookUrl:    process.env.EMAIL_WEBHOOK_URL    || '',
  emailWebhookToken:  process.env.EMAIL_WEBHOOK_TOKEN  || '',

  // Ключи закрытой беты: «ключ:подпись» через запятую. Пустая строка —
  // калитки нет, сайт открыт всем.
  betaKeys: (process.env.BETA_KEYS || '')
    .split(',').map((s) => s.trim()).filter(Boolean),

  // Сколько живёт разрешение, выданное за верный ключ (30 дней).
  betaTtlSec: Number(process.env.BETA_TTL_SEC || 60 * 60 * 24 * 30),
};
