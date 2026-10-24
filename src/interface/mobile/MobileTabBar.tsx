import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, Sparkles, LayoutGrid, Bell, User, Grid3x3, ChevronRight, ChevronLeft } from 'lucide-react';
import { useModuleStore } from '@/data/state/modules';
import type { ModuleKey } from '@/data/state/modules';
import { useNavPrefs, useNavBadges, fmtBadge } from '@/interface/layout/navPrefs';
import { haptic } from './haptics';

const PRIMARY: { key: ModuleKey; label: string; icon: any }[] = [
  { key: 'messages',      label: 'Чаты',    icon: MessageCircle },
  { key: 'bloom',         label: 'Bloom',   icon: Sparkles },
  { key: 'extras',        label: 'Sky',     icon: LayoutGrid },
  { key: 'notifications', label: 'Уведом.', icon: Bell },
  { key: 'profile',       label: 'Профиль', icon: User },
];

/**
 * Нижняя панель: плавающая, скруглённая, с объёмом. Её можно спрятать за
 * правый край (кнопка-язычок или свайп вправо) — остаётся язычок у края,
 * он возвращает панель. Состояние запоминается.
 */
export const MobileTabBar = ({ onMore }: { onMore: () => void }) => {
  const { activeModule, setActiveModule } = useModuleStore();
  const hidden = useNavPrefs((s) => s.mobileHidden);
  const setHidden = useNavPrefs((s) => s.setMobileHidden);
  const badges = useNavBadges();

  return (
    <div className="relative shrink-0" style={{ zIndex: 30 }}>
      <AnimatePresence initial={false}>
        {hidden ? (
          <motion.button key="tab" type="button" aria-label="Показать панель"
            initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
            onClick={() => { haptic('selection'); setHidden(false); }}
            className="nav-tab fixed right-0 grid h-14 w-6 place-items-center"
            style={{ bottom: 'calc(var(--safe-bottom) + 14px)', borderRadius: '16px 0 0 16px', borderRight: 0, zIndex: 40 }}>
            <ChevronLeft size={15} />
          </motion.button>
        ) : (
          <motion.div key="bar" className="px-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 4px)', paddingTop: 6 }}
            initial={{ x: '110%' }} animate={{ x: 0 }} exit={{ x: '110%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
>
            <div className="glass-pill flex items-center justify-around px-1.5 py-1">
              {PRIMARY.map(({ key, label, icon: Icon }) => {
                const active = activeModule === key;
                const badge = badges[key] ?? 0;
                return (
                  <button key={key} type="button"
                    onClick={() => { haptic('selection'); setActiveModule(key); }}
                    className="relative isolate flex flex-1 flex-col items-center gap-0.5 py-1.5">
                    {active && (
                      <motion.div layoutId="mtab-lens" transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                        className="glass-lens absolute inset-x-0.5 inset-y-0 -z-10" />
                    )}
                    <motion.div className="relative" animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
                      <Icon size={22} strokeWidth={active ? 2.4 : 1.8} style={{ color: active ? 'var(--accent)' : 'var(--t3)' }} />
                      {badge > 0 && (
                        <span className="absolute -right-3 -top-2 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[9.5px] font-bold leading-none text-white"
                          style={{ background: '#ef4444', boxShadow: '0 0 0 1.5px var(--bg-l1)' }}>{fmtBadge(badge)}</span>
                      )}
                    </motion.div>
                    <span className="text-[9.5px] font-semibold" style={{ color: active ? 'var(--accent)' : 'var(--t3)' }}>{label}</span>
                  </button>
                );
              })}
              <button type="button" onClick={() => { haptic('selection'); onMore(); }}
                className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5">
                <Grid3x3 size={22} strokeWidth={1.8} style={{ color: 'var(--t3)' }} />
                <span className="text-[9.5px] font-semibold" style={{ color: 'var(--t3)' }}>Ещё</span>
              </button>
              <button type="button" aria-label="Спрятать панель" onClick={() => { haptic('selection'); setHidden(true); }}
                className="grid h-9 w-6 shrink-0 place-items-center" style={{ color: 'var(--t3)' }}>
                <ChevronRight size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
