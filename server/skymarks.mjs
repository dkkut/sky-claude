/**
 * Отметки верификации (модуль 6, ноябрь-2026): отметки у пользователей, групп, каналов, видеоканалов и «официальных» аккаунтов.
 *
 * Правила:
 *  • отметку нельзя присвоить себе: её даёт решение сотрудника (право `verification`); «Официальный» ставит только владелец сервиса;
 *  • заявку подаёт владелец объекта (пользователь — за себя; чат — владелец чата; видеоканал — автор), условия проверяет сервер;
 *  • сотрудник не решает по заявке на себя или на объект, которым владеет; отказ и снятие — только с причиной;
 *  • каждая заявка и каждое решение пишутся в историю и журнал администрации; заявителю приходит уведомление.
 * Проверка документов вручную: интеграций с реестрами нет, и интерфейс так и говорит.
 */
import crypto from 'node:crypto';
import { notifyStaff } from './staffnotify.mjs';
import { query } from './db.mjs';
import { encryptContent, decryptContent } from './crypto.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';

const TYPES = ['user', 'chat_group', 'chat_channel', 'video_channel', 'official'];
const MAX_NOTE = 1500; const MAX_REASON = 500; const MAX_LINKS = 5;
const newId = () => `ver-${crypto.randomUUID()}`;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const getSettings = async () => {
  const { rows } = await query('SELECT * FROM verification_settings WHERE id');
  const s = rows[0];
  return { enabled: s.enabled, minAccountDays: s.min_account_days, requireEmail: s.require_email, minMembers: s.min_members, minVideos: s.min_videos, retryDays: s.retry_days, criteriaText: s.criteria_text, updatedAt: s.updated_at?.toISOString?.() };
};

const history = (client, vid, event, actor, reason) =>
  (client ?? { query }).query('INSERT INTO verification_history (verification_id, event, actor_id, reason) VALUES ($1,$2,$3,$4)', [vid, event, actor ?? null, reason ? encryptContent(reason) : null]);

/* ─── Описание объекта и владелец ──────────────────────────────────── */

/** Кто владеет объектом и как он выглядит. Возвращает null, если такого объекта нет. */
export const describeSubject = async (type, id) => {
  if (type === 'user') {
    const { rows } = await query('SELECT id, name, username, avatar, created_at FROM profiles WHERE id = $1 AND deleted_at IS NULL', [id]);
    const p = rows[0]; return p ? { ownerId: p.id, title: p.name, handle: `@${p.username}`, avatar: p.avatar || undefined, createdAt: p.created_at } : null;
  }
  if (type === 'chat_group' || type === 'chat_channel') {
    const { rows } = await query(`SELECT c.id, c.type, c.name, c.username, c.avatar, c.owner_id, c.created_at,
        (SELECT count(*)::int FROM chat_members m WHERE m.chat_id = c.id) AS members
      FROM chats c WHERE c.id = $1 AND c.trashed_at IS NULL`, [id]);
    const c = rows[0];
    if (!c || c.type !== (type === 'chat_group' ? 'group' : 'channel')) return null;
    return { ownerId: c.owner_id, title: decryptContent(c.name) ?? c.name, handle: c.username ? `@${c.username}` : undefined, avatar: c.avatar || undefined, members: c.members, createdAt: c.created_at };
  }
  if (type === 'video_channel') {
    const { rows } = await query(`SELECT p.id, p.name, p.username, p.avatar, p.created_at,
        (SELECT count(*)::int FROM sky_videos v WHERE v.owner_id = p.id AND v.status = 'published') AS videos
      FROM profiles p WHERE p.id = $1 AND p.deleted_at IS NULL`, [id]);
    const p = rows[0]; return p ? { ownerId: p.id, title: p.name, handle: `@${p.username}`, avatar: p.avatar || undefined, videos: p.videos, createdAt: p.created_at } : null;
  }
  if (type === 'official') {
    const { rows } = await query('SELECT id, name, username, avatar FROM profiles WHERE id = $1 AND deleted_at IS NULL', [id]);
    const p = rows[0]; return p ? { ownerId: p.id, title: p.name, handle: `@${p.username}`, avatar: p.avatar || undefined } : null;
  }
  return null;
};

