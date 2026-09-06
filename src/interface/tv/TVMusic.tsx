/* ===========================================================
   SKY TV — Sky Music
   Использует ЕДИНЫЙ существующий аудио-движок (usePlayerStore +
   PlayerEngine) — не создаёт второй параллельный плеер.
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Music2 } from 'lucide-react';
import { usePlatformStore } from '@/platform/store';
import { usePlayerStore, type PlayerItem } from '@/player/playerStore';
import { TVFocusable } from './TVFocusable';
import { TVCarousel } from './TVCarousel';
import { tvFocusManager } from './focusManager';
import { useTVRestoreState } from './tvNavStore';

const fmt = (s: number) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60), sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; };

export const TVMusic = () => {
  const tracks = usePlatformStore(s => s.tracks);
  const favorites = usePlatformStore(s => s.favorites);
  const { item, isPlaying, currentTime, duration, setPlaying, nextTrack, prevTrack } = usePlayerStore();
  const { lastFocusedId } = useTVRestoreState();

  const favTracks = useMemo(() => tracks.filter(t => favorites.includes(t.id)), [tracks, favorites]);
  const fresh = useMemo(() => [...tracks].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 14), [tracks]);
  const byGenre = useMemo(() => {
    const map = new Map<string, typeof tracks>();
    for (const t of tracks) { if (!map.has(t.genre)) map.set(t.genre, []); map.get(t.genre)!.push(t); }
    return [...map.entries()].slice(0, 5);
  }, [tracks]);

  useEffect(() => { tvFocusManager.focusDefault(lastFocusedId); }, []);

  const playTrack = (t: typeof tracks[number]) => {
    const queue: PlayerItem[] = tracks.map(tr => ({ id: tr.id, kind: 'music', title: tr.title, author: tr.artist, coverUrl: tr.coverUrl, srcUrl: tr.sourceUrl, duration: undefined }));
    const idx = tracks.findIndex(tr => tr.id === t.id);
    usePlayerStore.getState().push({ ...queue[idx], queue, qIdx: idx });
  };

  if (tracks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Music2 size={40} color="var(--t3)"/>
        <p className="text-xl font-bold" style={{ color: 'var(--t1)' }}>Треков пока нет</p>
      </div>
    );
  }

  return (
    <div className="px-10 pt-6 pb-10">
      {item && (
        <div className="mb-8 flex items-center gap-6 rounded-2xl p-6" style={{ background: 'var(--bg-l1)' }}>
          <div className="h-28 w-28 shrink-0 rounded-xl overflow-hidden"
            style={{ background: item.coverUrl ? `center/cover no-repeat url(${item.coverUrl})` : 'linear-gradient(160deg,#232330,#101018)' }}/>
          <div className="flex-1 min-w-0">
            <p className="text-[22px] font-extrabold truncate" style={{ color: 'var(--t1)' }}>{item.title}</p>
            <p className="text-[15px] truncate mb-3" style={{ color: 'var(--t3)' }}>{item.author}</p>
            <div className="h-[5px] w-full max-w-[420px] rounded-full bg-white/10 overflow-hidden mb-1">
              <div className="h-full rounded-full" style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%`, background: 'var(--accent)' }}/>
            </div>
            <p className="text-[12px] font-semibold" style={{ color: 'var(--t3)' }}>{fmt(currentTime)} / {fmt(duration ?? 0)}</p>
          </div>
          <div className="flex items-center gap-3">
            <TVFocusable id="music-prev" onEnter={prevTrack}>
              {({ focused }) => <div className="grid h-12 w-12 place-items-center rounded-full" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)' }}><SkipBack size={19} color={focused ? '#fff' : 'var(--t1)'}/></div>}
            </TVFocusable>
            <TVFocusable id="music-play" onEnter={() => setPlaying(!isPlaying)} autoFocusPriority={0}>
              {({ focused }) => (
                <div className="grid h-14 w-14 place-items-center rounded-full" style={{ background: focused ? 'var(--accent)' : '#fff' }}>
                  {isPlaying ? <Pause size={22} color={focused ? '#fff' : '#0a0a0e'} fill={focused ? '#fff' : '#0a0a0e'}/> : <Play size={22} color={focused ? '#fff' : '#0a0a0e'} fill={focused ? '#fff' : '#0a0a0e'}/>}
                </div>
              )}
            </TVFocusable>
            <TVFocusable id="music-next" onEnter={nextTrack}>
              {({ focused }) => <div className="grid h-12 w-12 place-items-center rounded-full" style={{ background: focused ? 'var(--accent)' : 'var(--bg-l2)' }}><SkipForward size={19} color={focused ? '#fff' : 'var(--t1)'}/></div>}
            </TVFocusable>
          </div>
        </div>
      )}

      {favTracks.length > 0 && (
        <TVCarousel title="Любимые треки" items={favTracks} getId={t => t.id} rowAutoFocusPriority={item ? undefined : 0}
          renderItem={(t, p) => (
            <TVFocusable id={`fav-${t.id}`} onEnter={() => playTrack(t)} autoFocusPriority={p} className="shrink-0" style={{ width: 168 }}>
              {({ focused }) => (
                <div style={{ transform: focused ? 'scale(1.07)' : 'scale(1)', transition: 'transform 0.16s' }}>
                  <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ background: t.coverUrl ? `center/cover no-repeat url(${t.coverUrl})` : 'linear-gradient(160deg,#232330,#101018)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none' }}/>
                  <p className="text-[14px] font-bold truncate" style={{ color: focused ? 'var(--accent)' : 'var(--t1)' }}>{t.title}</p>
                  <p className="text-[12px] truncate" style={{ color: 'var(--t3)' }}>{t.artist}</p>
                </div>
              )}
            </TVFocusable>
          )}/>
      )}

      <TVCarousel title="Недавно добавленное" items={fresh} getId={t => t.id} rowAutoFocusPriority={favTracks.length === 0 && !item ? 0 : undefined}
        renderItem={(t, p) => (
          <TVFocusable id={`fresh-${t.id}`} onEnter={() => playTrack(t)} autoFocusPriority={p} className="shrink-0" style={{ width: 168 }}>
            {({ focused }) => (
              <div style={{ transform: focused ? 'scale(1.07)' : 'scale(1)', transition: 'transform 0.16s' }}>
                <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ background: t.coverUrl ? `center/cover no-repeat url(${t.coverUrl})` : 'linear-gradient(160deg,#232330,#101018)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none' }}/>
                <p className="text-[14px] font-bold truncate" style={{ color: focused ? 'var(--accent)' : 'var(--t1)' }}>{t.title}</p>
                <p className="text-[12px] truncate" style={{ color: 'var(--t3)' }}>{t.artist}</p>
              </div>
            )}
          </TVFocusable>
        )}/>

      {byGenre.map(([genre, list]) => (
        <TVCarousel key={genre} title={genre} items={list} getId={t => t.id}
          renderItem={(t, p) => (
            <TVFocusable id={`g-${genre}-${t.id}`} onEnter={() => playTrack(t)} autoFocusPriority={p} className="shrink-0" style={{ width: 168 }}>
              {({ focused }) => (
                <div style={{ transform: focused ? 'scale(1.07)' : 'scale(1)', transition: 'transform 0.16s' }}>
                  <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ background: t.coverUrl ? `center/cover no-repeat url(${t.coverUrl})` : 'linear-gradient(160deg,#232330,#101018)', boxShadow: focused ? '0 0 0 3px var(--accent)' : 'none' }}/>
                  <p className="text-[14px] font-bold truncate" style={{ color: focused ? 'var(--accent)' : 'var(--t1)' }}>{t.title}</p>
                  <p className="text-[12px] truncate" style={{ color: 'var(--t3)' }}>{t.artist}</p>
                </div>
              )}
            </TVFocusable>
          )}/>
      ))}
    </div>
  );
};
