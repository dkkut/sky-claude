/** Sky Life: люди — /api/life/*, администрация — /api/admin/life/* (права `life_admin`, `life_moderation`; личные записи и файлы ей недоступны). */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit, rateLimitPerHour } from './../security.mjs';
import * as L from './../life.mjs';
import * as B from './../lifebiz.mjs';

const STATUS = { not_found: 404, user_not_found: 404, forbidden: 403, not_allowed: 403, restricted: 403, blocked: 403, life_disabled: 503, biz_disabled: 503, limit_reached: 402, storage_limit: 402, posts_limit: 402, prime_required: 402,
  too_large: 413, scan_unavailable: 503, write_failed: 500, malware_detected: 422, secret_not_allowed: 422, file_type_not_allowed: 415, file_type_mismatch: 415, daily_limit: 429, already_sent: 409, bad_state: 409, already_added: 409, exists: 409, already_member: 409, self_review: 403, already_reported: 409, ai_busy: 503, ai_not_configured: 503, ai_budget: 503, ai_service_off: 503, ai_service_limit: 503 };
const readBody = (req, max) => new Promise((resolve) => {
  const declared = Number(req.headers['content-length'] ?? 0); if (declared > max) { req.resume(); return resolve({ error: 'too_large' }); }
  const chunks = []; let n = 0; let over = false;
  req.on('data', (c) => { n += c.length; if (n > max) { over = true; chunks.length = 0; } else if (!over) chunks.push(c); });
  req.on('end', () => resolve(over ? { error: 'too_large' } : { buf: Buffer.concat(chunks) })); req.on('error', () => resolve({ error: 'read_failed' }));
});
const ID = '[a-z]{2}-[0-9a-f-]{36}';

