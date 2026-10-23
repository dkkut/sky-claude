/**
 * Дружба и просмотры профиля — то же самое, что нужно
 * src/profile/viewer/social.ts, но на сервере вместо localStorage.
 */
import { json, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { getPrivacy, sectionExceptions } from './../privacy.mjs';
import {
  friendStatus, sendFriendRequest, removeFriend, friendIds, friendCount,
} from './../friends.mjs';
import { recordProfileView, profileViewCount } from './../profileviews.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 30;
const ID_RE = /^acc-[0-9a-f-]{36}$/;

export const friendsRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/friends/') && !url.startsWith('/api/profile-views/')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  if (url.startsWith('/api/friends/')) {
    const parts = url.slice('/api/friends/'.length).split('/');
    const targetId = parts[0];
    const tail = parts[1] ?? '';
    if (!ID_RE.test(targetId)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'GET' && tail === '') {
      if (!rateLimit(`friends:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });

      const isOwn = targetId === me;
      const privacy = isOwn ? null : await getPrivacy(targetId);
      const exc = isOwn ? {} : await sectionExceptions(targetId, me);
    const canSee = isOwn || (exc.showFriends ?? privacy?.profileVisibility?.showFriends ?? true);

      const [status, ids, count] = await Promise.all([
        friendStatus(me, targetId),
        canSee ? friendIds(targetId) : Promise.resolve([]),
        canSee ? friendCount(targetId) : Promise.resolve(0),
      ]);
      return json(res, 200, { status, friendIds: ids, friendCount: count });
    }

    if (req.method === 'POST' && tail === 'request') {
      if (!rateLimit(`friends:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await sendFriendRequest(me, targetId);
      if (r.error) return json(res, r.error === 'not_found' ? 404 : 400, r);
      return json(res, 200, r);
    }

    if (req.method === 'POST' && tail === 'remove') {
      if (!rateLimit(`friends:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await removeFriend(me, targetId);
      return json(res, 200, r);
    }

    return json(res, 404, { error: 'not_found' });
  }

  /* ── Просмотры профиля ────────────────────────────────────────────── */
  const targetId = url.slice('/api/profile-views/'.length).split('/')[0];
  if (!ID_RE.test(targetId)) return json(res, 404, { error: 'not_found' });

  if (req.method === 'POST') {
    if (!rateLimit(`profileviews:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    await recordProfileView(targetId, me);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET') {
    if (!rateLimit(`profileviews:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    // Свои просмотры видит только владелец — чужому счётчику взгляд
    // постороннего ничего не должен показывать.
    if (targetId !== me) return json(res, 200, { count: null });
    return json(res, 200, { count: await profileViewCount(targetId) });
  }

  return json(res, 404, { error: 'not_found' });
};
