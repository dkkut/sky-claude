/* ===========================================================
   SKY TV — Плеер
   Полноэкранный, минимальный интерфейс, управление пультом.
   ← → перематывают на 10с, OK — показать контролы/play-pause,
   контролы скрываются сами через несколько секунд бездействия.
=========================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX, Subtitles, Settings2, ChevronLeft } from 'lucide-react';
import { useSkyVideoStore } from '@/video/serverStore';
import { videoUrl as skyVideoUrl, apiSkyVideoTicket } from '@/video/skyVideoApi';
import { reloadWithFreshTicket, describeMediaFailure } from '@/core/mediaTicketRefresh';
import { recordProgress } from './watchProgressStore';
import { useFilmStore } from '@/film/serverStore';
import { videoUrl, apiFilmTicket } from '@/film/filmApi';
import { useTVKeyBindings } from './useTVKeyBindings';
import { useRegisterWatchActivity } from '@/settings/breakReminderStore';
import { apiMovie, type ServerMovie } from '@/film/filmApi';
import { useEpisodeExtras } from '@/film/useEpisodeExtras';
import { SkipForward } from 'lucide-react';

export type TVPlayerSource = { kind: 'movie'; id: string } | { kind: 'video'; id: string };
interface TVPlayerProps { source: TVPlayerSource; onBack: () => void; /** Запустить другую серию (заменяет текущий экран плеера). */ onPlayEpisode?: (id: string) => void; }

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

