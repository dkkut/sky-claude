/* -- Мини-плеер — Apple Dynamic Island style ────────────── */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, SkipForward, SkipBack, Music2 } from 'lucide-react';
import type { Track } from '@/platform/store';
import { getG } from './utils';

interface Props {
  track:       Track;
  playing:     boolean;
  currentTime: number;
  duration:    number;
  onPlay:      () => void;
  onNext:      () => void;
  onPrev?:     () => void;
  onOpen:      () => void;
}

export const MiniPlayer = ({ track, playing, currentTime, duration, onPlay, onNext, onPrev, onOpen }: Props) => {
  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const [c1, c2] = getG(track.id);
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      className="absolute top-0 inset-x-0 z-50 flex justify-center pointer-events-none"
      style={{ padding: '8px 0 0' }}>
      <motion.div
        layout
        onClick={() => setExpanded(e => !e)}
        className="pointer-events-auto cursor-pointer overflow-hidden relative"
        style={{ borderRadius: expanded ? 24 : 36 }}
        animate={{
          width:  expanded ? 360 : 160,
          height: expanded ? 92  : 36,
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}>

        {/* Background — dark pill */}
        <div className="absolute inset-0"
          style={{ background: '#111', borderRadius: 'inherit' }}/>

        {/* Ambient glow from track color */}
        <motion.div className="absolute inset-0 pointer-events-none"
          style={{ borderRadius: 'inherit',
            background: `radial-gradient(ellipse at 30% 50%, ${c1}40 0%, transparent 65%),
                         radial-gradient(ellipse at 70% 50%, ${c2}30 0%, transparent 65%)`,
          }}/>

        {/* Collapsed: pill with album art + waveform */}
        <AnimatePresence>
          {!expanded && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center gap-2 px-3">
              {/* Mini cover */}
              <div className="w-6 h-6 rounded-full shrink-0 overflow-hidden flex items-center justify-center"
                style={{ background: `linear-gradient(135deg,${c1},${c2})` }}>
                {track.coverUrl
                  ? <img src={track.coverUrl} alt="" className="w-full h-full object-cover"/>
                  : <Music2 size={12} className="text-white"/>}
              </div>
              {/* Animated waveform bars */}
              <div className="flex items-center gap-0.5" style={{ height: 14 }}>
                {[0,1,2,3,4].map(i => (
                  <motion.div key={i}
                    className="rounded-full"
                    style={{ width: 2, background: `linear-gradient(to top, ${c1}, ${c2})` }}
                    animate={playing
                      ? { height: [4, 14, 6, 12, 4][i % 5], opacity: 1 }
                      : { height: 4, opacity: 0.4 }}
                    transition={playing
                      ? { duration: 0.4 + i * 0.08, repeat: Infinity, repeatType: 'mirror', delay: i * 0.06 }
                      : {}}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expanded: full mini-player */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: 0.08 } }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center gap-3 px-4">
              {/* Cover */}
              <motion.div
                className="shrink-0 rounded-xl overflow-hidden flex items-center justify-center"
                style={{ width: 60, height: 60, background: `linear-gradient(135deg,${c1},${c2})`,
                  boxShadow: `0 4px 16px ${c1}60` }}>
                {track.coverUrl
                  ? <img src={track.coverUrl} alt="" className="w-full h-full object-cover"/>
                  : <Music2 size={24} className="text-white"/>}
                {/* Rotation animation */}
                {playing && (
                  <motion.div className="absolute inset-0 rounded-xl"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                    style={{ border: `1px solid rgba(255,255,255,0.15)`, borderRadius: 'inherit' }}/>
                )}
              </motion.div>

              {/* Info + controls */}
              <div className="flex-1 min-w-0" onClick={e => e.stopPropagation()}>
                {/* Track info */}
                <div onClick={onOpen} className="cursor-pointer mb-2">
                  <p className="text-sm font-semibold text-white truncate leading-tight">{track.title}</p>
                  <p className="text-[11px] truncate" style={{ color: 'rgba(255,255,255,0.5)' }}>{track.artist}</p>
                </div>
                {/* Progress bar */}
                <div className="h-1 rounded-full mb-2.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.12)' }}>
                  <motion.div className="h-full rounded-full"
                    animate={{ width: `${pct}%` }}
                    style={{ background: `linear-gradient(90deg,${c1},${c2})` }}/>
                </div>
                {/* Controls */}
                <div className="flex items-center justify-between">
                  {onPrev && (
                    <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={onPrev}
                      className="grid h-7 w-7 place-items-center rounded-full"
                      style={{ color: 'rgba(255,255,255,0.7)' }}>
                      <SkipBack size={14} fill="currentColor"/>
                    </motion.button>
                  )}
                  <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={onPlay}
                    className="grid h-9 w-9 place-items-center rounded-full"
                    style={{ background: 'white' }}>
                    {playing
                      ? <Pause size={15} fill="black" style={{ color: 'black' }}/>
                      : <Play  size={15} fill="black" style={{ color: 'black' }} className="ml-0.5"/>}
                  </motion.button>
                  <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={onNext}
                    className="grid h-7 w-7 place-items-center rounded-full"
                    style={{ color: 'rgba(255,255,255,0.7)' }}>
                    <SkipForward size={14} fill="currentColor"/>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </motion.div>
  );
};
