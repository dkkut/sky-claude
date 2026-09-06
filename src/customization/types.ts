/* ===============================================================
   SKY CUSTOMIZATION — общие типы
   Единая модель для рамок, баннеров чата, тем профиля, оформления
   списка чатов и питомцев. Новый предмет = новая запись в каталоге
   (src/customization/catalog/*), без правок логики.
=============================================================== */
import type { Account } from '@/core/auth/store';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'exclusive';

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Обычная', rare: 'Редкая', epic: 'Эпическая',
  legendary: 'Легендарная', mythic: 'Мифическая', exclusive: 'Эксклюзивная',
};
export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#8a8f9a', rare: '#4f6ef7', epic: '#a855f7',
  legendary: '#f59e0b', mythic: '#ef4444', exclusive: '#22d3ee',
};
export const RARITY_ORDER: Record<Rarity, number> = {
  common: 0, rare: 1, epic: 2, legendary: 3, mythic: 4, exclusive: 5,
};

export type ItemCategory = 'frame' | 'banner' | 'profileTheme' | 'chatListStyle' | 'pet' | 'effect';

/** Условие разблокировки предмета — расширяемо под будущую покупку/подарки/сезоны. */
export type UnlockCondition =
  | { type: 'default' }                              // доступно всем сразу
  | { type: 'prime' }                                 // активная подписка Sky Prime
  | { type: 'business' }                              // Sky Business аккаунт
  | { type: 'admin' }                                 // администратор платформы
  | { type: 'tenure'; days: number }                  // стаж на платформе
  | { type: 'achievement'; key: string }               // получено достижение (см. profile/viewer/progression.ts)
  | { type: 'season'; from: string; to: string }       // сезонный предмет, доступен в окне дат (ISO)
  | { type: 'owned' };                                 // выдан/куплен/подарен — хранится в инвентаре

export interface CosmeticItem {
  id:          string;
  category:    ItemCategory;
  name:        string;
  description: string;
  rarity:      Rarity;
  unlock:      UnlockCondition;
  /** Короткая подпись способа получения для витрины маркета. */
  obtainLabel: string;
}

/** Проверяет статические условия разблокировки (всё, что не требует инвентаря). */
export function meetsStaticUnlock(unlock: UnlockCondition, acc: Account | undefined): boolean {
  if (!acc) return unlock.type === 'default';
  switch (unlock.type) {
    case 'default':  return true;
    case 'prime':    return !!acc.isPrime;
    case 'business': return !!acc.isPrimeBusiness;
    case 'admin':    return !!acc.isAdmin;
    case 'tenure': {
      const days = Math.floor((Date.now() - new Date(acc.createdAt).getTime()) / 86_400_000);
      return days >= unlock.days;
    }
    case 'season': {
      const now = Date.now();
      return now >= new Date(unlock.from).getTime() && now <= new Date(unlock.to).getTime();
    }
    case 'achievement': return false; // проверяется отдельно — нужен доступ к прогрессии (см. store.ts)
    case 'owned':        return false; // проверяется через инвентарь (см. store.ts)
    default: return false;
  }
}
