import { BufferingRing, useBuffering } from '@/player/BufferingRing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue } from 'framer-motion';
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1,
  ListMusic, Music2} from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { BottomSheet } from './BottomSheet';
import { haptic } from './haptics';
import { VideoBackdrop } from '@/music/VideoBackdrop';
import { openArtistCard } from '@/music/artistBridge';
import { MusicContinue } from '@/handoff/Slots';

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
  const buffering = useBuffering();

  const [showQueue, setShowQueue] = useState(false);
  /* «Скрыть текст»: по центру остаются только обложка и кнопки управления (общий выбор с ПК-плеером). */
  const [bare, setBareState] = useState(() => { try { return localStorage.getItem('sky:fullplayer:bare') === '1'; } catch { return false; } });
  const setBare = (v: boolean) => { setBareState(v); try { localStorage.setItem('sky:fullplayer:bare', v ? '1' : '0'); } catch { /* не критично */ } };
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const dragY = useMotionValue(0);
  const lyricsRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  const lyrics = useMemo(() => {
    const base = (item?.lyrics ?? []).filter((l) => l.text);
    // Без меток времени все строки имеют время 0 — растягиваем равномерно по песне.
    if (base.length > 1 && base.every((l) => l.t <= 0)) {
      const per = duration > 0 ? duration / base.length : 4;
      return base.map((l, i) => ({ ...l, t: i * per }));
    }
    return base;
  }, [item?.lyrics, duration]);
  const activeLine = useMemo(() => lyrics.reduce((best, l, i) => l.t <= currentTime ? i : best, -1), [lyrics, currentTime]);

  useEffect(() => {
    if (activeLine < 0) return;
    lineRefs.current[activeLine]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeLine]);

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
          initial={{ y: '100%', opacity: 1 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className="fixed inset-0 z-[95] flex flex-col overflow-hidden">
          {/* Видеофон трека: z=-1 внутри контекста корня — под всем содержимым, над градиентом. */}
          <VideoBackdrop src={item.videoUrl} playing={isPlaying} z={-1} />

          {/* Верхняя панель — с запасом сверху: на телефоне её иначе перекрывает системная строка состояния. */}
          <div className="flex shrink-0 items-center justify-between px-5" style={{ paddingTop: 'calc(var(--safe-top) + 22px)' }}>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <ChevronDown size={18} className="text-white"/>
            </button>
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/60">Сейчас играет</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { haptic('selection'); setBare(!bare); }} aria-pressed={bare}
                className="grid h-9 place-items-center rounded-full px-3 text-[11px] font-bold text-white" style={{ background: bare ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)' }}>
                {bare ? 'Показать текст' : 'Скрыть текст'}
              </button>
              <MusicContinue label={false} className="grid h-9 w-9 place-items-center rounded-full text-white" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <button type="button" onClick={() => setShowQueue(true)} className="grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.1)' }}>
                <ListMusic size={16} className="text-white"/>
              </button>
            </div>
          </div>

          {/* Текст песни — сверху и первым, чтобы помещался целиком, а не обрезался под маленький экран. */}
          {bare ? <div className="min-h-0 flex-1" /> : <div ref={lyricsRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-4 text-center">
            {lyrics.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-[13px] text-white/50">Текст песни недоступен</p>
              </div>
            ) : lyrics.map((l, i) => (
              <p key={i} ref={el => { lineRefs.current[i] = el; }}
                className="my-2.5 text-[16px] font-bold leading-snug transition-all"
                style={{ color: i === activeLine ? '#fff' : i < activeLine ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.5)', transform: i === activeLine ? 'scale(1.04)' : 'scale(1)' }}>
                {l.text}
              </p>
            ))}
          </div>}

          {/* Обложка с кнопками управления — под текстом, компактнее, чтобы обоим хватило места. */}
          <div className="shrink-0 flex flex-col items-center px-8 pt-1">
            <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              className={`relative aspect-square w-full ${bare ? 'max-w-[260px]' : 'max-w-[168px]'} overflow-hidden rounded-2xl`}
              style={{ background: item.coverUrl ? `url(${item.coverUrl}) center/cover` : `linear-gradient(135deg, ${g1}, ${g2})`, boxShadow: '0 14px 40px rgba(0,0,0,0.5)' }}>
              {!item.coverUrl && (
                <div className="grid h-full place-items-center">
                  <Music2 size={40} style={{ color: 'rgba(255,255,255,0.55)' }}/>
                </div>
              )}
            </motion.div>
          </div>

          {/* Скраббер */}
          <div className="shrink-0 px-6 pt-3">
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
          <div className="flex shrink-0 items-center justify-between px-6 py-3">
            <button type="button" onClick={() => { haptic('selection'); setShuffle(!shuffle); }}>
              <Shuffle size={18} style={{ color: shuffle ? '#fff' : 'rgba(255,255,255,0.4)' }}/>
            </button>
            <button type="button" onClick={() => { haptic('light'); prevTrack(); }}>
              <SkipBack size={26} className="text-white" fill="currentColor"/>
            </button>
            <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={() => { haptic('medium'); setPlaying(!isPlaying); }}
              className="grid h-16 w-16 place-items-center rounded-full bg-white">
              {buffering ? <BufferingRing size={28} color={g2}/> : isPlaying ? <Pause size={26} style={{ color: g2 }}/> : <Play size={26} className="ml-1" style={{ color: g2 }}/>}
            </motion.button>
            <button type="button" onClick={() => { haptic('light'); nextTrack(); }}>
              <SkipForward size={26} className="text-white" fill="currentColor"/>
            </button>
            <button type="button" onClick={() => { haptic('selection'); setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'); }}>
              {repeat === 'one' ? <Repeat1 size={18} className="text-white"/> : <Repeat size={18} style={{ color: repeat === 'all' ? '#fff' : 'rgba(255,255,255,0.4)' }}/>}
            </button>
          </div>

          {/* Название и исполнитель — в самом низу экрана (в режиме «Скрыть текст» их нет — снизу просто пустое место). */}
          {bare ? <div className="min-h-0 flex-1" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }} /> : <div className="shrink-0 px-6 pb-2" style={{ paddingBottom: 'calc(var(--safe-bottom) + 16px)' }}>
            <p className="truncate text-center text-[17px] font-black text-white">{item.title}</p>
            <button type="button" className="mx-auto block max-w-full truncate text-center text-[13px] text-white/60 underline-offset-2 active:underline"
              onClick={() => { haptic('selection'); onClose(); openArtistCard(item.author); }}>{item.author}</button>
          </div>}

          <BottomSheet open={showQueue} onClose={() => setShowQueue(false)} title="Очередь" snapPoints={[0.6]}>
            <div className="space-y-1 px-4 pb-6">
              {(item.queue ?? []).map((q, i) => (
                <button key={q.id + i} type="button" onClick={() => { playQueueIndex(i); setShowQueue(false); }}
                  className="flex w-full items-center gap-3 rounded-xl p-2.5" style={{ background: i === item.qIdx ? 'var(--accent-bg)' : 'transparent' }}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white" style={{ background: q.coverUrl ? `url(${q.coverUrl}) center/cover` : `hsl(${q.hue ?? 210},60%,35%)` }}>
                    {!q.coverUrl && <Music2 size={16} style={{ color: 'rgba(255,255,255,0.55)' }}/>}
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
