/* ===============================================================
   CUSTOMIZATION INVENTORY
   Кто чем владеет и что сейчас надето — зеркало серверного
   состояния (server/customization.mjs). Раньше весь этот модуль был
   чисто клиентским (localStorage): владение не стоило ничего и не
   переживало смену браузера. Теперь владение — платное (баллы) и
   хранится на сервере; здесь только кэш для синхронных селекторов
   (src/customization/selectors.ts, src/profile/viewer/cosmetics.ts) и
   отправка команд.

   Избранное (favorites) остаётся локальным — это не владение, а личная
   закладка на витрине, ей незачем на сервер.
=============================================================== */
import { create } from 'zustand';
import { useEffect } from 'react';
import type { ItemCategory, UnlockCondition } from './types';
import { meetsStaticUnlock } from './types';
import type { Account } from '@/core/auth/store';
import { apiMyCustomization, apiEquipCustomization, apiBuyCustomization, apiCustomizationCatalog, apiPeersCustomization, type CatalogPrice } from './customizationApi';

const W = typeof window !== 'undefined';
const FAVORITES_KEY = 'sky:customization:favorites:v1';

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
  catalog:  CatalogPrice[];
  /** Какие accountId уже подтянули инвентарь с сервера. */
  synced:   Record<string, boolean>;

  ownsItem:   (accountId: string, itemId: string) => boolean;
  priceOf:    (itemId: string) => number | undefined;

  /** Подтягивает владение/экипировку/цены с сервера. Безопасно звать
   *  повторно — например при входе в маркет, если main.tsx почему-то
   *  ещё не успел. */
  loadFromServer: (accountId: string) => Promise<void>;
  /** Подтянуть надетое у других людей (чат, профиль, список чатов). Не чаще раза в минуту на человека. */
  loadPeers: (ids: Array<string | undefined | null>) => Promise<void>;

  getEquipped: (accountId: string, category: ItemCategory) => string | undefined;
  /** Надеть предмет. Показывает сразу (оптимистично), истина — ответ
   *  сервера: при отказе (не куплено) откатывает обратно. */
  equip: (accountId: string, category: ItemCategory, itemId: string | null) => void;

  /** Купить за баллы. Возвращает результат — экран сам решит, что
   *  показать (не хватает баллов, уже куплено). */
  buyItem: (accountId: string, itemId: string) => Promise<{ ok: boolean; error?: string }>;

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

const peerFetchedAt = new Map<string, number>();

/** Хук: подтянуть надетое у людей и перерисовать экран, когда оно придёт. Возвращает счётчик для зависимостей useMemo. */
export const usePeerCosmetics = (ids: Array<string | undefined | null>): unknown => {
  const equipped = useCustomization((s) => s.equipped);
  const key = ids.filter(Boolean).join(',');
  useEffect(() => { void useCustomization.getState().loadPeers(key ? key.split(',') : []); }, [key]);
  return equipped;
};

export const useCustomization = create<CustomizationState>((set, get) => ({
  owned:    {},
  equipped: {},
  favorites: load(FAVORITES_KEY, {} as FavoritesMap),
  catalog:  [],
  synced:   {},

  ownsItem: (accountId, itemId) => (get().owned[accountId] ?? []).includes(itemId),

  priceOf: (itemId) => get().catalog.find((c) => c.id === itemId)?.pricePoints,

  loadFromServer: async (accountId) => {
    const [mine, catalog] = await Promise.all([apiMyCustomization(), apiCustomizationCatalog()]);
    if (!mine) return;
    set({
      owned: { ...get().owned, [accountId]: mine.inventory.map((r) => r.itemId) },
      equipped: { ...get().equipped, [accountId]: mine.equipped },
      catalog,
      synced: { ...get().synced, [accountId]: true },
    });
  },

  loadPeers: async (rawIds) => {
    const now = Date.now();
    const ids = [...new Set(rawIds.filter((x): x is string => !!x))].filter((id) => now - (peerFetchedAt.get(id) ?? 0) > 60_000);
    if (!ids.length) return;
    for (const id of ids) peerFetchedAt.set(id, now);
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const eq = await apiPeersCustomization(chunk);
      if (!eq) { for (const id of chunk) peerFetchedAt.delete(id); continue; }
      const equipped = { ...get().equipped };
      const owned = { ...get().owned };
      for (const id of chunk) {
        if (get().synced[id]) continue;                 // свой инвентарь не трогаем: он точнее
        equipped[id] = eq[id] ?? {};
        // Сервер разрешил надеть только то, чем человек владеет (платное) — для показа считаем это его имуществом.
        owned[id] = Object.values(eq[id] ?? {});
      }
      set({ equipped, owned });
    }
  },

  getEquipped: (accountId, category) => get().equipped[accountId]?.[category],

  equip: (accountId, category, itemId) => {
    const prior = get().equipped[accountId]?.[category];
    const forAcc = { ...(get().equipped[accountId] ?? {}) };
    if (itemId) forAcc[category] = itemId; else delete forAcc[category];
    set({ equipped: { ...get().equipped, [accountId]: forAcc } });

    void apiEquipCustomization(category, itemId).then((r) => {
      if (r.ok) return;
      // Сервер отказал (не куплено и т.п.) — откатываем оптимистичный показ.
      const reverted = { ...(get().equipped[accountId] ?? {}) };
      if (prior) reverted[category] = prior; else delete reverted[category];
      set({ equipped: { ...get().equipped, [accountId]: reverted } });
    });
  },

  buyItem: async (accountId, itemId) => {
    const r = await apiBuyCustomization(itemId);
    if (!r.ok) return { ok: false, error: r.error };
    const next = { ...get().owned, [accountId]: [...(get().owned[accountId] ?? []), itemId] };
    set({ owned: next });
    return { ok: true };
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

/** Подтянуть инвентарь текущего пользователя — зовётся из main.tsx при
 *  входе, рядом с reloadWalletForUser/reloadMessengerForUser и т.п. */
export const reloadCustomizationForUser = (accountId: string | null) => {
  if (!accountId) return;
  void useCustomization.getState().loadFromServer(accountId);
};
