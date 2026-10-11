/**
 * Sky GO — недельная активация кабинетов.
 *
 * Тарифы лежат в go_tariffs (правит администрация), привязка «кабинет → тариф» — в go_role_tariff:
 * у кабинета ровно один тариф, поэтому общая активация и специальный тариф не складываются.
 * Подписка действует с подтверждённой оплаты (списание с кошелька Sky в одной транзакции со строкой подписки);
 * автосписания нет. Истёкшая подписка закрывает ТОЛЬКО приём новых заказов: история, статистика и
 * уже принятые заказы остаются доступны.
 */
import { query } from './db.mjs';
import { wallet } from './wallet.mjs';
import { newId, inTx, goLog, notifyGo, ROLES } from './gocore.mjs';

export const tariffs = async () => {
  const { rows } = await query('SELECT code, title, price_rub, period_days FROM go_tariffs ORDER BY code');
  const { rows: map } = await query('SELECT role, tariff_code FROM go_role_tariff');
  return { tariffs: rows.map((t) => ({ code: t.code, title: t.title, priceRub: t.price_rub, periodDays: t.period_days })),
    roleTariff: Object.fromEntries(map.map((m) => [m.role, m.tariff_code])) };
};

export const tariffFor = async (role) => {
  const { rows } = await query(
    `SELECT t.code, t.title, t.price_rub, t.period_days FROM go_role_tariff r JOIN go_tariffs t ON t.code = r.tariff_code WHERE r.role = $1`, [role]);
  return rows[0] ? { code: rows[0].code, title: rows[0].title, priceRub: rows[0].price_rub, periodDays: rows[0].period_days } : null;
};

export const subscriptionState = async (profileId, role) => {
  const { rows } = await query(
    `SELECT tariff_code, expires_at, started_at FROM go_subscriptions WHERE profile_id = $1 AND role = $2 ORDER BY expires_at DESC LIMIT 1`, [profileId, role]);
  const r = rows[0];
  const t = await tariffFor(role);
  const active = Boolean(r && r.expires_at > new Date());
  return { role, active, expiresAt: r?.expires_at?.toISOString?.() ?? null, tariff: t, expired: Boolean(r) && !active };
};

export const subscriptionHistory = async (profileId, role) => {
  const { rows } = await query(
    `SELECT id, tariff_code, price_rub, started_at, expires_at FROM go_subscriptions WHERE profile_id = $1 AND role = $2 ORDER BY created_at DESC LIMIT 50`, [profileId, role]);
  return rows.map((r) => ({ id: r.id, tariff: r.tariff_code, priceRub: r.price_rub, startedAt: r.started_at.toISOString(), expiresAt: r.expires_at.toISOString() }));
};

