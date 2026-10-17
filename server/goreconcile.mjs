/**
 * Sky GO — сверка финансовых статусов (только чтение). Sky не принимает деньги за поездки и доставки: оплата идёт напрямую исполнителю,
 * а в Sky фиксируются сообщения сторон. Здесь ищутся расхождения между заказом, записью оплаты и кошельком (подписки), чтобы сотрудник
 * мог разобраться вручную. Ничего не исправляется автоматически; персональных данных в ответе нет — только идентификаторы.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';

const SAMPLE = 20;
const CHECKS = [
  ['paid_without_confirmed_payment', 'Заказ «оплачен», но оплата не подтверждена получателем',
    `SELECT o.id FROM go_orders o LEFT JOIN go_order_pay p ON p.order_id = o.id
      WHERE o.status = 'paid' AND o.kind IN ('taxi','delivery') AND NOT coalesce((o.data->>'internal')::boolean, false)
        AND coalesce(p.state, '') <> 'confirmed' AND o.completed_at < now() - interval '5 minutes'`],
  ['confirmed_but_not_paid', 'Оплата подтверждена, а заказ не закрыт',
    `SELECT o.id FROM go_orders o JOIN go_order_pay p ON p.order_id = o.id
      WHERE p.state = 'confirmed' AND o.status IN ('awaiting_payment','payment_reported') AND p.confirmed_at < now() - interval '5 minutes'`],
  ['awaiting_without_payment_row', 'Заказ ждёт оплаты, а записи оплаты нет',
    `SELECT o.id FROM go_orders o LEFT JOIN go_order_pay p ON p.order_id = o.id
      WHERE o.status IN ('awaiting_payment','payment_reported') AND p.order_id IS NULL`],
  ['payment_stuck', 'Оплата ждёт больше 7 суток',
    `SELECT o.id FROM go_orders o WHERE o.status IN ('awaiting_payment','payment_reported') AND o.updated_at < now() - interval '7 days'`],
  ['dispute_stuck', 'Спор без решения больше 3 суток',
    `SELECT o.id FROM go_orders o WHERE o.status = 'dispute' AND o.updated_at < now() - interval '3 days'`],
  ['active_without_executor', 'Заказ в работе без исполнителя',
    `SELECT o.id FROM go_orders o WHERE o.kind IN ('taxi','delivery') AND o.status IN ('assigned','en_route','arrived','in_ride','heading_pickup','at_pickup','picked_up','delivering','at_recipient') AND o.executor_id IS NULL`],
  ['subscription_without_charge', 'Платная подписка без списания в кошельке',
    `SELECT s.id FROM go_subscriptions s
      WHERE s.price_rub > 0 AND s.created_at < now() - interval '1 minute'
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions w WHERE w.user_id = s.profile_id AND w.type = 'go_sub' AND abs(extract(epoch FROM (w.created_at - s.created_at))) < 30)`],
  ['duplicate_subscription_payment', 'Один платёжный ключ подписки использован дважды',
    `SELECT min(id) AS id FROM go_subscriptions WHERE payment_ref IS NOT NULL GROUP BY profile_id, role, payment_ref HAVING count(*) > 1`],
];

export const reconcile = async (adminId) => {
  if (!(await can(adminId, 'go')) && !(await can(adminId, 'go_finance'))) return { error: 'not_allowed' };
  const out = [];
  for (const [code, title, sql] of CHECKS) {
    try {
      const { rows } = await query(`${sql} LIMIT 500`);
      out.push({ code, title, count: rows.length, sample: rows.slice(0, SAMPLE).map((r) => r.id), ok: rows.length === 0 });
    } catch (e) { out.push({ code, title, error: 'check_failed', ok: false }); }
  }
  return { checkedAt: new Date().toISOString(), ok: out.every((c) => c.ok), checks: out,
    note: 'Только чтение. Sky не принимает деньги за поездки и доставки, поэтому сверяются статусы заказов и записи оплаты, а не банковские операции.' };
};
