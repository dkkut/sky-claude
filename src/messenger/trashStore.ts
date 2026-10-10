/**
 * Корзина чатов: удалённые у всех чаты хранятся на сервере 30 дней и
 * возвращаются кнопкой «Восстановить». Список приходит от сервера.
 */
import { create } from 'zustand';
import type { ChatType } from './types';

export interface TrashedChat {
  id: string;
  name: string;
  type: ChatType;
  trashedAt: string;
  deleteAt: string;
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

/** Сколько дней осталось до окончательного удаления (минимум 1, пока чат ещё можно вернуть). */
export const daysLeft = (deleteAt: string): number =>
  Math.max(1, Math.ceil((new Date(deleteAt).getTime() - Date.now()) / 86400_000));
