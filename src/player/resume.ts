/**
 * Где остановились: позиция трека/выпуска запоминается на устройстве, и при
 * повторном включении (в том числе после выхода из приложения) воспроизведение
 * продолжается с этого места, а не с нуля. Дослушанное забывается.
 */
import { useSettings } from '@/settings/store';

const KEY = 'sky:resume:v1';
const KEEP = 40;
const MAX_AGE = 30 * 86_400_000;

type Entry = { p: number; at: number };
const read = (): Record<string, Entry> => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
};
const write = (m: Record<string, Entry>) => {
  try {
    const keys = Object.keys(m);
    if (keys.length > KEEP) keys.sort((a, b) => m[a].at - m[b].at).slice(0, keys.length - KEEP).forEach((k) => delete m[k]);
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch { /* приватный режим */ }
};

export const saveResume = (id: string, position: number, duration: number) => {
  if (!id || !Number.isFinite(position)) return;
  const m = read();
  // Начало и самый конец не запоминаем: там продолжать нечего.
  if (position < 5 || (duration > 0 && position > duration - 8)) { delete m[id]; write(m); return; }
  m[id] = { p: Math.floor(position), at: Date.now() };
  write(m);
};

export const loadResume = (id: string): number => {
  if (!useSettings.getState().settings.resumePlayback) return 0;
  const e = read()[id];
  return e && Date.now() - e.at < MAX_AGE ? e.p : 0;
};

export const clearResume = (id: string) => {
  const m = read();
  if (m[id]) { delete m[id]; write(m); }
};
