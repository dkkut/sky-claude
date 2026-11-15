/* ===========================================================
   SKY TV — Главная

   Каталог приходит с сервера — тот же, что и в приложении на телефоне.
   «Продолжить просмотр» тоже считает сервер: начатое на телефоне
   продолжается здесь с того же места, потому что позиция лежит не в
   памяти этого устройства, а в общей на всех записи.

   Личная коллекция сюда не попадает и не должна: телевизор стоит в
   комнате, где бывают и другие люди, а закрытое кино — закрытое.
=========================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Film, Clapperboard, Tv2, Music2, Play, Mic2, Bookmark, type LucideIcon } from 'lucide-react';
import { TVFocusable } from './TVFocusable';
import type { NavKind } from './TVSidebar';
import { TVHero } from './TVHero';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager, useTVFocusedId } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, fmtDuration, type ServerMovie } from '@/film/filmApi';

interface TVHomeProps {
  onOpenMovie: (id: string) => void;
  onPlayMovie: (id: string) => void;
  /** Переход в раздел (чипы под афишей). */
  onNavigate?: (k: NavKind) => void;
}

const CHIPS: { k: NavKind; label: string; icon: LucideIcon }[] = [
  { k: 'movies', label: 'Фильмы', icon: Film },
  { k: 'series', label: 'Сериалы', icon: Clapperboard },
  { k: 'channels', label: 'Телеканалы', icon: Tv2 },
  { k: 'music', label: 'Sky Music', icon: Music2 },
  { k: 'video', label: 'SkyVideo', icon: Play },
  { k: 'podcasts', label: 'Подкасты', icon: Mic2 },
  { k: 'collection', label: 'Моя коллекция', icon: Bookmark },
];

const cover = (m: ServerMovie) => (m.hasPoster ? posterUrl(m.id) : undefined);

export const TVHome = ({ onOpenMovie, onPlayMovie, onNavigate }: TVHomeProps) => {
  const catalog = useFilmStore(s => s.catalog);
  const continueWatching = useFilmStore(s => s.continueWatching);
  const progress = useFilmStore(s => s.progress);
  const progressList = useFilmStore(s => s.progressList);
  const load = useFilmStore(s => s.load);
  const { lastFocusedId } = useTVRestoreState();

  useEffect(() => { void load(); }, [load]);

  const catalogMovies = useMemo(() => catalog.filter(m => !m.isShort), [catalog]);
  const focusedId = useTVFocusedId();
  const [heroId, setHeroId] = useState<string | null>(null);
  // Афиша следует за фокусом: id карточек вида «prem-<id фильма>». Не фильм (чипы, меню) — остаётся прежняя.
  useEffect(() => {
    if (!focusedId) return;
    const m = /^(?:prem|cw|top|watched)-(.+)$/.exec(focusedId);
    if (!m) return;
    const t = setTimeout(() => setHeroId(m[1]), 140);
    return () => clearTimeout(t);
  }, [focusedId]);
  const hero = (heroId && catalogMovies.find(m => m.id === heroId)) || catalogMovies[0];
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
    <div className="pb-10">
      {hero && (
        <TVHero movieKey={hero.id} title={hero.title} description={hero.description} imageUrl={cover(hero)}
          rating={hero.rating} genre={hero.genre} year={hero.year} country={hero.country} ageRating={hero.ageRating}
          duration={hero.duration ? fmtDuration(hero.duration) : undefined}
          onWatch={() => onPlayMovie(hero.id)} onDetails={() => onOpenMovie(hero.id)}>
          <p className="mb-3 text-[20px] font-extrabold text-white">Новинки</p>
          <TVCarousel title="" items={fresh} getId={m => m.id}
            renderItem={(m, p) => (
              <TVCard id={`prem-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)} rating={m.rating} aspect="wide"
                onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
            )}/>
        </TVHero>
      )}

      <div className="px-14 pt-5">
        {onNavigate && (
          <div className="mb-8 flex flex-wrap gap-3">
            {CHIPS.map(c => (
              <TVFocusable key={c.k} id={`chip-${c.k}`} onEnter={() => onNavigate(c.k)}>
                {({ focused }) => (
                  <div className="flex items-center gap-2.5 rounded-2xl px-5 py-3 text-[17px] font-bold text-white transition-transform"
                    style={{ background: focused ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(14px)',
                      transform: focused ? 'scale(1.06)' : 'scale(1)', boxShadow: focused ? '0 0 0 3px #b3a7ff, 0 0 28px rgba(139,124,255,.5)' : 'none' }}>
                    <c.icon size={20} />{c.label}
                  </div>
                )}
              </TVFocusable>
            ))}
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

      {watchedList.length > 0 && (
        <TVCarousel title="Вы смотрели" items={watchedList} getId={m => m.id}
          renderItem={(m, p) => (
            <TVCard id={`watched-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)}
              onEnter={() => onOpenMovie(m.id)} autoFocusPriority={p}/>
          )}/>
      )}
      </div>
    </div>
  );
};
