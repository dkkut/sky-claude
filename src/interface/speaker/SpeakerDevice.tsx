/* Колонка Sky: тканевая решётка, светящееся кольцо Sky AI и окошко часов с надписью SKY. */
import { useEffect, useState } from 'react';
import { SP_ACCENT, SP_ACCENT2 } from './speakerTheme';

export const SpeakerClock = () => {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 5000); return () => clearInterval(i); }, []);
  return <>{t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</>;
};

export const SpeakerDevice = ({ glow, level, onTap }: { glow: 'off' | 'idle' | 'active' | 'busy'; level: number; onTap: () => void }) => {
  const c = glow === 'off' ? 'rgba(255,255,255,0.18)' : glow === 'busy' ? SP_ACCENT2 : SP_ACCENT;
  const spread = 14 + (glow === 'active' ? level * 46 : 0);
  return (
    <button type="button" onClick={onTap} aria-label="Позвать Sky AI"
      className="relative block outline-none transition active:scale-[0.98] focus-visible:ring-4 focus-visible:ring-teal-200"
      style={{ width: 'min(46vh, 80vw)', aspectRatio: '1 / 1.12', borderRadius: '38% / 30%' }}>
      <span aria-hidden className="absolute inset-0 rounded-[inherit] transition-all duration-200"
        style={{ boxShadow: glow === 'off' ? 'none' : `0 0 ${spread * 2}px ${spread / 2}px ${c}55` }} />
      <svg viewBox="0 0 300 336" className="relative h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="spBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a3a63" /><stop offset="0.55" stopColor="#141c35" /><stop offset="1" stopColor="#0b1020" />
          </linearGradient>
          <pattern id="spGrille" width="9" height="9" patternUnits="userSpaceOnUse">
            <circle cx="4.5" cy="4.5" r="1.5" fill="rgba(255,255,255,0.16)" />
          </pattern>
          <linearGradient id="spRing" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={c} stopOpacity="0.15" /><stop offset="0.5" stopColor={c} /><stop offset="1" stopColor={c} stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect x="6" y="6" width="288" height="324" rx="112" ry="100" fill="url(#spBody)" stroke="rgba(255,255,255,0.14)" strokeWidth="2" />
        <rect x="26" y="150" width="248" height="160" rx="70" ry="56" fill="url(#spGrille)" />
        <rect x="40" y="26" width="220" height="10" rx="5" fill="url(#spRing)" opacity={glow === 'off' ? 0.35 : 1} />
        <rect x="52" y="52" width="196" height="84" rx="26" fill="#03060d" stroke="rgba(94,234,212,0.30)" strokeWidth="1.5" />
        <text x="150" y="76" textAnchor="middle" fontSize="12" fontWeight="800" letterSpacing="7" fill={SP_ACCENT} fontFamily="system-ui, sans-serif">SKY</text>
      </svg>
      <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-center font-extrabold tabular-nums text-white"
        style={{ top: '25.5%', fontSize: 'clamp(30px, 6.4vh, 60px)', lineHeight: 1, textShadow: `0 0 18px ${SP_ACCENT}88` }} translate="no">
        <SpeakerClock />
      </span>
    </button>
  );
};
