/**
 * Sky Life: проекты (Sky Projects) и деловые связи (Sky Business Connection, Sky Match), модерация и админка.
 * Деловые данные — отдельно от личных: личные записи отсюда не читаются. Контакты и скрытые финансовые параметры открываются
 * только решением автора предложения после принятия сотрудничества. Sky не проверяет проекты и инвесторов: «проверено» и «гарантированно» писать нельзя.
 * Sky KYC в проекте нет — подтверждение личности не отображается и не имитируется.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { newId, clean, encJson, decJson, hasSecret, limitsOf, notifyLife, audit, settings, forgetSettings, removeFileBlob } from './life.mjs';
import { encryptSecret, decryptSecret, macOf } from './crypto.mjs';

const line = (v, max) => clean(v, max).replace(/\s+/g, ' ');
const list = (v, n = 10, m = 40) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => line(x, m).toLowerCase()).filter(Boolean))].slice(0, n);
const nameOf = async (id) => (await query('SELECT name, username FROM profiles WHERE id = $1', [id])).rows[0] ?? null;

/* ─── Проекты ─────────────────────────────────────────────────────── */
const VIS = ['private', 'members', 'public', 'link'];
const logP = (pid, actor, action) => query('INSERT INTO life_project_log (project_id, actor_id, action) VALUES ($1,$2,$3)', [pid, actor, action]).catch(() => {});
export const projectAccess = async (me, pid) => {
  const p = (await query('SELECT * FROM life_projects WHERE id = $1', [String(pid)])).rows[0]; if (!p) return null;
  if (p.owner_id === me) return { p, role: 'owner' };
  const m = (await query(`SELECT role, status FROM life_project_members WHERE project_id = $1 AND profile_id = $2`, [p.id, me])).rows[0];
  if (m?.status === 'active' && !p.blocked) return { p, role: m.role };
  if (m?.status === 'invited') return { p, role: 'invited' };
  return { p, role: null };
};
const canEdit = (role) => ['owner', 'manager'].includes(role);
const canWork = (role) => ['owner', 'manager', 'member'].includes(role);
const pubView = (p) => ({ id: p.id, title: p.pub_title, summary: p.pub_summary, status: p.status, ownerId: p.owner_id });

export const createProject = async (me, b) => {
  if (!(await settings()).enabled) return { error: 'life_disabled' };
  const lim = await limitsOf(me);
  if ((await query(`SELECT count(*)::int AS c FROM life_projects WHERE owner_id = $1 AND status <> 'archived'`, [me])).rows[0].c >= lim.projects) return { error: 'limit_reached', limit: lim.projects, prime: lim.prime };
  const title = line(b.title, 120); if (title.length < 3) return { error: 'bad_title' };
  const data = { title, idea: clean(b.idea, 4000), plan: clean(b.plan, 4000) };
  if (hasSecret(`${data.title}\n${data.idea}\n${data.plan}`)) return { error: 'secret_not_allowed' };
  const id = newId('lp');
  await query('INSERT INTO life_projects (id, owner_id, data_enc) VALUES ($1,$2,$3)', [id, me, encJson(data)]);
  await logP(id, me, 'created'); await audit(me, me, 'project_created');
  if (b.visibility && b.visibility !== 'private') { const r = await updateProject(me, id, { visibility: b.visibility, pubTitle: b.pubTitle, pubSummary: b.pubSummary }); if (r.error) return { ok: true, id, warning: r.error }; return { ...r, id }; }
  return { ok: true, id };
};
export const updateProject = async (me, id, b) => {
  const a = await projectAccess(me, id); if (!a?.role || a.role === 'invited') return { error: 'not_found' }; if (!canEdit(a.role)) return { error: 'forbidden' };
  const p = a.p; let data = decJson(p.data_enc) ?? {}; const set = ['updated_at = now()']; const args = [p.id]; const put = (c, v) => { args.push(v); set.push(`${c} = $${args.length}`); };
  for (const k of ['title', 'idea', 'plan']) if (k in b) data[k] = k === 'title' ? line(b[k], 120) : clean(b[k], 4000);
  if (!data.title || data.title.length < 3) return { error: 'bad_title' };
  if (hasSecret(`${data.title}\n${data.idea}\n${data.plan}`)) return { error: 'secret_not_allowed' };
  put('data_enc', encJson(data));
  let linkToken = null;
  if ('status' in b) { if (!['active', 'paused', 'done', 'archived'].includes(b.status)) return { error: 'bad_status' }; put('status', b.status); }
  const vis = 'visibility' in b ? String(b.visibility) : p.visibility;
  if ('visibility' in b || 'pubTitle' in b || 'pubSummary' in b) {
    if (a.role !== 'owner') return { error: 'forbidden' }; if (!VIS.includes(vis)) return { error: 'bad_visibility' };
    const pt = 'pubTitle' in b ? line(b.pubTitle, 120) : (p.pub_title ?? ''); const ps = 'pubSummary' in b ? clean(b.pubSummary, 1500) : (p.pub_summary ?? '');
    if (['public', 'link'].includes(vis)) {
      if (pt.length < 3 || ps.length < 10) return { error: 'public_fields_required' };
      if (hasSecret(`${pt}\n${ps}`) || CONTACT_RX.test(`${pt}\n${ps}`) || CLAIM_RX.test(`${pt}\n${ps}`)) return { error: 'public_text_not_allowed' };
    }
    put('visibility', vis); put('pub_title', pt || null); put('pub_summary', ps || null);
    if (vis === 'link') { linkToken = crypto.randomBytes(18).toString('base64url'); put('link_hash', macOf('lifelink', linkToken)); } else { set.push('link_hash = NULL'); }
  }
  await query(`UPDATE life_projects SET ${set.join(', ')} WHERE id = $1`, args);
  await logP(p.id, me, 'updated'); await audit(p.owner_id, me, 'project_updated', p.id);
  return { ok: true, ...(linkToken ? { linkToken } : {}) };
};
export const listProjects = async (me) => {
  const rows = (await query(`SELECT p.*, COALESCE(m.role, 'owner') AS my_role, m.status AS my_status,
    (SELECT count(*) FROM life_project_tasks t WHERE t.project_id = p.id) AS tasks, (SELECT count(*) FROM life_project_tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done
    FROM life_projects p LEFT JOIN life_project_members m ON m.project_id = p.id AND m.profile_id = $1
    WHERE p.owner_id = $1 OR (m.profile_id = $1 AND m.status IN ('invited','active')) ORDER BY p.updated_at DESC LIMIT 200`, [me])).rows;
  return { projects: rows.filter((p) => !p.blocked || p.owner_id === me).map((p) => ({ id: p.id, title: decJson(p.data_enc)?.title ?? '', status: p.status, visibility: p.visibility, role: p.owner_id === me ? 'owner' : p.my_role, invited: p.my_status === 'invited', blocked: p.blocked, tasks: Number(p.tasks), done: Number(p.done), linkedPostId: p.linked_post_id })) };
};
export const getProject = async (me, id) => {
  const a = await projectAccess(me, id); if (!a?.role) return { error: 'not_found' };
  if (a.role === 'invited') return { ok: true, invited: true, project: { id: a.p.id, title: decJson(a.p.data_enc)?.title ?? '' } };
  const p = a.p; const d = decJson(p.data_enc) ?? {};
  const members = (await query(`SELECT m.profile_id, m.role, m.status, pr.name, pr.username FROM life_project_members m JOIN profiles pr ON pr.id = m.profile_id WHERE m.project_id = $1 AND m.status IN ('invited','active') ORDER BY m.created_at`, [p.id])).rows;
  const owner = await nameOf(p.owner_id);
  const tasks = (await query('SELECT * FROM life_project_tasks WHERE project_id = $1 ORDER BY created_at', [p.id])).rows.map((t) => ({ id: t.id, ...(decJson(t.data_enc) ?? {}), status: t.status, assigneeId: t.assignee_id, dueAt: t.due_at, createdBy: t.created_by }));
  const bud = (await query('SELECT * FROM life_project_budget WHERE project_id = $1 ORDER BY created_at', [p.id])).rows.map((b) => ({ id: b.id, kind: b.kind, amountRub: Number(b.amount_rub), label: decryptSecret(b.label_enc) ?? '' }));
  const sum = (k) => bud.filter((x) => x.kind === k).reduce((s, x) => s + x.amountRub, 0);
  const files = (await query(`SELECT id, name_enc, mime, bytes FROM life_files WHERE project_id = $1 ORDER BY created_at`, [p.id])).rows.map((f) => ({ id: f.id, name: decryptSecret(f.name_enc) ?? 'файл', mime: f.mime, bytes: Number(f.bytes) }));
  const log = (await query('SELECT l.action, l.at, pr.name FROM life_project_log l LEFT JOIN profiles pr ON pr.id = l.actor_id WHERE l.project_id = $1 ORDER BY l.at DESC LIMIT 60', [p.id])).rows;
  return { ok: true, role: a.role, project: { id: p.id, ownerId: p.owner_id, owner, title: d.title, idea: d.idea, plan: d.plan, status: p.status, visibility: p.visibility, pubTitle: p.pub_title, pubSummary: p.pub_summary, linkedPostId: p.linked_post_id, blocked: p.blocked },
    members: members.map((m) => ({ id: m.profile_id, name: m.name, username: m.username, role: m.role, status: m.status })), tasks, budget: { items: bud, planRub: sum('plan'), actualRub: sum('actual') }, files, log };
};
export const deleteProject = async (me, id) => {
  const a = await projectAccess(me, id); if (a?.role !== 'owner') return { error: a?.role ? 'forbidden' : 'not_found' };
  for (const f of (await query('SELECT id FROM life_files WHERE project_id = $1', [id])).rows) await removeFileBlob(f.id);
  await query('DELETE FROM life_projects WHERE id = $1', [id]); await audit(me, me, 'project_deleted'); return { ok: true };
};
export const projectByLink = async (me, token) => {
  const p = (await query('SELECT * FROM life_projects WHERE link_hash = $1 AND visibility = $2 AND NOT blocked', [macOf('lifelink', String(token)), 'link'])).rows[0]; if (!p) return { error: 'not_found' };
  return { ok: true, project: pubView(p) };
};
export const publicProjects = async () => ({ projects: (await query(`SELECT * FROM life_projects WHERE visibility = 'public' AND NOT blocked AND status = 'active' AND pub_title IS NOT NULL ORDER BY updated_at DESC LIMIT 60`)).rows.map(pubView) });

