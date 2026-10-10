/**
 * Sky Codes (server/skycodes.mjs).
 *
 * Пользователь:
 *   POST /api/codes/redeem            { code }
 *   GET  /api/codes/history
 *   GET  /api/codes/coupons
 *
 * Администратор (право 'codes'; создаёт серии только владелец):
 *   POST /api/admin/codes/step-up
 *   POST /api/admin/codes/batches                  создать серию (+ stepUpCode)
 *   GET  /api/admin/codes/batches
 *   GET  /api/admin/codes/batches/:id/codes
 *   GET  /api/admin/codes/batches/:id/export       CSV
 *   POST /api/admin/codes/batches/:id/revoke       { reason } — неиспользованные
 *   POST /api/admin/codes/codes/:id/revoke         { reason }
 *   GET  /api/admin/codes/redemptions
 *   GET  /api/admin/codes/log
 *   GET  /api/admin/codes/items
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta, beginStepUp } from './../adminsec.mjs';
import {
  redeemCode, listMyRedemptions, listMyCoupons, createBatch, listBatches, listCodes,
  listRedemptions, revokeCode, revokeBatchUnused, exportBatchCsv, codesLog, listItemChoices,
  mayCreate, STEP_UP_PURPOSE,
} from './../skycodes.mjs';

const STATUS = {
  invalid_code: 400, bad_input: 400, bad_title: 400, bad_reward: 400, bad_count: 400,
  bad_max_uses: 400, bad_amount: 400, bad_days: 400, bad_item: 400, bad_percent: 400,
  bad_expiry: 400, bound_not_found: 404, bound_needs_single: 400, custom_needs_single: 400,
  bad_custom_code: 400, custom_code_taken: 409, exposure_too_high: 400, reason_required: 400,
  not_allowed: 403, lockdown: 403, unauthorized: 401,
  step_up_required: 401, step_up_invalid: 401, step_up_exhausted: 429, no_second_factor: 409,
  not_found: 404, already_revoked: 409,
  code_expired: 410, code_revoked: 410, code_exhausted: 409, already_redeemed: 409,
  item_already_owned: 409, too_many_attempts: 429, reward_failed: 500, reward_unavailable: 409,
  activation_failed: 500, create_failed: 500, generation_failed: 500,
};

const fail = (res, r) => json(res, STATUS[r.error] ?? 400, r);

export const codesRoutes = async (req, res, url) => {
  const path = url.split('?')[0];
  if (!path.startsWith('/api/codes') && !path.startsWith('/api/admin/codes')) return false;

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const meta = requestMeta(req);

  /* ══ Пользователь ═════════════════════════════════════════════════ */

  if (req.method === 'POST' && path === '/api/codes/redeem') {
    // Два предела: по человеку и по адресу. Подбирают и с одного аккаунта,
    // и перебирая аккаунты с одного адреса.
    if (!rateLimit(`codes:redeem:${me}`, 8) || !rateLimit(`codes:redeem:ip:${meta.ip}`, 30)) {
      return json(res, 429, { error: 'too_many_attempts', retryAfter: 60 });
    }
    const body = await parseBody(req);
    const r = await redeemCode(me, body?.code, { ipHash: meta.ip });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/codes/history') {
    if (!rateLimit(`codes:read:${me}`, 60)) return json(res, 429, { error: 'too_many_attempts' });
    return json(res, 200, { items: await listMyRedemptions(me) });
  }

  if (req.method === 'GET' && path === '/api/codes/coupons') {
    if (!rateLimit(`codes:read:${me}`, 60)) return json(res, 429, { error: 'too_many_attempts' });
    return json(res, 200, { items: await listMyCoupons(me) });
  }

  /* ══ Администратор ════════════════════════════════════════════════ */

  if (!path.startsWith('/api/admin/codes')) return json(res, 404, { error: 'not_found' });
  if (!rateLimit(`codes:admin:${me}`, 120)) return json(res, 429, { error: 'too_many_attempts' });

  if (req.method === 'POST' && path === '/api/admin/codes/step-up') {
    if (!(await mayCreate(me))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`codes:stepup:${me}`, 5)) return json(res, 429, { error: 'too_many_attempts' });
    const r = await beginStepUp(me, STEP_UP_PURPOSE, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'POST' && path === '/api/admin/codes/batches') {
    if (!rateLimit(`codes:create:${me}`, 6)) return json(res, 429, { error: 'too_many_attempts' });
    const body = await parseBody(req);
    const r = await createBatch(me, body ?? {}, { meta });
    return r.error ? fail(res, r) : json(res, 201, r);
  }

  if (req.method === 'GET' && path === '/api/admin/codes/batches') {
    const items = await listBatches(me);
    return items === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { items });
  }

  const sub = /^\/api\/admin\/codes\/batches\/(scb-[0-9a-f-]{36})\/(codes|export|revoke)$/.exec(path);
  if (sub) {
    const [, batchId, action] = sub;
    const params = new URL(req.url, 'http://x').searchParams;
    if (req.method === 'GET' && action === 'codes') {
      const r = await listCodes(me, batchId, {
        status: params.get('status'), limit: params.get('limit'), offset: params.get('offset'),
      });
      if (r === null) return json(res, 403, { error: 'not_allowed' });
      return r.error ? fail(res, r) : json(res, 200, r);
    }
    if (req.method === 'GET' && action === 'export') {
      if (!rateLimit(`codes:export:${me}`, 10)) return json(res, 429, { error: 'too_many_attempts' });
      const r = await exportBatchCsv(me, batchId, { meta });
      if (r.error) return fail(res, r);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${r.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(r.csv);
    }
    if (req.method === 'POST' && action === 'revoke') {
      const body = await parseBody(req);
      const r = await revokeBatchUnused(me, batchId, body?.reason, { meta });
      return r.error ? fail(res, r) : json(res, 200, r);
    }
  }

  const one = /^\/api\/admin\/codes\/codes\/(scd-[0-9a-f-]{36})\/revoke$/.exec(path);
  if (req.method === 'POST' && one) {
    const body = await parseBody(req);
    const r = await revokeCode(me, one[1], body?.reason, { meta });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/admin/codes/redemptions') {
    const params = new URL(req.url, 'http://x').searchParams;
    const r = await listRedemptions(me, {
      batchId: params.get('batchId'), q: params.get('q'), limit: params.get('limit'),
    });
    if (r === null) return json(res, 403, { error: 'not_allowed' });
    return r.error ? fail(res, r) : json(res, 200, r);
  }

  if (req.method === 'GET' && path === '/api/admin/codes/log') {
    const items = await codesLog(me);
    return items === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { items });
  }

  if (req.method === 'GET' && path === '/api/admin/codes/items') {
    const items = await listItemChoices(me);
    return items === null ? json(res, 403, { error: 'not_allowed' }) : json(res, 200, { items });
  }

  return json(res, 404, { error: 'not_found' });
};
