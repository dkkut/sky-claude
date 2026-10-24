/**
 * SKY MARKET
 *
 * Витрина, товар, оформление заказа и вкладки. Данные берутся с
 * сервера: каталог, цена, наличие и состояние заказа приходят оттуда и
 * там же решаются. Ничего из показанного здесь не хранится в браузере
 * между запусками — собранная в браузере витрина показывает то, что
 * удобно браузеру.
 *
 * Про деньги коротко: Sky их не держит. Покупатель переводит продавцу
 * напрямую, у нас нет ни баланса продавца, ни вывода, ни комиссии.
 * Единственная плата — подписка продавца за место на витрине, и она
 * живёт в кабинете.
 */
import { OnsiteTab } from './onsite/Onsite';
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Heart, ArrowLeft, Store, Bell, SlidersHorizontal,
  MapPin, Warehouse,
} from 'lucide-react';
import { useAuthStore } from '@/core/auth/store';
import { useMarketStore } from './store';
import {
  C, fmt, fmtTs, fmtTime, Stars, Empty, Field,
  inputStyle, Alert, ProductCard, ProductImage, ProductLogo, CatIcon, CAT_CFG,
} from './ui';
import {
  apiProduct, apiProductReviews, apiCreateOrder, apiPickupPoints, apiMarketTicket,
} from './marketApi';
import type {
  Product, Review, ProductCategory, PickupPoint, MarketType,
} from './types';
import { CATEGORY_LABEL } from './types';
import { OrdersList, OrderPage } from './OrderScreens';
import { ParcelLookup } from './ParcelTracking';
import { BecomeSeller, SellerCabinet } from './SellerCabinet';
import { OriginBlock } from './ProductCompliance';
import { ReportButton } from './ReportButton';
import { CarrierCabinet } from './CarrierCabinet';
import { PvzCabinet } from './PvzCabinet';
import { GamingMarket } from './SkyGamingMarket';
import { ServicesMarket } from './SkyServicesMarket';

/* Эти три нужны другим модулям (подарки, логистика) — они рисуют
   карточки в том же наборе цветов. */
export { C, fmt, fmtTs, fmtNum, Stars, StatCard } from './ui';

/* ── Оформление заказа ────────────────────────────────────────────── */

/**
 * Куда везти.
 *
 * Для обычного товара нужен адрес или пункт выдачи — что-то одно.
 * Игровому лоту не нужно ни то, ни другое: там нечего везти.
 */
