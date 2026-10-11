/* ===========================================================
   SKY FILM

   Экран тот же, что и был. Изменилось то, откуда берутся данные:
   раньше список фильмов лежал в localStorage браузера, а сам файл —
   во временной ссылке blob:, которая пропадает при перезагрузке
   страницы. Теперь и список, и файлы живут на сервере, и он же решает,
   что этому человеку показывать.

   Два множества держатся порознь и никогда не смешиваются:

     • каталог — только опубликованное, его видят все;
     • «Моя коллекция» — то, что человек загрузил сам. Она закрыта:
       в каталог, поиск, популярное и подборки эти фильмы не попадают,
       и другому человеку — включая администратора — не отдаются вовсе.

   Закрытость обеспечивается не здесь. Здесь мы просто не получаем
   чужого: проверка стоит в базе и в запросах сервера, а этот файл
   можно переписать в браузере сколько угодно.
=========================================================== */
import { RetentionNote } from '@/shared/RetentionNote';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  X, Star, Clock, Film, Search, ChevronLeft, RotateCcw,
  SkipForward, Bookmark, BookmarkCheck, Info,
  Tv, TrendingUp, Award, Layers, Download, CheckCircle, Upload, Image as ImageIcon,
  Plus, Crown, ShieldAlert, ShieldCheck, Cloud, Zap, AlertTriangle, Lock, History, Music2, Users,
  Share2,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { saveDownload, isDownloaded } from '@/offline/offlineDB';
import { useModerationStore } from '@/shared/moderationStore';
import { ContentWarningGate, BlockedChannelBadge } from '@/shared/ContentWarningGate';
import { useRegisterWatchActivity } from '@/settings/breakReminderStore';
import { useRegisterMedia } from '@/island/mediaRegistry';
import type { IconComponent } from '@/shared/icon';
import { useMediaPresence } from '@/profile/viewer/mediaPresence';
import { useFilmStore } from '@/film/serverStore';
import { ShareDialog } from '@/storage/ShareDialog';
import { StorageQuotaBar } from '@/storage/StorageQuotaBar';
import { sendTogether, type PlayerHandle } from '@/together/togetherState';
import { useTogetherSync } from '@/together/useTogetherSync';
import {
  videoUrl, posterUrl, fmtDuration, readVideoMeta, looksLikeShort,
  MAX_SHORT_DURATION, apiFilmModerationQueue, apiModerateMovie, apiMovie,
  apiFilmTicket, type ServerMovie, type VideoMeta,
} from '@/film/filmApi';
import { reloadWithFreshTicket, describeMediaFailure } from '@/core/mediaTicketRefresh';
import { useModuleStore } from '@/data/state/modules';
import { SkyShorts } from './SkyShorts';
import { ACCEPT_VIDEO, ACCEPT_IMAGE } from '@/shared/fileAccept';

/* -- токены ----------------------------------------------- */
const K = {
  bg:     'var(--bg)',
  card:   'var(--bg-l1)',
  card2:  'var(--bg-l2)',
  orange: '#FF5500',
  orange2:'#FF8C42',
  text:   'var(--t1)',
  sub:    'var(--t2)',
  dim:    'var(--t3)',
  gold:   '#F5C518',
  border: 'var(--border)',
};

const fmtT = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`;
};

const fmtSize = (bytes: number) => {
  if (!bytes) return '';
  const gb = bytes / (1024 ** 3);
  return gb >= 1 ? `${gb.toFixed(1)} ГБ` : `${Math.round(bytes / (1024 ** 2))} МБ`;
};

/* -- градиенты для постера по умолчанию --------------------
   Раньше их раздавали по жёстко записанным «mov-1»…«mov-8» — вместе с
   образцом данных, которого больше нет. Теперь цвет считается из самого
   идентификатора: у одного фильма он всегда один и тот же, а палитра
   осталась прежней.
---------------------------------------------------------- */
const PALETTE: [string,string][] = [
  ['#0b1a45','#162f6a'], ['#2a0808','#581212'],
  ['#061828','#0d2d45'], ['#06180f','#0e3020'],
  ['#1a0a00','#3c1900'], ['#100016','#1e002e'],
  ['#180c22','#35183e'], ['#001a1a','#003333'],
];
const grad = (id: string): [string,string] => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
};

/* -- Постер ----------------------------------------------- */
const Poster = ({ movie, w = 110, h }: { movie: ServerMovie; w?: number; h?: number }) => {
  const [c1, c2] = grad(movie.id);
  const ph = h ?? Math.round(w * 1.48);
  return (
    <div className="relative overflow-hidden rounded-xl shrink-0" style={{ width: w, height: ph }}>
      {movie.hasPoster
        ? <img src={posterUrl(movie.id)} alt={movie.title} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(160deg,${c1},${c2})` }}>
            <Film size={w * 0.28} color="rgba(255,255,255,0.18)" />
          </div>}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(transparent 55%, rgba(0,0,0,0.75))' }} />
      {movie.rating != null && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md px-1.5 py-0.5"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
          <Star size={9} fill={K.gold} style={{ color: K.gold }} />
          <span className="text-[10px] font-bold tabular-nums" style={{ color: K.gold }}>
            {movie.rating.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );
};

