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

/**
 * iPhone/iPad (Safari, PWA): медиаэлементы там берут файл через системный загрузчик, который
 * не присылает наши HttpOnly SameSite-куки пропуска — файл отвечает «доступ запрещён», а плеер
 * пишет «браузер не может открыть файл». Поэтому на этих устройствах пропуск едет в адресе (?t=),
 * как и в нативном приложении. Пропуск короткий и узкий: только выдача медиа, 6 часов.
 */
export const IOS_WEB = !NATIVE_APP && typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1));
export const MEDIA_BY_URL = NATIVE_APP || IOS_WEB;

/** Абсолютный адрес API. Пусто в веб-сборке — там пути и так относительные. */
export const API_ORIGIN = NATIVE_APP ? (import.meta.env.VITE_API_ORIGIN ?? '') : '';

/* ─── Резервные адреса API (только родное приложение) ───────────────
   Основной адрес — API_ORIGIN; запасные — VITE_API_FALLBACKS (через запятую, только https).
   Когда основной не отвечает (сеть до него оборвалась / 502-504), запросы уходят на следующий
   живой адрес; раз в минуту основной проверяется /healthz, и как только он снова жив, приложение
   возвращается на него. В вебе (тот же origin) переключать нечего — там список пуст. */
const FALLBACKS = NATIVE_APP
  ? String(import.meta.env.VITE_API_FALLBACKS ?? '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter((x) => /^https:\/\/[^/\s]+$/.test(x) && x !== API_ORIGIN)
  : [];
const ORIGINS = API_ORIGIN ? [API_ORIGIN, ...FALLBACKS] : [];
let active = 0;
let lastSwitch = 0;
const listeners = new Set<(origin: string) => void>();

/** Адрес API, который сейчас считается рабочим. */
export const getApiOrigin = (): string => (NATIVE_APP ? (ORIGINS[active] ?? API_ORIGIN) : '');
export const hasApiFallbacks = ORIGINS.length > 1;
export const onApiOriginChange = (fn: (origin: string) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

const healthy = async (origin: string) => {
  try { return (await fetch(`${origin}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })).ok; }
  catch { return false; }
};
const setActive = (i: number) => {
  if (i === active) return;
  active = i; lastSwitch = Date.now();
  listeners.forEach((fn) => fn(ORIGINS[i]));
};

let switching: Promise<boolean> | null = null;
/** Вызывается при сбое запроса к текущему адресу: ищет следующий живой. true — адрес сменился. */
export const failoverApiOrigin = (): Promise<boolean> => {
  if (ORIGINS.length < 2) return Promise.resolve(false);
  if (switching) return switching;
  const from = active;
  switching = (async () => {
    for (let k = 1; k < ORIGINS.length; k++) {
      const i = (from + k) % ORIGINS.length;
      if (await healthy(ORIGINS[i])) { setActive(i); return true; }
    }
    return false;
  })().finally(() => { switching = null; });
  return switching;
};

if (ORIGINS.length > 1 && typeof window !== 'undefined') {
  setInterval(async () => {
    if (active === 0 || document.hidden || Date.now() - lastSwitch < 60_000) return;
    if (await healthy(ORIGINS[0])) setActive(0);
  }, 60_000);
}

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
      /** Сменная иконка окна и трея (Windows): принимает PNG data:URL. */
      setAppIcon?: (dataUrl: string) => Promise<{ ok: boolean }>;
      /** Прокси приложения (Windows): настоящая маршрутизация через session.setProxy. */
      proxy?: {
        get: () => Promise<{ ok: boolean; encrypted: boolean; cfg: { enabled: boolean; type: 'http' | 'socks5' | 'socks4'; host: string; port: number; username: string; hasPassword: boolean } }>;
        apply: (cfg: { enabled: boolean; type: string; host: string; port: number | string; username?: string; password?: string }) => Promise<{ ok: boolean; error?: string; message?: string }>;
        reach: (cfg: { type: string; host: string; port: number | string }) => Promise<{ ok: boolean; ms?: number; error?: string }>;
      };
      /** Определение запущенных игр (Windows-приложение, только по настройке gameDetect). */
      gameDetect?: {
        set: (on: boolean) => void;
        onDetected: (fn: (gameId: string | null) => void) => () => void;
      };
      /** Установка и запуск игр Sky Game Launcher (Windows-приложение). Менеджер в главном процессе создаётся при первом init. */
      launcher?: {
        init: (o: { apiOrigin: string; token: string }) => Promise<{ ok?: boolean; root?: string; error?: string }>;
        setToken: (t: string) => Promise<boolean>;
        call: (method: string, ...args: unknown[]) => Promise<any>;
        pickFolder: () => Promise<string | null>;
        pauseAll: () => Promise<boolean>;
        onEvent: (fn: (ev: any) => void) => () => void;
        /** Minecraft: установка с серверов Mojang, вход Microsoft, запуск (electron/mclauncher.cjs). */
        mc: (clientId: string, method: string, ...args: unknown[]) => Promise<any>;
        onMcEvent: (fn: (ev: any) => void) => () => void;
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
