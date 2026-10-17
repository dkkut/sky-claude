/**
 * Sky GO Dispatch — распределение заказов такси между водителями.
 *
 * Режимы (`dispatch_mode` в настройках Sky GO, правит go_finance):
 *   pool   — как раньше: заказ виден всем подходящим водителям города, берёт первый (по умолчанию, ничего не меняется);
 *   offers — заказ предлагается ОДНОМУ лучшему водителю на ограниченное время; не ответил / отказал / срок вышел →
 *            следующему; после `dispatch_max_offers` попыток или если кандидатов нет — заказ уходит в общий пул (state=pool),
 *            чтобы не зависнуть. Ни один заказ не может быть назначен двум водителям: назначение — один UPDATE … WHERE status='searching'
 *            под блокировкой строки заказа.
 *
 * Алгоритм прозрачный и проверяемый (никакого «ИИ»): кандидат допускается, если он на линии, одобрен, с действующей подпиской и реквизитами,
 * в городе заказа, не занят другой поездкой, не держит другого открытого предложения, не получал этот заказ раньше, его положение
 * свежее (`dispatch_presence_fresh_sec`, иначе считаем, что связь потеряна) и не дальше `dispatch_radius_km`. Балл (меньше — лучше):
 *   расстояние до подачи, км  +  0,7 × (отказы и пропуски за час)  −  0,03 × min(простой в минутах, 30).
 * Простой даёт небольшую поправку в пользу давно не получавших заказ — это и есть «справедливость»; расстояние остаётся главным.
 * Класс автомобиля: водитель класса ниже заказанного тарифа не кандидат; класс выше — кандидат с надбавкой 1,5 км (режим 'strict' — нет), см. goclass.mjs.
 * Не учитывается: зоны внутри города — в данных исполнителей их нет (см. docs/GO-AUDIT-2026-11.md).
 * Каждое решение пишется в go_dispatch_log (кого и почему выбрали, три лучших балла).
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import { logAdmin } from './adminsec.mjs';
import { getSetting, inTx, lockOrder, setStatus, addEvent, notifyGo, haversineKm, goLog, clean, pushOrderChanged } from './gocore.mjs';
import { pushGoEvent } from './signal.mjs';
import { driverClass, classMode, classCheck, UPGRADE_PENALTY_KM } from './goclass.mjs';

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const dispatchSettings = async () => ({
  mode: (await getSetting('dispatch_mode', 'pool')) === 'offers' ? 'offers' : 'pool',
  offerSec: num(await getSetting('dispatch_offer_sec', 25), 25, 10, 120),
  maxOffers: Math.round(num(await getSetting('dispatch_max_offers', 5), 5, 1, 20)),
  searchTimeoutMin: Math.round(num(await getSetting('dispatch_search_timeout_min', 20), 20, 0, 240)),   // 0 — не отменять
  freshSec: Math.round(num(await getSetting('dispatch_presence_fresh_sec', 300), 300, 30, 3600)),
  radiusKm: num(await getSetting('dispatch_radius_km', 15), 15, 1, 200),
});

/** Виды заказов, которые распределяются предложениями: роль исполнителя, активные статусы, сколько заказов можно вести сразу. */
const KINDS = {
  taxi: { role: 'taxi_driver', active: ['assigned', 'en_route', 'arrived', 'in_ride'], maxActive: 1, title: 'Новый заказ такси' },
  delivery: { role: 'courier', active: ['assigned', 'heading_pickup', 'at_pickup', 'picked_up', 'delivering', 'at_recipient'], maxActive: 3, title: 'Новая доставка' },
};
/** Заказ организации идёт через диспетчера организации (goorg); в общее распределение попадает, только когда организация открыла его курьерам. */
export const dispatchable = (o) => Boolean(KINDS[o.kind]) && (!o.org_id || o.data?.poolOpen === true || o.data?.poolOpen === 'true');

const dlog = (client, orderId, event, actorId, detail = {}) =>
  client.query('INSERT INTO go_dispatch_log (order_id, event, actor_id, detail) VALUES ($1,$2,$3,$4::jsonb)', [orderId, event, actorId ?? null, JSON.stringify(detail)]);

export const scoreOf = ({ km, misses, idleMin }) => Math.round((km + 0.7 * misses - 0.03 * Math.min(idleMin, 30)) * 100) / 100;

