/**
 * Prime Pulse по HTTP.
 *
 * Просмотр ленты открыт любому вошедшему — предложения сами по себе
 * не секрет, а вот погасить их может только тот, у кого Prime сейчас
 * действует (redeemOffer это и проверяет). Управление предложениями —
 * право content, тот же приём, что у очереди модерации музыки/кино.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import {
  listOffersForUser, listOffersForAdmin, createOffer, updateOffer,
  setOfferActive, deleteOffer, redeemOffer, listMyRedemptions,
} from './../primepulse.mjs';

const READ_PER_MIN = 120;
const WRITE_PER_MIN = 30;

const OFFER_ID = /^ppo-[0-9a-f-]{36}$/;

const errCode = (error) => (
  error === 'not_allowed' ? 403
    : error === 'not_found' ? 404
      : error === 'prime_required' ? 402
        : error === 'already_redeemed' ? 409
          : error === 'has_redemptions' ? 409
            : 400
);

export const primePulseRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/prime-pulse')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const path = url.split('?')[0];

  if (req.method === 'GET' && path === '/api/prime-pulse/offers') {
    if (!rateLimit(`pulse:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { offers: await listOffersForUser(me) });
  }

  if (req.method === 'GET' && path === '/api/prime-pulse/mine') {
    if (!rateLimit(`pulse:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    return json(res, 200, { redemptions: await listMyRedemptions(me) });
  }

  if (req.method === 'GET' && path === '/api/prime-pulse/admin/offers') {
    if (!rateLimit(`pulse:read:${me}`, READ_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await listOffersForAdmin(me);
    if (r?.error) return json(res, errCode(r.error), r);
    return json(res, 200, { offers: r });
  }

  if (req.method === 'POST' && path === '/api/prime-pulse/admin/offers') {
    if (!rateLimit(`pulse:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const body = await parseBody(req);
    const r = await createOffer(me, body ?? {});
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }

  const offerMatch = path.match(/^\/api\/prime-pulse\/admin\/offers\/([^/]+)(\/[a-z]+)?$/);
  if (offerMatch) {
    const id = offerMatch[1];
    const tail = offerMatch[2] ?? '';
    if (!OFFER_ID.test(id)) return json(res, 404, { error: 'not_found' });

    if (req.method === 'PATCH' && tail === '') {
      if (!rateLimit(`pulse:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await updateOffer(me, id, body ?? {});
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }

    if (req.method === 'POST' && tail === '/active') {
      if (!rateLimit(`pulse:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const body = await parseBody(req);
      const r = await setOfferActive(me, id, body?.on !== false);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }

    if (req.method === 'DELETE' && tail === '') {
      if (!rateLimit(`pulse:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
      const r = await deleteOffer(me, id);
      return r.error ? json(res, errCode(r.error), r) : json(res, 200, r);
    }

    return json(res, 404, { error: 'not_found' });
  }

  const redeemMatch = path.match(/^\/api\/prime-pulse\/offers\/([^/]+)\/redeem$/);
  if (req.method === 'POST' && redeemMatch) {
    if (!OFFER_ID.test(redeemMatch[1])) return json(res, 404, { error: 'not_found' });
    if (!rateLimit(`pulse:write:${me}`, WRITE_PER_MIN)) return json(res, 429, { error: 'rate_limited' });
    const r = await redeemOffer(me, redeemMatch[1]);
    return r.error ? json(res, errCode(r.error), r) : json(res, 201, r);
  }

  return json(res, 404, { error: 'not_found' });
};
