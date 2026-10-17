/**
 * Sky GO Maps — обёртка над картографическим поставщиком (maps.mjs) для расчёта расстояния и времени между двумя точками:
 *  • кэш маршрутов (точки округляются до ~11 м, срок 10 минут, не больше 500 записей): повторные расчёты одного и того же маршрута
 *    (человек правит комментарий, пересчитывает цену, диспетчер открывает заказ) не тратят запросы к платному Directions;
 *  • суточный предел запросов к поставщику (`maps_route_daily_limit` в настройках Sky GO, 0 — без предела): при исчерпании
 *    считаем по прямой с пометкой estimated, а не отказываем человеку;
 *  • тайм-аут поставщика и недоступность не ломают заказ: оценка по прямой (×1,35 и 28 км/ч) с пометкой estimated;
 *  • счётчики для админки (запросы, попадания в кэш, отказы поставщика, оценки по прямой) — только числа, без адресов.
 * Движение исполнителей не имитируется: здесь только маршрут между точками, положение берётся из go_presence.
 */
const R = (n) => Math.round(Number(n) * 1e4) / 1e4;
const keyOf = (a, b) => `${R(a.lat)},${R(a.lng)}>${R(b.lat)},${R(b.lng)}`;

export const makeRouteService = ({ compute, haversineKm, limitPerDay = async () => 0, ttlMs = 10 * 60_000, max = 500, now = () => Date.now() }) => {
  const cache = new Map();
  const stats = { calls: 0, cacheHits: 0, providerFailures: 0, estimated: 0, limited: 0 };
  let day = ''; let usedToday = 0;
  const today = () => new Date(now()).toISOString().slice(0, 10);

  const estimate = (a, b, why) => {
    stats.estimated += 1;
    const km = haversineKm(a, b) * 1.35;
    return { km, min: Math.max(1, Math.round((km / 28) * 60)), estimated: true, why };
  };

  const route = async (a, b) => {
    const k = keyOf(a, b);
    const hit = cache.get(k);
    if (hit && hit.until > now()) { stats.cacheHits += 1; return { ...hit.value, cached: true }; }
    if (today() !== day) { day = today(); usedToday = 0; }
    const lim = await limitPerDay();
    if (lim > 0 && usedToday >= lim) { stats.limited += 1; return estimate(a, b, 'daily_limit'); }
    usedToday += 1; stats.calls += 1;
    const r = await compute({ origin: a, stops: [{ id: 'b', lat: b.lat, lng: b.lng }] }).catch(() => ({ error: 'route_failed' }));
    if (r?.ok && r.distanceM > 0) {
      const value = { km: r.distanceM / 1000, min: Math.max(1, Math.round(r.durationS / 60)), estimated: false };
      if (cache.size >= max) cache.delete(cache.keys().next().value);
      cache.set(k, { value, until: now() + ttlMs });
      return value;
    }
    // «не настроен ключ» — не сбой поставщика; всё остальное считаем сбоем
    if (r?.error && r.error !== 'not_configured' && r.error !== 'maps_not_configured') stats.providerFailures += 1;
    return estimate(a, b, 'provider');
  };
  return { route, stats: () => ({ ...stats, cached: cache.size, usedToday }), clear: () => cache.clear() };
};
