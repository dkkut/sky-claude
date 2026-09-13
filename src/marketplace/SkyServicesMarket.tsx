/**
 * SKY SERVICES — биржа услуг.
 *
 * Услуга — тот же товар Sky Market, только третьего типа. Поэтому здесь
 * нет второй витрины со своими правилами: карточки, картинки, заказ,
 * чат сделки, отзывы и реквизиты продавца — общие с остальным маркетом.
 * Отличие ровно одно: услуга продаётся пакетом.
 *
 * Раньше этот раздел был списком выдуманных объявлений в памяти
 * вкладки: выложить свою услугу было нельзя вообще, а «заказ» никуда
 * не уходил.
 *
 * Про деньги — как везде в маркете: Sky их не хранит, заказчик платит
 * исполнителю напрямую по реквизитам из его профиля.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, X, ArrowLeft, Clock, RefreshCw, Check, Briefcase } from 'lucide-react';
import { C, fmt, Stars, Empty, Field, inputStyle, Alert, ProductImage, ProductLogo } from './ui';
import { useMarketStore } from './store';
import { apiProduct, apiProductReviews, apiCreateOrder } from './marketApi';
import type {
  Product, Review, ServiceCategory, ServiceLevel, ServicePackage,
} from './types';
import { SERVICE_CATEGORY_LABEL, SERVICE_LEVEL_LABEL } from './types';

/* ── Карточка услуги ──────────────────────────────────────────────── */

const ServiceCard = ({ product, onOpen }: { product: Product; onOpen: () => void }) => {
  const from = product.packages?.length
    ? Math.min(...product.packages.map((p) => p.price))
    : product.price;

  return (
    <button type="button" onClick={onOpen}
      className="w-full overflow-hidden rounded-2xl text-left"
      style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <ProductImage imageId={product.images[0]} alt={product.title}
        className="h-28 w-full object-cover" style={{ display: 'block' }} />
      <div className="p-3">
        <div className="flex items-start gap-2">
          <ProductLogo product={product} size={26} />
          <p className="line-clamp-2 text-[12px] font-semibold" style={{ color: C.t1 }}>{product.title}</p>
        </div>
        <p className="mt-1 truncate text-[10px]" style={{ color: C.t3 }}>{product.sellerName}</p>
        <div className="mt-1 flex items-center gap-1">
          <Stars rating={product.rating} size={10} />
          <span className="text-[9px]" style={{ color: C.t3 }}>
            {product.reviewCount > 0 ? product.reviewCount : 'нет отзывов'}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] font-black" style={{ color: C.t1 }}>от {fmt(from)}</p>
      </div>
    </button>
  );
};

/* ── Оформление заказа услуги ─────────────────────────────────────── */

const OrderService = ({ product, pack, onDone, onBack }: {
  product: Product;
  pack: ServicePackage;
  onDone: (orderId: string) => void;
  onBack: () => void;
}) => {
  const [requirements, setRequirements] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = async () => {
    setBusy(true); setError(null);
    /* Уходит уровень пакета, а не его цена: цену берёт сервер. */
    const r = await apiCreateOrder({
      productId: product.id,
      quantity: 1,
      packageLevel: pack.level,
      requirements: requirements.trim() || undefined,
      contact: contact.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Заказ не оформился'); return; }
    onDone(r.data.order.id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.acc }}>
          <ArrowLeft size={18} />
        </button>
        <p className="text-sm font-bold" style={{ color: C.t1 }}>Заказ услуги</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <p className="text-[12px] font-semibold" style={{ color: C.t1 }}>{product.title}</p>
          <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>
            Пакет «{pack.title}» · {SERVICE_LEVEL_LABEL[pack.level]}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <p className="flex items-center gap-1 text-[11px]" style={{ color: C.t2 }}>
              <Clock size={11} /> {pack.delivery} дн.
            </p>
            <p className="text-lg font-black" style={{ color: C.t1 }}>{fmt(pack.price)}</p>
          </div>
        </div>

        <Field label="Что нужно сделать"
          hint="Требования видит только исполнитель. Хранятся зашифрованными.">
          <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)}
            rows={5} maxLength={4000} placeholder="Опишите задачу, ссылки, пожелания"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        </Field>

        <Field label="Как с вами связаться" hint="По желанию.">
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200}
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        </Field>

        <div className="rounded-2xl px-3 py-2 text-[11px]"
          style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          Оплата идёт напрямую исполнителю: Sky деньги не принимает и не хранит.
          Реквизиты появятся на странице заказа сразу после оформления.
        </div>

        {error && <Alert text={error} />}

        <button type="button" disabled={busy} onClick={buy}
          className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {busy ? 'Оформляем…' : `Заказать за ${fmt(pack.price)}`}
        </button>
      </div>
    </div>
  );
};

