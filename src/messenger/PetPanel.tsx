/* ===================================================================
   SKY PETS  -  панель питомцев для чата
   Отправляет анимированного питомца как "сообщение-стикер"
   Концепт: живые существа с состояниями, реакциями, уровнем дружбы
=================================================================== */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Heart, Zap, Star } from 'lucide-react';
import { PetCareScreen } from './PetCare';
import type { Pet, PetMood } from './petData';
import { PETS, RARITY_CFG } from './petData';

export type { PetMood };
export type { Pet };
export { PETS, RARITY_CFG };

const PetCareInline = PetCareScreen;

/* -- Хранилище предпочтений (localStorage) -------------------------- */
const PETS_KEY = 'sky:pets:v1';
interface PetPrefs { owned: string[]; active: string|null; friendship: Record<string,number>; }
const loadPrefs = (): PetPrefs => {
  try { return JSON.parse(localStorage.getItem(PETS_KEY)||'null') || { owned:['cat-neon','bunny-pixel'], active:'cat-neon', friendship:{} }; }
  catch { return { owned:['cat-neon','bunny-pixel'], active:'cat-neon', friendship:{} }; }
};
const savePrefs = (p: PetPrefs) => { try { localStorage.setItem(PETS_KEY, JSON.stringify(p)); } catch {} };

/* -- Живой питомец в чате ------------------------------------------- */
export const LivePet = ({ petId, mood, onMoodEnd }: {
  petId: string; mood: PetMood; onMoodEnd: ()=>void;
}) => {
  const pet = PETS.find(p=>p.id===petId);
  if (!pet) return null;
  const frames = pet.moods[mood];
  const [frame, setFrame] = useState(0);
  const { glow } = RARITY_CFG[pet.rarity];

  useEffect(()=>{
    let i = 0;
    const t = setInterval(()=>{
      i++;
      if (i >= frames.length) { clearInterval(t); onMoodEnd(); return; }
      setFrame(i);
    }, 700);
    return ()=>clearInterval(t);
  }, [mood]);

  return (
    <motion.div
      initial={{ scale:0, rotate:-10 }}
      animate={{ scale:1, rotate:0 }}
      exit={{ scale:0, opacity:0 }}
      className="inline-flex flex-col items-center gap-1"
    >
      <motion.div
        animate={{ y:[0,-6,0], filter:[`drop-shadow(0 0 8px ${glow})`,`drop-shadow(0 0 18px ${glow})`,`drop-shadow(0 0 8px ${glow})`] }}
        transition={{ duration:1.2, repeat:Infinity, ease:'easeInOut' }}
        className="text-4xl select-none"
      >
        {frames[frame]}
      </motion.div>
      <p className="text-[10px] font-semibold" style={{ color:pet.color }}>{pet.name}</p>
    </motion.div>
  );
};

/* -- Компонент «питомец в пузыре» (рендерится в MsgBody) ----------- */
export const PetBubble = ({ petId, mood, sound, petName, petColor }: {
  petId: string; mood: PetMood; sound: string; petName: string; petColor: string;
}) => {
  const pet = PETS.find(p=>p.id===petId);
  if (!pet) return <span>{sound}</span>;
  const { glow } = RARITY_CFG[pet.rarity];
  const frames = pet.moods[mood];
  const [frame, setFrame] = useState(0);

  useEffect(()=>{
    const t = setInterval(()=>setFrame(f=>(f+1)%frames.length), 800);
    return ()=>clearInterval(t);
  },[mood]);

  return (
    <div className="flex flex-col items-center gap-2 py-2" style={{ minWidth:100 }}>
      <motion.div
        animate={{ y:[0,-5,0] }}
        transition={{ duration:1.4, repeat:Infinity, ease:'easeInOut' }}
        className="text-5xl"
        style={{ filter:`drop-shadow(0 0 12px ${glow})` }}>
        {frames[frame]}
      </motion.div>
      <p className="text-xs font-bold" style={{ color:petColor }}>{petName}</p>
      {sound && (
        <div className="rounded-full px-3 py-1 text-xs"
          style={{ background:`${petColor}18`, border:`1px solid ${petColor}35`, color:petColor }}>
          {sound}
        </div>
      )}
    </div>
  );
};

/* -- Главная панель выбора питомца ----------------------------------- */
interface PetPanelProps {
  onSend: (petId:string, mood:PetMood, sound:string) => void;
  onClose: () => void;
}

