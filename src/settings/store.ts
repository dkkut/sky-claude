/* ===============================================================
   SKY SETTINGS  -  настройки приложения
   Реально работающие настройки с сохранением
=============================================================== */
import { startLightNormalizer, stopLightNormalizer } from './lightNormalizer';
import { create } from 'zustand';
import { wireSend } from '@/core/wire';

export type AccentColor = 'blue' | 'purple' | 'green' | 'pink' | 'orange' | 'cyan' | 'red';
export type FontSize    = 'small' | 'normal' | 'large';
export type ThemeMode   = 'dark' | 'amoled' | 'dim';
/* Светлая/тёмная — отдельная ось от ThemeMode: AMOLED и Dim — это
   поднастройки тёмной темы, светлой у них нет. */
export type ColorScheme = 'dark' | 'light';

export const ACCENT_COLORS: Record<AccentColor, { hex: string; bg: string; label: string }> = {
  blue:   { hex: '#4f6ef7', bg: 'rgba(79,110,247,0.12)',  label: 'Синий'     },
  purple: { hex: '#a855f7', bg: 'rgba(168,85,247,0.12)',  label: 'Фиолетовый'},
  green:  { hex: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'Зелёный'   },
  pink:   { hex: '#ec4899', bg: 'rgba(236,72,153,0.12)',  label: 'Розовый'   },
  orange: { hex: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'Оранжевый' },
  cyan:   { hex: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   label: 'Голубой'   },
  red:    { hex: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'Красный'   },
};

export const THEME_MODES: Record<ThemeMode, { bg: string; l1: string; l2: string; l3: string; label: string }> = {
  dark:   { bg:'#111113', l1:'#161618', l2:'#1c1c1f', l3:'#222226', label:'Тёмная' },
  amoled: { bg:'#000000', l1:'#0a0a0a', l2:'#111111', l3:'#161616', label:'AMOLED' },
  dim:    { bg:'#1a1c21', l1:'#1f2128', l2:'#262830', l3:'#2d2f38', label:'Dim' },
};

export const FONT_SIZES: Record<FontSize, { size: string; label: string }> = {
  small:  { size: '13px', label: 'Маленький' },
  normal: { size: '14px', label: 'Обычный'   },
  large:  { size: '16px', label: 'Большой'   },
};

export interface AppSettings {
  // Внешний вид
  colorScheme:     ColorScheme;
  theme:           ThemeMode;
  accent:          AccentColor;
  fontSize:        FontSize;
  animationsOn:    boolean;
  /** Анимация-заставка при запуске приложения. */
  introAnim:       boolean;
  /* Sky Island: где показывать воспроизведение и события. */
  islandMode:      'both' | 'island' | 'side';
  islandNotifs:    boolean;
  islandTracks:    boolean;
  islandDownloads: boolean;
  islandMessages:  boolean;
  /** Сколько секунд висит обычное событие (3–10). */
  islandSeconds:   number;
  /** Что видно в сообщении на острове: всё / только имя / ничего. */
  islandPrivacy:   'full' | 'sender' | 'hidden';
  islandAnim:      'full' | 'simple';
  /* Sky AI на острове. */
  aiManualCall:    boolean;
  aiWake:          boolean;
  aiVoiceAnswers:  boolean;
  aiContinue:      boolean;
  aiIdleEnd:       boolean;
  compactMode:     boolean;
  // Уведомления
  soundMessages:   boolean;
  soundCalls:      boolean;
  soundMentions:   boolean;
  desktopNotifs:   boolean;
  /** Windows-приложение: определять запущенные известные игры и отмечать их как «играет сейчас». */
  gameDetect:      boolean;
  // Мессенджер
  enterToSend:     boolean;
  showReadReceipts:boolean;
  showTyping:      boolean;
  autoDownloadMedia:boolean;
  /* Конфиденциальность.
     hideLastSeen хранится ЗДЕСЬ только для отрисовки галочки. Решает
     сервер: настройка защищает от других, а свой браузер можно
     переписать. Меняется через applyServerPrivacy/wireSend ниже. */
  hideLastSeen:    boolean;
  twoFactorHint:   string;
  language:        'ru' | 'en';
}

const SK = 'sky:settings:v1';
const W  = typeof window !== 'undefined';

