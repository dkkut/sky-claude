/* -- Радио ------------------------------------------------- */
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import type { Track } from '@/platform/store';
import { TrackRow } from './MusicPrimitives';

interface Props {
  tracks:   Track[];
  favorites: string[];
  activeId:  string | null;
  playing:   boolean;
  onPlay:    (t: Track, pool: Track[]) => void;
  onLike:    (id: string) => void;
  onAdd:     (id: string) => void;
  onArtist:  (name: string) => void;
}

const MOODS = [
  { key: 'energy', label: 'Энергия',   color: '#f43f5e' },
  { key: 'chill',  label: 'Спокойно',  color: 'var(--green)' },
  { key: 'focus',  label: 'Фокус',     color: '#3b82f6' },
  { key: 'party',  label: 'Вечеринка', color: 'var(--amber)' },
];

export const RadioTab = ({ tracks, favorites, activeId, playing, onPlay, onLike, onAdd, onArtist }: Props) => {
  const pub     = tracks.filter(t => t.status === 'published');
  const genres  = [...new Set(pub.map(t => t.genre))];
  const artists = [...new Set(pub.map(t => t.artist))];

  const [seed, setSeed] = useState<'genre' | 'artist' | 'mood'>('genre');
  const [pick, setPick] = useState<string>(genres[0] ?? '');

  const radioQueue = useMemo(() => {
    let pool = seed === 'genre'  ? pub.filter(t => t.genre === pick)
      : seed === 'artist' ? pub.filter(t => t.artist === pick)
      : pub;
    if (pool.length < 5) pool = pub;
    return [...pool].sort(() => Math.random() - 0.5);
  }, [seed, pick, pub.length]);

  const seedTypes = [
    { key: 'genre' as const,  label: 'Жанр' },
    { key: 'artist' as const, label: 'Исполнитель' },
    { key: 'mood' as const,   label: 'Настроение' },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 pt-2 pb-3 shrink-0 space-y-3">

        {/* Тип радио */}
        <div className="flex gap-2">
          {seedTypes.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setSeed(key)}
              className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all"
              style={{
                background: seed === key ? 'var(--accent-bg)' : 'var(--bg-l2)',
                border:     `1px solid ${seed === key ? 'var(--accent)' : 'var(--border)'}`,
                color:      seed === key ? 'var(--accent)' : 'var(--t3)',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Жанры */}
        {seed === 'genre' && (
          <div className="flex flex-wrap gap-1.5">
            {genres.map(g => (
              <button key={g} type="button" onClick={() => setPick(g)}
                className="rounded-xl px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  background: pick === g ? 'var(--accent-bg)' : 'var(--bg-l2)',
                  border:     `1px solid ${pick === g ? 'var(--accent)' : 'var(--border)'}`,
                  color:      pick === g ? 'var(--accent)' : 'var(--t3)',
                }}>
                {g}
              </button>
            ))}
          </div>
        )}

        {/* Исполнители */}
        {seed === 'artist' && (
          <div className="flex flex-wrap gap-1.5">
            {artists.map(a => (
              <button key={a} type="button" onClick={() => setPick(a)}
                className="rounded-xl px-2.5 py-1 text-[11px] font-medium transition-all"
                style={{
                  background: pick === a ? 'var(--accent-bg)' : 'var(--bg-l2)',
                  border:     `1px solid ${pick === a ? 'var(--accent)' : 'var(--border)'}`,
                  color:      pick === a ? 'var(--accent)' : 'var(--t3)',
                }}>
                {a}
              </button>
            ))}
          </div>
        )}

        {/* Настроение */}
        {seed === 'mood' && (
          <div className="grid grid-cols-2 gap-2">
            {MOODS.map(m => (
              <motion.button key={m.key} type="button" whileTap={{ scale: 0.96 }}
                onClick={() => setPick(m.key)}
                className="flex items-center gap-2 rounded-2xl px-3 py-2.5"
                style={{
                  background: pick === m.key ? `${m.color}18` : 'var(--bg-l2)',
                  border:     `1.5px solid ${pick === m.key ? m.color : 'var(--border)'}`,
                }}>
                <div className="h-3 w-3 rounded-full" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}80` }} />
                <span className="text-xs font-semibold"
                  style={{ color: pick === m.key ? m.color : 'var(--t2)' }}>{m.label}</span>
              </motion.button>
            ))}
          </div>
        )}

        {/* Запуск */}
        <motion.button type="button" whileTap={{ scale: 0.97 }}
          onClick={() => radioQueue[0] && onPlay(radioQueue[0], radioQueue)}
          className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold text-white"
          style={{ background: 'linear-gradient(135deg,var(--accent),#8b5cf6)' }}>
          <Radio size={16}/>Запустить радио
        </motion.button>
      </div>

      {/* Очередь */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        <p className="text-[10px] font-bold uppercase tracking-widest px-2 mb-2" style={{ color: 'var(--t3)' }}>
          В очереди · {radioQueue.length}
        </p>
        {radioQueue.map(t => (
          <TrackRow key={t.id} track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
            onPlay={() => onPlay(t, radioQueue)} liked={favorites.includes(t.id)}
            onLike={() => onLike(t.id)} onAdd={() => onAdd(t.id)} compact onArtist={onArtist}/>
        ))}
      </div>
    </div>
  );
};
