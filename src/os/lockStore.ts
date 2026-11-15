/**
 * Экран блокировки Sky — настройки (на этом устройстве) и состояние показа.
 * Это экран ВНУТРИ приложения Sky, а не системная блокировка Windows/Android/iOS:
 * пароль системы он не заменяет. Защиту даёт «Замок приложения» (код, Face ID),
 * если человек его включил; без него экран закрывается касанием.
 */
import { create } from 'zustand';
import { apiWeather, type WeatherNow } from '@/bloom/weatherApi';

export type LockWallpaper = 'space' | 'cover' | 'custom';
export interface LockSettings {
  wallpaper: LockWallpaper;
  blur: number;            // 0..40 px (для своей картинки и обложки)
  showMusic: boolean;
  showWeather: boolean;
  showNotifs: boolean;
  /** Текст уведомлений на закрытом экране: по умолчанию выключен — видят все, кто рядом. */
  showNotifText: boolean;
}

const KEY = 'sky:lock:v1';
const DEFAULTS: LockSettings = { wallpaper: 'space', blur: 24, showMusic: true, showWeather: false, showNotifs: true, showNotifText: false };
const read = (): LockSettings => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; } };

interface SettingsState extends LockSettings { set: (p: Partial<LockSettings>) => void }
export const useLockSettings = create<SettingsState>((set, get) => ({
  ...read(),
  set: (p) => {
    set(p);
    const { set: _s, ...rest } = get();
    try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* не критично */ }
  },
}));

/** Ручной показ экрана (сочетание клавиш, кнопка в профиле, остров). */
interface ShowState { open: boolean; show: () => void; hide: () => void }
export const useLockScreen = create<ShowState>((set) => ({ open: false, show: () => set({ open: true }), hide: () => set({ open: false }) }));

/* ── Погода: последняя известная, обновляется только по разрешению геолокации ── */
const WKEY = 'sky:lock:weather';
export const readCachedWeather = (): { w: WeatherNow; at: number } | null => { try { return JSON.parse(localStorage.getItem(WKEY) || 'null'); } catch { return null; } };
/** Запрашивает положение (спросит разрешение один раз) и погоду; вернёт null, если отказано или сервер не ответил. */
export const refreshWeather = async (): Promise<WeatherNow | null> => {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  const pos = await new Promise<GeolocationPosition | null>((res) =>
    navigator.geolocation.getCurrentPosition((p) => res(p), () => res(null), { timeout: 8000, maximumAge: 15 * 60_000 }));
  if (!pos) return null;
  const w = await apiWeather(pos.coords.latitude, pos.coords.longitude);
  if (w) { try { localStorage.setItem(WKEY, JSON.stringify({ w, at: Date.now() })); } catch { /* не критично */ } }
  return w;
};
/** Тихое обновление: только если разрешение уже выдано — окно с вопросом само не появится. */
export const refreshWeatherQuiet = async () => {
  try {
    const st = await (navigator as any).permissions?.query?.({ name: 'geolocation' });
    if (st?.state === 'granted') await refreshWeather();
  } catch { /* браузер не умеет — молчим */ }
};
