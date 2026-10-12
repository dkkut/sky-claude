/**
 * Google Карты на стороне сервера.
 *
 * Зачем это здесь, а не в браузере. Раньше карта логистики показывала
 * выдуманные точки: координаты выводились из хэша идентификатора, а
 * движение транспорта было равномерным скольжением между двумя такими
 * же выдуманными точками. Выглядело живо и означало ровно ничего — по
 * такой карте нельзя доехать.
 *
 * Теперь на карте только то, что есть в базе: заданные владельцем
 * координаты склада, настоящая точка курьера, пока он на связи, и адрес
 * заказа, превращённый в координаты Google.
 *
 * Ключ. Он один и он серверный: им подписаны запросы, которые делает
 * сам сервер — адрес в координаты и картинка карты. В браузер он не
 * уходит ни разу, в репозитории не лежит и от клиента не приходит.
 *
 * Живой карты Google, которую тянут мышью, здесь нет сознательно: её
 * библиотека грузится в браузере, а политика безопасности приложения
 * пускает скрипты только со своего адреса. Пустить туда чужой домен
 * значит ослабить её для всей страницы, где лежат переписка и кошелёк.
 * Поэтому карта приходит картинкой, а двигают её кнопками.
 *
 * Про SSRF. Адрес запроса собирается здесь целиком из своих кусков:
 * основа — из настроек сервера, путь — постоянная строка, значения
 * уходят через URLSearchParams. Присланное клиентом попадает только в
 * значения параметров и никогда — в хост, путь или схему.
 */
import { query } from './db.mjs';
import { config } from './config.mjs';

const MAX_ADDRESS = 300;
/** Сколько держать разобранный адрес. Дома не переезжают. */
const CACHE_DAYS = 90;

export const mapsConfigured = () => Boolean(config.mapsKey);

/**
 * Что знать клиенту о картах.
 *
 * Ключа здесь нет и быть не может: карта приходит картинкой от нашего
 * же сервера, и ключ нужен только ему.
 */
export const mapsSettings = () => ({ enabled: Boolean(config.mapsKey) });

/* Управляющие символы в адресе — это попытка разорвать строку или
   спрятать в ней лишнее. Образец собирается из кодов, чтобы сам файл
   этих символов не содержал. */
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g');

const clean = (s, max) => String(s ?? '').replace(CONTROL, '').trim().slice(0, max);

/** Похоже ли это на точку на Земле. Ноль-ноль — это «не задано». */
export const isRealPoint = (lat, lng) => {
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return false;
  return Math.abs(a) > 0.0001 || Math.abs(b) > 0.0001;
};

/* ─── Адрес в координаты ───────────────────────────────────────────── */

/**
 * Превратить адрес в точку.
 *
 * Ответ Google кладётся в свою таблицу: один и тот же адрес спрашивают
 * десятки раз — при каждом открытии карты заказа, — а каждый такой
 * вопрос это и деньги, и ещё один повод отправить чужой адрес наружу.
 *
 * Возвращает null, когда ключа нет или Google адреса не знает. Это
 * честное «не нашлось»: подставлять вместо ненайденного адреса центр
 * города нельзя — по такой точке поедут.
 */
export const geocode = async (rawAddress) => {
  const address = clean(rawAddress, MAX_ADDRESS);
  if (address.length < 4) return null;

  const { rows: cached } = await query(
    `SELECT lat, lng, found FROM maps_geocode
      WHERE address = $1 AND created_at > now() - ($2::int * interval '1 day')`,
    [address, CACHE_DAYS]);
  if (cached[0]) {
    return cached[0].found
      ? { lat: Number(cached[0].lat), lng: Number(cached[0].lng), cached: true }
      : null;
  }

  if (!config.mapsKey) return null;

  /* Адрес человека уходит третьей стороне. Это неизбежно для карт, но
     уходит именно адрес и ничего сверх: ни кто спросил, ни по какому
     заказу. */
  const params = new URLSearchParams({ address, key: config.mapsKey, language: 'ru' });
  const url = `${config.mapsBaseUrl}/maps/api/geocode/json?${params}`;

  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    /* Сеть подвела — не запоминаем: через минуту ответ может быть. */
    return null;
  }

  const spot = data?.results?.[0]?.geometry?.location;
  const found = data?.status === 'OK' && Number.isFinite(Number(spot?.lat));
  await remember(address, found ? Number(spot.lat) : null, found ? Number(spot.lng) : null, found);
  return found ? { lat: Number(spot.lat), lng: Number(spot.lng), cached: false } : null;
};

const remember = async (address, lat, lng, found) => {
  await query(
    `INSERT INTO maps_geocode (address, lat, lng, found)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (address) DO UPDATE
       SET lat = EXCLUDED.lat, lng = EXCLUDED.lng,
           found = EXCLUDED.found, created_at = now()`,
    [address, lat, lng, found]);
};

/* ─── Картинка карты ───────────────────────────────────────────────── */

