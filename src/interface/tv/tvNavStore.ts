/* ===========================================================
   SKY TV — стек навигации.
   Хранит историю экранов TV-режима, чтобы Back вёл строго по
   реальному пути пользователя (а не «домой» произвольно), и
   восстанавливал фокус/скролл там, где он был при уходе с экрана.
=========================================================== */
import { create } from 'zustand';

export type TVScreen =
  | { kind: 'home' }
  | { kind: 'movies' }
  | { kind: 'series' }
  | { kind: 'music' }
  | { kind: 'video' }
  | { kind: 'channels' }
  | { kind: 'podcasts' }
  | { kind: 'library' }
  | { kind: 'favorites' }
  | { kind: 'search' }
  | { kind: 'profile' }
  | { kind: 'settings' }
  | { kind: 'movieDetail'; movieId: string }
  | { kind: 'player'; movieId: string };

interface StackEntry {
  screen: TVScreen;
  lastFocusedId?: string;
  scrollY?: number;
}

interface TVNavState {
  stack: StackEntry[];
  current: () => TVScreen;
  push: (screen: TVScreen) => void;
  /** возвращает true, если реально вышли на предыдущий экран;
      false — если стек пуст (стек содержит только 'home') и Back
      нужно интерпретировать как «выйти из TV-режима» на вызывающей стороне */
  back: () => boolean;
  replaceHome: () => void;
  /** переключение верхнеуровневого раздела через хедер — сбрасывает
      глубокий стек (детали/плеер), а не копит его бесконечно */
  setTopLevel: (screen: TVScreen) => void;
  saveFocusForCurrent: (id: string | undefined, scrollY: number) => void;
}

export const useTVNavStore = create<TVNavState>((set, get) => ({
  stack: [{ screen: { kind: 'home' } }],

  current: () => get().stack[get().stack.length - 1].screen,

  push: (screen) => set(s => ({ stack: [...s.stack, { screen }] })),

  back: () => {
    const s = get();
    if (s.stack.length <= 1) return false;
    set({ stack: s.stack.slice(0, -1) });
    return true;
  },

  replaceHome: () => set({ stack: [{ screen: { kind: 'home' } }] }),
  setTopLevel: (screen) => set({ stack: [{ screen }] }),

  saveFocusForCurrent: (id, scrollY) => set(s => {
    if (s.stack.length === 0) return s;
    const stack = [...s.stack];
    stack[stack.length - 1] = { ...stack[stack.length - 1], lastFocusedId: id, scrollY };
    return { stack };
  }),
}));

/** Что было сохранено для экрана, на который мы только что Back'нулись
    (id последнего фокуса + позиция скролла) — читается один раз при
    монтировании экрана. */
export const useTVRestoreState = () => {
  const stack = useTVNavStore(s => s.stack);
  const top = stack[stack.length - 1];
  return { lastFocusedId: top?.lastFocusedId, scrollY: top?.scrollY ?? 0 };
};
