/* ===========================================================
   SKY CAR — Кино и видео.
   Видео открыто ТОЛЬКО когда автомобиль стоит (driveLogic.ts): едет или состояние неизвестно — экран закрыт. Если автомобиль
   тронулся во время просмотра, картинка гаснет и видео ставится на паузу; можно продолжить слушать звук (как подкаст) или закрыть.
   Тот же поток и те же права, что и в остальном Sky Film / Sky Video: ничего не копируется, позиции просмотра идут на сервер.
=========================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, Play, Pause, RotateCcw, RotateCw, Headphones, X, Film as FilmIcon } from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { videoUrl, posterUrl, apiMovie, apiFilmTicket, type ServerMovie } from '@/film/filmApi';
import { apiSeriesCatalog, apiSeries, type ServerSeries, type SeriesFull } from '@/film/seriesApi';
import { useSkyVideoStore } from '@/video/serverStore';
import { videoUrl as skyVideoUrl, apiSkyVideoTicket } from '@/video/skyVideoApi';
import { reloadWithFreshTicket } from '@/core/mediaTicketRefresh';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR, CAR_ACCENT, fmtTime } from './carTheme';
import { useDriveWatch } from './driveState';
import { mayShowVideo } from './driveLogic';
import { CarWarningGate, DriveBadge, LockedNote } from './CarWarning';

type Playing = { kind: 'movie' | 'video'; id: string; title: string; start: number };

const Tile = ({ title, sub, poster, onClick }: { title: string; sub?: string; poster?: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-label={title} className="flex w-full items-center gap-5 rounded-3xl px-4 text-left outline-none transition active:scale-[0.985] focus-visible:ring-4 focus-visible:ring-violet-300" style={{ minHeight: 104 }}>
    <span className="h-[80px] w-[56px] shrink-0 overflow-hidden rounded-xl" style={{ background: poster ? `center/cover url(${poster})` : 'linear-gradient(160deg,#2b2440,#12101f)' }}>
      {!poster && <span className="grid h-full w-full place-items-center"><FilmIcon size={24} color="rgba(255,255,255,0.4)" /></span>}
    </span>
    <span className="min-w-0 flex-1"><span className="block truncate text-[26px] font-bold text-white" translate="no">{title}</span>{sub && <span className="block truncate text-[18px] text-white/55">{sub}</span>}</span>
  </button>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section><p className="mb-2 px-1 text-[18px] font-bold uppercase tracking-wide text-white/50">{title}</p>
    <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>{children}</div></section>
);

/** Плеер: большие кнопки; при движении автомобиля — только звук. */
export const CarVideoPlayer = ({ p, parked, onClose }: { p: Playing; parked: boolean; onClose: () => void }) => {
  const v = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [audioOnly, setAudioOnly] = useState(false);
  const tried = useRef(false);
  const lastSave = useRef(0);
  const saveProgress = useFilmStore((s) => s.saveProgress);
  const flushProgress = useFilmStore((s) => s.flushProgress);
  const src = p.kind === 'movie' ? videoUrl(p.id) : skyVideoUrl(p.id);
  const showPicture = parked && !audioOnly;

  // Автомобиль тронулся: картинка гаснет, видео на паузе. Продолжить можно только осознанно — «слушать звук».
  useEffect(() => { if (!parked && !audioOnly && v.current && !v.current.paused) { v.current.pause(); setPlaying(false); } }, [parked, audioOnly]);
  useEffect(() => { if (parked) setAudioOnly(false); }, [parked]);
  useEffect(() => () => { if (p.kind === 'movie' && lastSave.current > 5) void flushProgress(p.id, lastSave.current, v.current?.duration || 0); v.current?.pause(); }, [p.id, p.kind, flushProgress]);

  const toggle = () => {
    const el = v.current; if (!el) return;
    if (!parked && !audioOnly) return;                 // движение: запуск картинки запрещён
    if (el.paused) void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); else { el.pause(); setPlaying(false); }
  };
  const skip = (n: number) => { const el = v.current; if (el) el.currentTime = Math.max(0, Math.min(el.duration || 1e9, el.currentTime + n)); };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black" data-car-video data-picture={showPicture ? 'on' : 'off'}>
      <div className="relative min-h-0 flex-1">
        <video ref={v} src={src} playsInline preload="metadata" className="h-full w-full object-contain" style={{ visibility: showPicture ? 'visible' : 'hidden' }}
          onLoadedMetadata={() => { const el = v.current; if (el) { setDur(el.duration || 0); if (p.start > 30 && p.start < (el.duration || 1e9) - 60) el.currentTime = p.start; } }}
          onTimeUpdate={() => {
            const el = v.current; if (!el) return;
            setCur(el.currentTime); lastSave.current = el.currentTime;
            if (p.kind === 'movie') saveProgress(p.id, el.currentTime, el.duration || 0);
          }}
          onEnded={() => setPlaying(false)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => { const el = v.current; if (el && !tried.current) { tried.current = true; void reloadWithFreshTicket(el, p.kind === 'movie' ? apiFilmTicket : apiSkyVideoTicket, () => src); } }} />
        {!showPicture && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-10 text-center" style={{ background: 'rgba(7,7,15,0.97)' }} data-car-video-locked>
            <p className="text-[30px] font-extrabold text-white" translate="no">{p.title}</p>
            {!parked && !audioOnly ? (<>
              <p className="max-w-[760px] text-[26px] font-bold text-amber-300">Видео остановлено: автомобиль в движении или его состояние неизвестно.</p>
              <button type="button" onClick={() => { setAudioOnly(true); const el = v.current; if (el) void el.play().catch(() => setPlaying(false)); }} className="flex items-center gap-3 rounded-3xl px-10 text-[26px] font-bold text-white" style={{ minHeight: 88, background: CAR_ACCENT }}><Headphones size={32} /> Слушать только звук</button>
            </>) : <p className="text-[24px] text-white/70">Идёт только звук. Картинка вернётся, когда автомобиль остановится.</p>}
          </div>)}
      </div>
      <div className="flex items-center gap-4 px-6 py-4" style={{ background: 'rgba(8,8,22,0.92)' }}>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-[84px] w-[84px] place-items-center rounded-3xl" style={{ background: CAR_GLASS }}><X size={36} color="#fff" /></button>
        <button type="button" onClick={() => skip(-30)} aria-label="Назад на 30 секунд" className="grid h-[84px] w-[84px] place-items-center rounded-3xl" style={{ background: CAR_GLASS }}><RotateCcw size={34} color="#fff" /></button>
        <button type="button" onClick={toggle} aria-label={playing ? 'Пауза' : 'Играть'} disabled={!parked && !audioOnly} className="grid h-[104px] w-[104px] place-items-center rounded-full disabled:opacity-40" style={{ background: CAR_ACCENT }}>{playing ? <Pause size={46} color="#fff" fill="#fff" /> : <Play size={46} color="#fff" fill="#fff" />}</button>
        <button type="button" onClick={() => skip(30)} aria-label="Вперёд на 30 секунд" className="grid h-[84px] w-[84px] place-items-center rounded-3xl" style={{ background: CAR_GLASS }}><RotateCw size={34} color="#fff" /></button>
        <span className="ml-auto text-[24px] tabular-nums text-white/80" translate="no">{fmtTime(cur)} / {fmtTime(dur)}</span>
      </div>
    </div>
  );
};

