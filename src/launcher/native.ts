/* Мост к менеджеру установки игр в Windows-приложении (electron/launcher.cjs). В браузере и Android установки нет — об этом честно сказано в интерфейсе. */
import { create } from 'zustand';
import { getAccessToken } from '@/core/auth/api';
import { getApiOrigin } from '@/core/nativeApp';
import { lApi } from './api';

export interface DlTask { gameId: string; kind: string; status: string; doneBytes: number; totalBytes: number; speed: number; etaSec: number | null; error: string | null; version: string | null }
export interface Installed { gameId: string; dir: string; version: string; buildId: string; installedAt: string; history: { version: string; at: string }[] }

export const launcherNative = () => typeof window !== 'undefined' ? window.sky?.launcher ?? null : null;
const ACTIVE = new Set(['queued', 'starting', 'downloading', 'applying']);

interface S {
  ready: boolean; root: string; tasks: Record<string, DlTask>; installed: Record<string, Installed>; running: string[]; lastError: string | null;
  start: () => Promise<void>; stop: () => void; refresh: () => Promise<void>;
  call: (method: string, ...args: unknown[]) => Promise<any>;
}
let unsub: (() => void) | null = null; let tokenTimer: number | null = null; let users = 0;

export const useDownloads = create<S>((set, get) => ({
  ready: false, root: '', tasks: {}, installed: {}, running: [], lastError: null,
  call: async (method, ...args) => { const l = launcherNative(); if (!l) return { error: 'not_native' }; return l.call(method, ...args); },
  refresh: async () => {
    const l = launcherNative(); if (!l || !get().ready) return;
    const [tasks, inst, run] = await Promise.all([l.call('tasks'), l.call('installed'), l.call('running')]);
    set({ tasks: Object.fromEntries((Array.isArray(tasks) ? tasks : []).map((t: DlTask) => [t.gameId, t])), installed: Object.fromEntries((Array.isArray(inst) ? inst : []).map((i: Installed) => [i.gameId, i])), running: Array.isArray(run) ? run : [] });
  },
  /** Вкладка «Лаунчер» открыта: подписываемся на события менеджера. Счётчик пользователей — повторное открытие не создаёт вторую подписку. */
  start: async () => {
    const l = launcherNative(); if (!l) return; users += 1; if (users > 1) return;
    const r = await l.init({ apiOrigin: getApiOrigin(), token: getAccessToken() ?? '' });
    if (r.error) { set({ lastError: r.error }); return; }
    set({ ready: true, root: r.root ?? '' });
    unsub = l.onEvent((ev: any) => {
      if (ev.type === 'progress' || ev.type === 'state' || ev.type === 'done' || ev.type === 'error') {
        set((s) => ({ tasks: { ...s.tasks, [ev.gameId]: ev as DlTask } }));
        if (ev.type === 'done' || ev.type === 'error') {
          void get().refresh();
          void lApi.event(ev.gameId, ev.type === 'done' ? (ev.kind === 'update' ? 'update_ok' : 'install_ok') : (ev.kind === 'update' ? 'update_fail' : 'install_fail'));   // только счётчик для владельца игры, без личных данных
        }
      } else if (ev.type === 'running' || ev.type === 'exited' || ev.type === 'launch_error') void get().refresh();
    });
    // токен нужен менеджеру только пока идёт загрузка: обновляем раз в минуту и только при активных задачах
    tokenTimer = window.setInterval(() => { if (document.hidden) return; if (Object.values(get().tasks).some((t) => ACTIVE.has(t.status))) void l.setToken(getAccessToken() ?? ''); }, 60000);
    await get().refresh();
  },
  stop: () => {
    users = Math.max(0, users - 1); if (users > 0) return;
    if (unsub) { unsub(); unsub = null; }
    if (tokenTimer) { window.clearInterval(tokenTimer); tokenTimer = null; }
    // загрузки, которые человек запустил сам, продолжаются в главном процессе; здесь прекращаются только подписка и таймеры вкладки
  },
}));
export const isActive = (t?: DlTask) => Boolean(t && ACTIVE.has(t.status));
