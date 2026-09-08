/* -- Модал «Добавить в плейлист» --------------------------- */
import { motion, AnimatePresence } from 'framer-motion';
import { X, ListMusic, Check } from 'lucide-react';
import { useMusicStore } from '@/music/serverStore';

interface Props {
  trackId: string | null;
  onClose: () => void;
}

export const AddToPlaylistModal = ({ trackId, onClose }: Props) => {
  // Плейлисты серверные: добавление проверяется правами, а не доверием
  // к нажатой кнопке.
  const playlists = useMusicStore(s => s.playlists);
  const addToPlaylist = useMusicStore(s => s.addToPlaylist);
  const removeFromPlaylist = useMusicStore(s => s.removeFromPlaylist);

  return (
    <AnimatePresence>
      {trackId && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="absolute inset-0 z-[60] grid place-items-center px-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onClick={onClose}>
          <motion.div initial={{ scale: 0.9, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9 }}
            className="w-full max-w-xs rounded-3xl p-5"
            style={{ background: 'var(--bg-l1)', border: '1px solid var(--border-m)' }}
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-white">Добавить в плейлист</p>
              <button type="button" onClick={onClose} style={{ color: 'var(--t3)' }}>
                <X size={15}/>
              </button>
            </div>

            <div className="space-y-1.5">
              {playlists.map(pl => {
                const has = pl.trackIds.includes(trackId);
                return (
                  <button key={pl.id} type="button"
                    onClick={() => {
                      void (has ? removeFromPlaylist(pl.id, trackId) : addToPlaylist(pl.id, trackId));
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/5">
                    <ListMusic size={14} style={{ color: '#A855F7' }}/>
                    <span className="flex-1 text-sm text-white text-left">{pl.name}</span>
                    {has && <Check size={13} style={{ color: '#22c55e' }}/>}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
