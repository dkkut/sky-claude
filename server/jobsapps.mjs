/**
 * Sky Работа: отклики и ход найма, переписка с кандидатом, жалобы, администрирование.
 * Статусы отклика: Отправлен → Просмотрен → Приглашение → Собеседование → Предложение → Принят / Отказ. Переходы — только по таблице, меняет работодатель.
 * Переписка привязана к отклику (двое участников); деньги и секреты в сообщениях запрещены, контакты вне Sky работодатель получает только после согласия кандидата.
 */
import { query } from './db.mjs';
import { inTx } from './gocore.mjs';
import { can } from './admin.mjs';
import { logAdmin as adminLog } from './adminsec.mjs';
import { wallet } from './wallet.mjs';
import { checkContent, blockedReply } from './contentfilterstore.mjs';
import { err, clean, line, newId, note, log, scanMessage, settings, dropSettingsCache, blockedProfile, categories, APP_STATUS, REPORT_REASONS, VERIFY_LABEL, _internal } from './jobs.mjs';

const { seal, open, resumeShape, firstName } = _internal;
const adminLogJ = (me, type, detail) => adminLog({ actorId: me, targetType: 'jobs', type: `jobs_${type}`, detail: String(detail ?? '') }).catch(() => {});

/* ─── Отклики соискателя ─── */
export const apply = async (me, vacancyId, body) => {
  if (await blockedProfile(me)) return err('blocked');
  const v = (await query(`SELECT v.id, v.title, c.owner_id, c.name FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE v.id = $1 AND v.status = 'published' AND (v.expires_at IS NULL OR v.expires_at > now()) AND c.status = 'active'`, [String(vacancyId ?? '')])).rows[0];
  if (!v) return err('not_found');
  if (v.owner_id === me) return err('own_vacancy');
  const cover = clean(body?.cover, 2000);
  if (cover && scanMessage(cover, { fromEmployer: false, contactsOpen: true }) ) return err('message_blocked');
  const cf = cover ? await checkContent('job_message', me, [cover]) : null; if (cf?.action === 'block') return blockedReply(cf);
  let resumeId = null;
  if (body?.resumeId) { const r = (await query(`SELECT id FROM job_resumes WHERE id = $1 AND owner_id = $2 AND status = 'active'`, [String(body.resumeId), me])).rows[0]; if (!r) return err('resume_not_found'); resumeId = r.id; }
  if (!resumeId && !cover) return err('resume_or_cover_required');
  if ((await query(`SELECT count(*)::int AS n FROM job_applications WHERE applicant_id = $1 AND created_at > now() - interval '24 hours' AND initiator = 'applicant'`, [me])).rows[0].n >= 30) return err('too_many_requests');
  const id = newId('jap');
  const ins = await query(`INSERT INTO job_applications (id, vacancy_id, applicant_id, resume_id, cover_enc) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (vacancy_id, applicant_id) DO NOTHING`, [id, v.id, me, resumeId, cover ? seal({ text: cover }) : null]);
  if (!ins.rowCount) { const ex = (await query('SELECT id FROM job_applications WHERE vacancy_id = $1 AND applicant_id = $2', [v.id, me])).rows[0]; return { ok: true, duplicate: true, id: ex?.id }; }
  await query(`INSERT INTO job_app_events (application_id, status, actor) VALUES ($1,'sent',$2)`, [id, me]);
  void note(v.owner_id, 'Новый отклик на вакансию', v.title, `jobapp:${id}:new`);
  return { ok: true, id };
};
const appCard = (r) => ({ id: r.id, vacancyId: r.vacancy_id, vacancyTitle: r.title, company: r.company_name, companyVerified: r.verify_status === 'verified', status: r.status, statusLabel: APP_STATUS[r.status], initiator: r.initiator,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), unread: r.unread ?? 0, vacancyClosed: r.vstatus !== 'published' });
export const myApplications = async (me) => {
  const { rows } = await query(`SELECT a.*, v.title, v.status AS vstatus, c.name AS company_name, c.verify_status,
      (SELECT count(*)::int FROM job_messages m WHERE m.application_id = a.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
    FROM job_applications a JOIN job_vacancies v ON v.id = a.vacancy_id JOIN job_companies c ON c.id = v.company_id WHERE a.applicant_id = $1 ORDER BY a.updated_at DESC LIMIT 200`, [me]);
  return { ok: true, applications: rows.map(appCard) };
};

