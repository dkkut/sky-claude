/**
 * Sky Family по HTTP.
 *
 * Здесь только вход: кто спрашивает и не слишком ли часто. Кому что
 * можно решает server/family.mjs — от роли в family_members, а не от
 * того, что прислал клиент.
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import {
  myFamily, myInvitations, createFamily, addPlaceholderMember,
  inviteMember, cancelInvitation, acceptInvitation, rejectInvitation,
  removeMember, leaveFamily, updateMember, transferOwnership, closeFamily,
  purchaseFamilyPrime, listNotifications, readNotification,
  adminListFamilies, adminFamilyDetail, adminSetFamilyStatus,
} from './../family.mjs';
import * as famWallet from './../familywallet.mjs';

const READ_PER_MIN = 60;
const WRITE_PER_MIN = 20;
/* Приглашения — то место, где спамят: свой, более тесный предел. */
const INVITE_PER_HOUR = 20;

const CODES = {
  not_found: 404,
  not_allowed: 403,
  bad_name: 400,
  bad_role: 400,
  bad_plan: 400,
  bad_status: 400,
  already_in_family: 409,
  already_pending: 409,
  already_decided: 409,
  recipient_in_family: 409,
  no_such_user: 404,
  self_invite: 400,
  member_limit: 409,
  adult_limit: 409,
  expired: 410,
  not_in_family: 404,
  owner_must_transfer_or_close: 409,
  cannot_remove_owner: 409,
  nothing_to_update: 400,
  invalid_amount: 400,
  insufficient_funds: 409,
  insufficient_family_funds: 409,
  family_inactive: 409,
};

const fail = (res, result) => json(res, CODES[result.error] ?? 400, { error: result.error });

export const familyRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/family')) return false;

  const path = url.split('?')[0];
  const params = new URL(req.url, 'http://x').searchParams;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;

  const readOk = () => rateLimit(`fam:r:${me}`, READ_PER_MIN);
  const writeOk = () => rateLimit(`fam:w:${me}`, WRITE_PER_MIN);
  const body = async () => parseBody(req);

  if (req.method === 'GET' && path === '/api/family/me') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { data: await myFamily(me) });
  }

  if (req.method === 'POST' && path === '/api/family') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await createFamily(me, (await body()).name);
    return done.error ? fail(res, done) : json(res, 201, { data: done });
  }

  if (req.method === 'GET' && path === '/api/family/invitations') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { invitations: await myInvitations(me) });
  }

  const invitePath = path.match(/^\/api\/family\/invitations\/(fi-[0-9a-f-]{36})(\/[a-z]+)?$/);
  if (invitePath) {
    const id = invitePath[1];
    const tail = invitePath[2] ?? '';
    if (req.method === 'POST' && tail === '/accept') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await acceptInvitation(me, id);
      return done.error ? fail(res, done) : json(res, 200, { data: done });
    }
    if (req.method === 'POST' && tail === '/reject') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await rejectInvitation(me, id);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await cancelInvitation(me, id);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  const famPath = path.match(/^\/api\/family\/(fam-[0-9a-f-]{36})(\/[a-z-]+)?$/);
  if (famPath) {
    const familyId = famPath[1];
    const tail = famPath[2] ?? '';

    if (req.method === 'DELETE' && tail === '') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await closeFamily(me, familyId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (tail === '/wallet' && req.method === 'GET') {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await famWallet.getWallet(me, familyId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'POST' && ['/wallet-topup', '/wallet-withdraw', '/wallet-contribute'].includes(tail)) {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const amount = Number(b.amount);
      const done = tail === '/wallet-topup' ? await famWallet.topUp(me, familyId, amount, b.idemKey)
        : tail === '/wallet-withdraw' ? await famWallet.withdraw(me, familyId, amount, b.desc, b.idemKey, b.toProfileId)
          : await famWallet.contribute(me, familyId, amount, b.desc, b.idemKey);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (req.method === 'POST' && tail === '/invite') {
      if (!rateLimitPerHour(`fam:invite:${me}`, INVITE_PER_HOUR)) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await inviteMember(me, familyId, b.recipientId, b.role);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'POST' && tail === '/placeholder') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const b = await body();
      const done = await addPlaceholderMember(me, familyId, b.name, b.role);
      return done.error ? fail(res, done) : json(res, 201, done);
    }

    if (req.method === 'POST' && tail === '/transfer') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await transferOwnership(me, familyId, (await body()).memberId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }

    if (req.method === 'POST' && tail === '/prime') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await purchaseFamilyPrime(me, familyId, (await body()).planId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  if (req.method === 'POST' && path === '/api/family/leave') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    const done = await leaveFamily(me);
    return done.error ? fail(res, done) : json(res, 200, done);
  }

  const memberPath = path.match(/^\/api\/family\/(fam-[0-9a-f-]{36})\/members\/(fm-[0-9a-f-]{36})$/);
  if (memberPath) {
    const [, familyId, memberId] = memberPath;
    if (req.method === 'DELETE') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await removeMember(me, familyId, memberId);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
    if (req.method === 'PATCH') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await updateMember(me, familyId, memberId, await body());
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  if (req.method === 'GET' && path === '/api/family/notifications') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { items: await listNotifications(me, { limit: params.get('limit') }) });
  }
  if (req.method === 'POST' && path === '/api/family/notifications/read') {
    if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
    return json(res, 200, { ok: await readNotification(me, (await body()).id) });
  }

  /* ══ Админка ═══════════════════════════════════════════════════════ */

  if (req.method === 'GET' && path === '/api/family/admin/list') {
    if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
    const items = await adminListFamilies(me, { q: params.get('q'), limit: params.get('limit') });
    if (items === null) return json(res, 403, { error: 'not_allowed' });
    return json(res, 200, { items });
  }

  const adminDetailPath = path.match(/^\/api\/family\/admin\/(fam-[0-9a-f-]{36})(\/status)?$/);
  if (adminDetailPath) {
    const familyId = adminDetailPath[1];
    if (req.method === 'GET' && !adminDetailPath[2]) {
      if (!readOk()) return json(res, 429, { error: 'too_many_requests' });
      const data = await adminFamilyDetail(me, familyId);
      if (data === null) return json(res, 403, { error: 'not_allowed' });
      if (!data.family) return json(res, 404, { error: 'not_found' });
      return json(res, 200, data);
    }
    if (req.method === 'POST' && adminDetailPath[2] === '/status') {
      if (!writeOk()) return json(res, 429, { error: 'too_many_requests' });
      const done = await adminSetFamilyStatus(me, familyId, (await body()).status);
      return done.error ? fail(res, done) : json(res, 200, done);
    }
  }

  return json(res, 404, { error: 'not_found' });
};
