/**
 * Карты по HTTP.
 *
 * Три ручки и ни одной лишней:
 *
 *   GET  /api/maps/settings  — есть ли карты вообще и каким ключом
 *                              рисовать живую;
 *   POST /api/maps/geocode   — адрес в координаты;
 *   GET  /api/maps/still     — картинка карты, собранная сервером.
 *
 * Серверный ключ не появляется ни в одном ответе. Картинку забирает
 * сервер и отдаёт уже байтами: положи мы ключ в адрес картинки на
 * странице — он оказался бы у всех, кто эту страницу открыл.
 *
 * Точки в картинку приходят от клиента, и это не дыра: нарисовать можно
 * только то, что и так знаешь. Чужие координаты отсюда не достать —
 * их здесь не ищут, а рисуют присланные. Всё же настоящее — где склад,
 * где курьер — приходит другими ручками, и права там свои.
 */
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { ticketFromCookies } from './../marketticket.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { mapsSettings, geocode, fetchStaticMap } from './../maps.mjs';

/** Спрос у Google стоит денег: свой предел, помимо общего. */
const GEOCODE_PER_HOUR = 120;
const STILL_PER_MIN = 60;

export const mapsRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/maps')) return false;

  /* Картинку карты браузер тянет тегом <img>. Пропуск здесь только
     говорит, чей это запрос: нарисовать можно лишь те точки, что
     прислали, а чужих координат отсюда не достать. */
  const isPicture = req.method === 'GET' && path === '/api/maps/still';

  let me;
  if (isPicture) {
    const got = await readSession(req);
    me = got?.profileId ?? ticketFromCookies(req.headers.cookie);
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }

  if (req.method === 'GET' && path === '/api/maps/settings') {
    if (!rateLimit(`mp:s:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, mapsSettings());
  }

  if (req.method === 'POST' && path === '/api/maps/geocode') {
    if (!rateLimitPerHour(`mp:g:${me}`, GEOCODE_PER_HOUR)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const body = await parseBody(req);
    const point = await geocode(body.address);
    /* Не нашлось — так и говорим. Подставить центр города вместо
       ненайденного адреса означало бы отправить человека не туда. */
    return json(res, 200, { point });
  }

  if (req.method === 'GET' && path === '/api/maps/still') {
    if (!rateLimit(`mp:i:${me}`, STILL_PER_MIN)) {
      return json(res, 429, { error: 'too_many_requests' });
    }
    const params = new URL(req.url, 'http://x').searchParams;
    /* Точки приходят строкой «широта,долгота,вид;…»: разбирается она
       здесь, и в запрос к Google уходят только числа. */
    const points = [];
    for (const piece of String(params.get('points') ?? '').split(';').slice(0, 40)) {
      const [lat, lng, kind] = piece.split(',');
      if (lat === undefined || lng === undefined) continue;
      points.push({ lat, lng, kind });
    }
    /* Середина — когда карту двигают кнопками. Разбирается так же:
       числами и ничем больше. */
    const [cLat, cLng] = String(params.get('center') ?? '').split(',');
    const picture = await fetchStaticMap({
      points,
      center: cLat === undefined ? undefined : { lat: cLat, lng: cLng },
      width: params.get('w'),
      height: params.get('h'),
      zoom: params.get('zoom') ?? undefined,
    });
    if (!picture) return json(res, 404, { error: 'map_unavailable' });

    res.writeHead(200, {
      'Content-Type': picture.mime,
      'Content-Length': String(picture.body.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      /* Карта одних и тех же точек не меняется час от часу. */
      'Cache-Control': 'private, max-age=3600',
      // См. server/routes/film.mjs — пропуск в куке, без Vary браузер мог
      // бы отдать картинку, закешированную под одним профилем, другому
      // профилю того же Sky ID в том же браузере.
      'Vary': 'Cookie',
    });
    res.end(picture.body);
    return true;
  }

  return json(res, 404, { error: 'not_found' });
};
