import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { useModuleStore } from '@/data/state/modules';
import { useRegionStore, findCountry } from '@/region/store';
import { RegionPicker } from '@/region/RegionPicker';
import { useNotifStore } from '@/notifications/store';
import { haptic } from './haptics';

const TITLES: Record<string, string> = {
  stories: 'Истории', messages: 'Чаты', bloom: 'Bloom', extras: 'Sky',
  profile: 'Профиль', notifications: 'Уведомления', gaming: 'Игры',
  video: 'Видео', library: 'Библиотека', studio: 'Студия',
};

export const MobileHeader = () => {
  const { activeModule, setActiveModule } = useModuleStore();
  const { code } = useRegionStore();
  const { notifs } = useNotifStore();
  const unread = notifs.filter(n => !n.read).length;
  const [showRegion, setShowRegion] = useState(false);

  return (
    <div className="flex shrink-0 items-center justify-between px-4 pb-2"
      style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
      <h1 className="text-[20px] font-black tracking-tight" style={{ color: 'var(--t1)' }}>{TITLES[activeModule] ?? 'Sky'}</h1>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => { haptic('light'); setShowRegion(true); }}
          className="grid h-9 w-9 place-items-center rounded-full text-base" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          {findCountry(code).flag}
        </button>
        <button type="button" onClick={() => { haptic('light'); setActiveModule('notifications'); }}
          className="relative grid h-9 w-9 place-items-center rounded-full" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <Bell size={16} style={{ color: 'var(--t2)' }}/>
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold text-white" style={{ background: 'var(--red)' }}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </div>

      <AnimatePresence>
        {showRegion && <RegionPicker onClose={() => setShowRegion(false)}/>}
      </AnimatePresence>
    </div>
  );
};
