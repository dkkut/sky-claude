/**
 * Sky Market: общие части экрана.
 *
 * Токены, карточка товара, звёзды, пустые состояния. Всё, что рисуется
 * и в обычном маркете, и в игровом, живёт здесь — чтобы две витрины не
 * разъезжались по мелочам.
 */
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Package, Star, Heart, Laptop, Shirt, Home, Sparkles, Dumbbell,
  BookOpen, Gamepad2, Apple, ImageOff, Flower2,
} from 'lucide-react';
import type { Product, ProductCategory } from './types';
import { useMarketImage } from './marketMedia';
import { marketImageUrl, productLogoUrl, gameCoverUrl, sellerAvatarUrl } from './marketApi';

/* ── Токены ───────────────────────────────────────────────────────── */

export const C = {
  bg:    'var(--bg)',
  l1:    'var(--bg-l1)',
  l2:    'var(--bg-l2)',
  l3:    'var(--bg-l3)',
  brd:   'var(--border)',
  brdM:  'var(--border-m)',
  t1:    'var(--t1)',
  t2:    'var(--t2)',
  t3:    'var(--t3)',
  acc:   'var(--accent)',
  accBg: 'var(--accent-bg)',
  amber: 'var(--amber)',
  green: 'var(--green)',
  red:   'var(--red)',
};

export const fmt = (n: number) => n.toLocaleString('ru-RU') + ' ₽';
export const fmtNum = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n));
export const fmtTs = (s?: string | null) =>
  s ? new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
export const fmtTime = (s?: string | null) =>
  s ? new Date(s).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

/**
 * Рубли в копейки.
 *
 * Считается в целых копейках через строку, а не умножением на сто:
 * 19.99 * 100 в двоичной арифметике даёт 1998.9999999999998, и товар
 * за 19.99 однажды уезжает на витрину по 19.98.
 */
export const rublesToKop = (value: string): number | null => {
  const clean = value.replace(',', '.').trim();
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const kop = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isFinite(kop) && kop > 0 ? kop : null;
};

export const kopToRubles = (kop?: number | null) =>
  kop == null ? '' : (kop % 100 === 0 ? String(kop / 100) : (kop / 100).toFixed(2));

/* ── Категории ────────────────────────────────────────────────────── */

export const CAT_CFG: Record<ProductCategory, { label: string; Icon: typeof Package; color: string }> = {
  electronics: { label: 'Электроника', Icon: Laptop,   color: '#3b82f6' },
  clothing:    { label: 'Одежда',      Icon: Shirt,    color: '#8b5cf6' },
  home:        { label: 'Дом',         Icon: Home,     color: '#10b981' },
  beauty:      { label: 'Красота',     Icon: Sparkles, color: '#ec4899' },
  sports:      { label: 'Спорт',       Icon: Dumbbell, color: '#f59e0b' },
  books:       { label: 'Книги',       Icon: BookOpen, color: '#6366f1' },
  toys:        { label: 'Игрушки',     Icon: Gamepad2, color: '#f43f5e' },
  food:        { label: 'Питание',     Icon: Apple,    color: '#22c55e' },
  flowers:     { label: 'Цветы',       Icon: Flower2,  color: '#f472b6' },
  other:       { label: 'Другое',      Icon: Package,  color: 'var(--t3)' },
};

export const CatIcon = ({ cat, size = 20, color }:
{ cat: ProductCategory; size?: number; color?: string }) => {
  const cfg = CAT_CFG[cat] ?? CAT_CFG.other;
  const Icon = cfg.Icon;
  return <Icon size={size} style={{ color: color ?? cfg.color }} />;
};

/* ── Мелочи ───────────────────────────────────────────────────────── */

export const Stars = ({ rating, size = 12 }: { rating: number | null; size?: number }) => (
  <div className="flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} size={size}
        style={{ color: rating !== null && i <= Math.round(rating) ? C.amber : C.t3 }}
        fill={rating !== null && i <= Math.round(rating) ? C.amber : 'none'} />
    ))}
  </div>
);

