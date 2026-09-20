/* ===============================================================
   SKY GARANT — клиентское состояние.

   Раньше вся Sky Garant жила в localStorage этой вкладки (сделки,
   подписка) — сервера не было вовсе, и оплата покупателя уходила в
   никуда. Здесь состояние полностью серверное: store — только кэш
   последнего ответа сервера плюс обёртки над вызовами garantApi.ts.
   Ничего не решается на клиенте — сервер перепроверяет каждое
   действие сам.
=============================================================== */
import { create } from 'zustand';
import { useMoney } from '@/wallet/store';
import {
  apiMyGarantStatus, apiMyDeals, apiCreateDeal, apiDepositSeller, apiDepositBuyer,
  apiConfirmBuyer, apiConfirmSeller, apiCancelDeal, apiOpenDispute, apiSubscribe,
  type GarantDeal, type GarantStatus, type CreateDealParams,
} from './garantApi';

interface GarantState {
  status: GarantStatus | null;
  deals: GarantDeal[];
  loaded: boolean;
  busy: boolean;
  lastError: string;

  load: () => Promise<void>;
  createDeal: (params: CreateDealParams) => Promise<{ ok: boolean; deal?: GarantDeal; error?: string }>;
  depositSeller: (dealId: string) => Promise<boolean>;
  depositBuyer: (dealId: string) => Promise<{ ok: boolean; error?: string }>;
  confirmBuyer: (dealId: string) => Promise<boolean>;
  confirmSeller: (dealId: string) => Promise<boolean>;
  cancelDeal: (dealId: string) => Promise<boolean>;
  openDispute: (dealId: string, reason: string) => Promise<boolean>;
  subscribe: () => Promise<boolean>;
  dealById: (dealId: string) => GarantDeal | undefined;
}

const applyDeal = (deals: GarantDeal[], deal: GarantDeal) => {
  const idx = deals.findIndex((d) => d.id === deal.id);
  if (idx === -1) return [deal, ...deals];
  const next = deals.slice();
  next[idx] = deal;
  return next;
};

export const useGarantStore = create<GarantState>((set, get) => ({
  status: null,
  deals: [],
  loaded: false,
  busy: false,
  lastError: '',

  load: async () => {
    const [statusRes, dealsRes] = await Promise.all([apiMyGarantStatus(), apiMyDeals()]);
    set({
      status: statusRes.ok ? statusRes.data?.data ?? null : null,
      deals: dealsRes.ok ? dealsRes.data?.deals ?? [] : [],
      loaded: true,
    });
  },

  createDeal: async (params) => {
    set({ busy: true, lastError: '' });
    const r = await apiCreateDeal(params);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return { ok: false, error: r.error }; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    void get().load();
    return { ok: true, deal: r.data.deal };
  },

  depositSeller: async (dealId) => {
    set({ busy: true, lastError: '' });
    const r = await apiDepositSeller(dealId);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return false; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    return true;
  },

  depositBuyer: async (dealId) => {
    set({ busy: true, lastError: '' });
    const r = await apiDepositBuyer(dealId);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return { ok: false, error: r.error }; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    void useMoney.getState().refresh();
    return { ok: true };
  },

  confirmBuyer: async (dealId) => {
    set({ busy: true, lastError: '' });
    const r = await apiConfirmBuyer(dealId);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return false; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    if (r.data.deal.status === 'completed') void useMoney.getState().refresh();
    return true;
  },

  confirmSeller: async (dealId) => {
    set({ busy: true, lastError: '' });
    const r = await apiConfirmSeller(dealId);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return false; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    if (r.data.deal.status === 'completed') void useMoney.getState().refresh();
    return true;
  },

  cancelDeal: async (dealId) => {
    set({ busy: true, lastError: '' });
    const r = await apiCancelDeal(dealId);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return false; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    return true;
  },

  openDispute: async (dealId, reason) => {
    set({ busy: true, lastError: '' });
    const r = await apiOpenDispute(dealId, reason);
    set({ busy: false });
    if (!r.ok || !r.data) { set({ lastError: r.error ?? 'failed' }); return false; }
    set((s) => ({ deals: applyDeal(s.deals, r.data!.deal) }));
    return true;
  },

  subscribe: async () => {
    set({ busy: true, lastError: '' });
    const r = await apiSubscribe();
    set({ busy: false });
    if (!r.ok) { set({ lastError: r.error ?? 'failed' }); return false; }
    void get().load();
    void useMoney.getState().refresh();
    return true;
  },

  dealById: (dealId) => get().deals.find((d) => d.id === dealId),
}));
