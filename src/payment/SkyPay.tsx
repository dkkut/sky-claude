/* ===============================================================
   SKY PAY UI  -  Платёжный экран
   Стиль: тёмный, профессиональный, как у Telegram Payments
=============================================================== */
import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Lock, Shield, Check, X,
  AlertCircle, RefreshCw, CreditCard, Wifi, Clock, Zap, Landmark, KeyRound,
} from 'lucide-react';
import type { IconComponent } from '@/shared/icon';
import {
  usePayGateway, PROVIDERS, detectCardBrand, maskCard, fmtAmount,
  STATUS_LABEL, PURPOSE_LABEL,
  type PayProvider, type PayPurpose, type PayStatus, type CardData,
} from './gateway';
import { useMoney } from '@/wallet/store';
import { useAuthStore } from '@/core/auth/store';

/* -- Tokens --------------------------------------------------- */
const P = {
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

/* -- Card brand icon -------------------------------------------
   Платёжные системы раньше показывались цветными кружками-эмодзи:
   «синее сердце» для Visa, «красный круг» для Mastercard. Ни одна
   из этих картинок систему не называла, а рисовал их шрифт
   устройства. Теперь это короткая подпись бренда на его цвете —
   читается одинаково везде и не зависит от шрифта.
---------------------------------------------------------------- */
const BRAND_MARK: Record<string, { text: string; color: string }> = {
  visa:       { text: 'VISA', color: '#1a1f71' },
  mastercard: { text: 'MC',   color: '#eb001b' },
  mir:        { text: 'МИР',  color: '#0f754e' },
  amex:       { text: 'AMEX', color: '#2e77bb' },
  unknown:    { text: '',     color: 'transparent' },
};

const BrandMark = ({ brand }: { brand: string }) => {
  const m = BRAND_MARK[brand] ?? BRAND_MARK.unknown;
  if (!m.text) return <CreditCard size={18} style={{ color:'rgba(255,255,255,0.6)' }}/>;
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white"
      style={{ background: m.color }}>
      {m.text}
    </span>
  );
};

/* -- Input field ----------------------------------------------- */
const Field = ({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) => (
  <div className="space-y-1.5">
    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color:P.t3 }}>
      {label}
    </label>
    {children}
    {error && (
      <motion.p initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }}
        className="text-[11px] flex items-center gap-1" style={{ color:P.red }}>
        <AlertCircle size={10}/>{error}
      </motion.p>
    )}
  </div>
);

const inp = {
  base: 'w-full rounded-2xl px-4 py-3.5 text-sm outline-none transition-all placeholder:text-[--t3]',
  style: (focus: boolean) => ({
    background:   P.l2,
    border:       `1.5px solid ${focus ? P.accent : P.border}`,
    color:        P.t1,
    caretColor:   P.accent,
  }),
};

/* -- Card visual preview --------------------------------------- */
const CardPreview = ({ num, exp, holder, intl }: { num:string; exp:string; holder:string; intl:boolean }) => {
  const brand = detectCardBrand(num);
  const hue   = intl ? '270,65%,42%' : '225,65%,42%';
  return (
    <motion.div layout
      className="relative overflow-hidden rounded-2xl px-5 pt-4 pb-5 mb-1"
      style={{
        background:  `linear-gradient(135deg,hsl(${hue}),hsl(${hue.replace('42%','32%')}))`,
        boxShadow:   `0 12px 40px rgba(0,0,0,0.45), 0 2px 0 rgba(255,255,255,0.08) inset`,
        minHeight:   140,
      }}>
      {/* Glare */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background:'linear-gradient(135deg,rgba(255,255,255,0.12) 0%,transparent 50%)' }}/>
      {/* Chip */}
      <div className="absolute top-4 left-5">
        <div className="w-8 h-6 rounded-md"
          style={{ background:'linear-gradient(135deg,#c8a02a,#f0c040)', boxShadow:'0 1px 4px rgba(0,0,0,0.4)' }}/>
      </div>
      {/* Brand */}
      <div className="absolute top-3 right-4"><BrandMark brand={brand}/></div>
      {/* Card number */}
      <div className="absolute bottom-12 left-5 right-5">
        <p className="text-base tracking-[.22em] font-bold text-white font-mono"
          style={{ textShadow:'0 1px 4px rgba(0,0,0,0.5)' }}>
          {num || '•••• •••• •••• ••••'}
        </p>
      </div>
      {/* Bottom row */}
      <div className="absolute bottom-4 left-5 right-5 flex justify-between">
        <div>
          <p className="text-[8px] uppercase tracking-wider text-white opacity-50">Держатель</p>
          <p className="text-[11px] font-semibold text-white mt-0.5 tracking-wide">
            {holder || 'IVAN IVANOV'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[8px] uppercase tracking-wider text-white opacity-50">Срок</p>
          <p className="text-[11px] font-semibold text-white mt-0.5">{exp || 'MM/YY'}</p>
        </div>
      </div>
    </motion.div>
  );
};

