/**
 * Sky GO — бизнес: организация, сотрудники, роли, назначение заказов.
 *
 * Организация строится на уже существующей регистрации «Компания (доставки)» (goreg.mjs): одобренная заявка
 * компании = организация (создаётся один раз, имя — «Название для заказов» из анкеты). Своей авторизации,
 * своих юридических проверок и своих подписок здесь нет: люди — профили Sky ID, допуск исполнителей — их
 * собственная регистрация «Курьер» и её подписка (gosubs.mjs).
 *
 * Роли в организации:
 *   owner   — владелец (один, не меняется);
 *   admin   — всё, кроме владельца и других администраторов;
 *   manager — заказы и назначения, без управления командой и настройками;
 *   driver / courier — исполнители: видят и выполняют только свои заказы.
 * Все проверки — здесь, на сервере; интерфейс лишь рисует то, что сервер разрешил.
 *
 * Заказ организации — обычный заказ доставки (go_orders) с org_id. Статусы и коды — те же, что у всей доставки
 * (godelivery.mjs); сюда добавлено только назначение: диспетчер назначает исполнителя из команды, исполнитель
 * принимает назначение, отказаться может только с причиной. Деньги через Sky между организацией и её сотрудником
 * не ходят: заказ своего сотрудника закрывается вручением (data.internal), заказ внешнего курьера из общего потока
 * идёт прежним путём — прямая оплата.
 */
import { offerNext } from './godispatch.mjs';
import { query } from './db.mjs';
import { executorStatus } from './goreg.mjs';
import { canWork } from './gosubs.mjs';
import * as delivery from './godelivery.mjs';
import { orderView, payRow } from './gopay.mjs';
import { newId, inTx, lockOrder, addEvent, notifyGo, goLog, clean, openJson, profileCards, haversineKm, resolvePoint, pushOrderChanged, cityOk } from './gocore.mjs';

export const ORG_ROLES = ['owner', 'admin', 'manager', 'driver', 'courier'];
export const ROLE_LABEL = { owner: 'Владелец', admin: 'Администратор', manager: 'Менеджер', driver: 'Водитель', courier: 'Курьер' };
export const STAFF = ['owner', 'admin', 'manager'];
const GRANT = { owner: ['admin', 'manager', 'driver', 'courier'], admin: ['manager', 'driver', 'courier'] };
const ACTIVE_ST = ['assigned', 'heading_pickup', 'at_pickup', 'picked_up', 'delivering', 'at_recipient'];
const OPEN_ST = ['searching', ...ACTIVE_ST, 'awaiting_payment', 'payment_reported', 'dispute'];
const MAX_ACTIVE = 3;
const STALE_SEARCH_MIN = 15;

export const audit = (orgId, actorId, action, subject, detail = {}) =>
  query('INSERT INTO go_org_audit (org_id, actor_id, action, subject, detail) VALUES ($1,$2,$3,$4,$5::jsonb)', [orgId, actorId ?? null, action, subject ?? null, JSON.stringify(detail)]).catch(() => {});

/* ─── Организация и членство ───────────────────────────────────────── */

/** Организация владельца с одобренной ролью «компания»: создаётся при первом обращении, один раз. */
export const ensureOrg = async (profileId) => {
  const { rows: ex } = await query('SELECT id FROM go_orgs WHERE owner_id = $1', [profileId]);
  if (ex[0]) return ex[0].id;
  const co = await executorStatus(profileId, 'company');
  if (!co || co.status !== 'approved') return null;
  const d = openJson(co.data_enc); const brand = clean(d.extra?.brand ?? d.fields?.brand, 120);
  const { rows: p } = await query('SELECT name FROM profiles WHERE id = $1', [profileId]);
  const id = newId('org');
  const ins = await query(
    `INSERT INTO go_orgs (id, owner_id, name, city) VALUES ($1,$2,$3,$4) ON CONFLICT (owner_id) DO NOTHING RETURNING id`,
    [id, profileId, brand || p[0]?.name || 'Организация', co.city ?? '']);
  const orgId = ins.rows[0]?.id ?? (await query('SELECT id FROM go_orgs WHERE owner_id = $1', [profileId])).rows[0].id;
  await query(`INSERT INTO go_org_members (org_id, profile_id, role, status, joined_at) VALUES ($1,$2,'owner','active', now()) ON CONFLICT DO NOTHING`, [orgId, profileId]);
  if (ins.rows[0]) await audit(orgId, profileId, 'org_create', null, { name: brand });
  return orgId;
};

const getOrg = async (orgId) => (await query('SELECT * FROM go_orgs WHERE id = $1', [String(orgId ?? '')])).rows[0] ?? null;
const membership = async (profileId, orgId) =>
  (await query(`SELECT * FROM go_org_members WHERE org_id = $1 AND profile_id = $2`, [String(orgId ?? ''), profileId])).rows[0] ?? null;

/** Нужна роль из списка: не участник организации не узнаёт о её существовании (not_found), участник без права получает not_allowed. */
export const need = async (profileId, orgId, roles) => {
  const org = await getOrg(orgId);
  const m = org ? await membership(profileId, orgId) : null;
  if (!org || !m || m.status === 'removed' || m.status === 'declined' || m.status === 'invited') return { error: 'not_found' };
  if (m.status !== 'active' || !roles.includes(m.role)) return { error: 'not_allowed' };
  return { org, m };
};

/** Рабочие пространства человека: организации (где он принят) + приглашения. Исполнительские кабинеты клиент берёт из /executors. */
export const workspaces = async (profileId) => {
  await ensureOrg(profileId);
  const { rows } = await query(
    `SELECT o.id, o.name, o.suspended, m.role, m.status FROM go_org_members m JOIN go_orgs o ON o.id = m.org_id
      WHERE m.profile_id = $1 AND m.status IN ('active','suspended') ORDER BY m.joined_at`, [profileId]);
  const { rows: inv } = await query(
    `SELECT o.id AS org_id, o.name, m.role, m.invited_at, m.invited_by FROM go_org_members m JOIN go_orgs o ON o.id = m.org_id
      WHERE m.profile_id = $1 AND m.status = 'invited' AND NOT o.suspended ORDER BY m.invited_at DESC`, [profileId]);
  const cards = await profileCards(inv.map((i) => i.invited_by));
  return {
    orgs: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, roleLabel: ROLE_LABEL[r.role], status: r.status, suspended: r.suspended, staff: STAFF.includes(r.role) })),
    invites: inv.map((i) => ({ orgId: i.org_id, orgName: i.name, role: i.role, roleLabel: ROLE_LABEL[i.role], at: i.invited_at.toISOString(), by: cards.get(i.invited_by) ?? null })),
  };
};

