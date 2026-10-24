import { SkyLoader } from '@/shared/SkyLoader';
/* ===========================================================
   SKY FILM — Shorts
   Вертикальный полноэкранный режим коротких видео (9:16),
   свайп вверх/вниз, автовоспроизведение, лайк/избранное/поделиться.

   Видео берётся с сервера потоком, как и полные фильмы. Сердечко тоже
   стало настоящим: раньше оно считало отметки в localStorage
   нажавшего — то есть не значило ничего и никому, кроме одной вкладки,
   не было видно. Теперь это та же оценка, что и у полного кино,
   только в виде «нравится»: она лежит на сервере, её видят все и она
   переживает смену устройства.
=========================================================== */
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import {
  X, Heart, Bookmark, BookmarkCheck, Share2, Volume2, VolumeX,
  Play, Pause, User, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useRegisterWatchActivity } from '@/settings/breakReminderStore';
import { useFilmStore } from '@/film/serverStore';
import { videoUrl, posterUrl, apiFilmTicket, type ServerMovie } from '@/film/filmApi';
import { reloadWithFreshTicket } from '@/core/mediaTicketRefresh';

const K = {
  text: '#FFFFFF',
  sub:  'rgba(255,255,255,0.72)',
  dim:  'rgba(255,255,255,0.4)',
  accent: '#FF5500',
};

interface SkyShortsProps {
  startId?: string;
  onClose: () => void;
}

