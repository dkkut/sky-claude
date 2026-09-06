/* ===========================================================
   SKY TV — Главная
=========================================================== */
import { useEffect, useMemo } from 'react';
import { usePlatformStore, type Movie } from '@/platform/store';
import { TVHero } from './TVHero';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { getContinueWatching, getWatchHistory } from './watchProgressStore';
import { useTVRestoreState } from './tvNavStore';

interface TVHomeProps {
  onOpenMovie: (id: string) => void;
  onPlayMovie: (id: string) => void;
}

export const TVHome = ({ onOpenMovie, onPlayMovie }: TVHomeProps) => {
  const movies = usePlatformStore(s => s.movies);
  const { lastFocusedId } = useTVRestoreState();

  const catalogMovies = useMemo(() => movies.filter(m => !m.isShort), [movies]);
  const hero = catalogMovies[0];
  const topRated = useMemo(() => [...catalogMovies].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 12), [catalogMovies]);
  const fresh = useMemo(() => [...catalogMovies].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 12), [catalogMovies]);
  const byMap = useMemo(() => new Map(movies.map(m => [m.id, m])), [movies]);

  const continueList = useMemo(() =>
    getContinueWatching().map(({ movieId, entry }) => ({ movie: byMap.get(movieId), entry })).filter(x => x.movie) as { movie: Movie; entry: { position: number; duration: number } }[],
    [byMap]);
  const watchedList = useMemo(() =>
    getWatchHistory().map(({ movieId }) => byMap.get(movieId)).filter(Boolean) as Movie[],
    [byMap]);

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, []);

  if (catalogMovies.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Каталог пока пуст</p>
        <p className="text-sm" style={{ color: 'var(--t3)' }}>Контент появится здесь, как только будет добавлен</p>
      </div>
    );
  }

  return (
    <div className="px-10 pt-6 pb-10">
      {hero && (
        <div className="mb-10">
          <TVHero title={hero.title} description={hero.description} imageUrl={hero.coverUrl}
            rating={hero.rating} genre={hero.genre} year={hero.year} duration={hero.duration}
            onWatch={() => onPlayMovie(hero.id)} onDetails={() => onOpenMovie(hero.id)}/>
        </div>
      )}

      {continueList.length > 0 && (
        <TVCarousel title="Продолжить просмотр" items={continueList} getId={x => x.movie.id} rowAutoFocusPriority={hero ? undefined : 0}
          renderItem={({ movie, entry }, p) => (
            <TVCard id={`cw-${movie.id}`} title={movie.title} subtitle={movie.genre} imageUrl={movie.coverUrl}
              aspect="wide" progress={entry.position / entry.duration} onEnter={() => onPlayMovie(movie.id)} autoFocusPriority={p}/>
          )}/>
      )}

      <TVCarousel title="Топ по рейтингу" items={topRated} getId={m => m.id}
        renderItem={(m, p) => (
          <TVCard id={`top-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.coverUrl} rating={m.rating}
            onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
        )}/>

      <TVCarousel title="Новинки" items={fresh} getId={m => m.id}
        renderItem={(m, p) => (
          <TVCard id={`fresh-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.coverUrl} badge={m.premium ? 'Premium' : undefined}
            onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
        )}/>

      {watchedList.length > 0 && (
        <TVCarousel title="Вы смотрели" items={watchedList} getId={m => m.id}
          renderItem={(m, p) => (
            <TVCard id={`watched-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={m.coverUrl}
              onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
          )}/>
      )}
    </div>
  );
};
