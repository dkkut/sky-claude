import { useAuthStore } from '@/core/auth/store';
/* ===========================================================
   SKY TV — реальный трекинг прогресса просмотра.
   Без него «Продолжить просмотр» / «Вы смотрели» нечем было бы
   наполнить, кроме фейковых данных — вместо этого TVPlayer
   реально пишет сюда позицию воспроизведения.
=========================================================== */
/* Прогресс хранится по профилю: на телевизоре бывает несколько человек, их истории не смешиваются. */
const uid = () => useAuthStore.getState().currentUserId ?? 'anon';
const SK = () => `sky:tv:watchProgress:v2:${uid()}`;
const W = typeof window !== 'undefined';

export interface WatchEntry { position: number; duration: number; updatedAt: string }

const load = (): Record<string, WatchEntry> => {
  if (!W) return {};
  try { return JSON.parse(localStorage.getItem(SK()) || '{}'); } catch { return {}; }
};
const persist = (v: Record<string, WatchEntry>) => {
  if (!W) return;
  try { localStorage.setItem(SK(), JSON.stringify(v)); } catch {}
};

let cache = load();
let cacheUid = uid();
const fresh = () => { const u = uid(); if (u !== cacheUid) { cacheUid = u; cache = load(); } };

export const recordProgress = (movieId: string, position: number, duration: number) => {
  if (!duration || duration < 1) return;
  fresh();
  cache = { ...cache, [movieId]: { position, duration, updatedAt: new Date().toISOString() } };
  persist(cache);
};

export const getProgress = (movieId: string): WatchEntry | null => { fresh(); return cache[movieId] ?? null; };

/** незавершённые (2%..92%) — для «Продолжить просмотр» */
export const getContinueWatching = (): { movieId: string; entry: WatchEntry }[] => { fresh(); return Object.entries(cache)
    .filter(([, e]) => e.position / e.duration > 0.02 && e.position / e.duration < 0.92)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .map(([movieId, entry]) => ({ movieId, entry })); };

/** просмотренные хотя бы раз (включая завершённые) — для «Вы смотрели» */
export const getWatchHistory = (): { movieId: string; entry: WatchEntry }[] => { fresh(); return Object.entries(cache)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .map(([movieId, entry]) => ({ movieId, entry })); };
