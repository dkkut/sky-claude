import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipForward, Music2} from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { haptic } from './haptics';

export const MobileMiniPlayer = ({ onOpen }: { onOpen: () => void }) => {
  const { item, isPlaying, currentTime, duration, setPlaying, nextTrack } = usePlayerStore();

  return (
    <AnimatePresence>
      {item && (
        <motion.button type="button" onClick={() => { haptic('light'); onOpen(); }}
          initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="relative mx-3 mb-2 flex items-center gap-3 overflow-hidden rounded-2xl p-2 text-left"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
          <div className="absolute bottom-0 left-0 h-[2.5px] bg-white/10" style={{ width: '100%' }}>
            <div className="h-full" style={{ width: `${duration ? (currentTime/duration)*100 : 0}%`, background: 'var(--accent)' }}/>
          </div>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white"
            style={{ background: item.coverUrl ? `url(${item.coverUrl}) center/cover` : `hsl(${item.hue ?? 210},60%,40%)` }}>
            {!item.coverUrl && <Music2 size={16} style={{ color: 'rgba(255,255,255,0.55)' }}/>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-bold" style={{ color: 'var(--t1)' }}>{item.title}</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{item.author}</p>
          </div>
          <button type="button" onClick={(e) => { e.stopPropagation(); haptic('light'); setPlaying(!isPlaying); }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'var(--accent)' }}>
            {isPlaying ? <Pause size={15} className="text-white"/> : <Play size={15} className="ml-0.5 text-white"/>}
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); haptic('selection'); nextTrack(); }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <SkipForward size={14} style={{ color: 'var(--t2)' }}/>
          </button>
        </motion.button>
      )}
    </AnimatePresence>
  );
};