/* -- Одно видео короткого формата ----------------------------------- */
const ShortItem = ({
  movie, active, muted, onToggleMute, saved, onToggleSave, onEnded,
}: {
  movie: ServerMovie; active: boolean; muted: boolean; onToggleMute: () => void;
  saved: boolean; onToggleSave: () => void; onEnded: () => void;
}) => {
  const vRef = useRef<HTMLVideoElement>(null);
  const passTried = useRef(false);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [flash, setFlash] = useState(false);
  const [shared, setShared] = useState(false);
  const [broken, setBroken] = useState(false);
  const rate = useFilmStore(s => s.rate);
  const noteView = useFilmStore(s => s.noteView);
  // «Нравится» — это оценка, выставленная на сервере. Повторное
  // нажатие её снимает, поэтому сердечко нажимается дважды.
  const liked = (movie.myRating ?? 0) > 0;
  const { setPlaying: registerActive, setPauseHandler } = useRegisterWatchActivity();
  const counted = useRef(false);

  /* Играет только активная (текущая) карточка; остальные — на паузе */
  useEffect(() => {
    const v = vRef.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {});
      setPlaying(true);
      if (!counted.current) { counted.current = true; void noteView(movie.id); }
    } else { v.pause(); setPlaying(false); }
  }, [active, movie.id, noteView]);

  useEffect(() => { registerActive(active && playing); return () => registerActive(false); }, [active, playing, registerActive]);
  useEffect(() => {
    if (!active) return;
    setPauseHandler(() => { vRef.current?.pause(); setPlaying(false); });
    return () => setPauseHandler(null);
  }, [active, setPauseHandler]);
  useEffect(() => { if (vRef.current) vRef.current.muted = muted; }, [muted]);

  const toggle = () => {
    const v = vRef.current; if (!v) return;
    if (playing) v.pause(); else v.play().catch(() => {});
    setPlaying(p => !p);
    setFlash(true); setTimeout(() => setFlash(false), 400);
  };

  const like = () => { void rate(movie.id, liked ? 0 : 10); };

  const share = async () => {
    const text = `${movie.title} — смотри в SkyFilm Shorts`;
    try {
      if (navigator.share) await navigator.share({ title: movie.title, text });
      else await navigator.clipboard.writeText(text);
      setShared(true); setTimeout(() => setShared(false), 1600);
    } catch {}
  };

  return (
    <div className="relative h-full w-full bg-black" onClick={toggle}>
      {movie.bytes > 0 && !broken ? (
        <video ref={vRef} src={videoUrl(movie.id)} className="h-full w-full object-cover" playsInline loop={false}
          // Постер показывается, пока не пришли первые куски видео:
          // иначе при пролистывании между роликами моргает чёрное.
          poster={movie.hasPoster ? posterUrl(movie.id) : undefined}
          preload="auto"
          onTimeUpdate={() => { const v = vRef.current; if (v?.duration) setProgress(v.currentTime / v.duration); }}
          onError={() => {
            const v = vRef.current;
            if (v && !passTried.current) {
              passTried.current = true;
              void reloadWithFreshTicket(v, apiFilmTicket, () => videoUrl(movie.id)).then((ok) => { if (!ok) setBroken(true); });
              return;
            }
            setBroken(true);
          }}
          onPlaying={() => { passTried.current = false; setBroken(false); }}
          onEnded={onEnded}/>
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center gap-3"
          style={{ background: `linear-gradient(160deg,#1a1a22,#0a0a0f)` }}>
          <Play size={56} color="rgba(255,255,255,0.15)"/>
          <p className="text-sm px-8 text-center" style={{ color: K.dim }}>
            {broken ? 'Это видео не удалось открыть' : 'Видео ещё не загружено'}
          </p>
          {broken && (
            <p className="text-xs px-10 text-center" style={{ color: K.dim }}>
              Пролистайте дальше — остальная лента работает
            </p>
          )}
        </div>
      )}

      {/* мгновенная вспышка play/pause по тапу */}
      <AnimatePresence>
        {flash && (
          <motion.div initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="grid h-16 w-16 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.4)' }}>
              {playing
                ? <Play size={26} fill="#fff" color="#fff" className="ml-1"/>
                : <Pause size={26} fill="#fff" color="#fff"/>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* верхний градиент + прогресс */}
      <div className="absolute top-0 inset-x-0 pointer-events-none" style={{ background: 'linear-gradient(rgba(0,0,0,0.5),transparent)', height: 90 }}/>
      <div className="absolute top-0 inset-x-0 h-[3px] bg-white/15">
        <div className="h-full" style={{ width: `${progress * 100}%`, background: K.accent, transition: 'width 0.1s linear' }}/>
      </div>

      {/* нижний градиент + инфо */}
      <div className="absolute bottom-0 inset-x-0 pointer-events-none" style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.75))', height: 180 }}/>
      <div className="absolute bottom-5 left-4 right-20 pointer-events-none">
        <p className="text-white text-[15px] font-bold truncate">{movie.title}</p>
        {movie.director && (
          <p className="text-[12px] flex items-center gap-1 mt-1" style={{ color: K.sub }}>
            <User size={11}/> {movie.director}
          </p>
        )}
        {movie.description && <p className="text-[12px] mt-1.5 line-clamp-2" style={{ color: K.sub }}>{movie.description}</p>}
      </div>

      {/* правая колонка действий */}
      {/* Кнопок стало пять — добавился счётчик просмотров, — поэтому
          промежутки поджаты: иначе нижняя упирается в край экрана. */}
      <div data-shorts-actions className="absolute right-3 bottom-6 flex flex-col items-center gap-3.5 pointer-events-auto" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={like} className="flex flex-col items-center gap-1">
          <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.35)' }}>
            <Heart size={22} color={liked ? '#ff3b5c' : '#fff'} fill={liked ? '#ff3b5c' : 'none'}/>
          </div>
          <span className="text-[11px] font-semibold text-white">{movie.ratingCount ?? 0}</span>
        </button>
        <button type="button" onClick={onToggleSave} className="flex flex-col items-center gap-1">
          <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.35)' }}>
            {saved ? <BookmarkCheck size={20} color={K.accent}/> : <Bookmark size={20} color="#fff"/>}
          </div>
          <span className="text-[10px] font-semibold text-white">{saved ? 'В закладках' : 'Сохранить'}</span>
        </button>
        <div className="flex flex-col items-center gap-1">
          <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.35)' }}>
            <Play size={18} color="#fff" fill="#fff"/>
          </div>
          <span className="text-[11px] font-semibold text-white">{movie.views ?? 0}</span>
        </div>
        <button type="button" onClick={share} className="flex flex-col items-center gap-1">
          <div className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.35)' }}>
            <Share2 size={19} color="#fff"/>
          </div>
          <span className="text-[10px] font-semibold text-white">{shared ? 'Готово' : 'Поделиться'}</span>
        </button>
        <button type="button" onClick={onToggleMute} className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.35)' }}>
          {muted ? <VolumeX size={19} color="#fff"/> : <Volume2 size={19} color="#fff"/>}
        </button>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