/* ── Карточка услуги целиком ──────────────────────────────────────── */

const ServicePage = ({ productId, onBack, onOrdered }: {
  productId: string;
  onBack: () => void;
  onOrdered: (orderId: string) => void;
}) => {
  const [product, setProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [picked, setPicked] = useState<ServiceLevel | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [p, r] = await Promise.all([apiProduct(productId), apiProductReviews(productId)]);
      if (p.ok && p.data) {
        setProduct(p.data.product);
        setPicked(p.data.product.packages?.[0]?.level ?? null);
      } else setError(p.reason ?? 'Услуга не найдена');
      if (r.ok && r.data) setReviews(r.data.reviews);
    })();
  }, [productId]);

  const pack = useMemo(
    () => product?.packages?.find((p) => p.level === picked) ?? null,
    [product, picked]);

  if (!product) {
    return (
      <div className="p-4">
        {error ? <Alert text={error} /> : <p className="text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>}
      </div>
    );
  }

  if (ordering && pack) {
    return <OrderService product={product} pack={pack} onBack={() => setOrdering(false)} onDone={onOrdered} />;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <button type="button" onClick={onBack}
          className="grid h-9 w-9 place-items-center rounded-xl hover:bg-white/5" style={{ color: C.acc }}>
          <ArrowLeft size={18} />
        </button>
        <p className="truncate text-sm font-bold" style={{ color: C.t1 }}>{product.title}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        <ProductImage imageId={product.images[0]} alt={product.title} className="h-48 w-full object-cover" />

        <div className="space-y-3 p-4">
          <div>
            <div className="flex items-center gap-2">
              <ProductLogo product={product} size={32} />
              <p className="text-[13px] font-semibold" style={{ color: C.t1 }}>{product.title}</p>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <Stars rating={product.rating} />
              <span className="text-[11px]" style={{ color: C.t3 }}>
                {product.reviewCount > 0 ? `${product.reviewCount} отзывов` : 'отзывов пока нет'}
              </span>
              <span className="text-[11px]" style={{ color: C.t3 }}>· выполнено {product.sold}</span>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: C.t3 }}>
              {product.sellerName}
              {product.serviceCategory && ` · ${SERVICE_CATEGORY_LABEL[product.serviceCategory]}`}
            </p>
          </div>

          {product.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {product.tags.map((t) => (
                <span key={t} className="rounded-lg px-2 py-0.5 text-[10px]"
                  style={{ background: C.l2, color: C.t3 }}>#{t}</span>
              ))}
            </div>
          )}

          {product.description && (
            <p className="whitespace-pre-wrap text-[12px]" style={{ color: C.t2 }}>{product.description}</p>
          )}

          {product.images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {product.images.slice(1).map((id) => (
                <ProductImage key={id} imageId={id} alt="" className="h-20 w-20 rounded-xl object-cover" />
              ))}
            </div>
          )}

          {/* Пакеты */}
          {(product.packages ?? []).length === 0 ? (
            <Alert kind="info" text="Исполнитель ещё не описал пакеты этой услуги." />
          ) : (
            <div className="space-y-2">
              <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Пакеты</p>
              {product.packages!.map((p) => (
                <button key={p.level} type="button" onClick={() => setPicked(p.level)}
                  className="block w-full rounded-2xl p-3 text-left"
                  style={{
                    background: picked === p.level ? C.accBg : C.l1,
                    border: `1px solid ${picked === p.level ? 'rgba(79,110,247,0.35)' : C.brd}`,
                  }}>
                  <div className="flex items-center justify-between">
                    <p className="text-[12px] font-bold" style={{ color: C.t1 }}>
                      {p.title} <span style={{ color: C.t3 }}>· {SERVICE_LEVEL_LABEL[p.level]}</span>
                    </p>
                    <p className="text-sm font-black" style={{ color: C.t1 }}>{fmt(p.price)}</p>
                  </div>
                  {p.description && (
                    <p className="mt-1 text-[11px]" style={{ color: C.t2 }}>{p.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[10px]" style={{ color: C.t3 }}>
                    <span className="flex items-center gap-1"><Clock size={10} /> {p.delivery} дн.</span>
                    <span className="flex items-center gap-1">
                      <RefreshCw size={10} /> {p.revisions === -1 ? 'правки без ограничения' : `${p.revisions} правок`}
                    </span>
                  </div>
                  {p.includes.length > 0 && (
                    <div className="mt-1.5 space-y-0.5">
                      {p.includes.map((x) => (
                        <p key={x} className="flex items-center gap-1 text-[10px]" style={{ color: C.t2 }}>
                          <Check size={10} style={{ color: C.green }} /> {x}
                        </p>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="rounded-2xl px-3 py-2 text-[11px]"
            style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
            Доставки у услуги нет: исполнитель сдаёт работу, заказчик принимает.
            Деньги идут напрямую исполнителю, мимо Sky.
          </div>

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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 p-4" style={{ borderTop: `1px solid ${C.brd}` }}>
        <button type="button" disabled={!pack || product.own} onClick={() => setOrdering(true)}
          className="w-full rounded-xl py-3 text-[13px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {product.own ? 'Это ваша услуга' : pack ? `Заказать за ${fmt(pack.price)}` : 'Пакеты не описаны'}
        </button>
      </div>
    </div>
  );
};

/* ── Витрина ──────────────────────────────────────────────────────── */

export const ServicesMarket = ({ onOrdered }: { onOrdered?: (orderId: string) => void } = {}) => {
  const { catalog, catalogLoading, catalogError, loadCatalog } = useMarketStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<ServiceCategory | ''>('');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCatalog({
        type: 'service',
        q: q.trim() || undefined,
        serviceCategory: cat || undefined,
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, cat]);

  if (open) {
    return (
      <ServicePage productId={open} onBack={() => setOpen(null)}
        onOrdered={(id) => { setOpen(null); onOrdered?.(id); }} />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 p-3" style={{ borderBottom: `1px solid ${C.brd}` }}>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.l2 }}>
          <Search size={14} style={{ color: C.t3 }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Какая нужна услуга"
            className="flex-1 bg-transparent text-[12px] outline-none" style={{ color: C.t1 }} />
          {q && <button type="button" onClick={() => setQ('')}><X size={13} style={{ color: C.t3 }} /></button>}
        </div>
        <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          <button type="button" onClick={() => setCat('')}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
            style={{ background: cat === '' ? C.accBg : C.l2, color: cat === '' ? C.acc : C.t3 }}>
            Все
          </button>
          {(Object.keys(SERVICE_CATEGORY_LABEL) as ServiceCategory[]).map((k) => (
            <button key={k} type="button" onClick={() => setCat(k)}
              className="shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-semibold"
              style={{ background: cat === k ? C.accBg : C.l2, color: cat === k ? C.acc : C.t3 }}>
              {SERVICE_CATEGORY_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {catalogError && <Alert text={catalogError} />}
        {catalogLoading && catalog.length === 0 && (
          <p className="py-8 text-center text-[12px]" style={{ color: C.t3 }}>Загружаем…</p>
        )}
        {!catalogLoading && catalog.length === 0 && !catalogError && (
          <Empty title="Услуг пока нет" hint="Загляните позже или выложите свою" Icon={Briefcase} />
        )}
        <div className="grid grid-cols-2 gap-2">
          {catalog.map((p) => (
            <ServiceCard key={p.id} product={p} onOpen={() => setOpen(p.id)} />
          ))}
        </div>
      </div>
    </div>
  );
};
