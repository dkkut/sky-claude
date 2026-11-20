/**
 * Sky GO «Для транспорта»:
 *   люди     — /api/go/transport/*   (удобства/топливо/акции карточки, «Мои работы», согласование и отмена клиентом)
 *   владелец — /api/kbiz/transport/* (топливо, удобства, акции, заказ-наряды, оплата, статистика; сотрудники по правам kbstaff)
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as tr from './../gotransport.mjs';
import * as st from './../kbstaff.mjs';
import { audit } from './../kbiz.mjs';

const MULT = Math.max(1, Number(process.env.GOPLACES_RATE_MULT) || 1);
const CODE = { not_found: 404, no_business: 404, not_transport: 409, not_fuel: 409, buyer_not_found: 404, own_place: 403, bad_transition: 409, bad_state: 409, reason_required: 400, too_many_open: 429,
  too_many_promos: 409, price_required: 422, already_paid: 409, no_requisites: 422, forbidden: 403 };
const reply = (res, r, ok = 200) => (!r || !r.error ? json(res, ok, r ?? { ok: true }) : json(res, CODE[r.error] ?? 400, r));

export const goTransportRoutes = async (req, res, url) => {
  const isOwner = url.startsWith('/api/kbiz/transport');
  if (!url.startsWith('/api/go/transport') && !isOwner) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const u = new URL(req.url, 'http://x'); const path = u.pathname; const method = req.method; const me = s.profileId;
  const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `gotr:w:${me}` : `gotr:r:${me}`, (write ? 60 : 300) * MULT)) return json(res, 429, { error: 'rate_limited' });
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  let m;
  try {
    if (isOwner) {
      const acc = await st.accessOf(me);
      if (!acc) return json(res, 404, { error: 'no_business' });
      const own = acc.role === 'owner' ? me : `biz:${acc.businessId}`;
      const group = method === 'GET' ? 'placeview' : /\/(features|promos)/.test(path) ? 'placecard' : 'placeops';
      if (!st.can(acc, group)) return json(res, 403, { error: 'forbidden' });
      if (acc.role !== 'owner' && write) await audit(acc.businessId, me, 'staff_action', `${acc.role}: ${method} ${path.replace(/(gp[a-z])-[0-9a-f-]{36}/g, '$1:id')}`).catch(() => {});
      if (method === 'GET' && path === '/api/kbiz/transport/fuel') return reply(res, await tr.ownerFuelGet(own));
      if (method === 'PUT' && path === '/api/kbiz/transport/fuel') return reply(res, await tr.ownerFuelSet(own, me, (await body()).prices));
      if (method === 'PUT' && path === '/api/kbiz/transport/features') return reply(res, await tr.ownerFeaturesSave(own, (await body()).features));
      if (method === 'GET' && path === '/api/kbiz/transport/catalog') return reply(res, { ok: true, features: tr.FEATURES, fuels: tr.FUELS, workLabels: tr.WORK_LABEL });
      if (method === 'GET' && path === '/api/kbiz/transport/promos') return reply(res, await tr.ownerPromos(own));
      if (method === 'POST' && path === '/api/kbiz/transport/promos') return reply(res, await tr.ownerPromoSave(own, null, await body()), 201);
      if (method === 'PUT' && (m = path.match(/^\/api\/kbiz\/transport\/promos\/(gpp-[0-9a-f-]{36})$/))) return reply(res, await tr.ownerPromoSave(own, m[1], await body()));
      if (method === 'DELETE' && (m = path.match(/^\/api\/kbiz\/transport\/promos\/(gpp-[0-9a-f-]{36})$/))) return reply(res, await tr.ownerPromoDelete(own, m[1]));
      if (method === 'GET' && path === '/api/kbiz/transport/work') return reply(res, await tr.ownerWork(own, Object.fromEntries(u.searchParams)));
      if (method === 'POST' && path === '/api/kbiz/transport/work') return reply(res, await tr.ownerCreateWork(own, me, await body()), 201);
      if (method === 'POST' && (m = path.match(/^\/api\/kbiz\/transport\/work\/(gpw-[0-9a-f-]{36})\/status$/))) { const b = await body(); return reply(res, await tr.setWorkStatus('owner', own, me, m[1], String(b.to ?? ''), b)); }
      if (method === 'POST' && (m = path.match(/^\/api\/kbiz\/transport\/work\/(gpw-[0-9a-f-]{36})\/pay$/))) return reply(res, await tr.ownerRequestPay(own, me, m[1], await body()));
      if (method === 'GET' && path === '/api/kbiz/transport/stats') return reply(res, await tr.ownerTransportStats(own));
      return json(res, 404, { error: 'not_found' });
    }
    if (method === 'GET' && (m = path.match(/^\/api\/go\/transport\/info\/(kbz-[0-9a-f-]{36})$/))) return reply(res, await tr.publicInfo(m[1]));
    if (method === 'GET' && path === '/api/go/transport/work') return reply(res, await tr.myWork(me));
    if (method === 'POST' && (m = path.match(/^\/api\/go\/transport\/work\/(gpw-[0-9a-f-]{36})\/status$/))) { const b = await body(); return reply(res, await tr.setWorkStatus('buyer', me, me, m[1], String(b.to ?? ''), b)); }
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[gotransport]', e.message);
    return json(res, 500, { error: 'server_error' });
  }
};
