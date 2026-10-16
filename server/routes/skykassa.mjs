/**
 * SkyKassa — маршруты.
 *   /api/skykassa/*          — человек (платежи, способы, данные отправителя, история)
 *   /api/skykassa/webhook/*  — события партнёров (подпись вместо входа)
 *   /api/admin/skykassa/*    — сотрудники и владелец (очередь, проверка, настройки)
 */
import { json, requireProfile, parseBody, clientIp, BadRequest } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { requestMeta } from './../adminsec.mjs';
import { getSettings, STATUS_LABEL } from './../skykassacore.mjs';
import * as U from './../skykassa.mjs';
import * as R from './../skykassareview.mjs';
import * as A from './../skykassaadmin.mjs';
import { handleWebhook } from './../skykassapartners.mjs';

const CODE = {
  not_found: 404, not_allowed: 403, owner_only: 403, self_review: 403, paused: 423, app_disabled: 423,
  too_many_open: 429, step_up_required: 401, step_up_invalid: 401, step_up_exhausted: 429, no_second_factor: 409,
  bad_state: 409, expired: 410, cannot_cancel: 409, processing_error: 500, partner_unreachable: 502, partner_error: 502,
  lockdown: 423,
};
const MULT = Math.max(Number(process.env.SKYKASSA_RATE_MULT) || 1, 1);
const rl = (key, n) => rateLimit(key, n * MULT);
const status = (r) => (r.error ? (CODE[r.error] ?? 400) : 200);
const reply = (res, r) => json(res, status(r), r);

const readRaw = (req) => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) { reject(new BadRequest('payload_too_large')); req.destroy(); } });
  req.on('end', () => resolve(raw));
  req.on('error', reject);
});

