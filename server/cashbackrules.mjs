/**
 * Sky Prime: правила кэшбэка, которые настраивает администрация (право `prime`, изменения — с подтверждением личности).
 *
 * Правило = «за что» (trigger) + «сколько» (процент от суммы или фиксированные баллы) + пределы. Начисляется только баллами
 * Prime Points (`wallet.creditPointsIn`), рублей и курса «баллы → рубли» нет. Поводы:
 *   go_taxi / go_delivery / go_food / go_stay — заказ Sky GO, по подтверждённой исполнителем прямой оплате (Sky деньги не видит, поэтому есть «холд»);
 *   prime_purchase — покупка подписки Prime (процент от оплаченной суммы);  wallet_topup — пополнение кошелька через SkyKassa;
 *   market_order — завершённый заказ Sky Market (отдельно от прежних правил Market на вкладке);  tab_visit — пользование вкладкой (раз в сутки на человека).
 * Правила складываются: если на один повод подходят несколько активных, начисляется по каждому (так администрация делает «акции»).
 * Идемпотентность: UNIQUE (rule_id, ref) — один повод даёт одно начисление по правилу; пределы на человека, бюджет правила и
 * окно действия проверяются при начислении. Покупатель и исполнитель с одним Sky ID кэшбэка не получают.
 */
import crypto from 'node:crypto';
import { query, pool } from './db.mjs';
import { wallet } from './wallet.mjs';
import { hasPrime } from './skyid.mjs';
import { notifyGift } from './giftnotify.mjs';
import { logAdmin } from './adminsec.mjs';

export const TRIGGERS = {
  go_taxi: 'Заказ такси (Sky GO)', go_delivery: 'Доставка (Sky GO)', go_food: 'Еда (Sky GO)', go_stay: 'Бронь жилья (Sky GO)',
  prime_purchase: 'Покупка подписки Prime', wallet_topup: 'Пополнение кошелька (SkyKassa)', market_order: 'Заказ в Sky Market', tab_visit: 'Использование вкладки',
};
/** Вкладки, за которые можно начислять (закрытый список: клиент присылает только ключ, сервер сверяет). */
export const TABS = {
  music: 'Sky Music', film: 'Sky Film', tv: 'Sky TV', podcasts: 'Подкасты', books: 'Книги', ai: 'Sky AI', prime: 'Prime', market: 'Market', go: 'Sky GO', blox: 'Sky Blox',
  gifts: 'Подарки', family: 'Family', pulse: 'Pulse', events: 'Мероприятия', games: 'Игры', garant: 'Гарант', partners: 'Партнёры', video: 'Sky Video', together: 'Вместе', artists: 'Артисты',
};
const STATUSES = ['active', 'paused', 'ended'];
const MS_DAY = 86400000;

let cache = { at: 0, rows: [] };
const forget = () => { cache = { at: 0, rows: [] }; };
const activeRules = async () => {
  if (Date.now() - cache.at < 10000) return cache.rows;
  const { rows } = await query(`SELECT * FROM cashback_rules WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`);
  cache = { at: Date.now(), rows };
  return rows;
};

