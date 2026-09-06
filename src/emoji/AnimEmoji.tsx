/* ===============================================================
   SKY ANIMATED EMOJI  -  3D анимированные эмодзи как в Telegram
   + SKY CLOUD  -  виртуальный маскот Sky
=============================================================== */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, type TargetAndTransition } from 'framer-motion';

/* === EMOJI ANIMATION PRESETS ================================
   Каждый тип эмодзи имеет свою физику и характер движения
=============================================================== */
export type EmojiAnim =
  | 'float'    | 'bounce'   | 'spin'     | 'shake'
  | 'pulse'    | 'wave'     | 'explode'  | 'swing'
  | 'heartbeat'| 'tada'     | 'rubber'   | 'jello'
  | 'flip3d'   | 'orbit';

interface EmojiDef {
  char:  string;
  anim:  EmojiAnim;
  scale: number;
  glow?: string;
}

export const ANIMATED_EMOJIS: Record<string, EmojiDef> = {
  // Сердечки
  '❤️':  { char:'❤️',  anim:'heartbeat', scale:1,    glow:'rgba(248,113,113,0.6)' },
  '🥰':  { char:'🥰',  anim:'swing',     scale:1,    glow:'rgba(248,113,113,0.4)' },
  '💖':  { char:'💖',  anim:'heartbeat', scale:1.1,  glow:'rgba(236,72,153,0.6)'  },
  '💘':  { char:'💘',  anim:'pulse',     scale:1,    glow:'rgba(248,113,113,0.5)' },
  '😍':  { char:'😍',  anim:'rubber',    scale:1,    glow:'rgba(250,204,21,0.4)'  },
  // Веселье
  '😂':  { char:'😂',  anim:'shake',     scale:1,    glow:'rgba(250,204,21,0.3)'  },
  '🤣':  { char:'🤣',  anim:'bounce',    scale:1.1,  glow:'rgba(250,204,21,0.3)'  },
  '😎':  { char:'😎',  anim:'swing',     scale:1                                  },
  '🥳':  { char:'🥳',  anim:'tada',      scale:1.1,  glow:'rgba(167,139,250,0.4)' },
  '🎉':  { char:'🎉',  anim:'explode',   scale:1.2,  glow:'rgba(167,139,250,0.5)' },
  '🎊':  { char:'🎊',  anim:'spin',      scale:1.1,  glow:'rgba(79,110,247,0.4)'  },
  // Огонь / сила
  '🔥':  { char:'🔥',  anim:'pulse',     scale:1,    glow:'rgba(249,115,22,0.6)'  },
  '⚡':  { char:'⚡',  anim:'jello',     scale:1,    glow:'rgba(250,204,21,0.7)'  },
  '💥':  { char:'💥',  anim:'explode',   scale:1.2,  glow:'rgba(249,115,22,0.6)'  },
  '🚀':  { char:'🚀',  anim:'orbit',     scale:1,    glow:'rgba(79,110,247,0.5)'  },
  '⭐':  { char:'⭐',  anim:'spin',      scale:1,    glow:'rgba(250,204,21,0.7)'  },
  '🌟':  { char:'🌟',  anim:'pulse',     scale:1.1,  glow:'rgba(250,204,21,0.8)'  },
  '✨':  { char:'✨',  anim:'float',     scale:1,    glow:'rgba(250,204,21,0.5)'  },
  '💫':  { char:'💫',  anim:'orbit',     scale:1,    glow:'rgba(250,204,21,0.4)'  },
  // Флаги / победа
  '🏆':  { char:'🏆',  anim:'tada',      scale:1.1,  glow:'rgba(245,158,11,0.6)'  },
  '👑':  { char:'👑',  anim:'float',     scale:1,    glow:'rgba(245,158,11,0.7)'  },
  '💎':  { char:'💎',  anim:'spin',      scale:1,    glow:'rgba(96,165,250,0.7)'  },
  // Природа
  '🌈':  { char:'🌈',  anim:'wave',      scale:1,    glow:'rgba(167,139,250,0.4)' },
  '☁️':  { char:'☁️',  anim:'float',     scale:1,    glow:'rgba(148,163,184,0.5)' },
  '🌸':  { char:'🌸',  anim:'swing',     scale:1,    glow:'rgba(244,114,182,0.4)' },
  // Еда / разное
  '🍕':  { char:'🍕',  anim:'bounce',    scale:1                                  },
  '🎵':  { char:'🎵',  anim:'wave',      scale:1,    glow:'rgba(79,110,247,0.4)'  },
  '🎮':  { char:'🎮',  anim:'rubber',    scale:1                                  },
  // По умолчанию для всех остальных
  'default': { char:'', anim:'float', scale:1 },
};

