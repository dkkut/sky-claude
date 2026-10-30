/* ===============================================================
   CUSTOMIZATION SELECTORS
   Единая логика «что сейчас надето» для каждой категории: сверяем
   выбранный предмет с правом на владение (статика + инвентарь) и
   откатываемся на дефолт, если условие больше не выполняется
   (например, закончился Prime).
=============================================================== */
import type { Account } from '@/core/auth/store';
import { meetsStaticUnlock } from './types';
import { useCustomization, isPeerCosmetics } from './store';
import { BANNER_CATALOG, BANNER_MAP, type BannerItem } from './catalog/banners';
import { PROFILE_THEME_CATALOG, PROFILE_THEME_MAP, type ProfileThemeItem } from './catalog/profileThemes';
import { CHAT_LIST_STYLE_CATALOG, CHAT_LIST_STYLE_MAP, type ChatListStyleItem } from './catalog/chatListStyles';

function isUnlockedFor(acc: Account, itemId: string, unlock: Parameters<typeof meetsStaticUnlock>[0]): boolean {
  // Заглушка чужого аккаунта (см. peerAccount): условий разблокировки по ней не проверить — доверяем надетому.
  if ((acc as { __peer?: boolean }).__peer && isPeerCosmetics(acc.id)) return true;
  // Чужое надетое: «достижение» по неполным данным человека не проверить — доверяем тому, что он надел (платное сервер уже проверил).
  if (unlock.type === 'achievement' && isPeerCosmetics(acc.id)) return true;
  if (unlock.type === 'owned') return useCustomization.getState().ownsItem(acc.id, itemId);
  return meetsStaticUnlock(unlock, acc);
}

export function availableBanners(acc: Account): BannerItem[] {
  return BANNER_CATALOG.filter(b => isUnlockedFor(acc, b.id, b.unlock));
}
export function activeBanner(acc: Account | undefined): BannerItem {
  if (!acc) return BANNER_MAP['banner-default'];
  const id = useCustomization.getState().getEquipped(acc.id, 'banner');
  const wanted = id ? BANNER_MAP[id] : undefined;
  if (wanted && isUnlockedFor(acc, wanted.id, wanted.unlock)) return wanted;
  return BANNER_MAP['banner-default'];
}

export function availableProfileThemes(acc: Account): ProfileThemeItem[] {
  return PROFILE_THEME_CATALOG.filter(t => isUnlockedFor(acc, t.id, t.unlock));
}
export function activeProfileTheme(acc: Account | undefined): ProfileThemeItem {
  if (!acc) return PROFILE_THEME_MAP['theme-sky'];
  const id = useCustomization.getState().getEquipped(acc.id, 'profileTheme');
  const wanted = id ? PROFILE_THEME_MAP[id] : undefined;
  if (wanted && isUnlockedFor(acc, wanted.id, wanted.unlock)) return wanted;
  return PROFILE_THEME_MAP['theme-sky'];
}

export function availableChatListStyles(acc: Account): ChatListStyleItem[] {
  return CHAT_LIST_STYLE_CATALOG.filter(s => isUnlockedFor(acc, s.id, s.unlock));
}
export function activeChatListStyle(acc: Account | undefined): ChatListStyleItem {
  if (!acc) return CHAT_LIST_STYLE_MAP['cls-default'];
  const id = useCustomization.getState().getEquipped(acc.id, 'chatListStyle');
  const wanted = id ? CHAT_LIST_STYLE_MAP[id] : undefined;
  if (wanted && isUnlockedFor(acc, wanted.id, wanted.unlock)) return wanted;
  return CHAT_LIST_STYLE_MAP['cls-default'];
}
