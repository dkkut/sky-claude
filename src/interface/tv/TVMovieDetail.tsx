/* ===========================================================
   SKY TV — страница фильма

   Кино и закладки берутся с сервера. Кнопка «В избранное» раньше
   клала идентификатор фильма в список избранной музыки — эти два
   списка в общем сторе жили под одним именем. Теперь это закладки
   кино, те же самые, что и в приложении на телефоне.
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Play, Plus, Check, Star, RotateCcw } from 'lucide-react';
import { TVFocusable } from './TVFocusable';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, fmtDuration, type ServerMovie } from '@/film/filmApi';

interface TVMovieDetailProps {
  movieId: string;
  onPlay: (id: string) => void;
  onOpenMovie: (id: string) => void;
}

const cover = (m: ServerMovie) => (m.hasPoster ? posterUrl(m.id) : undefined);

export const TVMovieDetail = ({ movieId, onPlay, onOpenMovie }: TVMovieDetailProps) => {
  const catalog = useFilmStore(s => s.catalog);
  const saved = useFilmStore(s => s.saved);
  const progress = useFilmStore(s => s.progress);
  const toggleSaved = useFilmStore(s => s.toggleSaved);
  const load = useFilmStore(s => s.load);
  const { lastFocusedId } = useTVRestoreState();

  useEffect(() => { void load(); }, [load]);

  const movie = catalog.find(m => m.id === movieId);
  const isSaved = saved.some(m => m.id === movieId);
  const position = progress[movieId] ?? movie?.position ?? 0;
  const hasProgress = Boolean(movie && position > 30 && (!movie.duration || position < movie.duration - 60));

  const similar = useMemo(() => {
    if (!movie) return [];
    return catalog.filter(m => m.id !== movie.id && !m.isShort && m.genre === movie.genre).slice(0, 12);
  }, [catalog, movie]);

  const recommended = useMemo(() => {
    if (!movie) return [];
    return [...catalog].filter(m => m.id !== movie.id && !m.isShort)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 12);
  }, [catalog, movie]);

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, [movieId]);

  if (!movie) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Контент не найден</p>
      </div>
    );
  }

  const poster = cover(movie);

  return (
    <div className="pb-10">
      <div className="relative w-full overflow-hidden" style={{ height: '52vh', minHeight: 380 }}>
        <div className="absolute inset-0"
          style={{ background: poster ? `center/cover no-repeat url(${poster})` : 'linear-gradient(135deg,#242433,#0e0e14)' }}/>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(10,10,14,0.95) 0%, rgba(10,10,14,0.55) 55%, transparent 100%)' }}/>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, var(--bg) 0%, transparent 35%)' }}/>

        <div className="absolute inset-0 flex flex-col justify-end p-10 max-w-[55%]">
          <p className="text-[40px] font-extrabold leading-[1.05] mb-3 text-white">{movie.title}</p>
          <div className="flex items-center gap-3 mb-4 text-[15px] font-semibold flex-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {movie.rating != null && <span className="flex items-center gap-1"><Star size={15} fill="#ffc93c" color="#ffc93c"/> {movie.rating.toFixed(1)}</span>}
            {movie.genre && <span>{movie.genre}</span>}
            {movie.year && <span>{movie.year}</span>}
            {movie.ageRating && <span className="rounded px-1.5 py-0.5 text-[12px]" style={{ background: 'rgba(255,255,255,0.15)' }}>{movie.ageRating}</span>}
            {movie.duration > 0 && <span>{fmtDuration(movie.duration)}</span>}
          </div>
          {movie.description && <p className="text-[15px] leading-snug mb-6 max-w-[520px]" style={{ color: 'rgba(255,255,255,0.65)' }}>{movie.description}</p>}

          <div className="flex items-center gap-3">
            <TVFocusable id="detail-watch" onEnter={() => onPlay(movie.id)} autoFocusPriority={0}>
              {({ focused }) => (
                <div className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-bold" style={{ background: '#fff', color: '#0a0a0e', transform: focused ? 'scale(1.06)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none', transition: 'transform 0.16s' }}>
                  {hasProgress ? <><RotateCcw size={19}/> Продолжить</> : <><Play size={20} fill="#0a0a0e"/> Смотреть</>}
                </div>
              )}
            </TVFocusable>
            <TVFocusable id="detail-fav" onEnter={() => void toggleSaved(movie.id)} autoFocusPriority={1}>
              {({ focused }) => (
                <div className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-bold text-white" style={{ background: focused ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)', transform: focused ? 'scale(1.06)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none', transition: 'transform 0.16s' }}>
                  {isSaved ? <><Check size={19}/> В закладках</> : <><Plus size={19}/> В закладки</>}
                </div>
              )}
            </TVFocusable>
          </div>
        </div>
      </div>

      <div className="px-10 pt-8">
        {similar.length > 0 && (
          <TVCarousel title="Похожие" items={similar} getId={m => m.id} rowAutoFocusPriority={2}
            renderItem={(m, p) => <TVCard id={`sim-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)} rating={m.rating} onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>}/>
        )}
        {recommended.length > 0 && (
          <TVCarousel title="Вам может понравиться" items={recommended} getId={m => m.id}
            renderItem={(m, p) => <TVCard id={`rec-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)} rating={m.rating} onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>}/>
        )}
      </div>
    </div>
  );
};
