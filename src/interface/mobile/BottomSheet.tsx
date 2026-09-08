import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useAnimation, PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { haptic } from './haptics';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Доли высоты экрана для точек раскрытия, от меньшей к большей, напр. [0.45, 0.92].
   *  Одна точка = обычный несворачиваемый шит. */
  snapPoints?: number[];
  initialSnap?: number;
  showHandle?: boolean;
  showClose?: boolean;
}

export const BottomSheet = ({
  open, onClose, title, children,
  snapPoints = [0.9], initialSnap = 0, showHandle = true, showClose = false,
}: BottomSheetProps) => {
  const controls = useAnimation();
  const [snap, setSnap] = useState(Math.min(initialSnap, snapPoints.length - 1));
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const sheetRef = useRef<HTMLDivElement>(null);

  const heightFor = (i: number) => vh * snapPoints[i];

  useEffect(() => {
    if (open) {
      setSnap(Math.min(initialSnap, snapPoints.length - 1));
      // Анимированный въезд снизу — без .set(), чтобы реально сыграла анимация,
      // а не мгновенный прыжок.
      controls.start({ y: 0, transition: { type: 'spring', damping: 32, stiffness: 300 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onDragEnd = (_: any, info: PanInfo) => {
    const draggedPx = info.offset.y;
    const velocity = info.velocity.y;

    // быстрый свайп вниз — закрыть
    if (velocity > 800 || draggedPx > heightFor(snap) * 0.4) {
      haptic('light');
      controls.start({ y: heightFor(snap) + 40, transition: { duration: 0.22 } }).then(onClose);
      return;
    }
    // свайп вверх достаточно сильный — перейти на следующую точку раскрытия
    if (draggedPx < -60 && snap < snapPoints.length - 1) {
      haptic('selection');
      setSnap(snap + 1);
      controls.start({ y: 0, transition: { type: 'spring', damping: 32, stiffness: 300 } });
      return;
    }
    // свайп вниз, но недостаточно — перейти на предыдущую точку раскрытия
    if (draggedPx > 60 && snap > 0) {
      haptic('selection');
      setSnap(snap - 1);
      controls.start({ y: 0, transition: { type: 'spring', damping: 32, stiffness: 300 } });
      return;
    }
    controls.start({ y: 0, transition: { type: 'spring', damping: 32, stiffness: 340 } });
  };

  const sheet = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90]"
            style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
          />
          <motion.div
            key="sheet"
            ref={sheetRef}
            drag="y"
            dragElastic={0.06}
            dragConstraints={{ top: 0, bottom: 0 }}
            onDragEnd={onDragEnd}
            style={{
              height: heightFor(snap),
              background: 'var(--bg-l1)',
              boxShadow: '0 -20px 60px rgba(0,0,0,0.45)',
              paddingBottom: 'var(--safe-bottom)',
              touchAction: 'none',
            }}
            animate={controls}
            initial={{ y: '100%' }}
            exit={{ y: '100%', transition: { duration: 0.22 } }}
            className="fixed inset-x-0 bottom-0 z-[91] flex flex-col rounded-t-[28px]">
            {showHandle && (
              <div className="flex shrink-0 justify-center pb-1 pt-2.5">
                <div className="h-1.5 w-10 rounded-full" style={{ background: 'var(--border-m, rgba(255,255,255,0.18))' }}/>
              </div>
            )}
            {(title || showClose) && (
              <div className="flex shrink-0 items-center justify-between px-5 pb-2 pt-1">
                {title && <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>{title}</p>}
                {showClose && (
                  <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <X size={15} style={{ color: 'var(--t2)' }}/>
                  </button>
                )}
              </div>
            )}
            <div className="flex-1 overflow-y-auto overscroll-contain px-1">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Рендерим через Portal напрямую в <body> — так шит гарантированно не может
  // оказаться "под" каким-нибудь предком с transform/filter/backdrop-filter,
  // который создаёт свой containing block для position:fixed и рвёт слой.
  if (typeof document === 'undefined') return null;
  return createPortal(sheet, document.body);
};
