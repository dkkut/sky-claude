/* ===========================================================
   SKY TV — боковая панель (концепт ПК-версии: вертикальная панель
   с иконками и индикатором раздела). Узкая в покое, раскрывается с
   подписями, когда на неё переходит фокус пульта.
=========================================================== */
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Home, Film, Music2, Play, Tv2, Mic2, Bookmark, Library, User, type LucideIcon } from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { TVFocusable } from './TVFocusable';
import { useTVFocusedId } from './focusManager';
import type { TVScreen } from './tvNavStore';

export type NavKind = 'search' | 'home' | 'movies' | 'music' | 'video' | 'channels' | 'podcasts' | 'collection' | 'library' | 'profile';

const ITEMS: { key: NavKind; label: string; icon: LucideIcon }[] = [
  { key: 'search', label: 'Поиск', icon: Search },
  { key: 'home', label: 'Главная', icon: Home },
  { key: 'movies', label: 'Фильмы', icon: Film },
  { key: 'music', label: 'Sky Music', icon: Music2 },
  { key: 'video', label: 'SkyVideo', icon: Play },
  { key: 'channels', label: 'Телеканалы', icon: Tv2 },
  { key: 'podcasts', label: 'Подкасты', icon: Mic2 },
  { key: 'collection', label: 'Моя коллекция', icon: Bookmark },
  { key: 'library', label: 'Библиотека', icon: Library },
];

export const SIDEBAR_W = 108;
const OPEN_W = 360;

/** Какой пункт панели подсвечен для открытого экрана. */
export const navKindFor = (k: TVScreen['kind']): NavKind => {
  if (k === 'movieDetail' || k === 'player' || k === 'series' || k === 'favorites') return k === 'favorites' ? 'collection' : 'movies';
  if (k === 'settings') return 'profile';
  return k as NavKind;
};

const Row = ({ k, label, icon: Icon, active, open, onNavigate }: { k: NavKind; label: string; icon: LucideIcon; active: NavKind; open: boolean; onNavigate: (k: NavKind) => void }) => (
  <TVFocusable id={`nav-${k}`} onEnter={() => onNavigate(k)} autoFocusPriority={active === k ? -1 : undefined}>
    {({ focused }) => (
      <div className="relative flex items-center gap-5 rounded-[22px] py-3.5 pl-[26px] pr-5" aria-label={label}
        style={{
          background: focused ? 'rgba(255,255,255,0.16)' : active === k ? 'rgba(139,124,255,0.14)' : 'transparent',
          boxShadow: focused ? '0 0 0 3px #b3a7ff, 0 0 28px rgba(139,124,255,0.45)' : 'none',
          transition: 'background .15s, box-shadow .15s',
        }}>
        {active === k && <span className="absolute left-[8px] top-1/2 h-7 w-[4px] -translate-y-1/2 rounded-full" style={{ background: '#8b7cff' }} />}
        <Icon size={30} strokeWidth={active === k || focused ? 2.4 : 1.8} color={focused || active === k ? '#fff' : 'rgba(255,255,255,0.62)'} className="shrink-0" />
        <AnimatePresence>
          {open && (
            <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}
              className="whitespace-nowrap text-[24px]" style={{ color: '#fff', fontWeight: active === k || focused ? 700 : 500 }}>
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    )}
  </TVFocusable>
);

export const TVSidebar = ({ active, onNavigate }: { active: NavKind; onNavigate: (k: NavKind) => void }) => {
  const focusedId = useTVFocusedId();
  const open = !!focusedId && focusedId.startsWith('nav-');
  const me = useAuthStore((s) => s.accounts.find((a) => a.id === s.currentUserId));

  return (
    <div className="relative z-[60] shrink-0" style={{ width: SIDEBAR_W }}>
      <motion.nav aria-label="Разделы" className="absolute inset-y-0 left-0 flex flex-col overflow-hidden py-8"
        animate={{ width: open ? OPEN_W : SIDEBAR_W }} transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        style={{
          background: open ? 'linear-gradient(90deg, rgba(8,8,22,0.985) 78%, rgba(8,8,22,0.0))' : 'linear-gradient(90deg, rgba(8,8,22,0.92), rgba(8,8,22,0.55))',
          borderRight: open ? 'none' : '1px solid rgba(160,150,255,0.14)',
        }}>
        <div className="mb-6 flex items-center gap-4 pl-[22px]">
          <img src="/logo.png" alt="Sky" draggable={false} className="h-12 w-12 shrink-0 object-contain" style={{ filter: 'drop-shadow(0 0 12px rgba(139,124,255,0.55))' }} />
          <AnimatePresence>{open && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-[28px] font-extrabold tracking-wide text-white" translate="no">Sky TV</motion.span>}</AnimatePresence>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-3">
          {ITEMS.map((i) => <Row key={i.key} k={i.key} label={i.label} icon={i.icon} active={active} open={open} onNavigate={onNavigate} />)}
        </div>
        <div className="px-3">
          <TVFocusable id="nav-profile" onEnter={() => onNavigate('profile')}>
            {({ focused }) => (
              <div className="flex items-center gap-4 rounded-[22px] py-3 pl-[18px] pr-4" aria-label="Профиль"
                style={{ background: focused ? 'rgba(255,255,255,0.16)' : active === 'profile' ? 'rgba(139,124,255,0.14)' : 'transparent', boxShadow: focused ? '0 0 0 3px #b3a7ff, 0 0 28px rgba(139,124,255,0.45)' : 'none' }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-violet-500 text-[18px] font-bold text-white"
                  style={me?.avatar ? { background: `center/cover url(${me.avatar})` } : undefined} translate="no">
                  {!me?.avatar && (me?.name?.[0]?.toUpperCase() ?? <User size={20} />)}
                </span>
                <AnimatePresence>
                  {open && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-w-0">
                      <span className="block truncate text-[22px] font-semibold text-white" translate="no">{me?.name ?? 'Профиль'}</span>
                      <span className="block text-[15px] text-white/55">Профиль и настройки</span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            )}
          </TVFocusable>
        </div>
      </motion.nav>
    </div>
  );
};
