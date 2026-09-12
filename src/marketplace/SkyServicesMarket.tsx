import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, Clock, RefreshCw, ChevronLeft, Check, Package, Shield, ChevronRight, Wrench } from 'lucide-react';
import {
  useServicesMarket, fmtSvcPrice, STATUS_LABEL_SVC,
  SVC_CAT_LABEL, SVC_CAT_ICON, SVC_CAT_COLOR,
  type ServiceListing, type ServiceCategory, type ServiceLevel,
} from './servicesMarket';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import { SkyPayCheckout } from '@/payment/SkyPay';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)', l3:'var(--bg-l3)',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

const LEVEL_BADGE: Record<string, { label:string; color:string }> = {
  new:  { label:'Новичок', color:'var(--t2)' },
  pro:  { label:'PRO',     color:'var(--accent)' },
  top:  { label:'TOP',     color:'var(--amber)' },
};

const PKG_LABEL: Record<ServiceLevel, string> = {
  basic: 'Базовый', standard: 'Стандарт', premium: 'Премиум',
};

/* -- Listing Card ----------------------------------------------- */
const ListingCard = ({ listing, onClick }: { listing: ServiceListing; onClick: () => void }) => {
  const cat   = SVC_CAT_COLOR[listing.category];
  const basic = listing.packages.find(p => p.level === 'basic')!;
  const badge = LEVEL_BADGE[listing.sellerLevel];

  return (
    <motion.div whileTap={{ scale:.97 }} onClick={onClick}
      className="rounded-2xl overflow-hidden cursor-pointer"
      style={{ background:C.l2, border:`1px solid ${C.border}` }}>
      {/* Color bar */}
      <div className="h-1.5 w-full" style={{ background:`linear-gradient(90deg,${cat},${cat}66)` }}/>
      <div className="p-3.5">
        {/* Category + seller level */}
        <div className="flex items-center gap-1.5 mb-2">
          {(() => { const Icon = SVC_CAT_ICON[listing.category]; return <Icon size={14} style={{ color:cat }}/>; })()}
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background:`${cat}18`, color:cat }}>
            {SVC_CAT_LABEL[listing.category]}
          </span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-auto"
            style={{ background:`${badge.color}18`, color:badge.color }}>
            {badge.label}
          </span>
        </div>
        <p className="text-xs font-bold leading-snug mb-1.5 line-clamp-2" style={{ color:C.t1 }}>
          {listing.title}
        </p>
        {/* Seller */}
        <div className="flex items-center gap-1.5 mb-2.5">
          <div className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold text-white shrink-0"
            style={{ background:`linear-gradient(135deg,${cat}80,${cat}40)` }}>
            {listing.sellerName[0]}
          </div>
          <span className="text-[10px]" style={{ color:C.t3 }}>{listing.sellerName}</span>
          {listing.verified && <Check size={9} style={{ color:C.green }}/>}
        </div>
        {/* Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Star size={10} fill={C.amber} style={{ color:C.amber }}/>
            <span className="text-[10px] font-bold" style={{ color:C.amber }}>{listing.rating}</span>
            <span className="text-[10px]" style={{ color:C.t3 }}>({listing.reviews})</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock size={9} style={{ color:C.t3 }}/>
            <span className="text-[10px]" style={{ color:C.t3 }}>от {basic.delivery} дн.</span>
          </div>
        </div>
        {/* Price */}
        <div className="mt-2 pt-2" style={{ borderTop:`1px solid ${C.border}` }}>
          <span className="text-[10px]" style={{ color:C.t3 }}>от </span>
          <span className="text-sm font-black" style={{ color:C.t1 }}>{fmtSvcPrice(basic.price)}</span>
        </div>
      </div>
    </motion.div>
  );
};

