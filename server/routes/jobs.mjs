/**
 * Sky Работа:
 *   люди     — /api/jobs/*        (вакансии, резюме, отклики, переписка, жалобы, компания работодателя)
 *   админка  — /api/admin/jobs/*  (право `jobs`; тарифы — `jobs_tariffs`)
 */
import { json, parseBody, requireProfile } from './../http.mjs';
import { rateLimit } from './../security.mjs';
import * as j from './../jobs.mjs';
import * as a from './../jobsapps.mjs';

const MULT = Math.max(1, Number(process.env.JOBS_RATE_MULT) || 1);
const CODE = { not_found: 404, not_allowed: 403, blocked: 423, no_company: 409, bad_state: 409, bad_transition: 409, conflict: 409, incomplete: 422, vacancy_limit: 402, insufficient_funds: 402, payment_failed: 402, promotion_unavailable: 409,
  consent_required: 422, personal_secret: 422, payment_demand: 422, contact_in_text: 422, content_blocked: 422, message_blocked: 422, secret_in_message: 422, verification_required: 403, own_vacancy: 403, already_exists: 409,
  too_many_requests: 429, too_many_favs: 409, self_review: 403, reason_required: 400, already_verified: 409, closed: 409, vacancy_not_found: 404, resume_not_found: 404, resume_or_cover_required: 422 };
const reply = (res, r, ok = 200) => (!r || !r.error ? json(res, ok, r ?? { ok: true }) : json(res, CODE[r.error] ?? 400, r));

