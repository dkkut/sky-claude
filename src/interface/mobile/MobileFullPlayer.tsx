import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  ListMusic, Mic2, X,
} from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { BottomSheet } from './BottomSheet';
import { haptic } from './haptics';

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export const MobileFullPlayer = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const {
    item, isPlaying, currentTime, duration, shuffle, repeat,
    setPlaying, requestSeek, nextTrack, prevTrack, setShuffle, setRepeat, playQueueIndex,
  } = usePlayerStore();

  const [showQueue, setShowQueue] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const dragY = useMotionValue(0);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const lyrics = item?.lyrics ?? [];
  const activeLine = useMemo(() => lyrics.reduce((best, l, i) => l.t <= currentTime ? i : best, -1), [lyrics, currentTime]);

  useEffect(() => {
    if (!showLyrics || activeLine < 0) return;
    lineRefs.current[activeLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine, showLyrics]);

  useEffect(() => { if (open) dragY.set(0); }, [open]);

  if (!item) return null;
  const pct = scrubbing !== null ? scrubbing : (duration > 0 ? (currentTime / duration) * 100 : 0);
  const g1 = `hsl(${item.hue ?? 210},70%,22%)`, g2 = `hsl(${((item.hue ?? 210)+50)%360},60%,12%)`;

  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setScrubbing(p * 100);
  };
  const onScrubEnd = () => {
    if (scrubbing !== null && duration > 0) { requestSeek((scrubbing / 100) * duration); haptic('light'); }
    setScrubbing(null);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          drag="y" dragElastic={0.08} dragConstraints={{ top: 0, bottom: 0 }}
          onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 700) { haptic('light'); onClose(); } }}
          style={{ y: dragY, background: `linear-gradient(160deg, ${g1}, ${g2} 70%)` }}
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed inset-0 z-[95] flex flex-col overflow-hidden">

          <div className="flex shrink-0 items-center justify-between px-5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <ChevronDown size={18} className="text-white"/>
            </button>
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">Сейчас играет</p>
            <button type="button" onClick={() => setShowQueue(true)} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <ListMusic size={16} className="text-white"/>
            </button>
          </div>

          {/* Обложка / текст песни */}
          <div className="flex flex-1 flex-col items-center justify-center px-8">
            {!showLyrics ? (
              <motion.div key="cover" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                className="relative aspect-square w-full max-w-[300px] overflow-hidden rounded-3xl"
                style={{ background: item.coverUrl ? `url(${item.coverUrl}) center/cover` : `linear-gradient(135deg, ${g1}, ${g2})`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                {!item.coverUrl && <div className="grid h-full place-items-center text-6xl">🎵</div>}
              </motion.div>
            ) : (
              <div ref={lyricsRef} className="h-full w-full overflow-y-auto py-10 text-center">
                {lyrics.length === 0 ? (
                  <p className="mt-20 text-[13px] text-white/50">Текст песни недоступен</p>
                ) : lyrics.map((l, i) => (
                  <p key={i} ref={el => { lineRefs.current[i] = el; }}
                    className="my-3 text-[19px] font-bold leading-snug transition-all"
                    style={{ color: i === activeLine ? '#fff' : 'rgba(255,255,255,0.35)', transform: i === activeLine ? 'scale(1.04)' : 'scale(1)' }}>
                    {l.text}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 px-6 pb-2">
            <p className="truncate text-center text-[19px] font-black text-white">{item.title}</p>
            <p className="truncate text-center text-[13px] text-white/60">{item.author}</p>
          </div>

          {/* Скраббер */}
          <div className="shrink-0 px-6 pt-4">
            <div className="relative h-6 cursor-pointer" onPointerDown={onScrubMove} onPointerMove={e => e.buttons===1 && onScrubMove(e)} onPointerUp={onScrubEnd}>
              <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/20"/>
              <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white" style={{ width: `${pct}%` }}/>
              <motion.div className="absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white" style={{ left: `${pct}%` }} animate={{ scale: scrubbing !== null ? 1.3 : 1 }}/>
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-white/50">
              <span>{fmtTime(scrubbing !== null ? (scrubbing/100)*duration : currentTime)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
          </div>

          {/* Управление */}
          <div className="flex shrink-0 items-center justify-between px-6 py-5">
            <button type="button" onClick={() => { haptic('selection'); setShuffle(!shuffle); }}>
              <Shuffle size={18} style={{ color: shuffle ? '#fff' : 'rgba(255,255,255,0.4)' }}/>
            </button>
            <button type="button" onClick={() => { haptic('light'); prevTrack(); }}>
              <SkipBack size={26} className="text-white" fill="currentColor"/>
            </button>
            <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => { haptic('medium'); setPlaying(!isPlaying); }}
              className="grid h-16 w-16 place-items-center rounded-full bg-white">
              {isPlaying ? <Pause size={26} style={{ color: g2 }}/> : <Play size={26} className="ml-1" style={{ color: g2 }}/>}
            </motion.button>
            <button type="button" onClick={() => { haptic('light'); nextTrack(); }}>
              <SkipForward size={26} className="text-white" fill="currentColor"/>
            </button>
            <button type="button" onClick={() => { haptic('selection'); setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'); }}>
              {repeat === 'one' ? <Repeat1 size={18} className="text-white"/> : <Repeat size={18} style={{ color: repeat === 'all' ? '#fff' : 'rgba(255,255,255,0.4)' }}/>}
            </button>
          </div>

          <div className="flex shrink-0 justify-center pb-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <button type="button" onClick={() => setShowLyrics(v => !v)}
              className="flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-bold"
              style={{ background: showLyrics ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)', color: '#fff' }}>
              <Mic2 size={13}/>{showLyrics ? 'Обложка' : 'Текст песни'}
            </button>
          </div>

          <BottomSheet open={showQueue} onClose={() => setShowQueue(false)} title="Очередь" snapPoints={[0.6]}>
            <div className="space-y-1 px-4 pb-6">
              {(item.queue ?? []).map((q, i) => (
                <button key={q.id + i} type="button" onClick={() => { playQueueIndex(i); setShowQueue(false); }}
                  className="flex w-full items-center gap-3 rounded-xl p-2.5" style={{ background: i === item.qIdx ? 'var(--accent-bg)' : 'transparent' }}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: q.coverUrl ? `url(${q.coverUrl}) center/cover` : `hsl(${q.hue ?? 210},60%,35%)` }}>
                    {!q.coverUrl && '🎵'}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[13px] font-semibold" style={{ color: i === item.qIdx ? 'var(--accent)' : 'var(--t1)' }}>{q.title}</p>
                    <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{q.author}</p>
                  </div>
                </button>
              ))}
            </div>
          </BottomSheet>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
