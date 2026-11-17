/**
 * Переводы по Sky ID и международные провайдеры.
 *  • /api/wallet/transfer/{lookup,quote}, POST /api/wallet/transfer, GET /api/wallet/history — за замком SkyMoney (путь /api/wallet/);
 *  • /api/admin/p2p* — настройки (владелец, код `p2p_settings`) и метки подозрительного (право `finance`);
 *  • /api/admin/skykassa-intl* — учёт заявок иностранных провайдеров (ничего не подключает).
 */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import { can } from './../admin.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import * as p2p from './../walletp2p.mjs';
import * as intl from './../skykassaintl.mjs';

const CODES = { transfers_disabled: 403, not_found: 404, recipient_unavailable: 409, cannot_send_to_self: 400, bad_currency: 400, invalid_amount: 400, idem_required: 400, amount_too_small: 400, amount_too_large: 400, daily_limit: 429, new_account_limit: 429, too_fast: 429, currency_unavailable: 409, no_account: 404, recipient_no_account: 409, quote_changed: 409, quote_expired: 409, idem_conflict: 409, insufficient_funds: 402, not_allowed: 403, owner_only: 403, code_required: 401, bad_settings: 400, reason_required: 400, checklist_incomplete: 409 };

export const walletP2pRoutes = async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const isUser = p.startsWith('/api/wallet/transfer') || p === '/api/wallet/history';
  const isAdmin = p.startsWith('/api/admin/p2p') || p.startsWith('/api/admin/skykassa-intl');
  if (!isUser && !isAdmin) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const meta = requestMeta(req);
  const reply = (r) => json(res, r.error ? (CODES[r.error] ?? 400) : 200, r);

  if (isUser) {
    if (req.method === 'GET' && p === '/api/wallet/history') {
      if (!rateLimit(`p2phist:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
      const u = new URL(req.url, 'http://x').searchParams;
      return json(res, 200, await p2p.history(me, { currency: u.get('currency') ?? 'ALL', limit: u.get('limit') ?? 50 }));
    }
    const b = req.method === 'POST' ? ((await parseBody(req).catch(() => ({}))) ?? {}) : {};
    if (req.method === 'GET' && p === '/api/wallet/transfer/settings') { const s = await p2p.settings(); return json(res, 200, { enabled: s.enabled, feePercent: s.feePercent, feeMin: s.feeMin, feeMax: s.feeMax, minAmount: s.minAmount, maxAmount: s.maxAmount, dailyLimit: s.dailyLimit }); }
    if (req.method === 'POST' && p === '/api/wallet/transfer/lookup') {
      // Перебор имён для вытягивания данных людей: узкие пределы на отправителя.
      if (!rateLimit(`p2plook:${me}`, 15) || !rateLimitPerHour(`p2plookh:${me}`, 100)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await p2p.lookup(me, b.skyId ?? b.handle));
    }
    if (req.method === 'POST' && p === '/api/wallet/transfer/quote') {
      if (!rateLimit(`p2pquote:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await p2p.quote(me, { recipientId: b.recipientId, currency: b.currency, amount: b.amount }));
    }
    if (req.method === 'POST' && p === '/api/wallet/transfer') {
      if (!rateLimit(`p2pdo:${me}`, 10) || !rateLimitPerHour(`p2pdoh:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await p2p.transfer(me, { recipientId: b.recipientId, currency: b.currency, amount: b.amount, token: b.token, idemKey: b.idemKey, note: b.note }));
    }
    return json(res, 404, { error: 'not_found' });
  }

  if (!(await can(me, 'finance')) && !p.startsWith('/api/admin/skykassa-intl')) return json(res, 403, { error: 'not_allowed' });
  if (!rateLimit(`p2padm:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const b = ['POST', 'PUT'].includes(req.method) ? ((await parseBody(req).catch(() => ({}))) ?? {}) : {};
  if (req.method === 'GET' && p === '/api/admin/p2p') return reply(await p2p.adminFlags(me, { open: new URL(req.url, 'http://x').searchParams.get('all') !== '1' }));
  if (req.method === 'POST' && p === '/api/admin/p2p/review') return reply(await p2p.reviewFlag(me, b.id, b.note));
  if (req.method === 'POST' && p === '/api/admin/p2p/step-up') { const r = await beginStepUp(me, 'p2p_settings', { meta }); return json(res, r.error ? 400 : 200, r); }
  if (req.method === 'PUT' && p === '/api/admin/p2p/settings') {
    const s = await consumeStepUp(me, 'p2p_settings', b.stepUpCode, { meta });
    if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s);
    return reply(await p2p.saveSettings(me, b, { codeOk: true }));
  }
  if (req.method === 'GET' && p === '/api/admin/skykassa-intl') return reply(await intl.list(me));
  if (req.method === 'POST' && p === '/api/admin/skykassa-intl') return reply(await intl.save(me, b));
  if (req.method === 'POST' && p === '/api/admin/skykassa-intl/status') return reply(await intl.setStatus(me, b.id, b.status, b.reason));
  return json(res, 404, { error: 'not_found' });
};
