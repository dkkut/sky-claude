/* ======================================================================
   SKY MARKET  —  Full marketplace v2
====================================================================== */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, SlidersHorizontal, X, Star, ShoppingCart,
  Heart, Package, Truck, CheckCircle, Clock, ArrowLeft, Plus,
  Minus, Share2, ChevronRight, Zap, TrendingUp,
  Store, BarChart3, Grid3X3, List, BadgePercent, Flame,
  AlertCircle, Edit3, Trash2, Laptop, Shirt, Home, Sparkles, Dumbbell,
  BookOpen, Gamepad2, Apple, MapPin, Check,
} from 'lucide-react';
import { useMoney } from '@/wallet/store';
import { useMarketStore } from './store';
import { useAuthStore } from '@/core/auth/store';
import type { Product, ProductCategory, Order, SellerProfile } from './types';
import { GamingMarket } from './SkyGamingMarket';
import { ServicesMarket } from './SkyServicesMarket';
import { CourierHub } from './logistics/CourierHub';
import { TransportCompanyHub, DeliveryOffersPanel } from './logistics/TransportCompanyHub';
import { WarehouseHub } from './logistics/WarehouseHub';
import { PassHub } from './logistics/PassHub';
import { ShipmentHub } from './logistics/ShipmentHub';
import { Warehouse as WarehouseIcon, KeyRound, Route, PackageSearch } from 'lucide-react';

/* ── Design tokens ────────────────────────────────────────────────── */
export const C = {
  bg:     'var(--bg)',
  l1:     'var(--bg-l1)',
  l2:     'var(--bg-l2)',
  l3:     'var(--bg-l3)',
  brd:    'var(--border)',
  brdM:   'var(--border-m)',
  t1:     'var(--t1)',
  t2:     'var(--t2)',
  t3:     'var(--t3)',
  acc:    'var(--accent)',
  accBg:  'var(--accent-bg)',
  amber:  'var(--amber)',
  green:  'var(--green)',
  red:    'var(--red)',
};

/* ── Helpers ──────────────────────────────────────────────────────── */
export const fmt   = (n: number) => n.toLocaleString('ru-RU') + ' ₽';
export const fmtTs = (s: string) =>
  new Date(s).toLocaleDateString('ru-RU', { day:'numeric', month:'short' });

const CAT_CFG: Record<ProductCategory, { label:string; Icon:typeof Package; color:string }> = {
  electronics: { label:'Электроника', Icon:Laptop,   color:'#3b82f6' },
  clothing:    { label:'Одежда',      Icon:Shirt,    color:'#8b5cf6' },
  home:        { label:'Дом',         Icon:Home,     color:'#10b981' },
  beauty:      { label:'Красота',     Icon:Sparkles, color:'#ec4899' },
  sports:      { label:'Спорт',       Icon:Dumbbell, color:'#f59e0b' },
  books:       { label:'Книги',       Icon:BookOpen, color:'#6366f1' },
  toys:        { label:'Игрушки',     Icon:Gamepad2, color:'#f43f5e' },
  food:        { label:'Питание',     Icon:Apple,    color:'#22c55e' },
  other:       { label:'Другое',      Icon:Package,  color:'var(--t3)' },
};

/**
 * Значок категории товара.
 *
 * Раньше здесь стояла эмодзи, и картинка зависела от шрифта устройства:
 * на телефоне одна, на телевизоре другая, а цвет и толщину линии под
 * тему подобрать было нельзя. Теперь категория хранит свой значок из
 * набора приложения, а размер и цвет задаются на месте.
 */
const CatIcon = ({ cat, size = 20, color }:
{ cat: ProductCategory; size?: number; color?: string }) => {
  const cfg = CAT_CFG[cat];
  const Icon = cfg.Icon;
  return <Icon size={size} style={{ color: color ?? cfg.color }}/>;
};

const ORDER_STATUS: Record<string,{label:string;color:string;icon:any}> = {
  pending:   { label:'Ожидает',    color:C.amber, icon:Clock       },
  confirmed: { label:'Подтверждён',color:C.acc,   icon:CheckCircle },
  shipped:   { label:'В пути',     color:'#8b5cf6',icon:Truck      },
  delivered: { label:'Доставлен', color:C.green,  icon:CheckCircle },
  cancelled: { label:'Отменён',   color:C.red,    icon:X           },
  disputed:  { label:'Спор',      color:C.red,    icon:AlertCircle },
};

export const Stars = ({ rating, size = 12 }: { rating: number; size?: number }) => (
  <span className="inline-flex gap-0.5">
    {[1,2,3,4,5].map(i => (
      <Star key={i} size={size}
        fill={i <= Math.round(rating) ? '#f59e0b' : 'none'}
        style={{ color: i <= Math.round(rating) ? '#f59e0b' : C.t3 }}/>
    ))}
  </span>
);

/* ── Cart state (local) ───────────────────────────────────────────── */
type CartItem = { product: Product; qty: number };
const useCart = () => {
  const [items, setItems] = useState<CartItem[]>([]);
  const add = useCallback((p: Product) => {
    setItems(prev => {
      const ex = prev.find(i => i.product.id === p.id);
      return ex
        ? prev.map(i => i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i)
        : [...prev, { product: p, qty: 1 }];
    });
  }, []);
  const remove   = useCallback((id: string) => setItems(p => p.filter(i => i.product.id !== id)), []);
  const setQty   = useCallback((id: string, qty: number) =>
    setItems(p => qty <= 0 ? p.filter(i => i.product.id !== id) : p.map(i => i.product.id === id ? { ...i, qty } : i)), []);
  const clear    = useCallback(() => setItems([]), []);
  const total    = items.reduce((a, i) => a + i.product.price * i.qty, 0);
  const count    = items.reduce((a, i) => a + i.qty, 0);
  return { items, add, remove, setQty, clear, total, count };
};

/* ── Wishlist state ───────────────────────────────────────────────── */
const useWishlist = () => {
  const [ids, setIds] = useState<Set<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  return { ids, toggle };
};

/* ── History ──────────────────────────────────────────────────────── */
const useHistory = () => {
  const [hist, setHist] = useState<string[]>([]);
  const push = useCallback((id: string) => {
    setHist(prev => [id, ...prev.filter(x => x !== id)].slice(0, 20));
  }, []);
  return { hist, push };
};

