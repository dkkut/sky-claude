/* ======================================================================
   SKY GIFTS  —  Модельки подарков (глянцевые 3D-иконки поверх фона,
   аналог предметных моделек в Telegram Gifts)
====================================================================== */
import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Gift as GiftIcon, Crown, Gem, Heart, Star, Trophy, Rocket, Flame,
  Snowflake, Clover, KeyRound, PartyPopper, Award, Flower2, Music2, Sparkles,
} from 'lucide-react';
import type { Rarity } from './types';

const hash = (s: string) => { let h=0; for (let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; };

export interface GiftModelDef {
  key: string;
  label: string;
  icon: any;
  from: string; // цвет верхнего блика градиента
  to: string;   // цвет нижней тени градиента
}

/* 16 предметных моделек — как «набор коллекций» в Telegram Gifts */
export const GIFT_MODELS: GiftModelDef[] = [
  { key:'bear',    label:'Мишка',      icon:GiftIcon,    from:'#ffb37a', to:'#c2560b' },
  { key:'crown',   label:'Корона',     icon:Crown,       from:'#ffe27a', to:'#b8860b' },
  { key:'gem',     label:'Кристалл',   icon:Gem,         from:'#9ee7ff', to:'#0e6ea8' },
  { key:'heart',   label:'Сердце',     icon:Heart,       from:'#ff9bb0', to:'#c81e4e' },
  { key:'star',    label:'Звезда',     icon:Star,        from:'#fff29e', to:'#c99a0a' },
  { key:'trophy',  label:'Кубок',      icon:Trophy,      from:'#ffdd8a', to:'#b4740c' },
  { key:'rocket',  label:'Ракета',     icon:Rocket,      from:'#c3b8ff', to:'#5a3bc4' },
  { key:'flame',   label:'Пламя',      icon:Flame,       from:'#ffb27a', to:'#d43f1a' },
  { key:'snow',    label:'Снежинка',   icon:Snowflake,   from:'#c6f2ff', to:'#2f9fce' },
  { key:'clover',  label:'Клевер',     icon:Clover,      from:'#b6f2b0', to:'#1f9c4d' },
  { key:'key',     label:'Ключ',       icon:KeyRound,    from:'#ffe4a8', to:'#c07a10' },
  { key:'party',   label:'Праздник',   icon:PartyPopper, from:'#ffc2e8', to:'#c62e94' },
  { key:'award',   label:'Награда',    icon:Award,       from:'#d8c2ff', to:'#6d3bc4' },
  { key:'flower',  label:'Цветок',     icon:Flower2,     from:'#ffc7de', to:'#c23e79' },
  { key:'note',    label:'Мелодия',    icon:Music2,      from:'#a8d8ff', to:'#1f5fc4' },
  { key:'spark',   label:'Искра',      icon:Sparkles,    from:'#fff2b0', to:'#c98a0a' },
];

export const modelForSeed = (seed: string): GiftModelDef => GIFT_MODELS[hash(seed) % GIFT_MODELS.length];
export const modelByKey = (key: string): GiftModelDef => GIFT_MODELS.find(m => m.key === key) ?? GIFT_MODELS[0];

const RARITY_SCALE: Record<Rarity, number> = {
  common:0.86, uncommon:0.9, rare:0.94, epic:1, legendary:1.05,
  mythic:1.1, divine:1.14, limited:1.08, founder:1.16, one_of_one:1.2,
};

/* ── Инлайн-версия бейджа (не absolute) — для использования вне GiftCard,
   например в комментариях Bloom или вкладке «Подарки» профиля ── */
export const GiftBadge = memo(({ modelKey, rarity='epic', size=48, float=false }: {
  modelKey: string; rarity?: Rarity; size?: number; float?: boolean;
}) => {
  const model = useMemo(() => modelByKey(modelKey), [modelKey]);
  const Icon = model.icon;
  const scale = RARITY_SCALE[rarity];
  const dim = Math.round(size * scale);
  const Wrap = float ? motion.div : 'div';
  const floatProps = float ? { animate:{ y:[0,-4,0] }, transition:{ duration:3.5, repeat:Infinity, ease:'easeInOut' } } : {};

  return (
    <Wrap className="relative grid shrink-0 place-items-center rounded-full" style={{
      height: dim, width: dim,
      background: `radial-gradient(circle at 35% 28%, ${model.from}, ${model.to} 72%)`,
      boxShadow: `0 ${dim*0.14}px ${dim*0.24}px rgba(0,0,0,0.4), inset 0 ${dim*0.07}px ${dim*0.14}px rgba(255,255,255,0.35), inset 0 -${dim*0.08}px ${dim*0.16}px rgba(0,0,0,0.22)`,
    }} {...floatProps}>
      <div className="absolute rounded-full" style={{
        top:'12%', left:'20%', height:'32%', width:'42%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.75), rgba(255,255,255,0) 70%)',
        filter: 'blur(1px)',
      }}/>
      <Icon size={Math.round(dim*0.46)} color="#fff" strokeWidth={2.1} style={{ filter:'drop-shadow(0 2px 3px rgba(0,0,0,0.35))' }}/>
    </Wrap>
  );
});
GiftBadge.displayName = 'GiftBadge';

/* ── Глянцевая 3D-иконка подарка ─────────────────────────────────────
   Круглая «сфера» с радиальным градиентом + блик сверху + мягкая тень —
   даёт ощущение объёма без canvas/3D-движка, в стиле моделек Telegram. */
export const GiftModel = memo(({ seed, rarity, size=88, animated=true }: { seed: string; rarity: Rarity; size?: number; animated?: boolean }) => {
  const model = useMemo(() => modelForSeed(seed), [seed]);
  const Icon = model.icon;
  const scale = RARITY_SCALE[rarity];
  const dim = Math.round(size * scale);

  return (
    <motion.div
      className="absolute inset-0 grid place-items-center pointer-events-none select-none"
      initial={{ y:0 }} animate={animated ? { y:[0,-6,0] } : { y:0 }} transition={animated ? { duration:4.5, repeat:Infinity, ease:'easeInOut' } : { duration:0 }}>
      <div className="relative grid place-items-center rounded-full" style={{
        height: dim, width: dim,
        background: `radial-gradient(circle at 35% 28%, ${model.from}, ${model.to} 72%)`,
        boxShadow: `0 ${dim*0.16}px ${dim*0.3}px rgba(0,0,0,0.45), inset 0 ${dim*0.08}px ${dim*0.16}px rgba(255,255,255,0.35), inset 0 -${dim*0.1}px ${dim*0.18}px rgba(0,0,0,0.25)`,
      }}>
        {/* блик — имитация объёма/стекла */}
        <div className="absolute rounded-full" style={{
          top:'12%', left:'20%', height:'32%', width:'42%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.75), rgba(255,255,255,0) 70%)',
          filter: 'blur(1px)',
        }}/>
        <Icon size={Math.round(dim*0.46)} color="#fff" strokeWidth={2.1} style={{ filter:'drop-shadow(0 2px 3px rgba(0,0,0,0.35))' }}/>
      </div>
    </motion.div>
  );
});
GiftModel.displayName = 'GiftModel';