export const SkyShorts = ({ startId, onClose }: SkyShortsProps) => {
  /* Лента приходит с сервера порциями. Держать её здесь, а не получать
     готовым списком снаружи, важно по существу: листают её бесконечно,
     и следующая порция должна подъезжать по мере пролистывания, а не
     кончаться на той сотне, что успел отдать каталог. */
  const movies = useFilmStore(s => s.shorts);
  const shortsDone = useFilmStore(s => s.shortsDone);
  const shortsLoading = useFilmStore(s => s.shortsLoading);
  const loadShorts = useFilmStore(s => s.loadShorts);
  const loadMoreShorts = useFilmStore(s => s.loadMoreShorts);
  const savedList = useFilmStore(s => s.saved);
  const toggleSaved = useFilmStore(s => s.toggleSaved);

  const [index, setIndex]   = useState(0);
  const [muted, setMuted]   = useState(false);
  const [dir,   setDir]     = useState(1);
  const jumped = useRef(false);

  useEffect(() => { void loadShorts(); }, [loadShorts]);

  /* Открыли с конкретного видео — встаём на него, но только один раз:
     дальше человек листает сам, и перескакивать обратно нельзя. */
  useEffect(() => {
    if (jumped.current || !startId || movies.length === 0) return;
    const at = movies.findIndex(m => m.id === startId);
    if (at >= 0) { jumped.current = true; setIndex(at); }
  }, [startId, movies]);

  const go = useCallback((delta: number) => {
    setDir(delta);
    setIndex(i => Math.max(0, Math.min(movies.length - 1, i + delta)));
  }, [movies.length]);

  /* Следующая порция — заранее, за три видео до конца: иначе человек
     упирается в край ленты и ждёт, пока она догрузится. */
  useEffect(() => {
    if (movies.length && index >= movies.length - 3) void loadMoreShorts();
  }, [index, movies.length, loadMoreShorts]);

  const onDragEnd = (_: any, info: PanInfo) => {
    if (info.offset.y < -70 || info.velocity.y < -500) go(1);
    else if (info.offset.y > 70 || info.velocity.y > 500) go(-1);
  };

  /* стрелки клавиатуры — доступность на ПК */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp')   go(-1);
      if (e.key === 'ArrowDown') go(1);
      if (e.key === 'Escape')    onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  /* колесо мыши — свайп-эквивалент на ПК */
  const wheelLock = useRef(false);
  const onWheel = (e: React.WheelEvent) => {
    if (wheelLock.current) return;
    if (Math.abs(e.deltaY) < 24) return;
    wheelLock.current = true;
    go(e.deltaY > 0 ? 1 : -1);
    setTimeout(() => { wheelLock.current = false; }, 450);
  };

  const movie = movies[index];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: '#000' }}
      onWheel={onWheel}>

      {!movie ? (
        <div className="flex flex-col items-center gap-3 px-10 text-center">
          {shortsLoading
            ? <SkyLoader label="Загружаем ленту…"/>
            : <p className="text-sm" style={{ color: K.dim }}>Короткого кино пока нет</p>}
          {!shortsLoading && (
            <p className="text-xs" style={{ color: K.dim }}>
              Снимите вертикальное видео до пяти минут, загрузите его в «Коллекцию»
              и отправьте на проверку — оно появится здесь.
            </p>
          )}
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-xs font-bold text-white" style={{ background: K.accent }}>Закрыть</button>
        </div>
      ) : (
      <div className="relative h-full w-full sm:h-[92vh] sm:w-[420px] sm:rounded-[28px] overflow-hidden sm:shadow-2xl">
        <AnimatePresence initial={false}>
          <motion.div key={movie.id}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.5} onDragEnd={onDragEnd}
            initial={{ y: dir > 0 ? '100%' : '-100%' }} animate={{ y: 0 }} exit={{ y: dir > 0 ? '-100%' : '100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: 'easeOut' }}
            className="absolute inset-0">
            <ShortItem movie={movie} active muted={muted} onToggleMute={() => setMuted(m => !m)}
              saved={savedList.some(x => x.id === movie.id)}
              onToggleSave={() => void toggleSaved(movie.id)}
              onEnded={() => go(1)}/>
          </motion.div>
        </AnimatePresence>

        {/* верхняя панель */}
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between px-4 pt-4 pointer-events-none">
          <button type="button" onClick={onClose} className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.4)' }}>
            <X size={18} color="#fff"/>
          </button>
          <p className="text-white text-sm font-bold pointer-events-none">
            Shorts · {index + 1}{shortsDone ? ` из ${movies.length}` : ''}
          </p>
          <div className="w-9"/>
        </div>

        {/* подсказки свайпа на ПК (не мешают жестам на мобильном) */}
        <div className="hidden sm:flex absolute right-[-52px] top-1/2 -translate-y-1/2 flex-col gap-3">
          <button type="button" onClick={() => go(-1)} disabled={index === 0}
            className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <ChevronUp size={18} color="#fff"/>
          </button>
          <button type="button" onClick={() => go(1)} disabled={index >= movies.length - 1 && shortsDone}
            className="grid h-9 w-9 place-items-center rounded-full disabled:opacity-30" style={{ background: 'rgba(255,255,255,0.1)' }}>
            <ChevronDown size={18} color="#fff"/>
          </button>
        </div>
      </div>
      )}
    </motion.div>
  );
};
