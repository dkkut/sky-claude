/**
 * Sky Parking, этап B: автомобили, оплата через SkyKassa Business (на реквизиты организации), сессии, продление, возвраты, жалобы.
 *
 * Деньги Sky НЕ принимает: человек платит организации напрямую по её реквизитам на странице SkyKassa Business (`/p/<id>`) и жмёт «Я перевёл»;
 * сессия ждёт (`awaiting_payment`, 30 минут) и включается, когда организация подтвердит поступление в кабинете SkyKassa Business
 * (`kassaPaymentConfirmedIn`, вызывается из kbiz.actOnPayment В ТОЙ ЖЕ транзакции). Кошелёк Sky здесь только у старых сессий (pay_via='wallet').
 * Оплата и действие — ОДНА транзакция под блокировкой парковки; повтор запроса с тем же idemKey ничего не списывает.
 * Подтверждение «оплачено» создаёт только сервер; клиентскому «успех» верить нельзя. Организациям деньги не выплачиваются.
 */
import crypto from 'node:crypto';
import { query } from './db.mjs';
import { can, isOwner } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { wallet } from './wallet.mjs';
import { newId, inTx, clean, notifyGo, sealJson, openJson } from './gocore.mjs';
import { notifyStaff } from './staffnotify.mjs';
import { calcCost, orgRole } from './parking.mjs';
import { subState, payUrl, publicId } from './kbiz.mjs';

const PAY_WINDOW_MIN = 30;

const MAX_VEHICLES = 5;
const PLATE_RE = /^[A-ZА-Я0-9]{4,10}$/;
const platesHash = (profileId, plate) => crypto.createHmac('sha256', `parking-plate:${profileId}`).update(plate).digest('hex');
export const normPlate = (v) => String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
const maskPlate = (p) => (p.length <= 4 ? p : `${p.slice(0, 2)}•••${p.slice(-2)}`);
const idemOk = (k) => /^[\w:.-]{8,80}$/.test(String(k ?? ''));

/* ─── Автомобили ─── */
export const myVehicles = async (me) => {
  const { rows } = await query('SELECT id, plate_enc, label, created_at FROM parking_vehicles WHERE profile_id=$1 ORDER BY created_at', [me]);
  return { vehicles: rows.map((r) => ({ id: r.id, plate: openJson(r.plate_enc).plate ?? '', label: r.label })) };
};
export const addVehicle = async (me, input) => {
  const plate = normPlate(input?.plate);
  if (!PLATE_RE.test(plate)) return { error: 'bad_plate' };
  const n = Number((await query('SELECT COUNT(*)::int c FROM parking_vehicles WHERE profile_id=$1', [me])).rows[0].c);
  if (n >= MAX_VEHICLES) return { error: 'too_many_vehicles' };
  const id = newId('pkv');
  const r = await query('INSERT INTO parking_vehicles (id, profile_id, plate_enc, plate_hash, label) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (profile_id, plate_hash) DO NOTHING',
    [id, me, sealJson({ plate }), platesHash(me, plate), clean(input?.label, 40)]);
  if (!r.rowCount) return { error: 'vehicle_exists' };
  return { ok: true, id };
};
export const removeVehicle = async (me, id) => {
  const act = await query("SELECT 1 FROM parking_sessions WHERE vehicle_id=$1 AND profile_id=$2 AND status='active' AND ends_at>now()", [id, me]);
  if (act.rowCount) return { error: 'vehicle_in_use' };
  const r = await query('DELETE FROM parking_vehicles WHERE id=$1 AND profile_id=$2', [id, me]);
  return r.rowCount ? { ok: true } : { error: 'not_found' };
};

/* ─── Сессии ─── */
const expireDue = async (client = null) => {
  await (client ?? { query }).query("UPDATE parking_sessions SET status='ended' WHERE status='active' AND ends_at<=now()");
};
const sessView = (s, withPlate = true) => ({
  id: s.id, lotId: s.lot_id, lotTitle: s.lot_title, address: s.address, status: s.status, startsAt: s.starts_at, endsAt: s.ends_at,
  paidRub: s.paid_rub, payBy: s.status === 'awaiting_payment' ? s.pay_deadline : null, secondsLeft: s.status === 'active' ? Math.max(0, Math.floor((new Date(s.ends_at).getTime() - Date.now()) / 1000)) : 0,
  plate: withPlate ? (openJson(s.plate_enc).plate ?? '') : maskPlate(openJson(s.plate_enc).plate ?? ''),
  tariff: { kind: s.tariff_snap?.kind, priceRub: s.tariff_snap?.price_rub, maxMinutes: s.tariff_snap?.max_minutes },
});
const SESS_SQL = `SELECT s.*, l.title AS lot_title, l.address FROM parking_sessions s JOIN parking_lots l ON l.id=s.lot_id`;

