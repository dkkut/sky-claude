/* ===========================================================
   SKY TV — Sky Music
   Тот же серверный каталог, история, избранное и плейлисты, что в
   приложении (useMusicStore) — а не отдельный список. Играет ЕДИНЫЙ
   плеер (usePlayerStore + PlayerEngine); позиция прослушивания и
   история уходят на сервер (useMusicSync + playMusicQueue).
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music2, Heart, RefreshCw } from 'lucide-react';
import { useMusicStore } from '@/music/serverStore';
import { playMusicQueue } from '@/music/useMusicSync';
import { usePlayerStore } from '@/player/playerStore';
import type { Track } from '@/platform/store';
import { TVFocusable } from './TVFocusable';
import { TVCarousel } from './TVCarousel';
import { TVCard } from './TVCard';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';

const fmt = (s: number) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; };

const Btn = ({ id, onEnter, children, big, prio, label }: { id: string; onEnter: () => void; children: (f: boolean) => React.ReactNode; big?: boolean; prio?: number; label: string }) => (
  <TVFocusable id={id} onEnter={onEnter} autoFocusPriority={prio}>
    {({ focused }) => (
      <div aria-label={label} className="grid place-items-center rounded-full" style={{ width: big ? 76 : 60, height: big ? 76 : 60, background: big ? (focused ? '#8b7cff' : '#fff') : (focused ? '#8b7cff' : 'rgba(255,255,255,0.12)'), boxShadow: focused ? '0 0 0 4px rgba(179,167,255,0.9), 0 0 30px rgba(139,124,255,0.6)' : 'none', transform: focused ? 'scale(1.1)' : 'scale(1)', transition: 'all .15s' }}>
        {children(focused)}
      </div>
    )}
  </TVFocusable>
);

export const TVMusic = () => {
  const tracks = useMusicStore(s => s.tracks);
  const favorites = useMusicStore(s => s.favorites);
  const history = useMusicStore(s => s.history);
  const playlists = useMusicStore(s => s.playlists);
  const loaded = useMusicStore(s => s.loaded);
  const loading = useMusicStore(s => s.loading);
  const error = useMusicStore(s => s.error);
  const load = useMusicStore(s => s.load);
  const toggleFavorite = useMusicStore(s => s.toggleFavorite);
  const { item, isPlaying, currentTime, duration, nextTrack, prevTrack } = usePlayerStore();
  const { lastFocusedId } = useTVRestoreState();

  useEffect(() => { void load(); }, [load]);

  const favTracks = useMemo(() => tracks.filter(t => favorites.includes(t.id)), [tracks, favorites]);
  const mine = useMemo(() => tracks.filter(t => t.uploadedBy === 'me'), [tracks]);
  const fresh = useMemo(() => [...tracks].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 18), [tracks]);
  const byGenre = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const t of tracks) { if (!map.has(t.genre)) map.set(t.genre, []); map.get(t.genre)!.push(t); }
    return [...map.entries()].filter(([, l]) => l.length > 0).slice(0, 6);
  }, [tracks]);

  useEffect(() => { if (loaded) tvFocusManager.focusDefault(lastFocusedId); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && tracks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <Music2 size={48} color="var(--t3)"/>
        <p className="text-[26px] font-bold" style={{ color: 'var(--t1)' }}>{error}</p>
        <TVFocusable id="music-retry" onEnter={() => { void load({ force: true }); }} autoFocusPriority={0}>
          {({ focused }) => <div className="flex items-center gap-2 rounded-2xl px-8 py-4 text-[22px] font-bold" style={{ background: focused ? '#8b7cff' : 'rgba(255,255,255,0.12)', color: '#fff', boxShadow: focused ? '0 0 0 4px rgba(179,167,255,0.9)' : 'none' }}><RefreshCw size={22}/> Повторить</div>}
        </TVFocusable>
      </div>
    );
  }
  if (!loaded && loading) {
    return <div className="flex h-full items-center justify-center text-[24px]" style={{ color: 'var(--t3)' }} role="status">Загружаем музыку…</div>;
  }
  if (tracks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Music2 size={48} color="var(--t3)"/>
        <p className="text-[26px] font-bold" style={{ color: 'var(--t1)' }}>Треков пока нет</p>
        <p className="text-[18px]" style={{ color: 'var(--t3)' }}>Музыка появится здесь, как только её добавят в каталог</p>
      </div>
    );
  }

  const nowIsFav = !!item && favorites.includes(item.id);
  const play = (t: Track, pool: Track[]) => playMusicQueue(pool, t.id);
  const first = (rowIdx: number) => (item ? undefined : rowIdx === 0 ? 0 : undefined);
  let row = 0;
  const rowPrio = (len: number) => { const r = len > 0 ? first(row) : undefined; if (len > 0) row += 1; return r; };

  const trackRow = (title: string, list: Track[], prefix: string) => list.length === 0 ? null : (
    <TVCarousel key={prefix} title={title} items={list} getId={t => `${prefix}-${t.id}`} rowAutoFocusPriority={rowPrio(list.length)}
      renderItem={(t, p) => <TVCard id={`${prefix}-${t.id}`} title={t.title} subtitle={t.artist} imageUrl={t.coverUrl} aspect="square" onEnter={() => play(t, list)} autoFocusPriority={p}/>}/>
  );

  return (
    <div className="px-12 pt-8 pb-14">
      <h1 className="mb-6 text-[40px] font-extrabold" style={{ color: 'var(--t1)' }}>Sky Music</h1>

      {item && item.kind === 'music' && (
        <div className="mb-10 flex items-center gap-8 rounded-[32px] p-7" style={{ background: 'linear-gradient(120deg, rgba(139,124,255,0.22), rgba(255,255,255,0.05))', border: '1px solid rgba(160,150,255,0.25)' }}>
          <div className="h-40 w-40 shrink-0 overflow-hidden rounded-3xl" style={{ background: item.coverUrl ? `center/cover no-repeat url(${item.coverUrl})` : 'linear-gradient(160deg,#4f2e8a,#101018)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}/>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold uppercase tracking-[0.2em]" style={{ color: '#b3a7ff' }}>{isPlaying ? 'Сейчас играет' : 'На паузе'}</p>
            <p className="truncate text-[34px] font-extrabold" style={{ color: 'var(--t1)' }} translate="no">{item.title}</p>
            <p className="mb-4 truncate text-[22px]" style={{ color: 'var(--t3)' }} translate="no">{item.author}</p>
            <div className="mb-2 h-[8px] w-full max-w-[640px] overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%`, background: 'linear-gradient(90deg,#8b7cff,#4f6ef7)' }}/>
            </div>
            <p className="text-[16px] font-semibold tabular-nums" style={{ color: 'var(--t3)' }}>{fmt(currentTime)} / {fmt(duration ?? 0)}</p>
          </div>
          <div className="flex items-center gap-4">
            <Btn id="music-fav" label="В избранное" onEnter={() => { void toggleFavorite(item.id); }}>{() => <Heart size={26} color="#fff" fill={nowIsFav ? '#ff5d8f' : 'none'}/>}</Btn>
            <Btn id="music-prev" label="Предыдущий" onEnter={prevTrack}>{() => <SkipBack size={26} color="#fff"/>}</Btn>
            <Btn id="music-play" label={isPlaying ? 'Пауза' : 'Играть'} big prio={0} onEnter={() => usePlayerStore.getState().requestPlay(!isPlaying)}>
              {(f) => isPlaying ? <Pause size={34} color={f ? '#fff' : '#0a0a0e'} fill={f ? '#fff' : '#0a0a0e'}/> : <Play size={34} color={f ? '#fff' : '#0a0a0e'} fill={f ? '#fff' : '#0a0a0e'}/>}
            </Btn>
            <Btn id="music-next" label="Следующий" onEnter={nextTrack}>{() => <SkipForward size={26} color="#fff"/>}</Btn>
          </div>
        </div>
      )}

      {trackRow('Продолжить слушать', history.slice(0, 18), 'hist')}
      {trackRow('Любимые треки', favTracks, 'fav')}
      {trackRow('Моя музыка', mine, 'mine')}
      {playlists.some(p => p.tracks.length > 0) && (
        <TVCarousel title="Плейлисты" items={playlists.filter(p => p.tracks.length > 0)} getId={p => `pl-${p.id}`} rowAutoFocusPriority={rowPrio(1)}
          renderItem={(p, pr) => <TVCard id={`pl-${p.id}`} title={p.name} subtitle={`${p.count} треков`} imageUrl={p.tracks[0]?.coverUrl} aspect="square" onEnter={() => playMusicQueue(p.tracks, p.tracks[0].id)} autoFocusPriority={pr}/>}/>
      )}
      {trackRow('Новинки', fresh, 'fresh')}
      {byGenre.map(([genre, list]) => trackRow(genre, list.slice(0, 18), `g-${genre}`))}
    </div>
  );
};
