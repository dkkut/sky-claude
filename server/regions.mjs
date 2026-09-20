/**
 * Регионы — общий список кодов и доступ к уже сохранённому региону
 * профиля.
 *
 * Смена региона у Sky уже есть (src/region: RegionPicker, store.ts,
 * COUNTRIES) — этот файл её не переделывает и не заводит второй выбор.
 * До сих пор код региона, который человек там выбирал, жил только в
 * localStorage браузера и на сервер вообще не попадал — прочитать его
 * для проверки на бэкенде было неоткуда. Единственное, что здесь
 * добавлено: тот же код сохраняется в profiles.region_code (см.
 * миграцию 070) и синхронизируется с существующим клиентским стором,
 * плюс список кодов, чтобы сервер не доверял произвольной строке.
 *
 * Коды — ровно те, что в src/region/types.ts (COUNTRIES) плюс 'WW'
 * («весь мир»). Значение не задано или 'WW' — ограничений по региону
 * для этого человека нет, это и есть смысл «Весь мир» в самом пикере.
 */
import { query } from './db.mjs';

export const REGION_CODES = new Set([
  'RU', 'KZ', 'BY', 'UA', 'UZ', 'AM', 'AZ', 'GE', 'KG', 'TJ', 'MD',
  'US', 'GB', 'DE', 'FR', 'ES', 'IT', 'PT', 'NL', 'PL', 'TR',
  'AE', 'SA', 'IL', 'CN', 'JP', 'KR', 'IN', 'ID', 'TH', 'VN',
  'BR', 'MX', 'AR', 'CA', 'AU', 'EG', 'ZA', 'FI', 'SE', 'NO', 'CH',
  'WW',
]);

export const isValidRegion = (code) => typeof code === 'string' && REGION_CODES.has(code);

/**
 * Регион этого человека прямо сейчас, каким его установила
 * существующая система смены региона. Никогда не берётся из тела
 * запроса — только из профиля в базе, привязанного к серверной сессии.
 * 'WW' и незаполненное значение равнозначны null: без ограничения.
 */
export const regionOf = async (userId) => {
  if (!userId) return null;
  const { rows } = await query('SELECT region_code FROM profiles WHERE id = $1', [userId]);
  const code = rows[0]?.region_code ?? null;
  return code && code !== 'WW' ? code : null;
};

/** Заблокирован ли контент с таким списком регионов для зрителя с этим регионом. */
export const isBlockedForRegion = (blockedRegions, viewerRegion) => {
  if (!viewerRegion) return false;
  if (!blockedRegions || blockedRegions.length === 0) return false;
  return blockedRegions.includes(viewerRegion);
};

/** Список кодов для валидации на запись (админка: блокировка регионов, аудитория рассылки). */
export const cleanRegionList = (list) => {
  if (!Array.isArray(list)) return [];
  const out = [...new Set(list.map((c) => String(c ?? '').toUpperCase().trim()))]
    .filter((c) => isValidRegion(c) && c !== 'WW');
  return out.slice(0, REGION_CODES.size);
};
