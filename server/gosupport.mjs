/**
 * Sky GO Support — обращения по заказам и настройки уведомлений.
 * Это НЕ отдельная система поддержки: обращение — обычный тикет Sky (`support_tickets`, ответы сотрудников — в общей очереди «Поддержка»),
 * а `go_support_links` лишь привязывает его к заказу и категории Sky GO, чтобы сотрудник видел контекст и мог отфильтровать (безопасность — сверху).
 * Сообщить о заказе может только его сторона (заказчик, исполнитель, сотрудник организации); чужой заказ — not_found.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { createTicket, readTicket } from './support.mjs';
import { clean, goLog } from './gocore.mjs';

export const CATEGORIES = {
  ride: 'Проблема с поездкой', delivery: 'Проблема с доставкой', payment: 'Вопрос оплаты', cancel: 'Отмена заказа',
  executor: 'Проблема с исполнителем', customer: 'Проблема с заказчиком', tech: 'Техническая ошибка', safety: 'Безопасность', other: 'Другое',
};
const KIND = { tech: 'bug', safety: 'report', executor: 'report', customer: 'report' };

/** Сторона заказа: заказчик, исполнитель или активный сотрудник организации-заказчика. */
const isParty = async (profileId, orderId) => {
  const { rows } = await query(
    `SELECT 1 FROM go_orders o WHERE o.id = $2 AND (o.customer_id = $1 OR o.executor_id = $1
        OR (o.org_id IS NOT NULL AND EXISTS (SELECT 1 FROM go_org_members m WHERE m.org_id = o.org_id AND m.profile_id = $1 AND m.status = 'active')))`, [profileId, orderId]);
  return Boolean(rows[0]);
};

export const report = async (profileId, { category, orderId, text } = {}) => {
  if (!CATEGORIES[category]) return { error: 'bad_category' };
  const body = clean(text, 2000);
  if (body.length < 5) return { error: 'text_required' };
  const oid = orderId ? String(orderId) : null;
  if (oid && !(await isParty(profileId, oid))) return { error: 'not_found' };
  const subject = `Sky GO · ${CATEGORIES[category]}${oid ? ` · ${oid}` : ''}`;
  const r = await createTicket(profileId, { subject, body: `${oid ? `Заказ: ${oid}\n` : ''}${body}`, kind: KIND[category] ?? 'question' });
  if (r.error) return r;
  await query('INSERT INTO go_support_links (ticket_id, profile_id, order_id, category) VALUES ($1,$2,$3,$4)', [r.ticket.id, profileId, oid, category]);
  await goLog(profileId, 'support_report', oid, { category, ticket: r.ticket.id });
  return { ok: true, ticketId: r.ticket.id };
};

export const mine = async (profileId) => {
  const { rows } = await query(
    `SELECT l.ticket_id, l.order_id, l.category, l.created_at, t.status FROM go_support_links l JOIN support_tickets t ON t.id = l.ticket_id
      WHERE l.profile_id = $1 ORDER BY l.created_at DESC LIMIT 50`, [profileId]);
  return { categories: CATEGORIES, tickets: rows.map((r) => ({ ticketId: r.ticket_id, orderId: r.order_id, category: r.category, label: CATEGORIES[r.category], status: r.status, createdAt: r.created_at.toISOString() })) };
};

export const ticket = async (profileId, ticketId) => {
  const { rows } = await query('SELECT 1 FROM go_support_links WHERE ticket_id = $1 AND profile_id = $2', [String(ticketId ?? ''), profileId]);
  if (!rows[0]) return { error: 'not_found' };
  return { ticket: await readTicket(String(ticketId), profileId) };
};

/** Для сотрудников (право go): обращения Sky GO с контекстом заказа. Содержимое читается в общей очереди поддержки. */
export const adminList = async (adminId, { category, status } = {}) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const args = []; const where = [];
  if (category && CATEGORIES[category]) { args.push(category); where.push(`l.category = $${args.length}`); }
  if (status && ['open', 'in_progress', 'waiting', 'closed'].includes(status)) { args.push(status); where.push(`t.status = $${args.length}`); }
  const { rows } = await query(
    `SELECT l.ticket_id, l.order_id, l.category, l.created_at, t.status, o.kind, o.status AS order_status
       FROM go_support_links l JOIN support_tickets t ON t.id = l.ticket_id LEFT JOIN go_orders o ON o.id = l.order_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (l.category = 'safety' AND t.status <> 'closed') DESC, l.created_at DESC LIMIT 100`, args);
  return { tickets: rows.map((r) => ({ ticketId: r.ticket_id, orderId: r.order_id, orderKind: r.kind, orderStatus: r.order_status, category: r.category, label: CATEGORIES[r.category], status: r.status, createdAt: r.created_at.toISOString() })) };
};

/* ─── Настройки уведомлений ───────────────────────────────────────── */
export const GROUPS = { orders: 'Статусы заказов', offers: 'Новые предложения заказов (для исполнителей)', payments: 'Оплата и подписка', support: 'Ответы поддержки' };
/** Какая группа у уведомления. Споры и безопасность отключить нельзя — это всегда 'critical'. */
export const groupOf = (kind, dedupe) => {
  if (kind === 'dispute') return 'critical';
  if (String(dedupe ?? '').includes(':offer:') || String(dedupe ?? '').includes(':manual:')) return 'offers';
  if (kind === 'payment' || kind === 'subscription') return 'payments';
  if (kind === 'support') return 'support';
  return 'orders';
};

export const getPrefs = async (profileId) => {
  const { rows } = await query('SELECT prefs FROM go_notify_prefs WHERE profile_id = $1', [profileId]);
  const p = rows[0]?.prefs ?? {};
  return { groups: GROUPS, push: Object.fromEntries(Object.keys(GROUPS).map((g) => [g, p[g] !== false])), note: 'Записи в разделе «Уведомления» остаются всегда; здесь отключаются только пуши. Споры и вопросы безопасности отключить нельзя.' };
};
export const setPrefs = async (profileId, input) => {
  const cur = (await getPrefs(profileId)).push;
  const next = { ...cur };
  for (const g of Object.keys(GROUPS)) if (typeof input?.push?.[g] === 'boolean') next[g] = input.push[g];
  await query(`INSERT INTO go_notify_prefs (profile_id, prefs) VALUES ($1,$2::jsonb) ON CONFLICT (profile_id) DO UPDATE SET prefs = $2::jsonb, updated_at = now()`, [profileId, JSON.stringify(next)]);
  return getPrefs(profileId);
};
export const pushAllowed = async (profileId, kind, dedupe) => {
  const g = groupOf(kind, dedupe);
  if (g === 'critical') return true;
  try { const { rows } = await query('SELECT prefs->>$2 AS v FROM go_notify_prefs WHERE profile_id = $1', [profileId, g]); return rows[0]?.v !== 'false'; } catch { return true; }
};
