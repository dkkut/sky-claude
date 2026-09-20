/**
 * Погода на стороне сервера.
 *
 * Виджет в Bloom раньше показывал одну и ту же выдуманную строку
 * («+18°, Sky City») всем и всегда. Теперь координаты приходят от
 * браузера пользователя (Geolocation API — он же настоящая точка, а не
 * выдуманный город), а сервер спрашивает у Open-Meteo (бесплатно, без
 * ключа) и кэширует ответ в БД: один и тот же квадрат карты не должен
 * спрашиваться у стороннего сервиса при каждом открытии виджета каждым
 * человеком поблизости.
 *
 * Про SSRF: адрес собирается целиком из своих кусков (постоянный хост,
 * постоянный путь), присланные клиентом lat/lon проверяются как числа
 * в разумном диапазоне и уходят только в значения параметров запроса.
 */
import { query } from './db.mjs';

const CACHE_MIN = 30;

const round1 = (n) => Math.round(Number(n) * 10) / 10;

export const isRealPoint = (lat, lon) => {
  const a = Number(lat);
  const b = Number(lon);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
};

/* Коды погоды Open-Meteo (WMO) — сводим к укрупнённому виду для иконки
 * на клиенте, а не тащим всю таблицу WMO на фронт. */
const kindOf = (code) => {
  const c = Number(code);
  if (c === 0) return 'clear';
  if (c === 1 || c === 2 || c === 3) return 'cloudy';
  if (c === 45 || c === 48) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(c)) return 'snow';
  if ([95, 96, 99].includes(c)) return 'storm';
  return 'cloudy';
};

const fetchCity = async (lat, lon) => {
  try {
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lon), localityLanguage: 'ru',
    });
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.city || data?.locality || data?.principalSubdivision || null;
  } catch {
    return null;
  }
};

/**
 * Погода в точке. Возвращает null, если точка не похожа на реальную
 * или сторонний сервис не ответил — честное «сейчас не знаем», а не
 * подставленная выдуманная температура.
 */
export const getWeather = async (lat, lon) => {
  if (!isRealPoint(lat, lon)) return null;
  const latR = round1(lat);
  const lonR = round1(lon);

  const { rows: cached } = await query(
    `SELECT city, temp_c, code FROM weather_cache
      WHERE lat_r = $1 AND lon_r = $2 AND created_at > now() - ($3::int * interval '1 minute')`,
    [latR, lonR, CACHE_MIN],
  );
  if (cached[0]) {
    return { city: cached[0].city, tempC: cached[0].temp_c, kind: kindOf(cached[0].code) };
  }

  let tempC;
  let code;
  try {
    const params = new URLSearchParams({
      latitude: String(latR), longitude: String(lonR), current_weather: 'true',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    tempC = Number(data?.current_weather?.temperature);
    code = Number(data?.current_weather?.weathercode);
    if (!Number.isFinite(tempC) || !Number.isFinite(code)) return null;
  } catch {
    /* Сеть подвела — не запоминаем: через минуту ответ может быть. */
    return null;
  }

  const city = await fetchCity(latR, lonR);

  await query(
    `INSERT INTO weather_cache (lat_r, lon_r, city, temp_c, code)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (lat_r, lon_r) DO UPDATE
       SET city = EXCLUDED.city, temp_c = EXCLUDED.temp_c, code = EXCLUDED.code, created_at = now()`,
    [latR, lonR, city, tempC, code],
  );

  return { city, tempC, kind: kindOf(code) };
};
