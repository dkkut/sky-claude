import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, MessageSquare, Bell, Layers, Swords, Radio, User, PlaySquare,
  Library, Briefcase, Crown, ChevronLeft, ChevronRight, PanelLeftOpen, PanelLeftClose } from 'lucide-react';
import { useModuleStore }  from '@/data/state/modules';
import { useAuthStore }    from '@/core/auth/store';
import { useNavPrefs, useNavBadges, fmtBadge } from './navPrefs';
import type { ModuleKey }  from '@/data/state/modules';
import { SkyMiniPlayer }  from '@/player/SkyMiniPlayer';
import { usePlayerStore } from '@/player/playerStore';

const DESC: Record<string, string> = {
  stories: 'Короткие истории', messages: 'Переписки и звонки', notifications: 'Что произошло',
  bloom: 'Лента и реклама', gaming: 'Матчи, турниры, каналы', extras: 'Музыка, кино, ТВ',
  video: 'Ролики и Studio', library: 'Книги и файлы', studio: 'Бизнес-кабинет', profile: 'Аккаунт и настройки',
};

const NAV: { key: ModuleKey; label: string; Icon: typeof MessageSquare }[] = [
  { key: 'stories',       label: 'Истории',     Icon: BookOpen      },
  { key: 'messages',      label: 'Чаты',        Icon: MessageSquare },
  { key: 'notifications', label: 'События',     Icon: Bell          },
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

  const badges = useNavBadges();
  const mode = useNavPrefs(st => st.desktop);
  const setMode = useNavPrefs(st => st.setDesktop);
  const wide = mode === 'wide';

  const outerW = mode === 'hidden' ? 0 : wide ? 232 : 76;

  return (
    <div className="relative shrink-0" style={{ width: outerW, transition: 'width .25s cubic-bezier(.4,0,.2,1)', zIndex: 20 }}>

      {/* Язычок у края: вернуть спрятанную панель */}
      {mode === 'hidden' && (
        <button type="button" onClick={() => setMode('rail')} title="Показать панель" aria-label="Показать панель"
          className="nav-tab absolute left-0 top-1/2 grid h-14 w-5 -translate-y-1/2 place-items-center"
          style={{ borderRadius: '0 14px 14px 0', borderLeft: 0, zIndex: 30 }}>
          <ChevronRight size={14} />
        </button>
      )}

      <aside
        className="nav-panel absolute flex flex-col items-center py-3"
        style={{
          top: 8, bottom: 8, left: 8, width: outerW - 12, borderRadius: 28,
          transform: mode === 'hidden' ? 'translateX(-110%)' : 'none',
          opacity: mode === 'hidden' ? 0 : 1, pointerEvents: mode === 'hidden' ? 'none' : 'auto',
          transition: 'width .25s cubic-bezier(.4,0,.2,1), transform .25s cubic-bezier(.4,0,.2,1), opacity .2s',
        }}>

        {/* Logo */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.88 }}
          onClick={() => setActiveModule('stories')}
          className="mb-3 flex shrink-0 items-center gap-2 cursor-pointer relative"
          title="Sky">
          <span className="relative grid h-9 w-9 place-items-center">
            <img src="/logo.png" alt="Sky" style={{ width: 34, height: 34, objectFit: 'contain', filter: 'drop-shadow(0 0 10px rgba(79,110,247,0.5))' }} />
            <motion.span
              className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full status-online"
              animate={{ boxShadow: ['0 0 0 0 rgba(34,197,94,0.4)', '0 0 0 4px rgba(34,197,94,0)'] }}
              transition={{ duration: 2, repeat: Infinity }} />
          </span>
          {wide && <span className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Sky</span>}
        </motion.button>

        <div className="sky-divider mb-2 w-10 shrink-0" />

        {/* Nav */}
        <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1.5" style={{ scrollbarWidth: 'none' }}>
          {NAV.map(({ key, label, Icon }) => {
            const isActive = key === activeModule;
            const badge = badges[key] ?? 0;
            return (
              <motion.button
                key={key}
                type="button"
                title={label}
                whileTap={{ scale: 0.94 }}
                onClick={() => setActiveModule(key)}
                className={`sidebar-nav-btn${wide ? ' wide' : ''}`}>

                {/* Линия — у открытой страницы, у края панели */}
                {isActive && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute top-1/2 w-[3px] -translate-y-1/2 rounded-full"
                    style={{ left: -6, height: 24, background: 'var(--accent)' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
                )}

                <div className="relative shrink-0">
                  <Icon size={wide ? 20 : 19} strokeWidth={isActive ? 2.3 : 1.6}
                    style={{ color: isActive ? 'var(--accent)' : 'var(--t3)', transition: 'color 0.12s' }} />
                  {badge > 0 && !wide && (
                    <span className="absolute -right-2.5 -top-2 grid h-[15px] min-w-[15px] place-items-center rounded-full px-1 text-[8px] font-bold leading-none text-white"
                      style={{ background: '#ef4444', boxShadow: '0 0 0 1.5px var(--bg-l1)' }}>{fmtBadge(badge)}</span>
                  )}
                </div>

                {wide ? (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold leading-tight" style={{ color: isActive ? 'var(--accent)' : 'var(--t1)' }}>{label}</span>
                    <span className="block truncate text-[10.5px] leading-tight" style={{ color: 'var(--t3)' }}>{DESC[key]}</span>
                  </span>
                ) : (
                  <span className="whitespace-nowrap text-[8px] font-semibold leading-none tracking-tight"
                    style={{ color: isActive ? 'var(--accent)' : 'var(--t3)', transition: 'color 0.12s' }}>{label}</span>
                )}
                {badge > 0 && wide && (
                  <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: '#ef4444' }}>{fmtBadge(badge)}</span>
                )}
              </motion.button>
            );
          })}
        </nav>

        <div className="sky-divider my-2 w-10 shrink-0" />

        <div className="relative mb-2 flex w-full shrink-0 justify-center">
          <SkyMiniPlayer />
        </div>

        <div className="flex shrink-0 flex-col items-center gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={() => setActiveModule('profile')}
            title={account?.name ?? 'Профиль'}
            className="relative grid h-9 w-9 place-items-center rounded-full text-[11px] font-bold text-white"
            style={{
              background: avatarGrad(account?.name ?? 'Sky'),
              boxShadow: activeModule === 'profile'
                ? '0 0 0 2px var(--accent), 0 0 12px rgba(79,110,247,0.4)'
                : isPrime ? '0 0 0 2px rgba(245,158,11,0.6)' : '0 0 0 1.5px rgba(255,255,255,0.08)',
            }}>
            {initials}
            {isPrime && (
              <span className="absolute -top-1 -right-1 leading-none" title="Prime">
                <Crown size={10} style={{ color: 'var(--amber)' }} fill="currentColor" />
              </span>
            )}
          </motion.button>
          <div className={wide ? 'flex items-center gap-1' : 'flex flex-col items-center gap-0.5'}>
          <button type="button" onClick={() => setMode(wide ? 'rail' : 'wide')}
            title={wide ? 'Свернуть названия' : 'Развернуть с описаниями'} aria-label={wide ? 'Свернуть панель' : 'Развернуть панель'}
            className="grid h-8 w-8 place-items-center rounded-xl" style={{ color: 'var(--t3)' }}>
            {wide ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <button type="button" onClick={() => setMode('hidden')} title="Спрятать панель" aria-label="Спрятать панель"
            className="grid h-8 w-8 place-items-center rounded-xl" style={{ color: 'var(--t3)' }}>
            <ChevronLeft size={17} />
          </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
