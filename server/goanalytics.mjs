/**
 * Sky GO Analytics — сводка по платформе для сотрудников (право `analytics` или `go`). Только агрегаты по настоящим таблицам, без персональных данных.
 * Деньги: Sky не принимает оплату за поездки и доставки, поэтому «выручка» здесь — СТОИМОСТЬ заказов, оплата по которым подтверждена исполнителем напрямую
 * (статус paid, без заказов своих сотрудников организаций); это не доход Sky. Доход Sky — только подписки исполнителей (списания с кошелька go_sub).
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';

export const analytics = async (adminId, { days } = {}) => {
  if (!(await can(adminId, 'go')) && !(await can(adminId, 'analytics'))) return { error: 'not_allowed' };
  const d = String(Math.min(180, Math.max(1, Math.round(Number(days) || 14))));
  const win = `o.created_at >= date_trunc('day', now()) - ($1 || ' days')::interval + interval '1 day'`;
  const { rows: byDay } = await query(
    `SELECT to_char(date_trunc('day', o.created_at), 'YYYY-MM-DD') AS day, o.kind,
            count(*)::int AS created,
            count(*) FILTER (WHERE o.status = 'paid')::int AS paid,
            count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE o.status = 'cancelled' AND o.cancel_reason = 'no_drivers')::int AS no_drivers,
            coalesce(sum(o.price_rub) FILTER (WHERE o.status = 'paid' AND NOT coalesce((o.data->>'internal')::boolean, false)), 0)::int AS paid_rub
       FROM go_orders o WHERE o.kind IN ('taxi','delivery') AND ${win} GROUP BY 1, 2 ORDER BY 1, 2`, [d]);
  const { rows: tot } = await query(
    `SELECT o.kind, count(*)::int AS created, count(*) FILTER (WHERE o.status = 'paid')::int AS paid, count(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE o.status = 'dispute')::int AS disputes,
            coalesce(sum(o.price_rub) FILTER (WHERE o.status = 'paid' AND NOT coalesce((o.data->>'internal')::boolean, false)), 0)::int AS paid_rub,
            round(avg(extract(epoch FROM (a.at - o.created_at))) FILTER (WHERE a.at IS NOT NULL))::int AS secs_to_assign,
            round(avg(extract(epoch FROM (o.completed_at - a.at))) FILTER (WHERE o.completed_at IS NOT NULL AND a.at IS NOT NULL AND o.completed_at > a.at))::int AS secs_to_complete
       FROM go_orders o LEFT JOIN LATERAL (SELECT at FROM go_order_events WHERE order_id = o.id AND to_status = 'assigned' ORDER BY id LIMIT 1) a ON TRUE
      WHERE o.kind IN ('taxi','delivery') AND ${win} GROUP BY o.kind`, [d]);
  const { rows: cities } = await query(
    `SELECT o.city, count(*)::int AS created, count(*) FILTER (WHERE o.status = 'paid')::int AS paid FROM go_orders o WHERE o.kind IN ('taxi','delivery') AND ${win} GROUP BY o.city ORDER BY created DESC LIMIT 20`, [d]);
  const { rows: ex } = await query(`SELECT role, status, count(*)::int AS n FROM go_executors GROUP BY role, status`);
  const { rows: subs } = await query(`SELECT role, count(DISTINCT profile_id)::int AS active FROM go_subscriptions WHERE expires_at > now() GROUP BY role`);
  const { rows: income } = await query(
    `SELECT coalesce(sum(price_rub), 0)::int AS rub, count(*)::int AS n FROM go_subscriptions WHERE price_rub > 0 AND created_at >= now() - ($1 || ' days')::interval`, [d]);
  const { rows: online } = await query(`SELECT role, count(*)::int AS n FROM go_presence WHERE online AND updated_at > now() - interval '10 minutes' GROUP BY role`);
  const kinds = {};
  for (const r of tot) kinds[r.kind] = { created: r.created, paid: r.paid, cancelled: r.cancelled, disputes: r.disputes, cancelRate: r.created ? Math.round((r.cancelled / r.created) * 100) : null,
    paidRub: r.paid_rub, avgSecondsToAssign: r.secs_to_assign, avgSecondsToComplete: r.secs_to_complete };
  return { days: Number(d), currency: 'RUB', kinds, byDay: byDay.map((r) => ({ day: r.day, kind: r.kind, created: r.created, paid: r.paid, cancelled: r.cancelled, noDrivers: r.no_drivers, paidRub: r.paid_rub })),
    cities: cities.map((r) => ({ city: r.city, created: r.created, paid: r.paid })),
    executors: ex.reduce((m, r) => { (m[r.role] ??= {})[r.status] = r.n; return m; }, {}),
    activeSubscriptions: Object.fromEntries(subs.map((r) => [r.role, r.active])), onlineNow: Object.fromEntries(online.map((r) => [r.role, r.n])),
    subscriptionIncome: { rub: income[0].rub, count: income[0].n },
    note: 'Выручка — стоимость заказов с подтверждённой прямой оплатой исполнителю, не доход Sky. Доход Sky — только подписки исполнителей.' };
};
