/** Настройки обнаружения утечек и самозащиты (одна строка defense_settings.data). Кэш 10 с. */
import { query } from './db.mjs';

export const DEFAULTS = {
  enabled: true,
  /** auto — действия выполняются сами; notify — только письмо и запись, без действий. */
  mode: 'auto',
  thresholds: {
    reqPerMin: 900,            // запросов к API в минуту от одного человека/адреса
    bytes5min: 150 * 1024 * 1024,   // JSON-ответов за 5 минут
    distinctUsers10min: 300,   // разных людей/профилей, чьи данные открыты за 10 минут
    exports10min: 6,           // обращений к выгрузкам за 10 минут
    adminActions10min: 30,     // действий администратора за 10 минут
    adminPriv10min: 6,         // выдач прав/ролей за 10 минут
    probing4xxPerMin: 120,     // ответов 4xx с одного адреса в минуту (сканирование)
  },
  actions: {                   // какие защитные действия разрешены автоматически
    block_ip: true, hold_account: true, revoke_sessions: true, panel_lockdown: true, raise_level: true,
    host_restore_code: true, host_recreate: true, host_rotate_jwt: true,
  },
  blockHours: 6,
  holdHours: 6,
  undoLinkDays: 7,
};

let cache = null; let at = 0;
export const getSettings = async () => {
  if (cache && Date.now() - at < 10_000) return cache;
  let data = {};
  try { data = (await query('SELECT data FROM defense_settings WHERE id')).rows[0]?.data ?? {}; } catch { /* таблицы ещё нет */ }
  cache = { ...DEFAULTS, ...data, thresholds: { ...DEFAULTS.thresholds, ...(data.thresholds ?? {}) }, actions: { ...DEFAULTS.actions, ...(data.actions ?? {}) } };
  at = Date.now();
  return cache;
};
export const forgetSettings = () => { cache = null; };

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null; };
export const saveSettings = async (actorId, patch) => {
  const cur = await getSettings();
  const next = { ...cur, thresholds: { ...cur.thresholds }, actions: { ...cur.actions } };
  if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
  if (patch.mode !== undefined) { if (!['auto', 'notify'].includes(patch.mode)) return { error: 'bad_field', field: 'mode' }; next.mode = patch.mode; }
  const T = { reqPerMin: [30, 100000], bytes5min: [1 << 20, 1 << 40], distinctUsers10min: [5, 100000], exports10min: [1, 1000], adminActions10min: [3, 1000], adminPriv10min: [1, 100], probing4xxPerMin: [10, 100000] };
  for (const [k, [lo, hi]] of Object.entries(T)) if (patch.thresholds?.[k] !== undefined) { const v = num(patch.thresholds[k], lo, hi); if (v == null) return { error: 'bad_field', field: k }; next.thresholds[k] = v; }
  for (const k of Object.keys(DEFAULTS.actions)) if (patch.actions?.[k] !== undefined) next.actions[k] = Boolean(patch.actions[k]);
  for (const [k, lo, hi] of [['blockHours', 1, 168], ['holdHours', 1, 168], ['undoLinkDays', 1, 30]]) if (patch[k] !== undefined) { const v = num(patch[k], lo, hi); if (v == null) return { error: 'bad_field', field: k }; next[k] = v; }
  const { enabled, mode, thresholds, actions, blockHours, holdHours, undoLinkDays } = next;
  await query('UPDATE defense_settings SET data = $1::jsonb, updated_by = $2, updated_at = now() WHERE id', [JSON.stringify({ enabled, mode, thresholds, actions, blockHours, holdHours, undoLinkDays }), actorId ?? null]);
  forgetSettings();
  return { ok: true, settings: await getSettings() };
};
