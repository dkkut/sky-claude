import { create } from 'zustand';
/** Из чата: открыть Sky Pets с собеседником (совместный питомец) и отправлять карточки обратно в этот чат. */
type Nav = { peerId: string | null; peerName: string | null; chatId: string | null; tab: string | null; set: (p: Partial<Omit<Nav, 'set'>>) => void; clear: () => void };
export const usePetsNav = create<Nav>((set) => ({ peerId: null, peerName: null, chatId: null, tab: null, set: (p) => set(p), clear: () => set({ peerId: null, peerName: null, chatId: null, tab: null }) }));
export const openSkyPets = async (opts: { peerId?: string; peerName?: string; chatId?: string; tab?: string } = {}) => {
  usePetsNav.getState().set({ peerId: opts.peerId ?? null, peerName: opts.peerName ?? null, chatId: opts.chatId ?? null, tab: opts.tab ?? null });
  const { useModuleStore } = await import('@/data/state/modules');
  useModuleStore.getState().setPendingExtrasTab('skypets'); useModuleStore.getState().setActiveModule('extras');
};