/** Проверка условий из настроек по настоящим данным; возвращает список невыполненных. */
export const eligibility = async (type, id, ownerProfileId) => {
  const s = await getSettings();
  const d = await describeSubject(type, id);
  const problems = [];
  if (!d) return { ok: false, problems: ['Объект не найден'], settings: s };
  const ageDays = Math.floor((Date.now() - new Date(d.createdAt ?? Date.now()).getTime()) / 86_400_000);
  if (type === 'user' && ageDays < s.minAccountDays) problems.push(`Аккаунту должно быть не меньше ${s.minAccountDays} дн. (сейчас ${ageDays})`);
  if ((type === 'chat_group' || type === 'chat_channel') && (d.members ?? 0) < s.minMembers) problems.push(`Нужно не меньше ${s.minMembers} участников (сейчас ${d.members ?? 0})`);
  if (type === 'video_channel' && (d.videos ?? 0) < s.minVideos) problems.push(`Нужно не меньше ${s.minVideos} опубликованных видео (сейчас ${d.videos ?? 0})`);
  if (s.requireEmail) {
    const { rows } = await query(`SELECT s.email_verified FROM profiles p JOIN sky_ids s ON s.id = p.sky_id WHERE p.id = $1`, [ownerProfileId]);
    if (!rows[0]?.email_verified) problems.push('Нужна подтверждённая почта в Sky ID');
  }
  return { ok: problems.length === 0, problems, settings: s, subject: d };
};

/* ─── Заявитель ────────────────────────────────────────────────────── */

const view = (r, withPrivate = false) => ({
  id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, mark: r.mark, status: r.status,
  createdAt: r.created_at.toISOString(), decidedAt: r.decided_at?.toISOString?.() ?? undefined,
  ...(withPrivate ? {
    note: r.note ? decryptContent(r.note) ?? '' : undefined,
    links: r.links ? JSON.parse(decryptContent(r.links) ?? '[]') : [],
    requestedBy: r.requested_by ?? undefined,
  } : {}),
  reason: r.decision_reason ? decryptContent(r.decision_reason) ?? undefined : undefined,
});

export const requestVerification = async (profileId, { type, subjectId, note, links } = {}) => {
  if (!TYPES.includes(type) || type === 'official') return { error: 'bad_type' };
  const id = type === 'user' || type === 'video_channel' ? String(subjectId || profileId) : String(subjectId ?? '');
  const el = await eligibility(type, id, profileId);
  if (!el.settings.enabled) return { error: 'closed' };
  if (!el.subject) return { error: 'not_found' };
  if (el.subject.ownerId !== profileId) return { error: 'not_owner' };
  if (!el.ok) return { error: 'not_eligible', problems: el.problems };
  const text = clean(note, MAX_NOTE);
  if (text.length < 10) return { error: 'note_required' };
  const urls = (Array.isArray(links) ? links : []).map((l) => String(l).trim()).filter((l) => /^https:\/\/[^\s]{3,300}$/i.test(l)).slice(0, MAX_LINKS);
  const live = await query(`SELECT status FROM verifications WHERE subject_type=$1 AND subject_id=$2 AND status IN ('pending','approved')`, [type, id]);
  if (live.rows[0]) return { error: live.rows[0].status === 'approved' ? 'already_verified' : 'already_pending' };
  const last = await query(`SELECT decided_at FROM verifications WHERE subject_type=$1 AND subject_id=$2 AND status='rejected' ORDER BY decided_at DESC LIMIT 1`, [type, id]);
  if (last.rows[0] && Date.now() - new Date(last.rows[0].decided_at).getTime() < el.settings.retryDays * 86_400_000) return { error: 'retry_later', retryDays: el.settings.retryDays };
  const vid = newId();
  try {
    await query(`INSERT INTO verifications (id, subject_type, subject_id, mark, status, requested_by, note, links) VALUES ($1,$2,$3,'verified','pending',$4,$5,$6)`,
      [vid, type, id, profileId, encryptContent(text), encryptContent(JSON.stringify(urls))]);
  } catch (e) { if (e.code === '23505') return { error: 'already_pending' }; throw e; }
  await history(null, vid, 'requested', profileId, null);
  void notifyStaff('verification', { title: 'Заявка на верификацию', body: 'Новая заявка на отметку ждёт решения.', dedupe: vid, except: profileId });
  return { ok: true, id: vid };
};

