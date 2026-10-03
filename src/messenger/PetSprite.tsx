/* ===============================================================
   PET SPRITE  -  SVG-персонажи питомцев с настоящими эмоциями
   Анимированные: idle (дыхание), happy (прыжки), excited (вибрация),
   sleepy (зевота), love (сердечки), angry (дрожь)
=============================================================== */
import { useEffect, useMemo, useState, useRef } from 'react';
import { motion, AnimatePresence, type TargetAndTransition, type Transition } from 'framer-motion';
import type { PetMood } from './petsApi';

/* Раньше SVG-перекраска питомца шла по локальному мок-каталогу скинов
   (petSkins.ts: bodyColor/accentColor/eyeColor на выбор за Баллы
   Прайма) — отдельная, чисто косметическая система, никак не связанная
   с настоящим Sky Skin Market (server/skinMarket.mjs — надеваемые
   предметы с реальным медиа: skin/outfit/headwear/… а не перекраска).
   Тип питомца с сервера несёт только один цвет (pet_types.base_color),
   поэтому раскраска тела теперь считается от него же — тон акцента и
   подсветка выводятся автоматически, а не выбираются из каталога. */
interface SpriteSkin { bodyColor: string; accentColor: string; eyeColor: string; extraColor?: string; glow: string; badge?: string }