/* ─── Уведомления сотрудникам ──────────────────────────────────────── */
export const notifyStaff = async (orgId, title, body, refId, dedupe, except = null) => {
  const { rows } = await query(`SELECT profile_id FROM go_org_members WHERE org_id = $1 AND status = 'active' AND role IN ('owner','admin','manager')`, [orgId]);
  for (const r of rows) if (r.profile_id !== except) await notifyGo(r.profile_id, 'org', title, body, refId, dedupe ? `${dedupe}:${r.profile_id}` : null);
};

/* ─── Организация: настройки, точки ───────────────────────────────── */
export const getSettings = async (actorId, orgId) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const co = await executorStatus(a.org.owner_id, 'company');
  const { rows: pts } = await query('SELECT id, title, address, lat, lng FROM go_org_points WHERE org_id = $1 ORDER BY created_at', [orgId]);
  const canEdit = ['owner', 'admin'].includes(a.m.role);
  return {
    org: { id: a.org.id, name: a.org.name, city: a.org.city, phone: canEdit ? a.org.phone : undefined, assignMode: a.org.assign_mode, suspended: a.org.suspended, createdAt: a.org.created_at.toISOString() },
    myRole: a.m.role,
    // Статус проверки — настоящий, из регистрации компании; ничего «подтверждённого» от нас сверх него нет.
    verification: co ? { status: co.status, legalForm: co.legal_form } : { status: 'none' },
    points: pts.map((p) => ({ id: p.id, title: p.title, address: p.address, located: p.lat != null })),
    canEdit,
  };
};

export const updateSettings = async (actorId, orgId, input) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  const sets = []; const args = [orgId];
  const add = (col, val) => { args.push(val); sets.push(`${col} = $${args.length}`); };
  if (input?.name != null) { const n = clean(input.name, 120); if (n.length < 2) return { error: 'name_required' }; add('name', n); }
  if (input?.phone != null) { const ph = String(input.phone).replace(/[^\d+]/g, '').slice(0, 16); if (ph && !/^\+?\d{10,15}$/.test(ph)) return { error: 'phone_invalid' }; add('phone', ph); }
  if (input?.assignMode != null) { if (!['manual', 'auto', 'pool'].includes(input.assignMode)) return { error: 'bad_mode' }; add('assign_mode', input.assignMode); }
  if (!sets.length) return { ok: true };
  await query(`UPDATE go_orgs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, args);
  await audit(orgId, actorId, 'settings', null, { fields: Object.keys(input ?? {}).filter((k) => ['name', 'phone', 'assignMode'].includes(k)) });
  return { ok: true };
};

export const addPoint = async (actorId, orgId, input) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  const { rows: n } = await query('SELECT count(*)::int AS n FROM go_org_points WHERE org_id = $1', [orgId]);
  if (n[0].n >= 30) return { error: 'too_many_points' };
  const title = clean(input?.title, 80); if (title.length < 2) return { error: 'title_required' };
  const r = await resolvePoint({ address: input?.address, lat: input?.lat, lng: input?.lng });
  if (r.error && r.error !== 'address_not_found') return r;
  const addr = clean(input?.address, 240);
  if (addr.length < 5) return { error: 'address_required' };
  const id = newId('pt');
  await query('INSERT INTO go_org_points (id, org_id, title, address, lat, lng) VALUES ($1,$2,$3,$4,$5,$6)', [id, orgId, title, addr, r.point?.lat ?? null, r.point?.lng ?? null]);
  await audit(orgId, actorId, 'point_add', id, { title });
  return { ok: true, id, located: Boolean(r.point) };
};
export const removePoint = async (actorId, orgId, pointId) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  const { rowCount } = await query('DELETE FROM go_org_points WHERE id = $1 AND org_id = $2', [String(pointId ?? ''), orgId]);
  if (!rowCount) return { error: 'not_found' };
  await audit(orgId, actorId, 'point_remove', pointId);
  return { ok: true };
};

/* ─── Сотрудники ───────────────────────────────────────────────────── */
export const listMembers = async (actorId, orgId) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const { rows } = await query(
    `SELECT m.profile_id, m.role, m.status, m.invited_at, m.joined_at,
            (SELECT status FROM go_executors e WHERE e.profile_id = m.profile_id AND e.role = 'courier') AS courier_status,
            (SELECT bool_or(s.expires_at > now()) FROM go_subscriptions s WHERE s.profile_id = m.profile_id AND s.role = 'courier') AS sub_active,
            (SELECT online FROM go_presence p WHERE p.profile_id = m.profile_id AND p.role = 'courier') AS online,
            (SELECT count(*)::int FROM go_orders o WHERE o.org_id = $1 AND o.executor_id = m.profile_id AND o.status = ANY($2::text[])) AS active_orders,
            (SELECT count(*)::int FROM go_orders o WHERE o.org_id = $1 AND o.executor_id = m.profile_id AND o.status = 'paid') AS done_orders
       FROM go_org_members m WHERE m.org_id = $1 AND m.status IN ('invited','active','suspended') ORDER BY (m.role = 'owner') DESC, m.joined_at NULLS LAST`, [orgId, ACTIVE_ST]);
  const cards = await profileCards(rows.map((r) => r.profile_id));
  const me = a.m.role;
  return {
    myRole: me,
    canManage: Boolean(GRANT[me]),
    grantable: GRANT[me] ?? [],
    // Только то, что нужно для работы: имя, ник, роль, готовность к назначениям, нагрузка. Телефонов, документов и ИНН здесь нет.
    members: rows.map((r) => ({
      profileId: r.profile_id, name: cards.get(r.profile_id)?.name ?? '', username: cards.get(r.profile_id)?.username ?? '', avatar: cards.get(r.profile_id)?.avatar ?? null,
      role: r.role, roleLabel: ROLE_LABEL[r.role], status: r.status, joinedAt: r.joined_at?.toISOString?.() ?? null,
      ready: r.courier_status === 'approved' && Boolean(r.sub_active), courierStatus: r.courier_status ?? 'none', online: Boolean(r.online),
      activeOrders: r.active_orders, doneOrders: r.done_orders, self: r.profile_id === actorId,
    })),
  };
};

export const invite = async (actorId, orgId, { username, role }) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  if (a.org.suspended) return { error: 'org_suspended' };
  if (!GRANT[a.m.role].includes(role)) return { error: 'role_not_allowed' };
  const uname = clean(username, 40).replace(/^@/, '').toLowerCase();
  const { rows } = await query('SELECT id, name FROM profiles WHERE lower(username) = $1', [uname]);
  if (!rows[0]) return { error: 'profile_not_found' };
  const target = rows[0].id;
  if (target === actorId) return { error: 'self_invite' };
  const cur = await membership(target, orgId);
  if (cur && ['invited', 'active', 'suspended'].includes(cur.status)) return { error: 'already_member', status: cur.status };
  const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM go_org_members WHERE org_id = $1 AND status IN ('invited','active','suspended')`, [orgId]);
  if (cnt[0].n >= 200) return { error: 'too_many_members' };
  await query(
    `INSERT INTO go_org_members (org_id, profile_id, role, status, invited_by, invited_at) VALUES ($1,$2,$3,'invited',$4, now())
     ON CONFLICT (org_id, profile_id) DO UPDATE SET role = $3, status = 'invited', invited_by = $4, invited_at = now(), joined_at = NULL, updated_at = now()`,
    [orgId, target, role, actorId]);
  await audit(orgId, actorId, 'invite', target, { role });
  await notifyGo(target, 'org', 'Приглашение в организацию', `«${a.org.name}» приглашает вас: ${ROLE_LABEL[role]}. Откройте Sky GO → Работа.`, orgId, `invite:${orgId}:${target}:${Date.now() / 3.6e6 | 0}`);
  return { ok: true };
};