export const inviteMember = async (me, id, username, role = 'member') => {
  const a = await projectAccess(me, id); if (!a?.role) return { error: 'not_found' }; if (!canEdit(a.role)) return { error: 'forbidden' };
  if (!['manager', 'member', 'viewer'].includes(role)) return { error: 'bad_role' }; if (role === 'manager' && a.role !== 'owner') return { error: 'forbidden' };
  const u = (await query('SELECT id, name FROM profiles WHERE lower(username) = lower($1)', [String(username).replace(/^@/, '')])).rows[0]; if (!u) return { error: 'user_not_found' };
  if (u.id === a.p.owner_id) return { error: 'is_owner' };
  if ((await query(`SELECT count(*)::int AS c FROM life_project_members WHERE project_id = $1 AND status IN ('invited','active')`, [id])).rows[0].c >= 30) return { error: 'too_many_members' };
  if ((await query(`SELECT 1 FROM life_restrictions WHERE profile_id = $1 AND (until IS NULL OR until > now())`, [me])).rowCount) return { error: 'restricted' };
  const ex = (await query('SELECT status FROM life_project_members WHERE project_id = $1 AND profile_id = $2', [id, u.id])).rows[0]; if (ex && ex.status !== 'removed') return { error: 'already_member' };
  await query(`INSERT INTO life_project_members (project_id, profile_id, role, status, invited_by) VALUES ($1,$2,$3,'invited',$4) ON CONFLICT (project_id, profile_id) DO UPDATE SET role = $3, status = 'invited', invited_by = $4, created_at = now()`, [id, u.id, role, me]);
  await logP(id, me, `invited:${u.name}`); await notifyLife(u.id, 'invites', 'Приглашение в проект', 'Вас пригласили в проект в Sky Life. Откройте «Мои проекты», чтобы принять или отклонить.', id);
  return { ok: true };
};
export const answerInvite = async (me, id, accept) => {
  const m = (await query(`SELECT status FROM life_project_members WHERE project_id = $1 AND profile_id = $2`, [id, me])).rows[0]; if (m?.status !== 'invited') return { error: 'not_found' };
  await query(`UPDATE life_project_members SET status = $3 WHERE project_id = $1 AND profile_id = $2`, [id, me, accept ? 'active' : 'removed']); await logP(id, me, accept ? 'joined' : 'declined'); return { ok: true };
};
export const changeMember = async (me, id, profileId, o) => {
  const a = await projectAccess(me, id); if (!a?.role) return { error: 'not_found' };
  if (profileId === me && o.remove) { await query(`UPDATE life_project_members SET status = 'removed' WHERE project_id = $1 AND profile_id = $2`, [id, me]); await logP(id, me, 'left'); return { ok: true }; }
  if (!canEdit(a.role)) return { error: 'forbidden' }; if (profileId === a.p.owner_id) return { error: 'forbidden' };
  const t = (await query('SELECT role FROM life_project_members WHERE project_id = $1 AND profile_id = $2', [id, profileId])).rows[0]; if (!t) return { error: 'not_found' };
  if (t.role === 'manager' && a.role !== 'owner') return { error: 'forbidden' };
  if (o.remove) { await query(`UPDATE life_project_members SET status = 'removed' WHERE project_id = $1 AND profile_id = $2`, [id, profileId]); await query('UPDATE life_project_tasks SET assignee_id = NULL WHERE project_id = $1 AND assignee_id = $2', [id, profileId]); await logP(id, me, 'removed_member'); return { ok: true }; }
  if (o.role) { if (!['manager', 'member', 'viewer'].includes(o.role) || (o.role === 'manager' && a.role !== 'owner')) return { error: 'forbidden' }; await query('UPDATE life_project_members SET role = $3 WHERE project_id = $1 AND profile_id = $2', [id, profileId, o.role]); await logP(id, me, `role:${o.role}`); }
  return { ok: true };
};
export const addTask = async (me, id, b) => {
  const a = await projectAccess(me, id); if (!a?.role || a.role === 'invited') return { error: 'not_found' }; if (!canWork(a.role)) return { error: 'forbidden' };
  const title = line(b.title, 200); if (title.length < 2) return { error: 'bad_title' }; if (hasSecret(title + (b.description ?? ''))) return { error: 'secret_not_allowed' };
  if ((await query('SELECT count(*)::int AS c FROM life_project_tasks WHERE project_id = $1', [id])).rows[0].c >= 500) return { error: 'too_many_tasks' };
  let assignee = null; if (b.assigneeId) { const ok = b.assigneeId === a.p.owner_id || (await query(`SELECT 1 FROM life_project_members WHERE project_id = $1 AND profile_id = $2 AND status = 'active' AND role <> 'viewer'`, [id, b.assigneeId])).rowCount; if (!ok) return { error: 'bad_assignee' }; assignee = String(b.assigneeId); }
  const due = b.dueAt ? new Date(b.dueAt) : null; if (due && Number.isNaN(due.getTime())) return { error: 'bad_date' };
  const tid = newId('lt'); await query('INSERT INTO life_project_tasks (id, project_id, data_enc, assignee_id, due_at, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [tid, id, encJson({ title, description: clean(b.description, 2000) }), assignee, due, me]);
  await logP(id, me, 'task_added'); if (assignee && assignee !== me) await notifyLife(assignee, 'invites', 'Новая задача в проекте', 'Вам назначена задача в проекте Sky Life.', id);
  return { ok: true, id: tid };
};
export const updateTask = async (me, id, tid, b) => {
  const a = await projectAccess(me, id); if (!a?.role || a.role === 'invited') return { error: 'not_found' };
  const t = (await query('SELECT * FROM life_project_tasks WHERE id = $1 AND project_id = $2', [tid, id])).rows[0]; if (!t) return { error: 'not_found' };
  const mine = t.assignee_id === me || t.created_by === me; if (!(canEdit(a.role) || (a.role === 'member' && mine))) return { error: 'forbidden' };
  if (b.delete) { if (!(canEdit(a.role) || t.created_by === me)) return { error: 'forbidden' }; await query('DELETE FROM life_project_tasks WHERE id = $1', [tid]); await logP(id, me, 'task_deleted'); return { ok: true }; }
  const set = []; const args = [tid]; const put = (c, v) => { args.push(v); set.push(`${c} = $${args.length}`); };
  if ('status' in b) { if (!['open', 'doing', 'done'].includes(b.status)) return { error: 'bad_status' }; put('status', b.status); set.push(b.status === 'done' ? 'done_at = now()' : 'done_at = NULL'); }
  if ('dueAt' in b) { const d = b.dueAt ? new Date(b.dueAt) : null; if (d && Number.isNaN(d.getTime())) return { error: 'bad_date' }; put('due_at', d); }
  if ('assigneeId' in b) { if (!canEdit(a.role)) return { error: 'forbidden' }; if (b.assigneeId) { const ok = b.assigneeId === a.p.owner_id || (await query(`SELECT 1 FROM life_project_members WHERE project_id = $1 AND profile_id = $2 AND status = 'active' AND role <> 'viewer'`, [id, b.assigneeId])).rowCount; if (!ok) return { error: 'bad_assignee' }; } put('assignee_id', b.assigneeId || null); }
  if ('title' in b || 'description' in b) { const d = decJson(t.data_enc) ?? {}; if ('title' in b) d.title = line(b.title, 200); if ('description' in b) d.description = clean(b.description, 2000); if (!d.title || hasSecret(`${d.title}${d.description}`)) return { error: 'bad_title' }; put('data_enc', encJson(d)); }
  if (set.length) await query(`UPDATE life_project_tasks SET ${set.join(', ')} WHERE id = $1`, args); await logP(id, me, 'task_updated'); return { ok: true };
};
export const projectMessages = async (me, id) => {
  const a = await projectAccess(me, id); if (!a?.role || a.role === 'invited') return { error: 'not_found' };
  const rows = (await query(`SELECT m.id, m.author_id, m.text_enc, m.created_at, pr.name FROM life_project_msgs m LEFT JOIN profiles pr ON pr.id = m.author_id WHERE m.project_id = $1 ORDER BY m.created_at DESC LIMIT 100`, [id])).rows.reverse();
  return { messages: rows.map((m) => ({ id: m.id, authorId: m.author_id, author: m.name, text: decryptSecret(m.text_enc) ?? '', at: m.created_at })) };
};
export const postProjectMessage = async (me, id, text) => {
  const a = await projectAccess(me, id); if (!a?.role || a.role === 'invited') return { error: 'not_found' }; if (!canWork(a.role)) return { error: 'forbidden' };
  const t = clean(text, 2000); if (!t) return { error: 'empty' }; if (hasSecret(t)) return { error: 'secret_not_allowed' };
  await query('INSERT INTO life_project_msgs (id, project_id, author_id, text_enc) VALUES ($1,$2,$3,$4)', [newId('lm'), id, me, encryptSecret(t)]); return { ok: true };
};
export const addBudget = async (me, id, b) => {
  const a = await projectAccess(me, id); if (!a?.role || a.role === 'invited') return { error: 'not_found' }; if (!canEdit(a.role)) return { error: 'forbidden' };
  if (b.delete) { await query('DELETE FROM life_project_budget WHERE id = $1 AND project_id = $2', [String(b.delete), id]); await logP(id, me, 'budget_deleted'); return { ok: true }; }
  const label = line(b.label, 120); const amt = Math.round(Number(b.amountRub)); if (label.length < 2) return { error: 'bad_title' }; if (!['plan', 'actual'].includes(b.kind)) return { error: 'bad_kind' }; if (!Number.isFinite(amt) || amt < 0 || amt > 1e11) return { error: 'bad_amount' };
  await query('INSERT INTO life_project_budget (id, project_id, label_enc, kind, amount_rub, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [newId('lb'), id, encryptSecret(label), b.kind, amt, me]); await logP(id, me, 'budget_added'); return { ok: true };
};
export const linkProjectPost = async (me, id, postId) => {
  const a = await projectAccess(me, id); if (a?.role !== 'owner') return { error: a?.role ? 'forbidden' : 'not_found' };
  if (postId) { const ok = (await query('SELECT 1 FROM life_biz_posts WHERE id = $1 AND owner_id = $2', [postId, me])).rowCount; if (!ok) return { error: 'not_found' }; }
  await query('UPDATE life_projects SET linked_post_id = $2, updated_at = now() WHERE id = $1', [id, postId || null]); if (postId) await query('UPDATE life_biz_posts SET project_id = $2 WHERE id = $1', [postId, id]); await logP(id, me, postId ? 'linked_post' : 'unlinked_post'); return { ok: true };
};

/* ─── Деловые связи ───────────────────────────────────────────────── */
export const BIZ_NOTICE = 'Sky не проверяет проекты, инвесторов и партнёров и не гарантирует достоверность предложений, доходность или результат. Не переводите деньги незнакомым людям, не платите за «доступ» к инвестору и проверяйте договорённости самостоятельно. Подтверждение личности (KYC) в Sky Life пока не подключено.';
const CLAIM_RX = /(гарантированн[\p{L}]*\s+(доход|прибыл|возврат|результат)|без\s+риска|100\s?%\s*(доход|прибыл|возврат|гарант)|гарантия\s+возврата|(проверенн[\p{L}]+|официально\s+проверен[\p{L}]+)\s+(инвестиц|проект|инвестор)|sky\s+(проверил|гарантир))/iu;
const SUSPECT_RX = /(предоплат|вложи[\p{L}]*\s+и\s+получ|удво[\p{L}]+|утро[\p{L}]+\s+(вложен|деньги)|пассивн[\p{L}]+\s+доход|быстр[\p{L}]+\s+заработ|переведи[\p{L}]*\s+(мне|на\s+карт)|пирамид|закрыт[\p{L}]+\s+клуб)/iu;
const CONTACT_RX = /([\w.+-]+@[\w-]+\.[\w.]{2,}|(?:\+?\d[\s().-]*){10,}|t\.me\/|wa\.me\/|https?:\/\/(?:www\.)?(?:vk\.com\/id|instagram|facebook)\S*)/i;
const restricted = async (me) => (await query('SELECT reason FROM life_restrictions WHERE profile_id = $1 AND (until IS NULL OR until > now())', [me])).rows[0];
const links = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((u) => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password; } catch { return false; } }).slice(0, 8).map((u) => u.slice(0, 300));
const STAGES = ['idea', 'mvp', 'launch', 'growth', 'scale'];
const COOP = ['equity', 'revenue_share', 'salary', 'contract', 'barter', 'any'];