const clampByte = (n: number) => Math.max(0, Math.min(255, n));
const shade = (hex: string, amt: number): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = clampByte(((n >> 16) & 255) + amt);
  const g = clampByte(((n >> 8) & 255) + amt);
  const b = clampByte((n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
};
const toRgba = (hex: string, alpha: number): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(139,92,246,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};
/** Из одного базового цвета типа питомца собираем ту же палитру, которую
 *  раньше задавал локальный скин, — акцент темнее тела, глаза — тёмные. */
const deriveSkin = (color: string, badge?: string): SpriteSkin => ({
  bodyColor: color,
  accentColor: shade(color, -36),
  eyeColor: '#2d1a0e',
  glow: toRgba(color, 0.5),
  badge,
});

/* -- Emotion overlays -------------------------------------- */
const EmotionParticles = ({ mood, color }: { mood: PetMood; color: string }) => {
  if (mood === 'idle') return null;

  const particles = {
    happy:   [{ e:'✨',x:30,y:-20 }, { e:'⭐',x:-25,y:-30 }, { e:'💛',x:20,y:-45 }],
    excited: [{ e:'⚡',x:35,y:-15 }, { e:'💥',x:-30,y:-25 }, { e:'🌟',x:10,y:-50 }],
    sleepy:  [{ e:'💤',x:30,y:-20 }, { e:'😴',x:-20,y:-35 }, { e:'z',x:15,y:-50 }],
    love:    [{ e:'❤️',x:35,y:-20 }, { e:'💕',x:-25,y:-30 }, { e:'💖',x:10,y:-48 }],
  };

  const pts = particles[mood as keyof typeof particles] ?? [];

  return (
    <>
      {pts.map((p, i) => (
        <motion.div key={i}
          className="absolute pointer-events-none select-none text-base"
          style={{ bottom: '100%', left: '50%' }}
          initial={{ opacity: 0, x: p.x * 0.5, y: 0, scale: 0.3 }}
          animate={{ opacity: [0, 1, 1, 0], x: p.x, y: p.y, scale: [0.3, 1.1, 1, 0.8] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.3, ease: 'easeOut' }}>
          {p.e}
        </motion.div>
      ))}
    </>
  );
};

/* -- SVG Cat ----------------------------------------------- */
const SvgCat = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const eyeClosed = blinkState || mood === 'sleepy';
  const happyEyes = mood === 'happy' || mood === 'love';
  const excitedEyes = mood === 'excited';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Tail */}
      <motion.path
        d={`M${20 + s*0.05} 60 Q10 70 15 75 Q20 80 25 72 Q30 65 ${20 + s*0.05} 58`}
        fill={skin.accentColor}
        animate={{ rotate: mood === 'happy' || mood === 'excited' ? [0, 25, -10, 20, 0] : [0, 8, -5, 3, 0] }}
        style={{ transformOrigin: '20px 60px' }}
        transition={{ duration: mood === 'happy' ? 0.8 : 2.5, repeat: Infinity, ease: 'easeInOut' }}/>
      {/* Body */}
      <ellipse cx="40" cy="52" rx="22" ry="18" fill={skin.bodyColor}/>
      {/* Belly */}
      <ellipse cx="40" cy="55" rx="13" ry="11" fill={skin.extraColor ?? skin.accentColor + '80'}/>
      {/* Head */}
      <circle cx="40" cy="30" r="20" fill={skin.bodyColor}/>
      {/* Ears */}
      <polygon points="22,16 15,3 30,12" fill={skin.bodyColor}/>
      <polygon points="58,16 65,3 50,12" fill={skin.bodyColor}/>
      <polygon points="24,15 18,6 29,13" fill={skin.accentColor + '80'}/>
      <polygon points="56,15 62,6 51,13" fill={skin.accentColor + '80'}/>
      {/* Eyes */}
      {eyeClosed ? (
        <>
          <path d="M29 30 Q33 27 37 30" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M43 30 Q47 27 51 30" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        </>
      ) : happyEyes ? (
        <>
          <path d="M29 31 Q33 26 37 31" stroke={skin.eyeColor} strokeWidth="2.5" strokeLinecap="round" fill="none"/>
          <path d="M43 31 Q47 26 51 31" stroke={skin.eyeColor} strokeWidth="2.5" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <ellipse cx="33" cy="30" rx={excitedEyes?5:4} ry={excitedEyes?6:5} fill={skin.eyeColor}/>
          <ellipse cx="47" cy="30" rx={excitedEyes?5:4} ry={excitedEyes?6:5} fill={skin.eyeColor}/>
          <ellipse cx="34" cy="29" rx="1.5" ry="2" fill="white" opacity="0.8"/>
          <ellipse cx="48" cy="29" rx="1.5" ry="2" fill="white" opacity="0.8"/>
        </>
      )}
      {/* Nose + mouth */}
      <ellipse cx="40" cy="36" rx="2.5" ry="2" fill={skin.accentColor}/>
      {mood === 'happy' || mood === 'excited' || mood === 'love'
        ? <path d="M36 39 Q40 43 44 39" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        : <path d="M37 39 Q40 41 43 39" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      }
      {/* Whiskers */}
      <line x1="12" y1="35" x2="32" y2="37" stroke={skin.accentColor} strokeWidth="1" opacity="0.6"/>
      <line x1="12" y1="38" x2="32" y2="39" stroke={skin.accentColor} strokeWidth="1" opacity="0.6"/>
      <line x1="48" y1="37" x2="68" y2="35" stroke={skin.accentColor} strokeWidth="1" opacity="0.6"/>
      <line x1="48" y1="39" x2="68" y2="38" stroke={skin.accentColor} strokeWidth="1" opacity="0.6"/>
      {/* Blush */}
      {(mood === 'love' || mood === 'happy') && (
        <>
          <ellipse cx="24" cy="36" rx="5" ry="3" fill="#f9a8d4" opacity="0.5"/>
          <ellipse cx="56" cy="36" rx="5" ry="3" fill="#f9a8d4" opacity="0.5"/>
        </>
      )}
      {/* Paws */}
      <ellipse cx="22" cy="66" rx="7" ry="5" fill={skin.bodyColor}/>
      <ellipse cx="58" cy="66" rx="7" ry="5" fill={skin.bodyColor}/>
      {/* Skin badge */}
      {skin.badge && (
        <text x="60" y="20" fontSize="14" textAnchor="middle">{skin.badge}</text>
      )}
    </svg>
  );
};

