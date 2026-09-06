/* ===========================================================
   SKY FILM  -  редизайн в стиле Кинопоиска
=========================================================== */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  X, Star, Clock, Film, Search, ChevronLeft, RotateCcw,
  SkipForward, Bookmark, BookmarkCheck, Info,
  Tv, TrendingUp, Award, Layers, Download, CheckCircle, Upload, Image as ImageIcon, Plus, Crown,
  ShieldAlert, ShieldCheck, Cloud, Zap,
} from 'lucide-react';
import { usePlatformStore, Movie } from '@/platform/store';
import { useMoney } from '@/wallet/store';
import { SkyPayCheckout } from '@/payment/SkyPay';
import { useAuthStore } from '@/core/auth/store';
import { saveDownloadFromDataUrl, isDownloaded } from '@/offline/offlineDB';
import { useModerationStore } from '@/shared/moderationStore';
import { ContentWarningGate, BlockedChannelBadge } from '@/shared/ContentWarningGate';
import { useRegisterWatchActivity } from '@/settings/breakReminderStore';
import type { IconComponent } from '@/shared/icon';
import { useMediaPresence } from '@/profile/viewer/mediaPresence';
import { SkyShorts } from './SkyShorts';

/* -- токены ----------------------------------------------- */
const K = {
  bg:     '#060609',
  card:   '#111116',
  card2:  '#1a1a22',
  orange: '#FF5500',
  orange2:'#FF8C42',
  text:   '#FFFFFF',
  sub:    '#9898b0',
  dim:    '#50506a',
  gold:   '#F5C518',
  border: 'var(--border)',
};

