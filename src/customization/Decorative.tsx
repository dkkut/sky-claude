/* ===============================================================
   SKY DECORATIVE MOTIFS
   Авторские декоративные слои для баннеров чата и тем профиля.
   Каждый мотив — самостоятельная, узнаваемая композиция (не случайный
   градиент), параметризуемая цветом. Используется многослойно поверх
   базового фона темы, с приглушённой прозрачностью, чтобы не мешать
   тексту. Один мотив может переиспользоваться в разных темах —
   идентичность темы всё равно достигается сочетанием фона+акцента.
=============================================================== */
import { motion } from 'framer-motion';

export type MotifProps = { accent: string; accent2?: string; opacity?: number; seed?: number };

const rnd = (seed: number, i: number) => {
  const x = Math.sin(seed * 999 + i * 57.13) * 10000;
  return x - Math.floor(x);
};

/* ── Созвездия (Galaxy / Space / Night) ─────────────────────── */
export const Constellations = ({ accent, opacity = 0.55, seed = 1 }: MotifProps) => {
  const stars = Array.from({ length: 26 }, (_, i) => ({
    x: rnd(seed, i) * 100, y: rnd(seed, i + 50) * 100, r: 0.5 + rnd(seed, i + 100) * 1.1,
  }));
  const links = [[0,1],[1,2],[3,4],[4,5],[6,7],[8,9],[9,10],[12,13],[15,16],[18,19]];
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity }}>
      {links.map(([a,b],i) => stars[a] && stars[b] && (
        <line key={i} x1={stars[a].x} y1={stars[a].y} x2={stars[b].x} y2={stars[b].y} stroke={accent} strokeWidth="0.15" opacity="0.5"/>
      ))}
      {stars.map((s,i) => (
        <motion.circle key={i} cx={s.x} cy={s.y} r={s.r} fill={i % 5 === 0 ? accent : '#fff'}
          animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2.5 + rnd(seed,i)*3, repeat: Infinity, delay: rnd(seed,i+7)*3 }}/>
      ))}
      <circle cx="80" cy="18" r="9" fill="none" stroke={accent} strokeWidth="0.3" opacity="0.35"/>
      <circle cx="80" cy="18" r="13" fill="none" stroke={accent} strokeWidth="0.15" opacity="0.2"/>
    </svg>
  );
};

/* ── Ленты северного сияния (Aurora) ─────────────────────────── */
export const AuroraRibbons = ({ accent, accent2 = accent, opacity = 0.5 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    {[0,1,2].map(i => (
      <motion.path key={i}
        d={`M -10 ${30+i*14} Q 25 ${8+i*14} 50 ${30+i*14} T 110 ${30+i*14}`}
        fill="none" stroke={i % 2 === 0 ? accent : accent2} strokeWidth={3-i*0.6} strokeLinecap="round" opacity={0.5 - i*0.1}
        animate={{ d: [
          `M -10 ${30+i*14} Q 25 ${8+i*14} 50 ${30+i*14} T 110 ${30+i*14}`,
          `M -10 ${34+i*14} Q 25 ${16+i*14} 50 ${26+i*14} T 110 ${34+i*14}`,
          `M -10 ${30+i*14} Q 25 ${8+i*14} 50 ${30+i*14} T 110 ${30+i*14}`,
        ] }}
        transition={{ duration: 7 + i*2, repeat: Infinity, ease: 'easeInOut' }}/>
    ))}
  </svg>
);

/* ── Лепестки сакуры (Sakura) ─────────────────────────────────── */
export const SakuraPetals = ({ accent, opacity = 0.6, seed = 2 }: MotifProps) => {
  const petals = Array.from({ length: 9 }, (_, i) => ({
    x: rnd(seed,i)*100, y: rnd(seed,i+20)*100, r: 6 + rnd(seed,i+40)*20, rot: rnd(seed,i+60)*360,
  }));
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity }}>
      <path d="M -5 70 Q 30 60 45 75 T 95 65" fill="none" stroke={accent} strokeWidth="0.4" opacity="0.4"/>
      {petals.map((p,i) => (
        <motion.g key={i} animate={{ y: [0, 4, 0], rotate: [p.rot, p.rot+15, p.rot] }} transition={{ duration: 5+rnd(seed,i)*3, repeat: Infinity }}
          style={{ transformOrigin: `${p.x}px ${p.y}px` }}>
          <path d={`M ${p.x} ${p.y} q 3 -4 6 0 q -1 4 -6 4 q -5 0 -6 -4 q 3 -4 6 0`} fill={accent} opacity="0.55" transform={`scale(${p.r/16})`} />
        </motion.g>
      ))}
    </svg>
  );
};