/* -- SVG Fox ----------------------------------------------- */
const SvgFox = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const eyeClosed = blinkState || mood === 'sleepy';
  const happy = mood === 'happy' || mood === 'love';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Tail  -  big fluffy */}
      <motion.ellipse cx="18" cy="62" rx="14" ry="10" fill={skin.bodyColor}
        animate={{ rotate: happy ? [0, 30, -15, 25, 0] : [0, 12, -8, 5, 0] }}
        style={{ transformOrigin: '25px 62px' }}
        transition={{ duration: happy ? 0.7 : 2.2, repeat: Infinity }}/>
      <motion.ellipse cx="14" cy="65" rx="8" ry="6" fill="white" opacity="0.9"
        animate={{ rotate: happy ? [0, 30, -15, 25, 0] : [0, 12, -8, 5, 0] }}
        style={{ transformOrigin: '25px 62px' }}
        transition={{ duration: happy ? 0.7 : 2.2, repeat: Infinity }}/>
      {/* Body */}
      <ellipse cx="40" cy="53" rx="21" ry="17" fill={skin.bodyColor}/>
      <ellipse cx="40" cy="57" rx="12" ry="9" fill="white" opacity="0.9"/>
      {/* Head */}
      <ellipse cx="40" cy="29" rx="20" ry="19" fill={skin.bodyColor}/>
      {/* Pointy ears */}
      <polygon points="23,16 17,0 32,14" fill={skin.bodyColor}/>
      <polygon points="57,16 63,0 48,14" fill={skin.bodyColor}/>
      <polygon points="25,14 20,4 30,12" fill={skin.accentColor + '90'}/>
      <polygon points="55,14 60,4 50,12" fill={skin.accentColor + '90'}/>
      {/* Face white */}
      <ellipse cx="40" cy="33" rx="12" ry="10" fill="white" opacity="0.85"/>
      {/* Eyes */}
      {eyeClosed ? (
        <>
          <path d="M30 29 Q33 26 36 29" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M44 29 Q47 26 50 29" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <ellipse cx="33" cy="29" rx="4" ry="4.5" fill={skin.eyeColor}/>
          <ellipse cx="47" cy="29" rx="4" ry="4.5" fill={skin.eyeColor}/>
          <ellipse cx="34" cy="27.5" rx="1.5" ry="1.5" fill="white" opacity="0.8"/>
          <ellipse cx="48" cy="27.5" rx="1.5" ry="1.5" fill="white" opacity="0.8"/>
        </>
      )}
      {/* Nose */}
      <ellipse cx="40" cy="35" rx="3" ry="2.5" fill={skin.accentColor}/>
      {happy
        ? <path d="M36 39 Q40 44 44 39" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        : <path d="M37 39 Q40 42 43 39" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      }
      {/* Whiskers */}
      <line x1="10" y1="34" x2="30" y2="36" stroke={skin.accentColor} strokeWidth="1" opacity="0.5"/>
      <line x1="10" y1="37" x2="30" y2="38" stroke={skin.accentColor} strokeWidth="1" opacity="0.5"/>
      <line x1="50" y1="36" x2="70" y2="34" stroke={skin.accentColor} strokeWidth="1" opacity="0.5"/>
      <line x1="50" y1="38" x2="70" y2="37" stroke={skin.accentColor} strokeWidth="1" opacity="0.5"/>
      {/* Blush */}
      {happy && (
        <>
          <ellipse cx="25" cy="35" rx="5" ry="3" fill="#f9a8d4" opacity="0.5"/>
          <ellipse cx="55" cy="35" rx="5" ry="3" fill="#f9a8d4" opacity="0.5"/>
        </>
      )}
      {/* Paws */}
      <ellipse cx="23" cy="67" rx="7" ry="5" fill={skin.bodyColor}/>
      <ellipse cx="57" cy="67" rx="7" ry="5" fill={skin.bodyColor}/>
      {skin.badge && <text x="62" y="18" fontSize="14">{skin.badge}</text>}
    </svg>
  );
};

