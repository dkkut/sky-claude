/**
 * Bloom: сообщества. Сообщество — это страница со своими правилами, участниками и модераторами; посты в нём — обычные посты Bloom (bloom_posts.community_id).
 *  • публичное сообщество видно всем, вступление свободное; закрытое показывается в каталоге (название, описание), но посты видят только участники, вступление — по заявке;
 *  • видимость постов решает одна точка — bloom.communityVisibleSql (используется ленты, профиль, поиск, медиа, реакции, комментарии): закрытое сообщество не «протекает» в общую ленту;
 *  • роли: owner (один) → mod → member; модератор не трогает владельца и других модераторов; бан запоминается; каждое действие модерации — в журнал сообщества с причиной;
 *  • администрация Sky (право `bloom_communities`) может заблокировать сообщество целиком по жалобам — содержимое при этом не удаляется.
 */
import { checkContent, blockedReply } from './contentfilterstore.mjs';
import crypto from 'node:crypto';
import { pool, query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { notifyGift } from './giftnotify.mjs';
import { notifyStaff } from './staffnotify.mjs';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const line = (v, max) => clean(v, max).replace(/\s+/g, ' ');
const RESERVED = new Set(['admin', 'sky', 'bloom', 'official', 'support', 'moderator', 'all', 'new', 'null', 'system', 'skybot']);
const MAX_OWNED = 5; const MAX_PER_DAY = 3; const MAX_RULES = 10;
const REPORT_REASONS = { spam: 'Спам', scam: 'Мошенничество', hate: 'Ненависть и травля', illegal: 'Незаконное содержимое', adult: 'Недопустимый контент', other: 'Другое' };
export { REPORT_REASONS };
const log = (cid, actor, action, target = null, reason = null) => query('INSERT INTO bloom_community_log (community_id, actor_id, action, target, reason) VALUES ($1,$2,$3,$4,$5)', [cid, actor, action, target, reason ? String(reason).slice(0, 300) : null]).catch(() => {});
const colorOk = (c) => /^#[0-9a-fA-F]{6}$/.test(String(c));
const shapeRules = (r) => (Array.isArray(r) ? r : []).slice(0, MAX_RULES).map((x) => ({ title: line(x?.title, 80), text: clean(x?.text, 400) })).filter((x) => x.title);

const base = `SELECT c.*, (SELECT count(*)::int FROM bloom_community_members m WHERE m.community_id = c.id AND m.status = 'active') AS members,
  (SELECT count(*)::int FROM bloom_posts p WHERE p.community_id = c.id AND p.deleted_at IS NULL) AS posts,
  (SELECT row_to_json(x) FROM (SELECT role, status FROM bloom_community_members m WHERE m.community_id = c.id AND m.profile_id = $1) x) AS mine
  FROM bloom_communities c`;
const view = (c, full = false) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, emoji: c.emoji, color: c.color, privacy: c.privacy, postPolicy: c.post_policy, members: c.members, posts: c.posts,
  mine: c.mine ?? null, createdAt: c.created_at, blocked: c.blocked || undefined, ...(full ? { rules: c.rules, ownerId: c.owner_id } : {}) });

const roleOf = async (me, cid) => (await query('SELECT role, status FROM bloom_community_members WHERE community_id = $1 AND profile_id = $2', [cid, me])).rows[0] ?? null;
const isMod = (m) => m && m.status === 'active' && ['owner', 'mod'].includes(m.role);
const findC = async (me, key) => {
  const k = String(key ?? ''); const col = /^bcm-/.test(k) ? 'c.id' : 'c.slug';
  const r = (await query(`${base} WHERE ${col} = $2 AND c.deleted_at IS NULL`, [me, k.toLowerCase() === k ? k : k.toLowerCase()])).rows[0];
  return r ?? null;
};

