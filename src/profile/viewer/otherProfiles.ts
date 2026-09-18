/**
 * Кэш чужих профилей в памяти вкладки.
 *
 * accounts в auth-сторе — это профили СВОЕГО Sky ID (их отдаёт сервер
 * при входе), и другого человека там никогда не будет. Чужой профиль
 * приходит отдельной ручкой (apiPublicProfile) и живёт здесь — только
 * в памяти, не в localStorage: это не данные пользователя, а чужие,
 * подсмотренные на минуту просмотра.
 */
import { create } from 'zustand';
import { apiPublicProfile, type PublicProfile } from '@/core/auth/api';

interface OtherProfilesState {
  byId: Record<string, PublicProfile | null>; // null — посмотрели и не нашли
  pending: Set<string>;
  fetch: (id: string) => Promise<void>;
}

export const useOtherProfiles = create<OtherProfilesState>((set, get) => ({
  byId: {},
  pending: new Set(),

  fetch: async (id: string) => {
    if (!id || id in get().byId || get().pending.has(id)) return;
    set((s) => ({ pending: new Set(s.pending).add(id) }));
    const r = await apiPublicProfile(id);
    set((s) => {
      const pending = new Set(s.pending);
      pending.delete(id);
      return { byId: { ...s.byId, [id]: r.ok ? (r.data?.profile ?? null) : null }, pending };
    });
  },
}));
