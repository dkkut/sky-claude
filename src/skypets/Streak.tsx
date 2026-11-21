import { useEffect, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PetPic } from './PetArt';
import { Btn, Card, INK } from './ui';
import type { Pet } from './api';

export type Streak = { current: number; best: number; doneToday: boolean; next: number | null; milestones: { m: number; reward: number; reached: boolean; at: string | null }[]; unseen: number[]; restore: { available: boolean; possible: boolean; lostStreak: number; left: number; perMonth: number; until: string }; freeze: { available: boolean; left: number; days: number; active: boolean; until: string | null } };

/** Цвета и названия ступеней серии. */
const TIER: Record<number, { name: string; a: string; b: string; glow: string }> = {
  10: { name: 'Бронзовая серия', a: '#e8a36b', b: '#b8662f', glow: '#ffb77a' },
  30: { name: 'Серебряная серия', a: '#e4eaf2', b: '#9aa8bb', glow: '#cfe0ff' },
  100: { name: 'Золотая серия', a: '#ffe27a', b: '#f0a020', glow: '#ffd24a' },
  200: { name: 'Изумрудная серия', a: '#7cf0c0', b: '#1fae78', glow: '#5ff0b0' },
  300: { name: 'Сапфировая серия', a: '#8cc4ff', b: '#2f6fe0', glow: '#6fb0ff' },
  400: { name: 'Аметистовая серия', a: '#d9a8ff', b: '#8a43e0', glow: '#c98aff' },
  500: { name: 'Легендарная серия', a: '#ff8ad0', b: '#7b5cf0', glow: '#ffd24a' },
};
export const tierOf = (m: number) => TIER[m] ?? TIER[10];

