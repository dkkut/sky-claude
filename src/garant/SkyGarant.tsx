/* ===============================================================
   SKY GARANT  -  Гарант-сервис для безопасных сделок
   Скины · Подарки · NFT · Любые ценности между пользователями
=============================================================== */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Plus, Check, ArrowRight,
  Package, DollarSign, Star, AlertCircle, Crown, Lock,
  ChevronLeft, CheckCircle, XCircle, History,
  Palette, Gift, Gem, Sparkles, Scale, Handshake,
  Clock,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import { create } from 'zustand';

/* === TYPES ================================================== */
export type DealStatus =
  | 'pending_seller'    // ждём товар от продавца
  | 'pending_buyer'     // ждём оплату от покупателя
  | 'in_escrow'         // оба внесли  -  гарант держит
  | 'completed'         // сделка завершена
  | 'cancelled'         // отменена
  | 'disputed';         // спор

export type ItemType = 'skin' | 'gift' | 'nft' | 'currency' | 'item' | 'other';
export type PayType  = 'rubles' | 'points';

export interface GarantDeal {
  id:          string;
  title:       string;
  description: string;
  sellerId:    string;
  sellerName:  string;
  buyerId:     string;
  buyerName:   string;
  itemType:    ItemType;
  itemName:    string;
  price:       number;
  payType:     PayType;
  status:      DealStatus;
  createdAt:   string;
  completedAt?: string;
  sellerDeposited: boolean;  // продавец внёс товар
  buyerDeposited:  boolean;  // покупатель внёс оплату
  sellerConfirmed: boolean;  // продавец подтвердил получение денег
  buyerConfirmed:  boolean;  // покупатель подтвердил получение товара
  comment?:    string;
  // Dispute fields
  disputeReason?:   string;
  disputeOpenedBy?: string;  // userId
  disputeAt?:       string;
  disputeResult?:   'seller_wins' | 'buyer_wins' | 'cancelled';
  disputeNote?:     string;  // admin resolution note
}

interface GarantState {
  deals:          GarantDeal[];
  subscriptions:  Record<string, { until: string }>;  // userId → sub

  create:         (d: Omit<GarantDeal,'id'|'createdAt'|'sellerDeposited'|'buyerDeposited'|'sellerConfirmed'|'buyerConfirmed'|'status'>) => string;
  depositSeller:  (id: string) => void;
  depositBuyer:   (id: string, userId: string) => void;
  confirmBuyer:   (id: string) => void;  // покупатель получил товар
  confirmSeller:  (id: string) => void;  // продавец получил деньги
  cancel:         (id: string) => void;
  openDispute:    (id: string, reason: string, openedBy: string) => void;
  resolveDispute: (id: string, winner: 'seller_wins' | 'buyer_wins' | 'cancelled', note: string) => void;
  adminForceConfirm:(id: string, side: 'buyer' | 'seller') => void;

  getMyDeals:     (userId: string) => GarantDeal[];
  getMonthlyCount:(userId: string) => number;
  hasSubscription:(userId: string) => boolean;
  subscribe:      (userId: string) => void;
}

const SK = 'sky:garant:v1';
const loadDeals = (): GarantDeal[] => { try { return JSON.parse(localStorage.getItem(SK)||'[]'); } catch { return []; } };
const saveDeals = (d: GarantDeal[]) => { try { localStorage.setItem(SK, JSON.stringify(d)); } catch {} };
const SK_SUBS   = 'sky:garant:subs:v1';
const loadSubs  = (): Record<string,{until:string}> => { try { return JSON.parse(localStorage.getItem(SK_SUBS)||'{}'); } catch { return {}; } };
const saveSubs  = (s: Record<string,{until:string}>) => { try { localStorage.setItem(SK_SUBS, JSON.stringify(s)); } catch {} };

export const useGarantStore = create<GarantState>((set, get) => ({
  deals:         loadDeals(),
  subscriptions: loadSubs(),

  create: (params) => {
    const id = `grt-${Date.now()}-${Math.random().toString(36).slice(2,5)}`;
    const deal: GarantDeal = {
      ...params, id, createdAt: new Date().toISOString(),
      sellerDeposited:false, buyerDeposited:false,
      sellerConfirmed:false, buyerConfirmed:false,
      status:'pending_seller',
    };
    const next = [...get().deals, deal];
    saveDeals(next); set({ deals: next });
    return id;
  },

  depositSeller: (id) => {
    const next = get().deals.map(d =>
      d.id===id ? { ...d, sellerDeposited:true, status: d.buyerDeposited?'in_escrow' as const:'pending_buyer' as const } : d
    );
    saveDeals(next); set({ deals: next });
  },

  depositBuyer: (id, _userId) => {
    const next = get().deals.map(d =>
      d.id===id ? { ...d, buyerDeposited:true, status: d.sellerDeposited?'in_escrow' as const:'pending_seller' as const } : d
    );
    saveDeals(next); set({ deals: next });
  },

  confirmBuyer: (id) => {
    const d = get().deals.find(x=>x.id===id);
    if (!d) return;
    const sellerAlso = d.sellerConfirmed;
    const next = get().deals.map(x =>
      x.id===id ? { ...x, buyerConfirmed:true,
        status: sellerAlso ? 'completed' as const : x.status,
        completedAt: sellerAlso ? new Date().toISOString() : undefined,
      } : x
    );
    saveDeals(next); set({ deals: next });
  },

  confirmSeller: (id) => {
    const d = get().deals.find(x=>x.id===id);
    if (!d) return;
    const buyerAlso = d.buyerConfirmed;
    const next = get().deals.map(x =>
      x.id===id ? { ...x, sellerConfirmed:true,
        status: buyerAlso ? 'completed' as const : x.status,
        completedAt: buyerAlso ? new Date().toISOString() : undefined,
      } : x
    );
    saveDeals(next); set({ deals: next });
  },

  cancel: (id) => {
    const next = get().deals.map(d => d.id===id ? {...d, status:'cancelled' as const} : d);
    saveDeals(next); set({ deals: next });
  },
  openDispute: (id, reason, openedBy) => {
    const next = get().deals.map(d => d.id===id ? {
      ...d, status:'disputed' as const,
      disputeReason:reason, disputeOpenedBy:openedBy, disputeAt:new Date().toISOString()
    } : d);
    saveDeals(next); set({ deals: next });
  },
  resolveDispute: (id, winner, note) => {
    const d = get().deals.find(x => x.id===id);
    if (!d) return;
    // Force-complete based on winner
    const next = get().deals.map(x => x.id===id ? {
      ...x,
      status: 'completed' as const,
      completedAt: new Date().toISOString(),
      disputeResult: winner,
      disputeNote: note,
      buyerConfirmed:  true,
      sellerConfirmed: true,
    } : x);
    saveDeals(next); set({ deals: next });
  },
  adminForceConfirm: (id, side) => {
    const d = get().deals.find(x => x.id===id);
    if (!d) return;
    const buyerAlso  = side==='buyer'  ? true : d.buyerConfirmed;
    const sellerAlso = side==='seller' ? true : d.sellerConfirmed;
    const completed  = buyerAlso && sellerAlso;
    const next = get().deals.map(x => x.id===id ? {
      ...x,
      buyerConfirmed:  buyerAlso,
      sellerConfirmed: sellerAlso,
      status: completed ? 'completed' as const : x.status,
      completedAt: completed ? new Date().toISOString() : undefined,
    } : x);
    saveDeals(next); set({ deals: next });
  },

  getMyDeals: (uid) => get().deals.filter(d => d.sellerId===uid || d.buyerId===uid)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt)),

  getMonthlyCount: (uid) => {
    const month = new Date().toISOString().slice(0,7);
    return get().deals.filter(d => d.sellerId===uid && d.createdAt.startsWith(month)).length;
  },

  hasSubscription: (uid) => {
    const sub = get().subscriptions[uid];
    return !!sub && new Date(sub.until) > new Date();
  },

  subscribe: (uid) => {
    const until = new Date(Date.now() + 30*86400000).toISOString();
    const next  = { ...get().subscriptions, [uid]: { until } };
    saveSubs(next); set({ subscriptions: next });
  },
}));

