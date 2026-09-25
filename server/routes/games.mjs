/**
 * Sky Games — чтение реального серверного рейтинга (server/matchmaking.mjs).
 * Сама очередь и матчи идут по WebSocket (server/signal.mjs) — им нужны
 * события в реальном времени, а не опрос.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getRating } from './../matchmaking.mjs';

const GAME_ID_RE = /^[\w-]{1,40}$/;

export const gamesRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/games/')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const m = url.match(/^\/api\/games\/([^/]+)\/rating$/);
  if (req.method === 'GET' && m) {
    if (!GAME_ID_RE.test(m[1])) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`games:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { rating: await getRating(me, m[1]) });
  }

  return json(res, 404, { error: 'not_found' });
};
