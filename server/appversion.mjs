/**
 * Минимальная сборка родных приложений (Android/Windows).
 * Новые сборки шлют X-Sky-Build (src/core/version.ts, APP_BUILD); у уже
 * установленных старых заголовка нет. Пока MIN_APP_BUILD > 0, такое приложение
 * получает 503 platform_maintenance с понятным текстом — старый клиент уже умеет
 * показывать причину на экране «Технические работы». Браузер (без X-Sky-Client)
 * не затрагивается. MIN_APP_BUILD=0 — выключено.
 */
let dbMin = 0;
export const setDbMinBuild = (n) => { dbMin = Math.max(0, Number(n) || 0); };
let texts = { ru: '', en: '' };
export const setOutdatedTexts = (ru, en) => { texts = { ru: String(ru || ''), en: String(en || '') }; };
const minBuild = () => Math.max(dbMin, Math.max(0, Number(process.env.MIN_APP_BUILD || 0) || 0));

export const OUTDATED_RU = 'У вас старая версия, обновите через Веб - профиль - настройки - обновить';
export const OUTDATED_EN = 'Your app is out of date. Update via Web: Profile → Settings → Update';

export const isOutdatedApp = (req) => {
  const min = minBuild();
  if (!min) return false;
  if (String(req?.headers?.['x-sky-client'] ?? '').toLowerCase() !== 'app') return false;
  const build = Number(req.headers['x-sky-build'] ?? 0) || 0;
  return build < min;
};

export const outdatedReason = (req) => (String(req?.headers?.['x-sky-lang'] ?? '').toLowerCase() === 'en' ? (texts.en || OUTDATED_EN) : (texts.ru || OUTDATED_RU));
