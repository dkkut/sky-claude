/**
 * Корзина чатов: удалённые у всех чаты хранятся на сервере без срока и
 * возвращаются кнопкой «Восстановить». Список приходит от сервера.
 */
import { create } from 'zustand';
import type { ChatType } from './types';

export interface TrashedChat {
  id: string;
  name: string;
  type: ChatType;
  trashedAt: string;
  canRestore: boolean;
}

interface TrashState {
  items: TrashedChat[];
  loaded: boolean;
  set: (items: TrashedChat[]) => void;
  drop: (chatId: string) => void;
}

export const useTrashStore = create<TrashState>((set) => ({
  items: [],
  loaded: false,
  set: (items) => set({ items, loaded: true }),
  drop: (chatId) => set((s) => ({ items: s.items.filter((c) => c.id !== chatId) })),
}));
