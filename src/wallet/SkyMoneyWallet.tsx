/* ===============================================================
   SKYMONEY  -  UI кошелька
=============================================================== */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, ArrowUpRight, ArrowDownLeft, RotateCcw,
  Crown, ShoppingBag, Music2, ChevronRight, X, Check,
  CreditCard, Smartphone, Building2, Users, Star, ArrowLeftRight,
  Globe, Zap, Landmark, Lock, Gift,
} from 'lucide-react';
import { useMoney, TX_ICON, TX_LABEL, fmt, fmtSigned, type TxType } from './store';
import { useAuthStore } from '@/core/auth/store';
import { MyGifts } from '@/gifts/SkyGifts';
import { SkyPayCheckout, PayHistory } from '@/payment/SkyPay';

const C = {
  bg:     'var(--bg)',
  l1:     'var(--bg-l1)',
  l2:     'var(--bg-l2)',
  l3:     'var(--bg-l3)',
  border: 'var(--border)',
  b2:     'var(--border-m)',
  t1:     'var(--t1)',
  t2:     'var(--t2)',
  t3:     'var(--t3)',
  accent: 'var(--accent)',
  green:  'var(--green)',
  red:    'var(--red)',
  amber:  'var(--amber)',
};

/* -- Топап методы ----------------------------------------------- */
const TOP_UP_METHODS = [
  { id:'card',  label:'Банковская карта',  icon:CreditCard,  fee: 0 },
  { id:'phone', label:'Через телефон',     icon:Smartphone,  fee: 2 },
  { id:'bank',  label:'Банковский перевод',icon:Building2,   fee: 0 },
];

/* QUICK_AMOUNTS moved to TopUpSheet */

/* -- Toplevel section type --------------------------------------- */
type WView = 'main' | 'topup' | 'checkout' | 'transfer' | 'history' | 'pay_history' | 'gifts' | 'exchange';

/* -- Balance Card ----------------------------------------------- */
const BalanceCard = ({ balance, points, userId, onExchange }: {
  balance: number; points: number; userId: string; onExchange: () => void;
}) => (
  <div className="space-y-2.5">
    {/* RUB balance */}
    <div className="relative overflow-hidden rounded-3xl p-5"
      style={{ background:'linear-gradient(135deg,#1a1f3c,#0d1128)', border:'1px solid rgba(79,110,247,0.25)' }}>
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full pointer-events-none"
        style={{ background:'radial-gradient(circle,rgba(79,110,247,0.2),transparent 70%)' }}/>
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <div className="grid h-7 w-7 place-items-center rounded-xl"
            style={{ background:'rgba(79,110,247,0.2)', border:'1px solid rgba(79,110,247,0.35)' }}>
            <Wallet size={13} style={{ color:C.accent }}/>
          </div>
          <span className="text-xs font-semibold tracking-wider uppercase" style={{ color:'rgba(255,255,255,0.4)' }}>SkyMoney</span>
        </div>
        <div className="text-4xl font-black text-white" style={{ letterSpacing:'-0.02em' }}>{fmt(balance)}</div>
        <div className="text-xs mt-1" style={{ color:'rgba(255,255,255,0.35)' }}>Доступный баланс</div>
      </div>
    </div>
    {/* Prime Points */}
    <div className="relative overflow-hidden rounded-3xl p-5 cursor-pointer"
      style={{ background:'linear-gradient(135deg,#1f1a00,#2d2000)', border:'1px solid rgba(245,158,11,0.3)' }}
      onClick={onExchange}>
      <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full pointer-events-none"
        style={{ background:'radial-gradient(circle,rgba(245,158,11,0.18),transparent 70%)' }}/>
      <div className="relative flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="grid h-7 w-7 place-items-center rounded-xl"
              style={{ background:'rgba(245,158,11,0.2)', border:'1px solid rgba(245,158,11,0.4)' }}>
              <Star size={13} style={{ color:'var(--amber)' }}/>
            </div>
            <span className="text-xs font-semibold tracking-wider uppercase" style={{ color:'rgba(255,255,255,0.4)' }}>Баллы Прайма</span>
          </div>
          <div className="text-4xl font-black" style={{ color:'var(--amber)', letterSpacing:'-0.02em' }}>
            {points.toLocaleString('ru')}
          </div>
          <div className="text-xs mt-1" style={{ color:'rgba(255,255,255,0.35)' }}>баллов</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{ background:'rgba(245,158,11,0.15)', border:'1px solid rgba(245,158,11,0.3)' }}>
            <ArrowLeftRight size={11} style={{ color:'var(--amber)' }}/>
            <span className="text-[10px] font-bold" style={{ color:'var(--amber)' }}>Обменять</span>
          </div>
          <span className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)' }}>1₽ = 10 баллов</span>
        </div>
      </div>
    </div>
  </div>
);

