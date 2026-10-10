/**
 * Sky Market: разговор с сервером.
 *
 * Здесь только вызовы. Ни одна проверка отсюда не заменяет серверную:
 * этот файл живёт в браузере, а браузер переписывается.
 *
 * Чего этот файл не отправляет никогда:
 *   · цену товара и продавца — сервер берёт их из своей базы;
 *   · своё «я продавец» и «подписка активна» — право торговать
 *     спрашивается у базы, а подписку оплачивают деньгами;
 *   · новое состояние заказа — уходит название действия, а состояние
 *     выбирает машина переходов;
 *   · трек-номер и состояние посылки — их приносит перевозчик.
 */
import { apiCall, uploadUrl } from '@/core/auth/api';
import { NATIVE_APP } from '@/core/nativeApp';
import type {
  Product, Review, Seller, SellerStats, Order, OrderEvent, OrderAction,
  Game, PickupPoint, Carrier, Shipment, DealChat, ChatMessage,
  MarketNotification, MarketConfig, MarketType, ProductCategory,
  GameCategoryKey, ShipMethod, ShipDestination, MyCarrier, CarrierJob,
  ServiceCategory, ServiceLevel, ServicePackage, FulfilmentMode,
  PromoPlan, Promotion,
} from './types';

const q = (params: Record<string, string | number | undefined | null>) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
};

const enc = encodeURIComponent;

/* ─── Что умеет сервер ────────────────────────────────────────────── */

export const apiMarketConfig = () => apiCall<MarketConfig>('/api/market/config');

/* ─── Каталог ─────────────────────────────────────────────────────── */

export interface CatalogQuery {
  type?: MarketType;
  q?: string;
  category?: ProductCategory;
  gameId?: string;
  gameCategory?: GameCategoryKey;
  serviceCategory?: ServiceCategory;
  sellerId?: string;
  sort?: 'new' | 'cheap' | 'expensive' | 'popular' | 'rating';
  limit?: number;
  offset?: number;
  minPrice?: number;
  maxPrice?: number;
  /** ru — отправка из России, abroad — из-за рубежа, intl — международная доставка. */
  shipping?: 'ru' | 'abroad' | 'intl';
}

export const apiCatalog = (query: CatalogQuery = {}) =>
  apiCall<{ items: Product[] }>(`/api/market/catalog${q(query as Record<string, string>)}`);

export const apiProduct = (id: string) =>
  apiCall<{ product: Product }>(`/api/market/products/${enc(id)}`);

export const apiProductReviews = (id: string, limit = 50) =>
  apiCall<{ reviews: Review[] }>(`/api/market/products/${enc(id)}/reviews${q({ limit })}`);

/**
 * Пропуск для картинок маркета.
 *
 * Тег <img> заголовок авторизации отправить не умеет: адрес в src
 * браузер тянет сам. Без пропуска каждая картинка маркета получала в
 * ответ 401, срабатывала подстановка «не загрузилась», и витрина стояла
 * с серыми прямоугольниками вместо товара.
 *
 * В обычном браузере пропуск едет курьером в куке, но в родном
 * приложении страница и API — разные origin, а кука SameSite=Strict
 * туда попросту не доедет. Поэтому там же пропуск подставляется в адрес
 * строкой (?t=), и адрес становится абсолютным (uploadUrl) — иначе
 * относительный путь резолвился бы не туда, а в свой пустой origin.
 */
let mediaTicket: string | null = null;

/**
 * Тот же пропуск нужен и логистике, и картам (server/marketticket.mjs
 * выдаёт один пропуск сразу на все три пути) — поэтому его можно
 * забрать отсюда, не выпрашивая заново.
 */
export const getMarketMediaTicket = () => mediaTicket;

const withMediaTicket = (path: string) => {
  const url = uploadUrl(path);
  if (!NATIVE_APP || !mediaTicket) return url;
  return `${url}?t=${encodeURIComponent(mediaTicket)}`;
};

/** Адрес картинки. Собирается здесь, потому что путей на диске клиенту не отдают. */
export const marketImageUrl = (imageId: string) => withMediaTicket(`/api/market/images/${enc(imageId)}`);
export const sellerAvatarUrl = (sellerId: string) => withMediaTicket(`/api/market/sellers/${enc(sellerId)}/avatar`);

export const apiMarketTicket = async () => {
  const r = await apiCall<{ ticket?: string }>('/api/market/ticket', { method: 'POST', body: '{}' });
  if (r.ok && r.data?.ticket) mediaTicket = r.data.ticket;
  return r.ok;
};
export const productLogoUrl = (productId: string) => withMediaTicket(`/api/market/products/${enc(productId)}/logo`);
export const gameCoverUrl = (gameId: string) => withMediaTicket(`/api/market/games/${enc(gameId)}/cover`);

