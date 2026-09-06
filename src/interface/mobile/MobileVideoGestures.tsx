import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rewind, FastForward, Volume2, Sun, PictureInPicture2 } from 'lucide-react';
import { haptic } from './haptics';

const DOUBLE_TAP_MS = 280;

/** Жестовый слой поверх <video>: двойной тап слева/справа — перемотка ±10с,
 *  вертикальный свайп справа — громкость, слева — «яркость» (только
 *  внутриэкранное затемнение оверлеем — реальная яркость экрана устройству
 *  недоступна из веб-приложения без нативной обёртки, честно ограничиваемся
 *  визуальным приближением). PiP — настоящий, через Picture-in-Picture API. */
export const MobileVideoGestures = ({ videoRef, onSingleTap }: {
  videoRef: React.RefObject<HTMLVideoElement>;
  onSingleTap?: () => void;
}) => {
  const lastTap = useRef<{ t: number; side: 'left'|'right' } | null>(null);
  const tapTimer = useRef<number>(0);
  const [flash, setFlash] = useState<'left'|'right'|null>(null);
  const [volumeUI, setVolumeUI] = useState<number | null>(null);
  const [dimUI, setDimUI] = useState<number | null>(null);
  const [dim, setDim] = useState(0);
  const dragStart = useRef<{ y: number; val: number } | null>(null);
  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document;

  const seek = (delta: number) => {
    const v = videoRef.current; if (!v) return;
    v.currentTime = Math.min(v.duration || Infinity, Math.max(0, v.currentTime + delta));
    haptic('light');
  };

  const onTap = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const side: 'left'|'right' = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();

    if (lastTap.current && lastTap.current.side === side && now - lastTap.current.t < DOUBLE_TAP_MS) {
      clearTimeout(tapTimer.current);
      lastTap.current = null;
      seek(side === 'left' ? -10 : 10);
      setFlash(side);
      setTimeout(() => setFlash(null), 500);
      return;
    }
    lastTap.current = { t: now, side };
    tapTimer.current = window.setTimeout(() => { lastTap.current = null; onSingleTap?.(); }, DOUBLE_TAP_MS);
  };

  const onDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const side: 'left'|'right' = (e.clientX - rect.left) < rect.width / 2 ? 'left' : 'right';
    const v = videoRef.current;
    dragStart.current = { y: e.clientY, val: side === 'right' ? (v?.volume ?? 1) : dim };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    (dragStart.current as any).side = side;
  };
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const side = (dragStart.current as any).side as 'left'|'right';
    const rect = e.currentTarget.getBoundingClientRect();
    const delta = (dragStart.current.y - e.clientY) / rect.height; // вверх = плюс
    const next = Math.min(1, Math.max(0, dragStart.current.val + delta));
    if (side === 'right') {
      const v = videoRef.current; if (v) v.volume = next;
      setVolumeUI(next);
    } else {
      setDim(next);
      setDimUI(next);
    }
  };
  const onDragEnd = () => {
    dragStart.current = null;
    setTimeout(() => { setVolumeUI(null); setDimUI(null); }, 700);
  };

  const togglePiP = async () => {
    const v = videoRef.current; if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
      haptic('light');
    } catch {}
  };

  return (
    <div className="absolute inset-0 z-10" style={{ touchAction: 'none' }} onClick={e => e.stopPropagation()}>
      <div className="absolute inset-0 pointer-events-none" style={{ background: `rgba(0,0,0,${dim * 0.7})` }}/>

      <div className="absolute inset-0 flex">
        <div className="h-full w-1/2" onPointerDown={e => { onTap(e); onDragStart(e); }} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}/>
        <div className="h-full w-1/2" onPointerDown={e => { onTap(e); onDragStart(e); }} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}/>
      </div>

      <AnimatePresence>
        {flash && (
          <motion.div initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl px-4 py-3"
            style={{ [flash === 'left' ? 'left' : 'right']: '12%', background: 'rgba(0,0,0,0.55)' } as any}>
            {flash === 'left' ? <Rewind size={22} className="text-white"/> : <FastForward size={22} className="text-white"/>}
            <span className="text-[11px] font-bold text-white">10 сек</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {volumeUI !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute right-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl px-2.5 py-3" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <Volume2 size={16} className="text-white"/>
            <div className="h-20 w-1.5 overflow-hidden rounded-full bg-white/25">
              <div className="w-full bg-white" style={{ height: `${volumeUI*100}%`, marginTop: `${(1-volumeUI)*100}%` }}/>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {dimUI !== null && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="pointer-events-none absolute left-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-2xl px-2.5 py-3" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <Sun size={16} className="text-white"/>
            <div className="h-20 w-1.5 overflow-hidden rounded-full bg-white/25">
              <div className="w-full bg-white" style={{ height: `${(1-dimUI)*100}%`, marginTop: `${dimUI*100}%` }}/>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pipSupported && (
        <button type="button" onClick={(e) => { e.stopPropagation(); togglePiP(); }}
          className="pointer-events-auto absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <PictureInPicture2 size={14} className="text-white"/>
        </button>
      )}
    </div>
  );
};
