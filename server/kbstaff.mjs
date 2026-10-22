/**
 * SkyKassa Business, этап 3: сотрудники и роли.
 * Владелец один; остальные — приглашённые по @username с принятием приглашения. Один человек состоит не более чем в одном бизнесе.
 * Права по ролям задаёт сервер (PERMS); сотрудник действует от имени бизнеса, но каждое изменение пишется в журнал с его именем.
 * Реквизиты, подписка, публикация, сотрудники и данные бизнеса — только владельцу (смена реквизитов требует его код аутентификатора).
 */
import { query } from './db.mjs';
import { newId, clean, profileCards } from './gocore.mjs';
import { notifyGift } from './giftnotify.mjs';
import { err, audit } from './kbiz.mjs';

export const ROLES = { admin: 'Администратор', manager: 'Менеджер', cashier: 'Кассир' };
/** group → роли, которым разрешено (владелец может всё). */
export const PERMS = {
  view:      ['admin', 'manager', 'cashier'],     // обзор, список заявок, список QR
  cash:      ['admin', 'manager', 'cashier'],     // касса, временный QR на сумму
  qr:        ['admin', 'manager'],                // постоянные QR, статусы QR
  confirm:   ['admin', 'manager'],                // решения по заявкам на оплату
  catalog:   ['admin', 'manager'],                // товары, заказы, счета, чаевые, промокоды, отзывы
  shop:      ['admin'],                           // настройки витрины и пакет для VPS
  analytics: ['admin', 'manager'],
  audit:     ['admin'],
  placeview: ['admin', 'manager'],                // Sky GO: записи, отзывы, статистика, карточка (чтение)
  placeops:  ['admin', 'manager'],                // Sky GO: решения по записям, ответы на отзывы
  placecard: ['admin'],                           // Sky GO: правка карточки, расписания, фото, отправка на проверку
  owner:     [],                                  // только владелец
};

/** Кем человек является в SkyKassa Business: владелец, активный сотрудник или никем. */
export const accessOf = async (profileId) => {
  const { rows: o } = await query('SELECT id, owner_id FROM kb_businesses WHERE owner_id = $1', [profileId]);
  if (o[0]) return { role: 'owner', businessId: o[0].id, ownerId: o[0].owner_id };
  const { rows } = await query(`SELECT s.role, s.business_id, b.owner_id FROM kb_staff s JOIN kb_businesses b ON b.id = s.business_id WHERE s.profile_id = $1 AND s.status = 'active'`, [profileId]);
  return rows[0] ? { role: rows[0].role, businessId: rows[0].business_id, ownerId: rows[0].owner_id } : null;
};
export const can = (access, group) => Boolean(access) && (access.role === 'owner' || (PERMS[group] ?? []).includes(access.role));

export const listStaff = async (ownerId) => {
  const { rows: b } = await query('SELECT id FROM kb_businesses WHERE owner_id = $1', [ownerId]); if (!b[0]) return { staff: [] };
  const { rows } = await query(`SELECT id, profile_id, role, status, created_at FROM kb_staff WHERE business_id = $1 AND status IN ('invited','active') ORDER BY created_at`, [b[0].id]);
  const cards = await profileCards(rows.map((r) => r.profile_id));
  return { staff: rows.map((r) => ({ id: r.id, name: cards.get(r.profile_id)?.name ?? '', username: cards.get(r.profile_id)?.username ?? '', role: r.role, roleLabel: ROLES[r.role], status: r.status, createdAt: r.created_at.toISOString() })) };
};

