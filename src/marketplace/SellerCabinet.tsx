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
import { DeliverySettings } from './DeliverySettings';
import { useCallback, useEffect, useState } from 'react';
import { useWarehouseStore } from './logistics/warehouseStore';
import { MyTax } from '@/tax/TaxPanel';
import type { LucideIcon } from 'lucide-react';
import {
  Store, Receipt, Package, ShoppingBag, BarChart3, Settings, Plus, Trash2,
  Edit3, CheckCircle2, AlertCircle, Star, ImagePlus, CreditCard,
  Truck, Route, Warehouse as WarehouseIcon, PackageSearch, KeyRound, Zap,
  Lock as LockIcon, Check, ScrollText, QrCode, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { SellerViolations } from './ViolationsTab';
import {
  C, fmt, fmtTime, Empty, Field, inputStyle, Alert, StatCard, Stars,
  ProductImage, ProductLogo, rublesToKop, kopToRubles,
} from './ui';
import {
  apiCreateSeller, apiUpdateSeller, apiPaySellerSubscription,
  apiCreateProduct, apiUpdateProduct, apiArchiveProduct,
  apiUploadProductImage, apiDeleteProductImage, apiGames,
  apiUploadProductLogo, apiDeleteProductLogo,
  apiSetServicePackages, apiPromotions, apiBuyPromotion,
  type ProductInput,
} from './marketApi';
import { useMarketStore } from './store';
import type {
  Product, Seller, MarketType, ProductCategory, GameCategoryKey, Game,
  ServiceCategory, ServiceLevel, ServicePackage, FulfilmentMode,
  PromoPlan, Promotion,
} from './types';
import {
  GAME_CATEGORY_LABEL, CATEGORY_LABEL, SERVICE_CATEGORY_LABEL, SERVICE_LEVEL_LABEL,
} from './types';
import { OrdersList, OrderPage } from './OrderScreens';
import { CourierHub } from './logistics/CourierHub';
import { TransportCompanyHub, DeliveryOffersPanel } from './logistics/TransportCompanyHub';
import { WarehouseHub } from './logistics/WarehouseHub';
import { CellMarket } from './logistics/CellMarket';
import { DocumentGate } from './logistics/DocumentGate';
import { apiDocuments } from './logistics/sharedApi';
import { SlidePanel } from './logistics/shared';
import { ShipmentHub } from './logistics/ShipmentHub';
import { PassHub } from './logistics/PassHub';
import { SellerPvzShipments } from './SellerPvzShipments';
import { VerificationPanel } from './SellerVerification';
import { TransferPanel } from './Transfers';
import {
  OriginSection, ListingPanel, ModerationBadge, originFromProduct, originToInput, type OriginState,
} from './ProductCompliance';

/* ── Стать продавцом ──────────────────────────────────────────────── */

export const BecomeSeller = () => {
  const { setSeller, config } = useMarketStore();
  const [shopName, setShopName] = useState('');
  const [description, setDescription] = useState('');
  const [paymentDetails, setPaymentDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Приняты ли правила продавцов. Признак приходит с сервера и туда же
     уходит: галочка на этом экране ничего не решает — магазин заводит
     сервер, и он же смотрит на свою запись о согласии. */
  const [rulesOk, setRulesOk] = useState<boolean | null>(null);
  const [gate, setGate] = useState(false);

  const loadRules = useCallback(async () => {
    const r = await apiDocuments();
    const doc = r.ok ? r.data?.documents.find((d) => d.code === 'seller_rules') : null;
    setRulesOk(doc?.accepted ?? false);
  }, []);

  useEffect(() => { void loadRules(); }, [loadRules]);

  const create = async () => {
    setBusy(true); setError(null);
    const r = await apiCreateSeller({
      shopName: shopName.trim(),
      description: description.trim(),
      paymentDetails: paymentDetails.trim(),
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      if (r.error === 'seller_rules_required') { setRulesOk(false); setGate(true); return; }
      setError(r.reason ?? 'Магазин не завёлся');
      return;
    }
    setSeller(r.data.seller);
  };

  if (gate) {
    return (
      <SlidePanel open onClose={() => setGate(false)} onBack={() => setGate(false)} title="Правила продавцов">
        <DocumentGate code="seller_rules"
          note="Их принимают до того, как магазин появился: по ним вы и будете работать."
          onAccepted={() => { setGate(false); setRulesOk(true); }} />
      </SlidePanel>
    );
  }

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      <div className="rounded-2xl p-4" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
        <Store size={22} style={{ color: C.acc }} />
        <p className="mt-2 text-base font-bold" style={{ color: C.t1 }}>Открыть магазин</p>
        <p className="mt-1 text-[12px]" style={{ color: C.t2 }}>
          Место на витрине стоит {config?.sellerPrice ?? 79} ₽ за {config?.sellerDays ?? 7} дней.
          Это плата Sky за витрину и хранение — с ваших продаж мы ничего не берём.
        </p>
        <p className="mt-2 text-[11px]" style={{ color: C.t2 }}>
          После создания магазина выберите свой статус (физлицо, самозанятый, ИП или организация) и
          отправьте анкету на проверку: торговать можно будет после одобрения заявки.
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

      <button type="button" onClick={() => setGate(true)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px]"
        style={{ background: C.l1, border: `1px solid ${rulesOk ? C.brd : C.acc}` }}>
        {rulesOk
          ? <Check size={14} style={{ color: C.green, flexShrink: 0 }} />
          : <ScrollText size={14} style={{ color: C.acc, flexShrink: 0 }} />}
        <span style={{ color: rulesOk ? C.t2 : C.t1 }}>
          {rulesOk ? 'Правила продавцов приняты' : 'Прочитать и принять правила продавцов'}
        </span>
      </button>

      {error && <Alert text={error} />}

      <button type="button"
        disabled={busy || !rulesOk || shopName.trim().length < 2 || paymentDetails.trim().length < 4}
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
  const [serviceCategory, setServiceCategory] = useState<ServiceCategory | ''>(product?.serviceCategory ?? '');
  const [tags, setTags] = useState((product?.tags ?? []).join(', '));
  /* Пакеты услуги. Уходят отдельным запросом после сохранения самой
     услуги: без неё им не к чему прикрепиться. */
  const [packages, setPackages] = useState<ServicePackage[]>(product?.packages ?? []);
  const [origin, setOrigin] = useState<OriginState>(originFromProduct(product));
  /* Только что созданная карточка: форма остаётся открытой, чтобы
     продавец сразу мог отправить её на публикацию. */
  const [created, setCreated] = useState<Product | null>(null);
  const current = product ?? created;
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
      ...originToInput(origin, marketType),
    };
    if (marketType === 'game') {
      input.gameId = gameId;
      input.gameCategory = (gameCategory || undefined) as GameCategoryKey | undefined;
    }
    if (marketType === 'service') {
      input.serviceCategory = (serviceCategory || undefined) as ServiceCategory | undefined;
      input.tags = tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12);
    }

    setBusy(true); setError(null);
    const r = current
      ? await apiUpdateProduct(current.id, input)
      : await apiCreateProduct(input);
    if (!r.ok || !r.data) { setBusy(false); setError(r.reason ?? 'Товар не сохранился'); return; }

    if (marketType === 'service' && packages.length > 0) {
      const saved = await apiSetServicePackages(r.data.product.id, packages);
      if (!saved.ok) { setBusy(false); setError(saved.reason ?? 'Пакеты не сохранились'); return; }
    }
    setBusy(false);
    /* Новая карточка — черновик: остаёмся в форме и показываем публикацию. */
    setCreated(r.data.product);
    if (current) onDone();
  };

  return (
    <div className="space-y-3 p-4">
      <p className="text-sm font-bold" style={{ color: C.t1 }}>
        {product ? 'Правка товара' : 'Новый товар'}
      </p>

      {!product && (
        <div className="grid grid-cols-3 gap-2">
          {([['standard', 'Товар'], ['game', 'Игровой лот'], ['service', 'Услуга']] as const).map(([k, label]) => (
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

      {marketType === 'service' && (
        <>
          <Field label="Вид услуги">
            <select value={serviceCategory} onChange={(e) => setServiceCategory(e.target.value as ServiceCategory)}
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
              <option value="">Выберите вид</option>
              {Object.entries(SERVICE_CATEGORY_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Метки" hint="Через запятую — по ним услугу находят в поиске.">
            <input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={400}
              placeholder="логотип, брендинг, вектор"
              className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
          </Field>

          <PackageEditor packages={packages} onChange={setPackages} />

          <p className="text-[10px]" style={{ color: C.t3 }}>
            Цена услуги на витрине — цена самого дешёвого пакета; считает её сервер.
            Доставки и трек-номера у услуги нет: вы сдаёте работу, заказчик принимает.
          </p>
        </>
      )}

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

      <OriginSection marketType={marketType} value={origin} onChange={setOrigin} />

      {error && <Alert text={error} />}

      {current && <ListingPanel product={current} onChanged={() => void useMarketStore.getState().loadSellerData()} />}

      <div className="flex gap-2 pb-4">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl py-2.5 text-[12px] font-bold"
          style={{ background: C.l2, color: C.t1, border: `1px solid ${C.brd}` }}>
          {created ? 'Готово' : 'Отмена'}
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

/* ── Пакеты услуги ────────────────────────────────────────────────── */

const EMPTY_PACKAGE = (level: ServiceLevel): ServicePackage => ({
  level,
  title: SERVICE_LEVEL_LABEL[level],
  description: '',
  price: 0,
  priceKop: 0,
  delivery: 3,
  revisions: 1,
  includes: [],
});

/**
 * Три пакета услуги.
 *
 * Цена здесь — рубли на экране и копейки в запросе: складывать рубли с
 * плавающей точкой нельзя, и 19.99 не должно уехать на витрину как
 * 19.98.
 */
const PackageEditor = ({ packages, onChange }: {
  packages: ServicePackage[];
  onChange: (next: ServicePackage[]) => void;
}) => {
  const byLevel = (level: ServiceLevel) => packages.find((p) => p.level === level);

  const toggle = (level: ServiceLevel) => {
    onChange(byLevel(level)
      ? packages.filter((p) => p.level !== level)
      : [...packages, EMPTY_PACKAGE(level)]);
  };

  const patch = (level: ServiceLevel, next: Partial<ServicePackage>) => {
    onChange(packages.map((p) => (p.level === level ? { ...p, ...next } : p)));
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>ПАКЕТЫ</p>
      {(['basic', 'standard', 'premium'] as ServiceLevel[]).map((level) => {
        const p = byLevel(level);
        return (
          <div key={level} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
            <button type="button" onClick={() => toggle(level)}
              className="flex w-full items-center justify-between text-left">
              <p className="text-[12px] font-bold" style={{ color: p ? C.t1 : C.t3 }}>
                {SERVICE_LEVEL_LABEL[level]}
              </p>
              <span className="text-[11px] font-semibold" style={{ color: C.acc }}>
                {p ? 'Убрать' : 'Добавить'}
              </span>
            </button>

            {p && (
              <div className="mt-2 space-y-2">
                <input value={p.title} maxLength={80}
                  onChange={(e) => patch(level, { title: e.target.value })}
                  placeholder="Название пакета"
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                <textarea value={p.description} rows={2} maxLength={600}
                  onChange={(e) => patch(level, { description: e.target.value })}
                  placeholder="Что входит одним предложением"
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                <div className="grid grid-cols-3 gap-2">
                  <input value={kopToRubles(p.priceKop)} inputMode="decimal"
                    onChange={(e) => patch(level, { priceKop: rublesToKop(e.target.value) ?? 0 })}
                    placeholder="Цена, ₽"
                    className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                  <input value={String(p.delivery)} inputMode="numeric"
                    onChange={(e) => patch(level, { delivery: Math.max(1, Number(e.target.value) || 1) })}
                    placeholder="Дней"
                    className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                  <input value={p.revisions === -1 ? '∞' : String(p.revisions)}
                    onChange={(e) => patch(level, {
                      revisions: e.target.value.trim() === '∞' ? -1 : Math.max(0, Number(e.target.value) || 0),
                    })}
                    placeholder="Правок"
                    className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
                </div>
                <input value={p.includes.join(', ')} maxLength={400}
                  onChange={(e) => patch(level, {
                    includes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12),
                  })}
                  placeholder="Что входит, через запятую"
                  className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle} />
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[10px]" style={{ color: C.t3 }}>
        Впишите «∞» в поле правок, если правки без ограничения.
      </p>
    </div>
  );
};

/* ── Картинки товара ──────────────────────────────────────────────── */

const ImageManager = ({ product, onChanged }: { product: Product; onChanged: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Логотип.
   *
   * Отдельно от фотографий: это марка, по которой товар узнают в
   * списке. Нет своей — карточка возьмёт обложку игры или аватар
   * магазина, так что пустой она не останется.
   */
  const uploadLogo = async (file: File) => {
    setBusy(true); setError(null);
    const r = await apiUploadProductLogo(product.id, file);
    setBusy(false);
    if (!r.ok) { setError(r.reason ?? 'Логотип не загрузился'); return; }
    onChanged();
  };

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
      <div className="flex items-center gap-3">
        <ProductLogo product={product} size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold" style={{ color: C.t2 }}>Логотип товара</p>
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Квадратная марка для списка. Без неё возьмём обложку игры или аватар магазина.
          </p>
        </div>
        <label className="cursor-pointer rounded-lg px-2 py-1 text-[11px] font-semibold"
          style={{ background: C.l2, color: C.acc }}>
          {product.hasLogo ? 'Заменить' : 'Загрузить'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ''; }} />
        </label>
        {product.hasLogo && (
          <button type="button"
            onClick={async () => { await apiDeleteProductLogo(product.id); onChanged(); }}
            className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: C.l2, color: C.red }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

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
              </p>
              <ModerationBadge status={p.moderationStatus} />
            </div>
            <button type="button" onClick={() => setEditing(p)}
              className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: C.l2, color: C.t2 }}>
              <Edit3 size={13} />
            </button>
            {p.moderationStatus !== 'archived' && (
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

  /* Список перечитывается при каждом открытии вкладки: заказ мог
     появиться, пока продавец был на другой. Один лишний запрос дешевле
     устаревшего списка. */
  useEffect(() => { void loadOrders('seller'); }, []);

  if (open) {
    return (
      <OrderPage orderId={open} meId={meId} onBack={() => { setOpen(null); void loadOrders('seller'); }}
        onChanged={patchOrder} />
    );
  }
  return (
    <div className="h-full overflow-y-auto">
      {/* Встречные предложения перевозчиков: решение по цене принимает
          продавец, и место этому решению — рядом с его заказами. */}
      <DeliveryOffersPanel sellerId={meId} />
      <OrdersList orders={ordersSell} onOpen={setOpen} empty="Заказов пока нет" />
    </div>
  );
};

/* ── Продвижение ──────────────────────────────────────────────────── */

/**
 * Реклама товара.
 *
 * Раньше этот экран рисовал «кампания запущена» и добавлял строчку в
 * память вкладки: денег никто не брал, охвата никто не давал, а при
 * перезагрузке кампания исчезала. Теперь продвижение настоящее — оно
 * оплачивается из кошелька Sky и действительно поднимает товар в
 * каталоге на оплаченный срок.
 *
 * Это плата нам за место на витрине, как подписка. Деньги сделки через
 * Sky по-прежнему не проходят.
 */
const SellerPromotions = () => {
  const { myProducts } = useMarketStore();
  const [plans, setPlans] = useState<PromoPlan[]>([]);
  const [items, setItems] = useState<Promotion[]>([]);
  const [plan, setPlan] = useState<string>('');
  const [productId, setProductId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState('');

  const reload = async () => {
    const r = await apiPromotions();
    if (r.ok && r.data) { setPlans(r.data.plans); setItems(r.data.items); }
  };
  useEffect(() => { void reload(); }, []);

  const live = myProducts.filter((p) => p.active);

  const buy = async () => {
    if (!plan || !productId) return;
    setBusy(true); setError(null); setDone('');
    const r = await apiBuyPromotion(productId, plan);
    setBusy(false);
    if (!r.ok || !r.data) { setError(r.reason ?? 'Не получилось оплатить'); return; }
    setDone(`Товар продвигается до ${fmtTime(r.data.promotion.endsAt)}`);
    setPlan(''); setProductId('');
    await reload();
  };

  return (
    <div className="space-y-3 p-4">
      {items.filter((i) => i.active).length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>СЕЙЧАС ПРОДВИГАЕТСЯ</p>
          {items.filter((i) => i.active).map((i) => (
            <div key={i.id} className="rounded-2xl p-3" style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
              <p className="text-[12px] font-semibold" style={{ color: C.t1 }}>{i.productTitle}</p>
              <p className="mt-0.5 text-[11px]" style={{ color: C.t3 }}>
                {i.planTitle} · до {fmtTime(i.endsAt)}
              </p>
            </div>
          ))}
        </div>
      )}

      <Field label="Какой товар продвигать">
        <select value={productId} onChange={(e) => setProductId(e.target.value)}
          className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
          <option value="">Выберите товар</option>
          {live.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      </Field>
      {live.length === 0 && <Alert text="На витрине пока нет товаров, которые можно продвигать." />}

      <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>ТАРИФЫ</p>
      {plans.map((p) => (
        <button key={p.id} type="button" onClick={() => setPlan(p.id)}
          className="block w-full rounded-2xl p-3 text-left"
          style={{
            background: plan === p.id ? C.accBg : C.l1,
            border: `1px solid ${plan === p.id ? 'rgba(79,110,247,0.35)' : C.brd}`,
          }}>
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold" style={{ color: C.t1 }}>{p.title}</p>
            <p className="text-sm font-black" style={{ color: C.t1 }}>{fmt(p.price)}</p>
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: C.t2 }}>{p.note}</p>
        </button>
      ))}

      {error && <Alert text={error} />}
      {done && <Alert kind="info" text={done} />}

      <button type="button" disabled={!plan || !productId || busy} onClick={buy}
        className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Оплачиваем…' : 'Оплатить продвижение'}
      </button>

      <p className="text-[10px]" style={{ color: C.t3 }}>
        Списывается из кошелька Sky. Это плата за место на витрине, а не комиссия
        со сделки: деньги покупателя идут вам напрямую, мимо Sky.
      </p>

      {items.filter((i) => !i.active).length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>ЗАВЕРШЁННЫЕ</p>
          {items.filter((i) => !i.active).map((i) => (
            <p key={i.id} className="text-[11px]" style={{ color: C.t3 }}>
              {i.productTitle} · {i.planTitle} · до {fmtTime(i.endsAt)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
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
  const [mode, setMode] = useState<FulfilmentMode>(seller.fulfilmentMode ?? 'direct');
  const [warehouseId, setWarehouseId] = useState(seller.fulfilmentWarehouseId ?? '');
  const { myWarehouses, load: loadWarehouses } = useWarehouseStore();
  const warehouses = myWarehouses();
  useEffect(() => { void loadWarehouses(); }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    const r = await apiUpdateSeller({
      shopName: shopName.trim(),
      description: description.trim(),
      paymentDetails: paymentDetails.trim(),
      fulfilmentMode: mode,
      fulfilmentWarehouseId: mode === 'warehouse' ? warehouseId : null,
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

      {/* Режим работы магазина */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold" style={{ color: C.t3 }}>РЕЖИМ РАБОТЫ</p>
        <div className="grid grid-cols-2 gap-2">
          {([['direct', 'Напрямую'], ['warehouse', 'Через свой склад']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMode(k)}
              className="rounded-xl py-2 text-[11px] font-semibold"
              style={{
                background: mode === k ? C.accBg : C.l2,
                color: mode === k ? C.acc : C.t2,
                border: `1px solid ${mode === k ? 'rgba(79,110,247,0.3)' : C.brd}`,
              }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'direct' ? (
          <p className="text-[10px]" style={{ color: C.t3 }}>
            Заказ уходит покупателю сразу: службой доставки в пункт выдачи или до двери,
            либо вы везёте сами.
          </p>
        ) : (
          <>
            <Field label="Склад магазина"
              hint="Заказы собираются в поставку, едут на этот склад, и уже оттуда вы везёте покупателю сами — с тем же подтверждением получения.">
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full rounded-xl px-3 py-2 text-[12px]" style={inputStyle}>
                <option value="">Выберите свой склад</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            {warehouses.length === 0 && (
              <Alert text="Своих складов пока нет. Заведите склад во вкладке «Мои склады» — без него режим не включится." />
            )}
          </>
        )}
      </div>

      {error && <Alert text={error} />}
      {saved && <Alert kind="info" text="Сохранено" />}

      <button type="button" disabled={busy} onClick={save}
        className="w-full rounded-xl py-2.5 text-[12px] font-bold disabled:opacity-40"
        style={{ background: C.acc, color: '#fff' }}>
        {busy ? 'Сохраняем…' : 'Сохранить'}
      </button>

      <TransferPanel kind="shop" title={seller.shopName} />
    </div>
  );
};

/* ── Кабинет ──────────────────────────────────────────────────────── */

type CabTab = 'verify' | 'orders' | 'products' | 'stats'
  | 'couriers' | 'transport' | 'warehouses' | 'cells' | 'shipments' | 'pvzship' | 'passes'
  | 'ads' | 'violations' | 'tax' | 'delivery' | 'settings';

/* Логистика — часть кабинета продавца, как и была: курьеры, своя
   транспортная компания, склады, поставки и пропуска. Теперь всё это
   живёт на сервере, но стоит там же, где стояло. */
const TABS: { key: CabTab; label: string; Icon: LucideIcon }[] = [
  { key: 'verify',     label: 'Проверка статуса', Icon: ShieldCheck },
  { key: 'orders',     label: 'Заказы',   Icon: ShoppingBag },
  { key: 'products',   label: 'Товары',   Icon: Package },
  { key: 'stats',      label: 'Счётчики', Icon: BarChart3 },
  { key: 'couriers',   label: 'Курьеры',  Icon: Truck },
  { key: 'transport',  label: 'Транспортная компания', Icon: Route },
  { key: 'warehouses', label: 'Мои склады', Icon: WarehouseIcon },
  { key: 'cells',      label: 'Ячейки на складах', Icon: LockIcon },
  { key: 'shipments',  label: 'Поставки', Icon: PackageSearch },
  { key: 'pvzship',    label: 'Поставка в ПВЗ', Icon: QrCode },
  { key: 'passes',     label: 'Пропуска и доступы', Icon: KeyRound },
  { key: 'ads',        label: 'Реклама',  Icon: Zap },
  { key: 'violations', label: 'Нарушения и штрафы', Icon: ShieldAlert },
  { key: 'tax',        label: 'Налоги',   Icon: Receipt },
  { key: 'delivery',   label: 'Доставка и самовывоз', Icon: Truck },
  { key: 'settings',   label: 'Магазин',  Icon: Settings },
];

export const SellerCabinet = ({ seller, meId }: { seller: Seller; meId: string }) => {
  const { loadSellerData, ordersSell, loadOrders } = useMarketStore();
  const verified = seller.verification === 'approved' || seller.verification === 'legacy';
  const [tab, setTab] = useState<CabTab>(verified ? 'orders' : 'verify');

  useEffect(() => { void loadSellerData(); }, []);

  /* Курьерскому хабу нужны заказы продавца — те же, что в его вкладке
     «Заказы»: он предлагает отдать курьеру именно их. Читаем их, когда
     эта вкладка открывается, а не при каждом заходе в кабинет. */
  useEffect(() => {
    if (tab === 'couriers') void loadOrders('seller');
  }, [tab]);
  const ordersForCouriers = ordersSell;

  const sub = seller.subscription;

  return (
    <div className="flex h-full flex-col">
      {!verified && (
        <div className="shrink-0 px-4 pt-3">
          <Alert text="Магазин ещё не прошёл проверку: торговать и публиковать товары можно после одобрения заявки. Заполните вкладку «Проверка статуса»." />
        </div>
      )}

      {verified && !sub?.active && (
        <div className="shrink-0 px-4 pt-3">
          <SubscriptionCard seller={seller} />
        </div>
      )}

      {!seller.hasPaymentDetails && (
        <div className="shrink-0 px-4 pt-3">
          <Alert text="Укажите реквизиты для оплаты во вкладке «Магазин» — без них покупателю некуда переводить деньги, и товары не публикуются." />
        </div>
      )}

      <div className="flex shrink-0 gap-1 overflow-x-auto px-4 py-2"
        style={{ borderBottom: `1px solid ${C.brd}`, scrollbarWidth: 'none' }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className="flex shrink-0 items-center justify-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-semibold"
            style={{
              background: tab === t.key ? C.accBg : 'transparent',
              color: tab === t.key ? C.acc : C.t3,
            }}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'verify' && <VerificationPanel onChanged={() => void useMarketStore.getState().loadSeller()} />}
        {tab === 'orders' && <SellerOrders meId={meId} />}
        {tab === 'products' && <SellerProducts />}
        {tab === 'stats' && <SellerStatsView />}
        {tab === 'couriers' && <CourierHub sellerId={seller.id} orders={ordersForCouriers} />}
        {tab === 'transport' && <TransportCompanyHub />}
        {tab === 'warehouses' && <WarehouseHub />}
        {tab === 'cells' && <CellMarket />}
        {tab === 'shipments' && <ShipmentHub />}
        {tab === 'pvzship' && <SellerPvzShipments />}
        {tab === 'passes' && <PassHub />}
        {tab === 'delivery' && <DeliverySettings />}
        {tab === 'ads' && <SellerPromotions />}
        {tab === 'violations' && <SellerViolations />}
        {tab === 'tax' && <MyTax />}
        {tab === 'settings' && <SellerSettings seller={seller} />}
      </div>
    </div>
  );
};
