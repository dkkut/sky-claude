/* ===========================================================
   SKY PRIME — уровни и каталог наград.
   Баланс баллов и история — это уже существующий useMoney().points
   (кошелёк Sky), здесь мы только считаем уровень по lifetime-баллам
   и предоставляем каталог наград для обмена.

   earnPrimePoints/redeemPrimeReward — обычные функции (не хуки),
   их можно безопасно вызывать из экшенов других сторов (например,
   из завершения доставки Sky Courier), а не только из компонентов.
=========================================================== */
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

export type PrimeTier = 'silver' | 'gold' | 'platinum' | 'diamond';

export interface Reward {
  id: string; title: string; desc: string; cost: number; icon: string;
  kind: 'discount'|'cashback'|'freebie'|'boost';
}

export const REWARDS: Reward[] = [
  { id:'delivery_free',title:'Бесплатная доставка',    desc:'Sky Market — до 150 ₽ компенсации', cost:1200, icon:'🎟️', kind:'freebie' },
  { id:'cashback5',title:'+5% кэшбек на неделю',       desc:'На все покупки в Sky Market',    cost:600,  icon:'💸', kind:'cashback' },
  { id:'music_ad', title:'Месяц Sky Music без рекламы',desc:'Уже включено в Prime',           cost:400,  icon:'🎧', kind:'freebie' },
  { id:'boost',    title:'Буст доставки x2',           desc:'Приоритет у курьеров на 24ч',    cost:500,  icon:'⚡', kind:'boost' },
  { id:'giftcert', title:'Сертификат 200 ₽',           desc:'На баланс Sky Money',            cost:2000, icon:'🎁', kind:'freebie' },
];

const TIERS: { key: PrimeTier; label: string; min: number; color: string }[] = [
  { key:'silver',   label:'Silver',   min:0,     color:'#9ca3af' },
  { key:'gold',     label:'Gold',     min:2000,  color:'#f59e0b' },
  { key:'platinum', label:'Platinum', min:8000,  color:'#a78bfa' },
  { key:'diamond',  label:'Diamond',  min:20000, color:'#38bdf8' },
];
export const TIER_LIST = TIERS;

export const tierFor = (lifetime: number): typeof TIERS[number] => {
  let cur = TIERS[0];
  for (const t of TIERS) if (lifetime >= t.min) cur = t;
  return cur;
};
export const nextTier = (lifetime: number) => TIERS.find(t => t.min > lifetime) ?? null;

const me = () => useAuthStore.getState().currentUserId ?? '';

/* lifetime = сумма всех начислений (points_earn), не уменьшается при тратах —
   так уровень не откатывается назад после обмена баллов на награду */
export const lifetimePointsOf = (userId: string) => useMoney.getState().getTxs(userId)
  .filter(t => t.type === 'points_earn')
  .reduce((a, t) => a + t.amount, 0);

export const progressToNextTier = (lifetime: number) => {
  const next = nextTier(lifetime);
  if (!next) return { next: null, pct: 100, remaining: 0 };
  const cur = tierFor(lifetime);
  const span = next.min - cur.min;
  const pct = Math.min(100, Math.round(((lifetime - cur.min) / span) * 100));
  return { next, pct, remaining: next.min - lifetime };
};

/* Обычные функции — можно вызывать откуда угодно, не только из компонентов */
export const earnPrimePoints = (amount: number, reason: string) => {
  if (amount > 0) useMoney.getState().earnPoints(me(), amount, reason);
};

export const redeemPrimeReward = (rewardId: string): boolean => {
  const reward = REWARDS.find(r => r.id === rewardId);
  if (!reward) return false;
  return useMoney.getState().spendPoints(me(), reward.cost, `Обмен: ${reward.title}`, rewardId);
};