/* ─── Избранное ───────────────────────────────────────────────────── */

export const apiFavorites = (limit = 100) =>
  apiCall<{ items: Product[] }>(`/api/market/favorites${q({ limit })}`);

export const apiSetFavorite = (productId: string, on: boolean) =>
  apiCall<{ ok: true }>(`/api/market/favorites/${enc(productId)}`, { method: on ? 'POST' : 'DELETE' });

/* ─── Игры ────────────────────────────────────────────────────────── */

export const apiGames = () => apiCall<{ games: Game[] }>('/api/market/games');

/* ─── Продавец ────────────────────────────────────────────────────── */

export const apiMySeller = () => apiCall<{ seller: Seller | null }>('/api/market/seller');

export const apiSeller = (sellerId: string) =>
  apiCall<{ seller: Seller }>(`/api/market/sellers/${enc(sellerId)}`);

export const apiCreateSeller = (input: { shopName: string; description?: string; paymentDetails?: string }) =>
  apiCall<{ seller: Seller }>('/api/market/seller', { method: 'POST', body: JSON.stringify(input) });

export const apiUpdateSeller = (patch: {
  shopName?: string; description?: string; paymentDetails?: string;
  fulfilmentMode?: FulfilmentMode; fulfilmentWarehouseId?: string | null;
}) =>
  apiCall<{ seller: Seller }>('/api/market/seller', { method: 'PATCH', body: JSON.stringify(patch) });

/** Подписка за место на витрине. Цену называет сервер. */
export const apiPaySellerSubscription = () =>
  apiCall<{ seller: Seller; balance: number }>('/api/market/seller/subscription',
    { method: 'POST', body: '{}' });

export const apiSellerStats = () => apiCall<{ stats: SellerStats }>('/api/market/seller/stats');

export const apiMyProducts = (limit = 100, offset = 0) =>
  apiCall<{ items: Product[] }>(`/api/market/seller/products${q({ limit, offset })}`);