export const StatCard = ({ label, value, Icon, icon, color }:
{ label: string; value: string | number; Icon?: LucideIcon; icon?: LucideIcon; color?: string }) => {
  const Glyph = Icon ?? icon;
  return (
  <div className="rounded-2xl p-3" style={{ background: C.l2, border: `1px solid ${C.brd}` }}>
    <div className="flex items-center gap-1.5">
      {Glyph && <Glyph size={13} style={{ color: color ?? C.t3 }} />}
      <p className="text-[10px] font-semibold" style={{ color: C.t3 }}>{label}</p>
    </div>
    <p className="mt-1 text-lg font-black" style={{ color: color ?? C.t1 }}>{value}</p>
  </div>
  );
};

export const Empty = ({ title, hint, Icon = Package }:
{ title: string; hint?: string; Icon?: LucideIcon }) => (
  <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    <Icon size={28} style={{ color: C.t3 }} />
    <p className="text-sm font-bold" style={{ color: C.t2 }}>{title}</p>
    {hint && <p className="text-[11px]" style={{ color: C.t3 }}>{hint}</p>}
  </div>
);

export const Field = ({ label, children, hint }:
{ label: string; children: React.ReactNode; hint?: string }) => (
  <label className="block">
    <p className="mb-1 text-[11px] font-semibold" style={{ color: C.t3 }}>{label}</p>
    {children}
    {hint && <p className="mt-1 text-[10px]" style={{ color: C.t3 }}>{hint}</p>}
  </label>
);

export const inputStyle = {
  background: C.l2,
  border: `1px solid ${C.brd}`,
  color: C.t1,
};

export const Alert = ({ text, kind = 'error' }: { text: string; kind?: 'error' | 'info' }) => (
  <div className="rounded-xl px-3 py-2 text-[11px] font-semibold"
    style={{
      background: kind === 'error' ? 'rgba(239,68,68,0.12)' : C.l2,
      color: kind === 'error' ? C.red : C.t2,
      border: `1px solid ${kind === 'error' ? 'rgba(239,68,68,0.25)' : C.brd}`,
    }}>
    {text}
  </div>
);

/* ── Картинка товара ──────────────────────────────────────────────── */

/**
 * Картинка по идентификатору.
 *
 * Адрес собирается из идентификатора, который выдал сервер. Ни имени
 * файла, ни пути на диске клиент не знает и знать не должен.
 */
export const ProductImage = ({ imageId, alt, className, style }:
{ imageId?: string; alt: string; className?: string; style?: React.CSSProperties }) => {
  const [broken, setBroken] = useState(false);
  const mi = useMarketImage();
  if (!imageId || broken || !mi.ready) {
    return (
      <div className={className} style={{ ...style, background: C.l3, display: 'grid', placeItems: 'center' }}>
        {!imageId || broken ? <ImageOff size={20} style={{ color: C.t3 }} /> : null}
      </div>
    );
  }
  return (
    <img key={mi.nonce} src={marketImageUrl(imageId)} alt={alt} className={className} style={style}
      loading="lazy" onError={() => mi.fail(() => setBroken(true))} />
  );
};

/* ── Логотип товара ───────────────────────────────────────────────── */

/**
 * Марка товара.
 *
 * Своя, если продавец её загрузил. Нет своей — берём то, что и так
 * узнаваемо: у игрового лота обложку его игры, у остального аватар
 * магазина. Нет и этого — буква названия на своём цвете: пустой серый
 * квадрат не говорит ничего, а буква хотя бы отличает один товар от
 * другого.
 *
 * Спрашиваем только то, что точно есть: сервер присылает признаки
 * «у магазина есть аватар» и «у игры есть обложка». Без них карточка
 * запрашивала бы картинку наугад, и каталог из тридцати товаров стоил
 * бы тридцати лишних запросов, каждый из которых заканчивается ничем.
 */