/* -- Quick Actions ----------------------------------------------- */
const QuickActions = ({ onTopUp, onTransfer, onHistory }: {
  onTopUp: () => void; onTransfer: () => void; onHistory: () => void;
}) => (
  <div className="grid grid-cols-3 gap-3">
    {[
      { icon:Plus,           label:'Пополнить', onClick:onTopUp,    color:C.accent },
      { icon:ArrowUpRight,   label:'Перевод',   onClick:onTransfer, color:C.green  },
      { icon:RotateCcw,      label:'История',   onClick:onHistory,  color:C.amber  },
    ].map(({ icon:Icon, label, onClick, color }) => (
      <motion.button key={label} type="button" onClick={onClick} whileTap={{ scale:0.94 }}
        className="flex flex-col items-center gap-2 rounded-2xl py-4 transition-colors"
        style={{ background:C.l2, border:`1px solid ${C.border}` }}>
        <div className="grid h-10 w-10 place-items-center rounded-xl"
          style={{ background:`${color}18`, border:`1px solid ${color}30` }}>
          <Icon size={18} style={{ color }}/>
        </div>
        <span className="text-xs font-semibold" style={{ color:C.t1 }}>{label}</span>
      </motion.button>
    ))}
  </div>
);

/* -- Spending Stats ----------------------------------------------- */
const SpendingStats = ({ txs }: { txs: ReturnType<typeof useMoney.getState>['transactions'] }) => {
  const spent30 = txs.filter(t => {
    const days = (Date.now() - new Date(t.createdAt).getTime()) / 86400000;
    return t.amount < 0 && days <= 30;
  }).reduce((a, t) => a + Math.abs(t.amount), 0);

  const income30 = txs.filter(t => {
    const days = (Date.now() - new Date(t.createdAt).getTime()) / 86400000;
    return t.amount > 0 && days <= 30;
  }).reduce((a, t) => a + t.amount, 0);

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl p-4" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
        <div className="flex items-center gap-2 mb-2">
          <ArrowDownLeft size={14} style={{ color:C.red }}/>
          <span className="text-xs" style={{ color:C.t3 }}>Расходы (30 дн)</span>
        </div>
        <div className="text-lg font-bold" style={{ color:C.red }}>−{fmt(spent30)}</div>
      </div>
      <div className="rounded-2xl p-4" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
        <div className="flex items-center gap-2 mb-2">
          <ArrowUpRight size={14} style={{ color:C.green }}/>
          <span className="text-xs" style={{ color:C.t3 }}>Приход (30 дн)</span>
        </div>
        <div className="text-lg font-bold" style={{ color:C.green }}>+{fmt(income30)}</div>
      </div>
    </div>
  );
};