/* --- Animation keyframes по типам ------------------------- */
const ANIM_VARIANTS: Record<EmojiAnim, TargetAndTransition> = {
  float: {
    y: [0, -8, 0],
    transition: { duration:2.4, repeat:Infinity, ease:'easeInOut' },
  },
  bounce: {
    y: [0, -14, 0],
    scaleY: [1, 0.85, 1.05, 1],
    transition: { duration:0.6, repeat:Infinity, ease:[0.36,0,0.66,-0.56] },
  },
  spin: {
    rotate: [0, 360],
    transition: { duration:2, repeat:Infinity, ease:'linear' },
  },
  shake: {
    x: [0, -6, 6, -4, 4, -2, 2, 0],
    rotate: [0,-8,8,-5,5,0],
    transition: { duration:0.5, repeat:Infinity, repeatDelay:1.5 },
  },
  pulse: {
    scale: [1, 1.18, 1, 1.1, 1],
    transition: { duration:1.2, repeat:Infinity, ease:'easeInOut' },
  },
  wave: {
    rotate: [0, 15, -8, 15, 0],
    transition: { duration:1.5, repeat:Infinity, ease:'easeInOut' },
  },
  explode: {
    scale: [1, 1.3, 0.9, 1.15, 1],
    rotate: [0, -10, 10, -5, 0],
    transition: { duration:0.7, repeat:Infinity, repeatDelay:2 },
  },
  swing: {
    rotate: [-8, 8, -8],
    transition: { duration:1.8, repeat:Infinity, ease:'easeInOut' },
  },
  heartbeat: {
    scale: [1, 1.25, 1, 1.15, 1],
    transition: { duration:0.9, repeat:Infinity, times:[0,0.14,0.28,0.42,1] },
  },
  tada: {
    scale: [1, 0.9, 0.9, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1],
    rotate: [0,-3,-3,3,-3,3,-3,3,-3,0],
    transition: { duration:1, repeat:Infinity, repeatDelay:2 },
  },
  rubber: {
    scaleX: [1, 1.25, 0.75, 1.15, 0.95, 1.05, 1],
    scaleY: [1, 0.75, 1.25, 0.85, 1.05, 0.95, 1],
    transition: { duration:0.8, repeat:Infinity, repeatDelay:1.5 },
  },
  jello: {
    skewX: [0, -12.5, 6.25, -3.125, 1.5625, 0],
    transition: { duration:0.9, repeat:Infinity, repeatDelay:2 },
  },
  flip3d: {
    rotateY: [0, 180, 360],
    transition: { duration:1.5, repeat:Infinity, repeatDelay:1 },
  },
  orbit: {
    x: [0, 6, 0, -6, 0],
    y: [0, -4, -8, -4, 0],
    transition: { duration:2.5, repeat:Infinity, ease:'easeInOut' },
  },
};

/* === ANIMATED EMOJI COMPONENT =============================== */
interface AnimEmojiProps {
  emoji:   string;
  size?:   number | string;  // px or tailwind text-size
  playing?: boolean;         // false = static
  onClick?: () => void;
  className?: string;
}

