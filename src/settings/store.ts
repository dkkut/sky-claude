/* ===============================================================
   SKY SETTINGS  -  настройки приложения
   Реально работающие настройки с сохранением
=============================================================== */
import { create } from 'zustand';
import { wireSend } from '@/core/wire';

export type AccentColor = 'blue' | 'purple' | 'green' | 'pink' | 'orange' | 'cyan' | 'red';
export type FontSize    = 'small' | 'normal' | 'large';
export type ThemeMode   = 'dark' | 'amoled' | 'dim';

export const ACCENT_COLORS: Record<AccentColor, { hex: string; bg: string; label: string }> = {
  blue:   { hex: '#4f6ef7', bg: 'rgba(79,110,247,0.12)',  label: 'Синий'     },
  purple: { hex: '#a855f7', bg: 'rgba(168,85,247,0.12)',  label: 'Фиолетовый'},
  green:  { hex: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: 'Зелёный'   },
  pink:   { hex: '#ec4899', bg: 'rgba(236,72,153,0.12)',  label: 'Розовый'   },
  orange: { hex: '#f97316', bg: 'rgba(249,115,22,0.12)',  label: 'Оранжевый' },
  cyan:   { hex: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   label: 'Голубой'   },
  red:    { hex: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: 'Красный'   },
};

export const THEME_MODES: Record<ThemeMode, { bg: string; l1: string; l2: string; l3: string; label: string; icon: string }> = {
  dark:   { bg:'#111113', l1:'#161618', l2:'#1c1c1f', l3:'#222226', label:'Тёмная',  icon:'🌙' },
  amoled: { bg:'#000000', l1:'#0a0a0a', l2:'#111111', l3:'#161616', label:'AMOLED',  icon:'⚫' },
  dim:    { bg:'#1a1c21', l1:'#1f2128', l2:'#262830', l3:'#2d2f38', label:'Dim',     icon:'🌫' },
};

export const FONT_SIZES: Record<FontSize, { size: string; label: string }> = {
  small:  { size: '13px', label: 'Маленький' },
  normal: { size: '14px', label: 'Обычный'   },
  large:  { size: '16px', label: 'Большой'   },
};

export interface AppSettings {
  // Внешний вид
  theme:           ThemeMode;
  accent:          AccentColor;
  fontSize:        FontSize;
  animationsOn:    boolean;
  compactMode:     boolean;
  // Уведомления
  soundMessages:   boolean;
  soundCalls:      boolean;
  soundMentions:   boolean;
  desktopNotifs:   boolean;
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
  theme:            'dark',
  accent:           'blue',
  fontSize:         'normal',
  animationsOn:     true,
  compactMode:      false,
  soundMessages:    true,
  soundCalls:       true,
  soundMentions:    true,
  desktopNotifs:    false,
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
export const applySettings = (s: AppSettings) => {
  if (!W) return;
  const root = document.documentElement;
  const theme = THEME_MODES[s.theme];
  const accent = ACCENT_COLORS[s.accent];
  const font = FONT_SIZES[s.fontSize];

  root.style.setProperty('--bg',      theme.bg);
  root.style.setProperty('--bg-l1',   theme.l1);
  root.style.setProperty('--bg-l2',   theme.l2);
  root.style.setProperty('--bg-l3',   theme.l3);
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
      if (patch.hideLastSeen !== undefined) {
        wireSend({ type: 'privacy', payload: { hideLastSeen: patch.hideLastSeen } });
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