export const withdraw = async (profileId, vid) => {
  const { rowCount } = await query(`UPDATE verifications SET status='withdrawn', updated_at=now() WHERE id=$1 AND requested_by=$2 AND status='pending'`, [String(vid ?? ''), profileId]);
  if (!rowCount) return { error: 'not_found' };
  await history(null, vid, 'withdrawn', profileId, null);
  return { ok: true };
};

/** Свои объекты, за которые можно просить отметку, и статусы заявок. */
export const mine = async (profileId) => {
  const settings = await getSettings();
  const subjects = [];
  const push = async (type, id, extra = {}) => {
    const el = await eligibility(type, id, profileId);
    const cur = (await query(`SELECT * FROM verifications WHERE subject_type=$1 AND subject_id=$2 ORDER BY created_at DESC LIMIT 1`, [type, id])).rows[0];
    subjects.push({ type, id, title: el.subject?.title, handle: el.subject?.handle, eligible: el.ok, problems: el.problems, current: cur ? view(cur) : undefined, ...extra });
  };
  await push('user', profileId);
  const vc = await describeSubject('video_channel', profileId);
  if (vc && vc.videos > 0) await push('video_channel', profileId);
  const chats = (await query(`SELECT id, type FROM chats WHERE owner_id = $1 AND type IN ('group','channel') AND trashed_at IS NULL ORDER BY created_at DESC LIMIT 50`, [profileId])).rows;
  for (const c of chats) await push(c.type === 'group' ? 'chat_group' : 'chat_channel', c.id);
  return { enabled: settings.enabled, criteriaText: settings.criteriaText, minimums: { minAccountDays: settings.minAccountDays, minMembers: settings.minMembers, minVideos: settings.minVideos, requireEmail: settings.requireEmail, retryDays: settings.retryDays }, subjects };
};

/* ─── Публичные отметки ────────────────────────────────────────────── */

export const marksFor = async (type, ids) => {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 100);
  if (!TYPES.includes(type) || !list.length) return {};
  const { rows } = await query(
    `SELECT subject_id, mark FROM verifications WHERE subject_type = $1 AND subject_id = ANY($2) AND status = 'approved'`, [type, list]);
  return Object.fromEntries(rows.map((r) => [r.subject_id, r.mark]));
};

/* ─── Сотрудники ───────────────────────────────────────────────────── */

export const adminQueue = async (adminId, { status = 'pending', type, limit = 100 } = {}) => {
  if (!(await can(adminId, 'verification'))) return { error: 'not_allowed' };
  const args = [Math.min(200, Math.max(1, Number(limit) || 100))]; const where = [];
  if (status !== 'all') { args.push(status); where.push(`v.status = $${args.length}`); }
  if (type && TYPES.includes(type)) { args.push(type); where.push(`v.subject_type = $${args.length}`); }
  const { rows } = await query(`SELECT v.* FROM verifications v ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT $1`, args);
  const out = [];
  for (const r of rows) {
    const d = await describeSubject(r.subject_type, r.subject_id);
    out.push({ ...view(r, true), subject: d ? { title: d.title, handle: d.handle, members: d.members, videos: d.videos, ownerId: d.ownerId } : undefined });
  }
  return { items: out };
};