export const apiUploadSellerAvatar = (file: Blob) =>
  apiCall<{ ok: true }>('/api/market/seller/avatar',
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

/**
 * Продвижение товара.
 *
 * Плата Sky за своё же место на витрине — как подписка продавца. Уходит
 * только название тарифа: цену и срок берёт сервер.
 */
export const apiPromotions = () =>
  apiCall<{ plans: PromoPlan[]; items: Promotion[] }>('/api/market/promotions');

export const apiBuyPromotion = (productId: string, plan: string) =>
  apiCall<{ promotion: Promotion; balance: number }>('/api/market/promotions',
    { method: 'POST', body: JSON.stringify({ productId, plan }) });

/* ─── Товары ──────────────────────────────────────────────────────── */

export interface ProductInput {
  marketType?: MarketType;
  title: string;
  description?: string;
  /** Только копейки: рубли с плавающей точкой однажды теряют копейку. */
  priceKop: number;
  oldPriceKop?: number | null;
  category?: ProductCategory;
  stock: number;
  serviceCategory?: ServiceCategory;
  tags?: string[];
  gameId?: string;
  gameCategory?: GameCategoryKey;
  region?: string;
  itemCondition?: 'new' | 'used' | null;
  itemSource?: 'personal' | 'own_production' | 'resale' | null;
  markingDeclared?: 'not_required' | 'required' | 'unsure' | null;
  originCountry?: string | null;
  shipFromCountry?: string | null;
  itemLocationCountry?: string | null;
  intlShipping?: boolean;
  deliveryDaysMin?: number | null;
  deliveryDaysMax?: number | null;
  importInfo?: string;
}

export const apiCreateProduct = (input: ProductInput) =>
  apiCall<{ product: Product }>('/api/market/products',
    { method: 'POST', body: JSON.stringify(input) });

export const apiUpdateProduct = (id: string, patch: Partial<ProductInput>) =>
  apiCall<{ product: Product }>(`/api/market/products/${enc(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });

/** Снять с витрины. Удаления нет: на товар ссылаются чужие заказы. */
export const apiArchiveProduct = (id: string) =>
  apiCall<{ ok: true }>(`/api/market/products/${enc(id)}`, { method: 'DELETE' });

/** Логотип товара — одна квадратная марка, отдельно от фотографий. */
export const apiUploadProductLogo = (productId: string, file: Blob) =>
  apiCall<{ ok: true }>(`/api/market/products/${enc(productId)}/logo`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

export const apiDeleteProductLogo = (productId: string) =>
  apiCall<{ ok: true }>(`/api/market/products/${enc(productId)}/logo`, { method: 'DELETE' });

export const apiUploadProductImage = (productId: string, file: Blob) =>
  apiCall<{ ok: true; imageId: string }>(`/api/market/products/${enc(productId)}/images`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });

export const apiDeleteProductImage = (imageId: string) =>
  apiCall<{ ok: true }>(`/api/market/images/${enc(imageId)}`, { method: 'DELETE' });

/**
 * Пакеты услуги.
 *
 * Уходят разом и разом же заменяются: три строки, которые всегда
 * правят вместе, проще переписать целиком.
 */
export const apiSetServicePackages = (
  productId: string,
  packages: (Pick<ServicePackage, 'level' | 'title' | 'description' | 'priceKop' | 'delivery' | 'revisions' | 'includes'>)[],
) => apiCall<{ product: Product }>(`/api/market/products/${enc(productId)}/packages`,
  { method: 'PUT', body: JSON.stringify({ packages }) });

/* ─── Заказы ──────────────────────────────────────────────────────── */

export interface OrderInput {
  productId: string;
  quantity: number;
  address?: string;
  contact?: string;
  pickupPointId?: string;
  /** Услуга заказывается пакетом: уходит уровень, цену берёт сервер. */
  packageLevel?: ServiceLevel;
  requirements?: string;
}

export const apiCreateOrder = (input: OrderInput) =>
  apiCall<{ order: Order }>('/api/market/orders', { method: 'POST', body: JSON.stringify(input) });

export const apiOrders = (side: 'buyer' | 'seller', status?: 'open' | 'closed') =>
  apiCall<{ items: Order[] }>(`/api/market/orders${q({ side, status })}`);

/**
 * Заказ вместе с реквизитами продавца.
 *
 * Реквизиты приходят с сервера и только покупателю этого заказа.
 * Присланные в чат реквизиты подменяет тот, кто в чат попал, — поэтому
 * платить нужно по тем, что пришли отсюда.
 */
export const apiOrder = (id: string) =>
  apiCall<{ order: Order; shipment: Shipment | null; paymentDetails: string | null }>(
    `/api/market/orders/${enc(id)}`);

export const apiOrderHistory = (id: string) =>
  apiCall<{ events: OrderEvent[] }>(`/api/market/orders/${enc(id)}/history`);

/** Уходит название действия. Новое состояние выбирает сервер. */
export const apiOrderAction = (id: string, action: OrderAction) =>
  apiCall<{ order: Order; repeated?: boolean }>(`/api/market/orders/${enc(id)}/action`,
    { method: 'POST', body: JSON.stringify({ action }) });

export const apiCancelOrder = (id: string, reason: string) =>
  apiCall<{ order: Order }>(`/api/market/orders/${enc(id)}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason }) });

export const apiDisputeOrder = (id: string, reason: string) =>
  apiCall<{ order: Order }>(`/api/market/orders/${enc(id)}/dispute`,
    { method: 'POST', body: JSON.stringify({ reason }) });

/** Все открытые споры сразу — для раздела «Sky Market» в админ-панели. */
export const apiDisputedOrders = (limit = 50) =>
  apiCall<{ orders: Order[] }>(`/api/market/admin/disputes${q({ limit })}`);

export const apiResolveDispute = (id: string, outcome: 'completed' | 'cancelled', note = '') =>
  apiCall<{ order: Order }>(`/api/market/orders/${enc(id)}/resolve`,
    { method: 'POST', body: JSON.stringify({ outcome, note }) });

export const apiMarkPacking = (id: string, done: boolean) =>
  apiCall<{ order: Order }>(`/api/market/orders/${enc(id)}/packing`,
    { method: 'POST', body: JSON.stringify({ done }) });

export const apiLeaveReview = (id: string, rating: number, text: string) =>
  apiCall<{ ok: true; reviewId: string }>(`/api/market/orders/${enc(id)}/review`,
    { method: 'POST', body: JSON.stringify({ rating, text }) });

/**
 * Положить заказ в поставку на свой склад.
 *
 * Шаг режима «через склад»: со склада продавец повезёт покупателю сам.
 */
export const apiPutOrderInSupply = (orderId: string, supplyId: string) =>
  apiCall<{ order: Order }>(`/api/market/orders/${enc(orderId)}/supply`,
    { method: 'POST', body: JSON.stringify({ supplyId }) });

export const apiSupplyOrders = (supplyId: string) =>
  apiCall<{ items: Order[] }>(`/api/market/supplies/${enc(supplyId)}/orders`);

/* ─── Доставка ────────────────────────────────────────────────────── */

