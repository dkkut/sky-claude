/**
 * Sky Market: состояние вкладки.
 *
 * Хранилище здесь — это кэш ответов сервера, а не вторая копия правды.
 * Всё, что видно на экране, пришло с сервера; всё, что человек делает,
 * уходит на сервер и возвращается его ответом. В localStorage не
 * ложится ни товар, ни заказ, ни продавец: витрина, собранная в
 * браузере, показывает то, что браузеру удобно.
 *
 * Чего здесь нет совсем: баланса продавца, вывода средств, комиссии и
 * замороженных сумм. Sky не хранит деньги сделки — покупатель платит
 * продавцу напрямую, и считать этот перевод нам нечем и незачем.
 */
import { create } from 'zustand';
import {
  apiMarketConfig, apiCatalog, apiGames, apiMySeller, apiSellerStats,
  apiMyProducts, apiFavorites, apiSetFavorite, apiOrders,
  apiMarketNotifications, apiReadAllNotifications, apiDealChats, apiDealUnread,
  type CatalogQuery,
} from './marketApi';
import type {
  Product, Seller, SellerStats, Order, Game, MarketNotification, DealChat, MarketConfig,
} from './types';

interface MarketState {
  config: MarketConfig | null;
  games: Game[];

  catalog: Product[];
  catalogLoading: boolean;
  catalogError: string | null;

  seller: Seller | null;
  sellerLoaded: boolean;
  stats: SellerStats | null;
  myProducts: Product[];

  favorites: Product[];
  ordersBuy: Order[];
  ordersSell: Order[];

  notifications: MarketNotification[];
  chats: DealChat[];
  unread: number;

  loadConfig: () => Promise<void>;
  loadGames: () => Promise<void>;
  loadCatalog: (query?: CatalogQuery) => Promise<void>;
  loadSeller: () => Promise<void>;
  loadSellerData: () => Promise<void>;
  loadFavorites: () => Promise<void>;
  toggleFavorite: (product: Product) => Promise<void>;
  loadOrders: (side: 'buyer' | 'seller') => Promise<void>;
  loadNotifications: () => Promise<void>;
  readAllNotifications: () => Promise<void>;
  loadChats: () => Promise<void>;
  loadUnread: () => Promise<void>;
  setSeller: (seller: Seller | null) => void;
  patchProduct: (product: Product) => void;
  patchOrder: (order: Order) => void;
}

export const useMarketStore = create<MarketState>((set, get) => ({
  config: null,
  games: [],
  catalog: [],
  catalogLoading: false,
  catalogError: null,
  seller: null,
  sellerLoaded: false,
  stats: null,
  myProducts: [],
  favorites: [],
  ordersBuy: [],
  ordersSell: [],
  notifications: [],
  chats: [],
  unread: 0,

  loadConfig: async () => {
    if (get().config) return;
    const r = await apiMarketConfig();
    if (r.ok && r.data) set({ config: r.data });
  },

  loadGames: async () => {
    const r = await apiGames();
    if (r.ok && r.data) set({ games: r.data.games });
  },

  loadCatalog: async (query = {}) => {
    set({ catalogLoading: true, catalogError: null });
    const r = await apiCatalog(query);
    if (r.ok && r.data) set({ catalog: r.data.items, catalogLoading: false });
    else set({ catalogLoading: false, catalogError: r.reason ?? 'Не удалось загрузить каталог' });
  },

  loadSeller: async () => {
    const r = await apiMySeller();
    set({ seller: r.ok ? (r.data?.seller ?? null) : null, sellerLoaded: true });
  },

  /** Кабинет целиком: счётчики и свои товары. */
  loadSellerData: async () => {
    const [stats, products] = await Promise.all([apiSellerStats(), apiMyProducts()]);
    set({
      stats: stats.ok && stats.data ? stats.data.stats : null,
      myProducts: products.ok && products.data ? products.data.items : [],
    });
  },

  loadFavorites: async () => {
    const r = await apiFavorites();
    if (r.ok && r.data) set({ favorites: r.data.items });
  },

  /**
   * Избранное переключается на сервере, а не в памяти вкладки: иначе
   * сердечко закрашивалось бы и тогда, когда сервер отказал.
   */
  toggleFavorite: async (product) => {
    const next = !product.favorite;
    const r = await apiSetFavorite(product.id, next);
    if (!r.ok) return;
    const mark = (list: Product[]) =>
      list.map((p) => (p.id === product.id ? { ...p, favorite: next } : p));
    set({ catalog: mark(get().catalog), myProducts: mark(get().myProducts) });
    await get().loadFavorites();
  },

  loadOrders: async (side) => {
    const r = await apiOrders(side);
    if (!r.ok || !r.data) return;
    set(side === 'buyer' ? { ordersBuy: r.data.items } : { ordersSell: r.data.items });
  },

  loadNotifications: async () => {
    const r = await apiMarketNotifications();
    if (r.ok && r.data) set({ notifications: r.data.items });
  },

  readAllNotifications: async () => {
    await apiReadAllNotifications();
    set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) });
  },

  loadChats: async () => {
    const r = await apiDealChats();
    if (r.ok && r.data) set({ chats: r.data.chats });
  },

  loadUnread: async () => {
    const r = await apiDealUnread();
    if (r.ok && r.data) set({ unread: r.data.unread });
  },

  setSeller: (seller) => set({ seller, sellerLoaded: true }),

  patchProduct: (product) => set({
    catalog: get().catalog.map((p) => (p.id === product.id ? product : p)),
    myProducts: get().myProducts.map((p) => (p.id === product.id ? product : p)),
  }),

  patchOrder: (order) => set({
    ordersBuy: get().ordersBuy.map((o) => (o.id === order.id ? { ...o, ...order } : o)),
    ordersSell: get().ordersSell.map((o) => (o.id === order.id ? { ...o, ...order } : o)),
  }),
}));
