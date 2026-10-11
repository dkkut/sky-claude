/**
 * Sky Заправки — ближайшие АЗС и загруженность.
 *
 * Станции приходят от подключённого поставщика: по умолчанию OpenStreetMap (Overpass, открытые данные, ключ не нужен),
 * либо Google Places (при FUEL_PROVIDER=google и серверном ключе карт). Показывается только то, что дал поставщик:
 * название, адрес, часы, виды топлива, услуги. Цен и очередей у открытых данных НЕТ — их не выдумываем.
 * Яндекс Заправки публичного API очередей/цен не предоставляет, закрытые интерфейсы не используются.
 *
 * Загруженность — только пользовательские сообщения (low/medium/high), и они отделены от данных поставщика:
 * вес сообщения падает вдвое каждые 30 минут, показываются сообщения не старше 3 часов, число сообщений и время последнего
 * видны. От накрутки: одно сообщение на станцию раз в 15 минут и не больше 10 в час на человека; точного времени ожидания не даём.
 */
import { query } from './db.mjs';
import { config } from './config.mjs';
import { newId, clean, haversineKm, goLog } from './gocore.mjs';
import { isRealPoint } from './maps.mjs';
import { rateLimitPerHour } from './security.mjs';

const provider = () => String(process.env.FUEL_PROVIDER || 'osm').toLowerCase();
const overpass = () => process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const AREA_TTL_MS = 10 * 60_000;
const areas = new Map();   // ключ квадрата → когда запрашивали

export const fuelStatus = () => ({
  provider: provider(), configured: provider() === 'osm' || (provider() === 'google' && Boolean(config.mapsKey)),
  hasPrices: false, hasQueues: false,
  note: 'Станции — данные поставщика; загруженность — только оценки пользователей. Цен и официальных очередей нет.',
});

const FUEL_TAGS = { 'fuel:diesel': 'ДТ', 'fuel:octane_92': 'АИ-92', 'fuel:octane_95': 'АИ-95', 'fuel:octane_98': 'АИ-98', 'fuel:octane_100': 'АИ-100', 'fuel:lpg': 'Газ (пропан)', 'fuel:cng': 'Метан', 'fuel:electricity': 'Зарядка' };
const SERVICE_TAGS = { shop: 'Магазин', car_wash: 'Автомойка', toilets: 'Туалет', compressed_air: 'Подкачка шин', atm: 'Банкомат', cafe: 'Кафе' };