/* -- SVG Dragon -------------------------------------------- */
const SvgDragon = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const happy = mood === 'happy' || mood === 'love';
  const excited = mood === 'excited';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Wings */}
      <motion.path d="M20 35 Q5 20 10 10 Q15 5 22 18 Q25 25 28 32"
        fill={skin.accentColor} opacity="0.85"
        animate={{ rotate: excited ? [-20, 10, -20] : [0, -8, 0], scaleX: excited ? [1, 1.1, 1] : 1 }}
        style={{ transformOrigin: '20px 35px' }}
        transition={{ duration: excited ? 0.4 : 2, repeat: Infinity }}/>
      <motion.path d="M60 35 Q75 20 70 10 Q65 5 58 18 Q55 25 52 32"
        fill={skin.accentColor} opacity="0.85"
        animate={{ rotate: excited ? [20, -10, 20] : [0, 8, 0], scaleX: excited ? [1, 1.1, 1] : 1 }}
        style={{ transformOrigin: '60px 35px' }}
        transition={{ duration: excited ? 0.4 : 2, repeat: Infinity }}/>
      {/* Tail with spikes */}
      <motion.path d="M20 58 Q8 65 12 72 Q16 78 22 70 Q26 62 22 55"
        fill={skin.bodyColor}
        animate={{ rotate: happy ? [0,20,-10,15,0] : [0,8,-4,0] }}
        style={{ transformOrigin: '20px 58px' }}
        transition={{ duration: happy ? 0.9 : 2.5, repeat: Infinity }}/>
      {/* Body */}
      <ellipse cx="40" cy="53" rx="20" ry="16" fill={skin.bodyColor}/>
      {/* Belly scales */}
      <ellipse cx="40" cy="57" rx="11" ry="8" fill={skin.extraColor ?? skin.accentColor + '60'}/>
      {/* Head */}
      <ellipse cx="40" cy="28" rx="18" ry="17" fill={skin.bodyColor}/>
      {/* Horns */}
      <path d="M28 14 L24 3 L31 12" fill={skin.accentColor}/>
      <path d="M52 14 L56 3 L49 12" fill={skin.accentColor}/>
      {/* Back spikes */}
      <polygon points="32,38 29,30 35,38" fill={skin.accentColor}/>
      <polygon points="40,36 37,28 43,36" fill={skin.accentColor}/>
      <polygon points="48,38 45,30 51,38" fill={skin.accentColor}/>
      {/* Eyes */}
      {blinkState || mood === 'sleepy' ? (
        <>
          <path d="M30 28 Q33 25 36 28" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M44 28 Q47 25 50 28" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <ellipse cx="33" cy="28" rx="4.5" ry="5" fill={skin.eyeColor}/>
          <ellipse cx="47" cy="28" rx="4.5" ry="5" fill={skin.eyeColor}/>
          {/* Slit pupils */}
          <ellipse cx="33" cy="28" rx="1.5" ry="3" fill="rgba(0,0,0,0.6)"/>
          <ellipse cx="47" cy="28" rx="1.5" ry="3" fill="rgba(0,0,0,0.6)"/>
          <ellipse cx="34" cy="26" rx="1" ry="1" fill="white" opacity="0.8"/>
          <ellipse cx="48" cy="26" rx="1" ry="1" fill="white" opacity="0.8"/>
        </>
      )}
      {/* Nostrils + mouth */}
      <ellipse cx="37" cy="34" rx="1.5" ry="1" fill={skin.accentColor}/>
      <ellipse cx="43" cy="34" rx="1.5" ry="1" fill={skin.accentColor}/>
      {happy
        ? <path d="M33 38 Q40 44 47 38" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        : <path d="M35 38 Q40 41 45 38" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      }
      {/* Fire breath when excited */}
      {excited && (
        <motion.text x="38" y="50" fontSize="14" textAnchor="middle"
          animate={{ opacity:[0,1,0], y:[50,60,50], scale:[0.5,1.2,0.5] }}
          transition={{ duration:0.5, repeat:Infinity }}>
          🔥
        </motion.text>
      )}
      {/* Paws */}
      <ellipse cx="24" cy="67" rx="7" ry="5" fill={skin.bodyColor}/>
      <ellipse cx="56" cy="67" rx="7" ry="5" fill={skin.bodyColor}/>
      {skin.badge && <text x="62" y="18" fontSize="14">{skin.badge}</text>}
    </svg>
  );
};