export const ProductLogo = ({ product, size = 28 }: { product: Product; size?: number }) => {
  const chain = [
    product.hasLogo ? productLogoUrl(product.id) : null,
    product.gameId && product.gameHasCover ? gameCoverUrl(product.gameId) : null,
    product.sellerId && product.sellerHasAvatar ? sellerAvatarUrl(product.sellerId) : null,
  ].filter(Boolean) as string[];

  const [step, setStep] = useState(0);
  const mi = useMarketImage();
  const src = mi.ready ? chain[step] : undefined;
  if (!mi.ready && chain.length) return <div style={{ width: size, height: size, borderRadius: size / 4, background: C.l3, flexShrink: 0 }} />;

  /* Буква названия на цвете, выведенном из идентификатора: один и тот
     же товар всегда одного цвета. */
  if (!src) {
    let hash = 0;
    for (const ch of product.id) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return (
      <div style={{
        width: size, height: size, borderRadius: size / 4,
        background: `hsl(${hash} 45% 30%)`, color: '#fff',
        display: 'grid', placeItems: 'center',
        fontSize: size * 0.45, fontWeight: 800, flexShrink: 0,
      }}>
        {(product.title.trim()[0] ?? '?').toUpperCase()}
      </div>
    );
  }

  return (
    <img key={`${step}-${mi.nonce}`} src={src} alt="" onError={() => mi.fail(() => setStep((n) => n + 1))}
      style={{
        width: size, height: size, borderRadius: size / 4,
        objectFit: 'cover', flexShrink: 0, background: C.l3,
      }} />
  );
};

/* ── Карточка товара ──────────────────────────────────────────────── */

export const ProductCard = ({ product, onOpen, onFavorite }:
{ product: Product; onOpen: () => void; onFavorite?: () => void }) => {
  const discount = product.oldPriceKop && product.oldPriceKop > product.priceKop
    ? Math.round((1 - product.priceKop / product.oldPriceKop) * 100)
    : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl text-left"
      style={{ background: C.l1, border: `1px solid ${C.brd}` }}>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <div className="relative">
          <ProductImage imageId={product.images[0]} alt={product.title}
            className="h-32 w-full object-cover" style={{ display: 'block' }} />
          {discount > 0 && (
            <span className="absolute left-2 top-2 rounded-lg px-1.5 py-0.5 text-[9px] font-black text-white"
              style={{ background: C.red }}>−{discount}%</span>
          )}
          {!product.inStock && (
            <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(0,0,0,0.55)' }}>
              <span className="text-[11px] font-bold text-white">Нет в наличии</span>
            </div>
          )}
        </div>
        <div className="p-2.5">
          <div className="flex items-start gap-2">
            <ProductLogo product={product} size={26} />
            <p className="line-clamp-2 text-[12px] font-semibold" style={{ color: C.t1 }}>{product.title}</p>
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <p className="text-sm font-black" style={{ color: C.t1 }}>{fmt(product.price)}</p>
            {product.oldPrice != null && (
              <p className="text-[10px] line-through" style={{ color: C.t3 }}>{fmt(product.oldPrice)}</p>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <Stars rating={product.rating} size={10} />
            <span className="text-[9px]" style={{ color: C.t3 }}>
              {product.reviewCount > 0 ? product.reviewCount : 'нет отзывов'}
            </span>
          </div>
          {(product.shipsFromAbroad === true || product.intlShipping === true) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {product.shipsFromAbroad === true && (
                <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: C.accBg, color: C.acc }}>Из-за рубежа</span>
              )}
              {product.intlShipping === true && (
                <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: C.accBg, color: C.acc }}>Международная доставка</span>
              )}
            </div>
          )}
          {product.sellerName && (
            <p className="mt-1 truncate text-[10px]" style={{ color: C.t3 }}>{product.sellerName}</p>
          )}
        </div>
      </button>
      {onFavorite && (
        <button type="button" onClick={onFavorite}
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg"
          style={{ background: 'rgba(0,0,0,0.45)' }}>
          <Heart size={13} style={{ color: product.favorite ? C.red : '#fff' }}
            fill={product.favorite ? C.red : 'none'} />
        </button>
      )}
    </div>
  );
};
