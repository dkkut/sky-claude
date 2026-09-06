/* ===================================================================
   SKY PETS  -  уход за питомцем
   Tamagotchi-экран: 5 показателей, деградация, 5 действий,
   частицы, реакции, журнал событий, уровни питомца
=================================================================== */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Utensils, Gamepad2, Droplets, Moon, Sparkles, Heart } from 'lucide-react';
import { PETS, RARITY_CFG, Pet } from './petData';

/* --- Типы -------------------------------------------------------- */
export interface PetVitals {
  hunger:    number;   // 0-100 (100 = сытый)
  mood:      number;   // 0-100
  clean:     number;   // 0-100
  energy:    number;   // 0-100
  health:    number;   // 0-100 (зависит от остальных)
  xp:        number;
  level:     number;
  lastCared: number;   // timestamp  -  для деградации
}

export interface CareLog {
  id:     string;
  petId:  string;
  action: CareAction;
  emoji:  string;
  text:   string;
  ts:     number;
}

export type CareAction = 'feed'|'play'|'wash'|'sleep'|'treat';

/* --- Конфиг действий --------------------------------------------- */
const ACTIONS: {
  key: CareAction; label: string; emoji: string; color: string;
  effect: Partial<PetVitals>; cooldown: number; desc: string;
}[] = [
  { key:'feed',  label:'Покормить', emoji:'🍖', color:'var(--amber)',
    effect:{ hunger:+30, health:+5, energy:+10 },   cooldown:60*5,
    desc:'Восстанавливает сытость и немного здоровья' },
  { key:'play',  label:'Поиграть',  emoji:'🎾', color:'#10b981',
    effect:{ mood:+35, energy:-20, hunger:-10 },     cooldown:60*8,
    desc:'Поднимает настроение, тратит энергию' },
  { key:'wash',  label:'Искупать',  emoji:'🛁', color:'#3b82f6',
    effect:{ clean:+40, mood:+10, health:+8 },       cooldown:60*15,
    desc:'Чистота = здоровье и хорошее настроение' },
  { key:'sleep', label:'Уложить',   emoji:'🌙', color:'#8b5cf6',
    effect:{ energy:+50, health:+10, mood:+5 },      cooldown:60*20,
    desc:'Полный отдых восстанавливает всё' },
  { key:'treat', label:'Угощение',  emoji:'🍬', color:'#ec4899',
    effect:{ mood:+20, hunger:+15, xp:+50 },          cooldown:60*10,
    desc:'Любимое лакомство  -  +XP и радость' },
];

const STAT_CFG = [
  { key:'hunger' as const, label:'Сытость',    emoji:'🍖', color:'var(--amber)' },
  { key:'mood'   as const, label:'Настроение', emoji:'😊', color:'#10b981' },
  { key:'clean'  as const, label:'Чистота',    emoji:'🛁', color:'#3b82f6' },
  { key:'energy' as const, label:'Энергия',    emoji:'⚡', color:'#8b5cf6' },
  { key:'health' as const, label:'Здоровье',   emoji:'❤️', color:'#f43f5e' },
];

/* --- XP для уровня ----------------------------------------------- */
const xpForLevel = (lvl: number) => lvl * 200;
const LEVEL_NAMES = ['Малыш','Детёныш','Юный','Взрослый','Мудрый','Легенда'];
const levelName   = (lvl: number) => LEVEL_NAMES[Math.min(lvl-1, LEVEL_NAMES.length-1)] ?? 'Легенда';

/* --- Storage ----------------------------------------------------- */
const VITALS_KEY = 'sky:pet-vitals:v1';
const LOG_KEY    = 'sky:pet-log:v1';
const CD_KEY     = 'sky:pet-cd:v1';

const defaultVitals = (): PetVitals => ({
  hunger:80, mood:75, clean:90, energy:85, health:95,
  xp:0, level:1, lastCared: Date.now(),
});