export const AnimEmoji = ({ emoji, size=40, playing=true, onClick, className='' }: AnimEmojiProps) => {
  const def  = ANIMATED_EMOJIS[emoji] ?? ANIMATED_EMOJIS['default'];
  const anim = ANIM_VARIANTS[def.anim];
  const [active, setActive] = useState(playing);
  const [burst, setBurst] = useState(false);

  const handleClick = () => {
    setBurst(true);
    setTimeout(() => setBurst(false), 600);
    onClick?.();
  };

  const sizeStyle = typeof size === 'number' ? { fontSize: size } : {};

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={handleClick}>

      {/* Glow halo */}
      {def.glow && active && (
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background:`radial-gradient(circle, ${def.glow} 0%, transparent 70%)`,
            transform:'scale(1.8)', zIndex:0 }}
          animate={{ opacity:[0.3, 0.7, 0.3] }}
          transition={{ duration:2, repeat:Infinity, ease:'easeInOut' }}/>
      )}

      {/* Burst particles on click */}
      <AnimatePresence>
        {burst && (
          <>
            {[...Array(6)].map((_,i) => (
              <motion.div key={i}
                className="absolute text-sm pointer-events-none select-none"
                style={{ zIndex:10 }}
                initial={{ x:0, y:0, opacity:1, scale:0.5 }}
                animate={{
                  x: Math.cos(i/6*Math.PI*2) * 28,
                  y: Math.sin(i/6*Math.PI*2) * 28,
                  opacity:0, scale:1.2,
                }}
                exit={{ opacity:0 }}
                transition={{ duration:0.55, ease:'easeOut' }}>
                ✦
              </motion.div>
            ))}
          </>
        )}
      </AnimatePresence>

      {/* Emoji */}
      <motion.span
        className="select-none relative z-1"
        style={{ ...sizeStyle,
          display:'inline-block',
          transformOrigin:'bottom center',
          transform:`scale(${def.scale})`,
          filter: def.glow && active
            ? `drop-shadow(0 2px 8px ${def.glow})`
            : 'none',
        }}
        animate={active ? anim : {}}
        whileHover={!active && onClick ? { scale:1.2 } : {}}
        whileTap={onClick ? { scale:0.9 } : {}}>
        {emoji}
      </motion.span>
    </div>
  );
};

/* === EMOJI REACTION ROW ====================================
   Строка быстрых реакций с 3D анимацией
=============================================================== */
const QUICK_REACTIONS = ['❤️','🔥','😂','😍','👑','⭐','🎉','💎'];

interface EmojiReactionProps {
  onSelect: (emoji: string) => void;
}

export const EmojiReactionBar = ({ onSelect }: EmojiReactionProps) => {
  const [hovered, setHovered] = useState<string|null>(null);

  return (
    <div className="flex items-center gap-1 px-2 py-2">
      {QUICK_REACTIONS.map((e, i) => (
        <motion.button key={e} type="button"
          initial={{ scale:0, opacity:0 }}
          animate={{ scale:1, opacity:1 }}
          transition={{ delay:i*0.04, type:'spring', stiffness:400, damping:18 }}
          whileHover={{ scale:1.4, y:-8, zIndex:10 }}
          whileTap={{ scale:0.85 }}
          onHoverStart={() => setHovered(e)}
          onHoverEnd={() => setHovered(null)}
          onClick={() => onSelect(e)}
          className="relative text-2xl leading-none rounded-xl p-1.5 transition-colors hover:bg-white/10"
          style={{ zIndex:hovered===e ? 10 : 1 }}>
          <span style={{
            display:'inline-block',
            filter: ANIMATED_EMOJIS[e]?.glow
              ? `drop-shadow(0 2px 6px ${ANIMATED_EMOJIS[e].glow})`
              : 'none',
          }}>
            {e}
          </span>
          {hovered === e && (
            <motion.div
              initial={{ opacity:0, scale:0.5, y:0 }}
              animate={{ opacity:1, scale:1, y:-4 }}
              className="absolute -top-8 left-1/2 -translate-x-1/2 text-xl pointer-events-none">
              {e}
            </motion.div>
          )}
        </motion.button>
      ))}
    </div>
  );
};

