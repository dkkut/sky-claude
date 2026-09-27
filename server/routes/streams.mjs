/**
 * Sky Трансляции: список/создание/завершение эфира + донат. Кто сейчас
 * смотрит и живое состояние (чат/реакции/прогнозы/WebRTC-сигналинг)
 * идёт по WebSocket (server/signal.mjs, case 'live:*') — им нужны
 * события в реальном времени, а не опрос, тот же принцип, что и в
 * routes/voiceparty.mjs.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { createStream, endStream, listLive, getStream, donate } from './../streams.mjs';

const STREAM_ID_RE = /^live-[0-9a-f-]{36}$/;

const errCode = (error) => (
  error === 'not_found' ? 404
    : error === 'not_allowed' || error === 'banned' ? 403
      : error === 'already_live' || error === 'self_donate' ? 409
        : 400
);

export const streamsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/streams')) return false;
  const path = url.split('?')[0];

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (path === '/api/streams' && req.method === 'GET') {
    if (!rateLimit(`live:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { streams: await listLive() });
  }

  if (path === '/api/streams' && req.method === 'POST') {
    if (!rateLimit(`live:write:${me}`, 10)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createStream(me, body ?? {});
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }

  const m = path.match(/^\/api\/streams\/([^/]+)(\/[a-z]+)?$/);
  if (m) {
    const streamId = m[1];
    const tail = m[2] ?? '';
    if (!STREAM_ID_RE.test(streamId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`live:read:${me}`, 120)) return json(res, 429, { error: 'rate_limited' });
      const stream = await getStream(streamId);
      return stream ? json(res, 200, { stream }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'POST' && tail === '/end') {
      if (!rateLimit(`live:write:${me}`, 10)) return json(res, 429, { error: 'rate_limited' });
      const r = await endStream(me, streamId);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/donate') {
      if (!rateLimit(`live:donate:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await donate(me, streamId, body?.amount, body?.message, body?.idempotencyKey);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