const fmtT = (s: number) => {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`;
};

/* -- градиенты по ID --------------------------------------- */
const GRADS: Record<string, [string,string]> = {
  'mov-1':['#0b1a45','#162f6a'], 'mov-2':['#2a0808','#581212'],
  'mov-3':['#061828','#0d2d45'], 'mov-4':['#06180f','#0e3020'],
  'mov-5':['#1a0a00','#3c1900'], 'mov-6':['#100016','#1e002e'],
  'mov-7':['#180c22','#35183e'], 'mov-8':['#001a1a','#003333'],
};
const grad = (id: string): [string,string] => GRADS[id] ?? ['#0d1422','#1a2540'];

/* -- Постер ----------------------------------------------- */
const Poster = ({ movie, w = 110, h }: { movie: Movie; w?: number; h?: number }) => {
  const [c1, c2] = grad(movie.id);
  const ph = h ?? Math.round(w * 1.48);
  return (
    <div className="relative overflow-hidden rounded-xl shrink-0"
      style={{ width: w, height: ph }}>
      {movie.coverUrl
        ? <img src={movie.coverUrl} alt={movie.title} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(160deg,${c1},${c2})` }}>
            <Film size={w * 0.28} color="rgba(255,255,255,0.18)" />
          </div>}
      {/* vignette bottom */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(transparent 55%, rgba(0,0,0,0.75))' }} />
      {/* SKY+ badge */}
      {movie.premium && (
        <div className="absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-black text-white"
          style={{ background: `linear-gradient(135deg,${K.orange},${K.orange2})` }}>SKY+</div>
      )}
      {/* rating */}
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

/* -- Poster full-width (for grid) ------------------------- */
const PosterFill = ({ movie }: { movie: Movie }) => {
  const [c1, c2] = grad(movie.id);
  return (
    <div className="relative overflow-hidden rounded-xl w-full" style={{ aspectRatio: '2/3' }}>
      {movie.coverUrl
        ? <img src={movie.coverUrl} alt={movie.title} className="w-full h-full object-cover" />
        : <div className="w-full h-full flex items-center justify-center"
            style={{ background: `linear-gradient(160deg,${c1},${c2})` }}>
            <Film size={32} color="rgba(255,255,255,0.18)" />
          </div>}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(transparent 55%, rgba(0,0,0,0.75))' }} />
      {movie.premium && (
        <div className="absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[9px] font-black text-white"
          style={{ background: `linear-gradient(135deg,${K.orange},${K.orange2})` }}>SKY+</div>
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

/* -- Star chip --------------------------------------------- */
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

/* -- Video player ------------------------------------------ */
const Player = ({ movie, onClose }: { movie: Movie; onClose: () => void }) => {
  const vRef  = useRef<HTMLVideoElement>(null);
  const cRef  = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const [pl,  setPl]  = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(0.85);
  const [mut, setMut] = useState(false);
  const [fs,  setFs]  = useState(false);
  const [ui,  setUi]  = useState(true);
  const [c1, c2] = grad(movie.id);
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  const { setPlaying, setPauseHandler } = useRegisterWatchActivity();

  useEffect(() => { const v = vRef.current; if (!v || !movie.sourceUrl) return; v.src = movie.sourceUrl; }, [movie.id]);
  useEffect(() => { if (vRef.current) vRef.current.volume = mut ? 0 : vol; }, [vol, mut]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); vRef.current?.pause(); }, []);

  /* Сообщаем движку «Перерыва от просмотра» о фактическом воспроизведении,
     и отдаём ему функцию паузы для варианта «Сделать перерыв». */
  useEffect(() => {
    setPlaying(pl);
    return () => setPlaying(false);
  }, [pl, setPlaying]);
  useEffect(() => {
    setPauseHandler(() => { vRef.current?.pause(); setPl(false); });
    return () => setPauseHandler(null);
  }, [setPauseHandler]);

  /* «Сейчас смотрит фильм» — реальный live-статус в профиле. */
  const { currentUserId, accounts } = useAuthStore();
  const setWatchPresence = useMediaPresence(s => s.setWatchPresence);
  useEffect(() => {
    if (!currentUserId) return;
    const me = accounts.find(a => a.id === currentUserId);
    const allowed = me?.privacy?.showMovies ?? true;
    if (pl && allowed) setWatchPresence({ userId: currentUserId, title: movie.title, kind: 'movie', coverUrl: movie.coverUrl }, currentUserId);
    else setWatchPresence(null, currentUserId);
    return () => setWatchPresence(null, currentUserId);
  }, [pl, movie.id, currentUserId]);

  const bump = useCallback(() => {
    setUi(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setUi(false), 3000);
  }, []);

  const toggle = () => {
    const v = vRef.current; if (!v) return;
    pl ? v.pause() : v.play().catch(() => {});
    setPl(p => !p);
  };
  const seek = (t: number) => { if (vRef.current) { vRef.current.currentTime = t; setCur(t); } };
  const skip = (n: number) => seek(Math.max(0, Math.min(dur, cur + n)));
  const toggleFs = async () => {
    if (!document.fullscreenElement) { await cRef.current?.requestFullscreen?.().catch(() => {}); setFs(true); }
    else { await document.exitFullscreen?.().catch(() => {}); setFs(false); }
  };

  return (
    <motion.div ref={cRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center"
      onMouseMove={bump} style={{ cursor: ui ? 'default' : 'none' }}>

      {movie.sourceUrl
        ? <video ref={vRef} className="h-full w-full object-contain"
            onTimeUpdate={() => setCur(vRef.current?.currentTime ?? 0)}
            onLoadedMetadata={() => setDur(vRef.current?.duration ?? 0)}
            onEnded={() => setPl(false)} onClick={toggle} />
        : <div className="h-full w-full flex flex-col items-center justify-center gap-4"
            style={{ background: `linear-gradient(160deg,${c1},${c2})` }}>
            <Film size={72} color="rgba(255,255,255,0.1)" />
            <p className="text-xl font-bold text-white">{movie.title}</p>
            <p className="text-sm" style={{ color: K.sub }}>Видеофайл не загружен</p>
          </div>}

      <AnimatePresence>
        {ui && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {/* top */}
            <div className="flex items-center gap-3 px-5 py-4 pointer-events-auto"
              style={{ background: 'linear-gradient(rgba(0,0,0,0.78),transparent)' }}>
              <button type="button" onClick={onClose}
                className="grid h-10 w-10 place-items-center rounded-full hover:bg-white/15"
                style={{ background: 'rgba(0,0,0,0.5)' }}>
                <ChevronLeft size={20} className="text-white" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-white truncate">{movie.title}</p>
                {movie.year && <p className="text-xs" style={{ color: K.sub }}>{movie.year} · {movie.genre}</p>}
              </div>
              <button type="button" onClick={toggleFs}
                className="grid h-10 w-10 place-items-center rounded-full pointer-events-auto"
                style={{ background: 'rgba(0,0,0,0.5)' }}>
                {fs ? <Minimize2 size={16} className="text-white" /> : <Maximize2 size={16} className="text-white" />}
              </button>
            </div>
            {/* center */}
            <div className="flex items-center justify-center gap-8 pointer-events-auto">
              <motion.button whileTap={{ scale: 0.88 }} type="button" onClick={() => skip(-10)}
                className="grid h-12 w-12 place-items-center rounded-full"
                style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
                <RotateCcw size={20} className="text-white" />
              </motion.button>
              <motion.button whileTap={{ scale: 0.9 }} type="button" onClick={toggle}
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
            {/* bottom */}
            <div className="px-5 pb-5 space-y-3 pointer-events-auto"
              style={{ background: 'linear-gradient(transparent,rgba(0,0,0,0.88))' }}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono w-10 text-right" style={{ color: K.sub }}>{fmtT(cur)}</span>
                <div className="group relative flex-1 h-[3px] cursor-pointer rounded-full transition-all hover:h-1.5"
                  style={{ background: 'rgba(255,255,255,0.18)' }}
                  onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX-r.left)/r.width)*dur); }}>
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

/* -- Detail bottom sheet ----------------------------------- */
const Detail = ({ movie, onPlay, onClose, saved, onSave }: {
  movie: Movie; onPlay: () => void; onClose: () => void; saved: boolean; onSave: () => void;
}) => {
  const [c1, c2] = grad(movie.id);
  const [dlState, setDlState] = useState<'idle'|'loading'|'done'>('idle');
  const { isBlocked, blockReason, warningFor, isAcknowledged } = useModerationStore();
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

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (dlState !== 'idle' || !movie.sourceUrl) return;
    setDlState('loading');
    try {
      const resp = await fetch(movie.sourceUrl);
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob); });
      await saveDownloadFromDataUrl({
        id: movie.id, kind: 'movie',
        title: movie.title, duration: movie.duration,
        mimeType: movie.mimeType ?? 'video/mp4',
        bytes: movie.bytes ?? blob.size,
        addedAt: new Date().toISOString(),
      }, dataUrl);
      setDlState('done');
    } catch { setDlState('idle'); }
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

        {/* hero */}
        <div className="relative h-52 shrink-0 overflow-hidden">
          {movie.coverUrl
            ? <img src={movie.coverUrl} alt="" className="w-full h-full object-cover" />
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
              {(movie as any).ageRestricted18 && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-black text-white" style={{ background:'rgba(239,68,68,0.85)' }}>18+</span>
              )}
              {(movie as any).explicit && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-black text-white" style={{ background:'rgba(0,0,0,0.6)' }}>E</span>
              )}
            </div>
          </div>
        </div>

        {/* body */}
        <div className="overflow-y-auto flex-1 px-5 pt-4 pb-8" style={{ scrollbarWidth: 'none' }}>
          <div className="flex items-center gap-4 mb-4">
            <Stars r={movie.rating} />
            {movie.duration && (
              <span className="flex items-center gap-1 text-sm" style={{ color: K.sub }}>
                <Clock size={13} /> {movie.duration}
              </span>
            )}
            {movie.country && <span className="text-sm" style={{ color: K.sub }}>{movie.country}</span>}
          </div>

          {(movie as any).license && (
            <div className="flex items-center gap-1.5 rounded-xl px-3 py-2 mb-4 text-[11px]"
              style={{ background: (movie as any).license==='open' ? 'rgba(255,85,0,0.08)' : 'rgba(34,197,94,0.08)',
                border: `1px solid ${(movie as any).license==='open' ? 'rgba(255,85,0,0.2)' : 'rgba(34,197,94,0.2)'}`,
                color: K.sub }}>
              {(movie as any).license === 'open'
                ? <><ShieldAlert size={13} style={{ color: K.orange }}/><span>Открытая лицензия — взято из открытых источников. Экосистема не несёт ответственности за использование лицензий. Загрузил: {(movie as any).uploaderName ?? 'пользователь'}</span></>
                : <><ShieldCheck size={13} style={{ color:'#22c55e' }}/><span>Авторское право на личную лицензию подтверждено. Загрузил: {(movie as any).uploaderName ?? 'пользователь'}</span></>}
            </div>
          )}

          {/* CTA */}
          <div className="flex gap-3 mb-5">
            <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={onPlay}
              className="flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-base font-bold text-white"
              style={{ background: K.orange }}>
              <Play size={18} fill="white" /> Смотреть
            </motion.button>
            <button type="button" onClick={onSave}
              className="grid h-12 w-12 place-items-center rounded-2xl transition-all"
              style={{ background: saved ? `${K.orange}20` : 'var(--border)', border: `1px solid ${saved ? K.orange+'55' : 'transparent'}` }}>
              {saved
                ? <BookmarkCheck size={18} style={{ color: K.orange }} />
                : <Bookmark size={18} style={{ color: K.sub }} />}
            </button>
            {/* Download for offline */}
            <button type="button" onClick={handleDownload}
              disabled={dlState === 'loading' || (!movie.sourceUrl && dlState === 'idle')}
              className="grid h-12 w-12 place-items-center rounded-2xl transition-all"
              title={dlState === 'done' ? 'Скачано' : dlState === 'loading' ? 'Скачивание...' : movie.sourceUrl ? 'Скачать офлайн' : 'Нет файла'}
              style={{ background: dlState === 'done' ? 'rgba(52,211,153,0.15)' : dlState === 'loading' ? 'rgba(79,110,247,0.15)' : 'var(--border)', border: `1px solid ${dlState === 'done' ? '#34d39944' : dlState === 'loading' ? '#4f6ef744' : 'transparent'}` }}>
              {dlState === 'done'
                ? <CheckCircle size={18} style={{ color: 'var(--green)' }} />
                : <motion.div animate={dlState === 'loading' ? { rotate: 360 } : {}} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                    <Download size={18} style={{ color: dlState === 'loading' ? 'var(--accent)' : K.sub }} />
                  </motion.div>
              }
            </button>
          </div>

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

