/* ===========================================================
   SKY TV — «Моя коллекция»
   Личное, отдельно от общего каталога: свои фильмы и треки, сохранённое
   кино, любимая музыка, плейлисты. Всё лежит на сервере (useFilmStore.mine/
   saved, useMusicStore.tracks[own]/favorites/playlists) — одно и то же на
   телефоне, сайте и телевизоре. Права решает сервер: чужое он не отдаст,
   а удалять можно только своё.
   На ТВ у пользователя может быть чужой гость в комнате — поэтому личное
   показано только здесь и не попадает на главную.
=========================================================== */
import { flash } from '@/shared/flash';
import { useEffect, useMemo } from 'react';
import { Bookmark, RefreshCw } from 'lucide-react';
import { useFilmStore } from '@/film/serverStore';
import { posterUrl, type ServerMovie } from '@/film/filmApi';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import type { Track } from '@/platform/store';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { TVFocusable } from './TVFocusable';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';
import { useTVSheet } from './TVActionSheet';

const STATUS: Record<string, string> = { private: 'Личное', published: 'В каталоге', pending: 'На проверке', rejected: 'Отклонено' };
const cover = (m: ServerMovie) => (m.hasPoster ? posterUrl(m.id) : undefined);

interface Props { onOpenMovie: (id: string) => void; onPlayMovie: (id: string) => void }

