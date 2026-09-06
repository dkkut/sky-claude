/* ===============================================================
   PROFILE VIEWER — навигация
   Стек userId: открытие профиля кладёт id наверх, «назад» — снимает.
   Работает из любого модуля платформы (см. ProfileViewerLayer).
=============================================================== */
import { create } from 'zustand';

interface ProfileViewerState {
  stack: string[];
  open:  (userId: string) => void;
  back:  () => void;
  close: () => void;
}

export const useProfileViewer = create<ProfileViewerState>((set, get) => ({
  stack: [],

  open: (userId) => {
    if (!userId) return;
    const { stack } = get();
    if (stack[stack.length - 1] === userId) return;
    set({ stack: [...stack, userId] });
  },

  back: () => {
    const { stack } = get();
    if (stack.length <= 1) { set({ stack: [] }); return; }
    set({ stack: stack.slice(0, -1) });
  },

  close: () => set({ stack: [] }),
}));

/** Удобный хук для точек входа: openProfile(userId) откуда угодно. */
export const openProfile = (userId: string) => useProfileViewer.getState().open(userId);
