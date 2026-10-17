/**
 * Sky GO: возвраты и отчёт по оплатам.
 * Sky деньги за поездки, доставки и еду НЕ принимает (прямая оплата исполнителю), поэтому и вернуть их Sky сам не может.
 * Возврат здесь — это ЗАПИСЬ договорённости: заказчик просит, исполнитель соглашается/отказывает, переводит деньги сам и сообщает,
 * заказчик подтверждает получение. Если исполнитель отказал или стороны не согласны — решает администрация (она тоже ничего не переводит:
 * решение «в пользу заказчика» обязывает исполнителя вернуть деньги, дальше — те же шаги).
 *
 * Статусы: requested → accepted | rejected; accepted/upheld → returned → refunded (подтвердил заказчик);
 * rejected | returned → escalated (заказчик) → upheld | denied (администрация); requested | rejected → withdrawn (заказчик).
 */
import { cancelByRef } from './cashbackrules.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { newId, inTx, lockOrder, addEvent, notifyGo, clean, getSetting, goLog } from './gocore.mjs';
import { payRow } from './gopay.mjs';

const CLOSED = ['refunded', 'denied', 'withdrawn'];

export const refundWindowDays = async () => {
  const v = Number(await getSetting('refund_window_days', 14));
  return Number.isFinite(v) && v >= 1 && v <= 90 ? Math.round(v) : 14;
};

/** Запись в историю заказа: статус заказа не меняется (он уже «оплачен»), поэтому берём текущий. */
const evt = async (c, orderId, actorId, note) => {
  const { rows } = await c.query('SELECT status FROM go_orders WHERE id = $1', [orderId]);
  if (rows[0]) await addEvent(c, orderId, actorId, rows[0].status, rows[0].status, note);
};

const step = (r, who, what, note = '') => [...(r.history ?? []), { at: new Date().toISOString(), who, what, note: note.slice(0, 300) }];

const view = (r, viewerId) => ({
  id: r.id, orderId: r.order_id, amountRub: r.amount_rub, reason: r.reason, status: r.status, executorNote: r.executor_note, adminNote: r.admin_note,
  role: viewerId === r.customer_id ? 'customer' : viewerId === r.executor_id ? 'executor' : 'staff',
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), closedAt: r.closed_at?.toISOString?.() ?? null,
  history: (r.history ?? []).map((h) => ({ at: h.at, who: h.who, what: h.what, note: h.note })),
});

/** Возврат по заказу: виден заказчику, исполнителю и сотрудникам. eligible — можно ли сейчас запросить. */
export const forOrder = async (viewerId, orderId, { staff = false } = {}) => {
  const { rows: ord } = await query('SELECT * FROM go_orders WHERE id = $1', [orderId]);
  const o = ord[0]; if (!o) return { error: 'not_found' };
  const pay = await payRow(null, orderId);
  const { rows } = await query('SELECT * FROM go_refunds WHERE order_id = $1', [orderId]);
  const r = rows[0] ?? null;
  const party = pay && (pay.payer_id === viewerId || pay.payee_id === viewerId) || o.customer_id === viewerId || o.executor_id === viewerId;
  if (!party && !staff) return { error: 'not_found' };
  const out = { ok: true, refund: r ? view(r, viewerId) : null, windowDays: await refundWindowDays() };
  if (!r && (pay?.payer_id === viewerId || o.customer_id === viewerId)) out.eligible = (await eligible(o, pay)).ok;
  return out;
};

const eligible = async (o, pay) => {
  if (!pay || pay.state !== 'confirmed') return { error: 'not_paid' };
  if (o.status !== 'paid') return { error: 'not_paid' };
  if (o.data?.internal) return { error: 'no_payment' };
  const win = await refundWindowDays();
  const done = o.completed_at ?? o.updated_at;
  if (Date.now() - done.getTime() > win * 86400000) return { error: 'refund_window_closed', days: win };
  return { ok: true };
};

export const request = async (customerId, orderId, input) => {
  const reason = clean(input?.reason, 500);
  if (reason.length < 5) return { error: 'reason_required' };
  const out = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o) return { error: 'not_found' };
    const pay = await payRow(c, orderId);
    if (!pay || pay.payer_id !== customerId) return { error: 'not_found' };
    const el = await eligible(o, pay); if (el.error) return el;
    const amount = input?.amountRub == null || input.amountRub === '' ? pay.amount_rub : Math.round(Number(input.amountRub));
    if (!(amount >= 1 && amount <= pay.amount_rub)) return { error: 'bad_amount', max: pay.amount_rub };
    const { rows: ex } = await c.query('SELECT 1 FROM go_refunds WHERE order_id = $1', [orderId]);
    if (ex[0]) return { error: 'refund_exists' };
    const id = newId('gr');
    const h = [{ at: new Date().toISOString(), who: 'customer', what: 'requested', note: reason.slice(0, 300) }];
    await c.query(`INSERT INTO go_refunds (id, order_id, customer_id, executor_id, amount_rub, reason, status, history) VALUES ($1,$2,$3,$4,$5,$6,'requested',$7::jsonb)`,
      [id, orderId, customerId, pay.payee_id, amount, reason, JSON.stringify(h)]);
    await addEvent(c, orderId, customerId, o.status, o.status, `Заказчик запросил возврат ${amount} ₽`);
    return { ok: true, id, executorId: pay.payee_id, amountRub: amount };
  });
  if (out.ok) await notifyGo(out.executorId, 'payment', 'Запрос на возврат', `Заказчик просит вернуть ${out.amountRub} ₽ по оплаченному заказу. Ответьте на запрос в карточке заказа.`, orderId, `${out.id}:requested`);
  return out;
};

