/* ======================================================================
   SKY ПВЗ  —  Shared Glassmorphism UI + Charts
====================================================================== */
import { PropsWithChildren, useMemo, useState, Fragment, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';
import { useIsMobile } from '@/interface/mobile/useIsMobile';

/* ── Глянцевые токены ─────────────────────────────────────────────── */
export const G = {
  glass:    'rgba(255,255,255,0.045)',
  glassHi:  'rgba(255,255,255,0.08)',
  glassBrd: 'rgba(255,255,255,0.09)',
  shadow:   '0 8px 32px rgba(0,0,0,0.35)',
};

export const glassStyle: CSSProperties = {
  background: `linear-gradient(160deg, ${G.glass}, rgba(255,255,255,0.015))`,
  border: `1px solid ${G.glassBrd}`,
  boxShadow: G.shadow,
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
};

export const GlassCard = ({ children, className = '', style = {} }: PropsWithChildren<{ className?: string; style?: CSSProperties }>) => (
  <div className={`rounded-3xl ${className}`} style={{ ...glassStyle, ...style }}>{children}</div>
);

/* ── KPI-плитка ────────────────────────────────────────────────────── */
export const KpiTile = ({
  label, value, sub, icon: Icon, color, trend,
}: { label: string; value: string; sub?: string; icon: any; color: string; trend?: number }) => (
  <GlassCard className="p-4">
    <div className="flex items-start justify-between mb-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-2xl" style={{ background: `${color}18` }}>
        <Icon size={16} style={{ color }}/>
      </div>
      {trend !== undefined && (
        <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ background: trend>=0?'rgba(0,220,90,0.12)':'rgba(255,59,92,0.12)', color: trend>=0?C.green:C.red }}>
          {trend>=0 ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}{Math.abs(trend)}%
        </span>
      )}
    </div>
    <p className="text-lg font-black tracking-tight" style={{ color: C.t1 }}>{value}</p>
    <p className="text-[11px] mt-0.5" style={{ color: C.t3 }}>{label}</p>
    {sub && <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{sub}</p>}
  </GlassCard>
);

/* ── Полнопанельный слайд (как в logistics) ───────────────────────── */
export const PVZSlide = ({
  open, onClose, title, children,
}: PropsWithChildren<{ open: boolean; onClose: () => void; title: string }>) => (
  <AnimatePresence>
    {open && (
      <motion.div initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:28, stiffness:300 }}
        className="absolute inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
        <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom:`1px solid ${C.brd}` }}>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.t3 }}>
            <X size={18}/>
          </button>
          <p className="flex-1 text-base font-bold truncate" style={{ color: C.t1 }}>{title}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth:'none' }}>{children}</div>
      </motion.div>
    )}
  </AnimatePresence>
);

