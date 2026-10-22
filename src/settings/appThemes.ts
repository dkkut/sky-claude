/* ===============================================================
   СМЕННЫЕ ТЕМЫ ПРИЛОЖЕНИЯ — готовые наборы «светлая/тёмная + подтема + акцент» одним нажатием.
   Это не новая система: пресет лишь выставляет уже существующие настройки (colorScheme, theme, accent),
   поэтому всё остальное приложение (переменные, светлый нормализатор, сезонные темы) работает как раньше.
   Выбор пресета выключает сезонную тему и автопереключение по времени — иначе они тут же перекрасили бы выбранное.
=============================================================== */
import type { AccentColor, AppSettings, ColorScheme, ThemeMode } from './store';

export interface AppThemePreset {
  id: string;
  name: string;
  scheme: ColorScheme;
  mode: ThemeMode;
  accent: AccentColor;
  /** Цвета миниатюры: фон, панель, акцент. */
  swatch: [string, string, string];
}

export const APP_THEMES: AppThemePreset[] = [
  { id: 'sky',      name: 'Sky',       scheme: 'dark',  mode: 'dark',   accent: 'blue',   swatch: ['#111113', '#1c1c1f', '#4f6ef7'] },
  { id: 'midnight', name: 'Полночь',   scheme: 'dark',  mode: 'amoled', accent: 'purple', swatch: ['#000000', '#111111', '#a855f7'] },
  { id: 'ocean',    name: 'Океан',     scheme: 'dark',  mode: 'dim',    accent: 'cyan',   swatch: ['#1a1c21', '#262830', '#06b6d4'] },
  { id: 'forest',   name: 'Лес',       scheme: 'dark',  mode: 'dim',    accent: 'green',  swatch: ['#1a1c21', '#262830', '#22c55e'] },
  { id: 'sunset',   name: 'Закат',     scheme: 'dark',  mode: 'dark',   accent: 'orange', swatch: ['#111113', '#1c1c1f', '#f97316'] },
  { id: 'rose',     name: 'Роза',      scheme: 'dark',  mode: 'amoled', accent: 'pink',   swatch: ['#000000', '#111111', '#ec4899'] },
  { id: 'ruby',     name: 'Рубин',     scheme: 'dark',  mode: 'dark',   accent: 'red',    swatch: ['#111113', '#1c1c1f', '#ef4444'] },
  { id: 'day',      name: 'День',      scheme: 'light', mode: 'dark',   accent: 'blue',   swatch: ['#f4f5f7', '#ffffff', '#4f6ef7'] },
  { id: 'mint',     name: 'Мята',      scheme: 'light', mode: 'dark',   accent: 'green',  swatch: ['#f4f5f7', '#ffffff', '#22c55e'] },
  { id: 'peach',    name: 'Персик',    scheme: 'light', mode: 'dark',   accent: 'orange', swatch: ['#f4f5f7', '#ffffff', '#f97316'] },
  { id: 'lilac',    name: 'Сирень',    scheme: 'light', mode: 'dark',   accent: 'purple', swatch: ['#f4f5f7', '#ffffff', '#a855f7'] },
  { id: 'sakura',   name: 'Сакура',    scheme: 'light', mode: 'dark',   accent: 'pink',   swatch: ['#f4f5f7', '#ffffff', '#ec4899'] },
];

/** Какой пресет совпадает с текущими настройками (подтема у светлой темы не учитывается — её у неё нет). */
export const activeAppTheme = (s: Pick<AppSettings, 'colorScheme' | 'theme' | 'accent' | 'season'>): string | null => {
  if (s.season && s.season !== 'none') return null;
  const p = APP_THEMES.find((t) => t.scheme === s.colorScheme && t.accent === s.accent && (t.scheme === 'light' || t.mode === s.theme));
  return p?.id ?? null;
};

export const appThemePatch = (p: AppThemePreset): Partial<AppSettings> => ({
  colorScheme: p.scheme,
  // у светлой темы подтему не трогаем: вернувшись в тёмную, человек увидит свою прежнюю
  ...(p.scheme === 'dark' ? { theme: p.mode } : {}),
  accent: p.accent,
  season: 'none',
  autoTheme: false,
});
