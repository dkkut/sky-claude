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
}

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
