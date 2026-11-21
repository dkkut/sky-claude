import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';

export const GRAD = 'linear-gradient(160deg,#fff4fb 0%,#efe6ff 45%,#dff1ff 100%)';
export const INK = '#3a2f4d';
export const Btn = ({ children, onClick, kind = 'main', disabled, small, title }: { children: ReactNode; onClick?: () => void; kind?: 'main' | 'soft' | 'ghost' | 'danger' | 'gold'; disabled?: boolean; small?: boolean; title?: string }) => {
  const bg = { main: 'linear-gradient(180deg,#9a7bff,#7b5cf0)', soft: 'rgba(122,92,240,.12)', ghost: 'transparent', danger: 'linear-gradient(180deg,#ff8a8a,#e85d5d)', gold: 'linear-gradient(180deg,#ffd76a,#ffb02e)' }[kind];
  const col = kind === 'soft' || kind === 'ghost' ? '#6b4fd8' : kind === 'gold' ? '#5a3a00' : '#fff';
  return <button type="button" title={title} disabled={disabled} onClick={onClick} className={`sp-btn ${small ? 'px-3 py-1.5 text-[12px]' : 'px-4 py-2.5 text-[13px]'} rounded-2xl font-bold transition active:scale-95 disabled:opacity-40`} style={{ background: bg, color: col, boxShadow: kind === 'main' || kind === 'gold' || kind === 'danger' ? '0 4px 0 rgba(60,30,140,.25)' : undefined, minHeight: 36 }}>{children}</button>;
};
export const Bar = ({ v, color = '#7b5cf0', label, max = 100 }: { v: number; color?: string; label?: string; max?: number }) => (
  <div className="min-w-0">
    {label && <div className="mb-0.5 flex justify-between text-[11px] font-semibold" style={{ color: INK }}><span>{label}</span><span>{Math.round(v)}{max === 100 ? '' : `/${max}`}</span></div>}
    <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'rgba(60,30,140,.12)' }}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, (v / max) * 100))}%`, background: color }} /></div>
  </div>
);
export const Chip = ({ children, color = '#7b5cf0' }: { children: ReactNode; color?: string }) => <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: `${color}22`, color }}>{children}</span>;
export const Card = ({ children, onClick, className = '', style }: { children: ReactNode; onClick?: () => void; className?: string; style?: React.CSSProperties }) => (
  <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    className={`rounded-[26px] p-3 ${onClick ? 'cursor-pointer active:scale-[.98] transition' : ''} ${className}`} style={{ background: 'rgba(255,255,255,.78)', border: '1px solid rgba(255,255,255,.9)', boxShadow: '0 6px 22px rgba(90,60,190,.12)', color: INK, ...style }}>{children}</div>
);
export const Modal = ({ children, onClose, title, wide }: { children: ReactNode; onClose: () => void; title?: string; wide?: boolean }) => (
  <div className="fixed inset-0 z-[9000] flex items-end justify-center sm:items-center" style={{ background: 'rgba(30,20,60,.5)', backdropFilter: 'blur(6px)' }} onClick={onClose} role="dialog" aria-modal="true">
    <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} onClick={(e) => e.stopPropagation()} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[30px] p-4 sm:rounded-[30px] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`} style={{ background: GRAD, color: INK }}>
      <div className="mb-2 flex items-center justify-between gap-2"><div className="text-[16px] font-extrabold">{title}</div><button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-9 w-9 place-items-center rounded-full text-[18px]" style={{ background: 'rgba(60,30,140,.1)' }}>×</button></div>
      {children}
    </motion.div>
  </div>
);
export const useToast = () => {
  const [t, setT] = useState<{ m: string; bad?: boolean } | null>(null); const timer = useRef<number>();
  const show = useCallback((m: string, bad = false) => { setT({ m, bad }); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setT(null), 2800); }, []);
  const node = t ? <div className="pointer-events-none fixed inset-x-0 top-16 z-[9500] flex justify-center px-4" role="status"><div className="rounded-2xl px-4 py-2.5 text-[13px] font-bold shadow-xl" style={{ background: t.bad ? '#e85d5d' : '#4c3a99', color: '#fff' }}>{t.m}</div></div> : null;
  return { show, node };
};
export const Empty = ({ text, hint }: { text: string; hint?: string }) => <div className="px-4 py-10 text-center" style={{ color: INK }}><div className="text-[14px] font-bold">{text}</div>{hint && <div className="mt-1 text-[12px] opacity-70">{hint}</div>}</div>;
export const Coin = ({ n }: { n: number }) => <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-extrabold" style={{ background: 'linear-gradient(180deg,#ffe58a,#ffc233)', color: '#5a3a00' }}><span aria-hidden>●</span>{n.toLocaleString('ru-RU')}</span>;
export const rid = () => `buy-${crypto.randomUUID()}`;
export const ICON: Record<string, string> = { bone: '🦴', fish: '🐟', cake: '🍰', leaf: '🌿', ball: '⚽', rope: '🪢', puzzle: '🧩', star: '⭐', bow: '🎀', crown: '👑', scarf: '🧣', bed: '🛏️', bowl: '🥣', sofa: '🛋️', gym: '🏋️', plant: '🪴', lamp: '💡', wall: '🧱', floor: '🟫', door: '🚪', table: '🍽️', fridge: '🧊', stove: '🍳', tub: '🛁', sink: '🚰', shower: '🚿', wardrobe: '🚪', shelf: '📚', tv: '📺', nightstand: '🗄️', armchair: '💺', desk: '🖥️', carpet: '🟪', curtain: '🪟', picture: '🖼️', clock: '🕰️', flowers: '💐', aquarium: '🐠', tree: '🌳', bush: '🌿', fence: '🚧', swing: '🎠', slide: '🛝', sandbox: '🏖️', tunnel: '🕳️' };
export const itemIcon = (i?: { art?: { icon?: string }; kind?: string } | null) => ICON[i?.art?.icon ?? ''] ?? ({ food: '🍖', toy: '🧸', accessory: '🎀', clothes: '👕', furniture: '🪑', interior: '🖼️', decor: '🪴', house: '🏠', bed: '🛏️', bowl: '🥣' } as Record<string, string>)[i?.kind ?? ''] ?? '🎁';
export const useReload = (fn: () => void, ms = 15000) => {
  useEffect(() => { fn(); const h = () => fn(); window.addEventListener('sky:skypets', h); const t = window.setInterval(() => { if (!document.hidden) fn(); }, ms); return () => { window.removeEventListener('sky:skypets', h); window.clearInterval(t); }; }, [fn, ms]);
};
