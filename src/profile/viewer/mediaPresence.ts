/* ===============================================================
   SKY — Live media presence
   «Сейчас слушает музыку» / «сейчас смотрит фильм» / «в эфире» —
   тот же паттерн общего Record<userId,…>, что уже используется для
   игровой активности (src/gaming/accounts.ts). Обновляется реальными
   плеерами приложения (PlayerEngine, SkyFilm/TV Player), не выдумками.
=============================================================== */
import { create } from 'zustand';

export interface MusicPresence {
  userId: string; title: string; artist: string; coverUrl?: string; updatedAt: number;
}
export interface WatchPresence {
  userId: string; title: string; kind: 'movie' | 'video'; coverUrl?: string; updatedAt: number;
}
export interface StreamPresence {
  userId: string; title: string; category?: string; viewers: number; startedAt: number;
}

const SK = 'sky:mediaPresence:v1';
const W = typeof window !== 'undefined';
const load = () => { if (!W) return null; try { return JSON.parse(localStorage.getItem(SK) || 'null'); } catch { return null; } };
const persist = (d: object) => { if (!W) return; try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} };

/* Presence «протухает», если плеер не обновлял её дольше 2 минут —
   защита от «залипшего» статуса, если вкладку закрыли без явной остановки. */
const STALE_MS = 120_000;
const isFresh = (updatedAt: number) => Date.now() - updatedAt < STALE_MS;

interface MediaPresenceState {
  music:   Record<string, MusicPresence>;
  watch:   Record<string, WatchPresence>;
  streams: Record<string, StreamPresence>;

  setMusicPresence: (p: Omit<MusicPresence, 'updatedAt'> | null, userId: string) => void;
  setWatchPresence: (p: Omit<WatchPresence, 'updatedAt'> | null, userId: string) => void;
  setStreamPresence: (p: Omit<StreamPresence, 'startedAt'> | null, userId: string) => void;

  getMusicPresence: (userId: string) => MusicPresence | null;
  getWatchPresence: (userId: string) => WatchPresence | null;
  getStreamPresence: (userId: string) => StreamPresence | null;
}

const stored = load();

export const useMediaPresence = create<MediaPresenceState>((set, get) => {
  const flush = () => { const s = get(); persist({ music: s.music, watch: s.watch, streams: s.streams }); };

  return {
    music:   stored?.music   ?? {},
    watch:   stored?.watch   ?? {},
    streams: stored?.streams ?? {},

    setMusicPresence: (p, userId) => {
      set(s => {
        const next = { ...s.music };
        if (p) next[userId] = { ...p, userId, updatedAt: Date.now() }; else delete next[userId];
        return { music: next };
      });
      flush();
    },
    setWatchPresence: (p, userId) => {
      set(s => {
        const next = { ...s.watch };
        if (p) next[userId] = { ...p, userId, updatedAt: Date.now() }; else delete next[userId];
        return { watch: next };
      });
      flush();
    },
    setStreamPresence: (p, userId) => {
      set(s => {
        const next = { ...s.streams };
        if (p) next[userId] = { ...p, userId, startedAt: s.streams[userId]?.startedAt ?? Date.now() }; else delete next[userId];
        return { streams: next };
      });
      flush();
    },

    getMusicPresence: (userId) => { const p = get().music[userId]; return p && isFresh(p.updatedAt) ? p : null; },
    getWatchPresence: (userId) => { const p = get().watch[userId]; return p && isFresh(p.updatedAt) ? p : null; },
    getStreamPresence: (userId) => get().streams[userId] ?? null,
  };
});
