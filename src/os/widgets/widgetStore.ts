/** Единая система виджетов Sky: какие окна открыты и где лежат (позиции помнятся на устройстве). */
import { create } from 'zustand';

export type WidgetId = 'weather' | 'music' | 'notifications' | 'resources' | 'quick' | 'ai' | 'wallet';
export const WIDGET_IDS: WidgetId[] = ['weather', 'music', 'notifications', 'resources', 'quick', 'ai', 'wallet'];
export const WIDGET_TITLES: Record<WidgetId, string> = {
  weather: 'Погода', music: 'Музыка', notifications: 'Уведомления', resources: 'Ресурсы устройства', quick: 'Быстрые настройки', ai: 'Sky AI', wallet: 'Кошелёк',
};
export const isWidgetId = (v: unknown): v is WidgetId => typeof v === 'string' && (WIDGET_IDS as string[]).includes(v);

const KEY = 'sky:widgets:pos:v1';
type Pos = Record<string, { x: number; y: number }>;
const readPos = (): Pos => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

interface State {
  open: WidgetId[];
  pos: Pos;
  toggle: (id: WidgetId) => void;
  show: (id: WidgetId) => void;
  close: (id: WidgetId) => void;
  closeAll: () => void;
  move: (id: WidgetId, p: { x: number; y: number }) => void;
}
export const useWidgets = create<State>((set, get) => ({
  open: [], pos: readPos(),
  toggle: (id) => set(s => ({ open: s.open.includes(id) ? s.open.filter(x => x !== id) : [...s.open, id].slice(-3) })),
  show: (id) => set(s => ({ open: s.open.includes(id) ? s.open : [...s.open, id].slice(-3) })),
  close: (id) => set(s => ({ open: s.open.filter(x => x !== id) })),
  closeAll: () => set({ open: [] }),
  move: (id, p) => {
    set(s => ({ pos: { ...s.pos, [id]: p } }));
    try { localStorage.setItem(KEY, JSON.stringify(get().pos)); } catch { /* не критично */ }
  },
}));