const MARKER_COLORS = {
  warehouse: '0x8b5cf6',
  courier: '0x3b82f6',
  pickup: '0x22c55e',
  target: '0xef4444',
  default: '0x6b7280',
};

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
};

/** Шесть знаков — это около десяти сантиметров. Больше незачем. */
const round = (n) => Number(n).toFixed(6);

/**
 * Собрать адрес статичной карты.
 *
 * Каждое значение проверяется и приводится к числу здесь: строка,
 * попавшая в параметры как есть, позволила бы дописать к запросу чужие
 * параметры Google нашим же ключом.
 *
 * Возвращает null без ключа — и клиент покажет «карта не настроена».
 */
export const staticMapUrl = ({ points = [], center, width = 640, height = 360, zoom, pathEnc } = {}) => {
  if (!config.mapsKey) return null;

  const params = new URLSearchParams();
  params.set('size', `${clampInt(width, 80, 1280)}x${clampInt(height, 80, 1280)}`);
  params.set('scale', '2');
  params.set('language', 'ru');
  params.set('maptype', 'roadmap');

  const good = [];
  for (const p of (Array.isArray(points) ? points : []).slice(0, 40)) {
    if (!isRealPoint(p?.lat, p?.lng)) continue;
    good.push({
      lat: Number(p.lat),
      lng: Number(p.lng),
      kind: MARKER_COLORS[p?.kind] ? p.kind : 'default',
      // Подпись метки — один символ A–Z/0–9 (порядковый номер остановки).
      label: /^[A-Z0-9]$/.test(String(p?.label ?? '')) ? String(p.label) : '',
    });
  }
  /* Линия маршрута — закодированная ломаная Google; проверяется и по алфавиту, и по длине:
     иначе в адрес картинки с нашим ключом можно было бы дописать чужие параметры. */
  if (typeof pathEnc === 'string' && /^[\x3f-\x7e]{2,6000}$/.test(pathEnc)) {
    params.append('path', `weight:5|color:0x3b82f6cc|enc:${pathEnc}`);
  }
  /* Середина задана — значит карту двигают кнопками, и показать её надо
     даже там, где ни одной метки не осталось: иначе край карты был бы
     обрывом. Середины нет и меток нет — рисовать нечего. */
  const centred = isRealPoint(center?.lat, center?.lng);
  if (good.length === 0 && !centred) return null;

  /* Точки одного вида — одной пачкой: у Google на каждый цвет свой
     параметр markers, и по одной они упёрлись бы в предел длины адреса
     уже на десятке складов. */
  const byKind = new Map();
  for (const p of good) {
    if (p.label) { params.append('markers', `color:${MARKER_COLORS[p.kind]}|label:${p.label}|${round(p.lat)},${round(p.lng)}`); continue; }
    if (!byKind.has(p.kind)) byKind.set(p.kind, []);
    byKind.get(p.kind).push(p);
  }
  for (const [kind, list] of byKind) {
    const head = `color:${MARKER_COLORS[kind]}|size:mid`;
    const body = list.map((p) => `${round(p.lat)},${round(p.lng)}`).join('|');
    params.append('markers', `${head}|${body}`);
  }

  if (centred) {
    params.set('center', `${round(center.lat)},${round(center.lng)}`);
    params.set('zoom', String(clampInt(zoom ?? 12, 1, 20)));
  } else if (good.length === 1) {
    /* Одна метка сама себе границ не задаёт: без середины и приближения
       Google показал бы её на карте мира. */
    params.set('center', `${round(good[0].lat)},${round(good[0].lng)}`);
    params.set('zoom', String(clampInt(zoom ?? 14, 1, 20)));
  } else if (zoom !== undefined) {
    params.set('zoom', String(clampInt(zoom, 1, 20)));
  }

  params.set('key', config.mapsKey);
  return `${config.mapsBaseUrl}/maps/api/staticmap?${params}`;
};

/**
 * Забрать картинку карты у Google.
 *
 * Ходит сервер, а не браузер: иначе серверный ключ оказался бы в адресе
 * картинки на странице, то есть у всех.
 */