/* -- SVG Bunny --------------------------------------------- */
const SvgBunny = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const happy = mood === 'happy' || mood === 'love';
  const sleepy = mood === 'sleepy';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Long ears */}
      <motion.ellipse cx="28" cy="12" rx="7" ry="16" fill={skin.bodyColor}
        animate={{ rotate: happy ? [-5, 8, -5] : [0, 3, -2, 0] }}
        style={{ transformOrigin: '28px 24px' }}
        transition={{ duration: happy ? 0.6 : 3, repeat: Infinity }}/>
      <motion.ellipse cx="52" cy="12" rx="7" ry="16" fill={skin.bodyColor}
        animate={{ rotate: happy ? [5, -8, 5] : [0, -3, 2, 0] }}
        style={{ transformOrigin: '52px 24px' }}
        transition={{ duration: happy ? 0.6 : 3, repeat: Infinity, delay: 0.1 }}/>
      {/* Inner ear */}
      <ellipse cx="28" cy="12" rx="4" ry="11" fill={skin.accentColor + '70'}/>
      <ellipse cx="52" cy="12" rx="4" ry="11" fill={skin.accentColor + '70'}/>
      {/* Body */}
      <ellipse cx="40" cy="55" rx="22" ry="19" fill={skin.bodyColor}/>
      {/* Belly */}
      <ellipse cx="40" cy="58" rx="13" ry="12" fill={skin.extraColor ?? 'white'} opacity="0.8"/>
      {/* Head */}
      <circle cx="40" cy="31" r="19" fill={skin.bodyColor}/>
      {/* Eyes */}
      {blinkState || sleepy ? (
        <>
          <path d="M30 31 Q33 28 36 31" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M44 31 Q47 28 50 31" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <circle cx="33" cy="31" r={happy ? 4.5 : 4} fill={skin.eyeColor}/>
          <circle cx="47" cy="31" r={happy ? 4.5 : 4} fill={skin.eyeColor}/>
          <circle cx="34.5" cy="29.5" r="1.5" fill="white" opacity="0.8"/>
          <circle cx="48.5" cy="29.5" r="1.5" fill="white" opacity="0.8"/>
        </>
      )}
      {/* Nose */}
      <ellipse cx="40" cy="37" rx="3" ry="2" fill={skin.accentColor}/>
      {happy
        ? <path d="M35 41 Q40 46 45 41" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
        : <path d="M37 41 Q40 43 43 41" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      }
      {/* Whiskers */}
      <line x1="12" y1="36" x2="31" y2="38" stroke={skin.accentColor} strokeWidth="1" opacity="0.4"/>
      <line x1="12" y1="39" x2="31" y2="40" stroke={skin.accentColor} strokeWidth="1" opacity="0.4"/>
      <line x1="49" y1="38" x2="68" y2="36" stroke={skin.accentColor} strokeWidth="1" opacity="0.4"/>
      <line x1="49" y1="40" x2="68" y2="39" stroke={skin.accentColor} strokeWidth="1" opacity="0.4"/>
      {/* Blush */}
      {happy && (
        <>
          <ellipse cx="24" cy="37" rx="5" ry="3" fill="#f9a8d4" opacity="0.55"/>
          <ellipse cx="56" cy="37" rx="5" ry="3" fill="#f9a8d4" opacity="0.55"/>
        </>
      )}
      {/* Cotton tail */}
      <circle cx="60" cy="62" r="6" fill="white" opacity="0.9"/>
      {/* Paws */}
      <ellipse cx="22" cy="70" rx="8" ry="5" fill={skin.bodyColor}/>
      <ellipse cx="58" cy="70" rx="8" ry="5" fill={skin.bodyColor}/>
      {skin.badge && <text x="62" y="18" fontSize="14">{skin.badge}</text>}
    </svg>
  );
};

/* -- SVG Shark ----------------------------------------------- */
const SvgShark = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const happy = mood === 'happy' || mood === 'love';
  const excited = mood === 'excited';
  const sleepy = mood === 'sleepy';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Tail fin */}
      <motion.path d="M12 50 Q2 40 4 58 Q2 70 14 60" fill={skin.bodyColor}
        animate={{ rotate: excited ? [0, -18, 12, 0] : [0, -8, 5, 0] }}
        style={{ transformOrigin: '14px 55px' }}
        transition={{ duration: excited ? 0.5 : 2.2, repeat: Infinity, ease: 'easeInOut' }}/>
      {/* Body */}
      <ellipse cx="44" cy="46" rx="26" ry="17" fill={skin.bodyColor}/>
      {/* Belly */}
      <path d="M22 50 Q44 62 66 50 Q44 58 22 50" fill={skin.extraColor ?? '#fff'} opacity="0.85"/>
      {/* Dorsal fin */}
      <motion.path d="M38 30 Q44 10 52 30" fill={skin.accentColor}
        animate={{ rotate: happy ? [0, 6, -6, 0] : [0, 2, -2, 0] }}
        style={{ transformOrigin: '44px 30px' }}
        transition={{ duration: 1.8, repeat: Infinity }}/>
      {/* Snout */}
      <ellipse cx="68" cy="46" rx="10" ry="10" fill={skin.bodyColor}/>
      {/* Gills */}
      <path d="M52 40 L52 52 M57 39 L57 53 M62 39 L62 53" stroke={skin.accentColor} strokeWidth="1.4" opacity="0.6"/>
      {/* Eye */}
      {blinkState || sleepy
        ? <path d="M68 42 Q71 40 74 42" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        : <>
            <circle cx="71" cy="42" r={excited ? 4 : 3.2} fill={skin.eyeColor}/>
            <circle cx="72.3" cy="40.8" r="1.1" fill="white" opacity="0.85"/>
          </>
      }
      {/* Teeth / smile */}
      {happy || excited
        ? <path d="M64 53 L68 58 L72 53 L76 58 L79 52" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none"/>
        : <path d="M62 52 Q68 56 76 52" stroke={skin.accentColor} strokeWidth="1.5" strokeLinecap="round" fill="none"/>
      }
      {/* Pectoral fin */}
      <motion.path d="M40 58 Q34 68 26 60" fill={skin.accentColor}
        animate={{ rotate: [0, -6, 0] }} style={{ transformOrigin: '38px 58px' }}
        transition={{ duration: 2.4, repeat: Infinity }}/>
      {(mood === 'love' || happy) && (
        <>
          <ellipse cx="30" cy="44" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.5"/>
        </>
      )}
      {skin.badge && <text x="14" y="24" fontSize="14">{skin.badge}</text>}
    </svg>
  );
};

