/**
 * Sky GO — класс автомобиля и тариф заказа. Класс водителя — то, что он указал в анкете и что одобрил сотрудник (extra.carClass: economy < comfort < business).
 * Код тарифа заказа совпадает с названием класса (economy / comfort / business). Тариф с другим кодом (добавленный администрацией) требований к классу не предъявляет.
 * Режим `dispatch_class_mode`: 'upgrade' (по умолчанию) — водитель класса ВЫШЕ заказанного тоже может взять заказ (в распределении ему небольшая надбавка к баллу,
 * чтобы сперва предлагать водителям того же класса); 'strict' — только тот же класс. Водитель класса НИЖЕ заказанного не получает и не видит заказ никогда.
 */
import { getSetting, openJson } from './gocore.mjs';

export const CLASS_RANK = { economy: 1, comfort: 2, business: 3 };
export const UPGRADE_PENALTY_KM = 1.5;

export const driverClass = (ex) => { const c = openJson(ex?.data_enc).extra?.carClass; return CLASS_RANK[c] ? c : 'economy'; };
export const classMode = async () => ((await getSetting('dispatch_class_mode', 'upgrade')) === 'strict' ? 'strict' : 'upgrade');

/** { ok } — можно; upgrade: true — водитель класса выше заказанного. */
export const classCheck = (driverCls, tariffCode, mode = 'upgrade') => {
  const need = CLASS_RANK[tariffCode];
  if (!need) return { ok: true };
  const have = CLASS_RANK[driverCls] ?? 1;
  if (have < need) return { ok: false, why: 'lower' };
  if (have > need) return mode === 'strict' ? { ok: false, why: 'strict' } : { ok: true, upgrade: true };
  return { ok: true };
};