/* ===============================================================
   ☁️ SKY CLOUD MASCOT  -  виртуальное лицо Sky
   Аналог Telegram Duck  -  появляется в разных состояниях
=============================================================== */
export type CloudMood =
  | 'idle'       // спокойное
  | 'happy'      // радостное  -  новое сообщение, подарок
  | 'thinking'   // думает  -  загрузка AI
  | 'sleeping'   // спит  -  офлайн
  | 'surprised'  // удивлён  -  ошибка
  | 'waving'     // машет  -  приветствие
  | 'celebrating'// праздник  -  достижение, Prime
  | 'sad'        // грустный  -  пустой экран
  | 'cool';      // в очках  -  гейминг

const CLOUD_MOODS: Record<CloudMood, {
  eyes:       string;
  mouth:      string;
  accessory?: string;
  bg:         string;
  anim:       TargetAndTransition;
  particles?: string[];
}> = {
  idle: {
    eyes:'◕ ◕', mouth:'‿', bg:'#e0f2fe',
    anim:{ y:[0,-6,0], transition:{duration:3,repeat:Infinity,ease:'easeInOut'} },
  },
  happy: {
    eyes:'˘ ˘', mouth:'◡', bg:'#fef3c7',
    anim:{ y:[0,-10,0], scale:[1,1.04,1], transition:{duration:1.5,repeat:Infinity,ease:'easeInOut'} },
    particles:['✨','⭐','💫'],
  },
  thinking: {
    eyes:'◔ ◔', mouth:' - ', bg:'#f3e8ff',
    anim:{ rotate:[-3,3,-3], transition:{duration:2,repeat:Infinity,ease:'easeInOut'} },
    particles:['💭','...'],
  },
  sleeping: {
    eyes:' -   - ', mouth:'‿', bg:'#e0f2fe',
    anim:{ y:[0,-4,0], scaleY:[1,0.97,1], transition:{duration:4,repeat:Infinity,ease:'easeInOut'} },
    particles:['💤','Zzz'],
  },
  surprised: {
    eyes:'◉ ◉', mouth:'○', bg:'#fff7ed',
    anim:{ scale:[1,1.08,1], transition:{duration:0.5,repeat:Infinity,ease:'easeInOut'} },
    particles:['❗','!!'],
  },
  waving: {
    eyes:'◕ ◕', mouth:'◡', bg:'#dcfce7',
    anim:{ y:[0,-8,0], transition:{duration:1.8,repeat:Infinity,ease:'easeInOut'} },
    particles:['👋'],
  },
  celebrating: {
    eyes:'★ ★', mouth:'◡', bg:'#fef3c7',
    anim:{ y:[0,-14,2], rotate:[-5,5,-5], transition:{duration:0.8,repeat:Infinity,ease:'easeInOut'} },
    particles:['🎉','🎊','✨','⭐'],
  },
  sad: {
    eyes:'◡ ◡', mouth:'⌢', bg:'#f0f9ff',
    anim:{ y:[0,-3,0], transition:{duration:3.5,repeat:Infinity,ease:'easeInOut'} },
  },
  cool: {
    eyes:'▬ ▬', mouth:'‿', bg:'#1e1b4b',
    anim:{ y:[0,-6,0], rotate:[-2,2,-2], transition:{duration:2.5,repeat:Infinity,ease:'easeInOut'} },
    particles:['🎮','⚡'],
  },
};

interface CloudMascotProps {
  mood?:     CloudMood;
  size?:     'sm' | 'md' | 'lg' | 'xl';
  message?:  string;
  onClick?:  () => void;
  className?: string;
}

const SIZE_MAP = { sm:60, md:90, lg:120, xl:160 };
const FONT_MAP = { sm:12, md:16, lg:22, xl:28 };

