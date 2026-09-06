import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingCart, Star, Zap, Check, ChevronLeft, Tag, Package, Clock } from 'lucide-react';
import {
  useGamingMarket, fmtGPrice,
  RARITY_COLOR, RARITY_GLOW, RARITY_LABEL,
  GITEM_TYPE_LABEL, GITEM_TYPE_ICON,
  type GamingItem, type GItemType, type GItemRarity,
} from './gamingMarket';
import { useAuthStore } from '@/core/auth/store';
import { useMoney } from '@/wallet/store';
import { SkyPayCheckout } from '@/payment/SkyPay';

const C = {
  bg:'var(--bg)', l1:'var(--bg-l1)', l2:'var(--bg-l2)', l3:'var(--bg-l3)',
  border:'var(--border)', b2:'var(--border-m)',
  t1:'var(--t1)', t2:'var(--t2)', t3:'var(--t3)',
  accent:'var(--accent)', green:'var(--green)', amber:'var(--amber)', red:'var(--red)',
};

/* -- Item Card ----------------------------------------------- */
const ItemCard = ({ item, onClick }: { item: GamingItem; onClick: () => void }) => {
  const rc = RARITY_COLOR[item.rarity];
  const rg = RARITY_GLOW[item.rarity];
  const discount = item.originalPrice
    ? Math.round((1 - item.price / item.originalPrice) * 100) : 0;

  return (
    <motion.div whileTap={{ scale:.97 }} onClick={onClick}
      className="relative overflow-hidden rounded-2xl cursor-pointer"
      style={{ background:`linear-gradient(155deg,${item.gradient[0]},${item.gradient[1]})`,
        border:`1px solid ${rc}30`, boxShadow:`0 4px 20px ${rg}` }}>
      {/* Glow orb */}
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full pointer-events-none"
        style={{ background:`radial-gradient(${rc}50,transparent 70%)` }}/>

      {item.featured && (
        <div className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[9px] font-bold"
          style={{ background:'rgba(245,158,11,0.85)', color:'#fff' }}>★ ТОП</div>
      )}
      {discount > 0 && (
        <div className="absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{ background:'rgba(248,113,113,0.85)', color:'#fff' }}>−{discount}%</div>
      )}

      <div className="relative p-3.5 pt-7">
        {/* Type + Rarity */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-sm">{GITEM_TYPE_ICON[item.type]}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ background:`${rc}20`, color:rc, border:`1px solid ${rc}40` }}>
            {RARITY_LABEL[item.rarity]}
          </span>
        </div>
        <p className="text-xs font-bold leading-snug text-white line-clamp-2 mb-1">{item.title}</p>
        <p className="text-[9px] mb-2.5" style={{ color:'rgba(255,255,255,0.45)' }}>{item.game}</p>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-white">{fmtGPrice(item.price)}</p>
            {item.originalPrice && (
              <p className="text-[9px] line-through" style={{ color:'rgba(255,255,255,0.35)' }}>
                {fmtGPrice(item.originalPrice)}
              </p>
            )}
          </div>
          {item.delivery === 'instant'
            ? <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                style={{ background:'rgba(52,211,153,0.2)', color:C.green }}>⚡ Сразу</span>
            : <span className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background:'rgba(79,110,247,0.15)', color:C.accent }}>Вручную</span>
          }
        </div>
      </div>
    </motion.div>
  );
};

