import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, MessageSquare, Bell, Layers, Swords, Radio, User, PlaySquare,
  Library, Briefcase,
} from 'lucide-react';
import { useModuleStore }  from '@/data/state/modules';
import { useAuthStore }    from '@/core/auth/store';
import { useNotifStore }   from '@/notifications/store';
import { useMessengerStore } from '@/messenger/store';
import type { ModuleKey }  from '@/data/state/modules';
import { SkyMiniPlayer }  from '@/player/SkyMiniPlayer';
import { usePlayerStore } from '@/player/playerStore';

const NAV: { key: ModuleKey; label: string; Icon: typeof MessageSquare }[] = [
  { key: 'stories',       label: 'Истории',     Icon: BookOpen      },
  { key: 'messages',      label: 'Чаты',        Icon: MessageSquare },
  { key: 'notifications', label: 'Событий',     Icon: Bell          },
  { key: 'bloom',         label: 'Лента',       Icon: Layers        },
  { key: 'gaming',        label: 'Игры',        Icon: Swords        },
  { key: 'extras',        label: 'Медиа',       Icon: Radio         },
  { key: 'video',         label: 'Видео',       Icon: PlaySquare    },
  { key: 'library',       label: 'Библиотека',  Icon: Library       },
  { key: 'studio',        label: 'Studio',      Icon: Briefcase     },
  { key: 'profile',       label: 'Профиль',     Icon: User          },
];

const avatarGrad = (name: string) => {
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `linear-gradient(135deg, hsl(${hue},65%,42%), hsl(${(hue + 40) % 360},70%,36%))`;
};

export const Sidebar = () => {
  const { activeModule, setActiveModule } = useModuleStore();
  const accounts      = useAuthStore(s => s.accounts);
  const currentUserId = useAuthStore(s => s.currentUserId);
  const account       = accounts.find(a => a.id === currentUserId);
  const initials      = account?.name?.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() ?? 'SK';
  const isPrime       = account?.isPrime ?? false;

  const unreadNotifs  = useNotifStore(s => s.notifs.filter(n => !n.read).length);
  const unreadChats   = useMessengerStore(s => {
    const withUnread = new Set(
      s.messages.filter(m => !m.fromMe && m.status !== 'read').map(m => m.chatId)
    );
    return s.chats.filter(c => withUnread.has(c.id)).length;
  });

  return (
    <aside
      className="flex w-[62px] shrink-0 flex-col items-center py-3"
      style={{
        background: 'var(--bg)',
        borderRight: '1px solid var(--border)',
      }}>

      {/* Logo */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.88 }}
        onClick={() => setActiveModule('stories')}
        className="mb-4 grid h-9 w-9 place-items-center cursor-pointer relative"
        title="Sky">
        <img
          src="/logo.png"
          alt="Sky"
          style={{
            width: 34, height: 34, objectFit: 'contain',
            filter: 'drop-shadow(0 0 10px rgba(79,110,247,0.5))',
          }}
        />
        {/* Online pulse ring */}
        <motion.span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full status-online"
          animate={{ boxShadow: ['0 0 0 0 rgba(34,197,94,0.4)', '0 0 0 4px rgba(34,197,94,0)'] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      </motion.button>

      {/* Divider */}
      <div className="sky-divider w-8 mb-2" />

      {/* Nav */}
      <nav className="flex flex-1 flex-col items-center gap-0.5 w-full px-2">
        {NAV.map(({ key, label, Icon }) => {
          const isActive = key === activeModule;
          const badge =
            key === 'notifications' ? unreadNotifs :
            key === 'messages'      ? unreadChats  : 0;

          return (
            <motion.button
              key={key}
              type="button"
              title={label}
              whileTap={{ scale: 0.9 }}
              onClick={() => setActiveModule(key)}
              className="sidebar-nav-btn"
              style={{ background: isActive ? 'rgba(79,110,247,0.12)' : undefined }}>

              {/* Active indicator */}
              <AnimatePresence>
                {isActive && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] rounded-r-full"
                    style={{ height: 22, background: 'var(--accent)' }}
                    initial={{ opacity: 0, scaleY: 0 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    exit={{ opacity: 0, scaleY: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                  />
                )}
              </AnimatePresence>

              {/* Icon */}
              <div className="relative">
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.3 : 1.6}
                  style={{
                    color: isActive ? 'var(--accent)' : 'var(--t3)',
                    transition: 'color 0.12s',
                  }}
                />
                {badge > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -right-1.5 -top-1.5 grid h-[15px] min-w-[15px] place-items-center rounded-full px-0.5 text-[8px] font-bold text-white leading-none"
                    style={{ background: '#ef4444', boxShadow: '0 0 0 1.5px var(--bg)' }}>
                    {badge > 99 ? '99+' : badge}
                  </motion.span>
                )}
              </div>

              {/* Label */}
              <span
                className="text-[8px] font-semibold tracking-wide leading-none"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--t3)',
                  transition: 'color 0.12s',
                }}>
                {label}
              </span>
            </motion.button>
          );
        })}
      </nav>

      {/* Divider */}
      <div className="sky-divider w-8 my-2" />

      {/* Mini Player */}
      <div className="relative mb-2 w-full flex justify-center">
        <SkyMiniPlayer />
      </div>

      {/* Avatar */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        onClick={() => setActiveModule('profile')}
        title={account?.name ?? 'Профиль'}
        className="relative grid h-8 w-8 place-items-center rounded-full text-[11px] font-bold text-white"
        style={{
          background: avatarGrad(account?.name ?? 'Sky'),
          boxShadow: activeModule === 'profile'
            ? '0 0 0 2px var(--accent), 0 0 12px rgba(79,110,247,0.4)'
            : isPrime
              ? '0 0 0 2px rgba(245,158,11,0.6)'
              : '0 0 0 1.5px rgba(255,255,255,0.08)',
        }}>
        {initials}
        {isPrime && (
          <span
            className="absolute -top-1 -right-1 text-[8px] leading-none"
            title="Prime">
            👑
          </span>
        )}
      </motion.button>
    </aside>
  );
};