/* ══════════════════════════════════════════════════════════════════
   PRODUCT CARD
══════════════════════════════════════════════════════════════════ */
const ProductCard = ({
  product, onOpen, onAddCart, wishlisted, onWishlist, view,
}: {
  product: Product; onOpen: () => void; onAddCart: () => void;
  wishlisted: boolean; onWishlist: () => void; view: 'grid'|'list';
}) => {
  const sellers = useMarketStore(s => s.sellers);
  const seller  = sellers.find(s => s.accountId === product.sellerId);
  const cat     = CAT_CFG[product.category];
  const isLow   = product.stock > 0 && product.stock <= 3;

  if (view === 'list') return (
    <motion.div whileTap={{ scale: 0.99 }}
      className="flex items-center gap-4 rounded-2xl p-3 cursor-pointer"
      style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      {/* Image */}
      <div onClick={onOpen}
        className="relative shrink-0 h-20 w-20 rounded-xl flex items-center justify-center overflow-hidden"
        style={{ background: `${cat.color}10`, border: `1px solid ${cat.color}20` }}>
        {product.images[0]
          ? <img src={product.images[0]} alt={product.title} className="h-full w-full object-cover"/>
          : <CatIcon cat={product.category} size={30}/>}
        {product.badge && (
          <div className="absolute top-1 left-1 rounded px-1 py-0.5 text-[8px] font-black text-white"
            style={{ background: product.badge.includes('−') || product.badge === 'ЛИМ' ? '#f43f5e' : C.acc }}>
            {product.badge}
          </div>
        )}
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0" onClick={onOpen}>
        <p className="text-[10px] mb-0.5 flex items-center gap-1" style={{ color: cat.color }}>
          <CatIcon cat={product.category} size={11}/> {cat.label}
        </p>
        <p className="text-sm font-semibold truncate" style={{ color: C.t1 }}>{product.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <Stars rating={product.rating} size={10}/>
          <span className="text-[10px]" style={{ color: C.t3 }}>
            {product.rating.toFixed(1)} ({product.reviewCount})
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-black" style={{ color: C.t1 }}>{fmt(product.price)}</span>
          {product.oldPrice && (
            <span className="text-xs line-through" style={{ color: C.t3 }}>{fmt(product.oldPrice)}</span>
          )}
        </div>
      </div>
      {/* Actions */}
      <div className="flex flex-col gap-2 shrink-0">
        <button type="button" onClick={e => { e.stopPropagation(); onWishlist(); }}
          className="grid h-8 w-8 place-items-center rounded-xl transition-all"
          style={{ background: wishlisted ? 'rgba(244,63,94,0.15)' : C.l2, color: wishlisted ? '#f43f5e' : C.t3 }}>
          <Heart size={14} fill={wishlisted ? '#f43f5e' : 'none'}/>
        </button>
        <button type="button" onClick={e => { e.stopPropagation(); onAddCart(); }}
          disabled={product.stock === 0}
          className="grid h-8 w-8 place-items-center rounded-xl transition-all disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          <ShoppingCart size={14}/>
        </button>
      </div>
    </motion.div>
  );

  // GRID card
  return (
    <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
      whileHover={{ y:-2 }} whileTap={{ scale:0.98 }}
      className="rounded-2xl overflow-hidden cursor-pointer group"
      style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      {/* Image area */}
      <div onClick={onOpen} className="relative overflow-hidden"
        style={{ height: 160, background: `${cat.color}08` }}>
        {product.images[0]
          ? <img src={product.images[0]} alt={product.title} className="h-full w-full object-cover"/>
          : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-2">
              <span style={{ filter: `drop-shadow(0 4px 12px ${cat.color}40)` }}>
                <CatIcon cat={product.category} size={48}/>
              </span>
            </div>
          )}
        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {product.badge && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-black text-white"
              style={{ background: product.badge.includes('−') || product.badge === 'ЛИМ' ? '#f43f5e' : C.acc }}>
              {product.badge}
            </span>
          )}
          {isLow && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-black"
              style={{ background: 'rgba(245,158,11,0.9)', color:'#000' }}>
              {product.stock} шт
            </span>
          )}
          {product.stock === 0 && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-black text-white"
              style={{ background: C.red }}>Нет</span>
          )}
        </div>
        {/* Wishlist */}
        <button type="button" onClick={e => { e.stopPropagation(); onWishlist(); }}
          className="absolute top-2 right-2 grid h-7 w-7 place-items-center rounded-xl transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter:'blur(8px)', color: wishlisted ? '#f43f5e' : '#fff' }}>
          <Heart size={13} fill={wishlisted ? '#f43f5e' : 'none'}/>
        </button>
      </div>
      {/* Info */}
      <div className="p-3" onClick={onOpen}>
        <p className="text-[9px] font-semibold mb-1" style={{ color: cat.color }}>
          {cat.label} · {seller?.shopName ?? ''}
        </p>
        <p className="text-[13px] font-semibold leading-snug line-clamp-2 mb-2" style={{ color: C.t1 }}>
          {product.title}
        </p>
        <div className="flex items-center gap-1.5 mb-2">
          <Stars rating={product.rating} size={11}/>
          <span className="text-[10px] font-semibold" style={{ color: C.t3 }}>
            {product.rating.toFixed(1)}
          </span>
          <span className="text-[10px]" style={{ color: C.t3 }}>({product.reviewCount})</span>
          {product.sold > 50 && (
            <span className="text-[10px]" style={{ color: C.green }}>· {product.sold}+ продано</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-black" style={{ color: C.t1 }}>{fmt(product.price)}</span>
            {product.oldPrice && (
              <span className="ml-1.5 text-[11px] line-through" style={{ color: C.t3 }}>
                {fmt(product.oldPrice)}
              </span>
            )}
          </div>
          <motion.button whileTap={{ scale:0.88 }} type="button"
            onClick={e => { e.stopPropagation(); onAddCart(); }}
            disabled={product.stock === 0}
            className="grid h-8 w-8 place-items-center rounded-xl transition-all disabled:opacity-40"
            style={{ background: C.acc, color: '#fff' }}>
            <ShoppingCart size={14}/>
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   PRODUCT PAGE
══════════════════════════════════════════════════════════════════ */
const ProductPage = ({
  product, onBack, onAddCart, wishlisted, onWishlist,
}: {
  product: Product; onBack: () => void;
  onAddCart: () => void; wishlisted: boolean; onWishlist: () => void;
}) => {
  const { reviews, addReview } = useMarketStore();
  const sellers  = useMarketStore(s => s.sellers);
  const products = useMarketStore(s => s.products);
  const { currentUserId, accounts } = useAuthStore();
  const me = accounts.find(a => a.id === currentUserId);
  const seller = sellers.find(s => s.accountId === product.sellerId);
  const productReviews = reviews.filter(r => r.productId === product.id);
  const cat = CAT_CFG[product.category];

  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<'desc'|'reviews'>('desc');
  const [reviewText, setReviewText] = useState('');
  const [reviewRating, setReviewRating] = useState(5);
  const [submitted, setSubmitted] = useState(false);

  // Similar products
  const similar = products
    .filter(p => p.category === product.category && p.id !== product.id && p.active)
    .slice(0, 4);

  const handleReview = () => {
    if (!reviewText.trim() || !me) return;
    addReview({ productId: product.id, rating: reviewRating, text: reviewText.trim() });
    setReviewText(''); setSubmitted(true);
  };

  return (
    <motion.div initial={{ x: 20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      className="h-full flex flex-col overflow-hidden"
      style={{ background: C.bg }}>

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5"
          style={{ color: C.acc }}>
          <ArrowLeft size={18}/>
        </button>
        <p className="flex-1 text-sm font-semibold truncate" style={{ color: C.t1 }}>{product.title}</p>
        <button type="button" onClick={onWishlist}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5"
          style={{ color: wishlisted ? '#f43f5e' : C.t3 }}>
          <Heart size={18} fill={wishlisted ? '#f43f5e' : 'none'}/>
        </button>
        <button type="button"
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5"
          style={{ color: C.t3 }}>
          <Share2 size={18}/>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {/* Image */}
        <div className="relative mx-4 mt-4 rounded-2xl overflow-hidden flex items-center justify-center"
          style={{ height: 240, background: `${cat.color}08`, border: `1px solid ${cat.color}15` }}>
          {product.images[0]
            ? <img src={product.images[0]} alt={product.title} className="h-full object-contain"/>
            : <CatIcon cat={product.category} size={88}/>}
          {product.badge && (
            <div className="absolute top-3 left-3 rounded-lg px-2.5 py-1 text-xs font-black text-white"
              style={{ background: product.badge.includes('−') ? '#f43f5e' : C.acc }}>
              {product.badge}
            </div>
          )}
          {product.oldPrice && (
            <div className="absolute bottom-3 right-3 rounded-lg px-2.5 py-1 text-xs font-black"
              style={{ background: 'rgba(0,0,0,0.7)', color: '#fff' }}>
              Скидка {product.discount}%
            </div>
          )}
        </div>

        {/* Main info */}
        <div className="px-4 mt-4">
          <p className="text-[10px] font-semibold mb-1 flex items-center gap-1" style={{ color: cat.color }}>
            <CatIcon cat={product.category} size={11}/> {cat.label} · {seller?.shopName}
          </p>
          <h1 className="text-xl font-bold leading-tight mb-2" style={{ color: C.t1 }}>
            {product.title}
          </h1>
          <div className="flex items-center gap-3 mb-3">
            <Stars rating={product.rating} size={14}/>
            <span className="text-sm font-semibold" style={{ color: C.t1 }}>
              {product.rating.toFixed(1)}
            </span>
            <button type="button" onClick={() => setTab('reviews')}
              className="text-sm" style={{ color: C.acc }}>
              {product.reviewCount} отзывов
            </button>
            <span className="text-sm" style={{ color: C.t3 }}>
              · {product.sold} продано
            </span>
          </div>

          {/* Price */}
          <div className="flex items-end gap-3 mb-4">
            <span className="text-3xl font-black" style={{ color: C.t1 }}>
              {fmt(product.price)}
            </span>
            {product.oldPrice && (
              <div>
                <span className="text-lg line-through" style={{ color: C.t3 }}>
                  {fmt(product.oldPrice)}
                </span>
                <p className="text-xs font-bold" style={{ color: C.green }}>
                  Экономия {fmt(product.oldPrice - product.price)}
                </p>
              </div>
            )}
          </div>

          {/* Stock */}
          <div className="flex items-center gap-2 mb-4 rounded-xl px-3 py-2"
            style={{ background: product.stock === 0 ? 'rgba(255,59,92,0.08)' :
              product.stock <= 3 ? 'rgba(245,158,11,0.08)' : 'rgba(0,220,90,0.08)',
              border: `1px solid ${product.stock === 0 ? 'rgba(255,59,92,0.2)' :
              product.stock <= 3 ? 'rgba(245,158,11,0.2)' : 'rgba(0,220,90,0.2)'}` }}>
            <Package size={14} style={{ color: product.stock === 0 ? C.red :
              product.stock <= 3 ? C.amber : C.green }}/>
            <p className="text-xs font-semibold" style={{ color: product.stock === 0 ? C.red :
              product.stock <= 3 ? C.amber : C.green }}>
              {product.stock === 0 ? 'Нет в наличии'
                : product.stock <= 3 ? `Осталось ${product.stock} шт`
                : `В наличии · ${product.stock} шт`}
            </p>
          </div>

          {/* Qty + Add */}
          {product.stock > 0 && (
            <div className="flex items-center gap-3 mb-5">
              <div className="flex items-center gap-2 rounded-xl overflow-hidden"
                style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
                <button type="button" onClick={() => setQty(q => Math.max(1, q-1))}
                  className="grid h-9 w-9 place-items-center" style={{ color: C.t2 }}>
                  <Minus size={14}/>
                </button>
                <span className="w-8 text-center text-sm font-bold" style={{ color: C.t1 }}>{qty}</span>
                <button type="button" onClick={() => setQty(q => Math.min(product.stock, q+1))}
                  className="grid h-9 w-9 place-items-center" style={{ color: C.t2 }}>
                  <Plus size={14}/>
                </button>
              </div>
              <motion.button whileTap={{ scale:0.97 }} type="button"
                onClick={() => { for(let i=0;i<qty;i++) onAddCart(); }}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white"
                style={{ background: C.acc, boxShadow: `0 4px 16px rgba(79,110,247,0.3)` }}>
                <ShoppingCart size={16}/>
                В корзину · {fmt(product.price * qty)}
              </motion.button>
            </div>
          )}

          {/* Seller card */}
          {seller && (
            <div className="rounded-2xl p-3 mb-4 flex items-center gap-3"
              style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base font-black"
                style={{ background: C.accBg, color: C.acc }}>
                {seller.shopName[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate" style={{ color: C.t1 }}>{seller.shopName}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Stars rating={seller.rating} size={10}/>
                  <span className="text-[10px]" style={{ color: C.t3 }}>
                    {seller.rating.toFixed(1)} · {seller.salesCount} продаж
                  </span>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: C.t3 }}/>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-0 border-b mb-4" style={{ borderColor: C.brd }}>
            {(['desc','reviews'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className="relative pb-2.5 mr-5 text-sm font-semibold transition-colors"
                style={{ color: tab === t ? C.t1 : C.t3 }}>
                {t === 'desc' ? 'Описание' : `Отзывы (${productReviews.length})`}
                {tab === t && (
                  <motion.div layoutId="product-tab"
                    className="absolute bottom-0 inset-x-0 h-[2px] rounded-full"
                    style={{ background: C.acc }}/>
                )}
              </button>
            ))}
          </div>

          {tab === 'desc' && (
            <div>
              <p className="text-sm leading-relaxed mb-6" style={{ color: C.t2 }}>
                {product.description}
              </p>
            </div>
          )}

          {tab === 'reviews' && (
            <div className="space-y-3 mb-6">
              {/* Add review */}
              {me && !submitted && (
                <div className="rounded-2xl p-4 space-y-3"
                  style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                  <p className="text-xs font-bold" style={{ color: C.t2 }}>Ваш отзыв</p>
                  <div className="flex gap-2">
                    {[1,2,3,4,5].map(i => (
                      <button key={i} type="button" onClick={() => setReviewRating(i)}>
                        <Star size={20} fill={i <= reviewRating ? '#f59e0b' : 'none'}
                          style={{ color: i <= reviewRating ? '#f59e0b' : C.t3 }}/>
                      </button>
                    ))}
                  </div>
                  <textarea value={reviewText} onChange={e => setReviewText(e.target.value)}
                    rows={3} placeholder="Расскажите о товаре..."
                    className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
                    style={{ background: C.l2, border:`1px solid ${C.brd}`, color:C.t1 }}/>
                  <button type="button" onClick={handleReview} disabled={!reviewText.trim()}
                    className="rounded-xl px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
                    style={{ background: C.acc }}>
                    Отправить отзыв
                  </button>
                </div>
              )}
              {submitted && (
                <div className="rounded-2xl p-3 text-center" style={{ background:'rgba(0,220,90,0.08)', border:'1px solid rgba(0,220,90,0.2)' }}>
                  <p className="text-xs font-semibold flex items-center justify-center gap-1.5" style={{ color: C.green }}>
                    <Check size={13}/> Отзыв опубликован
                  </p>
                </div>
              )}
              {productReviews.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: C.t3 }}>Отзывов пока нет</p>
              ) : productReviews.map(r => (
                <div key={r.id} className="rounded-2xl p-3"
                  style={{ background: C.l1, border:`1px solid ${C.brd}` }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white"
                        style={{ background: C.accBg, color: C.acc }}>
                        {r.buyerName[0]}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: C.t1 }}>{r.buyerName}</p>
                    </div>
                    <Stars rating={r.rating} size={11}/>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: C.t2 }}>{r.text}</p>
                  <p className="text-[10px] mt-1.5" style={{ color: C.t3 }}>{fmtTs(r.createdAt)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Similar products */}
          {similar.length > 0 && (
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.t3 }}>
                Похожие товары
              </p>
              <div className="flex gap-3 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
                {similar.map(p => (
                  <div key={p.id} className="shrink-0 w-36 rounded-2xl overflow-hidden cursor-pointer"
                    style={{ background: C.l1, border:`1px solid ${C.brd}` }}
                    onClick={() => { /* handled by parent */ }}>
                    <div className="h-24 flex items-center justify-center"
                      style={{ background:`${CAT_CFG[p.category].color}08` }}>
                      <CatIcon cat={p.category} size={30}/>
                    </div>
                    <div className="p-2">
                      <p className="text-[11px] font-semibold line-clamp-2 leading-tight" style={{ color:C.t1 }}>
                        {p.title}
                      </p>
                      <p className="text-xs font-black mt-1" style={{ color:C.t1 }}>{fmt(p.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   CART DRAWER
══════════════════════════════════════════════════════════════════ */
const CartDrawer = ({
  cart, onClose, onRemove, onSetQty, onCheckout,
}: {
  cart: ReturnType<typeof useCart>; onClose: () => void;
  onRemove: (id:string) => void; onSetQty:(id:string,q:number) => void;
  onCheckout: () => void;
}) => (
  <motion.div initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
    transition={{ type:'spring', damping:28, stiffness:300 }}
    className="absolute inset-0 z-50 flex flex-col"
    style={{ background: C.bg }}>
    {/* Header */}
    <div className="flex items-center gap-3 px-4 py-3 shrink-0"
      style={{ borderBottom:`1px solid ${C.brd}` }}>
      <button type="button" onClick={onClose}
        className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color:C.t3 }}>
        <X size={18}/>
      </button>
      <p className="flex-1 text-base font-bold" style={{ color:C.t1 }}>
        Корзина · {cart.count} товар{cart.count===1?'':cart.count<5?'а':'ов'}
      </p>
    </div>
    {cart.items.length === 0 ? (
      <div className="flex-1 flex flex-col items-center justify-center gap-4">
        <ShoppingCart size={48} style={{ color:C.t3, opacity:0.3 }}/>
        <p className="text-sm" style={{ color:C.t3 }}>Корзина пуста</p>
      </div>
    ) : (
      <>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ scrollbarWidth:'none' }}>
          {cart.items.map(({ product:p, qty }) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl p-3"
              style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl"
                style={{ background:`${CAT_CFG[p.category].color}10` }}>
                {p.images[0]
                  ? <img src={p.images[0]} alt="" className="h-full w-full object-cover rounded-xl"/>
                  : <CatIcon cat={p.category} size={24}/>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color:C.t1 }}>{p.title}</p>
                <p className="text-xs font-black mt-0.5" style={{ color:C.t1 }}>{fmt(p.price * qty)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => onSetQty(p.id, qty-1)}
                  className="grid h-7 w-7 place-items-center rounded-lg"
                  style={{ background:C.l2, color:C.t2 }}><Minus size={12}/></button>
                <span className="w-6 text-center text-xs font-bold" style={{ color:C.t1 }}>{qty}</span>
                <button type="button" onClick={() => onSetQty(p.id, qty+1)}
                  className="grid h-7 w-7 place-items-center rounded-lg"
                  style={{ background:C.l2, color:C.t2 }}><Plus size={12}/></button>
              </div>
              <button type="button" onClick={() => onRemove(p.id)}
                className="grid h-7 w-7 place-items-center rounded-lg ml-1"
                style={{ background:'rgba(255,59,92,0.08)', color:C.red }}>
                <X size={12}/>
              </button>
            </div>
          ))}
        </div>
        <div className="px-4 py-4 shrink-0" style={{ borderTop:`1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm" style={{ color:C.t2 }}>Итого:</p>
            <p className="text-xl font-black" style={{ color:C.t1 }}>{fmt(cart.total)}</p>
          </div>
          <button type="button" onClick={onCheckout}
            className="w-full rounded-2xl py-3.5 text-sm font-bold text-white"
            style={{ background:C.acc, boxShadow:`0 4px 20px rgba(79,110,247,0.35)` }}>
            Оформить заказ
          </button>
        </div>
      </>
    )}
  </motion.div>
);

/* ══════════════════════════════════════════════════════════════════
   ORDERS VIEW
══════════════════════════════════════════════════════════════════ */
const OrdersView = () => {
  const { orders, confirmDelivery } = useMarketStore();
  const { currentUserId } = useAuthStore();
  const myOrders = orders.filter(o => o.buyerId === currentUserId)
    .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="h-full overflow-y-auto pb-6 px-4" style={{ scrollbarWidth:'none' }}>
      {myOrders.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20">
          <Package size={48} style={{ color:C.t3, opacity:0.3 }}/>
          <p className="text-sm font-medium" style={{ color:C.t3 }}>Заказов пока нет</p>
        </div>
      ) : myOrders.map(order => {
        const cfg = ORDER_STATUS[order.status];
        const Icon = cfg.icon;
        return (
          <div key={order.id} className="mt-3 rounded-2xl overflow-hidden"
            style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
            <div className="flex items-center justify-between px-4 py-2.5"
              style={{ background:C.l2, borderBottom:`1px solid ${C.brd}` }}>
              <div className="flex items-center gap-2">
                <Icon size={13} style={{ color:cfg.color }}/>
                <span className="text-[11px] font-bold" style={{ color:cfg.color }}>{cfg.label}</span>
              </div>
              <span className="text-[10px]" style={{ color:C.t3 }}>{fmtTs(order.createdAt)}</span>
            </div>
            <div className="p-3.5">
              <p className="text-sm font-semibold mb-1" style={{ color:C.t1 }}>{order.productTitle}</p>
              <p className="text-xs mb-2" style={{ color:C.t3 }}>
                {order.quantity} шт · {fmt(order.total)} · {order.trackNumber}
              </p>
              {order.status === 'shipped' && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-2"
                  style={{ background:'rgba(139,92,246,0.08)', border:'1px solid rgba(139,92,246,0.2)' }}>
                  <Truck size={13} style={{ color:'#8b5cf6' }}/>
                  <p className="text-xs" style={{ color:'#8b5cf6' }}>Ожидайте доставку</p>
                </div>
              )}
              {order.status === 'shipped' && (
                <button type="button" onClick={() => confirmDelivery(order.id)}
                  className="w-full rounded-xl py-2 text-xs font-bold text-white"
                  style={{ background:C.green }}>
                  Подтвердить получение
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   MAIN CATALOG
══════════════════════════════════════════════════════════════════ */
const Catalog = ({
  cart, wishlist, history,
}: {
  cart: ReturnType<typeof useCart>;
  wishlist: ReturnType<typeof useWishlist>;
  history: ReturnType<typeof useHistory>;
}) => {
  const { products } = useMarketStore();
  const [query,    setQuery]    = useState('');
  const [category, setCat]      = useState<ProductCategory|'all'>('all');
  const [sort,     setSort]     = useState<'pop'|'new'|'price_asc'|'price_desc'|'rating'>('pop');
  const [view,     setView]     = useState<'grid'|'list'>('grid');
  const [showFilter,setFilter]  = useState(false);
  const [maxPrice, setMaxPrice] = useState(100000);
  const [inStock,  setInStock]  = useState(false);
  const [onSale,   setOnSale]   = useState(false);
  const [openProd, setOpenProd] = useState<Product|null>(null);

  const activeProducts = products.filter(p => p.active);

  const filtered = useMemo(() => {
    let res = activeProducts;
    if (query)      res = res.filter(p => p.title.toLowerCase().includes(query.toLowerCase()) || p.description.toLowerCase().includes(query.toLowerCase()));
    if (category !== 'all') res = res.filter(p => p.category === category);
    if (inStock)    res = res.filter(p => p.stock > 0);
    if (onSale)     res = res.filter(p => !!p.oldPrice);
    res = res.filter(p => p.price <= maxPrice);
    return [...res].sort((a,b) => {
      if (sort === 'new')        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === 'price_asc')  return a.price - b.price;
      if (sort === 'price_desc') return b.price - a.price;
      if (sort === 'rating')     return b.rating - a.rating;
      return b.sold - a.sold; // pop
    });
  }, [activeProducts, query, category, sort, maxPrice, inStock, onSale]);

  // Featured / banner promos
  const featured   = activeProducts.filter(p => p.badge === 'ХИТ').slice(0, 3);
  const onSaleProds = activeProducts.filter(p => !!p.oldPrice).slice(0, 4);
  const newProds   = activeProducts.filter(p => p.badge === 'NEW').slice(0, 4);

  if (openProd) return (
    <ProductPage
      product={openProd}
      onBack={() => setOpenProd(null)}
      onAddCart={() => cart.add(openProd)}
      wishlisted={wishlist.ids.has(openProd.id)}
      onWishlist={() => wishlist.toggle(openProd.id)}
    />
  );

  const showingPromo = !query && category === 'all';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Search bar */}
      <div className="px-4 py-3 shrink-0" style={{ borderBottom:`1px solid ${C.brd}` }}>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2.5 rounded-xl px-3 py-2"
            style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
            <Search size={14} style={{ color:C.t3, flexShrink:0 }}/>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Поиск товаров..."
              className="flex-1 text-sm bg-transparent outline-none"
              style={{ color:C.t1 }}/>
            {query && (
              <button type="button" onClick={() => setQuery('')} style={{ color:C.t3 }}>
                <X size={14}/>
              </button>
            )}
          </div>
          <button type="button" onClick={() => setFilter(f=>!f)}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-all"
            style={{ background:showFilter ? C.accBg : C.l1, color:showFilter ? C.acc : C.t3,
              border:`1px solid ${showFilter ? 'rgba(79,110,247,0.3)' : C.brd}` }}>
            <SlidersHorizontal size={16}/>
          </button>
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {showFilter && (
            <motion.div initial={{ height:0, opacity:0 }} animate={{ height:'auto', opacity:1 }}
              exit={{ height:0, opacity:0 }} className="overflow-hidden">
              <div className="pt-3 space-y-3">
                <div className="flex gap-3 items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={inStock} onChange={e => setInStock(e.target.checked)}
                      className="rounded" style={{ accentColor:C.acc }}/>
                    <span className="text-xs" style={{ color:C.t2 }}>В наличии</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={onSale} onChange={e => setOnSale(e.target.checked)}
                      className="rounded" style={{ accentColor:C.acc }}/>
                    <span className="text-xs" style={{ color:C.t2 }}>Со скидкой</span>
                  </label>
                </div>
                <div>
                  <p className="text-[10px] mb-1.5" style={{ color:C.t3 }}>
                    Цена до {fmt(maxPrice)}
                  </p>
                  <input type="range" min={0} max={50000} value={maxPrice}
                    onChange={e => setMaxPrice(+e.target.value)}
                    className="w-full" style={{ accentColor:C.acc }}/>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth:'none' }}>
        {/* Promo banners (only on main page) */}
        {showingPromo && (
          <div className="px-4 pt-3">
            {/* Sale banner */}
            {onSaleProds.length > 0 && (
              <div className="rounded-2xl overflow-hidden mb-3 relative"
                style={{ background:'linear-gradient(135deg,#1a0a3a,#2d0856)',
                  border:'1px solid rgba(168,85,247,0.25)' }}>
                <div className="absolute inset-0"
                  style={{ background:'radial-gradient(ellipse at 80% 50%,rgba(244,63,94,0.12) 0%,transparent 60%)' }}/>
                <div className="relative p-4 flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <BadgePercent size={16} style={{ color:'#f43f5e' }}/>
                      <p className="text-sm font-black" style={{ color:'#fff' }}>Акции и скидки</p>
                    </div>
                    <p className="text-xs" style={{ color:'rgba(255,255,255,0.55)' }}>
                      {onSaleProds.length} товаров со скидкой до 30%
                    </p>
                    <button type="button" onClick={() => setOnSale(true)}
                      className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold"
                      style={{ background:'#f43f5e', color:'#fff' }}>
                      Смотреть →
                    </button>
                  </div>
                  <div className="ml-auto flex gap-2 shrink-0 overflow-hidden" style={{ maxWidth:120 }}>
                    {onSaleProds.slice(0,2).map(p => (
                      <div key={p.id} className="grid h-12 w-12 place-items-center rounded-xl shrink-0"
                        style={{ background:'rgba(255,255,255,0.06)' }}>
                        <CatIcon cat={p.category} size={22} color="#fff"/>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Hits row */}
            {featured.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Flame size={13} style={{ color:'#f59e0b' }}/>
                    <p className="text-xs font-bold" style={{ color:C.t2 }}>Хиты продаж</p>
                  </div>
                  <button type="button" onClick={() => setSort('pop')}
                    className="text-[10px]" style={{ color:C.acc }}>Все →</button>
                </div>
                <div className="flex gap-3 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
                  {featured.map(p => (
                    <div key={p.id} onClick={() => { setOpenProd(p); history.push(p.id); }}
                      className="shrink-0 w-36 rounded-2xl overflow-hidden cursor-pointer"
                      style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
                      <div className="h-24 flex items-center justify-center"
                        style={{ background:`${CAT_CFG[p.category].color}08` }}>
                        <CatIcon cat={p.category} size={36}/>
                      </div>
                      <div className="p-2">
                        <p className="text-[11px] font-semibold line-clamp-2 leading-tight" style={{ color:C.t1 }}>
                          {p.title}
                        </p>
                        <p className="text-xs font-black mt-1" style={{ color:C.t1 }}>{fmt(p.price)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Category pills */}
        <div className="flex gap-2 px-4 py-2 overflow-x-auto" style={{ scrollbarWidth:'none' }}>
          <button type="button" onClick={() => setCat('all')}
            className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
            style={{ background:category==='all'?C.acc:'transparent', color:category==='all'?'#fff':C.t3,
              border:`1px solid ${category==='all'?'transparent':C.brd}` }}>
            Все
          </button>
          {Object.entries(CAT_CFG).map(([k,v]) => (
            <button key={k} type="button" onClick={() => setCat(k as ProductCategory)}
              className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
              style={{ background:category===k?`${v.color}20`:'transparent',
                color:category===k?v.color:C.t3,
                border:`1px solid ${category===k?v.color+'40':C.brd}` }}>
              <v.Icon size={12}/> {v.label}
            </button>
          ))}
        </div>

        {/* Sort + view toggle + count */}
        <div className="flex items-center justify-between px-4 py-2">
          <p className="text-[11px]" style={{ color:C.t3 }}>
            {filtered.length} товаров
          </p>
          <div className="flex items-center gap-2">
            <select value={sort} onChange={e => setSort(e.target.value as typeof sort)}
              className="text-[11px] rounded-lg px-2 py-1 outline-none"
              style={{ background:C.l2, border:`1px solid ${C.brd}`, color:C.t2 }}>
              <option value="pop">Популярные</option>
              <option value="new">Новинки</option>
              <option value="rating">По рейтингу</option>
              <option value="price_asc">Дешевле</option>
              <option value="price_desc">Дороже</option>
            </select>
            <button type="button" onClick={() => setView(v => v==='grid'?'list':'grid')}
              className="grid h-7 w-7 place-items-center rounded-lg"
              style={{ background:C.l2, color:C.t3, border:`1px solid ${C.brd}` }}>
              {view==='grid' ? <List size={13}/> : <Grid3X3 size={13}/>}
            </button>
          </div>
        </div>

        {/* Product grid/list */}
        <div className={`px-4 pb-6 ${view==='grid' ? 'grid grid-cols-2 gap-3' : 'space-y-2.5'}`}>
          {filtered.length === 0 ? (
            <div className="col-span-2 flex flex-col items-center gap-3 py-16">
              <Search size={36} style={{ color:C.t3, opacity:0.3 }}/>
              <p className="text-sm" style={{ color:C.t3 }}>Ничего не найдено</p>
            </div>
          ) : filtered.map(p => (
            <ProductCard
              key={p.id} product={p} view={view}
              onOpen={() => { setOpenProd(p); history.push(p.id); }}
              onAddCart={() => cart.add(p)}
              wishlisted={wishlist.ids.has(p.id)}
              onWishlist={() => wishlist.toggle(p.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   CHECKOUT
══════════════════════════════════════════════════════════════════ */
const Checkout = ({ cart, onDone }: { cart: ReturnType<typeof useCart>; onDone: () => void }) => {
  const { placeOrder } = useMarketStore();
  const { getBalance } = useMoney();
  const { currentUserId } = useAuthStore();
  const [addr, setAddr] = useState('');
  const [done, setDone] = useState(false);
  const [placedOrders, setPlacedOrders] = useState<Order[]>([]);
  const balance = getBalance(currentUserId ?? '');

  const handleOrder = () => {
    if (!addr.trim()) return;
    const created: Order[] = [];
    cart.items.forEach(({ product, qty }) => {
      for (let i = 0; i < qty; i++) {
        const o = placeOrder({ productId: product.id, quantity: 1, address: addr.trim() });
        if (o) created.push(o);
      }
    });
    setPlacedOrders(created);
    cart.clear();
    setDone(true);
  };

  if (done) return (
    <div className="flex flex-col items-center justify-center gap-5 h-full px-6">
      <motion.div initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:'spring' }}
        className="grid h-20 w-20 place-items-center rounded-3xl"
        style={{ background:'rgba(0,220,90,0.1)', border:'1px solid rgba(0,220,90,0.25)' }}>
        <Check size={38} style={{ color:C.green }}/>
      </motion.div>
      <div className="text-center">
        <p className="text-xl font-bold" style={{ color:C.t1 }}>Заказ оформлен!</p>
        <p className="text-sm mt-2" style={{ color:C.t2 }}>Следите за статусом в разделе «Заказы»</p>
        {placedOrders.length > 0 && (
          <div className="mt-3 w-full max-w-xs space-y-1.5">
            {[...new Map(placedOrders.map(o => [o.deliveryCompanyId, o])).values()].map(o => (
              <div key={o.deliveryCompanyId} className="flex items-center justify-between rounded-xl px-3 py-2 text-xs" style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
                <span className="flex items-center gap-1.5" style={{ color:C.t2 }}>
                  {o.deliverySource === 'seller'
                    ? <Store size={12}/>
                    : o.deliverySource === 'skymarket' ? <Package size={12}/> : <Truck size={12}/>}
                  {o.deliveryCompanyName}
                </span>
                <span className="font-bold" style={{ color:C.t1 }}>{fmt(o.deliveryPrice ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={onDone}
        className="rounded-2xl px-8 py-3 text-sm font-bold text-white"
        style={{ background:C.acc }}>Продолжить покупки</button>
    </div>
  );

  return (
    <div className="h-full flex flex-col px-4 py-4">
      <p className="text-base font-bold mb-4" style={{ color:C.t1 }}>Оформление заказа</p>
      <div className="space-y-3 mb-4">
        {cart.items.map(({ product:p, qty }) => (
          <div key={p.id} className="flex items-center gap-3 rounded-xl p-3"
            style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
            <CatIcon cat={p.category} size={24}/>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color:C.t1 }}>{p.title}</p>
              <p className="text-xs" style={{ color:C.t3 }}>{qty} шт × {fmt(p.price)}</p>
            </div>
            <p className="text-sm font-black shrink-0" style={{ color:C.t1 }}>{fmt(p.price*qty)}</p>
          </div>
        ))}
      </div>
      <div className="flex-1 space-y-3">
        <div>
          <p className="text-xs font-semibold mb-1.5" style={{ color:C.t3 }}>Адрес доставки</p>
          <textarea value={addr} onChange={e => setAddr(e.target.value)} rows={2}
            placeholder="Город, улица, дом, квартира"
            className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background:C.l1, border:`1px solid ${C.brd}`, color:C.t1 }}/>
        </div>
        <div className="rounded-xl p-3" style={{ background:C.l1, border:`1px solid ${C.brd}` }}>
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color:C.t2 }}>Sky Money</p>
            <p className="text-xs font-bold" style={{ color:C.green }}>{fmt(balance)}</p>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-sm font-semibold" style={{ color:C.t1 }}>К оплате</p>
            <p className="text-lg font-black" style={{ color:C.t1 }}>{fmt(cart.total)}</p>
          </div>
        </div>
      </div>
      <button type="button" onClick={handleOrder} disabled={!addr.trim()}
        className="mt-4 w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-40"
        style={{ background:C.acc }}>
        Оплатить {fmt(cart.total)}
      </button>
    </div>
  );
};

/* ══════════════════════════════════════════════════════════════════
   SELLER DASHBOARD — full marketplace seller cabinet
══════════════════════════════════════════════════════════════════ */
type SellerView = 'overview'|'products'|'orders'|'analytics'|'ads'|'couriers'|'transport'|'warehouses'|'passes'|'shipments'|'rules'|'settings';

const SELLER_TABS: {key:SellerView;label:string;icon:any}[] = [
  { key:'overview',   label:'Обзор',    icon:BarChart3 },
  { key:'products',   label:'Товары',   icon:Package   },
  { key:'orders',     label:'Заказы',   icon:Truck     },
  { key:'analytics',  label:'Аналитика',icon:TrendingUp},
  { key:'couriers',   label:'Курьеры',  icon:Truck},
  { key:'transport',  label:'Транспортная компания', icon:Route},
  { key:'warehouses', label:'Мои склады', icon:WarehouseIcon},
  { key:'shipments',  label:'Поставки', icon:PackageSearch},
  { key:'passes',     label:'Пропуска и доступы', icon:KeyRound},
  { key:'ads',        label:'Реклама',  icon:Zap},
  { key:'settings',   label:'Магазин',  icon:Store     },
];

export const fmtNum = (n:number) => n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n);

/* ── Mini stat card ─────────────────────────────────────────────── */
export const StatCard = ({
  label, value, sub, icon:Icon, color, trend,
}:{label:string;value:string;sub?:string;icon:any;color:string;trend?:number}) => (
  <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
    <div className="flex items-start justify-between mb-2">
      <div className="grid h-8 w-8 place-items-center rounded-xl"
        style={{background:`${color}15`}}>
        <Icon size={15} style={{color}}/>
      </div>
      {trend !== undefined && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{background:trend>=0?'rgba(0,220,90,0.1)':'rgba(255,59,92,0.1)',
            color:trend>=0?C.green:C.red}}>
          {trend>=0?'↑':'↓'}{Math.abs(trend)}%
        </span>
      )}
    </div>
    <p className="text-xl font-black" style={{color:C.t1}}>{value}</p>
    <p className="text-[10px] mt-0.5" style={{color:C.t3}}>{label}</p>
    {sub && <p className="text-[10px] mt-1" style={{color:C.t2}}>{sub}</p>}
  </div>
);

/* ── Product form ───────────────────────────────────────────────── */
const ProductForm = ({
  initial, onSave, onCancel,
}:{
  initial?: Partial<Product>;
  onSave:(data:any)=>void;
  onCancel:()=>void;
}) => {
  const [title,    setTitle]    = useState(initial?.title    ?? '');
  const [desc,     setDesc]     = useState(initial?.description ?? '');
  const [price,    setPrice]    = useState(String(initial?.price  ?? ''));
  const [oldPrice, setOldPrice] = useState(String(initial?.oldPrice ?? ''));
  const [stock,    setStock]    = useState(String(initial?.stock  ?? '10'));
  const [cat,      setCat]      = useState<ProductCategory>(initial?.category ?? 'other');
  const [badge,    setBadge]    = useState(initial?.badge ?? '');
  const [err,      setErr]      = useState('');

  const save = () => {
    if (!title.trim()) { setErr('Введите название'); return; }
    const p = parseFloat(price);
    if (!p || p <= 0) { setErr('Укажите цену'); return; }
    onSave({
      title: title.trim(), description: desc.trim(), price: p,
      oldPrice: oldPrice ? parseFloat(oldPrice) : undefined,
      stock: parseInt(stock) || 0, category: cat,
      badge: badge.trim() || undefined, images: initial?.images ?? [],
      active: true,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <div>
          <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>НАЗВАНИЕ *</p>
          <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={80}
            placeholder="Например: Игровая мышь SkyX Pro"
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>ОПИСАНИЕ</p>
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={3} maxLength={500}
            placeholder="Характеристики, материал, размеры..."
            className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>ЦЕНА ₽ *</p>
            <input type="number" value={price} onChange={e=>setPrice(e.target.value)} min={1}
              placeholder="1990"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
          </div>
          <div>
            <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>СТАРАЯ ЦЕНА ₽</p>
            <input type="number" value={oldPrice} onChange={e=>setOldPrice(e.target.value)} min={0}
              placeholder="2490"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
          </div>
          <div>
            <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>ОСТАТОК (ШТ) *</p>
            <input type="number" value={stock} onChange={e=>setStock(e.target.value)} min={0}
              placeholder="10"
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
          </div>
          <div>
            <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>БЕЙДЖ</p>
            <select value={badge} onChange={e=>setBadge(e.target.value)}
              className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}>
              <option value="">Без бейджа</option>
              <option value="ХИТ">ХИТ</option>
              <option value="NEW">NEW</option>
              <option value="ЛИМ">Лимитированный</option>
            </select>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1" style={{color:C.t3}}>КАТЕГОРИЯ</p>
          <select value={cat} onChange={e=>setCat(e.target.value as ProductCategory)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}>
            {Object.entries(CAT_CFG).map(([k,v])=>(
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>
      {err && <p className="text-xs" style={{color:C.red}}>{err}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl py-2.5 text-sm font-semibold"
          style={{background:C.l2,color:C.t2}}>Отмена</button>
        <button type="button" onClick={save}
          className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white"
          style={{background:C.acc}}>
          {initial?.id ? 'Сохранить' : 'Добавить товар'}
        </button>
      </div>
    </div>
  );
};

/* ── Products management ─────────────────────────────────────────── */
const SellerProducts = ({sellerId}:{sellerId:string}) => {
  const { products, addProduct, updateProduct, deleteProduct } = useMarketStore();
  const myProds = products.filter(p=>p.sellerId===sellerId).sort(
    (a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()
  );
  const [mode, setMode] = useState<'list'|'add'|{edit:Product}>('list');

  const handleAdd = (data:any) => {
    addProduct({...data, sellerId});
    setMode('list');
  };
  const handleEdit = (data:any) => {
    if (typeof mode==='object' && 'edit' in mode) {
      updateProduct(mode.edit.id, data);
      setMode('list');
    }
  };

  if (mode === 'add') return (
    <div className="h-full overflow-y-auto px-4 py-4" style={{scrollbarWidth:'none'}}>
      <div className="flex items-center gap-3 mb-4">
        <button type="button" onClick={()=>setMode('list')}
          className="grid h-8 w-8 place-items-center rounded-xl"
          style={{background:C.l2,color:C.t3}}>
          <ArrowLeft size={15}/>
        </button>
        <p className="text-sm font-bold" style={{color:C.t1}}>Новый товар</p>
      </div>
      <ProductForm onSave={handleAdd} onCancel={()=>setMode('list')}/>
    </div>
  );

  if (typeof mode==='object' && 'edit' in mode) return (
    <div className="h-full overflow-y-auto px-4 py-4" style={{scrollbarWidth:'none'}}>
      <div className="flex items-center gap-3 mb-4">
        <button type="button" onClick={()=>setMode('list')}
          className="grid h-8 w-8 place-items-center rounded-xl"
          style={{background:C.l2,color:C.t3}}>
          <ArrowLeft size={15}/>
        </button>
        <p className="text-sm font-bold" style={{color:C.t1}}>Редактировать товар</p>
      </div>
      <ProductForm initial={mode.edit} onSave={handleEdit} onCancel={()=>setMode('list')}/>
    </div>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{borderBottom:`1px solid ${C.brd}`}}>
        <p className="text-sm font-bold" style={{color:C.t1}}>
          Товары <span className="font-normal text-xs" style={{color:C.t3}}>({myProds.length})</span>
        </p>
        <motion.button whileTap={{scale:.94}} type="button"
          onClick={()=>setMode('add')}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-white"
          style={{background:C.acc}}>
          <Plus size={13}/> Добавить
        </motion.button>
      </div>
      {myProds.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <Package size={40} style={{color:C.t3,opacity:0.3}}/>
          <p className="text-sm" style={{color:C.t3}}>Товаров пока нет</p>
          <button type="button" onClick={()=>setMode('add')}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{background:C.acc}}>Добавить первый товар</button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-2" style={{scrollbarWidth:'none'}}>
          {myProds.map(p=>{
            const cat = CAT_CFG[p.category];
            const isLow = p.stock > 0 && p.stock <= 3;
            return (
              <div key={p.id} className="rounded-2xl overflow-hidden"
                style={{background:C.l1,border:`1px solid ${C.brd}`}}>
                <div className="flex items-center gap-3 p-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl"
                    style={{background:`${cat.color}10`}}>
                    {p.images[0]
                      ? <img src={p.images[0]} alt="" className="h-full w-full object-cover rounded-xl"/>
                      : <CatIcon cat={p.category} size={24}/>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate" style={{color:C.t1}}>{p.title}</p>
                      {p.badge && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded shrink-0"
                          style={{background:C.acc+'22',color:C.acc}}>{p.badge}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-bold" style={{color:C.t1}}>{fmt(p.price)}</span>
                      {p.oldPrice && <span className="text-[10px] line-through" style={{color:C.t3}}>{fmt(p.oldPrice)}</span>}
                      <span className="text-[10px]" style={{color: p.stock===0?C.red:isLow?C.amber:C.t3}}>
                        · {p.stock===0?'Нет':isLow?`${p.stock} осталось`:`${p.stock} шт`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Stars rating={p.rating} size={9}/>
                      <span className="text-[9px]" style={{color:C.t3}}>{p.rating.toFixed(1)} ({p.reviewCount})</span>
                      <span className="text-[9px]" style={{color:C.t3}}>· {p.sold} продано</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button type="button" onClick={()=>setMode({edit:p})}
                      className="grid h-7 w-7 place-items-center rounded-lg"
                      style={{background:C.l2,color:C.t3}}>
                      <Edit3 size={12}/>
                    </button>
                    <button type="button" onClick={()=>updateProduct(p.id,{active:!p.active})}
                      className="grid h-7 w-7 place-items-center rounded-lg"
                      style={{background:p.active?'rgba(0,220,90,0.1)':'rgba(255,255,255,0.05)',
                        color:p.active?C.green:C.t3}}>
                      <CheckCircle size={12}/>
                    </button>
                    <button type="button" onClick={()=>{if(window.confirm('Удалить товар?'))deleteProduct(p.id);}}
                      className="grid h-7 w-7 place-items-center rounded-lg"
                      style={{background:'rgba(255,59,92,0.08)',color:C.red}}>
                      <Trash2 size={12}/>
                    </button>
                  </div>
                </div>
                {/* Stock bar */}
                <div className="px-3 pb-2.5">
                  <div className="h-1 rounded-full overflow-hidden" style={{background:C.l2}}>
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width:`${Math.min(100,(p.stock/20)*100)}%`,
                        background: p.stock===0?C.red:isLow?C.amber:C.green
                      }}/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Order management ───────────────────────────────────────────── */
const SellerOrders = ({sellerId}:{sellerId:string}) => {
  const { orders, confirmOrder, shipOrder, cancelOrder } = useMarketStore();
  const myOrders = orders.filter(o=>o.sellerId===sellerId)
    .sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
  const [filter, setFilter] = useState<'all'|'pending'|'confirmed'|'shipped'|'delivered'>('all');

  const filtered = filter==='all' ? myOrders : myOrders.filter(o=>o.status===filter);
  const counts = {
    pending:   myOrders.filter(o=>o.status==='pending').length,
    confirmed: myOrders.filter(o=>o.status==='confirmed').length,
    shipped:   myOrders.filter(o=>o.status==='shipped').length,
    delivered: myOrders.filter(o=>o.status==='delivered').length,
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <DeliveryOffersPanel sellerId={sellerId}/>
      {/* Status tabs */}
      <div className="px-4 py-2.5 shrink-0" style={{borderBottom:`1px solid ${C.brd}`}}>
        <div className="flex gap-1.5 overflow-x-auto" style={{scrollbarWidth:'none'}}>
          {([
            ['all','Все',myOrders.length],
            ['pending','Новые',counts.pending],
            ['confirmed','Обрабатываются',counts.confirmed],
            ['shipped','Отправлены',counts.shipped],
            ['delivered','Доставлены',counts.delivered],
          ] as [typeof filter,string,number][]).map(([k,l,cnt])=>(
            <button key={k} type="button" onClick={()=>setFilter(k)}
              className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-all"
              style={{background:filter===k?C.acc:'transparent',color:filter===k?'#fff':C.t3,
                border:`1px solid ${filter===k?'transparent':C.brd}`}}>
              {l}
              {cnt > 0 && (
                <span className="grid place-items-center rounded-full px-1 min-w-[16px] h-4 text-[8px] font-black"
                  style={{background:filter===k?'rgba(255,255,255,0.25)':
                    k==='pending'?'rgba(244,63,94,0.15)':'rgba(255,255,255,0.08)',
                    color:filter===k?'#fff':k==='pending'?C.red:C.t3}}>
                  {cnt}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-2.5" style={{scrollbarWidth:'none'}}>
        {filtered.length===0 ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Package size={36} style={{color:C.t3,opacity:0.3}}/>
            <p className="text-sm" style={{color:C.t3}}>Заказов нет</p>
          </div>
        ) : filtered.map(o=>{
          const cfg = ORDER_STATUS[o.status];
          const Icon = cfg.icon;
          const canConfirm = o.status==='pending';
          const canShip    = o.status==='confirmed';
          const canCancel  = !['delivered','cancelled','disputed'].includes(o.status);
          return (
            <div key={o.id} className="rounded-2xl overflow-hidden"
              style={{background:C.l1,border:`1px solid ${o.status==='pending'?'rgba(244,63,94,0.25)':C.brd}`}}>
              {/* Status bar */}
              <div className="flex items-center justify-between px-4 py-2"
                style={{background:C.l2,borderBottom:`1px solid ${C.brd}`}}>
                <div className="flex items-center gap-2">
                  <Icon size={12} style={{color:cfg.color}}/>
                  <span className="text-[10px] font-bold" style={{color:cfg.color}}>{cfg.label}</span>
                  {o.status==='pending' && (
                    <motion.span animate={{opacity:[1,0.4,1]}} transition={{duration:1.5,repeat:Infinity}}
                      className="text-[9px] font-bold" style={{color:C.red}}>НОВЫЙ</motion.span>
                  )}
                </div>
                <span className="text-[10px]" style={{color:C.t3}}>{fmtTs(o.createdAt)}</span>
              </div>
              <div className="p-3.5">
                {/* Product */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                    style={{background:C.l2}}>
                    <Package size={16} style={{color:C.t3}}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{color:C.t1}}>{o.productTitle}</p>
                    <p className="text-xs mt-0.5" style={{color:C.t3}}>
                      {o.quantity} шт · <span className="font-bold" style={{color:C.t2}}>{fmt(o.total)}</span>
                    </p>
                    <p className="text-[10px] mt-0.5 flex items-center gap-1" style={{color:C.t3}}>
                      <MapPin size={10} className="shrink-0"/> {o.address}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black" style={{color:C.green}}>+{fmt(Math.round(o.total*0.95))}</p>
                    <p className="text-[9px]" style={{color:C.t3}}>после комиссии</p>
                  </div>
                </div>
                {/* Track */}
                <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-2.5"
                  style={{background:C.l2}}>
                  <Truck size={11} style={{color:C.t3}}/>
                  <span className="text-[10px] font-mono" style={{color:C.t3}}>{o.trackNumber}</span>
                </div>
                {/* Action buttons */}
                {(canConfirm||canShip||canCancel) && (
                  <div className="flex gap-2">
                    {canConfirm && (
                      <button type="button" onClick={()=>confirmOrder(o.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-white"
                        style={{background:C.acc}}>
                        <CheckCircle size={12}/> Принять
                      </button>
                    )}
                    {canShip && (
                      <button type="button" onClick={()=>shipOrder(o.id)}
                        className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-white"
                        style={{background:'#8b5cf6'}}>
                        <Truck size={12}/> Отправить
                      </button>
                    )}
                    {canCancel && (
                      <button type="button" onClick={()=>cancelOrder(o.id,'Отменено продавцом')}
                        className="rounded-xl px-3 py-2 text-xs font-semibold"
                        style={{background:'rgba(255,59,92,0.08)',color:C.red,border:`1px solid rgba(255,59,92,0.2)`}}>
                        Отмена
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── Analytics ──────────────────────────────────────────────────── */
const SellerAnalytics = ({seller,sellerId}:{seller:SellerProfile;sellerId:string}) => {
  const { orders, products, reviews, withdraw } = useMarketStore();
  const myOrders   = orders.filter(o=>o.sellerId===sellerId);
  const myProds    = products.filter(p=>p.sellerId===sellerId && p.active);
  const myRevs     = reviews.filter(r=>myProds.some(p=>p.id===r.productId));
  const delivered  = myOrders.filter(o=>o.status==='delivered');
  const pending    = myOrders.filter(o=>['pending','confirmed','shipped'].includes(o.status));
  const revenue7d  = delivered.filter(o=>Date.now()-new Date(o.createdAt).getTime()<86400000*7)
    .reduce((a,o)=>a+o.total,0);
  const revenue30d = delivered.filter(o=>Date.now()-new Date(o.createdAt).getTime()<86400000*30)
    .reduce((a,o)=>a+o.total,0);

  // Top products by revenue
  const topProds = myProds.map(p=>({
    ...p,
    revenue: myOrders.filter(o=>o.productId===p.id&&o.status==='delivered').reduce((a,o)=>a+o.total,0),
    ordCnt:  myOrders.filter(o=>o.productId===p.id).length,
  })).sort((a,b)=>b.revenue-a.revenue).slice(0,5);

  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [wdDone, setWdDone] = useState('');

  const doWithdraw = () => {
    const amt = parseFloat(withdrawAmt);
    if (!amt || amt <= 0 || amt > seller.balance) return;
    const req = withdraw(amt);
    if (req) { setWdDone(`Выведено ${fmt(req.net)} (комиссия ${fmt(req.fee)})`); setWithdrawAmt(''); }
  };

  return (
    <div className="h-full overflow-y-auto pb-6" style={{scrollbarWidth:'none'}}>
      {/* Revenue stats */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-3">
        <StatCard label="Всего заработано" value={fmt(seller.totalEarned)} icon={Zap} color={C.amber} trend={12}/>
        <StatCard label="Баланс к выводу" value={fmt(seller.balance)} icon={BarChart3} color={C.green}/>
        <StatCard label="Продажи за 7 дней" value={fmt(revenue7d)} sub={`${delivered.filter(o=>Date.now()-new Date(o.createdAt).getTime()<86400000*7).length} заказов`} icon={TrendingUp} color={C.acc} trend={8}/>
        <StatCard label="В обработке" value={String(pending.length)} sub="активных заказов" icon={Clock} color="#8b5cf6"/>
      </div>

      {/* KPI strip */}
      <div className="mx-4 mt-3 rounded-2xl p-4"
        style={{background:C.l1,border:`1px solid ${C.brd}`}}>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{color:C.t3}}>
          Показатели магазина
        </p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            {v:`${seller.rating.toFixed(1)||'–'}`,l:'Рейтинг',c:C.amber},
            {v:String(seller.salesCount),l:'Продаж',c:C.t1},
            {v:String(myProds.length),l:'Товаров',c:C.acc},
            {v:`${myRevs.length}`,l:'Отзывов',c:C.green},
          ].map(({v,l,c})=>(
            <div key={l}>
              <p className="text-lg font-black" style={{color:c}}>{v}</p>
              <p className="text-[9px]" style={{color:C.t3}}>{l}</p>
            </div>
          ))}
        </div>
        {/* Fulfillment rate */}
        {myOrders.length > 0 && (
          <div className="mt-3 pt-3" style={{borderTop:`1px solid ${C.brd}`}}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px]" style={{color:C.t3}}>Выполнено заказов</p>
              <p className="text-[10px] font-bold" style={{color:C.green}}>
                {Math.round((delivered.length/myOrders.length)*100)}%
              </p>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{background:C.l2}}>
              <div className="h-full rounded-full"
                style={{width:`${(delivered.length/myOrders.length)*100}%`,background:C.green}}/>
            </div>
          </div>
        )}
      </div>

      {/* Top products */}
      {topProds.length > 0 && (
        <div className="px-4 mt-3">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{color:C.t3}}>
            Топ товаров
          </p>
          <div className="rounded-2xl overflow-hidden"
            style={{background:C.l1,border:`1px solid ${C.brd}`}}>
            {topProds.map((p,i)=>(
              <div key={p.id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{borderBottom:i<topProds.length-1?`1px solid ${C.brd}`:'none',
                  background:i%2===0?'transparent':C.l2+'50'}}>
                <span className="text-xs font-black w-5 shrink-0 text-center" style={{color:C.t3}}>
                  {i+1}
                </span>
                <span className="shrink-0"><CatIcon cat={p.category} size={20}/></span>
                <p className="flex-1 text-xs font-semibold truncate" style={{color:C.t1}}>{p.title}</p>
                <div className="text-right shrink-0">
                  <p className="text-xs font-black" style={{color:C.green}}>{fmt(p.revenue)}</p>
                  <p className="text-[9px]" style={{color:C.t3}}>{p.ordCnt} заказов</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Withdraw */}
      <div className="px-4 mt-3">
        <div className="rounded-2xl p-4" style={{background:C.l1,border:`1px solid ${C.brd}`}}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold" style={{color:C.t1}}>Вывод средств</p>
            <p className="text-sm font-black" style={{color:C.green}}>{fmt(seller.balance)}</p>
          </div>
          {wdDone ? (
            <div className="rounded-xl p-3 text-center" style={{background:'rgba(0,220,90,0.08)',border:'1px solid rgba(0,220,90,0.2)'}}>
              <p className="text-xs font-semibold flex items-center justify-center gap-1.5" style={{color:C.green}}>
                <Check size={13}/> {wdDone}
              </p>
              <button type="button" onClick={()=>setWdDone('')}
                className="text-xs mt-1" style={{color:C.acc}}>Вывести ещё</button>
            </div>
          ) : (
            <>
              <p className="text-[10px] mb-2" style={{color:C.t3}}>
                Комиссия 5% · Минимум 100 ₽
              </p>
              <div className="flex gap-2">
                <input type="number" value={withdrawAmt} onChange={e=>setWithdrawAmt(e.target.value)}
                  placeholder={`До ${fmt(seller.balance)}`} min={100} max={seller.balance}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                  style={{background:C.l2,border:`1px solid ${C.brd}`,color:C.t1}}/>
                <button type="button" onClick={doWithdraw}
                  disabled={!withdrawAmt||parseFloat(withdrawAmt)<100||parseFloat(withdrawAmt)>seller.balance}
                  className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                  style={{background:C.green}}>
                  Вывести
                </button>
              </div>
              {withdrawAmt && parseFloat(withdrawAmt) > 0 && (
                <p className="text-[10px] mt-1.5" style={{color:C.t3}}>
                  Получите: {fmt(Math.round(parseFloat(withdrawAmt)*0.95))} (комиссия {fmt(Math.round(parseFloat(withdrawAmt)*0.05))})
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

/* ── Shop settings ──────────────────────────────────────────────── */
const SellerSettings = ({seller}:{seller:SellerProfile}) => {
  const { updateShop } = useMarketStore();
  const [name, setName] = useState(seller.shopName);
  const [desc, setDesc] = useState(seller.description);
  const [saved,setSaved]= useState(false);

  const save = () => {
    if (!name.trim()) return;
    updateShop({shopName:name.trim(),description:desc.trim()});
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4" style={{scrollbarWidth:'none'}}>
      <div className="rounded-2xl overflow-hidden mb-4"
        style={{background:'linear-gradient(135deg,var(--accent-bg),rgba(79,110,247,0.05))',
          border:`1px solid ${C.acc}30`}}>
        <div className="px-4 py-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl text-xl font-black mb-3"
            style={{background:C.accBg,color:C.acc}}>
            {seller.shopName[0]}
          </div>
          <p className="text-base font-bold" style={{color:C.t1}}>{seller.shopName}</p>
          <div className="flex items-center gap-2 mt-1">
            <Stars rating={seller.rating} size={12}/>
            <span className="text-xs" style={{color:C.t3}}>
              {seller.rating>0?seller.rating.toFixed(1)+' рейтинг':'Нет оценок'} · {seller.salesCount} продаж
            </span>
          </div>
          <div className="flex items-center gap-3 mt-3 pt-3" style={{borderTop:`1px solid ${C.brd}`}}>
            <span className="text-[10px] px-2 py-1 rounded-full font-semibold inline-flex items-center gap-1.5"
              style={{background:'rgba(0,220,90,0.12)',color:C.green}}>
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{background:C.green}}/> Активен
            </span>
            <span className="text-[10px]" style={{color:C.t3}}>
              Работает с {fmtTs(seller.createdAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-bold mb-1.5" style={{color:C.t3}}>НАЗВАНИЕ МАГАЗИНА</p>
          <input value={name} onChange={e=>setName(e.target.value)} maxLength={50}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{background:C.l1,border:`1px solid ${C.brd}`,color:C.t1}}/>
        </div>
        <div>
          <p className="text-[10px] font-bold mb-1.5" style={{color:C.t3}}>ОПИСАНИЕ</p>
          <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={4} maxLength={300}
            placeholder="Расскажите о вашем магазине..."
            className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{background:C.l1,border:`1px solid ${C.brd}`,color:C.t1}}/>
          <p className="text-[9px] text-right mt-1" style={{color:C.t3}}>{desc.length}/300</p>
        </div>
        <motion.button whileTap={{scale:.97}} type="button" onClick={save}
          className="w-full rounded-xl py-3 text-sm font-bold transition-all"
          style={{background:saved?'rgba(0,220,90,0.15)':C.acc,
            color:saved?C.green:'#fff',
            border:saved?`1px solid rgba(0,220,90,0.3)`:'none'}}>
          {saved
            ? <span className="inline-flex items-center justify-center gap-1.5"><Check size={14}/> Сохранено</span>
            : 'Сохранить изменения'}
        </motion.button>
      </div>

      {/* Info cards */}
      <div className="mt-4 space-y-2">
        {[
          {icon:BadgePercent,label:'Комиссия с продаж',value:'5%',color:C.amber},
          {icon:Truck,label:'Срок обработки заказа',value:'24 часа',color:'#8b5cf6'},
          {icon:Zap,label:'Выплата на Sky Money',value:'Мгновенно',color:C.green},
        ].map(({icon:Icon,label,value,color})=>(
          <div key={label} className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{background:C.l1,border:`1px solid ${C.brd}`}}>
            <Icon size={16} style={{color}}/>
            <p className="flex-1 text-xs" style={{color:C.t2}}>{label}</p>
            <p className="text-xs font-bold" style={{color}}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Become seller ──────────────────────────────────────────────── */
const BecomeSellerView = ({onDone}:{onDone:()=>void}) => {
  const { becomeSeller } = useMarketStore();
  const { accounts, currentUserId } = useAuthStore();
  const me = accounts.find(a=>a.id===currentUserId);
  const [name, setName] = useState(me?.name ? `${me.name} Store` : '');
  const [desc, setDesc] = useState('');
  const [err,  setErr]  = useState('');

  const submit = () => {
    if (!name.trim()) { setErr('Введите название магазина'); return; }
    becomeSeller(name.trim(), desc.trim() || 'Товары и услуги от нашего магазина');
    onDone();
  };

  return (
    <div className="h-full flex flex-col px-4 py-6" style={{background:C.bg}}>
      <div className="flex-1 flex flex-col justify-center max-w-sm mx-auto w-full gap-6">
        <div className="text-center">
          <div className="grid h-16 w-16 place-items-center rounded-3xl mx-auto mb-4"
            style={{background:C.accBg,border:`1px solid rgba(79,110,247,0.25)`}}>
            <Store size={28} style={{color:C.acc}}/>
          </div>
          <h2 className="text-xl font-bold mb-2" style={{color:C.t1}}>Открыть магазин</h2>
          <p className="text-sm" style={{color:C.t2}}>
            Продавайте товары миллионам пользователей Sky. Комиссия 5%, моментальные выплаты.
          </p>
        </div>

        {/* Benefits */}
        <div className="space-y-2">
          {[
            {icon:Zap,label:'Быстрый старт',sub:'Магазин открывается сразу'},
            {icon:BarChart3,label:'Аналитика продаж',sub:'Подробные отчёты и статистика'},
            {icon:CheckCircle,label:'Защита продавца',sub:'Гарантийные выплаты через Sky Garant'},
          ].map(({icon:Icon,label,sub})=>(
            <div key={label} className="flex items-center gap-3 rounded-xl px-4 py-3"
              style={{background:C.l1,border:`1px solid ${C.brd}`}}>
              <div className="grid h-8 w-8 place-items-center rounded-lg shrink-0"
                style={{background:C.accBg}}>
                <Icon size={14} style={{color:C.acc}}/>
              </div>
              <div>
                <p className="text-xs font-bold" style={{color:C.t1}}>{label}</p>
                <p className="text-[10px]" style={{color:C.t3}}>{sub}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold mb-1.5" style={{color:C.t3}}>НАЗВАНИЕ МАГАЗИНА *</p>
            <input value={name} onChange={e=>setName(e.target.value)} maxLength={50}
              placeholder="Мой крутой магазин"
              className="w-full rounded-xl px-3 py-3 text-sm outline-none"
              style={{background:C.l1,border:`1px solid ${C.brd}`,color:C.t1}}/>
          </div>
          <div>
            <p className="text-[10px] font-bold mb-1.5" style={{color:C.t3}}>ОПИСАНИЕ</p>
            <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={2} maxLength={200}
              placeholder="Что вы продаёте?"
              className="w-full resize-none rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{background:C.l1,border:`1px solid ${C.brd}`,color:C.t1}}/>
          </div>
          {err && <p className="text-xs" style={{color:C.red}}>{err}</p>}
          <button type="button" onClick={submit}
            className="w-full rounded-xl py-3.5 text-sm font-bold text-white"
            style={{background:C.acc,boxShadow:`0 4px 20px rgba(79,110,247,0.35)`}}>
            Открыть магазин бесплатно
          </button>
          <p className="text-[10px] text-center" style={{color:C.t3}}>
            Нажимая «Открыть», вы принимаете условия Sky Market
          </p>
        </div>
      </div>
    </div>
  );
};

/* ── Full seller dashboard ──────────────────────────────────────── */
/* ── Seller Ads Panel (PC) ───────────────────────────────────────── */
const AD_PLANS_PC = [
  {id:'basic',  name:'Базовый',  price:990,  reach:'~5 000',  desc:'48ч показов в ленте покупателей', color:'#6b7280'},
  {id:'pro',    name:'Про',      price:2990, reach:'~20 000', desc:'7 дней, приоритет в каталоге + лента', color:C.acc},
  {id:'premium',name:'Премиум',  price:7990, reach:'~80 000', desc:'30 дней, топ позиций + push', color:C.amber},
];

const SellerAdsPanel = ({ seller }: { seller: any }) => {
  const { products } = useMarketStore();
  const myProds = products.filter(p=>p.sellerId===seller.accountId&&p.active);
  const [plan,   setPlan]   = useState<string|null>(null);
  const [prodId, setProdId] = useState('');
  const [campaigns, setCamp] = useState<any[]>([]);
  const [done, setDone]      = useState('');

  const buy = () => {
    if (!plan || !prodId) return;
    const p = AD_PLANS_PC.find(x=>x.id===plan)!;
    const prod = myProds.find(x=>x.id===prodId);
    setCamp(prev=>[{id:'c'+Date.now(),plan:p.name,prod:prod?.title,reach:p.reach,started:new Date().toLocaleDateString('ru-RU')}, ...prev]);
    setDone(`Кампания «${p.name}» запущена! Охват ${p.reach} пользователей.`);
    setPlan(null); setProdId('');
  };

  return (
    <div className="h-full overflow-y-auto pb-6 px-4" style={{scrollbarWidth:'none'}}>
      {campaigns.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest" style={{color:C.t3}}>Активные кампании</p>
          {campaigns.map(cp=>(
            <div key={cp.id} className="rounded-2xl p-3 flex items-center gap-3"
              style={{background:'rgba(0,220,90,0.06)',border:'1px solid rgba(0,220,90,0.2)'}}>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{color:C.t1}}>{cp.prod}</p>
                <p className="text-xs mt-0.5" style={{color:C.t3}}>Тариф: {cp.plan} · Охват {cp.reach} · {cp.started}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full"
                style={{background:'rgba(0,220,90,0.15)',color:C.green}}>Активна</span>
            </div>
          ))}
        </div>
      )}
      {done && <div className="mt-3 rounded-2xl p-3 text-center" style={{background:'rgba(0,220,90,0.08)',border:'1px solid rgba(0,220,90,0.2)'}}>
        <p className="text-xs font-semibold flex items-center justify-center gap-1.5" style={{color:C.green}}>
          <Check size={13}/> {done}
        </p>
      </div>}
      <div className="mt-4 space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{color:C.t3}}>Тарифы</p>
        {AD_PLANS_PC.map(p=>(
          <div key={p.id} onClick={()=>setPlan(p.id)}
            className="rounded-2xl p-4 cursor-pointer"
            style={{background:plan===p.id?`${p.color}10`:C.l1,
              border:`${plan===p.id?1.5:1}px solid ${plan===p.id?p.color+'60':C.brd}`}}>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm font-bold" style={{color:C.t1}}>{p.name}</p>
              <p className="text-lg font-black" style={{color:p.color}}>{p.price.toLocaleString('ru')} ₽</p>
            </div>
            <p className="text-xs" style={{color:C.t2}}>{p.desc}</p>
            <p className="text-[11px] mt-1 font-semibold" style={{color:p.color}}>Охват: {p.reach}</p>
          </div>
        ))}
      </div>
      {plan && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest" style={{color:C.t3}}>Товар для рекламы</p>
          <select value={prodId} onChange={e=>setProdId(e.target.value)}
            className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
            style={{background:C.l1,border:`1px solid ${C.brd}`,color:prodId?C.t1:C.t3}}>
            <option value="">Выберите товар...</option>
            {myProds.map(p=><option key={p.id} value={p.id}>{p.title} — {p.price.toLocaleString('ru')} ₽</option>)}
          </select>
          {prodId && (
            <button type="button" onClick={buy}
              className="w-full rounded-2xl py-3 text-sm font-bold text-white"
              style={{background:C.acc}}>
              Запустить за {AD_PLANS_PC.find(x=>x.id===plan)?.price.toLocaleString('ru')} ₽
            </button>
          )}
        </div>
      )}
    </div>
  );
};


const SellerDashboard = ({seller}:{seller:SellerProfile}) => {
  const [view, setView] = useState<SellerView>('overview');
  const { orders, products } = useMarketStore();
  const newOrders = orders.filter(o=>o.sellerId===seller.accountId&&o.status==='pending').length;
  const myProds   = products.filter(p=>p.sellerId===seller.accountId&&p.active).length;
  const lowStock  = products.filter(p=>p.sellerId===seller.accountId&&p.stock<=3&&p.stock>0).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Dashboard header */}
      <div className="shrink-0 px-4 py-3"
        style={{background:C.l1,borderBottom:`1px solid ${C.brd}`}}>
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl text-sm font-black text-white shrink-0"
            style={{background:`linear-gradient(135deg,${C.acc},#8b5cf6)`}}>
            {seller.shopName[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{color:C.t1}}>{seller.shopName}</p>
            <div className="flex items-center gap-2">
              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold inline-flex items-center gap-1"
                style={{background:'rgba(0,220,90,0.12)',color:C.green}}>
                <span className="inline-block h-1 w-1 rounded-full" style={{background:C.green}}/> Активен
              </span>
              <Stars rating={seller.rating} size={10}/>
            </div>
          </div>
          {(newOrders > 0 || lowStock > 0) && (
            <div className="flex gap-1.5">
              {newOrders > 0 && (
                <div className="flex items-center gap-1 rounded-full px-2 py-1"
                  style={{background:'rgba(244,63,94,0.12)',border:'1px solid rgba(244,63,94,0.2)'}}>
                  <span className="text-[9px] font-black" style={{color:C.red}}>{newOrders} новых</span>
                </div>
              )}
              {lowStock > 0 && (
                <div className="flex items-center gap-1 rounded-full px-2 py-1"
                  style={{background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.2)'}}>
                  <span className="text-[9px] font-black" style={{color:C.amber}}>Мало</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <div className="flex overflow-x-auto shrink-0" style={{scrollbarWidth:'none',borderBottom:`1px solid ${C.brd}`,background:C.l1}}>
        {SELLER_TABS.map(t=>{
          const Icon = t.icon;
          const badge = t.key==='orders' ? newOrders : 0;
          return (
            <button key={t.key} type="button" onClick={()=>setView(t.key)}
              className="relative flex-1 shrink-0 flex flex-col items-center gap-0.5 py-2.5 transition-colors"
              style={{color:view===t.key?C.acc:C.t3,minWidth:60}}>
              <Icon size={15} strokeWidth={view===t.key?2.2:1.6}/>
              <span className="text-[9px] font-semibold">{t.label}</span>
              {badge > 0 && (
                <span className="absolute top-1 right-1/4 grid h-3.5 min-w-[14px] place-items-center rounded-full text-[7px] font-black text-white"
                  style={{background:C.red}}>{badge}</span>
              )}
              {view===t.key && (
                <motion.div layoutId="seller-tab"
                  className="absolute bottom-0 inset-x-2 h-[2px] rounded-full"
                  style={{background:C.acc}}/>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={view} className="h-full"
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.1}}>
            {view==='overview'  && <SellerAnalytics seller={seller} sellerId={seller.accountId}/>}
            {view==='products'  && <SellerProducts sellerId={seller.accountId}/>}
            {view==='orders'    && <SellerOrders sellerId={seller.accountId}/>}
            {view==='analytics' && <SellerAnalytics seller={seller} sellerId={seller.accountId}/>}
            {view==='couriers'  && <CourierHub sellerId={seller.accountId} orders={orders.filter(o=>o.sellerId===seller.accountId)}/>}
            {view==='transport' && <TransportCompanyHub/>}
            {view==='warehouses'&& <WarehouseHub/>}
            {view==='shipments' && <ShipmentHub/>}
            {view==='passes'    && <PassHub/>}
            {view==='ads'       && <SellerAdsPanel seller={seller}/>}
            {view==='settings'  && <SellerSettings seller={seller}/>}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};


/* ══════════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════════ */
type Tab = 'catalog'|'gaming'|'services'|'orders'|'seller';

export const SkyMarket = () => {
  const cart     = useCart();
  const wishlist = useWishlist();
  const history  = useHistory();
  const [tab,       setTab]       = useState<Tab>('catalog');
  const [showCart,  setShowCart]  = useState(false);
  const [checkout,  setCheckout]  = useState(false);
  const { mySeller, becomeSeller } = useMarketStore();
  const { currentUserId } = useAuthStore();
  const seller = mySeller();

  return (
    <div className="relative flex h-full flex-col overflow-hidden" style={{ background:C.bg }}>

      {/* ── Header ──────────────────────────────────────── */}
      <div className="shrink-0" style={{ background:C.l1, borderBottom:`1px solid ${C.brd}` }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 flex-1">
            <Store size={18} style={{ color:C.acc }}/>
            <p className="text-base font-bold" style={{ color:C.t1 }}>Sky Market</p>
          </div>
          <button type="button" onClick={() => setShowCart(true)}
            className="relative grid h-9 w-9 place-items-center rounded-xl"
            style={{ background:cart.count > 0 ? C.accBg : C.l2, color:cart.count > 0 ? C.acc : C.t3,
              border:`1px solid ${cart.count > 0 ? 'rgba(79,110,247,0.25)' : C.brd}` }}>
            <ShoppingCart size={16}/>
            {cart.count > 0 && (
              <span className="absolute -top-1 -right-1 grid h-4 min-w-[16px] place-items-center rounded-full text-[8px] font-black text-white"
                style={{ background:C.red }}>
                {cart.count}
              </span>
            )}
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex overflow-x-auto" style={{ scrollbarWidth:'none', borderTop:`1px solid ${C.brd}` }}>
          {([
            { key:'catalog',  label:'Каталог'   },
            { key:'gaming',   label:'Игры'       },
            { key:'services', label:'Сервисы'    },
            { key:'orders',   label:'Заказы' },
            { key:'seller',   label:seller ? 'Магазин' : 'Продавать' },
          ] as {key:Tab;label:string}[]).map(t => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className="relative shrink-0 px-4 py-2.5 text-[12px] font-semibold transition-colors"
              style={{ color: tab===t.key ? C.t1 : C.t3 }}>
              {t.label}
              {tab===t.key && (
                <motion.div layoutId="market-tab"
                  className="absolute bottom-0 inset-x-0 h-[2px]"
                  style={{ background:C.acc }}/>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} className="h-full"
            initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            transition={{ duration:0.1 }}>
            {tab==='catalog'  && <Catalog cart={cart} wishlist={wishlist} history={history}/>}
            {tab==='gaming'   && <GamingMarket/>}
            {tab==='services' && <ServicesMarket/>}
            {tab==='orders'   && <OrdersView/>}
            {tab==='seller'   && (
              seller
                ? <SellerDashboard seller={seller}/>
                : <BecomeSellerView onDone={() => {/* seller now set */}}/>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Cart drawer ─────────────────────────────────── */}
      <AnimatePresence>
        {showCart && !checkout && (
          <CartDrawer
            cart={cart} onClose={() => setShowCart(false)}
            onRemove={cart.remove} onSetQty={cart.setQty}
            onCheckout={() => setCheckout(true)}/>
        )}
        {checkout && (
          <motion.div initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
            transition={{ type:'spring', damping:28, stiffness:300 }}
            className="absolute inset-0 z-50" style={{ background:C.bg }}>
            <div className="flex items-center gap-3 px-4 py-3 shrink-0"
              style={{ borderBottom:`1px solid ${C.brd}` }}>
              <button type="button" onClick={() => setCheckout(false)}
                className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color:C.acc }}>
                <ArrowLeft size={18}/>
              </button>
              <p className="text-sm font-bold" style={{ color:C.t1 }}>Оформление заказа</p>
            </div>
            <Checkout cart={cart} onDone={() => { setCheckout(false); setShowCart(false); setTab('orders'); }}/>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