export const apiPickupPoints = (city?: string) =>
  apiCall<{ points: PickupPoint[] }>(`/api/market/pickup-points${q({ city })}`);

export const apiCarriers = (city?: string) =>
  apiCall<{ carriers: Carrier[] }>(`/api/market/carriers${q({ city })}`);

export const apiShipment = (orderId: string) =>
  apiCall<{ shipment: Shipment }>(`/api/market/orders/${enc(orderId)}/shipment`);

/**
 * Отправить заказ.
 *
 * Четыре способа: службой в пункт выдачи, службой до двери, самому в
 * пункт выдачи, самому до двери. Трек-номера здесь нет: его выдаёт
 * сервер вместе с отправлением.
 */
export const apiShipOrder = (orderId: string, input: {
  method: ShipMethod;
  destination: ShipDestination;
  carrierId?: string;
  pickupPointId?: string;
}) => apiCall<{ order: Order; shipment: Shipment }>(`/api/market/orders/${enc(orderId)}/ship`,
  { method: 'POST', body: JSON.stringify(input) });

/** Продавец, который везёт сам, двигает свою посылку. Чужую — нет. */
export const apiMoveShipment = (orderId: string, status: 'in_transit' | 'arrived' | 'ready_for_pickup', note = '') =>
  apiCall<{ ok: true; shipment: Shipment }>(`/api/market/orders/${enc(orderId)}/shipment-status`,
    { method: 'POST', body: JSON.stringify({ status, note }) });

/* ─── Своя транспортная компания ──────────────────────────────────── */

/**
 * Компанию заводит администрация, а возит она сама.
 *
 * Вебхука у своей компании нет, поэтому состояние посылки она ставит
 * руками — но только у той посылки, которую ей поручили. Проверяет это
 * сервер, а не этот файл.
 */
export const apiMyCarriers = () => apiCall<{ carriers: MyCarrier[] }>('/api/market/carrier');

export const apiCarrierJobs = (limit = 100) =>
  apiCall<{ shipments: CarrierJob[] }>(`/api/market/carrier/shipments${q({ limit })}`);

/* ─── Чат сделки ──────────────────────────────────────────────────── */

export const apiDealChats = (limit = 50) =>
  apiCall<{ chats: DealChat[] }>(`/api/market/chats${q({ limit })}`);

export const apiDealChat = (chatId: string, limit = 50, before?: string) =>
  apiCall<{ chat: DealChat; messages: ChatMessage[] }>(
    `/api/market/chats/${enc(chatId)}${q({ limit, before })}`);

export const apiOrderChat = (orderId: string, limit = 50) =>
  apiCall<{ chat: DealChat; messages: ChatMessage[] }>(
    `/api/market/orders/${enc(orderId)}/chat${q({ limit })}`);

export const apiSendDealMessage = (chatId: string, text: string) =>
  apiCall<{ message: ChatMessage }>(`/api/market/chats/${enc(chatId)}/messages`,
    { method: 'POST', body: JSON.stringify({ text }) });

export const apiReadDealChat = (chatId: string) =>
  apiCall<{ ok: true; marked: number }>(`/api/market/chats/${enc(chatId)}/read`,
    { method: 'POST', body: '{}' });

export const apiDealUnread = () => apiCall<{ unread: number }>('/api/market/unread');

/* ─── Уведомления ─────────────────────────────────────────────────── */

export const apiMarketNotifications = (limit = 50) =>
  apiCall<{ items: MarketNotification[] }>(`/api/market/notifications${q({ limit })}`);

export const apiReadNotification = (id: string) =>
  apiCall<{ ok: boolean }>('/api/market/notifications/read',
    { method: 'POST', body: JSON.stringify({ id }) });

export const apiReadAllNotifications = () =>
  apiCall<{ marked: number }>('/api/market/notifications/read',
    { method: 'POST', body: JSON.stringify({ all: true }) });

/* ─── Администрация ───────────────────────────────────────────────── */

export const apiCreateGame = (input: { title: string; slug: string; description?: string; order?: number }) =>
  apiCall<{ game: Game }>('/api/market/admin/games', { method: 'POST', body: JSON.stringify(input) });

export const apiUpdateGame = (id: string, patch: { title?: string; description?: string; hidden?: boolean; order?: number }) =>
  apiCall<{ game: Game }>(`/api/market/admin/games/${enc(id)}`,
    { method: 'PATCH', body: JSON.stringify(patch) });

export const apiUploadGameCover = (gameId: string, file: Blob) =>
  apiCall<{ ok: true }>(`/api/market/admin/games/${enc(gameId)}/cover`,
    { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
