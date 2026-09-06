/* ======================================================================
   SKY GIFTS  —  Анимированные фоны подарков
   15 тем, на framer-motion (без canvas / внешних библиотек)
====================================================================== */
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { BackgroundTheme, Rarity } from './types';
import { RARITY_CONFIG } from './types';

const hash = (s: string) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; };
const rnd = (seed: string, i: number, min: number, max: number) => {
  const h = hash(seed+i);
  return min + ((h % 10000)/10000) * (max-min);
};

/* ── Частицы (используются почти во всех темах, интенсивность = редкость) ── */
const Particles = memo(({ seed, count, color }: { seed: string; count: number; color: string }) => {
  const dots = useMemo(() => Array.from({ length: count }, (_,i) => ({
    x: rnd(seed,i,0,100), y: rnd(seed,i+50,0,100), size: rnd(seed,i+100,1,3.2),
    dur: rnd(seed,i+150,3,7), delay: rnd(seed,i+200,0,4),
  })), [seed, count]);
  return (
    <>
      {dots.map((d,i) => (
        <motion.span key={i} className="absolute rounded-full" style={{ left:`${d.x}%`, top:`${d.y}%`, height:d.size, width:d.size, background:color, boxShadow:`0 0 ${d.size*3}px ${color}` }}
          animate={{ opacity:[0,1,0], y:[0,-14,0] }} transition={{ duration:d.dur, repeat:Infinity, delay:d.delay, ease:'easeInOut' }}/>
      ))}
    </>
  );
});

const Blob = ({ color, top, left, sizeVw, dur, delay=0 }: { color:string; top:string; left:string; sizeVw:number; dur:number; delay?:number }) => (
  <motion.div className="absolute rounded-full blur-2xl" style={{ top, left, height:`${sizeVw}%`, width:`${sizeVw}%`, background:color, transform:'translate(-50%,-50%)' }}
    animate={{ scale:[1,1.25,1], opacity:[0.5,0.85,0.5] }} transition={{ duration:dur, repeat:Infinity, delay, ease:'easeInOut' }}/>
);

/* ── Конфигурация каждой темы ─────────────────────────────────────── */
const THEME_BASE: Record<BackgroundTheme, string> = {
  aurora:       'linear-gradient(160deg, #061018, #0a2030)',
  space:        'radial-gradient(circle at 50% 30%, #0a0a18, #020208)',
  galaxy:       'radial-gradient(circle at 40% 40%, #14081f, #03020a)',
  clouds:       'linear-gradient(160deg, #2b3950, #0d1420)',
  liquid_metal: 'linear-gradient(160deg, #1c1f24, #05060a)',
  water:        'linear-gradient(160deg, #052233, #01080f)',
  crystal:      'linear-gradient(160deg, #1a1430, #06040d)',
  neon:         'linear-gradient(160deg, #15041f, #03010a)',
  glass:        'linear-gradient(160deg, #1b1f28, #06070a)',
  gold:         'linear-gradient(160deg, #2a1d08, #0a0602)',
  ice:          'linear-gradient(160deg, #0c2733, #020a0e)',
  fire:         'linear-gradient(160deg, #2b0a04, #0a0301)',
  matrix:       'linear-gradient(160deg, #021006, #000301)',
  waves:        'linear-gradient(160deg, #051527, #01060c)',
  particles:    'radial-gradient(circle at 50% 40%, #0b0b16, #020205)',
};

