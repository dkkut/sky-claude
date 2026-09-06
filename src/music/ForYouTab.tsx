/* -- Вкладка «Для вас»  -  алгоритмическая лента ----------- */
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, TrendingUp, Zap, Hash } from 'lucide-react';
import type { Track } from '@/platform/store';
import { algoScore, loadHistory, getG } from './utils';
import { TrackRow } from './MusicPrimitives';
import type { ListenCtx } from './types';

interface Props {
  tracks:    Track[];
  favorites: string[];
  playing:   boolean;
  activeId:  string | null;
  onPlay:    (t: Track, pool: Track[]) => void;
  onLike:    (id: string) => void;
  onAdd:     (id: string) => void;
  onArtist:  (name: string) => void;
}

const GENRE_COLORS: Record<string, string> = {
  Synthwave: '#a855f7', Electronic: '#3b82f6', Ambient: 'var(--green)',
  Rock: '#f43f5e', 'Hip-Hop': 'var(--amber)', Jazz: '#ec4899',
  Classical: '#10b981', Другое: '#8b5cf6',
};

export const ForYouTab = ({ tracks, favorites, playing, activeId, onPlay, onLike, onAdd, onArtist }: Props) => {
  const pub = tracks.filter(t => t.status === 'published');
  const now = Date.now();

  const hist = useMemo(() => loadHistory(), []);

  const ctx: ListenCtx = useMemo(() => {
    const genreCount:  Record<string, number> = {};
    const artistCount: Record<string, number> = {};
    const liked   = new Set(favorites);
    const history = new Set(hist);
    pub.forEach(t => {
      if (liked.has(t.id))   { genreCount[t.genre]   = (genreCount[t.genre]   || 0) + 2; artistCount[t.artist] = (artistCount[t.artist] || 0) + 2; }
      if (history.has(t.id)) { genreCount[t.genre]   = (genreCount[t.genre]   || 0) + 1; artistCount[t.artist] = (artistCount[t.artist] || 0) + 1; }
    });
    return { genreCount, artistCount, liked, history };
  }, [favorites.join(','), hist.join(',')]);

  const scored    = useMemo(() => [...pub].sort((a, b) => algoScore(b, ctx, now) - algoScore(a, ctx, now)), [pub, ctx, now]);
  const forYou    = scored.slice(0, 8);
  const newTracks = [...pub].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 6);
  const topPlays  = [...pub].sort((a, b) => b.plays - a.plays).slice(0, 5);
  const genres    = [...new Set(pub.map(t => t.genre))].slice(0, 8);

  const [selGenre, setSelGenre] = useState<string | null>(null);
  const genreTracks = selGenre ? pub.filter(t => t.genre === selGenre) : [];

  return (
    <div className="h-full overflow-y-auto px-3 py-3 space-y-6">

      {/* Для вас */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Sparkles size={14} style={{ color: '#a855f7' }}/>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Для вас</p>
          <span className="text-[9px] rounded-full px-1.5 py-0.5 font-bold"
            style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7' }}>АЛГО</span>
        </div>
        <div className="space-y-0.5">
          {forYou.map(t => (
            <TrackRow key={t.id} track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
              onPlay={() => onPlay(t, scored)} liked={favorites.includes(t.id)}
              onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} compact onArtist={onArtist}/>
          ))}
        </div>
      </section>

      {/* Топ чарт */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <TrendingUp size={14} style={{ color: 'var(--amber)' }}/>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Топ чарт</p>
        </div>
        <div className="space-y-0.5">
          {topPlays.map((t, i) => (
            <TrackRow key={t.id} track={t} index={i} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
              onPlay={() => onPlay(t, topPlays)} liked={favorites.includes(t.id)}
              onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} onArtist={onArtist}/>
          ))}
        </div>
      </section>

      {/* Новинки */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Zap size={14} style={{ color: 'var(--green)' }}/>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Новинки</p>
        </div>
        <div className="space-y-0.5">
          {newTracks.map(t => (
            <TrackRow key={t.id} track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
              onPlay={() => onPlay(t, newTracks)} liked={favorites.includes(t.id)}
              onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} compact onArtist={onArtist}/>
          ))}
        </div>
      </section>

      {/* Жанры */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <Hash size={14} style={{ color: '#3b82f6' }}/>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--t3)' }}>Жанры</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {genres.map(g => {
            const cnt = pub.filter(t => t.genre === g).length;
            const aff = ctx.genreCount[g] ?? 0;
            const col = GENRE_COLORS[g] ?? 'var(--accent)';
            return (
              <motion.button key={g} type="button" whileTap={{ scale: 0.95 }}
                onClick={() => setSelGenre(sg => sg === g ? null : g)}
                className="flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: selGenre === g ? `${col}25` : 'var(--bg-l2)',
                  border:     `1.5px solid ${selGenre === g ? col : 'var(--border)'}`,
                  color:      selGenre === g ? col : 'var(--t2)',
                  boxShadow:  aff > 0 ? `0 0 8px ${col}30` : 'none',
                }}>
                {g}
                <span className="text-[9px]" style={{ color: selGenre === g ? col : 'var(--t3)' }}>·{cnt}</span>
                {aff > 0 && (
                  <span className="text-[8px] rounded-full px-1 font-bold"
                    style={{ background: `${col}20`, color: col }}>♥</span>
                )}
              </motion.button>
            );
          })}
        </div>
        {selGenre && genreTracks.length > 0 && (
          <div className="mt-3 space-y-0.5">
            {genreTracks.map(t => (
              <TrackRow key={t.id} track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
                onPlay={() => onPlay(t, genreTracks)} liked={favorites.includes(t.id)}
                onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} compact onArtist={onArtist}/>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
