/**
 * Сериалы и субтитры Sky Film по HTTP. Права и правила — в filmseries.mjs; здесь вход: кто спрашивает,
 * не слишком ли часто, той ли формы идентификатор. Доступ тот же, что у всего Sky Film (Prime или право `content`).
 */
import { json, parseBody, requireProfile, readSession } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { hasPrime } from './../skyid.mjs';
import { can } from './../admin.mjs';
import { ticketFromCookies, readTicket } from './../filmticket.mjs';
import { deleteMovie } from './../film.mjs';
import {
  createSeries, updateSeries, deleteSeries, addSeason, updateSeason, deleteSeason, updateEpisode,
  listSeriesCatalog, listMySeries, readSeries, nextEpisode, submitSeries, moderateSeries, seriesQueue,
  setSubtitle, deleteSubtitle, listSubtitles, readSubtitle, isSeriesId,
} from './../filmseries.mjs';

const READ_PER_MIN = 300;
const WRITE_PER_MIN = 120;
const MOVIE_ID = /^mov-[0-9a-f-]{36}$/;
const SEASON_ID = /^sea-[0-9a-f-]{36}$/;

const CODES = { not_found: 404, not_allowed: 403, too_many: 409, season_exists: 409, episode_exists: 409, already_pending: 409, already_published: 409, not_pending: 409, file_too_large: 413 };
const fail = (res, r) => json(res, CODES[r.error] ?? 400, r);

export const filmSeriesRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/film/')) return false;
  const path = url.split('?')[0];
  const isSeries = path === '/api/film/series' || path.startsWith('/api/film/series/') || path === '/api/film/series-moderation'
    || path.startsWith('/api/film/season/') || path.startsWith('/api/film/episode/');
  const subs = path.match(/^\/api\/film\/movie\/([^/]+)\/subtitles(?:\/([a-z]{2}))?$/);
  if (!isSeries && !subs) return false;
  const params = new URL(req.url, 'http://x').searchParams;

  let me;
  if (subs && req.method === 'GET' && subs[2]) {
    // Дорожку запрашивает тег <track> — заголовка Authorization у него нет, годится и пропуск из куки / ?t=.
    const session = await readSession(req);
    me = session?.profileId ?? ticketFromCookies(req.headers.cookie) ?? readTicket(params.get('t'));
    if (!me) return json(res, 401, { error: 'unauthorized' });
  } else {
    const session = await requireProfile(req, res);
    if (!session) return true;
    me = session.profileId;
  }
  if (!(await hasPrime(me)) && !(await can(me, 'content'))) return json(res, 403, { error: 'prime_required' });
  const read = () => rateLimit(`film:read:${me}`, READ_PER_MIN);
  const write = () => rateLimit(`film:write:${me}`, WRITE_PER_MIN);

  /* ── Субтитры ── */
  if (subs) {
    const [, movieId, lang] = subs;
    if (!MOVIE_ID.test(movieId)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && !lang) {
      if (!read()) return json(res, 429, { error: 'rate_limited' });
      const list = await listSubtitles(movieId, me);
      return list ? json(res, 200, { subtitles: list }) : json(res, 404, { error: 'not_found' });
    }
    if (req.method === 'GET' && lang) {
      if (!read()) return json(res, 429, { error: 'rate_limited' });
      const vtt = await readSubtitle(movieId, lang, me);
      if (vtt === null) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=600', 'Vary': 'Cookie' });
      res.end(vtt);
      return true;
    }
    if (req.method === 'PUT' && lang) {
      if (!write()) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setSubtitle(movieId, me, { lang, label: body?.label, content: body?.content });
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (req.method === 'DELETE' && lang) {
      if (!write()) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteSubtitle(movieId, me, lang);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    return json(res, 405, { error: 'method_not_allowed' });
  }

  /* ── Сериалы ── */
  if (path === '/api/film/series' && req.method === 'GET') {
    if (!read()) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { series: await listSeriesCatalog(me, { q: params.get('q') ?? undefined, limit: params.get('limit'), offset: params.get('offset') }) });
  }
  if (path === '/api/film/series/mine' && req.method === 'GET') {
    if (!read()) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { series: await listMySeries(me) });
  }
  if (path === '/api/film/series' && req.method === 'POST') {
    if (!write()) return json(res, 429, { error: 'rate_limited' });
    const r = await createSeries(me, await parseBody(req));
    return r.error ? fail(res, r) : json(res, 201, { id: r.id, ...(await readSeries(r.id, me)) });
  }
  if (path === '/api/film/series-moderation' && req.method === 'GET') {
    if (!(await can(me, 'content'))) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { series: await seriesQueue(me) });
  }

  const sm = path.match(/^\/api\/film\/series\/([^/]+)(?:\/([a-z-]+))?$/);
  if (sm) {
    const id = sm[1]; const tail = sm[2] ?? '';
    if (!isSeriesId(id)) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && !tail) {
      if (!read()) return json(res, 429, { error: 'rate_limited' });
      const full = await readSeries(id, me);
      return full ? json(res, 200, full) : json(res, 404, { error: 'not_found' });
    }
    if (!write()) return json(res, 429, { error: 'rate_limited' });
    if (req.method === 'PATCH' && !tail) { const r = await updateSeries(id, me, (await parseBody(req)) ?? {}); return r.error ? fail(res, r) : json(res, 200, await readSeries(id, me)); }
    if (req.method === 'DELETE' && !tail) { const r = await deleteSeries(id, me); return r.error ? fail(res, r) : json(res, 200, r); }
    if (req.method === 'POST' && tail === 'seasons') { const r = await addSeason(id, me, (await parseBody(req)) ?? {}); return r.error ? fail(res, r) : json(res, 201, { ...r, ...(await readSeries(id, me)) }); }
    if (req.method === 'POST' && tail === 'submit') {
      const b = (await parseBody(req)) ?? {};
      const r = await submitSeries(id, me, { license: b.license, explicit: b.explicit === true, ageRestricted18: b.ageRestricted18 === true });
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (req.method === 'POST' && tail === 'moderate') {
      const b = (await parseBody(req)) ?? {};
      const r = await moderateSeries(id, me, { approve: b.approve === true, reason: b.reason });
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    return json(res, 404, { error: 'not_found' });
  }

  const sea = path.match(/^\/api\/film\/season\/([^/]+)$/);
  if (sea) {
    if (!SEASON_ID.test(sea[1])) return json(res, 404, { error: 'not_found' });
    if (!write()) return json(res, 429, { error: 'rate_limited' });
    if (req.method === 'PATCH') { const r = await updateSeason(sea[1], me, (await parseBody(req)) ?? {}); return r.error ? fail(res, r) : json(res, 200, r); }
    if (req.method === 'DELETE') { const r = await deleteSeason(sea[1], me); return r.error ? fail(res, r) : json(res, 200, r); }
  }

  const ep = path.match(/^\/api\/film\/episode\/([^/]+)(?:\/(next))?$/);
  if (ep) {
    if (!MOVIE_ID.test(ep[1])) return json(res, 404, { error: 'not_found' });
    if (req.method === 'GET' && ep[2] === 'next') {
      if (!read()) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { next: await nextEpisode(ep[1], me) });
    }
    if (req.method === 'PATCH' && !ep[2]) {
      if (!write()) return json(res, 429, { error: 'rate_limited' });
      const r = await updateEpisode(ep[1], me, (await parseBody(req)) ?? {});
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (req.method === 'DELETE' && !ep[2]) {
      if (!write()) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteMovie(ep[1], me);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
  }
  return json(res, 404, { error: 'not_found' });
};
