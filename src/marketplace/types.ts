/* ======================================================================
   SKY MARKET — типы

   Это отражение того, что отдаёт сервер, и ничего сверх. Здесь нет
   баланса продавца, вывода средств, комиссии и замороженных сумм —
   Sky не хранит деньги сделки, покупатель платит продавцу напрямую.

   Всё, что лежит в этих полях, — уже решение сервера. Переписать их в
   памяти вкладки можно, кнопки нарисуются; нажатие всё равно уйдёт на
   сервер, а тот спросит базу и ответит отказом.
====================================================================== */

export type MarketType = 'standard' | 'game' | 'service';

/** Вид услуги. Список ведёт сервер — здесь только подписи. */
export type ServiceCategory =
  | 'design' | 'dev' | 'music' | 'video' | 'writing' | 'marketing' | 'gaming' | 'other';

export const SERVICE_CATEGORY_LABEL: Record<ServiceCategory, string> = {
  design: 'Дизайн', dev: 'Разработка', music: 'Музыка', video: 'Видео',
  writing: 'Текст', marketing: 'Маркетинг', gaming: 'Гейминг', other: 'Другое',
};

export type ServiceLevel = 'basic' | 'standard' | 'premium';

export const SERVICE_LEVEL_LABEL: Record<ServiceLevel, string> = {
  basic: 'Базовый', standard: 'Стандарт', premium: 'Премиум',
};

/**
 * Пакет услуги.
 *
 * Цену отсюда клиент не отправляет обратно: при заказе уходит только
 * уровень, а цену и срок берёт сервер из своей базы.
 */
export interface ServicePackage {
  level: ServiceLevel;
  title: string;
  description: string;
  price: number;
  priceKop: number;
  delivery: number;
  /** -1 — без ограничения. */
  revisions: number;
  includes: string[];
}

export type ProductCategory =
  | 'electronics' | 'clothing' | 'home' | 'beauty'
  | 'sports' | 'books' | 'toys' | 'food' | 'other';

/**
 * Состояние сделки — ровно то же, что в машине переходов на сервере.
 *
 * Слова declared и confirmed означают заявления сторон, а не проверку
 * платежа: Sky перевода не видит.
 */
export type OrderStatus =
  | 'created'
  | 'payment_pending'
  | 'buyer_payment_declared'
  | 'seller_payment_confirmed'
  | 'fulfillment'
  | 'seller_shipped'
  | 'in_transit'
  | 'ready_for_pickup'
  | 'buyer_received'
  | 'completed'
  | 'cancelled'
  | 'disputed';

/** Действие, которое клиент вправе попросить. Состояние выбирает сервер. */
export type OrderAction = 'accept' | 'declare_paid' | 'confirm_paid' | 'fulfill' | 'received';

export type OrderRole = 'buyer' | 'seller' | 'support';

export type SellerStatus = 'pending' | 'active' | 'suspended';

/**
 * Режим работы магазина.
 *
 *   direct    — заказ уходит покупателю сразу: службой или своими силами.
 *   warehouse — заказы собираются в поставку, едут на свой склад, и уже
 *               оттуда продавец везёт покупателю сам.
 */
export type FulfilmentMode = 'direct' | 'warehouse';

export type GameCategoryKey =
  | 'currency' | 'accounts' | 'keys' | 'dlc' | 'items'
  | 'skins' | 'services' | 'subscriptions' | 'giftcards' | 'licenses';

export const GAME_CATEGORY_LABEL: Record<GameCategoryKey, string> = {
  currency: 'Игровая валюта', accounts: 'Аккаунты', keys: 'Ключи', dlc: 'DLC',
  items: 'Предметы', skins: 'Скины', services: 'Услуги', subscriptions: 'Подписки',
  giftcards: 'Gift Cards', licenses: 'Игровые лицензии',
};

export const CATEGORY_LABEL: Record<ProductCategory, string> = {
  electronics: 'Электроника', clothing: 'Одежда', home: 'Дом', beauty: 'Красота',
  sports: 'Спорт', books: 'Книги', toys: 'Игрушки', food: 'Питание', other: 'Другое',
};

export interface Game {
  id: string;
  title: string;
  slug: string;
  description: string;
  hasCover: boolean;
  order: number;
  hidden: boolean;
}