/** Допустимые кандидаты, отсортированные по баллу (меньше — лучше). Читает базу, ничего не меняет. */
export const rankCandidates = async (client, order, cfg) => {
  const k = KINDS[order.kind];
  const cargo = order.kind === 'delivery' && order.data?.scenario === 'cargo';
  const { rows } = await client.query(
    `SELECT p.profile_id, p.lat, p.lng, e.data_enc,
            (SELECT max(completed_at) FROM go_orders x WHERE x.executor_id = p.profile_id AND x.kind = $5) AS last_done,
            (SELECT count(*)::int FROM go_order_offers f JOIN go_orders fo ON fo.id = f.order_id WHERE f.driver_id = p.profile_id AND fo.kind = $5 AND f.status IN ('declined','expired') AND f.offered_at > now() - interval '1 hour') AS misses,
            (SELECT count(*)::int FROM go_orders b WHERE b.kind = $5 AND b.executor_id = p.profile_id AND b.status = ANY($6::text[])) AS active_n,
            (SELECT count(*)::int FROM go_orders b WHERE b.kind = $5 AND b.executor_id = p.profile_id AND b.status = ANY($6::text[]) AND b.data->>'scenario' = 'cargo') AS cargo_n
       FROM go_presence p
       JOIN go_executors e ON e.profile_id = p.profile_id AND e.role = $7 AND e.status = 'approved' AND e.city = $2
      WHERE p.role = $7 AND p.online AND p.lat IS NOT NULL AND p.lng IS NOT NULL
        AND p.updated_at > now() - ($3 || ' seconds')::interval
        AND EXISTS (SELECT 1 FROM go_subscriptions s WHERE s.profile_id = p.profile_id AND s.role = $7 AND s.expires_at > now())
        AND EXISTS (SELECT 1 FROM go_pay_details d WHERE d.profile_id = p.profile_id)
        AND NOT EXISTS (SELECT 1 FROM go_order_offers o WHERE o.driver_id = p.profile_id AND o.status = 'offered' AND o.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM go_order_offers t WHERE t.driver_id = p.profile_id AND t.order_id = $1)
        AND p.profile_id <> $4`,
    [order.id, order.city, String(cfg.freshSec), order.customer_id, order.kind, k.active, k.role]);
  const from = order.data?.from;
  const { openJson } = await import('./gocore.mjs');
  const cMode = order.kind === 'taxi' ? await classMode() : 'upgrade';
  const out = [];
  for (const r of rows) {
    if (r.active_n >= k.maxActive) continue;
    // Грузовой заказ едет отдельным рейсом и только на грузовом транспорте; и наоборот — с грузовым рейсом ничего не совмещается.
    if (cargo && (r.active_n > 0 || openJson(r.data_enc).extra?.transport !== 'truck')) continue;
    if (r.cargo_n > 0) continue;
    const cls = order.kind === 'taxi' ? classCheck(driverClass(r), order.data?.tariff, cMode) : { ok: true };
    if (!cls.ok) continue;
    const km = haversineKm({ lat: r.lat, lng: r.lng }, from);
    if (km > cfg.radiusKm) continue;
    const idleMin = r.last_done ? (Date.now() - new Date(r.last_done).getTime()) / 60000 : 30;
    const reasons = { km: Math.round(km * 10) / 10, etaMin: Math.max(1, Math.round((km * 1.35 / 28) * 60)), misses: r.misses, idleMin: Math.round(idleMin), active: r.active_n, ...(order.kind === 'taxi' ? { carClass: driverClass(r), upgrade: Boolean(cls.upgrade) } : {}) };
    out.push({ driverId: r.profile_id, score: scoreOf({ km, misses: r.misses, idleMin }) + 0.5 * r.active_n + (cls.upgrade ? UPGRADE_PENALTY_KM : 0), reasons });
  }
  return out.sort((a, b) => a.score - b.score || a.driverId.localeCompare(b.driverId));
};

/**
 * Следующий шаг распределения для заказа: погасить просроченные предложения и, если действующего нет, предложить следующему.
 * Безопасно вызывать сколько угодно раз (уборка, отказ водителя, создание заказа): под блокировкой строки заказа.
 */