const defaults: AppSettings = {
  colorScheme:      'dark',
  theme:            'dark',
  accent:           'blue',
  fontSize:         'normal',
  animationsOn:     true,
  introAnim:        true,
  islandMode:       'both',
  islandNotifs:     true,
  islandTracks:     true,
  islandDownloads:  true,
  islandMessages:   true,
  islandSeconds:    4,
  islandPrivacy:    'sender',
  islandAnim:       'full',
  aiManualCall:     true,
  aiWake:           false,
  aiVoiceAnswers:   true,
  aiContinue:       true,
  aiIdleEnd:        true,
  compactMode:      false,
  soundMessages:    true,
  soundCalls:       true,
  soundMentions:    true,
  desktopNotifs:    false,
  gameDetect:       false,
  enterToSend:      true,
  showReadReceipts: true,
  showTyping:       true,
  autoDownloadMedia:true,
  hideLastSeen:     false,
  twoFactorHint:    '',
  language:         'ru',
};

const load = (): AppSettings => {
  if (!W) return defaults;
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SK) || '{}') }; }
  catch { return defaults; }
};

/* Apply settings to CSS variables */
/** Консоль, ТВ и Car Mode всегда тёмные: на экране в трёх метрах светлая тема даёт тёмный текст на тёмном фоне. */
export const setForceDark = (on: boolean) => {
  if (!W) return;
  document.documentElement.dataset.forceDark = on ? '1' : '';
  applySettings(useSettings.getState().settings);
};

export const applySettings = (input: AppSettings) => {
  if (!W) return;
  const root = document.documentElement;
  const s = root.dataset.forceDark === '1' ? { ...input, colorScheme: 'dark' as const } : input;
  const accent = ACCENT_COLORS[s.accent];
  const font = FONT_SIZES[s.fontSize];

  /* Светлая/тёмная — атрибут на корне, светлую палитру задаёт CSS
     (:root[data-theme='light'] в styles.css). AMOLED/Dim — поднастройки
     самой тёмной темы, у светлой их нет, поэтому инлайновый --bg* ставим
     только в тёмном режиме: иначе он перебил бы светлую палитру из CSS
     (инлайновый style всегда сильнее обычного правила). */
  root.dataset.theme = s.colorScheme;
  if (s.colorScheme === 'light') startLightNormalizer(); else stopLightNormalizer();
  if (s.colorScheme === 'dark') {
    const theme = THEME_MODES[s.theme];
    root.style.setProperty('--bg',    theme.bg);
    root.style.setProperty('--bg-l1', theme.l1);
    root.style.setProperty('--bg-l2', theme.l2);
    root.style.setProperty('--bg-l3', theme.l3);
  } else {
    root.style.removeProperty('--bg');
    root.style.removeProperty('--bg-l1');
    root.style.removeProperty('--bg-l2');
    root.style.removeProperty('--bg-l3');
  }
  root.style.setProperty('--accent',  accent.hex);
  root.style.setProperty('--accent-bg', accent.bg);
  document.body.style.fontSize = font.size;

  // Reduce animations
  if (!s.animationsOn) {
    root.style.setProperty('--motion-duration', '0ms');
  } else {
    root.style.removeProperty('--motion-duration');
  }

  // Компактный режим: плотнее строки и меньше отступы. Раньше тумблер
  // не делал ничего — теперь ставит признак на корне, а размеры
  // подхватывает разметка.
  root.dataset.compact = s.compactMode ? 'on' : 'off';
};

interface SettingsState {
  settings: AppSettings;
  set: (patch: Partial<AppSettings>) => void;
  reset: () => void;
  /** Ответ сервера про приватность — записываем как есть, не спрашивая. */
  applyServerPrivacy: (hideLastSeen: boolean) => void;
}

export const useSettings = create<SettingsState>((setState, get) => {
  const initial = load();
  // Apply on init
  setTimeout(() => applySettings(initial), 0);

  return {
    settings: initial,
    set: (patch) => {
      const next = { ...get().settings, ...patch };
      setState({ settings: next });
      try { localStorage.setItem(SK, JSON.stringify(next)); } catch {}
      applySettings(next);

      // «Был(а) в сети» скрывает сервер, а не браузер: здесь только
      // просьба. Придёт ответ — applyServerPrivacy запишет, как вышло
      // на самом деле.
      // «Скрыть был(а) в сети» — короткая форма настройки «кто видит в
      // сети»: спрятаться от всех или показаться всем. Отдельного
      // признака на сервере нет намеренно — два переключателя одного и
      // того же рано или поздно разошлись бы.
      if (patch.hideLastSeen !== undefined) {
        wireSend({
          type: 'privacy',
          payload: { whoSeesOnline: patch.hideLastSeen ? 'nobody' : 'all' },
        });
      }
    },
    applyServerPrivacy: (hideLastSeen) => {
      const next = { ...get().settings, hideLastSeen };
      setState({ settings: next });
      try { localStorage.setItem(SK, JSON.stringify(next)); } catch {}
    },
    reset: () => {
      setState({ settings: defaults });
      try { localStorage.setItem(SK, JSON.stringify(defaults)); } catch {}
      applySettings(defaults);
    },
  };
});