/** Доступ к отклику: кандидат или владелец компании вакансии. */
const loadApp = async (me, id) => {
  const r = (await query(`SELECT a.*, v.title, v.id AS vid, v.status AS vstatus, c.id AS company_id, c.name AS company_name, c.owner_id AS employer_id, c.verify_status, p.name AS applicant_name
    FROM job_applications a JOIN job_vacancies v ON v.id = a.vacancy_id JOIN job_companies c ON c.id = v.company_id JOIN profiles p ON p.id = a.applicant_id WHERE a.id = $1`, [String(id ?? '')])).rows[0];
  if (!r) return null;
  if (r.applicant_id !== me && r.employer_id !== me) return null;
  return { ...r, role: r.employer_id === me ? 'employer' : 'applicant' };
};
const events = async (id) => (await query('SELECT status, note, at FROM job_app_events WHERE application_id = $1 ORDER BY id', [id])).rows.map((e) => ({ status: e.status, label: APP_STATUS[e.status], note: e.note, at: e.at.toISOString() }));
const coverOf = (a) => (a.cover_enc ? open(a.cover_enc).text ?? '' : '');

export const getApplication = async (me, id) => {
  const a = await loadApp(me, id); if (!a) return err('not_found');
  if (a.role === 'employer' && a.status === 'sent') {   // открытие работодателем = «Просмотрен»
    const u = await query(`UPDATE job_applications SET status = 'viewed', updated_at = now() WHERE id = $1 AND status = 'sent'`, [a.id]);
    if (u.rowCount) { await query(`INSERT INTO job_app_events (application_id, status, actor) VALUES ($1,'viewed',$2)`, [a.id, me]); a.status = 'viewed'; void note(a.applicant_id, 'Ваш отклик просмотрен', `${a.company_name}: ${a.title}`, `jobapp:${a.id}:viewed`); }
  }
  let resume = null; let contact = null;
  if (a.resume_id) { const r = (await query('SELECT * FROM job_resumes WHERE id = $1', [a.resume_id])).rows[0]; if (r) { resume = resumeShape(r, true); if (a.role === 'applicant' || a.contacts_shared) contact = open(r.contact_enc); } }
  const base = { id: a.id, role: a.role, vacancyId: a.vid, vacancyTitle: a.title, company: a.company_name, status: a.status, statusLabel: APP_STATUS[a.status], initiator: a.initiator, cover: coverOf(a), contactsShared: a.contacts_shared, events: await events(a.id), createdAt: a.created_at.toISOString() };
  if (a.role === 'employer') return { ok: true, application: { ...base, applicant: { name: firstName(a.applicant_name) }, resume, contact, actions: NEXT[a.status] ?? [] } };
  return { ok: true, application: { ...base, resume: null, contact: null, actions: [] } };
};