export const offerNext = async (orderId) => {
  const cfg = await dispatchSettings();
  if (cfg.mode !== 'offers') return { skipped: 'pool_mode' };
  const r = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || !dispatchable(o) || o.status !== 'searching' || o.executor_id) return { skipped: 'not_searching' };
    if (o.dispatch_state === 'pool') return { skipped: 'pool' };
    const { rows: exp } = await c.query(`UPDATE go_order_offers SET status = 'expired', answered_at = now() WHERE order_id = $1 AND status = 'offered' AND expires_at <= now() RETURNING driver_id`, [orderId]);
    for (const e of exp) await dlog(c, orderId, 'offer_expired', null, { driverId: e.driver_id });
    const { rows: open } = await c.query(`SELECT 1 FROM go_order_offers WHERE order_id = $1 AND status = 'offered' AND expires_at > now() LIMIT 1`, [orderId]);
    if (open[0]) return { waiting: true };
    if (o.dispatch_attempts >= cfg.maxOffers) {
      await c.query(`UPDATE go_orders SET dispatch_state = 'pool', updated_at = now() WHERE id = $1`, [orderId]);
      await dlog(c, orderId, 'pool_fallback', null, { reason: 'max_offers', attempts: o.dispatch_attempts });
      return { pool: true };
    }
    const cands = await rankCandidates(c, o, cfg);
    if (!cands.length) {
      await c.query(`UPDATE go_orders SET dispatch_state = 'pool', updated_at = now() WHERE id = $1`, [orderId]);
      await dlog(c, orderId, 'pool_fallback', null, { reason: 'no_candidates', attempts: o.dispatch_attempts });
      return { pool: true };
    }
    const best = cands[0];
    const rank = o.dispatch_attempts + 1;
    await c.query(`INSERT INTO go_order_offers (order_id, driver_id, rank, score, reasons, expires_at) VALUES ($1,$2,$3,$4,$5::jsonb, now() + ($6 || ' seconds')::interval)`,
      [orderId, best.driverId, rank, best.score, JSON.stringify(best.reasons), String(cfg.offerSec)]);
    await c.query(`UPDATE go_orders SET dispatch_state = 'offering', dispatch_attempts = $2, updated_at = now() WHERE id = $1`, [orderId, rank]);
    await dlog(c, orderId, 'offer', null, { driverId: best.driverId, rank, score: best.score, reasons: best.reasons, top: cands.slice(0, 3).map((x) => ({ driverId: x.driverId, score: x.score })) });
    return { offered: best.driverId, rank, expiresInSec: cfg.offerSec, city: o.city, kind: o.kind };
  });
  if (r.offered) {
    await notifyGo(r.offered, r.kind, KINDS[r.kind].title, `Предложение действует ${r.expiresInSec} с.`, orderId, `${orderId}:offer:${r.rank}`);
    pushGoEvent([r.offered], { type: 'go:offer', payload: { orderId, expiresInSec: r.expiresInSec } });
  }
  return r;
};

/** Водитель отказался от предложения. Отказ не штрафует жёстко: попадает в поправку к баллу на час. */
export const declineOffer = async (driverId, orderId) => {
  const r = await inTx(async (c) => {
    await lockOrder(c, orderId);
    const { rows } = await c.query(`UPDATE go_order_offers SET status = 'declined', answered_at = now() WHERE order_id = $1 AND driver_id = $2 AND status = 'offered' RETURNING id`, [orderId, driverId]);
    if (!rows[0]) return { error: 'no_offer' };
    await dlog(c, orderId, 'offer_declined', driverId, {});
    return { ok: true };
  });
  if (r.ok) { await offerNext(orderId).catch(() => {}); await pushOrderChanged(orderId); }
  return r;
};

/** Предложение этому водителю на этот заказ (если действует). Вызывается внутри транзакции принятия. */
export const claimOffer = async (client, orderId, driverId) => {
  const { rows } = await client.query(`SELECT id, expires_at FROM go_order_offers WHERE order_id = $1 AND driver_id = $2 AND status = 'offered' FOR UPDATE`, [orderId, driverId]);
  if (!rows[0]) return { error: 'not_offered' };
  if (rows[0].expires_at < new Date()) return { error: 'offer_expired' };
  await client.query(`UPDATE go_order_offers SET status = 'accepted', answered_at = now() WHERE id = $1`, [rows[0].id]);
  await client.query(`UPDATE go_order_offers SET status = 'cancelled', answered_at = now() WHERE order_id = $1 AND status = 'offered'`, [orderId]);
  await dlog(client, orderId, 'offer_accepted', driverId, {});
  return { ok: true };
};

