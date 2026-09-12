/* ======================================================================
   SKY MARKET / LOGISTICS  —  Shared UI primitives
====================================================================== */
import { PropsWithChildren } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bike, Car, Truck as VanIcon, Footprints, MapPin } from 'lucide-react';
import type { IconComponent } from '@/shared/icon';
import { C } from '../SkyMarket';
import { CITIES, toMapPercent } from './geo';
import type { CourierVehicle, GeoPoint } from './types';

/* ── Full-panel slide (как CartDrawer/Checkout в SkyMarket) ──────── */
export const SlidePanel = ({
  open, onClose, title, children, onBack,
}: PropsWithChildren<{ open: boolean; onClose: () => void; title: string; onBack?: () => void }>) => (
  <AnimatePresence>
    {open && (
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
        className="absolute inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
        <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: `1px solid ${C.brd}` }}>
          <button type="button" onClick={onBack ?? onClose}
            className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.t3 }}>
            <X size={18}/>
          </button>
          <p className="flex-1 text-base font-bold truncate" style={{ color: C.t1 }}>{title}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {children}
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

/* ── Маленькая центрированная модалка для быстрых действий ───────── */
export const ConfirmModal = ({
  open, onClose, title, children,
}: PropsWithChildren<{ open: boolean; onClose: () => void; title: string }>) => (
  <AnimatePresence>
    {open && (
      <motion.div className="absolute inset-0 z-[60] flex items-center justify-center p-6"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}/>
        <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
          className="relative w-full max-w-[340px] rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-sm font-bold mb-3" style={{ color: C.t1 }}>{title}</p>
          {children}
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

/* ── Пустое состояние ─────────────────────────────────────────────── */
export const EmptyState = ({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 px-6 text-center">
    <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: C.l2 }}>
      <Icon size={20} style={{ color: C.t3 }}/>
    </div>
    <p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>
    {sub && <p className="text-xs max-w-[260px]" style={{ color: C.t3 }}>{sub}</p>}
  </div>
);

/* ── Иконка транспорта курьера ───────────────────────────────────── */
export const VEHICLE_CFG: Record<CourierVehicle, { label: string; icon: IconComponent }> = {
  foot:    { label: 'Пешком',  icon: Footprints },
  bike:    { label: 'Велосипед', icon: Bike },
  scooter: { label: 'Скутер',  icon: Bike },
  car:     { label: 'Авто',    icon: Car },
  van:     { label: 'Фургон',  icon: VanIcon },
};

/* ── Сегмент-контрол ──────────────────────────────────────────────── */
export const Segmented = <T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) => (
  <div className="flex rounded-xl p-1" style={{ background: C.l2 }}>
    {options.map(o => (
      <button key={o.key} type="button" onClick={() => onChange(o.key)}
        className="flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors"
        style={{ background: value===o.key ? C.l3 : 'transparent', color: value===o.key ? C.t1 : C.t3 }}>
        {o.label}
      </button>
    ))}
  </div>
);

/* ── Мини-карта (CSS/SVG имитация real-time карты, без внешних сервисов) ── */
export const MiniMap = ({
  cityId, points, height = 200,
}: {
  cityId: string;
  points: { id: string; pos: GeoPoint; label: string; Icon?: IconComponent; online?: boolean; highlight?: boolean }[];
  height?: number;
}) => {
  const city = CITIES.find(c => c.id === cityId) ?? CITIES[0];
  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ height, background: 'radial-gradient(circle at 30% 20%, rgba(79,110,247,0.12), transparent 60%), var(--bg-l2)', border: `1px solid ${C.brd}` }}>
      {/* псевдо-сетка улиц */}
      <svg className="absolute inset-0 h-full w-full opacity-30" viewBox="0 0 100 100" preserveAspectRatio="none">
        {[15,32,50,68,85].map(v => (<line key={'v'+v} x1={v} y1={0} x2={v} y2={100} stroke="white" strokeWidth="0.3"/>))}
        {[18,38,58,78].map(h => (<line key={'h'+h} x1={0} y1={h} x2={100} y2={h} stroke="white" strokeWidth="0.3"/>))}
      </svg>
      <div className="absolute top-2 left-2 text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: 'rgba(0,0,0,0.4)', color: C.t2 }}>
        {city.name}
      </div>
      {points.map(pt => {
        const { x, y } = toMapPercent(pt.pos, cityId);
        return (
          <motion.div key={pt.id} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
            style={{ left: `${x}%`, top: `${y}%` }}
            animate={{ left: `${x}%`, top: `${y}%` }} transition={{ duration: 1.2, ease: 'easeInOut' }}>
            <div className="grid place-items-center rounded-full shadow-lg"
              style={{ height: pt.highlight ? 30 : 24, width: pt.highlight ? 30 : 24,
                background: pt.online === false ? 'var(--bg-l3)' : `linear-gradient(135deg,${C.acc},#8b5cf6)`,
                border: pt.highlight ? `2px solid ${C.amber}` : '2px solid rgba(255,255,255,0.2)' }}>
              {(() => { const Icon = pt.Icon ?? MapPin; return <Icon size={pt.highlight ? 15 : 13} color="#fff"/>; })()}
            </div>
            {pt.online && (
              <motion.div className="absolute rounded-full" style={{ height: 24, width: 24, border: `1.5px solid ${C.acc}` }}
                animate={{ scale: [1, 1.8], opacity: [0.6, 0] }} transition={{ duration: 2, repeat: Infinity }}/>
            )}
            <span className="mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={{ background: 'rgba(0,0,0,0.5)', color: C.t1 }}>{pt.label}</span>
          </motion.div>
        );
      })}
    </div>
  );
};

/* ── Статус-точка online/offline ─────────────────────────────────── */
export const OnlineDot = ({ online }: { online: boolean }) => (
  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
    style={{ background: online ? 'rgba(0,220,90,0.1)' : 'rgba(255,255,255,0.05)', color: online ? C.green : C.t3 }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: online ? C.green : C.t3 }}/>
    {online ? 'Онлайн' : 'Оффлайн'}
  </span>
);