const Checkout = ({ product, onDone, onBack }:
{ product: Product; onDone: (orderId: string) => void; onBack: () => void }) => {
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState<'address' | 'pickup'>('address');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [pointId, setPointId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const game = product.marketType === 'game';

  useEffect(() => {
    if (game) return;
    void (async () => {
      const r = await apiPickupPoints();
      if (r.ok && r.data) setPoints(r.data.points);
    })();
  }, [game]);

  const buy = async () => {
    setBusy(true); setError(null);
    const r = await apiCreateOrder({
      productId: product.id,
      quantity,
      address: !game && mode === 'address' ? address.trim() : undefined,
      contact: contact.trim() || undefined,
      pickupPointId: !game && mode === 'pickup' ? pointId : undefined,
    });
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Заказ не оформился'); return; }
    onDone(r.data.order.id);
  };

  const ready = game || (mode === 'address' ? address.trim().length > 4 : Boolean(pointId));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.acc }}>
          <ArrowLeft size={18} />
        </button>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Оформление заказа</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="flex items-center gap-3 rounded-2xl p-3"
          style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <ProductImage imageId={product.images[0]} alt={product.title}
            className="h-14 w-14 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold" style={{ color: C.t1 }}>{product.title}</p>
            <p className="text-[11px]" style={{ color: C.t3 }}>{product.sellerName}</p>
          </div>
          <p className="text-sm font-black" style={{ color: C.t1 }}>{fmt(product.price)}</p>
        </div>

        <Field label="Сколько">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>−</button>
            <p className="w-10 text-center text-sm font-bold" style={{ color: C.t1 }}>{quantity}</p>
            <button type="button" onClick={() => setQuantity((q) => Math.min(product.stock, q + 1))}
              className="grid h-9 w-9 place-items-center rounded-xl"
              style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>+</button>
            <p className="ml-auto text-[11px]" style={{ color: C.t3 }}>в наличии {product.stock}</p>
          </div>
        </Field>

        {!game && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {([['address', 'До двери', MapPin], ['pickup', 'В пункт выдачи', Warehouse]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setMode(k)}
                  className="flex items-center justify-center gap-2 rounded-xl py-2 text-[11px] font-semibold"
                  style={{
                    background: mode === k ? C.accBg : C.l2,
                    color: mode === k ? C.acc : C.t2,
                    border: `1px solid ${mode === k ? 'rgba(79,110,247,0.3)' : C.brd}`,
                  }}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {mode === 'address' ? (
              <Field label="Адрес доставки"
                hint="Адрес хранится зашифрованным и открывается продавцу только после оплаты.">
                <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={400}
                  placeholder="Город, улица, дом, квартира"
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
              </Field>
            ) : (
              <Field label="Пункт выдачи">
                <select value={pointId} onChange={(e) => setPointId(e.target.value)}
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
                  <option value="">Выберите пункт</option>
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>{p.city}, {p.address} · хранение {p.holdDays} дн.</option>
                  ))}
                </select>
              </Field>
            )}
          </>
        )}

        <Field label="Как с вами связаться" hint="Телефон или ник — по желанию.">
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200}
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        </Field>

        <div className="rounded-2xl px-3 py-2 text-[11px]"
          style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          Оплата идёт напрямую продавцу: Sky деньги не принимает и не хранит.
          Как переводить — договоритесь в чате заказа, он откроется сразу после оформления.
        </div>

        {error && <Alert text={error} />}

        <div className="flex items-center justify-between rounded-2xl p-3"
          style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[12px]" style={{ color: C.t2 }}>Итого</p>
          <p className="text-lg font-black" style={{ color: C.t1 }}>{fmt(product.price * quantity)}</p>
        </div>

        <button type="button" disabled={!ready || busy} onClick={buy}
          className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {busy ? 'Оформляем…' : 'Оформить заказ'}
        </button>
      </div>
    </div>
  );
};

/* ── Страница товара ──────────────────────────────────────────────── */

