/**
 * Полноэкранный плеер музыки для общего мини-плеера (телефон): тот же `SkyPcPlayer`, что и в Sky Music,
 * только данные берутся из общего стора плеера, а не из экрана Sky Music.
 */
import React, { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { usePlayerStore, type PlayerItem } from '@/player/playerStore';
import { useMusicStore } from '@/music/serverStore';
import { AddToPlaylistModal } from '@/music/AddToPlaylistModal';
import { openArtistCard } from '@/music/artistBridge';
import { SkyPcPlayer } from '@/music/PcPlayer';
import type { Track } from '@/platform/store';

const toTrack = (q: PlayerItem): Track => ({
  id: q.id, title: q.title, artist: q.author, genre: '', duration: q.duration ? `${Math.floor(q.duration / 60)}:${String(Math.floor(q.duration % 60)).padStart(2, '0')}` : '',
  premium: false, addedAt: '', status: 'published', plays: 0, likes: [], coverUrl: q.coverUrl, videoUrl: q.videoUrl, explicit: q.explicit, legacy: q.legacy,
  syncedLyrics: q.lyrics,
});

export const MusicFullHost = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const item = usePlayerStore(s => s.item);
  const playing = usePlayerStore(s => s.isPlaying);
  const cur = usePlayerStore(s => s.currentTime);
  const dur = usePlayerStore(s => s.duration);
  const volume = usePlayerStore(s => s.volume);
  const shuffle = usePlayerStore(s => s.shuffle);
  const repeat = usePlayerStore(s => s.repeat);
  const st = usePlayerStore.getState;
  const favorites = useMusicStore(s => s.favorites);
  const toggleFavorite = useMusicStore(s => s.toggleFavorite);
  const [addId, setAddId] = useState<string | null>(null);
  const queue = useMemo(() => (item?.queue ?? (item ? [item] : [])).map(toTrack), [item]);
  const idx = item?.qIdx ?? 0;
  if (!item) return null;
  const track = queue[idx] ?? toTrack(item);
  return (
    <>
      <AnimatePresence>
        {open && (
          <SkyPcPlayer track={track} playing={playing} currentTime={cur} duration={dur} volume={volume} shuffle={shuffle} repeat={repeat}
            favorites={favorites} queue={queue} queueIdx={idx}
            onPlay={() => st().requestPlay(!st().isPlaying)} onPrev={() => st().prevTrack()} onNext={() => st().nextTrack()}
            onSeek={t => st().requestSeek(t)} onVolume={v => st().setVolume(v)}
            onShuffle={() => st().setShuffle(!st().shuffle)}
            onRepeat={() => { const r = st().repeat; st().setRepeat(r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'); }}
            onLike={id => { void toggleFavorite(id); }} onAdd={id => setAddId(id)}
            onArtist={a => { onClose(); openArtistCard(a); }} onClose={onClose} />
        )}
      </AnimatePresence>
      <AddToPlaylistModal trackId={addId} onClose={() => setAddId(null)} />
    </>
  );
};