export const mySessions = async (me) => {
  await expireDue();
  await expireUnpaid();
  const { rows } = await query(`${SESS_SQL} WHERE s.profile_id=$1 ORDER BY s.created_at DESC LIMIT 60`, [me]);
  const ids = rows.map((r) => r.id);
  const pay = ids.length ? (await query('SELECT p.id, p.session_id, p.kind, p.amount_rub, p.status, p.created_at, p.pay_via, q.public_id AS pub, q.expires_at AS pay_by, r.status AS refund_status FROM parking_payments p LEFT JOIN parking_refunds r ON r.payment_id=p.id LEFT JOIN kb_qr q ON q.id=p.kb_qr_id WHERE p.session_id=ANY($1) ORDER BY p.created_at', [ids])).rows : [];
  return { sessions: rows.map((r) => ({ ...sessView(r), payments: pay.filter((p) => p.session_id === r.id).map((p) => ({ id: p.id, kind: p.kind, amountRub: p.amount_rub, status: p.status, payVia: p.pay_via, refund: p.refund_status ?? null, at: p.created_at, ...(p.status === 'pending' && p.pub ? { payUrl: payUrl(p.pub), payBy: p.pay_by } : {}) })) })) };
};

const lockLot = async (c, lotId) => {
  const l = (await c.query(`SELECT l.*, o.status AS org_status, o.owner_id FROM parking_lots l JOIN parking_orgs o ON o.id=l.org_id WHERE l.id=$1 FOR UPDATE OF l`, [lotId])).rows[0];
  if (!l || l.status !== 'approved' || l.org_status !== 'active') return null;
  return l;
};
/** Страница оплаты организации принимает деньги, только если у владельца подключён SkyKassa Business: бизнес опубликован, подписка действует, есть реквизиты. */
const kassaReady = async (c, ownerId) => {
  const b = (await c.query("SELECT id, status FROM kb_businesses WHERE owner_id = $1", [ownerId])).rows[0];
  if (!b || b.status !== 'active') return null;
  if (!(await subState(b.id)).active) return null;
  if (!(await c.query('SELECT 1 FROM kb_requisites WHERE business_id = $1', [b.id])).rowCount) return null;
  return b;
};
export const lotAcceptsPayment = async (ownerId) => Boolean(await kassaReady({ query }, ownerId));

const payResult = async (payment, extra = {}) => {
  const q = payment.kb_qr_id ? (await query('SELECT public_id, expires_at FROM kb_qr WHERE id = $1', [payment.kb_qr_id])).rows[0] : null;
  return { ok: true, sessionId: payment.session_id, paymentId: payment.id, amountRub: payment.amount_rub, duplicate: true,
    ...(payment.status === 'pending' && q ? { pending: true, payUrl: payUrl(q.public_id), payBy: q.expires_at } : {}), ...extra };
};
const paidSessionResult = payResult;

/** Страница оплаты на ровно эту сумму: обычная страница SkyKassa Business (скрыта из списка QR как «касса»), срок — окно оплаты. */
const createPayPage = async (c, biz, { title, description, amount, sessionId, paymentId, me }) => {
  const qid = newId('kbq'); const pid = publicId();
  await c.query(`INSERT INTO kb_qr (id, public_id, business_id, kind, title, description, amount_rub, order_no, expires_at, created_by, config)
                 VALUES ($1,$2,$3,'pay',$4,$5,$6,$7, now() + ($8 || ' minutes')::interval, $9, $10)`,
    [qid, pid, biz.id, title, description, amount, `PK-${sessionId.slice(-6)}`, String(PAY_WINDOW_MIN), me, JSON.stringify({ cash: true, parking: true, parkingPayment: paymentId })]);
  return { qid, pid };
};

