/**
 * Sky Cloud — фирменное облачко. Рисуется векторно (то же облачко, что в стикерах), состояния:
 * greeting/wave (приветствие, машет рукой), joy, surprise, waiting, error, offline, success.
 * Анимация лёгкая (transform), при «Анимации выкл» и prefers-reduced-motion стоит на месте.
 */
import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { EyesSvg, MouthSvg } from '@/messenger/mascotStickers';

export type CloudState = 'greeting' | 'wave' | 'joy' | 'surprise' | 'waiting' | 'error' | 'offline' | 'success' | 'blocked';

const FACE: Record<CloudState, { eyes: Parameters<typeof EyesSvg>[0]['kind']; mouth: Parameters<typeof MouthSvg>[0]['kind']; tint: string }> = {
  greeting: { eyes: 'happy', mouth: 'grin', tint: '#60a5fa' },
  wave: { eyes: 'happy', mouth: 'smile', tint: '#60a5fa' },
  joy: { eyes: 'star', mouth: 'grin', tint: '#a78bfa' },
  surprise: { eyes: 'wide', mouth: 'o', tint: '#fbbf24' },
  waiting: { eyes: 'open', mouth: 'flat', tint: '#94a3b8' },
  error: { eyes: 'cry', mouth: 'frown', tint: '#f87171' },
  offline: { eyes: 'open', mouth: 'frown', tint: '#7dd3fc' },
  success: { eyes: 'happy', mouth: 'grin', tint: '#34d399' },
  blocked: { eyes: 'open', mouth: 'flat', tint: '#f87171' },
};

const Y = '#fcd34d', YS = '#d99a06';
const Hand = () => (
  <g>
    <rect x="6" y="9" width="12" height="11" rx="5" fill={Y} stroke={YS} strokeWidth="1.2" />
    {[7, 10.5, 14, 17.5].map((x, i) => <rect key={x} x={x - 1.6} y={3 + (i === 1 || i === 2 ? 0 : 2)} width="3.2" height="9" rx="1.6" fill={Y} stroke={YS} strokeWidth="1.2" />)}
  </g>
);

