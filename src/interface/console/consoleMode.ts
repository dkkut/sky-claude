/* ===========================================================
   SKY CONSOLE — включение режима.
   Отдельный режим для игровых консолей; не связан с Sky TV и
   Car Mode. Включается адресом ?console=true, ручной настройкой
   или автоопределением по User-Agent консольных браузеров.
   Приоритет выше TV: у консоли своя оболочка.
=========================================================== */
import { useSyncExternalStore } from 'react';

export type ConsoleModeSetting = 'auto' | 'on' | 'off';

const SK = 'sky:console:mode:v1';
const W = typeof window !== 'undefined';

const readSetting = (): ConsoleModeSetting => {
  if (!W) return 'auto';
  try {
    const q = new URLSearchParams(window.location.search).get('console');
    if (q === 'true') { localStorage.setItem(SK, 'on'); return 'on'; }
    if (q === 'false') { localStorage.setItem(SK, 'off'); return 'off'; }
    const v = localStorage.getItem(SK);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch { return 'auto'; }
};

let setting: ConsoleModeSetting = readSetting();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getConsoleModeSetting = () => setting;
export const setConsoleModeSetting = (v: ConsoleModeSetting) => {
  setting = v;
  if (W) try { localStorage.setItem(SK, v); } catch { /* приватный режим */ }
  emit();
};

/** Браузеры консолей сами называют себя в User-Agent. */
export const detectConsoleUA = (ua = W ? navigator.userAgent : ''): boolean =>
  /playstation|xbox|nintendo switch|nintendobrowser/i.test(ua);

export const isConsoleMode = (): boolean =>
  setting === 'on' ? true : setting === 'off' ? false : detectConsoleUA();

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** true — активна консольная оболочка Sky Console. */
export const useConsoleMode = (): boolean =>
  useSyncExternalStore(subscribe, isConsoleMode, () => false);

/** Сама настройка (auto/on/off) — для переключателя в профиле. */
export const useConsoleModeSetting = (): ConsoleModeSetting =>
  useSyncExternalStore(subscribe, getConsoleModeSetting, () => 'auto' as ConsoleModeSetting);
