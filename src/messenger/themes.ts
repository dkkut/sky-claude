/* ===============================================================
   CHAT THEMES  -  сменные темы чата
   Хранит тему per-chat в localStorage
=============================================================== */
import { create } from 'zustand';

export type ChatThemeId =
  | 'default'
  | 'midnight'
  | 'space'
  | 'forest'
  | 'ocean'
  | 'sunset'
  | 'aurora'
  | 'cherry'
  | 'monochrome'
  | 'vapor'
  | 'daylight'
  | 'peach'
  | 'mint'
  | 'lavender'
  | 'custom';

export interface ChatTheme {
  id:          ChatThemeId;
  name:        string;
  preview:     string[];           // 2-3 gradient colors for preview swatch
  bg:          string;             // chat area background
  bgImage?:    string;             // CSS background-image (pattern or gradient)
  bgSize?:     string;
  panel:       string;             // header + input panel bg
  mine:        string;             // sent bubble background
  other:       string;             // received bubble background
  mineText:    string;
  otherText:   string;
  accent:      string;
  border:      string;
  inputBg:     string;
  liquidColor: string;             // liquid glass cursor color
  /** Светлая тема: на корне чата переопределяются переменные текста и границ, см. LIGHT_VARS. */
  light?:      boolean;
}

/** Переменные интерфейса для светлых тем — те же значения, что у
 *  :root[data-theme='light'] в styles.css, чтобы тексты внутри чата
 *  читались на светлом фоне независимо от общей темы приложения. */
export const LIGHT_VARS: Record<string, string> = {
  '--t1': '#15161a', '--t2': '#5b5d68', '--t3': '#8d909b', '--t4': '#c7c9d0',
  '--bg-l1': '#ffffff', '--bg-l2': '#eceef1', '--bg-l3': '#e1e3e8', '--bg-l4': '#d2d5db',
  '--border': 'rgba(15,15,20,0.08)', '--border-m': 'rgba(15,15,20,0.14)', '--border-s': 'rgba(15,15,20,0.22)',
};

