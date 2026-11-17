/** Автомодерация каналов: людям — жалоба (/api/channel-mod/report) и статус/апелляция владельца; модераторам — /api/admin/channel-mod* (право `channel_mod`). */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import { beginStepUp, consumeStepUp, requestMeta } from './../adminsec.mjs';
import * as cm from './../chanmod.mjs';

const CODES = { not_allowed: 403, not_found: 404, bad_reason: 400, own_channel: 403, not_member: 403, too_many_reports: 429, already_reported: 409, bad_state: 409, self_review: 403, reason_required: 400, not_serious: 409, confirm_required: 400, bad_action: 400, bad_settings: 400, owner_only: 403, code_required: 401, appeal_too_short: 400, appeal_open: 409, only_owner_can_appeal: 403, too_many_appeals: 429 };
export const chanModRoutes = async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (!p.startsWith('/api/channel-mod') && !p.startsWith('/api/admin/channel-mod')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId; const meta = requestMeta(req);
  if (!rateLimit(`chanmod:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (CODES[r.error] ?? 400) : 200, r);
  const b = ['POST', 'PUT'].includes(req.method) ? ((await parseBody(req).catch(() => ({}))) ?? {}) : {};
  const u = new URL(req.url, 'http://x').searchParams;
  if (req.method === 'GET' && p === '/api/channel-mod/reasons') return json(res, 200, { reasons: cm.REPORT_REASONS });
  if (req.method === 'POST' && p === '/api/channel-mod/report') return reply(await cm.report(me, b.chatId, b.reason));
  if (req.method === 'GET' && p === '/api/channel-mod/mine') return json(res, 200, await cm.ownerCases(me));
  let m = /^\/api\/channel-mod\/cases\/([^/]+)\/appeal$/.exec(p);
  if (m && req.method === 'POST') return reply(await cm.appealCase(me, m[1], b.text));
  if (req.method === 'GET' && p === '/api/admin/channel-mod') return reply({ ...(await cm.queue(me, { status: u.get('status') ?? 'review' })), settings: await cm.getSettings(), categories: cm.CATEGORIES });
  if (req.method === 'POST' && p === '/api/admin/channel-mod/step-up') { const r = await beginStepUp(me, 'chan_mod_settings', { meta }); return json(res, r.error ? 400 : 200, r); }
  if (req.method === 'PUT' && p === '/api/admin/channel-mod/settings') {
    let codeOk = false;
    if (b.stepUpCode) { const s = await consumeStepUp(me, 'chan_mod_settings', b.stepUpCode, { meta }); if (s.error) return json(res, s.error === 'step_up_exhausted' ? 429 : 401, s); codeOk = true; }
    return reply(await cm.saveSettings(me, b, { codeOk }));
  }
  m = /^\/api\/admin\/channel-mod\/cases\/([^/]+)(?:\/(decide|appeal))?$/.exec(p);
  if (m && req.method === 'GET' && !m[2]) return reply(await cm.detail(me, m[1]));
  if (m && req.method === 'POST' && m[2] === 'decide') return reply(await cm.decide(me, m[1], b));
  if (m && req.method === 'POST' && m[2] === 'appeal') return reply(await cm.decideCaseAppeal(me, m[1], b));
  return json(res, 404, { error: 'not_found' });
};
