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

export const shutdownState = async () => {
  const { rows } = await query('SELECT active, reason, set_at FROM platform_shutdown WHERE id');
  return rows[0] ?? { active: false, reason: '', set_at: null };
};

export const maintenanceState = async () => {
  const { rows } = await query('SELECT active, reason, set_at FROM platform_maintenance WHERE id');
  return rows[0] ?? { active: false, reason: '', set_at: null };
};

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
  await logAdmin({ actorId, type: on ? 'platform_maintenance_on' : 'platform_maintenance_off',
    targetType: 'system', detail: cleanReason });
  return { ...(await maintenanceState()) };
};