/* -- Card Form ------------------------------------------------- */
const CardForm = ({ intl, onSubmit }: {
  intl: boolean;
  onSubmit: (card: CardData) => void;
}) => {
  const [num,    setNum]    = useState('');
  const [exp,    setExp]    = useState('');
  const [cvv,    setCvv]    = useState('');
  const [holder, setHolder] = useState('');
  const [focusedField, setFocused] = useState<string|null>(null);
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [saveCard, setSaveCard] = useState(false);

  const expRef  = useRef<HTMLInputElement>(null);
  const cvvRef  = useRef<HTMLInputElement>(null);
  const holdRef = useRef<HTMLInputElement>(null);

  const formatNum = (v: string) =>
    v.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();

  const formatExp = (v: string) => {
    const d = v.replace(/\D/g,'').slice(0,4);
    return d.length > 2 ? d.slice(0,2) + '/' + d.slice(2) : d;
  };

  const handleNum = (v: string) => {
    const f = formatNum(v);
    setNum(f);
    if (f.replace(/\s/g,'').length === 16) expRef.current?.focus();
  };

  const handleExp = (v: string) => {
    const f = formatExp(v);
    setExp(f);
    if (f.length === 5) cvvRef.current?.focus();
  };

  const validate = (): boolean => {
    const errs: Record<string,string> = {};
    const rawNum = num.replace(/\s/g,'');
    if (rawNum.length < 16)             errs.num    = 'Введите 16 цифр';
    if (exp.length < 5)                 errs.exp    = 'Формат MM/YY';
    else {
      const [m,y] = exp.split('/');
      const d = new Date(2000+parseInt(y), parseInt(m)-1);
      if (d < new Date()) errs.exp = 'Срок истёк';
    }
    if (cvv.length < 3)                 errs.cvv    = '3-4 цифры';
    if (!holder.trim() || holder.length < 3) errs.holder = 'Введите имя';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    onSubmit({
      number: maskCard(num),
      expiry: exp,
      holder: holder.trim().toUpperCase(),
      brand:  detectCardBrand(num),
    });
  };

  return (
    <div className="space-y-4">
      <CardPreview num={num} exp={exp} holder={holder} intl={intl}/>

      <Field label="Номер карты" error={errors.num}>
        <input value={num} onChange={e => handleNum(e.target.value)}
          onFocus={() => setFocused('num')} onBlur={() => setFocused(null)}
          placeholder="0000 0000 0000 0000" inputMode="numeric" maxLength={19}
          className={inp.base} style={inp.style(focusedField==='num')}/>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Срок" error={errors.exp}>
          <input ref={expRef} value={exp} onChange={e => handleExp(e.target.value)}
            onFocus={() => setFocused('exp')} onBlur={() => setFocused(null)}
            placeholder="MM/YY" inputMode="numeric" maxLength={5}
            className={inp.base} style={inp.style(focusedField==='exp')}/>
        </Field>
        <Field label="CVV / CVC" error={errors.cvv}>
          <input ref={cvvRef} value={cvv} onChange={e => setCvv(e.target.value.replace(/\D/g,'').slice(0,4))}
            onFocus={() => setFocused('cvv')} onBlur={() => setFocused(null)}
            placeholder="•••" inputMode="numeric" type="password" maxLength={4}
            className={inp.base} style={inp.style(focusedField==='cvv')}/>
        </Field>
      </div>

      <Field label="Держатель карты" error={errors.holder}>
        <input ref={holdRef} value={holder} onChange={e => setHolder(e.target.value.toUpperCase())}
          onFocus={() => setFocused('holder')} onBlur={() => setFocused(null)}
          placeholder="IVAN IVANOV"
          className={inp.base} style={inp.style(focusedField==='holder')}/>
      </Field>

      {/* Save card */}
      <label className="flex items-center gap-3 cursor-pointer select-none px-1">
        <div className="relative h-5 w-9 flex-shrink-0">
          <div className="absolute inset-0 rounded-full transition-colors"
            style={{ background: saveCard ? P.accent : P.l3 }}
            onClick={() => setSaveCard(s => !s)}>
            <motion.div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-md"
              animate={{ x: saveCard ? 16 : 0 }} transition={{ type:'spring', stiffness:700, damping:35 }}/>
          </div>
        </div>
        <span className="text-xs" style={{ color:P.t2 }}>Сохранить карту для быстрой оплаты</span>
      </label>

      <button type="button" onClick={submit}
        className="w-full rounded-2xl py-4 text-sm font-bold text-white flex items-center justify-center gap-2"
        style={{ background:`linear-gradient(135deg,${P.accent},#818cf8)`, boxShadow:`0 6px 24px ${P.accent}40` }}>
        <Lock size={14}/>Оплатить
      </button>
    </div>
  );
};