const loadVitals = (): Record<string, PetVitals> => {
  try { return JSON.parse(localStorage.getItem(VITALS_KEY)||'{}'); } catch { return {}; }
};
const saveVitals = (v: Record<string, PetVitals>) => {
  try { localStorage.setItem(VITALS_KEY, JSON.stringify(v)); } catch {}
};
const loadLog = (): CareLog[] => {
  try { return JSON.parse(localStorage.getItem(LOG_KEY)||'[]'); } catch { return []; }
};
const saveLog = (l: CareLog[]) => {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0,50))); } catch {}
};
const loadCD = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(CD_KEY)||'{}'); } catch { return {}; }
};
const saveCD = (c: Record<string, number>) => {
  try { localStorage.setItem(CD_KEY, JSON.stringify(c)); } catch {}
};

/* --- Деградация показателей со временем ------------------------- */
const applyDecay = (v: PetVitals): PetVitals => {
  const hoursGone = Math.min((Date.now() - v.lastCared) / 3_600_000, 24);
  if (hoursGone < 0.1) return v;
  const decay = (base: number, rate: number) =>
    Math.max(0, base - hoursGone * rate);
  const next: PetVitals = {
    ...v,
    hunger: decay(v.hunger, 8),
    mood:   decay(v.mood,   5),
    clean:  decay(v.clean,  4),
    energy: decay(v.energy, 6),
    lastCared: Date.now(),
  };
  next.health = Math.max(0, Math.round((next.hunger + next.mood + next.clean + next.energy) / 4));
  return next;
};

/* --- Частицы при действии ---------------------------------------- */
interface Particle { id: string; x: number; y: number; emoji: string; }

const ParticleLayer = ({ particles }: { particles: Particle[] }) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    <AnimatePresence>
      {particles.map(p => (
        <motion.div key={p.id}
          initial={{ x: p.x, y: p.y, opacity: 1, scale: 0.5 }}
          animate={{ y: p.y - 80 - Math.random()*40, x: p.x + (Math.random()-0.5)*60,
            opacity: 0, scale: 1.4 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          className="absolute text-2xl select-none"
          style={{ transform: 'translate(-50%,-50%)' }}>
          {p.emoji}
        </motion.div>
      ))}
    </AnimatePresence>
  </div>
);

/* --- Полоска показателя ------------------------------------------ */
const StatBar = ({ label, emoji, value, color, flash }: {
  label: string; emoji: string; value: number; color: string; flash: boolean;
}) => {
  const low = value < 25;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{emoji}</span>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--t2)' }}>{label}</span>
        </div>
        <motion.span
          animate={flash ? { scale: [1, 1.4, 1] } : {}}
          className="text-[11px] font-bold tabular-nums"
          style={{ color: low ? 'var(--red)' : color }}>
          {Math.round(value)}
        </motion.span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--bg-l3)' }}>
        <motion.div
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ background: low
            ? 'linear-gradient(90deg,#f87171,#ef4444)'
            : `linear-gradient(90deg,${color}88,${color})` }}
        />
        {low && (
          <motion.div
            animate={{ opacity: [0.4, 0.9, 0.4] }}
            transition={{ duration: 1, repeat: Infinity }}
            className="absolute inset-0 rounded-full"
            style={{ background: 'rgba(248,113,113,0.15)' }}
          />
        )}
      </div>
    </div>
  );
};

/* --- Главный экран ухода ----------------------------------------- */
interface PetCareProps {
  petId:   string;
  onBack:  () => void;
}