export const THEMES: ChatTheme[] = [
  {
    id: 'default', name: 'Sky Dark',
    preview: ['#0d0d0f','#2563eb','#1e1e26'],
    bg: '#0d0d0f',
    bgImage: 'radial-gradient(circle at 1px 1px, rgba(91,155,209,0.04) 1px, transparent 0)',
    bgSize: '32px 32px',
    panel: '#121215', mine: 'linear-gradient(135deg,#1d4ed8,#2563eb)',
    other: '#1e1e26', mineText: '#ffffff', otherText: '#f0f0f2',
    accent: '#5b9bd1', border: 'rgba(255,255,255,0.05)',
    inputBg: '#1e1e24', liquidColor: 'rgba(91,155,209,0.35)',
  },
  {
    id: 'midnight', name: 'Midnight',
    preview: ['#090910','#1a1030','#a855f7'],
    bg: '#090910',
    bgImage: 'radial-gradient(ellipse at 20% 50%, rgba(168,85,247,0.07) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(79,110,247,0.07) 0%, transparent 50%)',
    panel: '#0f0f1a', mine: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
    other: '#16162a', mineText: '#ffffff', otherText: '#e8e8f0',
    accent: '#a855f7', border: 'rgba(168,85,247,0.1)',
    inputBg: '#16162a', liquidColor: 'rgba(168,85,247,0.4)',
  },
  {
    id: 'space', name: 'Deep Space',
    preview: ['#040611','#0a1628','#1e3a5f'],
    bg: '#040611',
    bgImage: `radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,0.9) 0%, transparent 0%),
      radial-gradient(1px 1px at 30% 5%, rgba(255,255,255,0.7) 0%, transparent 0%),
      radial-gradient(1px 1px at 55% 25%, rgba(255,255,255,0.8) 0%, transparent 0%),
      radial-gradient(1px 1px at 75% 8%, rgba(255,255,255,0.6) 0%, transparent 0%),
      radial-gradient(1px 1px at 90% 35%, rgba(255,255,255,0.9) 0%, transparent 0%),
      radial-gradient(1px 1px at 20% 60%, rgba(255,255,255,0.7) 0%, transparent 0%),
      radial-gradient(1px 1px at 45% 75%, rgba(255,255,255,0.5) 0%, transparent 0%),
      radial-gradient(1px 1px at 65% 55%, rgba(255,255,255,0.8) 0%, transparent 0%),
      radial-gradient(1px 1px at 85% 70%, rgba(255,255,255,0.6) 0%, transparent 0%),
      radial-gradient(ellipse at 50% 50%, rgba(30,58,95,0.5) 0%, transparent 70%)`,
    panel: '#080c18', mine: 'linear-gradient(135deg,#1d4ed8,#1e3a5f)',
    other: '#0e1628', mineText: '#ffffff', otherText: '#c8d8f0',
    accent: '#4a9eff', border: 'rgba(74,158,255,0.1)',
    inputBg: '#0e1628', liquidColor: 'rgba(74,158,255,0.4)',
  },
  {
    id: 'forest', name: 'Forest',
    preview: ['#071410','#0f2d1f','#22c55e'],
    bg: '#071410',
    bgImage: 'radial-gradient(ellipse at 10% 90%, rgba(34,197,94,0.08) 0%, transparent 50%), radial-gradient(ellipse at 90% 10%, rgba(16,185,129,0.06) 0%, transparent 50%)',
    panel: '#0a1c16', mine: 'linear-gradient(135deg,#15803d,#166534)',
    other: '#0f2219', mineText: '#ffffff', otherText: '#d1fae5',
    accent: '#22c55e', border: 'rgba(34,197,94,0.1)',
    inputBg: '#0f2219', liquidColor: 'rgba(34,197,94,0.35)',
  },
  {
    id: 'ocean', name: 'Ocean',
    preview: ['#051620','#063652','#0ea5e9'],
    bg: '#051620',
    bgImage: 'repeating-linear-gradient(0deg, transparent, transparent 40px, rgba(14,165,233,0.03) 40px, rgba(14,165,233,0.03) 41px), repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(14,165,233,0.03) 40px, rgba(14,165,233,0.03) 41px)',
    panel: '#071d2a', mine: 'linear-gradient(135deg,#0369a1,#0ea5e9)',
    other: '#0c2535', mineText: '#ffffff', otherText: '#e0f2fe',
    accent: '#0ea5e9', border: 'rgba(14,165,233,0.1)',
    inputBg: '#0c2535', liquidColor: 'rgba(14,165,233,0.4)',
  },
  {
    id: 'sunset', name: 'Sunset',
    preview: ['#1a0a00','#7c2d12','#f97316'],
    bg: '#1a0a00',
    bgImage: 'radial-gradient(ellipse at 50% 100%, rgba(249,115,22,0.15) 0%, transparent 60%), radial-gradient(ellipse at 80% 0%, rgba(239,68,68,0.08) 0%, transparent 50%)',
    panel: '#200d00', mine: 'linear-gradient(135deg,#c2410c,#ea580c)',
    other: '#2d1200', mineText: '#ffffff', otherText: '#fed7aa',
    accent: '#f97316', border: 'rgba(249,115,22,0.12)',
    inputBg: '#2d1200', liquidColor: 'rgba(249,115,22,0.4)',
  },
  {
    id: 'aurora', name: 'Aurora',
    preview: ['#020f0a','#064e3b','#10b981'],
    bg: '#020f0a',
    bgImage: 'radial-gradient(ellipse at 0% 50%, rgba(16,185,129,0.12) 0%, transparent 50%), radial-gradient(ellipse at 100% 50%, rgba(6,182,212,0.1) 0%, transparent 50%), radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.08) 0%, transparent 50%)',
    panel: '#041510', mine: 'linear-gradient(135deg,#065f46,#047857)',
    other: '#071f15', mineText: '#ffffff', otherText: '#a7f3d0',
    accent: '#10b981', border: 'rgba(16,185,129,0.1)',
    inputBg: '#071f15', liquidColor: 'rgba(16,185,129,0.4)',
  },
  {
    id: 'cherry', name: 'Cherry',
    preview: ['#150009','#4a0018','#f43f5e'],
    bg: '#150009',
    bgImage: 'radial-gradient(ellipse at 30% 70%, rgba(244,63,94,0.08) 0%, transparent 50%), radial-gradient(ellipse at 70% 30%, rgba(236,72,153,0.06) 0%, transparent 50%)',
    panel: '#1a000c', mine: 'linear-gradient(135deg,#be123c,#e11d48)',
    other: '#250010', mineText: '#ffffff', otherText: '#ffe4e6',
    accent: '#f43f5e', border: 'rgba(244,63,94,0.12)',
    inputBg: '#250010', liquidColor: 'rgba(244,63,94,0.4)',
  },
  {
    id: 'monochrome', name: 'Monochrome',
    preview: ['#0a0a0a','#1a1a1a','#e5e5e5'],
    bg: '#0a0a0a',
    bgImage: 'none',
    panel: '#111111', mine: '#2a2a2a',
    other: '#1a1a1a', mineText: '#ffffff', otherText: '#e5e5e5',
    accent: '#ffffff', border: 'rgba(255,255,255,0.08)',
    inputBg: '#1a1a1a', liquidColor: 'rgba(255,255,255,0.2)',
  },
  {
    id: 'vapor', name: 'Vaporwave',
    preview: ['#0d0021','#1a0040','#ff71ce'],
    bg: '#0d0021',
    bgImage: 'linear-gradient(180deg, #0d0021 0%, #0d0040 50%, #0d0021 100%), repeating-linear-gradient(90deg, transparent, transparent 80px, rgba(255,113,206,0.05) 80px, rgba(255,113,206,0.05) 81px), repeating-linear-gradient(0deg, transparent, transparent 80px, rgba(1,205,254,0.05) 80px, rgba(1,205,254,0.05) 81px)',
    panel: '#0d0030', mine: 'linear-gradient(135deg,#b10c6d,#7c1fa2)',
    other: '#150035', mineText: '#ffffff', otherText: '#ffd6f0',
    accent: '#ff71ce', border: 'rgba(255,113,206,0.15)',
    inputBg: '#150035', liquidColor: 'rgba(255,113,206,0.45)',
  },
  {
    id: 'daylight', name: 'Daylight', light: true,
    preview: ['#f4f6fb','#2563eb','#ffffff'],
    bg: '#f1f4f9', bgImage: 'radial-gradient(circle at 1px 1px, rgba(37,99,235,0.07) 1px, transparent 0)', bgSize: '28px 28px',
    panel: '#ffffff', mine: 'linear-gradient(135deg,#3b82f6,#2563eb)',
    other: '#ffffff', mineText: '#ffffff', otherText: '#15161a',
    accent: '#2563eb', border: 'rgba(15,15,20,0.08)',
    inputBg: '#e8ecf3', liquidColor: 'rgba(37,99,235,0.28)',
  },
  {
    id: 'peach', name: 'Peach', light: true,
    preview: ['#fff4ec','#f97316','#ffffff'],
    bg: '#fff5ee', bgImage: 'radial-gradient(ellipse at 15% 20%, rgba(251,146,60,0.14) 0%, transparent 55%), radial-gradient(ellipse at 85% 80%, rgba(244,114,182,0.10) 0%, transparent 55%)',
    panel: '#fffaf6', mine: 'linear-gradient(135deg,#fb923c,#f97316)',
    other: '#ffffff', mineText: '#ffffff', otherText: '#2b1a10',
    accent: '#ea6a0a', border: 'rgba(120,53,15,0.10)',
    inputBg: '#fdeadb', liquidColor: 'rgba(249,115,22,0.30)',
  },
  {
    id: 'mint', name: 'Mint', light: true,
    preview: ['#effaf5','#10b981','#ffffff'],
    bg: '#eefaf4', bgImage: 'radial-gradient(ellipse at 80% 15%, rgba(16,185,129,0.14) 0%, transparent 55%), radial-gradient(ellipse at 10% 90%, rgba(56,189,248,0.10) 0%, transparent 55%)',
    panel: '#f8fffb', mine: 'linear-gradient(135deg,#10b981,#059669)',
    other: '#ffffff', mineText: '#ffffff', otherText: '#10261c',
    accent: '#059669', border: 'rgba(6,78,59,0.10)',
    inputBg: '#dcf3e8', liquidColor: 'rgba(16,185,129,0.30)',
  },
  {
    id: 'lavender', name: 'Lavender', light: true,
    preview: ['#f5f1ff','#8b5cf6','#ffffff'],
    bg: '#f4f0ff', bgImage: 'radial-gradient(ellipse at 20% 15%, rgba(139,92,246,0.14) 0%, transparent 55%), radial-gradient(ellipse at 85% 85%, rgba(244,114,182,0.10) 0%, transparent 55%)',
    panel: '#fbf9ff', mine: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
    other: '#ffffff', mineText: '#ffffff', otherText: '#1d1433',
    accent: '#7c3aed', border: 'rgba(76,29,149,0.10)',
    inputBg: '#e9e1fb', liquidColor: 'rgba(139,92,246,0.30)',
  },
];