export function StreakCard({ s, onRestore, onFreeze, busy }: { s: Streak; onRestore?: () => void; onFreeze?: () => void; busy?: boolean }) {
  const until = s.freeze?.until ? s.freeze.until.split('-').reverse().slice(0, 2).join('.') : '';
  const prev = [...s.milestones].reverse().find((x) => x.m <= s.current)?.m ?? 0;
  const pct = s.next ? Math.min(100, Math.round(((s.current - prev) / (s.next - prev)) * 100)) : 100;
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-[30px]" style={{ background: s.current > 0 ? 'linear-gradient(145deg,#ffb02e,#ff5d4a)' : '#e4def5', boxShadow: s.current > 0 ? '0 6px 18px rgba(255,120,60,.35)' : 'none' }}><span className={s.current > 0 && !s.doneToday ? 'sp-flame' : ''}>🔥</span></div>
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-black leading-none" style={{ color: INK }}><span className="text-[13px] font-bold opacity-70">{s.current === 1 ? `${s.current} день подряд` : s.current >= 2 && s.current <= 4 ? `${s.current} дня подряд` : `${s.current} дней подряд`}</span></div>
          <div className="mt-1 text-[12px] opacity-75" style={{ color: INK }}>{(s.current === 0 ? 'Позаботьтесь о питомце сегодня — начнётся серия' : s.doneToday ? 'Сегодня уже ухаживали — так держать!' : 'Ухаживайте сегодня, чтобы серия не прервалась') + ` · рекорд ${s.best}`}</div>
        </div>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full" style={{ background: 'rgba(123,92,240,.15)' }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#ffb02e,#ff5d4a)' }} /></div>
      <div className="mt-1 text-[11px] opacity-70" style={{ color: INK }}>{s.next ? `До следующей ступени — ещё ${s.next - s.current} дн.` : 'Все ступени пройдены!'}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {s.milestones.map((x) => { const t = tierOf(x.m); return (
          <span key={x.m} title={`+${x.reward} монет`} className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={x.reached ? { background: `linear-gradient(135deg,${t.a},${t.b})`, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,.25)' } : { background: 'rgba(123,92,240,.1)', color: INK, opacity: .55 }}>{x.reached ? '★' : '☆'} {x.m}</span>
        ); })}
      </div>
      {s.restore?.possible && (
        <div className="mt-3 rounded-2xl p-2.5" style={{ background: 'linear-gradient(135deg,rgba(255,176,46,.18),rgba(255,93,74,.16))', border: '1px solid rgba(255,120,60,.35)' }}>
          <div className="text-[13px] font-extrabold" style={{ color: INK }}>{`Серия ${s.restore.lostStreak} дн. оборвалась вчера`}</div>
          <div className="mt-0.5 text-[11px] opacity-75" style={{ color: INK }}>{s.restore.available ? `Её можно вернуть до конца сегодняшнего дня (по UTC). Осталось ${s.restore.left} из ${s.restore.perMonth} в этом месяце.` : `В этом месяце все ${s.restore.perMonth} восстановлений уже использованы.`}</div>
          {s.restore.available && onRestore && <div className="mt-2"><Btn small onClick={onRestore} disabled={busy}>🔥 Восстановить серию</Btn></div>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {s.freeze?.active && <span className="rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ background: 'rgba(74,163,255,.18)', color: '#2a7ad6' }}>{`❄ Заморозка до ${until}`}</span>}
        {s.freeze?.available && onFreeze && <Btn kind="soft" small onClick={onFreeze} disabled={busy}>{`❄ Заморозить серию на ${s.freeze.days} дней`}</Btn>}
        {!s.freeze?.active && !s.freeze?.available && s.freeze?.left === 0 && <span className="text-[11px] opacity-65" style={{ color: INK }}>Заморозка в этом месяце уже использована</span>}
      </div>
    </Card>
  );
}

const CONFETTI = ['#ffd24a', '#ff6fa8', '#6fb0ff', '#5ff0b0', '#c98aff', '#ff8a4a'];
/** Праздник при достижении вехи: вспышка, лучи, салют, большое число, питомец танцует. */
export function StreakCelebration({ milestone, reward, pet, onClose }: { milestone: number; reward: number; pet: Pet; onClose: () => void }) {
  const calm = useReducedMotion(); const t = tierOf(milestone); const grand = milestone >= 100;
  const parts = useMemo(() => Array.from({ length: grand ? 56 : 34 }, (_, i) => { const ang = (i / (grand ? 56 : 34)) * Math.PI * 2 + (i % 3) * 0.2; const dist = 120 + ((i * 37) % 150); return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist - 40, r: (i * 53) % 360, c: CONFETTI[i % CONFETTI.length], s: 6 + (i % 4) * 2, d: (i % 7) * 0.03 }; }), [grand]);
  const stars = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ l: 6 + ((i * 23) % 88), t: 4 + ((i * 41) % 40), d: (i % 5) * 0.4 })), []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <motion.div className="fixed inset-0 z-[10050] grid place-items-center overflow-hidden px-4" style={{ background: 'rgba(24,14,52,.78)', backdropFilter: 'blur(6px)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} role="dialog" aria-label={t.name}>
      <style>{`@keyframes sp-flame{0%,100%{transform:scale(1) rotate(-3deg)}50%{transform:scale(1.14) rotate(3deg)}}.sp-flame{animation:sp-flame 1.1s ease-in-out infinite;display:inline-block}
@keyframes sp-rays{to{transform:rotate(360deg)}}@keyframes sp-twk{0%,100%{opacity:.2;transform:scale(.6)}50%{opacity:1;transform:scale(1.2)}}
@media (prefers-reduced-motion:reduce){.sp-flame{animation:none}}html[data-animations='off'] .sp-flame{animation:none}`}</style>
      {!calm && <div className="pointer-events-none absolute left-1/2 top-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 opacity-60" style={{ background: `repeating-conic-gradient(from 0deg, ${t.glow}55 0 8deg, transparent 8deg 24deg)`, maskImage: 'radial-gradient(circle,#000 8%,transparent 62%)', WebkitMaskImage: 'radial-gradient(circle,#000 8%,transparent 62%)', animation: 'sp-rays 26s linear infinite' }} />}
      {!calm && stars.map((s, i) => <span key={i} className="pointer-events-none absolute text-[18px]" style={{ left: `${s.l}%`, top: `${s.t}%`, color: t.glow, animation: `sp-twk 2.2s ${s.d}s ease-in-out infinite` }}>✦</span>)}
      <motion.div className="relative w-full max-w-[340px] text-center" initial={calm ? false : { scale: 0.4, y: 40, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 16 }} onClick={(e) => e.stopPropagation()}>
        {!calm && [0, 1, 2].map((i) => <motion.span key={i} className="pointer-events-none absolute left-1/2 top-[88px] rounded-full" style={{ width: 120, height: 120, marginLeft: -60, marginTop: -60, border: `3px solid ${t.glow}` }} initial={{ scale: 0.3, opacity: 0.9 }} animate={{ scale: 3.2, opacity: 0 }} transition={{ duration: 1.8, delay: 0.15 + i * 0.35, repeat: 1, ease: 'easeOut' }} />)}
        {!calm && parts.map((p, i) => <motion.span key={i} className="pointer-events-none absolute left-1/2 top-[88px] rounded-[2px]" style={{ width: p.s, height: p.s * 0.5, background: p.c }} initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }} animate={{ x: p.x, y: [0, p.y, p.y + 220], opacity: [1, 1, 0], rotate: p.r * 3 }} transition={{ duration: 2.4, delay: 0.3 + p.d, ease: 'easeOut' }} />)}
        <div className="relative mx-auto grid h-[176px] w-[176px] place-items-center rounded-full" style={{ background: `radial-gradient(circle at 50% 38%, #fff, ${t.a} 55%, ${t.b})`, boxShadow: `0 0 0 6px ${t.glow}66, 0 0 70px ${t.glow}` }}>
          <motion.div animate={calm ? undefined : { y: [0, -14, 0], rotate: [0, -6, 6, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}><PetPic pet={pet} size={128} /></motion.div>
          <motion.div className="absolute -right-3 -top-2 text-[40px]" initial={calm ? false : { scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.5, type: 'spring', stiffness: 300, damping: 10 }}>🔥</motion.div>
        </div>
        <motion.div className="mt-4 font-black leading-none" style={{ fontSize: grand ? 84 : 72, background: `linear-gradient(180deg,#fff,${t.a} 55%,${t.b})`, WebkitBackgroundClip: 'text', color: 'transparent', filter: `drop-shadow(0 4px 18px ${t.glow})` }} initial={calm ? false : { scale: 0.2, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 12 }}>{milestone}</motion.div>
        <div className="mt-1 text-[13px] font-extrabold uppercase tracking-[0.18em]" style={{ color: t.glow }}>дней ухода подряд</div>
        <div className="mt-2 text-[20px] font-black text-white">{t.name}!</div>
        <div className="mx-auto mt-1 max-w-[280px] text-[13px] text-white/80"><span translate="no">{pet.name}</span>{` — `}{'растёт с заботой, вы не пропустили ни одного дня.'}</div>
        <motion.div className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[14px] font-extrabold" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', border: `1px solid ${t.glow}88` }} initial={calm ? false : { y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.9 }}>{pet.owners.length > 1 ? `🪙 +${reward} монет каждому хозяину` : `🪙 +${reward} монет`}</motion.div>
        <div className="mt-4"><Btn onClick={onClose}>Ура!</Btn></div>
      </motion.div>
    </motion.div>
  );
}