export const PetCareScreen = ({ petId, onBack }: PetCareProps) => {
  const pet = PETS.find(p => p.id === petId)!;
  const cfg = RARITY_CFG[pet.rarity];

  /* Состояние */
  const [allVitals, setAllVitals] = useState<Record<string, PetVitals>>(() => {
    const stored = loadVitals();
    if (!stored[petId]) stored[petId] = defaultVitals();
    return { ...stored, [petId]: applyDecay(stored[petId]) };
  });
  const v = allVitals[petId] ?? defaultVitals();

  const [cds,      setCds]      = useState<Record<string, number>>(loadCD);
  const [log,      setLog]      = useState<CareLog[]>(loadLog);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [particles,setParticles]= useState<Particle[]>([]);
  const [reaction, setReaction] = useState<string|null>(null);
  const [activeAct,setActiveAct]= useState<CareAction|null>(null);
  const petRef = useRef<HTMLDivElement>(null);
  const [petFrame, setPetFrame] = useState(0);

  /* Анимация питомца */
  useEffect(() => {
    const frames = pet.moods.idle;
    const t = setInterval(() => setPetFrame(f => (f+1) % frames.length), 900);
    return () => clearInterval(t);
  }, [petId]);

  /* Деградация каждую минуту пока открыт экран */
  useEffect(() => {
    const t = setInterval(() => {
      setAllVitals(prev => {
        const cur = prev[petId] ?? defaultVitals();
        const decay = (x: number, r: number) => Math.max(0, x - r/60);
        const next: PetVitals = {
          ...cur,
          hunger: decay(cur.hunger, 8),
          mood:   decay(cur.mood,   5),
          clean:  decay(cur.clean,  4),
          energy: decay(cur.energy, 6),
          lastCared: Date.now(),
        };
        next.health = Math.max(0, Math.round(
          (next.hunger + next.mood + next.clean + next.energy) / 4
        ));
        const updated = { ...prev, [petId]: next };
        saveVitals(updated);
        return updated;
      });
    }, 60_000);
    return () => clearInterval(t);
  }, [petId]);

  /* Действие ухода */
  const doAction = useCallback((action: typeof ACTIONS[number], btnEl?: HTMLElement) => {
    const now = Date.now();
    const cdKey = `${petId}:${action.key}`;
    if (cds[cdKey] && now < cds[cdKey]) return;

    setActiveAct(action.key);
    setTimeout(() => setActiveAct(null), 900);

    /* Частицы */
    const rect = petRef.current?.getBoundingClientRect();
    const pRect = petRef.current?.parentElement?.getBoundingClientRect();
    if (rect && pRect) {
      const cx = rect.left - pRect.left + rect.width/2;
      const cy = rect.top  - pRect.top  + rect.height/2;
      const newP: Particle[] = Array.from({ length: 6 }, (_, i) => ({
        id: `${now}-${i}`,
        x: cx + (Math.random()-0.5)*60,
        y: cy + (Math.random()-0.5)*30,
        emoji: action.emoji,
      }));
      setParticles(p => [...p, ...newP]);
      setTimeout(() => setParticles(p => p.filter(x => !newP.find(n=>n.id===x.id))), 1200);
    }

    /* Реакция питомца */
    const reactions: Record<CareAction, string> = {
      feed:'😋', play:'😸', wash:'😌', sleep:'😴', treat:'🥰'
    };
    setReaction(reactions[action.key]);
    setTimeout(() => setReaction(null), 1800);

    /* Обновляем показатели */
    setAllVitals(prev => {
      const cur = { ...(prev[petId] ?? defaultVitals()) };
      const eff = action.effect;

      if (eff.hunger !== undefined) cur.hunger = Math.min(100, Math.max(0, cur.hunger + eff.hunger));
      if (eff.mood   !== undefined) cur.mood   = Math.min(100, Math.max(0, cur.mood   + eff.mood));
      if (eff.clean  !== undefined) cur.clean  = Math.min(100, Math.max(0, cur.clean  + eff.clean));
      if (eff.energy !== undefined) cur.energy = Math.min(100, Math.max(0, cur.energy + eff.energy));
      cur.health = Math.max(0, Math.round((cur.hunger + cur.mood + cur.clean + cur.energy) / 4));

      /* XP и уровень */
      const xpGain = (eff.xp ?? 20);
      cur.xp += xpGain;
      while (cur.xp >= xpForLevel(cur.level) && cur.level < 6) {
        cur.xp -= xpForLevel(cur.level);
        cur.level++;
      }
      cur.lastCared = now;

      const updated = { ...prev, [petId]: cur };
      saveVitals(updated);
      return updated;
    });

    /* Flash затронутых баров */
    const touched = Object.keys(action.effect).filter(k => k !== 'xp');
    setFlashing(new Set(touched));
    setTimeout(() => setFlashing(new Set()), 700);

    /* Cooldown */
    const newCds = { ...cds, [cdKey]: now + action.cooldown * 1000 };
    setCds(newCds);
    saveCD(newCds);

    /* Лог */
    const xpGain = action.effect.xp ?? 20;
    const logTexts: Record<CareAction, string[]> = {
      feed:  [`${pet.name} с аппетитом поел`, `Вкусно! ${pet.name} доволен`, 'Ням-ням! Всё съедено'],
      play:  [`${pet.name} весело поиграл`, `+настроение от игры!`, `${pet.name} набегался`],
      wash:  [`${pet.name} чистый и довольный`, `Купание прошло хорошо`, `Блестит как новый!`],
      sleep: [`${pet.name} крепко спит`, `Тихий час у ${pet.name}`, `Сладкий сон`],
      treat: [`${pet.name} получил лакомство!`, `+${xpGain} XP за угощение`, `Любимая вкусняшка!`],
    };
    const texts = logTexts[action.key];
    const entry: CareLog = {
      id:     `${now}`,
      petId,
      action: action.key,
      emoji:  action.emoji,
      text:   texts[Math.floor(Math.random() * texts.length)],
      ts:     now,
    };
    setLog(prev => {
      const next = [entry, ...prev].slice(0, 50);
      saveLog(next);
      return next;
    });
  }, [cds, petId, pet]);

  /* Состояние питомца в целом */
  const avgHealth = (v.hunger + v.mood + v.clean + v.energy) / 4;
  const overallMood: 'great'|'good'|'ok'|'sad'|'sick' =
    avgHealth >= 80 ? 'great' : avgHealth >= 60 ? 'good' :
    avgHealth >= 40 ? 'ok' : avgHealth >= 20 ? 'sad' : 'sick';

  const moodFrames: Record<typeof overallMood, string[]> = {
    great: pet.moods.excited,
    good:  pet.moods.happy,
    ok:    pet.moods.idle,
    sad:   pet.moods.sleepy,
    sick:  pet.moods.sleepy,
  };
  const moodColor: Record<typeof overallMood, string> = {
    great:'var(--green)', good:'var(--amber)', ok:'var(--t2)', sad:'var(--red)', sick:'#ef4444',
  };
  const moodLabel: Record<typeof overallMood, string> = {
    great:'Счастлив!', good:'Доволен', ok:'Нормально', sad:'Грустит', sick:'Плохо',
  };

  /* XP прогресс */
  const xpNeeded  = xpForLevel(v.level);
  const xpPct     = Math.min(100, (v.xp / xpNeeded) * 100);

  /* Форматирование CD */
  const cdLeft = (key: CareAction) => {
    const cdKey = `${petId}:${key}`;
    const rem = (cds[cdKey] ?? 0) - Date.now();
    if (rem <= 0) return null;
    const m = Math.ceil(rem / 60000);
    return m >= 60 ? `${Math.ceil(m/60)}ч` : `${m}м`;
  };

  const petLogs = log.filter(l => l.petId === petId).slice(0, 8);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background:'var(--bg)' }}>

      {/* -- Header -- */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0 border-b"
        style={{ borderColor:'var(--border)', background:'var(--bg-l1)' }}>
        <motion.button type="button" whileTap={{ scale:0.9 }} onClick={onBack}
          className="grid h-8 w-8 place-items-center rounded-xl"
          style={{ background:'var(--bg-l2)', color:'var(--t2)' }}>
          <ArrowLeft size={16}/>
        </motion.button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color:'var(--t1)' }}>
            {pet.name}
            <span className="ml-2 text-[10px] font-normal" style={{ color: cfg.color }}>
              {cfg.label}
            </span>
          </p>
          <p className="text-[10px]" style={{ color:'var(--t3)' }}>
            {pet.species} · Ур. {v.level} «{levelName(v.level)}»
          </p>
        </div>
        {/* Общее здоровье */}
        <div className="flex items-center gap-2 rounded-2xl px-3 py-1.5"
          style={{ background: moodColor[overallMood]+'18', border:`1px solid ${moodColor[overallMood]}35` }}>
          <motion.div animate={{ scale:[1,1.2,1] }} transition={{ duration:1.4, repeat:Infinity }}>
            <Heart size={12} fill={moodColor[overallMood]} style={{ color:moodColor[overallMood] }}/>
          </motion.div>
          <span className="text-[11px] font-bold" style={{ color:moodColor[overallMood] }}>
            {moodLabel[overallMood]}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* -- Арена питомца -- */}
        <div className="relative mx-4 mt-4 rounded-3xl overflow-hidden"
          style={{
            background: `radial-gradient(ellipse at 50% 80%, ${cfg.color}18 0%, var(--bg-l2) 70%)`,
            border: `1px solid ${cfg.color}30`,
            minHeight: 200,
          }}>

          {/* Частицы */}
          <ParticleLayer particles={particles}/>

          {/* Декор-кружки фона */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(3)].map((_,i) => (
              <motion.div key={i}
                animate={{ scale:[1,1.15,1], opacity:[0.06,0.12,0.06] }}
                transition={{ duration:3+i*0.7, repeat:Infinity, delay:i*0.9 }}
                className="absolute rounded-full"
                style={{
                  width: 80+i*40, height: 80+i*40,
                  background: cfg.color,
                  left: `${20+i*25}%`, top: `${30+i*10}%`,
                  transform:'translate(-50%,-50%)',
                }}/>
            ))}
          </div>

          {/* Питомец */}
          <div ref={petRef} className="relative flex flex-col items-center justify-center py-8 gap-2">

            {/* Реакция-всплывашка */}
            <AnimatePresence>
              {reaction && (
                <motion.div
                  initial={{ scale:0, y:10, opacity:0 }}
                  animate={{ scale:1, y:0,  opacity:1 }}
                  exit={{   scale:0, y:-20, opacity:0 }}
                  className="absolute top-2 text-4xl select-none z-10">
                  {reaction}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Основной эмодзи-спрайт */}
            <motion.div
              animate={activeAct ? { scale:[1,1.25,0.9,1.1,1], rotate:[0,-8,8,-4,0] } : { y:[0,-8,0] }}
              transition={activeAct
                ? { duration:0.7, ease:'easeInOut' }
                : { duration:2.2, repeat:Infinity, ease:'easeInOut' }}
              className="text-7xl select-none"
              style={{ filter:`drop-shadow(0 0 20px ${cfg.glow})` }}>
              {moodFrames[overallMood][petFrame % moodFrames[overallMood].length]}
            </motion.div>

            <p className="text-xs font-bold" style={{ color: cfg.color }}>{pet.name}</p>

            {/* Здоровье под питомцем */}
            <div className="flex gap-1 mt-1">
              {[...Array(5)].map((_, i) => (
                <motion.div key={i}
                  animate={{ opacity: i < Math.ceil(v.health/20) ? 1 : 0.2 }}
                  className="text-sm">❤️</motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* -- XP + Уровень -- */}
        <div className="mx-4 mt-3 rounded-2xl p-3"
          style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} style={{ color: cfg.color }}/>
              <span className="text-[11px] font-bold" style={{ color:'var(--t1)' }}>
                Уровень {v.level}  -  {levelName(v.level)}
              </span>
            </div>
            <span className="text-[10px]" style={{ color:'var(--t3)' }}>
              {v.xp} / {xpNeeded} XP
            </span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden" style={{ background:'var(--bg-l3)' }}>
            <motion.div className="h-full rounded-full"
              animate={{ width:`${xpPct}%` }}
              transition={{ duration:0.6, ease:'easeOut' }}
              style={{ background:`linear-gradient(90deg,${cfg.color}80,${cfg.color})` }}/>
          </div>
        </div>

        {/* -- Показатели -- */}
        <div className="mx-4 mt-3 rounded-2xl p-4 space-y-3"
          style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color:'var(--t3)' }}>
            Состояние
          </p>
          {STAT_CFG.map(s => (
            <StatBar key={s.key}
              label={s.label} emoji={s.emoji}
              value={v[s.key] as number}
              color={s.color}
              flash={flashing.has(s.key)}/>
          ))}
        </div>

        {/* -- Действия -- */}
        <div className="mx-4 mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
            style={{ color:'var(--t3)' }}>Уход</p>
          <div className="grid grid-cols-5 gap-2">
            {ACTIONS.map(action => {
              const cd = cdLeft(action.key);
              const ready = !cd;
              return (
                <motion.button key={action.key} type="button"
                  whileTap={ready ? { scale:0.85 } : {}}
                  onClick={() => ready && doAction(action)}
                  className="flex flex-col items-center gap-1.5 rounded-2xl py-3 relative overflow-hidden"
                  style={{
                    background: ready ? `${action.color}14` : 'var(--bg-l2)',
                    border: `1.5px solid ${ready ? action.color+'50' : 'var(--border)'}`,
                    opacity: ready ? 1 : 0.55,
                    cursor:  ready ? 'pointer' : 'default',
                  }}>
                  {/* Пульс у готовых */}
                  {ready && (
                    <motion.div className="absolute inset-0 rounded-2xl"
                      animate={{ opacity:[0,0.15,0] }}
                      transition={{ duration:2, repeat:Infinity }}
                      style={{ background: action.color }}/>
                  )}
                  <span className="text-2xl relative">{action.emoji}</span>
                  <span className="text-[9px] font-semibold relative"
                    style={{ color: ready ? action.color : 'var(--t3)' }}>
                    {action.label}
                  </span>
                  {cd && (
                    <span className="text-[8px] relative" style={{ color:'var(--t3)' }}>{cd}</span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* -- Журнал -- */}
        {petLogs.length > 0 && (
          <div className="mx-4 mt-4 mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2"
              style={{ color:'var(--t3)' }}>Последние события</p>
            <div className="space-y-1.5">
              {petLogs.map((entry, i) => {
                const ago = Date.now() - entry.ts;
                const label = ago < 60000 ? 'только что'
                  : ago < 3600000 ? `${Math.floor(ago/60000)} мин`
                  : `${Math.floor(ago/3600000)} ч`;
                return (
                  <motion.div key={entry.id}
                    initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }}
                    transition={{ delay: i*0.04 }}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                    style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
                    <span className="text-base shrink-0">{entry.emoji}</span>
                    <p className="flex-1 text-[11px]" style={{ color:'var(--t2)' }}>{entry.text}</p>
                    <span className="text-[9px] shrink-0" style={{ color:'var(--t3)' }}>{label}</span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Предупреждения */}
        <AnimatePresence>
          {STAT_CFG.filter(s => (v[s.key] as number) < 25).map(s => (
            <motion.div key={s.key}
              initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }}
              exit={{ opacity:0, height:0 }}
              className="mx-4 mb-2 rounded-xl px-3 py-2 flex items-center gap-2"
              style={{ background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.25)' }}>
              <motion.span animate={{ rotate:[0,-10,10,-5,0] }} transition={{ duration:0.5, repeat:Infinity, repeatDelay:1 }}>
                {s.emoji}
              </motion.span>
              <p className="text-[11px] font-semibold" style={{ color:'var(--red)' }}>
                {s.label} критически низкая  -  позаботься о {pet.name}!
              </p>
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="h-4"/>
      </div>
    </div>
  );
};
