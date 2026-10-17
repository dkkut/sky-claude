/** Sky GO: заказ «на потом» — общие настройки и проверка времени для такси и доставки. */
import { getSetting } from './gocore.mjs';

export const SCHEDULE_DEFAULTS = { minMin: 30, maxDays: 7, leadMin: 20, maxOrders: 5 };
export const scheduleSettings = async () => ({ ...SCHEDULE_DEFAULTS, ...(((await getSetting('schedule', null)) ?? {})) });

/** Время из запроса → { at } либо { error }. Пустое значение — заказ «сейчас» (at: null). */
export const parseSchedule = async (raw) => {
  if (!raw) return { at: null };
  const sc = await scheduleSettings();
  const when = new Date(String(raw));
  if (Number.isNaN(when.getTime())) return { error: 'bad_schedule' };
  const ahead = (when.getTime() - Date.now()) / 60000;
  if (ahead < sc.minMin) return { error: 'schedule_too_soon', minMin: sc.minMin };
  if (ahead > sc.maxDays * 1440) return { error: 'schedule_too_far', maxDays: sc.maxDays };
  return { at: when };
};

/** Лимит и конфликт по времени среди уже запланированных заказов человека этого вида (внутри транзакции). */
export const checkScheduleSlot = async (c, customerId, kind, at) => {
  const sc = await scheduleSettings();
  const { rows } = await c.query(`SELECT scheduled_at FROM go_orders WHERE customer_id = $1 AND kind = $2 AND status = 'scheduled'`, [customerId, kind]);
  if (rows.length >= sc.maxOrders) return { error: 'too_many_scheduled', max: sc.maxOrders };
  if (rows.some((m) => Math.abs(m.scheduled_at.getTime() - at.getTime()) < 30 * 60000)) return { error: 'schedule_conflict' };
  return null;
};