/* === CONSTANTS ============================================== */
const STATUS_INFO: Record<DealStatus, { label:string; color:string; icon:any; desc:string }> = {
  pending_seller: { label:'Ждём товар',    color:'var(--amber)', icon:Package,     desc:'Продавец должен передать товар гаранту' },
  pending_buyer:  { label:'Ждём оплату',   color:'var(--amber)', icon:DollarSign,  desc:'Покупатель должен внести оплату' },
  in_escrow:      { label:'У гаранта',     color:'var(--accent)', icon:Lock,        desc:'Оба внесли  -  гарант держит до подтверждений' },
  completed:      { label:'Завершена',     color:'var(--green)', icon:CheckCircle, desc:'Сделка успешно завершена' },
  cancelled:      { label:'Отменена',      color:'var(--t2)', icon:XCircle,     desc:'Сделка была отменена' },
  disputed:       { label:'Спор',          color:'var(--red)', icon:AlertCircle, desc:'Открыт спор  -  ожидайте решения администратора' },
};

/* Значок вида товара — из общего набора. Раньше у сделки было ещё и
   своё поле с эмодзи, которое продавец вписывал руками: два источника
   одной картинки, причём второй ничего не сообщал о товаре. Остался
   один — вид сделки. */
const ITEM_TYPES: { key:ItemType; label:string; Icon:typeof Package }[] = [
  { key:'skin',     label:'Скин',          Icon:Palette },
  { key:'gift',     label:'Подарок Sky',   Icon:Gift },
  { key:'nft',      label:'NFT',           Icon:Gem },
  { key:'currency', label:'Валюта/Баллы',  Icon:Star },
  { key:'item',     label:'Предмет',       Icon:Package },
  { key:'other',    label:'Другое',        Icon:Sparkles },
];

const C = {
  bg:'#09090f', l1:'#111118', l2:'#17171f', l3:'#1e1e28',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
  gold:'var(--amber)',
};

const fmtDate = (iso:string) => new Date(iso).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

