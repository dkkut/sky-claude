/**
 * Поиск людей и разрешение их id в имена.
 *
 * Обе ручки требуют выбранного профиля: справочник пользователей — не
 * публичная страница, а часть мессенджера.
 *
 * Путь приходит уже без строки запроса (её отбрасывает server.mjs),
 * поэтому параметры читаем из исходного req.url.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { searchPeople, peopleByIds } from './../directory.mjs';

/**
 * Потолок поисков в минуту на профиль.
 *
 * Ограничения nginx считают по адресу, а перебирать ники можно и с
 * одного адреса под одной учётной записью: тридцать запросов в секунду
 * — это выгрузка справочника пользователей за вечер.
 */
const SEARCH_PER_MIN = 40;

const params = (req) => new URL(req.url || '/', 'http://sky.local').searchParams;

export const directoryRoutes = async (req, res, url) => {
  if (req.method === 'GET' && url === '/api/directory/search') {
    const s = await requireProfile(req, res); if (!s) return true;
    if (!rateLimit(`search:${s.profileId}`, SEARCH_PER_MIN)) {
      return json(res, 429, { error: 'rate_limited' });
    }
    return json(res, 200, { people: await searchPeople(params(req).get('q'), s.profileId) });
  }

  if (req.method === 'GET' && url === '/api/directory/people') {
    const s = await requireProfile(req, res); if (!s) return true;
    if (!rateLimit(`people:${s.profileId}`, SEARCH_PER_MIN)) {
      return json(res, 429, { error: 'rate_limited' });
    }
    const ids = (params(req).get('ids') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    return json(res, 200, { people: await peopleByIds(ids, s.profileId) });
  }

  return false;
};
