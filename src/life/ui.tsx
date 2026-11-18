/** Общие кирпичи Sky Life: стеклянные карточки, кнопки, поля, шкала прогресса, листы, переключатель разделов. */
import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { flash } from '@/shared/flash';
import { errText } from './api';

export const T = { l1: 'var(--bg-l1)', l2: 'var(--bg-l2)', brd: 'var(--border)', t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', acc: 'var(--accent)' };
const VIOLET = '#8b5cf6';
export const glass: CSSProperties = { background: 'color-mix(in srgb, var(--bg-l1) 82%, transparent)', border: '1px solid var(--border)', backdropFilter: 'blur(18px) saturate(1.4)', WebkitBackdropFilter: 'blur(18px) saturate(1.4)' };

export const Card = ({ children, className = '', onClick, style }: { children: ReactNode; className?: string; onClick?: () => void; style?: CSSProperties }) => (
  <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    className={`rounded-3xl p-4 ${onClick ? 'cursor-pointer transition active:scale-[.99]' : ''} ${className}`} style={{ ...glass, ...style }}>{children}</div>
);
export const H = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="flex items-center justify-between gap-2"><p className="text-[15px] font-bold" style={{ color: T.t1 }}>{children}</p>{right}</div>
);
export const Note = ({ children }: { children: ReactNode }) => <p className="text-[11px] leading-relaxed" style={{ color: T.t3 }}>{children}</p>;
export const Btn = ({ children, onClick, tone = 'acc', disabled, small, type = 'button' }: { children: ReactNode; onClick?: () => void; tone?: 'acc' | 'plain' | 'red'; disabled?: boolean; small?: boolean; type?: 'button' | 'submit' }) => (
  <button type={type} disabled={disabled} onClick={onClick} className={`rounded-2xl font-bold transition active:scale-95 disabled:opacity-40 ${small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'}`}
    style={tone === 'acc' ? { background: `linear-gradient(135deg, ${VIOLET}, #6366f1)`, color: '#fff', boxShadow: '0 6px 20px rgba(99,102,241,.3)' } : tone === 'red' ? { background: 'rgba(239,68,68,.14)', color: '#ef4444' } : { background: T.l2, color: T.t1, border: `1px solid ${T.brd}` }}>{children}</button>
);
export const inputSty: CSSProperties = { background: T.l2, border: `1px solid ${T.brd}`, color: T.t1 };
export const Field = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="block space-y-1"><span className="text-[11px] font-semibold" style={{ color: T.t3 }}>{label}</span>{children}{hint && <Note>{hint}</Note>}</label>
);
export const TextIn = ({ value, onChange, placeholder, type = 'text', max }: { value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; max?: number }) => (
  <input type={type} value={value} maxLength={max} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-2xl px-3 py-2.5 text-sm outline-none" style={inputSty} />
);
export const Area = ({ value, onChange, placeholder, rows = 3, max }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; max?: number }) => (
  <textarea value={value} rows={rows} maxLength={max} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 w-full resize-y rounded-2xl px-3 py-2.5 text-sm outline-none" style={inputSty} />
);
export const Pick = <V extends string | number>({ value, onChange, options }: { value: V; onChange: (v: V) => void; options: { v: V; l: string }[] }) => (
  <select value={value} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as V)} className="w-full rounded-2xl px-3 py-2.5 text-sm outline-none" style={inputSty}>
    {options.map((o) => <option key={String(o.v)} value={o.v}>{o.l}</option>)}
  </select>
);
export const Check = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: T.t1 }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-violet-500" />{label}</label>
);
export const Chip = ({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'acc' }) => {
  const c = tone === 'ok' ? '#10b981' : tone === 'warn' ? '#f59e0b' : tone === 'bad' ? '#ef4444' : tone === 'acc' ? VIOLET : T.t2;
  return <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}>{children}</span>;
};
export const Progress = ({ value, tone }: { value: number; tone?: 'ok' | 'bad' }) => (
  <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: T.l2 }} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
    <motion.div initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={{ duration: 0.6, ease: 'easeOut' }} className="h-full rounded-full"
      style={{ background: tone === 'bad' ? 'linear-gradient(90deg,#f87171,#ef4444)' : tone === 'ok' ? 'linear-gradient(90deg,#34d399,#10b981)' : `linear-gradient(90deg,#a78bfa,${VIOLET},#6366f1)` }} />
  </div>
);
export const Spinner = () => <div className="grid h-40 place-items-center"><Loader2 className="animate-spin" size={20} style={{ color: T.t3 }} /></div>;
export const Empty = ({ text, hint, action }: { text: string; hint?: string; action?: ReactNode }) => (
  <div className="grid place-items-center gap-2 rounded-3xl px-4 py-10 text-center" style={{ border: `1px dashed ${T.brd}` }}>
    <p className="text-sm font-semibold" style={{ color: T.t2 }}>{text}</p>{hint && <Note>{hint}</Note>}{action}
  </div>
);
export const Sheet = ({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) => {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[10050] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" style={{ background: 'rgba(5,5,15,.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-[28px] sm:rounded-[28px] ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`} style={{ ...glass, background: 'var(--bg-l1)' }}>
        <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-4"><p className="text-base font-bold" style={{ color: T.t1 }}>{title}</p>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-8 w-8 place-items-center rounded-full" style={{ background: T.l2 }}><X size={15} style={{ color: T.t2 }} /></button></div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-6 pt-1">{children}</div>
      </motion.div>
    </div>
  );
};
/** Стеклянная лента вкладок с линзой выбранного пункта. */
export const Seg = <V extends string>({ value, onChange, items, id }: { value: V; onChange: (v: V) => void; items: { v: V; l: string; badge?: number }[]; id: string }) => (
  <div className="glass-pill flex max-w-full gap-1 overflow-x-auto p-1" role="tablist" style={{ scrollbarWidth: 'none' }}>
    {items.map((it) => (
      <button key={it.v} type="button" role="tab" aria-selected={value === it.v} onClick={() => onChange(it.v)} className="relative isolate shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold" style={{ color: value === it.v ? T.t1 : T.t3 }}>
        {value === it.v && <motion.span layoutId={`lens-${id}`} className="glass-lens absolute inset-0 -z-10 rounded-full" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
        {it.l}{it.badge ? <span className="ml-1 rounded-full px-1.5 text-[10px] font-black text-white" style={{ background: VIOLET }}>{it.badge}</span> : null}
      </button>
    ))}
  </div>
);
export const useLoad = <R,>(fn: () => Promise<R>, deps: unknown[] = []) => {
  const [data, setData] = useState<R | null>(null); const [err, setErr] = useState(false); const alive = useRef(true);
  const run = useCallback(async () => { try { const r = await fn(); if (alive.current) { setData(r); setErr(false); } } catch { if (alive.current) setErr(true); } }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; void run(); return () => { alive.current = false; }; }, [run]);
  return { data, err, reload: run, setData };
};
export const useAct = () => {
  const [busy, setBusy] = useState(false);
  const act = async <R extends { ok: boolean; error?: string }>(fn: () => Promise<R>, okText?: string): Promise<R | null> => {
    if (busy) return null; setBusy(true);
    try { const r = await fn(); if (r.ok) { if (okText) flash(okText); } else flash(errText(r.error)); return r; } catch { flash('Нет связи. Попробуйте ещё раз.'); return null; } finally { setBusy(false); }
  };
  return { busy, act };
};
export const BackBar = ({ onBack, title, right }: { onBack: () => void; title: string; right?: ReactNode }) => (
  <div className="flex items-center gap-2"><button type="button" onClick={onBack} aria-label="Назад" className="glass-btn round grid h-9 w-9 shrink-0 place-items-center text-lg" style={{ color: T.t1 }}>‹</button>
    <p className="min-w-0 flex-1 truncate text-base font-bold" style={{ color: T.t1 }} translate="no">{title}</p>{right}</div>
);