export const startSession = async (me, input) => {
  const idem = String(input?.idemKey ?? ''); if (!idemOk(idem)) return { error: 'idem_required' };
  const minutes = Math.floor(Number(input?.minutes));
  const out = await inTx(async (c) => {
    const dup = (await c.query('SELECT * FROM parking_payments WHERE profile_id=$1 AND idem_key=$2', [me, idem])).rows[0];
    if (dup) return { dup };
    const lot = await lockLot(c, String(input?.lotId ?? '')); if (!lot) return { error: 'not_found' };
    // повторная проверка ПОСЛЕ блокировки: параллельный повтор того же ключа дождался замка и видит уже созданное
    const dup2 = (await c.query('SELECT * FROM parking_payments WHERE profile_id=$1 AND idem_key=$2', [me, idem])).rows[0];
    if (dup2) return { dup: dup2 };
    if (lot.owner_id === me) return { error: 'own_lot' };
    const t = (await c.query('SELECT * FROM parking_tariffs WHERE id=$1 AND lot_id=$2 AND active', [String(input?.tariffId ?? ''), lot.id])).rows[0];
    if (!t) return { error: 'not_found' };
    const veh = (await c.query('SELECT id, plate_enc FROM parking_vehicles WHERE id=$1 AND profile_id=$2', [String(input?.vehicleId ?? ''), me])).rows[0];
    if (!veh) return { error: 'vehicle_required' };
    const cost = calcCost(t, minutes); if (cost.error) return cost;
    await expireDue(c);
    await expireUnpaid(c);
    if ((await c.query("SELECT 1 FROM parking_sessions WHERE vehicle_id=$1 AND status IN ('active','awaiting_payment')", [veh.id])).rowCount) return { error: 'vehicle_in_use' };
    const used = Number((await c.query("SELECT COUNT(*)::int c FROM parking_sessions WHERE lot_id=$1 AND status IN ('active','awaiting_payment')", [lot.id])).rows[0].c);
    if (used >= lot.spaces_total) return { error: 'lot_full' };           // оплаченных и ожидающих оплату через Sky сессий не больше числа мест
    let biz = null;
    if (cost.cost > 0) { biz = await kassaReady(c, lot.owner_id); if (!biz) return { error: 'lot_not_accepting_payments' }; }
    const sid = newId('pks'); const pid = newId('pkp');
    const snap = { kind: t.kind, price_rub: t.price_rub, free_minutes: t.free_minutes, min_minutes: t.min_minutes, max_minutes: t.max_minutes, tariff_id: t.id };
    const free = cost.cost === 0;
    await c.query(`INSERT INTO parking_sessions (id, lot_id, org_id, profile_id, vehicle_id, plate_enc, tariff_snap, starts_at, ends_at, paid_rub, status, pay_via, pay_deadline, start_minutes)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,now(), now() + ($8 || ' minutes')::interval, 0, $9, $10, $11, $12)`,
      [sid, lot.id, lot.org_id, me, veh.id, veh.plate_enc, JSON.stringify(snap), String(cost.minutes), free ? 'active' : 'awaiting_payment', free ? 'free' : 'kassa',
        free ? null : new Date(Date.now() + PAY_WINDOW_MIN * 60_000), cost.minutes]);
    let page = null;
    if (!free) page = await createPayPage(c, biz, { title: `Парковка: ${lot.title}`, description: `${cost.minutes} мин, номер ${maskPlate(openJson(veh.plate_enc).plate ?? '')}`, amount: cost.cost, sessionId: sid, paymentId: pid, me });
    await c.query(`INSERT INTO parking_payments (id, session_id, profile_id, kind, minutes, amount_rub, idem_key, status, pay_via, kb_qr_id) VALUES ($1,$2,$3,'start',$4,$5,$6,$7,$8,$9)`,
      [pid, sid, me, cost.minutes, cost.cost, idem, free ? 'paid' : 'pending', free ? 'free' : 'kassa', page?.qid ?? null]);
    await c.query('INSERT INTO parking_events (org_id, lot_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [lot.org_id, lot.id, me, free ? 'session_started' : 'session_awaiting_payment', JSON.stringify({ sessionId: sid, minutes: cost.minutes, amountRub: cost.cost })]);
    return free ? { ok: true, sessionId: sid, paymentId: pid, amountRub: 0 }
      : { ok: true, sessionId: sid, paymentId: pid, amountRub: cost.cost, pending: true, payUrl: payUrl(page.pid), payBy: new Date(Date.now() + PAY_WINDOW_MIN * 60_000).toISOString() };
  });
  return out.dup ? payResult(out.dup) : out;
};

export const extendSession = async (me, sessionId, input) => {
  const idem = String(input?.idemKey ?? ''); if (!idemOk(idem)) return { error: 'idem_required' };
  const extra = Math.floor(Number(input?.minutes));
  if (!Number.isFinite(extra) || extra < 5) return { error: 'duration_too_short', min: 5 };
  const out = await inTx(async (c) => {
    const dup = (await c.query('SELECT * FROM parking_payments WHERE profile_id=$1 AND idem_key=$2', [me, idem])).rows[0];
    if (dup) return { dup };
    const s = (await c.query('SELECT * FROM parking_sessions WHERE id=$1 AND profile_id=$2 FOR UPDATE', [sessionId, me])).rows[0];
    if (!s) return { error: 'not_found' };
    if (s.status !== 'active' || new Date(s.ends_at) <= new Date()) return { error: 'session_ended' };
    const lot = await lockLot(c, s.lot_id); if (!lot) return { error: 'lot_unavailable' };
    const dup2 = (await c.query('SELECT * FROM parking_payments WHERE profile_id=$1 AND idem_key=$2', [me, idem])).rows[0];
    if (dup2) return { dup: dup2 };
    const snap = s.tariff_snap;
    if (snap.kind === 'flat') return { error: 'not_extendable' };
    if ((await c.query("SELECT 1 FROM parking_payments WHERE session_id=$1 AND status='pending'", [s.id])).rowCount) return { error: 'payment_pending' };   // сначала дождаться/отменить прежнюю оплату
    const prevMin = Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
    const total = prevMin + extra;
    const before = calcCost(snap, prevMin); const after = calcCost(snap, total);
    if (after.error) return after;
    const diff = Math.max(0, after.cost - (before.cost ?? 0));
    const pid = newId('pkp');
    if (diff === 0) {
      await c.query("UPDATE parking_sessions SET ends_at = ends_at + ($2 || ' minutes')::interval, soon_notified=false, end_notified=false WHERE id=$1", [s.id, String(extra)]);
      await c.query(`INSERT INTO parking_payments (id, session_id, profile_id, kind, minutes, amount_rub, idem_key, status, pay_via) VALUES ($1,$2,$3,'extend',$4,0,$5,'paid','free')`, [pid, s.id, me, extra, idem]);
      return { ok: true, sessionId: s.id, paymentId: pid, amountRub: 0 };
    }
    const biz = await kassaReady(c, lot.owner_id); if (!biz) return { error: 'lot_not_accepting_payments' };
    const page = await createPayPage(c, biz, { title: `Парковка: продление, ${lot.title}`, description: `+${extra} мин`, amount: diff, sessionId: s.id, paymentId: pid, me });
    await c.query(`INSERT INTO parking_payments (id, session_id, profile_id, kind, minutes, amount_rub, idem_key, status, pay_via, kb_qr_id) VALUES ($1,$2,$3,'extend',$4,$5,$6,'pending','kassa',$7)`, [pid, s.id, me, extra, diff, idem, page.qid]);
    await c.query('INSERT INTO parking_events (org_id, lot_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [s.org_id, s.lot_id, me, 'session_extend_awaiting_payment', JSON.stringify({ sessionId: s.id, minutes: extra, amountRub: diff })]);
    return { ok: true, sessionId: s.id, paymentId: pid, amountRub: diff, pending: true, payUrl: payUrl(page.pid), payBy: new Date(Date.now() + PAY_WINDOW_MIN * 60_000).toISOString() };
  });
  return out.dup ? payResult(out.dup) : out;
};

/* ─── Подтверждение оплаты организацией (SkyKassa Business) ─── */

/** Вызывается из kbiz.actOnPayment/kbprovider В ТОЙ ЖЕ транзакции, когда оплата подтверждена: включает/продлевает сессию. */
export const kassaPaymentConfirmedIn = async (c, kbPaymentId) => {
  const row = (await c.query('SELECT p.id, p.amount_rub, q.config FROM kb_payments p JOIN kb_qr q ON q.id = p.qr_id WHERE p.id = $1', [kbPaymentId])).rows[0];
  const pkId = row?.config?.parkingPayment; if (!pkId) return;
  const pay = (await c.query('SELECT * FROM parking_payments WHERE id = $1 FOR UPDATE', [pkId])).rows[0];
  if (!pay || pay.status !== 'pending') return;
  const s = (await c.query('SELECT * FROM parking_sessions WHERE id = $1 FOR UPDATE', [pay.session_id])).rows[0]; if (!s) return;
  await c.query("UPDATE parking_payments SET status='paid', kb_payment_id=$2 WHERE id=$1", [pay.id, kbPaymentId]);
  await c.query('SAVEPOINT pk_activate');
  try {
    if (pay.kind === 'start') {
      if (['awaiting_payment', 'cancelled'].includes(s.status) && s.pay_via === 'kassa') {
        await c.query("UPDATE parking_sessions SET status='active', starts_at=now(), ends_at=now() + ($2 || ' minutes')::interval, paid_rub=$3, soon_notified=false, end_notified=false WHERE id=$1", [s.id, String(pay.minutes), pay.amount_rub]);
      }
    } else if (['active', 'ended'].includes(s.status)) {
      await c.query("UPDATE parking_sessions SET status='active', ends_at = GREATEST(now(), ends_at) + ($2 || ' minutes')::interval, paid_rub = paid_rub + $3, soon_notified=false, end_notified=false WHERE id=$1", [s.id, String(pay.minutes), pay.amount_rub]);
    }
    await c.query('RELEASE SAVEPOINT pk_activate');
  } catch (e) {            // например, на машине уже другая сессия: оплата принята и записана, сессию не включили — человек запросит возврат
    await c.query('ROLLBACK TO SAVEPOINT pk_activate');
    console.error('[parking] включение сессии после оплаты:', e.message);
  }
  await c.query('INSERT INTO parking_events (org_id, lot_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [s.org_id, s.lot_id, null, 'payment_confirmed', JSON.stringify({ sessionId: s.id, paymentId: pay.id, amountRub: pay.amount_rub })]);
  void notifyGo(s.profile_id, 'parking', 'Sky Parking', 'Оплата подтверждена организацией — парковка началась.', s.id, `pk:${pay.id}:paid`).catch(() => {});
};

/** Оплата отменена организацией: ожидающая сессия/продление отменяются; возврат подтверждённой оплаты — статус возврата. */
export const kassaPaymentChangedIn = async (c, kbPaymentId, status) => {
  const row = (await c.query('SELECT q.config FROM kb_payments p JOIN kb_qr q ON q.id = p.qr_id WHERE p.id = $1', [kbPaymentId])).rows[0];
  const pkId = row?.config?.parkingPayment; if (!pkId) return;
  const pay = (await c.query('SELECT * FROM parking_payments WHERE id = $1 FOR UPDATE', [pkId])).rows[0]; if (!pay) return;
  if (status === 'cancelled' && pay.status === 'pending') {
    await c.query("UPDATE parking_payments SET status='cancelled' WHERE id=$1", [pay.id]);
    if (pay.kind === 'start') await c.query("UPDATE parking_sessions SET status='cancelled' WHERE id=$1 AND status='awaiting_payment'", [pay.session_id]);
  } else if (status === 'refunded' && pay.status === 'paid') {
    await c.query("UPDATE parking_payments SET status='refunded' WHERE id=$1", [pay.id]);
    if (pay.kind === 'start') await c.query("UPDATE parking_sessions SET status='cancelled', ends_at=LEAST(ends_at, now()) WHERE id=$1 AND status='active'", [pay.session_id]);
  }
};

/** Не дождались оплаты: сессия и страница оплаты закрываются. Если человек уже нажал «Я перевёл» — ждём решения организации. */
const expireUnpaid = async (client = null) => {
  const c = client ?? { query };
  await c.query(`UPDATE parking_sessions s SET status='cancelled' WHERE s.status='awaiting_payment' AND s.pay_deadline < now()
                   AND NOT EXISTS (SELECT 1 FROM parking_payments pp JOIN kb_payments kp ON kp.qr_id = pp.kb_qr_id WHERE pp.session_id = s.id AND kp.status IN ('reported','pending_check'))`);
  await c.query(`UPDATE kb_qr q SET status='disabled' FROM parking_payments pp WHERE pp.kb_qr_id = q.id AND pp.status = 'pending' AND q.status = 'active' AND q.expires_at < now()
                   AND NOT EXISTS (SELECT 1 FROM kb_payments kp WHERE kp.qr_id = q.id AND kp.status IN ('reported','pending_check'))`);
  await c.query(`UPDATE parking_payments pp SET status='cancelled' WHERE pp.status='pending'
                   AND (EXISTS (SELECT 1 FROM parking_sessions s WHERE s.id = pp.session_id AND s.status = 'cancelled')
                        OR EXISTS (SELECT 1 FROM kb_qr q WHERE q.id = pp.kb_qr_id AND q.expires_at < now()))
                   AND NOT EXISTS (SELECT 1 FROM kb_payments kp WHERE kp.qr_id = pp.kb_qr_id AND kp.status IN ('reported','pending_check'))`);
};

/** Что будет стоить продление — без списания. */
export const extendQuote = async (me, sessionId, minutes) => {
  const extra = Math.floor(Number(minutes)); if (!Number.isFinite(extra) || extra < 5) return { error: 'duration_too_short', min: 5 };
  const s = (await query("SELECT * FROM parking_sessions WHERE id=$1 AND profile_id=$2 AND status='active' AND ends_at>now()", [sessionId, me])).rows[0];
  if (!s) return { error: 'not_found' };
  const snap = s.tariff_snap; if (snap.kind === 'flat') return { error: 'not_extendable' };
  const prev = Math.round((new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 60000);
  const a = calcCost(snap, prev + extra); if (a.error) return a;
  return { ok: true, costRub: Math.max(0, a.cost - (calcCost(snap, prev).cost ?? 0)) };
};

/* ─── Возвраты ─── */
export const requestRefund = async (me, paymentId, reasonRaw) => {
  const reason = clean(reasonRaw, 400); if (reason.length < 5) return { error: 'reason_required' };
  return inTx(async (c) => {
    const p = (await c.query('SELECT p.*, s.lot_id, s.org_id FROM parking_payments p JOIN parking_sessions s ON s.id=p.session_id WHERE p.id=$1 AND p.profile_id=$2 FOR UPDATE OF p', [paymentId, me])).rows[0];
    if (!p) return { error: 'not_found' };
    if (p.status !== 'paid' || p.amount_rub < 1) return { error: 'bad_state' };
    if (Date.now() - new Date(p.created_at).getTime() > 7 * 86400000) return { error: 'refund_window_closed' };
    const r = await c.query(`INSERT INTO parking_refunds (id, payment_id, session_id, lot_id, org_id, profile_id, amount_rub, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (payment_id) DO NOTHING`,
      [newId('pkr'), p.id, p.session_id, p.lot_id, p.org_id, me, p.amount_rub, reason]);
    if (!r.rowCount) return { error: 'refund_exists' };
    await c.query('INSERT INTO parking_events (org_id, lot_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [p.org_id, p.lot_id, me, 'refund_requested', JSON.stringify({ paymentId: p.id })]);
    return { ok: true };
  }).then((out) => { if (out.ok) void notifyStaff('parking_lot', { title: 'Запрос на возврат за парковку', body: 'Нужно решение организации или администрации', dedupe: `pkrefund:${paymentId}`, except: me }).catch(() => {}); return out; });
};

const canDecideRefund = async (me, orgId) => {
  const r = await orgRole(me, orgId);
  if (r.role === 'owner' || r.role === 'admin') return true;
  return (await can(me, 'parking')) || (await isOwner(me));
};
export const orgRefunds = async (me, orgId, status = 'requested') => {
  if (!(await canDecideRefund(me, orgId))) return { error: 'not_found' };
  const st = ['requested', 'approved', 'rejected'].includes(status) ? status : 'requested';
  const { rows } = await query(`SELECT r.*, l.title FROM parking_refunds r JOIN parking_lots l ON l.id=r.lot_id WHERE r.org_id=$1 AND r.status=$2 ORDER BY r.created_at DESC LIMIT 100`, [orgId, st]);
  return { refunds: rows.map((r) => ({ id: r.id, lotTitle: r.title, amountRub: r.amount_rub, reason: r.reason, status: r.status, note: r.decision_note, at: r.created_at, own: r.profile_id === me })) };
};
export const decideRefund = async (me, refundId, action, noteRaw) => {
  const note = clean(noteRaw, 400);
  if (!['approve', 'reject'].includes(action)) return { error: 'bad_action' };
  if (action === 'reject' && note.length < 5) return { error: 'reason_required' };
  const out = await inTx(async (c) => {
    const r = (await c.query('SELECT * FROM parking_refunds WHERE id=$1 FOR UPDATE', [refundId])).rows[0];
    if (!r) return { error: 'not_found' };
    if (!(await canDecideRefund(me, r.org_id))) return { error: 'not_found' };
    if (r.profile_id === me) return { error: 'self_review' };               // свой возврат не решают
    if (r.status !== 'requested') return { error: 'bad_state' };
    if (action === 'reject') {
      await c.query("UPDATE parking_refunds SET status='rejected', decided_by=$2, decision_note=$3, decided_at=now() WHERE id=$1", [refundId, me, note]);
    } else {
      const p = (await c.query('SELECT * FROM parking_payments WHERE id=$1 FOR UPDATE', [r.payment_id])).rows[0];
      if (!p || p.status !== 'paid') return { error: 'bad_state' };
      // Оплата шла напрямую организации (SkyKassa): Sky деньги не возвращает — это согласие организации вернуть, перевод она делает сама.
      if (p.pay_via === 'kassa') {
        await c.query("UPDATE kb_payments SET status='refunded', updated_at=now() WHERE id=$1 AND status='confirmed'", [p.kb_payment_id]);
        await c.query("INSERT INTO kb_payment_log (payment_id, actor, from_status, to_status, note) SELECT id, $2, 'confirmed', 'refunded', 'Возврат за парковку (Sky Parking)' FROM kb_payments WHERE id=$1 AND status='refunded'", [p.kb_payment_id, me]);
      } else {
        const cr = await wallet.creditIn(c, r.profile_id, r.amount_rub, 'parking_refund', 'Sky Parking: возврат', `parking-refund:${r.id}`);
        if (cr?.error) return cr;
      }
      await c.query("UPDATE parking_payments SET status='refunded' WHERE id=$1", [p.id]);
      await c.query("UPDATE parking_refunds SET status='approved', decided_by=$2, decision_note=$3, decided_at=now() WHERE id=$1", [refundId, me, note]);
      // возврат за начало сессии прекращает её, если больше ничего не оплачено
      const left = Number((await c.query("SELECT COUNT(*)::int c FROM parking_payments WHERE session_id=$1 AND status='paid' AND amount_rub>0", [r.session_id])).rows[0].c);
      if (!left) await c.query("UPDATE parking_sessions SET status='cancelled', ends_at=LEAST(ends_at, now()) WHERE id=$1 AND status='active'", [r.session_id]);
    }
    await c.query('INSERT INTO parking_events (org_id, lot_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [r.org_id, r.lot_id, me, `refund_${action}`, JSON.stringify({ refundId, note })]);
    return { ok: true, to: r.profile_id, amount: r.amount_rub, kassa: Boolean((await c.query('SELECT 1 FROM parking_payments WHERE id=$1 AND pay_via=$2', [r.payment_id, 'kassa'])).rowCount) };
  });
  if (!out.ok) return out;
  await logAdmin({ actorId: me, targetId: refundId, targetType: 'parking_refund', type: `parking_refund_${action}`, detail: note }).catch(() => {});
  void notifyGo(out.to, 'parking', 'Sky Parking', action === 'approve' ? (out.kassa ? `Возврат ${out.amount} ₽ одобрен: организация переведёт деньги сама. Если перевода нет — напишите в поддержку.` : `Возврат ${out.amount} ₽ зачислен на кошелёк`) : `Возврат отклонён: ${note}`, refundId, `pkref:${refundId}:${action}`).catch(() => {});
  return { ok: true };
};

/* ─── Организация: сессии и итоги (оплачено ≠ прибыль, выплат нет) ─── */
export const orgSessions = async (me, orgId) => {
  const r = await orgRole(me, orgId);
  if (r.role !== 'owner' && r.role !== 'admin') return { error: r.role ? 'not_allowed' : 'not_found' };
  await expireDue();
  const { rows } = await query(`${SESS_SQL} WHERE s.org_id=$1 AND (s.status='active' OR s.created_at > now() - interval '3 days') ORDER BY s.created_at DESC LIMIT 200`, [orgId]);
  const sum = (await query(`SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount_rub END),0)::int AS paid, COALESCE(SUM(CASE WHEN status='refunded' THEN amount_rub END),0)::int AS refunded
                              FROM parking_payments WHERE session_id IN (SELECT id FROM parking_sessions WHERE org_id=$1)`, [orgId])).rows[0];
  return { sessions: rows.map((s) => sessView(s, true)), totals: { paidRub: sum.paid, refundedRub: sum.refunded, note: 'Оплаты идут напрямую на ваши реквизиты через SkyKassa Business (подтверждаете вы), старые — через кошелёк Sky. Выплат организациям Sky пока не делает.' } };
};

/* ─── Жалобы ─── */
const REPORT_REASONS = ['wrong_info', 'closed', 'unsafe', 'price', 'other'];
export const reportLot = async (me, lotId, input) => {
  const reason = String(input?.reason ?? ''); if (!REPORT_REASONS.includes(reason)) return { error: 'bad_reason' };
  const lot = (await query("SELECT id FROM parking_lots WHERE id=$1 AND status='approved'", [lotId])).rows[0]; if (!lot) return { error: 'not_found' };
  const r = await query('INSERT INTO parking_reports (id, lot_id, profile_id, reason, note) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (lot_id, profile_id) DO NOTHING', [newId('pkq'), lotId, me, reason, clean(input?.note, 400)]);
  if (!r.rowCount) return { error: 'already_reported' };
  void notifyStaff('parking_lot', { title: 'Жалоба на парковку', body: 'Нужна проверка', dedupe: `pkrep:${lotId}:${me}`, except: me }).catch(() => {});
  return { ok: true };
};
export const adminReports = async (me, status = 'open') => {
  if (!(await can(me, 'parking_moderation'))) return { error: 'not_allowed' };
  const { rows } = await query(`SELECT q.*, l.title FROM parking_reports q JOIN parking_lots l ON l.id=q.lot_id WHERE q.status=$1 ORDER BY q.created_at LIMIT 200`, [status === 'resolved' ? 'resolved' : 'open']);
  return { reports: rows.map((q) => ({ id: q.id, lotId: q.lot_id, lotTitle: q.title, reason: q.reason, note: q.note, status: q.status, resolution: q.resolution, at: q.created_at })) };
};
export const adminResolveReport = async (me, id, resolutionRaw) => {
  if (!(await can(me, 'parking_moderation'))) return { error: 'not_allowed' };
  const resolution = clean(resolutionRaw, 400); if (resolution.length < 5) return { error: 'reason_required' };
  const r = await query("UPDATE parking_reports SET status='resolved', resolved_by=$2, resolution=$3 WHERE id=$1 AND status='open'", [id, me, resolution]);
  if (!r.rowCount) return { error: 'not_found' };
  await logAdmin({ actorId: me, targetId: id, targetType: 'parking_report', type: 'parking_report_resolve', detail: resolution }).catch(() => {});
  return { ok: true };
};

/* ─── Уборка: окончание сессий и напоминания ─── */
export const sweepParking = async () => {
  await expireDue();
  await expireUnpaid();
  const soon = (await query(`UPDATE parking_sessions s SET soon_notified=true FROM parking_lots l WHERE l.id=s.lot_id AND s.status='active' AND NOT s.soon_notified AND s.ends_at <= now() + interval '10 minutes' AND s.ends_at > now() RETURNING s.id, s.profile_id, s.ends_at, l.title`)).rows;
  for (const s of soon) void notifyGo(s.profile_id, 'parking', 'Sky Parking', `Парковка «${s.title}» закончится меньше чем через 10 минут. Продлите в Sky GO.`, s.id, `pk:${s.id}:soon:${new Date(s.ends_at).getTime()}`).catch(() => {});
  const ended = (await query(`UPDATE parking_sessions s SET end_notified=true FROM parking_lots l WHERE l.id=s.lot_id AND s.status='ended' AND NOT s.end_notified RETURNING s.id, s.profile_id, s.ends_at, l.title`)).rows;
  for (const s of ended) void notifyGo(s.profile_id, 'parking', 'Sky Parking', `Время парковки «${s.title}» истекло.`, s.id, `pk:${s.id}:end:${new Date(s.ends_at).getTime()}`).catch(() => {});
};