export const respondInvite = async (profileId, orgId, accept) => {
  const org = await getOrg(orgId);
  const m = org ? await membership(profileId, orgId) : null;
  if (!m || m.status !== 'invited') return { error: 'not_found' };
  await query(`UPDATE go_org_members SET status = $3, joined_at = CASE WHEN $3 = 'active' THEN now() ELSE NULL END, updated_at = now() WHERE org_id = $1 AND profile_id = $2`,
    [orgId, profileId, accept ? 'active' : 'declined']);
  await audit(orgId, profileId, accept ? 'invite_accept' : 'invite_decline', profileId, { role: m.role });
  if (m.invited_by) await notifyGo(m.invited_by, 'org', accept ? 'Приглашение принято' : 'Приглашение отклонено', accept ? 'Сотрудник присоединился к организации.' : 'Сотрудник отказался от приглашения.', orgId, `invresp:${orgId}:${profileId}:${accept}`);
  return { ok: true };
};

/** Возвращает диспетчеру заказы, которые исполнитель ещё не забрал (ушёл из команды / приостановлен). Идёт внутри транзакции. */
const releaseUnpicked = async (c, orgId, profileId, actorId, why) => {
  const { rows } = await c.query(
    `SELECT * FROM go_orders WHERE org_id = $1 AND executor_id = $2 AND status IN ('assigned','heading_pickup','at_pickup') FOR UPDATE`, [orgId, profileId]);
  for (const o of rows) {
    await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, data = (data - 'dispatch') || '{"internal":false}'::jsonb, updated_at = now() WHERE id = $1`, [o.id]);
    await addEvent(c, o.id, actorId, o.status, 'searching', why);
  }
  return rows.map((r) => r.id);
};

export const changeMember = async (actorId, orgId, targetId, { role, status, confirm } = {}) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  if (targetId === actorId) return { error: 'self_change' };                       // себе роль и допуск менять нельзя
  const t = await membership(targetId, orgId);
  if (!t || !['active', 'suspended', 'invited'].includes(t.status)) return { error: 'not_found' };
  if (t.role === 'owner') return { error: 'owner_immutable' };
  const grant = GRANT[a.m.role];
  if (!grant.includes(t.role)) return { error: 'not_allowed' };                    // администратор не трогает администраторов
  if (role != null && !grant.includes(role)) return { error: 'role_not_allowed' }; // выше своего уровня не назначить
  if (status != null && !['active', 'suspended', 'removed'].includes(status)) return { error: 'bad_status' };
  const nextRole = role ?? t.role; const nextStatus = status ?? t.status;
  if (nextRole === t.role && nextStatus === t.status) return { ok: true };
  const dangerous = nextRole !== t.role && (nextRole === 'admin' || t.role === 'admin') || nextStatus === 'suspended' || nextStatus === 'removed';
  if (dangerous && confirm !== true) return { error: 'confirm_required' };
  const released = await inTx(async (c) => {
    await c.query(`UPDATE go_org_members SET role = $3, status = $4, updated_at = now() WHERE org_id = $1 AND profile_id = $2`, [orgId, targetId, nextRole, nextStatus]);
    if (nextStatus === 'suspended' || nextStatus === 'removed') {
      const { rows: busy } = await c.query(`SELECT 1 FROM go_orders WHERE org_id = $1 AND executor_id = $2 AND status IN ('picked_up','delivering','at_recipient') LIMIT 1`, [orgId, targetId]);
      if (busy[0]) throw Object.assign(new Error('busy'), { goError: 'executor_in_delivery' });   // доставку на руках сначала доводят до конца или решают спором
      return releaseUnpicked(c, orgId, targetId, actorId, 'Исполнитель отстранён — заказ возвращён диспетчеру');
    }
    return [];
  }).catch((e) => (e.goError ? { error: e.goError } : Promise.reject(e)));
  if (released.error) return released;
  await audit(orgId, actorId, 'member_change', targetId, { from: { role: t.role, status: t.status }, to: { role: nextRole, status: nextStatus } });
  await notifyGo(targetId, 'org', 'Изменён ваш доступ', nextStatus === 'active' ? `Ваша роль в «${a.org.name}»: ${ROLE_LABEL[nextRole]}.` : `Ваш доступ к «${a.org.name}» ${nextStatus === 'removed' ? 'закрыт' : 'приостановлен'}.`, orgId, `member:${orgId}:${targetId}:${nextRole}:${nextStatus}:${Date.now() / 6e4 | 0}`);
  for (const id of released) { await notifyStaff(orgId, 'Заказ вернулся диспетчеру', 'Исполнитель отстранён — назначьте другого.', id, `${id}:unassigned`); await pushOrderChanged(id); await autoAssignOrder(orgId, id).catch(() => {}); }
  return { ok: true, released: released.length };
};

export const leave = async (profileId, orgId) => {
  const org = await getOrg(orgId); const m = org ? await membership(profileId, orgId) : null;
  if (!m || m.status !== 'active') return { error: 'not_found' };
  if (m.role === 'owner') return { error: 'owner_immutable' };
  const res = await inTx(async (c) => {
    const { rows: busy } = await c.query(`SELECT 1 FROM go_orders WHERE org_id = $1 AND executor_id = $2 AND status IN ('picked_up','delivering','at_recipient') LIMIT 1`, [orgId, profileId]);
    if (busy[0]) return { error: 'executor_in_delivery' };
    await c.query(`UPDATE go_org_members SET status = 'removed', updated_at = now() WHERE org_id = $1 AND profile_id = $2`, [orgId, profileId]);
    return { ok: true, released: await releaseUnpicked(c, orgId, profileId, profileId, 'Исполнитель покинул организацию') };
  });
  if (res.error) return res;
  await audit(orgId, profileId, 'member_leave', profileId, {});
  await notifyStaff(orgId, 'Сотрудник покинул организацию', 'Проверьте назначения.', orgId, `leave:${orgId}:${profileId}:${Date.now() / 6e4 | 0}`);
  for (const id of res.released) await pushOrderChanged(id);
  return { ok: true };
};

export const auditLog = async (actorId, orgId, { limit } = {}) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  const { rows } = await query('SELECT id, actor_id, action, subject, detail, at FROM go_org_audit WHERE org_id = $1 ORDER BY id DESC LIMIT $2', [orgId, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
  const cards = await profileCards(rows.flatMap((r) => [r.actor_id, r.subject]));
  return { log: rows.map((r) => ({ id: String(r.id), action: r.action, actor: cards.get(r.actor_id)?.username ?? null, subject: cards.get(r.subject)?.username ?? r.subject, detail: r.detail, at: r.at.toISOString() })) };
};

/* ─── Заказы организации ───────────────────────────────────────────── */
const GROUPS = {
  new: ['searching'], active: ACTIVE_ST, awaiting: ['awaiting_payment', 'payment_reported'], done: ['paid'], cancelled: ['cancelled'], dispute: ['dispute'],
};

const orgOrderCard = (r, cards) => ({
  id: r.id, status: r.status, priceRub: r.price_rub, city: r.city, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), completedAt: r.completed_at?.toISOString?.() ?? null,
  scenario: r.data.scenario, from: r.data.from?.address, to: r.data.to?.address, km: r.data.km, minutes: r.data.minutes,
  parcel: r.data.parcel?.description, recipient: r.data.recipient?.name,
  executor: r.executor_id ? cards.get(r.executor_id) ?? null : null, internal: Boolean(r.data.internal), accepted: r.data.dispatch ? Boolean(r.data.dispatch.accepted) : null,
  poolOpen: Boolean(r.data.poolOpen), problemOpen: Boolean(r.data.problemOpen), createdBy: cards.get(r.created_by)?.username ?? null,
  needsAttention: needsAttention(r),
});

/** Заказ требует внимания: открытая проблема, спор, исполнителя нет дольше срока, или доставка тянется вдвое дольше расчётного времени. */
const needsAttention = (r) => {
  if (r.data.problemOpen || r.status === 'dispute') return r.status === 'dispute' ? 'dispute' : 'problem';
  const ageMin = (Date.now() - r.created_at.getTime()) / 60000;
  if (r.status === 'searching' && ageMin > STALE_SEARCH_MIN) return 'no_executor';
  const sinceUpd = (Date.now() - r.updated_at.getTime()) / 60000;
  if (['picked_up', 'delivering'].includes(r.status) && sinceUpd > Math.max(60, 2 * (Number(r.data.minutes) || 30))) return 'late';
  return null;
};

export const listOrders = async (actorId, orgId, { group, q, sort, executor, limit, offset } = {}) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const args = [orgId]; const where = ['org_id = $1'];
  if (group && GROUPS[group]) { args.push(GROUPS[group]); where.push(`status = ANY($${args.length}::text[])`); }
  if (group === 'problem') where.push(`(data->>'problemOpen' = 'true')`);
  if (executor) { args.push(String(executor)); where.push(`executor_id = $${args.length}`); }
  const term = clean(q, 60);
  if (term) {
    args.push(`%${term.replace(/[%_\\]/g, '')}%`);
    where.push(`(id ILIKE $${args.length} OR data->'parcel'->>'description' ILIKE $${args.length} OR data->'from'->>'address' ILIKE $${args.length} OR data->'to'->>'address' ILIKE $${args.length} OR data->'recipient'->>'name' ILIKE $${args.length})`);
  }
  const order = { price: 'price_rub DESC', old: 'created_at ASC', upd: 'updated_at DESC' }[sort] ?? 'created_at DESC';
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 100); const off = Math.max(Number(offset) || 0, 0);
  const { rows } = await query(`SELECT * FROM go_orders WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, args);
  const { rows: tot } = await query(`SELECT count(*)::int AS n FROM go_orders WHERE ${where.join(' AND ')}`, args);
  const cards = await profileCards(rows.flatMap((r) => [r.executor_id, r.created_by]));
  return { orders: rows.map((r) => orgOrderCard(r, cards)), total: tot[0].n };
};

