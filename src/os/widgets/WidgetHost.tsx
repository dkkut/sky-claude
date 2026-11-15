/**
 * Хост виджетов: каждый — собственное окно поверх содержимого с кнопкой закрытия; фон слегка затемняется.
 * Окна можно перетаскивать (на телефоне — нет: там они встают по центру). Позиции помнятся на устройстве.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useIsMobile } from '@/interface/mobile/useIsMobile';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { useWidgets, WIDGET_TITLES, type WidgetId } from './widgetStore';
import { WeatherWidget, MusicWidget, NotificationsWidget, ResourcesWidget, QuickWidget, AiWidget, WalletWidget } from './widgets';

const BODY: Record<WidgetId, () => JSX.Element> = {
  weather: WeatherWidget, music: MusicWidget, notifications: NotificationsWidget, resources: ResourcesWidget, quick: QuickWidget, ai: AiWidget, wallet: WalletWidget,
};

const WidgetWindow = ({ id, index, count }: { id: WidgetId; index: number; count: number }) => {
  const isMobile = useIsMobile();
  const pos = useWidgets(s => s.pos[id]); const close = useWidgets(s => s.close); const move = useWidgets(s => s.move);
  const Body = BODY[id];
  return (
    <motion.div role="dialog" aria-label={WIDGET_TITLES[id]} data-keep-dark
      drag={!isMobile} dragMomentum={false} dragElastic={0.05}
      onDragEnd={(_e, info) => move(id, { x: (pos?.x ?? 0) + info.offset.x, y: (pos?.y ?? 0) + info.offset.y })}
      initial={{ opacity: 0, scale: 0.94, x: pos?.x ?? 0, y: (pos?.y ?? 0) + 12 }} animate={{ opacity: 1, scale: 1, x: pos?.x ?? 0, y: pos?.y ?? 0 }} exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
      className="absolute text-white"
      style={{
        left: isMobile ? '50%' : `calc(50% - 170px + ${Math.round((index - (count - 1) / 2) * 360)}px)`, top: isMobile ? `calc(env(safe-area-inset-top, 0px) + 70px + ${index * 18}px)` : '96px',
        marginLeft: isMobile ? 'calc(min(92vw, 360px) / -2)' : 0, width: isMobile ? 'min(92vw, 360px)' : 340, borderRadius: 28, pointerEvents: 'auto',
        background: 'rgba(22,18,44,0.82)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(28px) saturate(1.4)', WebkitBackdropFilter: 'blur(28px) saturate(1.4)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.55)', fontFamily: "'Manrope',system-ui,sans-serif", cursor: isMobile ? 'default' : 'grab',
      }}>
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <p className="text-[12px] font-extrabold tracking-[0.12em]" style={{ color: 'rgba(255,255,255,0.7)' }}>{WIDGET_TITLES[id].toUpperCase()}</p>
        <button type="button" aria-label={`Закрыть: ${WIDGET_TITLES[id]}`} onClick={() => close(id)} onPointerDownCapture={e => e.stopPropagation()}
          className="grid h-8 w-8 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }}><X size={16} /></button>
      </div>
      <div className="px-4 pb-4 pt-1" onPointerDownCapture={e => e.stopPropagation()} style={{ cursor: 'default' }}>
        <ErrorBoundary><Body /></ErrorBoundary>
      </div>
    </motion.div>
  );
};

export const WidgetHost = () => {
  const open = useWidgets(s => s.open); const closeAll = useWidgets(s => s.closeAll);
  React.useEffect(() => {
    if (open.length === 0) return undefined;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAll(); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [open.length, closeAll]);
  return createPortal(
    <AnimatePresence>
      {open.length > 0 && (
        <motion.div key="wd" className="fixed inset-0 z-[9000]" style={{ pointerEvents: 'none' }}>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeAll} aria-hidden
            className="absolute inset-0" style={{ background: 'rgba(5,4,14,0.4)', backdropFilter: 'blur(2px)', pointerEvents: 'auto' }} />
          {open.map((id, i) => <WidgetWindow key={id} id={id} index={i} count={open.length} />)}
        </motion.div>
      )}
    </AnimatePresence>, document.body);
};
