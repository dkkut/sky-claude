/* ===============================================================
   Quick Menu — разговор с сервером (server/quickmenu.mjs).
   Порядок/включённость/закреп разделов всегда читаются и пишутся
   целиком — сервер сам решает, что вообще существует (registry),
   клиент только переставляет и переключает.
=============================================================== */
import { apiCall } from '@/core/auth/api';

export interface QuickMenuItem {
  key: string;
  label: string;
  enabled: boolean;
  pinned: boolean;
}
export interface QuickMenuRegistryItem { key: string; label: string }

export const apiQuickMenuGet = async (): Promise<{ items: QuickMenuItem[]; registry: QuickMenuRegistryItem[] }> => {
  const r = await apiCall<{ items: QuickMenuItem[]; registry: QuickMenuRegistryItem[] }>('/api/quickmenu');
  return r.ok && r.data ? r.data : { items: [], registry: [] };
};

export const apiQuickMenuSet = async (items: QuickMenuItem[]) => {
  const r = await apiCall<{ items: QuickMenuItem[] }>('/api/quickmenu', {
    method: 'POST',
    body: JSON.stringify({ items: items.map(({ key, enabled, pinned }) => ({ key, enabled, pinned })) }),
  });
  return r.ok ? { ok: true as const, items: r.data?.items ?? [] } : { ok: false as const };
};

export const apiQuickMenuReset = async (): Promise<QuickMenuItem[]> => {
  const r = await apiCall<{ items: QuickMenuItem[] }>('/api/quickmenu/reset', { method: 'POST' });
  return r.ok ? r.data?.items ?? [] : [];
};

/** Точечное включение/выключение одного пункта — то, чем пользуется
 *  голосовая команда «добавь X в быстрое меню» (см. voiceCommands.ts):
 *  та же самая ручка, что и обычный тумблер в настройках. */
export const apiQuickMenuSetItem = async (key: string, enabled: boolean) => {
  const r = await apiCall<{ items: QuickMenuItem[] }>('/api/quickmenu/item', {
    method: 'POST', body: JSON.stringify({ key, enabled }),
  });
  return r.ok ? { ok: true as const, items: r.data?.items ?? [] } : { ok: false as const };
};