export const lifeRoutes = async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname;
  const user = p.startsWith('/api/life'); const admin = p.startsWith('/api/admin/life');
  if (!user && !admin) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; let m;
  const reply = (r) => json(res, r.error ? STATUS[r.error] ?? 400 : 200, r);
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  const get = req.method === 'GET'; const post = req.method === 'POST'; const put = req.method === 'PUT' || req.method === 'PATCH'; const del = req.method === 'DELETE';
  try {
    if (admin) {
      if (!rateLimit(`lifeadm:${me}`, 120)) return json(res, 429, { error: 'too_many_requests' });
      if (get && p === '/api/admin/life/queue') return reply(await B.adminQueue(me));
      if (get && p === '/api/admin/life/stats') return reply(await B.adminStats(me));
      if (get && p === '/api/admin/life/logs') return reply(await B.adminLogs(me));
      if (get && p === '/api/admin/life/settings') return reply(await B.adminSettings(me));
      if (put && p === '/api/admin/life/settings') return reply(await B.adminSaveSettings(me, await body()));
      if (post && p === '/api/admin/life/categories') return reply(await B.adminCategory(me, await body()));
      if (post && (m = /^\/api\/admin\/life\/(post|profile|project)\/([^/]+)\/decide$/.exec(p))) { const b = await body(); return reply(await B.adminDecide(me, m[1], decodeURIComponent(m[2]), String(b.action ?? ''), b.reason)); }
      if (post && (m = /^\/api\/admin\/life\/reports\/([^/]+)\/decide$/.exec(p))) { const b = await body(); return reply(await B.adminReportDecide(me, m[1], String(b.action ?? ''), b.note)); }
      if (post && p === '/api/admin/life/restrict') { const b = await body(); return reply(await B.adminRestrict(me, String(b.profileId ?? ''), b.days, b.reason, b.lift === true)); }
      return json(res, 404, { error: 'not_found' });
    }
    if (!rateLimit(`life:${me}`, 300)) return json(res, 429, { error: 'too_many_requests' });
    const writes = !get; if (writes && !rateLimit(`lifew:${me}`, 90)) return json(res, 429, { error: 'too_many_requests' });

    /* личное пространство */
    if (get && p === '/api/life/home') return json(res, 200, await L.home(me));
    if (get && p === '/api/life/categories') return json(res, 200, await L.categories(me));
    if (post && p === '/api/life/categories') return reply(await L.addCategory(me, (await body()).name));
    if (del && (m = new RegExp(`^/api/life/categories/(${ID})$`).exec(p))) return reply(await L.removeCategory(me, m[1]));
    if (get && p === '/api/life/items') { const q = Object.fromEntries(u.searchParams); return json(res, 200, await L.listItems(me, q)); }
    if (post && p === '/api/life/items') return reply(await L.createItem(me, await body()));
    if ((m = new RegExp(`^/api/life/items/(${ID})$`).exec(p))) {
      if (get) { const it = await L.getItem(me, m[1]); return it ? json(res, 200, { item: it }) : json(res, 404, { error: 'not_found' }); }
      if (put) return reply(await L.updateItem(me, m[1], await body()));
      if (del) return reply(await L.deleteItem(me, m[1]));
    }
    if (get && p === '/api/life/goals') return json(res, 200, await L.goalsOverview(me));
    if (get && p === '/api/life/stats') return json(res, 200, await L.stats(me));
    if (get && p === '/api/life/analytics') return reply(await L.analytics(me));
    if (get && p === '/api/life/finance') return json(res, 200, await L.finance(me));
    if (get && p === '/api/life/memory/sources') return json(res, 200, await L.memorySources(me));
    if (post && p === '/api/life/memory/import') return reply(await L.importMemory(me, String((await body()).source ?? '')));
    if (get && p === '/api/life/prefs') return json(res, 200, { prefs: await L.getPrefs(me), notifLabels: L.NOTIF, widgets: L.HOME_WIDGETS, limits: await L.limitsOf(me) });
    if (put && p === '/api/life/prefs') return reply(await L.savePrefs(me, await body()));
    if (get && p === '/api/life/audit') return json(res, 200, await L.auditLog(me));
    if (get && p === '/api/life/export') { res.setHeader('Content-Disposition', 'attachment; filename="sky-life-export.json"'); return json(res, 200, await L.exportAll(me)); }
    if (get && p === '/api/life/calendar.ics') { const t = await L.ics(me); res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="sky-life.ics"', 'Cache-Control': 'no-store' }); return res.end(t); }
    if (post && p === '/api/life/erase') { const b = await body(); if (b.confirm !== 'DELETE') return json(res, 400, { error: 'confirm_required' }); if (!rateLimitPerHour(`lifeerase:${me}`, 3)) return json(res, 429, { error: 'too_many_requests' }); return reply(await L.eraseAll(me)); }
    if (post && p === '/api/life/ai') { if (!rateLimit(`lifeai:${me}`, 12)) return json(res, 429, { error: 'too_many_requests' }); return reply(await L.aiAsk(me, await body())); }

    /* файлы */
    if (post && p === '/api/life/files/upload') {
      if (!rateLimit(`lifefile:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' });
      const t = {}; const q = u.searchParams;
      if (q.get('itemId')) t.itemId = q.get('itemId'); else if (q.get('projectId')) t.projectId = q.get('projectId'); else if (q.get('postId')) t.postId = q.get('postId'); else if (q.get('logo') === '1') t.logo = true; else return json(res, 400, { error: 'target_required' });
      if (!(await L.targetAllowed(me, t))) return json(res, 404, { error: 'not_found' });
      const r = await readBody(req, L.FILE_MAX + 1024); if (r.error) return reply(r);
      return reply(await L.saveFile(me, t, q.get('name') ?? '', r.buf));
    }
    if ((m = new RegExp(`^/api/life/files/(lf-[0-9a-f-]{36})$`).exec(p))) {
      if (del) return reply(await L.deleteFile(me, m[1]));
      if (get) {
        const acc = await L.fileAccess(me, m[1]); if (!acc) return json(res, 404, { error: 'not_found' });
        const size = await acc.plainSize().catch(() => acc.size);
        res.writeHead(200, { 'Content-Type': acc.mime, 'Content-Length': size, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(acc.name)}` });
        const st = acc.open(null); st.on('error', () => res.destroy()); res.on('close', () => st.destroy()); st.pipe(res); return true;
      }
    }

    /* проекты */
    if (get && p === '/api/life/projects') return json(res, 200, await B.listProjects(me));
    if (post && p === '/api/life/projects') return reply(await B.createProject(me, await body()));
    if (get && p === '/api/life/projects/public') return json(res, 200, await B.publicProjects());
    if (get && (m = /^\/api\/life\/projects\/by-link\/([A-Za-z0-9_-]{10,40})$/.exec(p))) { if (!rateLimit(`lifelink:${me}`, 20)) return json(res, 429, { error: 'too_many_requests' }); return reply(await B.projectByLink(me, m[1])); }
    if ((m = new RegExp(`^/api/life/projects/(lp-[0-9a-f-]{36})$`).exec(p))) {
      if (get) return reply(await B.getProject(me, m[1])); if (put) return reply(await B.updateProject(me, m[1], await body())); if (del) return reply(await B.deleteProject(me, m[1]));
    }
    if ((m = new RegExp(`^/api/life/projects/(lp-[0-9a-f-]{36})/([a-z-]+)(?:/([^/]+))?$`).exec(p))) {
      const [, id, act, sub] = m; const b = req.method === 'GET' ? {} : await body();
      if (post && act === 'invite') return reply(await B.inviteMember(me, id, String(b.username ?? ''), b.role ?? 'member'));
      if (post && act === 'answer') return reply(await B.answerInvite(me, id, b.accept === true));
      if (put && act === 'members' && sub) return reply(await B.changeMember(me, id, decodeURIComponent(sub), { role: b.role, remove: b.remove === true }));
      if (post && act === 'tasks') return reply(await B.addTask(me, id, b));
      if (put && act === 'tasks' && sub) return reply(await B.updateTask(me, id, sub, b));
      if (get && act === 'messages') return reply(await B.projectMessages(me, id));
      if (post && act === 'messages') return reply(await B.postProjectMessage(me, id, b.text));
      if (post && act === 'budget') return reply(await B.addBudget(me, id, b));
      if (put && act === 'link-post') return reply(await B.linkProjectPost(me, id, b.postId ?? null));
    }

    /* деловые связи */
    if (get && p === '/api/life/biz/overview') return json(res, 200, { notice: B.BIZ_NOTICE, kyc: { available: false }, reasons: B.REPORT_REASONS, ...(await B.myRestriction(me)), ...(await B.getMyBizProfile(me)) });
    if (get && p === '/api/life/biz/profile') return json(res, 200, await B.getMyBizProfile(me));
    if (put && p === '/api/life/biz/profile') return reply(await B.saveBizProfile(me, await body()));
    if (del && p === '/api/life/biz/profile') return reply(await B.unpublishBizProfile(me));
    if (get && p === '/api/life/biz/profiles') return reply(await B.searchProfiles(me, Object.fromEntries(u.searchParams)));
    if (get && (m = /^\/api\/life\/biz\/profiles\/([^/]+)$/.exec(p))) return reply(await B.bizProfilePublic(decodeURIComponent(m[1])));
    if (get && p === '/api/life/biz/search') { if (!rateLimit(`lifesearch:${me}`, 60)) return json(res, 429, { error: 'too_many_requests' }); return reply(await B.searchPosts(me, Object.fromEntries(u.searchParams))); }
    if (get && p === '/api/life/biz/posts') return json(res, 200, await B.myPosts(me));
    if (post && p === '/api/life/biz/posts') return reply(await B.savePost(me, null, await body()));
    if ((m = new RegExp(`^/api/life/biz/posts/(bp-[0-9a-f-]{36})$`).exec(p))) {
      if (get) return reply(await B.postPublic(me, m[1])); if (put) return reply(await B.savePost(me, m[1], await body())); if (del) return reply(await B.deletePost(me, m[1]));
    }
    if (post && (m = new RegExp(`^/api/life/biz/posts/(bp-[0-9a-f-]{36})/(close|favorite|proposal|report)$`).exec(p))) {
      const b = await body();
      if (m[2] === 'close') return reply(await B.closePost(me, m[1]));
      if (m[2] === 'favorite') return reply(await B.toggleFav(me, 'post', m[1]));
      if (m[2] === 'report') return reply(await B.report(me, 'post', m[1], b.reason, b.text));
      if (!rateLimitPerHour(`lifeprop:${me}`, 30)) return json(res, 429, { error: 'too_many_requests' });
      return reply(await B.sendProposal(me, m[1], b.message));
    }
    if (post && (m = /^\/api\/life\/biz\/profiles\/([^/]+)\/(favorite|report)$/.exec(p))) { const b = await body(); const id = decodeURIComponent(m[1]); return reply(m[2] === 'favorite' ? await B.toggleFav(me, 'profile', id) : await B.report(me, 'profile', id, b.reason, b.text)); }
    if (post && (m = /^\/api\/life\/biz\/(proposals|projects)\/([^/]+)\/report$/.exec(p))) { const b = await body(); return reply(await B.report(me, m[1] === 'proposals' ? 'proposal' : 'project', decodeURIComponent(m[2]), b.reason, b.text)); }
    if (get && p === '/api/life/biz/favorites') return json(res, 200, await B.favorites(me));
    if (get && p === '/api/life/biz/contacts') return json(res, 200, await B.contacts(me));
    if (get && p === '/api/life/biz/proposals') return json(res, 200, await B.listProposals(me, u.searchParams.get('box') === 'out' ? 'out' : 'in'));
    if ((m = new RegExp(`^/api/life/biz/proposals/(bq-[0-9a-f-]{36})/([a-z]+)$`).exec(p))) {
      if (get && m[2] === 'history') return reply(await B.proposalHistory(me, m[1]));
      if (post && ['accept', 'decline', 'withdraw'].includes(m[2])) return reply(await B.answerProposal(me, m[1], m[2]));
      if (post && m[2] === 'share') return reply(await B.shareWith(me, m[1], await body()));
    }
  } catch (e) { await L.logError(`${req.method} ${p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')}`, e); return json(res, 500, { error: 'server_error' }); }
  return json(res, 404, { error: 'not_found' });
};