/* -- Listing Detail ----------------------------------------------- */
const ListingDetail = ({ listing, onBack }: { listing: ServiceListing; onBack: () => void }) => {
  const { order } = useServicesMarket();
  const { currentUserId } = useAuthStore();
  const { spend, getBalance } = useMoney();
  const [pkg, setPkg]           = useState<ServiceLevel>('standard');
  const [requirements, setReqs] = useState('');
  const [ordered, setOrdered]   = useState(false);
  const [showPay, setShowPay]   = useState(false);

  const cat     = SVC_CAT_COLOR[listing.category];
  const balance = getBalance(currentUserId ?? '');
  const selPkg  = listing.packages.find(p => p.level === pkg)!;
  const badge   = LEVEL_BADGE[listing.sellerLevel];

  const buy = async () => {
    if (!currentUserId) return;
    const ok = await spend(currentUserId, selPkg.price, 'market', listing.title, listing.id);
    if (ok) {
      order(listing.id, pkg, currentUserId, requirements || undefined);
      setOrdered(true);
    } else {
      setShowPay(true);
    }
  };

  if (showPay) return (
    <SkyPayCheckout
      purpose="market_order"
      amount={selPkg.price}
      onSuccess={() => {
        if (currentUserId) order(listing.id, pkg, currentUserId, requirements || undefined);
        setOrdered(true); setShowPay(false);
      }}
      onCancel={() => setShowPay(false)}
    />
  );

  return (
    <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
      {/* Hero */}
      <div className="relative shrink-0 px-4 pt-4 pb-5"
        style={{ background:`linear-gradient(135deg,${listing.gradient[0]},${listing.gradient[1]})` }}>
        <div className="absolute inset-0"
          style={{ background:`radial-gradient(circle at 70% 20%,${cat}25,transparent 60%)` }}/>
        <button type="button" onClick={onBack}
          className="relative flex items-center gap-1 mb-4 text-xs font-medium"
          style={{ color:'rgba(255,255,255,0.5)' }}>
          <ChevronLeft size={14}/>Назад
        </button>
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            {(() => { const Icon = SVC_CAT_ICON[listing.category]; return <Icon size={22} style={{ color:cat }}/>; })()}
            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{ background:`${cat}25`, color:cat }}>{SVC_CAT_LABEL[listing.category]}</span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background:`${badge.color}25`, color:badge.color }}>{badge.label}</span>
          </div>
          <h1 className="text-lg font-black text-white leading-tight mb-2">{listing.title}</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Star size={12} fill={C.amber} style={{ color:C.amber }}/>
              <span className="text-xs font-bold text-white">{listing.rating}</span>
              <span className="text-xs" style={{ color:'rgba(255,255,255,0.4)' }}>({listing.reviews})</span>
            </div>
            <span className="text-xs" style={{ color:'rgba(255,255,255,0.4)' }}>{listing.sold} заказов</span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Seller */}
        <div className="flex items-center gap-3 p-3 rounded-2xl"
          style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <div className="grid h-10 w-10 place-items-center rounded-full font-bold text-white shrink-0"
            style={{ background:`${cat}33`, fontSize:16 }}>
            {listing.sellerName[0]}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold" style={{ color:C.t1 }}>{listing.sellerName}</span>
              {listing.verified && <Check size={12} style={{ color:C.green }}/>}
            </div>
            <span className="text-xs" style={{ color:C.t3 }}>Исполнитель</span>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm leading-relaxed" style={{ color:C.t2 }}>{listing.description}</p>

        {/* Package selector */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color:C.t3 }}>
            Выберите пакет
          </p>
          <div className="grid grid-cols-3 gap-2">
            {listing.packages.map(p => (
              <motion.button key={p.level} type="button" whileTap={{ scale:.97 }}
                onClick={() => setPkg(p.level)}
                className="rounded-2xl p-3 text-left transition-all"
                style={{
                  background: pkg===p.level ? `${cat}12` : C.l2,
                  border: `1.5px solid ${pkg===p.level ? cat+'50' : C.border}`,
                }}>
                <p className="text-[10px] font-bold mb-1" style={{ color:pkg===p.level?cat:C.t3 }}>
                  {PKG_LABEL[p.level]}
                </p>
                <p className="text-sm font-black" style={{ color:C.t1 }}>{fmtSvcPrice(p.price)}</p>
                <div className="flex items-center gap-1 mt-1">
                  <Clock size={8} style={{ color:C.t3 }}/>
                  <span className="text-[9px]" style={{ color:C.t3 }}>{p.delivery} дн</span>
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Selected package details */}
        {selPkg && (
          <div className="rounded-2xl p-4 space-y-2"
            style={{ background:C.l2, border:`1px solid ${C.border}` }}>
            <p className="text-xs font-bold" style={{ color:C.t1 }}>{selPkg.description}</p>
            <div className="flex gap-3">
              <div className="flex items-center gap-1">
                <Clock size={11} style={{ color:C.t3 }}/>
                <span className="text-xs" style={{ color:C.t2 }}>{selPkg.delivery} дней</span>
              </div>
              {selPkg.revisions !== -1 && (
                <div className="flex items-center gap-1">
                  <RefreshCw size={11} style={{ color:C.t3 }}/>
                  <span className="text-xs" style={{ color:C.t2 }}>{selPkg.revisions} правки</span>
                </div>
              )}
              {selPkg.revisions === -1 && (
                <span className="text-xs" style={{ color:C.green }}>&#8734; правок</span>
              )}
            </div>
            <div className="space-y-1 pt-1">
              {selPkg.includes.map(inc => (
                <div key={inc} className="flex items-center gap-2">
                  <Check size={11} style={{ color:C.green }}/>
                  <span className="text-xs" style={{ color:C.t2 }}>{inc}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Requirements */}
        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color:C.t3 }}>
            Требования к заказу
          </p>
          <textarea value={requirements} onChange={e => setReqs(e.target.value)}
            placeholder="Опишите детали заказа, пожелания, ссылки..."
            rows={3} className="w-full rounded-2xl px-4 py-3 text-sm outline-none resize-none"
            style={{ background:C.l2, border:`1px solid ${C.border}`, color:C.t1 }}/>
        </div>

        {/* Buy */}
        <div className="rounded-2xl p-4" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <div className="flex justify-between items-center mb-3">
            <div>
              <p className="text-xl font-black" style={{ color:C.t1 }}>{fmtSvcPrice(selPkg.price)}</p>
              <p className="text-xs mt-0.5" style={{ color:C.t3 }}>
                Баланс: <span style={{ color:balance >= selPkg.price ? C.green : C.red }}>
                  {balance.toLocaleString('ru')} ₽
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs" style={{ color:C.t3 }}>
              <Shield size={12} style={{ color:C.green }}/>
              <span>Защита сделки</span>
            </div>
          </div>

          {ordered ? (
            <motion.div initial={{ scale:.95 }} animate={{ scale:1 }}
              className="flex items-center justify-center gap-2 rounded-2xl py-3"
              style={{ background:'rgba(52,211,153,0.12)', border:`1px solid rgba(52,211,153,0.3)` }}>
              <Check size={18} style={{ color:C.green }}/>
              <span className="text-sm font-bold" style={{ color:C.green }}>Заказ создан!</span>
            </motion.div>
          ) : (
            <motion.button whileTap={{ scale:.97 }} type="button" onClick={buy}
              className="flex items-center justify-center gap-2 w-full rounded-2xl py-3.5 text-sm font-bold text-white"
              style={{ background:`linear-gradient(135deg,${cat},${cat}aa)`, boxShadow:`0 6px 20px ${cat}30` }}>
              Заказать за {fmtSvcPrice(selPkg.price)}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* === SERVICES MARKET ========================================== */
export const ServicesMarket = () => {
  const { listings, getMyOrders } = useServicesMarket();
  const { currentUserId } = useAuthStore();
  const [catFilter, setCatFilter] = useState<ServiceCategory|'all'>('all');
  const [detail, setDetail]       = useState<ServiceListing|null>(null);
  const [showOrders, setShowOrders] = useState(false);

  const myOrders  = getMyOrders(currentUserId ?? '');
  const featured  = listings.filter(l => l.featured);
  const visible   = useMemo(() =>
    catFilter === 'all' ? listings : listings.filter(l => l.category === catFilter),
    [listings, catFilter]
  );

  if (detail) return <ListingDetail listing={detail} onBack={() => setDetail(null)}/>;

  if (showOrders) return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setShowOrders(false)}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={18} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>Мои заказы</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth:'none' }}>
        {myOrders.length === 0
          ? <p className="text-center py-10 text-sm" style={{ color:C.t3 }}>Заказов нет</p>
          : myOrders.map(o => {
            const cat = SVC_CAT_COLOR['other'];
            const d = new Date(o.deadline);
            return (
              <div key={o.id} className="rounded-2xl p-3.5"
                style={{ background:C.l2, border:`1px solid ${C.border}` }}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-xs font-semibold leading-snug flex-1" style={{ color:C.t1 }}>
                    {o.listingTitle}
                  </p>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-semibold"
                    style={{
                      background: o.status === 'completed' ? 'rgba(52,211,153,0.12)' : 'rgba(79,110,247,0.12)',
                      color: o.status === 'completed' ? C.green : C.accent,
                    }}>
                    {STATUS_LABEL_SVC[o.status]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px]" style={{ color:C.t3 }}>
                  <span>Исполнитель: {o.sellerName}</span>
                  <span>·</span>
                  <span>{PKG_LABEL[o.package]}</span>
                  <span>·</span>
                  <span style={{ color:C.t1 }}>{fmtSvcPrice(o.price)}</span>
                </div>
                <div className="flex items-center gap-1 mt-1.5">
                  <Clock size={9} style={{ color:C.t3 }}/>
                  <span className="text-[9px]" style={{ color:C.t3 }}>
                    Дедлайн: {d.toLocaleDateString('ru', { day:'numeric', month:'short' })}
                  </span>
                </div>
              </div>
            );
          })
        }
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <p className="text-xs font-bold flex items-center gap-1.5" style={{ color:C.t2 }}>
          <Wrench size={13}/> Биржа услуг · Фрилансеры
        </p>
        <button type="button" onClick={() => setShowOrders(true)}
          className="flex items-center gap-1.5 text-xs font-semibold" style={{ color:C.accent }}>
          <Package size={12}/>Заказы {myOrders.length > 0 && `(${myOrders.length})`}
        </button>
      </div>

      {/* Category filters */}
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto shrink-0" style={{ scrollbarWidth:'none' }}>
        <button type="button" onClick={() => setCatFilter('all')}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
          style={{ background:catFilter==='all'?C.accent:C.l2, color:catFilter==='all'?'#fff':C.t2 }}>
          Все
        </button>
        {(Object.keys(SVC_CAT_LABEL) as ServiceCategory[]).map(cat => (
          <button key={cat} type="button" onClick={() => setCatFilter(cat)}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
            style={{ background:catFilter===cat?SVC_CAT_COLOR[cat]:C.l2, color:catFilter===cat?'#fff':C.t2 }}>
            {(() => { const Icon = SVC_CAT_ICON[cat]; return <Icon size={13}/>; })()}{SVC_CAT_LABEL[cat]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        {/* Featured */}
        {catFilter === 'all' && featured.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color:C.t3 }}>
              <Star size={11} className="inline-block -mt-0.5 mr-1" fill="currentColor"/> Рекомендуем
            </p>
            <div className="grid grid-cols-2 gap-3">
              {featured.map(l => <ListingCard key={l.id} listing={l} onClick={() => setDetail(l)}/>)}
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5 flex items-center gap-1" style={{ color:C.t3 }}>
            {catFilter === 'all'
              ? 'Все услуги'
              : <>{(() => { const Icon = SVC_CAT_ICON[catFilter]; return <Icon size={11}/>; })()} {SVC_CAT_LABEL[catFilter]}</>}
            · {visible.length}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {visible.map(l => <ListingCard key={l.id} listing={l} onClick={() => setDetail(l)}/>)}
          </div>
        </div>
      </div>
    </div>
  );
};
