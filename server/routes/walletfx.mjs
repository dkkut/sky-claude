/**
 * Валютные счета SkyMoney: /api/wallet/fx* (за замком SkyMoney — это путь /api/wallet/) и курсы в админке: /api/admin/fx-rates.
 * Курсы задаёт только владелец с кодом подтверждения (`fx_rates`); смотреть — право `finance`. Логика — walletfx.mjs.
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { can, isOwner } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta, logAdmin } from './../adminsec.mjs';
import * as fx from './../walletfx.mjs';

const CODES = { source_unavailable: 502, source_no_data: 409, bad_currency: 400, bad_direction: 400, invalid_amount: 400, idem_required: 400, amount_out_of_range: 400, amount_too_small: 400, currency_unavailable: 409, too_many_accounts: 409, not_empty: 409, no_account: 404, not_found: 404, rate_changed: 409, insufficient_funds: 402 };

export const walletFxRoutes = async (req, res, url) => {
  const p = new URL(req.url, 'http://x').pathname;

  if (p === '/api/admin/fx-rates' || p === '/api/admin/fx-rates/step-up' || p === '/api/admin/fx-rates/refresh') {
    const session = await requireProfile(req, res); if (!session) return true;
    const me = session.profileId; const meta = requestMeta(req);
    if (!(await can(me, 'finance'))) return json(res, 403, { error: 'not_allowed' });
    if (!rateLimit(`fxadm:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
    if (req.method === 'GET' && p === '/api/admin/fx-rates') return json(res, 200, { rates: await fx.adminRates(), analytics: await fx.analytics(), canEdit: await isOwner(me) });
    if (!(await isOwner(me))) return json(res, 403, { error: 'owner_only' });
    if (req.method === 'POST' && p === '/api/admin/fx-rates/refresh') {
      if (!rateLimit(`fxrefresh:${me}`, 6)) return json(res, 429, { error: 'too_many_requests' });
      const r = await fx.refreshFromCbr();
      if (!r.error) await logAdmin({ actorId: me, type: 'fx_rates_refresh', targetType: 'system', detail: `обновлено: ${r.updated.join(', ') || 'ничего'}`, meta });
      return json(res, r.error ? 502 : 200, r);
    }
    if (req.method === 'POST' && p.endsWith('/step-up')) { const r = await beginStepUp(me, 'fx_rates', { meta }); return json(res, r.error ? 400 : 200, r); }
    if (req.method === 'PUT') {
      const b = (await parseBody(req)) ?? {};
      const s = await consumeStepUp(me, 'fx_rates', b.stepUpCode, { meta });
      if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
      const r = await fx.saveRates(me, b.rates, { confirmBig: b.confirmBig === true });
      if (!r.error) await logAdmin({ actorId: me, type: 'fx_rates', targetType: 'system', detail: `курсы: ${r.changed.join(', ')}`, meta });
      return json(res, r.error ? 400 : 200, r);
    }
    return json(res, 405, { error: 'method' });
  }

  if (!p.startsWith('/api/wallet/fx')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const uid = session.profileId;
  if (!rateLimit(`walletfx:${uid}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (CODES[r.error] ?? 400) : 200, r);

  if (req.method === 'GET' && p === '/api/wallet/fx') return json(res, 200, { ...(await fx.overview(uid)), history: await fx.history(uid, 30) });
  const b = req.method === 'POST' ? ((await parseBody(req).catch(() => ({}))) ?? {}) : {};
  if (req.method === 'POST' && p === '/api/wallet/fx/open') return reply(await fx.openAccount(uid, String(b.currency ?? '')));
  if (req.method === 'POST' && p === '/api/wallet/fx/close') return reply(await fx.closeAccount(uid, String(b.currency ?? '')));
  if (req.method === 'POST' && p === '/api/wallet/fx/convert') {
    return reply(await fx.convert(uid, { currency: String(b.currency ?? ''), direction: String(b.direction ?? ''), amount: Number(b.amount), expect: b.expect === undefined ? NaN : Number(b.expect), idemKey: b.idemKey }));
  }
  return json(res, 404, { error: 'not_found' });
};