const profileFields = (b) => ({
  name: line(b.name, 80), country: line(b.country, 60), city: line(b.city, 60), industries: list(b.industries), experience: clean(b.experience, 1500), skills: list(b.skills, 20), interests: list(b.interests),
  about: clean(b.about, 3000), projects: (Array.isArray(b.projects) ? b.projects : []).slice(0, 8).map((x) => ({ title: line(x?.title, 100), url: links([x?.url])[0] ?? null })).filter((x) => x.title),
  skyBusinessUrl: links([b.skyBusinessUrl])[0] ?? null, coop: list(b.coop).filter((x) => COOP.includes(x)), format: ['remote', 'offline', 'both'].includes(b.format) ? b.format : null,
});
export const getMyBizProfile = async (me) => { const r = (await query('SELECT * FROM life_biz_profiles WHERE owner_id = $1', [me])).rows[0]; if (!r) return { profile: null }; const logo = (await query(`SELECT id FROM life_files WHERE owner_id = $1 AND scope = 'bizlogo' LIMIT 1`, [me])).rows[0]; return { profile: { ...r.data, contact: r.contact_enc ? decJson(r.contact_enc) : '', status: r.status, reason: r.reason, logoFileId: logo?.id ?? null } }; };
export const saveBizProfile = async (me, b) => {
  const s = await settings(); if (!s.enabled || !s.biz_enabled) return { error: 'biz_disabled' }; if (await restricted(me)) return { error: 'restricted' };
  const f = profileFields(b); if (f.name.length < 2) return { error: 'bad_name' };
  const pub = JSON.stringify(f); if (hasSecret(pub)) return { error: 'secret_not_allowed' }; if (CONTACT_RX.test(`${f.about}\n${f.experience}\n${f.name}`)) return { error: 'contact_in_public_text' }; if (CLAIM_RX.test(pub)) return { error: 'claims_not_allowed' };
  const contact = line(b.contact, 300); const status = b.publish ? 'pending' : 'draft';
  const prev = (await query('SELECT status FROM life_biz_profiles WHERE owner_id = $1', [me])).rows[0];
  await query(`INSERT INTO life_biz_profiles (owner_id, data, contact_enc, status) VALUES ($1,$2,$3,$4) ON CONFLICT (owner_id) DO UPDATE SET data = $2, contact_enc = $3, status = CASE WHEN life_biz_profiles.status = 'blocked' THEN 'blocked' ELSE $4 END, reason = NULL, updated_at = now()`,
    [me, f, contact ? encJson(contact) : null, status]);
  if (status === 'pending' && prev?.status !== 'pending') void notifyStaff('life_review', { title: 'Деловая карточка на проверке', body: 'Новая карточка в Sky Life ждёт проверки.', dedupe: `prof:${me}:${Date.now() / 3600000 | 0}`, except: me });
  await audit(me, me, 'biz_profile_saved'); return { ok: true, status };
};
export const unpublishBizProfile = async (me) => { await query(`UPDATE life_biz_profiles SET status = 'draft', updated_at = now() WHERE owner_id = $1 AND status IN ('published','pending')`, [me]); return { ok: true }; };

