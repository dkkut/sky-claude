import { useRef } from 'react';
import { motion, useMotionValue } from 'framer-motion';
import { Star } from 'lucide-react';
import type { GameEntry } from '../store';
import { GENRE_LABEL } from '../store';

export const RANK_GLOW: Record<string, string> = {
  Bronze: '205,127,50', Silver: '168,169,173',
  Gold: '245,158,11',   Platinum: '79,158,247',
  Diamond: '168,85,247', Master: '244,63,94',
};
export const GENRE_COLOR: Record<string, string> = {
  fps: '#f43f5e', moba: '#8b5cf6', 'battle-royale': '#10b981',
  racing: '#3b82f6', rpg: 'var(--amber)', strategy: '#ec4899',
};
export const rankCol  = (r: string) => `rgb(${RANK_GLOW[r] ?? '69,69,79'})`;
export const rankGlow = (r: string) => `0 0 20px rgba(${RANK_GLOW[r] ?? '69,69,79'},0.5)`;
export const K        = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n);
export const ago      = (s: string) => {
  const d = Date.now() - new Date(s).getTime();
  if (d < 3600000)  return `${Math.floor(d / 60000)}м`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}ч`;
  return `${Math.floor(d / 86400000)}д`;
};
export const countdown = (s: string) => {
  const d = new Date(s).getTime() - Date.now();
  if (d <= 0) return 'Идёт';
  const h = Math.floor(d / 3600000), days = Math.floor(d / 86400000);
  return days > 0 ? `${days}д ${h % 24}ч` : `${h}ч`;
};

export const GameCard = ({ game, rank, onClick }: { game: GameEntry; rank?: string; onClick: () => void }) => {
  const ref  = useRef<HTMLDivElement>(null);
  const rotX = useMotionValue(0);
  const rotY = useMotionValue(0);
  const col  = GENRE_COLOR[game.genre] ?? 'var(--accent)';

  const handleMouse = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return;
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = (e.clientX - left) / width  - 0.5;
    const y = (e.clientY - top)  / height - 0.5;
    rotX.set(-y * 10); rotY.set(x * 10);
  };

  return (
    <motion.div ref={ref}
      onMouseMove={handleMouse}
      onMouseLeave={() => { rotX.set(0); rotY.set(0); }}
      onClick={onClick}
      style={{ rotateX: rotX, rotateY: rotY, transformStyle: 'preserve-3d', perspective: 800 }}
      whileTap={{ scale: 0.96 }}
      className="relative cursor-pointer overflow-hidden rounded-3xl"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      <div className="absolute inset-0" style={{ background: game.gradient }}/>
      <div className="absolute inset-0 opacity-30"
        style={{ background: `radial-gradient(ellipse at 30% 50%, ${col}55 0%, transparent 70%)` }}/>
      <div className="relative p-4 flex flex-col" style={{ minHeight: 200 }}>
        <div className="flex items-center justify-between mb-auto">
          <span className="rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide"
            style={{ background: `${col}25`, color: col, border: `1px solid ${col}40` }}>
            {GENRE_LABEL[game.genre]}
          </span>
          {rank && (
            <span className="text-xs font-bold" style={{ color: rankCol(rank), textShadow: rankGlow(rank) }}>{rank}</span>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center py-4">
          <div className="grid h-16 w-16 place-items-center rounded-2xl text-2xl font-black select-none"
            style={{ background: `${col}18`, border: `1px solid ${col}35`,
              color: col, textShadow: `0 0 20px ${col}`,
              boxShadow: `0 0 32px ${col}30, inset 0 1px 0 rgba(255,255,255,0.08)` }}>
            {game.title.slice(0, 2).toUpperCase()}
          </div>
        </div>
        <div>
          <p className="text-base font-bold text-white leading-tight mb-1">{game.title}</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse"/>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>{K(game.players)}</span>
            </div>
            <div className="flex gap-0.5">
              {[1,2,3,4,5].map(i => (
                <Star key={i} size={9} fill={i <= Math.round(game.rating) ? 'var(--amber)' : 'none'}
                  style={{ color: i <= Math.round(game.rating) ? 'var(--amber)' : 'rgba(255,255,255,0.15)' }}/>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${col}, transparent)`, opacity: 0.6 }}/>
    </motion.div>
  );
};

export const RankBadge = ({ rank, icon, large }: { rank: string; icon: string; large?: boolean }) => {
  const col = rankCol(rank);
  const sz  = large ? 64 : 40;
  return (
    <motion.div
      animate={{ boxShadow: [rankGlow(rank), `0 0 30px rgba(${RANK_GLOW[rank]},0.8)`, rankGlow(rank)] }}
      transition={{ duration: 2.5, repeat: Infinity }}
      className="grid place-items-center rounded-full shrink-0"
      style={{ width: sz, height: sz, background: `rgba(${RANK_GLOW[rank]},0.12)`, border: `1.5px solid ${col}60` }}>
      <span style={{ fontSize: large ? 28 : 16 }}>{icon}</span>
    </motion.div>
  );
};

export const StatPill = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
  <div className="flex flex-col items-center gap-0.5 rounded-2xl px-3 py-2"
    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
    <p className="text-sm font-bold" style={{ color: color ?? 'var(--t1)' }}>{value}</p>
    <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--t3)' }}>{label}</p>
  </div>
);
