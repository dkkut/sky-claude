/**
 * Ползунок «проведите вправо, чтобы подтвердить». Анимация жеста доказательством согласия НЕ является:
 * после жеста вызывается onConfirm, а решение принимает сервер (проверяет сессию, запрос, срок). Для клавиатуры и
 * программ чтения с экрана — кнопка-запасной вариант (Enter/Пробел на ползунке).
 */
import { useRef, useState } from 'react';
import { ChevronRight, Check, Loader2 } from 'lucide-react';

interface Props { label: string; onConfirm: () => void; disabled?: boolean; busy?: boolean; dark?: boolean }
const H = 48;

export const SwipeConfirm = ({ label, onConfirm, disabled, busy, dark = true }: Props) => {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(false);
  const [done, setDone] = useState(false);
  const start = useRef(0);
  const max = () => Math.max(1, (track.current?.clientWidth ?? 240) - H - 6);

  const down = (e: React.PointerEvent) => {
    if (disabled || busy || done) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = e.clientX - x; setDrag(true);
  };
  const move = (e: React.PointerEvent) => { if (drag) setX(Math.min(max(), Math.max(0, e.clientX - start.current))); };
  const up = () => {
    if (!drag) return;
    setDrag(false);
    if (x >= max() * 0.88) { setX(max()); setDone(true); onConfirm(); } else setX(0);
  };
  const key = (e: React.KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled && !busy && !done) { e.preventDefault(); setX(max()); setDone(true); onConfirm(); } };
  const fill = Math.round(((x + H) / (max() + H)) * 100);

  return (
    <div ref={track} className="relative w-full select-none overflow-hidden rounded-full" style={{ height: H + 6, background: dark ? 'rgba(255,255,255,0.1)' : 'var(--bg-l2)', opacity: disabled ? 0.5 : 1, touchAction: 'pan-y' }}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill}%`, background: 'linear-gradient(90deg, rgba(139,124,255,0.35), rgba(56,189,248,0.45))', transition: drag ? 'none' : 'width .2s' }} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold" style={{ color: dark ? 'rgba(255,255,255,0.75)' : 'var(--t2)', paddingLeft: H }}>
        {busy || done ? '…' : label}
      </div>
      <div role="button" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || busy || done}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        className="absolute top-[3px] left-[3px] grid cursor-grab place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        style={{ width: H, height: H, transform: `translateX(${x}px)`, transition: drag ? 'none' : 'transform .2s', background: 'linear-gradient(135deg, #8b7cff, #38bdf8)', color: '#fff', boxShadow: '0 4px 18px rgba(139,124,255,0.45)' }}>
        {busy ? <Loader2 size={20} className="animate-spin" /> : done ? <Check size={20} /> : <ChevronRight size={22} />}
      </div>
    </div>
  );
};
