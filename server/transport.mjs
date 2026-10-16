/**
 * Защита канала передачи (модуль «Шифрование передачи данных»).
 * TLS завершается на nginx; API слушает внутри сети. Если запрос до API всё же дошёл по открытому http (проброшенный порт,
 * ошибка конфигурации) — в боевом режиме API-запросы с токенами и паролями не принимаются.
 */
import { config } from './config.mjs';

/** true — это API-запрос, пришедший по открытому http (по заголовку nginx X-Forwarded-Proto), и принимать его нельзя. */
export const insecureApiRequest = (req, url, env = config.nodeEnv) =>
  env === 'production' && String(url).startsWith('/api/')
  && String(req.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase() === 'http';
