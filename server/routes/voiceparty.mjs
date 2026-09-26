/**
 * Войс-пати: список/создание/удаление комнат. Кто сейчас внутри и живое
 * состояние (мьют, роль, поднятая рука) идёт по WebSocket (server/signal.mjs)
 * — им нужны события в реальном времени, а не опрос.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { createRoom, deleteRoom, listRooms, getRoom } from './../voiceparty.mjs';

const ROOM_ID_RE = /^vp-[0-9a-f-]{36}$/;

export const voicePartyRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/voiceparty/')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (url === '/api/voiceparty/rooms' && req.method === 'GET') {
    if (!rateLimit(`vp:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await listRooms());
  }

  if (url === '/api/voiceparty/rooms' && req.method === 'POST') {
    if (!rateLimit(`vp:write:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
    let body;
    try { body = await parseBody(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
    const r = await createRoom(me, body);
    return r.error ? json(res, 400, r) : json(res, 201, r);
  }

  const m = url.match(/^\/api\/voiceparty\/rooms\/([^/]+)$/);
  if (m) {
    const roomId = m[1];
    if (!ROOM_ID_RE.test(roomId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET') {
      if (!rateLimit(`vp:read:${me}`, 60)) return json(res, 429, { error: 'rate_limited' });
      const room = await getRoom(roomId);
      return room ? json(res, 200, { room }) : json(res, 404, { error: 'not_found' });
    }

    if (req.method === 'DELETE') {
      if (!rateLimit(`vp:write:${me}`, 20)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteRoom(me, roomId);
      return r.error ? json(res, r.error === 'not_allowed' ? 403 : 404, r) : json(res, 200, r);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
