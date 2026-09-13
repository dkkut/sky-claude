/**
 * Sky Market: кабинет продавца.
 *
 * Подписка за место на витрине — 79 ₽ в неделю. Это единственные
 * деньги модуля, и они наши, а не часть чьей-то сделки: списываются из
 * кошелька Sky. Оборота продавца мы не считаем и считать не можем —
 * покупатель платит ему напрямую, мимо нас.
 *
 * Поэтому в этом кабинете нет и не будет баланса, вывода средств,
 * доступных и замороженных сумм. Есть счётчики заказов, рейтинг и
 * список товаров.
 *
 * Право торговать здесь не решается. Кнопки рисуются по тому, что уже
 * ответил сервер; каждое нажатие он проверяет заново.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Store, Package, ShoppingBag, BarChart3, Settings, Plus, Trash2,
  Edit3, CheckCircle2, AlertCircle, Star, ImagePlus, CreditCard,
} from 'lucide-react';
import {
  C, fmt, fmtTime, Empty, Field, inputStyle, Alert, StatCard, Stars,
  ProductImage, rublesToKop, kopToRubles,
} from './ui';
import {
  apiCreateSeller, apiUpdateSeller, apiPaySellerSubscription,
  apiCreateProduct, apiUpdateProduct, apiArchiveProduct,
  apiUploadProductImage, apiDeleteProductImage, apiGames,
  type ProductInput,
} from './marketApi';
import { useMarketStore } from './store';
import type { Product, Seller, MarketType, ProductCategory, GameCategoryKey, Game } from './types';
import { GAME_CATEGORY_LABEL, CATEGORY_LABEL } from './types';
import { OrdersList, OrderPage } from './OrderScreens';

/* ── Стать продавцом ──────────────────────────────────────────────── */

export const BecomeSeller = () => {
  const { setSeller, config } = useMarketStore();
  const [shopName, setShopName] = useState('');
  const [description, setDescription] = useState('');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    const r = await apiCreateSeller({
      shopName: shopName.trim(),
      description: description.trim(),
      paymentDetails: paymentDetails.trim(),
    });
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Магазин не завёлся'); return; }
    setSeller(r.data.seller);
  };

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <Store size={22} style={{ color: C.acc }} />
        <p className="mt-2 text-base font-bold" style={{ color: C.t1 }}>Открыть магазин</p>
        <p className="mt-1 text-[12px]" style={{ color: C.t2 }}>
          Место на витрине стоит {config?.sellerPrice ?? 79} ₽ за {config?.sellerDays ?? 7} дней.
          Это плата Sky за витрину и хранение — с ваших продаж мы ничего не берём.
        </p>
        <p className="mt-2 text-[11px]" style={{ color: C.t3 }}>
          Покупатель платит вам напрямую. Sky не принимает, не хранит и не переводит
          деньги сделки, и вывода средств здесь нет — выводить нечего.
        </p>
      </div>

      <Field label="Название магазина">
        <input value={shopName} onChange={(e) => setShopName(e.target.value)} maxLength={60}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>
      <Field label="О магазине">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>

      <Field label="Реквизиты для оплаты"
        hint="Покупатель увидит их после оформления заказа — переводить он будет сюда. Без реквизитов торговать нельзя: платят вам напрямую.">
        <textarea value={paymentDetails} onChange={(e) => setPaymentDetails(e.target.value)}
          rows={3} maxLength={600}
          placeholder="Например: СБП +7 900 000-00-00 (Т-Банк), получатель Иван И."
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>

      {error && <Alert text={error} />}

      <button type="button" disabled={busy || shopName.trim().length < 2 || paymentDetails.trim().length < 4}
        onClick={create}
        className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Открываем…' : 'Открыть магазин'}
      </button>
    </div>
  );
};

/* ── Подписка ─────────────────────────────────────────────────────── */