const POST_PUBLIC = {
  common: ['industry', 'city', 'country', 'remote', 'summary', 'stage', 'coop'],
  partner: ['idea', 'state', 'skillsNeeded', 'duties', 'roles', 'financeTerms'],
  cofounder: ['idea', 'state', 'skillsNeeded', 'duties', 'roles', 'financeTerms', 'commitment'],
  investor_ask: ['projectName', 'description', 'problem', 'audience', 'revenue', 'amountNeeded', 'equityPct', 'useOfFunds', 'model', 'forecast', 'presentationNote'],
  investor: ['industries', 'amountMin', 'amountMax', 'stages', 'geo', 'investType', 'models', 'terms'],
};
const HIDEABLE = ['revenue', 'amountNeeded', 'equityPct', 'forecast', 'amountMin', 'amountMax', 'financeTerms'];
const NUMF = ['revenue', 'amountNeeded', 'amountMin', 'amountMax'];
const TEXTF = ['summary', 'idea', 'state', 'duties', 'roles', 'financeTerms', 'projectName', 'description', 'problem', 'audience', 'useOfFunds', 'model', 'forecast', 'presentationNote', 'terms', 'commitment', 'city', 'country', 'investType'];
const LISTF = ['industry', 'coop', 'skillsNeeded', 'industries', 'stages', 'geo', 'models'];
const shapePost = (kind, b) => {
  const allowed = [...POST_PUBLIC.common, ...POST_PUBLIC[kind]]; const out = {};
  for (const k of allowed) {
    if (!(k in b)) continue; const v = b[k];
    if (NUMF.includes(k)) { if (v === '' || v == null) continue; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e13) return { error: 'bad_amount' }; out[k] = Math.round(n); }
    else if (k === 'equityPct') { if (v === '' || v == null) continue; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'bad_equity' }; out[k] = Math.round(n * 100) / 100; }
    else if (k === 'remote') out[k] = v === true;
    else if (k === 'stage') { if (v && !STAGES.includes(v)) return { error: 'bad_stage' }; if (v) out[k] = v; }
    else if (LISTF.includes(k)) out[k] = list(v, 15).filter((x) => k !== 'stages' || STAGES.includes(x)).filter((x) => k !== 'coop' || COOP.includes(x));
    else if (TEXTF.includes(k)) out[k] = clean(v, k === 'summary' || k === 'description' ? 4000 : 1500);
  }
  return out;
};
const postRow = (p, extra = {}) => ({ id: p.id, ownerId: p.owner_id, kind: p.kind, title: p.title, data: p.data, hidden: p.hidden, status: p.status, reason: p.reason, projectId: p.project_id, createdAt: p.created_at, publishedAt: p.published_at, riskFlags: p.risk_flags, ...extra });