/* -- SVG Capybara ----------------------------------------------- */
const SvgCapybara = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const happy = mood === 'happy' || mood === 'love';
  const sleepy = mood === 'sleepy';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Body — низкий и широкий */}
      <ellipse cx="40" cy="54" rx="27" ry="17" fill={skin.bodyColor}/>
      <ellipse cx="40" cy="58" rx="16" ry="10" fill={skin.extraColor ?? skin.accentColor + '70'}/>
      {/* Head — прямоугольная морда */}
      <rect x="20" y="26" width="34" height="24" rx="12" fill={skin.bodyColor}/>
      {/* Ears */}
      <circle cx="24" cy="22" r="5" fill={skin.accentColor}/>
      <circle cx="46" cy="20" r="5.5" fill={skin.accentColor}/>
      {/* Eyes */}
      {blinkState || sleepy ? (
        <>
          <path d="M27 36 Q30 34 33 36" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M39 36 Q42 34 45 36" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <ellipse cx="30" cy="36" rx="2.6" ry={happy ? 3.2 : 2.8} fill={skin.eyeColor}/>
          <ellipse cx="42" cy="36" rx="2.6" ry={happy ? 3.2 : 2.8} fill={skin.eyeColor}/>
        </>
      )}
      {/* Snout */}
      <ellipse cx="36" cy="45" rx="11" ry="7" fill={skin.extraColor ?? '#fff'} opacity="0.9"/>
      <ellipse cx="36" cy="45" rx="3" ry="2" fill={skin.accentColor}/>
      {happy
        ? <path d="M30 48 Q36 52 42 48" stroke={skin.accentColor} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
        : <path d="M32 48 Q36 50 40 48" stroke={skin.accentColor} strokeWidth="1.4" strokeLinecap="round" fill="none"/>
      }
      {/* Legs stub */}
      <ellipse cx="20" cy="68" rx="6" ry="4" fill={skin.bodyColor}/>
      <ellipse cx="60" cy="68" rx="6" ry="4" fill={skin.bodyColor}/>
      {/* Extra badge item (мандаринка на голове и т.п.) */}
      {skin.badge && <text x="34" y="16" fontSize="14" textAnchor="middle">{skin.badge}</text>}
    </svg>
  );
};

