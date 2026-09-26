/* ===========================================================
   SKY CAR MODE — Музыка.
   Тот же реальный каталог/история/избранное, что и в SkyMusic.tsx
   (useMusicStore, @/music/serverStore) — свой список, но не второй
   музыкальный бэкенд. Запуск трека собирает очередь и кладёт её в
   ЕДИНЫЙ usePlayerStore — тот же канал, которым управляет CarMiniPlayer.
=========================================================== */
import { useEffect, useMemo } from 'react';
import { Music2, Heart } from 'lucide-react';
import { useMusicStore } from '@/music/serverStore';
import { usePlayerStore, type PlayerItem } from '@/player/playerStore';
import type { Track } from '@/platform/store';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './CarShell';

const Row = ({ t, active, onPlay }: { t: Track; active: boolean; onPlay: () => void }) => (
  <button type="button" onClick={onPlay}
    className="flex w-full items-center gap-4 rounded-2xl px-4 py-3 text-left transition-transform active:scale-[0.98]"
    style={{ background: active ? 'rgba(255,255,255,0.10)' : 'transparent' }}>
    <div className="h-14 w-14 shrink-0 rounded-xl overflow-hidden"
      style={{ background: t.coverUrl ? `center/cover no-repeat url(${t.coverUrl})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }}>
      {!t.coverUrl && <div className="grid h-full w-full place-items-center"><Music2 size={20} color="rgba(255,255,255,0.4)" /></div>}
    </div>
    <div className="min-w-0 flex-1">
      <p className="truncate text-[17px] font-bold" style={{ color: active ? 'var(--accent)' : '#fff' }}>{t.title}</p>
      <p className="truncate text-[14px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{t.artist}</p>
    </div>
  </button>
);

export const CarMusic = () => {
  const tracks = useMusicStore(s => s.tracks);
  const favorites = useMusicStore(s => s.favorites);
  const history = useMusicStore(s => s.history);
  const loaded = useMusicStore(s => s.loaded);
  const error = useMusicStore(s => s.error);
  const load = useMusicStore(s => s.load);
  const notePlay = useMusicStore(s => s.notePlay);
  const currentId = usePlayerStore(s => (s.item?.kind === 'music' ? s.item.id : null));

  useEffect(() => { void load(); }, [load]);

  const favTracks = useMemo(() => tracks.filter(t => favorites.includes(t.id)), [tracks, favorites]);

  const playFrom = (t: Track, pool: Track[]) => {
    const i = pool.findIndex(x => x.id === t.id);
    if (i < 0) return;
    const queue: PlayerItem[] = pool.map(p => ({
      id: p.id, kind: 'music', title: p.title, author: p.artist ?? '', coverUrl: p.coverUrl, srcUrl: p.sourceUrl,
    }));
    usePlayerStore.getState().push({ ...queue[i], queue, qIdx: i });
    void notePlay(t.id);
  };

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Music2 size={40} color="rgba(255,255,255,0.35)" />
        <p className="text-[16px] font-bold text-white">{error}</p>
      </div>
    );
  }

  if (loaded && tracks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <Music2 size={40} color="rgba(255,255,255,0.35)" />
        <p className="text-[16px] font-bold text-white">Треков пока нет</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {favTracks.length > 0 && (
        <section>
          <p className="mb-2 flex items-center gap-2 px-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <Heart size={13} /> Любимые
          </p>
          <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
            {favTracks.slice(0, 8).map(t => <Row key={t.id} t={t} active={t.id === currentId} onPlay={() => playFrom(t, favTracks)} />)}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>Недавно слушали</p>
          <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
            {history.slice(0, 10).map(t => <Row key={t.id} t={t} active={t.id === currentId} onPlay={() => playFrom(t, history)} />)}
          </div>
        </section>
      )}

      {tracks.length > 0 && (
        <section>
          <p className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.45)' }}>Вся музыка</p>
          <div className="rounded-3xl p-2" style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
            {tracks.map(t => <Row key={t.id} t={t} active={t.id === currentId} onPlay={() => playFrom(t, tracks)} />)}
          </div>
        </section>
      )}
    </div>
  );
};