/* -- Item Detail ----------------------------------------------- */
const ItemDetail = ({ item, onBack }: { item: GamingItem; onBack: () => void }) => {
  const { buyItem } = useGamingMarket();
  const { currentUserId } = useAuthStore();
  const { spend, getBalance } = useMoney();
  const [ordered, setOrdered] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const rc = RARITY_COLOR[item.rarity];

  const balance = getBalance(currentUserId ?? '');

  const buy = () => {
    if (!currentUserId) return;
    const ok = spend(currentUserId, item.price, 'market', item.title, item.id);
    if (ok) {
      buyItem(item.id, currentUserId);
      setOrdered(true);
    } else {
      setShowPay(true);
    }
  };

  if (showPay) return (
    <SkyPayCheckout
      purpose="market_order"
      amount={item.price}
      onSuccess={() => {
        if (currentUserId) buyItem(item.id, currentUserId);
        setOrdered(true); setShowPay(false);
      }}
      onCancel={() => setShowPay(false)}
    />
  );

  return (
    <motion.div initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }}
      className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth:'none' }}>
      {/* Hero */}
      <div className="relative overflow-hidden shrink-0 px-4 pt-4 pb-6"
        style={{ background:`linear-gradient(155deg,${item.gradient[0]},${item.gradient[1]})` }}>
        <div className="absolute inset-0"
          style={{ background:`radial-gradient(circle at 70% 30%,${rc}25,transparent 60%)` }}/>
        <button type="button" onClick={onBack}
          className="relative flex items-center gap-1 mb-4 text-xs font-medium"
          style={{ color:'rgba(255,255,255,0.5)' }}>
          <ChevronLeft size={14}/>Назад
        </button>
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{GITEM_TYPE_ICON[item.type]}</span>
            <span className="text-xs font-bold px-2 py-1 rounded-full"
              style={{ background:`${rc}25`, color:rc, border:`1px solid ${rc}45` }}>
              {RARITY_LABEL[item.rarity]}
            </span>
            {item.delivery === 'instant' && (
              <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                style={{ background:'rgba(52,211,153,0.2)', color:C.green }}>⚡ Мгновенно</span>
            )}
          </div>
          <h1 className="text-xl font-black text-white leading-tight mb-1">{item.title}</h1>
          <p className="text-xs" style={{ color:'rgba(255,255,255,0.5)' }}>
            {item.game} · {GITEM_TYPE_LABEL[item.type]}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Star size={11} fill={C.amber} style={{ color:C.amber }}/>
            <span className="text-xs font-bold text-white">{item.rating}</span>
            <span className="text-xs" style={{ color:'rgba(255,255,255,0.4)' }}>
              {item.reviews} отзывов · {item.sold} продаж
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Seller */}
        <div className="flex items-center gap-3 p-3 rounded-2xl"
          style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <div className="grid h-10 w-10 place-items-center rounded-full font-bold text-white shrink-0"
            style={{ background:C.accent+'33', fontSize:16 }}>
            {item.sellerName[0]}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold" style={{ color:C.t1 }}>{item.sellerName}</span>
              {item.verified && <Check size={12} style={{ color:C.green }}/>}
            </div>
            <span className="text-xs" style={{ color:C.t3 }}>Продавец игровых товаров</span>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm leading-relaxed" style={{ color:C.t2 }}>{item.description}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          {item.tags.map(t => (
            <span key={t} className="text-xs px-2 py-0.5 rounded-full"
              style={{ background:`${rc}12`, color:rc }}>#{t}</span>
          ))}
        </div>

        {/* Price block */}
        <div className="rounded-2xl p-4" style={{ background:C.l2, border:`1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black" style={{ color:C.t1 }}>
                  {fmtGPrice(item.price)}
                </span>
                {item.originalPrice && (
                  <span className="text-sm line-through" style={{ color:C.t3 }}>
                    {fmtGPrice(item.originalPrice)}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color:C.t3 }}>
                Баланс: <span style={{ color: balance >= item.price ? C.green : C.red }}>
                  {balance.toLocaleString('ru')} ₽
                </span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold" style={{ color:C.t3 }}>
                {item.delivery === 'instant' ? '⚡ Мгновенная выдача' : '📋 Ручная выдача'}
              </p>
              {item.stock < 10 && item.stock < 999999 && (
                <p className="text-[10px] mt-0.5" style={{ color:C.amber }}>
                  Осталось: {item.stock} шт
                </p>
              )}
            </div>
          </div>

          {ordered ? (
            <motion.div initial={{ scale:.95 }} animate={{ scale:1 }}
              className="flex items-center justify-center gap-2 rounded-2xl py-3"
              style={{ background:'rgba(52,211,153,0.12)', border:`1px solid rgba(52,211,153,0.3)` }}>
              <Check size={18} style={{ color:C.green }}/>
              <span className="text-sm font-bold" style={{ color:C.green }}>Куплено!</span>
            </motion.div>
          ) : (
            <motion.button whileTap={{ scale:.97 }} type="button" onClick={buy}
              disabled={item.stock <= 0}
              className="flex items-center justify-center gap-2 w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
              style={{ background:`linear-gradient(135deg,${rc},${rc}99)`, boxShadow:`0 6px 20px ${RARITY_GLOW[item.rarity]}` }}>
              <ShoppingCart size={15}/>
              {item.stock <= 0 ? 'Нет в наличии' : `Купить за ${fmtGPrice(item.price)}`}
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* === GAMING MARKET ============================================ */
const TYPE_FILTERS: GItemType[] = ['skin','boost','currency','case','rank','coaching','account'];

export const GamingMarket = () => {
  const { items, getMyOrders } = useGamingMarket();
  const { currentUserId } = useAuthStore();
  const [filter, setFilter] = useState<GItemType|'all'>('all');
  const [detail, setDetail] = useState<GamingItem|null>(null);
  const [showOrders, setShowOrders] = useState(false);

  const myOrders = getMyOrders(currentUserId ?? '');
  const featured = items.filter(i => i.featured);
  const visible  = useMemo(() =>
    filter === 'all' ? items : items.filter(i => i.type === filter),
    [items, filter]
  );

  if (detail) return <ItemDetail item={detail} onBack={() => setDetail(null)}/>;

  if (showOrders) return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <button type="button" onClick={() => setShowOrders(false)}
          className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5">
          <ChevronLeft size={18} style={{ color:C.t2 }}/>
        </button>
        <span className="text-sm font-semibold" style={{ color:C.t1 }}>Мои покупки</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" style={{ scrollbarWidth:'none' }}>
        {myOrders.length === 0
          ? <p className="text-center py-10 text-sm" style={{ color:C.t3 }}>Покупок нет</p>
          : myOrders.map(o => (
            <div key={o.id} className="rounded-2xl p-3 flex items-center gap-3"
              style={{ background:C.l2, border:`1px solid ${C.border}` }}>
              <span className="text-xl">{GITEM_TYPE_ICON[o.type]}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color:C.t1 }}>{o.itemTitle}</p>
                <p className="text-[10px]" style={{ color:C.t3 }}>{o.game}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-bold" style={{ color:C.t1 }}>{fmtGPrice(o.price)}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background:'rgba(52,211,153,0.12)', color:C.green }}>
                  {o.status === 'completed' || o.status === 'delivering' ? 'Получено' : 'В процессе'}
                </span>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ borderBottom:`1px solid ${C.border}` }}>
        <p className="text-xs font-bold" style={{ color:C.t2 }}>⚔️ Игровые товары и услуги</p>
        <button type="button" onClick={() => setShowOrders(true)}
          className="flex items-center gap-1.5 text-xs font-semibold" style={{ color:C.accent }}>
          <Package size={12}/>Покупки {myOrders.length > 0 && `(${myOrders.length})`}
        </button>
      </div>

      {/* Type filters */}
      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto shrink-0" style={{ scrollbarWidth:'none' }}>
        <button type="button" onClick={() => setFilter('all')}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all"
          style={{ background:filter==='all'?C.accent:C.l2, color:filter==='all'?'#fff':C.t2 }}>
          Все
        </button>
        {TYPE_FILTERS.map(t => (
          <button key={t} type="button" onClick={() => setFilter(t)}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all flex items-center gap-1"
            style={{ background:filter===t?C.accent:C.l2, color:filter===t?'#fff':C.t2 }}>
            {GITEM_TYPE_ICON[t]}{GITEM_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ scrollbarWidth:'none' }}>
        {/* Featured */}
        {filter === 'all' && featured.length > 0 && (
          <div className="mb-4">
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color:C.t3 }}>
              ★ Избранное
            </p>
            <div className="grid grid-cols-2 gap-3">
              {featured.map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)}/>)}
            </div>
          </div>
        )}
        {/* All */}
        <div>
          {filter !== 'all' && (
            <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color:C.t3 }}>
              {GITEM_TYPE_ICON[filter]} {GITEM_TYPE_LABEL[filter]} · {visible.length}
            </p>
          )}
          {filter === 'all' && <p className="text-[10px] font-bold uppercase tracking-wider mb-2.5" style={{ color:C.t3 }}>Все товары</p>}
          <div className="grid grid-cols-2 gap-3">
            {visible.map(item => <ItemCard key={item.id} item={item} onClick={() => setDetail(item)}/>)}
          </div>
        </div>
      </div>
    </div>
  );
};
