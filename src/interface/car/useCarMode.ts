/* ===========================================================
   SKY CAR MODE — включение режима.
   В отличие от TV-режима, у автомобильного экрана нет надёжного
   способа определить себя из браузера (Android Auto/CarPlay — это
   свои нативные шаблоны, а не веб-страница) — поэтому это ручной
   переключатель, а не эвристика. Пользователь включает Car Mode сам,
   когда подключился к экрану машины (или просто хочет крупный
   интерфейс с меньшим количеством отвлекающих деталей).
=========================================================== */
import { useSyncExternalStore } from 'react';

const SK = 'sky:car:mode:v1';
const W = typeof window !== 'undefined';

const read = (): boolean => {
  if (!W) return false;
  try { return localStorage.getItem(SK) === 'on'; } catch { return false; }
};

let on = read();
const listeners = new Set<() => void>();

export const setCarMode = (v: boolean) => {
  on = v;
  if (W) try { localStorage.setItem(SK, v ? 'on' : 'off'); } catch { /* приватный режим */ }
  listeners.forEach(l => l());
};
export const getCarMode = () => on;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };

/** true — сейчас активен Car Mode (полноэкранная оболочка вместо обычного интерфейса). */
export const useCarMode = (): boolean =>
  useSyncExternalStore(subscribe, getCarMode, () => false);
