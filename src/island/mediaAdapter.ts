/**
 * Единый вид «что сейчас играет» для острова и бокового мини-плеера.
 * Ничего не проигрывает сам: читает и командует настоящими плеерами —
 * usePlayerStore (музыка/ТВ/голос), usePlayer (подкасты) и элементами,
 * зарегистрированными через mediaRegistry (кино, SkyVideo, книги).
 */
import { useMemo } from 'react';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { epCoverUrl } from '@/podcasts/podcastApi';
import { useMediaRegistry } from './mediaRegistry';
import { useModuleStore } from '@/data/state/modules';

export type NowKind = 'music' | 'podcast' | 'film' | 'video' | 'book' | 'tv' | 'voice';

export interface NowPlaying {
  /** Стабильный ключ «трека»: меняется со сменой дорожки. */
  key: string;
  kind: NowKind;
  title: string;
  subtitle: string;
  cover?: string;
  playing: boolean;
  current: number;
  duration: number;
  error: boolean;
  canSeek: boolean;
  canPrev: boolean;
  canNext: boolean;
  /** Скорость подкаста; undefined — плеер её не поддерживает. */
  rate?: number;
  toggle: () => void;
  prev: () => void;
  next: () => void;
  seek: (sec: number) => void;
  setRate?: (r: number) => void;
  /** Полностью завершить воспроизведение (голосовые: крестик на острове). */
  stop?: () => void;
  open: () => void;
}

const SOURCE_LABEL: Record<NowKind, string> = {
  music: 'Sky Music', podcast: 'Подкасты', film: 'Кино', video: 'SkyVideo', book: 'Книги', tv: 'Sky TV', voice: 'Голосовое',
};
export const sourceLabel = (k: NowKind) => SOURCE_LABEL[k];

const openExtras = (tab: string) => () => {
  useModuleStore.getState().setActiveModule('extras');
  useModuleStore.getState().setPendingExtrasTab(tab);
};

/** Чистая сборка из снимков хранилищ — удобно проверять без React. */
export const pickNowPlaying = (): NowPlaying | null => {
  const reg = Object.values(useMediaRegistry.getState().entries);
  const regPlaying = reg.filter((e) => e.playing).sort((a, b) => b.at - a.at)[0];
  const pod = usePodcastPlayer.getState();
  const mus = usePlayerStore.getState();

  if (regPlaying) return fromRegistry(regPlaying);
  if (pod.episode && pod.playing) return fromPodcast();
  if (mus.item && mus.isPlaying) return fromMusic();
  // Ничего не играет: показываем то, что поставлено на паузу последним.
  const regPaused = reg.filter((e) => !e.error).sort((a, b) => b.at - a.at)[0];
  if (regPaused && regPaused.at > 0) return fromRegistry(regPaused);
  if (pod.episode) return fromPodcast();
  if (mus.item) return fromMusic();
  return null;
};

const fromMusic = (): NowPlaying => {
  const s = usePlayerStore.getState();
  const it = s.item!;
  const q = it.queue?.length ?? 0;
  const idx = it.qIdx ?? 0;
  const kind: NowKind = it.kind === 'tv' ? 'tv' : it.kind === 'voice' ? 'voice' : it.kind === 'podcast' ? 'podcast' : it.kind === 'video' ? 'video' : 'music';
  return {
    key: `m:${it.id}`, kind, title: it.title, subtitle: it.author, cover: it.coverUrl,
    playing: s.isPlaying, current: s.currentTime, duration: s.duration || it.duration || 0, error: false,
    canSeek: kind !== 'tv', canPrev: q > 1, canNext: q > 1 && (idx < q - 1 || s.repeat === 'all' || s.shuffle),
    toggle: () => usePlayerStore.getState().requestPlay(!usePlayerStore.getState().isPlaying),
    prev: () => usePlayerStore.getState().prevTrack(),
    next: () => usePlayerStore.getState().nextTrack(),
    seek: (t) => usePlayerStore.getState().requestSeek(t),
    open: () => { usePlayerStore.getState().show(); if (kind === 'music') openExtras('music')(); },
  };
};

const fromPodcast = (): NowPlaying => {
  const p = usePodcastPlayer.getState();
  const ep = p.episode!;
  return {
    key: `p:${ep.id}`, kind: 'podcast', title: ep.title, subtitle: ep.podcastTitle ?? '',
    cover: ep.hasCover ? epCoverUrl(ep.id) : undefined,
    playing: p.playing, current: p.currentTime, duration: p.duration || ep.duration || 0, error: !!p.error,
    canSeek: true, canPrev: false, canNext: false, rate: p.rate,
    toggle: () => usePodcastPlayer.getState().toggle(),
    prev: () => usePodcastPlayer.getState().skip(-15),
    next: () => usePodcastPlayer.getState().skip(30),
    seek: (t) => usePodcastPlayer.getState().seek(t),
    setRate: (r) => usePodcastPlayer.getState().setRate(r),
    open: () => { usePodcastPlayer.getState().setExpanded(true); openExtras('podcasts')(); },
  };
};

const fromRegistry = (e: ReturnType<typeof useMediaRegistry.getState>['entries'][string]): NowPlaying => ({
  key: `r:${e.id}`, kind: e.kind, title: e.title, subtitle: e.subtitle ?? '', cover: e.cover,
  playing: e.playing, current: e.current, duration: e.duration, error: e.error,
  canSeek: e.canSeek !== false && e.duration > 0, canPrev: false, canNext: false,
  toggle: () => { if (e.el.paused) void e.el.play().catch(() => useMediaRegistry.getState().patch(e.id, { error: true })); else e.el.pause(); },
  prev: () => { e.el.currentTime = Math.max(0, e.el.currentTime - 10); },
  next: () => { e.el.currentTime = Math.min(e.el.duration || e.el.currentTime + 10, e.el.currentTime + 10); },
  seek: (t) => { e.el.currentTime = t; },
  open: () => e.open?.(),
  ...(e.kind === 'voice' ? {
    rate: e.el.playbackRate || 1,
    setRate: (r: number) => { e.el.playbackRate = r; },
    stop: () => { e.el.pause(); try { e.el.currentTime = 0; } catch { /* ещё не загружено */ } },
  } : {}),
});

/** Подписка: пересчёт при любом изменении источников. */
export const useNowPlaying = (): NowPlaying | null => {
  const m = usePlayerStore((s) => s);
  const p = usePodcastPlayer((s) => s);
  const r = useMediaRegistry((s) => s.entries);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => pickNowPlaying(), [m.item, m.isPlaying, m.currentTime, m.duration, p.episode, p.playing, p.currentTime, p.duration, p.rate, p.error, r]);
};