export const adminDetail = async (adminId, vid) => {
  if (!(await can(adminId, 'verification'))) return { error: 'not_allowed' };
  const r = (await query('SELECT * FROM verifications WHERE id = $1', [String(vid ?? '')])).rows[0];
  if (!r) return { error: 'not_found' };
  const d = await describeSubject(r.subject_type, r.subject_id);
  const hist = (await query('SELECT h.event, h.actor_id, h.reason, h.at, p.username AS actor FROM verification_history h LEFT JOIN profiles p ON p.id = h.actor_id WHERE h.verification_id = $1 ORDER BY h.id', [vid])).rows
    .map((h) => ({ event: h.event, actor: h.actor ? `@${h.actor}` : undefined, reason: h.reason ? decryptContent(h.reason) ?? undefined : undefined, at: h.at.toISOString() }));
  const el = d ? await eligibility(r.subject_type, r.subject_id, d.ownerId) : null;
  return { item: { ...view(r, true), subject: d ? { title: d.title, handle: d.handle, members: d.members, videos: d.videos, ownerId: d.ownerId } : undefined, problems: el?.problems ?? [] }, history: hist };
};

/** Решение по заявке: одобрить или отклонить (с причиной). Свою заявку и объект, которым владеешь, решать нельзя. */
export const decide = async (adminId, vid, { approve, reason } = {}) => {
  if (!(await can(adminId, 'verification'))) return { error: 'not_allowed' };
  const r = (await query('SELECT * FROM verifications WHERE id = $1', [String(vid ?? '')])).rows[0];
  if (!r) return { error: 'not_found' };
  if (r.status !== 'pending') return { error: 'not_pending' };
  const d = await describeSubject(r.subject_type, r.subject_id);
  if (r.requested_by === adminId || d?.ownerId === adminId) return { error: 'self_review' };
  const why = clean(reason, MAX_REASON);
  if (!approve && why.length < 5) return { error: 'reason_required' };
  const { rowCount } = await query(
    `UPDATE verifications SET status = $2, decided_by = $3, decided_at = now(), decision_reason = $4, updated_at = now() WHERE id = $1 AND status = 'pending'`,
    [vid, approve ? 'approved' : 'rejected', adminId, why ? encryptContent(why) : null]);
  if (!rowCount) return { error: 'not_pending' };
  await history(null, vid, approve ? 'approved' : 'rejected', adminId, why);
  await logAdmin({ actorId: adminId, targetId: r.requested_by, type: approve ? 'verification_approve' : 'verification_reject', detail: `${r.subject_type}:${r.subject_id}${why ? ` — ${why}` : ''}` });
  if (r.requested_by) {
    await notifyGift(r.requested_by, 'verification', approve ? 'Верификация подтверждена' : 'Заявка на верификацию отклонена',
      approve ? `Объект «${d?.title ?? ''}» теперь с отметкой.` : `Объект «${d?.title ?? ''}»: ${why}`, vid).catch(() => {});
  }
  return { ok: true, status: approve ? 'approved' : 'rejected' };
};

/** Снять действующую отметку (причина обязательна). */
export const revoke = async (adminId, vid, reason) => {
  if (!(await can(adminId, 'verification'))) return { error: 'not_allowed' };
  const r = (await query('SELECT * FROM verifications WHERE id = $1', [String(vid ?? '')])).rows[0];
  if (!r) return { error: 'not_found' };
  if (r.status !== 'approved') return { error: 'not_approved' };
  if (r.mark === 'official' && !(await isOwner(adminId))) return { error: 'owner_only' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 5) return { error: 'reason_required' };
  await query(`UPDATE verifications SET status='revoked', decided_by=$2, decided_at=now(), decision_reason=$3, updated_at=now() WHERE id=$1 AND status='approved'`, [vid, adminId, encryptContent(why)]);
  await history(null, vid, 'revoked', adminId, why);
  await logAdmin({ actorId: adminId, targetId: r.requested_by, type: 'verification_revoke', detail: `${r.subject_type}:${r.subject_id} — ${why}` });
  if (r.requested_by) await notifyGift(r.requested_by, 'verification', 'Отметка верификации снята', why, vid).catch(() => {});
  return { ok: true };
};

