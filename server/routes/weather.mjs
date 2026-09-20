/**
 * Погода и курсы валют — реальные виджеты в Bloom (см. server/weather.mjs,
 * server/currency.mjs). Оба источника бесплатны и без ключа, поэтому
 * настраивать здесь нечего: ручка либо отдаёт то, что реально ответил
 * сторонний сервис (с кэшем), либо честно 404 — без выдуманного значения.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getWeather } from './../weather.mjs';
import { getRates } from './../currency.mjs';

const PER_MIN = 30;

export const weatherRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/weather') && !url.startsWith('/api/currency')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && url.startsWith('/api/weather')) {
    if (!rateLimit(`weather:${me}`, PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const params = new URL(req.url, 'http://x').searchParams;
    const lat = Number(params.get('lat'));
    const lon = Number(params.get('lon'));
    const weather = await getWeather(lat, lon);
    if (!weather) return json(res, 404, { error: 'not_found' });
    return json(res, 200, weather);
  }

  if (req.method === 'GET' && url.startsWith('/api/currency')) {
    if (!rateLimit(`currency:${me}`, PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { rates: await getRates() });
  }

  return false;
};
