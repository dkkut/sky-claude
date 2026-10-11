import { create } from 'zustand';
import { useNotifStore } from '@/notifications/store';
import { useMessengerStore } from '@/messenger/store';

/**
 * Состояние панелей навигации: у ПК боковая панель бывает узкой (rail),
 * широкой с названиями и описаниями (wide) или спрятанной за левый край
 * (hidden); у телефона нижняя панель прячется за правый край.
 * Запоминается между запусками.
 */
export type DesktopNav = 'rail' | 'wide' | 'hidden';
const KEY = 'sky:nav:v1';

const read = (): { desktop: DesktopNav; mobileHidden: boolean } => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      desktop: v.desktop === 'wide' || v.desktop === 'hidden' ? v.desktop : 'rail',
      mobileHidden: v.mobileHidden === true,
    };
  } catch { return { desktop: 'rail', mobileHidden: false }; }
};

interface NavPrefs {
  desktop: DesktopNav;
  mobileHidden: boolean;
  setDesktop: (m: DesktopNav) => void;
  setMobileHidden: (h: boolean) => void;
}

export const useNavPrefs = create<NavPrefs>((set, get) => {
  const save = () => {
    const { desktop, mobileHidden } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ desktop, mobileHidden })); } catch { /* приватный режим */ }
  };
  return {
    ...read(),
    setDesktop: (desktop) => { set({ desktop }); save(); },
    setMobileHidden: (mobileHidden) => { set({ mobileHidden }); save(); },
  };
});

/** Счётчики непрочитанного для значков на кнопках панелей. */
export const useNavBadges = () => {
  const notifications = useNotifStore((s) => s.notifs.filter((n) => !n.read).length);
  const messages = useMessengerStore((s) => {
    const withUnread = new Set(s.messages.filter((m) => !m.fromMe && m.status !== 'read').map((m) => m.chatId));
    return s.chats.filter((c) => withUnread.has(c.id)).length;
  });
  return { notifications, messages } as Record<string, number>;
};

export const fmtBadge = (n: number) => (n >= 1000 ? `${Math.floor(n / 1000)}K` : n > 99 ? '99+' : String(n));