/** «Официальный» аккаунт/сервис — только владелец сервиса, без заявки, с причиной. */
export const grantOfficial = async (ownerId, { subjectType, subjectId, reason } = {}) => {
  if (!(await isOwner(ownerId))) return { error: 'owner_only' };
  const type = ['user', 'chat_group', 'chat_channel', 'video_channel'].includes(subjectType) ? subjectType : null;
  if (!type) return { error: 'bad_type' };
  const d = await describeSubject(type, String(subjectId ?? ''));
  if (!d) return { error: 'not_found' };
  const why = clean(reason, MAX_REASON);
  if (why.length < 5) return { error: 'reason_required' };
  const vid = newId();
  const client = await (await import('./db.mjs')).pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE verifications SET status='revoked', decided_by=$3, decided_at=now(), decision_reason=$4, updated_at=now() WHERE subject_type=$1 AND subject_id=$2 AND status IN ('pending','approved')`, [type, subjectId, ownerId, encryptContent('Заменено отметкой «Официальный»')]);
    await client.query(`INSERT INTO verifications (id, subject_type, subject_id, mark, status, requested_by, decided_by, decided_at, decision_reason) VALUES ($1,$2,$3,'official','approved',$4,$4,now(),$5)`, [vid, type, subjectId, ownerId, encryptContent(why)]);
    await history(client, vid, 'official_granted', ownerId, why);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await logAdmin({ actorId: ownerId, targetId: d.ownerId, type: 'verification_official', detail: `${type}:${subjectId} — ${why}` });
  return { ok: true, id: vid };
};

export const saveSettings = async (adminId, body) => {
  if (!(await can(adminId, 'verification'))) return { error: 'not_allowed' };
  const cur = await getSettings();
  const n = (v, d, lo, hi) => (v === undefined ? d : Math.max(lo, Math.min(hi, Math.trunc(Number(v)) || 0)));
  const next = {
    enabled: typeof body?.enabled === 'boolean' ? body.enabled : cur.enabled,
    min_account_days: n(body?.minAccountDays, cur.minAccountDays, 0, 3650), require_email: typeof body?.requireEmail === 'boolean' ? body.requireEmail : cur.requireEmail,
    min_members: n(body?.minMembers, cur.minMembers, 0, 1_000_000), min_videos: n(body?.minVideos, cur.minVideos, 0, 100_000), retry_days: n(body?.retryDays, cur.retryDays, 0, 365),
    criteria_text: body?.criteriaText === undefined ? cur.criteriaText : String(body.criteriaText).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, 3000),
  };
  await query(`UPDATE verification_settings SET enabled=$1, min_account_days=$2, require_email=$3, min_members=$4, min_videos=$5, retry_days=$6, criteria_text=$7, updated_by=$8, updated_at=now() WHERE id`,
    [next.enabled, next.min_account_days, next.require_email, next.min_members, next.min_videos, next.retry_days, next.criteria_text, adminId]);
  await logAdmin({ actorId: adminId, targetType: 'system', type: 'verification_settings', detail: `заявки ${next.enabled ? 'открыты' : 'закрыты'}; аккаунт ≥${next.min_account_days} дн.; участников ≥${next.min_members}; видео ≥${next.min_videos}` });
  return { ok: true, settings: await getSettings() };
};

export const stats = async (adminId) => {
  if (!(await can(adminId, 'verification'))) return { error: 'not_allowed' };
  const { rows } = await query(`SELECT status, count(*)::int AS n FROM verifications GROUP BY status`);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
};