export const TVPlayer = ({ source, onBack, onPlayEpisode }: TVPlayerProps) => {
  const storeMovie = useFilmStore(s => (source.kind === 'movie'
    ? s.catalog.find(m => m.id === source.id) ?? s.mine.find(m => m.id === source.id) ?? s.saved.find(m => m.id === source.id) ?? s.continueWatching.find(m => m.id === source.id)
    : undefined));
  /* Серии нет в списках стора, если открыта по ссылке из сериала — берём её у сервера. */
  const [fetched, setFetched] = useState<ServerMovie | null>(null);
  useEffect(() => {
    setFetched(null);
    if (source.kind !== 'movie' || storeMovie) return;
    let alive = true;
    void apiMovie(source.id).then(m => { if (alive) setFetched(m); });
    return () => { alive = false; };
  }, [source.kind, source.id, storeMovie]);
  const movie = storeMovie ?? fetched ?? undefined;
  const video = useSkyVideoStore(s => source.kind === 'video' ? s.feed.find(v => v.id === source.id) : undefined);
  const noteSkyVideoView = useSkyVideoStore(s => s.noteView);
  const loadSkyVideo = useSkyVideoStore(s => s.load);
  const savedPosition = useFilmStore(s => (movie ? s.progress[movie.id] : undefined));
  const saveFilmProgress = useFilmStore(s => s.saveProgress);
  const flushFilmProgress = useFilmStore(s => s.flushProgress);
  const noteFilmView = useFilmStore(s => s.noteView);
  const restored = useRef(false);

  const title = movie?.title ?? video?.title ?? '';
  // Фильм идёт с сервера потоком: телевизор просит куски по мере
  // просмотра, поэтому длинное кино начинается сразу и перематывается.
  const sourceUrl = movie ? videoUrl(movie.id) : (video ? skyVideoUrl(video.id) : undefined);
  const contentId = source.id;
  const [sourceMissingYet, setMissingYet] = useState(true);
  useEffect(() => { const t = window.setTimeout(() => setMissingYet(false), 4000); return () => clearTimeout(t); }, [source.id]);

  const vRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const [failedText, setFailedText] = useState('');
  const ticketTried = useRef(false);
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

  /* Позиция просмотра — раз в пять секунд и при уходе с экрана.
     Для кино она уходит на сервер: только так начатое на телефоне
     продолжается на телевизоре и наоборот. Видеохостинг по-прежнему
     помнит позицию у себя — его записи живут отдельно. */
  useEffect(() => {
    const write = () => {
      const v = vRef.current;
      if (!v || !v.duration) return;
      if (movie) saveFilmProgress(movie.id, v.currentTime, v.duration);
      else recordProgress(contentId, v.currentTime, v.duration);
    };
    saveTimer.current = window.setInterval(write, 5000);
    return () => {
      if (saveTimer.current) window.clearInterval(saveTimer.current);
      const v = vRef.current;
      if (v && v.duration) {
        if (movie) void flushFilmProgress(movie.id, v.currentTime, v.duration);
        else recordProgress(contentId, v.currentTime, v.duration);
      }
    };
  }, [contentId, movie, saveFilmProgress, flushFilmProgress]);

  /* Счётчик просмотров кино ведёт сервер: он общий, а не свой у каждого. */
  useEffect(() => {
    if (movie) void noteFilmView(movie.id);
  }, [movie?.id, noteFilmView]);

  /* Для SkyVideo — реальный счётчик просмотров на сервере. Позиция
     просмотра по-прежнему своя у телевизора (watchProgressStore) —
     у Sky Video нет серверной синхронизации прогресса, как у кино. */
  useEffect(() => {
    if (source.kind !== 'video') return;
    void loadSkyVideo();
    void noteSkyVideoView(source.id);
  }, [source.kind, source.id, loadSkyVideo, noteSkyVideoView]);

  const togglePlay = useCallback(() => {
    const v = vRef.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); }
  }, []);

  const seek = useCallback((delta: number) => {
    const v = vRef.current; if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
  }, []);

  const ex = useEpisodeExtras(movie, vRef, cur);
  const goNext = useCallback(() => { if (ex.nextEp && onPlayEpisode) onPlayEpisode(ex.nextEp.id); }, [ex.nextEp, onPlayEpisode]);
  const primary = useCallback(() => { if (ex.inIntro) ex.skipIntro(); else goNext(); }, [ex, goNext]);

  useTVKeyBindings({
    mode: 'player',
    onPrimaryAction: primary,
    onSubtitles: ex.cycleSubtitles,
    onNext: goNext,
    onBack,
    onPlayPause: togglePlay,
    onSeek: seek,
    onShowControls: showControls,
  });

  if (!movie && !video && source.kind === 'movie' && !fetched && !storeMovie && sourceMissingYet) {
    return <div className="fixed inset-0 z-[200] bg-black" />;
  }
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
      {failedText && (
        <div className="absolute inset-x-0 top-1/3 z-10 mx-auto max-w-[900px] rounded-3xl px-8 py-6 text-center" style={{ background: 'rgba(0,0,0,0.75)' }} role="alert">
          <p className="text-[32px] font-bold text-white">Не удалось воспроизвести</p>
          <p className="mt-2 text-[20px] text-white/70">{failedText}</p>
        </div>
      )}
      {sourceUrl ? (
        <video ref={vRef} src={sourceUrl} autoPlay className="h-full w-full object-contain"
          onTimeUpdate={e => setCur(e.currentTarget.currentTime)}
          onDurationChange={e => setDur(e.currentTarget.duration)}
          onLoadedMetadata={e => {
            // Продолжаем с того места, где остановились, — хоть здесь,
            // хоть на другом устройстве. К самым титрам не возвращаем.
            if (restored.current || !movie) return;
            restored.current = true;
            const from = savedPosition ?? movie.position ?? 0;
            const d = e.currentTarget.duration;
            if (from > 30 && (!d || from < d - 60)) e.currentTarget.currentTime = from;
          }}
          onPlay={() => { setPlaying(true); setFailedText(''); }} onPause={() => setPlaying(false)}
          onError={e => {
            // Протухший пропуск на выдачу — самая частая причина: обновляем один раз и продолжаем с того же места.
            const v = e.currentTarget;
            if (!ticketTried.current) {
              ticketTried.current = true;
              void reloadWithFreshTicket(v, movie ? apiFilmTicket : apiSkyVideoTicket, () => sourceUrl).then(ok => {
                if (ok) void v.play().catch(() => {});
                else void describeMediaFailure(v, sourceUrl).then(setFailedText);
              });
              return;
            }
            void describeMediaFailure(v, sourceUrl).then(setFailedText);
          }}
          onEnded={() => { if (ex.nextEp && onPlayEpisode) goNext(); else onBack(); }}>
          {ex.tracks.map(t => <track key={t.lang} kind="subtitles" srcLang={t.lang} label={t.label} src={t.url} />)}
        </video>
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center gap-3">
          <Play size={64} color="rgba(255,255,255,0.15)"/>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Видеофайл ещё не загружен</p>
        </div>
      )}

      {(ex.inIntro || (ex.nextEp && dur > 0 && cur > dur - 45)) && (
        <div className="absolute bottom-40 right-10 z-10 flex items-center gap-3 rounded-2xl px-6 py-4 text-[22px] font-bold text-white" style={{ background: 'rgba(16,14,34,0.72)', border: '2px solid #b3a7ff', backdropFilter: 'blur(18px)' }} role="status">
          <SkipForward size={26}/>
          <span translate="no">{ex.inIntro ? '↑ Пропустить заставку' : `↑ Следующая серия: ${ex.nextEp?.epNo ?? ''}. ${ex.nextEp?.title ?? ''}`}</span>
        </div>
      )}

      <AnimatePresence>
        {controlsVisible && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {/* верх */}
            <div className="flex items-center gap-4 p-8 pointer-events-auto" style={{ background: 'linear-gradient(rgba(0,0,0,0.7),transparent)' }}>
              <button type="button" onClick={onBack} aria-label="Назад" className="grid h-12 w-12 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(14px)' }}>
                <ChevronLeft size={22} color="#fff"/>
              </button>
              <p translate="no" className="text-[22px] font-bold text-white">{title}</p>
            </div>

            {/* низ */}
            <div className="m-8 rounded-[30px] px-8 pb-5 pt-6 pointer-events-auto" style={{ background: 'rgba(16,14,34,0.62)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(26px)', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
              <div className="mb-3 h-[6px] w-full rounded-full bg-white/20 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#8b7cff,#c084fc)' }}/>
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
                  <Subtitles size={17}/> {ex.tracks.length ? (ex.subLabel ? `Субтитры: ${ex.subLabel}` : 'Субтитры выкл. (↓ — включить)') : 'Субтитров нет'}
                </div>
                {/* Качество: файл отдаётся как загружен, переключаемых вариантов у источника нет — поэтому только сведение, а не выбор. */}
                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  <Settings2 size={17}/> {movie?.height ? `${movie.height}p · оригинал` : 'Оригинал'}
                </div>
                <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  Источник: {movie ? 'Sky TV' : 'SkyVideo'}
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
