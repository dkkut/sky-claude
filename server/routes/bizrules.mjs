/** Правила Sky Business: людям — /api/business/rules (чтение, подтверждение ознакомления); администрации — /api/admin/business-rules (право `business_rules`). */
import { json, requireProfile, parseBody } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as br from './../bizrules.mjs';

const CODES = { not_allowed: 403, bad_section: 400, not_organization: 403, not_published: 409, bad_title: 400, bad_body: 400, no_draft: 409, change_note_required: 400 };
export const bizRulesRoutes = async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (!p.startsWith('/api/business/rules') && !p.startsWith('/api/admin/business-rules')) return false;
  const session = await requireProfile(req, res); if (!session) return true;
  const me = session.profileId;
  if (!rateLimit(`bizrules:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' });
  const reply = (r) => json(res, r.error ? (CODES[r.error] ?? 400) : 200, r);
  const body = ['POST', 'PUT'].includes(req.method) ? ((await parseBody(req).catch(() => ({}))) ?? {}) : {};
  if (p === '/api/business/rules' && req.method === 'GET') return json(res, 200, await br.publicRules(me));
  if (p === '/api/business/rules/ack' && req.method === 'POST') return reply(await br.acknowledge(me, String(body.section ?? '')));
  if (p === '/api/admin/business-rules' && req.method === 'GET') return reply(await br.adminList(me));
  let m = /^\/api\/admin\/business-rules\/([a-z]+)$/.exec(p);
  if (m && req.method === 'PUT') return reply(await br.adminSaveDraft(me, m[1], body));
  m = /^\/api\/admin\/business-rules\/([a-z]+)\/(publish|history|acks)$/.exec(p);
  if (m && req.method === 'POST' && m[2] === 'publish') return reply(await br.adminPublish(me, m[1], { notify: body.notify !== false }));
  if (m && req.method === 'GET' && m[2] === 'history') return reply(await br.adminHistory(me, m[1]));
  if (m && req.method === 'GET' && m[2] === 'acks') return reply(await br.adminAcks(me, m[1]));
  return json(res, 404, { error: 'not_found' });
};