const NEXT = { sent: ['invited', 'rejected'], viewed: ['invited', 'interview', 'offer', 'rejected'], invited: ['interview', 'offer', 'rejected'], interview: ['offer', 'rejected', 'hired'], offer: ['hired', 'rejected'], hired: [], rejected: [] };
/** Этап найма — только работодатель, только по таблице переходов; повтор того же статуса безвреден. */
export const setStatus = async (me, id, to, text) => {
  const a = await loadApp(me, id); if (!a || a.role !== 'employer') return err('not_found');
  if (await blockedProfile(me)) return err('blocked');
  if (a.status === to) return { ok: true, duplicate: true, status: to };
  if (!(NEXT[a.status] ?? []).includes(to)) return err('bad_transition', { from: a.status, to });
  const msg = clean(text, 500); if (to === 'rejected' && msg.length < 3) return err('reason_required');
  if (msg && scanMessage(msg, { fromEmployer: true, contactsOpen: a.contacts_shared })) return err('message_blocked');
  const u = await query('UPDATE job_applications SET status = $2, updated_at = now() WHERE id = $1 AND status = $3', [a.id, to, a.status]);
  if (!u.rowCount) return err('conflict');
  await query('INSERT INTO job_app_events (application_id, status, note, actor) VALUES ($1,$2,$3,$4)', [a.id, to, msg, me]);
  void note(a.applicant_id, `${a.company_name}: ${APP_STATUS[to].toLowerCase()}`, `${a.title}${msg ? ` — ${msg}` : ''}`, `jobapp:${a.id}:${to}`);
  return { ok: true, status: to };
};
/** Кандидат открывает или закрывает свои контакты для работодателя в этом отклике. */
export const shareContacts = async (me, id, on) => {
  const a = await loadApp(me, id); if (!a || a.role !== 'applicant') return err('not_found');
  await query('UPDATE job_applications SET contacts_shared = $2 WHERE id = $1', [a.id, Boolean(on)]);
  return { ok: true, shared: Boolean(on) };
};
export const vacancyApplications = async (me, vacancyId, q = {}) => {
  const vals = [me, String(vacancyId ?? '')]; let w = 'c.owner_id = $1 AND v.id = $2';
  if (q.status && q.status in APP_STATUS) { vals.push(q.status); w += ` AND a.status = $${vals.length}`; }
  const { rows } = await query(`SELECT a.*, v.title, v.status AS vstatus, c.name AS company_name, c.verify_status, p.name AS applicant_name, r.position, r.experience_years, r.desired_salary,
      (SELECT count(*)::int FROM job_messages m WHERE m.application_id = a.id AND m.sender_id <> $1 AND m.read_at IS NULL) AS unread
    FROM job_applications a JOIN job_vacancies v ON v.id = a.vacancy_id JOIN job_companies c ON c.id = v.company_id JOIN profiles p ON p.id = a.applicant_id LEFT JOIN job_resumes r ON r.id = a.resume_id WHERE ${w} ORDER BY a.updated_at DESC LIMIT 300`, vals);
  return { ok: true, applications: rows.map((r) => ({ ...appCard(r), name: firstName(r.applicant_name), position: r.position ?? '', experienceYears: r.experience_years, desiredSalary: r.desired_salary })) };
};

/* ─── Переписка ─── */
export const messages = async (me, id) => {
  const a = await loadApp(me, id); if (!a) return err('not_found');
  await query('UPDATE job_messages SET read_at = now() WHERE application_id = $1 AND sender_id <> $2 AND read_at IS NULL', [a.id, me]);
  const rows = (await query('SELECT id, sender_id, body_enc, at FROM job_messages WHERE application_id = $1 ORDER BY id DESC LIMIT 200', [a.id])).rows.reverse();
  return { ok: true, role: a.role, contactsShared: a.contacts_shared, messages: rows.map((m) => ({ id: m.id, mine: m.sender_id === me, text: open(m.body_enc).text ?? '', at: m.at.toISOString() })) };
};
export const sendMessage = async (me, id, text) => {
  const a = await loadApp(me, id); if (!a) return err('not_found');
  if (await blockedProfile(me)) return err('blocked');
  const t = clean(text, 2000); if (!t) return err('empty');
  const open_ = a.contacts_shared || ['interview', 'offer', 'hired'].includes(a.status);
  const bad = scanMessage(t, { fromEmployer: a.role === 'employer', contactsOpen: open_ }); if (bad) return err('message_blocked', { reason: bad });
  const cf = await checkContent('job_message', me, [t]); if (cf.action === 'block') return blockedReply(cf);
  if (a.status === 'rejected' && a.role === 'employer') return err('closed');
  const n = (await query(`SELECT count(*)::int AS n FROM job_messages WHERE application_id = $1 AND sender_id = $2 AND at > now() - interval '10 minutes'`, [a.id, me])).rows[0].n;
  if (n >= 20) return err('too_many_requests');
  await query('INSERT INTO job_messages (application_id, sender_id, body_enc) VALUES ($1,$2,$3)', [a.id, me, seal({ text: cf.maskFields?.[0] ?? t })]);
  const to = a.role === 'employer' ? a.applicant_id : a.employer_id;
  void note(to, `${a.role === 'employer' ? a.company_name : firstName(a.applicant_name)}: новое сообщение`, a.title, `jobmsg:${a.id}:${to}:${Date.now() >> 18}`);   // не чаще раза в ~4 минуты
  return { ok: true };
};

