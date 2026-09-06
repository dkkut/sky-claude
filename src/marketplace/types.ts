/* ======================================================================
   SKY MARKET  -  Types
====================================================================== */

export type ProductCategory =
  | 'electronics' | 'clothing' | 'home' | 'beauty'
  | 'sports' | 'books' | 'toys' | 'food' | 'other';

export type MarketType = 'standard' | 'game';

export type OrderStatus =
  | 'pending'          // ожидает оплаты/подтверждения продавца
  | 'confirmed'        // продавец подтвердил
  | 'shipped'          // отправлен, трек-номер присвоен
  | 'delivered'        // покупатель подтвердил получение
  | 'cancelled'        // отменён
  | 'disputed';        // спор

export type SellerStatus = 'pending' | 'active' | 'suspended';

/* ── Игровой маркет: игры и категории — реальные сущности, управляются
   из Admin Panel, а не хардкод во frontend ── */
export interface Game {
  id:          string;
  title:       string;
  slug:        string;          // для /market/games/:slug
  coverUrl?:   string;
  description: string;
  categories:  string[];        // ключи из GAME_CATEGORY_LABEL, выбранные для этой игры
  order:       number;          // порядок отображения
  hidden:      boolean;
  createdAt:   string;
}

export type GameCategoryKey =
  | 'currency' | 'accounts' | 'keys' | 'dlc' | 'items'
  | 'skins' | 'services' | 'subscriptions' | 'giftcards' | 'licenses';

export const GAME_CATEGORY_LABEL: Record<GameCategoryKey, string> = {
  currency: 'Игровая валюта', accounts: 'Аккаунты', keys: 'Ключи', dlc: 'DLC',
  items: 'Предметы', skins: 'Скины', services: 'Услуги', subscriptions: 'Подписки',
  giftcards: 'Gift Cards', licenses: 'Игровые лицензии',
};

export type DeliveryMethod = 'instant' | 'manual';

export interface Product {
  id:          string;
  sellerId:    string;
  title:       string;
  description: string;
  price:       number;          // в рублях
  oldPrice?:   number;          // зачёркнутая цена
  badge?:      string;          // ХИТ / NEW / ЛИМ / −X%
  discount?:   number;          // % скидки
  category:    ProductCategory;
  images:      string[];        // base64 или blob URL
  stock:       number;
  rating:      number;          // 0-5
  reviewCount: number;
  sold:        number;
  createdAt:   string;
  active:      boolean;
  /* ── Игровой маркет (marketType==='game') ── */
  marketType:      MarketType;      // 'standard' — обычный товар, 'game' — игровой лот
  gameId?:          string;         // ссылка на Game.id
  gameCategory?:     GameCategoryKey;
  deliveryMethod?:   DeliveryMethod;
  region?:           string;       // регион аккаунта/ключа, если применимо
}

export interface Review {
  id:        string;
  productId: string;
  buyerId:   string;
  buyerName: string;
  rating:    number;    // 1-5
  text:      string;
  createdAt: string;
}

export interface Order {
  id:          string;
  trackNumber: string;           // авто-генерируется: SKY-XXXX-XXXX
  buyerId:     string;
  sellerId:    string;
  productId:   string;
  productTitle:string;
  productImage?:string;
  quantity:    number;
  price:       number;           // цена за единицу
  total:       number;           // итого
  status:      OrderStatus;
  address:     string;
  createdAt:   string;
  shippedAt?:  string;
  deliveredAt?:string;
  cancelReason?:string;
  deliveryCompanyId?:   string;
  deliveryCompanyName?: string;
  deliverySource?:      'seller'|'skymarket'|'external';
  deliveryPrice?:       number;
  marketType:  MarketType;       // 'standard' | 'game'
  commissionRate?: number;       // ставка на момент заказа (снимок, не пересчитывается задним числом)
  commissionAmount?: number;
}

export interface SellerProfile {
  accountId:   string;
  shopName:    string;
  description: string;
  status:      SellerStatus;
  balance:     number;           // рублей к выводу
  totalEarned: number;
  commission:  number;           // 0.05 = 5%
  createdAt:   string;
  rating:      number;
  salesCount:  number;
}

export interface WithdrawRequest {
  id:        string;
  sellerId:  string;
  amount:    number;             // сумма до комиссии
  fee:       number;             // комиссия 5%
  net:       number;             // к выводу
  status:    'pending' | 'done';
  createdAt: string;
}

/* ── Глобальные ставки комиссии по типу маркета — задаются только из
   Admin Panel, фронтенд их не хардкодит и не может передать своё значение ── */
export interface MarketCommissionRates {
  standard: number;   // 0.05 = 5%
  game:     number;
}