const SeriesList = ({ s, onPlay, onBack }: { s: ServerSeries; onPlay: (m: ServerMovie) => void; onBack: () => void }) => {
  const [full, setFull] = useState<SeriesFull | null>(null);
  useEffect(() => { void apiSeries(s.id).then(setFull); }, [s.id]);
  return (
    <div className="h-full overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-2 text-[22px] font-bold text-white/80" style={{ minHeight: 72 }}><ChevronLeft size={30} /> Назад</button>
      <p className="mb-3 text-[32px] font-extrabold text-white" translate="no">{s.title}</p>
      {full?.seasons.map((se) => (
        <Section key={se.id} title={se.title ? `${se.number}. ${se.title}` : `Сезон ${se.number}`}>
          {se.episodes.map((e) => <Tile key={e.id} title={`${e.epNo}. ${e.title}`} sub={e.position ? `Остановились на ${fmtTime(e.position)}` : undefined} onClick={() => onPlay(e)} />)}
        </Section>))}
    </div>
  );
};

const Inner = () => {
  const drive = useDriveWatch();
  const parked = mayShowVideo(drive.state);
  const catalog = useFilmStore((s) => s.catalog);
  const cont = useFilmStore((s) => s.continueWatching);
  const loadFilm = useFilmStore((s) => s.load);
  const needsPrime = useFilmStore((s) => s.needsPrime);
  const feed = useSkyVideoStore((s) => s.feed);
  const loadVideo = useSkyVideoStore((s) => s.load);
  const [series, setSeries] = useState<ServerSeries[]>([]);
  const [openSeries, setOpenSeries] = useState<ServerSeries | null>(null);
  const [now, setNow] = useState<Playing | null>(null);

  useEffect(() => { void loadFilm(); void loadVideo(); void apiSeriesCatalog().then((r) => r && setSeries(r)); }, [loadFilm, loadVideo]);
  const playMovie = useCallback((m: ServerMovie) => setNow({ kind: 'movie', id: m.id, title: m.title, start: m.position ?? 0 }), []);
  const resume = async (m: ServerMovie) => playMovie((await apiMovie(m.id)) ?? m);

  if (now) return <CarVideoPlayer p={now} parked={parked} onClose={() => setNow(null)} />;
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between"><p className="text-[32px] font-extrabold text-white">Кино и видео</p><DriveBadge state={drive.state} /></div>
      {needsPrime ? <p className="text-[24px] text-white/70">Кино входит в Sky Prime. Оформите подписку с телефона.</p> : !parked ? <LockedNote state={drive.state === 'driving' ? 'driving' : 'unknown'} what="Кино и видео" /> : openSeries ? (
        <SeriesList s={openSeries} onPlay={playMovie} onBack={() => setOpenSeries(null)} />
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1" style={{ scrollbarWidth: 'none' }}>
          {cont.length > 0 && <Section title="Продолжить">{cont.slice(0, 6).map((m) => <Tile key={m.id} title={m.title} sub={m.position ? `Остановились на ${fmtTime(m.position)}` : undefined} poster={m.hasPoster ? posterUrl(m.id) : undefined} onClick={() => void resume(m)} />)}</Section>}
          {series.length > 0 && <Section title="Сериалы">{series.map((s) => <Tile key={s.id} title={s.title} sub={`${s.seasons} сез. · ${s.episodes} сер.`} poster={s.posterMovieId ? posterUrl(s.posterMovieId) : undefined} onClick={() => setOpenSeries(s)} />)}</Section>}
          <Section title="Кино">{catalog.slice(0, 30).map((m) => <Tile key={m.id} title={m.title} sub={m.year ? String(m.year) : undefined} poster={m.hasPoster ? posterUrl(m.id) : undefined} onClick={() => playMovie(m)} />)}{!catalog.length && <p className="p-4 text-[20px] text-white/50">Каталог пуст</p>}</Section>
          <Section title="Видео">{feed.slice(0, 20).map((vd) => <Tile key={vd.id} title={vd.title} sub={vd.authorName} onClick={() => setNow({ kind: 'video', id: vd.id, title: vd.title, start: 0 })} />)}{!feed.length && <p className="p-4 text-[20px] text-white/50">Пока ничего нет</p>}</Section>
        </div>)}
    </div>
  );
};

export const CarCinema = () => <CarWarningGate><Inner /></CarWarningGate>;
