import { AiCallButton } from '@/island/AiCallButton';
import { Camera, Gamepad2, Film, Library, Palette, Building2, ChevronRight } from 'lucide-react';
import { BottomSheet } from './BottomSheet';
import { useModuleStore } from '@/data/state/modules';
import type { ModuleKey } from '@/data/state/modules';
import { haptic } from './haptics';

const SECONDARY: { key: ModuleKey; label: string; desc: string; icon: any; color: string }[] = [
  { key: 'stories', label: 'Истории',  desc: 'Фото и видео на 24 часа',        icon: Camera,   color: '#ec4899' },
  { key: 'gaming',  label: 'Игры',     desc: 'Sky Games, турниры, достижения', icon: Gamepad2, color: '#8b5cf6' },
  { key: 'video',   label: 'Видео',    desc: 'Sky Video, трансляции',          icon: Film,     color: '#ef4444' },
  { key: 'library', label: 'Библиотека', desc: 'Книги и подписки',             icon: Library,  color: '#f59e0b' },
  { key: 'studio',  label: 'Студия',   desc: 'Творческие инструменты',         icon: Palette,  color: '#06b6d4' },
  { key: 'business', label: 'Бизнес',  desc: 'Магазин, ПВЗ, логистика, касса', icon: Building2, color: '#10b981' },
];

export const MoreSheet = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const { setActiveModule } = useModuleStore();

  return (
    <BottomSheet open={open} onClose={onClose} title="Ещё" snapPoints={[0.5]}>
      <div className="space-y-1.5 px-3 pb-5">
        <AiCallButton className="w-full rounded-xl p-2.5 justify-start" />
        {SECONDARY.map(({ key, label, desc, icon: Icon, color }) => (
          <button key={key} type="button"
            onClick={() => { haptic('selection'); setActiveModule(key); onClose(); }}
            className="flex w-full items-center gap-2.5 rounded-xl p-2.5"
            style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `${color}20` }}>
              <Icon size={16} style={{ color }}/>
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-[13px] font-bold" style={{ color: 'var(--t1)' }}>{label}</p>
              <p className="truncate text-[10.5px]" style={{ color: 'var(--t3)' }}>{desc}</p>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--t3)' }}/>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
};
