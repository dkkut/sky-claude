/**
 * Два системных режима для сайта целиком — не путать с аварийным
 * режимом панели администратора (server/adminsec.mjs::setLockdown):
 * тот закрывает только саму панель и обрывает чужие admin-сессии,
 * владелец всё равно проходит, и предназначен для подозрения на
 * компрометацию панели. Здесь — про сайт для обычных людей:
 *
 *   «Аварийные работы» (shutdown)    — сайт не отвечает вообще никому,
 *                                      кроме владельца. Тяжёлый инцидент.
 *   «Технические работы» (maintenance) — сайт не отвечает обычным людям,
 *                                      но администрация продолжает
 *                                      работать. Плановое отключение.
 *
 * Включает и то, и другое только владелец — тот же принцип, что у
 * admin_lockdown: системный рубильник такого масштаба не отдаётся
 * рядовому администратору.
 */
import { query } from './db.mjs';
import { isOwner } from './admin.mjs';
import { logAdmin, consumeStepUp } from './adminsec.mjs';

const MAX_REASON = 300;

/* Эти два вопроса задаются на КАЖДЫЙ запрос к API (шлюз в server.mjs). Ответ держим недолго (PLATFORM_STATE_CACHE_MS, по умолчанию 1 с;
   0 — без кэша) и сбрасываем сразу при любом переключении из кода (setShutdown/setMaintenance/аварийная кнопка). Запросы к базе идут
   с общим «в полёте»: параллельные запросы делят один вопрос. Включение режима другим процессом/скриптом дойдёт не позже чем через секунду. */
const TTL = () => Math.max(0, Number(process.env.PLATFORM_STATE_CACHE_MS ?? 1000));
const memo = (sql) => {
  let at = 0, val = null, inflight = null;
  const get = async () => {
    const ttl = TTL();
    if (ttl && val && Date.now() - at < ttl) return val;
    if (inflight) return inflight;
    inflight = query(sql).then(({ rows }) => { val = rows[0] ?? { active: false, reason: '', set_at: null }; at = Date.now(); return val; }).finally(() => { inflight = null; });
    return inflight;
  };
  get.reset = () => { at = 0; val = null; };
  return get;
};
const readShutdown = memo('SELECT active, reason, set_at FROM platform_shutdown WHERE id');
const readMaintenance = memo('SELECT active, reason, set_at FROM platform_maintenance WHERE id');
export const forgetPlatformState = () => { readShutdown.reset(); readMaintenance.reset(); };
export const shutdownState = () => readShutdown();
export const maintenanceState = () => readMaintenance();

/**
 * Повторное подтверждение личности нужно обоим переключателям — хоть
 * владелец их и так единственный, кто может нажать, захваченная сессия
 * владельца не должна в одно действие положить сайт для всех.
 */
export const setShutdown = async (actorId, on, reason = '', stepUpCode = '') => {
  if (!(await isOwner(actorId))) {
    await logAdmin({ actorId, type: 'platform_shutdown', targetType: 'system',
      result: 'denied', detail: 'Не владелец' });
    return { error: 'owner_only' };
  }
  const step = await consumeStepUp(actorId, 'platform_shutdown', stepUpCode);
  if (step.error) return { error: step.error };
  const cleanReason = String(reason ?? '').slice(0, MAX_REASON);
  await query(
    `UPDATE platform_shutdown SET active = $1, reason = $2, set_by = $3, set_at = now() WHERE id`,
    [Boolean(on), cleanReason, actorId]);
  forgetPlatformState();
  await logAdmin({ actorId, type: on ? 'platform_shutdown_on' : 'platform_shutdown_off',
    targetType: 'system', detail: cleanReason });
  return { ...(await shutdownState()) };
};

export const setMaintenance = async (actorId, on, reason = '', stepUpCode = '') => {
  if (!(await isOwner(actorId))) {
    await logAdmin({ actorId, type: 'platform_maintenance', targetType: 'system',
      result: 'denied', detail: 'Не владелец' });
    return { error: 'owner_only' };
  }
  const step = await consumeStepUp(actorId, 'platform_maintenance', stepUpCode);
  if (step.error) return { error: step.error };
  const cleanReason = String(reason ?? '').slice(0, MAX_REASON);
  await query(
    `UPDATE platform_maintenance SET active = $1, reason = $2, set_by = $3, set_at = now() WHERE id`,
    [Boolean(on), cleanReason, actorId]);
  forgetPlatformState();
  await logAdmin({ actorId, type: on ? 'platform_maintenance_on' : 'platform_maintenance_off',
    targetType: 'system', detail: cleanReason });
  return { ...(await maintenanceState()) };
};