/** Предложения, ожидающие водителя сейчас. */
export const openOffersFor = async (driverId) => {
  const { rows } = await query(`SELECT order_id, expires_at, rank, reasons FROM go_order_offers WHERE driver_id = $1 AND status = 'offered' AND expires_at > now()`, [driverId]);
  return new Map(rows.map((r) => [r.order_id, { expiresAt: r.expires_at.toISOString(), secondsLeft: Math.max(0, Math.round((r.expires_at.getTime() - Date.now()) / 1000)), rank: r.rank }]));
};

/** Отозвать все действующие предложения заказа (заказ отменён / назначен вручную). Внутри транзакции. */
export const cancelOffers = (client, orderId) =>
  client.query(`UPDATE go_order_offers SET status = 'cancelled', answered_at = now() WHERE order_id = $1 AND status = 'offered'`, [orderId]);

/** Заказы «на потом»: за leadMin минут до времени начинается обычный поиск (searching + распределение). Повтор безопасен: под блокировкой заказа, статус проверяется. */
export const startScheduled = async () => {
  const { scheduleSettings } = await import('./goschedule.mjs');
  const sc = await scheduleSettings();
  const { rows } = await query(`SELECT id, kind FROM go_orders WHERE kind IN ('taxi','delivery') AND status = 'scheduled' AND scheduled_at <= now() + ($1 || ' minutes')::interval ORDER BY scheduled_at LIMIT 100`, [String(sc.leadMin)]);
  for (const r of rows) {
    const taxi = r.kind === 'taxi';
    const res = await inTx(async (c) => {
      const o = await lockOrder(c, r.id);
      if (!o || o.status !== 'scheduled') return { skipped: true };
      await setStatus(c, o, 'searching', null, taxi ? 'Подошло время: начинаем поиск водителя' : 'Подошло время: начинаем поиск курьера', { search_started_at: new Date() });
      await dlog(c, o.id, 'scheduled_start', null, { scheduledAt: o.scheduled_at?.toISOString() });
      return { ok: true, customerId: o.customer_id };
    }).catch(() => ({ skipped: true }));
    if (res.ok) {
      await notifyGo(res.customerId, r.kind, taxi ? 'Ищем водителя' : 'Ищем курьера', taxi ? 'Подошло время вашей поездки — ищем водителя.' : 'Подошло время вашей доставки — ищем курьера.', r.id, `${r.id}:sched-start`);
      await offerNext(r.id).catch(() => {});
      await pushOrderChanged(r.id);
    }
  }
};

/** Фоновая уборка: просроченные предложения → следующий кандидат; заказ без водителя слишком долго → отмена «нет водителей». */
export const sweepDispatch = async () => {
  const cfg = await dispatchSettings();
  await startScheduled();
  if (cfg.mode === 'offers') {
    const { rows } = await query(
      `SELECT DISTINCT o.id FROM go_orders o
        WHERE o.kind IN ('taxi','delivery') AND o.status = 'searching' AND o.executor_id IS NULL AND o.dispatch_state = 'offering'
          AND NOT EXISTS (SELECT 1 FROM go_order_offers f WHERE f.order_id = o.id AND f.status = 'offered' AND f.expires_at > now())
        LIMIT 200`);
    for (const r of rows) await offerNext(r.id).catch((e) => console.error('[go] распределение', e.message));
  }
  if (cfg.searchTimeoutMin > 0) {
    const { rows } = await query(
      `SELECT id FROM go_orders WHERE kind = 'taxi' AND status = 'searching' AND executor_id IS NULL AND org_id IS NULL
          AND coalesce(search_started_at, created_at) < now() - ($1 || ' minutes')::interval LIMIT 200`, [String(cfg.searchTimeoutMin)]);
    for (const r of rows) {
      const res = await inTx(async (c) => {
        const o = await lockOrder(c, r.id);
        if (!o || o.status !== 'searching' || o.executor_id) return { skipped: true };
        await cancelOffers(c, o.id);
        await setStatus(c, o, 'cancelled', null, 'Водитель не найден за отведённое время', { cancel_reason: 'no_drivers' });
        await dlog(c, o.id, 'search_timeout', null, { minutes: cfg.searchTimeoutMin });
        return { ok: true, customerId: o.customer_id };
      }).catch(() => ({ skipped: true }));
      if (res.ok) {
        await notifyGo(res.customerId, 'taxi', 'Водитель не найден', 'Свободных водителей не нашлось. Попробуйте заказать ещё раз.', r.id, `${r.id}:no_drivers`);
        await pushOrderChanged(r.id);
      }
    }
  }
};