/* -- SBP Form -------------------------------------------------- */
const SbpForm = ({ amount, onSubmit }: { amount: number; onSubmit: () => void }) => {
  const [bank, setBank] = useState('');
  const BANKS = [
    { id:'sber',   name:'Сбербанк',    color:'#21A038' },
    { id:'tbank',  name:'Т-Банк',      color:'#FFDD2D' },
    { id:'alfa',   name:'Альфа-Банк',  color:'#EF3124' },
    { id:'vtb',    name:'ВТБ',         color:'#0072CE' },
    { id:'raiffeisen', name:'Райффайзен', color:'#FFED00' },
    { id:'other',  name:'Другой банк', color:'var(--t2)', other:true },
  ];

  return (
    <div className="space-y-4">
      {/* SBP logo area */}
      <div className="rounded-2xl p-4 flex items-center gap-4"
        style={{ background:'rgba(52,211,153,0.07)', border:'1px solid rgba(52,211,153,0.2)' }}>
        <div className="grid h-14 w-14 place-items-center rounded-2xl flex-shrink-0"
          style={{ background:'rgba(52,211,153,0.12)' }}>
          <Zap size={26} style={{ color:P.green }}/>
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color:P.t1 }}>СБП  -  Система быстрых платежей</p>
          <p className="text-xs mt-0.5" style={{ color:P.t2 }}>Мгновенный перевод · 0% комиссии</p>
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color:P.green }}>
            <Check size={12}/> Центробанк России
          </p>
        </div>
      </div>

      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color:P.t3 }}>
        Выберите банк для оплаты
      </p>

      <div className="grid grid-cols-2 gap-2">
        {BANKS.map(b => (
          <motion.button key={b.id} type="button" whileTap={{ scale:.96 }}
            onClick={() => setBank(b.id)}
            className="flex items-center gap-2.5 rounded-2xl px-3 py-3 transition-all"
            style={{
              background: bank===b.id ? `${b.color}18` : P.l2,
              border:     `1.5px solid ${bank===b.id ? b.color+'55' : P.border}`,
            }}>
            {b.other
              ? <Landmark size={17} className="flex-shrink-0" style={{ color:b.color }}/>
              : <span className="h-3.5 w-3.5 rounded-full flex-shrink-0" style={{ background:b.color }}/>}
            <span className="text-xs font-semibold text-left" style={{ color:P.t1 }}>{b.name}</span>
            {bank===b.id && <Check size={13} className="ml-auto flex-shrink-0" style={{ color:P.green }}/>}
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {bank && (
          <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="rounded-2xl p-4 text-center"
            style={{ background:P.l2, border:`1px solid ${P.border}` }}>
            <p className="text-xs" style={{ color:P.t2 }}>Откроется приложение банка</p>
            <p className="text-2xl font-black mt-1" style={{ color:P.t1 }}>
              {fmtAmount(amount)}
            </p>
            <p className="text-xs mt-1" style={{ color:P.t3 }}>
              Sky Platform · Получатель идентифицирован
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <button type="button" onClick={onSubmit} disabled={!bank}
        className="w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35 flex items-center justify-center gap-2"
        style={{ background:'linear-gradient(135deg,rgba(52,211,153,0.9),rgba(52,211,153,0.7))' }}>
        <Wifi size={14}/>Перейти в приложение
      </button>
    </div>
  );
};

/* -- PayPal Form ----------------------------------------------- */
const PayPalForm = ({ amount, fee, onSubmit }: { amount:number; fee:number; onSubmit:()=>void }) => {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [focused, setFocused] = useState<string|null>(null);
  const total   = amount + fee;
  const valid   = /\S+@\S+\.\S+/.test(email) && pass.length >= 4;

  return (
    <div className="space-y-4">
      {/* PayPal header */}
      <div className="rounded-2xl p-4 flex items-center gap-3"
        style={{ background:'rgba(0,112,186,0.08)', border:'1px solid rgba(0,112,186,0.25)' }}>
        <div className="grid h-12 w-12 place-items-center rounded-xl text-2xl flex-shrink-0"
          style={{ background:'rgba(0,112,186,0.12)' }}>🅿</div>
        <div>
          <p className="text-sm font-bold" style={{ color:P.t1 }}>PayPal</p>
          <p className="text-xs mt-0.5" style={{ color:P.t2 }}>
            Комиссия +{fmtAmount(fee)} · Итого {fmtAmount(total)}
          </p>
        </div>
      </div>

      <Field label="Email PayPal">
        <input value={email} onChange={e=>setEmail(e.target.value)} type="email"
          placeholder="you@example.com"
          onFocus={()=>setFocused('email')} onBlur={()=>setFocused(null)}
          className={inp.base} style={inp.style(focused==='email')}/>
      </Field>

      <Field label="Пароль">
        <input value={pass} onChange={e=>setPass(e.target.value)} type="password"
          placeholder="••••••••"
          onFocus={()=>setFocused('pass')} onBlur={()=>setFocused(null)}
          className={inp.base} style={inp.style(focused==='pass')}/>
      </Field>

      <div className="rounded-xl px-4 py-2.5 flex items-center gap-2"
        style={{ background:'rgba(0,48,135,0.15)', border:'1px solid rgba(0,112,186,0.2)' }}>
        <Lock size={11} style={{ color:'rgba(0,112,186,0.7)' }}/>
        <p className="text-[10px]" style={{ color:P.t3 }}>
          Ваш пароль защищён SSL. Sky не хранит учётные данные PayPal.
        </p>
      </div>

      <button type="button" onClick={onSubmit} disabled={!valid}
        className="w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35"
        style={{ background:'linear-gradient(135deg,#0070ba,#003087)' }}>
        Войти и оплатить {fmtAmount(total)}
      </button>
    </div>
  );
};

/* -- Status screens -------------------------------------------- */
const StatusScreen = ({ status, amount, sessionId, onRetry, onClose }: {
  status:    PayStatus;
  amount:    number;
  sessionId: string;
  onRetry:   () => void;
  onClose:   () => void;
}) => {
  const SCREENS = {
    pending: {
      icon: <motion.div animate={{ rotate:360 }} transition={{ duration:1.4, repeat:Infinity, ease:'linear' }}
              className="grid h-16 w-16 place-items-center rounded-full"
              style={{ border:`3px solid ${P.accent}`, borderTopColor:'transparent' }}/>,
      title: 'Ожидание...',
      sub:   'Подключаемся к банку',
      color: P.accent,
    },
    processing: {
      icon: (
        <div className="relative h-16 w-16">
          <motion.div animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:'linear' }}
            className="absolute inset-0 rounded-full"
            style={{ border:`3px solid ${P.amber}`, borderTopColor:'transparent' }}/>
          <div className="absolute inset-2 grid place-items-center">
            <KeyRound size={20} style={{ color:P.amber }}/>
          </div>
        </div>
      ),
      title: 'Обрабатывается...',
      sub:   'Подтверждение в банке',
      color: P.amber,
    },
    confirmed: {
      icon: (
        <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
          transition={{ type:'spring', stiffness:400, damping:18 }}
          className="grid h-16 w-16 place-items-center rounded-full"
          style={{ background:'rgba(52,211,153,0.15)', border:`2px solid ${P.green}` }}>
          <Check size={32} style={{ color:P.green }}/>
        </motion.div>
      ),
      title: 'Оплачено',
      sub:   fmtAmount(amount) + ' зачислено на SkyMoney',
      color: P.green,
    },
    failed: {
      icon: (
        <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
          transition={{ type:'spring', stiffness:400, damping:18 }}
          className="grid h-16 w-16 place-items-center rounded-full"
          style={{ background:'rgba(248,113,113,0.12)', border:`2px solid ${P.red}` }}>
          <X size={32} style={{ color:P.red }}/>
        </motion.div>
      ),
      title: 'Платёж отклонён',
      sub:   'Банк отказал в проведении транзакции',
      color: P.red,
    },
  };

  const screen = SCREENS[status as keyof typeof SCREENS];
  if (!screen) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-8 px-4">
      {screen.icon}
      <div className="text-center">
        <p className="text-lg font-black" style={{ color:screen.color }}>{screen.title}</p>
        <p className="text-sm mt-1" style={{ color:P.t2 }}>{screen.sub}</p>
        <p className="text-[10px] mt-2 font-mono" style={{ color:P.t3 }}>{sessionId}</p>
      </div>

      {status === 'confirmed' && (
        <motion.button initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} transition={{ delay:.4 }}
          type="button" onClick={onClose}
          className="w-full max-w-xs rounded-2xl py-3.5 text-sm font-bold text-white"
          style={{ background:`linear-gradient(135deg,${P.green}cc,${P.green})` }}>
          Готово
        </motion.button>
      )}

      {status === 'failed' && (
        <div className="flex gap-3 w-full max-w-xs">
          <button type="button" onClick={onClose}
            className="flex-1 rounded-2xl py-3 text-sm font-semibold"
            style={{ background:P.l2, border:`1px solid ${P.border}`, color:P.t2 }}>
            Закрыть
          </button>
          <button type="button" onClick={onRetry}
            className="flex-1 rounded-2xl py-3 text-sm font-bold text-white flex items-center justify-center gap-1.5"
            style={{ background:P.accent }}>
            <RefreshCw size={13}/>Повторить
          </button>
        </div>
      )}

      {(status === 'pending' || status === 'processing') && (
        <p className="text-xs text-center" style={{ color:P.t3 }}>
          Не закрывайте окно...
        </p>
      )}
    </div>
  );
};

