/**
 * Открыть переданный материал НА ЭТОМ устройстве с точного места. Ничего не проигрывает само: вызывает те же плееры и те же «дипссылки», что уже есть в Sky
 * (playMusicQueue, usePodcastPlayer.play, pendingExtrasItemId, TV-стек, экраны Car), а место передаёт через `useHandoffStart` — разовую запись, которую
 * плеер забирает при открытии. Так перемотка не зависит от того, успел ли обновиться локальный кэш прогресса.
 */
import { create } from 'zustand';
import { useModuleStore } from '@/data/state/modules';
import { usePlayerStore } from '@/player/playerStore';
import { usePlayer as usePodcastPlayer } from '@/podcasts/playerStore';
import { apiEpisode } from '@/podcasts/podcastApi';
import { apiTrack, toClientTrack } from '@/music/musicApi';
import { playMusicQueue } from '@/music/useMusicSync';
import { useMusicStore } from '@/music/serverStore';
import { useFilmStore } from '@/film/serverStore';
import { useTVNavStore } from '@/interface/tv/tvNavStore';
import { recordProgress } from '@/interface/tv/watchProgressStore';
import type { Handoff, HKind } from './handoffApi';

export interface StartPoint { kind: HKind; id: string; position: number; extra: Record<string, number | string | null>; title: string; at: number }
interface S {
  start: StartPoint | null;
  /** Для оболочек со своим состоянием экранов (Car): «открой раздел / материал». Забирается один раз. */
  carOpen: StartPoint | null;
  set: (p: StartPoint | null) => void;
  setCar: (p: StartPoint | null) => void;
}
export const useHandoffStart = create<S>((set) => ({ start: null, carOpen: null, set: (p) => set({ start: p }), setCar: (p) => set({ carOpen: p }) }));

/** Забрать место для материала (один раз, не старше минуты). */
export const takeStart = (kind: HKind, id: string): StartPoint | null => {
  const s = useHandoffStart.getState().start;
  if (!s || s.kind !== kind || s.id !== id || Date.now() - s.at > 60_000) return null;
  useHandoffStart.getState().set(null);
  return s;
};

const mode = () => (typeof document !== 'undefined' ? document.documentElement.dataset.skyMode ?? '' : '');

/** Дождаться, пока трек/выпуск загрузится, и перемотать — как делает useMusicSync, но по месту из передачи. */
const seekWhenReady = (match: () => boolean, getDur: () => number, seek: (t: number) => void, at: number) => {
  if (at < 3) return;
  let tries = 0;
  const t = window.setInterval(() => {
    tries += 1;
    if (match() && getDur() > 0) { window.clearInterval(t); seek(Math.min(at, Math.max(0, getDur() - 3))); }
    else if (tries > 60) window.clearInterval(t);
  }, 250);
};

export interface OpenResult { ok: boolean; message?: string }

export const openContent = async (h: Handoff, position: number, extra?: Record<string, number | string | null>): Promise<OpenResult> => {
  const m = mode();
  const point: StartPoint = { kind: h.kind, id: h.itemId, position, extra: extra ?? h.extra ?? {}, title: h.title, at: Date.now() };
  useHandoffStart.getState().set(point);
  const mod = useModuleStore.getState();

  if (h.kind === 'music') {
    const t = await apiTrack(h.itemId);
    if (!t) return { ok: false, message: 'Трек недоступен.' };
    useMusicStore.setState((s) => ({ progress: { ...s.progress, [h.itemId]: Math.floor(position) } }));   // чтобы прежнее «вернуться на место» не перемотало на устаревшее
    playMusicQueue([toClientTrack(t)], h.itemId);
    seekWhenReady(() => usePlayerStore.getState().item?.id === h.itemId, () => usePlayerStore.getState().duration, (x) => usePlayerStore.getState().requestSeek(x), position);
    if (m === 'car') useHandoffStart.getState().setCar(point);
    return { ok: true };
  }
  if (h.kind === 'podcast') {
    const ep = await apiEpisode(h.itemId);
    if (!ep) return { ok: false, message: 'Выпуск недоступен.' };
    await usePodcastPlayer.getState().play(ep, { at: Math.floor(position) });
    return { ok: true };
  }
  if (h.kind === 'film') {
    useFilmStore.setState((s) => ({ progress: { ...s.progress, [h.itemId]: Math.floor(position) } }));
    if (m === 'tv') { recordProgress(h.itemId, position, h.duration || position + 60); useTVNavStore.getState().push({ kind: 'player', movieId: h.itemId }); return { ok: true }; }
    if (m === 'car') { useHandoffStart.getState().setCar(point); return { ok: true }; }
    mod.setActiveModule('extras'); mod.setPendingExtrasTab('movies'); mod.setPendingExtrasItemId(h.itemId);
    return { ok: true };
  }
  if (h.kind === 'video') {
    if (m === 'tv') { useTVNavStore.getState().push({ kind: 'player', movieId: h.itemId }); return { ok: true }; }
    if (m === 'car') { useHandoffStart.getState().setCar(point); return { ok: true }; }
    mod.setActiveModule('video');
    return { ok: true };
  }
  if (h.kind === 'book') {
    if (m === 'tv') return { ok: false, message: 'На ТВ книги не открываются.' };
    if (m === 'car') { if (point.extra.mode !== 'audio') return { ok: false, message: 'В машине книгу можно только слушать.' }; useHandoffStart.getState().setCar(point); return { ok: true }; }
    mod.setActiveModule('extras'); mod.setPendingExtrasTab('books'); mod.setPendingExtrasItemId(h.itemId);
    return { ok: true };
  }
  return { ok: false, message: 'Неизвестный материал.' };
};
