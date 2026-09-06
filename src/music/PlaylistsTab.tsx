/* -- Плейлисты --------------------------------------------- */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, ArrowLeft, Pencil, Trash2, X, ListMusic } from 'lucide-react';
import type { Track } from '@/platform/store';
import { usePlatformStore } from '@/platform/store';
import { TrackRow } from './MusicPrimitives';

interface Props {
  tracks:    Track[];
  favorites: string[];
  activeId:  string | null;
  playing:   boolean;
  onPlay:    (t: Track, pool: Track[]) => void;
  onAdd:     (id: string) => void;
}

export const PlaylistsTab = ({ tracks, favorites, activeId, playing, onPlay, onAdd }: Props) => {
  const {
    playlists, createPlaylist, deletePlaylist, renamePlaylist,
    removeFromPlaylist, setCurrentPlaylist, currentPlaylistId, toggleFavorite,
  } = usePlatformStore();

  const [newName,  setNewName]  = useState('');
  const [openId,   setOpenId]   = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameV,  setRenameV]  = useState('');

  /* Просмотр плейлиста */
  if (openId) {
    const pl = playlists.find(p => p.id === openId);
    if (!pl) { setOpenId(null); return null; }
    const pool = pl.trackIds.map(id => tracks.find(t => t.id === id)).filter(Boolean) as Track[];

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1 shrink-0">
          <button type="button" onClick={() => setOpenId(null)}
            className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/10"
            style={{ color: 'var(--accent)' }}>
            <ArrowLeft size={14}/>
          </button>
          {renaming === pl.id
            ? <input autoFocus value={renameV} onChange={e => setRenameV(e.target.value)}
                onBlur={() => { if (renameV.trim()) renamePlaylist(pl.id, renameV.trim()); setRenaming(null); }}
                onKeyDown={e => { if (e.key === 'Enter') { renamePlaylist(pl.id, renameV.trim()); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }}
                className="flex-1 rounded-xl px-2 py-1 text-sm font-bold text-white outline-none"
                style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent-bg)' }}/>
            : <p className="flex-1 text-sm font-bold text-white truncate">{pl.name}</p>}
          <button type="button" onClick={() => { setRenaming(pl.id); setRenameV(pl.name); }}
            className="grid h-7 w-7 place-items-center rounded-xl hover:bg-white/10"
            style={{ color: 'var(--t3)' }}>
            <Pencil size={12}/>
          </button>
        </div>
        <p className="text-xs px-4 mb-2" style={{ color: 'var(--t3)' }}>{pool.length} треков</p>
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {pool.length === 0 && (
            <p className="py-6 text-center text-xs" style={{ color: 'var(--t3)' }}>Добавь треки из других разделов</p>
          )}
          {pool.map(t => (
            <div key={t.id} className="group flex items-center gap-1">
              <div className="flex-1 min-w-0">
                <TrackRow track={t} isActive={activeId === t.id} isPlaying={playing && activeId === t.id}
                  onPlay={() => { setCurrentPlaylist(pl.id); onPlay(t, pool); }}
                  liked={favorites.includes(t.id)} onLike={() => toggleFavorite(t.id)} onAdd={() => onAdd(t.id)}/>
              </div>
              <button type="button" onClick={() => removeFromPlaylist(pl.id, t.id)}
                className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 px-1 transition-opacity"
                style={{ color: 'var(--red)' }}>
                <X size={11}/>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-2">
      {/* Новый плейлист */}
      <div className="flex gap-2">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Новый плейлист..."
          className="flex-1 rounded-2xl px-3 py-2 text-xs outline-none"
          style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}
          onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { createPlaylist(newName.trim()); setNewName(''); } }}/>
        <button type="button" onClick={() => { if (newName.trim()) { createPlaylist(newName.trim()); setNewName(''); } }}
          className="rounded-2xl px-3 py-2" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
          <Plus size={14}/>
        </button>
      </div>

      {/* Список */}
      {playlists.map(pl => (
        <motion.div key={pl.id} className="group flex items-center gap-3 rounded-2xl px-3 py-2.5 cursor-pointer"
          style={{
            background: currentPlaylistId === pl.id ? 'var(--accent-bg)' : 'var(--bg-l2)',
            border:     `1px solid ${currentPlaylistId === pl.id ? 'rgba(79,110,247,0.3)' : 'var(--border)'}`,
          }}
          onClick={() => setCurrentPlaylist(currentPlaylistId === pl.id ? null : pl.id)}>
          <div className="grid h-9 w-9 place-items-center rounded-xl shrink-0" style={{ background: 'var(--accent-bg)' }}>
            <ListMusic size={14} style={{ color: 'var(--accent)' }}/>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{pl.name}</p>
            <p className="text-xs" style={{ color: 'var(--t3)' }}>{pl.trackIds.length} треков</p>
          </div>
          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={e => { e.stopPropagation(); setOpenId(pl.id); }}
              className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/10"
              style={{ color: 'var(--accent)' }}>
              <ArrowLeft size={11} style={{ transform: 'rotate(180deg)' }}/>
            </button>
            {pl.id !== 'pl-fav' && (
              <button type="button" onClick={e => { e.stopPropagation(); deletePlaylist(pl.id); }}
                className="grid h-6 w-6 place-items-center rounded-lg hover:bg-white/10"
                style={{ color: 'var(--red)' }}>
                <Trash2 size={11}/>
              </button>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
};