/** Карточка заказа для сотрудников: всё, что видит заказчик, плюс назначение, заметки, проблемы и допустимые действия. */
export const getOrder = async (actorId, orgId, orderId) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const { rows } = await query('SELECT * FROM go_orders WHERE id = $1 AND org_id = $2', [String(orderId ?? ''), orgId]);
  const row = rows[0]; if (!row) return { error: 'not_found' };
  const view = await orderView(row, row.customer_id, { events: true });
  const cards = await profileCards([row.created_by, row.executor_id]);
  const { rows: notes } = await query('SELECT n.id, n.author_id, n.to_executor, n.body, n.at FROM go_order_notes n WHERE order_id = $1 ORDER BY id', [row.id]);
  const nc = await profileCards(notes.map((n) => n.author_id));
  const { rows: probs } = await query(`SELECT id, reporter_id, kind, note, (photo IS NOT NULL) AS has_photo, state, resolution, created_at, resolved_at FROM go_order_problems WHERE order_id = $1 ORDER BY created_at`, [row.id]);
  let location = null;
  if (row.executor_id && ACTIVE_ST.includes(row.status)) {
    const { rows: pr } = await query(`SELECT lat, lng, updated_at FROM go_presence WHERE profile_id = $1 AND role = 'courier' AND online AND lat IS NOT NULL`, [row.executor_id]);
    if (pr[0]) location = { lat: pr[0].lat, lng: pr[0].lng, updatedAt: pr[0].updated_at.toISOString() };   // только пока заказ в работе и исполнитель на линии
  }
  const can = {
    assign: ['searching', 'assigned', 'heading_pickup', 'at_pickup'].includes(row.status) && !a.org.suspended,
    cancel: ['searching', 'assigned', 'heading_pickup', 'at_pickup'].includes(row.status),
    openPool: row.status === 'searching' && !row.data.poolOpen,
    note: OPEN_ST.includes(row.status),
    resolveProblem: Boolean(row.data.problemOpen),
  };
  return {
    order: { ...view, orgId, internal: Boolean(row.data.internal), poolOpen: Boolean(row.data.poolOpen), accepted: row.data.dispatch ? Boolean(row.data.dispatch.accepted) : null,
      createdBy: cards.get(row.created_by)?.username ?? null, executorLocation: location, attention: needsAttention(row) },
    notes: notes.map((n) => ({ id: String(n.id), author: nc.get(n.author_id)?.username ?? '', toExecutor: n.to_executor, body: n.body, at: n.at.toISOString() })),
    problems: probs.map((p) => ({ id: p.id, kind: p.kind, note: p.note, hasPhoto: p.has_photo, state: p.state, resolution: p.resolution || undefined, at: p.created_at.toISOString(), resolvedAt: p.resolved_at?.toISOString?.() ?? null })),
    can, myRole: a.m.role,
  };
};

