/* --- Утилиты и алгоритм ---------------------------------- */
import type { Track } from '@/platform/store';
import type { ListenCtx } from './types';

/* Форматирование */
export const fmtTime  = (s: number) =>
  !isFinite(s) || s < 0 ? '0:00'
  : `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export const fmtPlays = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1000    ? `${(n / 1000).toFixed(1)}K`
  : String(n);

export const toDurStr = (s: number) =>
  !isFinite(s) || s <= 0 ? '0:00'
  : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* Цвета обложек */
const PALETTE: [string, string][] = [
  ['#1a0533', '#2d1b69'], ['#0f2027', '#2c5364'], ['#0d1b2a', '#1b4332'],
  ['#0f0c29', '#302b63'], ['#1a1a2e', '#16213e'], ['#200122', '#6f0000'],
  ['#0a192f', '#112240'], ['#1c0a00', '#3d1a00'], ['#0a0a1a', '#1a1a3a'],
];
export const getG = (id: string): [string, string] => {
  const h = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[h % PALETTE.length];
};

/* Алгоритм «Для вас» */
export const algoScore = (t: Track, ctx: ListenCtx, now: number): number => {
  const hoursAgo = (now - new Date(t.addedAt).getTime()) / 3_600_000;
  const recency  = Math.max(0, 100 - hoursAgo * 0.4);
  const pop      = Math.log1p(t.plays) * 4;
  const likes    = t.likes.length * 3;
  const genre    = (ctx.genreCount[t.genre]  ?? 0) * 8;
  const artist   = (ctx.artistCount[t.artist] ?? 0) * 10;
  const likedBst = ctx.liked.has(t.id)   ? 20  : 0;
  const heard    = ctx.history.has(t.id) ? -15  : 0;
  return recency + pop + likes + genre + artist + likedBst + heard;
};

/* История прослушиваний */
const HIST_KEY = 'sky:music:history:v1';
export const loadHistory = (): string[] => {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
};
export const addHistory = (id: string) => {
  try {
    const h = loadHistory().filter(x => x !== id);
    localStorage.setItem(HIST_KEY, JSON.stringify([id, ...h].slice(0, 100)));
  } catch {}
};
