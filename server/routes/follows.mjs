/**
 * Подписки — общая ручка для Bloom, SkyVideo и общего профиль-вьюера:
 * все три места переключают и показывают одно и то же состояние.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getPrivacy, sectionExceptions } from './../privacy.mjs';
import {
  toggleFollow, isFollowing, followerIds, followingIds, followerCount, followingCount,
} from './../follows.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 30;
const ID_RE = /^acc-[0-9a-f-]{36}$/;

export const followsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/follows/')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const parts = url.slice('/api/follows/'.length).split('/');
  const targetId = parts[0];
  const tail = parts[1] ?? '';
  if (!ID_RE.test(targetId)) return json(res, 404, { error: 'not_found' });

  if (req.method === 'GET' && tail === '') {
    if (!rateLimit(`follows:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

    const isOwn = targetId === me;
    const privacy = isOwn ? null : await getPrivacy(targetId);
    const exc = isOwn ? {} : await sectionExceptions(targetId, me);
    const canSee = isOwn || (exc.showFollowing ?? privacy?.profileVisibility?.showFollowing ?? true);

    if (!canSee) {
      return json(res, 200, { following: [], followers: [], followingCount: 0, followerCount: 0, isFollowing: false });
    }

    const [following, followers, fc, gc, iFollow] = await Promise.all([
      followingIds(targetId), followerIds(targetId),
      followerCount(targetId), followingCount(targetId),
      isFollowing(me, targetId),
    ]);
    return json(res, 200, {
      following, followers, followingCount: gc, followerCount: fc, isFollowing: iFollow,
    });
  }

  if (req.method === 'POST' && tail === 'toggle') {
    if (!rateLimit(`follows:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await toggleFollow(me, targetId);
    if (r.error) return json(res, r.error === 'not_found' ? 404 : 400, r);
    return json(res, 200, r);
  }

  return json(res, 404, { error: 'not_found' });
};
