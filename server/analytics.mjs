/**
 * Мониторинг и аналитика платформы — только реальные данные.
 *
 * Откуда что берётся:
 *  · онлайн сейчас — живые WebSocket-соединения (источник регистрирует
 *    signal.mjs); история — замеры раз в минуту в metrics_online;
 *  · активные за день — те, кто подключался в этот день (metrics_active_users);
 *    раньше запуска сбора этих данных не существует, и интерфейс так и
 *    говорит, а не рисует задним числом;
 *  · регистрации — profiles.created_at;
 *  · сделки — Sky Garant (garant_deals) и заказы Sky Market (market_orders);
 *  · покупки — списания в кошельке (wallet_transactions, сумма < 0) и
 *    покупки в Sky Blox; рубли и баллы считаются отдельно, курса нет;
 *  · состояние сервера — измерения процесса и базы (bloxlimits.collectMetrics).
 * Выдуманных чисел нет: чего измерить нельзя, того в ответе нет.
 */
import { query } from './db.mjs';
import { collectMetrics, warningsFor } from './bloxlimits.mjs';

let onlineSource = () => ({ users: 0, sessions: 0 });
export const setOnlineSource = (fn) => { onlineSource = fn; };
export const onlineNow = () => onlineSource();

/* ─── Активные за день ───────────────────────────────────────────────── */

const pendingActive = new Set();
export const markActive = (userId) => { if (userId) pendingActive.add(String(userId)); };

const flushActive = async () => {
  if (pendingActive.size === 0) return;
  const ids = [...pendingActive]; pendingActive.clear();
  await query(
    `INSERT INTO metrics_active_users (day, user_id) SELECT current_date, x FROM unnest($1::text[]) x ON CONFLICT DO NOTHING`, [ids]);
};

/** Замер раз в минуту: онлайн сейчас и накопленные «активные». */
export const sampleOnce = async () => {
  const o = onlineSource();
  await query('INSERT INTO metrics_online (ts, users, sessions) VALUES (now(), $1, $2) ON CONFLICT (ts) DO NOTHING', [o.users, o.sessions]);
  await flushActive();
  // Старше 40 дней замеры не нужны.
  await query(`DELETE FROM metrics_online WHERE ts < now() - interval '40 days'`);
  await query(`DELETE FROM metrics_active_users WHERE day < current_date - 400`);
};

/* ─── Сводка ─────────────────────────────────────────────────────────── */

const RUB_TYPES = ['prime', 'market', 'music', 'market_subscription', 'market_promotion', 'pvz_subscription', 'nft_purchase',
  'skin_purchase', 'ads', 'garant_subscription', 'family_prime', 'prime_gift', 'stream_donation'];
const POINT_TYPES = ['blox_purchase', 'points_spend'];

const cache = new Map();
const cached = async (key, ttlMs, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
};

const num = (v) => Number(v ?? 0);

const dayRows = (rows) => rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'day').map(([k, v]) => [k, num(v)])) }));