const SubscriptionCard = ({ seller }: { seller: Seller }) => {
  const { setSeller } = useMarketStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = seller.subscription;

  const pay = async () => {
    setBusy(true); setError(null);
    const r = await apiPaySellerSubscription();
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Оплатить не вышло'); return; }
    setSeller(r.data.seller);
  };

  return (
    <div className="space-y-2 rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <div className="flex items-center gap-2">
        <CreditCard size={14} style={{ color: sub?.active ? C.green : C.amber }} />
        <p className="text-[12px] font-bold" style={{ color: C.t1 }}>Место на витрине</p>
      </div>
      <p className="text-[11px]" style={{ color: C.t2 }}>
        {sub?.active
          ? `Оплачено до ${fmtTime(sub.until)}`
          : sub?.status === 'expired'
            ? 'Срок вышел. Пока не оплачено, товары с витрины скрыты.'
            : 'Ещё не оплачено. Без оплаты товары не публикуются.'}
      </p>
      <p className="text-[10px]" style={{ color: C.t3 }}>
        {sub?.price ?? 79} ₽ за {sub?.days ?? 7} дней. Списывается из кошелька Sky.
        С продаж комиссия не берётся: деньги сделки через Sky не проходят.
      </p>
      {error && <Alert text={error} />}
      <button type="button" disabled={busy} onClick={pay}
        className="w-full rounded-xl py-2 text-[12px] font-bold disabled:opacity-40"
        style={{ background: sub?.active ? C.l2 : C.acc, color: sub?.active ? C.t1 : '#fff',
          border: sub?.active ? `1px solid ${C.brd}` : 'none' }}>
        {busy ? 'Оплачиваем…' : sub?.active ? 'Продлить на неделю' : 'Оплатить неделю'}
      </button>
    </div>
  );
};

/* ── Форма товара ─────────────────────────────────────────────────── */

