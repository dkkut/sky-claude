/* ===========================================================
   SKY TV — реальный трекинг прогресса просмотра.
   Без него «Продолжить просмотр» / «Вы смотрели» нечем было бы
   наполнить, кроме фейковых данных — вместо этого TVPlayer
   реально пишет сюда позицию воспроизведения.
=========================================================== */
const SK = 'sky:tv:watchProgress:v1';
const W = typeof window !== 'undefined';

export interface WatchEntry { position: number; duration: number; updatedAt: string }

const load = (): Record<string, WatchEntry> => {
  if (!W) return {};
  try { return JSON.parse(localStorage.getItem(SK) || '{}'); } catch { return {}; }
};
const persist = (v: Record<string, WatchEntry>) => {
  if (!W) return;
  try { localStorage.setItem(SK, JSON.stringify(v)); } catch {}
};

let cache = load();

export const recordProgress = (movieId: string, position: number, duration: number) => {
  if (!duration || duration < 1) return;
  cache = { ...cache, [movieId]: { position, duration, updatedAt: new Date().toISOString() } };
  persist(cache);
};

export const getProgress = (movieId: string): WatchEntry | null => cache[movieId] ?? null;

/** незавершённые (2%..92%) — для «Продолжить просмотр» */
export const getContinueWatching = (): { movieId: string; entry: WatchEntry }[] =>
  Object.entries(cache)
    .filter(([, e]) => e.position / e.duration > 0.02 && e.position / e.duration < 0.92)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .map(([movieId, entry]) => ({ movieId, entry }));

/** просмотренные хотя бы раз (включая завершённые) — для «Вы смотрели» */
export const getWatchHistory = (): { movieId: string; entry: WatchEntry }[] =>
  Object.entries(cache)
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt))
    .map(([movieId, entry]) => ({ movieId, entry }));