export const PetPanel = ({ onSend, onClose }: PetPanelProps) => {
  const [prefs, setPrefs] = useState<PetPrefs>(loadPrefs);
  const [selected, setSelected] = useState<string|null>(prefs.active);
  const [previewMood, setPreviewMood] = useState<PetMood>('idle');
  const [tab, setTab] = useState<'my'|'care'|'shop'>('my');
  const [careTarget, setCareTarget] = useState<string|null>(null);

  const save = (p: PetPrefs) => { setPrefs(p); savePrefs(p); };

  const pet  = PETS.find(p=>p.id===selected);
  const owned = PETS.filter(p=>prefs.owned.includes(p.id));
  const shop  = PETS.filter(p=>!prefs.owned.includes(p.id));
  const friendship = prefs.friendship[selected??''] ?? 0;

  const handleSend = (mood: PetMood) => {
    if (!selected || !pet) return;
    const sound = pet.sounds[Math.floor(Math.random()*pet.sounds.length)];
    onSend(selected, mood, sound);
    // Рост дружбы
    const next = Math.min(100, (prefs.friendship[selected]??0)+5);
    save({ ...prefs, friendship:{ ...prefs.friendship, [selected]:next } });
  };

  const adopt = (petId: string) => {
    save({ ...prefs, owned:[...prefs.owned, petId], active:petId });
    setSelected(petId);
    setTab('my');
  };

  const MOODS: { key:PetMood; label:string; emoji:string; color:string }[] = [
    { key:'idle',    label:'Обычный',  emoji:'😌', color:'var(--t2)' },
    { key:'happy',   label:'Радуется', emoji:'😊', color:'var(--green)'   },
    { key:'excited', label:'Восторг',  emoji:'🤩', color:'var(--amber)'   },
    { key:'sleepy',  label:'Устал',    emoji:'😴', color:'#8b5cf6'   },
    { key:'love',    label:'Влюблён',  emoji:'😻', color:'#f43f5e'   },
  ];

  return (
    <motion.div
      initial={{ opacity:0, scale:0.92, y:8 }}
      animate={{ opacity:1, scale:1,    y:0 }}
      exit={{   opacity:0, scale:0.92,  y:8 }}
      className="absolute bottom-full right-0 mb-2 z-[200] flex flex-col overflow-hidden rounded-2xl"
      style={{
        width: 320, maxHeight: 460,
        background:'var(--bg-l1)',
        border:'1px solid var(--border-m)',
        boxShadow:'0 20px 60px rgba(0,0,0,0.7)',
      }}
    >
      {/* -- Заголовок -- */}
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor:'var(--border)' }}>
        <p className="text-sm font-bold" style={{ color:'var(--t1)' }}>Питомцы</p>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl overflow-hidden border" style={{ borderColor:'var(--border)' }}>
            {(['my','care','shop'] as const).map(t=>(
              <button key={t} type="button" onClick={()=>setTab(t)}
                className="px-3 py-1 text-xs font-semibold transition-all"
                style={{ background:tab===t?'var(--accent)':'transparent',
                  color:tab===t?'#fff':'var(--t2)' }}>
                {t==='my'?`Мои (${owned.length})`:t==='care'?'Уход':'Магазин'}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} style={{ color:'var(--t3)' }}>
            <X size={15}/>
          </button>
        </div>
      </div>

      {/* -- МОИ питомцы -- */}
      {tab==='my' && (
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Список */}
          <div className="flex gap-2 px-3 py-2 overflow-x-auto scroll-none">
            {owned.map(p=>{
              const cfg = RARITY_CFG[p.rarity];
              const isSelected = p.id===selected;
              return (
                <motion.button key={p.id} type="button" whileTap={{ scale:0.93 }}
                  onClick={()=>{ setSelected(p.id); setPreviewMood('idle'); save({...prefs,active:p.id}); }}
                  className="shrink-0 flex flex-col items-center gap-1 rounded-2xl px-3 py-2"
                  style={{
                    background: isSelected ? `${cfg.color}18` : 'var(--bg-l2)',
                    border:`1.5px solid ${isSelected?cfg.color:'var(--border)'}`,
                    boxShadow: isSelected ? `0 0 12px ${cfg.glow}` : 'none',
                  }}>
                  <motion.span className="text-2xl"
                    animate={isSelected ? { y:[0,-3,0] } : {}}
                    transition={{ duration:1.2, repeat:Infinity }}>
                    {p.emoji}
                  </motion.span>
                  <span className="text-[9px] font-semibold" style={{ color:isSelected?cfg.color:'var(--t3)' }}>
                    {p.name}
                  </span>
                </motion.button>
              );
            })}
          </div>

          {/* Превью + действия */}
          {pet && (
            <div className="flex-1 px-3 pb-3 space-y-3 overflow-y-auto">
              {/* Питомец-превью */}
              <div className="rounded-2xl p-4 flex items-center gap-4"
                style={{ background:RARITY_CFG[pet.rarity].color+'0d', border:`1px solid ${RARITY_CFG[pet.rarity].color}25` }}>
                <motion.div
                  animate={{ y:[0,-6,0], filter:[`drop-shadow(0 0 8px ${RARITY_CFG[pet.rarity].glow})`,`drop-shadow(0 0 20px ${RARITY_CFG[pet.rarity].glow})`,`drop-shadow(0 0 8px ${RARITY_CFG[pet.rarity].glow})`] }}
                  transition={{ duration:1.4, repeat:Infinity }}
                  className="text-5xl shrink-0 select-none">
                  {pet.moods[previewMood][0]}
                </motion.div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-bold" style={{ color:'var(--t1)' }}>{pet.name}</p>
                    <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5"
                      style={{ background:RARITY_CFG[pet.rarity].color+'22', color:RARITY_CFG[pet.rarity].color }}>
                      {RARITY_CFG[pet.rarity].label}
                    </span>
                  </div>
                  <p className="text-[10px] leading-relaxed" style={{ color:'var(--t3)' }}>{pet.description}</p>
                  {/* Дружба */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[9px] mb-1">
                      <span style={{ color:'var(--t3)' }}>Дружба</span>
                      <span style={{ color:pet.color }}>{friendship}%</span>
                    </div>
                    <div className="h-1 w-full rounded-full overflow-hidden" style={{ background:'var(--bg-l3)' }}>
                      <motion.div className="h-full rounded-full"
                        animate={{ width:`${friendship}%` }}
                        style={{ background:`linear-gradient(90deg,${pet.color}88,${pet.color})` }}/>
                    </div>
                  </div>
                </div>
              </div>

              {/* Настроения */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color:'var(--t3)' }}>Отправить</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {MOODS.map(m=>(
                    <motion.button key={m.key} type="button" whileTap={{ scale:0.88 }}
                      onClick={()=>handleSend(m.key)}
                      onMouseEnter={()=>setPreviewMood(m.key)}
                      onMouseLeave={()=>setPreviewMood('idle')}
                      className="flex flex-col items-center gap-1 rounded-xl py-2"
                      style={{ background:'var(--bg-l2)', border:'1px solid var(--border)' }}>
                      <span className="text-lg">{m.emoji}</span>
                      <span className="text-[8px] font-medium" style={{ color:'var(--t3)' }}>{m.label}</span>
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {owned.length===0 && (
            <div className="flex-1 flex items-center justify-center pb-4">
              <div className="text-center space-y-2">
                <p className="text-3xl">🐾</p>
                <p className="text-xs" style={{ color:'var(--t3)' }}>Зайди в магазин и возьми питомца!</p>
              </div>
            </div>
          )}
        </div>
      )}


      {/* -- УХОД -- */}
      {tab==='care' && selected && (
        <div className="flex-1 overflow-hidden">
          <PetCareInline petId={selected} onBack={()=>setTab('my')}/>
        </div>
      )}
      {tab==='care' && !selected && (
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-2">
            <p className="text-2xl">🐾</p>
            <p className="text-xs" style={{ color:'var(--t3)' }}>Сначала выбери питомца во вкладке «Мои»</p>
          </div>
        </div>
      )}

      {/* -- МАГАЗИН -- */}
      {tab==='shop' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {shop.length===0 && (
            <div className="py-8 text-center">
              
              <p className="text-xs" style={{ color:'var(--t3)' }}>Все питомцы уже у вас!</p>
            </div>
          )}
          {shop.map(p=>{
            const cfg = RARITY_CFG[p.rarity];
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-2xl p-3"
                style={{ background:'var(--bg-l2)', border:`1px solid ${cfg.color}25` }}>
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-3xl"
                  style={{ background:`${cfg.color}15`, boxShadow:`0 0 12px ${cfg.glow}` }}>
                  {p.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold" style={{ color:'var(--t1)' }}>{p.name}</p>
                    <span className="text-[8px] font-bold rounded-full px-1.5 py-0.5"
                      style={{ background:`${cfg.color}20`, color:cfg.color }}>{cfg.label}</span>
                  </div>
                  <p className="text-[10px] mt-0.5 line-clamp-1" style={{ color:'var(--t3)' }}>
                    {p.description}
                  </p>
                </div>
                <motion.button whileTap={{ scale:0.9 }} type="button" onClick={()=>adopt(p.id)}
                  className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold text-white"
                  style={{ background:`linear-gradient(135deg,${cfg.color},${cfg.color}bb)` }}>
                  Взять
                </motion.button>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
};
