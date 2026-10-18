/**
 * Секреты из файлов: для каждой переменной X, у которой не задано значение, но задана X_FILE=/путь,
 * значение читается из файла (Docker/Compose secrets: /run/secrets/…). Так секрет не лежит в окружении контейнера
 * (`docker inspect`, /proc/<pid>/environ) — только в файле с правами 400.
 *
 * Подключается первой строкой в server.mjs и config.mjs. Явно заданное значение X не перетирается.
 * Файл, который не читается, — остановка с понятным сообщением (тихо запуститься без секрета нельзя).
 */
import fs from 'node:fs';

export const loadEnvFiles = (env = process.env, read = (p) => fs.readFileSync(p, 'utf8')) => {
  const loaded = [];
  for (const [k, path] of Object.entries(env)) {
    if (!k.endsWith('_FILE') || !path) continue;
    const name = k.slice(0, -5);
    if (!name || env[name]) continue;
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
