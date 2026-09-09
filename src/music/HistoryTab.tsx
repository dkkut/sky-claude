/* -- История прослушиваний --------------------------------- */
import { useMemo } from 'react';
import type { Track } from '@/platform/store';
import { useMusicStore } from './serverStore';
import { TrackRow } from './MusicPrimitives';

interface Props {
  tracks:    Track[];
  favorites: string[];
  activeId:  string | null;
  playing:   boolean;
  onPlay:    (t: Track, pool: Track[]) => void;
  onLike:    (id: string) => void;
  onAdd:     (id: string) => void;
  onArtist:  (name: string) => void;
}

export const HistoryTab = ({ tracks, favorites, activeId, playing, onPlay, onLike, onAdd, onArtist }: Props) => {
  // История приходит с сервера уже треками — она одинакова на всех
  // устройствах. Сверяемся с каталогом: удалённый трек играть нечем.
  const history = useMusicStore(st => st.history);
  const pool = useMemo(
    () => history.map(h => tracks.find(t => t.id === h.id)).filter(Boolean) as Track[],
    [history, tracks],
  );

  return (
    <div className="h-full overflow-y-auto px-2 py-2">
      {pool.length === 0
        ? <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>История пуста</p>
        : <>
            <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--t3)' }}>
              Недавно слушал · {pool.length}
            </p>
            {pool.map(t => (
              <TrackRow key={t.id} track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
                onPlay={() => onPlay(t, pool)} liked={favorites.includes(t.id)}
                onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} compact onArtist={onArtist}/>
            ))}
          </>
      }
    </div>
  );
};