/* ─── Жалобы ─── */
export const report = async (me, type, targetId, reason, text) => {
  if (!['vacancy', 'company', 'resume'].includes(type)) return err('bad_field', { field: 'type' });
  if (!(reason in REPORT_REASONS)) return err('bad_field', { field: 'reason' });
  if (type === 'vacancy' && !(await query('SELECT 1 FROM job_vacancies WHERE id = $1', [String(targetId ?? '')])).rows[0]) return err('not_found');
  if (type === 'company' && !(await query('SELECT 1 FROM job_companies WHERE id = $1', [String(targetId ?? '')])).rows[0]) return err('not_found');
  if (type === 'resume' && !(await query('SELECT 1 FROM job_resumes WHERE id = $1', [String(targetId ?? '')])).rows[0]) return err('not_found');
  if ((await query(`SELECT count(*)::int AS n FROM job_reports WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`, [me])).rows[0].n >= 10) return err('too_many_requests');
  const id = newId('jrp');
  const r = await query(`INSERT INTO job_reports (id, reporter_id, target_type, target_id, reason, text) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [id, me, type, String(targetId), reason, clean(text, 500)]);
  if (!r.rowCount) return { ok: true, duplicate: true };
  void import('./staffnotify.mjs').then((m) => m.notifyStaff('job_report', { title: 'Жалоба в Sky Работа', body: REPORT_REASONS[reason], dedupe: id, except: me })).catch(() => {});
  return { ok: true, id };
};

/* ─── Администрация ─── */
const need = async (me, right = 'jobs') => ((await can(me, right)) ? null : err('not_allowed'));
export const adminOverview = async (me) => {
  const bad = await need(me); if (bad) return bad;
  const g = async (sql) => (await query(sql)).rows;
  const vac = await g(`SELECT status, count(*)::int AS n FROM job_vacancies GROUP BY status`);
  const apps = await g(`SELECT status, count(*)::int AS n FROM job_applications WHERE created_at > now() - interval '30 days' GROUP BY status`);
  const one = async (sql) => (await query(sql)).rows[0];
  const co = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE verify_status='verified')::int AS verified, count(*) FILTER (WHERE verify_status='pending')::int AS pending, count(*) FILTER (WHERE status='blocked')::int AS blocked FROM job_companies`);
  const rs = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE visibility='public')::int AS public, count(*) FILTER (WHERE status='blocked')::int AS blocked FROM job_resumes`);
  const rp = await one(`SELECT count(*)::int AS open FROM job_reports WHERE status = 'open'`);
  const rev = await one(`SELECT COALESCE(sum(paid_rub),0)::int AS vacancies FROM job_vacancies WHERE paid_rub > 0`);
  return { ok: true, vacancies: Object.fromEntries(vac.map((x) => [x.status, x.n])), applications30d: Object.fromEntries(apps.map((x) => [x.status, x.n])), companies: co, resumes: rs, openReports: rp.open, paidVacanciesRub: rev.vacancies,
    canTariffs: (await can(me, 'jobs_tariffs')), settings: await settings(true), ...(await categories({ all: true })) };
};
export const adminVacancies = async (me, q = {}) => {
  const bad = await need(me); if (bad) return bad;
  const vals = []; let w = 'TRUE';
  const st = ['pending', 'published', 'rejected', 'closed', 'blocked', 'draft'].includes(q.status) ? q.status : 'pending'; vals.push(st); w += ` AND v.status = $${vals.length}`;
  if (q.q) { vals.push(`%${String(q.q).replace(/[%_\\]/g, ' ').trim().slice(0, 60)}%`); w += ` AND (v.title ILIKE $${vals.length} OR c.name ILIKE $${vals.length})`; }
  const { rows } = await query(`SELECT v.*, c.name AS company_name, c.verify_status, c.id AS company_id FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE ${w} ORDER BY (cardinality(v.flags) > 0) DESC, v.submitted_at DESC NULLS LAST LIMIT 100`, vals);
  return { ok: true, vacancies: rows.map((r) => ({ id: r.id, title: r.title, company: r.company_name, companyId: r.company_id, verified: r.verify_status === 'verified', status: r.status, flags: r.flags, city: r.city, remote: r.remote, salaryFrom: r.salary_from, salaryTo: r.salary_to, categoryId: r.category_id,
    description: r.description, requirements: r.requirements, conditions: r.conditions, paidRub: r.paid_rub, rejectReason: r.reject_reason, submittedAt: r.submitted_at?.toISOString() ?? null })) };
};
const VNEXT = { approve: [['pending'], 'published'], reject: [['pending'], 'rejected'], block: [['pending', 'published', 'rejected', 'draft'], 'blocked'], unblock: [['blocked'], 'closed'], close: [['published'], 'closed'] };
export const adminDecideVacancy = async (me, id, action, reason) => {
  const bad = await need(me); if (bad) return bad;
  const t = VNEXT[action]; if (!t) return err('bad_action');
  const why = clean(reason, 300); if (['reject', 'block', 'close'].includes(action) && why.length < 5) return err('reason_required');
  const days = (await settings()).vacancyDays;
  const res = await inTx(async (c) => {
    const v = (await c.query(`SELECT v.*, co.owner_id, co.name AS cname FROM job_vacancies v JOIN job_companies co ON co.id = v.company_id WHERE v.id = $1 FOR UPDATE OF v`, [String(id ?? '')])).rows[0]; if (!v) return err('not_found');
    if (v.owner_id === me && action === 'approve') return err('self_review');
    if (v.status === t[1]) return { ok: true, duplicate: true };
    if (!t[0].includes(v.status)) return err('bad_state', { status: v.status });
    await c.query(`UPDATE job_vacancies SET status=$2, reject_reason = CASE WHEN $2 IN ('rejected','blocked','closed') THEN $3 ELSE '' END, moderated_by=$4, moderated_at=now(),
        published_at = CASE WHEN $2 = 'published' THEN now() ELSE published_at END, expires_at = CASE WHEN $2 = 'published' THEN now() + ($5 || ' days')::interval ELSE expires_at END, updated_at=now() WHERE id=$1`, [v.id, t[1], why, me, String(days)]);
    // платная вакансия, отклонённая модерацией, возвращает деньги в той же транзакции (повтор невозможен: статус уже изменён)
    let refunded = 0;
    if (action === 'reject' && v.paid_rub > 0) { const r = await wallet.creditIn(c, v.owner_id, v.paid_rub, 'jobs_refund', `Sky Работа: возврат за вакансию «${v.title}»`, `jobv-refund:${v.id}`); if (!r.error) { refunded = v.paid_rub; await c.query('UPDATE job_vacancies SET paid_rub = 0 WHERE id = $1', [v.id]); } }
    return { ok: true, owner: v.owner_id, title: v.title, refunded };
  });
  if (res.ok && !res.duplicate) {
    await adminLogJ(me, `vacancy_${action}`, `${id}${why ? `: ${why}` : ''}`);
    const T = { approve: 'Вакансия опубликована', reject: 'Вакансия отклонена', block: 'Вакансия заблокирована', unblock: 'Вакансия разблокирована', close: 'Вакансия снята с публикации' }[action];
    void note(res.owner, T, `${res.title}${why ? `. ${why}` : ''}${res.refunded ? ` Возвращено ${res.refunded} ₽.` : ''}`, `jobv:${id}:${action}:${Date.now() >> 10}`);
  }
  return res;
};
export const adminCompanies = async (me, q = {}) => {
  const bad = await need(me); if (bad) return bad;
  const vs = ['pending', 'verified', 'rejected', 'none'].includes(q.verify) ? q.verify : 'pending';
  const { rows } = await query(`SELECT c.*, (SELECT count(*)::int FROM job_vacancies v WHERE v.company_id = c.id AND v.status = 'published') AS live FROM job_companies c WHERE c.verify_status = $1 ORDER BY c.verify_submitted_at DESC NULLS LAST, c.created_at DESC LIMIT 100`, [vs]);
  return { ok: true, companies: rows.map((c) => { const cl = c.verify_claim_enc ? open(c.verify_claim_enc) : {}; return { id: c.id, name: c.name, about: c.about, city: c.city, site: c.site, status: c.status, verifyStatus: c.verify_status, inn: cl.inn ?? '', claim: cl.note ?? '', live: c.live, blockReason: c.block_reason, verifyReason: c.verify_reason }; }) };
};
export const adminDecideCompany = async (me, id, action, reason) => {
  const bad = await need(me); if (bad) return bad;
  const why = clean(reason, 300);
  const c = (await query('SELECT * FROM job_companies WHERE id = $1', [String(id ?? '')])).rows[0]; if (!c) return err('not_found');
  if (c.owner_id === me && ['approve'].includes(action)) return err('self_review');
  if (action === 'approve') { if (c.verify_status === 'verified') return { ok: true, duplicate: true }; await query(`UPDATE job_companies SET verify_status='verified', verified_by=$2, verified_at=now(), verify_reason='', updated_at=now() WHERE id=$1`, [c.id, me]); }
  else if (action === 'reject') { if (why.length < 5) return err('reason_required'); await query(`UPDATE job_companies SET verify_status='rejected', verify_reason=$2, updated_at=now() WHERE id=$1`, [c.id, why]); }
  else if (action === 'block') {
    if (why.length < 5) return err('reason_required');
    await query(`UPDATE job_companies SET status='blocked', block_reason=$2, updated_at=now() WHERE id=$1`, [c.id, why]);
    await query(`UPDATE job_vacancies SET status='blocked', reject_reason=$2, updated_at=now() WHERE company_id=$1 AND status IN ('pending','published')`, [c.id, why]);
  } else if (action === 'unblock') await query(`UPDATE job_companies SET status='active', block_reason='', updated_at=now() WHERE id=$1`, [c.id]);
  else return err('bad_action');
  await adminLogJ(me, `company_${action}`, `${id}${why ? `: ${why}` : ''}`);
  const T = { approve: 'Компания проверена', reject: 'Проверка компании не пройдена', block: 'Компания заблокирована', unblock: 'Компания разблокирована' }[action];
  void note(c.owner_id, T, `${c.name}${why ? `. ${why}` : ''}`, `jobco:${c.id}:${action}:${Date.now() >> 10}`);
  return { ok: true };
};
export const adminReports = async (me, q = {}) => {
  const bad = await need(me); if (bad) return bad;
  const st = ['open', 'resolved', 'dismissed'].includes(q.status) ? q.status : 'open';
  const { rows } = await query(`SELECT * FROM job_reports WHERE status = $1 ORDER BY created_at DESC LIMIT 100`, [st]);
  return { ok: true, reports: rows.map((r) => ({ id: r.id, type: r.target_type, targetId: r.target_id, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason], text: r.text, status: r.status, note: r.note, at: r.created_at.toISOString() })) };
};
/** Сведения о том, на что пожаловались (резюме открывается модератору только по жалобе; открытие пишется в журнал). */
export const adminReportTarget = async (me, id) => {
  const bad = await need(me); if (bad) return bad;
  const r = (await query('SELECT * FROM job_reports WHERE id = $1', [String(id ?? '')])).rows[0]; if (!r) return err('not_found');
  let target = null;
  if (r.target_type === 'vacancy') target = (await adminVacancyById(r.target_id));
  else if (r.target_type === 'company') target = (await query('SELECT id, name, about, site, verify_status, status FROM job_companies WHERE id = $1', [r.target_id])).rows[0] ?? null;
  else { const rs = (await query('SELECT * FROM job_resumes WHERE id = $1', [r.target_id])).rows[0]; if (rs) { target = resumeShape(rs, true); await adminLogJ(me, 'resume_view', `${rs.id} (жалоба ${r.id})`); } }
  return { ok: true, report: { id: r.id, type: r.target_type, reason: REPORT_REASONS[r.reason], text: r.text, status: r.status }, target };
};
const adminVacancyById = async (id) => { const v = (await query('SELECT v.id, v.title, v.description, v.status, v.flags, c.name AS company FROM job_vacancies v JOIN job_companies c ON c.id = v.company_id WHERE v.id = $1', [id])).rows[0]; return v ?? null; };
export const adminResolveReport = async (me, id, action, noteText, blockTarget) => {
  const bad = await need(me); if (bad) return bad;
  const why = clean(noteText, 300);
  const r = (await query('SELECT * FROM job_reports WHERE id = $1', [String(id ?? '')])).rows[0]; if (!r) return err('not_found');
  if (r.reporter_id === me) return err('self_review');
  if (action === 'resolve' && why.length < 5) return err('reason_required');
  const to = action === 'resolve' ? 'resolved' : action === 'dismiss' ? 'dismissed' : null; if (!to) return err('bad_action');
  const u = await query(`UPDATE job_reports SET status=$2, note=$3, handled_by=$4, handled_at=now() WHERE id=$1 AND status='open'`, [r.id, to, why, me]); if (!u.rowCount) return { ok: true, duplicate: true };
  if (to === 'resolved' && blockTarget) {   // блокировка объекта жалобы по решению сотрудника
    if (r.target_type === 'vacancy') await adminDecideVacancy(me, r.target_id, 'block', why);
    else if (r.target_type === 'company') await adminDecideCompany(me, r.target_id, 'block', why);
    else await query(`UPDATE job_resumes SET status='blocked', block_reason=$2, updated_at=now() WHERE id=$1`, [r.target_id, why]);
  }
  await adminLogJ(me, `report_${to}`, `${id}${blockTarget ? ' + блокировка' : ''}`);
  void note(r.reporter_id, 'Жалоба рассмотрена', to === 'resolved' ? 'Мы приняли меры. Спасибо, что помогаете делать Sky безопаснее.' : 'Нарушений не найдено.', `jobrp:${r.id}`);
  return { ok: true };
};
export const adminBlockProfile = async (me, profileId, on, reason) => {
  const bad = await need(me); if (bad) return bad;
  const why = clean(reason, 300);
  if (on) {
    if (why.length < 5) return err('reason_required');
    if (!(await query('SELECT 1 FROM profiles WHERE id = $1', [String(profileId ?? '')])).rows[0]) return err('not_found');
    if (profileId === me) return err('self_review');
    await query('INSERT INTO job_profile_blocks (profile_id, reason, blocked_by) VALUES ($1,$2,$3) ON CONFLICT (profile_id) DO UPDATE SET reason = $2, blocked_by = $3, at = now()', [profileId, why, me]);
    await query(`UPDATE job_vacancies SET status='blocked', reject_reason=$2, updated_at=now() WHERE status IN ('pending','published') AND company_id IN (SELECT id FROM job_companies WHERE owner_id = $1)`, [profileId, why]);
  } else await query('DELETE FROM job_profile_blocks WHERE profile_id = $1', [String(profileId ?? '')]);
  await adminLogJ(me, on ? 'profile_block' : 'profile_unblock', `${profileId}${why ? `: ${why}` : ''}`);
  void note(profileId, on ? 'Доступ к разделу «Работа» ограничен' : 'Доступ к разделу «Работа» восстановлен', why, `jobpb:${profileId}:${on}:${Date.now() >> 10}`);
  return { ok: true };
};
export const adminBlocks = async (me) => {
  const bad = await need(me); if (bad) return bad;
  const { rows } = await query(`SELECT b.profile_id, b.reason, b.at, p.name, p.username FROM job_profile_blocks b JOIN profiles p ON p.id = b.profile_id ORDER BY b.at DESC LIMIT 100`);
  return { ok: true, blocks: rows.map((r) => ({ profileId: r.profile_id, name: r.name, username: r.username, reason: r.reason, at: r.at.toISOString() })) };
};
/** Тарифы и продвижение: только право jobs_tariffs; значения целые и в пределах. */
export const adminSaveSettings = async (me, body) => {
  const bad = await need(me, 'jobs_tariffs'); if (bad) return bad;
  const int = (v, lo, hi) => (Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const f = int(body?.freeVacancies, 0, 100); const vp = int(body?.vacancyPriceRub, 0, 100000); const pp = int(body?.promoPriceRub, 0, 100000); const d = int(body?.vacancyDays, 7, 90);
  if ([f, vp, pp, d].includes(null)) return err('bad_field');
  await query('UPDATE job_settings SET free_vacancies=$1, vacancy_price_rub=$2, promo_price_rub=$3, vacancy_days=$4, resumes_need_verified=$5, updated_at=now() WHERE id', [f, vp, pp, d, body?.resumesNeedVerified !== false]);
  dropSettingsCache();
  await adminLogJ(me, 'settings', `бесплатно ${f}, вакансия ${vp} ₽, продвижение ${pp} ₽, срок ${d} дн.`);
  return { ok: true, settings: await settings(true) };
};
export const adminSaveCategory = async (me, id, body) => {
  const bad = await need(me); if (bad) return bad;
  const name = line(body?.name, 60); if (name.length < 2) return err('bad_field', { field: 'name' });
  const sort = Number.isInteger(Number(body?.sort)) ? Number(body.sort) : 100; const hidden = Boolean(body?.hidden);
  if (id) { const r = await query('UPDATE job_categories SET name=$2, sort=$3, hidden=$4 WHERE id=$1', [id, name, sort, hidden]); if (!r.rowCount) return err('not_found'); }
  else { const nid = `c-${Date.now().toString(36)}`; await query('INSERT INTO job_categories (id, name, sort, hidden) VALUES ($1,$2,$3,$4)', [nid, name, sort, hidden]); id = nid; }
  await adminLogJ(me, 'category', `${id}: ${name}${hidden ? ' (скрыта)' : ''}`);
  return { ok: true, id };
};

/** Уборка (почасовая): истёкшие вакансии закрываются, работодатель получает одно уведомление. */
export const sweepJobs = async () => {
  const { rows } = await query(`UPDATE job_vacancies v SET status='closed', updated_at=now() FROM job_companies c WHERE c.id = v.company_id AND v.status='published' AND v.expires_at < now() RETURNING v.id, v.title, c.owner_id`);
  for (const r of rows) void note(r.owner_id, 'Срок вакансии истёк', `${r.title} снята с публикации. Откройте её заново и отправьте на проверку.`, `jobv:${r.id}:expired`);
  await query(`DELETE FROM job_resume_views WHERE day < CURRENT_DATE - 90`);
  return rows.length;
};
export { VERIFY_LABEL };