/* === DEAL CARD ============================================== */
const DealCard = ({ deal, myId, onOpen }: { deal:GarantDeal; myId:string; onOpen:()=>void }) => {
  const si    = STATUS_INFO[deal.status];
  const isSeller = deal.sellerId === myId;
  const role  = isSeller ? 'Продавец' : 'Покупатель';

  return (
    <motion.button type="button" whileTap={{ scale:.98 }} onClick={onOpen}
      className="w-full rounded-2xl overflow-hidden text-left"
      style={{ background:C.l1, border:`1.5px solid ${deal.status==='in_escrow'?C.accent+'40':deal.status==='completed'?C.green+'30':C.border}` }}>
      {/* Status stripe */}
      <div className="h-0.5 w-full" style={{ background:si.color }}/>
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          {/* Значок вида товара */}
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl"
            style={{ background:`${si.color}12` }}>
            {(() => { const I = ITEM_TYPES.find(t=>t.key===deal.itemType)?.Icon ?? Package;
              return <I size={22} style={{ color:si.color }}/>; })()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-1">
              <p className="text-sm font-bold text-white leading-tight">{deal.title}</p>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-1"
                style={{ background:`${si.color}15`, color:si.color }}>
                {si.label}
              </span>
            </div>
            <p className="text-xs mt-0.5 truncate" style={{ color:C.t3 }}>{deal.itemName}</p>
            <p className="text-[10px] mt-1" style={{ color:C.t3 }}>
              Вы: <span style={{ color:C.t2 }}>{role}</span> ·{' '}
              {isSeller ? deal.buyerName : deal.sellerName}
            </p>
          </div>
        </div>
        {/* Price + progress */}
        <div className="flex items-center justify-between">
          <span className="text-base font-black" style={{ color:C.amber }}>
            {deal.payType==='rubles' ? `${deal.price.toLocaleString('ru')} ₽` : `${deal.price.toLocaleString('ru')}`}
          </span>
          {/* Deposit progress */}
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full" style={{ background:deal.sellerDeposited?C.green:C.border }}/>
              <span className="text-[9px]" style={{ color:C.t3 }}>Товар</span>
            </div>
            <ArrowRight size={10} style={{ color:C.t3 }}/>
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full" style={{ background:deal.buyerDeposited?C.green:C.border }}/>
              <span className="text-[9px]" style={{ color:C.t3 }}>Оплата</span>
            </div>
          </div>
        </div>
        <p className="text-[10px] mt-1.5" style={{ color:C.t3 }}>{fmtDate(deal.createdAt)}</p>
      </div>
    </motion.button>
  );
};

/* --- DisputeButton with reason input ---------------------- */
const DisputeButton = ({ dealId, myId }: { dealId:string; myId:string }) => {
  const { openDispute } = useGarantStore();
  const [open,   setOpen]   = useState(false);
  const [reason, setReason] = useState('');
  const [err,    setErr]    = useState('');

  const submit = () => {
    if (!reason.trim()) { setErr('Опишите причину спора'); return; }
    openDispute(dealId, reason.trim(), myId);
    setOpen(false);
  };

  if (!open) return (
    <button type="button" onClick={()=>setOpen(true)}
      className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-xs font-semibold"
      style={{ background:`rgba(248,113,113,0.08)`, color:'var(--red)', border:`1px solid rgba(248,113,113,0.18)` }}>
      <AlertCircle size={13}/>Открыть денежный спор
    </button>
  );

  return (
    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}}
      className="rounded-2xl p-4 space-y-3"
      style={{background:'rgba(248,113,113,0.06)',border:'1.5px solid rgba(248,113,113,0.25)'}}>
      <div className="flex items-center gap-2">
        <AlertCircle size={15} style={{color:'var(--red)'}}/>
        <p className="text-sm font-bold" style={{color:'var(--red)'}}>Открыть денежный спор</p>
      </div>
      <p className="text-[11px] leading-relaxed" style={{color:'rgba(255,255,255,0.5)'}}>
        Администратор Sky рассмотрит ситуацию и примет решение  -  кому зачислить средства и товар. Злоупотребление спорами ведёт к блокировке.
      </p>
      <div className="space-y-2">
        <textarea value={reason} onChange={e=>{setReason(e.target.value);setErr('');}} rows={3}
          placeholder="Опишите ситуацию: что пошло не так, есть ли доказательства..."
          className="w-full rounded-xl px-3 py-2.5 text-xs outline-none resize-none"
          style={{background:'rgba(0,0,0,0.3)',border:'1px solid rgba(248,113,113,0.25)',color:'var(--t1)'}}/>
        {err && <p className="text-[10px]" style={{color:'var(--red)'}}>{err}</p>}
        <div className="flex gap-2">
          <motion.button whileTap={{scale:.96}} type="button" onClick={submit}
            className="flex-1 rounded-xl py-2.5 text-xs font-bold"
            style={{background:'rgba(248,113,113,0.15)',color:'var(--red)',border:'1px solid rgba(248,113,113,0.3)'}}>
            Подать спор
          </motion.button>
          <button type="button" onClick={()=>setOpen(false)}
            className="rounded-xl px-4 py-2.5 text-xs"
            style={{background:'rgba(255,255,255,0.05)',color:'rgba(255,255,255,0.4)'}}>
            Отмена
          </button>
        </div>
      </div>
    </motion.div>
  );
};

