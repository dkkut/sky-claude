/**
 * Разбор и сборка Cookie без внешних зависимостей.
 *
 * Refresh-токен уезжает в куку с HttpOnly: так до него не дотянется
 * никакой скрипт на странице, и украсть его через XSS уже нельзя.
 * Access-токен, наоборот, отдаётся в теле ответа и живёт в памяти
 * вкладки — он короткоживущий и в хранилище не попадает.
 */

import { currentSession } from './reqctx.mjs';

export const REFRESH_COOKIE = 'sky_rt';

/**
 * До трёх Sky ID на одном устройстве: у каждого свой «слот» и своя HttpOnly-кука (sky_rt, sky_rt2, sky_rt3).
 * Слот выбирает клиент заголовком X-Sky-Slot; любое другое значение приводится к первому, поэтому больше трёх кук не бывает.
 */
export const slotOf = (v) => (Number(v) === 2 ? 2 : Number(v) === 3 ? 3 : 1);
export const refreshCookieName = (slot = currentSession()?.slot ?? 1) => (slot === 2 || slot === 3 ? `${REFRESH_COOKIE}${slot}` : REFRESH_COOKIE);

/** Пропуск в закрытую бету. В отличие от refresh уходит на весь сайт. */
export const BETA_COOKIE = 'sky_beta';

/** Путь намеренно узкий: кука уходит только на эндпоинты авторизации. */
const COOKIE_PATH = '/api/auth';

export const parseCookies = (header) => {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // Значение с битым процентным кодированием просто пропускаем.
    }
  }
  return out;
};

export const buildRefreshCookie = (token, maxAgeSec) => [
  `${refreshCookieName()}=${encodeURIComponent(token)}`,
  `Path=${COOKIE_PATH}`,
  `Max-Age=${maxAgeSec}`,
  'HttpOnly',
  // Secure: браузер не отправит куку по обычному HTTP. Продакшн работает
  // только по HTTPS, а localhost браузеры считают безопасным контекстом.
  'Secure',
  // Strict отсекает межсайтовые запросы — основная защита от CSRF,
  // потому что обновление сессии идёт именно по этой куке.
  'SameSite=Strict',
].join('; ');

export const clearRefreshCookie = () => [
  `${refreshCookieName()}=`,
  `Path=${COOKIE_PATH}`,
  'Max-Age=0',
  'HttpOnly',
  'Secure',
  'SameSite=Strict',
].join('; ');

/**
 * Пропуск в бету. Путь широкий: калитка стоит перед всем API, а не
 * только перед входом. Остальное — как у refresh: скриптам не видна,
 * только по HTTPS, межсайтовые запросы её не увозят.
 */
export const buildBetaCookie = (token, maxAgeSec) => [
  `${BETA_COOKIE}=${encodeURIComponent(token)}`,
  'Path=/',
  `Max-Age=${maxAgeSec}`,
  'HttpOnly',
  'Secure',
  'SameSite=Strict',
].join('; ');