export const CloudMascot = ({
  mood = 'idle',
  size = 'md',
  message,
  onClick,
  className = '',
}: CloudMascotProps) => {
  const [currentMood, setCurrentMood] = useState(mood);
  const [blink, setBlink] = useState(false);
  const m  = CLOUD_MOODS[currentMood];
  const px = SIZE_MAP[size];
  const fs = FONT_MAP[size];
  const [particles, setParticles] = useState<{id:number;x:number;y:number;ch:string}[]>([]);

  useEffect(() => { setCurrentMood(mood); }, [mood]);

  // Blink every 3-5s
  useEffect(() => {
    const blink = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
    };
    const t = setInterval(blink, 3000 + Math.random() * 2000);
    return () => clearInterval(t);
  }, []);

  // Particle burst on happy/celebrating
  useEffect(() => {
    if (!m.particles) return;
    const emit = () => {
      const id = Date.now();
      const ch = m.particles![Math.floor(Math.random() * m.particles!.length)];
      const x  = (Math.random()-0.5)*80;
      const y  = -30 - Math.random()*40;
      setParticles(p => [...p, {id, x, y, ch}]);
      setTimeout(() => setParticles(p => p.filter(pp => pp.id !== id)), 1200);
    };
    const t = setInterval(emit, 800);
    return () => clearInterval(t);
  }, [currentMood]);

  const handleClick = () => {
    setCurrentMood('happy');
    setTimeout(() => setCurrentMood(mood), 2000);
    onClick?.();
  };

  return (
    <div className={`relative inline-flex flex-col items-center ${className}`}
      style={{ cursor: onClick ? 'pointer' : 'default' }}>

      {/* Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-visible" style={{ zIndex:10 }}>
        {particles.map(p => (
          <motion.span key={p.id}
            style={{ position:'absolute', left:'50%', top:'20%', fontSize:fs*0.7 }}
            initial={{ x:p.x, y:0, opacity:1, scale:0.5 }}
            animate={{ y:p.y, opacity:0, scale:1.2 }}
            transition={{ duration:1.2, ease:'easeOut' }}>
            {p.ch}
          </motion.span>
        ))}
      </div>

      {/* Cloud body */}
      <motion.div
        animate={m.anim}
        onClick={handleClick}
        style={{
          width:px, height:px*0.75,
          position:'relative', cursor:'pointer',
          filter:`drop-shadow(0 ${px*0.08}px ${px*0.12}px rgba(0,0,0,0.15))`,
        }}>

        {/* SVG cloud shape */}
        <svg viewBox="0 0 120 80" style={{ width:'100%', height:'100%', overflow:'visible' }}>
          <defs>
            <radialGradient id="cloudGrad" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="white"/>
              <stop offset="100%" stopColor={m.bg}/>
            </radialGradient>
          </defs>
          {/* Cloud bumps */}
          <circle cx="30"  cy="50" r="22" fill="url(#cloudGrad)"/>
          <circle cx="55"  cy="35" r="28" fill="url(#cloudGrad)"/>
          <circle cx="82"  cy="46" r="22" fill="url(#cloudGrad)"/>
          <circle cx="68"  cy="60" r="18" fill="url(#cloudGrad)"/>
          <circle cx="38"  cy="60" r="18" fill="url(#cloudGrad)"/>
          {/* Bottom flat base */}
          <rect x="14" y="55" width="92" height="18" rx="9" fill="url(#cloudGrad)"/>

          {/* Eyes */}
          {!blink ? (
            <>
              <circle cx="43" cy="46" r={fs*0.35} fill="#334155"/>
              <circle cx="73" cy="46" r={fs*0.35} fill="#334155"/>
              {/* Eye shine */}
              <circle cx="45" cy="44" r={fs*0.12} fill="white"/>
              <circle cx="75" cy="44" r={fs*0.12} fill="white"/>
            </>
          ) : (
            <>
              <line x1="39" y1="46" x2="47" y2="46" stroke="#334155" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="69" y1="46" x2="77" y2="46" stroke="#334155" strokeWidth="2.5" strokeLinecap="round"/>
            </>
          )}

          {/* Mouth */}
          {currentMood === 'surprised' ? (
            <ellipse cx="58" cy="57" rx="5" ry="5.5" fill="#334155"/>
          ) : currentMood === 'sad' ? (
            <path d="M 47 58 Q 58 53 69 58" stroke="#334155" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          ) : (
            <path d="M 47 55 Q 58 63 69 55" stroke="#334155" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          )}

          {/* Accessories */}
          {currentMood === 'sleeping' && (
            <text x="72" y="36" fontSize="14" style={{ userSelect:'none' }}>💤</text>
          )}
          {currentMood === 'cool' && (
            <>
              <rect x="34" y="40" width="18" height="11" rx="5" fill="#1e293b" opacity="0.9"/>
              <rect x="64" y="40" width="18" height="11" rx="5" fill="#1e293b" opacity="0.9"/>
              <line x1="52" y1="46" x2="64" y2="46" stroke="#1e293b" strokeWidth="2"/>
            </>
          )}
          {currentMood === 'celebrating' && (
            <text x="92" y="22" fontSize="18" style={{ userSelect:'none' }}>🎉</text>
          )}
          {currentMood === 'thinking' && (
            <>
              <circle cx="80" cy="26" r="3" fill="#a78bfa" opacity="0.6"/>
              <circle cx="88" cy="18" r="4.5" fill="#a78bfa" opacity="0.7"/>
              <circle cx="97" cy="10" r="6" fill="#a78bfa" opacity="0.8"/>
            </>
          )}
          {currentMood === 'waving' && (
            <text x="95" y="35" fontSize="18"
              style={{ userSelect:'none', animation:'sky-wave-arm 0.6s ease-in-out infinite',
                transformOrigin:'95px 35px', display:'inline-block' }}>
              👋
            </text>
          )}
          {/* Rosy cheeks */}
          {['happy','celebrating','waving'].includes(currentMood) && (
            <>
              <ellipse cx="36" cy="52" rx="7" ry="5" fill="#fca5a5" opacity="0.35"/>
              <ellipse cx="80" cy="52" rx="7" ry="5" fill="#fca5a5" opacity="0.35"/>
            </>
          )}

          {/* Sky logo on chest (small) */}
          <text x="49" y="68" fontSize="8" fill="#64748b" opacity="0.6" fontWeight="bold" fontFamily="system-ui">sky</text>
        </svg>
      </motion.div>

      {/* Message bubble */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity:0, scale:0.7, y:6 }}
            animate={{ opacity:1, scale:1, y:0 }}
            exit={{ opacity:0, scale:0.7 }}
            transition={{ type:'spring', stiffness:400, damping:20 }}
            className="mt-2 px-3 py-1.5 rounded-2xl text-center max-w-48"
            style={{
              background:'white',
              boxShadow:'0 4px 16px rgba(0,0,0,0.12)',
              color:'#334155',
              fontSize: fs * 0.65,
              fontWeight:600,
              position:'relative',
            }}>
            {/* Triangle */}
            <div style={{
              position:'absolute', top:-6, left:'50%', transform:'translateX(-50%)',
              width:0, height:0,
              borderLeft:'6px solid transparent',
              borderRight:'6px solid transparent',
              borderBottom:'6px solid white',
            }}/>
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* === CLOUD EMPTY STATES ==================================== */
interface EmptyStateProps {
  mood?:    CloudMood;
  title:    string;
  subtitle?: string;
  action?:  { label:string; onClick:()=>void };
}

export const CloudEmptyState = ({ mood='sad', title, subtitle, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center gap-4 py-12 px-6 text-center">
    <CloudMascot mood={mood} size="lg" message={undefined}/>
    <div>
      <p className="text-base font-bold" style={{ color:'var(--t1)' }}>{title}</p>
      {subtitle && <p className="text-sm mt-1" style={{ color:'var(--t2)' }}>{subtitle}</p>}
    </div>
    {action && (
      <motion.button whileTap={{ scale:.95 }} type="button" onClick={action.onClick}
        className="rounded-2xl px-6 py-3 text-sm font-bold text-white"
        style={{ background:'var(--accent)' }}>
        {action.label}
      </motion.button>
    )}
  </div>
);

/* === CLOUD LOADING ======================================== */
export const CloudLoading = ({ message='Загрузка...' }: { message?:string }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-8">
    <CloudMascot mood="thinking" size="md"/>
    <p className="text-sm font-medium" style={{ color:'var(--t2)' }}>{message}</p>
  </div>
);