/** Шаги сторон. action: accept | reject | returned (исполнитель); withdraw | escalate | confirm (заказчик). */
export const act = async (actorId, orderId, action, input = {}) => {
  const note = clean(input?.note, 500);
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM go_refunds WHERE order_id = $1 FOR UPDATE', [orderId]);
    const r = rows[0]; if (!r) return { error: 'not_found' };
    const isCust = actorId === r.customer_id; const isExec = actorId === r.executor_id;
    if (!isCust && !isExec) return { error: 'not_found' };
    const to = (status, who, extra = '', set = '') => ({ status, who, extra, set });
    let tr = null;
    if (isExec) {
      if (action === 'accept' && r.status === 'requested') tr = to('accepted', 'executor');
      else if (action === 'reject' && r.status === 'requested') { if (note.length < 5) return { error: 'note_required' }; tr = to('rejected', 'executor', note, 'executor_note'); }
      else if (action === 'returned' && ['accepted', 'upheld'].includes(r.status)) tr = to('returned', 'executor', note);
    } else {
      if (action === 'withdraw' && ['requested', 'rejected'].includes(r.status)) tr = to('withdrawn', 'customer');
      else if (action === 'escalate' && ['rejected', 'returned'].includes(r.status)) { if (note.length < 5) return { error: 'note_required' }; tr = to('escalated', 'customer', note); }
      else if (action === 'confirm' && r.status === 'returned') tr = to('refunded', 'customer');
    }
    if (!tr) return { error: 'bad_state', status: r.status };
    const closed = CLOSED.includes(tr.status);
    await c.query(`UPDATE go_refunds SET status = $2, history = $3::jsonb, ${tr.set === 'executor_note' ? 'executor_note = $4,' : ''} updated_at = now(), closed_at = ${closed ? 'now()' : 'closed_at'} WHERE id = $1`,
      tr.set === 'executor_note' ? [r.id, tr.status, JSON.stringify(step(r, tr.who, tr.status, tr.extra)), tr.extra] : [r.id, tr.status, JSON.stringify(step(r, tr.who, tr.status, tr.extra))]);
    await evt(c, orderId, actorId, `Возврат: ${tr.status}`);
    return { ok: true, id: r.id, status: tr.status, other: isExec ? r.customer_id : r.executor_id, amountRub: r.amount_rub };
  });
  if (out.ok && out.status === 'refunded') await cancelByRef(`go:${orderId}`, 'Возврат по заказу').catch(() => {});
  if (out.ok) {
    const T = { accepted: 'Исполнитель согласился вернуть деньги. Он переведёт их сам и сообщит.', rejected: 'Исполнитель отказал в возврате. Можно обратиться к администрации.', returned: 'Исполнитель сообщил, что вернул деньги. Проверьте и подтвердите получение.',
      refunded: 'Заказчик подтвердил получение возврата.', escalated: 'Заказчик обратился к администрации по возврату.', withdrawn: 'Заказчик отозвал запрос на возврат.' };
    if (out.status === 'escalated') void notifyStaff('go_dispute', { title: 'Возврат Sky GO: обращение', body: 'Заказчик обратился к администрации по возврату.', dedupe: `${out.id}:escalated`, except: [actorId] });
    await notifyGo(out.other, 'payment', 'Возврат по заказу', T[out.status] ?? 'Статус возврата изменился.', orderId, `${out.id}:${out.status}`);
  }
  return out;
};

/* ─── Администрация ─── */
export const adminList = async (adminId, status) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const st = String(status ?? '');
  const { rows } = await query(
    `SELECT r.*, o.kind, o.price_rub FROM go_refunds r JOIN go_orders o ON o.id = r.order_id
      WHERE ($1 = '' OR r.status = $1) ORDER BY (r.status = 'escalated') DESC, r.updated_at DESC LIMIT 200`, [st]);
  return { ok: true, refunds: rows.map((r) => ({ ...view(r, null), kind: r.kind, orderPriceRub: r.price_rub, customerId: r.customer_id, executorId: r.executor_id })) };
};

