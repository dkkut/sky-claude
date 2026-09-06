import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { haptic } from './haptics';

const EDGE_ZONE = 24;      // px от левого края, где должен начаться свайп
const TRIGGER_RATIO = 0.32; // доля ширины экрана, после которой отпускание = «назад»

/** Оборачивает экран, добавляя жест «свайп от левого края — назад»,
 *  с лёгким параллаксом текущего экрана, как в iOS. */
export const SwipeBackView = ({ onBack, children, enabled = true }: {
  onBack: () => void; children: React.ReactNode; enabled?: boolean;
}) => {
  const startX = useRef<number | null>(null);
  const width = useRef(typeof window !== 'undefined' ? window.innerWidth : 400);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const triggeredHaptic = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled) return;
    if (e.clientX > EDGE_ZONE) { startX.current = null; return; }
    startX.current = e.clientX;
    width.current = window.innerWidth;
    triggeredHaptic.current = false;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (startX.current === null) return;
    const delta = Math.max(0, e.clientX - startX.current);
    setDx(delta);
    if (!triggeredHaptic.current && delta > width.current * TRIGGER_RATIO) {
      triggeredHaptic.current = true;
      haptic('selection');
    }
  };
  const onPointerUp = () => {
    if (startX.current === null) return;
    const shouldGoBack = dx > width.current * TRIGGER_RATIO;
    setDragging(false);
    startX.current = null;
    if (shouldGoBack) { haptic('light'); onBack(); }
    setDx(0);
  };

  return (
    <div
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      className="relative h-full w-full" style={{ touchAction: 'pan-y' }}>
      <motion.div
        className="h-full w-full"
        animate={{ x: dx }}
        transition={dragging ? { duration: 0 } : { type: 'spring', damping: 30, stiffness: 400 }}
        style={{ boxShadow: dx > 4 ? '-12px 0 30px rgba(0,0,0,0.35)' : 'none' }}>
        {children}
      </motion.div>
      {dx > 0 && (
        <div className="pointer-events-none absolute inset-y-0 left-0" style={{ width: dx * 0.35, background: 'linear-gradient(90deg, rgba(0,0,0,0.25), transparent)' }}/>
      )}
    </div>
  );
};
