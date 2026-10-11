/**
 * Игровые серверы (вкладка «Каналы» игр): список, вступление, каналы,
 * сообщения, голос. Все права решает server/gameservers.mjs по базе.
 * Новые сообщения и перемены в устройстве сервера уходят участникам
 * по WebSocket (gs:*), остальное клиент берёт обычными запросами.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { pushGameServer } from './../signal.mjs';
import {
  listServers, createServer, getServer, joinServer, joinByCode, leaveServer, deleteServer,
  createChannel, deleteChannel, listMessages, postMessage, deleteMessage,
  kickMember, setMemberRole, voiceRoomFor, memberIds,
} from './../gameservers.mjs';

const STATUS = {
  not_found: 404, not_member: 403, not_allowed: 403, banned: 403, private_server: 403,
  too_many_servers: 409, too_many_channels: 409, owner_cannot_leave: 409, last_text_channel: 409,
  announce_only: 403, voice_channel: 400,
};
const fail = (res, r) => json(res, STATUS[r.error] ?? 400, r);

const SID = '(gsv-[0-9a-f-]{36})';
const CID = '(gch-[0-9a-f-]{36})';
const UID = '([A-Za-z0-9_-]{1,64})';

export const gameServerRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/gaming/servers') && !path.startsWith('/api/gaming/channels')
    && !path.startsWith('/api/gaming/messages')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const read = req.method === 'GET';
  if (!rateLimit(`gs:${read ? 'r' : 'w'}:${me}`, read ? 240 : 90)) return json(res, 429, { error: 'rate_limited' });

  const body = async () => { try { return (await parseBody(req)) ?? {}; } catch { return {}; } };
  const changed = async (serverId) => pushGameServer(await memberIds(serverId), { type: 'gs:changed', payload: { serverId } });

  if (read && path === '/api/gaming/servers') return json(res, 200, await listServers(me));

  if (req.method === 'POST' && path === '/api/gaming/servers') {
    const r = await createServer(me, await body());
    return r.error ? fail(res, r) : json(res, 201, r);
  }

  if (req.method === 'POST' && path === '/api/gaming/servers/join-code') {
    const r = await joinByCode(me, (await body()).code);
    if (r.error) return fail(res, r);
    if (r.joined) void changed(r.serverId);
    return json(res, 200, r);
  }

  let m = path.match(new RegExp(`^/api/gaming/servers/${SID}$`));
  if (m) {
    if (read) { const r = await getServer(me, m[1]); return r.error ? fail(res, r) : json(res, 200, r); }
    if (req.method === 'DELETE') {
      const r = await deleteServer(me, m[1]);
      if (r.error) return fail(res, r);
      pushGameServer(r.recipients, { type: 'gs:removed', payload: { serverId: m[1] } });
      return json(res, 200, { ok: true });
    }
  }

  m = path.match(new RegExp(`^/api/gaming/servers/${SID}/(join|leave|channels)$`));
  if (m && req.method === 'POST') {
    const [, serverId, action] = m;
    if (action === 'join') {
      const r = await joinServer(me, serverId, (await body()).code);
      if (r.error) return fail(res, r);
      if (r.joined) void changed(serverId);
      return json(res, 200, r);
    }
    if (action === 'leave') {
      const r = await leaveServer(me, serverId);
      if (r.error) return fail(res, r);
      void changed(serverId);
      return json(res, 200, r);
    }
    const r = await createChannel(me, serverId, await body());
    if (r.error) return fail(res, r);
    void changed(serverId);
    return json(res, 201, r);
  }

  m = path.match(new RegExp(`^/api/gaming/servers/${SID}/members/${UID}(?:/(role))?$`));
  if (m) {
    const [, serverId, target, role] = m;
    if (req.method === 'DELETE' && !role) {
      const b = await body();
      const r = await kickMember(me, serverId, target, b.ban === true || new URL(req.url, 'http://x').searchParams.get('ban') === '1');
      if (r.error) return fail(res, r);
      pushGameServer([target], { type: 'gs:removed', payload: { serverId } });
      void changed(serverId);
      return json(res, 200, r);
    }
    if (req.method === 'POST' && role) {
      const r = await setMemberRole(me, serverId, target, (await body()).role);
      if (r.error) return fail(res, r);
      void changed(serverId);
      return json(res, 200, r);
    }
  }

  m = path.match(new RegExp(`^/api/gaming/channels/${CID}(?:/(messages|voice))?$`));
  if (m) {
    const [, channelId, sub] = m;
    if (!sub && req.method === 'DELETE') {
      const r = await deleteChannel(me, channelId);
      if (r.error) return fail(res, r);
      void changed(r.serverId);
      return json(res, 200, { ok: true });
    }
    if (sub === 'messages' && read) {
      const before = new URL(req.url, 'http://x').searchParams.get('before');
      const r = await listMessages(me, channelId, before);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (sub === 'messages' && req.method === 'POST') {
      if (!rateLimit(`gs:msg:${me}`, 30)) return json(res, 429, { error: 'rate_limited' });
      const r = await postMessage(me, channelId, (await body()).text);
      if (r.error) return fail(res, r);
      pushGameServer(r.recipients, { type: 'gs:message', payload: { serverId: r.serverId, message: r.message } });
      return json(res, 201, { message: r.message });
    }
    if (sub === 'voice' && req.method === 'POST') {
      const r = await voiceRoomFor(me, channelId);
      return r.error ? fail(res, r) : json(res, 200, r);
    }
  }

  m = path.match(/^\/api\/gaming\/messages\/(gmsg-[0-9a-f-]{36})$/);
  if (m && req.method === 'DELETE') {
    const r = await deleteMessage(me, m[1]);
    if (r.error) return fail(res, r);
    pushGameServer(r.recipients, { type: 'gs:message-deleted', payload: { serverId: r.serverId, channelId: r.channelId, id: m[1] } });
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not_found' });
};
