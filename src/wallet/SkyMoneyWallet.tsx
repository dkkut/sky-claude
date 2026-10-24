/* ===============================================================
   SKYMONEY  -  UI кошелька
=============================================================== */
import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SkyCodes } from '@/codes/SkyCodes';
import {
  Wallet, Plus, ArrowUpRight, ArrowDownLeft, RotateCcw,
  Crown, ShoppingBag, Music2, ChevronRight, X, Check,
  CreditCard, Smartphone, Building2, Users, Star, ArrowLeftRight,
  Globe, Zap, Landmark, Lock, Gift, Ticket, ScanLine,
} from 'lucide-react';
import {
  useMoney, TX_ICON, TX_LABEL, TX_ICON_FALLBACK, TX_LABEL_FALLBACK,
  fmt, fmtTx, isPoints, type TxType,
} from './store';
import { useAuthStore } from '@/core/auth/store';
import { MyGifts } from '@/gifts/SkyGifts';
import { SkyPayCheckout, PayHistory } from '@/payment/SkyPay';
import { SkyKassa } from '@/skykassa/SkyKassa';
import { ScanQr } from '@/kassabiz/ScanQr';
import { RefundRequest } from './RefundRequest';

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

/* QUICK_AMOUNTS moved to TopUpSheet */

/* -- Toplevel section type --------------------------------------- */
type WView = 'main' | 'topup' | 'checkout' | 'history' | 'pay_history' | 'gifts' | 'exchange' | 'codes' | 'scan' | 'refund';

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
const QuickActions = ({ onTopUp, onHistory, onCodes, onScan, onRefund }: {
  onTopUp: () => void; onHistory: () => void; onCodes: () => void; onScan: () => void; onRefund: () => void;
}) => (
  <div className="grid grid-cols-5 gap-2">
    {[
      { icon:Plus,           label:'Пополнить', onClick:onTopUp,    color:C.accent },
      { icon:RotateCcw,      label:'История',   onClick:onHistory,  color:C.amber  },
      { icon:Ticket,         label:'Sky Codes', onClick:onCodes,    color:'var(--purple)' },
      { icon:ScanLine,       label:'Сканер QR', onClick:onScan,     color:'var(--green)' },
      { icon:ArrowDownLeft,  label:'Возврат',   onClick:onRefund,   color:'var(--red, #e5484d)' },
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
    return !isPoints(t) && t.amount < 0 && days <= 30;
  }).reduce((a, t) => a + Math.abs(t.amount), 0);

  const income30 = txs.filter(t => {
    const days = (Date.now() - new Date(t.createdAt).getTime()) / 86400000;
    return !isPoints(t) && t.amount > 0 && days <= 30;
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
  // Сервер пишет виды операций шире, чем клиент успевает завести здесь
  // (TxType — не рантайм-проверка, а подсказка типов): запасной значок
  // и подпись не дают незнакомому типу уронить весь экран кошелька
  // (см. комментарий у TxType в ./store — именно так падал экран после
  // начисления владельцем через панель администратора).
  const Icon  = TX_ICON[tx.type] ?? TX_ICON_FALLBACK;
  const label = TX_LABEL[tx.type] ?? TX_LABEL_FALLBACK;
  const plus  = tx.amount > 0;
  const d = new Date(tx.createdAt);
  const dateStr = d.toLocaleDateString('ru', { day:'numeric', month:'short' });

  return (
    <div className="flex items-center gap-3 py-3" style={{ borderBottom:`1px solid ${C.border}` }}>
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl"
        style={{ background: plus ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${plus ? 'rgba(52,211,153,0.2)' : C.border}` }}>
        <Icon size={18} style={{ color: plus ? C.green : C.t2 }}/>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color:C.t1 }}>{label}</p>
        <p className="text-xs truncate" style={{ color:C.t3 }}>{tx.desc}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold" style={{ color: plus ? C.green : C.t1 }}>
          {fmtTx(tx)}
        </p>
        <p className="text-[10px]" style={{ color:C.t3 }}>{dateStr}</p>
      </div>
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
  /* Возврат со страницы партнёра: ?skykassa=<платёж> открывает карточку платежа. */
  const kassaParam = (() => { try { return new URLSearchParams(location.search).get('skykassa'); } catch { return null; } })();
  const kassaId = kassaParam && /^[A-Za-z0-9-]{8,80}$/.test(kassaParam) ? kassaParam : null;
  const [view, setView] = useState<WView>(kassaId ? 'topup' : 'main');

  if (!currentUserId) return null;

  const balance = getBalance(currentUserId);
  const points  = getPoints(currentUserId);
  const txs     = getTxs(currentUserId);
  const recent  = txs.slice(0, 5);

  if (view === 'topup') return (
    <div className="flex flex-col h-full overflow-hidden">
      <SkyKassa onClose={() => { setView('main'); void useMoney.getState().refresh(); }}
        initialPaymentId={kassaId}/>
    </div>
  );

  if (view === 'scan') return (
    <div className="flex flex-col h-full overflow-hidden"><ScanQr onClose={() => setView('main')} /></div>
  );

  if (view === 'codes') return (
    <SkyCodes onClose={() => setView('main')} onRedeemed={() => void useMoney.getState().refresh()} />
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
  if (view === 'refund') return <RefundRequest txs={txs} onBack={() => setView('main')}/>;
  if (view === 'history') return <HistoryView txs={txs} onBack={() => setView('main')}/>;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Fixed top: Balance + Actions */}
      <div className="shrink-0 px-4 pt-4 pb-3 space-y-3"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <BalanceCard balance={balance} points={points} userId={currentUserId} onExchange={() => setView('exchange')}/>
        <QuickActions
          onTopUp={() => setView('topup')}
          onHistory={() => setView('history')}
          onCodes={() => setView('codes')}
          onScan={() => setView('scan')}
          onRefund={() => setView('refund')}
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
            { icon:Crown,      color:'var(--amber)', label:'Sky Prime', sub:'Подписка от 399 ₽/мес' },
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