export const GiftBackground = memo(({ theme, rarity, className='' }: { theme: BackgroundTheme; rarity: Rarity; className?: string }) => {
  const cfg = RARITY_CONFIG[rarity];
  const intensity = 0.5 + cfg.weight*0.7;
  const particleCount = Math.round(6 + cfg.weight*26);
  const seed = theme+rarity;

  return (
    <div className={`absolute inset-0 overflow-hidden ${className}`} style={{ background: THEME_BASE[theme] }}>
      {theme === 'aurora' && (
        <>
          <motion.div className="absolute inset-x-0 top-0 h-2/3" style={{ background:'linear-gradient(180deg, rgba(52,211,153,0.35), rgba(79,110,247,0.25), transparent)', filter:'blur(30px)' }}
            animate={{ x:['-15%','15%','-15%'], opacity:[0.5,0.9,0.5] }} transition={{ duration:8, repeat:Infinity, ease:'easeInOut' }}/>
          <motion.div className="absolute inset-x-0 top-0 h-1/2" style={{ background:'linear-gradient(180deg, rgba(167,139,250,0.3), transparent)', filter:'blur(24px)' }}
            animate={{ x:['10%','-10%','10%'] }} transition={{ duration:6, repeat:Infinity, ease:'easeInOut' }}/>
          <Particles seed={seed} count={particleCount} color="#a7f3d0"/>
        </>
      )}
      {theme === 'space' && (
        <>
          <Particles seed={seed} count={particleCount*2} color="#ffffff"/>
          <Blob color="rgba(79,110,247,0.25)" top="30%" left="60%" sizeVw={60} dur={10}/>
        </>
      )}
      {theme === 'galaxy' && (
        <>
          <motion.div className="absolute inset-0" style={{ background:'conic-gradient(from 0deg, rgba(167,139,250,0.25), rgba(244,63,94,0.15), rgba(34,211,238,0.2), rgba(167,139,250,0.25))', filter:'blur(40px)' }}
            animate={{ rotate:360 }} transition={{ duration:40, repeat:Infinity, ease:'linear' }}/>
          <Particles seed={seed} count={particleCount} color="#e879f9"/>
        </>
      )}
      {theme === 'clouds' && (
        <>
          <Blob color="rgba(255,255,255,0.18)" top="35%" left="30%" sizeVw={70} dur={9}/>
          <Blob color="rgba(148,163,184,0.18)" top="60%" left="70%" sizeVw={60} dur={11} delay={2}/>
        </>
      )}
      {theme === 'liquid_metal' && (
        <motion.div className="absolute inset-0" style={{ background:'linear-gradient(120deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.25) 45%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.2) 100%)' }}
          animate={{ backgroundPositionX:['0%','200%'] }} transition={{ duration:5, repeat:Infinity, ease:'linear' }}/>
      )}
      {theme === 'water' && (
        <>
          <Blob color="rgba(34,211,238,0.25)" top="40%" left="40%" sizeVw={65} dur={7}/>
          <motion.div className="absolute inset-0" style={{ background:'repeating-linear-gradient(100deg, rgba(34,211,238,0.06) 0 8px, transparent 8px 18px)' }}
            animate={{ backgroundPositionX:['0px','120px'] }} transition={{ duration:4, repeat:Infinity, ease:'linear' }}/>
        </>
      )}
      {theme === 'crystal' && (
        <>
          <motion.div className="absolute inset-0" style={{ background:'repeating-linear-gradient(60deg, rgba(167,139,250,0.12) 0 14px, rgba(255,255,255,0.04) 14px 28px)' }}
            animate={{ opacity:[0.6,1,0.6] }} transition={{ duration:4, repeat:Infinity }}/>
          <Particles seed={seed} count={particleCount} color="#c4b5fd"/>
        </>
      )}
      {theme === 'neon' && (
        <>
          <motion.div className="absolute left-1/2 top-1/2 h-[2px] w-[140%] -translate-x-1/2 -translate-y-1/2" style={{ background:'#f43f5e', boxShadow:'0 0 30px #f43f5e' }}
            animate={{ rotate:[0,180,360] }} transition={{ duration:14, repeat:Infinity, ease:'linear' }}/>
          <motion.div className="absolute left-1/2 top-1/2 h-[2px] w-[140%] -translate-x-1/2 -translate-y-1/2" style={{ background:'#22d3ee', boxShadow:'0 0 30px #22d3ee' }}
            animate={{ rotate:[90,270,450] }} transition={{ duration:11, repeat:Infinity, ease:'linear' }}/>
        </>
      )}
      {theme === 'glass' && (
        <motion.div className="absolute inset-0" style={{ background:'linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.18) 48%, transparent 65%)' }}
          animate={{ backgroundPositionX:['-100%','200%'] }} transition={{ duration:3.5, repeat:Infinity, ease:'linear' }}/>
      )}
      {theme === 'gold' && (
        <>
          <motion.div className="absolute inset-0" style={{ background:'linear-gradient(120deg, rgba(245,158,11,0.15) 0%, rgba(255,215,120,0.4) 45%, rgba(245,158,11,0.15) 55%, rgba(255,215,120,0.3) 100%)' }}
            animate={{ backgroundPositionX:['0%','200%'] }} transition={{ duration:4.5, repeat:Infinity, ease:'linear' }}/>
          <Particles seed={seed} count={particleCount} color="#fde68a"/>
        </>
      )}
      {theme === 'ice' && (
        <>
          <motion.div className="absolute inset-0" style={{ background:'repeating-linear-gradient(70deg, rgba(125,211,252,0.1) 0 10px, transparent 10px 22px)' }}
            animate={{ opacity:[0.5,0.9,0.5] }} transition={{ duration:5, repeat:Infinity }}/>
          <Particles seed={seed} count={Math.round(particleCount*0.6)} color="#bae6fd"/>
        </>
      )}
      {theme === 'fire' && (
        <>
          <motion.div className="absolute inset-x-0 bottom-0 h-2/3" style={{ background:'linear-gradient(0deg, rgba(244,63,94,0.55), rgba(245,158,11,0.3), transparent)', filter:'blur(20px)' }}
            animate={{ scaleY:[1,1.15,1], opacity:[0.7,1,0.7] }} transition={{ duration:1.6, repeat:Infinity, ease:'easeInOut' }}/>
          <Particles seed={seed} count={particleCount} color="#fb923c"/>
        </>
      )}
      {theme === 'matrix' && (
        <motion.div className="absolute inset-0 opacity-70" style={{ background:'repeating-linear-gradient(0deg, rgba(34,197,94,0.18) 0 2px, transparent 2px 16px)' }}
          animate={{ backgroundPositionY:['0px','160px'] }} transition={{ duration:2.2, repeat:Infinity, ease:'linear' }}/>
      )}
      {theme === 'waves' && (
        <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          {[0,1,2].map(i => (
            <motion.path key={i} d="M0 60 Q 25 50 50 60 T 100 60" fill="none" stroke={`rgba(79,110,247,${0.35-i*0.1})`} strokeWidth={1.5}
              animate={{ d: ['M0 60 Q 25 50 50 60 T 100 60','M0 55 Q 25 65 50 55 T 100 55','M0 60 Q 25 50 50 60 T 100 60'] }}
              transition={{ duration:5+i, repeat:Infinity, ease:'easeInOut', delay:i*0.4 }}/>
          ))}
        </svg>
      )}
      {theme === 'particles' && <Particles seed={seed} count={particleCount*2} color={cfg.color}/>}

      {/* Общее свечение редкости поверх любого фона */}
      <div className="absolute inset-0" style={{ background:`radial-gradient(circle at 50% 30%, ${cfg.glow}, transparent 70%)`, opacity: intensity*0.5 }}/>
    </div>
  );
});
GiftBackground.displayName = 'GiftBackground';