export const PVZConfirm = ({ open, onClose, title, children }: PropsWithChildren<{ open: boolean; onClose: () => void; title: string }>) => (
  <AnimatePresence>
    {open && (
      <motion.div className="absolute inset-0 z-[60] flex items-center justify-center p-6"
        initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
        <motion.div className="absolute inset-0" style={{ background:'rgba(0,0,0,0.6)' }} onClick={onClose}/>
        <motion.div initial={{ scale:0.94, opacity:0 }} animate={{ scale:1, opacity:1 }} exit={{ scale:0.94, opacity:0 }}
          className="relative w-full max-w-[360px] rounded-3xl p-5" style={glassStyle}>
          <p className="text-sm font-bold mb-3" style={{ color: C.t1 }}>{title}</p>
          {children}
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

export const EmptyState = ({ icon: Icon, title, sub }: { icon: any; title: string; sub?: string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 px-6 text-center">
    <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: C.l2 }}>
      <Icon size={20} style={{ color: C.t3 }}/>
    </div>
    <p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>
    {sub && <p className="text-xs max-w-[280px]" style={{ color: C.t3 }}>{sub}</p>}
  </div>
);

export const Segmented = <T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[] }) => (
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

export const Pill = ({ label, color }: { label: string; color: string }) => (
  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>{label}</span>
);

/* ── Прогресс-кольцо ───────────────────────────────────────────────── */
export const ScoreRing = ({ score, size = 76 }: { score: number; size?: number }) => {
  const color = score >= 85 ? C.green : score >= 60 ? C.amber : C.red;
  return (
    <div className="relative" style={{ height: size, width: size }}>
      <svg viewBox="0 0 36 36" style={{ height: size, width: size, transform: 'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={C.l2} strokeWidth="3"/>
        <motion.circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
          initial={{ strokeDasharray: '0 1000' }} animate={{ strokeDasharray: `${score*0.974} 1000` }} transition={{ duration: 0.9, ease:'easeOut' }}/>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="text-base font-black" style={{ color: C.t1 }}>{score}</span>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   ИНТЕРАКТИВНЫЕ ГРАФИКИ (свои, на SVG — без внешних зависимостей)
══════════════════════════════════════════════════════════════════ */
export type ChartPeriod = '7d' | '30d' | '90d';
export const PERIOD_DAYS: Record<ChartPeriod, number> = { '7d': 7, '30d': 30, '90d': 90 };

interface SeriesPoint { x: string; y: number; }

const buildPath = (points: SeriesPoint[], w: number, h: number, max: number, min: number) => {
  if (points.length === 0) return '';
  const span = Math.max(1, max - min);
  return points.map((p, i) => {
    const px = (i / Math.max(1, points.length - 1)) * w;
    const py = h - ((p.y - min) / span) * h;
    return `${i === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(' ');
};

/* Интерактивный линейный график с возможностью сравнения двух периодов и тултипом по hover */
export const InteractiveLineChart = ({
  data, compareData, label, compareLabel, color = C.acc, compareColor = '#8b5cf6', height = 180, format,
}: {
  data: SeriesPoint[]; compareData?: SeriesPoint[]; label: string; compareLabel?: string;
  color?: string; compareColor?: string; height?: number; format?: (v: number) => string;
}) => {
  const [hover, setHover] = useState<number | null>(null);
  const w = 600;
  const all = [...data.map(d=>d.y), ...(compareData?.map(d=>d.y) ?? [])];
  const max = Math.max(...all, 1) * 1.08;
  const min = Math.min(...all, 0) * 0.92;
  const path = useMemo(() => buildPath(data, w, height, max, min), [data, max, min]);
  const comparePath = useMemo(() => compareData ? buildPath(compareData, w, height, max, min) : '', [compareData, max, min]);
  const fmt = format ?? ((v:number) => v.toLocaleString('ru-RU'));

  const hoverX = hover !== null ? (hover / Math.max(1, data.length - 1)) * w : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height, overflow:'visible' }}
        onMouseMove={e => {
          const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          const idx = Math.round((px / w) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, idx)));
        }}
        onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="pvzAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0.25,0.5,0.75].map(f => <line key={f} x1={0} y1={height*f} x2={w} y2={height*f} stroke="white" strokeOpacity={0.05}/>)}
        {path && <motion.path d={`${path} L ${w} ${height} L 0 ${height} Z`} fill="url(#pvzAreaFill)"
          initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.5 }}/>}
        {path && <motion.path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength:0 }} animate={{ pathLength:1 }} transition={{ duration:0.8, ease:'easeOut' }}/>}
        {comparePath && <motion.path d={comparePath} fill="none" stroke={compareColor} strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round"
          initial={{ pathLength:0 }} animate={{ pathLength:1 }} transition={{ duration:0.8, ease:'easeOut' }}/>}
        {hoverX !== null && <line x1={hoverX} y1={0} x2={hoverX} y2={height} stroke="white" strokeOpacity={0.18}/>}
        {hoverX !== null && hover !== null && (
          <circle cx={hoverX} cy={height - ((data[hover].y - min)/Math.max(1,max-min))*height} r={4} fill={color}/>
        )}
      </svg>
      {hover !== null && (
        <div className="absolute top-0 rounded-xl px-2.5 py-1.5 pointer-events-none" style={{ left: `${(hover/(Math.max(1,data.length-1)))*100}%`, transform:'translate(-50%,-110%)', background:'rgba(10,10,16,0.92)', border:`1px solid ${C.brd}`, whiteSpace:'nowrap' }}>
          <p className="text-[10px] font-bold" style={{ color: C.t1 }}>{fmt(data[hover].y)}</p>
          <p className="text-[9px]" style={{ color: C.t3 }}>{data[hover].x}</p>
        </div>
      )}
      <div className="flex items-center gap-3 mt-2">
        <span className="flex items-center gap-1.5 text-[10px]" style={{ color: C.t3 }}><span className="h-1.5 w-3 rounded-full" style={{ background: color }}/> {label}</span>
        {compareData && <span className="flex items-center gap-1.5 text-[10px]" style={{ color: C.t3 }}><span className="h-1.5 w-3 rounded-full" style={{ background: compareColor }}/> {compareLabel}</span>}
      </div>
    </div>
  );
};

/* Интерактивная столбчатая диаграмма (например, заполненность по часам) */
export const InteractiveBarChart = ({
  data, color = C.acc, height = 140, format,
}: { data: SeriesPoint[]; color?: string; height?: number; format?: (v:number)=>string }) => {
  const [hover, setHover] = useState<number | null>(null);
  const isMobile = useIsMobile();
  const max = Math.max(...data.map(d=>d.y), 1);
  const fmt = format ?? ((v:number)=>String(v));
  return (
    <div className="relative">
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full relative"
            onMouseEnter={() => { if (!isMobile) setHover(i); }} onMouseLeave={() => { if (!isMobile) setHover(null); }}>
            {hover === i && (
              <div className="absolute bottom-full mb-1 rounded-lg px-2 py-1 pointer-events-none z-10" style={{ background:'rgba(10,10,16,0.92)', border:`1px solid ${C.brd}`, whiteSpace:'nowrap' }}>
                <p className="text-[9px] font-bold" style={{ color: C.t1 }}>{fmt(d.y)}</p>
              </div>
            )}
            <motion.div className="w-full rounded-md" style={{ background: hover===i ? color : `${color}90`, minHeight: 2 }}
              initial={{ height: 0 }} animate={{ height: `${(d.y/max)*100}%` }} transition={{ duration: 0.5, delay: i*0.015 }}/>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {data.map((d,i) => (i % Math.ceil(data.length/8) === 0) ? <span key={i} className="flex-1 text-center text-[8px]" style={{ color: C.t3 }}>{d.x}</span> : <span key={i} className="flex-1"/>)}
      </div>
    </div>
  );
};

/* Тепловая карта посещаемости (дни недели × часы) */
export const Heatmap = ({ matrix, days, hours }: { matrix: number[][]; days: string[]; hours: string[] }) => {
  const max = Math.max(...matrix.flat(), 1);
  return (
    <div className="overflow-x-auto" style={{ scrollbarWidth:'none' }}>
      <div className="inline-grid gap-1" style={{ gridTemplateColumns: `40px repeat(${hours.length}, 18px)` }}>
        <div/>
        {hours.map(h => <span key={h} className="text-[8px] text-center" style={{ color: C.t3 }}>{h}</span>)}
        {days.map((day, r) => (
          <Fragment key={day}>
            <span className="text-[9px] flex items-center" style={{ color: C.t3 }}>{day}</span>
            {hours.map((_, c) => {
              const v = matrix[r]?.[c] ?? 0;
              const intensity = v / max;
              return (
                <motion.div key={`${r}-${c}`} className="rounded-[3px]" style={{ height:18, width:18, background: `rgba(79,110,247,${0.08 + intensity*0.85})` }}
                  initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.3, delay:(r*hours.length+c)*0.003 }}/>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
};
