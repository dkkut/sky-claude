import { create } from 'zustand';

/** Курсор-питомец: включён ли и какое животное бегает за курсором (на этом устройстве). */
export const CURSOR_ANIMALS = ['🐱', '🐶', '🐰', '🦊', '🐻', '🐼', '🦁', '🐯', '🐹', '🐸', '🐧', '🦉', '🐲', '🦕'] as const;
const KEY = 'sky:cursorpet:v2';

interface CursorPetState {
  enabled: boolean;
  animal: string;
  setEnabled: (v: boolean) => void;
  setAnimal: (a: string) => void;
}

const read = (): { enabled: boolean; animal: string } => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const old = JSON.parse(localStorage.getItem('sky:pets:v1') ?? '{}');
    const MAP: Record<string, string> = { 'cat-neon': '🐱', 'bunny-pixel': '🐰', 'fox-cyber': '🦊', 'dog-retro': '🐶', 'dino-8bit': '🦕', 'bear-astro': '🐻', 'dragon-mini': '🐲', 'owl-neon': '🦉' };
    return {
      enabled: v.enabled !== false,
      animal: (CURSOR_ANIMALS as readonly string[]).includes(v.animal) ? v.animal : (MAP[old.active] ?? '🐱'),
    };
  } catch { return { enabled: true, animal: '🐱' }; }
};

export const useCursorPet = create<CursorPetState>((set, get) => {
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ enabled: get().enabled, animal: get().animal })); } catch { /* приватный режим */ } };
  return {
    ...read(),
    setEnabled: (enabled) => { set({ enabled }); save(); },
    setAnimal: (animal) => { set({ animal, enabled: true }); save(); },
  };
});
