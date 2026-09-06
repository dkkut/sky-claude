/* ===============================================================
   SKY — Перерыв от просмотра
   Настраиваемое напоминание о перерыве, основанное на реальном
   фактическом времени просмотра (а не времени на странице).
=============================================================== */
import { create } from 'zustand';

export interface BreakReminderSettings {
  enabled:         boolean;  // включена ли функция вообще
  intervalMinutes: number;   // напоминать через N минут АКТИВНОГО просмотра
  snoozeMinutes:   number;   // «Напомнить позже» — через сколько спросить снова
  pauseOnBreak:    boolean;  // «Сделать перерыв» также ставит плеер на паузу
}

const SK = 'sky:breakReminder:v1';
const W  = typeof window !== 'undefined';

export const INTERVAL_OPTIONS = [15, 30, 45, 60, 90];
export const SNOOZE_OPTIONS   = [5, 10, 15, 20];

const defaults: BreakReminderSettings = {
  enabled: true,
  intervalMinutes: 45,
  snoozeMinutes: 10,
  pauseOnBreak: true,
};

const load = (): BreakReminderSettings => {
  if (!W) return defaults;
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SK) || '{}') }; }
  catch { return defaults; }
};
const persist = (s: BreakReminderSettings) => {
  if (!W) return;
  try { localStorage.setItem(SK, JSON.stringify(s)); } catch {}
};

interface BreakReminderState {
  settings: BreakReminderSettings;
  setSettings: (patch: Partial<BreakReminderSettings>) => void;

  /* ── движок ─────────────────────────────────────────────────── */
  watchedSeconds:      number;   // фактически просмотрено с последнего сброса
  nextPromptAtSeconds: number;   // порог показа напоминания
  promptOpen:          boolean;
  activeCount:         number;   // сколько плееров сейчас реально воспроизводят

  /* вызывать из любого видео-плеера при play/pause */
  registerPlaying: (playing: boolean) => void;
  resolvePrompt:   (choice: 'break' | 'continue' | 'snooze') => void;
  requestPause:    (() => void) | null;   // текущий плеер регистрирует функцию паузы
  setPauseHandler: (fn: (() => void) | null) => void;
}

export const useBreakReminderStore = create<BreakReminderState>((set, get) => {
  const initial = load();

  /* Единый глобальный тикер на всё время жизни приложения —
     не завязан на монтирование конкретного плеера. */
  if (W) {
    setInterval(() => {
      const s = get();
      if (!s.settings.enabled || s.activeCount <= 0 || s.promptOpen) return;
      const next = s.watchedSeconds + 1;
      set(next >= s.nextPromptAtSeconds ? { watchedSeconds: next, promptOpen: true } : { watchedSeconds: next });
    }, 1000);
  }

  return {
    settings: initial,
    setSettings: (patch) => {
      const next = { ...get().settings, ...patch };
      persist(next);
      set(s => ({
        settings: next,
        promptOpen: next.enabled ? s.promptOpen : false,
        nextPromptAtSeconds: patch.intervalMinutes != null ? next.intervalMinutes * 60 : s.nextPromptAtSeconds,
      }));
    },

    watchedSeconds: 0,
    nextPromptAtSeconds: initial.intervalMinutes * 60,
    promptOpen: false,
    activeCount: 0,
    requestPause: null,

    registerPlaying: (playing) => set(s => ({ activeCount: Math.max(0, s.activeCount + (playing ? 1 : -1)) })),

    setPauseHandler: (fn) => set({ requestPause: fn }),

    resolvePrompt: (choice) => {
      const s = get();
      if (choice === 'snooze') {
        set({ promptOpen: false, nextPromptAtSeconds: s.watchedSeconds + s.settings.snoozeMinutes * 60 });
        return;
      }
      if (choice === 'break' && s.settings.pauseOnBreak) s.requestPause?.();
      // и «перерыв», и «продолжить» запускают полный новый цикл отсчёта
      set({ promptOpen: false, watchedSeconds: 0, nextPromptAtSeconds: s.settings.intervalMinutes * 60 });
    },
  };
});

/* Удобный хук для плееров: сообщает движку факт активного воспроизведения
   и (опционально) отдаёт функцию паузы для варианта «Сделать перерыв».
   Через селекторы — чтобы компонент НЕ перерендеривался на каждый тик таймера. */
export const useRegisterWatchActivity = () => {
  const setPlaying     = useBreakReminderStore(s => s.registerPlaying);
  const setPauseHandler = useBreakReminderStore(s => s.setPauseHandler);
  return { setPlaying, setPauseHandler };
};
