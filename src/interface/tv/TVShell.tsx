/* ===========================================================
   SKY TV — корневая оболочка.
   Связывает все TV-экраны через единый стек навигации.
=========================================================== */
import { useEffect, useRef } from 'react';
import { useTVNavStore, type TVScreen } from './tvNavStore';
import { tvFocusManager } from './focusManager';
import { useTVKeyBindings } from './useTVKeyBindings';
import { TVSidebar, navKindFor, type NavKind } from './TVSidebar';
import { TVCollection } from './TVCollection';
import { NetBanner } from '@/shared/NetBanner';
import { TVActionSheetHost, useTVSheet } from './TVActionSheet';
import { useTvScale } from './tvScale';
import { useMusicSync } from '@/music/useMusicSync';
import { PlayerEngine } from '@/player/PlayerEngine';
import { PodcastPlayerHost } from '@/podcasts/PodcastPlayer';
import { NotifBridge } from '@/notifications/NotifBridge';
import { NotifToastLayer } from '@/notifications/NotifToast';
import { FlashLayer } from '@/shared/flash';
import { useMusicStore } from '@/music/serverStore';
import { TVHome } from './TVHome';
import { TVMovieDetail } from './TVMovieDetail';
import { TVPlayer } from './TVPlayer';
import { TVSearch } from './TVSearch';
import { TVMusic } from './TVMusic';
import { TVVideoHub } from './TVVideoHub';
import { TVChannels } from './TVChannels';
import { TVPodcasts } from './TVPodcasts';
import { TVLibrary } from './TVLibrary';
import { TVCatalogGrid } from './TVCatalogGrid';
import { TVProfileSettings } from './TVProfileSettings';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl } from '@/film/filmApi';


export const TVShell = () => {
  const stack = useTVNavStore(s => s.stack);
  const push = useTVNavStore(s => s.push);
  const back = useTVNavStore(s => s.back);
  const setTopLevel = useTVNavStore(s => s.setTopLevel);
  const saveFocusForCurrent = useTVNavStore(s => s.saveFocusForCurrent);
  const scale = useTvScale();
  const contentRef = useRef<HTMLDivElement>(null);
  // Каталог кино и музыки — с сервера, как в приложении на телефоне.
  const movies = useFilmStore(s => s.catalog);
  const loadFilm = useFilmStore(s => s.load);
  const loadMusic = useMusicStore(s => s.load);
  useEffect(() => { void loadFilm(); void loadMusic(); }, [loadFilm, loadMusic]);
  useMusicSync();

  /* Личное меняется на другом устройстве, пока телевизор включён: при возврате в приложение
     и раз в пять минут перечитываем коллекции с сервера, а не показываем вчерашнее. */
  useEffect(() => {
    const refresh = () => { void useFilmStore.getState().load({ force: true }); void useMusicStore.getState().load({ force: true }); void useFilmStore.getState().refreshMine(); };
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', refresh);
    const t = setInterval(refresh, 5 * 60_000);
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', refresh); clearInterval(t); };
  }, []);

  const screen = stack[stack.length - 1].screen;
  const isPlayer = screen.kind === 'player';
  const active = navKindFor(screen.kind);

  /* при любом уходе с текущего экрана — запоминаем, что было в фокусе
     и на какой позиции скролла, чтобы Back вернул именно туда */
  const snapshot = () => {
    const id = tvFocusManager.getFocusedId() ?? undefined;
    saveFocusForCurrent(id, contentRef.current?.scrollTop ?? 0);
  };

  const goDetail = (movieId: string) => { snapshot(); push({ kind: 'movieDetail', movieId }); };
  const goPlayMovie = (movieId: string) => { snapshot(); push({ kind: 'player', movieId }); };
  const goPlayVideo = (videoId: string) => { snapshot(); push({ kind: 'player', movieId: videoId }); };
  const goNav = (kind: NavKind) => { snapshot(); setTopLevel({ kind } as TVScreen); };

  const handleBack = () => {
    if (useTVSheet.getState().close()) return;
    // Дальше назад некуда — фокус уходит на боковую панель, а не «в никуда».
    if (!back()) tvFocusManager.setFocused(`nav-${active}`);
  };

  useTVKeyBindings({ mode: 'nav', enabled: !isPlayer, onBack: handleBack });

  /* после смены экрана (кроме плеера) — восстановленная или нулевая позиция прокрутки */
  useEffect(() => {
    if (isPlayer) return;
    contentRef.current?.scrollTo({ top: stack[stack.length - 1].scrollY ?? 0 });
  }, [screen, isPlayer]);

  const allMovies = movies.filter(m => !m.isShort).map(m => ({
    id: m.id, title: m.title, subtitle: m.genre,
    imageUrl: m.hasPoster ? posterUrl(m.id) : undefined, rating: m.rating,
  }));

  return (
    <div className="fixed inset-0 z-[500] overflow-hidden" style={{ background: 'radial-gradient(120% 90% at 80% 0%, #14123a 0%, #0a0a14 55%, #05050c 100%)' }} data-keep-dark>
      <div style={{ zoom: scale, width: '100%', height: '100%' }} className="flex">
        <NotifBridge />
        <PlayerEngine />
        <PodcastPlayerHost />

        {!isPlayer && <TVSidebar active={active} onNavigate={(k) => (k === 'search' ? (snapshot(), setTopLevel({ kind: 'search' })) : goNav(k))} />}

        <div ref={contentRef} className="relative h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'none' }}>
          {screen.kind === 'home' && <TVHome onOpenMovie={goDetail} onPlayMovie={goPlayMovie}/>}

          {(screen.kind === 'movies' || screen.kind === 'series') && (
            <TVCatalogGrid items={allMovies} onOpen={goDetail} emptyTitle="Каталог пока пуст"/>
          )}

          {(screen.kind === 'collection' || screen.kind === 'favorites') && <TVCollection onOpenMovie={goDetail} onPlayMovie={goPlayMovie}/>}

          {screen.kind === 'music' && <TVMusic/>}
          {screen.kind === 'video' && <TVVideoHub onPlayVideo={goPlayVideo}/>}
          {screen.kind === 'channels' && <TVChannels/>}
          {screen.kind === 'podcasts' && <TVPodcasts/>}
          {screen.kind === 'library' && <TVLibrary onPlayMovie={goPlayMovie}/>}
          {screen.kind === 'search' && <TVSearch onOpenMovie={goDetail} onBack={handleBack}/>}
          {(screen.kind === 'profile' || screen.kind === 'settings') && <TVProfileSettings/>}

          {screen.kind === 'movieDetail' && (
            <TVMovieDetail movieId={screen.movieId} onPlay={goPlayMovie} onOpenMovie={goDetail}/>
          )}
        </div>

        {screen.kind === 'player' && (
          <TVPlayer
            source={movies.some(m => m.id === screen.movieId) || useFilmStore.getState().mine.some(m => m.id === screen.movieId) || useFilmStore.getState().saved.some(m => m.id === screen.movieId)
              ? { kind: 'movie', id: screen.movieId } : { kind: 'video', id: screen.movieId }}
            onBack={handleBack}/>
        )}
        <TVActionSheetHost />
        <NetBanner />
        <NotifToastLayer />
        <FlashLayer />
      </div>
    </div>
  );
};