export const savePost = async (me, id, b) => {
  const s = await settings(); if (!s.enabled || !s.biz_enabled) return { error: 'biz_disabled' }; if (await restricted(me)) return { error: 'restricted' };
  let kind = String(b.kind ?? ''); let prev = null;
  if (id) { prev = (await query('SELECT * FROM life_biz_posts WHERE id = $1 AND owner_id = $2', [id, me])).rows[0]; if (!prev) return { error: 'not_found' }; kind = prev.kind; if (prev.status === 'blocked') return { error: 'blocked' }; }
  if (!POST_PUBLIC[kind] || kind === 'common') return { error: 'bad_kind' };
  const title = line(b.title, 140); if (title.length < 5) return { error: 'bad_title' };
  const data = shapePost(kind, b); if (data.error) return data;
  const hidden = [...new Set((Array.isArray(b.hidden) ? b.hidden : []).map(String))].filter((k) => HIDEABLE.includes(k) && k in data);
  const pub = { ...data }; const priv = { contact: line(b.contact, 300) }; for (const k of hidden) { priv[k] = pub[k]; delete pub[k]; }
  const all = JSON.stringify([title, data]); if (hasSecret(all)) return { error: 'secret_not_allowed' };
  if (CLAIM_RX.test(all)) return { error: 'claims_not_allowed' };
  if (CONTACT_RX.test(`${title}\n${JSON.stringify(pub)}`)) return { error: 'contact_in_public_text' };
  const flags = SUSPECT_RX.test(all) ? ['suspicious_wording'] : [];
  const submit = b.submit === true;
  if (submit) { if (!(pub.summary ?? pub.description ?? '').trim() || String(pub.summary ?? pub.description ?? '').length < 30) return { error: 'summary_too_short' }; if (!priv.contact) return { error: 'contact_required' }; }
  if (!prev || (submit && prev.status !== 'pending' && prev.status !== 'published')) { const lim = await limitsOf(me); const c = (await query(`SELECT count(*)::int AS c FROM life_biz_posts WHERE owner_id = $1 AND status IN ('pending','published') AND id <> $2`, [me, id ?? ''])).rows[0].c; if (submit && c >= lim.posts) return { error: 'posts_limit', limit: lim.posts, prime: lim.prime }; if (!prev && (await query(`SELECT count(*)::int AS c FROM life_biz_posts WHERE owner_id = $1 AND status <> 'closed'`, [me])).rows[0].c >= lim.posts * 3) return { error: 'posts_limit', limit: lim.posts * 3 }; }
  const status = submit ? 'pending' : (prev && ['published', 'pending'].includes(prev.status) ? 'pending' : 'draft');
  if (prev) await query(`UPDATE life_biz_posts SET title = $3, data = $4, private_enc = $5, hidden = $6, risk_flags = $7, status = $8, reason = NULL, updated_at = now() WHERE id = $1 AND owner_id = $2`, [prev.id, me, title, pub, encJson(priv), JSON.stringify(hidden), JSON.stringify(flags), status]);
  else { const nid = newId('bp'); await query('INSERT INTO life_biz_posts (id, owner_id, kind, title, data, private_enc, hidden, risk_flags, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [nid, me, kind, title, pub, encJson(priv), JSON.stringify(hidden), JSON.stringify(flags), status]); id = nid; }
  if (status === 'pending') void notifyStaff('life_review', { title: flags.length ? 'Предложение с подозрительными формулировками' : 'Новое деловое предложение', body: 'Публикация в Sky Life ждёт проверки.', dedupe: `post:${id}:${Date.now() / 600000 | 0}`, except: me });
  await audit(me, me, submit ? 'post_submitted' : 'post_saved', kind); return { ok: true, id, status, flags };
};
export const closePost = async (me, id) => { const r = await query(`UPDATE life_biz_posts SET status = 'closed', updated_at = now() WHERE id = $1 AND owner_id = $2 AND status <> 'blocked' RETURNING id`, [id, me]); return r.rowCount ? { ok: true } : { error: 'not_found' }; };
export const deletePost = async (me, id) => {
  for (const f of (await query('SELECT id FROM life_files WHERE post_id = $1 AND owner_id = $2', [id, me])).rows) await removeFileBlob(f.id);
  const r = await query('DELETE FROM life_biz_posts WHERE id = $1 AND owner_id = $2 RETURNING id', [id, me]); await query('UPDATE life_projects SET linked_post_id = NULL WHERE linked_post_id = $1', [id]); return r.rowCount ? { ok: true } : { error: 'not_found' };
};
export const myPosts = async (me) => {
  const rows = (await query('SELECT * FROM life_biz_posts WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 100', [me])).rows;
  const out = [];
  for (const p of rows) { const priv = p.private_enc ? decJson(p.private_enc) : {}; const files = (await query('SELECT id, name_enc, mime, bytes FROM life_files WHERE post_id = $1', [p.id])).rows.map((f) => ({ id: f.id, name: decryptSecret(f.name_enc) ?? 'файл', mime: f.mime, bytes: Number(f.bytes) }));
    const props = (await query(`SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*)::int AS total FROM life_biz_proposals WHERE post_id = $1`, [p.id])).rows[0];
    out.push(postRow(p, { private: priv, files, proposals: props })); }
  return { posts: out };
};

/* ─── Sky Match: совместимость только по реально заполненным параметрам ─ */
const inter = (a, b) => a.filter((x) => b.includes(x));
const overlap = (a, b) => (a.length && b.length ? inter(a, b).length / Math.min(a.length, b.length) : null);
const RU = { idea: 'идея', mvp: 'MVP', launch: 'запуск', growth: 'рост', scale: 'масштабирование' };
export const traitsOf = (profile, post) => {
  const pd = profile ?? {}; const d = post?.data ?? {}; const priv = post?.priv ?? {};
  const industries = [...new Set([...(d.industry ?? []), ...(d.industries ?? []), ...(pd.industries ?? [])])];
  return {
    industries, skills: pd.skills ?? [], needs: d.skillsNeeded ?? [], interests: pd.interests ?? [], city: (d.city || pd.city || '').toLowerCase(), country: (d.country || pd.country || '').toLowerCase(), remote: d.remote === true || pd.format === 'remote' || pd.format === 'both',
    stages: d.stages?.length ? d.stages : (d.stage ? [d.stage] : []), coop: [...new Set([...(d.coop ?? []), ...(pd.coop ?? [])])],
    need: d.amountNeeded ?? priv.amountNeeded ?? null, min: d.amountMin ?? priv.amountMin ?? null, max: d.amountMax ?? priv.amountMax ?? null,
  };
};
/** Сравнение двух наборов. Возвращает {pct, reasons, confidence} или {pct:null, reason} при нехватке данных. */
export const compat = (a, b) => {
  const parts = [];
  const add = (w, s, yes, no) => { if (s == null) return; parts.push({ w, s, text: s >= 0.5 ? yes : no }); };
  const io = overlap(a.industries, b.industries); add(25, io, `Общие сферы: ${inter(a.industries, b.industries).join(', ')}`, 'Сферы деятельности почти не совпадают');
  const cover = (need, have) => (need.length && have.length ? inter(need, have).length / need.length : null);
  const c1 = cover(b.needs, a.skills); const c2 = cover(a.needs, b.skills);
  const cs = [c1, c2].filter((x) => x != null); if (cs.length) { const s = cs.reduce((x, y) => x + y, 0) / cs.length; parts.push({ w: 25, s, text: s >= 0.5 ? `Навыки закрывают нужды: ${[...inter(b.needs, a.skills), ...inter(a.needs, b.skills)].join(', ')}` : 'Нужные навыки закрыты слабо' }); }
  else { const sk = overlap(a.skills.concat(a.interests), b.skills.concat(b.interests)); add(10, sk, `Общие навыки и интересы: ${inter(a.skills.concat(a.interests), b.skills.concat(b.interests)).join(', ')}`, 'Навыки и интересы мало пересекаются'); }
  if ((a.city || a.country) && (b.city || b.country)) { const g = a.city && a.city === b.city ? 1 : a.country && a.country === b.country ? 0.6 : (a.remote || b.remote) ? 0.5 : 0; parts.push({ w: 15, s: g, text: g === 1 ? 'Один город' : g === 0.6 ? 'Одна страна' : g === 0.5 ? 'Возможно сотрудничество удалённо' : 'Разная география' }); }
  const st = overlap(a.stages, b.stages); add(15, st, `Подходящая стадия: ${inter(a.stages, b.stages).map((x) => RU[x] ?? x).join(', ')}`, 'Стадии проекта не совпадают');
  const co = overlap(a.coop, b.coop); add(10, co, 'Совпадает тип сотрудничества', 'Типы сотрудничества различаются');
  const fin = (need, min, max) => (need != null && (min != null || max != null) ? (need >= (min ?? 0) && need <= (max ?? Infinity) ? 1 : (min != null && need < min ? Math.max(0, 1 - (min - need) / min) : (max != null ? Math.max(0, 1 - (need - max) / need) : 0))) : null);
  const f = fin(a.need, b.min, b.max) ?? fin(b.need, a.min, a.max); add(20, f, 'Сумма входит в диапазон инвестора', 'Сумма вне заявленного диапазона инвестора');
  const total = parts.reduce((s, x) => s + x.w, 0);
  if (parts.length < 2 || total < 40) return { pct: null, reason: 'Недостаточно заполненных параметров для расчёта', confidence: total };
  const pct = Math.round((parts.reduce((s, x) => s + x.w * x.s, 0) / total) * 100);
  return { pct, reasons: parts.sort((x, y) => y.w * y.s - x.w * x.s).map((x) => ({ ok: x.s >= 0.5, text: x.text })), confidence: Math.min(100, Math.round((total / 110) * 100)) };
};
const TAB_KIND = { partners: 'partner', cofounders: 'cofounder', investors: 'investor', investees: 'investor_ask' };
const MY_KIND = { partners: 'partner', cofounders: 'cofounder', investors: 'investor_ask', investees: 'investor' };
const parseP = (p) => ({ data: p.data, priv: {} });
export const searchPosts = async (me, o = {}) => {
  const s = await settings(); if (!s.biz_enabled) return { error: 'biz_disabled' };
  const tab = TAB_KIND[o.tab] ? o.tab : 'partners'; const lim = await limitsOf(me);
  const myProfile = (await query('SELECT data FROM life_biz_profiles WHERE owner_id = $1', [me])).rows[0]?.data ?? null;
  const myPost = (await query(`SELECT data, private_enc FROM life_biz_posts WHERE owner_id = $1 AND kind = $2 AND status <> 'closed' ORDER BY updated_at DESC LIMIT 1`, [me, MY_KIND[o.tab] ?? 'partner'])).rows[0];
  const mine = traitsOf(myProfile, myPost ? { data: myPost.data, priv: myPost.private_enc ? decJson(myPost.private_enc) : {} } : null);
  const rows = (await query(`SELECT p.*, bp.data AS prof, bp.status AS prof_status, pr.name AS pname FROM life_biz_posts p LEFT JOIN life_biz_profiles bp ON bp.owner_id = p.owner_id LEFT JOIN profiles pr ON pr.id = p.owner_id
    WHERE p.status = 'published' AND p.kind = $1 AND p.owner_id <> $2 AND NOT EXISTS (SELECT 1 FROM life_restrictions r WHERE r.profile_id = p.owner_id AND (r.until IS NULL OR r.until > now())) ORDER BY p.published_at DESC LIMIT 400`, [TAB_KIND[tab], me])).rows;
  const favs = new Set((await query(`SELECT target_id FROM life_biz_favs WHERE owner_id = $1 AND target_type = 'post'`, [me])).rows.map((r) => r.target_id));
  const q = line(o.q, 60).toLowerCase(); const ind = line(o.industry, 40).toLowerCase(); const city = line(o.city, 60).toLowerCase(); const country = line(o.country, 60).toLowerCase();
  let out = rows.map((p) => {
    const prof = p.prof_status === 'published' ? p.prof : null; const t = traitsOf(prof, parseP(p)); const m = compat(mine, t);
    return { ...postRow(p, { hidden: undefined, riskFlags: undefined }), owner: { id: p.owner_id, name: prof?.name ?? p.pname, hasCard: Boolean(prof), city: prof?.city ?? null, country: prof?.country ?? null }, match: m, favorite: favs.has(p.id), _t: t };
  });
  if (q) out = out.filter((x) => `${x.title} ${JSON.stringify(x.data)} ${x.owner.name}`.toLowerCase().includes(q));
  if (ind) out = out.filter((x) => x._t.industries.some((i) => i.includes(ind)));
  if (city) out = out.filter((x) => x._t.city.includes(city)); if (country) out = out.filter((x) => x._t.country.includes(country));
  if (o.stage && STAGES.includes(o.stage)) out = out.filter((x) => x._t.stages.includes(o.stage));
  if (o.remote === 'true' || o.remote === true) out = out.filter((x) => x._t.remote);
  const minPct = Number(o.minMatch); if (Number.isFinite(minPct) && minPct > 0) out = out.filter((x) => (x.match.pct ?? -1) >= minPct);
  if (o.favorites === 'true' || o.favorites === true) out = out.filter((x) => x.favorite);
  if (o.sort === 'new') out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)); else out.sort((a, b) => (b.match.pct ?? -1) - (a.match.pct ?? -1) || new Date(b.publishedAt) - new Date(a.publishedAt));
  const total = out.length; const cap = lim.match; out = out.slice(0, cap).map(({ _t, ...x }) => x);
  return { posts: out, total, shown: out.length, cap, prime: lim.prime, notice: BIZ_NOTICE, kyc: { available: false }, myParams: { hasProfile: Boolean(myProfile), hasPost: Boolean(myPost) } };
};
export const postPublic = async (me, id) => {
  const p = (await query(`SELECT p.*, bp.data AS prof, bp.status AS prof_status FROM life_biz_posts p LEFT JOIN life_biz_profiles bp ON bp.owner_id = p.owner_id WHERE p.id = $1`, [id])).rows[0];
  if (!p || (p.status !== 'published' && p.owner_id !== me)) return { error: 'not_found' };
  const prof = p.prof_status === 'published' ? p.prof : null; const nm = await nameOf(p.owner_id);
  const logo = prof ? (await query(`SELECT id FROM life_files WHERE owner_id = $1 AND scope = 'bizlogo' LIMIT 1`, [p.owner_id])).rows[0] : null;
  const prop = p.owner_id === me ? null : (await query(`SELECT id, status, contact_shared, docs_shared, finance_shared FROM life_biz_proposals WHERE post_id = $1 AND from_id = $2 ORDER BY created_at DESC LIMIT 1`, [id, me])).rows[0];
  const shared = prop?.status === 'accepted' ? { contact: prop.contact_shared, docs: prop.docs_shared, finance: prop.finance_shared } : null;
  const priv = p.private_enc ? decJson(p.private_enc) : {};
  const out = { ...postRow(p, { riskFlags: undefined }), owner: { id: p.owner_id, name: prof?.name ?? nm?.name, username: nm?.username, card: prof ? { ...prof, logoFileId: logo?.id ?? null } : null }, notice: BIZ_NOTICE, kyc: { available: false },
    hiddenKeys: p.owner_id === me ? undefined : p.hidden, proposal: prop ? { id: prop.id, status: prop.status } : null };
  if (shared?.finance) out.finance = Object.fromEntries(Object.entries(priv).filter(([k]) => HIDEABLE.includes(k)));
  if (shared?.contact) out.contact = priv.contact ?? null;
  if (shared?.docs) out.files = (await query('SELECT id, name_enc, mime, bytes FROM life_files WHERE post_id = $1', [id])).rows.map((f) => ({ id: f.id, name: decryptSecret(f.name_enc) ?? 'файл', mime: f.mime, bytes: Number(f.bytes) }));
  if (p.owner_id === me) out.private = priv;
  out.hidden = p.hidden; if (p.owner_id !== me) { out.hasDocs = Boolean((await query('SELECT 1 FROM life_files WHERE post_id = $1', [id])).rowCount); }
  return { ok: true, post: out };
};
export const bizProfilePublic = async (id) => { const r = (await query(`SELECT bp.data, bp.owner_id FROM life_biz_profiles bp WHERE bp.owner_id = $1 AND bp.status = 'published'`, [id])).rows[0]; if (!r) return { error: 'not_found' }; const logo = (await query(`SELECT id FROM life_files WHERE owner_id = $1 AND scope = 'bizlogo' LIMIT 1`, [id])).rows[0]; return { ok: true, profile: { ...r.data, ownerId: r.owner_id, logoFileId: logo?.id ?? null }, notice: BIZ_NOTICE, kyc: { available: false } }; };
export const toggleFav = async (me, type, id) => {
  if (!['post', 'profile'].includes(type)) return { error: 'bad_type' };
  const ok = type === 'post' ? (await query(`SELECT 1 FROM life_biz_posts WHERE id = $1 AND status = 'published'`, [id])).rowCount : (await query(`SELECT 1 FROM life_biz_profiles WHERE owner_id = $1 AND status = 'published'`, [id])).rowCount; if (!ok) return { error: 'not_found' };
  const d = await query('DELETE FROM life_biz_favs WHERE owner_id = $1 AND target_type = $2 AND target_id = $3', [me, type, id]);
  if (d.rowCount) return { ok: true, favorite: false };
  if ((await query('SELECT count(*)::int AS c FROM life_biz_favs WHERE owner_id = $1', [me])).rows[0].c >= 300) return { error: 'too_many_favorites' };
  await query('INSERT INTO life_biz_favs (owner_id, target_type, target_id) VALUES ($1,$2,$3)', [me, type, id]); return { ok: true, favorite: true };
};
export const favorites = async (me) => {
  const posts = (await query(`SELECT p.id, p.kind, p.title, p.owner_id FROM life_biz_favs f JOIN life_biz_posts p ON p.id = f.target_id AND p.status = 'published' WHERE f.owner_id = $1 AND f.target_type = 'post' ORDER BY f.created_at DESC`, [me])).rows;
  const profiles = (await query(`SELECT bp.owner_id, bp.data FROM life_biz_favs f JOIN life_biz_profiles bp ON bp.owner_id = f.target_id AND bp.status = 'published' WHERE f.owner_id = $1 AND f.target_type = 'profile'`, [me])).rows.map((r) => ({ ownerId: r.owner_id, name: r.data.name, city: r.data.city, industries: r.data.industries }));
  return { posts: posts.map((p) => ({ id: p.id, kind: p.kind, title: p.title, ownerId: p.owner_id })), profiles };
};
export const searchProfiles = async (me, o = {}) => {
  const lim = await limitsOf(me); const mine = (await query('SELECT data FROM life_biz_profiles WHERE owner_id = $1', [me])).rows[0]?.data;
  const rows = (await query(`SELECT owner_id, data FROM life_biz_profiles WHERE status = 'published' AND owner_id <> $1 AND NOT EXISTS (SELECT 1 FROM life_restrictions r WHERE r.profile_id = owner_id AND (r.until IS NULL OR r.until > now())) ORDER BY updated_at DESC LIMIT 300`, [me])).rows;
  const q = line(o.q, 60).toLowerCase(); const t0 = traitsOf(mine, null);
  let out = rows.map((r) => ({ ownerId: r.owner_id, ...r.data, match: compat(t0, traitsOf(r.data, null)) }));
  if (q) out = out.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
  out.sort((a, b) => (b.match.pct ?? -1) - (a.match.pct ?? -1)); return { profiles: out.slice(0, lim.match), total: out.length, cap: lim.match, notice: BIZ_NOTICE };
};