/* === MAIN SKYPAY CHECKOUT ====================================== */
interface SkyPayProps {
  purpose:    PayPurpose;
  amount:     number;
  onSuccess:  () => void;
  onCancel:   () => void;
}

export const SkyPayCheckout = ({ purpose, amount, onSuccess, onCancel }: SkyPayProps) => {
  const { currentUserId } = useAuthStore();
  const { topUp }         = useMoney();
  const { createSession, executePayment } = usePayGateway();

  const [step,      setStep]    = useState<'select' | 'form' | 'status'>('select');
  const [provider,  setProvider] = useState<PayProvider>('skypay_card');
  const [status,    setStatus]  = useState<PayStatus>('created');
  const [sessionId, setSessionId] = useState('');

  const chosen = PROVIDERS.find(p => p.id === provider)!;
  const fee    = Math.max(chosen.minFee, Math.round(amount * chosen.feeRate));
  const total  = amount + fee;

  const startPayment = useCallback(async (cardData?: CardData) => {
    if (!currentUserId) return;
    setStep('status');
    setStatus('pending');

    const sess = createSession(currentUserId, purpose, amount, provider);
    setSessionId(sess.id);

    const result = await executePayment(sess.id, cardData, (s) => setStatus(s));

    if (result.status === 'confirmed') {
      // For wallet top-ups, credit the balance
      if (purpose === 'wallet_topup') {
        topUp(currentUserId, amount, chosen.label);
      }
      setTimeout(onSuccess, 1800);
    }
  }, [currentUserId, purpose, amount, provider, chosen, createSession, executePayment, topUp, onSuccess]);

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:P.bg }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 shrink-0"
        style={{ borderBottom:`1px solid ${P.border}` }}>
        <button type="button" onClick={step === 'select' ? onCancel : () => setStep('select')}
          className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/5"
          disabled={step === 'status' && (status === 'pending' || status === 'processing')}>
          <ChevronLeft size={20} style={{ color:P.t2 }}/>
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold" style={{ color:P.t1 }}>Sky Pay</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Lock size={10} style={{ color:P.green }}/>
            <span className="text-[10px]" style={{ color:P.t3 }}>Защищённое соединение</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
          style={{ background:'rgba(52,211,153,0.08)', border:'1px solid rgba(52,211,153,0.2)' }}>
          <Shield size={11} style={{ color:P.green }}/>
          <span className="text-[10px] font-semibold" style={{ color:P.green }}>PCI DSS</span>
        </div>
      </div>

      {/* Order summary */}
      {step !== 'status' && (
        <div className="mx-4 mt-4 rounded-2xl px-4 py-3 flex items-center justify-between shrink-0"
          style={{ background:P.l1, border:`1px solid ${P.border}` }}>
          <div>
            <p className="text-xs font-semibold" style={{ color:P.t2 }}>{PURPOSE_LABEL[purpose]}</p>
            {fee > 0 && (
              <p className="text-[10px] mt-0.5" style={{ color:P.t3 }}>
                +{fmtAmount(fee)} комиссия ({chosen.feeRate*100}%)
              </p>
            )}
          </div>
          <p className="text-xl font-black" style={{ color:P.t1 }}>{fmtAmount(total)}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth:'none' }}>
        <AnimatePresence mode="wait">

          {/* Step 1: Select provider */}
          {step === 'select' && (
            <motion.div key="select" initial={{ opacity:0, x:-12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0 }}
              className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color:P.t3 }}>
                Способ оплаты
              </p>
              {PROVIDERS.filter(p => p.enabled).map(p => {
                const pFee = Math.max(p.minFee, Math.round(amount * p.feeRate));
                return (
                  <motion.button key={p.id} type="button" whileTap={{ scale:.97 }}
                    onClick={() => { setProvider(p.id); setStep('form'); }}
                    className="flex items-center gap-4 w-full rounded-2xl px-4 py-4 transition-all"
                    style={{
                      background: P.l1,
                      border:     `1.5px solid ${provider===p.id ? P.accent+'60' : P.border}`,
                    }}>
                    <div className="grid h-11 w-11 place-items-center rounded-xl flex-shrink-0"
                      style={{ background:P.l2 }}>
                      <p.Icon size={21} style={{ color:P.t2 }}/>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-semibold" style={{ color:P.t1 }}>{p.label}</p>
                      <p className="text-[11px] mt-0.5" style={{ color:P.t3 }}>
                        {p.feeRate === 0
                          ? <span style={{ color:P.green }}>Без комиссии</span>
                          : `Комиссия +${fmtAmount(pFee)}`
                        }
                      </p>
                    </div>
                    <ChevronRight size={16} style={{ color:P.t3 }}/>
                  </motion.button>
                );
              })}

              {/* Security badges */}
              <div className="flex items-center justify-center gap-4 pt-3">
                {([[Lock,'SSL'],[Shield,'3D Secure'],[Check,'PCI DSS']] as [IconComponent,string][]).map(([Ico,lbl]) => (
                  <div key={lbl} className="flex items-center gap-1">
                    <Ico size={13} style={{ color:P.t3 }}/>
                    <span className="text-[10px]" style={{ color:P.t3 }}>{lbl}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Step 2: Payment form */}
          {step === 'form' && (
            <motion.div key="form" initial={{ opacity:0, x:12 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0 }}>
              {(provider === 'skypay_card' || provider === 'skypay_intl') && (
                <CardForm
                  intl={provider === 'skypay_intl'}
                  onSubmit={(card) => startPayment(card)}
                />
              )}
              {provider === 'skypay_sbp' && (
                <SbpForm amount={total} onSubmit={() => startPayment()}/>
              )}
              {provider === 'skypay_paypal' && (
                <PayPalForm amount={amount} fee={fee} onSubmit={() => startPayment()}/>
              )}
            </motion.div>
          )}

          {/* Step 3: Status */}
          {step === 'status' && (
            <motion.div key="status" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
              <StatusScreen
                status={status}
                amount={amount}
                sessionId={sessionId}
                onRetry={() => setStep('select')}
                onClose={status === 'confirmed' ? onSuccess : onCancel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

/* -- Pay History ----------------------------------------------- */
export const PayHistory = ({ userId }: { userId: string }) => {
  const { getUserSessions } = usePayGateway();
  const sessions = getUserSessions(userId);

  const STATUS_COLOR: Record<PayStatus, string> = {
    created: P.t3, pending: P.amber, processing: P.accent,
    confirmed: P.green, failed: P.red, refunded: P.amber, expired: P.t3,
  };

  if (sessions.length === 0) return (
    <div className="flex flex-col items-center gap-3 py-10">
      <Clock size={32} style={{ color:P.t3 }}/>
      <p className="text-sm" style={{ color:P.t2 }}>Нет платежей</p>
    </div>
  );

  return (
    <div className="space-y-2 py-2">
      {sessions.slice(0,20).map(s => (
        <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-2xl"
          style={{ background:P.l1, border:`1px solid ${P.border}` }}>
          <div className="grid h-9 w-9 place-items-center rounded-xl flex-shrink-0"
            style={{ background:P.l2 }}>
            {(() => {
              const Ico = PROVIDERS.find(p => p.id === s.provider)?.Icon ?? CreditCard;
              return <Ico size={17} style={{ color:P.t2 }}/>;
            })()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color:P.t1 }}>
              {PURPOSE_LABEL[s.purpose]}
            </p>
            <p className="text-[11px] truncate" style={{ color:P.green }}>переведено с вашего банковского счета</p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color:P.t3 }}>{s.id}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold" style={{ color:P.t1 }}>{fmtAmount(s.amount)}</p>
            <p className="text-[10px]" style={{ color:STATUS_COLOR[s.status] }}>
              {STATUS_LABEL[s.status]}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
};