const ruleView = (r) => ({
  id: r.id, title: r.title, trigger: r.trigger, triggerLabel: TRIGGERS[r.trigger], tab: r.tab, tabLabel: r.tab ? TABS[r.tab] : null, kind: r.kind, percent: Number(r.percent), fixedPoints: r.fixed_points,
  minAmountRub: r.min_amount_rub, maxPointsEvent: r.max_points_event, perUserDayEvents: r.per_user_day_events, perUserMonthPoints: r.per_user_month_points, primeOnly: r.prime_only,
  holdDays: r.hold_days, startsAt: r.starts_at?.toISOString?.() ?? null, endsAt: r.ends_at?.toISOString?.() ?? null, budgetPoints: r.budget_points, spentPoints: r.spent_points, status: r.status,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

/** Что видят люди: только действующие правила и их условия. */
export const publicRules = async () => (await activeRules()).filter((r) => r.budget_points == null || r.spent_points < r.budget_points).map((r) => {
  const v = ruleView(r);
  return { id: v.id, title: v.title, trigger: v.trigger, triggerLabel: v.triggerLabel, tab: v.tab, tabLabel: v.tabLabel, kind: v.kind, percent: v.percent, fixedPoints: v.fixedPoints, minAmountRub: v.minAmountRub,
    maxPointsEvent: v.maxPointsEvent, perUserDayEvents: v.perUserDayEvents, primeOnly: v.primeOnly, holdDays: v.holdDays, endsAt: v.endsAt };
});

const sameAccount = async (client, a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const { rows } = await client.query('SELECT id, sky_id FROM profiles WHERE id = ANY($1::text[])', [[a, b]]);
  const x = rows.find((r) => r.id === a)?.sky_id; const y = rows.find((r) => r.id === b)?.sky_id;
  return Boolean(x && x === y);
};

/**
 * Начислить по повозу. client — открытая транзакция вызывающего (внутри неё идёт SAVEPOINT: сбой кэшбэка не ломает чужую операцию).
 * Возвращает { granted: [{ruleId, points, status}] }; любая причина отказа — просто «ничего не начислено».
 */
export const awardIn = async (client, ev) => {
  const out = { granted: [] };
  const rules = (await activeRules()).filter((r) => r.trigger === ev.trigger && (r.trigger !== 'tab_visit' || r.tab === ev.tab));
  if (!rules.length || !ev.profileId || !ev.ref) return out;
  if (ev.counterpartyId && (await sameAccount(client, ev.profileId, ev.counterpartyId))) return out;
  const prime = rules.some((r) => r.prime_only) ? await hasPrime(ev.profileId) : false;
  const amount = Math.max(0, Math.round(Number(ev.amountRub) || 0));
  for (const r of rules) {
    if (r.prime_only && !prime) continue;
    if (amount < r.min_amount_rub) continue;
    let points = r.kind === 'percent' ? Math.floor(amount * Number(r.percent) / 100) : r.fixed_points;
    points = Math.min(points, r.max_points_event);
    if (!(points > 0)) continue;
    await client.query('SAVEPOINT cb_rule');
    try {
      // Пределы на человека: события за сутки и баллы за месяц (отменённые не считаются).
      const { rows: u } = await client.query(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 day' AND status <> 'cancelled')::int AS day_n,
                COALESCE(SUM(points) FILTER (WHERE created_at >= date_trunc('month', now()) AND status <> 'cancelled'), 0)::int AS month_pts
           FROM cashback_grants WHERE rule_id = $1 AND profile_id = $2`, [r.id, ev.profileId]);
      if (r.per_user_day_events > 0 && u[0].day_n >= r.per_user_day_events) { await client.query('RELEASE SAVEPOINT cb_rule'); continue; }
      points = Math.min(points, r.per_user_month_points - u[0].month_pts);
      if (!(points > 0)) { await client.query('RELEASE SAVEPOINT cb_rule'); continue; }
      // Бюджет правила — атомарно: две одновременные операции не выйдут за предел.
      const { rowCount: okBudget } = await client.query(
        `UPDATE cashback_rules SET spent_points = spent_points + $2 WHERE id = $1 AND status = 'active' AND (budget_points IS NULL OR spent_points + $2 <= budget_points)`, [r.id, points]);
      if (!okBudget) { await client.query('RELEASE SAVEPOINT cb_rule'); continue; }
      const id = `cbg-${crypto.randomUUID()}`;
      const instant = r.hold_days === 0;
      const { rowCount } = await client.query(
        `INSERT INTO cashback_grants (id, rule_id, profile_id, trigger, ref, amount_rub, points, status, release_at, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, ${instant ? 'NULL' : "now() + ($9 || ' days')::interval"}, ${instant ? 'now()' : 'NULL'}) ON CONFLICT (rule_id, ref) DO NOTHING`,
        instant ? [id, r.id, ev.profileId, ev.trigger, ev.ref, amount, points, 'paid'] : [id, r.id, ev.profileId, ev.trigger, ev.ref, amount, points, 'pending', String(r.hold_days)]);
      if (!rowCount) { await client.query('ROLLBACK TO SAVEPOINT cb_rule'); continue; }   // уже начисляли за этот повод — бюджет возвращаем откатом
      if (instant) await wallet.creditPointsIn(client, ev.profileId, points, 'cashback', `Кэшбэк: ${r.title}`, `cbrule:${r.id}:${ev.ref}`);
      await client.query('RELEASE SAVEPOINT cb_rule');
      out.granted.push({ ruleId: r.id, title: r.title, points, status: instant ? 'paid' : 'pending' });
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT cb_rule').catch(() => {});
      console.error('[cashback] правило не применено:', e.message);
    }
  }
  return out;
};

/** То же в собственной транзакции + уведомление человеку. */
export const award = async (ev) => {
  const c = await pool.connect();
  let res = { granted: [] };
  try { await c.query('BEGIN'); res = await awardIn(c, ev); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[cashback]', e.message); } finally { c.release(); }
  await notifyGranted(ev.profileId, res.granted, ev.ref);
  return res;
};

export const notifyGranted = async (profileId, granted, ref) => {
  for (const g of granted) {
    if (g.status === 'paid') await notifyGift(profileId, 'cashback', 'Кэшбэк зачислен', `+${g.points} баллов: ${g.title}`, ref).catch(() => {});
    else await notifyGift(profileId, 'cashback', 'Кэшбэк ожидает', `+${g.points} баллов (${g.title}) придут после проверки заказа`, ref).catch(() => {});
  }
};

/** Заказ вернули/отменили — ожидающие начисления по нему отменяются (зачисленные откатывает только отдельная операция кошелька). */
export const cancelByRef = async (ref, reason) => {
  const { rowCount } = await query(
    `UPDATE cashback_grants SET status = 'cancelled', reason = $2, decided_at = now() WHERE ref = $1 AND status = 'pending'`, [String(ref), String(reason ?? '').slice(0, 160)]);
  if (rowCount) await query(`UPDATE cashback_rules r SET spent_points = GREATEST(0, spent_points - COALESCE((SELECT SUM(points) FROM cashback_grants g WHERE g.rule_id = r.id AND g.ref = $1 AND g.status = 'cancelled' AND g.reason = $2), 0)) WHERE id IN (SELECT rule_id FROM cashback_grants WHERE ref = $1)`, [String(ref), String(reason ?? '').slice(0, 160)]).catch(() => {});
  return rowCount;
};

/** Созревшие начисления (после холда) — в кошелёк. Вызывается из почасовой уборки. */
export const releaseDue = async (limit = 200) => {
  const { rows } = await query(`SELECT id FROM cashback_grants WHERE status = 'pending' AND release_at <= now() ORDER BY release_at LIMIT $1`, [limit]);
  let paid = 0;
  for (const { id } of rows) {
    const c = await pool.connect(); let note = null;
    try {
      await c.query('BEGIN');
      const { rows: r } = await c.query(`SELECT g.*, u.title FROM cashback_grants g JOIN cashback_rules u ON u.id = g.rule_id WHERE g.id = $1 AND g.status = 'pending' FOR UPDATE OF g SKIP LOCKED`, [id]);
      if (!r[0]) { await c.query('ROLLBACK'); continue; }
      await wallet.creditPointsIn(c, r[0].profile_id, r[0].points, 'cashback', `Кэшбэк: ${r[0].title}`, `cbrule:${r[0].rule_id}:${r[0].ref}`);
      await c.query(`UPDATE cashback_grants SET status = 'paid', decided_at = now() WHERE id = $1`, [id]);
      await c.query('COMMIT'); paid += 1; note = r[0];
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); console.error('[cashback] не зачислено:', e.message); } finally { c.release(); }
    if (note) await notifyGift(note.profile_id, 'cashback', 'Кэшбэк зачислен', `+${note.points} баллов: ${note.title}`, note.ref).catch(() => {});
  }
  return paid;
};

/** Вкладка открыта и использовалась: раз в сутки на человека и правило (пределы — в самом правиле). Повод — только из закрытого списка. */
export const tabVisit = async (profileId, tab) => {
  if (!Object.hasOwn(TABS, String(tab))) return { error: 'bad_tab' };
  const day = new Date().toISOString().slice(0, 10);
  const r = await award({ trigger: 'tab_visit', tab, profileId, amountRub: 0, ref: `tab:${tab}:${profileId}:${day}` });
  return { ok: true, granted: r.granted.map((g) => ({ points: g.points, title: g.title, status: g.status })) };
};

/* ─── Администрация ─── */
const num = (v, lo, hi, def = null) => { if (v === '' || v == null) return def; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN; };

const parse = (b) => {
  const title = String(b?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100); if (title.length < 3) return { error: 'bad_field', field: 'title' };
  const trigger = String(b?.trigger ?? ''); if (!Object.hasOwn(TRIGGERS, trigger)) return { error: 'bad_field', field: 'trigger' };
  let tab = null;
  if (trigger === 'tab_visit') { tab = String(b?.tab ?? ''); if (!Object.hasOwn(TABS, tab)) return { error: 'bad_field', field: 'tab' }; }
  const kind = b?.kind === 'fixed' ? 'fixed' : b?.kind === 'percent' ? 'percent' : null; if (!kind) return { error: 'bad_field', field: 'kind' };
  if (trigger === 'tab_visit' && kind !== 'fixed') return { error: 'bad_field', field: 'kind' };   // у вкладки нет суммы
  const percent = kind === 'percent' ? num(b?.percent, 0.01, 100) : 0; if (Number.isNaN(percent) || (kind === 'percent' && !percent)) return { error: 'bad_field', field: 'percent' };
  const fixed = kind === 'fixed' ? num(b?.fixedPoints, 1, 100000) : 0; if (Number.isNaN(fixed) || (kind === 'fixed' && !fixed)) return { error: 'bad_field', field: 'fixedPoints' };
  const minAmount = num(b?.minAmountRub, 0, 10_000_000, 0); const maxEvent = num(b?.maxPointsEvent, 1, 1_000_000, 500);
  const dayEvents = num(b?.perUserDayEvents, 0, 1000, trigger === 'tab_visit' ? 1 : 0); const monthPts = num(b?.perUserMonthPoints, 1, 10_000_000, 5000);
  const hold = num(b?.holdDays, 0, 60, trigger === 'tab_visit' ? 0 : 3); const budget = num(b?.budgetPoints, 1, 1_000_000_000, null);
  for (const [f, v] of [['minAmountRub', minAmount], ['maxPointsEvent', maxEvent], ['perUserDayEvents', dayEvents], ['perUserMonthPoints', monthPts], ['holdDays', hold], ['budgetPoints', budget]]) if (Number.isNaN(v)) return { error: 'bad_field', field: f };
  if (trigger === 'tab_visit' && dayEvents !== 1) return { error: 'bad_field', field: 'perUserDayEvents' };   // вкладка — не чаще раза в сутки
  const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? NaN : d; };
  const startsAt = date(b?.startsAt); const endsAt = date(b?.endsAt);
  if (Number.isNaN(startsAt)) return { error: 'bad_field', field: 'startsAt' }; if (Number.isNaN(endsAt)) return { error: 'bad_field', field: 'endsAt' };
  if (startsAt && endsAt && endsAt <= startsAt) return { error: 'bad_field', field: 'endsAt' };
  const status = STATUSES.includes(b?.status) ? b.status : 'paused';
  return { v: { title, trigger, tab, kind, percent, fixed, minAmount, maxEvent, dayEvents, monthPts, primeOnly: b?.primeOnly === true, hold, startsAt, endsAt, budget, status } };
};

export const adminList = async () => {
  const { rows } = await query('SELECT * FROM cashback_rules ORDER BY (status = \'active\') DESC, created_at DESC');
  const { rows: tot } = await query(`SELECT rule_id, status, COALESCE(SUM(points),0)::int AS points, count(*)::int AS n FROM cashback_grants GROUP BY rule_id, status`);
  return { rules: rows.map((r) => ({ ...ruleView(r), grants: Object.fromEntries(tot.filter((t) => t.rule_id === r.id).map((t) => [t.status, { points: t.points, count: t.n }])) })),
    meta: { triggers: Object.entries(TRIGGERS).map(([k, l]) => ({ key: k, label: l })), tabs: Object.entries(TABS).map(([k, l]) => ({ key: k, label: l })) } };
};

export const adminSave = async (actorId, body, id = null) => {
  const p = parse(body); if (p.error) return p;
  const v = p.v; const rid = id ?? `cbr-${crypto.randomUUID()}`;
  if (id) {
    const { rows } = await query('SELECT spent_points FROM cashback_rules WHERE id = $1', [id]);
    if (!rows[0]) return { error: 'not_found' };
    if (v.budget != null && v.budget < rows[0].spent_points) return { error: 'bad_field', field: 'budgetPoints' };
    await query(`UPDATE cashback_rules SET title=$2, trigger=$3, tab=$4, kind=$5, percent=$6, fixed_points=$7, min_amount_rub=$8, max_points_event=$9, per_user_day_events=$10, per_user_month_points=$11, prime_only=$12, hold_days=$13, starts_at=$14, ends_at=$15, budget_points=$16, status=$17, updated_by=$18, updated_at=now() WHERE id=$1`,
      [id, v.title, v.trigger, v.tab, v.kind, v.percent, v.fixed, v.minAmount, v.maxEvent, v.dayEvents, v.monthPts, v.primeOnly, v.hold, v.startsAt, v.endsAt, v.budget, v.status, actorId]);
  } else {
    await query(`INSERT INTO cashback_rules (id, title, trigger, tab, kind, percent, fixed_points, min_amount_rub, max_points_event, per_user_day_events, per_user_month_points, prime_only, hold_days, starts_at, ends_at, budget_points, status, created_by, updated_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)`,
      [rid, v.title, v.trigger, v.tab, v.kind, v.percent, v.fixed, v.minAmount, v.maxEvent, v.dayEvents, v.monthPts, v.primeOnly, v.hold, v.startsAt, v.endsAt, v.budget, v.status, actorId]);
  }
  forget();
  await logAdmin({ actorId, targetType: 'prime', type: 'cashback_rule', targetId: rid, detail: `${id ? 'изменено' : 'создано'}: ${v.title} · ${TRIGGERS[v.trigger]}${v.tab ? ` / ${TABS[v.tab]}` : ''} · ${v.kind === 'percent' ? `${v.percent}%` : `${v.fixed} б.`} · ${v.status}`.slice(0, 220) });
  return { ok: true, id: rid };
};

export const adminSetStatus = async (actorId, id, status) => {
  if (!STATUSES.includes(status)) return { error: 'bad_field', field: 'status' };
  const { rows } = await query('SELECT status, title FROM cashback_rules WHERE id = $1', [id]);
  if (!rows[0]) return { error: 'not_found' };
  if (rows[0].status === 'ended' && status !== 'ended') return { error: 'rule_ended' };
  await query('UPDATE cashback_rules SET status = $2, updated_by = $3, updated_at = now() WHERE id = $1', [id, status, actorId]);
  forget();
  await logAdmin({ actorId, targetType: 'prime', type: 'cashback_rule', targetId: id, detail: `${rows[0].title}: ${rows[0].status} → ${status}`.slice(0, 220) });
  return { ok: true };
};

export const adminGrants = async (ruleId, limit = 100) => {
  const { rows } = await query(
    `SELECT g.*, p.username FROM cashback_grants g LEFT JOIN profiles p ON p.id = g.profile_id WHERE ($1 = '' OR g.rule_id = $1) ORDER BY g.created_at DESC LIMIT $2`, [String(ruleId ?? ''), Math.min(200, Math.max(1, limit))]);
  return { items: rows.map((g) => ({ id: g.id, ruleId: g.rule_id, user: g.username, trigger: g.trigger, ref: g.ref, amountRub: g.amount_rub, points: g.points, status: g.status, releaseAt: g.release_at, reason: g.reason, createdAt: g.created_at })) };
};

export const myGrants = async (profileId) => {
  const { rows } = await query(`SELECT g.id, g.points, g.status, g.release_at, g.created_at, r.title FROM cashback_grants g JOIN cashback_rules r ON r.id = g.rule_id WHERE g.profile_id = $1 ORDER BY g.created_at DESC LIMIT 30`, [profileId]);
  return rows.map((g) => ({ id: g.id, title: g.title, points: g.points, status: g.status, releaseAt: g.release_at, createdAt: g.created_at }));
};