/* -- Постер во всю ширину (для сетки) --------------------- */
const PosterFill = ({ movie }: { movie: ServerMovie }) => {
  const [c1, c2] = grad(movie.id);
  return (
    <div className="relative overflow-hidden rounded-xl w-full" style={{ aspectRatio: '2/3' }}>
      {movie.hasPoster
        ? <img src={posterUrl(movie.id)} alt={movie.title} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(160deg,${c1},${c2})` }}>
            <Film size={32} color="rgba(255,255,255,0.18)" />
          </div>}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(transparent 55%, rgba(0,0,0,0.75))' }} />
      {/* Замок вместо значка SKY+: он говорит то, что человеку важно
          знать про свой фильм, — что этот фильм не видит никто. */}
      {movie.private && (
        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-black text-white"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <Lock size={8} /> ТОЛЬКО Я
        </div>
      )}
      {movie.rating != null && (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md px-1.5 py-0.5"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
          <Star size={9} fill={K.gold} style={{ color: K.gold }} />
          <span className="text-[10px] font-bold tabular-nums" style={{ color: K.gold }}>{movie.rating.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
};

/* -- Оценка ------------------------------------------------ */
const Stars = ({ r }: { r?: number }) => {
  if (r == null) return null;
  const col = r >= 8 ? '#4CAF50' : r >= 7 ? K.gold : K.sub;
  return (
    <span className="flex items-center gap-1">
      <Star size={11} fill={col} style={{ color: col }} />
      <span className="text-sm font-bold tabular-nums" style={{ color: col }}>{r.toFixed(1)}</span>
    </span>
  );
};

/* -- Проигрыватель ----------------------------------------
   Видео приходит с сервера потоком: браузер сам просит куски по мере
   просмотра и при перемотке, поэтому фильм начинается сразу, а не
   после того, как скачается целиком.
---------------------------------------------------------- */
/**
 * Поводок совместного просмотра.
 *
 * Не второй плеер и не отдельный режим: те же элементы управления, тот
 * же <video>, та же перемотка. Меняется одно — куда уходит нажатие.
 * Без сессии оно двигает своё видео; в сессии уходит на сервер и
 * возвращается оттуда общим состоянием, которое двигает видео у всех
 * сразу. Тот, кому управлять не положено, кнопок не получает вовсе.
 */
export interface WatchTogether {
  sessionId: string;
  canControl: boolean;
  /** Сколько человек сейчас смотрит. Показывается в шапке плеера. */
  watchers?: number;
  /**
   * Выйти из сессии и завершить её.
   *
   * Обе кнопки живут в шапке плеера, а не только на экране сессии, и
   * это не украшение. Плеер занимает весь экран и накрывает собой всё
   * остальное: без них владелец, начав смотреть, уже не мог завершить
   * сеанс, а участник — выйти из него. Стрелка «назад» лишь сворачивает
   * просмотр, из сессии она не выводит.
   */
  onLeave?: () => void;
  onEnd?: () => void;
}

const openFilmPlayer = () => {
  useModuleStore.getState().setActiveModule('extras');
  useModuleStore.getState().setPendingExtrasTab('movies');
};

export const Player = ({ movie, onClose, together = null }: {
  movie: ServerMovie;
  onClose: () => void;
  together?: WatchTogether | null;
}) => {
  const vRef  = useRef<HTMLVideoElement>(null);
  const passTried = useRef(false);
  const cRef  = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [pl,  setPl]  = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(movie.duration || 0);
  const [vol, setVol] = useState(0.85);
  const [mut, setMut] = useState(false);
  const [fs,  setFs]  = useState(false);
  const [ui,  setUi]  = useState(true);
  const [failed, setFailed] = useState(false);
  const [failInfo, setFailInfo] = useState('');
  const [c1, c2] = grad(movie.id);
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const { setPlaying, setPauseHandler } = useRegisterWatchActivity();
  useRegisterMedia(vRef, { id: movie.id, kind: 'film', title: movie.title, subtitle: [movie.genre, movie.year].filter(Boolean).join(' · '), cover: movie.hasPoster ? posterUrl(movie.id) : undefined, canSeek: true, open: openFilmPlayer });
  const savedPos = useFilmStore(s => s.progress[movie.id]);
  const saveProgress = useFilmStore(s => s.saveProgress);
  const flushProgress = useFilmStore(s => s.flushProgress);
  const noteView = useFilmStore(s => s.noteView);
  /** Позицию надо отдать серверу при уходе, а к тому моменту видео уже снято. */
  const last = useRef({ pos: 0, dur: 0 });
  const counted = useRef(false);
  const restored = useRef(false);

  /* Продолжаем с того места, где остановились в прошлый раз — хоть на
     этом устройстве, хоть на другом: позицию помнит сервер. */
  const onMeta = () => {
    const v = vRef.current; if (!v) return;
    setDur(v.duration || movie.duration || 0);
    if (restored.current) return;
    restored.current = true;
    /* В совместном просмотре своё «остановился здесь» не применяется:
       место в фильме общее, и его задаёт сессия. Иначе вошедший
       перематывал бы всех к тому, где был сам в прошлый раз. */
    if (together) return;
    const from = savedPos ?? movie.position ?? 0;
    // К самому концу не возвращаем: человек его уже видел.
    if (from > 30 && (!v.duration || from < v.duration - 60)) { v.currentTime = from; setCur(from); }
  };

  useEffect(() => { if (vRef.current) vRef.current.volume = mut ? 0 : vol; }, [vol, mut]);

  /* Ручка для совместного просмотра: то немногое, что сессии позволено
     делать с этим проигрывателем. Громкость, полный экран и всё
     остальное остаются личным делом каждого — общее только место в
     фильме и то, идёт он или стоит. */
  const handle: PlayerHandle = useMemo(() => ({
    position: () => (vRef.current?.currentTime ?? 0) * 1000,
    playing:  () => Boolean(vRef.current && !vRef.current.paused && !vRef.current.ended),
    seek: (ms) => { const v = vRef.current; if (v) { v.currentTime = ms / 1000; setCur(ms / 1000); } },
    play:  () => { vRef.current?.play().then(() => setPl(true)).catch(() => setPl(false)); },
    pause: () => { vRef.current?.pause(); setPl(false); },
    setRate: (r) => { if (vRef.current) vRef.current.playbackRate = r; },
    currentId: () => movie.id,
  }), [movie.id]);

  useTogetherSync(together?.sessionId ?? null, handle, Boolean(together));

  /* Смотрит, но не управляет. Кнопки в этом случае не просто не
     работают — их не видно: неработающая кнопка раздражает сильнее
     отсутствующей, а человек и так знает, что фильм общий. */
  const watching = Boolean(together) && !together?.canControl;

  /* При уходе — последняя позиция на сервер. Без этого последние
     секунды просмотра терялись бы, и на другом устройстве фильм
     продолжался бы чуть раньше, чем человек ушёл. */
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    vRef.current?.pause();
    const { pos, dur: d } = last.current;
    if (pos > 5) void flushProgress(movie.id, pos, d);
  }, [movie.id, flushProgress]);

  /* Сообщаем движку «Перерыва от просмотра» о фактическом
     воспроизведении и отдаём ему функцию паузы. */
  useEffect(() => { setPlaying(pl); return () => setPlaying(false); }, [pl, setPlaying]);
  useEffect(() => {
    setPauseHandler(() => { vRef.current?.pause(); setPl(false); });
    return () => setPauseHandler(null);
  }, [setPauseHandler]);

  /* «Сейчас смотрит фильм» — живая отметка в профиле. */
  const { currentUserId, accounts } = useAuthStore();
  const setWatchPresence = useMediaPresence(s => s.setWatchPresence);
  useEffect(() => {
    if (!currentUserId) return;
    const me = accounts.find(a => a.id === currentUserId);
    const allowed = me?.privacy?.showMovies ?? true;
    // Закрытый фильм в чужом профиле не показываем даже названием:
    // это ровно то, что человек держит только у себя.
    if (pl && allowed && !movie.private) {
      setWatchPresence({ userId: currentUserId, title: movie.title, kind: 'movie',
        coverUrl: movie.hasPoster ? posterUrl(movie.id) : undefined }, currentUserId);
    } else setWatchPresence(null, currentUserId);
    return () => setWatchPresence(null, currentUserId);
  }, [pl, movie.id, currentUserId]);

  const bump = useCallback(() => {
    setUi(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUi(false), 3000);
  }, []);

  const toggle = () => {
    /* В сессии нажатие не двигает своё видео: оно уходит на сервер, а
       видео двигает пришедшее оттуда состояние — у всех разом. Так у
       нажавшего и у остальных не бывает разной картины даже на
       полсекунды. */
    if (together) {
      if (!together.canControl) return;
      sendTogether(together.sessionId, pl ? 'pause' : 'play');
      if (!counted.current) { counted.current = true; void noteView(movie.id); }
      return;
    }
    const v = vRef.current; if (!v) return;
    if (pl) { v.pause(); setPl(false); return; }
    v.play().then(() => {
      setPl(true);
      if (!counted.current) { counted.current = true; void noteView(movie.id); }
    }).catch(() => setPl(false));
  };
  const seek = (t: number) => {
    if (together) {
      if (!together.canControl) return;
      sendTogether(together.sessionId, 'seek', { positionMs: Math.round(Math.max(0, t) * 1000) });
      return;
    }
    if (vRef.current) { vRef.current.currentTime = t; setCur(t); }
  };
  const skip = (n: number) => seek(Math.max(0, Math.min(dur, cur + n)));
  const toggleFs = async () => {
    if (!document.fullscreenElement) { await cRef.current?.requestFullscreen?.().catch(() => {}); setFs(true); }
    else { await document.exitFullscreen?.().catch(() => {}); setFs(false); }
  };

  /** Связь оборвалась — предлагаем продолжить с того же места, а не начать заново. */
  const retry = () => {
    setFailInfo('');
    const v = vRef.current; if (!v) return;
    const from = last.current.pos;
    setFailed(false);
    v.load();
    v.currentTime = from;
    v.play().then(() => setPl(true)).catch(() => setPl(false));
  };

  return (
    <motion.div ref={cRef} data-keep-dark="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      onMouseMove={bump} style={{ cursor: ui ? 'default' : 'none' }}>

      {movie.bytes > 0 ? (
        <video ref={vRef} src={videoUrl(movie.id)} className="h-full w-full object-contain"
          preload="metadata" playsInline
          onTimeUpdate={() => {
            const v = vRef.current; if (!v) return;
            setCur(v.currentTime);
            last.current = { pos: v.currentTime, dur: v.duration || movie.duration || 0 };
            saveProgress(movie.id, v.currentTime, v.duration || movie.duration || 0);
          }}
          onLoadedMetadata={onMeta}
          onPlaying={() => { passTried.current = false; setFailed(false); setPl(true); }}
          onPause={() => setPl(false)}
          onError={() => {
            // Чаще всего файл не открылся из-за протухшего пропуска, а не
            // связи: один раз обновляем его и продолжаем с того же места.
            const v = vRef.current;
            if (v && !passTried.current) {
              passTried.current = true;
              void reloadWithFreshTicket(v, apiFilmTicket, () => videoUrl(movie.id)).then((ok) => {
                if (!ok) { setFailed(true); setPl(false); void describeMediaFailure(v, videoUrl(movie.id)).then(setFailInfo); }
              });
              return;
            }
            setFailed(true); setPl(false);
            void describeMediaFailure(v, videoUrl(movie.id)).then(setFailInfo);
          }}
          onStalled={() => setFailed(false)}
          onEnded={() => {
            setPl(false);
            void flushProgress(movie.id, dur, dur);
            /* В сессии о конце сообщает только тот, кто управляет:
               иначе десять человек прислали бы десять одинаковых
               сообщений об одном и том же конце. */
            if (together?.canControl) sendTogether(together.sessionId, 'ended');
          }}
          onClick={() => { if (!watching) toggle(); }} />
      ) : (
        <div className="h-full w-full flex flex-col items-center justify-center gap-4"
          style={{ background: `linear-gradient(160deg,${c1},${c2})` }}>
          <Film size={72} color="rgba(255,255,255,0.1)" />
          <p className="text-xl font-bold text-white">{movie.title}</p>
          <p className="text-sm" style={{ color: K.sub }}>Видеофайл не загружен</p>
        </div>
      )}

      {/* Обрыв связи. Показываем причину и предлагаем продолжить с того
          же места — заново длинный фильм никто смотреть не станет.

          Своя кнопка выхода здесь обязательна, и лежит это окно ниже
          управления: иначе оно перекрывает кнопку «назад» в верхней
          строке, и человек, у которого фильм не пошёл, остаётся запертым
          в чёрном экране без единого способа из него выйти. */}
      {failed && (
        <div className="absolute inset-0 z-0 flex flex-col items-center justify-center gap-3 px-8 text-center"
          style={{ background: 'rgba(0,0,0,0.82)' }}>
          <AlertTriangle size={40} style={{ color: K.orange }} />
          <p className="text-[15px] font-bold text-white">Воспроизведение прервалось</p>
          <p className="text-[12.5px]" style={{ color: K.sub, maxWidth: 300 }}>
            Похоже, пропала связь. Можно продолжить с того места, где остановились — {fmtT(last.current.pos)}.
          </p>
          {failInfo && <p className="text-[11px]" style={{ color: K.sub, maxWidth: 300, opacity: 0.8 }}>{failInfo}</p>}
          <div className="mt-1 flex gap-2">
            <button type="button" onClick={retry}
              className="rounded-full px-6 py-2.5 text-[13px] font-bold text-white" style={{ background: K.orange }}>
              Продолжить
            </button>
            <button type="button" onClick={onClose}
              className="rounded-full px-6 py-2.5 text-[13px] font-semibold"
              style={{ background: 'rgba(255,255,255,0.12)', color: K.text }}>
              Выйти
            </button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {ui && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col justify-between pointer-events-none">
            {/* верх */}
            <div className="flex items-center gap-3 px-5 pb-4 pointer-events-auto"
              style={{ background: 'linear-gradient(rgba(0,0,0,0.78),transparent)', paddingTop: 'calc(var(--safe-top) + 12px)' }}>
              <button type="button" onClick={onClose}
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15"
                style={{ background: 'rgba(0,0,0,0.5)' }}>
                <ChevronLeft size={20} className="text-white" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{movie.title}</p>
                {movie.year && <p className="text-xs" style={{ color: K.sub }}>{movie.year} · {movie.genre}</p>}
              </div>
              {/* «Только я» — про личную полку, поэтому подпись видит
                  её владелец. Тому, кому эту запись показывают в
                  сеансе, она сообщала бы неправду: для него фильм не
                  «только я», а «мне показывают». */}
              {movie.private && movie.own && (
                <span className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.5)', color: K.sub }}>
                  <Lock size={10} /> Только я
                </span>
              )}
              {movie.private && !movie.own && together && (
                <span className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold"
                  style={{ background: 'rgba(0,0,0,0.5)', color: K.sub }}>
                  <Lock size={10} /> Личная запись владельца
                </span>
              )}
              {/* Плеер занимает весь экран, и список участников за ним
                  не виден. Сколько человек смотрит — видно всегда: без
                  этого непонятно, один ты уже остался или нет. */}
              {together && (
                <span className="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold"
                  style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }} data-tg-watchers>
                  <Users size={10} /> {together.watchers ?? 1}
                </span>
              )}
              {together?.onEnd && (
                <button type="button" onClick={together.onEnd} data-tg-end-player
                  className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                  style={{ background: 'rgba(239,68,68,0.18)', color: '#f87171' }}>
                  Завершить
                </button>
              )}
              {together?.onLeave && (
                <button type="button" onClick={together.onLeave} data-tg-leave-player
                  className="rounded-full px-3 py-1.5 text-[11px] font-semibold"
                  style={{ background: 'rgba(255,255,255,0.12)', color: K.text }}>
                  Выйти
                </button>
              )}
              <button type="button" onClick={toggleFs}
                className="grid h-10 w-10 place-items-center rounded-full pointer-events-auto"
                style={{ background: 'rgba(0,0,0,0.5)' }}>
                {fs ? <Minimize2 size={16} className="text-white" /> : <Maximize2 size={16} className="text-white" />}
              </button>
            </div>
            {/* середина */}
            {watching ? (
              <div className="flex items-center justify-center pointer-events-none">
                <span className="rounded-full px-4 py-2 text-[12px] font-semibold"
                  style={{ background: 'rgba(0,0,0,0.55)', color: K.sub, backdropFilter: 'blur(6px)' }}>
                  Смотрим вместе · воспроизведением управляет владелец
                </span>
              </div>
            ) : (
            <div className="flex items-center justify-center gap-8 pointer-events-auto">
              <motion.button whileTap={{ scale: 0.88 }} type="button" onClick={() => skip(-10)}
                className="grid h-12 w-12 place-items-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
                <RotateCcw size={20} className="text-white" />
              </motion.button>
              <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={toggle} data-film-play
                className="grid place-items-center rounded-full"
                style={{ width: 68, height: 68, background: K.orange, boxShadow: `0 0 36px ${K.orange}60` }}>
                {pl ? <Pause size={28} fill="white" className="text-white" />
                    : <Play  size={28} fill="white" className="text-white ml-1" />}
              </motion.button>
              <motion.button whileTap={{ scale: 0.88 }} type="button" onClick={() => skip(10)}
                className="grid h-12 w-12 place-items-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
                <SkipForward size={20} className="text-white" />
              </motion.button>
            </div>
            )}
            {/* низ */}
            <div className="px-5 pb-5 space-y-3 pointer-events-auto"
              style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.88))' }}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono w-10 text-right" style={{ color: K.sub }}>{fmtT(cur)}</span>
                <div data-film-bar
                  className={`group relative flex-1 h-[3px] rounded-full transition-all ${watching ? '' : 'cursor-pointer hover:h-1.5'}`}
                  style={{ background: 'rgba(255,255,255,0.18)' }}
                  onClick={e => {
                    if (watching) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    seek(((e.clientX-r.left)/r.width)*dur);
                  }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg,${K.orange},${K.orange2})` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    style={{ left: `calc(${pct}% - 7px)`, boxShadow: `0 0 8px ${K.orange}` }} />
                </div>
                <span className="text-xs font-mono w-10" style={{ color: K.sub }}>{fmtT(dur)}</span>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button type="button" onClick={() => setMut(m => !m)} style={{ color: K.sub }}>
                  {mut ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <div className="relative h-[3px] w-24 cursor-pointer rounded-full hover:h-1.5 transition-all"
                  style={{ background: 'rgba(255,255,255,0.18)' }}
                  onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setVol((e.clientX-r.left)/r.width); setMut(false); }}>
                  <div className="h-full rounded-full" style={{ width: `${mut ? 0 : vol*100}%`, background: 'rgba(255,255,255,0.75)' }} />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/* -- Карточка фильма --------------------------------------- */
/**
 * Сколько фильм может весить, чтобы его имело смысл класть в память
 * устройства. Прежняя кнопка «скачать» переводила файл в строку base64
 * и держала его в памяти вкладки целиком — на настоящем фильме это
 * кончалось не скачиванием, а падением вкладки.
 */
const OFFLINE_LIMIT = 600 * 1024 * 1024;

const Detail = ({ movie, onPlay, onClose, saved, onSave }: {
  movie: ServerMovie; onPlay: () => void; onClose: () => void; saved: boolean; onSave: () => void;
}) => {
  const [c1, c2] = grad(movie.id);
  const [dlState, setDlState] = useState<'idle'|'loading'|'done'>('idle');
  const [dlError, setDlError] = useState('');
  const { isBlocked, blockReason, warningFor, isAcknowledged } = useModerationStore();
  const rate = useFilmStore(s => s.rate);
  const modBlocked = isBlocked('movie', movie.id);
  const modWarning = warningFor('movie', movie.id);
  const modAcked   = isAcknowledged('movie', movie.id);

  useEffect(() => {
    isDownloaded(movie.id).then(d => d && setDlState('done')).catch(() => {});
  }, [movie.id]);

  if (modBlocked) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 p-6" style={{ background: K.bg }}>
        <button type="button" onClick={onClose} className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <ChevronLeft size={18} style={{ color: K.text }}/>
        </button>
        <BlockedChannelBadge reason={blockReason('movie', movie.id)}/>
      </div>
    );
  }
  if (modWarning && !modAcked) {
    return (
      <div className="fixed inset-0 z-50" style={{ background: K.bg }}>
        <ContentWarningGate domain="movie" targetId={movie.id}><></></ContentWarningGate>
      </div>
    );
  }

  /**
   * Сохранить для просмотра без связи. Файл забирается потоком и
   * кладётся в хранилище устройства как есть — без перевода в строку,
   * который раньше поднимал весь фильм в память вкладки.
   */
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dlState !== 'idle' || !movie.bytes) return;
    if (movie.bytes > OFFLINE_LIMIT) {
      setDlError(`Фильм слишком большой для памяти устройства (${fmtSize(movie.bytes)})`);
      return;
    }
    setDlState('loading'); setDlError('');
    try {
      const resp = await fetch(videoUrl(movie.id), { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('отказ сервера');
      const blob = await resp.blob();
      await saveDownload({
        id: movie.id, kind: 'movie',
        title: movie.title, duration: fmtDuration(movie.duration),
        mimeType: blob.type || 'video/mp4',
        bytes: blob.size,
        addedAt: new Date().toISOString(),
      }, blob);
      setDlState('done');
    } catch {
      setDlState('idle');
      setDlError('Не получилось сохранить — попробуйте ещё раз');
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <motion.div initial={{ y: 70, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        exit={{ y: 70, opacity: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className="w-full sm:max-w-md overflow-hidden rounded-t-3xl sm:rounded-3xl flex flex-col"
        style={{ background: K.card, maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}>

        {/* шапка */}
        <div className="relative h-52 shrink-0 overflow-hidden">
          {movie.hasPoster
            ? <img src={posterUrl(movie.id)} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full" style={{ background: `linear-gradient(160deg,${c1},${c2})` }} />}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(transparent 30%,rgba(6,6,9,0.96))' }} />
          <button type="button" onClick={onClose}
            className="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full"
            style={{ background: 'rgba(0,0,0,0.6)' }}>
            <X size={16} className="text-white" />
          </button>
          <div className="absolute bottom-4 left-4 right-12">
            <h2 className="text-xl font-black text-white leading-snug">{movie.title}</h2>
            <div className="flex items-center flex-wrap gap-2 mt-1">
              {movie.year && <span className="text-sm" style={{ color: K.sub }}>{movie.year}</span>}
              {movie.genre && <span className="text-sm" style={{ color: K.sub }}>· {movie.genre}</span>}
              {movie.ageRating && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold border"
                  style={{ color: K.sub, borderColor: K.dim }}>{movie.ageRating}</span>
              )}
              {movie.ageRestricted18 && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-black text-white" style={{ background:'rgba(239,68,68,0.85)' }}>18+</span>
              )}
              {movie.explicit && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-black text-white" style={{ background:'rgba(0,0,0,0.6)' }}>E</span>
              )}
            </div>
          </div>
        </div>

        {/* тело */}
        <div className="overflow-y-auto flex-1 px-5 pt-4 pb-8" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-4 mb-4">
            <Stars r={movie.rating} />
            {movie.ratingCount ? (
              <span className="text-[11px]" style={{ color: K.dim }}>{movie.ratingCount} оценок</span>
            ) : null}
            {movie.duration > 0 && (
              <span className="flex items-center gap-1 text-sm" style={{ color: K.sub }}>
                <Clock size={13} /> {fmtDuration(movie.duration)}
              </span>
            )}
            {movie.country && <span className="text-sm" style={{ color: K.sub }}>{movie.country}</span>}
          </div>

          {/* Личный фильм: прямо сказано, что его не видит никто. */}
          {movie.private && (
            <div className="flex items-start gap-1.5 rounded-xl px-3 py-2 mb-4 text-[11px]"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: K.sub }}>
              <Lock size={13} className="mt-0.5 shrink-0" style={{ color: K.sub }} />
              <span>
                Этот фильм — в вашей личной коллекции. Его не видит никто, кроме вас: ни в каталоге,
                ни в поиске, ни у других людей. Он доступен на всех ваших устройствах.
              </span>
            </div>
          )}
          {movie.private && (
            <RetentionNote expiresAt={movie.expiresAt} keep={movie.retentionKeep}
              onKeep={(keep) => useFilmStore.getState().setKeep(movie.id, keep)} />
          )}

          {movie.license && !movie.private && (
            <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 mb-4 text-[11px]"
              style={{ background: movie.license==='open' ? 'rgba(255,85,0,0.08)' : 'rgba(34,197,94,0.08)',
                border: `1px solid ${movie.license==='open' ? 'rgba(255,85,0,0.2)' : 'rgba(34,197,94,0.2)'}`,
                color: K.sub }}>
              {movie.license === 'open'
                ? <><ShieldAlert size={13} style={{ color: K.orange }}/><span>Открытая лицензия — взято из открытых источников. Экосистема не несёт ответственности за использование лицензий. Загрузил: {movie.uploaderName ?? 'пользователь'}</span></>
                : <><ShieldCheck size={13} style={{ color:'#22c55e' }}/><span>Авторское право на личную лицензию подтверждено. Загрузил: {movie.uploaderName ?? 'пользователь'}</span></>}
            </div>
          )}

          {/* кнопки */}
          <div className="flex gap-3 mb-5">
            <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={onPlay}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-base font-bold text-white"
              style={{ background: K.orange }}>
              <Play size={18} fill="white" /> {movie.position && movie.position > 30 ? 'Продолжить' : 'Смотреть'}
            </motion.button>
            <button type="button" onClick={onSave}
              className="grid h-12 w-12 place-items-center rounded-2xl transition-all"
              style={{ background: saved ? `${K.orange}20` : 'var(--border)', border: `1px solid ${saved ? K.orange+'55' : 'transparent'}` }}>
              {saved
                ? <BookmarkCheck size={18} style={{ color: K.orange }} />
                : <Bookmark size={18} style={{ color: K.sub }} />}
            </button>
            <button type="button" onClick={handleDownload}
              disabled={dlState === 'loading' || !movie.bytes}
              className="grid h-12 w-12 place-items-center rounded-2xl transition-all"
              title={dlState === 'done' ? 'Сохранено на устройстве' : dlState === 'loading' ? 'Сохраняем…' : movie.bytes ? 'Смотреть без связи' : 'Нет файла'}
              style={{ background: dlState === 'done' ? 'rgba(52,211,153,0.15)' : dlState === 'loading' ? 'rgba(79,110,247,0.15)' : 'var(--border)', border: `1px solid ${dlState === 'done' ? '#34d39944' : dlState === 'loading' ? '#4f6ef744' : 'transparent'}` }}>
              {dlState === 'done'
                ? <CheckCircle size={18} style={{ color: 'var(--green)' }} />
                : <motion.div animate={dlState === 'loading' ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                    <Download size={18} style={{ color: dlState === 'loading' ? 'var(--accent)' : K.sub }} />
                  </motion.div>
              }
            </button>
          </div>
          {dlError && <p className="mb-4 text-[11.5px]" style={{ color: 'var(--red)' }}>{dlError}</p>}

          {/* Оценка — настоящая: её ставят живые зрители, среднее считает сервер. */}
          {!movie.private && (
            <div className="mb-5 rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider" style={{ color: K.dim }}>
                {movie.myRating ? `Ваша оценка: ${movie.myRating}` : 'Ваша оценка'}
              </p>
              <div className="flex gap-1">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                  <button key={n} type="button" onClick={() => void rate(movie.id, movie.myRating === n ? 0 : n)}
                    className="flex-1 rounded-md py-1.5 text-[11px] font-bold transition-colors"
                    style={{
                      background: (movie.myRating ?? 0) >= n ? `${K.gold}22` : 'rgba(255,255,255,0.05)',
                      color: (movie.myRating ?? 0) >= n ? K.gold : K.dim,
                    }}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {movie.description && (
            <p className="text-sm leading-relaxed mb-5" style={{ color: K.sub }}>{movie.description}</p>
          )}

          <div className="space-y-2.5">
            {([
              ['Режиссёр', movie.director],
              ['Жанр',     movie.genre],
              ['Страна',   movie.country],
              ['Год',      movie.year?.toString()],
              ['Рейтинг',  movie.ageRating],
              ['Размер',   fmtSize(movie.bytes)],
            ] as [string, string|undefined][]).filter(([,v]) => v).map(([l, v]) => (
              <div key={l} className="flex gap-3">
                <span className="w-20 shrink-0 text-xs pt-0.5" style={{ color: K.dim }}>{l}</span>
                <span className="text-xs" style={{ color: K.text }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

/* -- Баннер ------------------------------------------------ */
const Hero = ({ movie, onPlay, onInfo }: { movie: ServerMovie; onPlay: () => void; onInfo: () => void }) => {
  const [c1, c2] = grad(movie.id);
  return (
    <div className="relative overflow-hidden rounded-2xl mx-3 mt-3 mb-5" style={{ height: 230 }}>
      {movie.hasPoster
        ? <img src={posterUrl(movie.id)} alt="" className="w-full h-full object-cover" />
        : <div className="w-full h-full" style={{ background: `linear-gradient(160deg,${c1},${c2})` }} />}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(to right,rgba(6,6,9,0.94) 0%,rgba(6,6,9,0.6) 50%,rgba(6,6,9,0.1) 100%)' }} />
      <div className="absolute inset-0 flex flex-col justify-end px-5 pb-5">
        {movie.category && (
          <span className="mb-2 self-start rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ background: `${K.orange}22`, color: K.orange, border: `1px solid ${K.orange}44` }}>
            {movie.category}
          </span>
        )}
        <h2 className="text-[22px] font-black text-white leading-tight mb-1.5">{movie.title}</h2>
        <div className="flex items-center flex-wrap gap-2.5 mb-4">
          <Stars r={movie.rating} />
          {movie.year && <span className="text-xs" style={{ color: K.sub }}>{movie.year}</span>}
          {movie.duration > 0 && <span className="text-xs" style={{ color: K.sub }}>· {fmtDuration(movie.duration)}</span>}
          {movie.ageRating && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold border"
              style={{ color: K.sub, borderColor: K.dim }}>{movie.ageRating}</span>
          )}
        </div>
        <div className="flex gap-2">
          <motion.button whileTap={{ scale: 0.95 }} type="button" onClick={onPlay}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{ background: K.orange }}>
            <Play size={15} fill="white" /> Смотреть
          </motion.button>
          <button type="button" onClick={onInfo}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium"
            style={{ background: 'rgba(255,255,255,0.13)', color: K.text }}>
            <Info size={14} /> О фильме
          </button>
        </div>
      </div>
    </div>
  );
};

/* -- Полка ------------------------------------------------- */
const Row = ({ title, Icon, movies, onSelect, progress }: {
  title: string; Icon: IconComponent;
  movies: ServerMovie[]; onSelect: (m: ServerMovie) => void;
  progress?: Record<string, number>;
}) => {
  if (!movies.length) return null;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 px-3 mb-3">
        <Icon size={15} style={{ color: K.orange }} />
        <h3 className="text-[15px] font-bold" style={{ color: K.text }}>{title}</h3>
      </div>
      <div className="flex gap-3 px-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {movies.map(m => {
          const seen = progress?.[m.id] ?? m.position ?? 0;
          const pct = m.duration > 0 ? Math.min(100, (seen / m.duration) * 100) : 0;
          return (
            <div key={m.id} className="shrink-0" style={{ width: 110 }}>
              <motion.div whileHover={{ scale: 1.04, y: -4 }} whileTap={{ scale: 0.97 }}
                className="relative cursor-pointer" onClick={() => onSelect(m)}>
                <PosterFill movie={m} />
                {pct > 1 && (
                  <div className="absolute bottom-1 left-1.5 right-1.5 h-[3px] overflow-hidden rounded-full"
                    style={{ background: 'rgba(255,255,255,0.25)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: K.orange }} />
                  </div>
                )}
              </motion.div>
              <p className="mt-1.5 text-xs font-medium truncate leading-tight px-0.5" style={{ color: K.text }}>{m.title}</p>
              {m.rating != null && (
                <div className="flex items-center gap-0.5 px-0.5 mt-0.5">
                  <Star size={9} fill={K.gold} style={{ color: K.gold }} />
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: K.gold }}>{m.rating.toFixed(1)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* -- Сетка ------------------------------------------------- */
const Grid = ({ movies, onSelect }: { movies: ServerMovie[]; onSelect: (m: ServerMovie) => void }) => {
  const { isBlocked } = useModerationStore();
  return (
  <div className="grid gap-x-3 gap-y-5 px-3 pb-4"
    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
    {movies.map((m, i) => (
      <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(i, 12) * 0.03 }} className="flex flex-col">
        <motion.div whileHover={{ scale: 1.04, y: -4 }} whileTap={{ scale: 0.97 }}
          className="relative cursor-pointer w-full" onClick={() => onSelect(m)}>
          {isBlocked('movie', m.id) ? (
            <div className="grid aspect-[2/3] w-full place-items-center rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <span className="px-1 text-center text-[9px] font-semibold" style={{ color: '#ef4444' }}>Заблокировано модерацией</span>
            </div>
          ) : (
          <>
          <PosterFill movie={m} />
          {(m.explicit || m.ageRestricted18) && (
            <div className="absolute right-1 bottom-1 flex gap-1">
              {m.ageRestricted18 && (
                <span className="rounded px-1 py-0.5 text-[8px] font-black text-white" style={{ background:'rgba(239,68,68,0.85)' }}>18+</span>
              )}
              {m.explicit && (
                <span className="rounded px-1 py-0.5 text-[8px] font-black text-white" style={{ background:'rgba(0,0,0,0.6)' }}>E</span>
              )}
            </div>
          )}
          </>
          )}
        </motion.div>
        <p className="mt-1.5 text-xs font-medium truncate px-0.5" style={{ color: K.text }}>{m.title}</p>
        {m.rating != null && (
          <div className="flex items-center gap-0.5 px-0.5 mt-0.5">
            <Star size={9} fill={K.gold} style={{ color: K.gold }} />
            <span className="text-[10px] font-bold tabular-nums" style={{ color: K.gold }}>{m.rating.toFixed(1)}</span>
          </div>
        )}
      </motion.div>
    ))}
  </div>
  );
};

type Tab = 'home' | 'catalog' | 'saved' | 'mine' | 'publish';

/* ═══════════════════════════════════════════════════════════
   МОЯ КОЛЛЕКЦИЯ

   Здесь человек загружает фильмы для себя. Сервер кладёт их
   закрытыми — всегда, без исключений и без выбора: «опубликовать при
   загрузке» тут нет не потому, что кнопку убрали, а потому, что
   сервер публикацию при загрузке не делает вовсе.
═══════════════════════════════════════════════════════════ */
const iSty = { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color: K.text };
const iCls = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

const MineTab = ({ onOpen }: { onOpen: (m: ServerMovie) => void }) => {
  const mine = useFilmStore(s => s.mine);
  const upload = useFilmStore(s => s.upload);
  const setPoster = useFilmStore(s => s.setPoster);
  const removeMovie = useFilmStore(s => s.removeMovie);

  const [vFile, setVFile]     = useState<File|null>(null);
  const [meta, setMeta]       = useState<VideoMeta|null>(null);
  const [isShort, setIsShort] = useState(false);
  const [poster, setPosterFile] = useState<File|null>(null);
  const [posterPreview, setPosterPreview] = useState<string|undefined>();
  const [title, setTitle]     = useState('');
  const [desc,  setDesc]      = useState('');
  const [cat,   setCat]       = useState('Другое');
  const [busy, setBusy]       = useState(false);
  const [percent, setPercent] = useState(0);
  const [err, setErr]         = useState('');
  const cancelRef = useRef<(() => void) | null>(null);
  const vRef   = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  /* Ссылка на предпросмотр постера — временная, и её надо отпускать:
     иначе каждый выбранный файл остаётся висеть в памяти вкладки. */
  useEffect(() => () => { if (posterPreview) URL.revokeObjectURL(posterPreview); }, [posterPreview]);

  const submit = async () => {
    if (!vFile || !title.trim() || busy) return;
    setBusy(true); setPercent(0); setErr('');
    const info = meta ?? await readVideoMeta(vFile);
    // Жанр в каталоге он же категория: по нему собираются кнопки
    // разделов и он же стоит в карточке. Поле одно, поэтому пишем
    // в оба — иначе в карточке строка «Жанр» всегда была бы пустой.
    const genre = cat.trim() || 'Другое';
    const job = upload(vFile, {
      title: title.trim(),
      description: desc.trim() || undefined,
      category: genre,
      genre,
      duration: info.duration,
      width: info.width,
      height: info.height,
      isShort,
    }, setPercent);
    cancelRef.current = job.cancel;
    const res = await job.promise;
    cancelRef.current = null;
    if (!res.ok) { setErr(res.reason ?? 'Не получилось загрузить'); setBusy(false); setPercent(0); return; }
    if (poster && res.id) await setPoster(res.id, poster);
    setVFile(null); setPosterFile(null); setMeta(null); setIsShort(false);
    if (posterPreview) URL.revokeObjectURL(posterPreview);
    setPosterPreview(undefined);
    setTitle(''); setDesc(''); setCat('Другое');
    setBusy(false); setPercent(0);
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
      {/* Что такое эта вкладка — сказано словами, а не подразумевается. */}
      <div className="flex items-start gap-2 rounded-2xl p-3 text-[11.5px]"
        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${K.border}`, color: K.sub }}>
        <Lock size={13} className="mt-0.5 shrink-0" style={{ color: K.sub }}/>
        <span>
          Личная коллекция. Всё, что вы сюда загрузите, видите только вы — ни в каталоге, ни в поиске,
          ни у других людей этих фильмов нет. Они хранятся на сервере, поэтому доступны с любого
          вашего устройства и не пропадают при закрытии вкладки.
        </span>
      </div>

      <div className="rounded-2xl p-4 space-y-3" style={{ background: K.card, border: `1px solid ${K.border}` }}>
        <p className="text-sm font-bold" style={{ color: K.text }}>Загрузить фильм</p>
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-2xl py-6 cursor-pointer transition-colors"
          style={{ background: vFile ? 'rgba(255,85,0,0.07)' : 'rgba(255,255,255,0.03)', border: `2px dashed ${vFile ? K.orange : 'rgba(255,255,255,0.1)'}` }}
          onClick={() => !busy && vRef.current?.click()}>
          <input ref={vRef} type="file" accept={ACCEPT_VIDEO} className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setVFile(f); setErr('');
              if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
              // Размеры кадра и длительность читаются сразу: по ним
              // видно, короткометражка это или обычный фильм, и галочка
              // ставится сама. Передумать можно — решает всё равно
              // сервер, а не эта подсказка.
              const info = await readVideoMeta(f);
              setMeta(info);
              setIsShort(looksLikeShort(info));
            }} />
          <Film size={28} style={{ color: vFile ? K.orange : K.dim }} />
          <p className="text-sm font-medium" style={{ color: vFile ? K.orange : K.sub }}>
            {vFile ? vFile.name : 'Выбрать видеофайл'}
          </p>
          <p className="text-xs" style={{ color: K.dim }}>
            {vFile
              ? `${fmtSize(vFile.size)}${meta?.duration ? ` · ${fmtDuration(meta.duration)}` : ''}${meta?.width ? ` · ${meta.width}×${meta.height}` : ''}`
              : 'MP4 · MOV · MKV · WebM · AVI'}
          </p>
        </div>

        {/* Короткометражка — не «любое короткое видео»: это вертикальное
            и недлинное. Галочка ставится сама по самому файлу, но
            последнее слово за человеком. Слишком длинное сервер в ленту
            не пустит, поэтому и предлагать не будем. */}
        {vFile && meta && meta.duration > 0 && meta.duration <= MAX_SHORT_DURATION && (
          <button type="button" onClick={() => setIsShort(v => !v)}
            className="flex w-full items-start gap-2.5 rounded-2xl p-3 text-left"
            style={{ background: isShort ? 'rgba(255,85,0,0.1)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isShort ? 'rgba(255,85,0,0.3)' : 'transparent'}` }}>
            <div className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md"
              style={{ background: isShort ? K.orange : 'rgba(255,255,255,0.08)' }}>
              {isShort && <CheckCircle size={13} color="#fff"/>}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: isShort ? K.orange : K.text }}>
                Это короткое кино
              </p>
              <p className="text-[11px]" style={{ color: K.dim }}>
                Попадёт в вертикальную ленту «Короткое кино» — после проверки.
                {meta.height < meta.width ? ' Кадр горизонтальный: в ленте его обрежет по бокам.' : ''}
              </p>
            </div>
          </button>
        )}
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iCls} style={iSty}/>
        <input value={cat} onChange={e=>setCat(e.target.value)} placeholder="Жанр (Фантастика, Комедия...)" className={iCls} style={iSty}/>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание (необязательно)" rows={3}
          className={iCls+' resize-none'} style={iSty}/>
        <div className="flex items-center gap-3">
          <input ref={imgRef} type="file" accept={ACCEPT_IMAGE} className="hidden"
            onChange={e=>{ const f=e.target.files?.[0]; if(f){ setPosterFile(f); if (posterPreview) URL.revokeObjectURL(posterPreview); setPosterPreview(URL.createObjectURL(f)); } }}/>
          <button type="button" onClick={() => imgRef.current?.click()}
            className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors"
            style={{ background:'var(--border)', border:'1px solid rgba(255,255,255,0.1)', color: K.sub }}>
            <ImageIcon size={14}/>{poster ? 'Постер выбран' : 'Добавить постер'}
          </button>
          {posterPreview && <img src={posterPreview} alt="" className="h-10 w-16 rounded-xl object-cover"/>}
        </div>

        {busy && (
          <>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background:'var(--border)' }}>
              <div className="h-full rounded-full transition-all"
                style={{ width:`${percent}%`, background:`linear-gradient(90deg,${K.orange},${K.orange2})` }}/>
            </div>
            <button type="button" onClick={() => cancelRef.current?.()}
              className="w-full text-center text-[11.5px]" style={{ color: K.dim }}>
              Отменить загрузку
            </button>
          </>
        )}
        {err && <p className="text-[11.5px]" style={{ color:'var(--red)' }}>{err}</p>}

        <motion.button whileTap={{ scale:0.97 }} type="button" onClick={() => void submit()}
          disabled={busy||!vFile||!title.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: K.orange }}>
          <Plus size={15}/>{busy ? `${percent}%…` : 'Добавить в коллекцию'}
        </motion.button>
      </div>

      <StorageQuotaBar />

      {mine.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: K.dim }}>
            Мои фильмы · {mine.length}
          </p>
          {mine.map(m => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl p-3"
              style={{ background: K.card, border:`1px solid ${K.border}` }}>
              <button type="button" onClick={() => onOpen(m)} className="shrink-0">
                <Poster movie={m} w={54} h={80}/>
              </button>
              <button type="button" onClick={() => onOpen(m)} className="flex-1 min-w-0 text-left">
                <p className="text-sm font-semibold truncate" style={{ color: K.text }}>{m.title}</p>
                <p className="text-xs truncate" style={{ color: K.dim }}>
                  {m.category}{m.duration ? ` · ${fmtDuration(m.duration)}` : ''}{m.bytes ? ` · ${fmtSize(m.bytes)}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-1">
                  <StatusChip movie={m}/>
                  {m.isShort && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: `${K.orange}1f`, color: K.orange }}>
                      <Zap size={9}/> Коротко
                    </span>
                  )}
                </div>
              </button>
              {m.status === 'private' && (
                <button type="button" onClick={() => setSharingId(m.id)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-white/5">
                  <Share2 size={14} style={{ color: K.dim }}/>
                </button>
              )}
              <button type="button" onClick={() => void removeMovie(m.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-red-500/10">
                <X size={14} style={{ color:'var(--red)' }}/>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-10">
          <Lock size={34} style={{ color: K.dim }} />
          <p className="text-sm" style={{ color: K.sub }}>В коллекции пока пусто</p>
        </div>
      )}

      {sharingId && (
        <ShareDialog kind="movie" fileId={sharingId}
          title={mine.find(m => m.id === sharingId)?.title ?? ''}
          onClose={() => setSharingId(null)} />
      )}
    </div>
  );
};

/** Состояние фильма словами: где он сейчас и кто его видит. */
const StatusChip = ({ movie }: { movie: ServerMovie }) => {
  const map: Record<string, { text: string; color: string; bg: string }> = {
    private:   { text: 'Только вы',     color: K.sub,     bg: 'rgba(255,255,255,0.07)' },
    pending:   { text: 'На проверке',   color: K.orange,  bg: 'rgba(255,85,0,0.12)' },
    published: { text: 'В каталоге',    color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    rejected:  { text: 'Отклонён',      color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  };
  const s = map[movie.status] ?? map.private;
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ background: s.bg, color: s.color }}>
      {movie.status === 'private' && <Lock size={9}/>}
      {s.text}
      {movie.status === 'rejected' && movie.rejectReason ? ` · ${movie.rejectReason}` : ''}
    </span>
  );
};

/* ═══════════════════════════════════════════════════════════
   ОПУБЛИКОВАТЬ

   Второй загрузки здесь больше нет — раньше их было две, и обе писали
   в один и тот же список, из-за чего «личное» и «общее» ничем не
   отличались. Теперь фильм уже лежит в коллекции, и здесь человек
   только просит вынести его в общий каталог: выбирает лицензию,
   ставит пометки и отправляет на проверку. Решение принимает
   администратор.
═══════════════════════════════════════════════════════════ */
const PublishTab = () => {
  const mine = useFilmStore(s => s.mine);
  const submitForReview = useFilmStore(s => s.submitForReview);
  const unpublish = useFilmStore(s => s.unpublish);
  const [gateOk, setGateOk] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [license, setLicense] = useState<'open'|'personal'>('open');
  const [explicit, setExplicit] = useState(false);
  const [ageRestricted18, setAge] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const ready = mine.filter(m => m.status === 'private' || m.status === 'rejected');
  const sent  = mine.filter(m => m.status === 'pending' || m.status === 'published');

  const send = async () => {
    if (!chosen || (license === 'open' && !agreed) || busy) return;
    setBusy(true); setErr('');
    const r = await submitForReview(chosen, { license, explicit, ageRestricted18 });
    setBusy(false);
    if (!r.ok) { setErr(r.reason ?? 'Не получилось отправить'); return; }
    setChosen(null); setLicense('open'); setExplicit(false); setAge(false); setAgreed(false);
  };

  if (!gateOk) return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full" style={{ background: 'rgba(239,68,68,0.12)' }}>
        <span className="text-2xl font-black" style={{ color: '#ef4444' }}>18+</span>
      </div>
      <p className="text-[15px] font-bold" style={{ color: K.text }}>Публикация в общий доступ</p>
      <p className="max-w-xs text-[12.5px]" style={{ color: K.sub }}>
        Здесь встречаются видео от разных пользователей, в том числе с нецензурными словами.
        Экосистема не несёт ответственности за содержание — всё, что помечено «Открытая лицензия»,
        взято из открытых источников.
      </p>
      <button type="button" onClick={() => setGateOk(true)}
        className="rounded-full px-6 py-2.5 text-[13px] font-bold text-white" style={{ background: K.orange }}>
        Понятно, продолжить
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
      <div className="flex items-start gap-1.5 rounded-2xl p-2.5 text-[10.5px]" style={{ background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.15)', color: K.sub }}>
        <ShieldAlert size={12} className="mt-0.5 shrink-0" style={{ color: K.orange }}/>
        Видео с пометкой «Открытая лицензия» — взято из открытых источников (сайт). Экосистема не несёт ответственности за использование лицензий.
      </div>

      <div className="flex items-start gap-1.5 rounded-2xl p-2.5 text-[10.5px]" style={{ background: 'rgba(255,255,255,0.04)', color: K.sub }}>
        <Info size={12} className="mt-0.5 shrink-0" style={{ color: K.sub }}/>
        Фильм сначала загружается в личную коллекцию и остаётся закрытым. В общий каталог он попадает
        только после проверки — сам себя опубликовать нельзя.
      </div>

      {ready.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10">
          <Cloud size={34} style={{ color: K.dim }} />
          <p className="text-sm text-center" style={{ color: K.sub }}>
            Нечего публиковать — сначала загрузите фильм<br/>во вкладке «Коллекция»
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: K.dim }}>Какой фильм публикуем</p>
          <div className="space-y-2">
            {ready.map(m => (
              <button key={m.id} type="button" onClick={() => setChosen(chosen === m.id ? null : m.id)}
                className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left"
                style={{ background: chosen===m.id ? 'rgba(255,85,0,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${chosen===m.id ? 'rgba(255,85,0,0.35)' : 'transparent'}` }}>
                <Poster movie={m} w={40} h={58}/>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold" style={{ color: K.text }}>{m.title}</p>
                  <p className="truncate text-[10.5px]" style={{ color: K.dim }}>
                    {m.category}{m.duration ? ` · ${fmtDuration(m.duration)}` : ''}
                  </p>
                  {m.status === 'rejected' && m.rejectReason && (
                    <p className="truncate text-[10.5px]" style={{ color: '#ef4444' }}>Отклонён: {m.rejectReason}</p>
                  )}
                </div>
                {chosen===m.id && <CheckCircle size={16} style={{ color: K.orange }}/>}
              </button>
            ))}
          </div>

          {chosen && (
            <>
              <div className="grid grid-cols-2 gap-2">
                {([['open','Открытая'],['personal','Личная']] as const).map(([k,l]) => (
                  <button key={k} type="button" onClick={() => setLicense(k)}
                    className="rounded-2xl py-2.5 text-sm font-semibold"
                    style={{ background: license===k ? (k==='open'?'rgba(255,85,0,0.12)':'rgba(34,197,94,0.12)') : 'rgba(255,255,255,0.04)',
                      color: license===k ? (k==='open'?K.orange:'#22c55e') : K.sub,
                      border: license===k ? `1px solid ${k==='open'?'rgba(255,85,0,0.3)':'rgba(34,197,94,0.3)'}` : '1px solid transparent' }}>
                    {l} лицензия
                  </button>
                ))}
              </div>

              {license === 'open' ? (
                <div className="rounded-2xl p-3 space-y-2.5" style={{ background: 'rgba(255,85,0,0.06)', border: '1px solid rgba(255,85,0,0.2)' }}>
                  <p className="flex items-start gap-1.5 text-xs" style={{ color: K.sub }}>
                    <ShieldAlert size={13} className="mt-0.5 shrink-0" style={{ color: K.orange }}/>
                    Взято из открытых источников (сайт). Экосистема не несёт ответственности за использование лицензий.
                  </p>
                  <label className="flex items-start gap-2 text-xs" style={{ color: K.text }}>
                    <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)} className="mt-0.5"/>
                    Подтверждаю: экосистема не несёт ответственности за использование лицензий и авторских прав этого видео
                  </label>
                  <label className="flex items-center gap-2 text-xs" style={{ color: K.text }}>
                    <input type="checkbox" checked={ageRestricted18} onChange={e=>setAge(e.target.checked)}/>
                    18+ (содержит нецензурные слова / не для всех)
                  </label>
                  <label className="flex items-center gap-2 text-xs" style={{ color: K.text }}>
                    <input type="checkbox" checked={explicit} onChange={e=>setExplicit(e.target.checked)}/>
                    Пометка E (ненормативная лексика)
                  </label>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 rounded-2xl p-3 text-xs" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>
                  <ShieldCheck size={14} className="shrink-0"/>Авторское право на личную лицензию подтверждено
                </div>
              )}

              {err && <p className="text-[11.5px]" style={{ color:'var(--red)' }}>{err}</p>}

              <motion.button whileTap={{ scale:0.97 }} type="button" onClick={() => void send()}
                disabled={busy||(license==='open'&&!agreed)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
                style={{ background: K.orange }}>
                <Cloud size={15}/>{busy ? 'Отправляем…' : 'Отправить на проверку'}
              </motion.button>
            </>
          )}
        </>
      )}

      {sent.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: K.dim }}>Отправленные · {sent.length}</p>
          {sent.map(m => (
            <div key={m.id} className="flex items-center gap-2.5 rounded-2xl p-2.5" style={{ background:'rgba(255,255,255,0.04)' }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-[13px] font-semibold" style={{ color: K.text }}>{m.title}</p>
                  {m.explicit && <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-black" style={{ background:'rgba(255,255,255,0.1)', color:K.sub }}>E</span>}
                  {m.ageRestricted18 && <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-black" style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444' }}>18+</span>}
                </div>
                <StatusChip movie={m}/>
              </div>
              {m.status === 'published' && (
                <button type="button" onClick={() => void unpublish(m.id)}
                  className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold"
                  style={{ background:'rgba(255,255,255,0.07)', color: K.sub }}>
                  Убрать из каталога
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* -- Очередь проверки (только администратору) --------------- */
const ModerationPanel = () => {
  const [queue, setQueue] = useState<ServerMovie[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);

  const reload = useCallback(async () => { setQueue(await apiFilmModerationQueue()); }, []);
  useEffect(() => { void reload(); }, [reload]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    await apiModerateMovie(id, approve, approve ? undefined : reason.trim() || undefined);
    setBusy(null); setRejecting(null); setReason('');
    await reload();
  };

  if (queue === null) return null;
  return (
    <div className="space-y-2 px-4 pb-4">
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: K.dim }}>
        Очередь проверки · {queue.length}
      </p>
      {queue.length === 0 && <p className="py-6 text-center text-sm" style={{ color: K.sub }}>Заявок нет</p>}
      {queue.map(m => (
        <div key={m.id} className="rounded-2xl p-3 space-y-2" style={{ background: K.card, border: `1px solid ${K.border}` }}>
          <div className="flex items-center gap-3">
            <Poster movie={m} w={44} h={64}/>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold" style={{ color: K.text }}>{m.title}</p>
              <p className="truncate text-[11px]" style={{ color: K.dim }}>
                {m.category}{m.duration ? ` · ${fmtDuration(m.duration)}` : ''} · {m.ownerName ?? 'пользователь'}
              </p>
              <p className="text-[11px]" style={{ color: K.sub }}>
                {m.license === 'open' ? 'Открытая лицензия' : 'Личная лицензия'}
                {m.ageRestricted18 ? ' · 18+' : ''}{m.explicit ? ' · E' : ''}
              </p>
            </div>
          </div>
          {rejecting === m.id ? (
            <div className="space-y-2">
              <input value={reason} onChange={e => setReason(e.target.value)}
                placeholder="Причина отказа — её увидит владелец" className={iCls} style={iSty}/>
              <div className="flex gap-2">
                <button type="button" onClick={() => void decide(m.id, false)} disabled={busy === m.id}
                  className="flex-1 rounded-2xl py-2 text-[13px] font-bold text-white disabled:opacity-40"
                  style={{ background: 'var(--red)' }}>Отклонить</button>
                <button type="button" onClick={() => { setRejecting(null); setReason(''); }}
                  className="rounded-2xl px-4 py-2 text-[13px]" style={{ background: 'var(--border)', color: K.sub }}>Отмена</button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" onClick={() => void decide(m.id, true)} disabled={busy === m.id}
                className="flex-1 rounded-2xl py-2 text-[13px] font-bold text-white disabled:opacity-40"
                style={{ background: '#22c55e' }}>В каталог</button>
              <button type="button" onClick={() => setRejecting(m.id)}
                className="flex-1 rounded-2xl py-2 text-[13px] font-semibold"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>Отклонить</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

/* -- Экран подписки ---------------------------------------- */
const PrimeGate = ({ service }: { service: 'music' | 'film' }) => {
  const PLANS = [
    { days:30,  label:'1 месяц', price:'399 ₽' },
    { days:365, label:'1 год',   price:'3 790 ₽', popular:true },
    { days:730, label:'2 года',  price:'6 990 ₽' },
  ];
  // Цены здесь только для показа: считает и списывает сервер по своей
  // таблице, поэтому подделать сумму в запросе нельзя.
  const PRICES: Record<number, number> = { 30:399, 365:3790, 730:6990 };
  const { purchasePrime } = useAuthStore();
  const [chosen, setChosen] = useState(365);
  const [err,    setErr]    = useState('');
  const [busy,   setBusy]   = useState(false);
  const [done,   setDone]   = useState(false);

  const buy = async () => {
    setErr(''); setBusy(true);
    // Подписку выписывает сервер: он же списывает деньги и он же потом
    // решает, отдавать ли контент.
    const res = await purchasePrime('standard', chosen);
    setBusy(false);
    if (!res.ok) { setErr(res.reason ?? 'Не получилось оформить подписку'); return; }
    setDone(true);
  };

  const Icon  = service === 'music' ? Music2 : Film;
  const label = service === 'music' ? 'Sky Music' : 'Sky Film';

  if (done) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:20 }}
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)', boxShadow:'0 12px 40px rgba(245,158,11,0.4)' }}>
        <Crown size={36} className="text-white"/>
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-black text-white">Sky Prime активен!</p>
        <p className="text-sm mt-2" style={{ color:'var(--t2)' }}>Добро пожаловать в {label}</p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full px-5 py-6 gap-5 overflow-y-auto">
      <div className="relative">
        <div className="grid h-20 w-20 place-items-center rounded-3xl"
          style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)' }}>
          <Icon size={36} style={{ color:'var(--t2)' }}/>
        </div>
        <div className="absolute -top-2 -right-2 grid h-8 w-8 place-items-center rounded-full"
          style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
          <Crown size={14} className="text-white"/>
        </div>
      </div>

      <div className="text-center">
        <p className="text-xl font-black text-white">{label}  -  только для Prime</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color:'var(--t2)', maxWidth:300 }}>
          {service === 'music'
            ? 'Полный каталог музыки, загрузка треков и офлайн-режим доступны с подпиской Sky Prime.'
            : 'Вся кинотека, личная коллекция и просмотр без рекламы доступны с подпиской Sky Prime.'}
        </p>
      </div>

      <div className="w-full space-y-2.5 max-w-xs">
        {PLANS.map(plan => (
          <motion.button key={plan.days} type="button" whileTap={{ scale:0.97 }}
            onClick={() => setChosen(plan.days)}
            className="relative flex items-center justify-between w-full rounded-2xl px-4 py-3.5 transition-all"
            style={{
              background: chosen===plan.days
                ? plan.popular ? 'rgba(245,158,11,0.15)' : 'rgba(79,110,247,0.12)'
                : 'rgba(255,255,255,0.04)',
              border: chosen===plan.days
                ? `1.5px solid ${plan.popular ? 'rgba(245,158,11,0.5)' : 'rgba(79,110,247,0.5)'}`
                : '1.5px solid rgba(255,255,255,0.07)',
            }}>
            {plan.popular && (
              <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[9px] font-bold text-white"
                style={{ background:'linear-gradient(135deg,#f59e0b,#fb923c)' }}>
                ВЫГОДНО
              </span>
            )}
            <div className="flex items-center gap-2.5">
              <div className="grid h-5 w-5 place-items-center rounded-full"
                style={{ border:`2px solid ${chosen===plan.days ? (plan.popular?'var(--amber)':'var(--accent)') : 'rgba(255,255,255,0.2)'}` }}>
                {chosen===plan.days && (
                  <div className="h-2.5 w-2.5 rounded-full"
                    style={{ background: plan.popular?'var(--amber)':'var(--accent)' }}/>
                )}
              </div>
              <span className="text-sm font-semibold text-white">{plan.label}</span>
            </div>
            <span className="text-sm font-bold"
              style={{ color: plan.popular ? 'var(--amber)' : 'var(--t1)' }}>{plan.price}</span>
          </motion.button>
        ))}
      </div>

      {err && (
        <motion.p initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }}
          className="text-xs text-center leading-relaxed" style={{ color:'var(--red)', maxWidth:280 }}>
          {err}
        </motion.p>
      )}

      <motion.button whileTap={{ scale:0.97 }} type="button" onClick={() => void buy()} disabled={busy}
        className="w-full max-w-xs rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-50"
        style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)', boxShadow:'0 8px 28px rgba(245,158,11,0.35)' }}>
        {busy ? 'Оформляем…' : (
          <span className="inline-flex items-center justify-center gap-2">
            <Crown size={15}/> Оформить Prime за {PRICES[chosen].toLocaleString('ru')} ₽
          </span>
        )}
      </motion.button>

      <p className="text-xs text-center" style={{ color:'var(--t3)' }}>
        Списывается с баланса SkyMoney · Нет рекламы · Отменить в любой момент
      </p>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════
   SkyFilm
═══════════════════════════════════════════════════════════ */
export const SkyFilm = () => {
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const isAdmin = me?.isAdmin ?? false;

  const catalog = useFilmStore(s => s.catalog);
  const savedList = useFilmStore(s => s.saved);
  const continueWatching = useFilmStore(s => s.continueWatching);
  const categories = useFilmStore(s => s.categories);
  const progress = useFilmStore(s => s.progress);
  const loading = useFilmStore(s => s.loading);
  const loaded = useFilmStore(s => s.loaded);
  const needsPrime = useFilmStore(s => s.needsPrime);
  const error = useFilmStore(s => s.error);
  const load = useFilmStore(s => s.load);
  const toggleSaved = useFilmStore(s => s.toggleSaved);
  const searchServer = useFilmStore(s => s.search);

  const [tab,      setTab]      = useState<Tab>('home');
  const [playing,  setPlaying]  = useState<ServerMovie | null>(null);
  const [detail,   setDetail]   = useState<ServerMovie | null>(null);
  const [category, setCategory] = useState('Все');
  const [search,   setSearch]   = useState('');
  const [showSrch, setShowSrch] = useState(false);
  const [found,    setFound]    = useState<ServerMovie[]>([]);
  const [shortsStartId, setShortsStartId] = useState<string | null>(null);

  useEffect(() => { void load(); }, [load]);

  /* Дипссылка из Библиотеки: «открой и играй именно вот этот фильм».
     Тот же приём, что pendingExtrasTab, только несёт id элемента —
     запрашиваем фильм напрямую, а не ищем в уже загруженных списках,
     чтобы не зависеть от того, что именно успело подгрузиться. */
  const pendingItemId = useModuleStore(s => s.pendingExtrasItemId);
  const setPendingItemId = useModuleStore(s => s.setPendingExtrasItemId);
  useEffect(() => {
    if (!pendingItemId) return;
    const id = pendingItemId;
    setPendingItemId(null);
    void apiMovie(id).then(m => { if (m) setPlaying(m); });
  }, [pendingItemId, setPendingItemId]);

  /* Поиск идёт на сервере, а не по тому, что уже лежит на экране.
     Так он находит весь каталог, а не первую сотню, — и так личное в
     него не попадает по построению. */
  useEffect(() => {
    const q = search.trim();
    if (!q) { setFound([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      void searchServer(q).then(r => { if (alive) setFound(r); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [search, searchServer]);

  const savedIds = useMemo(() => savedList.map(m => m.id), [savedList]);
  const cats = useMemo(() => categories.map(c => c.name), [categories]);

  const filtered = useMemo(
    () => (category === 'Все' ? catalog : catalog.filter(m => m.category === category)),
    [catalog, category]);

  const topRated = useMemo(
    () => [...catalog].filter(m => m.rating != null).sort((a,b) => (b.rating??0)-(a.rating??0)).slice(0,10),
    [catalog]);
  const fresh = useMemo(
    () => [...catalog].sort((a,b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')).slice(0,10),
    [catalog]);
  const popular = useMemo(
    () => [...catalog].sort((a,b) => b.views - a.views).slice(0,10), [catalog]);
  /* Лента короткого кино приходит своей ручкой, а не отсевом каталога:
     каталог отдаётся первой сотней, и короткометражка, оказавшаяся сто
     первой, в ленту не попадала бы вовсе. Здесь нужно только знать,
     есть ли лента вообще, — чтобы не звать в пустоту. */
  const shorts = useFilmStore(s => s.shorts);
  const shortsDone = useFilmStore(s => s.shortsDone);
  const loadShorts = useFilmStore(s => s.loadShorts);
  useEffect(() => { void loadShorts(); }, [loadShorts]);
  const hero = topRated[0] ?? fresh[0];

  const NAV: { key: Tab; Icon: IconComponent; label: string }[] = [
    { key: 'home',    Icon: Tv,       label: 'Главная'  },
    { key: 'catalog', Icon: Layers,   label: 'Каталог'  },
    { key: 'saved',   Icon: Bookmark, label: 'Закладки' },
    { key: 'mine',    Icon: Upload,   label: 'Коллекция' },
    { key: 'publish', Icon: Cloud,    label: 'Опубликовать' },
  ];

  /* Подписку подтверждает сервер: он не отдал ни каталога, ни пропуска. */
  if (needsPrime) return <PrimeGate service="film"/>;

  if (loading && !loaded) return (
    <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: K.bg }}>
      <Film size={38} style={{ color: K.dim }} />
      <p className="text-sm" style={{ color: K.sub }}>Загружаем кино…</p>
    </div>
  );

  if (error && !loaded) return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center" style={{ background: K.bg }}>
      <AlertTriangle size={38} style={{ color: K.orange }} />
      <p className="text-sm" style={{ color: K.sub }}>{error}</p>
      <button type="button" onClick={() => void load({ force: true })}
        className="rounded-full px-6 py-2.5 text-[13px] font-bold text-white" style={{ background: K.orange }}>
        Попробовать ещё раз
      </button>
    </div>
  );

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden" style={{ background: K.bg }}>

        {/* -- Шапка -------------------------------------------- */}
        <header className="shrink-0 flex items-center justify-between px-4 pt-4 pb-2">
          <AnimatePresence mode="wait">
            {showSrch ? (
              <motion.div key="s" initial={{ opacity: 0, scaleX: 0.92 }} animate={{ opacity: 1, scaleX: 1 }}
                exit={{ opacity: 0 }} className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: K.card2 }}>
                <Search size={14} style={{ color: K.sub }} />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Фильм, жанр..."
                  className="flex-1 bg-transparent text-sm outline-none" style={{ color: K.text }} />
                {search && (
                  <button type="button" onClick={() => setSearch('')} style={{ color: K.sub }}>
                    <X size={14} />
                  </button>
                )}
              </motion.div>
            ) : (
              <motion.h1 key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="text-xl font-black tracking-tight">
                <span style={{ color: K.text }}>Sky</span>
                <span style={{ color: K.orange }}>Film</span>
              </motion.h1>
            )}
          </AnimatePresence>
          <button type="button"
            onClick={() => { setShowSrch(s => !s); if (showSrch) setSearch(''); }}
            className="ml-3 grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: showSrch ? K.orange : K.sub }}>
            {showSrch ? <X size={18} /> : <Search size={18} />}
          </button>
        </header>

        {/* -- Содержимое --------------------------------------- */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {showSrch && search ? (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <p className="px-3 py-2 text-xs font-semibold" style={{ color: K.sub }}>
                Результаты · {found.length}
              </p>
              <Grid movies={found} onSelect={m => { setDetail(m); setShowSrch(false); }} />
              {!found.length && (
                <div className="flex flex-col items-center gap-2 py-16">
                  <Film size={38} style={{ color: K.dim }} />
                  <p className="text-sm" style={{ color: K.sub }}>Ничего не найдено</p>
                  <p className="max-w-[260px] text-center text-[11.5px]" style={{ color: K.dim }}>
                    Поиск идёт по общему каталогу. Свои фильмы ищите во вкладке «Коллекция» —
                    они закрыты и в общий поиск не попадают.
                  </p>
                </div>
              )}
            </div>

          ) : tab === 'home' ? (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {hero && (
                <Hero movie={hero} onPlay={() => setPlaying(hero)} onInfo={() => setDetail(hero)} />
              )}
              {shorts.length > 0 && (
                <button type="button" onClick={() => setShortsStartId(shorts[0].id)}
                  className="mx-3 mt-3 mb-1 flex items-center gap-3 rounded-2xl px-4 py-3.5 w-[calc(100%-24px)]"
                  style={{ background: `linear-gradient(135deg,${K.orange}22,${K.card2})`, border: `1px solid ${K.orange}33` }}>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: K.orange }}>
                    <Zap size={18} color="#fff" fill="#fff"/>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-bold" style={{ color: K.text }}>Короткое кино</p>
                    <p className="text-[11px]" style={{ color: K.sub }}>Вертикальные короткометражки · свайп вверх</p>
                  </div>
                  {/* Число показываем, только когда лента кончилась и мы
                      знаем его целиком. Иначе здесь стояла бы длина
                      первой порции — то есть неправда. */}
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: K.orange, color: '#fff' }}>
                    {shortsDone ? shorts.length : 'Смотреть'}
                  </span>
                </button>
              )}
              <Row title="Продолжить просмотр" Icon={History} movies={continueWatching}
                onSelect={setDetail} progress={progress} />
              <Row title="Топ по рейтингу" Icon={Award}      movies={topRated} onSelect={setDetail} />
              <Row title="Популярное"       Icon={TrendingUp} movies={popular}  onSelect={setDetail} />
              <Row title="Новинки"          Icon={Film}       movies={fresh}    onSelect={setDetail} />
              {catalog.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-16">
                  <Film size={38} style={{ color: K.dim }} />
                  <p className="text-sm" style={{ color: K.sub }}>В каталоге пока пусто</p>
                  <p className="max-w-[260px] text-center text-[11.5px]" style={{ color: K.dim }}>
                    Свои фильмы можно загрузить во вкладке «Коллекция» — они останутся видны только вам.
                  </p>
                </div>
              )}
              <div className="h-4" />
            </div>

          ) : tab === 'catalog' ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="shrink-0 flex gap-2 px-3 py-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {['Все', ...cats].map(c => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className="shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition-all"
                    style={{
                      background: category === c ? K.orange : 'var(--border)',
                      color:      category === c ? '#fff' : K.sub,
                      border: category === c ? 'none' : `1px solid ${K.border}`,
                    }}>
                    {c}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto pt-2" style={{ scrollbarWidth: 'none' }}>
                {filtered.length > 0
                  ? <Grid movies={filtered} onSelect={setDetail} />
                  : <div className="flex flex-col items-center gap-2 py-16">
                      <Film size={38} style={{ color: K.dim }} />
                      <p className="text-sm" style={{ color: K.sub }}>Нет фильмов</p>
                    </div>}
              </div>
            </div>

          ) : tab === 'mine' ? (
            <div className="flex-1 overflow-hidden">
              <MineTab onOpen={setDetail} />
            </div>

          ) : tab === 'publish' ? (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <PublishTab />
              {isAdmin && <ModerationPanel />}
            </div>

          ) : (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <p className="px-3 pt-3 pb-2 text-base font-bold" style={{ color: K.text }}>
                Закладки · {savedList.length}
              </p>
              {savedList.length > 0
                ? <Grid movies={savedList} onSelect={setDetail} />
                : <div className="flex flex-col items-center gap-3 py-16">
                    <Bookmark size={42} style={{ color: K.dim }} />
                    <p className="text-sm" style={{ color: K.sub }}>Сохраняйте фильмы для просмотра позже</p>
                  </div>}
            </div>
          )}
        </div>

        {/* -- Нижняя навигация --------------------------------- */}
        <nav className="shrink-0 flex items-center justify-around border-t py-2"
          style={{ background: K.card, borderColor: K.border }}>
          {/* Пять частей поровну. С прежними отступами по бокам пятая
              вкладка не помещалась на телефоне и уезжала за край. */}
          {NAV.map(({ key, Icon, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className="flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1.5 transition-colors"
              style={{ color: tab === key ? K.orange : K.dim }}>
              <Icon size={21} />
              <span className="w-full truncate text-center text-[9px] font-semibold">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Карточка */}
      <AnimatePresence>
        {detail && !playing && (
          <Detail movie={detail}
            onPlay={() => { setPlaying(detail); setDetail(null); }}
            onClose={() => setDetail(null)}
            saved={savedIds.includes(detail.id)}
            onSave={() => void toggleSaved(detail.id)} />
        )}
      </AnimatePresence>

      {/* Проигрыватель */}
      <AnimatePresence>
        {playing && <Player movie={playing} onClose={() => setPlaying(null)} />}
      </AnimatePresence>

      {/* Короткое кино */}
      <AnimatePresence>
        {shortsStartId && (
          <SkyShorts startId={shortsStartId} onClose={() => setShortsStartId(null)}/>
        )}
      </AnimatePresence>
    </>
  );
};
