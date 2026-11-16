import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta, logAdmin } from './../adminsec.mjs';
import { deviceHash } from './../applock.mjs';
import * as R from './../royalties.mjs';

const STATUS = { not_found: 404, bad_key: 400, bad_period: 400, bad_source: 400, bad_country: 400, bad_amount: 400, bad_value: 400, bad_parts: 400, sum_not_100: 400, unknown_holder: 400,
  not_rightsholder: 403, not_allowed: 403, self_review: 403, period_closed: 409, already_closed: 409, period_not_finished: 409, no_confirmed_revenue: 409, settings_incomplete: 409,
  disabled: 409, proposal_open: 409, not_enrolled: 403, kyc_required: 403, below_minimum: 409, payout_open: 409, too_early: 425, expired: 410, bad_verdict: 400, no_plays: 400, bad_status: 400, bad_action: 400 };
const PURPOSE = 'royalty_owner';

/** Sky Royalties: автору — /api/royalties*, администрации — /api/admin/royalties* (права royalty_*; настройки, закрытие периода и выплаты — только владелец с кодом). */
export const royaltiesRoutes = async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const user = path.startsWith('/api/royalties');
  const admin = path.startsWith('/api/admin/royalties');
  if (!user && !admin) return false;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const b = req.method === 'GET' ? {} : ((await parseBody(req)) ?? {});

  if (user) {
    if (!rateLimit(`roy:${me}`, 240)) return json(res, 429, { error: 'too_many_requests' });
    let m;
    if (req.method === 'POST' && path === '/api/royalties/listen/start') {
      return reply(await R.startListen(me, b.trackId, b.playKey, { deviceHash: deviceHash(req) }));
    }
    if (req.method === 'POST' && path === '/api/royalties/listen/finish') return reply(await R.finishListen(me, b.playKey));
    if (req.method === 'GET' && path === '/api/royalties/cabinet') return json(res, 200, await R.cabinet(me));
    if (req.method === 'POST' && path === '/api/royalties/enroll') return reply(await R.applyEnrollment(me));
    if (req.method === 'POST' && path === '/api/royalties/kyc') return reply(await R.submitKyc(me));
    if (req.method === 'GET' && path === '/api/royalties/estimate') return json(res, 200, await R.estimateMonthly(me));
    if (req.method === 'POST' && path === '/api/royalties/payout') return reply(await R.requestPayout(me, b.idemKey));
    if (req.method === 'POST' && path === '/api/royalties/splits') return reply(await R.proposeSplit(me, b.trackId, b.parts, b.note));
    if (req.method === 'GET' && (m = /^\/api\/royalties\/splits\/([A-Za-z0-9_-]{1,80})$/.exec(path))) return reply(await R.splitHistory(me, m[1]));
    if (req.method === 'POST' && (m = /^\/api\/royalties\/splits\/(\d+)\/(accept|reject|cancel)$/.exec(path))) {
      return reply(m[2] === 'cancel' ? await R.cancelSplit(me, m[1]) : await R.answerSplit(me, m[1], m[2] === 'accept'));
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!rateLimit(`royadm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
  const owner = await isOwner(me);
  const meta = requestMeta(req);
  const view = owner || (await can(me, 'royalty_view'));
  if (!view) return json(res, 403, { error: 'not_allowed' });
  const need = async (perm) => owner || (await can(me, perm));
  const ownerStep = async () => {
    const st = await consumeStepUp(me, PURPOSE, b.stepUpCode, { meta });
    if (st.error) { json(res, st.error === 'step_up_exhausted' ? 429 : 401, st); return false; }
    return true;
  };
  let m;
  if (req.method === 'GET' && path === '/api/admin/royalties') return json(res, 200, { ...(await R.adminOverview()), isOwner: owner });
  if (req.method === 'GET' && path === '/api/admin/royalties/audit') return json(res, 200, await R.verifyAudit());
  if (req.method === 'GET' && (m = /^\/api\/admin\/royalties\/reconcile\/(\d{4}-\d{2})$/.exec(path))) return reply(await R.reconcile(m[1]));
  if (req.method === 'GET' && (m = /^\/api\/admin\/royalties\/suggest\/(\d{4}-\d{2})$/.exec(path))) return reply(await R.suggestPrimeGross(m[1]));
  if (req.method === 'POST' && path === '/api/admin/royalties/step-up') {
    if (!owner) return json(res, 403, { error: 'not_allowed' });
    const r = await beginStepUp(me, PURPOSE, { meta }); return json(res, r.error ? 400 : 200, r);
  }
  if (req.method === 'PUT' && path === '/api/admin/royalties/settings') {
    if (!owner) return json(res, 403, { error: 'not_allowed' });
    if (!(await ownerStep())) return true;
    const r = await R.saveSettings(me, b); if (!r.error) await logAdmin({ actorId: me, targetType: 'royalties', targetId: 'settings', type: 'royalty_settings', detail: Object.keys(r.changed).join(', ') }).catch(() => {});
    return reply(r);
  }
  if (req.method === 'POST' && path === '/api/admin/royalties/revenue') {
    if (!(await need('royalty_finance'))) return json(res, 403, { error: 'not_allowed' });
    return reply(await R.saveRevenue(me, b));
  }
  if (req.method === 'POST' && (m = /^\/api\/admin\/royalties\/revenue\/(\d+)\/confirm$/.exec(path))) {
    if (!(await need('royalty_finance'))) return json(res, 403, { error: 'not_allowed' });
    return reply(await R.confirmRevenue(me, m[1], { owner }));
  }
  if (req.method === 'POST' && (m = /^\/api\/admin\/royalties\/periods\/(\d{4}-\d{2})\/close$/.exec(path))) {
    if (!owner) return json(res, 403, { error: 'not_allowed' });
    if (!(await ownerStep())) return true;
    const r = await R.closePeriod(me, m[1]); if (!r.error) await logAdmin({ actorId: me, targetType: 'royalties', targetId: m[1], type: 'royalty_period_close', detail: m[1] }).catch(() => {});
    return reply(r);
  }
  if (req.method === 'POST' && path === '/api/admin/royalties/review') {
    if (!(await need('royalty_review'))) return json(res, 403, { error: 'not_allowed' });
    return reply(await R.resolveReview(me, b.playIds, b.verdict, b.note));
  }
  if (req.method === 'POST' && path === '/api/admin/royalties/enrollment') {
    if (!(await need('royalty_review'))) return json(res, 403, { error: 'not_allowed' });
    if (b.profileId === me && !owner) return json(res, 403, { error: 'self_review' });
    return reply(await R.decideEnrollment(me, String(b.profileId ?? ''), b.status, b.reason));
  }
  if (req.method === 'POST' && path === '/api/admin/royalties/kyc') {
    if (!(await need('royalty_review'))) return json(res, 403, { error: 'not_allowed' });
    if (b.profileId === me && !owner) return json(res, 403, { error: 'self_review' });
    return reply(await R.setKyc(me, String(b.profileId ?? ''), b.status, b.note));
  }
  if (req.method === 'POST' && (m = /^\/api\/admin\/royalties\/payouts\/(rp-[0-9a-f]+)\/(pay|reject)$/.exec(path))) {
    if (!owner) return json(res, 403, { error: 'not_allowed' });
    if (!(await ownerStep())) return true;
    const r = await R.decidePayout(me, m[1], m[2], b.note); if (!r.error) await logAdmin({ actorId: me, targetType: 'royalties', targetId: m[1], type: `royalty_payout_${m[2]}`, detail: m[1] }).catch(() => {});
    return reply(r);
  }
  return json(res, 404, { error: 'not_found' });
};
