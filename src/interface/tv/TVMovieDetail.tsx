/* ===========================================================
   SKY TV — страница фильма
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Play, Plus, Check, Star, RotateCcw } from 'lucide-react';
import { usePlatformStore, type Movie } from '@/platform/store';
import { TVFocusable } from './TVFocusable';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { getProgress } from './watchProgressStore';
import { useTVRestoreState } from './tvNavStore';

interface TVMovieDetailProps {
  movieId: string;
  onPlay: (id: string) => void;
  onOpenMovie: (id: string) => void;
}

export const TVMovieDetail = ({ movieId, onPlay, onOpenMovie }: TVMovieDetailProps) => {
  const movies = usePlatformStore(s => s.movies);
  const favorites = usePlatformStore(s => s.favorites);
  const toggleFavorite = usePlatformStore(s => s.toggleFavorite);
  const { lastFocusedId } = useTVRestoreState();

  const movie = movies.find(m => m.id === movieId);
  const isFav = movie ? favorites.includes(movie.id) : false;
  const progress = movie ? getProgress(movie.id) : null;
  const hasProgress = !!progress && progress.position / progress.duration < 0.92;

  const similar = useMemo(() => {
    if (!movie) return [];
    return movies.filter(m => m.id !== movie.id && !m.isShort && m.genre === movie.genre).slice(0, 12);
  }, [movies, movie]);

  const recommended = useMemo(() => {
    if (!movie) return [];
    return [...movies].filter(m => m.id !== movie.id && !m.isShort)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 12);
  }, [movies, movie]);

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, [movieId]);

  if (!movie) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Контент не найден</p>
      </div>
    );
  }

  return (
    <div className="pb-10">
      <div className="relative w-full overflow-hidden" style={{ height: '52vh', minHeight: 380 }}>
        <div className="absolute inset-0"
          style={{ background: movie.coverUrl ? `center/cover no-repeat url(${movie.coverUrl})` : 'linear-gradient(135deg,#242433,#0e0e14)' }}/>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(10,10,14,0.95) 0%, rgba(10,10,14,0.55) 55%, transparent 100%)' }}/>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, var(--bg) 0%, transparent 35%)' }}/>

        <div className="absolute inset-0 flex flex-col justify-end p-10 max-w-[55%]">
          <p className="text-[40px] font-extrabold leading-[1.05] mb-3 text-white">{movie.title}</p>
          <div className="flex items-center gap-3 mb-4 text-[15px] font-semibold flex-wrap" style={{ color: 'rgba(255,255,255,0.75)' }}>
            {movie.rating != null && <span className="flex items-center gap-1"><Star size={15} fill="#ffc93c" color="#ffc93c"/> {movie.rating.toFixed(1)}</span>}
            {movie.genre && <span>{movie.genre}</span>}
            {movie.year && <span>{movie.year}</span>}
            {movie.ageRating && <span className="rounded px-1.5 py-0.5 text-[12px]" style={{ background: 'rgba(255,255,255,0.15)' }}>{movie.ageRating}</span>}
            {movie.duration && <span>{movie.duration}</span>}
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
            <TVFocusable id="detail-fav" onEnter={() => toggleFavorite(movie.id)} autoFocusPriority={1}>
              {({ focused }) => (
                <div className="flex items-center gap-2 rounded-xl px-6 py-3 text-[16px] font-bold text-white" style={{ background: focused ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)', transform: focused ? 'scale(1.06)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none', transition: 'transform 0.16s' }}>
                  {isFav ? <><Check size={19}/> В избранном</> : <><Plus size={19}/> В избранное</>}
                </div>
              )}
            </TVFocusable>
          </div>
        </div>
      </div>

      <div className="px-10 pt-8">
        {similar.length > 0 && (
          <TVCarousel title="Похожие" items={similar} getId={m => m.id} rowAutoFocusPriority={2}
            renderItem={(m, p) => <TVCard id={`sim-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.coverUrl} rating={m.rating} onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>}/>
        )}
        {recommended.length > 0 && (
          <TVCarousel title="Вам может понравиться" items={recommended} getId={m => m.id}
            renderItem={(m, p) => <TVCard id={`rec-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.coverUrl} rating={m.rating} onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>}/>
        )}
      </div>
    </div>
  );
};
