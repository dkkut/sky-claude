/* ===========================================================
   SKY TV — Главная

   Каталог приходит с сервера — тот же, что и в приложении на телефоне.
   «Продолжить просмотр» тоже считает сервер: начатое на телефоне
   продолжается здесь с того же места, потому что позиция лежит не в
   памяти этого устройства, а в общей на всех записи.

   Личная коллекция сюда не попадает и не должна: телевизор стоит в
   комнате, где бывают и другие люди, а закрытое кино — закрытое.
=========================================================== */
import { useEffect, useMemo } from 'react';
import { TVHero } from './TVHero';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, fmtDuration, type ServerMovie } from '@/film/filmApi';

interface TVHomeProps {
  onOpenMovie: (id: string) => void;
  onPlayMovie: (id: string) => void;
}

const cover = (m: ServerMovie) => (m.hasPoster ? posterUrl(m.id) : undefined);

export const TVHome = ({ onOpenMovie, onPlayMovie }: TVHomeProps) => {
  const catalog = useFilmStore(s => s.catalog);
  const continueWatching = useFilmStore(s => s.continueWatching);
  const progress = useFilmStore(s => s.progress);
  const progressList = useFilmStore(s => s.progressList);
  const load = useFilmStore(s => s.load);
  const { lastFocusedId } = useTVRestoreState();

  useEffect(() => { void load(); }, [load]);

  const catalogMovies = useMemo(() => catalog.filter(m => !m.isShort), [catalog]);
  const hero = catalogMovies[0];
  const topRated = useMemo(
    () => [...catalogMovies].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 12),
    [catalogMovies]);
  const fresh = useMemo(
    () => [...catalogMovies].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')).slice(0, 12),
    [catalogMovies]);

  const byMap = useMemo(() => new Map(catalog.map(m => [m.id, m])), [catalog]);
  /* «Вы смотрели» — по записям позиций с сервера, в том порядке, в
     каком он их отдал: от самого свежего. */
  const watchedList = useMemo(
    () => progressList.map(p => byMap.get(p.movieId)).filter(Boolean) as ServerMovie[],
    [progressList, byMap]);

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
          <TVHero title={hero.title} description={hero.description} imageUrl={cover(hero)}
            rating={hero.rating} genre={hero.genre} year={hero.year}
            duration={hero.duration ? fmtDuration(hero.duration) : undefined}
            onWatch={() => onPlayMovie(hero.id)} onDetails={() => onOpenMovie(hero.id)}/>
        </div>
      )}

      {continueWatching.length > 0 && (
        <TVCarousel title="Продолжить просмотр" items={continueWatching} getId={m => m.id}
          rowAutoFocusPriority={hero ? undefined : 0}
          renderItem={(m, p) => (
            <TVCard id={`cw-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)}
              aspect="wide"
              progress={m.duration > 0 ? (progress[m.id] ?? m.position ?? 0) / m.duration : 0}
              onEnter={() => onPlayMovie(m.id)} autoFocusPriority={p}/>
          )}/>
      )}

      <TVCarousel title="Топ по рейтингу" items={topRated} getId={m => m.id}
        renderItem={(m, p) => (
          <TVCard id={`top-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)} rating={m.rating}
            onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
        )}/>

      <TVCarousel title="Новинки" items={fresh} getId={m => m.id}
        renderItem={(m, p) => (
          <TVCard id={`fresh-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)}
            onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
        )}/>

      {watchedList.length > 0 && (
        <TVCarousel title="Вы смотрели" items={watchedList} getId={m => m.id}
          renderItem={(m, p) => (
            <TVCard id={`watched-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)}
              onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
          )}/>
      )}
    </div>
  );
};
