/* ======================================================================
   SKY GIFTS  —  Shared UI + Charts
====================================================================== */
import { PropsWithChildren, useMemo, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown } from 'lucide-react';
import { C } from '@/marketplace/SkyMarket';

export const G = {
  glass:    'rgba(255,255,255,0.045)',
  glassBrd: 'rgba(255,255,255,0.1)',
  shadow:   '0 12px 40px rgba(0,0,0,0.4)',
};

export const glassStyle: CSSProperties = {
  background: `linear-gradient(160deg, ${G.glass}, rgba(255,255,255,0.015))`,
  border: `1px solid ${G.glassBrd}`,
  boxShadow: G.shadow,
  backdropFilter: 'blur(22px)',
  WebkitBackdropFilter: 'blur(22px)',
};

export const GlassCard = ({ children, className='', style={}, glow }: PropsWithChildren<{ className?: string; style?: CSSProperties; glow?: string }>) => (
  <div className={`rounded-3xl ${className}`} style={{ ...glassStyle, ...(glow ? { boxShadow: `${G.shadow}, 0 0 28px ${glow}` } : {}), ...style }}>{children}</div>
);

export const KpiTile = ({ label, value, sub, icon: Icon, color, trend }: { label:string; value:string; sub?:string; icon:any; color:string; trend?:number }) => (
  <GlassCard className="p-4">
    <div className="flex items-start justify-between mb-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-2xl" style={{ background:`${color}18` }}><Icon size={16} style={{ color }}/></div>
      {trend !== undefined && (
        <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: trend>=0?'rgba(0,220,90,0.12)':'rgba(255,59,92,0.12)', color: trend>=0?C.green:C.red }}>
          {trend>=0 ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}{Math.abs(trend)}%
        </span>
      )}
    </div>
    <p className="text-lg font-black tracking-tight" style={{ color: C.t1 }}>{value}</p>
    <p className="text-[11px] mt-0.5" style={{ color: C.t3 }}>{label}</p>
    {sub && <p className="text-[10px] mt-1" style={{ color: C.t3 }}>{sub}</p>}
  </GlassCard>
);

export const GiftSlide = ({ open, onClose, title, children }: PropsWithChildren<{ open:boolean; onClose:()=>void; title:string }>) => (
  <AnimatePresence>
    {open && (
      <motion.div initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }} transition={{ type:'spring', damping:28, stiffness:300 }}
        className="absolute inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
        <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom:`1px solid ${C.brd}` }}>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.t3 }}><X size={18}/></button>
          <p className="flex-1 text-base font-bold truncate" style={{ color: C.t1 }}>{title}</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth:'none' }}>{children}</div>
      </motion.div>
    )}
  </AnimatePresence>
);

export const GiftConfirm = ({ open, onClose, title, children }: PropsWithChildren<{ open:boolean; onClose:()=>void; title:string }>) => (
  <AnimatePresence>
    {open && (
      <motion.div className="absolute inset-0 z-[60] flex items-center justify-center p-6" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
        <motion.div className="absolute inset-0" style={{ background:'rgba(0,0,0,0.65)' }} onClick={onClose}/>
        <motion.div initial={{ scale:0.92, opacity:0, y:10 }} animate={{ scale:1, opacity:1, y:0 }} exit={{ scale:0.92, opacity:0 }}
          className="relative w-full max-w-[380px] rounded-3xl p-5" style={glassStyle}>
          <p className="text-sm font-bold mb-3" style={{ color: C.t1 }}>{title}</p>
          {children}
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

export const EmptyState = ({ icon: Icon, title, sub }: { icon:any; title:string; sub?:string }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 px-6 text-center">
    <div className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: C.l2 }}><Icon size={20} style={{ color: C.t3 }}/></div>
    <p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>
    {sub && <p className="text-xs max-w-[280px]" style={{ color: C.t3 }}>{sub}</p>}
  </div>
);

export const Segmented = <T extends string>({ value, onChange, options }: { value:T; onChange:(v:T)=>void; options:{key:T;label:string}[] }) => (
  <div className="flex rounded-xl p-1" style={{ background: C.l2 }}>
    {options.map(o => (
      <button key={o.key} type="button" onClick={() => onChange(o.key)} className="flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors"
        style={{ background: value===o.key ? C.l3 : 'transparent', color: value===o.key ? C.t1 : C.t3 }}>{o.label}</button>
    ))}
  </div>
);

export const Pill = ({ label, color }: { label:string; color:string }) => (
  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background:`${color}18`, color }}>{label}</span>
);