export interface Product {
  id: string;
  sellerId: string;
  sellerName?: string;
  sellerRating?: number;
  /** Есть ли чем заменить логотип: карточка не спрашивает картинку наугад. */
  sellerHasAvatar?: boolean;
  gameHasCover?: boolean;
  marketType: MarketType;
  title: string;
  description: string;
  /** Копейки — для расчётов. Рубли — для показа. Обратно не отправляется ни то, ни другое. */
  priceKop: number;
  price: number;
  oldPriceKop?: number;
  oldPrice?: number;
  category: ProductCategory;
  stock: number;
  inStock: boolean;
  sold: number;
  rating: number | null;
  reviewCount: number;
  active: boolean;
  /** Идентификаторы картинок. Адрес собирается на месте, путей на диске здесь нет. */
  images: string[];
  /** Есть ли своя марка. Нет — карточка возьмёт обложку игры или аватар магазина. */
  hasLogo: boolean;
  gameId?: string;
  gameTitle?: string;
  gameCategory?: GameCategoryKey;
  region?: string;
  serviceCategory?: ServiceCategory;
  tags: string[];
  packages?: ServicePackage[];
  /** Статус публикации. Видна ли карточка, решает сервер, а не флажок. */
  moderationStatus?: ModerationStatus;
  moderationReason?: string;
  itemCondition?: 'new' | 'used';
  itemSource?: 'personal' | 'own_production' | 'resale';
  markingDeclared?: 'not_required' | 'required' | 'unsure';
  /** Происхождение и отправка — разные сведения. Отметки приходят от сервера готовыми. */
  originCountry?: string;
  shipFromCountry?: string;
  itemLocationCountry?: string;
  shipsFromAbroad?: boolean;
  locatedAbroad?: boolean;
  intlShipping?: boolean;
  deliveryDaysMin?: number;
  deliveryDaysMax?: number;
  importInfo?: string;
  sellerTaxKind?: TaxKind;
  /** Продвигается ли товар прямо сейчас. Решает сервер. */
  promoted?: boolean;
  favorite?: boolean;
  own?: boolean;
  createdAt?: string;
}

export type ModerationStatus =
  'draft' | 'pending' | 'needs_changes' | 'approved' | 'published' | 'hidden' | 'blocked' | 'archived';

export type TaxKind = 'individual' | 'npd' | 'ip' | 'legal';

export interface Review {
  id: string;
  rating: number;
  text: string;
  buyerName: string;
  createdAt?: string;
}

export interface Subscription {
  active: boolean;
  status: 'active' | 'expired' | 'inactive';
  until: string | null;
  price: number;
  days: number;
}

export type VerificationState =
  'none' | 'draft' | 'submitted' | 'in_review' | 'needs_changes' | 'approved'
  | 'rejected' | 'suspended' | 'reverify' | 'legacy';

export interface Seller {
  id: string;
  shopName: string;
  description: string;
  hasAvatar: boolean;
  /** Есть ли куда переводить. Видно всем — сами реквизиты нет. */
  hasPaymentDetails: boolean;
  /** Как магазин отправляет заказы: напрямую или через свой склад. */
  fulfilmentMode: FulfilmentMode;
  /** Какой именно склад — только в своём профиле. */
  fulfilmentWarehouseId?: string | null;
  /** Только в своём профиле. Покупателю они приходят по его заказу. */
  paymentDetails?: string;
  status: SellerStatus;
  /** Подтверждённый проверкой налоговый статус — виден и покупателям. */
  taxKind?: TaxKind;
  /** Состояние проверки — только в своём профиле. */
  verification?: VerificationState;
  activities?: string[];
  suspendReason?: string;
  rating: number | null;
  reviewCount: number;
  ordersTotal?: number;
  ordersDone?: number;
  ordersCancelled?: number;
  subscription?: Subscription;
  createdAt?: string;
}

/** Счётчики продавца. Денег здесь нет и быть не может. */
export interface SellerStats {
  rating: number | null;
  reviewCount: number;
  ordersTotal: number;
  ordersDone: number;
  ordersCancelled: number;
  ordersOpen: number;
  productsActive: number;
}