/** Создать заказ от имени организации: владелец, администратор, менеджер. Цену, адреса и коды считает та же система доставки. */
export const createOrder = async (actorId, orgId, input) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  if (a.org.suspended) return { error: 'org_suspended' };
  const mode = ['manual', 'auto', 'pool'].includes(input?.assignMode) ? input.assignMode : a.org.assign_mode;
  let from = input?.from;
  if (input?.pointId) {
    const { rows } = await query('SELECT address, lat, lng FROM go_org_points WHERE id = $1 AND org_id = $2', [String(input.pointId), orgId]);
    if (!rows[0]) return { error: 'point_not_found' };
    from = { address: rows[0].address, lat: rows[0].lat, lng: rows[0].lng };
  }
  const r = await delivery.create(a.org.owner_id, { ...input, from, scenario: 'company', company: a.org.name, city: input?.city || a.org.city },
    { orgId, orgName: a.org.name, createdBy: actorId, poolOpen: mode === 'pool' });
  if (r.error || r.duplicate) return r;
  await audit(orgId, actorId, 'order_create', r.orderId, { mode });
  await notifyStaff(orgId, 'Новый заказ', `${clean(input?.parcel?.description, 60) || 'Доставка'} — ${r.priceRub} ₽`, r.orderId, `${r.orderId}:new`, actorId);
  let assigned = null;
  if (input?.assignTo) { assigned = await assignOrder(actorId, orgId, r.orderId, String(input.assignTo)); if (assigned.error) return { ...r, assignError: assigned.error }; }
  else if (mode === 'auto') await autoAssignOrder(orgId, r.orderId).catch(() => {});
  await pushOrderChanged(r.orderId);
  return { ...r, assigned: Boolean(assigned?.ok) };
};

/* ─── Назначение ───────────────────────────────────────────────────── */

/** Может ли этот человек взять заказ сейчас: активный участник, одобренный курьер с подпиской, на линии, нагрузка и совместимость. */
const eligible = async (c, orgId, profileId, orderRow, { needOnline = true } = {}) => {
  const m = (await c.query(`SELECT status FROM go_org_members WHERE org_id = $1 AND profile_id = $2`, [orgId, profileId])).rows[0];
  if (!m || m.status !== 'active') return { error: 'executor_not_member' };
  const w = await canWork(profileId, 'courier'); if (w.error) return { error: w.error === 'not_registered' || w.error === 'not_approved' ? 'executor_not_approved' : w.error };
  if (needOnline) {
    const { rows: pr } = await c.query(`SELECT online FROM go_presence WHERE profile_id = $1 AND role = 'courier'`, [profileId]);
    if (!pr[0]?.online) return { error: 'executor_offline' };
  }
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:exec:${profileId}`]);
  const { rows: mine } = await c.query(`SELECT data->>'scenario' AS sc FROM go_orders WHERE kind = 'delivery' AND executor_id = $1 AND id <> $2 AND status = ANY($3::text[])`, [profileId, orderRow.id, ACTIVE_ST]);
  if (mine.length >= MAX_ACTIVE) return { error: 'courier_busy' };
  if ((orderRow.data.scenario === 'cargo' && mine.length > 0) || mine.some((x) => x.sc === 'cargo')) return { error: 'incompatible_order' };
  if (orderRow.data.scenario === 'cargo') {
    const ex = await executorStatus(profileId, 'courier');
    if (openJson(ex?.data_enc).extra?.transport !== 'truck') return { error: 'executor_not_truck' };
  }
  return { ok: true };
};

/** Назначить (или переназначить) исполнителя из команды. Только до получения отправления. */
export const assignOrder = async (actorId, orgId, orderId, executorId) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  if (a.org.suspended) return { error: 'org_suspended' };
  const res = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || o.org_id !== orgId || o.kind !== 'delivery') return { error: 'not_found' };
    if (!['searching', 'assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
    if (o.executor_id === executorId) return { ok: true, duplicate: true };
    const ok = await eligible(c, orgId, executorId, o); if (ok.error) return ok;
    const { rows: pay } = await c.query('SELECT state FROM go_order_pay WHERE order_id = $1', [o.id]);
    if (pay[0]?.state && pay[0].state !== 'awaiting') return { error: 'payment_in_progress' };   // оплата уже идёт — исполнителя не меняем
    await c.query(`DELETE FROM go_order_pay WHERE order_id = $1`, [o.id]);
    const dispatch = { by: actorId, at: new Date().toISOString(), accepted: false };
    await c.query(`UPDATE go_orders SET status = 'assigned', executor_id = $2, updated_at = now(),
      data = (data - 'declinedBy') || jsonb_build_object('internal', true, 'payTerm', 'none', 'dispatch', $3::jsonb) WHERE id = $1`, [o.id, executorId, JSON.stringify(dispatch)]);
    await addEvent(c, o.id, actorId, o.status, 'assigned', o.executor_id ? 'Исполнитель переназначен диспетчером' : 'Исполнитель назначен диспетчером');
    return { ok: true, previous: o.executor_id, status: o.status };
  });
  if (res.error || res.duplicate) return res;
  await audit(orgId, actorId, res.previous ? 'order_reassign' : 'order_assign', orderId, { executor: executorId, previous: res.previous ?? null });
  const stamp = `${orderId}:${executorId}:${Date.now() / 1000 | 0}`;
  await notifyGo(executorId, 'delivery', 'Новое назначение', 'Вам назначен заказ. Откройте Sky GO → Работа и подтвердите.', orderId, `assign:${stamp}`);
  if (res.previous) await notifyGo(res.previous, 'delivery', 'Назначение снято', 'Диспетчер передал заказ другому исполнителю. Маршрут обновлён.', orderId, `unassign:${stamp}`);
  await notifyStaff(orgId, 'Исполнитель назначен', 'Заказ ожидает принятия исполнителем.', orderId, `${orderId}:dispatch:${executorId}`, actorId);
  await pushOrderChanged(orderId);
  return { ok: true };
};

/** Снять исполнителя (до получения отправления): заказ возвращается в очередь организации. */
export const unassignOrder = async (actorId, orgId, orderId, reason) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const why = clean(reason, 200); if (why.length < 3) return { error: 'reason_required' };
  const res = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || o.org_id !== orgId) return { error: 'not_found' };
    if (!['assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
    await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, data = (data - 'dispatch') || '{"internal":false}'::jsonb, updated_at = now() WHERE id = $1`, [o.id]);
    await c.query(`DELETE FROM go_order_pay WHERE order_id = $1 AND state = 'awaiting'`, [o.id]);
    await addEvent(c, o.id, actorId, o.status, 'searching', `Исполнитель снят: ${why}`);
    return { ok: true, previous: o.executor_id };
  });
  if (res.error) return res;
  await audit(orgId, actorId, 'order_unassign', orderId, { previous: res.previous, reason: why });
  if (res.previous) await notifyGo(res.previous, 'delivery', 'Назначение снято', `Диспетчер снял назначение: ${why}`, orderId, `unassign:${orderId}:${res.previous}:${Date.now() / 1000 | 0}`);
  await pushOrderChanged(orderId);
  await autoAssignOrder(orgId, orderId).catch(() => {});
  return { ok: true };
};

