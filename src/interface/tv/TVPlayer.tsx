/* ===========================================================
   SKY TV — Плеер
   Полноэкранный, минимальный интерфейс, управление пультом.
   ← → перематывают на 10с, OK — показать контролы/play-pause,
   контролы скрываются сами через несколько секунд бездействия.
=========================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX, Subtitles, Settings2, ChevronLeft } from 'lucide-react';
import { usePlatformStore } from '@/platform/store';
import { useVideoStore } from '@/video/store';
import { useAuthStore } from '@/core/auth/store';
import { recordProgress } from './watchProgressStore';
import { useTVKeyBindings } from './useTVKeyBindings';
import { useRegisterWatchActivity } from '@/settings/breakReminderStore';

export type TVPlayerSource = { kind: 'movie'; id: string } | { kind: 'video'; id: string };
interface TVPlayerProps { source: TVPlayerSource; onBack: () => void; }

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export const TVPlayer = ({ source, onBack }: TVPlayerProps) => {
  const movie = usePlatformStore(s => source.kind === 'movie' ? s.movies.find(m => m.id === source.id) : undefined);
  const video = useVideoStore(s => source.kind === 'video' ? s.videos.find(v => v.id === source.id) : undefined);
  const { currentUserId } = useAuthStore();
  const incrementViews = useVideoStore(s => s.incrementViews);
  const addToHistory = useVideoStore(s => s.addToHistory);

  const title = movie?.title ?? video?.title ?? '';
  const sourceUrl = movie?.sourceUrl ?? video?.sourceUrl;
  const contentId = source.id;

  const vRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const { setPlaying: registerActive, setPauseHandler } = useRegisterWatchActivity();

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  useEffect(() => { showControls(); return () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }; }, [showControls]);

  useEffect(() => {
    registerActive(playing);
    return () => registerActive(false);
  }, [playing, registerActive]);
  useEffect(() => {
    setPauseHandler(() => { vRef.current?.pause(); setPlaying(false); });
    return () => setPauseHandler(null);
  }, [setPauseHandler]);

  /* реально пишем прогресс просмотра — раз в 5с и при уходе с экрана */
  useEffect(() => {
    saveTimer.current = window.setInterval(() => {
      const v = vRef.current;
      if (v && v.duration) recordProgress(contentId, v.currentTime, v.duration);
    }, 5000);
    return () => {
      if (saveTimer.current) window.clearInterval(saveTimer.current);
      const v = vRef.current;
      if (v && v.duration) recordProgress(contentId, v.currentTime, v.duration);
    };
  }, [contentId]);

  /* для SkyVideo — реальный счётчик просмотров и история, как у обычного плеера видео */
  useEffect(() => {
    if (source.kind !== 'video') return;
    incrementViews(source.id);
    if (currentUserId) addToHistory(currentUserId, source.id);
  }, [source.kind, source.id, currentUserId, incrementViews, addToHistory]);

  const togglePlay = useCallback(() => {
    const v = vRef.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }, []);

  const seek = useCallback((delta: number) => {
    const v = vRef.current; if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }, []);

  useTVKeyBindings({
    mode: 'player',
    onBack,
    onPlayPause: togglePlay,
    onSeek: seek,
    onShowControls: showControls,
  });

  if (!movie && !video) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3" style={{ background: '#000' }}>
        <p className="text-lg font-bold text-white">Видео не найдено</p>
        <button type="button" onClick={onBack} className="rounded-xl px-5 py-2.5 text-sm font-bold text-white" style={{ background: 'var(--accent)' }}>Назад</button>
      </div>
    );
  }

  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div className="fixed inset-0 z-[200] bg-black" onMouseMove={showControls}>
      {sourceUrl ? (
        <video ref={vRef} src={sourceUrl} autoPlay className="h-full w-full object-contain"
          onTimeUpdate={e => setCur(e.currentTarget.currentTime)}
          onDurationChange={e => setDur(e.currentTarget.duration)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onEnded={onBack}/>
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center gap-3">
          <Play size={64} color="rgba(255,255,255,0.15)"/>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Видеофайл ещё не загружен</p>
        </div>
      )}

      <AnimatePresence>
        {controlsVisible && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {/* верх */}
            <div className="flex items-center gap-4 p-8 pointer-events-auto" style={{ background: 'linear-gradient(rgba(0,0,0,0.7),transparent)' }}>
              <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
                <ChevronLeft size={22} color="#fff"/>
              </button>
              <p className="text-[20px] font-bold text-white">{title}</p>
            </div>

            {/* низ */}
            <div className="p-8 pointer-events-auto" style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.8))' }}>
              <div className="mb-3 h-[5px] w-full rounded-full bg-white/20 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }}/>
              </div>
              <div className="flex items-center justify-between text-[13px] font-semibold mb-3" style={{ color: 'rgba(255,255,255,0.65)' }}>
                <span>{fmt(cur)}</span><span>{fmt(dur)}</span>
              </div>
              <div className="flex items-center gap-4">
                <button type="button" onClick={togglePlay} className="grid h-14 w-14 place-items-center rounded-full" style={{ background: '#fff' }}>
                  {playing ? <Pause size={24} color="#0a0a0e" fill="#0a0a0e"/> : <Play size={24} color="#0a0a0e" fill="#0a0a0e"/>}
                </button>
                <button type="button" onClick={() => setMuted(m => { if (vRef.current) vRef.current.muted = !m; return !m; })}
                  className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}>
                  {muted ? <VolumeX size={19} color="#fff"/> : <Volume2 size={19} color="#fff"/>}
                </button>
                <div className="flex-1"/>
                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  <Subtitles size={17}/> Субтитры выкл.
                </div>
                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.55)' }}>
                  <Settings2 size={17}/> Авто
                </div>
              </div>
              <p className="mt-3 text-[12px]" style={{ color: 'rgba(255,255,255,0.35)' }}>← 10с назад · → 10с вперёд · OK пауза/пуск · Back выход</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
