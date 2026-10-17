/**
 * Клиентская телеметрия (модуль 12): ошибки приложения уходят пачками в `/api/telemetry` → единый журнал Sky (категория «клиент»).
 * Отправляется только тип, короткое сообщение об ошибке, адрес экрана БЕЗ идентификаторов и версия — ни содержимого сообщений, ни
 * личных данных, ни токенов. Не чаще пачки в 15 секунд; повторы схлопываются со счётчиком; при отказе сервера (выключено/лимит) молчим.
 */
import { apiCall, getAccessToken } from '@/core/auth/api';

interface Ev { type: string; level: 'WARN' | 'ERROR' | 'CRITICAL'; message: string; route: string; count: number }
const queue = new Map<string, Ev>();
let timer: number | null = null;
let sent = 0;
let off = false;
const MAX_PER_SESSION = 100;

const route = () => { try { return location.pathname.replace(/[0-9a-f-]{20,}/gi, ':id'); } catch { return ''; } };
const platform = () => ((window as unknown as { __TAURI__?: unknown }).__TAURI__ ? 'desktop' : 'web');
const msg = (v: unknown) => String(v instanceof Error ? v.message : v ?? '').replace(/\s+/g, ' ').slice(0, 200);

const flush = async () => {
  timer = null;
  if (off || !queue.size || !getAccessToken()) return;   // без входа не отправляем: событие привязывается к профилю
  const events = [...queue.values()].slice(0, 20).map((e) => ({ ...e, platform: platform(), appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '' }));
  queue.clear();
  const r = await apiCall('/api/telemetry', { method: 'POST', body: JSON.stringify({ events }) });
  if (!r.ok && (r.status === 403 || r.status === 404)) off = true;
};

/** Записать событие. Никогда не бросает исключений. */
export const reportClient = (type: string, error: unknown, level: Ev['level'] = 'ERROR') => {
  try {
    if (off || sent >= MAX_PER_SESSION) return;
    const m = msg(error);
    const k = `${type}|${m}|${route()}`;
    const cur = queue.get(k);
    if (cur) cur.count += 1; else { queue.set(k, { type, level, message: m, route: route(), count: 1 }); sent += 1; }
    if (timer === null) timer = window.setTimeout(() => { void flush(); }, 15_000);
  } catch { /* телеметрия не должна ломать приложение */ }
};

let installed = false;
export const installTelemetry = () => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => reportClient('js_error', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => reportClient('unhandled_rejection', e.reason));
  // Уходя со страницы — досылаем, что накопилось (sendBeacon не умеет заголовки, поэтому обычный запрос с keepalive не используем).
  window.addEventListener('visibilitychange', () => { if (document.hidden) void flush(); });
};
