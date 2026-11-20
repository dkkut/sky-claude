// Горячие клавиши на ПК: человек сам назначает сочетание на действие (открыть раздел, вкладку, чат, управление плеером).
// Хранится только на этом устройстве. Сочетание считается по физической клавише (event.code), поэтому работает в любой раскладке.
import { useWidgets, WIDGET_IDS, WIDGET_TITLES, isWidgetId } from '@/os/widgets/widgetStore';
import { useLockScreen } from '@/os/lockStore';
import { create } from 'zustand';
import { useEffect } from 'react';
import { useModuleStore, type ModuleKey } from '@/data/state/modules';
import { useMessengerStore } from '@/messenger/store';
import { usePlayerStore } from '@/player/playerStore';

export interface ShortcutBinding { id: string; combo: string; action: string }

const KEY = 'sky:shortcuts:v1';
const MAX = 40;

export const MODULE_ACTIONS: { id: ModuleKey; label: string }[] = [
  { id: 'messages', label: 'Чаты' }, { id: 'bloom', label: 'Bloom' }, { id: 'stories', label: 'Истории' }, { id: 'extras', label: 'Sky Media' },
  { id: 'gaming', label: 'Игры' }, { id: 'video', label: 'Sky Video' }, { id: 'library', label: 'Библиотека' }, { id: 'studio', label: 'Студия' },
  { id: 'business', label: 'Бизнес' }, { id: 'jobs', label: 'Работа' }, { id: 'notifications', label: 'Уведомления' }, { id: 'profile', label: 'Профиль' },
];
export const EXTRAS_ACTIONS: { id: string; label: string }[] = [
  { id: 'home', label: 'Главная' }, { id: 'music', label: 'Музыка' }, { id: 'movies', label: 'Кино' }, { id: 'tv', label: 'ТВ' },
  { id: 'podcasts', label: 'Подкасты' }, { id: 'books', label: 'Книги' }, { id: 'ai', label: 'Sky AI' }, { id: 'prime', label: 'Prime' },
  { id: 'go', label: 'Sky GO' }, { id: 'market', label: 'Market' }, { id: 'blox', label: 'Sky Blox' }, { id: 'tickets', label: 'Билеты' },
  { id: 'nftgifts', label: 'Sky Gifts' }, { id: 'family', label: 'Sky Family' }, { id: 'transfer', label: 'Sky Transfer' }, { id: 'guide', label: 'Путеводитель' },
];
export const PLAYER_ACTIONS = [
  { id: 'player:toggle', label: 'Плеер: пауза / играть' }, { id: 'player:next', label: 'Плеер: следующий трек' }, { id: 'player:prev', label: 'Плеер: предыдущий трек' },
  { id: 'lock:show', label: 'Экран блокировки Sky' },
  ...WIDGET_IDS.map((w) => ({ id: `widget:${w}`, label: `Виджет: ${WIDGET_TITLES[w]}` })),
];

export const actionLabel = (action: string, chatName?: (id: string) => string | undefined): string => {
  const [kind, rest = ''] = [action.split(':')[0], action.slice(action.indexOf(':') + 1)];
  if (kind === 'module') return `Открыть: ${MODULE_ACTIONS.find((m) => m.id === rest)?.label ?? rest}`;
  if (kind === 'extras') return `Sky Media → ${EXTRAS_ACTIONS.find((m) => m.id === rest)?.label ?? rest}`;
  if (kind === 'chat') return `Чат: ${chatName?.(rest) ?? rest}`;
  return PLAYER_ACTIONS.find((p) => p.id === action)?.label ?? action;
};
export const isKnownAction = (a: string): boolean =>
  (a.startsWith('module:') && MODULE_ACTIONS.some((m) => `module:${m.id}` === a)) ||
  (a.startsWith('extras:') && EXTRAS_ACTIONS.some((m) => `extras:${m.id}` === a)) ||
  (a.startsWith('chat:') && a.length > 5 && a.length < 200) || PLAYER_ACTIONS.some((p) => p.id === a);

/** Сочетание из события: модификаторы по порядку ctrl, alt, shift, meta + физическая клавиша. null — одни модификаторы. */
export const comboOf = (e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string | null => {
  const code = e.code || '';
  if (!code || /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code)) return null;
  const key = code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, 'num$1').toLowerCase();
  return [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && 'shift', e.metaKey && 'meta', key].filter(Boolean).join('+');
};
const NAMES: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win/⌘', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', space: 'Space', escape: 'Esc', enter: 'Enter', backspace: 'Backspace', tab: 'Tab' };
export const comboLabel = (combo: string): string => combo.split('+').map((p) => NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p.toUpperCase())).join(' + ');

// Сочетания браузера и системы, которые назначать нельзя (иначе не вставить текст, не закрыть вкладку и т. п.).
const RESERVED = new Set(['ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+a', 'ctrl+z', 'ctrl+y', 'ctrl+s', 'ctrl+w', 'ctrl+t', 'ctrl+n', 'ctrl+r', 'ctrl+f', 'ctrl+p', 'ctrl+l', 'ctrl+q',
  'ctrl+shift+t', 'ctrl+shift+n', 'ctrl+shift+i', 'ctrl+tab', 'alt+f4', 'alt+tab', 'f5', 'f11', 'f12', 'ctrl+f5', 'ctrl+shift+r']);
