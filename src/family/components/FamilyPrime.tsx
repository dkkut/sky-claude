import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Crown, Check, Users, Sparkles, Percent, Gift } from 'lucide-react';
import { useFamilyStore } from '../store';
import { PRIME_FAMILY_PLANS } from '../types';
import { useMoney, fmt } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

const PERKS = [
  { icon: Crown,    text: 'Sky Prime для всех участников семьи' },
  { icon: Sparkles, text: 'Общий семейный уровень и ускоренный прогресс' },
  { icon: Percent,  text: 'Повышенный семейный кешбэк на всех уровнях' },
  { icon: Gift,     text: 'Эксклюзивные темы, рамки и достижения семьи' },
];

export const FamilyPrime = ({ onBack }: { onBack: () => void }) => {
  const { family, isPrimeFamilyActive, purchaseFamilyPrime } = useFamilyStore();
  const { getBalance } = useMoney();
  const { currentUserId } = useAuthStore();
  const [planId, setPlanId] = useState(PRIME_FAMILY_PLANS.find(p=>p.popular)?.id ?? PRIME_FAMILY_PLANS[0].id);
  const [toast, setToast] = useState<string | null>(null);

  if (!family) return null;
  const active = isPrimeFamilyActive();
  const balance = getBalance(currentUserId ?? '');
  const plan = PRIME_FAMILY_PLANS.find(p => p.id === planId)!;

  const buy = () => {
    const ok = purchaseFamilyPrime(planId);
    setToast(ok ? 'Sky Prime Family активирован для всей семьи 🎉' : 'Недостаточно средств на личном балансе');
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Sky Prime Family</h2>
      </div>

      <div className="px-5 py-4">
        <div className="flex flex-col items-center text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}
            className="grid h-16 w-16 place-items-center rounded-3xl text-3xl" style={{ background: 'linear-gradient(135deg,#f59e0b,#eab308)', boxShadow: '0 8px 26px rgba(245,158,11,0.4)' }}>
            👑
          </motion.div>
          <h1 className="mt-3 text-xl font-black" style={{ color: 'var(--t1)' }}>Prime для всей семьи</h1>
          <p className="mt-1 max-w-xs text-[12.5px]" style={{ color: 'var(--t3)' }}>
            До 8 участников получают Sky Prime по цене одной подписки — значительно выгоднее, чем оформлять каждому отдельно
          </p>
        </div>

        {active && family.primeUntil && (
          <div className="mt-5 rounded-2xl p-4 text-center" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
            <p className="text-[13px] font-bold" style={{ color: 'var(--green)' }}>✓ Активен для всей семьи</p>
            <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>До {new Date(family.primeUntil).toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' })}</p>
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          {PERKS.map(p => (
            <div key={p.text} className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'rgba(245,158,11,0.14)' }}><p.icon size={15} style={{ color: 'var(--amber)' }}/></div>
              <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>{p.text}</p>
            </div>
          ))}
          <div className="flex items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: 'rgba(245,158,11,0.14)' }}><Users size={15} style={{ color: 'var(--amber)' }}/></div>
            <p className="text-[12.5px]" style={{ color: 'var(--t2)' }}>Сейчас в семье: {family.members.length} участников — все получат Prime</p>
          </div>
        </div>

        {!active && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              {PRIME_FAMILY_PLANS.map(p => (
                <button key={p.id} type="button" onClick={() => setPlanId(p.id)}
                  className="relative rounded-2xl p-4 text-left"
                  style={{ background: planId === p.id ? 'rgba(245,158,11,0.1)' : 'var(--bg-l1)', border: `1.5px solid ${planId === p.id ? 'var(--amber)' : 'var(--border)'}` }}>
                  {p.popular && <span className="absolute -top-2 right-3 rounded-full px-2 py-0.5 text-[9px] font-bold text-white" style={{ background: 'var(--amber)' }}>Выгодно</span>}
                  <p className="text-[12px] font-semibold" style={{ color: 'var(--t3)' }}>{p.label}</p>
                  <p className="mt-0.5 text-xl font-black" style={{ color: 'var(--t1)' }}>{p.price.toLocaleString('ru')} ₽</p>
                  {p.sub && <p className="text-[10.5px] font-semibold" style={{ color: 'var(--green)' }}>{p.sub}</p>}
                  {planId === p.id && <Check size={14} className="absolute right-3 top-3" style={{ color: 'var(--amber)' }}/>}
                </button>
              ))}
            </div>

            <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--t3)' }}>Личный баланс: {fmt(balance)}</p>
            <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={buy}
              className="mt-3 w-full rounded-2xl py-4 text-center text-[14.5px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg,#f59e0b,#eab308)' }}>
              Оформить за {plan.price.toLocaleString('ru')} ₽
            </motion.button>
          </>
        )}

        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="mt-3 rounded-xl px-3 py-2.5 text-center text-[12.5px] font-semibold" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--t1)' }}>
            {toast}
          </motion.div>
        )}
      </div>
    </div>
  );
};
