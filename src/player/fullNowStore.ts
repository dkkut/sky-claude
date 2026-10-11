import { create } from 'zustand';

/** Развёрнутый «сейчас играет» на весь экран — общий для Sky TV и Sky Car. */
export const useFullNow = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
