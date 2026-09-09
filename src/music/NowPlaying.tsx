/* -- Полноэкранный плеер ----------------------------------- */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, FolderPlus, Heart, Shuffle, SkipBack, Play, Pause,
  SkipForward, Repeat, Volume2, VolumeX, Mic2, ListOrdered, Music2,
} from 'lucide-react';
import type { Track } from '@/platform/store';
import type { RepeatMode } from './types';
import { getG } from './utils';
import { ProgressBar, Cover } from './MusicPrimitives';

interface Props {
  track:       Track;
  playing:     boolean;
  currentTime: number;
  duration:    number;
  volume:      number;
  shuffle:     boolean;
  repeat:      RepeatMode;
  favorites:   string[];
  queue:       Track[];
  queueIdx:    number;
  onPlay:      () => void;
  onPrev:      () => void;
  onNext:      () => void;
  onSeek:      (v: number) => void;
  onVolume:    (v: number) => void;
  onShuffle:   () => void;
  onRepeat:    () => void;
  onLike:      (id: string) => void;
  onAdd:       (id: string) => void;
  onClose:     () => void;
}

export const NowPlaying = ({
  track, playing, currentTime, duration, volume, shuffle, repeat,
  favorites, queue, queueIdx,
  onPlay, onPrev, onNext, onSeek, onVolume, onShuffle, onRepeat,
  onLike, onAdd, onClose,
}: Props) => {
  const [showQueue,  setShowQueue]  = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [showVideo,  setShowVideo]  = useState(false);
  const [c1, c2] = getG(track.id);
  const liked    = favorites.includes(track.id);

  // Клип показываем только тогда, когда сам файл трека и есть видео.
  // Отдельного хранилища клипов нет, и подставлять сюда чужие ролики
  // мы не будем.
  const videoUrl = track.sourceUrl?.match(/\.(mp4|webm|mov)$/i) ? track.sourceUrl : null;
  const hasVideo = !!videoUrl;

  return (
    <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{ background: 'var(--bg)' }}>

      {/* Фон */}
      <motion.div key={track.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse 90% 60% at 50% 0%,${c1}cc,transparent 55%),radial-gradient(ellipse 60% 50% at 80% 90%,${c2}80,transparent 50%)` }}/>

      {/* Видеоклип на фоне */}
      {showVideo && hasVideo && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="pointer-events-none absolute inset-0 z-0">
          <video
            src={videoUrl!}
            autoPlay muted loop playsInline
            className="absolute inset-0 w-full h-full object-cover"
            style={{ opacity: 0.35 }}
          />
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.6) 100%)' }}/>
        </motion.div>
      )}

      {/* Ambient визуализация (без видео) */}
      {!hasVideo && playing && (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden opacity-20">
          {[...Array(6)].map((_,i) => (
            <div key={i} className="absolute rounded-full"
              style={{
                width: `${120 + i * 80}px`,
                height: `${120 + i * 80}px`,
                border: `1px solid ${i % 2 === 0 ? c1 : c2}`,
                animation: `music-ring ${2 + i * 0.4}s ease-in-out infinite`,
                animationDelay: `${i * 0.3}s`,
              }}/>
          ))}
        </div>
      )}

      {/* Шапка */}
      <div className="relative z-10 flex items-center justify-between px-5 pt-5 pb-2 shrink-0">
        <button type="button" onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-2xl"
          style={{ background: 'var(--border)' }}>
          <ChevronDown size={18} style={{ color: 'var(--t2)' }}/>
        </button>
        <p className="text-[11px] font-semibold" style={{ color: 'var(--t3)' }}>
          {queueIdx + 1} / {queue.length}
        </p>
        <button type="button" onClick={() => onAdd(track.id)}
          className="grid h-9 w-9 place-items-center rounded-2xl"
          style={{ background: 'var(--border)' }}>
          <FolderPlus size={16} style={{ color: 'var(--t2)' }}/>
        </button>
      </div>

      {/* Центр */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-between px-6 pb-4 overflow-hidden">
        <AnimatePresence mode="wait">

          {/* Обложка */}
          {!showQueue && !showLyrics && (
            <motion.div key="cover" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }} className="flex flex-col items-center w-full">
              <motion.div key={track.id} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="relative overflow-hidden rounded-3xl shadow-2xl grid place-items-center"
                style={{ width: 220, height: 220,
                  background: track.coverUrl ? undefined : `linear-gradient(135deg,${c1},${c2})`,
                  boxShadow: `0 24px 80px ${c1}99, 0 0 0 1px rgba(255,255,255,0.06)` }}>
                {track.coverUrl
                  ? <img src={track.coverUrl} alt="" className="w-full h-full object-cover"/>
                  : playing
                    ? <div className="flex items-end gap-3 h-20">
                        {[1,2,3,4,5,6].map(i => (
                          <motion.div key={i} className="w-3 rounded-full" style={{ background: 'rgba(255,255,255,0.6)' }}
                            animate={{ height: ['20%','80%','45%','100%','30%'][i % 5] }}
                            transition={{ duration: 0.5 + i * 0.08, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut', delay: i * 0.05 }}/>
                        ))}
                      </div>
                    : <Music2 size={80} style={{ color: 'rgba(255,255,255,0.3)' }}/>
                }
              </motion.div>

              <div className="flex items-center gap-3 mt-6 w-full px-2">
                <div className="flex-1 min-w-0">
                  <motion.p key={track.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="text-xl font-black truncate text-white">{track.title}</motion.p>
                  <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--t2)' }}>{track.artist}</p>
                </div>
                <motion.button type="button" whileTap={{ scale: 0.85 }} onClick={() => onLike(track.id)}
                  className="grid h-10 w-10 place-items-center rounded-full shrink-0"
                  style={{ background: liked ? 'rgba(248,113,113,0.15)' : 'var(--border)' }}>
                  <Heart size={20} className={liked ? 'fill-red-400 text-red-400' : ''}
                    style={{ color: liked ? undefined : 'rgba(255,255,255,0.4)' }}/>
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* Очередь */}
          {showQueue && (
            <motion.div key="queue" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }} className="w-full h-full flex flex-col overflow-hidden">
              <p className="text-sm font-bold text-white mb-3">Очередь</p>
              <div className="flex-1 overflow-y-auto space-y-0.5">
                {queue.map((t, i) => (
                  <div key={t.id + i} className="flex items-center gap-2 rounded-xl px-2 py-1.5"
                    style={{ background: i === queueIdx ? 'rgba(79,110,247,0.15)' : 'transparent' }}>
                    <Cover track={t} size={32} active={i === queueIdx} playing={playing && i === queueIdx}/>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-xs font-semibold"
                        style={{ color: i === queueIdx ? '#A855F7' : 'var(--t1)' }}>{t.title}</p>
                      <p className="truncate text-[10px]" style={{ color: 'var(--t3)' }}>{t.artist}</p>
                    </div>
                    <span className="text-[10px] tabular-nums" style={{ color: 'var(--t3)' }}>{t.duration}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Текст */}
          {showLyrics && (
            <motion.div key="lyrics" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }} className="w-full h-full flex flex-col overflow-hidden">
              <p className="text-sm font-bold text-white mb-3">Текст</p>
              <div className="flex-1 overflow-y-auto">
                {track.lyrics
                  ? <p className="whitespace-pre-line text-sm leading-loose" style={{ color: 'rgba(255,255,255,0.7)' }}>{track.lyrics}</p>
                  : <p className="text-sm" style={{ color: 'var(--t3)' }}>Текст не добавлен</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Контролы */}
        <div className="w-full max-w-sm space-y-4 mt-4">
          <ProgressBar current={currentTime} total={duration} onChange={onSeek}/>

          <div className="flex items-center justify-between">
            <motion.button type="button" whileTap={{ scale: 0.88 }} onClick={onShuffle}
              className="grid h-10 w-10 place-items-center rounded-full"
              style={{ background: shuffle ? 'rgba(168,85,247,0.15)' : 'transparent', color: shuffle ? '#A855F7' : 'var(--t3)' }}>
              <Shuffle size={17}/>
            </motion.button>

            <div className="flex items-center gap-3">
              <motion.button type="button" whileTap={{ scale: 0.88 }} onClick={onPrev}
                className="grid h-11 w-11 place-items-center rounded-full" style={{ color: 'var(--t1)' }}>
                <SkipBack size={26} fill="currentColor"/>
              </motion.button>
              <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={onPlay}
                className="grid h-16 w-16 place-items-center rounded-full"
                style={{ background: '#A855F7', boxShadow: '0 8px 32px rgba(168,85,247,0.4)' }}>
                {playing
                  ? <Pause size={28} fill="white" className="text-white"/>
                  : <Play  size={28} fill="white" className="text-white ml-1"/>}
              </motion.button>
              <motion.button type="button" whileTap={{ scale: 0.88 }} onClick={onNext}
                className="grid h-11 w-11 place-items-center rounded-full" style={{ color: 'var(--t1)' }}>
                <SkipForward size={26} fill="currentColor"/>
              </motion.button>
            </div>

            <motion.button type="button" whileTap={{ scale: 0.88 }} onClick={onRepeat}
              className="grid h-10 w-10 place-items-center rounded-full relative"
              style={{ background: repeat !== 'off' ? 'rgba(168,85,247,0.15)' : 'transparent', color: repeat !== 'off' ? '#A855F7' : 'var(--t3)' }}>
              <Repeat size={17}/>
              {repeat === 'one' && (
                <span className="absolute bottom-0.5 right-0.5 text-[7px] font-black" style={{ color: '#A855F7' }}>1</span>
              )}
            </motion.button>
          </div>

          {/* Громкость */}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => onVolume(volume === 0 ? 0.7 : 0)} style={{ color: 'var(--t3)' }}>
              {volume === 0 ? <VolumeX size={14}/> : <Volume2 size={14}/>}
            </button>
            <div className="relative flex-1 h-1 rounded-full cursor-pointer" style={{ background: 'var(--border-m)' }}
              onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onVolume((e.clientX - r.left) / r.width); }}>
              <div className="h-full rounded-full" style={{ width: `${volume * 100}%`, background: 'rgba(255,255,255,0.45)' }}/>
            </div>
          </div>

          {/* Переключатели вида */}
          <div className="flex items-center justify-center gap-4">
            <button type="button" onClick={() => { setShowLyrics(v => !v); setShowQueue(false); }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              style={{ background: showLyrics ? 'rgba(168,85,247,0.15)' : 'var(--border)', color: showLyrics ? '#A855F7' : 'var(--t3)' }}>
              <Mic2 size={12}/>Текст
            </button>
            <button type="button" onClick={() => { setShowQueue(v => !v); setShowLyrics(false); }}
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
              style={{ background: showQueue ? 'rgba(168,85,247,0.15)' : 'var(--border)', color: showQueue ? '#A855F7' : 'var(--t3)' }}>
              <ListOrdered size={12}/>Очередь
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
