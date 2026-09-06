import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Plus, X, Check } from 'lucide-react';
import { useFamilyStore } from '../store';
import { fmt } from '@/wallet/store';

const EMOJIS = ['🏖','🎮','🚗','🏠','💻','✈️','🎸','📱','🚲','🎓'];

export const FamilyGoals = ({ onBack }: { onBack: () => void }) => {
  const { family, createGoal, contributeToGoal, deleteGoal } = useFamilyStore();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [emoji, setEmoji] = useState(EMOJIS[0]);
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState('');
  const [contribGoal, setContribGoal] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  if (!family) return null;

  const submitCreate = () => {
    if (!title.trim() || !Number(target)) return;
    createGoal(title.trim(), emoji, Number(target), deadline || undefined);
    setCreating(false); setTitle(''); setTarget(''); setDeadline('');
  };

  const submitContribute = () => {
    const n = Number(amount);
    if (!n || !contribGoal) return;
    const ok = contributeToGoal(contribGoal, n);
    setToast(ok ? `Внесено ${n.toLocaleString('ru')} ₽` : 'Недостаточно средств на семейном счёте');
    setContribGoal(null); setAmount('');
    setTimeout(() => setToast(null), 2200);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
          <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Семейные цели</h2>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-white" style={{ background: 'var(--accent)' }}>
          <Plus size={13} className="inline"/> Цель
        </button>
      </div>

      <div className="flex-1 px-4 py-3 space-y-3">
        {family.goals.length === 0 && (
          <div className="sky-empty py-10">
            <div className="sky-empty-icon">🎯</div>
            <p style={{ color: 'var(--t2)' }}>Создайте первую семейную цель накопления</p>
            <button type="button" onClick={() => setCreating(true)} className="sky-btn-primary mt-2 px-5 py-2.5">Создать цель</button>
          </div>
        )}
        {family.goals.map(g => {
          const pct = Math.min(100, Math.round((g.savedAmount / g.targetAmount) * 100));
          return (
            <motion.div key={g.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl p-4" style={{ background: 'var(--bg-l1)', border: `1px solid ${g.achieved ? 'rgba(34,197,94,0.35)' : 'var(--border)'}` }}>
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: 'var(--bg-l2)' }}>{g.emoji}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold" style={{ color: 'var(--t1)' }}>{g.title}</p>
                  <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>{fmt(g.savedAmount)} из {fmt(g.targetAmount)}{g.deadline ? ` · до ${new Date(g.deadline).toLocaleDateString('ru')}` : ''}</p>
                </div>
                {g.achieved && <span className="shrink-0 text-lg">🎉</span>}
                <button type="button" onClick={() => deleteGoal(g.id)}><X size={14} style={{ color: 'var(--t3)' }}/></button>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-l2)' }}>
                <motion.div className="h-full rounded-full" style={{ background: g.achieved ? 'var(--green)' : 'var(--accent)' }}
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: 'easeOut' }}/>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px]" style={{ color: 'var(--t3)' }}>{pct}% · {g.contributors.length} участников внесли вклад</span>
                {!g.achieved && (
                  <button type="button" onClick={() => setContribGoal(g.id)} className="text-[12px] font-bold" style={{ color: 'var(--accent)' }}>Внести деньги</button>
                )}
              </div>
            </motion.div>
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
        {(creating || contribGoal) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}
            onClick={() => { setCreating(false); setContribGoal(null); }}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>

              {creating && (
                <>
                  <p className="mb-4 text-[15px] font-black" style={{ color: 'var(--t1)' }}>Новая цель</p>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {EMOJIS.map(e => (
                      <button key={e} type="button" onClick={() => setEmoji(e)}
                        className="grid h-10 w-10 place-items-center rounded-xl text-lg" style={{ background: emoji === e ? 'var(--accent-bg)' : 'var(--bg-l2)', border: emoji === e ? '1.5px solid var(--accent)' : '1px solid transparent' }}>
                        {e}
                      </button>
                    ))}
                  </div>
                  <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Название цели" maxLength={40}
                    className="w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  <input value={target} onChange={e => setTarget(e.target.value.replace(/\D/g,''))} placeholder="Сумма цели, ₽" inputMode="numeric"
                    className="mt-2.5 w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                    className="mt-2.5 w-full rounded-2xl px-4 py-3 text-[14px] outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submitCreate} className="sky-btn-primary mt-4 w-full justify-center py-3.5">
                    <Check size={15}/>Создать цель
                  </motion.button>
                </>
              )}

              {contribGoal && (
                <>
                  <p className="mb-4 text-[15px] font-black" style={{ color: 'var(--t1)' }}>Внести в цель</p>
                  <input value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g,''))} placeholder="Сумма, ₽" inputMode="numeric"
                    className="w-full rounded-2xl px-4 py-3.5 text-[18px] font-bold outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={submitContribute} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Внести</motion.button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