export const fetchStaticMap = async (opts) => {
  const url = staticMapUrl(opts);
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    /* Google при отказе отвечает текстом. Отдавать его в браузер как
       картинку нельзя — и незачем: там будет наша же ошибка. */
    if (!type.startsWith('image/')) return null;
    return { mime: type.split(';')[0], body: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
};


/* ─── Маршрут по точкам (Google Directions) ────────────────────────── */

const TRAVEL_MODES = { foot: 'walking', bike: 'bicycling', scooter: 'bicycling', car: 'driving', truck: 'driving' };
const MAX_STOPS = 20;
const haversine = (a, b) => {
  const R = 6371000; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * Маршрут от точки старта через остановки: Google сам подбирает порядок
 * (optimize:true), а последней остановкой ставим самую дальнюю от старта —
 * так маршрут не требует возврата. Ходит сервер своим ключом; в запрос
 * уходят только числа и название вида транспорта из белого списка.
 *
 * Возвращает { ok, order:[id…], legs:[{id,distanceM,durationS}], distanceM,
 * durationS, polyline } или { error }.
 */
export const computeRoute = async ({ origin, stops, vehicle } = {}) => {
  if (!config.mapsKey) return { error: 'maps_not_configured' };
  if (!isRealPoint(origin?.lat, origin?.lng)) return { error: 'no_origin' };
  const pts = (Array.isArray(stops) ? stops : []).filter((s) => s?.id && isRealPoint(s.lat, s.lng))
    .map((s) => ({ id: String(s.id), lat: Number(s.lat), lng: Number(s.lng) }));
  if (pts.length === 0) return { error: 'no_stops' };
  if (pts.length > MAX_STOPS) return { error: 'too_many_stops' };
  const o = { lat: Number(origin.lat), lng: Number(origin.lng) };

  let far = 0;
  pts.forEach((p, i) => { if (haversine(o, p) > haversine(o, pts[far])) far = i; });
  const last = pts[far];
  const mid = pts.filter((_, i) => i !== far);

  const params = new URLSearchParams({
    origin: `${round(o.lat)},${round(o.lng)}`,
    destination: `${round(last.lat)},${round(last.lng)}`,
    mode: TRAVEL_MODES[vehicle] ?? 'driving',
    language: 'ru', units: 'metric', key: config.mapsKey,
  });
  if (mid.length) params.set('waypoints', `optimize:true|${mid.map((p) => `${round(p.lat)},${round(p.lng)}`).join('|')}`);

  let data;
  try {
    const res = await fetch(`${config.mapsBaseUrl}/maps/api/directions/json?${params}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { error: 'route_failed' };
    data = await res.json();
  } catch { return { error: 'route_failed' }; }

  if (data?.status === 'REQUEST_DENIED') return { error: 'route_service_denied' };
  if (data?.status !== 'OK' || !data.routes?.[0]) return { error: data?.status === 'ZERO_RESULTS' ? 'no_route' : 'route_failed' };

  const route = data.routes[0];
  const wp = Array.isArray(route.waypoint_order) ? route.waypoint_order : mid.map((_, i) => i);
  const order = [...wp.map((i) => mid[i]), last];
  const legs = (route.legs ?? []).map((l, i) => ({
    id: order[i]?.id, distanceM: Number(l.distance?.value ?? 0), durationS: Number(l.duration?.value ?? 0),
  }));
  return {
    ok: true, order: order.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng })), legs,
    distanceM: legs.reduce((a, l) => a + l.distanceM, 0), durationS: legs.reduce((a, l) => a + l.durationS, 0),
    polyline: String(route.overview_polyline?.points ?? ''),
  };
};


/**
 * Маршрут по точкам В ЗАДАННОМ порядке (без перестановок): нужен курьеру, у которого забор всегда раньше вручения.
 * Возвращает { ok, legs:[{distanceM,durationS}], distanceM, durationS, polyline } или { error }.
 */
export const computeOrdered = async ({ origin, points, vehicle } = {}) => {
  if (!config.mapsKey) return { error: 'maps_not_configured' };
  if (!isRealPoint(origin?.lat, origin?.lng)) return { error: 'no_origin' };
  const pts = (Array.isArray(points) ? points : []).filter((p) => isRealPoint(p?.lat, p?.lng)).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  if (pts.length === 0) return { error: 'no_stops' };
  if (pts.length > MAX_STOPS) return { error: 'too_many_stops' };
  const last = pts[pts.length - 1]; const mid = pts.slice(0, -1);
  const params = new URLSearchParams({
    origin: `${round(origin.lat)},${round(origin.lng)}`, destination: `${round(last.lat)},${round(last.lng)}`,
    mode: TRAVEL_MODES[vehicle] ?? 'driving', language: 'ru', units: 'metric', key: config.mapsKey,
  });
  if (mid.length) params.set('waypoints', mid.map((p) => `via:${round(p.lat)},${round(p.lng)}`.replace('via:', '')).join('|'));
  let data;
  try {
    const res = await fetch(`${config.mapsBaseUrl}/maps/api/directions/json?${params}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return { error: 'route_failed' };
    data = await res.json();
  } catch { return { error: 'route_failed' }; }
  if (data?.status === 'REQUEST_DENIED') return { error: 'route_service_denied' };
  if (data?.status !== 'OK' || !data.routes?.[0]) return { error: data?.status === 'ZERO_RESULTS' ? 'no_route' : 'route_failed' };
  const route = data.routes[0];
  const legs = (route.legs ?? []).map((l) => ({ distanceM: Number(l.distance?.value ?? 0), durationS: Number(l.duration?.value ?? 0) }));
  return { ok: true, legs, distanceM: legs.reduce((a, l) => a + l.distanceM, 0), durationS: legs.reduce((a, l) => a + l.durationS, 0), polyline: String(route.overview_polyline?.points ?? '') };
};
