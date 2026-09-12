/* ===========================================================
   SKY TV — корневая оболочка.
   Связывает все TV-экраны через единый стек навигации.
=========================================================== */
import { useEffect } from 'react';
import { useTVNavStore, type TVScreen } from './tvNavStore';
import { tvFocusManager } from './focusManager';
import { useTVKeyBindings } from './useTVKeyBindings';
import { TVHeader } from './TVHeader';
import { TVHome } from './TVHome';
import { TVMovieDetail } from './TVMovieDetail';
import { TVPlayer } from './TVPlayer';
import { TVSearch } from './TVSearch';
import { TVMusic } from './TVMusic';
import { TVVideoHub } from './TVVideoHub';
import { TVChannels } from './TVChannels';
import { TVPodcasts } from './TVPodcasts';
import { TVCatalogGrid } from './TVCatalogGrid';
import { TVProfileSettings } from './TVProfileSettings';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, type ServerMovie } from '@/film/filmApi';

const HEADER_KINDS = new Set<TVScreen['kind']>(['home', 'movies', 'series', 'music', 'video', 'channels', 'podcasts', 'favorites']);

export const TVShell = () => {
  const stack = useTVNavStore(s => s.stack);
  const push = useTVNavStore(s => s.push);
  const back = useTVNavStore(s => s.back);
  const setTopLevel = useTVNavStore(s => s.setTopLevel);
  const saveFocusForCurrent = useTVNavStore(s => s.saveFocusForCurrent);
  // Каталог и закладки кино — с сервера. Раньше «избранное» здесь
  // было списком избранной музыки: в общем сторе он один на всё.
  const movies = useFilmStore(s => s.catalog);
  const savedFilms = useFilmStore(s => s.saved);
  const loadFilm = useFilmStore(s => s.load);
  useEffect(() => { void loadFilm(); }, [loadFilm]);

  const screen = stack[stack.length - 1].screen;
  const isPlayer = screen.kind === 'player';

  /* при любом уходе с текущего экрана — запоминаем, что было в фокусе
     и на какой позиции скролла, чтобы Back вернул именно туда (п.17 ТЗ) */
  const snapshot = () => {
    const id = tvFocusManager.getFocusedId() ?? undefined;
    saveFocusForCurrent(id, window.scrollY);
  };

  const goDetail = (movieId: string) => { snapshot(); push({ kind: 'movieDetail', movieId }); };
  const goPlayMovie = (movieId: string) => { snapshot(); push({ kind: 'player', movieId }); };
  const goPlayVideo = (videoId: string) => { snapshot(); push({ kind: 'player', movieId: videoId }); };
  const goSearch = () => { snapshot(); setTopLevel({ kind: 'search' }); };
  const goProfile = () => { snapshot(); setTopLevel({ kind: 'profile' }); };
  const goNav = (kind: TVScreen['kind']) => { snapshot(); setTopLevel({ kind } as TVScreen); };

  const handleBack = () => {
    const ok = back();
    // стек пуст дальше некуда — просто остаёмся на главной, ничего не закрываем
    if (!ok) return;
  };

  useTVKeyBindings({ mode: 'nav', enabled: !isPlayer, onBack: handleBack });

  /* после смены экрана (кроме плеера, у него свой фулскрин) — скроллим
     страницу в восстановленную/нулевую позицию */
  useEffect(() => {
    if (isPlayer) return;
    window.scrollTo({ top: stack[stack.length - 1].scrollY ?? 0 });
  }, [screen, isPlayer]);

  const card = (m: ServerMovie) => ({
    id: m.id, title: m.title, subtitle: m.genre,
    imageUrl: m.hasPoster ? posterUrl(m.id) : undefined, rating: m.rating,
  });
  const favoriteMovies = savedFilms.filter(m => !m.isShort).map(card);
  const allMovies = movies.filter(m => !m.isShort).map(card);

  return (
    <div className="fixed inset-0 z-[500] overflow-y-auto" style={{ background: 'var(--bg)' }}>
      {!isPlayer && HEADER_KINDS.has(screen.kind) && (
        <TVHeader active={screen.kind} onNavigate={goNav} onSearch={goSearch} onProfile={goProfile}/>
      )}

      {screen.kind === 'home' && <TVHome onOpenMovie={goDetail} onPlayMovie={goPlayMovie}/>}

      {screen.kind === 'movies' && (
        <TVCatalogGrid items={allMovies} onOpen={goDetail} emptyTitle="Каталог пока пуст"/>
      )}

      {screen.kind === 'series' && (
        <TVCatalogGrid items={[]} onOpen={goDetail} emptyTitle="Сериалы появятся здесь" emptySub="Пока в каталоге только фильмы и видео"/>
      )}

      {screen.kind === 'favorites' && (
        <TVCatalogGrid items={favoriteMovies} onOpen={goDetail} emptyTitle="В избранном пока пусто" emptySub="Добавляйте фильмы кнопкой «В избранное» на странице фильма"/>
      )}

      {screen.kind === 'music' && <TVMusic/>}

      {screen.kind === 'video' && <TVVideoHub onPlayVideo={goPlayVideo}/>}
      {screen.kind === 'channels' && <TVChannels/>}
      {screen.kind === 'podcasts' && <TVPodcasts/>}

      {screen.kind === 'search' && <TVSearch onOpenMovie={goDetail} onBack={handleBack}/>}

      {screen.kind === 'profile' && <TVProfileSettings/>}

      {screen.kind === 'movieDetail' && (
        <TVMovieDetail movieId={screen.movieId} onPlay={goPlayMovie} onOpenMovie={goDetail}/>
      )}

      {screen.kind === 'player' && (
        <TVPlayer
          source={movies.some(m => m.id === screen.movieId) ? { kind: 'movie', id: screen.movieId } : { kind: 'video', id: screen.movieId }}
          onBack={handleBack}/>
      )}
    </div>
  );
};