const ProductForm = ({ product, onDone, onCancel }:
{ product: Product | null; onDone: () => void; onCancel: () => void }) => {
  const [marketType, setMarketType] = useState<MarketType>(product?.marketType ?? 'standard');
  const [title, setTitle] = useState(product?.title ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(kopToRubles(product?.priceKop));
  const [oldPrice, setOldPrice] = useState(kopToRubles(product?.oldPriceKop));
  const [category, setCategory] = useState<ProductCategory>(product?.category ?? 'other');
  const [stock, setStock] = useState(String(product?.stock ?? 1));
  const [gameId, setGameId] = useState(product?.gameId ?? '');
  const [gameCategory, setGameCategory] = useState<GameCategoryKey | ''>(product?.gameCategory ?? '');
  const [region, setRegion] = useState(product?.region ?? '');
  const [games, setGames] = useState<Game[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => { const r = await apiGames(); if (r.ok && r.data) setGames(r.data.games); })();
  }, []);

  const save = async () => {
    const priceKop = rublesToKop(price);
    if (priceKop === null) { setError('Цена указана неверно'); return; }
    const oldKop = oldPrice.trim() ? rublesToKop(oldPrice) : null;
    if (oldPrice.trim() && oldKop === null) { setError('Старая цена указана неверно'); return; }

    const input: ProductInput = {
      marketType,
      title: title.trim(),
      description: description.trim(),
      priceKop,
      oldPriceKop: oldKop,
      category,
      stock: Number(stock) || 0,
      region: region.trim() || undefined,
    };
    if (marketType === 'game') {
      input.gameId = gameId;
      input.gameCategory = (gameCategory || undefined) as GameCategoryKey | undefined;
    }

    setBusy(true); setError(null);
    const r = product
      ? await apiUpdateProduct(product.id, input)
      : await apiCreateProduct(input);
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Товар не сохранился'); return; }
    onDone();
  };

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm font-bold" style={{ color: C.t1 }}>
        {product ? 'Правка товара' : 'Новый товар'}
      </p>

      {!product && (
        <div className="grid grid-cols-2 gap-2">
          {([['standard', 'Обычный товар'], ['game', 'Игровой лот']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMarketType(k)}
              className="rounded-xl py-2 text-[11px] font-semibold"
              style={{
                background: marketType === k ? C.accBg : C.l2,
                color: marketType === k ? C.acc : C.t2,
                border: `1px solid ${marketType === k ? 'rgba(79,110,247,0.3)' : C.brd}`,
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <Field label="Название">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>
      <Field label="Описание">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={6000}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Цена, ₽">
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        </Field>
        <Field label="Старая цена, ₽">
          <input value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} inputMode="decimal"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Сколько штук">
          <input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric"
            className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
        </Field>
        {marketType === 'standard' ? (
          <Field label="Категория">
            <select value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              {Object.entries(CATEGORY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Регион">
            <input value={region} onChange={(e) => setRegion(e.target.value)} maxLength={60}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          </Field>
        )}
      </div>

      {marketType === 'game' && (
        <>
          <Field label="Игра" hint="Список игр ведёт администрация Sky.">
            <select value={gameId} onChange={(e) => setGameId(e.target.value)}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              <option value="">Выберите игру</option>
              {games.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </Field>
          <Field label="Что продаёте">
            <select value={gameCategory} onChange={(e) => setGameCategory(e.target.value as GameCategoryKey)}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              <option value="">Выберите вид</option>
              {Object.entries(GAME_CATEGORY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </Field>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            У игрового лота нет доставки и трек-номера: товар передаётся в игре, а
            покупатель подтверждает выдачу.
          </p>
        </>
      )}

      {error && <Alert text={error} />}

      <div className="flex gap-2 pb-4">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold"
          style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          Отмена
        </button>
        <button type="button" disabled={busy} onClick={save}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
          style={{ background: C.acc, color: '#fff' }}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
};

/* ── Картинки товара ──────────────────────────────────────────────── */

const ImageManager = ({ product, onChanged }: { product: Product; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true); setError(null);
    const r = await apiUploadProductImage(product.id, file);
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Картинка не загрузилась'); return; }
    onChanged();
  };

  const drop = async (imageId: string) => {
    await apiDeleteProductImage(imageId);
    onChanged();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {product.images.map((id) => (
          <div key={id} className="relative">
            <ProductImage imageId={id} alt={product.title}
              className="h-16 w-16 rounded-xl object-cover" />
            <button type="button" onClick={() => drop(id)}
              className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full"
              style={{ background: C.red, color: '#fff' }}>
              <Trash2 size={10} />
            </button>
          </div>
        ))}
        <label className="grid h-16 w-16 cursor-pointer place-items-center rounded-xl"
          style={{ background: C.l2, border: `1px dashed ${C.brdM}` }}>
          <ImagePlus size={16} style={{ color: C.t3 }} />
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        </label>
      </div>
      {busy && <p className="text-[10px]" style={{ color: C.t3 }}>Загружаем…</p>}
      {error && <Alert text={error} />}
    </div>
  );
};

/* ── Товары продавца ──────────────────────────────────────────────── */

const SellerProducts = () => {
  const { myProducts, loadSellerData } = useMarketStore();
  const [editing, setEditing] = useState<Product | null | 'new'>(null);
  const [images, setImages] = useState<string | null>(null);

  if (editing) {
    return (
      <ProductForm product={editing === 'new' ? null : editing}
        onDone={() => { setEditing(null); void loadSellerData(); }}
        onCancel={() => setEditing(null)} />
    );
  }

  return (
    <div className="space-y-2 p-4">
      <button type="button" onClick={() => setEditing('new')}
        className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[12px] font-bold"
        style={{ background: C.acc, color: '#fff' }}>
        <Plus size={14} /> Новый товар
      </button>

      {myProducts.length === 0 && <Empty title="Товаров пока нет" hint="Выложите первый — он появится в каталоге" />}

      {myProducts.map((p) => (
        <div key={p.id} className="space-y-2 rounded-2xl p-3"
          style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
          <div className="flex items-center gap-3">
            <ProductImage imageId={p.images[0]} alt={p.title} className="h-12 w-12 rounded-xl object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold" style={{ color: C.t1 }}>{p.title}</p>
              <p className="text-[11px]" style={{ color: C.t3 }}>
                {fmt(p.price)} · остаток {p.stock} · продано {p.sold}
                {!p.active && <span style={{ color: C.red }}> · снят с витрины</span>}
              </p>
            </div>
            <button type="button" onClick={() => setEditing(p)}
              className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2, color: C.t2 }}>
              <Edit3 size={13} />
            </button>
            {p.active && (
              <button type="button"
                onClick={async () => { await apiArchiveProduct(p.id); void loadSellerData(); }}
                className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2, color: C.red }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <button type="button" onClick={() => setImages(images === p.id ? null : p.id)}
            className="text-[11px] font-semibold" style={{ color: C.acc }}>
            {images === p.id ? 'Скрыть картинки' : `Картинки (${p.images.length})`}
          </button>
          {images === p.id && <ImageManager product={p} onChanged={() => void loadSellerData()} />}
        </div>
      ))}
    </div>
  );
};

/* ── Заказы продавца ──────────────────────────────────────────────── */

const SellerOrders = ({ meId }: { meId: string }) => {
  const { ordersSell, loadOrders, patchOrder } = useMarketStore();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => { void loadOrders('seller'); }, []);

  if (open) {
    return (
      <OrderPage orderId={open} meId={meId} onBack={() => { setOpen(null); void loadOrders('seller'); }}
        onChanged={patchOrder} />
    );
  }
  return <OrdersList orders={ordersSell} onOpen={setOpen} empty="Заказов пока нет" />;
};

/* ── Счётчики ─────────────────────────────────────────────────────── */

const SellerStatsView = () => {
  const { stats } = useMarketStore();
  if (!stats) return <Empty title="Считаем…" />;

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Заказов всего" value={stats.ordersTotal} Icon={ShoppingBag} />
        <StatCard label="Завершено" value={stats.ordersDone} Icon={CheckCircle2} color={C.green} />
        <StatCard label="Открытых" value={stats.ordersOpen} Icon={Package} color={C.amber} />
        <StatCard label="Отменено" value={stats.ordersCancelled} Icon={AlertCircle} color={C.red} />
        <StatCard label="Товаров на витрине" value={stats.productsActive} Icon={Store} />
        <StatCard label="Отзывов" value={stats.reviewCount} Icon={Star} color={C.amber} />
      </div>

      <div className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>Рейтинг магазина</p>
        <div className="mt-1 flex items-center gap-2">
          <Stars rating={stats.rating} size={16} />
          <p className="text-lg font-black" style={{ color: C.t1 }}>
            {stats.rating === null ? '—' : stats.rating.toFixed(1)}
          </p>
        </div>
      </div>

      {/* Прямым текстом, чтобы вопрос «где мои деньги» не возникал. */}
      <div className="rounded-2xl px-3 py-2 text-[11px]"
        style={{ background: C.l2, color: C.t2, border: `1px solid ${C.brd}` }}>
          Выручки здесь нет намеренно: покупатели платят вам напрямую, и Sky этих
          переводов не видит. Считать ваш оборот нам нечем — и не нужно.
      </div>
    </div>
  );
};

/* ── Настройки магазина ───────────────────────────────────────────── */

const SellerSettings = ({ seller }: { seller: Seller }) => {
  const { setSeller } = useMarketStore();
  const [shopName, setShopName] = useState(seller.shopName);
  const [description, setDescription] = useState(seller.description);
  const [paymentDetails, setPaymentDetails] = useState(seller.paymentDetails ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    const r = await apiUpdateSeller({
      shopName: shopName.trim(),
      description: description.trim(),
      paymentDetails: paymentDetails.trim(),
    });
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Не сохранилось'); return; }
    setSeller(r.data.seller);
    setSaved(true);
  };

  return (
    <div className="space-y-3 p-4">
      <SubscriptionCard seller={seller} />

      <Field label="Название магазина">
        <input value={shopName} onChange={(e) => setShopName(e.target.value)} maxLength={60}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>
      <Field label="О магазине">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>

      <Field label="Реквизиты для оплаты"
        hint="Показываются покупателю после оформления заказа — он переводит деньги напрямую вам. Sky их не видит и не хранит переводы.">
        <textarea value={paymentDetails} onChange={(e) => setPaymentDetails(e.target.value)}
          rows={3} maxLength={600}
          placeholder="Например: СБП +7 900 000-00-00 (Т-Банк), получатель Иван И."
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
      </Field>

      {!seller.hasPaymentDetails && (
        <Alert text="Пока реквизиты не заданы, товары не публикуются и заказать у вас нельзя: покупателю некуда переводить деньги." />
      )}

      {error && <Alert text={error} />}
      {saved && <Alert kind="info" text="Сохранено" />}

      <button type="button" disabled={busy} onClick={save}
        className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Сохраняем…' : 'Сохранить'}
      </button>
    </div>
  );
};

/* ── Кабинет ──────────────────────────────────────────────────────── */

type CabTab = 'orders' | 'products' | 'stats' | 'settings';

const TABS: { key: CabTab; label: string; Icon: LucideIcon }[] = [
  { key: 'orders',   label: 'Заказы',   Icon: ShoppingBag },
  { key: 'products', label: 'Товары',   Icon: Package },
  { key: 'stats',    label: 'Счётчики', Icon: BarChart3 },
  { key: 'settings', label: 'Магазин',  Icon: Settings },
];

export const SellerCabinet = ({ seller, meId }: { seller: Seller; meId: string }) => {
  const { loadSellerData } = useMarketStore();
  const [tab, setTab] = useState<CabTab>('orders');

  useEffect(() => { void loadSellerData(); }, []);

  const sub = seller.subscription;

  return (
    <div className="flex h-full flex-col">
      {!sub?.active && (
        <div className="shrink-0 px-4 pt-3">
          <SubscriptionCard seller={seller} />
        </div>
      )}

      {!seller.hasPaymentDetails && (
        <div className="shrink-0 px-4 pt-3">
          <Alert text="Укажите реквизиты для оплаты во вкладке «Магазин» — без них покупателю некуда переводить деньги, и товары не публикуются." />
        </div>
      )}

      <div className="flex shrink-0 gap-1 px-4 py-2" style={{ borderBottom: `1px solid ${C.brd}` }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex flex-1 items-center justify-center gap-1 rounded-xl py-1.5 text-[11px] font-semibold"
            style={{
              background: tab === t.key ? C.accBg : 'transparent',
              color: tab === t.key ? C.acc : C.t3,
            }}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'orders' && <SellerOrders meId={meId} />}
        {tab === 'products' && <SellerProducts />}
        {tab === 'stats' && <SellerStatsView />}
        {tab === 'settings' && <SellerSettings seller={seller} />}
      </div>
    </div>
  );
};
