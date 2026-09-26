/* ===========================================================
   SKY CAR MODE — мини-плеер.
   Читает и управляет ЕДИНСТВЕННЫМ состоянием музыки (usePlayerStore) —
   тот же канал, которым уже пользуется обычный SkyMiniPlayer, поэтому
   открытие Car Mode не перезапускает и не дублирует музыку.
=========================================================== */
import { Play, Pause, SkipBack, SkipForward, Music2 } from 'lucide-react';
import { usePlayerStore } from '@/player/playerStore';
import { CAR_GLASS, CAR_GLASS_BORDER, CAR_BLUR } from './CarShell';

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export const CarMiniPlayer = ({ compact }: { compact?: boolean }) => {
  const item = usePlayerStore(s => s.item);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const currentTime = usePlayerStore(s => s.currentTime);
  const duration = usePlayerStore(s => s.duration);
  const setPlaying = usePlayerStore(s => s.setPlaying);
  const nextTrack = usePlayerStore(s => s.nextTrack);
  const prevTrack = usePlayerStore(s => s.prevTrack);

  if (!item) {
    return (
      <div className={`flex items-center gap-3 rounded-3xl ${compact ? 'px-4 py-3' : 'px-6 py-5'}`}
        style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
        <Music2 size={compact ? 18 : 24} color="rgba(255,255,255,0.35)" />
        <p className="text-[13px] font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>Ничего не играет</p>
      </div>
    );
  }

  const pct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`flex items-center gap-3 rounded-3xl ${compact ? 'px-4 py-3' : 'px-6 py-5'}`}
      style={{ background: CAR_GLASS, border: CAR_GLASS_BORDER, backdropFilter: CAR_BLUR }}>
      <div className={compact ? 'h-10 w-10 shrink-0 rounded-xl overflow-hidden' : 'h-16 w-16 shrink-0 rounded-2xl overflow-hidden'}
        style={{ background: item.coverUrl ? `center/cover no-repeat url(${item.coverUrl})` : 'linear-gradient(160deg,#4f2e8a,#1a0e33)' }} />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-bold text-white ${compact ? 'text-[13px]' : 'text-[16px]'}`}>{item.title}</p>
        <p className={`truncate ${compact ? 'text-[11px]' : 'text-[13px]'}`} style={{ color: 'rgba(255,255,255,0.5)' }}>{item.author}</p>
        {!compact && (
          <div className="mt-2 h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={prevTrack}
          className={`grid place-items-center rounded-full ${compact ? 'h-9 w-9' : 'h-12 w-12'}`} style={{ background: 'rgba(255,255,255,0.08)' }}>
          <SkipBack size={compact ? 14 : 18} color="#fff" />
        </button>
        <button type="button" onClick={() => setPlaying(!isPlaying)}
          className={`grid place-items-center rounded-full ${compact ? 'h-9 w-9' : 'h-14 w-14'}`} style={{ background: 'var(--accent)' }}>
          {isPlaying
            ? <Pause size={compact ? 14 : 20} color="#fff" fill="#fff" />
            : <Play size={compact ? 14 : 20} color="#fff" fill="#fff" />}
        </button>
        <button type="button" onClick={nextTrack}
          className={`grid place-items-center rounded-full ${compact ? 'h-9 w-9' : 'h-12 w-12'}`} style={{ background: 'rgba(255,255,255,0.08)' }}>
          <SkipForward size={compact ? 14 : 18} color="#fff" />
        </button>
      </div>
      {!compact && <p className="text-[12px] font-semibold shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>{fmt(currentTime)} / {fmt(duration)}</p>}
    </div>
  );
};
