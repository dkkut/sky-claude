/**
 * Sky Games — чтение реального серверного рейтинга (server/matchmaking.mjs)
 * и кабинет турниров (server/tournaments.mjs). Сама очередь и матчи идут
 * по WebSocket (server/signal.mjs) — им нужны события в реальном времени,
 * а не опрос.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { ratingView, leaderboard, history } from './../gameelo.mjs';
import {
  createTournament, listTournaments, getTournament,
  joinTournament, leaveTournament, setTournamentStatus,
} from './../tournaments.mjs';

const GAME_ID_RE = /^[\w-]{1,40}$/;
const TOURNEY_ID_RE = /^trn-[0-9a-f-]{36}$/;

export const gamesRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/games/')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const ratingMatch = url.match(/^\/api\/games\/([^/]+)\/(rating|leaderboard|rating\/history)$/);
  if (req.method === 'GET' && ratingMatch) {
    if (!GAME_ID_RE.test(ratingMatch[1])) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`games:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
    const gameId = ratingMatch[1];
    const q = new URL(req.url, 'http://x').searchParams;
    if (ratingMatch[2] === 'rating') return json(res, 200, { rating: await ratingView(me, gameId) });
    if (ratingMatch[2] === 'leaderboard') return json(res, 200, await leaderboard(me, gameId, q.get('limit')));
    return json(res, 200, await history(me, gameId, q.get('limit')));
  }

  if (url === '/api/games/tournaments') {
    if (req.method === 'GET') {
      if (!rateLimit(`games:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, { tournaments: await listTournaments(me) });
    }
    if (req.method === 'POST') {
      if (!rateLimit(`games:write:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
      let body;
      try { body = await parseBody(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
      const r = await createTournament(me, body);
      return r.error ? json(res, 400, r) : json(res, 201, r);
    }
  }

  const idMatch = url.match(/^\/api\/games\/tournaments\/([^/]+)(?:\/(join|leave|status))?$/);
  if (idMatch) {
    const id = idMatch[1];
    const action = idMatch[2];
    if (!TOURNEY_ID_RE.test(id)) return json(res, 404, { error: 'not_found' });

    if (!action && req.method === 'GET') {
      if (!rateLimit(`games:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
      const tournament = await getTournament(id, me);
      return tournament ? json(res, 200, { tournament }) : json(res, 404, { error: 'not_found' });
    }

    if (action === 'join' && req.method === 'POST') {
      if (!rateLimit(`games:write:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
      const r = await joinTournament(me, id);
      return r.error ? json(res, r.error === 'full' ? 409 : 404, r) : json(res, 200, r);
    }

    if (action === 'leave' && req.method === 'POST') {
      if (!rateLimit(`games:write:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
      const r = await leaveTournament(me, id);
      return r.error ? json(res, 404, r) : json(res, 200, r);
    }

    if (action === 'status' && req.method === 'POST') {
      if (!rateLimit(`games:write:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
      let body;
      try { body = await parseBody(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
      const r = await setTournamentStatus(me, id, body?.status);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 400, r) : json(res, 200, r);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
