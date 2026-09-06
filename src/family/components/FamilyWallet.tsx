import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, Repeat, X, Lock } from 'lucide-react';
import { useFamilyStore } from '../store';
import { useMoney, fmt } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';
import type { AutoTopupFreq } from '../types';
import { fmtAgo } from '@/bloom/store';

const FREQ_LABEL: Record<AutoTopupFreq, string> = { off:'Выключено', daily:'Ежедневно', weekly:'Еженедельно', monthly:'Ежемесячно', on_income:'При поступлении' };
const QUICK_AMOUNTS = [500, 1000, 5000, 10000];

export const FamilyWallet = ({ onBack }: { onBack: () => void }) => {
  const { family, topUp, withdraw, setAutoTopup, myMember } = useFamilyStore();
  const { getBalance } = useMoney();
  const { currentUserId } = useAuthStore();
  const [sheet, setSheet] = useState<'topup'|'withdraw'|'auto'|null>(null);
  const [amount, setAmount] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [autoFreq, setAutoFreq] = useState<AutoTopupFreq>(family?.autoTopup?.freq ?? 'off');
  const [autoAmount, setAutoAmount] = useState(String(family?.autoTopup?.amount ?? 1000));

  if (!family) return null;
  const me = myMember();
  const personalBalance = getBalance(currentUserId ?? '');
  const canWithdraw = me && !me.canDepositOnly && me.canWithdraw;

  const doTopUp = () => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    const ok = topUp(n);
    setToast(ok ? `Счёт пополнен на ${n.toLocaleString('ru')} ₽` : 'Недостаточно средств на личном балансе');
    setSheet(null); setAmount('');
    setTimeout(() => setToast(null), 2200);
  };

  const doWithdraw = () => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    const ok = withdraw(n, 'Личный перевод');
    if (ok) setToast(`${n.toLocaleString('ru')} ₽ переведено на личный счёт`);
    else if (me?.requireApprovalOver && n > me.requireApprovalOver) setToast('Запрос отправлен взрослым на подтверждение');
    else setToast('Операция недоступна: проверьте лимиты');
    setSheet(null); setAmount('');
    setTimeout(() => setToast(null), 2600);
  };

  const saveAuto = () => {
    setAutoTopup(autoFreq === 'off' ? null : { freq: autoFreq, amount: Number(autoAmount) || 0, memberId: me?.id ?? '' });
    setSheet(null);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
        <button type="button" onClick={onBack} className="rounded-full p-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}><ArrowLeft size={16} style={{ color: 'var(--t1)' }}/></button>
        <h2 className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>Общий счёт</h2>
      </div>

      <div className="px-4 py-3">
        <div className="rounded-3xl p-5" style={{ background: 'linear-gradient(135deg, rgba(79,110,247,0.18), rgba(139,92,246,0.12))', border: '1px solid rgba(79,110,247,0.25)' }}>
          <p className="text-[12px]" style={{ color: 'var(--t3)' }}>Баланс семьи</p>
          <p className="mt-1 text-3xl font-black" style={{ color: 'var(--t1)' }}>{fmt(family.balance)}</p>
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--t3)' }}>Ваш личный баланс: {fmt(personalBalance)}</p>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => setSheet('topup')}
              className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[13px] font-bold text-white" style={{ background: 'var(--accent)' }}>
              <ArrowDownToLine size={14}/>Пополнить
            </motion.button>
            {canWithdraw ? (
              <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => setSheet('withdraw')}
                className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[13px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t1)' }}>
                <ArrowUpFromLine size={14}/>Перевести себе
              </motion.button>
            ) : (
              <div className="flex items-center justify-center gap-1.5 rounded-2xl py-3 text-[12px] font-semibold" style={{ background: 'var(--bg-l2)', color: 'var(--t3)' }}>
                <Lock size={12}/>Только пополнение
              </div>
            )}
          </div>
        </div>

        <button type="button" onClick={() => setSheet('auto')}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl p-3.5" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
          <Repeat size={16} style={{ color: 'var(--accent)' }}/>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>Автопополнение</p>
            <p className="text-[11.5px]" style={{ color: 'var(--t3)' }}>{family.autoTopup ? `${FREQ_LABEL[family.autoTopup.freq]} · ${family.autoTopup.amount.toLocaleString('ru')} ₽` : 'Выключено'}</p>
          </div>
        </button>

        <div className="mt-5">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--t3)' }}>История операций</p>
          {family.transactions.length === 0 ? (
            <div className="sky-empty"><div className="sky-empty-icon">🧾</div><p style={{ color: 'var(--t2)' }}>Операций пока нет</p></div>
          ) : (
            <div className="space-y-2">
              {family.transactions.slice(0,30).map(t => (
                <div key={t.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'var(--bg-l1)', border: '1px solid var(--border)' }}>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm" style={{ background: 'var(--bg-l2)' }}>
                    {t.kind === 'topup' ? '💰' : t.kind === 'withdraw' ? '📤' : t.kind === 'goal_contribute' ? '🎯' : '💳'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold" style={{ color: 'var(--t1)' }}>{t.memberName}</p>
                    <p className="truncate text-[11px]" style={{ color: 'var(--t3)' }}>{t.desc} · {fmtAgo(t.createdAt)}</p>
                  </div>
                  <p className="shrink-0 text-[13px] font-bold" style={{ color: t.kind === 'topup' ? 'var(--green)' : 'var(--t1)' }}>
                    {t.kind === 'topup' ? '+' : '-'}{t.amount.toLocaleString('ru')} ₽
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
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
        {sheet && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setSheet(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30 }}
              onClick={e => e.stopPropagation()} className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl p-5" style={{ background: 'var(--bg-l1)' }}>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[15px] font-black" style={{ color: 'var(--t1)' }}>
                  {sheet === 'topup' ? 'Пополнить семейный счёт' : sheet === 'withdraw' ? 'Перевести на личный счёт' : 'Автопополнение'}
                </p>
                <button type="button" onClick={() => setSheet(null)}><X size={16} style={{ color: 'var(--t3)' }}/></button>
              </div>

              {(sheet === 'topup' || sheet === 'withdraw') && (
                <>
                  <input value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g,''))} placeholder="Сумма, ₽" inputMode="numeric"
                    className="w-full rounded-2xl px-4 py-3.5 text-[18px] font-bold outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  <div className="mt-3 flex gap-2">
                    {QUICK_AMOUNTS.map(a => (
                      <button key={a} type="button" onClick={() => setAmount(String(a))} className="flex-1 rounded-xl py-2 text-[12.5px] font-bold" style={{ background: 'var(--bg-l2)', color: 'var(--t2)' }}>{a.toLocaleString('ru')}</button>
                    ))}
                  </div>
                  {sheet === 'withdraw' && me?.requireApprovalOver && (
                    <p className="mt-3 text-[11.5px]" style={{ color: 'var(--t3)' }}>Переводы свыше {me.requireApprovalOver.toLocaleString('ru')} ₽ требуют подтверждения взрослого</p>
                  )}
                  <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={sheet === 'topup' ? doTopUp : doWithdraw}
                    className="sky-btn-primary mt-4 w-full justify-center py-3.5">Подтвердить</motion.button>
                </>
              )}

              {sheet === 'auto' && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(FREQ_LABEL) as AutoTopupFreq[]).map(f => (
                      <button key={f} type="button" onClick={() => setAutoFreq(f)}
                        className="rounded-xl px-3 py-2 text-[12.5px] font-semibold"
                        style={{ background: autoFreq === f ? 'var(--accent)' : 'var(--bg-l2)', color: autoFreq === f ? '#fff' : 'var(--t2)' }}>
                        {FREQ_LABEL[f]}
                      </button>
                    ))}
                  </div>
                  {autoFreq !== 'off' && (
                    <input value={autoAmount} onChange={e => setAutoAmount(e.target.value.replace(/\D/g,''))} placeholder="Сумма" inputMode="numeric"
                      className="mt-3 w-full rounded-2xl px-4 py-3 text-[15px] font-bold outline-none" style={{ background: 'var(--bg-l2)', border: '1px solid var(--border)', color: 'var(--t1)' }}/>
                  )}
                  <motion.button type="button" whileTap={{ scale: 0.98 }} onClick={saveAuto} className="sky-btn-primary mt-4 w-full justify-center py-3.5">Сохранить</motion.button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