export const jobsRoutes = async (req, res, url) => {
  const admin = url.startsWith('/api/admin/jobs');
  if (!url.startsWith('/api/jobs') && !admin) return false;
  const s = await requireProfile(req, res); if (!s) return true;
  const me = s.profileId; const u = new URL(req.url, 'http://x'); const path = u.pathname; const method = req.method; const write = method !== 'GET' && method !== 'HEAD';
  if (!rateLimit(write ? `jobs:w:${me}` : `jobs:r:${me}`, (write ? 60 : 300) * MULT)) return json(res, 429, { error: 'rate_limited' });
  const body = async () => (await parseBody(req).catch(() => ({}))) ?? {};
  const q = Object.fromEntries(u.searchParams);
  let m;
  try {
    if (admin) {
      if (method === 'GET' && path === '/api/admin/jobs/overview') return reply(res, await a.adminOverview(me));
      if (method === 'GET' && path === '/api/admin/jobs/vacancies') return reply(res, await a.adminVacancies(me, q));
      if (method === 'POST' && (m = path.match(/^\/api\/admin\/jobs\/vacancies\/(jvc-[0-9a-f-]{36})\/(approve|reject|block|unblock|close)$/))) return reply(res, await a.adminDecideVacancy(me, m[1], m[2], (await body()).reason));
      if (method === 'GET' && path === '/api/admin/jobs/companies') return reply(res, await a.adminCompanies(me, q));
      if (method === 'POST' && (m = path.match(/^\/api\/admin\/jobs\/companies\/(jco-[0-9a-f-]{36})\/(approve|reject|block|unblock)$/))) return reply(res, await a.adminDecideCompany(me, m[1], m[2], (await body()).reason));
      if (method === 'GET' && path === '/api/admin/jobs/reports') return reply(res, await a.adminReports(me, q));
      if (method === 'GET' && (m = path.match(/^\/api\/admin\/jobs\/reports\/(jrp-[0-9a-f-]{36})$/))) return reply(res, await a.adminReportTarget(me, m[1]));
      if (method === 'POST' && (m = path.match(/^\/api\/admin\/jobs\/reports\/(jrp-[0-9a-f-]{36})\/(resolve|dismiss)$/))) { const b = await body(); return reply(res, await a.adminResolveReport(me, m[1], m[2], b.note, b.block === true)); }
      if (method === 'GET' && path === '/api/admin/jobs/blocks') return reply(res, await a.adminBlocks(me));
      if (method === 'POST' && path === '/api/admin/jobs/blocks') { const b = await body(); return reply(res, await a.adminBlockProfile(me, b.profileId, b.on !== false, b.reason)); }
      if (method === 'PUT' && path === '/api/admin/jobs/settings') return reply(res, await a.adminSaveSettings(me, await body()));
      if (method === 'POST' && path === '/api/admin/jobs/categories') return reply(res, await a.adminSaveCategory(me, null, await body()), 201);
      if (method === 'PUT' && (m = path.match(/^\/api\/admin\/jobs\/categories\/([\w-]+)$/))) return reply(res, await a.adminSaveCategory(me, m[1], await body()));
      return json(res, 404, { error: 'not_found' });
    }
    if (method === 'GET' && path === '/api/jobs/config') return reply(res, await j.config());
    if (method === 'GET' && path === '/api/jobs/vacancies') return reply(res, await j.searchVacancies(me, q));
    if (method === 'GET' && path === '/api/jobs/my/vacancies') return reply(res, await j.myVacancies(me));
    if (method === 'POST' && path === '/api/jobs/my/vacancies') return reply(res, await j.saveVacancy(me, null, await body()), 201);
    if ((m = path.match(/^\/api\/jobs\/my\/vacancies\/(jvc-[0-9a-f-]{36})$/)) && method === 'PUT') return reply(res, await j.saveVacancy(me, m[1], await body()));
    if (method === 'POST' && (m = path.match(/^\/api\/jobs\/my\/vacancies\/(jvc-[0-9a-f-]{36})\/(submit|close|promote)$/))) return reply(res, await (m[2] === 'submit' ? j.submitVacancy(me, m[1]) : m[2] === 'close' ? j.closeVacancy(me, m[1]) : j.promoteVacancy(me, m[1])));
    if (method === 'GET' && (m = path.match(/^\/api\/jobs\/my\/vacancies\/(jvc-[0-9a-f-]{36})\/applications$/))) return reply(res, await a.vacancyApplications(me, m[1], q));
    if (method === 'GET' && (m = path.match(/^\/api\/jobs\/vacancies\/(jvc-[0-9a-f-]{36})$/))) return reply(res, await j.getVacancy(me, m[1]));
    if ((m = path.match(/^\/api\/jobs\/vacancies\/(jvc-[0-9a-f-]{36})\/fav$/))) { if (method === 'PUT') return reply(res, await j.toggleFav(me, m[1], true)); if (method === 'DELETE') return reply(res, await j.toggleFav(me, m[1], false)); }
    if (method === 'POST' && (m = path.match(/^\/api\/jobs\/vacancies\/(jvc-[0-9a-f-]{36})\/apply$/))) return reply(res, await a.apply(me, m[1], await body()), 201);
    if (method === 'GET' && path === '/api/jobs/company') return reply(res, await j.myCompany(me));
    if (method === 'PUT' && path === '/api/jobs/company') return reply(res, await j.saveCompany(me, await body()));
    if (method === 'POST' && path === '/api/jobs/company/verify') return reply(res, await j.requestVerify(me, await body()));
    if (method === 'GET' && path === '/api/jobs/resume') return reply(res, await j.myResume(me));
    if (method === 'PUT' && path === '/api/jobs/resume') return reply(res, await j.saveResume(me, await body()));
    if (method === 'DELETE' && path === '/api/jobs/resume') return reply(res, await j.deleteResume(me));
    if (method === 'PUT' && path === '/api/jobs/resume/visibility') return reply(res, await j.setResumeVisibility(me, (await body()).visibility));
    if (method === 'GET' && path === '/api/jobs/export') return reply(res, await j.exportMyData(me));
    if (method === 'GET' && path === '/api/jobs/resumes') return reply(res, await j.searchResumes(me, q));
    if (method === 'GET' && (m = path.match(/^\/api\/jobs\/resumes\/(jrs-[0-9a-f-]{36})$/))) return reply(res, await j.openResume(me, m[1]));
    if (method === 'POST' && (m = path.match(/^\/api\/jobs\/resumes\/(jrs-[0-9a-f-]{36})\/invite$/))) { const b = await body(); return reply(res, await j.inviteFromResume(me, m[1], b.vacancyId, b.text), 201); }
    if (method === 'GET' && path === '/api/jobs/applications') return reply(res, await a.myApplications(me));
    if (method === 'GET' && (m = path.match(/^\/api\/jobs\/applications\/(jap-[0-9a-f-]{36})$/))) return reply(res, await a.getApplication(me, m[1]));
    if (method === 'POST' && (m = path.match(/^\/api\/jobs\/applications\/(jap-[0-9a-f-]{36})\/status$/))) { const b = await body(); return reply(res, await a.setStatus(me, m[1], String(b.to ?? ''), b.note)); }
    if (method === 'POST' && (m = path.match(/^\/api\/jobs\/applications\/(jap-[0-9a-f-]{36})\/contacts$/))) return reply(res, await a.shareContacts(me, m[1], (await body()).on === true));
    if (method === 'GET' && (m = path.match(/^\/api\/jobs\/applications\/(jap-[0-9a-f-]{36})\/messages$/))) return reply(res, await a.messages(me, m[1]));
    if (method === 'POST' && (m = path.match(/^\/api\/jobs\/applications\/(jap-[0-9a-f-]{36})\/messages$/))) return reply(res, await a.sendMessage(me, m[1], (await body()).text), 201);
    if (method === 'POST' && path === '/api/jobs/report') { const b = await body(); return reply(res, await a.report(me, b.type, b.targetId, b.reason, b.text), 201); }
    return json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error('[jobs]', e.message);
    return json(res, 500, { error: 'server_error' });
  }
};
