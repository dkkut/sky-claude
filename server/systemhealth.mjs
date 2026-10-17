/**
 * Состояние систем Sky — единый раздел админки (только чтение, право `analytics`).
 *
 * Каждый блок считается независимо и защищён `safe()`: сбой одного запроса показывается в блоке как ошибка,
 * а не роняет остальные. Только агрегаты и идентификаторы видов событий — без секретов, ключей,
 * содержимого сообщений, адресов и почт людей. Выдуманных цифр нет: чего сервер не знает — `null`.
 */
import { query } from './db.mjs';
import { can } from './admin.mjs';
import * as aiusage from './aiusage.mjs';
import { loadSettings as primeSettings } from './primecashback.mjs';
import { giftsHealth } from './giftshealth.mjs';
import { stats as storageStats } from './skystorageindex.mjs';
import { snapshot as storageState } from './skystoragestate.mjs';
import { status as primaryStatus } from './skystorageprimary.mjs';
import { reconcileLedger } from './wallet.mjs';

const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: String(e?.message ?? e).slice(0, 120) }; } };
const n = (v) => Number(v ?? 0);
const one = async (sql, args) => (await query(sql, args)).rows[0] ?? {};

const security = async () => {
  const [acc, frozen, blocked, pinLocked, crit, sshReq, sshState, conn, backups] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE two_factor_enabled)::int AS two_factor,
                count(*) FILTER (WHERE email_verified)::int AS email_verified,
                count(*) FILTER (WHERE ip_pin_enabled)::int AS ip_pin FROM sky_ids`),
    one(`SELECT count(*)::int AS n FROM sky_ids WHERE login_frozen_until > now()`),
    one(`SELECT count(*)::int AS n FROM account_freeze_log WHERE kind = 'blocked_login' AND created_at > now() - interval '7 days'`),
    one(`SELECT count(*)::int AS n FROM sky_ids WHERE ip_pin_locked_until > now()`),
    query(`SELECT at, level, kind FROM storage_events WHERE level IN ('critical','warn') AND at > now() - interval '7 days' ORDER BY at DESC LIMIT 10`),
    query(`SELECT status, count(*)::int AS n FROM ssh_gate_requests WHERE created_at > now() - interval '7 days' GROUP BY status`),
    one(`SELECT paused, reason, set_at FROM ssh_gate_state WHERE id`),
    query(`SELECT status, count(*)::int AS n FROM storage_connections WHERE created_at > now() - interval '7 days' GROUP BY status`),
    query(`SELECT status, count(*)::int AS n, max(finished_at) AS last FROM storage_backups WHERE started_at > now() - interval '7 days' GROUP BY status`),
  ]);
  const st = storageState();
  const stor = await safe(() => storageStats());
  const lastGood = await one(`SELECT max(finished_at) AS at FROM storage_backups WHERE status IN ('ok','verified')`);
  const lastVerified = await one(`SELECT max(verified_at) AS at FROM storage_backups WHERE status = 'verified'`);
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const ssh = by(sshReq.rows); const cn = by(conn.rows); const bk = by(backups.rows);
  const warnings = [];
  if (acc.total && acc.two_factor / acc.total < 0.1) warnings.push({ level: 'info', text: 'Двухэтапная защита включена менее чем у 10 % аккаунтов' });
  if (sshState.paused) warnings.push({ level: 'warn', text: 'SSH: новые входы приостановлены' });
  if (st?.emergency?.active) warnings.push({ level: 'critical', text: 'Хранилище: аварийное отключение' });
  if (st?.maintenance?.active) warnings.push({ level: 'warn', text: 'Хранилище: технические работы' });
  if (stor?.capacity && ['critical', 'block', 'full'].includes(stor.capacity.level)) warnings.push({ level: 'critical', text: `Хранилище заполнено на ${stor.capacity.pct} %` });
  if (!lastGood.at) warnings.push({ level: 'warn', text: 'Резервных копий ещё не было' });
  else if (Date.now() - new Date(lastGood.at).getTime() > 3 * 86_400_000) warnings.push({ level: 'warn', text: 'Последняя успешная копия старше 3 суток' });
  if ((bk.failed ?? 0) + (bk.corrupt ?? 0) > 0) warnings.push({ level: 'critical', text: 'За 7 дней были неудавшиеся или повреждённые копии' });
  if ((ssh.exhausted ?? 0) > 0) warnings.push({ level: 'warn', text: `SSH: исчерпаны попытки подтверждения (${ssh.exhausted} за 7 дней)` });
  return {
    accounts: { total: acc.total, twoFactor: acc.two_factor, emailVerified: acc.email_verified, ipPin: acc.ip_pin, frozenNow: frozen.n, pinLockedNow: pinLocked.n },
    suspicious: { blockedLogins7d: blocked.n, pinLockedNow: pinLocked.n },
    criticalEvents: crit.rows.map((r) => ({ at: r.at, level: r.level, kind: r.kind })),
    ssh: { paused: Boolean(sshState.paused), pausedAt: sshState.set_at ?? null, requests7d: ssh },
    storage: {
      emergency: Boolean(st?.emergency?.active), maintenance: Boolean(st?.maintenance?.active),
      capacity: stor?.capacity ? { pct: stor.capacity.pct, level: stor.capacity.level, used: stor.capacity.used, total: stor.capacity.total, source: stor.capacity.source } : null,
      primary: primaryStatus(), quarantineHeld: stor?.quarantine?.held ?? null, error: stor?.error ?? null,
    },
    confirmationErrors: { sshDenied7d: ssh.denied ?? 0, sshExhausted7d: ssh.exhausted ?? 0, storageDenied7d: (cn.denied ?? 0) + (cn.expired ?? 0) },
    backups: { last7d: bk, lastGoodAt: lastGood.at ?? null, lastVerifiedAt: lastVerified.at ?? null },
    warnings,
  };
};

const ai = async () => {
  const o = await aiusage.overview(7);
  return {
    chat: { configured: o.chat.configured, provider: o.chat.provider, model: o.chat.model },
    stt: { configured: o.stt.configured, provider: o.stt.provider },
    quotaKnown: o.providerQuota?.known === true,
    spend: o.spend, errors15m: o.health.recentErrors15m, lastErrorAt: o.health.lastErrorAt,
    requests7d: o.series.reduce((s, r) => s + r.requests, 0), errors7d: o.series.reduce((s, r) => s + r.errors, 0),
    blockWhenExhausted: o.settings.blockWhenExhausted,
  };
};

const prime = async () => {
  const [members, cb, pend, rewards, red, cancelled, set] = await Promise.all([
    one(`SELECT count(DISTINCT profile_id)::int AS n FROM prime_subscriptions WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())`),
    one(`SELECT coalesce(sum(points) FILTER (WHERE status='paid'),0)::bigint AS paid, count(*) FILTER (WHERE status='paid')::int AS paid_n,
                coalesce(sum(points) FILTER (WHERE status='paid' AND decided_at > date_trunc('month', now())),0)::bigint AS paid_month FROM prime_cashback`),
    one(`SELECT count(*)::int AS n, coalesce(sum(points),0)::bigint AS pts, count(*) FILTER (WHERE release_at < now())::int AS overdue FROM prime_cashback WHERE status = 'pending'`),
    one(`SELECT count(*) FILTER (WHERE active)::int AS active, count(*)::int AS total,
                count(*) FILTER (WHERE active AND stock IS NOT NULL AND stock <= 0)::int AS sold_out FROM prime_rewards`),
    query(`SELECT status, count(*)::int AS n FROM prime_redemptions WHERE created_at > now() - interval '30 days' GROUP BY status`),
    one(`SELECT count(*)::int AS n FROM prime_cashback WHERE status = 'cancelled' AND decided_at > now() - interval '30 days'`),
    primeSettings(),
  ]);
  const rd = Object.fromEntries(red.rows.map((r) => [r.status, r.n]));
  return {
    members: members.n,
    cashback: { enabled: set.enabled === true, paidPoints: n(cb.paid), paidCount: cb.paid_n, paidThisMonth: n(cb.paid_month),
      pendingCount: pend.n, pendingPoints: n(pend.pts), overdue: pend.overdue, cancelled30d: cancelled.n,
      monthlyCapPerPerson: set.maxPointsPerMonth ?? null, holdDays: set.holdDays ?? null },
    rewards: { active: rewards.active, total: rewards.total, soldOut: rewards.sold_out, redemptions30d: rd },
    suspicious: { cancelledCashback30d: cancelled.n, failedRedemptions30d: (rd.failed_refunded ?? 0) },
  };
};

const gifts = async () => {
  const h = await giftsHealth();
  const g = await one(`SELECT count(*)::int AS n FROM gift_orders`).catch(() => ({ n: null }));
  const recent = await query(`SELECT created_at, amount FROM wallet_transactions WHERE type = 'nft_purchase' ORDER BY created_at DESC LIMIT 5`).catch(() => ({ rows: [] }));
  return {
    catalog: h.catalog, ordersByStatus: h.orders.byStatus, ordersTotal: g.n,
    nft: { materialized: h.nft.materialized, mint: h.nft.mint, realOwners: h.nft.realOwners, purchases7d: h.nft.purchases7d },
    problems: { demoOwners: h.nft.demoOwners.length, unknownOwners: h.nft.unknownOwners.length, staleListings: h.nft.staleListings.length,
      paidNotDelivered: h.nft.paidNotDelivered.length, stuckOrders: h.orders.stuck.length },
    recentPurchases: recent.rows.map((r) => ({ at: r.created_at, rub: -n(r.amount) })),
  };
};

const partners = async () => {
  const [by, expiring, offers] = await Promise.all([
    query(`SELECT status, count(*)::int AS n FROM partners GROUP BY status`),
    one(`SELECT count(*)::int AS n FROM partners WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= current_date + 14`),
    one(`SELECT count(*)::int AS n FROM partners p, jsonb_array_elements(p.offers) o
          WHERE p.status = 'active' AND (o->>'endsAt') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (o->>'endsAt')::date BETWEEN current_date AND current_date + 14`),
  ]);
  const s = Object.fromEntries(by.rows.map((r) => [r.status, r.n]));
  return { active: s.active ?? 0, review: s.review ?? 0, suspended: s.suspended ?? 0, draft: s.draft ?? 0, archive: s.archive ?? 0,
    expiringPartners14d: expiring.n, expiringOffers14d: offers.n };
};

const walletLedger = async () => {
  const r = await reconcileLedger({ maxAgeMs: 10 * 60_000 });
  return { accounts: r.accounts, checked: r.checked, unchecked: r.unchecked, driftRub: r.driftRubCount, driftPts: r.driftPtsCount, at: r.at };
};

export const systemHealth = async (adminId) => {
  if (!(await can(adminId, 'analytics'))) return null;
  const [sec, a, p, g, pt, wl] = await Promise.all([safe(security), safe(ai), safe(prime), safe(gifts), safe(partners), safe(walletLedger)]);
  return { at: new Date().toISOString(), security: sec, ai: a, prime: p, gifts: g, partners: pt, walletLedger: wl };
};