export const adminDecide = async (adminId, refundId, outcome, noteRaw) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const note = clean(noteRaw, 500);
  if (!['upheld', 'denied'].includes(outcome)) return { error: 'bad_outcome' };
  if (note.length < 5) return { error: 'note_required' };
  const out = await inTx(async (c) => {
    const { rows } = await c.query('SELECT * FROM go_refunds WHERE id = $1 FOR UPDATE', [refundId]);
    const r = rows[0]; if (!r) return { error: 'not_found' };
    if (r.status !== 'escalated') return { error: 'bad_state', status: r.status };
    if (adminId === r.customer_id || adminId === r.executor_id) return { error: 'self_review' };
    const closed = outcome === 'denied';
    await c.query(`UPDATE go_refunds SET status = $2, admin_note = $3, decided_by = $4, history = $5::jsonb, updated_at = now(), closed_at = ${closed ? 'now()' : 'closed_at'} WHERE id = $1`,
      [r.id, outcome, note, adminId, JSON.stringify(step(r, 'admin', outcome, note))]);
    await evt(c, r.order_id, adminId, `Решение администрации по возврату: ${outcome === 'upheld' ? 'в пользу заказчика' : 'отказано'}`);
    return { ok: true, r };
  });
  if (!out.ok) return out;
  await logAdmin({ actorId: adminId, type: 'go_refund', targetType: 'system', targetId: refundId, detail: `${outcome}: ${note}`.slice(0, 220) });
  await goLog(adminId, 'refund_decide', refundId, { outcome });
  const txt = outcome === 'upheld' ? 'Администрация решила в пользу заказчика: исполнитель должен вернуть деньги.' : 'Администрация отказала в возврате.';
  await notifyGo(out.r.customer_id, 'payment', 'Решение по возврату', txt, out.r.order_id, `${refundId}:${outcome}:c`);
  await notifyGo(out.r.executor_id, 'payment', 'Решение по возврату', txt, out.r.order_id, `${refundId}:${outcome}:e`);
  return { ok: true };
};

/* ─── Отчёт получателя денег (то, что называют «выплатами»): Sky ничего не выплачивает, деньги приходят напрямую. ─── */
export const earnings = async (profileId, daysRaw) => {
  const days = Math.min(180, Math.max(1, Math.round(Number(daysRaw) || 30)));
  const { rows } = await query(
    `SELECT p.order_id, p.amount_rub, p.confirmed_at, o.kind, f.status AS rstatus, f.amount_rub AS ramount
       FROM go_order_pay p JOIN go_orders o ON o.id = p.order_id LEFT JOIN go_refunds f ON f.order_id = p.order_id
      WHERE p.payee_id = $1 AND p.state = 'confirmed' AND p.confirmed_at > now() - ($2 || ' days')::interval
        AND coalesce(o.data->>'internal', '') <> 'true' ORDER BY p.confirmed_at`, [profileId, String(days)]);
  const day = new Map(); const kind = new Map();
  let total = 0, refunded = 0, pending = 0;
  for (const r of rows) {
    total += r.amount_rub;
    const back = r.rstatus === 'refunded' ? r.ramount : 0;
    refunded += back;
    if (r.rstatus && ['requested', 'accepted', 'returned', 'escalated', 'upheld', 'rejected'].includes(r.rstatus)) pending += r.ramount;
    const d = r.confirmed_at.toISOString().slice(0, 10);
    const cur = day.get(d) ?? { date: d, orders: 0, grossRub: 0, refundedRub: 0 };
    cur.orders += 1; cur.grossRub += r.amount_rub; cur.refundedRub += back; day.set(d, cur);
    const k = kind.get(r.kind) ?? { kind: r.kind, orders: 0, grossRub: 0 }; k.orders += 1; k.grossRub += r.amount_rub; kind.set(r.kind, k);
  }
  return { ok: true, days, orders: rows.length, grossRub: total, refundedRub: refunded, netRub: total - refunded, pendingRefundsRub: pending,
    byDay: [...day.values()], byKind: [...kind.values()],
    note: 'Отчёт по оплатам, которые вы подтвердили как полученные. Sky деньги за заказы не принимает и ничего не выплачивает: оплата идёт напрямую.' };
};

export const earningsCsv = async (profileId, days) => {
  const e = await earnings(profileId, days);
  const cell = (v) => { const s = String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; };
  const lines = ['Дата;Заказов;Получено, ₽;Возвращено, ₽;Итого, ₽', ...e.byDay.map((d) => [d.date, d.orders, d.grossRub, d.refundedRub, d.grossRub - d.refundedRub].map(cell).join(';')),
    ['Итого', e.orders, e.grossRub, e.refundedRub, e.netRub].map(cell).join(';')];
  return '﻿' + lines.join('\r\n') + '\r\n';
};
