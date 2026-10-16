import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, X, Wallet } from 'lucide-react';
import { FamilyIcon } from '../familyIcons';
import { useFamilyStore } from '../store';
import type { AllowanceFreq } from '../types';

export const FamilyAllowance = ({ onBack }: { onBack: () => void }) => {
  const { family, setAllowance, cancelAllowance, payoutNow } = useFamilyStore();
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState('500');
  const [freq, setFreq] = useState<AllowanceFreq>('weekly');
  const [toast, setToast] = useState<string | null>(null);

  if (!family) return null;
  const kids = family.members.filter(m => m.role === 'child' || m.role === 'teen');

  const save = () => {
    if (!editing || !Number(amount)) return;
    setAllowance(editing, Number(amount), freq);
    setEditing(null);
  };

  const doPayout = async (memberId: string) => {
    const ok = await payoutNow(memberId);
    setToast(ok ? 'Выплата произведена' : 'Недостаточно средств на семейном счёте');
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Карманные деньги</h2>
      </div>

      <div className="flex-1 px-4 py-3 space-y-2.5">
        {kids.length === 0 && (
          <div className="sky-empty py-10"><div className="sky-empty-icon"><FamilyIcon kind="money" size={30} color="var(--t3)"/></div><p style={{ color: 'var(--t2)' }}>В семье пока нет детей или подростков</p></div>
        )}
        {kids.map(m => {
          const a = family.allowances.find(x => x.memberId === m.id && x.active);
          const due = a && new Date(a.nextPayoutAt).getTime() <= Date.now();
          return (
            <div key={m.id} className="rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: m.avatarColor }}>{m.name[0]}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-bold" style={{ color: 'var(--t1)' }}>{m.name}</p>
                  {a ? (
                    <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>
                      {a.amount.toLocaleString('ru')} ₽ · {a.freq === 'weekly' ? 'еженедельно' : 'ежемесячно'} · след. выплата {new Date(a.nextPayoutAt).toLocaleDateString('ru-RU')}
                    </p>
                  ) : (
                    <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>Не настроено</p>
                  )}
                </div>
                <button type="button" onClick={() => { setEditing(m.id); setAmount(String(a?.amount ?? 500)); setFreq(a?.freq ?? 'weekly'); }}
                  className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>
                  {a ? 'Изменить' : 'Настроить'}
                </button>
              </div>
              {a && (
                <div className="mt-2.5 flex gap-2">
                  <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => doPayout(m.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-bold text-white" style={{ background: due ? 'var(--accent)' : 'var(--bg-l2)', color: due ? '#fff' : 'var(--t2)' }}>
                    <Wallet size={12}/>{due ? 'Выплатить сейчас' : 'Выплатить досрочно'}
                  </motion.button>
                  <button type="button" onClick={() => cancelAllowance(m.id)} className="rounded-xl px-3 py-2 text-[12px] font-semibold" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}>Отменить</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-2.5 text-[12.5px] font-semibold text-white" style={{ background: 'rgba(20,20,26,0.95)' }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setEditing(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Настроить выплаты</p>
                <button type="button" onClick={() => setEditing(null)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <input value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g,''))} placeholder="Сумма, ₽" inputMode="numeric"
                className="w-full rounded-2xl px-4 py-3.5 text-[18px] font-bold outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setFreq('weekly')} className="flex-1 rounded-xl py-2.5 text-[12.5px] font-bold" style={{ background: freq==='weekly' ? 'var(--accent)' : 'var(--bg-l2)', color: freq==='weekly' ? '#fff' : 'var(--t2)' }}>Еженедельно</button>
                <button type="button" onClick={() => setFreq('monthly')} className="flex-1 rounded-xl py-2.5 text-[12.5px] font-bold" style={{ background: freq==='monthly' ? 'var(--accent)' : 'var(--bg-l2)', color: freq==='monthly' ? '#fff' : 'var(--t2)' }}>Ежемесячно</button>
              </div>
              <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={save} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Сохранить</motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
