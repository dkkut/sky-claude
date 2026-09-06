import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search } from 'lucide-react';
import { GAMES, GENRE_LABEL, type GameEntry } from '../store';
import { GameCard, GENRE_COLOR } from './Primitives';

interface Props { onGame: (g: GameEntry) => void }

export const GamesView = ({ onGame }: Props) => {
  const [genre, setGenre]   = useState('all');
  const [query, setQuery]   = useState('');
  const genres = [['all','Все'], ...Object.entries(GENRE_LABEL)];

  const visible = GAMES.filter(g => {
    const matchGenre = genre === 'all' || g.genre === genre;
    const matchQuery = !query || g.title.toLowerCase().includes(query.toLowerCase());
    return matchGenre && matchQuery;
  });

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)' }}>
          <Search size={13} style={{ color: 'var(--t3)', shrink: 0 }}/>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Поиск игры..."
            className="flex-1 text-sm bg-transparent outline-none"
            style={{ color: 'var(--t1)' }}/>
        </div>
      </div>

      {/* Genre filter */}
      <div className="flex gap-1.5 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {genres.map(([k, l]) => {
          const col = k === 'all' ? 'var(--accent)' : GENRE_COLOR[k];
          const on  = genre === k;
          return (
            <button key={k} type="button" onClick={() => setGenre(k)}
              className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all"
              style={{
                background: on ? `${col}20` : 'transparent',
                color:      on ? col : 'var(--t3)',
                border:     `1px solid ${on ? col + '50' : 'var(--border)'}`,
              }}>
              {l}
            </button>
          );
        })}
      </div>

      {/* Results count */}
      <div className="px-4 pb-2">
        <p className="text-[10px]" style={{ color: 'var(--t3)' }}>
          {visible.length} игр{visible.length === 1 ? 'а' : visible.length < 5 ? 'ы' : ''}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth: 'none' }}>
        <div className="grid grid-cols-2 gap-3">
          <AnimatePresence mode="popLayout">
            {visible.map(g => (
              <motion.div key={g.id} layout
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.15 }}>
                <GameCard game={g} onClick={() => onGame(g)}/>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16">
            <Search size={32} style={{ color: 'var(--t3)', opacity: 0.4 }}/>
            <p className="text-sm" style={{ color: 'var(--t3)' }}>Ничего не найдено</p>
          </div>
        )}
      </div>
    </div>
  );
};