export const TVCollection = ({ onOpenMovie, onPlayMovie }: Props) => {
  const mine = useFilmStore(s => s.mine);
  const saved = useFilmStore(s => s.saved);
  const filmLoaded = useFilmStore(s => s.loaded);
  const filmError = useFilmStore(s => s.error);
  const loadFilm = useFilmStore(s => s.load);
  const refreshMine = useFilmStore(s => s.refreshMine);
  const toggleSaved = useFilmStore(s => s.toggleSaved);
  const removeMovie = useFilmStore(s => s.removeMovie);
  const tracks = useMusicStore(s => s.tracks);
  const favorites = useMusicStore(s => s.favorites);
  const playlists = useMusicStore(s => s.playlists);
  const musicLoaded = useMusicStore(s => s.loaded);
  const loadMusic = useMusicStore(s => s.load);
  const toggleFavorite = useMusicStore(s => s.toggleFavorite);
  const removeTrack = useMusicStore(s => s.removeTrack);
  const { lastFocusedId } = useTVRestoreState();
  const show = useTVSheet(s => s.show);

  useEffect(() => { void loadFilm(); void refreshMine(); void loadMusic(); }, [loadFilm, refreshMine, loadMusic]);

  const myTracks = useMemo(() => tracks.filter(t => t.uploadedBy === 'me'), [tracks]);
  const favTracks = useMemo(() => tracks.filter(t => favorites.includes(t.id)), [tracks, favorites]);
  const pls = useMemo(() => playlists.filter(p => p.tracks.length > 0), [playlists]);
  const total = mine.length + saved.length + myTracks.length + favTracks.length + pls.length;
  const ready = filmLoaded && musicLoaded;

  useEffect(() => { if (ready) tvFocusManager.focusDefault(lastFocusedId); }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDelete = (title: string, run: () => Promise<void> | void) => show({
    title: 'Удалить навсегда?', subtitle: title,
    actions: [{ label: 'Да, удалить', danger: true, run }],
  });

  const movieSheet = (m: ServerMovie, own: boolean) => show({
    title: m.title, subtitle: own ? (STATUS[m.status ?? 'private'] ?? 'Личное') : 'Сохранённое',
    actions: [
      { label: 'Смотреть', run: () => onPlayMovie(m.id) },
      { label: 'Подробнее', run: () => onOpenMovie(m.id) },
      ...(own
        ? [{ label: 'Удалить из моей коллекции', danger: true, keepOpen: true, run: () => { confirmDelete(m.title, async () => { await removeMovie(m.id); }); } }]
        : [{ label: 'Убрать из коллекции', danger: true, run: () => toggleSaved(m.id) }]),
    ],
  });

  const trackSheet = (t: Track, pool: Track[], own: boolean) => show({
    title: t.title, subtitle: t.artist,
    actions: [
      { label: 'Слушать', run: () => playMusicQueue(pool, t.id) },
      ...(favorites.includes(t.id) ? [{ label: 'Убрать из избранного', run: () => toggleFavorite(t.id) }] : [{ label: 'В избранное', run: () => toggleFavorite(t.id) }]),
      ...(own ? [{ label: 'Удалить трек', danger: true, keepOpen: true, run: () => { confirmDelete(t.title, async () => { if (!(await removeTrack(t.id))) flash('Не удалось удалить трек. Попробуйте ещё раз.'); }); } }] : []),
    ],
  });

  if (!ready && !filmError) {
    return <div className="flex h-full items-center justify-center text-[24px]" style={{ color: 'var(--t3)' }} role="status">Загружаем вашу коллекцию…</div>;
  }
  if (filmError && total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Bookmark size={48} color="var(--t3)" />
        <p className="text-[26px] font-bold" style={{ color: 'var(--t1)' }}>Не удалось загрузить коллекцию</p>
        <TVFocusable id="coll-retry" autoFocusPriority={0} onEnter={() => { void loadFilm({ force: true }); void refreshMine(); void loadMusic({ force: true }); }}>
          {({ focused }) => <div className="flex items-center gap-2 rounded-2xl px-8 py-4 text-[22px] font-bold text-white" style={{ background: focused ? '#8b7cff' : 'rgba(255,255,255,0.12)', boxShadow: focused ? '0 0 0 4px rgba(179,167,255,0.9)' : 'none' }}><RefreshCw size={22} /> Повторить</div>}
        </TVFocusable>
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-20 text-center">
        <Bookmark size={56} color="var(--t3)" />
        <p className="text-[30px] font-extrabold" style={{ color: 'var(--t1)' }}>В вашей коллекции пока пусто</p>
        <p className="max-w-[760px] text-[20px]" style={{ color: 'var(--t3)' }}>Сохраняйте фильмы кнопкой «В коллекцию» на странице фильма, отмечайте любимую музыку сердцем. Свои загрузки с телефона или сайта появятся здесь сами.</p>
      </div>
    );
  }

  let r = 0;
  const prio = () => (r++ === 0 ? 0 : undefined);

  return (
    <div className="px-12 pt-8 pb-14">
      <h1 className="mb-1 text-[40px] font-extrabold" style={{ color: 'var(--t1)' }}>Моя коллекция</h1>
      <p className="mb-8 text-[18px]" style={{ color: 'var(--t3)' }}>Только ваше. Общий каталог — в разделах «Фильмы» и «Sky Music».</p>

      {saved.length > 0 && (
        <TVCarousel title="Кино: сохранённое" items={saved} getId={m => `sv-${m.id}`} rowAutoFocusPriority={prio()}
          renderItem={(m, p) => <TVCard id={`sv-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)} rating={m.rating} onEnter={() => movieSheet(m, false)} autoFocusPriority={p}/>}/>
      )}
      {mine.length > 0 && (
        <TVCarousel title="Кино: мои загрузки" items={mine} getId={m => `mn-${m.id}`} rowAutoFocusPriority={prio()}
          renderItem={(m, p) => <TVCard id={`mn-${m.id}`} title={m.title} subtitle={m.genre} imageUrl={cover(m)} badge={STATUS[m.status ?? 'private']} onEnter={() => movieSheet(m, true)} autoFocusPriority={p}/>}/>
      )}
      {favTracks.length > 0 && (
        <TVCarousel title="Музыка: любимые" items={favTracks} getId={t => `ft-${t.id}`} rowAutoFocusPriority={prio()}
          renderItem={(t, p) => <TVCard id={`ft-${t.id}`} title={t.title} subtitle={t.artist} imageUrl={t.coverUrl} aspect="square" onEnter={() => trackSheet(t, favTracks, false)} autoFocusPriority={p}/>}/>
      )}
      {myTracks.length > 0 && (
        <TVCarousel title="Музыка: мои треки" items={myTracks} getId={t => `mt-${t.id}`} rowAutoFocusPriority={prio()}
          renderItem={(t, p) => <TVCard id={`mt-${t.id}`} title={t.title} subtitle={t.artist} imageUrl={t.coverUrl} aspect="square" onEnter={() => trackSheet(t, myTracks, true)} autoFocusPriority={p}/>}/>
      )}
      {pls.length > 0 && (
        <TVCarousel title="Музыка: плейлисты" items={pls} getId={p => `pl-${p.id}`} rowAutoFocusPriority={prio()}
          renderItem={(p, pr) => <TVCard id={`pl-${p.id}`} title={p.name} subtitle={`${p.count} треков`} imageUrl={p.tracks[0]?.coverUrl} aspect="square" onEnter={() => playMusicQueue(p.tracks, p.tracks[0].id)} autoFocusPriority={pr}/>}/>
      )}
    </div>
  );
};