export const ProductPage = ({ productId, onBack, onOrdered }:
{ productId: string; onBack: () => void; onOrdered: (orderId: string) => void }) => {
  const { toggleFavorite } = useMarketStore();
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [shot, setShot] = useState(0);
  const [checkout, setCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [p, r] = await Promise.all([apiProduct(productId), apiProductReviews(productId)]);
      if (p.ok && p.data) setProduct(p.data.product);
      else setError(p.reason ?? 'Товар не найден');
      if (r.ok && r.data) setReviews(r.data.reviews);
    })();
  }, [productId]);

  if (!product) {
    return (
      <div className="p-4">
        {error ? <Alert text={error} /> : <p className="text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>}
      </div>
    );
  }

  if (checkout) {
    return <Checkout product={product} onBack={() => setCheckout(false)} onDone={onOrdered} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.acc }}>
          <ArrowLeft size={18} />
        </button>
        <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{product.title}</p>
        <button type="button" onClick={() => toggleFavorite(product)}
          className="ml-auto grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.l2 }}>
          <Heart size={15} style={{ color: product.favorite ? C.red : C.t3 }}
            fill={product.favorite ? C.red : 'none'} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ProductImage imageId={product.images[shot]} alt={product.title}
          className="h-56 w-full object-cover" />
        {product.images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto p-3">
            {product.images.map((id, i) => (
              <button key={id} type="button" onClick={() => setShot(i)}>
                <ProductImage imageId={id} alt="" className="h-12 w-12 rounded-lg object-cover"
                  style={{ outline: i === shot ? `2px solid ${C.acc}` : 'none' }} />
              </button>
            ))}
          </div>
        )}

        <div className="space-y-3 p-4">
          <div>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-black" style={{ color: C.t1 }}>{fmt(product.price)}</p>
              {product.oldPrice != null && (
                <p className="text-[12px] line-through" style={{ color: C.t3 }}>{fmt(product.oldPrice)}</p>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ProductLogo product={product} size={32} />
              <p className="text-[13px] font-semibold" style={{ color: C.t1 }}>{product.title}</p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Stars rating={product.rating} />
              <span className="text-[11px]" style={{ color: C.t3 }}>
                {product.reviewCount > 0 ? `${product.reviewCount} отзывов` : 'отзывов пока нет'}
              </span>
              <span className="text-[11px]" style={{ color: C.t3 }}>· продано {product.sold}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-2xl p-3"
            style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <Store size={15} style={{ color: C.acc }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold" style={{ color: C.t1 }}>
                {product.sellerName}
                {product.sellerTaxKind && (
                  <span className="ml-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: C.l2, color: C.t2 }}>
                    {({ individual: 'Частное лицо', npd: 'Самозанятый', ip: 'ИП', legal: 'Организация' } as Record<string, string>)[product.sellerTaxKind]}
                  </span>
                )}
              </p>
              {product.sellerRating != null && (
                <div className="flex items-center gap-1">
                  <Stars rating={product.sellerRating} size={10} />
                  <span className="text-[10px]" style={{ color: C.t3 }}>{product.sellerRating.toFixed(1)}</span>
                </div>
              )}
            </div>
          </div>

          {product.marketType === 'game' ? (
            <div className="flex flex-wrap gap-2">
              {product.gameTitle && (
                <span className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                  style={{ background: C.l2, color: C.t2 }}>{product.gameTitle}</span>
              )}
              {product.region && (
                <span className="rounded-lg px-2 py-1 text-[10px] font-semibold"
                  style={{ background: C.l2, color: C.t2 }}>Регион: {product.region}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CatIcon cat={product.category} size={14} />
              <span className="text-[11px]" style={{ color: C.t2 }}>
                {CATEGORY_LABEL[product.category]}
              </span>
            </div>
          )}

          {product.description && (
            <p className="whitespace-pre-wrap text-[12px]" style={{ color: C.t2 }}>{product.description}</p>
          )}

          {product.marketType === 'standard' && <OriginBlock product={product} />}

          <div className="rounded-2xl px-3 py-2 text-[11px]"
            style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
            {product.marketType === 'game'
              ? 'Игровой лот: доставки и трек-номера нет. Продавец выдаёт товар в игре, вы подтверждаете выдачу.'
              : 'Доставку выбирает продавец: службой в пункт выдачи или до двери, либо привезёт сам.'}
          </div>

          {!product.own && <ReportButton targetType="product" targetId={product.id} />}

          {reviews.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Отзывы</p>
              {reviews.map((r) => (
                <div key={r.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold" style={{ color: C.t1 }}>{r.buyerName}</p>
                    <Stars rating={r.rating} size={10} />
                  </div>
                  {r.text && <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>{r.text}</p>}
                  <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>{fmtTs(r.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 p-4" style={{ borderTop: `1px solid ${C.brd}` }}>
        <button type="button" disabled={!product.inStock || product.own} onClick={() => setCheckout(true)}
          className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {product.own ? 'Это ваш товар' : product.inStock ? 'Купить товар' : 'Нет в наличии'}
        </button>
      </div>
    </div>
  );
};

/* ── Каталог ──────────────────────────────────────────────────────── */

export const Catalog = ({ marketType = 'standard', onOpen }:
{ marketType?: MarketType; onOpen: (id: string) => void }) => {
  const { catalog, catalogLoading, catalogError, loadCatalog, toggleFavorite } = useMarketStore();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ProductCategory | ''>('');
  const [sort, setSort] = useState<'new' | 'cheap' | 'expensive' | 'popular' | 'rating'>('new');
  const [shipping, setShipping] = useState<'' | 'ru' | 'abroad' | 'intl'>('');
  const [filters, setFilters] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCatalog({ type: marketType, q: q.trim() || undefined, category: category || undefined, sort, shipping: shipping || undefined });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, category, sort, marketType, shipping]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 p-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
            <Search size={14} style={{ color: C.t3 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Что ищем"
              className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: C.t1 }} />
            {q && <button type="button" onClick={() => setQ('')}><X size={13} style={{ color: C.t3 }} /></button>}
          </div>
          <button type="button" onClick={() => setFilters((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: filters ? C.accBg : C.l2, color: filters ? C.acc : C.t3 }}>
            <SlidersHorizontal size={15} />
          </button>
        </div>

        {filters && (
          <div className="space-y-2">
            <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              {(['new', 'cheap', 'expensive', 'popular', 'rating'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSort(s)}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
                  style={{
                    background: sort === s ? C.accBg : C.l2,
                    color: sort === s ? C.acc : C.t3,
                  }}>
                  {{ new: 'Сначала новые', cheap: 'Дешевле', expensive: 'Дороже', popular: 'Популярные', rating: 'По рейтингу' }[s]}
                </button>
              ))}
            </div>
            {marketType === 'standard' && (
              <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                {([['', 'Все товары'], ['ru', 'Отправка из России'], ['abroad', 'Отправка из-за рубежа'], ['intl', 'Международная доставка']] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setShipping(k)}
                    className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
                    style={{ background: shipping === k ? C.accBg : C.l2, color: shipping === k ? C.acc : C.t3 }}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            {marketType === 'standard' && (
              <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                <button type="button" onClick={() => setCategory('')}
                  className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
                  style={{ background: category === '' ? C.accBg : C.l2, color: category === '' ? C.acc : C.t3 }}>
                  Все
                </button>
                {(Object.keys(CAT_CFG) as ProductCategory[]).map((k) => (
                  <button key={k} type="button" onClick={() => setCategory(k)}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
                    style={{ background: category === k ? C.accBg : C.l2, color: category === k ? C.acc : C.t3 }}>
                    <CatIcon cat={k} size={11} color={category === k ? C.acc : C.t3} />
                    {CATEGORY_LABEL[k]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {catalogError && <Alert text={catalogError} />}
        {catalogLoading && catalog.length === 0 && (
          <p className="py-8 text-center text-[12px]" style={{ color: C.t3 }}>Загружаем каталог…</p>
        )}
        {!catalogLoading && catalog.length === 0 && !catalogError && (
          <Empty title="Ничего не нашлось" hint="Попробуйте другой запрос" />
        )}
        <div className="grid grid-cols-2 gap-2">
          {catalog.map((p) => (
            <ProductCard key={p.id} product={p} onOpen={() => onOpen(p.id)}
              onFavorite={() => toggleFavorite(p)} />
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Мои заказы ───────────────────────────────────────────────────── */

const MyOrders = ({ meId }: { meId: string }) => {
  const { ordersBuy, loadOrders, patchOrder } = useMarketStore();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { void loadOrders('buyer'); }, []);

  if (open) {
    return (
      <OrderPage orderId={open} meId={meId} onBack={() => { setOpen(null); void loadOrders('buyer'); }}
        onChanged={patchOrder} />
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      <OrdersList orders={ordersBuy} onOpen={setOpen} empty="Заказов пока нет" />
      <ParcelLookup />
    </div>
  );
};

/* ── Избранное ────────────────────────────────────────────────────── */

const Favorites = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const { favorites, loadFavorites, toggleFavorite } = useMarketStore();
  useEffect(() => { void loadFavorites(); }, []);

  return (
    <div className="h-full overflow-y-auto p-3">
      {favorites.length === 0 && <Empty title="Избранного пока нет" Icon={Heart} />}
      <div className="grid grid-cols-2 gap-2">
        {favorites.map((p) => (
          <ProductCard key={p.id} product={p} onOpen={() => onOpen(p.id)}
            onFavorite={() => toggleFavorite(p)} />
        ))}
      </div>
    </div>
  );
};

/* ── Уведомления ──────────────────────────────────────────────────── */

const Notifications = ({ onOpenOrder }: { onOpenOrder: (id: string) => void }) => {
  const { notifications, loadNotifications, readAllNotifications } = useMarketStore();
  useEffect(() => { void loadNotifications(); }, []);

  return (
    <div className="h-full space-y-2 overflow-y-auto p-4">
      {notifications.length > 0 && (
        <button type="button" onClick={readAllNotifications}
          className="text-[11px] font-semibold" style={{ color: C.acc }}>
          Отметить всё прочитанным
        </button>
      )}
      {notifications.length === 0 && <Empty title="Уведомлений нет" Icon={Bell} />}
      {notifications.map((n) => (
        <button key={n.id} type="button"
          onClick={() => n.orderId && onOpenOrder(n.orderId)}
          className="block w-full rounded-2xl p-3 text-left"
          style={{
            background: C.l1,
            border: `1px solid ${n.read ? C.brd : 'rgba(79,110,247,0.3)'}`,
          }}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }}>{n.title}</p>
          {n.body && <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>{n.body}</p>}
          <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>{fmtTime(n.createdAt)}</p>
        </button>
      ))}
    </div>
  );
};

/* ── Корень ───────────────────────────────────────────────────────── */

type Tab = 'catalog' | 'onsite' | 'gaming' | 'services' | 'orders' | 'fav' | 'seller' | 'carrier' | 'pvz' | 'bell';

export const SkyMarket = () => {
  const { currentUserId } = useAuthStore();
  const meId = currentUserId ?? '';
  const {
    seller, sellerLoaded, loadSeller, loadConfig, notifications, loadNotifications,
    myCarriers, loadCarrier, myPvz, loadMyPvz,
  } = useMarketStore();
  const [tab, setTab] = useState<Tab>('catalog');
  const [product, setProduct] = useState<string | null>(null);
  const [order, setOrder] = useState<string | null>(null);

  useEffect(() => {
    /* Первым делом пропуск: без него ни одна картинка не загрузится —
       тег <img> заголовок авторизации не отправляет. */
    void apiMarketTicket();
    void loadConfig();
    void loadSeller();
    void loadNotifications();
    /* Вкладка своей транспортной компании появляется только у того, у
       кого такая компания есть: остальным она не нужна. То же самое —
       вкладка кабинета ПВЗ: только тем, кто где-то там работает. */
    void loadCarrier();
    void loadMyPvz();
  }, []);

  const unreadNotes = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const openOrder = (id: string) => { setProduct(null); setOrder(id); };

  return (
    <div className="relative flex h-full flex-col overflow-hidden" style={{ background: C.bg }}>
      <div className="shrink-0" style={{ background: C.l1, borderBottom: `1px solid ${C.brd}` }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex flex-1 items-center gap-2">
            <Store size={18} style={{ color: C.acc }} />
            <p className="text-base font-bold" style={{ color: C.t1 }}>Sky Market</p>
          </div>
          <button type="button" onClick={() => { setProduct(null); setOrder(null); setTab('bell'); }}
            className="relative grid h-9 w-9 place-items-center rounded-xl"
            style={{ background: C.l2, color: C.t3 }}>
            <Bell size={16} />
            {unreadNotes > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full text-[8px] font-black text-white"
                style={{ background: C.red }}>{unreadNotes}</span>
            )}
          </button>
        </div>

        <div className="glass-pill mx-3 my-2 flex overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {([
            { key: 'catalog',  label: 'Каталог' },
            { key: 'onsite',   label: 'На месте' },
            { key: 'gaming',   label: 'Игры' },
            { key: 'services', label: 'Сервисы' },
            { key: 'orders',   label: 'Заказы' },
            { key: 'fav',      label: 'Избранное' },
            { key: 'seller',   label: seller ? 'Магазин' : 'Продавать' },
            ...(myCarriers.length > 0 ? [{ key: 'carrier' as Tab, label: 'Доставка' }] : []),
            { key: 'pvz' as Tab, label: myPvz.length > 0 ? 'Пункт выдачи' : 'Открыть ПВЗ' },
          ] as { key: Tab; label: string }[]).map((t) => (
            <button key={t.key} type="button"
              onClick={() => { setProduct(null); setOrder(null); setTab(t.key); }}
              className="relative isolate shrink-0 rounded-full px-4 py-2 text-[12px] font-semibold transition-colors"
              style={{ color: tab === t.key ? C.t1 : C.t3 }}>
              {t.label}
              {tab === t.key && (
                <motion.div layoutId="market-tab" className="glass-lens absolute inset-0 -z-10"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {order ? (
          <OrderPage orderId={order} meId={meId} onBack={() => setOrder(null)} />
        ) : product ? (
          <ProductPage productId={product} onBack={() => setProduct(null)}
            onOrdered={(id) => { setProduct(null); setOrder(id); }} />
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={tab} className="h-full"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}>
              {tab === 'catalog' && <Catalog marketType="standard" onOpen={setProduct} />}
              {tab === 'onsite' && <OnsiteTab />}
              {tab === 'gaming' && <GamingMarket onOpen={setProduct} />}
              {tab === 'services' && <ServicesMarket onOrdered={openOrder} />}
              {tab === 'orders' && <MyOrders meId={meId} />}
              {tab === 'fav' && <Favorites onOpen={setProduct} />}
              {tab === 'bell' && <Notifications onOpenOrder={openOrder} />}
              {tab === 'carrier' && <CarrierCabinet />}
              {tab === 'pvz' && <PvzCabinet />}
              {tab === 'seller' && (
                !sellerLoaded
                  ? <p className="p-4 text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>
                  : seller
                    ? <SellerCabinet seller={seller} meId={meId} />
                    : <BecomeSeller />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