export const create = async (me, b) => {
  const name = line(b.name, 50); if (name.length < 3) return { error: 'bad_name' };
  const slug = String(b.slug ?? '').toLowerCase().trim(); if (!/^[a-z0-9_]{3,30}$/.test(slug) || RESERVED.has(slug)) return { error: 'bad_slug' };
  const privacy = b.privacy === 'closed' ? 'closed' : 'public'; const policy = b.postPolicy === 'mods' ? 'mods' : 'all';
  const color = colorOk(b.color) ? b.color : '#8b5cf6'; const emoji = [...String(b.emoji ?? '🌸')].slice(0, 2).join('') || '🌸';
  if ((await query('SELECT count(*)::int AS c FROM bloom_communities WHERE owner_id = $1 AND deleted_at IS NULL', [me])).rows[0].c >= MAX_OWNED) return { error: 'too_many_communities' };
  if ((await query(`SELECT count(*)::int AS c FROM bloom_communities WHERE owner_id = $1 AND created_at > now() - interval '24 hours'`, [me])).rows[0].c >= MAX_PER_DAY) return { error: 'daily_limit' };
  const cv = await checkContent('bloom_community', me, [name, clean(b.description, 500)]);
  if (cv.action === 'block' || cv.action === 'moderate') return blockedReply(cv);
  const id = `bcm-${crypto.randomUUID()}`; const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO bloom_communities (id, slug, name, description, emoji, color, privacy, post_policy, rules, owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, slug, name, clean(b.description, 500), emoji, color, privacy, policy, JSON.stringify(shapeRules(b.rules)), me]);
    await client.query(`INSERT INTO bloom_community_members (community_id, profile_id, role, status) VALUES ($1,$2,'owner','active')`, [id, me]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); if (e.code === '23505') return { error: 'slug_taken' }; throw e; } finally { client.release(); }
  await log(id, me, 'created'); return { ok: true, id, slug };
};

export const update = async (me, id, b) => {
  const c = await findC(me, id); if (!c) return { error: 'not_found' }; const m = c.mine; if (m?.role !== 'owner') return { error: 'forbidden' };
  const set = []; const args = [c.id]; const put = (col, v) => { args.push(v); set.push(`${col} = $${args.length}`); };
  if ('name' in b) { const n = line(b.name, 50); if (n.length < 3) return { error: 'bad_name' }; put('name', n); }
  if ('description' in b) put('description', clean(b.description, 500));
  if ('emoji' in b) put('emoji', [...String(b.emoji)].slice(0, 2).join('') || '🌸'); if ('color' in b && colorOk(b.color)) put('color', b.color);
  if ('privacy' in b) { if (!['public', 'closed'].includes(b.privacy)) return { error: 'bad_privacy' }; put('privacy', b.privacy); }
  if ('postPolicy' in b) { if (!['all', 'mods'].includes(b.postPolicy)) return { error: 'bad_policy' }; put('post_policy', b.postPolicy); }
  if ('rules' in b) put('rules', JSON.stringify(shapeRules(b.rules)));
  if (!set.length) return { ok: true };
  if ('name' in b || 'description' in b) {
    const cv = await checkContent('bloom_community', me, [String(b.name ?? ''), String(b.description ?? '')]);
    if (cv.action === 'block' || cv.action === 'moderate') return blockedReply(cv);
  }
  await query(`UPDATE bloom_communities SET ${set.join(', ')} WHERE id = $1`, args); await log(c.id, me, 'updated', null, Object.keys(b).join(','));
  // закрытое → публичное: ожидающие заявки принимаются не автоматически, владелец решает сам
  return { ok: true };
};
export const remove = async (me, id) => {
  const c = await findC(me, id); if (!c) return { error: 'not_found' }; if (c.mine?.role !== 'owner') return { error: 'forbidden' };
  await query('UPDATE bloom_communities SET deleted_at = now() WHERE id = $1', [c.id]); await query('UPDATE bloom_posts SET deleted_at = now() WHERE community_id = $1 AND deleted_at IS NULL', [c.id]);
  await log(c.id, me, 'deleted'); return { ok: true };
};

