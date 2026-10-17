/**
 * Единый серверный источник прав по подписке (модуль 5, ноябрь-2026).
 *
 * Prime принадлежит профилю и хранится в `prime_subscriptions`; телефон, ПК, ТВ, консоль и машина спрашивают об одном и том же:
 * `GET /api/entitlements`. Закрытый контент закрывает сам сервер (`prime_required`), а не экран; этот ответ нужен экранам, чтобы
 * показать статус и вовремя разблокироваться, когда подписку оформили на другом устройстве.
 *
 * Оформлять и отменять подписку на ТВ, в консоли и в машине нельзя: устройство объявляет себя заголовком `X-Sky-Mode`
 * (tv | console | car), сервер отказывает в покупке (`purchase_not_on_device`) — пульт и геймпад не место для оплаты.
 */
import { query } from './db.mjs';

export const LIMITED_SURFACES = new Set(['tv', 'console', 'car']);
export const surfaceOf = (req) => {
  const m = String(req?.headers?.['x-sky-mode'] ?? '');
  return LIMITED_SURFACES.has(m) ? m : 'phone_or_desktop';
};
export const purchaseAllowedOn = (req) => surfaceOf(req) === 'phone_or_desktop';

/** Сервисы, которые открывает Prime (совпадает с PrimeGate на клиенте). Список зеркалит реальные проверки `hasPrime` в маршрутах. */
export const PRIME_SERVICES = ['music', 'film', 'podcasts', 'books', 'code'];

export const entitlementsOf = async (profileId) => {
  const { rows } = await query(
    `SELECT plan, status, started_at, expires_at FROM prime_subscriptions
      WHERE profile_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at DESC NULLS FIRST LIMIT 1`, [String(profileId)]);
  const r = rows[0];
  const active = Boolean(r);
  return {
    prime: {
      active,
      plan: r?.plan ?? null,
      expiresAt: r ? (r.expires_at ? r.expires_at.toISOString() : null) : null,
      lifetime: Boolean(r) && !r.expires_at,
    },
    services: Object.fromEntries(PRIME_SERVICES.map((s) => [s, active])),
    serverTime: new Date().toISOString(),
  };
};
