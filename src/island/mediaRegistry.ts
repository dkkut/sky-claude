/**
 * Реестр «живых» медиа, у которых нет общего хранилища (кино, SkyVideo,
 * аудиокниги). Плеер при монтировании регистрирует свой настоящий
 * <video>/<audio>; остров управляет именно им — второго плеера нет.
 * Музыка/подкасты/ТВ берутся напрямую из usePlayerStore и usePlayer
 * (см. mediaAdapter.ts).
 */
import { create } from 'zustand';
import { useEffect, type RefObject } from 'react';

export type RegKind = 'film' | 'video' | 'book' | 'voice';

export interface RegMeta {
  id: string;
  kind: RegKind;
  title: string;
  subtitle?: string;
  cover?: string;
  /** Показывать в острове перемотку: у прямых эфиров её нет. */
  canSeek?: boolean;
  /** Открыть экран плеера (вернуться к воспроизведению). */
  open?: () => void;
}

export interface RegEntry extends RegMeta {
  playing: boolean;
  current: number;
  duration: number;
  error: boolean;
  el: HTMLMediaElement;
  /** Когда запись в последний раз играла — чтобы выбрать главную. */
  at: number;
}

interface RegState {
  entries: Record<string, RegEntry>;
  upsert: (e: RegEntry) => void;
  patch: (id: string, p: Partial<RegEntry>) => void;
  remove: (id: string) => void;
}

export const useMediaRegistry = create<RegState>((set) => ({
  entries: {},
  upsert: (e) => set((s) => ({ entries: { ...s.entries, [e.id]: e } })),
  patch: (id, p) => set((s) => (s.entries[id] ? { entries: { ...s.entries, [id]: { ...s.entries[id], ...p } } } : s)),
  remove: (id) => set((s) => { const rest = { ...s.entries }; delete rest[id]; return { entries: rest }; }),
}));

/**
 * Подключает настоящий медиа-элемент к реестру. Обновления — по событиям
 * элемента, но не чаще 4 раз в секунду, чтобы остров не перерисовывался
 * на каждый кадр.
 */
export const useRegisterMedia = (
  ref: RefObject<HTMLMediaElement | null>,
  meta: RegMeta | null,
) => {
  const key = meta ? `${meta.kind}:${meta.id}` : '';
  const title = meta?.title ?? '';
  const subtitle = meta?.subtitle;
  const cover = meta?.cover;
  const canSeek = meta?.canSeek;
  const open = meta?.open;
  useEffect(() => {
    if (!meta) return undefined;
    let el: HTMLMediaElement | null = null;
    let raf = 0;
    let tries = 0;
    let last = 0;
    const regId = key;
    const read = (): Partial<RegEntry> => ({
      playing: !!el && !el.paused && !el.ended,
      current: el?.currentTime ?? 0,
      duration: Number.isFinite(el?.duration) ? (el?.duration ?? 0) : 0,
    });
    const onAny = () => { useMediaRegistry.getState().patch(regId, { ...read(), at: Date.now() }); };
    const onTime = () => {
      const now = performance.now();
      if (now - last < 250) return;
      last = now;
      useMediaRegistry.getState().patch(regId, read());
    };
    const onError = () => { useMediaRegistry.getState().patch(regId, { error: true, playing: false }); };
    const attach = () => {
      el = ref.current;
      if (!el) { tries += 1; if (tries < 40) raf = requestAnimationFrame(attach); return; }
      useMediaRegistry.getState().upsert({
        ...meta, id: regId, playing: false, current: 0, duration: 0, error: false, el, at: 0,
        ...read(),
      } as RegEntry);
      for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'seeked', 'playing', 'ratechange']) el.addEventListener(ev, onAny);
      el.addEventListener('timeupdate', onTime);
      el.addEventListener('error', onError);
    };
    attach();
    return () => {
      cancelAnimationFrame(raf);
      if (el) {
        for (const ev of ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'seeked', 'playing', 'ratechange']) el.removeEventListener(ev, onAny);
        el.removeEventListener('timeupdate', onTime);
        el.removeEventListener('error', onError);
      }
      useMediaRegistry.getState().remove(regId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, title, subtitle, cover, canSeek, open, ref]);
};