/** Годится ли сочетание: нужен хотя бы Ctrl, Alt или Win/⌘ (либо F-клавиша без модификаторов), чтобы не перехватывать обычный набор текста. */
export const checkCombo = (combo: string): { ok: true } | { ok: false; why: string } => {
  const parts = combo.split('+'); const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (RESERVED.has(combo)) return { ok: false, why: 'Это сочетание занято браузером или системой — выберите другое.' };
  if (/^f([1-9]|1[0-2])$/.test(key) && mods.length === 0) return { ok: true };
  if (!mods.some((m) => m === 'ctrl' || m === 'alt' || m === 'meta')) return { ok: false, why: 'Добавьте Ctrl, Alt или Win/⌘ — иначе клавиша сработает при наборе текста.' };
  return { ok: true };
};

const read = (): ShortcutBinding[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw.filter((b) => b && typeof b.id === 'string' && typeof b.combo === 'string' && typeof b.action === 'string' && isKnownAction(b.action) && checkCombo(b.combo).ok && !seen.has(b.combo) && seen.add(b.combo)).slice(0, MAX);
  } catch { return []; }
};
const write = (list: ShortcutBinding[]) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* память переполнена или запрещена */ } };

interface S {
  bindings: ShortcutBinding[]; enabled: boolean;
  add: (combo: string, action: string) => { ok: boolean; why?: string };
  update: (id: string, patch: Partial<Pick<ShortcutBinding, 'combo' | 'action'>>) => { ok: boolean; why?: string };
  remove: (id: string) => void; setEnabled: (v: boolean) => void; reset: () => void;
}
const en = (): boolean => { try { return localStorage.getItem('sky:shortcuts:off') !== '1'; } catch { return true; } };
export const useShortcuts = create<S>((set, get) => ({
  bindings: read(), enabled: en(),
  add: (combo, action) => {
    const c = checkCombo(combo); if (!c.ok) return c;
    if (!isKnownAction(action)) return { ok: false, why: 'Выберите действие.' };
    if (get().bindings.length >= MAX) return { ok: false, why: 'Слишком много сочетаний.' };
    if (get().bindings.some((b) => b.combo === combo)) return { ok: false, why: 'Это сочетание уже назначено.' };
    const next = [...get().bindings, { id: `sc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, combo, action }];
    write(next); set({ bindings: next }); return { ok: true };
  },
  update: (id, patch) => {
    if (patch.combo !== undefined) { const c = checkCombo(patch.combo); if (!c.ok) return c; if (get().bindings.some((b) => b.id !== id && b.combo === patch.combo)) return { ok: false, why: 'Это сочетание уже назначено.' }; }
    if (patch.action !== undefined && !isKnownAction(patch.action)) return { ok: false, why: 'Выберите действие.' };
    const next = get().bindings.map((b) => (b.id === id ? { ...b, ...patch } : b)); write(next); set({ bindings: next }); return { ok: true };
  },
  remove: (id) => { const next = get().bindings.filter((b) => b.id !== id); write(next); set({ bindings: next }); },
  setEnabled: (v) => { try { localStorage.setItem('sky:shortcuts:off', v ? '0' : '1'); } catch { /* не критично */ } set({ enabled: v }); },
  reset: () => { write([]); set({ bindings: [] }); },
}));

/** Выполнить действие. Всё — через те же сторы, что и кнопки интерфейса (второго способа навигации нет). */
export const runShortcut = (action: string): boolean => {
  const mod = useModuleStore.getState();
  if (action.startsWith('module:')) { mod.setActiveModule(action.slice(7) as ModuleKey); return true; }
  if (action.startsWith('extras:')) { mod.setPendingExtrasTab(action.slice(7)); mod.setActiveModule('extras'); return true; }
  if (action.startsWith('chat:')) {
    const id = action.slice(5);
    mod.setActiveModule('messages'); useMessengerStore.getState().setActiveChat(id); return true;
  }
  const p = usePlayerStore.getState();
  if (action === 'player:toggle') { if (!p.item) return false; p.setPlaying(!p.isPlaying); return true; }
  if (action === 'player:next') { if (!p.item) return false; p.nextTrack(); return true; }
  if (action === 'player:prev') { if (!p.item) return false; p.prevTrack(); return true; }
  if (action === 'lock:show') { useLockScreen.getState().show(); return true; }
  if (action.startsWith('widget:')) { const w = action.slice(7); if (!isWidgetId(w)) return false; useWidgets.getState().toggle(w); return true; }
  return false;
};

/** Слушатель на весь экран. Только ПК-оболочка; пока человек назначает сочетание (идёт запись), сработавшие не запускаются. */
export const useShortcutListener = (active: boolean) => {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.('[data-shortcut-capture]')) return;
      const st = useShortcuts.getState(); if (!st.enabled || !st.bindings.length) return;
      const combo = comboOf(e); if (!combo) return;
      const b = st.bindings.find((x) => x.combo === combo); if (!b) return;
      if (runShortcut(b.action)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
};
