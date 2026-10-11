/**
 * Нативные кнопки и карточка «сейчас играет» в приложении Android.
 *
 * Веб-версия показывает трек через Media Session API (экран блокировки,
 * наушники, клавиши Windows — это делает сам браузер/Electron). В WebView
 * Android такого уведомления нет, поэтому здесь поднимается настоящее
 * медиа-уведомление: название, исполнитель, источник (Sky Music), обложка
 * (или логотип Sky), кнопки «назад / пауза / вперёд», перемотка и кнопки
 * гарнитуры. Вне Android-приложения модуль ничего не делает.
 */
import { Capacitor } from '@capacitor/core';
import { NATIVE_APP, API_ORIGIN } from '@/core/nativeApp';

export const isAndroidApp = () => NATIVE_APP && Capacitor.getPlatform() === 'android';

export interface NativeMediaInfo {
  id: string; title: string; artist: string; album: string; cover?: string;
  duration: number; elapsed: number; isPlaying: boolean; hasPrev: boolean; hasNext: boolean;
}

export interface NativeMediaHandlers {
  play: () => void; pause: () => void; next: () => void; prev: () => void; seek: (sec: number) => void;
}

type Plugin = typeof import('capacitor-music-controls-plugin')['CapacitorMusicControls'];
let plugin: Plugin | null = null;
let created = '';
let listening = false;
let handlers: NativeMediaHandlers | null = null;

const load = async (): Promise<Plugin | null> => {
  if (plugin) return plugin;
  try { plugin = (await import('capacitor-music-controls-plugin')).CapacitorMusicControls; } catch { plugin = null; }
  return plugin;
};

/** Адрес обложки для системы: абсолютный; без обложки — логотип Sky. */
export const nativeCover = (cover?: string) => {
  const u = cover || '/logo.png';
  return /^https?:/.test(u) ? u : `${API_ORIGIN}${u}`;
};

const onEvent = (info: { message?: string; position?: number }) => {
  const h = handlers;
  if (!h) return;
  switch (info?.message) {
    case 'music-controls-next': h.next(); break;
    case 'music-controls-previous': h.prev(); break;
    case 'music-controls-pause': h.pause(); break;
    case 'music-controls-play': h.play(); break;
    case 'music-controls-seek-to': h.seek(Number(info.position) || 0); break;
    case 'music-controls-headset-unplugged': h.pause(); break;
    default: break;
  }
};

export const nativeMediaSet = async (info: NativeMediaInfo | null, h: NativeMediaHandlers) => {
  if (!isAndroidApp()) return;
  handlers = h;
  const p = await load();
  if (!p) return;
  try {
    if (!listening) {
      listening = true;
      // На Android события приходят как DOM-событие (см. README плагина), на iOS — через addListener.
      document.addEventListener('controlsNotification', ((e: Event) => {
        const d = e as unknown as { message?: string; position?: number };
        onEvent({ message: d.message ?? (e as CustomEvent).detail?.message, position: d.position ?? (e as CustomEvent).detail?.position });
      }) as EventListener);
    }
    if (!info) {
      if (created) { created = ''; await p.destroy(); }
      return;
    }
    if (created !== info.id) {
      created = info.id;
      await p.create({
        track: info.title, artist: info.artist, album: info.album, cover: nativeCover(info.cover),
        isPlaying: info.isPlaying, dismissable: false, hasPrev: info.hasPrev, hasNext: info.hasNext,
        hasClose: false, hasScrubbing: true, duration: Math.floor(info.duration), elapsed: Math.floor(info.elapsed),
        ticker: `${info.title} — ${info.artist}`,
      });
    } else {
      p.updateIsPlaying({ isPlaying: info.isPlaying });
    }
  } catch { /* плагин недоступен — остаются обычные кнопки на экране */ }
};

export const nativeMediaElapsed = async (elapsed: number, isPlaying: boolean) => {
  if (!isAndroidApp() || !created || !plugin) return;
  try { plugin.updateElapsed({ elapsed: Math.floor(elapsed), isPlaying }); } catch { /* не критично */ }
};
