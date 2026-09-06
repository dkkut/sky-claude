/* ===========================================================
   SKY — TV Mode detection
   Device Mode: 'desktop' | 'mobile' | 'tv' — единая точка входа,
   вместо разрозненных if(isTV)/if(isMobile) по всему коду.
=========================================================== */
import { useEffect, useState, useSyncExternalStore } from 'react';

export type TVModeSetting = 'auto' | 'on' | 'off';

const SK = 'sky:tv:mode:v1';
const W = typeof window !== 'undefined';

const readSetting = (): TVModeSetting => {
  if (!W) return 'auto';
  try {
    const v = localStorage.getItem(SK);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch { return 'auto'; }
};

let setting: TVModeSetting = readSetting();
const listeners = new Set<() => void>();

export const setTVModeSetting = (v: TVModeSetting) => {
  setting = v;
  if (W) try { localStorage.setItem(SK, v); } catch {}
  listeners.forEach(l => l());
};
export const getTVModeSetting = () => setting;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };

/* -- эвристика автоопределения ТВ ------------------------------- */
const detectTVHeuristic = (): boolean => {
  if (!W) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('tv') === 'true') return true;
  if (params.get('tv') === 'false') return false;

  const ua = navigator.userAgent.toLowerCase();
  const uaIsTV = /smarttv|smart-tv|googletv|appletv|hbbtv|netcast|viera|webos|tizen|\btv\b|crkey|aftb|aftm|aftt|roku|dtv/.test(ua);
  if (uaIsTV) return true;

  // Большой экран + альбомная ориентация + отсутствие тач-ввода + грубый
  // указатель/его отсутствие — все признаки разом, а не любое сочетание.
  // Специально строго: одинокий "большой viewport" (типично для встроенных
  // webview-превью типа Replit, где реальный экран — телефон) НЕ должен
  // сам по себе включать TV-режим и ломать обычный мобильный интерфейс.
  const width = window.innerWidth, height = window.innerHeight;
  const bigLandscapeScreen = width >= 1280 && height >= 650 && width > height * 1.3;
  const noTouch = !('ontouchstart' in window) && (navigator.maxTouchPoints ?? 0) === 0;
  const coarseOrNoHover = window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;

  return bigLandscapeScreen && noTouch && coarseOrNoHover;
};

/* -- реактивное значение через useSyncExternalStore --------------- */
export const useDeviceMode = (): 'desktop' | 'mobile' | 'tv' => {
  const currentSetting = useSyncExternalStore(subscribe, getTVModeSetting, () => 'auto' as TVModeSetting);
  const [autoIsTV, setAutoIsTV] = useState(() => detectTVHeuristic());

  useEffect(() => {
    const recheck = () => setAutoIsTV(detectTVHeuristic());
    recheck();
    window.addEventListener('resize', recheck);
    return () => window.removeEventListener('resize', recheck);
  }, []);

  const isTV = currentSetting === 'on' ? true : currentSetting === 'off' ? false : autoIsTV;
  if (isTV) return 'tv';

  const isNarrow = W && window.matchMedia?.('(max-width: 860px)').matches;
  return isNarrow ? 'mobile' : 'desktop';
};