/* ─── Диспетчер (сотрудник Sky, право go) ─────────────────────────── */

/** Ручное назначение: те же требования к водителю, что и при обычном принятии; заказ должен ещё искать водителя. */
export const manualAssign = async (adminId, orderId, driverId, note) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const why = clean(note, 200);
  if (why.length < 3) return { error: 'note_required' };
  const { canAccept } = await import('./gosubs.mjs');
  const { executorStatus } = await import('./goreg.mjs');
  const ok = await canAccept(String(driverId ?? ''), 'taxi_driver');
  if (ok.error) return { error: `driver_${ok.error}` };
  const ex = await executorStatus(driverId, 'taxi_driver');
  const r = await inTx(async (c) => {
    const o = await lockOrder(c, orderId);
    if (!o || o.kind !== 'taxi') return { error: 'not_found' };
    if (o.status !== 'searching' || o.executor_id) return { error: 'bad_state', status: o.status };
    if (o.customer_id === driverId) return { error: 'self_assign' };
    if (!ex || ex.city !== o.city) return { error: 'driver_other_city' };
    const { rows: pres } = await c.query(`SELECT online FROM go_presence WHERE profile_id = $1 AND role = 'taxi_driver'`, [driverId]);
    if (!pres[0]?.online) return { error: 'driver_offline' };
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`go:exec:${driverId}`]);
    const { rows: busy } = await c.query(`SELECT 1 FROM go_orders WHERE kind = 'taxi' AND executor_id = $1 AND status = ANY($2::text[]) LIMIT 1`, [driverId, ['assigned', 'en_route', 'arrived', 'in_ride']]);
    if (busy[0]) return { error: 'driver_busy' };
    await cancelOffers(c, orderId);
    await setStatus(c, o, 'assigned', adminId, `Назначено диспетчером: ${why}`, { executor_id: driverId, dispatch_state: 'pool' });
    await dlog(c, orderId, 'manual_assign', adminId, { driverId, note: why });
    return { ok: true, customerId: o.customer_id };
  });
  if (r.ok) {
    await logAdmin({ actorId: adminId, type: 'go_dispatch_assign', targetType: 'system', targetId: orderId, detail: `водитель ${driverId}: ${why}`.slice(0, 180) });
    await goLog(adminId, 'dispatch_assign', orderId, { driverId });
    await notifyGo(r.customerId, 'taxi', 'Водитель назначен', 'Водитель назначен на ваш заказ.', orderId, `${orderId}:assigned:${driverId}`);
    await notifyGo(driverId, 'taxi', 'Вам назначен заказ', 'Диспетчер назначил вам заказ такси.', orderId, `${orderId}:manual:${driverId}`);
    await pushOrderChanged(orderId);
  }
  return r;
};