export const invite = async (ownerId, { username, role }) => {
  const { rows: b } = await query('SELECT id, name, status FROM kb_businesses WHERE owner_id = $1', [ownerId]); if (!b[0]) return err('no_business');
  if (b[0].status === 'suspended') return err('suspended');
  if (!Object.hasOwn(ROLES, role)) return err('bad_field', { field: 'role' });
  const uname = clean(username, 40).replace(/^@/, '').toLowerCase();
  const { rows: p } = await query('SELECT id FROM profiles WHERE lower(username) = $1', [uname]);
  if (!p[0]) return err('user_not_found');
  if (p[0].id === ownerId) return err('bad_field', { field: 'username' });
  const { rows: own } = await query('SELECT 1 FROM kb_businesses WHERE owner_id = $1', [p[0].id]); if (own[0]) return err('already_in_business');
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM kb_staff WHERE business_id = $1 AND status IN ('invited','active')`, [b[0].id]); if (cnt[0].n >= 30) return err('too_many_staff');
  const id = newId('kbs2');
  try { await query(`INSERT INTO kb_staff (id, business_id, profile_id, role, invited_by) VALUES ($1,$2,$3,$4,$5)`, [id, b[0].id, p[0].id, role, ownerId]); }
  catch (e) { if (e.code === '23505') return err('already_in_business'); throw e; }
  await audit(b[0].id, ownerId, 'staff_invited', `@${uname}: ${ROLES[role]}`);
  await notifyGift(p[0].id, 'kassa_biz', 'Приглашение в SkyKassa Business', `Вас приглашают в бизнес «${b[0].name}» (${ROLES[role]}). Примите или откажитесь в Профиль → Sky для бизнеса.`, `kbinv:${id}`).catch(() => {});
  return { ok: true, id };
};

export const myInvites = async (profileId) => {
  const { rows } = await query(`SELECT s.id, s.role, b.name FROM kb_staff s JOIN kb_businesses b ON b.id = s.business_id WHERE s.profile_id = $1 AND s.status = 'invited'`, [profileId]);
  return { invites: rows.map((r) => ({ id: r.id, role: r.role, roleLabel: ROLES[r.role], business: r.name })) };
};

export const answerInvite = async (profileId, id, accept) => {
  const { rows: own } = await query('SELECT 1 FROM kb_businesses WHERE owner_id = $1', [profileId]); if (accept && own[0]) return err('already_in_business');
  const { rows } = await query(`UPDATE kb_staff SET status = $3, updated_at = now() WHERE id = $1 AND profile_id = $2 AND status = 'invited' RETURNING business_id, role`, [String(id ?? ''), profileId, accept ? 'active' : 'removed']);
  if (!rows[0]) return err('not_found');
  await audit(rows[0].business_id, profileId, accept ? 'staff_joined' : 'staff_declined', ROLES[rows[0].role]);
  return { ok: true };
};

export const setRole = async (ownerId, id, role) => {
  if (!Object.hasOwn(ROLES, role)) return err('bad_field', { field: 'role' });
  const { rows } = await query(`UPDATE kb_staff s SET role = $3, updated_at = now() FROM kb_businesses b WHERE s.id = $1 AND b.id = s.business_id AND b.owner_id = $2 AND s.status IN ('invited','active') RETURNING s.business_id`, [String(id ?? ''), ownerId, role]);
  if (!rows[0]) return err('not_found');
  await audit(rows[0].business_id, ownerId, 'staff_role', `${id}: ${ROLES[role]}`);
  return { ok: true };
};

/** Убрать сотрудника (владелец) или выйти самому (сам сотрудник). */
export const removeStaff = async (actorId, ownerId, id) => {
  const { rows } = await query(
    `UPDATE kb_staff s SET status = 'removed', updated_at = now() FROM kb_businesses b
      WHERE s.id = $1 AND b.id = s.business_id AND s.status IN ('invited','active') AND (b.owner_id = $2 OR s.profile_id = $3) RETURNING s.business_id, s.profile_id`, [String(id ?? ''), ownerId, actorId]);
  if (!rows[0]) return err('not_found');
  await audit(rows[0].business_id, actorId, rows[0].profile_id === actorId ? 'staff_left' : 'staff_removed', id);
  return { ok: true };
};