/** Оплата/продление: только для одобренного исполнителя, цена с сервера, продление от текущей даты окончания. */
export const buy = async (profileId, role, idemKey) => {
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const key = String(idemKey ?? '').slice(0, 64) || newId('idem');
  const res = await inTx(async (c) => {
    const { rows: ex } = await c.query('SELECT id, status FROM go_executors WHERE profile_id = $1 AND role = $2 FOR UPDATE', [profileId, role]);
    if (!ex[0]) return { error: 'not_registered' };
    if (ex[0].status !== 'approved') return { error: 'not_approved', status: ex[0].status };
    const { rows: dup } = await c.query('SELECT expires_at FROM go_subscriptions WHERE profile_id = $1 AND role = $2 AND payment_ref = $3', [profileId, role, key]);
    if (dup[0]) return { ok: true, duplicate: true, expiresAt: dup[0].expires_at.toISOString() };
    const t = await tariffFor(role);
    if (!t) return { error: 'no_tariff' };
    const { rows: cur } = await c.query('SELECT max(expires_at) AS until FROM go_subscriptions WHERE profile_id = $1 AND role = $2', [profileId, role]);
    const now = new Date();
    const startsAt = cur[0].until && cur[0].until > now ? cur[0].until : now;
    const expires = new Date(startsAt.getTime() + t.periodDays * 86_400_000);
    if (t.priceRub > 0) {
      const spent = await wallet.spendIn(c, profileId, t.priceRub, 'go_sub', `Sky GO: ${t.title}, ${t.periodDays} дн.`, `go:${role}`);
      if (spent.error) return { error: spent.error, balance: spent.balance };
    }
    await c.query(
      `INSERT INTO go_subscriptions (id, profile_id, role, tariff_code, price_rub, started_at, expires_at, payment_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [newId('gsub'), profileId, role, t.code, t.priceRub, startsAt, expires, key]);
    return { ok: true, expiresAt: expires.toISOString(), priceRub: t.priceRub, tariff: t.code };
  });
  if (res.ok && !res.duplicate) {
    await goLog(profileId, 'sub_buy', role, { price: res.priceRub, tariff: res.tariff });
    await notifyGo(profileId, 'subscription', 'Кабинет активирован', `Доступ к заказам открыт до ${new Date(res.expiresAt).toLocaleString('ru-RU')}.`, `sub:${role}`);
  }
  return res;
};

/**
 * Может ли исполнитель принимать НОВЫЕ заказы: одобрен + подписка действует + (для водителя и курьера) заданы реквизиты.
 * Возвращает { ok } или { error } — клиент объясняет причину человеку.
 */
export const canAccept = async (profileId, role) => {
  const { rows } = await query('SELECT status, data_enc FROM go_executors WHERE profile_id = $1 AND role = $2', [profileId, role]);
  if (!rows[0]) return { error: 'not_registered' };
  if (rows[0].status !== 'approved') return { error: 'not_approved', status: rows[0].status };
  const sub = await subscriptionState(profileId, role);
  if (!sub.active) return { error: 'subscription_required', expired: sub.expired };
  const { rows: pay } = await query('SELECT 1 FROM go_pay_details WHERE profile_id = $1', [profileId]);
  if (!pay[0]) return { error: 'pay_details_required' };
  return { ok: true };
};

/** Просроченные подписки уходят с линии: следующая уборка. */
export const sweepExpired = async () => {
  await query(
    `UPDATE go_presence p SET online = FALSE, updated_at = now()
      WHERE p.online AND NOT EXISTS (
        SELECT 1 FROM go_subscriptions s WHERE s.profile_id = p.profile_id AND s.role = p.role AND s.expires_at > now())`);
};

/** Выход на линию / уход с линии (водитель и курьер). Выйти может только тот, кто может принимать заказы. */
export const setPresence = async (profileId, role, online, point) => {
  if (!['taxi_driver', 'courier'].includes(role)) return { error: 'bad_role' };
  if (online) {
    const ok = await canAccept(profileId, role);
    if (ok.error) return ok;
  }
  const lat = Number(point?.lat); const lng = Number(point?.lng);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001);
  const { rows } = await query('SELECT city FROM go_executors WHERE profile_id = $1 AND role = $2', [profileId, role]);
  await query(
    `INSERT INTO go_presence (profile_id, role, online, lat, lng, city) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (profile_id, role) DO UPDATE SET online = $3, lat = COALESCE($4, go_presence.lat), lng = COALESCE($5, go_presence.lng), city = $6, updated_at = now()`,
    [profileId, role, Boolean(online), hasPoint ? lat : null, hasPoint ? lng : null, rows[0]?.city ?? '']);
  return { ok: true, online: Boolean(online) };
};

export const presenceOf = async (profileId, role) => {
  const { rows } = await query('SELECT online, lat, lng, updated_at FROM go_presence WHERE profile_id = $1 AND role = $2', [profileId, role]);
  return rows[0] ? { online: rows[0].online, lat: rows[0].lat, lng: rows[0].lng } : { online: false };
};