/* ─── Предложения о сотрудничестве ────────────────────────────────── */
const hist = (pid, actor, ev) => query('INSERT INTO life_biz_history (proposal_id, actor_id, event) VALUES ($1,$2,$3)', [pid, actor, ev]);
export const sendProposal = async (me, postId, message) => {
  const s = await settings(); if (!s.biz_enabled) return { error: 'biz_disabled' }; if (await restricted(me)) return { error: 'restricted' };
  const p = (await query(`SELECT id, owner_id, kind FROM life_biz_posts WHERE id = $1 AND status = 'published'`, [postId])).rows[0]; if (!p) return { error: 'not_found' }; if (p.owner_id === me) return { error: 'own_post' };
  if ((await query(`SELECT 1 FROM life_restrictions WHERE profile_id = $1 AND (until IS NULL OR until > now())`, [p.owner_id])).rowCount) return { error: 'not_found' };
  const msg = clean(message, 2000); if (msg.length < 10) return { error: 'message_too_short' }; if (hasSecret(msg)) return { error: 'secret_not_allowed' }; if (CLAIM_RX.test(msg)) return { error: 'claims_not_allowed' };
  if ((await query(`SELECT count(*)::int AS c FROM life_biz_proposals WHERE from_id = $1 AND created_at > now() - interval '24 hours'`, [me])).rows[0].c >= s.proposals_per_day) return { error: 'daily_limit' };
  const id = newId('bq');
  try { await query('INSERT INTO life_biz_proposals (id, post_id, from_id, to_id, message_enc) VALUES ($1,$2,$3,$4,$5)', [id, postId, me, p.owner_id, encryptSecret(msg)]); } catch { return { error: 'already_sent' }; }
  await hist(id, me, 'sent');
  await notifyLife(p.owner_id, p.kind === 'investor_ask' || p.kind === 'investor' ? 'investors' : 'offers', 'Новое предложение о сотрудничестве', 'Вам отправили предложение по вашей публикации в Sky Life.', id);
  return { ok: true, id };
};
export const listProposals = async (me, box) => {
  const col = box === 'out' ? 'from_id' : 'to_id'; const other = box === 'out' ? 'to_id' : 'from_id';
  const rows = (await query(`SELECT q.*, p.title, p.kind, pr.name, pr.username FROM life_biz_proposals q JOIN life_biz_posts p ON p.id = q.post_id LEFT JOIN profiles pr ON pr.id = q.${other} WHERE q.${col} = $1 ORDER BY q.created_at DESC LIMIT 100`, [me])).rows;
  return { proposals: rows.map((q) => ({ id: q.id, postId: q.post_id, postTitle: q.title, kind: q.kind, status: q.status, message: decryptSecret(q.message_enc) ?? '', peer: { id: q[other], name: q.name, username: q.username }, createdAt: q.created_at, decidedAt: q.decided_at, contactShared: q.contact_shared, docsShared: q.docs_shared, financeShared: q.finance_shared })) };
};
export const answerProposal = async (me, id, action) => {
  const q = (await query('SELECT * FROM life_biz_proposals WHERE id = $1', [id])).rows[0]; if (!q || (q.to_id !== me && q.from_id !== me)) return { error: 'not_found' };
  const post = (await query('SELECT kind FROM life_biz_posts WHERE id = $1', [q.post_id])).rows[0]; const cat = ['investor', 'investor_ask'].includes(post?.kind) ? 'investors' : 'offers';
  if (action === 'withdraw') { if (q.from_id !== me) return { error: 'forbidden' }; const r = await query(`UPDATE life_biz_proposals SET status = 'withdrawn', decided_at = now(), contact_shared = false, docs_shared = false, finance_shared = false WHERE id = $1 AND status IN ('sent','accepted') RETURNING id`, [id]); if (!r.rowCount) return { error: 'bad_state' }; await hist(id, me, 'withdrawn'); return { ok: true }; }
  if (q.to_id !== me) return { error: 'forbidden' };
  if (!['accept', 'decline'].includes(action)) return { error: 'bad_action' };
  const r = await query(`UPDATE life_biz_proposals SET status = $2, decided_at = now() WHERE id = $1 AND status = 'sent' RETURNING id`, [id, action === 'accept' ? 'accepted' : 'declined']); if (!r.rowCount) return { error: 'bad_state' };
  await hist(id, me, action === 'accept' ? 'accepted' : 'declined');
  await notifyLife(q.from_id, cat, action === 'accept' ? 'Предложение принято' : 'Предложение отклонено', action === 'accept' ? 'Автор принял ваше предложение. Откройте «Предложения», чтобы начать диалог.' : 'Автор отклонил ваше предложение.', id);
  return { ok: true, peerId: q.from_id };
};
/** Автор публикации решает, что открыть собеседнику. Ничего не открывается автоматически. */
export const shareWith = async (me, id, o) => {
  const q = (await query('SELECT * FROM life_biz_proposals WHERE id = $1 AND to_id = $2', [id, me])).rows[0]; if (!q) return { error: 'not_found' }; if (q.status !== 'accepted') return { error: 'not_accepted' };
  const set = []; const args = [id]; for (const [k, col] of [['contact', 'contact_shared'], ['docs', 'docs_shared'], ['finance', 'finance_shared']]) if (typeof o[k] === 'boolean') { args.push(o[k]); set.push(`${col} = $${args.length}`); }
  if (!set.length) return { error: 'nothing_to_change' }; await query(`UPDATE life_biz_proposals SET ${set.join(', ')} WHERE id = $1`, args);
  await hist(id, me, `share:${['contact', 'docs', 'finance'].filter((k) => typeof o[k] === 'boolean').map((k) => `${k}=${o[k]}`).join(',')}`); await audit(me, me, 'biz_share', JSON.stringify(Object.keys(o)).slice(0, 60)); return { ok: true };
};
export const proposalHistory = async (me, id) => {
  const q = (await query('SELECT from_id, to_id FROM life_biz_proposals WHERE id = $1', [id])).rows[0]; if (!q || (q.from_id !== me && q.to_id !== me)) return { error: 'not_found' };
  return { history: (await query('SELECT event, actor_id, at FROM life_biz_history WHERE proposal_id = $1 ORDER BY at', [id])).rows.map((h) => ({ event: h.event, byMe: h.actor_id === me, at: h.at })) };
};
export const contacts = async (me) => {
  const rows = (await query(`SELECT q.id, q.post_id, p.owner_id, p.private_enc, p.title, pr.name, pr.username FROM life_biz_proposals q JOIN life_biz_posts p ON p.id = q.post_id LEFT JOIN profiles pr ON pr.id = p.owner_id WHERE q.from_id = $1 AND q.status = 'accepted' AND q.contact_shared`, [me])).rows;
  return { contacts: rows.map((r) => ({ proposalId: r.id, postTitle: r.title, name: r.name, username: r.username, contact: decJson(r.private_enc)?.contact ?? null })) };
};