export interface Order {
  id: string;
  marketType: MarketType;
  status: OrderStatus;
  stateSeq: number;
  productId: string;
  title: string;
  priceKop: number;
  price: number;
  quantity: number;
  totalKop: number;
  total: number;
  buyerId: string;
  sellerId: string;
  role: OrderRole;
  address: string;
  contact: string;
  pickupPointId: string | null;
  packingStartedAt: string | null;
  packedAt: string | null;
  paidDeclaredAt: string | null;
  paidConfirmedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string;
  pickupUntil: string | null;
  supplyId: string | null;
  atWarehouseAt: string | null;
  packageLevel: ServiceLevel | null;
  packageTitle: string | null;
  deliveryDays: number | null;
  dueAt: string | null;
  requirements: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrderEvent {
  role: 'buyer' | 'seller' | 'support' | 'system';
  from: string | null;
  to: string;
  detail: Record<string, unknown>;
  at?: string;
}

export type ShipMethod = 'carrier' | 'seller_self';
export type ShipDestination = 'pickup_point' | 'buyer_address';

export interface PickupPoint {
  id: string;
  title: string;
  city: string;
  address: string;
  phone: string;
  workFrom: string;
  workTo: string;
  holdDays: number;
}

export interface Carrier {
  id: string;
  kind: 'external' | 'inhouse';
  code: string | null;
  title: string;
  city: string;
  minPriceKop: number;
  minPrice: number;
  pricePerKmKop: number;
  maxWeightG: number;
  etaHours: number;
  rating: number | null;
}

/** Своя транспортная компания — то, что видит её владелец. */
export interface MyCarrier {
  id: string;
  title: string;
  city: string;
  active: boolean;
  etaHours: number;
  minPrice: number;
}

/** Поручение своей компании: что везти и куда. */
export interface CarrierJob {
  orderId: string;
  title: string;
  orderStatus: OrderStatus;
  status: string;
  statusText: string;
  destination: ShipDestination;
  carrier: string;
  address: string;
  contact: string;
  pickupPoint: { title: string; city: string; address: string } | null;
  pickupUntil: string | null;
  eta: string | null;
}

export interface Shipment {
  orderId: string;
  method: ShipMethod;
  destination: ShipDestination;
  carrier: { title: string; kind: string; code: string | null } | null;
  pickupPoint: { id: string; title: string; city: string; address: string; workFrom: string; workTo: string } | null;
  tracking: string | null;
  status: string;
  statusText: string;
  location: string | null;
  eta: string | null;
  pickupUntil: string | null;
  /** Код получения из пункта выдачи. Виден только покупателю, и только пока заказ его ждёт. */
  pickupCode?: string | null;
  /** Кому и куда платить за доставку. Видит только продавец заказа. */
  carrierPayment: { carrier: string; details: string } | null;
  updatedAt?: string;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  role: 'buyer' | 'seller' | 'support' | 'system';
  text: string;
  read: boolean;
  createdAt?: string;
}

/** Чат сделки. Это не диалог мессенджера и в его списках не появляется. */
export interface DealChat {
  id: string;
  orderId: string;
  role: OrderRole;
  orderStatus: OrderStatus;
  marketType: MarketType;
  title: string;
  unread?: number;
  lastMessage?: string;
  lastAt?: string | null;
  createdAt?: string;
}

export interface MarketNotification {
  id: string;
  orderId: string | null;
  kind: string;
  title: string;
  body: string;
  read: boolean;
  createdAt?: string;
}

/** Тариф продвижения. Цену и срок задаёт сервер. */
export interface PromoPlan {
  id: 'basic' | 'pro' | 'premium';
  title: string;
  price: number;
  days: number;
  note: string;
}

export interface Promotion {
  id: string;
  productId: string;
  productTitle?: string;
  plan: string;
  planTitle: string;
  amount: number;
  days: number;
  startsAt?: string;
  endsAt?: string;
  active: boolean;
}

export interface MarketConfig {
  categories: ProductCategory[];
  gameCategories: GameCategoryKey[];
  serviceCategories: ServiceCategory[];
  serviceLevels: ServiceLevel[];
  marketTypes: MarketType[];
  sellerPrice: number;
  sellerDays: number;
  moneyModel: 'direct';
}

/* ─── Подписи состояний ───────────────────────────────────────────
   Один список на весь клиент: разошедшиеся подписи — это способ
   показать покупателю и продавцу разное про одну и ту же сделку.  */

export const ORDER_LABEL: Record<OrderStatus, string> = {
  created: 'Оформлен',
  payment_pending: 'Ждёт оплаты',
  buyer_payment_declared: 'Покупатель отправил деньги',
  seller_payment_confirmed: 'Продавец получил деньги',
  fulfillment: 'В работе',
  seller_shipped: 'Отправлен',
  in_transit: 'В пути',
  ready_for_pickup: 'Ждёт в пункте выдачи',
  buyer_received: 'Получен',
  completed: 'Закрыт',
  cancelled: 'Отменён',
  disputed: 'Спор',
};

export const ACTION_LABEL: Record<OrderAction, { buyer: string; seller: string }> = {
  accept:       { buyer: '', seller: 'Принять заказ' },
  declare_paid: { buyer: 'Отправил деньги', seller: '' },
  confirm_paid: { buyer: '', seller: 'Получил деньги' },
  fulfill:      { buyer: '', seller: 'Выдать заказ' },
  received:     { buyer: 'Подтверждаю получение', seller: '' },
};