/** Открыть заказ организации для всех курьеров Sky GO (обычный поток с прямой оплатой). */
export const openToPool = async (actorId, orgId, orderId) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  const term = await delivery.payTerm('delivery');
  const { rowCount } = await query(
    `UPDATE go_orders SET data = data || jsonb_build_object('poolOpen', true, 'payTerm', $3::text, 'internal', false), updated_at = now()
      WHERE id = $1 AND org_id = $2 AND status = 'searching' AND executor_id IS NULL`, [orderId, orgId, term]);
  if (!rowCount) return { error: 'bad_state' };
  await audit(orgId, actorId, 'order_open_pool', orderId);
  await pushOrderChanged(orderId);
  await offerNext(orderId).catch(() => {});   // открыт курьерам — дальше обычное распределение (если включено)
  return { ok: true };
};

/* Автоназначение: по наименьшей загрузке, затем по близости к месту забора. Только среди команды организации. */
export const autoAssignOrder = async (orgId, orderId) => {
  const org = await getOrg(orgId); if (!org || org.suspended || org.assign_mode !== 'auto') return { skipped: true };
  const { rows: ord } = await query(`SELECT * FROM go_orders WHERE id = $1 AND org_id = $2 AND status = 'searching' AND executor_id IS NULL AND NOT coalesce((data->>'poolOpen')::boolean, false)`, [orderId, orgId]);
  const o = ord[0]; if (!o) return { skipped: true };
  const declined = new Set(o.data.declinedBy ?? []);
  const { rows: cands } = await query(
    `SELECT m.profile_id, p.lat, p.lng,
            (SELECT count(*)::int FROM go_orders x WHERE x.executor_id = m.profile_id AND x.status = ANY($2::text[])) AS load
       FROM go_org_members m JOIN go_presence p ON p.profile_id = m.profile_id AND p.role = 'courier' AND p.online
      WHERE m.org_id = $1 AND m.status = 'active'`, [orgId, ACTIVE_ST]);
  const ranked = cands.filter((c) => !declined.has(c.profile_id)).map((c) => ({ ...c, d: c.lat != null && o.data.from?.lat != null ? haversineKm({ lat: c.lat, lng: c.lng }, o.data.from) : 1e6 }))
    .sort((x, y) => x.load - y.load || x.d - y.d);
  for (const c of ranked) {
    const r = await assignOrder(org.owner_id, orgId, orderId, c.profile_id);
    if (r.ok) { await audit(orgId, null, 'order_auto_assign', orderId, { executor: c.profile_id }); return { ok: true, executorId: c.profile_id }; }
  }
  return { none: true };
};
export const autoAssignPending = async (orgId) => {
  const { rows } = await query(`SELECT id FROM go_orders WHERE org_id = $1 AND status = 'searching' AND executor_id IS NULL AND NOT coalesce((data->>'poolOpen')::boolean, false) ORDER BY created_at LIMIT 20`, [orgId]);
  for (const r of rows) await autoAssignOrder(orgId, r.id).catch(() => {});
};
/** Исполнитель вышел на линию — ему могут достаться ожидающие заказы организаций, где включено автоназначение. */
export const autoAssignForMember = async (profileId) => {
  const { rows } = await query(`SELECT m.org_id FROM go_org_members m JOIN go_orgs o ON o.id = m.org_id WHERE m.profile_id = $1 AND m.status = 'active' AND o.assign_mode = 'auto'`, [profileId]);
  for (const r of rows) await autoAssignPending(r.org_id);
};
/** Исполнитель отказался: сообщаем диспетчеру и, если включено автоназначение, ищем другого. */
export const afterRelease = async (orderId) => {
  const { rows } = await query('SELECT org_id FROM go_orders WHERE id = $1', [orderId]);
  if (rows[0]?.org_id) await autoAssignOrder(rows[0].org_id, orderId);
};

/* ─── Действия заказчика от имени организации ──────────────────────── */
/** Кого считать заказчиком, когда действует сотрудник организации (владелец, администратор, менеджер); иначе — самого человека. */
export const effectiveCustomer = async (profileId, orderId) => {
  const { rows } = await query(`SELECT o.customer_id, o.org_id FROM go_orders o WHERE o.id = $1`, [String(orderId ?? '')]);
  const r = rows[0];
  if (!r?.org_id) return profileId;
  const m = await membership(profileId, r.org_id);
  return m && m.status === 'active' && STAFF.includes(m.role) ? r.customer_id : profileId;
};

