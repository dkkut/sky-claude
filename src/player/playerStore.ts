import { create } from 'zustand';

export type MediaKind = 'music' | 'podcast' | 'video' | 'tv' | 'voice';

export interface LyricLine  { t: number; text: string }
export interface Chapter     { t: number; title: string }

export interface PlayerItem {
  id:        string;
  kind:      MediaKind;
  title:     string;
  author:    string;
  coverUrl?: string;
  hue?:      number;       // gradient accent colour (0-360)
  /** Метки материала (сервер): Explicit «E» и «Старая версия». */
  explicit?: boolean;
  legacy?:   boolean;
  color?:    string;
  // queue
  queue?:    PlayerItem[];
  qIdx?:     number;
  // enrichment
  lyrics?:   LyricLine[];
  chapters?: Chapter[];
  // audio ref injection: SkyMusic writes srcUrl then drives the <audio> itself
  srcUrl?:   string;
  duration?: number;       // seconds
}

interface PlayerStore {
  item:        PlayerItem | null;
  isPlaying:   boolean;
  currentTime: number;
  duration:    number;
  volume:      number;
  shuffle:     boolean;
  repeat:      'off' | 'one' | 'all';
  // Скрыт ли плавающий мини-плеер — сама музыка при этом продолжает играть,
  // скрывается только виджет.
  hidden:      boolean;
  // external control signals (music component reads these)
  seekTo:      number | null;   // set then cleared
  cmdPlay:     boolean | null;  // null = no cmd pending

  // actions
  push:       (item: PlayerItem) => void;
  clear:      () => void;
  hide:       () => void;
  show:       () => void;
  syncTime:   (t: number, dur: number) => void;
  setPlaying: (v: boolean) => void;
  setVolume:  (v: number) => void;
  setShuffle: (v: boolean) => void;
  setRepeat:  (v: 'off' | 'one' | 'all') => void;
  requestSeek:(t: number) => void;
  clearSeek:  () => void;
  requestPlay:(v: boolean) => void;
  clearCmd:   () => void;
  nextTrack:  () => void;
  prevTrack:  () => void;
  playQueueIndex: (idx: number) => void;
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  item:        null,
  isPlaying:   false,
  currentTime: 0,
  duration:    0,
  volume:      0.85,
  shuffle:     false,
  repeat:      'off',
  hidden:      false,
  seekTo:      null,
  cmdPlay:     null,

  // Новый трек всегда возвращает виджет — «скрыть» это «не сейчас», а не
  // «больше никогда не показывай, что играет».
  push:       (item) => set({ item, isPlaying: true, currentTime: 0, hidden: false }),
  clear:      ()     => set({ item: null, isPlaying: false, currentTime: 0, duration: 0 }),
  hide:       ()     => set({ hidden: true }),
  show:       ()     => set({ hidden: false }),
  syncTime:   (t, dur) => set({ currentTime: t, duration: dur }),
  setPlaying: (v)    => set({ isPlaying: v }),
  setVolume:  (v)    => set({ volume: v }),
  setShuffle: (v)    => set({ shuffle: v }),
  setRepeat:  (v)    => set({ repeat: v }),

  requestSeek: (t)   => set({ seekTo: t }),
  clearSeek:   ()    => set({ seekTo: null }),
  requestPlay: (v)   => set({ cmdPlay: v }),
  clearCmd:    ()    => set({ cmdPlay: null }),

  nextTrack: () => {
    const { item, shuffle } = get();
    if (!item?.queue || item.queue.length === 0) return;
    const len = item.queue.length;
    const curIdx = item.qIdx ?? 0;
    let idx: number;
    if (shuffle && len > 1) {
      do { idx = Math.floor(Math.random() * len); } while (idx === curIdx);
    } else {
      idx = curIdx + 1;
      if (idx >= len) {
        if (get().repeat !== 'all') return;
        idx = 0;
      }
    }
    const next = { ...item.queue[idx], queue: item.queue, qIdx: idx };
    set({ item: next, currentTime: 0, isPlaying: true });
  },

  prevTrack: () => {
    const { item, currentTime } = get();
    if (!item?.queue || item.queue.length === 0) return;
    if (currentTime > 3) { set({ seekTo: 0 }); return; }
    const idx = (((item.qIdx ?? 0) - 1) + item.queue.length) % item.queue.length;
    const prev = { ...item.queue[idx], queue: item.queue, qIdx: idx };
    set({ item: prev, currentTime: 0, isPlaying: true });
  },
  playQueueIndex: (idx) => {
    const { item } = get();
    if (!item?.queue || idx < 0 || idx >= item.queue.length) return;
    const next = { ...item.queue[idx], queue: item.queue, qIdx: idx };
    set({ item: next, currentTime: 0, isPlaying: true });
  },
}));
