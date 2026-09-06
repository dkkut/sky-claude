/* ===============================================================
   CUSTOMIZATION INVENTORY
   Кто чем владеет и что сейчас надето, по каждой категории отдельно.
   Общий for-all-accounts датасет (как gifts/bloom-posts) — совместимо
   с однобраузерной демо-моделью Sky (несколько аккаунтов в одном браузере).
=============================================================== */
import { create } from 'zustand';
import type { ItemCategory, UnlockCondition } from './types';
import { meetsStaticUnlock } from './types';
import type { Account } from '@/core/auth/store';

const W = typeof window !== 'undefined';
const OWNED_KEY    = 'sky:customization:owned:v1';
const EQUIPPED_KEY = 'sky:customization:equipped:v1';
const FAVORITES_KEY = 'sky:customization:favorites:v1';

/* Немного стартовых предметов у демо-аккаунтов — иначе «owned»-часть
   каталога (то, что выдаёт будущий Маркет) негде посмотреть до того,
   как Маркет появится. В духе остальных SEED_* в проекте. */
const SEED_OWNED: OwnedMap = {
  'acc-kutuzov': ['frame-neon', 'frame-liquid', 'banner-galaxy', 'banner-neon', 'theme-galaxy', 'theme-neon', 'cls-neon-strip'],
  'acc-luna':    ['frame-flowers', 'banner-sakura', 'theme-cloud', 'cls-glass-card'],
};
const SEED_EQUIPPED: EquippedMap = {
  'acc-kutuzov': { frame: 'frame-liquid', banner: 'banner-galaxy', profileTheme: 'theme-galaxy', chatListStyle: 'cls-neon-strip' },
};

type OwnedMap    = Record<string, string[]>;                              // accountId -> itemIds
type EquippedMap = Record<string, Partial<Record<ItemCategory, string>>>; // accountId -> category -> itemId
type FavoritesMap = Record<string, string[]>;                             // accountId -> itemIds

function load<T>(key: string, fallback: T): T {
  if (!W) return fallback;
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function persist<T>(key: string, value: T) {
  if (!W) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

interface CustomizationState {
  owned:    OwnedMap;
  equipped: EquippedMap;
  favorites: FavoritesMap;

  ownsItem:   (accountId: string, itemId: string) => boolean;
  grantItem:  (accountId: string, itemId: string) => void;
  revokeItem: (accountId: string, itemId: string) => void;

  getEquipped: (accountId: string, category: ItemCategory) => string | undefined;
  equip:       (accountId: string, category: ItemCategory, itemId: string | null) => void;

  isFavorite:     (accountId: string, itemId: string) => boolean;
  toggleFavorite: (accountId: string, itemId: string) => void;

  /**
   * Полная проверка доступности предмета: статические условия
   * (Prime/стаж/сезон/…) ИЛИ владение через инвентарь. Достижения
   * передаются извне — их вычисление завязано на React-хук useProgression.
   */
  isUnlocked: (
    accountId: string, itemId: string, acc: Account | undefined,
    unlock: UnlockCondition, unlockedAchievements?: string[],
  ) => boolean;
}

export const useCustomization = create<CustomizationState>((set, get) => ({
  owned:    load(OWNED_KEY, SEED_OWNED),
  equipped: load(EQUIPPED_KEY, SEED_EQUIPPED),
  favorites: load(FAVORITES_KEY, {} as FavoritesMap),

  ownsItem: (accountId, itemId) => (get().owned[accountId] ?? []).includes(itemId),

  grantItem: (accountId, itemId) => {
    if (get().ownsItem(accountId, itemId)) return;
    const next = { ...get().owned, [accountId]: [...(get().owned[accountId] ?? []), itemId] };
    persist(OWNED_KEY, next);
    set({ owned: next });
  },

  revokeItem: (accountId, itemId) => {
    const next = { ...get().owned, [accountId]: (get().owned[accountId] ?? []).filter(id => id !== itemId) };
    persist(OWNED_KEY, next);
    set({ owned: next });
  },

  getEquipped: (accountId, category) => get().equipped[accountId]?.[category],

  equip: (accountId, category, itemId) => {
    const forAcc = { ...(get().equipped[accountId] ?? {}) };
    if (itemId) forAcc[category] = itemId; else delete forAcc[category];
    const next = { ...get().equipped, [accountId]: forAcc };
    persist(EQUIPPED_KEY, next);
    set({ equipped: next });
  },

  isUnlocked: (accountId, itemId, acc, unlock, unlockedAchievements = []) => {
    if (unlock.type === 'owned') return get().ownsItem(accountId, itemId);
    if (unlock.type === 'achievement') return unlockedAchievements.includes(unlock.key);
    return meetsStaticUnlock(unlock, acc);
  },

  isFavorite: (accountId, itemId) => (get().favorites[accountId] ?? []).includes(itemId),

  toggleFavorite: (accountId, itemId) => {
    const cur = get().favorites[accountId] ?? [];
    const nextList = cur.includes(itemId) ? cur.filter(id => id !== itemId) : [...cur, itemId];
    const next = { ...get().favorites, [accountId]: nextList };
    persist(FAVORITES_KEY, next);
    set({ favorites: next });
  },
}));