/* ─── Жалобы ──────────────────────────────────────────────────────── */
export const REPORT_REASONS = { scam: 'Мошенничество', fake: 'Ложные сведения', personal_data: 'Чужие персональные данные', spam: 'Спам', pressure: 'Давление или вымогательство', other: 'Другое' };
export const report = async (me, type, id, reason, text) => {
  if (!['post', 'profile', 'proposal', 'project'].includes(type)) return { error: 'bad_type' }; if (!Object.hasOwn(REPORT_REASONS, String(reason))) return { error: 'bad_reason' };
  let owner = null;
  if (type === 'post') owner = (await query('SELECT owner_id FROM life_biz_posts WHERE id = $1', [id])).rows[0]?.owner_id;
  if (type === 'profile') owner = (await query('SELECT owner_id FROM life_biz_profiles WHERE owner_id = $1', [id])).rows[0]?.owner_id;
  if (type === 'proposal') { const q = (await query('SELECT from_id, to_id FROM life_biz_proposals WHERE id = $1', [id])).rows[0]; if (q && (q.from_id === me || q.to_id === me)) owner = q.from_id === me ? q.to_id : q.from_id; }
  if (type === 'project') owner = (await query(`SELECT owner_id FROM life_projects WHERE id = $1 AND visibility IN ('public','link')`, [id])).rows[0]?.owner_id;
  if (!owner) return { error: 'not_found' }; if (owner === me) return { error: 'own_target' };
  if ((await query(`SELECT count(*)::int AS c FROM life_biz_reports WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`, [me])).rows[0].c >= 10) return { error: 'daily_limit' };
  try { await query('INSERT INTO life_biz_reports (id, reporter_id, target_type, target_id, reason, text) VALUES ($1,$2,$3,$4,$5,$6)', [newId('br'), me, type, id, reason, clean(text, 600) || null]); } catch { return { error: 'already_reported' }; }
  // Несколько независимых жалоб возвращают публикацию на проверку (не блокируют): решает человек.
  const c = (await query(`SELECT count(DISTINCT reporter_id)::int AS c FROM life_biz_reports WHERE target_type = $1 AND target_id = $2 AND status = 'open'`, [type, id])).rows[0].c;
  if (c >= 3) { if (type === 'post') await query(`UPDATE life_biz_posts SET status = 'pending', reason = 'Повторные жалобы — публикация возвращена на проверку' WHERE id = $1 AND status = 'published'`, [id]); if (type === 'profile') await query(`UPDATE life_biz_profiles SET status = 'pending' WHERE owner_id = $1 AND status = 'published'`, [id]); }
  void notifyStaff('life_review', { title: 'Жалоба в Sky Life', body: 'Поступила жалоба на деловую публикацию.', dedupe: `rep:${type}:${id}:${c}`, except: me });
  return { ok: true };
};