/* -- SVG Robot ----------------------------------------------- */
const SvgRobot = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const excited = mood === 'excited';
  const sleepy = mood === 'sleepy';
  const happy = mood === 'happy' || mood === 'love';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none">
      {/* Antenna */}
      <line x1="40" y1="12" x2="40" y2="20" stroke={skin.accentColor} strokeWidth="2"/>
      <motion.circle cx="40" cy="10" r="3.5" fill={skin.eyeColor}
        animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: excited ? 0.4 : 1.4, repeat: Infinity }}/>
      {/* Head */}
      <rect x="18" y="20" width="44" height="34" rx="10" fill={skin.bodyColor}/>
      {/* Face plate */}
      <rect x="24" y="26" width="32" height="22" rx="6" fill={skin.accentColor} opacity="0.35"/>
      {/* Eyes */}
      {sleepy ? (
        <>
          <line x1="30" y1="37" x2="36" y2="37" stroke={skin.eyeColor} strokeWidth="2.4" strokeLinecap="round"/>
          <line x1="44" y1="37" x2="50" y2="37" stroke={skin.eyeColor} strokeWidth="2.4" strokeLinecap="round"/>
        </>
      ) : (
        <>
          <motion.rect x="28" y={happy ? 32 : 30} width="8" height={happy ? 8 : 12} rx="3" fill={skin.eyeColor}
            animate={excited ? { opacity: [1, 0.3, 1] } : undefined} transition={{ duration: 0.3, repeat: Infinity }}/>
          <motion.rect x="44" y={happy ? 32 : 30} width="8" height={happy ? 8 : 12} rx="3" fill={skin.eyeColor}
            animate={excited ? { opacity: [1, 0.3, 1] } : undefined} transition={{ duration: 0.3, repeat: Infinity, delay: 0.15 }}/>
        </>
      )}
      {/* Mouth grille */}
      <rect x="32" y="44" width="16" height="3" rx="1.5" fill={skin.eyeColor} opacity="0.7"/>
      {/* Body */}
      <rect x="24" y="54" width="32" height="20" rx="8" fill={skin.bodyColor}/>
      <circle cx="40" cy="64" r="5" fill={skin.eyeColor} opacity="0.85"/>
      {/* Arms */}
      <motion.rect x="8" y="56" width="12" height="8" rx="4" fill={skin.accentColor}
        animate={{ rotate: happy ? [0, -20, 0] : [0, -5, 0] }} style={{ transformOrigin: '18px 60px' }}
        transition={{ duration: happy ? 0.6 : 2.4, repeat: Infinity }}/>
      <motion.rect x="60" y="56" width="12" height="8" rx="4" fill={skin.accentColor}
        animate={{ rotate: happy ? [0, 20, 0] : [0, 5, 0] }} style={{ transformOrigin: '62px 60px' }}
        transition={{ duration: happy ? 0.6 : 2.4, repeat: Infinity, delay: 0.1 }}/>
      {skin.badge && <text x="58" y="20" fontSize="13">{skin.badge}</text>}
    </svg>
  );
};

/* -- SVG Ghost ----------------------------------------------- */
const SvgGhost = ({ skin, mood, size }: { skin: SpriteSkin; mood: PetMood; size: number }) => {
  const s = size;
  const blinkState = useBlinkState();
  const happy = mood === 'happy' || mood === 'love';
  const sleepy = mood === 'sleepy';
  const excited = mood === 'excited';

  return (
    <svg width={s} height={s} viewBox="0 0 80 80" fill="none" opacity="0.92">
      {/* Wispy body */}
      <path d="M18 40 Q18 14 40 14 Q62 14 62 40 L62 62 Q57 68 52 62 Q47 68 42 62 Q37 68 32 62 Q27 68 22 62 Q17 68 18 62 Z"
        fill={skin.bodyColor}/>
      {/* Inner glow */}
      <ellipse cx="40" cy="38" rx="16" ry="14" fill={skin.extraColor ?? skin.accentColor} opacity="0.25"/>
      {/* Eyes */}
      {blinkState || sleepy ? (
        <>
          <path d="M29 38 Q33 35 37 38" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
          <path d="M43 38 Q47 35 51 38" stroke={skin.eyeColor} strokeWidth="2" strokeLinecap="round" fill="none"/>
        </>
      ) : (
        <>
          <ellipse cx="33" cy="38" rx="3.2" ry={excited ? 5 : 4} fill={skin.eyeColor}/>
          <ellipse cx="47" cy="38" rx="3.2" ry={excited ? 5 : 4} fill={skin.eyeColor}/>
        </>
      )}
      {/* Mouth */}
      {happy
        ? <ellipse cx="40" cy="48" rx="5" ry="4" fill={skin.eyeColor} opacity="0.8"/>
        : <path d="M35 47 Q40 51 45 47" stroke={skin.eyeColor} strokeWidth="1.6" strokeLinecap="round" fill="none" opacity="0.8"/>
      }
      {(mood === 'love' || happy) && (
        <>
          <ellipse cx="24" cy="42" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.45"/>
          <ellipse cx="56" cy="42" rx="4" ry="2.5" fill="#f9a8d4" opacity="0.45"/>
        </>
      )}
      {skin.badge && <text x="58" y="20" fontSize="14">{skin.badge}</text>}
    </svg>
  );
};

/* -- Blink hook -------------------------------------------- */
function useBlinkState(): boolean {
  const [blink, setBlink] = useState(false);
  const timer = useRef<number>(0);

  useEffect(() => {
    const schedule = () => {
      timer.current = window.setTimeout(() => {
        setBlink(true);
        setTimeout(() => { setBlink(false); schedule(); }, 120);
      }, 2500 + Math.random() * 3000);
    };
    schedule();
    return () => clearTimeout(timer.current);
  }, []);

  return blink;
}