export const cancelOrder = async (actorId, orgId, orderId, reason) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const why = clean(reason, 200); if (why.length < 3) return { error: 'reason_required' };
  const { rows } = await query('SELECT id FROM go_orders WHERE id = $1 AND org_id = $2', [String(orderId ?? ''), orgId]);
  if (!rows[0]) return { error: 'not_found' };
  const r = await delivery.customerCancel(a.org.owner_id, orderId, why);
  if (r.error) return r;
  await audit(orgId, actorId, 'order_cancel', orderId, { reason: why });
  await notifyStaff(orgId, 'Заказ отменён', why, orderId, `${orderId}:cancel`, actorId);
  return r;
};

export const addNote = async (actorId, orgId, orderId, { body, toExecutor }) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const text = clean(body, 500); if (text.length < 2) return { error: 'note_required' };
  const { rows } = await query('SELECT executor_id, status FROM go_orders WHERE id = $1 AND org_id = $2', [String(orderId ?? ''), orgId]);
  if (!rows[0]) return { error: 'not_found' };
  const to = Boolean(toExecutor) && Boolean(rows[0].executor_id);
  await query('INSERT INTO go_order_notes (order_id, author_id, to_executor, body) VALUES ($1,$2,$3,$4)', [orderId, actorId, to, text]);
  if (to) await notifyGo(rows[0].executor_id, 'delivery', 'Сообщение диспетчера', text, orderId, `note:${orderId}:${Date.now()}`);
  await pushOrderChanged(orderId);
  return { ok: true };
};

/** Диспетчер решает проблему доставки. Исполнитель этого сделать не может. */
export const resolveProblem = async (actorId, orgId, problemId, { action, note }) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const text = clean(note, 300); if (text.length < 3) return { error: 'note_required' };
  const { rows: pr } = await query(`SELECT p.*, o.org_id FROM go_order_problems p JOIN go_orders o ON o.id = p.order_id WHERE p.id = $1`, [String(problemId ?? '')]);
  const p = pr[0]; if (!p || p.org_id !== orgId) return { error: 'not_found' };
  if (p.state !== 'open') return { error: 'bad_state' };
  if (!['resume', 'reassign', 'cancel', 'escalate'].includes(action)) return { error: 'bad_action' };
  const res = await resolveProblemCore({ problemId: p.id, orderId: p.order_id, actorId, action, text, org: a.org });
  if (res.error) return res;
  await audit(orgId, actorId, 'problem_resolve', p.order_id, { action, note: text });
  return res;
};