export const skyKassaRoutes = async (req, res, url) => {
  if (!url.startsWith('/api/skykassa') && !url.startsWith('/api/admin/skykassa')) return false;
  const path = new URL(req.url, 'http://x').pathname;
  const params = new URL(req.url, 'http://x').searchParams;
  const ip = clientIp(req);

  /* ─── Вебхук партнёра: без входа, с подписью ─── */
  let m = /^\/api\/skykassa\/webhook\/([a-z0-9_-]+)$/.exec(path);
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'method' });
    if (!rl(`skykassa:hook:${ip}`, 120)) return json(res, 429, { error: 'too_many_attempts' });
    const raw = await readRaw(req);
    const r = await handleWebhook(m[1], raw, req.headers);
    return json(res, r.code, r.body);
  }

  const session = await requireProfile(req, res);
  if (!session) return true;
  const me = session.profileId;
  const meta = requestMeta(req);

  /* ─── Сотрудники ─── */
  if (path.startsWith('/api/admin/skykassa')) {
    if (!rl(`skykassa:admin:${me}`, 240)) return json(res, 429, { error: 'too_many_attempts' });
    const rest = path.slice('/api/admin/skykassa'.length);
    const body = req.method === 'GET' || req.method === 'DELETE' ? {} : ((await parseBody(req)) ?? {});

    if (req.method === 'GET' && rest === '/payments') {
      return reply(res, await R.queue(me, { status: params.get('status'), q: params.get('q'), limit: params.get('limit'), offset: params.get('offset') }));
    }
    if (req.method === 'GET' && rest === '/status-labels') return json(res, 200, { labels: STATUS_LABEL });
    if (req.method === 'POST' && rest === '/step-up') {
      if (!rl(`skykassa:stepup:${me}`, 5)) return json(res, 429, { error: 'too_many_attempts' });
      return reply(res, await R.ownerStepUp(me, meta));
    }
    if (req.method === 'POST' && rest === '/settings-step-up') {
      if (!rl(`skykassa:stepup:${me}`, 5)) return json(res, 429, { error: 'too_many_attempts' });
      return reply(res, await R.settingsStepUp(me, meta));
    }
    m = /^\/payments\/([A-Za-z0-9-]+)$/.exec(rest);
    if (req.method === 'GET' && m) {
      if (!rl(`skykassa:detail:${me}`, 60)) return json(res, 429, { error: 'too_many_attempts' });
      return reply(res, await R.detail(me, m[1], meta));
    }
    m = /^\/payments\/([A-Za-z0-9-]+)\/([a-z-]+)$/.exec(rest);
    if (req.method === 'POST' && m) {
      if (m[2] === 'act') return reply(res, await R.act(me, m[1], String(body.action ?? ''), body, meta));
      if (m[2] === 'refund') return reply(res, await R.requestRefund({ actorId: me, asStaff: true }, m[1], body, meta));
    }
    m = /^\/payments\/([A-Za-z0-9-]+)\/refunds\/([A-Za-z0-9-]+)\/([a-z]+)$/.exec(rest);
    if (req.method === 'POST' && m) return reply(res, await R.refundAct(me, m[1], m[2], m[3], body, meta));

    /* настройки (право skykassa_settings) */
    if (req.method === 'GET' && rest === '/overview') return reply(res, await A.overview(me, meta));
    if (req.method === 'PUT' && rest === '/settings') return reply(res, await A.putSettings(me, body, meta));
    if (req.method === 'POST' && rest === '/methods') return reply(res, await A.saveMethod(me, null, body, meta));
    m = /^\/methods\/([A-Za-z0-9_-]+)$/.exec(rest);
    if (m && req.method === 'PUT') return reply(res, await A.saveMethod(me, m[1], body, meta));
    if (m && req.method === 'DELETE') return reply(res, await A.deleteMethod(me, m[1], (await parseBody(req).catch(() => ({}))) ?? {}, meta));
    if (req.method === 'POST' && rest === '/requisites') return reply(res, await A.saveRequisite(me, null, body, meta));
    m = /^\/requisites\/([A-Za-z0-9_-]+)$/.exec(rest);
    if (m && req.method === 'PUT') return reply(res, await A.saveRequisite(me, m[1], body, meta));
    if (m && req.method === 'DELETE') return reply(res, await A.deleteRequisite(me, m[1], (await parseBody(req).catch(() => ({}))) ?? {}, meta));
    m = /^\/requisites\/([A-Za-z0-9_-]+)\/history$/.exec(rest);
    if (m && req.method === 'GET') return reply(res, await A.requisiteHistory(me, m[1]));
    if (req.method === 'POST' && rest === '/partners') return reply(res, await A.savePartner(me, null, body, meta));
    m = /^\/partners\/([a-z0-9_-]+)$/.exec(rest);
    if (m && req.method === 'PUT') return reply(res, await A.savePartner(me, m[1], body, meta));
    if (m && req.method === 'DELETE') return reply(res, await A.deletePartner(me, m[1], (await parseBody(req).catch(() => ({}))) ?? {}, meta));
    m = /^\/partners\/([a-z0-9_-]+)\/check$/.exec(rest);
    if (m && req.method === 'POST') {
      if (!rl(`skykassa:ping:${me}`, 10)) return json(res, 429, { error: 'too_many_attempts' });
      return reply(res, await A.checkPartner(me, m[1], meta));
    }
    return json(res, 404, { error: 'not_found' });
  }

  /* ─── Человек ─── */
  if (!rl(`skykassa:u:${me}`, 120)) return json(res, 429, { error: 'too_many_attempts' });
  const rest = path.slice('/api/skykassa'.length);

  if (req.method === 'GET' && rest === '/config') {
    const s = await getSettings();
    return json(res, 200, { paused: s.paused, message: s.paused ? s.pauseMessage : '', notice: s.notice, minAmount: s.minAmount, maxAmount: s.maxAmount, ttlMinutes: s.ttlMinutes, apps: s.apps });
  }
  if (req.method === 'GET' && rest === '/options') {
    const amount = Number(params.get('amount'));
    const s = await getSettings();
    if (!Number.isSafeInteger(amount) || amount < s.minAmount || amount > s.maxAmount) return json(res, 400, { error: 'bad_amount', min: s.minAmount, max: s.maxAmount });
    const dest = params.get('destination') === 'code' ? 'code' : 'balance';
    return json(res, 200, await U.listOptions({ amount, destination: dest, app: params.get('app') || 'web' }));
  }
  if (req.method === 'GET' && rest === '/payments') return json(res, 200, await U.listOwn(me, { limit: params.get('limit'), offset: params.get('offset') }));
  if (req.method === 'POST' && rest === '/payments') {
    if (!rl(`skykassa:create:${me}`, 10) || !rl(`skykassa:create:ip:${ip}`, 40)) return json(res, 429, { error: 'too_many_attempts' });
    return reply(res, await U.createPayment(me, (await parseBody(req)) ?? {}));
  }
  m = /^\/payments\/([A-Za-z0-9-]+)$/.exec(rest);
  if (req.method === 'GET' && m) return reply(res, await U.viewOwn(me, m[1], { refresh: params.get('refresh') === '1' && rl(`skykassa:refresh:${me}`, 20) }));
  m = /^\/payments\/([A-Za-z0-9-]+)\/([a-z-]+)$/.exec(rest);
  if (req.method === 'POST' && m) {
    const body = (await parseBody(req)) ?? {};
    const [, id, act] = m;
    if (!rl(`skykassa:act:${me}`, 30)) return json(res, 429, { error: 'too_many_attempts' });
    if (act === 'choose') return reply(res, await U.choose(me, id, body));
    if (act === 'sender') return reply(res, await U.saveSender(me, id, body));
    if (act === 'sender-change') return reply(res, await U.changeSender(me, id, body));
    if (act === 'report') return reply(res, await U.report(me, id, body));
    if (act === 'cancel') return reply(res, await U.cancel(me, id, body));
    if (act === 'reply') return reply(res, await U.reply(me, id, body));
    if (act === 'refund') return reply(res, await R.requestRefund({ actorId: me, asStaff: false }, id, body, meta));
    if (act === 'support') return reply(res, await U.openSupport(me, id));
  }
  return json(res, 404, { error: 'not_found' });
};
