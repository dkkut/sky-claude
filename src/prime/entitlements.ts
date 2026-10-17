/** Права по подписке с сервера (`/api/entitlements`) — одинаково для телефона, ПК, ТВ, консоли и машины. */
import { create } from 'zustand';
import { apiCall } from '@/core/auth/api';

export interface Entitlements {
  prime: { active: boolean; plan: string | null; expiresAt: string | null; lifetime: boolean };
  services: Record<string, boolean>;
  surface: string;
  purchaseAllowedHere: boolean;
}

/** Устройство, на котором подписку оформлять нельзя: ТВ, консоль, машина (режим объявляет `main.tsx`). */
export const isLimitedSurface = (): boolean => {
  const m = typeof document !== 'undefined' ? document.documentElement.dataset.skyMode : '';
  return m === 'tv' || m === 'console' || m === 'car';
};

interface State { data: Entitlements | null; refresh: () => Promise<Entitlements | null> }
export const useEntitlements = create<State>((set) => ({
  data: null,
  refresh: async () => {
    const r = await apiCall<Entitlements>('/api/entitlements');
    if (r.ok && r.data) { set({ data: r.data }); return r.data; }
    return null;
  },
}));

/** Публичный адрес, который открывает телефон по QR: без токенов и личных данных. */
export const primeLinkUrl = (origin: string) => `${origin.replace(/\/$/, '')}/?open=prime`;
