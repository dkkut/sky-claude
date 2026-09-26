/* ===============================================================
   Нативное приложение (Android/Windows) — единственное место, где
   поведение веба и приложения расходится.

   Вшитая сборка (VITE_NATIVE_APP=1, см. .env.native, package.json
   "build:native") открывается со своего origin, а не с боевого домена:
   HttpOnly-кука с refresh-токеном туда просто не долетает. Вместо неё
   приложение хранит токен у себя — в Preferences у Capacitor, в
   safeStorage через IPC у Electron — и слит явно на каждый запрос.
   Обычная веб-сборка этот файл не использует: NATIVE_APP всегда false,
   всё как раньше.
=============================================================== */

export const NATIVE_APP = import.meta.env.VITE_NATIVE_APP === '1';

/** Абсолютный адрес API. Пусто в веб-сборке — там пути и так относительные. */
export const API_ORIGIN = NATIVE_APP ? (import.meta.env.VITE_API_ORIGIN ?? '') : '';

/** Состояние единого плеера, которым основное окно Electron делится с overlay Quick Actions. */
export interface SkyPlayerState {
  kind: 'music' | 'podcast' | null;
  title: string;
  author: string;
  coverUrl?: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
}

/** Команда, которую overlay Quick Actions шлёт основному окну — единственному, кто трогает настоящий <audio>. */
export type SkyPlayerCommand =
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'skip'; deltaSec: number };

declare global {
  interface Window {
    Capacitor?: { isNativePlatform?: () => boolean };
    sky?: {
      secureStorage: {
        get: (key: string) => Promise<string | null>;
        set: (key: string, value: string) => Promise<void>;
        remove: (key: string) => Promise<void>;
      };
      quickActions: {
        hide: () => void;
        focusMain: () => void;
        sendPlayerState: (state: SkyPlayerState) => void;
        requestPlayerState: () => void;
        onPlayerState: (fn: (state: SkyPlayerState) => void) => () => void;
        sendPlayerCommand: (cmd: SkyPlayerCommand) => void;
        onPlayerCommand: (fn: (cmd: SkyPlayerCommand) => void) => () => void;
      };
    };
  }
}

const isCapacitor = () => Boolean(window.Capacitor?.isNativePlatform?.());
export const isElectron = () => Boolean(window.sky?.secureStorage);

/**
 * Защищённое хранилище токена — два бэкенда, один и тот же интерфейс.
 * Capacitor: @capacitor/preferences (песочница приложения на Android —
 * тот же уровень защиты, что у Preferences в Telegram Android).
 * Electron: IPC-мост в preload.cjs до safeStorage в главном процессе
 * (шифрование на уровне ОС; сама страница к Node не имеет доступа).
 */
export const nativeStore = {
  async get(key: string): Promise<string | null> {
    if (!NATIVE_APP) return null;
    if (isCapacitor()) {
      const { Preferences } = await import('@capacitor/preferences');
      const { value } = await Preferences.get({ key });
      return value ?? null;
    }
    if (isElectron()) return window.sky!.secureStorage.get(key);
    return null;
  },

  async set(key: string, value: string): Promise<void> {
    if (!NATIVE_APP) return;
    if (isCapacitor()) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
      return;
    }
    if (isElectron()) await window.sky!.secureStorage.set(key, value);
  },

  async remove(key: string): Promise<void> {
    if (!NATIVE_APP) return;
    if (isCapacitor()) {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
      return;
    }
    if (isElectron()) await window.sky!.secureStorage.remove(key);
  },
};

/** Ключи в хранилище — оба под одним неймспейсом, чтобы не путать с чем-то ещё. */
export const REFRESH_TOKEN_KEY = 'sky_refresh_token';
export const BETA_TOKEN_KEY = 'sky_beta_token';
