/**
 * Sky GO Business — отчёты и массовые операции кабинета организации: выгрузка заказов в CSV, финансовый отчёт, пакетное создание заказов, повтор заказа.
 * Права и изоляция — как у остального кабинета (`goorg.need`): чужая организация получает not_found, выгрузка/пакет — владелец, администратор, менеджер;
 * финансовый отчёт — владелец и администратор. Деньги Sky не принимает: «оплачено» = прямая оплата подтверждена исполнителем; заказы своих сотрудников
 * (`data.internal`) оплаты не имеют и считаются отдельно.
 */
import { query } from './db.mjs';
import { clean, newId } from './gocore.mjs';
import { need, audit, STAFF, createOrder, getOrder } from './goorg.mjs';

const MAX_ROWS = 5000;
const MAX_BATCH = 50;

/** Ячейка CSV: кавычки удваиваются, значения, похожие на формулу, получают ведущий апостроф (защита от инъекции формул в таблицах). */
export const csvCell = (v) => {
  let t = String(v ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[=+\-@\t]/.test(t)) t = `'${t}`;
  return /[",;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const day = (v, fallback) => { const t = String(v ?? ''); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : fallback; };

export const exportOrdersCsv = async (actorId, orgId, { from, to } = {}) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const f = day(from, '1970-01-01'); const t = day(to, '2999-12-31');
  const { rows } = await query(
    `SELECT o.id, o.status, o.price_rub, o.created_at, o.completed_at, o.data, p.name AS executor
       FROM go_orders o LEFT JOIN profiles p ON p.id = o.executor_id
      WHERE o.org_id = $1 AND o.created_at >= $2::date AND o.created_at < ($3::date + 1) ORDER BY o.created_at DESC LIMIT ${MAX_ROWS + 1}`, [orgId, f, t]);
  const truncated = rows.length > MAX_ROWS;
  const head = ['id', 'создан', 'статус', 'откуда', 'куда', 'описание', 'получатель', 'цена, ₽', 'исполнитель', 'завершён', 'свой сотрудник'];
  const lines = [head.join(',')];
  for (const r of rows.slice(0, MAX_ROWS)) {
    lines.push([r.id, r.created_at.toISOString(), r.status, r.data.from?.address, r.data.to?.address, r.data.parcel?.description, r.data.recipient?.name,
      r.price_rub, r.executor ?? '', r.completed_at?.toISOString() ?? '', r.data.internal ? 'да' : 'нет'].map(csvCell).join(','));
  }
  await audit(orgId, actorId, 'orders_export', null, { rows: Math.min(rows.length, MAX_ROWS), from: f, to: t });
  return { ok: true, csv: `﻿${lines.join('\r\n')}\r\n`, rows: Math.min(rows.length, MAX_ROWS), truncated };
};

export const financeReport = async (actorId, orgId, { days } = {}) => {
  const a = await need(actorId, orgId, ['owner', 'admin']); if (a.error) return a;
  const d = Math.min(366, Math.max(1, Math.round(Number(days) || 30)));
  const { rows: tot } = await query(
    `SELECT count(*) FILTER (WHERE status = 'paid')::int AS paid,
            count(*) FILTER (WHERE status = 'paid' AND coalesce((data->>'internal')::boolean, false))::int AS paid_internal,
            coalesce(sum(price_rub) FILTER (WHERE status = 'paid' AND NOT coalesce((data->>'internal')::boolean, false)), 0)::int AS paid_rub,
            count(*) FILTER (WHERE status IN ('awaiting_payment','payment_reported'))::int AS awaiting,
            coalesce(sum(price_rub) FILTER (WHERE status IN ('awaiting_payment','payment_reported')), 0)::int AS awaiting_rub,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE status = 'dispute')::int AS disputes
       FROM go_orders WHERE org_id = $1 AND created_at >= now() - ($2 || ' days')::interval`, [orgId, String(d)]);
  const { rows: byDay } = await query(
    `SELECT to_char(date_trunc('day', completed_at), 'YYYY-MM-DD') AS day, count(*)::int AS n,
            coalesce(sum(price_rub) FILTER (WHERE NOT coalesce((data->>'internal')::boolean, false)), 0)::int AS rub
       FROM go_orders WHERE org_id = $1 AND status = 'paid' AND completed_at >= now() - ($2 || ' days')::interval GROUP BY 1 ORDER BY 1`, [orgId, String(d)]);
  const t = tot[0];
  return { days: d, currency: 'RUB', paid: { orders: t.paid, internalOrders: t.paid_internal, rub: t.paid_rub }, awaiting: { orders: t.awaiting, rub: t.awaiting_rub },
    cancelled: t.cancelled, disputes: t.disputes, byDay: byDay.map((r) => ({ day: r.day, orders: r.n, rub: r.rub })),
    note: 'Sky не принимает деньги за доставку: суммы — стоимость заказов, оплата по которым подтверждена исполнителем напрямую. Заказы своих сотрудников оплаты не имеют.' };
};

/**
 * Пакет заказов: до 50 за раз, каждый проверяется теми же правилами, что и одиночный (`createOrder`), отказ одной строки другие не отменяет.
 * Повтор того же пакета (batchKey) не создаёт заказы заново: у каждой строки свой ключ идемпотентности.
 */
export const createBatch = async (actorId, orgId, input) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const list = Array.isArray(input?.orders) ? input.orders : null;
  if (!list || !list.length) return { error: 'batch_empty' };
  if (list.length > MAX_BATCH) return { error: 'batch_too_large', max: MAX_BATCH };
  const key = clean(input?.batchKey, 48) || newId('bt');
  const results = [];
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row || typeof row !== 'object') { results.push({ index: i, ok: false, error: 'bad_row' }); continue; }
    const r = await createOrder(actorId, orgId, { ...row, idemKey: `b:${key}:${i}` });
    results.push(r.error ? { index: i, ok: false, error: r.error } : { index: i, ok: true, orderId: r.orderId, priceRub: r.priceRub, duplicate: Boolean(r.duplicate) });
  }
  await audit(orgId, actorId, 'orders_batch', key, { total: list.length, created: results.filter((x) => x.ok && !x.duplicate).length });
  return { ok: true, batchKey: key, created: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results };
};

/** Повторить заказ: те же адреса, получатель и посылка, новая цена по текущему тарифу, новый заказ. */
export const repeatOrder = async (actorId, orgId, orderId) => {
  const a = await need(actorId, orgId, STAFF); if (a.error) return a;
  const { rows } = await query(`SELECT data FROM go_orders WHERE id = $1 AND org_id = $2`, [String(orderId ?? ''), orgId]);
  if (!rows[0]) return { error: 'not_found' };
  const d = rows[0].data;
  const r = await createOrder(actorId, orgId, { from: d.from, to: d.to, size: d.parcel?.size, parcel: d.parcel, recipient: d.recipient, sender: d.sender, comment: d.comment,
    city: undefined, idemKey: `rep:${orderId}:${Date.now()}` });
  if (!r.error) await audit(orgId, actorId, 'order_repeat', r.orderId, { from: orderId });
  return r;
};