/* ─── Администрация (личные записи и файлы не читаются) ───────────── */
const need = async (me, perm) => (await can(me, perm)) || (await isOwner(me));
const alog = async (me, action, target, reason) => { await query('INSERT INTO life_admin_log (actor_id, action, target, reason) VALUES ($1,$2,$3,$4)', [me, action, target ? String(target).slice(0, 80) : null, reason ? String(reason).slice(0, 300) : null]); await logAdmin({ actorId: me, targetType: 'life', targetId: target ?? null, type: `life_${action}`, detail: String(reason ?? '').slice(0, 200) }); };
export const adminQueue = async (me) => {
  if (!(await need(me, 'life_moderation'))) return { error: 'not_allowed' };
  const posts = (await query(`SELECT * FROM life_biz_posts WHERE status = 'pending' ORDER BY updated_at LIMIT 100`)).rows.map((p) => postRow(p, { hidden: undefined }));
  const profiles = (await query(`SELECT owner_id, data FROM life_biz_profiles WHERE status = 'pending' ORDER BY updated_at LIMIT 100`)).rows.map((r) => ({ ownerId: r.owner_id, ...r.data }));
  const reports = (await query(`SELECT * FROM life_biz_reports WHERE status = 'open' ORDER BY created_at LIMIT 100`)).rows.map((r) => ({ id: r.id, targetType: r.target_type, targetId: r.target_id, reason: REPORT_REASONS[r.reason] ?? r.reason, text: r.text, createdAt: r.created_at }));
  return { posts, profiles, reports, restrictions: (await query(`SELECT profile_id, until, reason FROM life_restrictions WHERE until IS NULL OR until > now() ORDER BY created_at DESC LIMIT 100`)).rows };
};
export const adminDecide = async (me, type, id, action, reason) => {
  if (!(await need(me, 'life_moderation'))) return { error: 'not_allowed' };
  if (!['approve', 'reject', 'block'].includes(action)) return { error: 'bad_action' }; const why = line(reason, 300); if (action !== 'approve' && why.length < 5) return { error: 'reason_required' };
  const status = action === 'approve' ? 'published' : action === 'reject' ? 'rejected' : 'blocked';
  const ownerOf = { post: ['SELECT owner_id FROM life_biz_posts WHERE id = $1', 'owner_id'], profile: ['SELECT owner_id FROM life_biz_profiles WHERE owner_id = $1', 'owner_id'], project: ['SELECT owner_id FROM life_projects WHERE id = $1', 'owner_id'] }[type];
  if (!ownerOf) return { error: 'bad_type' };
  const owner = (await query(ownerOf[0], [id])).rows[0]?.owner_id; if (!owner) return { error: 'not_found' };
  if (owner === me && !(await isOwner(me))) return { error: 'self_review' };
  let n = 0;
  if (type === 'post') n = (await query(`UPDATE life_biz_posts SET status = $2, reason = $3, reviewed_by = $4, reviewed_at = now(), published_at = CASE WHEN $2 = 'published' THEN COALESCE(published_at, now()) ELSE published_at END WHERE id = $1 AND status IN ('pending','published') RETURNING id`, [id, status, why || null, me])).rowCount;
  else if (type === 'profile') n = (await query(`UPDATE life_biz_profiles SET status = $2, reason = $3, reviewed_by = $4, reviewed_at = now() WHERE owner_id = $1 AND status IN ('pending','published') RETURNING owner_id`, [id, status, why || null, me])).rowCount;
  else n = (await query(`UPDATE life_projects SET blocked = $2, block_reason = $3 WHERE id = $1 AND visibility IN ('public','link') RETURNING id`, [id, action === 'block', why || null])).rowCount;
  if (!n) return { error: 'bad_state' };
  if (type !== 'project') await query(`UPDATE life_biz_reports SET status = $3, decided_by = $4, decision = $5, decided_at = now() WHERE target_type = $1 AND target_id = $2 AND status = 'open'`, [type, id, action === 'approve' ? 'dismissed' : 'resolved', me, action]);
  await alog(me, `${type}_${action}`, id, why);
  await notifyLife(owner, 'offers', action === 'approve' ? 'Публикация одобрена' : 'Публикация не прошла проверку', action === 'approve' ? 'Ваша публикация в Sky Life прошла проверку и видна другим.' : `Публикация не опубликована: ${why}`, id);
  return { ok: true, status };
};
export const adminReportDecide = async (me, id, action, note) => {
  if (!(await need(me, 'life_moderation'))) return { error: 'not_allowed' }; const n = line(note, 300); if (n.length < 5) return { error: 'reason_required' };
  const r = (await query(`UPDATE life_biz_reports SET status = $2, decided_by = $3, decision = $4, decided_at = now() WHERE id = $1 AND status = 'open' AND reporter_id <> $3 RETURNING id`, [id, action === 'dismiss' ? 'dismissed' : 'resolved', me, n])).rows[0]; if (!r) return { error: 'bad_state' };
  await alog(me, `report_${action}`, id, n); return { ok: true };
};
export const adminRestrict = async (me, profileId, days, reason, lift) => {
  if (!(await need(me, 'life_moderation'))) return { error: 'not_allowed' }; if (await isOwner(profileId)) return { error: 'forbidden' }; if (profileId === me) return { error: 'self_review' };
  if (lift) { await query('DELETE FROM life_restrictions WHERE profile_id = $1', [profileId]); await alog(me, 'unrestrict', profileId, reason || 'снято'); return { ok: true }; }
  const why = line(reason, 300); if (why.length < 5) return { error: 'reason_required' }; const d = Number(days); const until = Number.isFinite(d) && d > 0 ? new Date(Date.now() + Math.min(d, 365) * 86400_000) : null;
  await query(`INSERT INTO life_restrictions (profile_id, until, reason, by_id) VALUES ($1,$2,$3,$4) ON CONFLICT (profile_id) DO UPDATE SET until = $2, reason = $3, by_id = $4, created_at = now()`, [profileId, until, why, me]);
  await query(`UPDATE life_biz_posts SET status = 'blocked', reason = $2 WHERE owner_id = $1 AND status IN ('published','pending')`, [profileId, `Ограничение: ${why}`]);
  await alog(me, 'restrict', profileId, why); await notifyLife(profileId, 'offers', 'Ограничение деловых функций', `Деловые функции Sky Life ограничены: ${why}`, null); return { ok: true };
};
export const myRestriction = async (me) => ({ restriction: await restricted(me) ?? null });
export const adminSettings = async (me) => { if (!(await need(me, 'life_admin'))) return { error: 'not_allowed' }; const s = await settings(true); return { settings: s, categories: (await query('SELECT * FROM life_sys_categories ORDER BY position, name')).rows }; };
const INTK = ['free_items', 'prime_items', 'free_storage_mb', 'prime_storage_mb', 'free_posts', 'prime_posts', 'free_projects', 'prime_projects', 'free_match', 'prime_match', 'proposals_per_day'];
export const adminSaveSettings = async (me, b) => {
  if (!(await need(me, 'life_admin'))) return { error: 'not_allowed' };
  const set = ['updated_by = $1', 'updated_at = now()']; const args = [me]; const put = (c, v) => { args.push(v); set.push(`${c} = $${args.length}`); };
  for (const k of INTK) if (k in b) { const n = Number(b[k]); if (!Number.isInteger(n) || n < 0 || n > 1000000) return { error: 'bad_settings' }; put(k, n); }
  for (const k of ['enabled', 'biz_enabled']) if (typeof b[k] === 'boolean') put(k, b[k]);
  await query(`UPDATE life_settings SET ${set.join(', ')} WHERE id`, args); forgetSettings(); await alog(me, 'settings', null, JSON.stringify(Object.keys(b)).slice(0, 200)); return { ok: true };
};
export const adminCategory = async (me, b) => {
  if (!(await need(me, 'life_admin'))) return { error: 'not_allowed' };
  if (b.delete) { await query('DELETE FROM life_sys_categories WHERE id = $1', [String(b.delete)]); await alog(me, 'category_delete', b.delete, null); return { ok: true }; }
  const name = line(b.name, 40); if (name.length < 2) return { error: 'bad_name' };
  if (b.id) { await query('UPDATE life_sys_categories SET name = $2, enabled = COALESCE($3, enabled), position = COALESCE($4, position) WHERE id = $1', [String(b.id), name, typeof b.enabled === 'boolean' ? b.enabled : null, Number.isInteger(b.position) ? b.position : null]); }
  else await query('INSERT INTO life_sys_categories (id, name, position) VALUES ($1,$2,$3)', [`sc-${crypto.randomUUID().slice(0, 8)}`, name, Number.isInteger(b.position) ? b.position : 100]);
  await alog(me, 'category_save', b.id ?? name, null); return { ok: true };
};
/** Только числа: ни текста записей, ни имён, ни файлов. */
export const adminStats = async (me) => {
  if (!(await need(me, 'life_admin')) && !(await need(me, 'life_moderation'))) return { error: 'not_allowed' };
  const c = async (sql) => (await query(sql)).rows[0].c;
  return { users: await c('SELECT count(DISTINCT owner_id)::int AS c FROM life_items'), items: await c('SELECT count(*)::int AS c FROM life_items'), goals: await c(`SELECT count(*)::int AS c FROM life_items WHERE kind = 'goal'`), projects: await c('SELECT count(*)::int AS c FROM life_projects'),
    files: await c('SELECT count(*)::int AS c FROM life_files'), storageMb: Math.round((await c('SELECT COALESCE(sum(bytes),0)::bigint AS c FROM life_files')) / 1048576),
    posts: { published: await c(`SELECT count(*)::int AS c FROM life_biz_posts WHERE status = 'published'`), pending: await c(`SELECT count(*)::int AS c FROM life_biz_posts WHERE status = 'pending'`), blocked: await c(`SELECT count(*)::int AS c FROM life_biz_posts WHERE status = 'blocked'`) },
    profiles: await c(`SELECT count(*)::int AS c FROM life_biz_profiles WHERE status = 'published'`), proposals: await c('SELECT count(*)::int AS c FROM life_biz_proposals'), openReports: await c(`SELECT count(*)::int AS c FROM life_biz_reports WHERE status = 'open'`), restricted: await c(`SELECT count(*)::int AS c FROM life_restrictions WHERE until IS NULL OR until > now()`) };
};
export const adminLogs = async (me) => {
  if (!(await need(me, 'life_admin')) && !(await need(me, 'life_moderation'))) return { error: 'not_allowed' };
  return { actions: (await query('SELECT l.action, l.target, l.reason, l.at, pr.name AS actor FROM life_admin_log l LEFT JOIN profiles pr ON pr.id = l.actor_id ORDER BY l.at DESC LIMIT 100')).rows, errors: (await query('SELECT where_, code, at FROM life_errors ORDER BY at DESC LIMIT 50')).rows };
};
export { pool };