export const SkyCloud = ({ state = 'greeting', size = 96, className }: { state?: CloudState; size?: number; className?: string }) => {
  const reduce = useReducedMotion() || (typeof document !== 'undefined' && document.documentElement.dataset.animations === 'off');
  const f = FACE[state];
  const id = `sc-${state}`;
  const bob = state === 'joy' ? { y: [0, -8, 0], rotate: [-2, 2, -2] } : state === 'surprise' ? { scale: [1, 1.06, 1] } : state === 'waiting' ? { y: [0, -2, 0] } : { y: [0, -3, 0] };
  const dur = state === 'joy' ? 0.9 : state === 'waiting' ? 2.8 : 2.4;
  return (
    <div className={className} style={{ width: size, height: size * 0.92, flex: 'none' }} translate="no">
      <motion.svg viewBox="0 0 120 110" width={size} height={size * 0.92} role="img" aria-label="Sky"
        animate={reduce ? undefined : bob} transition={reduce ? undefined : { duration: dur, repeat: Infinity, ease: 'easeInOut' }}>
        <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#cfe3ff" /></linearGradient></defs>
        <ellipse cx="60" cy="98" rx="30" ry="4.5" fill="rgba(30,58,95,0.18)" />
        <g stroke={f.tint} strokeWidth="2.4" strokeLinejoin="round" fill={`url(#${id})`}>
          <circle cx="30" cy="62" r="20" /><circle cx="90" cy="62" r="20" /><circle cx="60" cy="48" r="27" /><circle cx="42" cy="72" r="17" /><circle cx="78" cy="72" r="17" />
        </g>
        <g fill={`url(#${id})`}><circle cx="30" cy="62" r="18.4" /><circle cx="90" cy="62" r="18.4" /><circle cx="60" cy="48" r="25.4" /><circle cx="42" cy="72" r="15.4" /><circle cx="78" cy="72" r="15.4" /></g>
        <ellipse cx="34" cy="64" rx="6" ry="3.6" fill="#fca5a5" opacity="0.45" /><ellipse cx="86" cy="64" rx="6" ry="3.6" fill="#fca5a5" opacity="0.45" />
        <EyesSvg kind={f.eyes} />
        <MouthSvg kind={f.mouth} />

        {(state === 'greeting' || state === 'wave') && (
          <motion.g style={{ transformOrigin: '104px 40px', transformBox: 'view-box' }} animate={reduce ? { rotate: 12 } : { rotate: [0, 28, -8, 24, 0] }} transition={reduce ? undefined : { duration: 1.5, repeat: Infinity, repeatDelay: 0.6, ease: 'easeInOut' }}>
            <g transform="translate(92 14) scale(1.1)"><Hand /></g>
          </motion.g>
        )}
        {state === 'waiting' && [0, 1, 2].map(i => (
          <motion.circle key={i} cx={46 + i * 14} cy="14" r="3.4" fill="#94a3b8" animate={reduce ? undefined : { opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
        ))}
        {state === 'error' && <g transform="translate(88 4)"><circle cx="12" cy="12" r="11" fill="#ef4444" /><rect x="10.6" y="5" width="2.8" height="9" rx="1.4" fill="#fff" /><circle cx="12" cy="18" r="1.7" fill="#fff" /></g>}
        {state === 'surprise' && <g transform="translate(88 2)" fill="#f59e0b"><rect x="9.8" y="2" width="4.4" height="12" rx="2.2" /><circle cx="12" cy="19" r="2.6" /></g>}
        {state === 'success' && <g transform="translate(88 4)"><circle cx="12" cy="12" r="11" fill="#22c55e" /><path d="M6.5 12.5 L10.5 16.5 L17.5 8" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></g>}
        {state === 'blocked' && (
          <g aria-hidden>
            {/* табличка с крестиком в руках облачка */}
            <rect x="38" y="74" width="44" height="28" rx="7" fill="#fff" stroke="#ef4444" strokeWidth="2.4" />
            <path d="M52 81 L68 95 M68 81 L52 95" stroke="#ef4444" strokeWidth="4.2" strokeLinecap="round" />
            <circle cx="35" cy="90" r="7.5" fill={Y} stroke={YS} strokeWidth="1.2" />
            <circle cx="85" cy="90" r="7.5" fill={Y} stroke={YS} strokeWidth="1.2" />
          </g>
        )}
        {state === 'offline' && (
          <g transform="translate(86 2)" stroke="#475569" strokeWidth="2.2" fill="none" strokeLinecap="round">
            <path d="M3 10 Q12 2 21 10" /><path d="M6.5 14 Q12 9 17.5 14" /><circle cx="12" cy="18" r="1.4" fill="#475569" stroke="none" />
            <line x1="3" y1="21" x2="21" y2="3" stroke="#ef4444" strokeWidth="2.6" />
          </g>
        )}
        {state === 'joy' && [[16, 18], [100, 22], [8, 48]].map(([x, y], i) => (
          <motion.path key={i} d={`M${x} ${y - 6} L${x + 1.8} ${y - 1.8} L${x + 6} ${y} L${x + 1.8} ${y + 1.8} L${x} ${y + 6} L${x - 1.8} ${y + 1.8} L${x - 6} ${y} L${x - 1.8} ${y - 1.8}Z`} fill="#fbbf24"
            animate={reduce ? undefined : { scale: [0.6, 1.1, 0.6], opacity: [0.5, 1, 0.5] }} style={{ transformOrigin: `${x}px ${y}px`, transformBox: 'view-box' }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.25 }} />
        ))}
      </motion.svg>
    </div>
  );
};

/** Приветствие по времени суток: «Доброе утро, Имя» с облачком рядом. */
export const greetingFor = (d = new Date()) => { const h = d.getHours(); return h < 6 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер'; };
