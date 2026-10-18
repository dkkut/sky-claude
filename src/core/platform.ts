/**
 * «Аварийные работы» / «Технические работы» — статус сайта целиком.
 * /api/platform/status отвечает даже без сессии: это ручка, по которой
 * ещё не вошедший человек понимает, какой экран показать вместо формы
 * входа. Переключатели доступны только владельцу — сервер проверяет
 * это сам (server/platform.mjs), здесь только проксируем запрос.
 */
import { apiCall } from './auth/api';

export interface PlatformModeState {
  active: boolean;
  reason: string;
  set_at: string | null;
}

export interface PlatformStatus {
  shutdown: PlatformModeState;
  maintenance: PlatformModeState;
  /** Можно ли сейчас завести новый аккаунт (server/registration.mjs). Вход существующих это не затрагивает. */
  /** Закрытые из админки модули: ключ → причина (только если разрешено показывать). */
  closedModules?: Record<string, { reason?: string }>;
  /** Показывать ли в Sky Media баннер о перебоях (включает администрация). */
  mediaBanner?: boolean;
  /** Этого посетителя режим не касается (владелец/администратор) — заглушку ему показывать нельзя. */
  bypass?: boolean;
  registration?: { open: boolean; message: string; reason: 'closed' | 'daily_limit' | null };
}

export const apiPlatformStatus = async (): Promise<PlatformStatus | null> => {
  const r = await apiCall<PlatformStatus>('/api/platform/status');
  return r.ok && r.data ? r.data : null;
};

export const apiSetPlatformShutdown = async (active: boolean, reason: string, stepUpCode: string) => {
  const r = await apiCall<PlatformModeState>('/api/platform/shutdown',
    { method: 'POST', body: JSON.stringify({ active, reason, stepUpCode }) });
  return r.ok && r.data
    ? { ok: true as const, state: r.data }
    : { ok: false as const, error: r.error, reason: r.reason };
};

export const apiSetPlatformMaintenance = async (active: boolean, reason: string, stepUpCode: string) => {
  const r = await apiCall<PlatformModeState>('/api/platform/maintenance',
    { method: 'POST', body: JSON.stringify({ active, reason, stepUpCode }) });
  return r.ok && r.data
    ? { ok: true as const, state: r.data }
    : { ok: false as const, error: r.error, reason: r.reason };
};