/** Диспетчерский экран: активные заказы такси, у кого, сколько ждут, что не так. */
export const board = async (adminId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const cfg = await dispatchSettings();
  const { rows } = await query(
    `SELECT o.id, o.status, o.city, o.price_rub, o.executor_id, o.dispatch_state, o.dispatch_attempts, o.created_at, o.updated_at,
            o.data->'from'->>'address' AS from_addr, o.data->'to'->>'address' AS to_addr,
            (SELECT count(*)::int FROM go_order_offers f WHERE f.order_id = o.id) AS offers,
            (SELECT f.driver_id FROM go_order_offers f WHERE f.order_id = o.id AND f.status = 'offered' AND f.expires_at > now() LIMIT 1) AS offered_to,
            p.name AS executor_name
       FROM go_orders o LEFT JOIN profiles p ON p.id = o.executor_id
      WHERE o.kind = 'taxi' AND o.status IN ('scheduled','searching','assigned','en_route','arrived','in_ride','dispute')
      ORDER BY o.created_at LIMIT 200`);
  const now = Date.now();
  const orders = rows.map((r) => {
    const ageMin = Math.round((now - r.created_at.getTime()) / 60000);
    const idleMin = Math.round((now - r.updated_at.getTime()) / 60000);
    const flags = [];
    if (r.status === 'searching' && ageMin >= 5) flags.push('long_search');
    if (r.status === 'searching' && r.dispatch_state === 'pool') flags.push('in_pool');
    if (['assigned', 'en_route'].includes(r.status) && idleMin >= 15) flags.push('stalled');
    if (r.status === 'in_ride' && idleMin >= 120) flags.push('long_ride');
    if (r.status === 'dispute') flags.push('dispute');
    return { id: r.id, status: r.status, city: r.city, priceRub: r.price_rub, from: r.from_addr, to: r.to_addr, executorId: r.executor_id, executorName: r.executor_name,
      dispatchState: r.dispatch_state, attempts: r.dispatch_attempts, offers: r.offers, offeredTo: r.offered_to, ageMin, idleMin, flags, createdAt: r.created_at.toISOString() };
  });
  const { rows: on } = await query(`SELECT city, count(*)::int AS n FROM go_presence WHERE role = 'taxi_driver' AND online AND updated_at > now() - ($1 || ' seconds')::interval GROUP BY city`, [String(cfg.freshSec)]);
  return { mode: cfg.mode, settings: cfg, orders, problems: orders.filter((o) => o.flags.length).length, onlineDrivers: Object.fromEntries(on.map((r) => [r.city, r.n])) };
};

export const orderDispatchLog = async (adminId, orderId) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const { rows: offers } = await query(`SELECT driver_id, status, rank, score, reasons, offered_at, expires_at, answered_at FROM go_order_offers WHERE order_id = $1 ORDER BY id`, [orderId]);
  const { rows: log } = await query(`SELECT event, actor_id, detail, at FROM go_dispatch_log WHERE order_id = $1 ORDER BY id`, [orderId]);
  return { offers: offers.map((o) => ({ driverId: o.driver_id, status: o.status, rank: o.rank, score: o.score, reasons: o.reasons, offeredAt: o.offered_at.toISOString(), expiresAt: o.expires_at.toISOString(), answeredAt: o.answered_at?.toISOString() ?? null })),
    log: log.map((l) => ({ event: l.event, actorId: l.actor_id, detail: l.detail, at: l.at.toISOString() })) };
};

/** Метрики распределения за период: сколько предложений, как отвечают, как быстро находится водитель. */
export const metrics = async (adminId, hours = 24) => {
  if (!(await can(adminId, 'go'))) return { error: 'not_allowed' };
  const h = String(Math.min(24 * 30, Math.max(1, Math.round(Number(hours) || 24))));
  const { rows: of } = await query(`SELECT status, count(*)::int AS n FROM go_order_offers WHERE offered_at > now() - ($1 || ' hours')::interval GROUP BY status`, [h]);
  const byStatus = Object.fromEntries(of.map((r) => [r.status, r.n]));
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const { rows: t } = await query(`SELECT round(avg(extract(epoch FROM (answered_at - offered_at))))::int AS sec FROM go_order_offers WHERE status = 'accepted' AND offered_at > now() - ($1 || ' hours')::interval`, [h]);
  const { rows: ord } = await query(
    `SELECT count(*)::int AS created,
            count(*) FILTER (WHERE status = 'cancelled' AND cancel_reason = 'no_drivers')::int AS no_drivers,
            count(*) FILTER (WHERE dispatch_state = 'pool')::int AS pooled,
            round(avg(extract(epoch FROM (e.at - o.created_at))) FILTER (WHERE e.at IS NOT NULL))::int AS secs_to_assign
       FROM go_orders o LEFT JOIN LATERAL (SELECT at FROM go_order_events WHERE order_id = o.id AND to_status = 'assigned' ORDER BY id LIMIT 1) e ON TRUE
      WHERE o.kind = 'taxi' AND o.created_at > now() - ($1 || ' hours')::interval`, [h]);
  return { hours: Number(h), offers: { total, ...byStatus, acceptRate: total ? Math.round(((byStatus.accepted ?? 0) / total) * 100) : null, avgAnswerSec: t[0]?.sec ?? null },
    orders: { created: ord[0].created, noDrivers: ord[0].no_drivers, pooled: ord[0].pooled, avgSecondsToAssign: ord[0].secs_to_assign ?? null } };
};
