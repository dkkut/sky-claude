/* -- Чарты ------------------------------------------------- */
import { useState } from 'react';
import type { Track } from '@/platform/store';
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

export const ChartsTab = ({ tracks, favorites, activeId, playing, onPlay, onLike, onAdd, onArtist }: Props) => {
  const pub    = tracks.filter(t => t.status === 'published');
  const genres = ['Все', ...new Set(pub.map(t => t.genre))];
  const [genre, setGenre] = useState('Все');
  const pool   = [...(genre === 'Все' ? pub : pub.filter(t => t.genre === genre))].sort((a, b) => b.plays - a.plays);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Фильтр жанров */}
      <div className="px-3 pt-2 pb-1 shrink-0 flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {genres.map(g => (
          <button key={g} type="button" onClick={() => setGenre(g)}
            className="shrink-0 rounded-2xl px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              background: genre === g ? 'rgba(168,85,247,0.12)' : 'var(--bg-l2)',
              border:     `1px solid ${genre === g ? 'rgba(79,110,247,0.4)' : 'var(--border)'}`,
              color:      genre === g ? '#A855F7' : 'var(--t3)',
            }}>
            {g}
          </button>
        ))}
      </div>

      {/* Список */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {pool.map((t, i) => (
          <div key={t.id} className="flex items-center gap-2">
            <div className="w-6 shrink-0 text-center">
              {i < 3
                ? <span className="text-xs font-black" style={{ color: i===0?'var(--amber)':i===1?'#94a3b8':'#b45309' }}>{i+1}</span>
                : <span className="text-xs tabular-nums" style={{ color: 'var(--t3)' }}>{i + 1}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <TrackRow track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
                onPlay={() => onPlay(t, pool)} liked={favorites.includes(t.id)}
                onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} onArtist={onArtist}/>
            </div>
          </div>
        ))}
        {pool.length === 0 && (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--t3)' }}>Нет треков</p>
        )}
      </div>
    </div>
  );
};