export const overview = async (daysRaw) => {
  const days = [7, 30, 90].includes(Number(daysRaw)) ? Number(daysRaw) : 7;
  return cached(`ov:${days}`, 30_000, async () => {
    const since = `(current_date - ${days - 1})`;
    const prevSince = `(current_date - ${days * 2 - 1})`;
    const series = `(SELECT x::date AS d FROM generate_series(${since}, current_date, interval '1 day') x) ds`;

    const [tot, regs, regsPrev, regDays, prime] = await Promise.all([
      query('SELECT count(*)::int AS n FROM profiles'),
      query(`SELECT count(*)::int AS n FROM profiles WHERE created_at >= ${since}`),
      query(`SELECT count(*)::int AS n FROM profiles WHERE created_at >= ${prevSince} AND created_at < ${since}`),
      query(`SELECT d AS day, count(p.id)::int AS n FROM ${series} LEFT JOIN profiles p ON p.created_at::date = d GROUP BY d ORDER BY d`),
      query(`SELECT count(*)::int AS n FROM prime_subscriptions WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())`),
    ]);

    const [dau, dauToday, collectedSince] = await Promise.all([
      query(`SELECT d AS day, count(a.user_id)::int AS n FROM ${series} LEFT JOIN metrics_active_users a ON a.day = d GROUP BY d ORDER BY d`),
      query('SELECT count(*)::int AS n FROM metrics_active_users WHERE day = current_date'),
      query('SELECT min(ts) AS t FROM metrics_online'),
    ]);

    const [peak, avg, onlineSeries] = await Promise.all([
      query(`SELECT coalesce(max(users),0)::int AS n FROM metrics_online WHERE ts > now() - interval '24 hours'`),
      query(`SELECT coalesce(round(avg(users)),0)::int AS n FROM metrics_online WHERE ts > now() - interval '24 hours'`),
      query(`SELECT date_bin('15 minutes', ts, TIMESTAMPTZ '2000-01-01') AS ts, round(avg(users))::int AS avg, max(users)::int AS max
               FROM metrics_online WHERE ts > now() - interval '24 hours' GROUP BY 1 ORDER BY 1`),
    ]);

    const [garant, garantPrev, garantDays, market, marketPrev, marketDays] = await Promise.all([
      query(`SELECT count(*)::int AS created, count(*) FILTER (WHERE status = 'completed')::int AS completed,
                    count(*) FILTER (WHERE status = 'disputed')::int AS disputed, coalesce(sum(price) FILTER (WHERE status = 'completed'),0)::bigint AS volume
               FROM garant_deals WHERE created_at >= ${since}`),
      query(`SELECT count(*)::int AS created FROM garant_deals WHERE created_at >= ${prevSince} AND created_at < ${since}`),
      query(`SELECT d AS day, count(g.id)::int AS created FROM ${series} LEFT JOIN garant_deals g ON g.created_at::date = d GROUP BY d ORDER BY d`),
      query(`SELECT count(*)::int AS created, count(*) FILTER (WHERE status = 'completed')::int AS completed,
                    count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
                    coalesce(sum(total_kop) FILTER (WHERE status = 'completed'),0)::bigint AS volume_kop
               FROM market_orders WHERE created_at >= ${since}`),
      query(`SELECT count(*)::int AS created FROM market_orders WHERE created_at >= ${prevSince} AND created_at < ${since}`),
      query(`SELECT d AS day, count(o.id)::int AS created FROM ${series} LEFT JOIN market_orders o ON o.created_at::date = d GROUP BY d ORDER BY d`),
    ]);

    const [purch, purchPrev, byType, purchDays] = await Promise.all([
      query(`SELECT count(*) FILTER (WHERE type = ANY($1))::int AS rub_count, coalesce(sum(-amount) FILTER (WHERE type = ANY($1)),0)::bigint AS rub_sum,
                    count(*) FILTER (WHERE type = ANY($2))::int AS pt_count, coalesce(sum(-amount) FILTER (WHERE type = ANY($2)),0)::bigint AS pt_sum
               FROM wallet_transactions WHERE amount < 0 AND created_at >= ${since}`, [RUB_TYPES, POINT_TYPES]),
      query(`SELECT count(*)::int AS n FROM wallet_transactions WHERE amount < 0 AND type = ANY($1) AND created_at >= ${prevSince} AND created_at < ${since}`, [[...RUB_TYPES, ...POINT_TYPES]]),
      query(`SELECT type, count(*)::int AS n, coalesce(sum(-amount),0)::bigint AS sum FROM wallet_transactions
              WHERE amount < 0 AND type = ANY($1) AND created_at >= ${since} GROUP BY type ORDER BY n DESC`, [[...RUB_TYPES, ...POINT_TYPES]]),
      query(`SELECT d AS day, count(t.id)::int AS n FROM ${series}
               LEFT JOIN wallet_transactions t ON t.created_at::date = d AND t.amount < 0 AND t.type = ANY($1) GROUP BY d ORDER BY d`, [[...RUB_TYPES, ...POINT_TYPES]]),
    ]);

    const o = onlineSource();
    const g = garant.rows[0]; const m = market.rows[0]; const p = purch.rows[0];
    return {
      days, generatedAt: new Date().toISOString(),
      collectingSince: collectedSince.rows[0]?.t?.toISOString?.() ?? null,
      online: {
        now: o.users, sessions: o.sessions, peak24h: num(peak.rows[0].n), avg24h: num(avg.rows[0].n),
        series: onlineSeries.rows.map((r) => ({ ts: r.ts.toISOString(), avg: num(r.avg), max: num(r.max) })),
      },
      users: {
        total: num(tot.rows[0].n), newInPeriod: num(regs.rows[0].n), newPrevPeriod: num(regsPrev.rows[0].n),
        prime: num(prime.rows[0].n), activeToday: num(dauToday.rows[0].n),
        registrationsPerDay: dayRows(regDays.rows), activePerDay: dayRows(dau.rows),
      },
      deals: {
        garant: { created: num(g.created), completed: num(g.completed), disputed: num(g.disputed), volume: num(g.volume), createdPrev: num(garantPrev.rows[0].created) },
        market: { created: num(m.created), completed: num(m.completed), cancelled: num(m.cancelled), volume: num(m.volume_kop) / 100, createdPrev: num(marketPrev.rows[0].created) },
        garantPerDay: dayRows(garantDays.rows), marketPerDay: dayRows(marketDays.rows),
      },
      purchases: {
        count: num(p.rub_count) + num(p.pt_count), rubCount: num(p.rub_count), rubSum: num(p.rub_sum), pointsCount: num(p.pt_count), pointsSum: num(p.pt_sum),
        countPrev: num(purchPrev.rows[0].n),
        byType: byType.rows.map((r) => ({ type: r.type, count: num(r.n), sum: num(r.sum), unit: POINT_TYPES.includes(r.type) ? 'points' : 'rub' })),
        perDay: dayRows(purchDays.rows),
      },
    };
  });
};

/** Живые показатели: онлайн сейчас и состояние сервера. */
export const live = async () => cached('live', 3000, async () => {
  const metrics = await collectMetrics();
  return { at: new Date().toISOString(), online: onlineSource(), metrics, warnings: warningsFor(metrics) };
});
