/* ===========================================================
   SKY SPEAKER — включение режима «умная колонка».
   Как и Car Mode, режим включается вручную (или адресом ?speaker=true):
   у браузера нет надёжного способа понять, что экран — это колонка.
=========================================================== */
import { useSyncExternalStore } from 'react';

const SK = 'sky:speaker:mode:v1';
const W = typeof window !== 'undefined';

const read = (): boolean => {
  if (!W) return false;
  try {
    if (new URLSearchParams(window.location.search).get('speaker') === 'true') {
      localStorage.setItem(SK, 'on');
      return true;
    }
    return localStorage.getItem(SK) === 'on';
  } catch { return false; }
};

let on = read();
const listeners = new Set<() => void>();

export const setSpeakerMode = (v: boolean) => {
  on = v;
  if (W) try { localStorage.setItem(SK, v ? 'on' : 'off'); } catch { /* приватный режим */ }
  listeners.forEach(l => l());
};
export const getSpeakerMode = () => on;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
export const useSpeakerMode = (): boolean => useSyncExternalStore(subscribe, getSpeakerMode, () => false);
