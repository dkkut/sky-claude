/**
 * Секреты из файлов: для каждой переменной X, у которой не задано значение, но задана X_FILE=/путь,
 * значение читается из файла (Docker/Compose secrets: /run/secrets/…). Так секрет не лежит в окружении контейнера
 * (`docker inspect`, /proc/<pid>/environ) — только в файле с правами 400.
 *
 * Только для известных секретов (ALLOWED): служебные переменные вроде SSL_CERT_FILE не трогаем — иначе чужой файл превратился бы в переменную окружения.
 * Подключается первой строкой в server.mjs и config.mjs. Явно заданное значение X не перетирается.
 * Файл, который не читается, — остановка с понятным сообщением (тихо запуститься без секрета нельзя).
 */
import fs from 'node:fs';

export const ALLOWED = [
  'JWT_SECRET', 'REFRESH_TOKEN_SECRET', 'ENCRYPTION_KEY', 'AI_API_KEY', 'STT_API_KEY', 'TTS_API_KEY',
  'STORAGE_S3_ACCESS_KEY', 'STORAGE_S3_SECRET_KEY', 'STORAGE_BACKUP_S3_ACCESS_KEY', 'STORAGE_BACKUP_S3_SECRET_KEY',
  'SMTP_PASS', 'RESEND_API_KEY', 'VAPID_PRIVATE_KEY', 'FCM_SERVICE_ACCOUNT_JSON', 'SSH_GATE_SECRET', 'OWNER_CLAIM_TOKEN',
  'SKYKASSA_PARTNERS_JSON', 'APP_DATABASE_URL', 'DATABASE_URL', 'REDIS_URL', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD',
];
const allowed = (name) => ALLOWED.includes(name) || /^STORAGE_KEK_[A-Za-z0-9_]+$/.test(name);

export const loadEnvFiles = (env = process.env, read = (p) => fs.readFileSync(p, 'utf8')) => {
  const loaded = [];
  for (const [k, path] of Object.entries(env)) {
    if (!k.endsWith('_FILE') || !path) continue;
    const name = k.slice(0, -5);
    if (!name || !allowed(name) || env[name]) continue;
    let text;
    try { text = read(path); } catch (e) { throw new Error(`[env] ${k}: не удалось прочитать ${path} (${e.code || e.message})`); }
    const value = String(text).replace(/\r?\n$/, '');   // убираем один перевод строки в конце; пробелы внутри — часть секрета
    if (!value) throw new Error(`[env] ${k}: файл ${path} пустой`);
    env[name] = value;
    loaded.push(name);
  }
  return loaded;
};

loadEnvFiles();