/* -- Storage ----------------------------------------------- */
const SK = 'sky:chat-themes:v1';
const W  = typeof window !== 'undefined';
const load = () => {
  if (!W) return {};
  try { return JSON.parse(localStorage.getItem(SK) || '{}'); } catch { return {}; }
};

interface ThemeState {
  chatThemes: Record<string, ChatThemeId>;   // chatId → themeId
  globalTheme: ChatThemeId;
  setTheme:   (chatId: string, themeId: ChatThemeId) => void;
  setGlobal:  (themeId: ChatThemeId) => void;
  getTheme:   (chatId?: string) => ChatTheme;
}

export const useChatTheme = create<ThemeState>((set, get) => ({
  chatThemes:  load(),
  globalTheme: 'default',

  setTheme: (chatId, themeId) => {
    set(s => {
      const next = { ...s.chatThemes, [chatId]: themeId };
      if (W) localStorage.setItem(SK, JSON.stringify(next));
      return { chatThemes: next };
    });
  },

  setGlobal: (themeId) => set({ globalTheme: themeId }),

  getTheme: (chatId) => {
    const s = get();
    const id = (chatId ? s.chatThemes[chatId] : null) ?? s.globalTheme;
    return THEMES.find(t => t.id === id) ?? THEMES[0];
  },
}));