export const list = async (me, { q, sort } = {}) => {
  const term = line(q, 60).toLowerCase();
  const where = [`c.deleted_at IS NULL`, 'NOT c.blocked']; const args = [me];
  if (term) { args.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(lower(c.name) LIKE $${args.length} OR lower(c.slug) LIKE $${args.length} OR lower(c.description) LIKE $${args.length})`); }
  if (sort === 'mine') where.push(`EXISTS (SELECT 1 FROM bloom_community_members mm WHERE mm.community_id = c.id AND mm.profile_id = $1 AND mm.status IN ('active','pending'))`);
  const order = sort === 'new' ? 'c.created_at DESC' : 'members DESC, c.created_at DESC';
  const rows = (await query(`SELECT * FROM (${base} WHERE ${where.join(' AND ')}) c ORDER BY ${order} LIMIT 60`, args)).rows;
  return { communities: rows.map((r) => view(r)) };
};
export const get = async (me, key) => {
  const c = await findC(me, key); if (!c) return { error: 'not_found' };
  const staff = !c.blocked ? false : await can(me, 'bloom_communities') || await isOwner(me);
  if (c.blocked && !staff && c.owner_id !== me) return { error: 'not_found' };
  const owner = (await query('SELECT id, name, username FROM profiles WHERE id = $1', [c.owner_id])).rows[0];
  const mods = (await query(`SELECT p.id, p.name, p.username, m.role FROM bloom_community_members m JOIN profiles p ON p.id = m.profile_id WHERE m.community_id = $1 AND m.role IN ('owner','mod') AND m.status = 'active' ORDER BY m.role DESC, m.created_at`, [c.id])).rows;
  const full = view(c, true);
  const visibleContent = c.privacy === 'public' || c.mine?.status === 'active';
  return { ok: true, community: { ...full, owner, mods, blockReason: c.blocked ? c.block_reason : undefined, contentVisible: visibleContent } };
};

export const join = async (me, id) => {
  const c = await findC(me, id); if (!c || c.blocked) return { error: 'not_found' };
  const m = c.mine; if (m?.status === 'banned') return { error: 'banned' }; if (m?.status === 'active') return { ok: true, status: 'active' };
  if (m?.status === 'pending') return { ok: true, status: 'pending' };
  const status = c.privacy === 'public' ? 'active' : 'pending';
  const r = await query(`INSERT INTO bloom_community_members (community_id, profile_id, role, status) VALUES ($1,$2,'member',$3) ON CONFLICT (community_id, profile_id) DO NOTHING RETURNING status`, [c.id, me, status]);
  if (!r.rowCount) return { error: 'bad_state' };
  if (status === 'pending') await notifyGift(c.owner_id, 'bloom_community', 'Заявка в сообщество', `Новая заявка на вступление в «${c.name}». Откройте сообщество, чтобы принять или отклонить.`, c.id).catch(() => {});
  return { ok: true, status };
};
export const leave = async (me, id) => {
  const c = await findC(me, id); if (!c) return { error: 'not_found' }; const m = c.mine; if (!m) return { ok: true }; if (m.role === 'owner') return { error: 'owner_cannot_leave' };
  if (m.status === 'banned') return { error: 'banned' };           // бан запоминается: выйти и вернуться нельзя
  await query('DELETE FROM bloom_community_members WHERE community_id = $1 AND profile_id = $2', [c.id, me]); return { ok: true };
};
export const members = async (me, id) => {
  const c = await findC(me, id); if (!c) return { error: 'not_found' }; const m = c.mine; const mod = isMod(m);
  if (c.privacy === 'closed' && m?.status !== 'active') return { error: 'forbidden' };
  const rows = (await query(`SELECT m.profile_id, m.role, m.status, m.ban_reason, p.name, p.username FROM bloom_community_members m JOIN profiles p ON p.id = m.profile_id WHERE m.community_id = $1 ${mod ? '' : `AND m.status = 'active'`} ORDER BY (m.role = 'owner') DESC, (m.role = 'mod') DESC, m.created_at LIMIT 300`, [c.id])).rows;
  return { members: rows.map((r) => ({ id: r.profile_id, name: r.name, username: r.username, role: r.role, status: r.status, ...(mod && r.status === 'banned' ? { banReason: r.ban_reason } : {}) })), canModerate: mod };
};
/** action: approve | reject | kick | ban | unban | promote | demote. Модератор не трогает владельца и других модераторов; повышать и понижать может только владелец. */
export const moderate = async (me, id, target, action, reason) => {
  const c = await findC(me, id); if (!c) return { error: 'not_found' }; const mm = c.mine; if (!isMod(mm)) return { error: 'forbidden' };
  if (target === me) return { error: 'self' };
  const t = await roleOf(target, c.id); if (!t) return { error: 'not_found' }; if (t.role === 'owner') return { error: 'forbidden' };
  if (t.role === 'mod' && mm.role !== 'owner') return { error: 'forbidden' };
  const why = line(reason, 300);
  if (action === 'approve') { if (t.status !== 'pending') return { error: 'bad_state' }; await query(`UPDATE bloom_community_members SET status = 'active' WHERE community_id = $1 AND profile_id = $2`, [c.id, target]); await notifyGift(target, 'bloom_community', 'Заявка принята', `Вас приняли в сообщество «${c.name}».`, c.id).catch(() => {}); }
  else if (action === 'reject') { if (t.status !== 'pending') return { error: 'bad_state' }; await query('DELETE FROM bloom_community_members WHERE community_id = $1 AND profile_id = $2', [c.id, target]); }
  else if (action === 'kick') { if (t.status !== 'active') return { error: 'bad_state' }; await query('DELETE FROM bloom_community_members WHERE community_id = $1 AND profile_id = $2', [c.id, target]); await notifyGift(target, 'bloom_community', 'Вы исключены из сообщества', `Вас исключили из «${c.name}»${why ? `: ${why}` : '.'}`, c.id).catch(() => {}); }
  else if (action === 'ban') { if (why.length < 3) return { error: 'reason_required' }; await query(`UPDATE bloom_community_members SET status = 'banned', role = 'member', ban_reason = $3 WHERE community_id = $1 AND profile_id = $2`, [c.id, target, why]); await notifyGift(target, 'bloom_community', 'Вы заблокированы в сообществе', `Вам закрыт доступ к «${c.name}»: ${why}`, c.id).catch(() => {}); }
  else if (action === 'unban') { if (t.status !== 'banned') return { error: 'bad_state' }; await query('DELETE FROM bloom_community_members WHERE community_id = $1 AND profile_id = $2', [c.id, target]); }
  else if (action === 'promote' || action === 'demote') { if (mm.role !== 'owner') return { error: 'forbidden' }; if (t.status !== 'active') return { error: 'bad_state' }; await query(`UPDATE bloom_community_members SET role = $3 WHERE community_id = $1 AND profile_id = $2`, [c.id, target, action === 'promote' ? 'mod' : 'member']); }
  else return { error: 'bad_action' };
  await log(c.id, me, action, target, why); return { ok: true };
};
/** Закрепить пост или снять пост модерацией (удаление не стирает следов: причина — в журнале, автору приходит уведомление). */
export const pinPost = async (me, postId, on) => {
  const p = (await query('SELECT community_id FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL AND community_id IS NOT NULL', [postId])).rows[0]; if (!p) return { error: 'not_found' };
  if (!isMod(await roleOf(me, p.community_id))) return { error: 'forbidden' };
  if (on) { const n = (await query('SELECT count(*)::int AS c FROM bloom_posts WHERE community_id = $1 AND community_pinned AND deleted_at IS NULL', [p.community_id])).rows[0].c; if (n >= 3) return { error: 'too_many_pinned' }; }
  await query('UPDATE bloom_posts SET community_pinned = $2 WHERE id = $1', [postId, on === true]); await log(p.community_id, me, on ? 'pin' : 'unpin', postId); return { ok: true };
};
export const removePost = async (me, postId, reason) => {
  const p = (await query('SELECT community_id, author_id FROM bloom_posts WHERE id = $1 AND deleted_at IS NULL AND community_id IS NOT NULL', [postId])).rows[0]; if (!p) return { error: 'not_found' };
  const mm = await roleOf(me, p.community_id); if (!isMod(mm)) return { error: 'forbidden' }; const why = line(reason, 300); if (why.length < 3) return { error: 'reason_required' };
  const a = await roleOf(p.author_id, p.community_id); if (p.author_id !== me && ['owner', 'mod'].includes(a?.role) && mm.role !== 'owner') return { error: 'forbidden' };
  await query('UPDATE bloom_posts SET deleted_at = now() WHERE id = $1', [postId]); await log(p.community_id, me, 'remove_post', postId, why);
  if (p.author_id !== me) await notifyGift(p.author_id, 'bloom_community', 'Пост удалён модератором', `Ваш пост в сообществе удалён: ${why}`, p.community_id).catch(() => {});
  return { ok: true };
};
export const modLog = async (me, id) => {
  const c = await findC(me, id); if (!c) return { error: 'not_found' }; if (!isMod(c.mine)) return { error: 'forbidden' };
  return { log: (await query(`SELECT l.action, l.target, l.reason, l.at, p.name AS actor FROM bloom_community_log l LEFT JOIN profiles p ON p.id = l.actor_id WHERE l.community_id = $1 ORDER BY l.at DESC LIMIT 100`, [c.id])).rows };
};

/* ─── Жалобы и администрация Sky ──────────────────────────────────── */
export const report = async (me, id, reason, text) => {
  const c = await findC(me, id); if (!c || c.blocked) return { error: 'not_found' }; if (c.owner_id === me) return { error: 'own' };
  if (!Object.hasOwn(REPORT_REASONS, String(reason))) return { error: 'bad_reason' };
  if (c.privacy === 'closed' && c.mine?.status !== 'active') return { error: 'forbidden' };
  if ((await query(`SELECT count(*)::int AS c FROM bloom_community_reports WHERE reporter_id = $1 AND created_at > now() - interval '24 hours'`, [me])).rows[0].c >= 10) return { error: 'daily_limit' };
  const rid = `bcr-${crypto.randomUUID()}`;
  try { await query('INSERT INTO bloom_community_reports (id, community_id, reporter_id, reason, text) VALUES ($1,$2,$3,$4,$5)', [rid, c.id, me, reason, clean(text, 500) || null]); } catch { return { error: 'already_reported' }; }
  void notifyStaff('bloom_community', { title: 'Жалоба на сообщество Bloom', body: 'Поступила жалоба на сообщество.', dedupe: `bcr:${c.id}:${(Date.now() / 600000) | 0}`, except: me });
  return { ok: true };
};
const need = async (me) => (await can(me, 'bloom_communities')) || (await isOwner(me));
export const adminList = async (me, { q, status } = {}) => {
  if (!(await need(me))) return { error: 'not_allowed' };
  const where = ['c.deleted_at IS NULL']; const args = [me]; const term = line(q, 60).toLowerCase();
  if (term) { args.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`); where.push(`(lower(c.name) LIKE $${args.length} OR lower(c.slug) LIKE $${args.length})`); }
  if (status === 'blocked') where.push('c.blocked'); if (status === 'reported') where.push(`EXISTS (SELECT 1 FROM bloom_community_reports r WHERE r.community_id = c.id AND r.status = 'open')`);
  const rows = (await query(`SELECT * FROM (${base} WHERE ${where.join(' AND ')}) c ORDER BY members DESC LIMIT 100`, args)).rows;
  const reports = (await query(`SELECT r.id, r.community_id, r.reason, r.text, r.created_at, c.name, c.slug FROM bloom_community_reports r JOIN bloom_communities c ON c.id = r.community_id WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100`)).rows;
  return { communities: rows.map((r) => ({ ...view(r), ownerId: r.owner_id, blockReason: r.block_reason })), reports: reports.map((r) => ({ id: r.id, communityId: r.community_id, name: r.name, slug: r.slug, reason: REPORT_REASONS[r.reason] ?? r.reason, text: r.text, createdAt: r.created_at })) };
};
export const adminBlock = async (me, id, block, reason) => {
  if (!(await need(me))) return { error: 'not_allowed' }; const why = line(reason, 300); if (why.length < 5) return { error: 'reason_required' };
  const c = (await query('SELECT id, owner_id, name FROM bloom_communities WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0]; if (!c) return { error: 'not_found' };
  if (await isOwner(c.owner_id)) return { error: 'forbidden' };
  await query('UPDATE bloom_communities SET blocked = $2, block_reason = $3, blocked_by = $4 WHERE id = $1', [id, block === true, block ? why : null, me]);
  await log(id, me, block ? 'admin_block' : 'admin_unblock', null, why); await logAdmin({ actorId: me, targetType: 'bloom_community', targetId: id, type: block ? 'bloom_community_block' : 'bloom_community_unblock', detail: why.slice(0, 200) });
  await notifyGift(c.owner_id, 'bloom_community', block ? 'Сообщество заблокировано' : 'Сообщество разблокировано', block ? `Сообщество «${c.name}» заблокировано администрацией: ${why}` : `Сообщество «${c.name}» снова доступно.`, id).catch(() => {});
  return { ok: true };
};
export const adminReport = async (me, rid, action, note) => {
  if (!(await need(me))) return { error: 'not_allowed' }; const n = line(note, 300); if (n.length < 5) return { error: 'reason_required' };
  const r = await query(`UPDATE bloom_community_reports SET status = $2, decided_by = $3, decision = $4, decided_at = now() WHERE id = $1 AND status = 'open' RETURNING community_id`, [rid, action === 'dismiss' ? 'dismissed' : 'resolved', me, n]);
  if (!r.rowCount) return { error: 'bad_state' }; await logAdmin({ actorId: me, targetType: 'bloom_community', targetId: r.rows[0].community_id, type: 'bloom_community_report', detail: `${action}: ${n}`.slice(0, 200) }); return { ok: true };
};
