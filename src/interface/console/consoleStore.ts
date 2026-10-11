/* Состояние оболочки Sky Console: этап запуска, открытый сервис, настройки. */
import { create } from 'zustand';

export type ServiceKey = 'film' | 'music' | 'calls' | 'games' | 'blox' | 'video' | 'podcasts' | 'messenger' | 'ai' | 'prime' | 'market' | 'notifications';

export interface ConsolePrefs {
  /** Полная заставка при холодном запуске. */
  intro: boolean;
  /** 'full' — все эффекты, 'light' — без частиц и размытия (слабые устройства). */
  fx: 'full' | 'light';
}

const PK = 'sky:console:prefs:v1';
const loadPrefs = (): ConsolePrefs => {
  const d: ConsolePrefs = { intro: true, fx: 'full' };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PK) || '{}') }; } catch { return d; }
};

interface ConsoleState {
  /** Заставка показана в этом запуске (сбрасывается только перезапуском). */
  introDone: boolean;
  /** Профиль выбран в этом запуске — до этого показываем «Кто играет?». */
  picked: boolean;
  /** Экран входа был показан в этом запуске — профиль человек выбрал там же. */
  authShown: boolean;
  service: ServiceKey | null;
  settingsOpen: boolean;
  prefs: ConsolePrefs;
  setIntroDone: () => void;
  setPicked: (v: boolean) => void;
  markAuthShown: () => void;
  open: (s: ServiceKey | null) => void;
  setSettingsOpen: (v: boolean) => void;
  setPrefs: (p: Partial<ConsolePrefs>) => void;
  /** Забыть всё, что относится к прошлому профилю. */
  resetForProfileChange: () => void;
}

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  introDone: false, picked: false, authShown: false, service: null, settingsOpen: false, prefs: loadPrefs(),
  setIntroDone: () => set({ introDone: true }),
  setPicked: (v) => set({ picked: v }),
  markAuthShown: () => set({ authShown: true }),
  open: (s) => set({ service: s, settingsOpen: false }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setPrefs: (p) => {
    const next = { ...get().prefs, ...p };
    try { localStorage.setItem(PK, JSON.stringify(next)); } catch { /* не страшно */ }
    set({ prefs: next });
  },
  resetForProfileChange: () => set({ picked: false, authShown: false, service: null, settingsOpen: false }),
}));
