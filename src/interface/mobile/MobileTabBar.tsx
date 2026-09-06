import { motion } from 'framer-motion';
import { MessageCircle, Sparkles, LayoutGrid, Bell, User, Grid3x3 } from 'lucide-react';
import { useModuleStore } from '@/data/state/modules';
import type { ModuleKey } from '@/data/state/modules';
import { haptic } from './haptics';

const PRIMARY: { key: ModuleKey; label: string; icon: any }[] = [
  { key: 'messages',      label: 'Чаты',    icon: MessageCircle },
  { key: 'bloom',         label: 'Bloom',   icon: Sparkles },
  { key: 'extras',        label: 'Sky',     icon: LayoutGrid },
  { key: 'notifications', label: 'Уведом.', icon: Bell },
  { key: 'profile',       label: 'Профиль', icon: User },
];

export const MobileTabBar = ({ onMore }: { onMore: () => void }) => {
  const { activeModule, setActiveModule } = useModuleStore();

  return (
    <div className="shrink-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)', background: 'rgba(10,10,15,0.82)', backdropFilter: 'blur(24px) saturate(180%)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-around px-1 pt-1.5 pb-1">
        {PRIMARY.map(({ key, label, icon: Icon }) => {
          const active = activeModule === key;
          return (
            <button key={key} type="button"
              onClick={() => { haptic('selection'); setActiveModule(key); }}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5">
              {active && (
                <motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className="absolute -top-1.5 h-1 w-6 rounded-full" style={{ background: 'var(--accent)' }}/>
              )}
              <motion.div animate={{ scale: active ? 1.08 : 1, y: active ? -1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
                <Icon size={22} strokeWidth={active ? 2.4 : 1.8} style={{ color: active ? 'var(--accent)' : 'var(--t3)' }}/>
              </motion.div>
              <span className="text-[9.5px] font-semibold" style={{ color: active ? 'var(--accent)' : 'var(--t3)' }}>{label}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => { haptic('selection'); onMore(); }}
          className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5">
          <Grid3x3 size={22} strokeWidth={1.8} style={{ color: 'var(--t3)' }}/>
          <span className="text-[9.5px] font-semibold" style={{ color: 'var(--t3)' }}>Ещё</span>
        </button>
      </div>
    </div>
  );
};