/* -- Body motion animations ------------------------------- */
const BODY_ANIM: Record<PetMood, TargetAndTransition> = {
  idle:    { y: [0, -4, 0],            scale: [1, 1.02, 1]         },
  happy:   { y: [0, -14, 0, -10, 0],  rotate: [-3, 0, 3, 0, -3]  },
  excited: { y: [0, -8, 0],            x: [-3, 3, -3],  scale: [1, 1.06, 1] },
  sleepy:  { y: [0, 2, 0],            scale: [1, 0.97, 1]         },
  love:    { y: [0, -8, 0],            scale: [1, 1.05, 1]         },
  angry:   { y: [0, -3, 0],            x: [-2, 2, -2, 2, 0],  rotate: [-2, 2, -2, 0] },
};
const BODY_TRANS: Record<PetMood, Transition> = {
  idle:    { duration: 2.5, repeat: Infinity, ease: 'easeInOut'  },
  happy:   { duration: 0.65, repeat: Infinity, ease: 'easeInOut' },
  angry:   { duration: 0.3, repeat: Infinity, ease: 'easeInOut'  },
  excited: { duration: 0.35, repeat: Infinity, ease: 'linear'    },
  sleepy:  { duration: 3.5, repeat: Infinity, ease: 'easeInOut'  },
  love:    { duration: 1.0, repeat: Infinity, ease: 'easeInOut'  },
};

/* --- Glow pulse ------------------------------------------- */
const GlowPulse = ({ color, mood }: { color: string; mood: PetMood }) => (
  <motion.div className="absolute inset-0 rounded-full pointer-events-none"
    style={{ background: `radial-gradient(circle, ${color}, transparent 70%)` }}
    animate={{ opacity: mood === 'excited' ? [0.3, 0.7, 0.3] : mood === 'idle' ? [0.1, 0.25, 0.1] : [0.2, 0.5, 0.2] }}
    transition={{ duration: mood === 'excited' ? 0.4 : 2, repeat: Infinity }}/>
);

/* === MAIN PETSPRITE COMPONENT ============================== */
interface PetSpriteProps {
  /** typeId реального типа (pet_types.id) — только чтобы выбрать форму
   *  SVG-силуэта (кот/лиса/дракон/…); у неизвестных типов — заяц. */
  typeId: string;
  /** Базовый цвет реального типа (pet_types.base_color) — вся палитра
   *  тела/акцентов выводится из него (см. deriveSkin выше). */
  color: string;
  mood:  PetMood;
  size?: number;
  showParticles?: boolean;
  /** Необязательный эмодзи-бейдж — напр. подсказка про надетый предмет
   *  из Sky Skin Market (у настоящих предметов нет recolor-параметров,
   *  только медиа, поэтому бейдж — не более чем маленькая подсказка). */
  badge?: string;
}

export const PetSprite = ({ typeId, color, mood, size = 80, showParticles = true, badge }: PetSpriteProps) => {
  const skin = useMemo(() => deriveSkin(color, badge), [color, badge]);
  const SvgComp = typeId.startsWith('cat') ? SvgCat
    : typeId.startsWith('fox') ? SvgFox
    : typeId.startsWith('dragon') ? SvgDragon
    : typeId.startsWith('shark') ? SvgShark
    : typeId.startsWith('capybara') ? SvgCapybara
    : typeId.startsWith('robot') ? SvgRobot
    : typeId.startsWith('ghost') ? SvgGhost
    : SvgBunny;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Glow */}
      <GlowPulse color={skin.glow} mood={mood}/>
      {/* Shadow */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full"
        style={{ width: size * 0.6, height: size * 0.1, background: 'rgba(0,0,0,0.2)', filter: 'blur(4px)' }}/>
      {/* Animated body */}
      <motion.div
        animate={BODY_ANIM[mood]}
        transition={BODY_TRANS[mood]}
        style={{ position: 'relative', zIndex: 1 }}>
        <SvgComp skin={skin} mood={mood} size={size}/>
      </motion.div>
      {/* Emotion particles */}
      {showParticles && (
        <div className="absolute inset-0 pointer-events-none overflow-visible">
          <EmotionParticles mood={mood} color={skin.glow}/>
        </div>
      )}
    </div>
  );
};