/* === DEAL DETAIL ============================================ */
const DealDetail = ({ deal, myId, onBack }: { deal:GarantDeal; myId:string; onBack:()=>void }) => {
  const { depositSeller, depositBuyer, confirmBuyer, confirmSeller, cancel, openDispute } = useGarantStore();
  const { spend, getBalance } = useMoney();
  const si = STATUS_INFO[deal.status];
  const Icon = si.icon;
  const isSeller  = deal.sellerId === myId;
  const isBuyer   = deal.buyerId  === myId;
  const balance   = getBalance(myId);

  const handleBuyerDeposit = () => {
    if (deal.payType==='rubles') {
      if (balance < deal.price) return;
      spend(myId, deal.price, 'market', `Гарант: ${deal.title}`);
    }
    depositBuyer(deal.id, myId);
  };

  const steps = [
    { label:'Продавец вносит товар', done:deal.sellerDeposited, active:!deal.sellerDeposited&&deal.status!=='cancelled' },
    { label:'Покупатель вносит оплату', done:deal.buyerDeposited, active:deal.sellerDeposited&&!deal.buyerDeposited },
    { label:'Гарант проверяет', done:deal.status==='in_escrow'||deal.status==='completed', active:deal.sellerDeposited&&deal.buyerDeposited&&deal.status==='in_escrow' },
    { label:'Обе стороны подтверждают', done:deal.status==='completed', active:deal.status==='in_escrow' },
  ];

  return (
    <motion.div initial={{ opacity:0, x:24 }} animate={{ opacity:1, x:0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ background:C.bg, scrollbarWidth:'none' }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={18} style={{ color:C.t2 }}/>
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">{deal.title}</p>
          <p className="text-[10px]" style={{ color:C.t3 }}>#{deal.id.slice(-8)}</p>
        </div>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
          style={{ background:`${si.color}15`, color:si.color }}>{si.label}</span>
      </div>

      <div className="px-4 py-4 space-y-4">

        {/* Status banner */}
        <motion.div initial={{ scale:.95 }} animate={{ scale:1 }}
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background:`${si.color}10`, border:`1.5px solid ${si.color}30` }}>
          <Icon size={22} style={{ color:si.color }}/>
          <div>
            <p className="text-sm font-bold" style={{ color:si.color }}>{si.label}</p>
            <p className="text-xs mt-0.5" style={{ color:`${si.color}99` }}>{si.desc}</p>
          </div>
        </motion.div>

        {/* Item card */}
        <div className="rounded-2xl p-4" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-14 w-14 place-items-center rounded-2xl shrink-0"
              style={{ background:C.l2 }}>
              {(() => { const I = ITEM_TYPES.find(t=>t.key===deal.itemType)?.Icon ?? Package;
                return <I size={26} style={{ color:C.accent }}/>; })()}
            </div>
            <div>
              <p className="text-base font-black text-white">{deal.itemName}</p>
              <p className="text-xs" style={{ color:C.t3 }}>
                {ITEM_TYPES.find(t=>t.key===deal.itemType)?.label} · {deal.description}
              </p>
            </div>
          </div>
          {/* Parties */}
          <div className="grid grid-cols-3 gap-2 items-center">
            <div className="rounded-xl p-2.5 text-center" style={{ background:C.l2 }}>
              <p className="text-[9px] font-bold uppercase" style={{ color:C.t3 }}>Продавец</p>
              <p className="text-xs font-bold text-white mt-0.5">{deal.sellerName}</p>
            </div>
            <div className="flex justify-center">
              <motion.div animate={{ x:[-3,3,-3] }} transition={{ duration:1.5, repeat:Infinity }}>
                <ArrowRight size={18} style={{ color:C.accent }}/>
              </motion.div>
            </div>
            <div className="rounded-xl p-2.5 text-center" style={{ background:C.l2 }}>
              <p className="text-[9px] font-bold uppercase" style={{ color:C.t3 }}>Покупатель</p>
              <p className="text-xs font-bold text-white mt-0.5">{deal.buyerName}</p>
            </div>
          </div>
          {/* Price */}
          <div className="mt-3 pt-3 flex items-center justify-between"
            style={{ borderTop:`1px solid ${C.border}` }}>
            <span className="text-xs" style={{ color:C.t3 }}>Стоимость сделки</span>
            <span className="text-xl font-black" style={{ color:C.amber }}>
              {deal.payType==='rubles' ? `${deal.price.toLocaleString('ru')} ₽` : `${deal.price.toLocaleString('ru')}`}
            </span>
          </div>
        </div>

        {/* Steps */}
        <div className="rounded-2xl p-4" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
          <p className="text-xs font-bold mb-3" style={{ color:C.t3 }}>Ход сделки</p>
          <div className="space-y-3">
            {steps.map((s,i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="grid h-6 w-6 place-items-center rounded-full shrink-0"
                  style={{ background:s.done?C.green:s.active?C.accent+'30':C.l2,
                    border:`1.5px solid ${s.done?C.green:s.active?C.accent:C.border}` }}>
                  {s.done
                    ? <Check size={12} style={{ color:'white' }}/>
                    : <span className="text-[10px] font-bold" style={{ color:s.active?C.accent:C.t3 }}>{i+1}</span>
                  }
                </div>
                <p className="text-xs font-medium"
                  style={{ color:s.done?C.t1:s.active?C.accent:C.t3 }}>
                  {s.label}
                </p>
                {s.active && (
                  <motion.div className="w-1.5 h-1.5 rounded-full ml-auto shrink-0"
                    style={{ background:C.accent }}
                    animate={{ opacity:[1,0.2,1] }} transition={{ duration:1.2, repeat:Infinity }}/>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Confirmations (in_escrow) */}
        {deal.status === 'in_escrow' && (
          <div className="rounded-2xl p-4" style={{ background:`${C.accent}08`, border:`1px solid ${C.accent}25` }}>
            <p className="text-xs font-bold mb-2" style={{ color:C.accent }}>Подтверждения получения</p>
            <div className="flex gap-3">
              <div className="flex items-center gap-1.5 flex-1">
                <div className="h-4 w-4 rounded-full" style={{ background:deal.buyerConfirmed?C.green:C.l3, border:`1.5px solid ${deal.buyerConfirmed?C.green:C.border}` }}>
                  {deal.buyerConfirmed&&<Check size={10} className="m-auto text-white"/>}
                </div>
                <span className="text-[10px]" style={{ color:deal.buyerConfirmed?C.green:C.t3 }}>Покупатель</span>
              </div>
              <div className="flex items-center gap-1.5 flex-1">
                <div className="h-4 w-4 rounded-full" style={{ background:deal.sellerConfirmed?C.green:C.l3, border:`1.5px solid ${deal.sellerConfirmed?C.green:C.border}` }}>
                  {deal.sellerConfirmed&&<Check size={10} className="m-auto text-white"/>}
                </div>
                <span className="text-[10px]" style={{ color:deal.sellerConfirmed?C.green:C.t3 }}>Продавец</span>
              </div>
            </div>
          </div>
        )}

        {/* Completed */}
        {deal.status === 'completed' && (
          <div className="rounded-2xl p-4 text-center"
            style={{ background:`${C.green}08`, border:`1px solid ${C.green}25` }}>
            <CheckCircle size={30} className="mx-auto mb-2" style={{ color:C.green }}/>
            <p className="text-sm font-bold" style={{ color:C.green }}>Сделка завершена!</p>
            {deal.completedAt && <p className="text-[10px] mt-1" style={{ color:C.t3 }}>{fmtDate(deal.completedAt)}</p>}
          </div>
        )}

        {/* Action buttons */}
        <div className="space-y-2.5">
          {/* Seller: deposit item */}
          {isSeller && !deal.sellerDeposited && deal.status!=='cancelled' && (
            <motion.button whileTap={{ scale:.97 }} type="button"
              onClick={() => depositSeller(deal.id)}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 6px 24px ${C.accent}35` }}>
              <Package size={16}/>Передать товар гаранту
            </motion.button>
          )}

          {/* Buyer: deposit payment */}
          {isBuyer && deal.sellerDeposited && !deal.buyerDeposited && deal.status!=='cancelled' && (
            <>
              {deal.payType==='rubles' && balance < deal.price && (
                <p className="text-xs text-center" style={{ color:C.red }}>
                  Недостаточно средств. Нужно {deal.price.toLocaleString('ru')} ₽, у вас {balance.toLocaleString('ru')} ₽
                </p>
              )}
              <motion.button whileTap={{ scale:.97 }} type="button"
                onClick={handleBuyerDeposit}
                disabled={deal.payType==='rubles' && balance < deal.price}
                className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-40"
                style={{ background:`linear-gradient(135deg,${C.amber},#d97706)`, boxShadow:`0 6px 24px ${C.amber}35` }}>
                <DollarSign size={16}/>
                Внести {deal.payType==='rubles'?`${deal.price.toLocaleString('ru')} ₽`:`${deal.price.toLocaleString('ru')}`}
              </motion.button>
            </>
          )}

          {/* In escrow confirmations */}
          {deal.status === 'in_escrow' && (
            <>
              {isBuyer && !deal.buyerConfirmed && (
                <motion.button whileTap={{ scale:.97 }} type="button"
                  onClick={() => confirmBuyer(deal.id)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white"
                  style={{ background:`linear-gradient(135deg,${C.green},#059669)`, boxShadow:`0 6px 24px ${C.green}35` }}>
                  <CheckCircle size={16}/>Подтверждаю  -  получил товар
                </motion.button>
              )}
              {isSeller && !deal.sellerConfirmed && (
                <motion.button whileTap={{ scale:.97 }} type="button"
                  onClick={() => confirmSeller(deal.id)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-bold text-white"
                  style={{ background:`linear-gradient(135deg,${C.green},#059669)`, boxShadow:`0 6px 24px ${C.green}35` }}>
                  <CheckCircle size={16}/>Подтверждаю  -  получил оплату
                </motion.button>
              )}
              <DisputeButton dealId={deal.id} myId={myId}/>
            </>
          )}

          {/* Cancel (early stages) */}
          {['pending_seller','pending_buyer'].includes(deal.status) && (
            <button type="button" onClick={() => cancel(deal.id)}
              className="w-full rounded-xl py-3 text-xs font-semibold"
              style={{ background:`${C.red}08`, color:C.red, border:`1px solid ${C.red}15` }}>
              Отменить сделку
            </button>
          )}

          {/* Dispute info when already disputed */}
          {deal.status === 'disputed' && (
            <div className="rounded-2xl p-4 space-y-2"
              style={{ background:`${C.red}08`, border:`1px solid ${C.red}20` }}>
              <div className="flex items-center gap-2">
                <AlertCircle size={15} style={{ color:C.red }}/>
                <p className="text-sm font-bold" style={{ color:C.red }}>Спор открыт</p>
              </div>
              {deal.disputeReason && (
                <p className="text-xs leading-relaxed" style={{ color:C.t2 }}>
                  «{deal.disputeReason}»
                </p>
              )}
              {deal.disputeAt && (
                <p className="text-[10px]" style={{ color:C.t3 }}>
                  {new Date(deal.disputeAt).toLocaleString('ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                </p>
              )}
              <div className="rounded-xl px-3 py-2.5 mt-1"
                style={{ background:'rgba(255,255,255,0.04)' }}>
                <p className="flex items-start gap-1.5 text-[11px]" style={{ color:C.t2 }}>
                  <Clock size={11} className="shrink-0 mt-0.5"/>
                  Администратор рассматривает спор. Решение будет принято в течение 24-72 часов.
                </p>
              </div>
            </div>
          )}

          {/* Dispute result */}
          {deal.disputeResult && (
            <div className="rounded-2xl p-4"
              style={{ background:deal.disputeResult==='cancelled'?`${C.t3}08`:(
                (deal.disputeResult==='seller_wins' && isSeller)||(deal.disputeResult==='buyer_wins' && isBuyer)
                  ? `${C.green}08` : `${C.red}08`),
                border:`1px solid ${deal.disputeResult==='cancelled'?C.t3:(
                  (deal.disputeResult==='seller_wins' && isSeller)||(deal.disputeResult==='buyer_wins' && isBuyer)
                    ? C.green : C.red)}20` }}>
              <p className="text-sm font-bold" style={{ color:
                deal.disputeResult==='cancelled'?C.t2:(
                  (deal.disputeResult==='seller_wins' && isSeller)||(deal.disputeResult==='buyer_wins' && isBuyer)
                    ? C.green : C.red) }}>
                {deal.disputeResult==='cancelled' ? 'Сделка отменена администратором' :
                 deal.disputeResult==='seller_wins' ? (isSeller?'Спор решён в вашу пользу':'Спор решён в пользу продавца') :
                 (isBuyer?'Спор решён в вашу пользу':'Спор решён в пользу покупателя')}
              </p>
              {deal.disputeNote && (
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color:C.t2 }}>
                  Решение администратора: «{deal.disputeNote}»
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* === CREATE DEAL FORM ======================================= */
const CreateDeal = ({ onDone }: { onDone:(id?:string)=>void }) => {
  const { accounts, currentUserId } = useAuthStore();
  const { create, getMonthlyCount, hasSubscription } = useGarantStore();
  const me = accounts.find(a=>a.id===currentUserId);

  const [step,      setStep]      = useState<'type'|'details'|'party'|'confirm'>('type');
  const [itemType,  setItemType]  = useState<ItemType>('skin');
  const [itemName,  setItemName]  = useState('');
  const [desc,      setDesc]      = useState('');
  const [price,     setPrice]     = useState('');
  const [payType,   setPayType]   = useState<PayType>('rubles');
  const [buyerUser, setBuyerUser] = useState('');
  const [err,       setErr]       = useState('');
  const [done,      setDone]      = useState<string|null>(null);

  const monthly   = getMonthlyCount(currentUserId??'');
  const hasSub    = hasSubscription(currentUserId??'');
  const canCreate = hasSub || monthly < 3;

  const buyerAcc = accounts.find(a => a.username.toLowerCase()===buyerUser.toLowerCase().replace('@','') && a.id!==currentUserId);

  const STEPS = ['type','details','party','confirm'];
  const stepIdx = STEPS.indexOf(step);

  if (done) return (
    <div className="flex flex-col items-center gap-5 py-10 px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }}
        transition={{ type:'spring', stiffness:400, damping:18 }}
        className="grid h-20 w-20 place-items-center rounded-full text-4xl"
        style={{ background:`${C.accent}15`, border:`2px solid ${C.accent}40` }}><Shield size={26} style={{ color:C.accent }}/></motion.div>
      <div className="text-center">
        <p className="text-xl font-black text-white">Сделка создана!</p>
        <p className="text-sm mt-1.5" style={{ color:C.t2 }}>
          Передайте товар гаранту чтобы начать обмен.
        </p>
        <p className="text-[11px] mt-1 font-mono" style={{ color:C.t3 }}>ID: #{done.slice(-8)}</p>
      </div>
      <button type="button" onClick={() => onDone(done)}
        className="rounded-2xl px-8 py-3 text-sm font-bold text-white"
        style={{ background:C.accent }}>К сделке →</button>
    </div>
  );

  const handleCreate = () => {
    setErr('');
    if (!itemName.trim()) { setErr('Укажите название товара'); return; }
    if (!price || isNaN(+price) || +price<=0) { setErr('Укажите корректную цену'); return; }
    if (!buyerAcc) { setErr('Покупатель не найден'); return; }
    const id = create({
      title:`${ITEM_TYPES.find(t=>t.key===itemType)?.label}: ${itemName.trim()}`,
      description:desc.trim(),
      sellerId:currentUserId??'', sellerName:me?.name??'',
      buyerId:buyerAcc.id, buyerName:buyerAcc.name,
      itemType, itemName:itemName.trim(),
      price:+price, payType,
      comment:desc.trim(),
    });
    setDone(id);
  };

  const iSty = { background:C.l2, border:`1px solid ${C.border}`, color:C.t1 };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      <div className="flex items-center gap-2 px-4 py-3.5 border-b shrink-0"
        style={{ borderColor:C.border }}>
        <button type="button" onClick={()=>step==='type'?onDone():setStep(STEPS[stepIdx-1] as any)}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={16} style={{ color:C.t2 }}/></button>
        <p className="text-sm font-bold text-white">Новая сделка</p>
        {/* Progress */}
        <div className="flex gap-1 ml-auto">
          {STEPS.map((_,i) => (
            <div key={i} className="rounded-full transition-all"
              style={{ width:i===stepIdx?16:6, height:6,
                background:i<=stepIdx?C.accent:C.l3 }}/>
          ))}
        </div>
      </div>

      {!canCreate && (
        <div className="mx-4 mt-3 rounded-2xl p-4" style={{ background:`${C.amber}08`, border:`1px solid ${C.amber}25` }}>
          <p className="inline-flex items-center gap-1 text-xs font-bold" style={{ color:C.amber }}><AlertCircle size={12}/>Лимит использован</p>
          <p className="text-[11px] mt-0.5" style={{ color:C.t3 }}>Бесплатно  -  3 сделки в месяц. Использовано: {monthly}/3. Подключите подписку для безлимита.</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ scrollbarWidth:'none' }}>

        {/* STEP 1: Type */}
        {step==='type'&&(
          <>
            <p className="text-sm font-bold text-white">Что продаёте?</p>
            <div className="grid grid-cols-2 gap-2.5">
              {ITEM_TYPES.map(t=>(
                <button key={t.key} type="button"
                  onClick={()=>setItemType(t.key)}
                  className="flex items-center gap-3 rounded-2xl p-4 transition-all"
                  style={{ background:itemType===t.key?`${C.accent}15`:C.l1,
                    border:`1.5px solid ${itemType===t.key?C.accent:C.border}` }}>
                  <t.Icon size={20} style={{ color:itemType===t.key?C.accent:C.t3 }}/>
                  <span className="text-sm font-semibold" style={{ color:itemType===t.key?C.t1:C.t2 }}>{t.label}</span>
                  {itemType===t.key&&<Check size={14} style={{ color:C.accent, marginLeft:'auto' }}/>}
                </button>
              ))}
            </div>
            <motion.button whileTap={{ scale:.97 }} type="button"
              disabled={!canCreate} onClick={()=>setStep('details')}
              className="w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
              Далее →
            </motion.button>
          </>
        )}

        {/* STEP 2: Details */}
        {step==='details'&&(
          <>
            <p className="text-sm font-bold text-white">Детали товара</p>
            <input value={itemName} onChange={e=>setItemName(e.target.value)}
              placeholder="Название товара *"
              className="w-full rounded-xl px-3 py-3 text-sm outline-none" style={iSty}/>
            <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3}
              placeholder="Описание (необязательно)..."
              className="w-full rounded-xl px-3 py-3 text-sm outline-none resize-none" style={iSty}/>
            {/* Price */}
            <div>
              <p className="text-xs font-bold mb-2" style={{ color:C.t3 }}>Цена</p>
              <div className="flex gap-2 mb-2">
                {(['rubles','points'] as const).map(p=>(
                  <button key={p} type="button" onClick={()=>setPayType(p)}
                    className="flex-1 rounded-xl py-2.5 text-xs font-bold transition-all"
                    style={{ background:payType===p?`${C.amber}15`:C.l2,
                      border:`1.5px solid ${payType===p?C.amber:C.border}`,
                      color:payType===p?C.amber:C.t3 }}>
                    {p==='rubles'?'Рубли':'Баллы'}
                  </button>
                ))}
              </div>
              <input value={price} onChange={e=>setPrice(e.target.value)} type="number" min="1"
                placeholder={payType==='rubles'?'Сумма в рублях':'Количество баллов'}
                className="w-full rounded-xl px-3 py-3 text-sm outline-none" style={iSty}/>
            </div>
            <motion.button whileTap={{ scale:.97 }} type="button"
              disabled={!itemName.trim()||!price}
              onClick={()=>setStep('party')}
              className="w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
              Далее →
            </motion.button>
          </>
        )}

        {/* STEP 3: Party */}
        {step==='party'&&(
          <>
            <p className="text-sm font-bold text-white">Укажите покупателя</p>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color:C.t3 }}>
                Никнейм покупателя
              </label>
              <input value={buyerUser} onChange={e=>setBuyerUser(e.target.value)}
                placeholder="@username или username"
                className="w-full rounded-xl px-3 py-3 text-sm outline-none" style={iSty}/>
              {buyerUser && (
                <div className="mt-2">
                  {buyerAcc ? (
                    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                      style={{ background:`${C.green}10`, border:`1px solid ${C.green}25` }}>
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                        style={{ background:C.accent }}>{buyerAcc.name[0]}</div>
                      <div>
                        <p className="text-sm font-bold text-white">{buyerAcc.name}</p>
                        <p className="inline-flex items-center gap-1 text-[10px]" style={{ color:C.green }}><Check size={10}/>Найден</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color:C.red }}>Пользователь не найден</p>
                  )}
                </div>
              )}
            </div>
            {err&&<p className="text-xs" style={{ color:C.red }}>{err}</p>}
            <motion.button whileTap={{ scale:.97 }} type="button"
              disabled={!buyerAcc}
              onClick={()=>{ if(buyerAcc) setStep('confirm'); else setErr('Пользователь не найден'); }}
              className="w-full rounded-2xl py-4 text-sm font-bold text-white disabled:opacity-35"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
              Далее →
            </motion.button>
          </>
        )}

        {/* STEP 4: Confirm */}
        {step==='confirm'&&(
          <>
            <p className="text-sm font-bold text-white">Подтвердите сделку</p>
            {/* Summary card */}
            <div className="rounded-2xl overflow-hidden"
              style={{ background:`linear-gradient(135deg,${C.accent}12,${C.l1})`, border:`1px solid ${C.accent}25` }}>
              <div className="p-4 flex items-center gap-3">
                {(() => { const I = ITEM_TYPES.find(t=>t.key===itemType)?.Icon ?? Package;
                  return <I size={34} style={{ color:C.accent }}/>; })()}
                <div>
                  <p className="text-base font-black text-white">{itemName}</p>
                  <p className="text-xs" style={{ color:C.t3 }}>{ITEM_TYPES.find(t=>t.key===itemType)?.label}</p>
                </div>
              </div>
              <div className="px-4 pb-4 space-y-2 border-t" style={{ borderColor:C.border }}>
                {[
                  { l:'Продавец', v:me?.name??'' },
                  { l:'Покупатель', v:buyerAcc?.name??'' },
                  { l:'Стоимость', v:payType==='rubles'?`${(+price).toLocaleString('ru')} ₽`:`${(+price).toLocaleString('ru')}` },
                ].map(({l,v})=>(
                  <div key={l} className="flex justify-between text-sm pt-2">
                    <span style={{ color:C.t3 }}>{l}</span>
                    <span className="font-semibold text-white">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl px-4 py-3" style={{ background:`${C.accent}06`, border:`1px solid ${C.accent}15` }}>
              <p className="text-[11px] leading-relaxed" style={{ color:C.t2 }}>
                Sky Garant держит товар и оплату до тех пор, пока обе стороны не подтвердят получение. Это защищает обоих участников.
              </p>
            </div>

            {err&&<p className="text-xs text-center" style={{ color:C.red }}>{err}</p>}
            <motion.button whileTap={{ scale:.97 }} type="button" onClick={handleCreate}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-black text-white"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 8px 32px ${C.accent}40` }}>
              <Shield size={18}/>Создать сделку
            </motion.button>
          </>
        )}
      </div>
    </div>
  );
};

/* === SUBSCRIPTION MODAL ==================================== */
const SubModal = ({ onClose }: { onClose:()=>void }) => {
  const { currentUserId } = useAuthStore();
  const { subscribe } = useGarantStore();
  const { spend, getBalance } = useMoney();
  const [done, setDone] = useState(false);

  const price = 159;
  const balance = getBalance(currentUserId??'');

  const buy = () => {
    if (balance < price) return;
    spend(currentUserId!, price, 'market', 'Sky Garant  -  подписка');
    subscribe(currentUserId!);
    setDone(true);
  };

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      className="fixed inset-0 z-[400] flex items-end justify-center"
      style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(12px)' }}
      onClick={onClose}>
      <motion.div initial={{ y:60 }} animate={{ y:0 }} exit={{ y:60 }}
        transition={{ type:'spring', damping:28, stiffness:300 }}
        className="max-h-[85vh] w-full max-w-md overflow-y-auto overflow-x-hidden"
        style={{ background:'#0f0f18', borderRadius:'28px 28px 0 0' }}
        onClick={e=>e.stopPropagation()}>
        {done ? (
          <div className="flex flex-col items-center gap-4 py-10 px-6">
            <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring', stiffness:400, damping:18 }}
              ><Shield size={46} style={{ color:C.accent }}/></motion.div>
            <p className="text-xl font-black text-white">Подписка активирована!</p>
            <p className="text-sm" style={{ color:C.t2 }}>Безлимитные сделки на месяц</p>
            <button type="button" onClick={onClose}
              className="rounded-2xl px-8 py-3 text-sm font-bold text-white" style={{ background:C.accent }}>
              Готово
            </button>
          </div>
        ):(
          <div className="px-6 pt-6 pb-8 space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl text-2xl"
                style={{ background:`${C.accent}15` }}><Shield size={22} style={{ color:C.accent }}/></div>
              <div>
                <p className="text-lg font-black text-white">Sky Garant Pro</p>
                <p className="text-xs" style={{ color:C.t3 }}>Безлимитные сделки в месяц</p>
              </div>
              <span className="ml-auto text-2xl font-black" style={{ color:C.amber }}>159 ₽</span>
            </div>
            {[
              'Безлимитные сделки в месяц',
              'Приоритетная поддержка при спорах',
              'Расширенная история сделок',
              'Уведомления о статусе сделок',
            ].map(f=>(
              <div key={f} className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ background:`${C.green}20` }}><Check size={10} style={{ color:C.green }}/></div>
                <span className="text-sm" style={{ color:C.t1 }}>{f}</span>
              </div>
            ))}
            <p className="text-[10px] text-center" style={{ color:C.t3 }}>
              Баланс: {balance.toLocaleString('ru')} ₽ · {balance<price?`Нужно ещё ${price-balance} ₽`:'Достаточно'}
            </p>
            <motion.button whileTap={{ scale:.97 }} type="button" onClick={buy}
              disabled={balance<price}
              className="w-full rounded-2xl py-4 text-base font-black text-white disabled:opacity-35"
              style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)`, boxShadow:`0 8px 32px ${C.accent}40` }}>
              Подключить за 159 ₽/мес
            </motion.button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

/* === MAIN SKYGARANT ======================================== */
export const SkyGarant = () => {
  const { currentUserId, accounts } = useAuthStore();
  const { getMyDeals, getMonthlyCount, hasSubscription } = useGarantStore();

  const [view,    setView]    = useState<'main'|'create'|'deal'>('main');
  const [detail,  setDetail]  = useState<GarantDeal|null>(null);
  const [showSub, setShowSub] = useState(false);
  const [histTab, setHistTab] = useState<'active'|'history'|'disputes'>('active');

  const myId    = currentUserId ?? '';
  const deals   = getMyDeals(myId);
  const monthly = getMonthlyCount(myId);
  const hasSub  = hasSubscription(myId);
  const active   = deals.filter(d=>!['completed','cancelled','disputed'].includes(d.status));
  const history  = deals.filter(d=>['completed','cancelled'].includes(d.status));
  const disputes = deals.filter(d=>d.status==='disputed');

  const shown = histTab==='active' ? active : histTab==='history' ? history : disputes;

  if (view==='create') return <CreateDeal onDone={(id)=>{ if(id){const d=useGarantStore.getState().deals.find(x=>x.id===id);if(d){setDetail(d);setView('deal');}}else setView('main'); }}/>;
  if (view==='deal'&&detail) return <DealDetail deal={useGarantStore.getState().deals.find(d=>d.id===detail.id)??detail} myId={myId} onBack={()=>{setView('main');setDetail(null);}}/>;

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background:C.bg }}>
      {/* Header */}
      <div className="px-4 pt-5 pb-4 shrink-0">
        {/* Logo row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl"
              style={{ background:`linear-gradient(135deg,${C.accent}25,rgba(129,140,248,0.15))`,
                border:`1.5px solid ${C.accent}35` }}>
              <Shield size={20} style={{ color:C.accent }}/>
            </div>
            <div>
              <p className="text-base font-black text-white">Sky Garant</p>
              <p className="text-[10px]" style={{ color:C.t3 }}>
                {hasSub ? 'Безлимит' : `${3-monthly} из 3 бесплатных`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!hasSub && (
              <button type="button" onClick={()=>setShowSub(true)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold"
                style={{ background:`${C.amber}15`, color:C.amber, border:`1px solid ${C.amber}25` }}>
                <Crown size={11}/>Pro · 159₽
              </button>
            )}
            {hasSub && (
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                style={{ background:`${C.accent}15`, color:C.accent }}><Shield size={10} className="inline mr-1"/>Pro</span>
            )}
            <motion.button whileTap={{ scale:.93 }} type="button"
              onClick={()=>setView('create')}
              className="flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white"
              style={{ background:C.accent, boxShadow:`0 4px 16px ${C.accent}40` }}>
              <Plus size={15}/>Сделка
            </motion.button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2.5 mb-4">
          {[
            { label:'Активных',   val:active.length,                                    color:C.accent },
            { label:'Завершено',  val:deals.filter(d=>d.status==='completed').length,  color:C.green  },
            { label:'В месяц',    val:hasSub?'∞':`${monthly}/3`,                        color:C.amber  },
          ].map(({label,val,color})=>(
            <div key={label} className="rounded-2xl px-3 py-3 text-center"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}>
              <p className="text-lg font-black" style={{ color }}>{val}</p>
              <p className="text-[9px] mt-0.5" style={{ color:C.t3 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex rounded-2xl overflow-hidden" style={{ background:C.l1, border:`1px solid ${C.border}` }}>
          {([['active','Активные'],['history','История'],['disputes','Споры']] as const).map(([k,l],i)=>(
            <button key={k} type="button" onClick={()=>setHistTab(k as any)}
              className="flex-1 py-2.5 text-[11px] font-bold transition-all"
              style={{ background:histTab===k?C.accent:'transparent',
                color:histTab===k?'white':C.t3,
                borderRight:i<2?`1px solid ${C.border}`:'none' }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3" style={{ scrollbarWidth:'none' }}>
        {shown.length===0 ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="grid h-16 w-16 place-items-center rounded-3xl text-3xl"
              style={{ background:C.l1, border:`1px solid ${C.border}` }}>
              {histTab==='active'?<Handshake size={28}/>:histTab==='history'?<History size={28}/>:<Scale size={28}/>}
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-white">
                {histTab==='active'?'Нет активных сделок':histTab==='history'?'История пуста':'Активных споров нет'}
              </p>
              <p className="text-xs mt-1" style={{ color:C.t2 }}>
                {histTab==='active'?'Создайте сделку  -  Sky Garant защитит обе стороны':
                 histTab==='history'?'Завершённые сделки появятся здесь':
                 'Хорошо  -  значит все сделки прошли гладко'}
              </p>
            </div>
            {histTab==='active'&&(
              <motion.button whileTap={{ scale:.95 }} type="button" onClick={()=>setView('create')}
                className="flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white"
                style={{ background:`linear-gradient(135deg,${C.accent},#818cf8)` }}>
                <Shield size={15}/>Создать сделку
              </motion.button>
            )}
          </div>
        ) : (
          shown.map(d=>(
            <DealCard key={d.id} deal={d} myId={myId}
              onOpen={()=>{ setDetail(d); setView('deal'); }}/>
          ))
        )}
      </div>

      {/* Sub modal */}
      <AnimatePresence>
        {showSub&&<SubModal onClose={()=>setShowSub(false)}/>}
      </AnimatePresence>
    </div>
  );
};
