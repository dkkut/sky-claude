/**
 * Sky Personal Storage: «Поделиться» по HTTP.
 *
 * Здесь только вход — кто спрашивает, не слишком ли часто, той ли формы
 * идентификатор. Кому что можно — решает storageshare.mjs.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { grantShare, revokeShare, listSharesForFile, listSharedWithMe } from './../storageshare.mjs';
import { checkQuota } from './../storagequota.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 30;

const CODES = {
  invalid_kind: 400,
  invalid_recipient: 400,
  recipient_not_found: 404,
  not_found: 404,
};
const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

const FILE_MATCH = /^\/api\/storage\/files\/(movie|track)\/([^/]+)\/share(?:\/([^/]+))?$/;

export const storageShareRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/storage/')) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId;

  if (req.method === 'GET' && url === '/api/storage/shared-with-me') {
    if (!rateLimit(`storageshare:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, await listSharedWithMe(me));
  }

  // Сколько места есть и сколько занято — кино и музыка вместе
  // (storagequota.mjs). incomingBytes=0: это чтение, а не резерв под
  // новую загрузку, quota.ok всегда true при нулевом приросте.
  if (req.method === 'GET' && url === '/api/storage/quota') {
    if (!rateLimit(`storageshare:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const { quota, used } = await checkQuota(me, 0);
    return json(res, 200, { quotaBytes: quota, usedBytes: used });
  }

  const match = url.split('?')[0].match(FILE_MATCH);
  if (!match) return false;
  const [, kind, fileId, targetUserId] = match;

  if (req.method === 'GET' && !targetUserId) {
    if (!rateLimit(`storageshare:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { shares: await listSharesForFile(me, kind, fileId) });
  }

  if (req.method === 'POST' && !targetUserId) {
    if (!rateLimit(`storageshare:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const result = await grantShare(me, String(body?.userId ?? ''), kind, fileId, {
      canDownload: body?.canDownload === true,
      expiresAt: body?.expiresAt ? new Date(body.expiresAt) : null,
    });
    if (result.error) return fail(res, result);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'DELETE' && targetUserId) {
    if (!rateLimit(`storageshare:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const ok = await revokeShare(me, targetUserId, kind, fileId);
    if (!ok) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { ok: true });
  }

  return false;
};