export const ScoreRing = ({ score, size=76, color }: { score:number; size?:number; color?:string }) => {
  const c = color ?? (score>=85?C.green:score>=60?C.amber:C.red);
  return (
    <div className="relative" style={{ height:size, width:size }}>
      <svg viewBox="0 0 36 36" style={{ height:size, width:size, transform:'rotate(-90deg)' }}>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke={C.l2} strokeWidth="3"/>
        <motion.circle cx="18" cy="18" r="15.5" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round"
          initial={{ strokeDasharray:'0 1000' }} animate={{ strokeDasharray:`${score*0.974} 1000` }} transition={{ duration:0.9, ease:'easeOut' }}/>
      </svg>
      <div className="absolute inset-0 grid place-items-center"><span className="text-base font-black" style={{ color: C.t1 }}>{score}</span></div>
    </div>
  );
};

/* ── Горизонтальная прокручиваемая секция (главный паттерн Home) ────── */
export const HRow = ({ title, action, children }: PropsWithChildren<{ title:string; action?:string }>) => (
  <div className="mt-5">
    <div className="px-5 flex items-center justify-between mb-2.5">
      <p className="text-sm font-bold" style={{ color: C.t1 }}>{title}</p>
      {action && <span className="text-[11px] font-semibold" style={{ color: C.acc }}>{action}</span>}
    </div>
    <div className="flex gap-3 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth:'none', scrollSnapType:'x proximity' }}>
      {children}
    </div>
  </div>
);

/* ── Skeleton loader ──────────────────────────────────────────────── */
export const Skeleton = ({ className='', style={} }: { className?:string; style?:CSSProperties }) => (
  <div className={`rounded-2xl overflow-hidden relative ${className}`} style={{ background: C.l2, ...style }}>
    <motion.div className="absolute inset-0" style={{ background:'linear-gradient(90deg, transparent, rgba(255,255,255,0.07), transparent)' }}
      animate={{ x:['-100%','100%'] }} transition={{ duration:1.3, repeat:Infinity, ease:'linear' }}/>
  </div>
);

/* ══════════════════════════════════════════════════════════════════
   ГРАФИКИ
══════════════════════════════════════════════════════════════════ */
interface SeriesPoint { x:string; y:number; }
const buildPath = (points: SeriesPoint[], w:number, h:number, max:number, min:number) => {
  if (points.length===0) return '';
  const span = Math.max(1, max-min);
  return points.map((p,i) => {
    const px = (i/Math.max(1,points.length-1))*w;
    const py = h - ((p.y-min)/span)*h;
    return `${i===0?'M':'L'} ${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(' ');
};

export const InteractiveLineChart = ({ data, label, color=C.acc, height=160, format }: {
  data: SeriesPoint[]; label:string; color?:string; height?:number; format?:(v:number)=>string;
}) => {
  const [hover, setHover] = useState<number|null>(null);
  const w = 600;
  const max = Math.max(...data.map(d=>d.y), 1) * 1.08;
  const min = Math.min(...data.map(d=>d.y), 0) * 0.92;
  const path = useMemo(() => buildPath(data, w, height, max, min), [data, max, min]);
  const fmt = format ?? ((v:number) => v.toLocaleString('ru-RU'));
  const hoverX = hover !== null ? (hover/Math.max(1,data.length-1))*w : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height, overflow:'visible' }}
        onMouseMove={e => {
          const rect = (e.target as SVGElement).closest('svg')!.getBoundingClientRect();
          const px = ((e.clientX-rect.left)/rect.width)*w;
          const idx = Math.round((px/w)*(data.length-1));
          setHover(Math.max(0, Math.min(data.length-1, idx)));
        }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="giftsAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0.25,0.5,0.75].map(f => <line key={f} x1={0} y1={height*f} x2={w} y2={height*f} stroke="white" strokeOpacity={0.05}/>)}
        {path && <motion.path d={`${path} L ${w} ${height} L 0 ${height} Z`} fill="url(#giftsAreaFill)" initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.5 }}/>}
        {path && <motion.path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength:0 }} animate={{ pathLength:1 }} transition={{ duration:0.8, ease:'easeOut' }}/>}
        {hoverX !== null && <line x1={hoverX} y1={0} x2={hoverX} y2={height} stroke="white" strokeOpacity={0.18}/>}
        {hoverX !== null && hover !== null && <circle cx={hoverX} cy={height-((data[hover].y-min)/Math.max(1,max-min))*height} r={4} fill={color}/>}
      </svg>
      {hover !== null && (
        <div className="absolute top-0 rounded-xl px-2.5 py-1.5 pointer-events-none" style={{ left:`${(hover/Math.max(1,data.length-1))*100}%`, transform:'translate(-50%,-110%)', background:'rgba(10,10,16,0.92)', border:`1px solid ${C.brd}`, whiteSpace:'nowrap' }}>
          <p className="text-[10px] font-bold" style={{ color: C.t1 }}>{fmt(data[hover].y)}</p>
          <p className="text-[9px]" style={{ color: C.t3 }}>{data[hover].x}</p>
        </div>
      )}
    </div>
  );
};