/* ── Неоновые контуры (Cyber) ─────────────────────────────────── */
export const NeonCircuits = ({ accent, opacity = 0.5 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <path d="M0 20 H30 L38 28 H70 L78 20 H100" fill="none" stroke={accent} strokeWidth="0.6"/>
    <path d="M0 80 H20 L28 72 H60 L66 80 H100" fill="none" stroke={accent} strokeWidth="0.6"/>
    <path d="M85 0 V15 L92 22 V45" fill="none" stroke={accent} strokeWidth="0.6"/>
    <path d="M15 100 V85 L8 78 V55" fill="none" stroke={accent} strokeWidth="0.6"/>
    {[[38,28],[78,20],[28,72],[66,80],[92,22],[8,78]].map(([x,y],i) => (
      <motion.circle key={i} cx={x} cy={y} r="1.4" fill={accent} animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 1.6, repeat: Infinity, delay: i*0.25 }}/>
    ))}
    <polygon points="0,0 8,0 0,8" fill="none" stroke={accent} strokeWidth="0.4" opacity="0.5"/>
  </svg>
);

/* ── Грани кристалла (Crystal) ─────────────────────────────────── */
export const CrystalFacets = ({ accent, accent2 = '#fff', opacity = 0.4 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <polygon points="70,-5 100,15 92,45 68,30" fill={accent} opacity="0.28"/>
    <polygon points="100,15 100,50 92,45" fill={accent2} opacity="0.18"/>
    <polygon points="68,30 92,45 78,60 55,50" fill={accent} opacity="0.18"/>
    <polygon points="-5,60 15,50 25,78 5,95" fill={accent} opacity="0.22"/>
    <polygon points="15,50 25,78 8,80" fill={accent2} opacity="0.15"/>
    <line x1="68" y1="30" x2="92" y2="45" stroke={accent2} strokeWidth="0.3" opacity="0.5"/>
    <line x1="15" y1="50" x2="25" y2="78" stroke={accent2} strokeWidth="0.3" opacity="0.5"/>
  </svg>
);

/* ── Волны океана (Ocean) ─────────────────────────────────────── */
export const OceanWaves = ({ accent, opacity = 0.45, seed = 3 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    {[0,1,2].map(i => (
      <motion.path key={i} d={`M -10 ${70+i*8} Q 15 ${60+i*8} 35 ${70+i*8} T 75 ${70+i*8} T 115 ${70+i*8}`}
        fill="none" stroke={accent} strokeWidth={1.2-i*0.2} opacity={0.5-i*0.12}
        animate={{ x: [0, -20, 0] }} transition={{ duration: 8+i*2, repeat: Infinity, ease: 'easeInOut' }}/>
    ))}
    {Array.from({ length: 6 }, (_, i) => (
      <motion.circle key={i} cx={10+rnd(seed,i)*80} cy={90-rnd(seed,i+10)*20} r={0.6+rnd(seed,i+20)*1}
        fill={accent} opacity="0.35" animate={{ cy: [90, 20], opacity: [0.4,0] }}
        transition={{ duration: 6+rnd(seed,i)*4, repeat: Infinity, delay: i*1.1 }}/>
    ))}
  </svg>
);

/* ── Королевский орнамент (Royal) ─────────────────────────────── */
export const RoyalFiligree = ({ accent, opacity = 0.5 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <path d="M0 8 C 10 2, 18 2, 20 8 C 22 2, 30 2, 30 10 C 30 4, 40 2, 42 8" fill="none" stroke={accent} strokeWidth="0.4"/>
    <path d="M100 92 C 90 98, 82 98, 80 92 C 78 98, 70 98, 70 90 C 70 96, 60 98, 58 92" fill="none" stroke={accent} strokeWidth="0.4"/>
    <circle cx="6" cy="6" r="2" fill="none" stroke={accent} strokeWidth="0.35"/>
    <circle cx="94" cy="94" r="2" fill="none" stroke={accent} strokeWidth="0.35"/>
    <path d="M0 0 L14 0 M0 0 L0 14" stroke={accent} strokeWidth="0.4" opacity="0.6"/>
    <path d="M100 100 L86 100 M100 100 L100 86" stroke={accent} strokeWidth="0.4" opacity="0.6"/>
  </svg>
);

/* ── Лесная листва (Forest) ─────────────────────────────────────── */
export const ForestLeaves = ({ accent, opacity = 0.5, seed = 4 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <path d="M-5 100 Q10 60 5 20" fill="none" stroke={accent} strokeWidth="0.5" opacity="0.5"/>
    {Array.from({ length: 8 }, (_, i) => {
      const y = 15 + i * 10, x = 4 + Math.sin(i) * 3;
      return <ellipse key={i} cx={x + (i%2===0?6:-2)} cy={y} rx="4.5" ry="2.2" fill={accent} opacity={0.35+rnd(seed,i)*0.2}
        transform={`rotate(${i%2===0?-30:30} ${x} ${y})`}/>;
    })}
    {Array.from({ length: 5 }, (_, i) => (
      <motion.circle key={i} cx={70+rnd(seed,i)*25} cy={rnd(seed,i+9)*100} r="0.6" fill={accent} opacity="0.4"
        animate={{ y: [0, 15, 0], opacity: [0.4,0.1,0.4] }} transition={{ duration: 4+rnd(seed,i)*3, repeat: Infinity }}/>
    ))}
  </svg>
);

/* ── Стеклянные грани (Liquid Glass / Dark Glass) ────────────────── */
export const GlassPanes = ({ accent, opacity = 0.35 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <rect x="55" y="-10" width="55" height="55" rx="10" fill={accent} opacity="0.12" transform="rotate(18 82 18)"/>
    <rect x="-15" y="55" width="45" height="45" rx="10" fill={accent} opacity="0.1" transform="rotate(-12 5 78)"/>
    <path d="M60 -5 L100 20" stroke="#fff" strokeWidth="0.6" opacity="0.25"/>
    <path d="M-10 70 L25 95" stroke="#fff" strokeWidth="0.5" opacity="0.2"/>
  </svg>
);

/* ── Закатные лучи (Sunset) ─────────────────────────────────────── */
export const SunsetRays = ({ accent, accent2 = accent, opacity = 0.5 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <circle cx="80" cy="85" r="20" fill={accent} opacity="0.2"/>
    {Array.from({ length: 7 }, (_, i) => (
      <line key={i} x1="80" y1="85" x2={80 + Math.cos((i/6)*Math.PI - Math.PI) * 55} y2={85 + Math.sin((i/6)*Math.PI - Math.PI) * 55}
        stroke={i % 2 === 0 ? accent : accent2} strokeWidth="0.4" opacity="0.3"/>
    ))}
    <path d="M0 70 Q 50 60 100 70" fill="none" stroke={accent2} strokeWidth="0.4" opacity="0.3"/>
  </svg>
);

/* ── Вейпорвейв-сетка (Vaporwave / Retro) ─────────────────────────── */
export const VaporGrid = ({ accent, accent2 = '#fff', opacity = 0.5 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <circle cx="50" cy="30" r="16" fill={accent2} opacity="0.15"/>
    <line x1="50" y1="14" x2="50" y2="46" stroke={accent} strokeWidth="0.4" opacity="0.4"/>
    {Array.from({ length: 6 }, (_, i) => (
      <line key={i} x1="0" y1={55+i*7} x2="100" y2={55+i*7} stroke={accent} strokeWidth="0.3" opacity={0.4-i*0.05}/>
    ))}
    {Array.from({ length: 9 }, (_, i) => (
      <line key={i} x1={50} y1={55} x2={i*12.5} y2={100} stroke={accent} strokeWidth="0.25" opacity="0.3"/>
    ))}
  </svg>
);

/* ── Зимний узор (Winter) ─────────────────────────────────────────── */
export const WinterFrost = ({ accent, opacity = 0.55, seed = 5 }: MotifProps) => {
  const flakes = Array.from({ length: 10 }, (_, i) => ({ x: rnd(seed,i)*100, y: rnd(seed,i+30)*100, s: 2+rnd(seed,i+60)*3 }));
  const arm = (cx: number, cy: number, s: number) => Array.from({ length: 6 }, (_, k) => {
    const a = (k/6) * Math.PI * 2;
    return <line key={k} x1={cx} y1={cy} x2={cx+Math.cos(a)*s} y2={cy+Math.sin(a)*s} stroke={accent} strokeWidth="0.3"/>;
  });
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity }}>
      {flakes.map((f,i) => <motion.g key={i} animate={{ opacity: [0.3,0.8,0.3] }} transition={{ duration: 3+rnd(seed,i)*2, repeat: Infinity, delay: i*0.3 }}>{arm(f.x,f.y,f.s)}</motion.g>)}
    </svg>
  );
};

/* ── Языки пламени (Fire) ─────────────────────────────────────────── */
export const FireEmbers = ({ accent, accent2 = '#fde68a', opacity = 0.55, seed = 6 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    <path d="M20 100 C10 75 25 60 20 40 C 35 55 32 70 30 78 C 45 65 35 45 40 25 C 55 45 50 65 55 80 C 65 65 60 50 65 35 C 78 55 70 75 62 100 Z"
      fill={accent} opacity="0.22"/>
    {Array.from({ length: 8 }, (_, i) => (
      <motion.circle key={i} cx={15+rnd(seed,i)*70} cy={95} r={0.7+rnd(seed,i+5)*1}
        fill={accent2} animate={{ cy: [95, 10], opacity: [0.6,0] }} transition={{ duration: 3+rnd(seed,i)*3, repeat: Infinity, delay: i*0.6 }}/>
    ))}
  </svg>
);

/* ── Облачный контур (Cloud) ─────────────────────────────────────── */
export const CloudDrift = ({ accent, opacity = 0.5 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    {[{x:10,y:25,s:1},{x:65,y:15,s:0.7},{x:35,y:80,s:0.85},{x:85,y:70,s:0.6}].map((c,i) => (
      <motion.g key={i} animate={{ x: [0, 8, 0] }} transition={{ duration: 12+i*3, repeat: Infinity, ease: 'easeInOut' }}>
        <ellipse cx={c.x} cy={c.y} rx={14*c.s} ry={7*c.s} fill={accent} opacity="0.16"/>
        <ellipse cx={c.x+8*c.s} cy={c.y-3*c.s} rx={9*c.s} ry={6*c.s} fill={accent} opacity="0.14"/>
        <ellipse cx={c.x-7*c.s} cy={c.y-2*c.s} rx={8*c.s} ry={5*c.s} fill={accent} opacity="0.14"/>
      </motion.g>
    ))}
  </svg>
);

/* ── Аниме-вспышки (Anime) ─────────────────────────────────────────── */
export const AnimeSparkle = ({ accent, opacity = 0.55, seed = 7 }: MotifProps) => (
  <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" style={{ opacity }}>
    {Array.from({ length: 12 }, (_, i) => (
      <line key={i} x1="50" y1="50" x2={50+Math.cos((i/12)*Math.PI*2)*60} y2={50+Math.sin((i/12)*Math.PI*2)*60}
        stroke={accent} strokeWidth="0.25" opacity="0.18"/>
    ))}
    {Array.from({ length: 6 }, (_, i) => {
      const x = rnd(seed,i)*100, y = rnd(seed,i+15)*100, s = 2+rnd(seed,i+30)*3;
      return (
        <motion.path key={i} d={`M${x} ${y-s} L${x+s*0.28} ${y-s*0.28} L${x+s} ${y} L${x+s*0.28} ${y+s*0.28} L${x} ${y+s} L${x-s*0.28} ${y+s*0.28} L${x-s} ${y} L${x-s*0.28} ${y-s*0.28} Z`}
          fill={accent} animate={{ opacity: [0.2,0.9,0.2], scale: [0.8,1.2,0.8] }}
          transition={{ duration: 1.8+rnd(seed,i)*2, repeat: Infinity, delay: i*0.3 }} style={{ transformOrigin: `${x}px ${y}px` }}/>
      );
    })}
  </svg>
);

/** Реестр мотивов по имени — используется каталогами тем/баннеров. */
export const MOTIFS = {
  constellations: Constellations,
  aurora:         AuroraRibbons,
  sakura:         SakuraPetals,
  neonCircuits:   NeonCircuits,
  crystal:        CrystalFacets,
  ocean:          OceanWaves,
  royal:          RoyalFiligree,
  forest:         ForestLeaves,
  glass:          GlassPanes,
  sunset:         SunsetRays,
  vapor:          VaporGrid,
  winter:         WinterFrost,
  fire:           FireEmbers,
  cloud:          CloudDrift,
  anime:          AnimeSparkle,
} as const;

export type MotifName = keyof typeof MOTIFS;