const fromOsm = (el) => {
  const lat = el.lat ?? el.center?.lat; const lng = el.lon ?? el.center?.lon;
  if (!isRealPoint(lat, lng)) return null;
  const t = el.tags ?? {};
  const addr = [t['addr:city'], t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
  const fuels = Object.entries(FUEL_TAGS).filter(([k]) => t[k] === 'yes').map(([, v]) => v);
  const services = Object.entries(SERVICE_TAGS).filter(([k]) => t[k] === 'yes' || (k === 'shop' && t.shop)).map(([, v]) => v);
  return { key: `osm:${el.type}${el.id}`, provider: 'osm', name: clean(t.name || t.brand || t.operator || 'АЗС', 100), brand: clean(t.brand ?? '', 60), address: clean(addr, 200),
    lat: Number(lat), lng: Number(lng), info: { hours: t.opening_hours ? clean(t.opening_hours, 120) : null, fuels, services, always: t.opening_hours === '24/7' } };
};

const fromGoogle = (p) => {
  const lat = p.geometry?.location?.lat; const lng = p.geometry?.location?.lng;
  if (!isRealPoint(lat, lng)) return null;
  return { key: `google:${p.place_id}`, provider: 'google', name: clean(p.name ?? 'АЗС', 100), brand: '', address: clean(p.vicinity ?? '', 200), lat: Number(lat), lng: Number(lng),
    info: { hours: null, openNow: p.opening_hours?.open_now ?? null, fuels: [], services: [], always: false } };
};

const fetchProvider = async (lat, lng, radiusM) => {
  if (provider() === 'google') {
    if (!config.mapsKey) return { error: 'provider_not_configured' };
    const params = new URLSearchParams({ location: `${lat},${lng}`, radius: String(radiusM), type: 'gas_station', language: 'ru', key: config.mapsKey });
    try {
      const res = await fetch(`${config.mapsBaseUrl}/maps/api/place/nearbysearch/json?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { error: 'provider_error' };
      const data = await res.json();
      if (data.status === 'REQUEST_DENIED') return { error: 'provider_denied' };
      return { stations: (data.results ?? []).map(fromGoogle).filter(Boolean) };
    } catch { return { error: 'provider_unreachable' }; }
  }
  if (provider() !== 'osm') return { error: 'provider_not_configured' };
  const q = `[out:json][timeout:20];(node(around:${radiusM},${lat},${lng})["amenity"="fuel"];way(around:${radiusM},${lat},${lng})["amenity"="fuel"];);out center tags 80;`;
  try {
    const res = await fetch(overpass(), { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(25_000), headers: { 'User-Agent': 'SkyGO/1.0 (fuel finder)' } });
    if (!res.ok) return { error: 'provider_error' };
    const data = await res.json();
    return { stations: (data.elements ?? []).map(fromOsm).filter(Boolean) };
  } catch { return { error: 'provider_unreachable' }; }
};

const LEVEL_VALUE = { low: 1, medium: 2, high: 3 };
const HALF_LIFE_MIN = 30;
const WINDOW_MIN = 180;

/** Загруженность по сообщениям людей: взвешенное по свежести. Нет свежих сообщений — нет оценки. */
const loadOf = (reports, now = Date.now()) => {
  const fresh = reports.filter((r) => now - r.at.getTime() < WINDOW_MIN * 60_000);
  if (!fresh.length) return { level: null, reports: 0, lastAt: null, source: 'users' };
  let w = 0; let s = 0;
  for (const r of fresh) { const k = 0.5 ** ((now - r.at.getTime()) / 60_000 / HALF_LIFE_MIN); w += k; s += k * LEVEL_VALUE[r.level]; }
  const avg = s / w;
  return { level: avg < 1.67 ? 'low' : avg < 2.34 ? 'medium' : 'high', reports: fresh.length, lastAt: new Date(Math.max(...fresh.map((r) => r.at.getTime()))).toISOString(),
    confidence: Math.min(1, Math.round((w / 3) * 100) / 100), source: 'users' };
};

export const nearby = async (input) => {
  const st = fuelStatus();
  if (!st.configured) return { error: 'provider_not_configured' };
  const lat = Number(input?.lat); const lng = Number(input?.lng);
  if (!isRealPoint(lat, lng)) return { error: 'location_required' };
  const radius = Math.min(10_000, Math.max(500, Math.floor(Number(input?.radiusM) || 4000)));
  const areaKey = `${provider()}:${lat.toFixed(2)}:${lng.toFixed(2)}:${radius}`;
  let providerError = null;
  if ((areas.get(areaKey) ?? 0) < Date.now() - AREA_TTL_MS) {
    const r = await fetchProvider(lat, lng, radius);
    if (r.error) providerError = r.error;
    else {
      areas.set(areaKey, Date.now());
      for (const s of r.stations) {
        await query(
          `INSERT INTO go_fuel_stations (key, provider, name, brand, address, lat, lng, info, fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET name=$3, brand=$4, address=$5, lat=$6, lng=$7, info=$8::jsonb, fetched_at = now()`,
          [s.key, s.provider, s.name, s.brand, s.address, s.lat, s.lng, JSON.stringify(s.info)]);
      }
    }
  }
  const deg = radius / 111_000;
  const { rows } = await query(
    `SELECT * FROM go_fuel_stations WHERE provider = $1 AND lat BETWEEN $2 AND $3 AND lng BETWEEN $4 AND $5 LIMIT 200`,
    [provider(), lat - deg, lat + deg, lng - deg * 1.8, lng + deg * 1.8]);
  if (!rows.length && providerError) return { error: providerError };
  const keys = rows.map((r) => r.key);
  const { rows: reps } = keys.length ? await query(
    `SELECT station_key, level, created_at FROM go_fuel_reports WHERE station_key = ANY($1::text[]) AND created_at > now() - interval '3 hours'`, [keys]) : { rows: [] };
  const by = new Map();
  for (const r of reps) { if (!by.has(r.station_key)) by.set(r.station_key, []); by.get(r.station_key).push({ level: r.level, at: r.created_at }); }
  const fuel = clean(input?.fuel, 20);
  const service = clean(input?.service, 30);
  let list = rows.map((r) => ({
    key: r.key, name: r.name, brand: r.brand, address: r.address, lat: r.lat, lng: r.lng,
    distanceKm: Math.round(haversineKm({ lat, lng }, r) * 100) / 100,
    hours: r.info.hours ?? null, openNow: r.info.openNow ?? null, always: Boolean(r.info.always), fuels: r.info.fuels ?? [], services: r.info.services ?? [],
    providerUpdatedAt: r.fetched_at.toISOString(), source: r.provider, load: loadOf(by.get(r.key) ?? []),
  })).filter((s) => s.distanceKm * 1000 <= radius * 1.05);
  if (fuel) list = list.filter((s) => s.fuels.includes(fuel));
  if (service) list = list.filter((s) => s.services.includes(service));
  if (input?.open === true) list = list.filter((s) => s.always || s.openNow === true);
  const rank = { low: 0, medium: 1, high: 2 };
  if (input?.sort === 'load') list.sort((a, b) => (rank[a.load.level] ?? 1.5) - (rank[b.load.level] ?? 1.5) || a.distanceKm - b.distanceKm);
  else list.sort((a, b) => a.distanceKm - b.distanceKm);
  return { ok: true, stations: list.slice(0, 40), provider: provider(), stale: Boolean(providerError), providerError, notice: st.note };
};

export const report = async (profileId, stationKey, level) => {
  if (!LEVEL_VALUE[level]) return { error: 'bad_level' };
  const { rows } = await query('SELECT key FROM go_fuel_stations WHERE key = $1', [String(stationKey ?? '')]);
  if (!rows[0]) return { error: 'station_not_found' };
  if (!rateLimitPerHour(`gofuel:${profileId}`, 10)) return { error: 'too_many_reports' };
  const { rows: last } = await query(`SELECT 1 FROM go_fuel_reports WHERE station_key = $1 AND profile_id = $2 AND created_at > now() - interval '15 minutes'`, [stationKey, profileId]);
  if (last[0]) return { error: 'report_too_soon' };
  await query('INSERT INTO go_fuel_reports (id, station_key, profile_id, level) VALUES ($1,$2,$3,$4)', [newId('gfr'), stationKey, profileId, level]);
  const { rows: reps } = await query(`SELECT level, created_at FROM go_fuel_reports WHERE station_key = $1 AND created_at > now() - interval '3 hours'`, [stationKey]);
  return { ok: true, load: loadOf(reps.map((r) => ({ level: r.level, at: r.created_at }))) };
};

export const sweepFuel = async () => {
  await query(`DELETE FROM go_fuel_reports WHERE created_at < now() - interval '2 days'`);
  await query(`DELETE FROM go_fuel_stations WHERE fetched_at < now() - interval '30 days'`);
};