/* -- Hero banner ------------------------------------------- */
const Hero = ({ movie, onPlay, onInfo }: { movie: Movie; onPlay: () => void; onInfo: () => void }) => {
  const [c1, c2] = grad(movie.id);
  return (
    <div className="relative overflow-hidden rounded-2xl mx-3 mt-3 mb-5" style={{ height: 230 }}>
      {movie.coverUrl
        ? <img src={movie.coverUrl} alt="" className="w-full h-full object-cover" />
        : <div className="w-full h-full" style={{ background: `linear-gradient(160deg,${c1},${c2})` }} />}
      {/* left-heavy overlay like Kinopoisk */}
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
          {movie.duration && <span className="text-xs" style={{ color: K.sub }}>· {movie.duration}</span>}
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

/* -- Horizontal row ---------------------------------------- */
const Row = ({ title, Icon, movies, onSelect }: {
  title: string; Icon: IconComponent;
  movies: Movie[]; onSelect: (m: Movie) => void;
}) => {
  if (!movies.length) return null;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 px-3 mb-3">
        <Icon size={15} style={{ color: K.orange }} />
        <h3 className="text-[15px] font-bold" style={{ color: K.text }}>{title}</h3>
      </div>
      <div className="flex gap-3 px-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {movies.map(m => (
          <div key={m.id} className="shrink-0" style={{ width: 110 }}>
            <motion.div whileHover={{ scale: 1.04, y: -4 }} whileTap={{ scale: 0.97 }}
              className="cursor-pointer" onClick={() => onSelect(m)}>
              <PosterFill movie={m} />
            </motion.div>
            <p className="mt-1.5 text-xs font-medium truncate leading-tight px-0.5" style={{ color: K.text }}>{m.title}</p>
            {m.rating != null && (
              <div className="flex items-center gap-0.5 px-0.5 mt-0.5">
                <Star size={9} fill={K.gold} style={{ color: K.gold }} />
                <span className="text-[10px] font-bold tabular-nums" style={{ color: K.gold }}>{m.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

/* -- Catalog grid ------------------------------------------ */
const Grid = ({ movies, onSelect }: { movies: Movie[]; onSelect: (m: Movie) => void }) => {
  const { isBlocked } = useModerationStore();
  return (
  <div className="grid gap-x-3 gap-y-5 px-3 pb-4"
    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))' }}>
    {movies.map((m, i) => (
      <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.03 }} className="flex flex-col">
        <motion.div whileHover={{ scale: 1.04, y: -4 }} whileTap={{ scale: 0.97 }}
          className="relative cursor-pointer w-full" onClick={() => onSelect(m)}>
          {isBlocked('movie', m.id) ? (
            <div className="grid aspect-[2/3] w-full place-items-center rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <span className="px-1 text-center text-[9px] font-semibold" style={{ color: '#ef4444' }}>Заблокировано модерацией</span>
            </div>
          ) : (
          <>
          <PosterFill movie={m} />
          {((m as any).explicit || (m as any).ageRestricted18) && (
            <div className="absolute right-1 top-1 flex gap-1">
              {(m as any).ageRestricted18 && (
                <span className="rounded px-1 py-0.5 text-[8px] font-black text-white" style={{ background:'rgba(239,68,68,0.85)' }}>18+</span>
              )}
              {(m as any).explicit && (
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

/* ===========================================================
   SkyFilm  -  main
=========================================================== */
/* -- Личная загрузка видео --------------------------------- */
const UploadTab = () => {
  const { addMovie, movies, deleteMovie } = usePlatformStore();
  const { currentUserId } = useAuthStore();
  const [vFile, setVFile]     = useState<File|null>(null);
  const [cover, setCover]     = useState<string|undefined>();
  const [title, setTitle]     = useState('');
  const [desc,  setDesc]      = useState('');
  const [cat,   setCat]       = useState('Другое');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const vRef   = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const mine   = movies.filter(m => (m as any).uploadedBy === currentUserId);

  const toDur = (s: number) => {
    if (!isFinite(s)||s<=0) return '0:00';
    const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);
    return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;
  };

  const submit = async () => {
    if (!vFile || !title.trim()) return;
    setLoading(true); setProgress(20);
    const url = URL.createObjectURL(vFile);
    const dur = await new Promise<number>(r => {
      const v = document.createElement('video'); v.preload='metadata';
      v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); r(v.duration); };
      v.onerror = () => { URL.revokeObjectURL(v.src); r(0); }; v.src = url;
    });
    setProgress(60);
    addMovie({
      title: title.trim(), category: cat.trim()||'Другое',
      description: desc.trim()||undefined, coverUrl: cover,
      duration: toDur(dur), premium: false,
      sourceUrl: URL.createObjectURL(vFile),
      fileName: vFile.name, mimeType: vFile.type, bytes: vFile.size,
      ...(({ uploadedBy: currentUserId }) as any),
    });
    setProgress(100);
    setVFile(null); setCover(undefined); setTitle(''); setDesc(''); setCat('Другое');
    setTimeout(() => { setLoading(false); setProgress(0); }, 500);
  };

  const iSty = { background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color: K.text };
  const iCls = 'w-full rounded-2xl px-4 py-2.5 text-sm outline-none';

  return (
    <div className="h-full overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>
      {/* Upload form */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: K.card, border: `1px solid ${K.border}` }}>
        <p className="text-sm font-bold" style={{ color: K.text }}>Загрузить видео</p>
        {/* File drop */}
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-2xl py-6 cursor-pointer transition-colors"
          style={{ background: vFile ? 'rgba(255,85,0,0.07)' : 'rgba(255,255,255,0.03)', border: `2px dashed ${vFile ? K.orange : 'rgba(255,255,255,0.1)'}` }}
          onClick={() => vRef.current?.click()}>
          <input ref={vRef} type="file" accept="video/*" className="hidden"
            onChange={e => { const f=e.target.files?.[0]; if(f){setVFile(f);if(!title)setTitle(f.name.replace(/\.[^.]+$/,''));} }} />
          <Film size={28} style={{ color: vFile ? K.orange : K.dim }} />
          <p className="text-sm font-medium" style={{ color: vFile ? K.orange : K.sub }}>
            {vFile ? vFile.name : 'Выбрать видеофайл'}
          </p>
          <p className="text-xs" style={{ color: K.dim }}>MP4 · MKV · AVI · MOV · WebM</p>
        </div>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название *" className={iCls} style={iSty}/>
        <input value={cat} onChange={e=>setCat(e.target.value)} placeholder="Жанр (Фантастика, Комедия...)" className={iCls} style={iSty}/>
        <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание (необязательно)" rows={3}
          className={iCls+' resize-none'} style={iSty}/>
        {/* Cover */}
        <div className="flex items-center gap-3">
          <input ref={imgRef} type="file" accept="image/*" className="hidden"
            onChange={async e=>{ const f=e.target.files?.[0]; if(f){const r=new FileReader();r.onload=()=>setCover(r.result as string);r.readAsDataURL(f);} }}/>
          <button type="button" onClick={() => imgRef.current?.click()}
            className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition-colors"
            style={{ background:'var(--border)', border:'1px solid rgba(255,255,255,0.1)', color: K.sub }}>
            <ImageIcon size={14}/>{cover ? '✅ Постер' : 'Добавить постер'}
          </button>
          {cover && <img src={cover} alt="" className="h-10 w-16 rounded-xl object-cover"/>}
        </div>
        {loading && (
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background:'var(--border)' }}>
            <motion.div className="h-full rounded-full" transition={{ duration:0.3 }}
              style={{ width:`${progress}%`, background:`linear-gradient(90deg,${K.orange},${K.orange2})` }}/>
          </div>
        )}
        <motion.button whileTap={{ scale:0.97 }} type="button" onClick={submit}
          disabled={loading||!vFile||!title.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
          style={{ background: K.orange }}>
          <Plus size={15}/>{loading ? `${progress}%...` : 'Добавить фильм'}
        </motion.button>
      </div>

      {/* My uploads */}
      {mine.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: K.dim }}>
            Мои видео · {mine.length}
          </p>
          {mine.map(m => (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl p-3"
              style={{ background: K.card, border:`1px solid ${K.border}` }}>
              <div className="h-12 w-20 shrink-0 rounded-xl overflow-hidden"
                style={{ background:`linear-gradient(135deg,${grad(m.id)[0]},${grad(m.id)[1]})` }}>
                {m.coverUrl ? <img src={m.coverUrl} alt="" className="w-full h-full object-cover"/> : null}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: K.text }}>{m.title}</p>
                <p className="text-xs" style={{ color: K.dim }}>{m.category} · {m.duration}</p>
              </div>
              <button type="button" onClick={() => deleteMovie(m.id)}
                className="grid h-8 w-8 place-items-center rounded-full hover:bg-red-500/10">
                <X size={14} style={{ color:'var(--red)' }}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

type Tab = 'home' | 'catalog' | 'saved' | 'upload' | 'publish';

/* -- Публикация в общий доступ -----------------------------------
   Отдельно от "Моё" (личная оффлайн-загрузка для просмотра без
   интернета) — сюда фильм публикуется в общий каталог экосистемы,
   с выбором лицензии (открытая/личная) и обязательными пометками.
--------------------------------------------------------------- */
const PublishTab = () => {
  const { addMovie, movies, deleteMovie } = usePlatformStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);

  const [gateOk, setGateOk] = useState(false);
  const [vFile, setVFile]   = useState<File|null>(null);
  const [cover, setCover]   = useState<string|undefined>();
  const [title, setTitle]   = useState('');
  const [desc,  setDesc]    = useState('');
  const [cat,   setCat]     = useState('Другое');
  const [license, setLicense] = useState<'open'|'personal'>('open');
  const [explicit, setExplicit] = useState(false);
  const [ageRestricted18, setAgeRestricted18] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const mine = movies.filter(m => (m as any).uploadedBy === currentUserId && (m as any).license);

  const submit = async () => {
    if (!vFile || !title.trim() || (license === 'open' && !agreed)) return;
    setLoading(true); setProgress(20);
    const url = URL.createObjectURL(vFile);
    const dur = await new Promise<number>(r => {
      const v = document.createElement('video'); v.preload='metadata';
      v.onloadedmetadata = () => { URL.revokeObjectURL(v.src); r(v.duration); };
      v.onerror = () => { URL.revokeObjectURL(v.src); r(0); }; v.src = url;
    });
    setProgress(60);
    addMovie({
      title: title.trim(), category: cat.trim()||'Другое',
      description: desc.trim()||undefined, coverUrl: cover,
      duration: toDur(dur), premium: false,
      sourceUrl: URL.createObjectURL(vFile),
      fileName: vFile.name, mimeType: vFile.type, bytes: vFile.size,
      license, explicit, ageRestricted18: license === 'open' ? ageRestricted18 : false,
      ...(({ uploadedBy: currentUserId, uploaderName: me?.name ?? 'Пользователь' }) as any),
    });
    setProgress(100);
    setVFile(null); setCover(undefined); setTitle(''); setDesc(''); setCat('Другое');
    setLicense('open'); setExplicit(false); setAgeRestricted18(false); setAgreed(false);
    setTimeout(() => { setLoading(false); setProgress(0); }, 500);
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

      <input type="file" accept="video/*" id="pub-video" className="hidden"
        onChange={e => setVFile(e.target.files?.[0] ?? null)} />
      <label htmlFor="pub-video" className="flex items-center gap-3 rounded-2xl p-4" style={{ background:'rgba(255,255,255,0.04)', border: vFile ? `1px solid ${K.orange}` : '1px dashed var(--border)' }}>
        <Upload size={18} style={{ color: vFile ? K.orange : K.dim }}/>
        <span className="min-w-0 flex-1 truncate text-sm" style={{ color: vFile ? K.text : K.sub }}>
          {vFile ? vFile.name : 'Выбрать видеофайл'}
        </span>
      </label>

      <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Название фильма"
        className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={{ background:'rgba(255,255,255,0.04)', color:K.text }}/>
      <textarea value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Описание" rows={2}
        className="w-full resize-none rounded-2xl px-4 py-3 text-sm outline-none" style={{ background:'rgba(255,255,255,0.04)', color:K.text }}/>
      <input value={cat} onChange={e=>setCat(e.target.value)} placeholder="Категория/жанр"
        className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={{ background:'rgba(255,255,255,0.04)', color:K.text }}/>

      {/* Лицензия публикации */}
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
            <input type="checkbox" checked={ageRestricted18} onChange={e=>setAgeRestricted18(e.target.checked)}/>
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

      {loading && (
        <div className="h-1.5 overflow-hidden rounded-full" style={{ background:'var(--border)' }}>
          <motion.div className="h-full rounded-full" transition={{ duration:0.3 }}
            style={{ width:`${progress}%`, background:`linear-gradient(90deg,${K.orange},${K.orange2})` }}/>
        </div>
      )}

      <motion.button whileTap={{ scale:0.97 }} type="button" onClick={submit}
        disabled={loading||!vFile||!title.trim()||(license==='open'&&!agreed)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white disabled:opacity-40"
        style={{ background: K.orange }}>
        <Cloud size={15}/>{loading ? `${progress}%...` : 'Опубликовать в общий доступ'}
      </motion.button>

      {mine.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: K.dim }}>Мои публикации · {mine.length}</p>
          {mine.map(m => (
            <div key={m.id} className="flex items-center gap-2.5 rounded-2xl p-2.5" style={{ background:'rgba(255,255,255,0.04)' }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-[13px] font-semibold" style={{ color: K.text }}>{m.title}</p>
                  {(m as any).explicit && <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-black" style={{ background:'rgba(255,255,255,0.1)', color:K.sub }}>E</span>}
                  {(m as any).ageRestricted18 && <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-black" style={{ background:'rgba(239,68,68,0.15)', color:'#ef4444' }}>18+</span>}
                </div>
                <p className="flex items-center gap-1 truncate text-[10.5px]" style={{ color: K.sub }}>
                  {(m as any).license === 'open' ? <><Cloud size={10}/>Открытая лицензия</> : <><ShieldCheck size={10} style={{color:'#22c55e'}}/>Личная лицензия</>}
                  {' · загрузил '}{(m as any).uploaderName ?? me?.name}
                </p>
              </div>
              <button type="button" onClick={() => deleteMovie(m.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-red-500/10">
                <X size={14} style={{ color:'var(--red)' }}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* -- Prime Gate -------------------------------------------------
   Показывается вместо контента если нет Prime подписки
--------------------------------------------------------------- */
const PrimeGate = ({ service }: { service: 'music' | 'film' }) => {
  const PLANS = [
    { days:30,  label:'1 месяц', price:'400 ₽' },
    { days:365, label:'1 год',   price:'3 790 ₽', popular:true },
    { days:730, label:'2 года',  price:'6 990 ₽' },
  ];
  const PRICES: Record<number, number> = { 30:400, 365:3790, 730:6990 };
  const { accounts, currentUserId, grantPrime } = useAuthStore();
  const { grantPrime: grantPlatformPrime } = usePlatformStore();
  const { spend, getBalance } = useMoney();
  const balance = getBalance(currentUserId ?? '');
  const [chosen, setChosen] = useState(365);
  const [err,    setErr]    = useState('');
  const [done,   setDone]   = useState(false);

  const price  = PRICES[chosen];
  const planLb = PLANS.find(p => p.days === chosen)?.label ?? '';

  const [showCheckout, setShowCheckout] = useState(false);

  const buy = () => {
    setErr('');
    // Try wallet first
    const ok = spend(currentUserId!, price, 'prime', `Sky Prime  -  ${planLb}`);
    if (ok) {
      grantPrime(currentUserId!, chosen);
      grantPlatformPrime(chosen);
      setDone(true);
    } else {
      // Not enough in wallet → open Sky Pay checkout
      setShowCheckout(true);
    }
  };

  if (showCheckout) {
    const purposeMap: Record<number, any> = { 30:'prime_month', 365:'prime_year', 730:'prime_2year' };
    return (
      <div style={{ height:'100%' }}>
        <SkyPayCheckout
          purpose={purposeMap[chosen] ?? 'prime_month'}
          amount={price}
          onSuccess={() => {
            grantPrime(currentUserId!, chosen);
            grantPlatformPrime(chosen);
            setDone(true);
          }}
          onCancel={() => setShowCheckout(false)}
        />
      </div>
    );
  }

  const icon  = service === 'music' ? '🎵' : '🎬';
  const label = service === 'music' ? 'Sky Music' : 'Sky Film';

  if (done) return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:20 }}
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)', boxShadow:'0 12px 40px rgba(245,158,11,0.4)' }}>
        <span style={{ fontSize:36 }}>👑</span>
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-black text-white">Sky Prime активен!</p>
        <p className="text-sm mt-2" style={{ color:'var(--t2)' }}>
          Добро пожаловать в {label}
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col items-center justify-center h-full px-5 py-6 gap-5">
      {/* Icon */}
      <div className="relative">
        <div className="grid h-20 w-20 place-items-center rounded-3xl text-4xl"
          style={{ background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)' }}>
          {icon}
        </div>
        <div className="absolute -top-2 -right-2 grid h-8 w-8 place-items-center rounded-full"
          style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
          <Crown size={14} className="text-white"/>
        </div>
      </div>

      {/* Title */}
      <div className="text-center">
        <p className="text-xl font-black text-white">{label}  -  только для Prime</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color:'var(--t2)', maxWidth:300 }}>
          {service === 'music'
            ? 'Полный каталог музыки, загрузка треков и офлайн-режим доступны с подпиской Sky Prime.'
            : 'Вся кинотека, 4K качество и совместный просмотр доступны с подпиской Sky Prime.'}
        </p>
      </div>

      {/* Plans */}
      <div className="w-full space-y-2.5 max-w-xs">
        {PLANS.map(plan => (
          <motion.button key={plan.days} type="button"
            whileTap={{ scale:0.97 }}
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

      {/* Balance */}
      <div className="w-full max-w-xs rounded-2xl px-4 py-2.5 flex items-center justify-between"
        style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
        <span className="text-xs" style={{ color:'var(--t3)' }}>Баланс SkyMoney</span>
        <span className="text-sm font-bold" style={{ color: balance >= price ? 'var(--green)' : 'var(--red)' }}>
          {balance.toLocaleString('ru')} ₽
        </span>
      </div>

      {err && (
        <motion.p initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }}
          className="text-xs text-center leading-relaxed" style={{ color:'var(--red)', maxWidth:280 }}>
          {err}
        </motion.p>
      )}

      {/* CTA */}
      <motion.button whileTap={{ scale:0.97 }} type="button" onClick={buy}
        className="w-full max-w-xs rounded-2xl py-4 text-sm font-bold text-white"
        style={{ background:'linear-gradient(135deg,#f59e0b,#fbbf24)', boxShadow:'0 8px 28px rgba(245,158,11,0.35)' }}>
        👑 Оформить Prime за {PRICES[chosen].toLocaleString('ru')} ₽
      </motion.button>

      <p className="text-xs text-center" style={{ color:'var(--t3)' }}>
        Списывается с баланса SkyMoney · Нет рекламы · Отменить в любой момент
      </p>
    </div>
  );
};

export const SkyFilm = () => {
  const { movies } = usePlatformStore();
  const { accounts, currentUserId: filmUid } = useAuthStore();
  const filmMe = accounts.find(a => a.id === filmUid);
  const isPrime = filmMe?.isPrime ?? false;
  const [tab,       setTab]       = useState<Tab>('home');
  const [playing,   setPlaying]   = useState<Movie | null>(null);
  const [detail,    setDetail]    = useState<Movie | null>(null);
  const [category,  setCategory]  = useState('Все');
  const [search,    setSearch]    = useState('');
  const [showSrch,  setShowSrch]  = useState(false);
  const [saved,     setSaved]     = useState<string[]>([]);

  const toggleSave = (id: string) => setSaved(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const cats = useMemo(() => [...new Set(movies.map(m => m.category))], [movies]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return movies.filter(m => {
      const mq = !q || m.title.toLowerCase().includes(q) || (m.genre ?? '').toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
      const mc = category === 'Все' || m.category === category;
      return mq && mc;
    });
  }, [movies, search, category]);

  const topRated   = useMemo(() => [...movies].sort((a,b) => (b.rating??0)-(a.rating??0)).slice(0,10), [movies]);
  const fresh      = useMemo(() => [...movies].sort((a,b) => b.addedAt.localeCompare(a.addedAt)).slice(0,10), [movies]);
  const savedMovies = useMemo(() => movies.filter(m => saved.includes(m.id)), [movies, saved]);
  const shortMovies = useMemo(() => movies.filter(m => m.isShort), [movies]);
  const [shortsStartId, setShortsStartId] = useState<string | null>(null);
  const hero = topRated[0];

  const NAV: { key: Tab; Icon: React.FC<any>; label: string }[] = [
    { key: 'home',    Icon: Tv,       label: 'Главная'  },
    { key: 'catalog', Icon: Layers,   label: 'Каталог'  },
    { key: 'saved',   Icon: Bookmark, label: 'Закладки' },
    { key: 'upload',  Icon: Upload,   label: 'Моё'      },
    { key: 'publish', Icon: Cloud,    label: 'Опубликовать' },
  ];

  if (!isPrime) return <PrimeGate service="film"/>;

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

        {/* -- Контент ------------------------------------------ */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

          {/* search overlay */}
          {showSrch && search ? (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <p className="px-3 py-2 text-xs font-semibold" style={{ color: K.sub }}>
                Результаты · {filtered.length}
              </p>
              <Grid movies={filtered} onSelect={m => { setDetail(m); setShowSrch(false); }} />
              {!filtered.length && (
                <div className="flex flex-col items-center gap-2 py-16">
                  <Film size={38} style={{ color: K.dim }} />
                  <p className="text-sm" style={{ color: K.sub }}>Ничего не найдено</p>
                </div>
              )}
            </div>

          ) : tab === 'home' ? (
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              {hero && (
                <Hero movie={hero}
                  onPlay={() => setPlaying(hero)}
                  onInfo={() => setDetail(hero)} />
              )}
              {shortMovies.length > 0 && (
                <button type="button" onClick={() => setShortsStartId(shortMovies[0].id)}
                  className="mx-3 mt-3 mb-1 flex items-center gap-3 rounded-2xl px-4 py-3.5 w-[calc(100%-24px)]"
                  style={{ background: `linear-gradient(135deg,${K.orange}22,${K.card2})`, border: `1px solid ${K.orange}33` }}>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: K.orange }}>
                    <Zap size={18} color="#fff" fill="#fff"/>
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-bold" style={{ color: K.text }}>Короткое кино</p>
                    <p className="text-[11px]" style={{ color: K.sub }}>Вертикальные короткометражки · свайп вверх</p>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: K.orange, color: '#fff' }}>{shortMovies.length}</span>
                </button>
              )}
              <Row title="Топ по рейтингу" Icon={Award}      movies={topRated} onSelect={setDetail} />
              <Row title="Новинки"          Icon={TrendingUp} movies={fresh}    onSelect={setDetail} />
              <div className="h-4" />
            </div>

          ) : tab === 'catalog' ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* category chips */}
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

          ) : tab === 'upload' ? (
            /* upload */
            <div className="flex-1 overflow-hidden">
              <UploadTab />
            </div>
          ) : tab === 'publish' ? (
            /* публикация в общий доступ */
            <div className="flex-1 overflow-hidden">
              <PublishTab />
            </div>
          ) : (
            /* saved */
            <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
              <p className="px-3 pt-3 pb-2 text-base font-bold" style={{ color: K.text }}>
                Закладки · {savedMovies.length}
              </p>
              {savedMovies.length > 0
                ? <Grid movies={savedMovies} onSelect={setDetail} />
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
          {NAV.map(({ key, Icon, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className="flex flex-col items-center gap-0.5 px-6 py-1.5 transition-colors"
              style={{ color: tab === key ? K.orange : K.dim }}>
              <Icon size={21} />
              <span className="text-[9px] font-semibold">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Detail sheet */}
      <AnimatePresence>
        {detail && !playing && (
          <Detail movie={detail}
            onPlay={() => { setPlaying(detail); setDetail(null); }}
            onClose={() => setDetail(null)}
            saved={saved.includes(detail.id)}
            onSave={() => toggleSave(detail.id)} />
        )}
      </AnimatePresence>

      {/* Player */}
      <AnimatePresence>
        {playing && <Player movie={playing} onClose={() => setPlaying(null)} />}
      </AnimatePresence>

      {/* Shorts — вертикальное короткое кино */}
      <AnimatePresence>
        {shortsStartId && (
          <SkyShorts movies={shortMovies} startId={shortsStartId} saved={saved}
            onToggleSave={toggleSave} onClose={() => setShortsStartId(null)}/>
        )}
      </AnimatePresence>
    </>
  );
};