/* -- Recent Transactions ------------------------------------------- */
const TxItem = ({ tx }: { tx: ReturnType<typeof useMoney.getState>['transactions'][0] }) => {
  const icon  = TX_ICON[tx.type];
  const label = TX_LABEL[tx.type];
  const plus  = tx.amount > 0;
  const d = new Date(tx.createdAt);
  const dateStr = d.toLocaleDateString('ru', { day:'numeric', month:'short' });

  return (
    <div className="flex items-center gap-3 py-3" style={{ borderBottom:`1px solid ${C.border}` }}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-lg"
        style={{ background: plus ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${plus ? 'rgba(52,211,153,0.2)' : C.border}` }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color:C.t1 }}>{label}</p>
        <p className="text-xs truncate" style={{ color:C.t3 }}>{tx.desc}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold" style={{ color: plus ? C.green : C.t1 }}>
          {fmtSigned(tx.amount)}
        </p>
        <p className="text-[10px]" style={{ color:C.t3 }}>{dateStr}</p>
      </div>
    </div>
  );
};

/* -- Top-up Modal ----------------------------------------------- */
/* ===============================================================
   КАССА  -  полноценный платёжный экран
=============================================================== */
type PayMethod = 'ru-card' | 'intl-card' | 'sbp' | 'paypal';

const PAY_METHODS: { id: PayMethod; label: string; sub: string; fee: number; Icon: typeof CreditCard; color: string }[] = [
  { id:'ru-card',   label:'Карта РФ',         sub:'Visa · МИР · Mastercard',    fee:0,   Icon:CreditCard, color:'var(--accent)' },
  { id:'intl-card', label:'Зарубежная карта',  sub:'Visa · Mastercard · Amex',   fee:1.5, Icon:Globe, color:'#a855f7' },
  { id:'sbp',       label:'СБП',              sub:'Система быстрых платежей',    fee:0,   Icon:Zap, color:'var(--green)' },
  { id:'paypal',    label:'PayPal',           sub:'Оплата через PayPal',          fee:2.5, Icon:Landmark,  color:'#0070ba' },
];

const QUICK_AMOUNTS_CASH = [200, 500, 1000, 2000, 5000, 10000];

/* -- Formatted card number input ------------------------------- */
const formatCard = (v: string) =>
  v.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();

const formatExpiry = (v: string) => {
  const d = v.replace(/\D/g,'').slice(0,4);
  return d.length > 2 ? d.slice(0,2) + '/' + d.slice(2) : d;
};

/* -- Card Form ------------------------------------------------- */
const CardForm = ({ intl, onPay }: { intl: boolean; onPay: (data: object) => void }) => {
  const [num,   setNum]   = useState('');
  const [exp,   setExp]   = useState('');
  const [cvv,   setCvv]   = useState('');
  const [name,  setName]  = useState('');
  const [save,  setSave]  = useState(false);
  const [err,   setErr]   = useState('');

  const iSty = { background:'rgba(255,255,255,0.05)', border:`1px solid ${C.border}`, color:C.t1 };
  const iCls = 'w-full rounded-2xl px-4 py-3 text-sm outline-none transition-all focus:border-[#4f6ef7]';

  const valid = num.replace(/\s/g,'').length===16 && exp.length===5 && cvv.length>=3;

  const submit = () => {
    setErr('');
    if (!valid) { setErr('Проверьте данные карты'); return; }
    const [m,y] = exp.split('/');
    const expDate = new Date(2000+parseInt(y), parseInt(m)-1);
    if (expDate < new Date()) { setErr('Срок действия карты истёк'); return; }
    onPay({ num, exp, name });
  };

  return (
    <div className="space-y-3">
      {/* Card visual */}
      <div className="relative h-36 rounded-2xl overflow-hidden px-5 py-4 flex flex-col justify-between"
        style={{ background:`linear-gradient(135deg,${intl?'#1a0533, #4f2e8a':'#0d1422, #1a3a6c'})`,
          boxShadow:`0 8px 32px ${intl?'rgba(168,85,247,0.25)':'rgba(79,110,247,0.25)'}` }}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage:'radial-gradient(circle at 80% 20%,rgba(255,255,255,0.3),transparent 50%)' }}/>
        <div className="flex justify-between items-start">
          <span className="text-xs font-bold tracking-wider uppercase text-white opacity-70">
            {intl ? 'International' : 'Russia'}
          </span>
          {intl ? <Globe size={17}/> : <CreditCard size={17}/>}
        </div>
        <div>
          <p className="text-base font-bold text-white tracking-widest font-mono">
            {num || '•••• •••• •••• ••••'}
          </p>
          <div className="flex gap-4 mt-1.5">
            <p className="text-[10px] text-white opacity-50">{name || 'ИМЯ ДЕРЖАТЕЛЯ'}</p>
            <p className="text-[10px] text-white opacity-50">{exp || 'MM/YY'}</p>
          </div>
        </div>
      </div>

      {/* Inputs */}
      <div>
        <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Номер карты</p>
        <input value={num} onChange={e => setNum(formatCard(e.target.value))}
          placeholder="0000 0000 0000 0000" maxLength={19}
          className={iCls} style={iSty}/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Срок</p>
          <input value={exp} onChange={e => setExp(formatExpiry(e.target.value))}
            placeholder="MM/YY" maxLength={5}
            className={iCls} style={iSty}/>
        </div>
        <div>
          <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>CVV</p>
          <input value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g,'').slice(0,4))}
            placeholder="•••" maxLength={4} type="password"
            className={iCls} style={iSty}/>
        </div>
      </div>
      <div>
        <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Имя держателя</p>
        <input value={name} onChange={e => setName(e.target.value.toUpperCase())}
          placeholder="IVAN IVANOV" className={iCls} style={iSty}/>
      </div>
      {/* Save card toggle */}
      <div className="flex items-center gap-3 px-1">
        <motion.div className="h-5 w-9 rounded-full cursor-pointer flex items-center px-0.5"
          style={{ background: save ? C.accent : C.l3 }}
          onClick={() => setSave(s => !s)}>
          <motion.div className="h-4 w-4 rounded-full bg-white shadow"
            animate={{ x: save ? 16 : 0 }} transition={{ type:'spring', stiffness:700, damping:35 }}/>
        </motion.div>
        <span className="text-xs" style={{ color:C.t2 }}>Сохранить карту для следующих платежей</span>
      </div>
      {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}
      <button type="button" onClick={submit} disabled={!valid}
        className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-35 transition-all"
        style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
        Оплатить
      </button>
    </div>
  );
};

/* -- SBP Form -------------------------------------------------- */
const SbpForm = ({ amount, onPay }: { amount: number; onPay: () => void }) => {
  const [bank, setBank] = useState('');
  const BANKS = [
    { id:'sber',  name:'Сбербанк',   dot:'#21a038' },
    { id:'tbank', name:'Т-Банк',     dot:'#ffdd2d' },
    { id:'alfa',  name:'Альфа-Банк', dot:'#ef3124' },
    { id:'vtb',   name:'ВТБ',        dot:'#0a2896' },
    { id:'other', name:'Другой банк',dot:'#8b95a5' },
  ];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 flex flex-col items-center gap-3"
        style={{ background:'rgba(52,211,153,0.06)', border:'1px solid rgba(52,211,153,0.2)' }}>
        <div className="grid h-16 w-16 place-items-center rounded-2xl text-3xl"
          style={{ background:'rgba(52,211,153,0.12)' }}><Zap size={18} style={{ color:'#34d399' }}/></div>
        <div className="text-center">
          <p className="text-sm font-bold text-white">СБП  -  Система быстрых платежей</p>
          <p className="text-xs mt-1" style={{ color:C.t2 }}>Мгновенный перевод · 0% комиссии</p>
        </div>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Выберите банк</p>
      <div className="grid grid-cols-1 gap-2">
        {BANKS.map(b => (
          <button key={b.id} type="button" onClick={() => setBank(b.id)}
            className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all"
            style={{
              background: bank===b.id ? 'rgba(52,211,153,0.1)' : C.l2,
              border: `1px solid ${bank===b.id ? 'rgba(52,211,153,0.35)' : C.border}`,
            }}>
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ background:b.dot }}/>
            <span className="text-sm font-medium flex-1 text-left" style={{ color:C.t1 }}>{b.name}</span>
            {bank===b.id && <Check size={15} style={{ color:C.green }}/>}
          </button>
        ))}
      </div>
      {bank && (
        <motion.div initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}
          className="rounded-2xl p-4 text-center"
          style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <p className="text-xs" style={{ color:C.t2 }}>Будет открыто приложение банка для подтверждения перевода</p>
          <p className="text-lg font-black text-white mt-1">{amount.toLocaleString('ru')} ₽</p>
        </motion.div>
      )}
      <button type="button" onClick={onPay} disabled={!bank}
        className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-35"
        style={{ background:`linear-gradient(135deg,${C.green}cc,${C.green})` }}>
        Перейти в приложение банка
      </button>
    </div>
  );
};

/* -- PayPal Form ----------------------------------------------- */
const PayPalForm = ({ amount, fee, onPay }: { amount: number; fee: number; onPay: () => void }) => {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const total = amount + Math.round(amount * fee / 100);
  const valid = email.includes('@') && pass.length >= 4;
  const iSty = { background:'rgba(255,255,255,0.05)', border:`1px solid ${C.border}`, color:C.t1 };
  return (
    <div className="space-y-4">
      {/* PayPal header */}
      <div className="rounded-2xl p-4 flex items-center gap-3"
        style={{ background:'rgba(0,112,186,0.08)', border:'1px solid rgba(0,112,186,0.25)' }}>
        <div className="grid h-12 w-12 place-items-center rounded-xl text-2xl flex-shrink-0"
          style={{ background:'rgba(0,112,186,0.12)' }}><Landmark size={18} style={{ color:'#0070ba' }}/></div>
        <div>
          <p className="text-sm font-bold text-white">PayPal</p>
          <p className="text-xs mt-0.5" style={{ color:C.t2 }}>Безопасная оплата через PayPal · Комиссия {fee}%</p>
        </div>
      </div>
      <div className="space-y-3">
        <div>
          <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Email PayPal</p>
          <input value={email} onChange={e=>setEmail(e.target.value)} type="email"
            placeholder="your@paypal.com"
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={iSty}/>
        </div>
        <div>
          <p className="text-[10px] mb-1.5 font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Пароль</p>
          <input value={pass} onChange={e=>setPass(e.target.value)} type="password"
            placeholder="••••••••"
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none" style={iSty}/>
        </div>
      </div>
      {fee > 0 && (
        <div className="rounded-2xl px-4 py-3 flex justify-between items-center"
          style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.2)' }}>
          <span className="text-xs" style={{ color:C.amber }}>Комиссия PayPal {fee}%</span>
          <span className="text-sm font-bold" style={{ color:C.amber }}>
            {amount.toLocaleString('ru')} + {Math.round(amount*fee/100)} ₽
          </span>
        </div>
      )}
      <div className="text-center text-xs" style={{ color:C.t3 }}>
        <Lock size={11} className="inline mr-1"/>Ваши данные защищены SSL-шифрованием PayPal
      </div>
      <button type="button" onClick={onPay} disabled={!valid}
        className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-35"
        style={{ background:'linear-gradient(135deg,#0070ba,#003087)' }}>
        Войти и оплатить {total.toLocaleString('ru')} ₽
      </button>
    </div>
  );
};

/* -- Processing Screen ----------------------------------------- */
const Processing = () => (
  <div className="flex flex-col items-center justify-center gap-5 py-10">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      className="grid h-16 w-16 place-items-center rounded-full"
      style={{ border:`3px solid ${C.accent}`, borderTopColor:'transparent' }}/>
    <div className="text-center">
      <p className="text-base font-bold text-white">Обрабатываем платёж...</p>
      <p className="text-xs mt-1" style={{ color:C.t2 }}>Обычно занимает несколько секунд</p>
    </div>
  </div>
);

/* -- Success Screen -------------------------------------------- */
const Success = ({ amount }: { amount: number }) => (
  <div className="flex flex-col items-center justify-center gap-5 py-10">
    <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
      transition={{ type:'spring', stiffness:400, damping:18 }}
      className="grid h-20 w-20 place-items-center rounded-full"
      style={{ background:'rgba(52,211,153,0.15)', border:'2px solid rgba(52,211,153,0.5)' }}>
      <Check size={36} style={{ color:C.green }}/>
    </motion.div>
    <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:.2 }}
      className="text-center">
      <p className="text-xl font-black text-white">Оплачено!</p>
      <p className="text-2xl font-black mt-2" style={{ color:C.green }}>+{amount.toLocaleString('ru')} ₽</p>
      <p className="text-sm mt-1" style={{ color:C.t2 }}>Зачислено на ваш SkyMoney</p>
    </motion.div>
  </div>
);

/* === MAIN CASHIER COMPONENT ==================================== */
const TopUpSheet = ({ onDone }: { onDone: () => void }) => {
  const { currentUserId } = useAuthStore();
  const { topUp }         = useMoney();

  const [step,    setStep]    = useState<'amount' | 'method' | 'form' | 'processing' | 'success'>('amount');
  const [amount,  setAmount]  = useState('');
  const [method,  setMethod]  = useState<PayMethod>('ru-card');

  const chosen = PAY_METHODS.find(m => m.id === method)!;
  const num    = parseInt(amount) || 0;
  const fee    = Math.round(num * chosen.fee / 100);
  const total  = num + fee;

  const processPayment = () => {
    setStep('processing');
    setTimeout(() => {
      topUp(currentUserId!, num, chosen.label);
      setStep('success');
      setTimeout(onDone, 2200);
    }, 2000);
  };

  return (
    <div className="space-y-1">
      {/* Step: Amount */}
      {step === 'amount' && (
        <motion.div initial={{ opacity:0, x:-12 }} animate={{ opacity:1, x:0 }} className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Сумма пополнения</p>
          {/* Quick amounts */}
          <div className="grid grid-cols-3 gap-2">
            {QUICK_AMOUNTS_CASH.map(a => (
              <button key={a} type="button" onClick={() => setAmount(String(a))}
                className="rounded-xl py-2.5 text-sm font-semibold transition-all"
                style={{
                  background: amount===String(a) ? `${C.accent}18` : C.l2,
                  border: `1px solid ${amount===String(a) ? C.accent+'50' : C.border}`,
                  color: amount===String(a) ? C.accent : C.t2,
                }}>
                {a.toLocaleString('ru')} ₽
              </button>
            ))}
          </div>
          {/* Custom amount */}
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-sm" style={{ color:C.t3 }}>₽</span>
            <input type="number" min="50" max="500000"
              value={amount} onChange={e => setAmount(e.target.value)}
              placeholder="Другая сумма (мин. 50 ₽)"
              className="w-full rounded-2xl pl-8 pr-4 py-3 text-sm outline-none"
              style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
          </div>
          <button type="button" onClick={() => setStep('method')}
            disabled={num < 50}
            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-35"
            style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
            Выбрать способ оплаты →
          </button>
        </motion.div>
      )}

      {/* Step: Method */}
      {step === 'method' && (
        <motion.div initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>Способ оплаты</p>
            <button type="button" onClick={() => setStep('amount')}
              className="text-xs" style={{ color:C.accent }}>← Изменить сумму</button>
          </div>
          {/* Amount recap */}
          <div className="rounded-2xl px-4 py-3 flex justify-between items-center"
            style={{ background:C.l2, border:`1px solid ${C.border}` }}>
            <span className="text-sm" style={{ color:C.t2 }}>К зачислению</span>
            <span className="text-lg font-black text-white">{num.toLocaleString('ru')} ₽</span>
          </div>
          {/* Methods */}
          <div className="space-y-2">
            {PAY_METHODS.map(m => {
              const feeAmt = Math.round(num * m.fee / 100);
              return (
                <motion.button key={m.id} type="button" whileTap={{ scale:.98 }}
                  onClick={() => setMethod(m.id)}
                  className="flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 transition-all"
                  style={{
                    background: method===m.id ? `${m.color}12` : C.l2,
                    border: `1.5px solid ${method===m.id ? m.color+'50' : C.border}`,
                  }}>
                  <div className="grid h-10 w-10 place-items-center rounded-xl text-xl flex-shrink-0"
                    style={{ background:`${m.color}18` }}>
                    <m.Icon size={20} style={{ color:m.color }}/>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-semibold" style={{ color:C.t1 }}>{m.label}</p>
                    <p className="text-xs" style={{ color:C.t3 }}>{m.sub}</p>
                  </div>
                  <div className="text-right">
                    {m.fee === 0
                      ? <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background:'rgba(52,211,153,0.12)', color:C.green }}>0%</span>
                      : <span className="text-xs" style={{ color:C.amber }}>+{feeAmt} ₽</span>
                    }
                  </div>
                  {method===m.id && (
                    <Check size={14} style={{ color:m.color }}/>
                  )}
                </motion.button>
              );
            })}
          </div>
          {/* Fee summary */}
          {chosen.fee > 0 && (
            <div className="rounded-xl px-4 py-2.5 flex justify-between"
              style={{ background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.18)' }}>
              <span className="text-xs" style={{ color:C.amber }}>Итого с комиссией {chosen.fee}%</span>
              <span className="text-sm font-bold" style={{ color:C.amber }}>{total.toLocaleString('ru')} ₽</span>
            </div>
          )}
          <button type="button" onClick={() => setStep('form')}
            className="w-full py-3.5 rounded-2xl text-sm font-bold text-white"
            style={{ background:`linear-gradient(135deg,${chosen.color},${chosen.color}aa)` }}>
            Продолжить → {method === 'sbp' ? 'СБП' : method === 'paypal' ? 'PayPal' : 'Ввести данные карты'}
          </button>
        </motion.div>
      )}

      {/* Step: Form */}
      {step === 'form' && (
        <motion.div initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <chosen.Icon size={19} style={{ color:chosen.color }}/>
              <p className="text-sm font-semibold" style={{ color:C.t1 }}>{chosen.label}</p>
            </div>
            <button type="button" onClick={() => setStep('method')}
              className="text-xs" style={{ color:C.accent }}>← Назад</button>
          </div>

          {(method === 'ru-card' || method === 'intl-card') && (
            <CardForm intl={method === 'intl-card'} onPay={processPayment}/>
          )}
          {method === 'sbp' && (
            <SbpForm amount={num} onPay={processPayment}/>
          )}
          {method === 'paypal' && (
            <PayPalForm amount={num} fee={chosen.fee} onPay={processPayment}/>
          )}
        </motion.div>
      )}

      {step === 'processing' && <Processing/>}
      {step === 'success'    && <Success amount={num}/>}
    </div>
  );
};


const TransferSheet = ({ onDone }: { onDone: () => void }) => {
  const { accounts, currentUserId } = useAuthStore();
  const { transfer, getBalance }    = useMoney();
  const [toId,    setToId]    = useState('');
  const [amount,  setAmount]  = useState('');
  const [success, setSuccess] = useState(false);
  const [err,     setErr]     = useState('');

  const others   = accounts.filter(a => a.id !== currentUserId);
  const myBal    = getBalance(currentUserId ?? '');
  const toUser   = others.find(a => a.id === toId);
  const num      = parseInt(amount) || 0;

  const confirm = async () => {
    setErr('');
    if (!toId)       { setErr('Выберите получателя'); return; }
    if (num < 10)    { setErr('Минимальная сумма 10 ₽'); return; }
    if (num > myBal) { setErr('Недостаточно средств'); return; }
    const ok = await transfer(currentUserId!, toId, num);
    if (ok) { setSuccess(true); setTimeout(onDone, 1600); }
    else      setErr(useMoney.getState().lastError ?? 'Ошибка перевода');
  };

  if (success) return (
    <div className="flex flex-col items-center justify-center gap-4 py-10">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', stiffness:400, damping:20 }}
        className="grid h-16 w-16 place-items-center rounded-full"
        style={{ background:'rgba(52,211,153,0.15)', border:'2px solid rgba(52,211,153,0.4)' }}>
        <Check size={32} style={{ color:C.green }}/>
      </motion.div>
      <p className="text-lg font-bold text-white">Перевод выполнен!</p>
    </div>
  );

  return (
    <div className="space-y-4 p-1">
      {/* Recipient */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color:C.t3 }}>Получатель</p>
        <div className="space-y-2">
          {others.map(a => (
            <button key={a.id} type="button" onClick={() => setToId(a.id)}
              className="flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-all"
              style={{
                background: toId === a.id ? `${C.accent}10` : C.l2,
                border: `1px solid ${toId === a.id ? C.accent+'40' : C.border}`,
              }}>
              <div className="grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-white shrink-0"
                style={{ background:`linear-gradient(135deg,hsl(${[...a.name].reduce((s,c)=>s+c.charCodeAt(0),0)%360},65%,42%),hsl(${([...a.name].reduce((s,c)=>s+c.charCodeAt(0),0)+40)%360},70%,36%))` }}>
                {a.name[0]}
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium" style={{ color:C.t1 }}>{a.name}</p>
                <p className="text-xs" style={{ color:C.t3 }}>@{a.username}</p>
              </div>
              {toId === a.id && <Check size={16} style={{ color:C.accent }}/>}
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color:C.t3 }}>Сумма</p>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color:C.t3 }}>₽</span>
          <input type="number" min="10" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Сколько отправить?"
            className="w-full rounded-2xl pl-8 pr-4 py-3 text-sm outline-none"
            style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
        </div>
        <p className="text-xs mt-1.5" style={{ color:C.t3 }}>Доступно: <span style={{ color:C.t2 }}>{fmt(myBal)}</span></p>
      </div>

      {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}

      {toUser && num >= 10 && (
        <motion.div initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }}
          className="rounded-2xl p-4" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <p className="text-sm" style={{ color:C.t2 }}>
            Перевод <span className="font-bold" style={{ color:C.t1 }}>{fmt(num)}</span> пользователю{' '}
            <span className="font-bold" style={{ color:C.t1 }}>{toUser.name}</span>
          </p>
        </motion.div>
      )}

      <motion.button whileTap={{ scale:0.97 }} type="button" onClick={confirm}
        disabled={!toId || !amount || num < 10}
        className="w-full py-3.5 rounded-2xl text-sm font-bold text-white disabled:opacity-40"
        style={{ background:`linear-gradient(135deg,${C.green}cc,${C.green})` }}>
        Отправить {num >= 10 ? fmt(num) : ''}
      </motion.button>
    </div>
  );
};

/* -- Full History ----------------------------------------------- */
const HistoryView = ({ txs, onBack }: { txs: ReturnType<typeof useMoney.getState>['transactions']; onBack: () => void }) => (
  <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} className="flex flex-col h-full">
    <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
      <button type="button" onClick={onBack}
        className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
        <X size={16} style={{ color:C.t2 }}/>
      </button>
      <span className="text-sm font-semibold" style={{ color:C.t1 }}>История операций</span>
    </div>
    <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth:'none' }}>
      {txs.length === 0
        ? <p className="text-center py-10 text-sm" style={{ color:C.t3 }}>Нет операций</p>
        : txs.map(tx => <TxItem key={tx.id} tx={tx}/>)
      }
    </div>
  </motion.div>
);


/* === EXCHANGE VIEW  -  RUB → Prime Points ======================= */
const EXCHANGE_PRESETS = [100, 300, 500, 1000, 2000, 5000];

const ExchangeView = ({ onDone, userId }: { onDone: () => void; userId: string }) => {
  const { getBalance, getPoints, exchangeToPoints } = useMoney();
  const [amount, setAmount] = useState('500');
  const [done,   setDone]   = useState(false);
  const [err,    setErr]    = useState('');

  const balance = getBalance(userId ?? '');
  const points  = getPoints(userId ?? '');
  const rubles  = parseInt(amount) || 0;
  const willGet = rubles * 10;

  const exchange = () => {
    setErr('');
    if (rubles < 50) { setErr('Минимальная сумма обмена: 50 ₽'); return; }
    const ok = exchangeToPoints(userId!, rubles);
    if (!ok) { setErr('Недостаточно средств'); return; }
    setDone(true);
    setTimeout(onDone, 2000);
  };

  if (done) return (
    <div className="flex flex-col items-center justify-center gap-5 h-full px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:18 }}
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background:'rgba(245,158,11,0.15)', border:'2px solid rgba(245,158,11,0.4)' }}>
        <Star size={36} fill="currentColor" style={{ color:'var(--amber)' }}/>
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-black text-white">Обмен выполнен!</p>
        <p className="text-2xl font-black mt-2" style={{ color:'var(--amber)' }}>+{willGet.toLocaleString('ru')} баллов</p>
        <p className="text-sm mt-1" style={{ color:C.t2 }}>Зачислено на счёт Баллов Прайма</p>
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5" style={{ scrollbarWidth:'none' }}>
      {/* Rate info */}
      <div className="rounded-2xl p-4 flex items-center gap-4"
        style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)' }}>
        <Star size={28} fill="currentColor" style={{ color:'var(--amber)' }}/>
        <div>
          <p className="text-sm font-bold text-white">Курс обмена</p>
          <p className="text-xs mt-0.5" style={{ color:C.t2 }}>1 рубль = 10 Баллов Прайма</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs" style={{ color:C.t3 }}>Баллы можно потратить на:</p>
          <p className="text-xs mt-0.5" style={{ color:C.amber }}>подарки · скины питомцев</p>
        </div>
      </div>

      {/* Current balances */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl p-3.5" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color:C.t3 }}>Баланс ₽</p>
          <p className="text-lg font-black text-white">{fmt(balance)}</p>
        </div>
        <div className="rounded-2xl p-3.5" style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)' }}>
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color:'rgba(245,158,11,0.5)' }}>Баллы</p>
          <p className="text-lg font-black" style={{ color:'var(--amber)' }}>{(points).toLocaleString('ru')}</p>
        </div>
      </div>

      {/* Presets */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color:C.t3 }}>Сумма обмена</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {EXCHANGE_PRESETS.map(a => (
            <button key={a} type="button" onClick={() => setAmount(String(a))}
              className="rounded-xl py-2.5 text-sm font-semibold transition-all"
              style={{
                background: amount===String(a) ? 'rgba(245,158,11,0.18)' : C.l2,
                border: `1px solid ${amount===String(a) ? 'rgba(245,158,11,0.5)' : C.border}`,
                color:  amount===String(a) ? 'var(--amber)' : C.t2,
              }}>
              {a.toLocaleString('ru')} ₽
            </button>
          ))}
        </div>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color:C.t3 }}>₽</span>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Своя сумма" min="50"
            className="w-full rounded-2xl pl-8 pr-4 py-3 text-sm outline-none"
            style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
        </div>
      </div>

      {/* Preview */}
      {rubles >= 50 && (
        <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
          className="rounded-2xl p-4 space-y-2.5" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <div className="flex justify-between text-sm">
            <span style={{ color:C.t2 }}>Спишется</span>
            <span style={{ color:C.t1 }}>{fmt(rubles)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color:C.t2 }}>Получите</span>
            <span className="font-bold" style={{ color:'var(--amber)' }}>{willGet.toLocaleString('ru')} баллов</span>
          </div>
          <div className="flex justify-between text-sm pt-1.5 font-bold" style={{ borderTop:`1px solid ${C.border}` }}>
            <span style={{ color:C.t2 }}>Остаток ₽</span>
            <span style={{ color: balance-rubles >= 0 ? C.green : C.red }}>
              {fmt(Math.max(0, balance-rubles))}
            </span>
          </div>
        </motion.div>
      )}

      {err && <p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}

      <motion.button whileTap={{ scale:.97 }} type="button" onClick={exchange}
        disabled={rubles < 50 || rubles > balance}
        className="w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35"
        style={{ background:'linear-gradient(135deg,#d97706,#f59e0b)', boxShadow:'0 8px 28px rgba(245,158,11,0.35)' }}>
        Обменять {rubles >= 50 ? `${fmt(rubles)} → ${willGet.toLocaleString('ru')} баллов` : ''}
      </motion.button>
    </div>
  );
};

/* === MAIN COMPONENT ============================================ */
export const SkyMoneyWallet = () => {
  const { currentUserId } = useAuthStore();
  const { getBalance, getPoints, getTxs } = useMoney();
  const [view, setView] = useState<WView>('main');

  if (!currentUserId) return null;

  const balance = getBalance(currentUserId);
  const points  = getPoints(currentUserId);
  const txs     = getTxs(currentUserId);
  const recent  = txs.slice(0, 5);

  if (view === 'topup') return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setView('main')}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <X size={16} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>Пополнить кошелёк</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth:'none' }}>
        <TopUpSheet onDone={() => setView('main')}/>
      </div>
    </div>
  );

  if (view === 'transfer') return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setView('main')}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <X size={16} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>Перевод</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth:'none' }}>
        <TransferSheet onDone={() => setView('main')}/>
      </div>
    </div>
  );

  if (view === 'gifts') return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setView('main')}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <X size={16} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>Мои подарки</span>
      </div>
      <MyGifts userId={currentUserId ?? ''}/>
    </div>
  );

  if (view === 'exchange') return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setView('main')}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <X size={16} style={{ color:C.t2 }}/>
        </button>
        <Star size={15} style={{ color:'var(--amber)' }}/>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>Обмен на Баллы Прайма</span>
      </div>
      <ExchangeView onDone={() => setView('main')} userId={currentUserId}/>
    </div>
  );

  if (view === 'checkout') return (
    <SkyPayCheckout
      purpose="wallet_topup"
      amount={parseInt(localStorage.getItem('sky:pay:pending_amount') || '500') || 500}
      onSuccess={() => { localStorage.removeItem('sky:pay:pending_amount'); setView('main'); }}
      onCancel={() => setView('main')}
    />
  );
  if (view === 'pay_history') return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setView('main')}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <X size={16} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>История платежей</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4" style={{ scrollbarWidth:'none' }}>
        <PayHistory userId={currentUserId}/>
      </div>
    </div>
  );
  if (view === 'history') return <HistoryView txs={txs} onBack={() => setView('main')}/>;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Fixed top: Balance + Actions */}
      <div className="shrink-0 px-4 pt-4 pb-3 space-y-3"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <BalanceCard balance={balance} points={points} userId={currentUserId} onExchange={() => setView('exchange')}/>
        <QuickActions
          onTopUp={() => setView('topup')}
          onTransfer={() => setView('transfer')}
          onHistory={() => setView('history')}
        />
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>

      {/* Spending stats */}
      <SpendingStats txs={txs}/>



      {/* Where to spend */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color:C.t3 }}>
          Куда потратить
        </p>
        <div className="space-y-2">
          {[
            { icon:Crown,      color:'var(--amber)', label:'Sky Prime', sub:'Подписка от 400 ₽/мес' },
            { icon:ShoppingBag,color:C.accent,  label:'Sky Market', sub:'Товары и сервисы' },
            { icon:Music2,     color:'#a855f7', label:'Sky Music', sub:'Эксклюзивные треки' },
          ].map(({ icon:Icon, color, label, sub }) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-white/[0.03] cursor-pointer"
              style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <div className="grid h-10 w-10 place-items-center rounded-2xl shrink-0"
                style={{ background:`${color}15`, border:`1px solid ${color}25` }}>
                <Icon size={17} style={{ color }}/>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color:C.t1 }}>{label}</p>
                <p className="text-xs" style={{ color:C.t3 }}>{sub}</p>
              </div>
              <ChevronRight size={14} style={{ color:C.t3 }}/>
            </div>
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      {recent.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:C.t3 }}>
              Последние операции
            </p>
            <button type="button" onClick={() => setView('history')}
              className="text-xs font-semibold" style={{ color:C.accent }}>
              Все →
            </button>
          </div>
          {recent.map(tx => <TxItem key={tx.id} tx={tx}/>)}
        </div>
      )}

      {/* Gifts link */}
      <button type="button" onClick={() => setView('gifts')}
        className="flex items-center gap-2 w-full rounded-2xl px-4 py-3 transition-colors hover:bg-white/[0.03]"
        style={{ background:C.l2, border:`1px solid ${C.border}` }}>
        <div className="grid h-8 w-8 place-items-center rounded-xl"
          style={{ background:'rgba(236,72,153,0.15)' }}>
          <Gift size={15} style={{ color:'var(--t2)' }}/>
        </div>
        <span className="text-sm font-medium flex-1 text-left" style={{ color:C.t1 }}>Мои подарки</span>
        <ChevronRight size={14} style={{ color:C.t3 }}/>
      </button>

      {/* Pay History link */}
      <button type="button" onClick={() => setView('pay_history')}
        className="flex items-center gap-2 w-full rounded-2xl px-4 py-3 transition-colors hover:bg-white/[0.03]"
        style={{ background:C.l2, border:`1px solid ${C.border}` }}>
        <div className="grid h-8 w-8 place-items-center rounded-xl"
          style={{ background:`${C.accent}15` }}>
          <RotateCcw size={14} style={{ color:C.accent }}/>
        </div>
        <span className="text-sm font-medium flex-1 text-left" style={{ color:C.t1 }}>История платежей Sky Pay</span>
        <ChevronRight size={14} style={{ color:C.t3 }}/>
      </button>

      {/* Security note */}
      <div className="rounded-2xl px-4 py-3 flex gap-3"
        style={{ background:'rgba(52,211,153,0.05)', border:'1px solid rgba(52,211,153,0.15)' }}>
        <Lock size={15} style={{ color:'var(--t2)' }}/>
        <p className="text-xs leading-relaxed" style={{ color:C.t3 }}>
          SkyMoney защищён шифрованием. Все транзакции фиксируются и могут быть проверены в истории.
        </p>
      </div>
      </div>{/* end scrollable */}
    </div>
  );
};