/** Общая часть решения (организация и администрация Sky): закрыть проблему и выполнить выбранное действие. */
export const resolveProblemCore = async ({ problemId, orderId, actorId, action, text, org = null }) => {
  const res = await inTx(async (c) => {
    const o = await lockOrder(c, orderId); if (!o) return { error: 'not_found' };
    const { rows: pr } = await c.query('SELECT state FROM go_order_problems WHERE id = $1 FOR UPDATE', [problemId]);
    if (pr[0]?.state !== 'open') return { error: 'bad_state' };
    if (action === 'reassign') {
      if (!['assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
      await c.query(`UPDATE go_orders SET status = 'searching', executor_id = NULL, data = (data - 'dispatch' - 'problemOpen') || '{"internal":false}'::jsonb, updated_at = now() WHERE id = $1`, [o.id]);
      await c.query(`DELETE FROM go_order_pay WHERE order_id = $1 AND state = 'awaiting'`, [o.id]);
      await addEvent(c, o.id, actorId, o.status, 'searching', `Проблема решена: исполнитель заменяется. ${text}`);
    } else if (action === 'cancel') {
      if (!['searching', 'assigned', 'heading_pickup', 'at_pickup'].includes(o.status)) return { error: 'bad_state', status: o.status };
      const { rows: pay } = await c.query(`SELECT state FROM go_order_pay WHERE order_id = $1`, [o.id]);
      if (pay[0]?.state === 'confirmed') return { error: 'payment_in_progress' };
      await c.query(`UPDATE go_orders SET status = 'cancelled', data = data - 'problemOpen', cancel_reason = $2, cancelled_by = $3, updated_at = now() WHERE id = $1`, [o.id, text, actorId]);
      await addEvent(c, o.id, actorId, o.status, 'cancelled', `Отменён по проблеме: ${text}`);
    } else if (action === 'escalate') {
      if (['paid', 'cancelled', 'dispute'].includes(o.status)) return { error: 'bad_state', status: o.status };
      await c.query(`UPDATE go_orders SET status = 'dispute', data = (data - 'problemOpen') || jsonb_build_object('disputeFrom', $2::text, 'disputeBy', $3::text), updated_at = now() WHERE id = $1`, [o.id, o.status, actorId]);
      await addEvent(c, o.id, actorId, o.status, 'dispute', `Передано администрации Sky: ${text}`);
    } else {
      await c.query(`UPDATE go_orders SET data = data - 'problemOpen', updated_at = now() WHERE id = $1`, [o.id]);
      await addEvent(c, o.id, actorId, o.status, o.status, `Проблема решена, доставка продолжается. ${text}`);
    }
    await c.query(`UPDATE go_order_problems SET state = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`, [problemId, `${action}: ${text}`, actorId]);
    return { ok: true, executorId: o.executor_id, customerId: o.customer_id, orgId: o.org_id };
  });
  if (res.error) return res;
  if (res.executorId) await notifyGo(res.executorId, 'delivery', 'Проблема по заказу решена', text, orderId, `problem-res:${problemId}:${res.executorId}`);
  if (res.orgId) await notifyStaff(res.orgId, 'Проблема по заказу решена', text, orderId, `problem-res:${problemId}`, actorId);
  else await notifyGo(res.customerId, 'delivery', 'Проблема по заказу решена', text, orderId, `problem-res:${problemId}:c`);
  await pushOrderChanged(orderId);
  if (action === 'reassign' && res.orgId) await autoAssignOrder(res.orgId, orderId).catch(() => {});
  return { ok: true };
};

/* ─── Панель ───────────────────────────────────────────────────────── */
export const dashboard = async (actorId, orgId) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const { rows: c } = await query(
    `SELECT count(*) FILTER (WHERE status = 'searching')::int AS searching,
            count(*) FILTER (WHERE status = 'assigned' AND coalesce((data->'dispatch'->>'accepted')::boolean, true))::int AS assigned_ok,
            count(*) FILTER (WHERE status = 'assigned' AND NOT coalesce((data->'dispatch'->>'accepted')::boolean, true))::int AS assigned_wait,
            count(*) FILTER (WHERE status IN ('heading_pickup','at_pickup'))::int AS to_pickup,
            count(*) FILTER (WHERE status IN ('picked_up','delivering','at_recipient'))::int AS delivering,
            count(*) FILTER (WHERE status IN ('awaiting_payment','payment_reported'))::int AS awaiting_pay,
            count(*) FILTER (WHERE status = 'dispute')::int AS dispute,
            count(*) FILTER (WHERE data->>'problemOpen' = 'true' AND status <> 'dispute')::int AS problems,
            count(*) FILTER (WHERE status = 'paid' AND completed_at >= date_trunc('day', now()))::int AS done_today,
            count(*) FILTER (WHERE status = 'cancelled' AND updated_at >= date_trunc('day', now()))::int AS cancelled_today,
            count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS created_today,
            count(*) FILTER (WHERE status = 'paid' AND completed_at >= now() - interval '30 days')::int AS done_30,
            count(*) FILTER (WHERE status = 'cancelled' AND updated_at >= now() - interval '30 days')::int AS cancelled_30
       FROM go_orders WHERE org_id = $1`, [orgId]);
  const { rows: avg } = await query(
    `SELECT round(avg(extract(epoch FROM (o.completed_at - e.at)) / 60))::int AS minutes, count(*)::int AS n
       FROM go_orders o JOIN LATERAL (SELECT at FROM go_order_events WHERE order_id = o.id AND to_status = 'assigned' ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE o.org_id = $1 AND o.status = 'paid' AND o.completed_at >= now() - interval '30 days' AND o.completed_at > e.at`, [orgId]);
  const { rows: team } = await query(
    `SELECT count(*) FILTER (WHERE p.online)::int AS online, count(*)::int AS total
       FROM go_org_members m LEFT JOIN go_presence p ON p.profile_id = m.profile_id AND p.role = 'courier'
      WHERE m.org_id = $1 AND m.status = 'active' AND m.role IN ('driver','courier')`, [orgId]);
  const { rows: attn } = await query(`SELECT * FROM go_orders WHERE org_id = $1 AND status = ANY($2::text[]) ORDER BY updated_at LIMIT 200`, [orgId, OPEN_ST]);
  const cards = await profileCards(attn.map((r) => r.executor_id));
  const attention = attn.filter((r) => needsAttention(r)).slice(0, 10).map((r) => ({ ...orgOrderCard(r, cards) }));
  // Доставки на карте: только заказы в работе, у исполнителей на линии с известным положением; видны сотрудникам организации.
  const { rows: live } = await query(
    `SELECT o.id, o.status, o.executor_id, o.data->'to'->>'address' AS to_addr, p.lat, p.lng, p.updated_at
       FROM go_orders o JOIN go_presence p ON p.profile_id = o.executor_id AND p.role = 'courier' AND p.online AND p.lat IS NOT NULL
      WHERE o.org_id = $1 AND o.status = ANY($2::text[]) LIMIT 50`, [orgId, ACTIVE_ST]);
  const lc = await profileCards(live.map((r) => r.executor_id));
  const { rows: sup } = await query(`SELECT count(*)::int AS n FROM go_order_problems p JOIN go_orders o ON o.id = p.order_id WHERE o.org_id = $1 AND p.state = 'open'`, [orgId]);
  return {
    counts: { ...c[0], openProblems: sup[0].n },
    avgDeliveryMinutes: avg[0].n > 0 ? avg[0].minutes : null, avgSample: avg[0].n,
    team: team[0], attention,
    map: live.map((r) => ({ orderId: r.id, status: r.status, executor: lc.get(r.executor_id)?.name ?? '', lat: r.lat, lng: r.lng, updatedAt: r.updated_at.toISOString(), to: r.to_addr })),
    org: { name: a.org.name, role: a.m.role, suspended: a.org.suspended, assignMode: a.org.assign_mode },
  };
};

/** Уборка: заказы организаций, ждущие автоназначения, получают исполнителя, когда кто-то освободился или вышел на линию. */
export const sweepOrgs = async () => {
  const { rows } = await query(`SELECT id FROM go_orgs WHERE assign_mode = 'auto' AND NOT suspended`);
  for (const r of rows) await autoAssignPending(r.id).catch(() => {});
  // Задержки: «ждёт исполнителя дольше срока» один раз напоминаем сотрудникам.
  const { rows: stale } = await query(`SELECT id, org_id FROM go_orders WHERE org_id IS NOT NULL AND status = 'searching' AND created_at < now() - ($1 || ' minutes')::interval AND created_at > now() - interval '2 days'`, [String(STALE_SEARCH_MIN)]);
  for (const o of stale) await notifyStaff(o.org_id, 'Заказ ждёт исполнителя', `Исполнитель не назначен дольше ${STALE_SEARCH_MIN} минут.`, o.id, `${o.id}:stale`);
};

export const adminOrgs = async () => {
  const { rows } = await query(
    `SELECT o.id, o.name, o.suspended, o.created_at, (SELECT username FROM profiles WHERE id = o.owner_id) AS owner,
            (SELECT count(*)::int FROM go_org_members m WHERE m.org_id = o.id AND m.status = 'active') AS members,
            (SELECT count(*)::int FROM go_orders x WHERE x.org_id = o.id) AS orders
       FROM go_orgs o ORDER BY o.created_at DESC LIMIT 200`);
  return { orgs: rows.map((r) => ({ id: r.id, name: r.name, owner: r.owner, suspended: r.suspended, members: r.members, orders: r.orders, createdAt: r.created_at.toISOString() })) };
};
export const adminSuspendOrg = async (adminId, orgId, suspended, reason) => {
  const why = clean(reason, 200); if (why.length < 3) return { error: 'reason_required' };
  const { rowCount } = await query('UPDATE go_orgs SET suspended = $2, updated_at = now() WHERE id = $1', [orgId, Boolean(suspended)]);
  if (!rowCount) return { error: 'not_found' };
  await audit(orgId, adminId, suspended ? 'admin_suspend' : 'admin_restore', null, { reason: why });
  await goLog(adminId, suspended ? 'org_suspend' : 'org_restore', orgId, { reason: why });
  return { ok: true };
};
