/* --- Базовые UI-примитивы --------------------------------- */
import { memo, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Music2, Heart, FolderPlus, Send, Trash2, Lock, AlertCircle, CheckCircle } from 'lucide-react';
import type { Track, TrackStatus } from '@/platform/store';
import { getG, fmtPlays, fmtTime } from './utils';

/* -- Визуализатор ------------------------------------------- */
export const Viz = memo(({ playing, bars = 5 }: { playing: boolean; bars?: number }) => (
  <div className="flex items-end gap-[2px]" style={{ height: 16 }}>
    {Array.from({ length: bars }, (_, i) => (
      <motion.div key={i} className="w-[3px] rounded-full" style={{ background: '#A855F7' }}
        animate={playing ? { height: ['35%', '100%', '55%', '85%', '35%'] } : { height: '25%' }}
        transition={playing
          ? { duration: 0.45 + i * 0.07, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut', delay: i * 0.06 }
          : { duration: 0.3 }}/>
    ))}
  </div>
));

/* -- Прогресс-бар ------------------------------------------- */
export const ProgressBar = ({ current, total, onChange }: {
  current: number; total: number; onChange: (v: number) => void;
}) => {
  const pct      = total > 0 ? (current / total) * 100 : 0;
  const dragging = useRef(false);
  const barRef   = useRef<HTMLDivElement>(null);

  const calc = (e: MouseEvent | React.MouseEvent) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return;
    onChange(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
  };

  useEffect(() => {
    const up = () => { dragging.current = false; };
    const mv = (e: MouseEvent) => { if (dragging.current) calc(e); };
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', mv);
    return () => { window.removeEventListener('mouseup', up); window.removeEventListener('mousemove', mv); };
  }, [total]);

  return (
    <div className="group flex items-center gap-3">
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums" style={{ color: 'var(--t3)' }}>
        {fmtTime(current)}
      </span>
      <div ref={barRef} className="relative flex-1 cursor-pointer py-2 -my-2"
        onMouseDown={e => { dragging.current = true; calc(e); }}>
        <div className="h-1 w-full rounded-full overflow-hidden transition-all group-hover:h-[5px]"
          style={{ background: 'var(--border-m)' }}>
          <div className="h-full rounded-full"
            style={{ width: `${pct}%`, background: '#A855F7' }}/>
        </div>
        <div className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-lg
          opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{ left: `calc(${pct}% - 7px)`, background: '#A855F7' }}/>
      </div>
      <span className="w-9 shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--t3)' }}>
        {fmtTime(total)}
      </span>
    </div>
  );
};

/* -- Обложка трека ------------------------------------------ */
export const Cover = ({ track, size = 44, playing = false, active = false }: {
  track: Track; size?: number; playing?: boolean; active?: boolean;
}) => {
  const [c1, c2] = getG(track.id);
  return (
    <div className="relative overflow-hidden rounded-xl shrink-0 grid place-items-center"
      style={{ width: size, height: size, background: track.coverUrl ? undefined : `linear-gradient(135deg,${c1},${c2})` }}>
      {track.coverUrl && <img src={track.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover"/>}
      {!track.coverUrl && !active && <Music2 size={size * 0.36} style={{ color: 'rgba(255,255,255,0.4)' }}/>}
      {active && playing && (
        <div className="absolute inset-0 grid place-items-center"
          style={{ background: track.coverUrl ? 'rgba(0,0,0,0.5)' : undefined }}>
          <Viz playing bars={4}/>
        </div>
      )}
      {active && !playing && !track.coverUrl && (
        <Music2 size={size * 0.36} style={{ color: 'rgba(255,255,255,0.4)' }}/>
      )}
    </div>
  );
};

/* -- Статусы треков ----------------------------------------- */

export const STATUS_CFG: Record<TrackStatus, { label: string; color: string; bg: string; icon: any }> = {
  private:   { label: 'Личный',      color: 'var(--t2)', bg: 'rgba(139,147,168,0.1)', icon: Lock },
  pending:   { label: 'Модерация',   color: 'var(--amber)',   bg: 'rgba(245,158,11,0.1)',  icon: AlertCircle },
  published: { label: 'Опубликован', color: '#22c55e',   bg: 'rgba(34,197,94,0.1)',   icon: CheckCircle },
};

/* -- Строка трека ------------------------------------------- */
export const TrackRow = memo(({
  track, index, isActive, isPlaying, onPlay, liked, onLike, onAdd,
  showStatus, onSubmit, onDelete, compact, onArtist,
}: {
  track: Track; index?: number; isActive: boolean; isPlaying: boolean;
  onPlay: () => void; liked: boolean; onLike: () => void; onAdd: () => void;
  showStatus?: boolean; onSubmit?: () => void; onDelete?: () => void;
  compact?: boolean; onArtist?: (name: string) => void;
}) => {
  const sb = STATUS_CFG[track.status];
  return (
    <motion.div whileHover={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
      className="group flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition-colors"
      style={{
        background:  isActive ? 'rgba(79,110,247,0.1)' : 'transparent',
        border:      isActive ? '1px solid rgba(79,110,247,0.2)' : '1px solid transparent',
      }}
      onClick={onPlay}>

      {/* Номер (не compact) */}
      {index != null && !compact && (
        <span className="w-5 shrink-0 text-center text-xs tabular-nums"
          style={{ color: index < 3 ? 'var(--amber)' : 'var(--t3)' }}>{index + 1}</span>
      )}

      <Cover track={track} size={compact ? 36 : 44} playing={isPlaying} active={isActive}/>

      {/* Инфо */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium" style={{ color: isActive ? '#A855F7' : 'var(--t1)' }}>
            {track.title}
          </p>
          {showStatus && (
            <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-medium shrink-0"
              style={{ background: sb.bg, color: sb.color }}>
              <sb.icon size={8}/>{sb.label}
            </span>
          )}
        </div>
        <p className="truncate text-xs" style={{ color: 'var(--t3)' }}>
          <button type="button" className="hover:underline"
            style={{ color: 'var(--t3)' }}
            onClick={e => { e.stopPropagation(); onArtist?.(track.artist); }}>
            {track.artist}
          </button>
          {!compact && <span> · {track.genre}</span>}
        </p>
      </div>

      {/* Действия */}
      <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={e => { e.stopPropagation(); onLike(); }}
          className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/10">
          <Heart size={13} className={liked ? 'fill-red-400 text-red-400' : ''}
            style={{ color: liked ? undefined : 'rgba(255,255,255,0.35)' }}/>
        </button>
        <button type="button" onClick={e => { e.stopPropagation(); onAdd(); }}
          className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/10">
          <FolderPlus size={13} style={{ color: 'rgba(255,255,255,0.35)' }}/>
        </button>
        {onSubmit && track.status === 'private' && (
          <button type="button" onClick={e => { e.stopPropagation(); onSubmit(); }}
            className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/10">
            <Send size={12} style={{ color: 'var(--accent)' }}/>
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={e => { e.stopPropagation(); onDelete(); }}
            className="grid h-7 w-7 place-items-center rounded-lg hover:bg-white/10">
            <Trash2 size={12} style={{ color: 'var(--red)' }}/>
          </button>
        )}
      </div>

      {/* Длительность / просмотры */}
      {!compact && (
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--t3)' }}>{track.duration}</span>
      )}
      {compact && track.plays > 0 && (
        <span className="text-[10px] shrink-0" style={{ color: 'var(--t3)' }}>{fmtPlays(track.plays)}</span>
      )}
    </motion.div>
  );
});
