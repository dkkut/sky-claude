/**
 * Стикеры с маскотом Sky — облачком. Рисуются векторно (без файлов), поэтому
 * одинаково чёткие на любом экране и в обеих темах. Сообщение несёт только
 * идентификатор стикера (kind: 'sticker', text: {"id":"hello"}); картинку собирает
 * получатель сам, так что подделать можно разве что «пустой» стикер, который не рисуется.
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

type Eyes = 'open' | 'happy' | 'closed' | 'heart' | 'star' | 'wide' | 'angry' | 'cry' | 'sleep' | 'cool';
type Mouth = 'smile' | 'grin' | 'o' | 'flat' | 'frown' | 'kiss';

export interface MascotDef { id: string; label: string; eyes: Eyes; mouth: Mouth; extra?: string; tint: string }

export const MASCOT_STICKERS: MascotDef[] = [
  { id: 'hello',  label: 'Привет!',     eyes: 'happy',  mouth: 'grin',  extra: '👋', tint: '#60a5fa' },
  { id: 'love',   label: 'Люблю',       eyes: 'heart',  mouth: 'smile', extra: '❤️', tint: '#f472b6' },
  { id: 'laugh',  label: 'Ха-ха',       eyes: 'happy',  mouth: 'grin',  extra: '💦', tint: '#fbbf24' },
  { id: 'cool',   label: 'Круто',       eyes: 'cool',   mouth: 'smile', extra: '🔥', tint: '#fb923c' },
  { id: 'party',  label: 'Ура!',        eyes: 'star',   mouth: 'grin',  extra: '🎉', tint: '#a78bfa' },
  { id: 'ok',     label: 'Окей',        eyes: 'happy',  mouth: 'smile', extra: '👍', tint: '#34d399' },
  { id: 'wow',    label: 'Ого!',        eyes: 'wide',   mouth: 'o',     extra: '❗', tint: '#f87171' },
  { id: 'thanks', label: 'Спасибо',     eyes: 'happy',  mouth: 'smile', extra: '🙏', tint: '#60a5fa' },
  { id: 'think',  label: 'Думаю…',      eyes: 'open',   mouth: 'flat',  extra: '💭', tint: '#94a3b8' },
  { id: 'sad',    label: 'Грустно',     eyes: 'open',   mouth: 'frown', extra: '🌧️', tint: '#7dd3fc' },
  { id: 'cry',    label: 'Плачу',       eyes: 'cry',    mouth: 'frown', extra: '💧', tint: '#38bdf8' },
  { id: 'angry',  label: 'Злюсь',       eyes: 'angry',  mouth: 'flat',  extra: '💢', tint: '#ef4444' },
  { id: 'sleep',  label: 'Сплю',        eyes: 'sleep',  mouth: 'o',     extra: '💤', tint: '#818cf8' },
  { id: 'kiss',   label: 'Чмок',        eyes: 'closed', mouth: 'kiss',  extra: '💋', tint: '#f472b6' },
  { id: 'coffee', label: 'Кофе?',       eyes: 'open',   mouth: 'smile', extra: '☕', tint: '#d6a15f' },
  { id: 'gamer',  label: 'Го играть',   eyes: 'cool',   mouth: 'grin',  extra: '🎮', tint: '#22d3ee' },
  { id: 'music',  label: 'Музыка',      eyes: 'happy',  mouth: 'smile', extra: '🎵', tint: '#c084fc' },
  { id: 'sorry',  label: 'Прости',      eyes: 'open',   mouth: 'frown', extra: '🙈', tint: '#fbbf24' },
  { id: 'no',     label: 'Нет',         eyes: 'closed', mouth: 'flat',  extra: '🚫', tint: '#f87171' },
  { id: 'bye',    label: 'Пока!',       eyes: 'happy',  mouth: 'smile', extra: '🌙', tint: '#6366f1' },
];

export const stickerById = (id: string) => MASCOT_STICKERS.find((s) => s.id === id);

const INK = '#1e3a5f';

const EyesSvg = ({ kind }: { kind: Eyes }) => {
  const L = 44, R = 76, Y = 52;
  switch (kind) {
    case 'happy': return <g stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round"><path d={`M${L - 6} ${Y + 3} Q${L} ${Y - 6} ${L + 6} ${Y + 3}`} /><path d={`M${R - 6} ${Y + 3} Q${R} ${Y - 6} ${R + 6} ${Y + 3}`} /></g>;
    case 'closed': return <g stroke={INK} strokeWidth="3" strokeLinecap="round"><line x1={L - 6} y1={Y} x2={L + 6} y2={Y} /><line x1={R - 6} y1={Y} x2={R + 6} y2={Y} /></g>;
    case 'sleep': return <g stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round"><path d={`M${L - 6} ${Y - 2} Q${L} ${Y + 6} ${L + 6} ${Y - 2}`} /><path d={`M${R - 6} ${Y - 2} Q${R} ${Y + 6} ${R + 6} ${Y - 2}`} /></g>;
    case 'heart': return <g fill="#ef4444">{[L, R].map((x) => <path key={x} d={`M${x} ${Y + 7} C${x - 12} ${Y - 2} ${x - 5} ${Y - 10} ${x} ${Y - 4} C${x + 5} ${Y - 10} ${x + 12} ${Y - 2} ${x} ${Y + 7}Z`} />)}</g>;
    case 'star': return <g fill="#f59e0b">{[L, R].map((x) => <path key={x} d={`M${x} ${Y - 8} L${x + 2.6} ${Y - 2.5} L${x + 8} ${Y - 2} L${x + 3.8} ${Y + 2} L${x + 5} ${Y + 8} L${x} ${Y + 5} L${x - 5} ${Y + 8} L${x - 3.8} ${Y + 2} L${x - 8} ${Y - 2} L${x - 2.6} ${Y - 2.5}Z`} />)}</g>;
    case 'wide': return <g>{[L, R].map((x) => <g key={x}><ellipse cx={x} cy={Y} rx="7" ry="8" fill="#fff" stroke={INK} strokeWidth="2.2" /><circle cx={x} cy={Y} r="3.2" fill={INK} /></g>)}</g>;
    case 'angry': return <g><g fill={INK}><ellipse cx={L} cy={Y + 1} rx="4.2" ry="4.6" /><ellipse cx={R} cy={Y + 1} rx="4.2" ry="4.6" /></g><g stroke={INK} strokeWidth="3" strokeLinecap="round"><line x1={L - 8} y1={Y - 9} x2={L + 6} y2={Y - 4} /><line x1={R + 8} y1={Y - 9} x2={R - 6} y2={Y - 4} /></g></g>;
    case 'cry': return <g><g fill={INK}><ellipse cx={L} cy={Y} rx="4.2" ry="4.8" /><ellipse cx={R} cy={Y} rx="4.2" ry="4.8" /></g><g fill="#38bdf8"><path d={`M${L - 5} ${Y + 7} q-3 8 0 9 q4 0 0 -9z`} /><path d={`M${R + 5} ${Y + 7} q3 8 0 9 q-4 0 0 -9z`} /></g></g>;
    case 'cool': return <g><rect x={L - 11} y={Y - 7} width="22" height="13" rx="5" fill="#111827" /><rect x={R - 11} y={Y - 7} width="22" height="13" rx="5" fill="#111827" /><line x1={L + 11} y1={Y - 2} x2={R - 11} y2={Y - 2} stroke="#111827" strokeWidth="3" /><path d={`M${L - 7} ${Y - 4} l6 0`} stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" /></g>;
    default: return <g fill={INK}><ellipse cx={L} cy={Y} rx="4.4" ry="4.9" /><ellipse cx={R} cy={Y} rx="4.4" ry="4.9" /><circle cx={L + 1.6} cy={Y - 1.8} r="1.5" fill="#fff" /><circle cx={R + 1.6} cy={Y - 1.8} r="1.5" fill="#fff" /></g>;
  }
};

const MouthSvg = ({ kind }: { kind: Mouth }) => {
  const x = 60, y = 68;
  switch (kind) {
    case 'grin': return <g><path d={`M${x - 11} ${y - 3} Q${x} ${y + 13} ${x + 11} ${y - 3}Z`} fill={INK} /><path d={`M${x - 7} ${y + 2} Q${x} ${y + 9} ${x + 7} ${y + 2}`} fill="#fca5a5" /></g>;
    case 'o': return <ellipse cx={x} cy={y + 2} rx="4.5" ry="5.5" fill={INK} />;
    case 'flat': return <line x1={x - 7} y1={y + 2} x2={x + 7} y2={y + 2} stroke={INK} strokeWidth="3" strokeLinecap="round" />;
    case 'frown': return <path d={`M${x - 8} ${y + 6} Q${x} ${y - 3} ${x + 8} ${y + 6}`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />;
    case 'kiss': return <g><path d={`M${x - 3} ${y - 1} q-6 3 0 5 q-6 3 0 5 q9 -1 9 -5 q0 -4 -9 -5z`} fill="#ef4444" /></g>;
    default: return <path d={`M${x - 9} ${y} Q${x} ${y + 9} ${x + 9} ${y}`} stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />;
  }
};

/** Один стикер: облачко с настроением, мелкий символ над ним и подпись. */
export const MascotSticker = ({ def, size = 120, caption = true, animate = true }: { def: MascotDef; size?: number; caption?: boolean; animate?: boolean }) => {
  const dur = 2.2 + (def.id.length % 5) * 0.3;
  return (
    <div className="inline-flex flex-col items-center" style={{ width: size }} translate="no">
      <motion.svg viewBox="0 0 120 110" width={size} height={size * 0.92}
        animate={animate ? { y: [0, -3, 0], rotate: [-1.2, 1.2, -1.2] } : undefined}
        transition={animate ? { duration: dur, repeat: Infinity, ease: 'easeInOut' } : undefined}
        role="img" aria-label={def.label}>
        <defs>
          <linearGradient id={`mc-${def.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#cfe3ff" />
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="98" rx="30" ry="4.5" fill="rgba(30,58,95,0.16)" />
        <g stroke={def.tint} strokeWidth="2.4" strokeLinejoin="round" fill={`url(#mc-${def.id})`}>
          <circle cx="30" cy="62" r="20" /><circle cx="90" cy="62" r="20" /><circle cx="60" cy="48" r="27" />
          <circle cx="42" cy="72" r="17" /><circle cx="78" cy="72" r="17" />
        </g>
        <g fill={`url(#mc-${def.id})`}><circle cx="30" cy="62" r="18.4" /><circle cx="90" cy="62" r="18.4" /><circle cx="60" cy="48" r="25.4" /><circle cx="42" cy="72" r="15.4" /><circle cx="78" cy="72" r="15.4" /><rect x="30" y="58" width="60" height="28" rx="12" /></g>
        <ellipse cx="34" cy="64" rx="6" ry="3.6" fill="#fca5a5" opacity="0.45" />
        <ellipse cx="86" cy="64" rx="6" ry="3.6" fill="#fca5a5" opacity="0.45" />
        <EyesSvg kind={def.eyes} />
        <MouthSvg kind={def.mouth} />
        {def.extra && (
          <motion.text x="96" y="26" fontSize="26" textAnchor="middle"
            animate={animate ? { scale: [1, 1.18, 1], rotate: [0, 8, 0] } : undefined}
            style={{ transformOrigin: '96px 18px', transformBox: 'fill-box' }}
            transition={animate ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}>{def.extra}</motion.text>
        )}
      </motion.svg>
      {caption && <span className="mt-0.5 text-[11px] font-bold leading-tight" style={{ color: 'var(--t1)' }}>{def.label}</span>}
    </div>
  );
};

/** Всплывающая панель выбора — над полем ввода, как у эмодзи. */
export const StickerPanel = ({ onPick, onClose }: { onPick: (id: string) => void; onClose: () => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <motion.div ref={ref} initial={{ opacity: 0, scale: 0.92, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: 10 }}
      className="fixed left-1/2 z-[60] rounded-3xl p-3 shadow-2xl"
      style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)', width: 'min(340px, calc(100vw - 24px))',
        bottom: 'calc(var(--safe-bottom) + 76px)', translateX: '-50%' }}>
      <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--t3)' }}>Стикеры Sky</p>
      <div className="grid max-h-[300px] grid-cols-4 gap-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {MASCOT_STICKERS.map((s) => (
          <button key={s.id} type="button" onClick={() => { onPick(s.id); onClose(); }} aria-label={s.label}
            className="grid place-items-center rounded-2xl py-1.5 transition-transform hover:scale-105 active:scale-95"
            style={{ background: 'transparent' }}>
            <MascotSticker def={s} size={68} animate={false} />
          </button>
        ))}
      </div>
    </motion.div>
  );
};
