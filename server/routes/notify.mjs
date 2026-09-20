/**
 * Рассылки по HTTP.
 *
 * /api/notify/events — для любого вошедшего: опрос новых рассылок,
 * дошедших лично до него, тем же способом, что и /api/bloom/events.
 *
 * /api/notify/admin/* — только с правом 'notifications' (проверяется
 * внутри notifyBroadcast.mjs, не здесь): создание, список, отмена.
 * Опасное массовое действие (создание рассылки, особенно «всем» или
 * «сейчас») подтверждается на клиенте отдельным диалогом и попадает в
 * уже существующий admin_log (logAdmin) — как и региональные
 * ограничения Bloom/SkyVideo.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  createBroadcast, listBroadcasts, getBroadcast, cancelBroadcast, recentDeliveries,
} from './../notifyBroadcast.mjs';
import { logAdmin } from './../adminsec.mjs';

const READ_PER_MIN = 120;
const ADMIN_PER_MIN = 30;

const errCode = (error) => (
  error === 'not_allowed' ? 403
    : error === 'not_found' ? 404
      : error === 'not_cancellable' ? 409
        : 400
);

export const notifyRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/notify')) return false;
  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (req.method === 'GET' && path === '/api/notify/events') {
    if (!rateLimit(`notify:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const sinceMs = Math.max(Date.now() - 24 * 3_600_000, Number(params.get('since')) || 0);
    const events = await recentDeliveries(me, new Date(sinceMs).toISOString());
    return json(res, 200, { events, now: Date.now() });
  }

  if (req.method === 'GET' && path === '/api/notify/admin/broadcasts') {
    if (!rateLimit(`notify:admin:${me}`, ADMIN_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await listBroadcasts(me, { status: params.get('status') || undefined, limit: params.get('limit') });
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/notify/admin/broadcasts') {
    if (!rateLimit(`notify:admin:${me}`, ADMIN_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createBroadcast(me, body ?? {});
    if (r.error) return json(res, errCode(r.error), r);
    await logAdmin({
      actorId: me, targetId: r.broadcast.id, targetType: 'notify_broadcast', type: 'notify_broadcast_create',
      result: 'ok',
      detail: `«${r.broadcast.title}» · аудитория: ${r.broadcast.audienceType}`
        + (r.broadcast.audienceType === 'region' ? ` (${r.broadcast.audienceRegion})` : '')
        + (r.broadcast.audienceType === 'users' ? ` (${r.broadcast.audienceUserIds.length} чел.)` : '')
        + ` · статус: ${r.broadcast.status}`
        + (r.broadcast.reason ? ` · причина: ${r.broadcast.reason}` : ''),
    });
    return json(res, 200, r);
  }

  const detailMatch = /^\/api\/notify\/admin\/broadcasts\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && detailMatch) {
    if (!rateLimit(`notify:admin:${me}`, ADMIN_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await getBroadcast(me, detailMatch[1]);
    if (r.error) return json(res, errCode(r.error), r);
    return json(res, 200, r);
  }

  const cancelMatch = /^\/api\/notify\/admin\/broadcasts\/([^/]+)\/cancel$/.exec(path);
  if (req.method === 'POST' && cancelMatch) {
    if (!rateLimit(`notify:admin:${me}`, ADMIN_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req).catch(() => ({}));
    const r = await cancelBroadcast(me, cancelMatch[1], body?.reason);
    if (r.error) return json(res, errCode(r.error), r);
    await logAdmin({
      actorId: me, targetId: cancelMatch[1], targetType: 'notify_broadcast', type: 'notify_broadcast_cancel',
      result: 'ok', detail: body?.reason ? String(body.reason).slice(0, 300) : '',
    });
    return json(res, 200, r);
  }

  return false;
};
