/* ===========================================================
   SKY PRIME — уровни. Каталог наград и обмен — на сервере (primeApi.ts, server/primerewards.mjs).
   Баланс баллов и история — это уже существующий useMoney().points
   (кошелёк Sky), здесь мы только считаем уровень по lifetime-баллам.
   Начисляет баллы только сервер (кэшбэк, коды, выплаты) — из браузера баллы не создаются.
=========================================================== */
import { useMoney } from '@/wallet/store';

export type PrimeTier = 'silver' | 'gold' | 'platinum' | 'diamond';

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

/* lifetime = сумма всех начислений (points_earn), не уменьшается при тратах —
   так уровень не откатывается назад после обмена баллов на награду */
export const lifetimePointsOf = (userId: string) => useMoney.getState().getTxs(userId)
  .filter(t => (t.type === 'points_earn' || t.type === 'cashback' || t.type === 'code_points') && t.amount > 0)
  .reduce((a, t) => a + t.amount, 0);

export const progressToNextTier = (lifetime: number) => {
  const next = nextTier(lifetime);
  if (!next) return { next: null, pct: 100, remaining: 0 };
  const cur = tierFor(lifetime);
  const span = next.min - cur.min;
  const pct = Math.min(100, Math.round(((lifetime - cur.min) / span) * 100));
  return { next, pct, remaining: next.min - lifetime };
};
